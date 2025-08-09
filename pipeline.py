#!/usr/bin/env python3
"""
NETC AR Statement Builder — persistent output tree (HTML only, no PDFs).

- Root folder is constant: ./Customer_Statements
- One subfolder per customer (slug)
- Keep historical statements per day per customer:
    <Customer>/<slug>_statement_<YYYY-MM-DD>.html
  Overwrite same-day; keep different days.
- email_template.txt is always the latest only (overwrite)
- Top-level index.html / send_statements.csv / Aging_Summary.xlsx overwritten each run
"""
import os
import textwrap
import zipfile
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
from jinja2 import Environment, BaseLoader, select_autoescape

from config import Company, BUCKET_CANON, BUCKET_MAP
from templates import INDEX_HTML, STATEMENT_HTML, EMAIL_TXT
from utils import (
    ALIASES, pick, clean_str, parse_money, fmt_money, slugify,
    excel_engine_or_csv_fallback, autodetect_csv, bucketize,
)


# ---------- Excel helpers ----------
def _apply_formats_xlsxwriter(writer, sheet_name, df):
    wb = writer.book
    ws = writer.sheets[sheet_name]
    money = wb.add_format({'num_format': '$#,##0.00'})
    ints = wb.add_format({'num_format': '0'})
    datef = wb.add_format({'num_format': 'yyyy-mm-dd'})
    # simple adaptive widths
    for i, col in enumerate(df.columns):
        maxlen = max([len(str(col))] + [len(str(v)) for v in df[col].astype(str).values[:200]])
        ws.set_column(i, i, min(maxlen + 2, 40))
    for i, col in enumerate(df.columns):
        nm = str(col).lower()
        if "amount" in nm or "balance" in nm or "total" in nm:
            ws.set_column(i, i, None, money)
        elif "days" in nm:
            ws.set_column(i, i, None, ints)
        elif "date" in nm or nm in ("due", "due_dt"):
            ws.set_column(i, i, None, datef)


def _apply_formats_openpyxl(writer, sheet_name):
    from openpyxl.styles import numbers
    ws = writer.sheets[sheet_name]
    header = [cell.value for cell in next(ws.iter_rows(min_row=1, max_row=1))]
    for col_idx, name in enumerate(header, start=1):
        nm = (str(name) if name is not None else "").lower()
        if "amount" in nm or "balance" in nm or "total" in nm:
            fmt = numbers.FORMAT_CURRENCY_USD_SIMPLE
        elif "days" in nm:
            fmt = "0"
        elif "date" in nm or nm in ("due", "due_dt"):
            fmt = numbers.FORMAT_DATE_YYYYMMDD2
        else:
            fmt = None
        if fmt:
            for cell in ws.iter_cols(min_col=col_idx, max_col=col_idx, min_row=2):
                for c in cell:
                    c.number_format = fmt


# ---------- Helpers ----------
def _normalize_bucket(raw_aging, dpd):
    """Return canonical bucket label.
    - If raw_aging is a known label, map it.
    - If raw_aging looks numeric (e.g., '72'), map by bucketize.
    - Else compute from DPD.
    """
    s = clean_str(raw_aging)
    # direct label
    if s in BUCKET_CANON or s in BUCKET_MAP:
        lab = BUCKET_MAP.get(s, s)
        if lab in BUCKET_CANON:
            return lab
    # numeric-like?
    try:
        return bucketize(int(float(s)))
    except Exception:
        pass
    # fallback to DPD
    try:
        return bucketize(int(dpd))
    except Exception:
        return "Current"


def _avg_int(series: pd.Series) -> int:
    """Safe integer average; returns 0 for empty/NaN."""
    if series is None or series.empty:
        return 0
    m = pd.to_numeric(series, errors="coerce").mean()
    return int(m) if pd.notna(m) else 0


# ---------- Main build ----------
def build_all(input_csv: str | None, as_of_str: str | None, outdir: Path | None,
              logo_override: str | None = None) -> None:
    as_of = pd.to_datetime(as_of_str).date() if as_of_str else date.today()
    company = Company()
    if logo_override:
        company.logo_src = logo_override

    # Persistent root: fixed folder
    base_root = (outdir if outdir else Path("./Customer_Statements")).resolve()
    base_root.mkdir(parents=True, exist_ok=True)

    # Input CSV (auto-detect allowed)
    if not input_csv:
        input_csv = autodetect_csv([Path.cwd(), Path.cwd() / "input", Path.home() / "Downloads"])
    if not input_csv:
        raise SystemExit("No CSV found. Provide --input or place a CSV in ./, ./input, or ~/Downloads.")
    input_csv = Path(input_csv)

    # Load raw
    raw0 = pd.read_csv(input_csv, dtype=str, encoding="utf-8-sig", on_bad_lines="skip")
    raw0.columns = [c.strip() for c in raw0.columns]

    cols = {k: pick(raw0, v) for k, v in ALIASES.items()}
    for critical in ("name", "type", "open_balance"):
        if not cols[critical]:
            raise SystemExit(f"Missing required column for '{critical}'. Found columns: {list(raw0.columns)}")

    # Normalize working df
    df0 = raw0.copy()
    df0["customer"] = df0[cols["name"]].map(clean_str)
    df0["type"] = df0[cols["type"]].map(clean_str)
    df0["num"] = df0[cols["num"]].map(clean_str) if cols["num"] else ""
    df0["po"] = df0[cols["po"]].map(clean_str) if cols["po"] else ""
    df0["terms"] = df0[cols["terms"]].map(clean_str) if cols["terms"] else ""
    df0["invoice_date"] = pd.to_datetime(df0[cols["date"]], errors="coerce") if cols["date"] else pd.NaT
    df0["due_date"] = pd.to_datetime(df0[cols["due_date"]], errors="coerce") if cols["due_date"] else pd.NaT
    df0["amount"] = df0[cols["open_balance"]].map(parse_money).astype(float)

    # --- DPD & Age (compute first, then clamp) ---
    dpd_supplied = (
        pd.to_numeric(df0[cols["days_past_due"]], errors="coerce")
        if cols.get("days_past_due") else pd.Series(index=df0.index, dtype="float64")
    )
    df0["days_past_due"] = dpd_supplied
    need_dpd = df0["days_past_due"].isna() & df0["due_date"].notna()
    df0.loc[need_dpd, "days_past_due"] = (pd.Timestamp(as_of) - df0.loc[need_dpd, "due_date"]).dt.days

    df0["invoice_age_days"] = (pd.Timestamp(as_of) - df0["invoice_date"]).dt.days

    # normalize types and clamp
    df0["days_past_due"] = pd.to_numeric(df0["days_past_due"], errors="coerce").fillna(0)
    df0["invoice_age_days"] = pd.to_numeric(df0["invoice_age_days"], errors="coerce").fillna(0)
    df0["days_past_due"] = df0["days_past_due"].clip(lower=0)
    df0["invoice_age_days"] = df0["invoice_age_days"].clip(lower=0)
    # DPD cannot exceed invoice age
    df0["days_past_due"] = df0[["days_past_due", "invoice_age_days"]].min(axis=1)
    # final dtypes
    df0["days_past_due"] = df0["days_past_due"].astype("int64")
    df0["invoice_age_days"] = df0["invoice_age_days"].astype("int64")

    # Buckets
    if cols.get("aging"):
        df0["bucket"] = [_normalize_bucket(a, d) for a, d in zip(df0[cols["aging"]], df0["days_past_due"])]
    else:
        df0["bucket"] = df0["days_past_due"].map(bucketize)

    # Clean text cols (no literal "nan")
    for c in ["customer", "type", "num", "po", "terms", "bucket"]:
        df0[c] = df0.get(c, "").fillna("").astype(str).str.strip()

    # STRICT FILTERS: only real invoice/credit detail
    reasons = []
    keep = pd.Series(True, index=df0.index)

    m = df0["customer"].str.len() > 0
    reasons.append(("blank_customer", ~m));
    keep &= m

    m = df0["type"].str.len() > 0
    reasons.append(("blank_type", ~m));
    keep &= m

    type_norm = df0["type"].str.lower()
    m = type_norm.str.contains(r"(?:invoice|credit)", regex=True, na=False)
    reasons.append(("non_invoice_or_credit", ~m));
    keep &= m

    m = (df0["num"].str.len() > 0) | df0["invoice_date"].notna() | df0["due_date"].notna()
    reasons.append(("no_num_and_no_dates", ~m));
    keep &= m

    m = df0["amount"].notna() & (df0["amount"].abs() > 1e-6)
    reasons.append(("zero_or_nan_amount", ~m));
    keep &= m

    dropped = int((~keep).sum())
    if dropped:
        rej = df0.loc[~keep].copy()
        rej["reject_reason"] = ""
        for name, mm in reasons:
            rej.loc[rej["reject_reason"].eq("") & mm.loc[rej.index], "reject_reason"] = name
        (base_root / "_rejected_rows.csv").write_text(rej.to_csv(index=False), encoding="utf-8")
        print(f"⚠️  Dropped {dropped} non-detail rows. See {base_root / '_rejected_rows.csv'}")

    df = df0.loc[keep].copy()
    if df.empty:
        raise SystemExit("No valid invoice/credit rows after filtering. Check your export.")

    df["is_overdue"] = df["days_past_due"] > 0

    # Jinja env
    env = Environment(loader=BaseLoader(), autoescape=select_autoescape())
    t_statement = env.from_string(STATEMENT_HTML)
    t_index = env.from_string(INDEX_HTML)
    t_email = env.from_string(EMAIL_TXT)

    # Per-customer generation
    summaries = []
    for cust in sorted(df["customer"].dropna().unique()):
        cdf = df.loc[df["customer"].eq(cust)].copy()
        cust_dir = base_root / slugify(cust)
        cust_dir.mkdir(parents=True, exist_ok=True)

        total_due = float(cdf["amount"].sum())
        bucket_sums = cdf.groupby("bucket")["amount"].sum().reindex(BUCKET_CANON, fill_value=0.0)
        overdue_total = float(cdf.loc[cdf["is_overdue"], "amount"].sum())

        # Minimal, collector-focused metrics
        open_mask = cdf["amount"] > 0
        over_mask = cdf["is_overdue"] & open_mask

        avg_dpd = _avg_int(cdf.loc[over_mask, "days_past_due"])
        oldest_past_due = int(cdf.loc[over_mask, "days_past_due"].max()) if over_mask.any() else 0

        overdue_sorted = cdf[cdf["is_overdue"]].sort_values("amount", ascending=False)
        largest_overdue = (
            f"{overdue_sorted['num'].iat[0]} ({fmt_money(overdue_sorted['amount'].iat[0])})"
            if not overdue_sorted.empty else "N/A"
        )

        metrics = {
            "Invoices": int(len(cdf)),
            "Overdue invoices": int(cdf["is_overdue"].sum()),
            "Avg days past due": avg_dpd,  # overdue only
            "Oldest days past due": oldest_past_due,
            "Total due": fmt_money(total_due),
            "Overdue total": fmt_money(overdue_total),
            "Largest overdue invoice": largest_overdue,
        }

        # Rows (sorted: overdue first, then oldest due first)
        rows = []
        cdf = cdf.sort_values(["is_overdue", "due_date", "invoice_date", "num"], ascending=[False, True, True, True])
        for _, r in cdf.iterrows():
            rows.append({
                "type": r["type"],
                "num": r["num"],
                "invoice_date": "" if pd.isna(r["invoice_date"]) else r["invoice_date"].date().isoformat(),
                "due_date": "" if pd.isna(r["due_date"]) else r["due_date"].date().isoformat(),
                "terms": r["terms"],
                "po": r["po"],
                "amount": float(r["amount"]),
                "amount_fmt": fmt_money(r["amount"]),
                "bucket": r["bucket"],
                "days_past_due": int(r["days_past_due"]),
                "is_overdue": bool(r["is_overdue"]),
            })

        # Statement file: keep history by day; overwrite if same day
        statement_name = f"{slugify(cust)}_statement_{as_of.isoformat()}.html"
        statement_path = cust_dir / statement_name

        html = t_statement.render(
            company=company, as_of=as_of.isoformat(),
            customer=cust, metrics=metrics, rows=rows,
            total_due_fmt=fmt_money(total_due),
            bucket_totals={b: fmt_money(bucket_sums[b]) for b in BUCKET_CANON},
        )
        statement_path.write_text(html, encoding="utf-8")

        # Email template: overwrite to most recent only
        email_txt = t_email.render(company=company, as_of=as_of.isoformat(), customer=cust,
                                   total_due_fmt=fmt_money(total_due))
        (cust_dir / "email_template.txt").write_text(textwrap.dedent(email_txt).strip(), encoding="utf-8")

        summaries.append({
            "Customer": cust,
            "As Of": as_of.isoformat(),
            "Statement": str(statement_path),
            **{b: float(bucket_sums[b]) for b in BUCKET_CANON},
            "Total Due": total_due,
        })

    if not summaries:
        raise SystemExit("No billable rows after filtering. Check Open Balance parsing.")

    # Sort and write top-level artifacts (overwrite each run)
    summary = pd.DataFrame(summaries).sort_values(["Total Due", "Customer"], ascending=[False, True])
    summary.to_csv(base_root / "send_statements.csv", index=False)

    engine = excel_engine_or_csv_fallback()
    if engine:
        with pd.ExcelWriter(base_root / "Aging_Summary.xlsx", engine=engine) as writer:
            # Raw
            raw_out = raw0.copy()
            for c in raw_out.columns:
                cl = c.lower()
                if "days" in cl:
                    raw_out[c] = pd.to_numeric(raw_out[c], errors="coerce")
                elif "balance" in cl or "amount" in cl or "open" in cl:
                    raw_out[c] = pd.to_numeric(raw_out[c], errors="coerce")
                elif "date" in cl:
                    raw_out[c] = pd.to_datetime(raw_out[c], errors="coerce")
            raw_out.to_excel(writer, index=False, sheet_name="Detail (Raw)")
            if engine == "xlsxwriter":
                _apply_formats_xlsxwriter(writer, "Detail (Raw)", raw_out)
            else:
                _apply_formats_openpyxl(writer, "Detail (Raw)")

            # Clean
            clean_cols = ["customer", "type", "num", "po", "terms", "invoice_date", "due_date", "amount",
                          "days_past_due", "bucket", "is_overdue", "invoice_age_days"]
            clean_out = pd.DataFrame(df, columns=clean_cols).copy()
            clean_out["days_past_due"] = pd.to_numeric(clean_out["days_past_due"], errors="coerce").fillna(0).astype(
                "int64")
            clean_out["invoice_age_days"] = pd.to_numeric(clean_out["invoice_age_days"], errors="coerce").fillna(
                0).astype("int64")
            clean_out.to_excel(writer, index=False, sheet_name="Detail (Clean)")
            if engine == "xlsxwriter":
                _apply_formats_xlsxwriter(writer, "Detail (Clean)", clean_out)
            else:
                _apply_formats_openpyxl(writer, "Detail (Clean)")

            # By Customer (latest)
            summary.to_excel(writer, index=False, sheet_name="By Customer")
            if engine == "xlsxwriter":
                _apply_formats_xlsxwriter(writer, "By Customer", summary)
            else:
                _apply_formats_openpyxl(writer, "By Customer")
    else:
        raw0.to_csv(base_root / "Detail_Raw.csv", index=False)
        df[["customer", "type", "num", "po", "terms", "invoice_date", "due_date", "amount", "days_past_due", "bucket",
            "is_overdue", "invoice_age_days"]].to_csv(base_root / "Detail_Clean.csv", index=False)
        summary.to_csv(base_root / "By_Customer.csv", index=False)

    # Index (links to latest statements we just wrote)
    rows = []
    for _, r in summary.iterrows():
        rel = os.path.relpath(r["Statement"], base_root).replace("\\", "/")
        rows.append({"customer": r["Customer"], "rel_path": rel, "total_due_fmt": fmt_money(r["Total Due"])})

    grand_total_raw = round(float(summary["Total Due"].sum()), 2)
    index_html = env.from_string(INDEX_HTML).render(
        company=company, as_of=as_of.isoformat(),
        rows=rows, grand_total_fmt=fmt_money(grand_total_raw),
        grand_total=grand_total_raw,
    )
    (base_root / "index.html").write_text(index_html, encoding="utf-8")

    # Optional: zip (overwrite same name each run to avoid growing artifacts)
    zip_path = base_root / "Customer_Statements_latest.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(base_root):
            for f in files:
                # don't include the zip itself
                fp = Path(root) / f
                if fp == zip_path:
                    continue
                z.write(fp, arcname=str(fp.relative_to(base_root)))

    print(f"✅ Built {len(summaries)} statements into {base_root}")
    print(f"   Open: {(base_root / 'index.html')}")
