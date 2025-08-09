"""
Core pipeline:
- Load CSV (auto-alias column names)
- Normalize data (clean strings, parse money, compute/normalize DPD + buckets)
- Render per-customer statements (HTML) + email drafts (TXT)
- Write index.html with search and grand total
- Write Aging_Summary.xlsx with clean separation:
    * Detail (Raw)   : exactly the input CSV
    * Detail (Clean) : tidy normalized columns (no duplicates)
    * By Customer    : totals by customer with buckets
- Zip the output folder for easy sharing
"""
import os
import textwrap
import zipfile
from datetime import date
from pathlib import Path

import pandas as pd
from jinja2 import Environment, BaseLoader, select_autoescape

from config import Company, Settings, BUCKET_CANON, BUCKET_MAP
from templates import INDEX_HTML, STATEMENT_HTML, EMAIL_TXT
from utils import (
    ALIASES, pick, clean_str, parse_money, fmt_money, slugify,
    excel_engine_or_csv_fallback, autodetect_csv, bucketize,
)


# --- add in pipeline.py ---

def _apply_formats_xlsxwriter(writer, sheet_name, df):
    """Apply nice Excel formats using xlsxwriter."""
    wb = writer.book
    ws = writer.sheets[sheet_name]
    money = wb.add_format({'num_format': '$#,##0.00'})
    ints = wb.add_format({'num_format': '0'})
    datef = wb.add_format({'num_format': 'yyyy-mm-dd'})

    # Auto width
    for idx, col in enumerate(df.columns, 0):
        maxlen = max([len(str(col))] + [len(str(v)) for v in df[col].astype(str).values[:200]])
        ws.set_column(idx, idx, min(maxlen + 2, 40))

    # Per-column number formats
    for idx, col in enumerate(df.columns, 0):
        cname = col.lower()
        if "amount" in cname or "balance" in cname or "total" in cname:
            ws.set_column(idx, idx, None, money)
        elif "days" in cname:
            ws.set_column(idx, idx, None, ints)
        elif "date" in cname or cname in ("due", "due_dt", "due_dt"):
            ws.set_column(idx, idx, None, datef)


def _apply_formats_openpyxl(writer, sheet_name):
    """Basic number formats for openpyxl engine (best-effort)."""
    ws = writer.sheets[sheet_name]
    from openpyxl.styles import numbers
    header = [cell.value for cell in next(ws.iter_rows(min_row=1, max_row=1))]
    for col_idx, name in enumerate(header, start=1):
        nm = (name or "").lower()
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


def build_all(input_csv: str | None, as_of_str: str | None, outdir: Path | None,
              logo_override: str | None = None) -> None:
    # ---- Settings / branding ----
    as_of = pd.to_datetime(as_of_str).date() if as_of_str else date.today()
    company = Company()  # central place to change name/contact/links
    if logo_override:
        company.logo_src = logo_override
    settings = Settings(as_of=as_of, output_root=outdir)

    # ---- Locate CSV ----
    if not input_csv:
        input_csv = autodetect_csv([Path.cwd(), Path.cwd() / "input", Path.home() / "Downloads"])
    if not input_csv:
        raise SystemExit("No CSV found. Provide --input or place a CSV next to the tool / in ./input / in ~/Downloads.")
    input_csv = Path(input_csv)

    # ---- Load RAW ----
    raw = pd.read_csv(input_csv, dtype=str, encoding="utf-8-sig", on_bad_lines="skip")
    raw.columns = [c.strip() for c in raw.columns]
    cols = {k: pick(raw, v) for k, v in ALIASES.items()}
    for critical in ("name", "type", "open_balance"):
        if not cols[critical]:
            raise SystemExit(f"Missing required column for '{critical}'. Found columns: {list(raw.columns)}")

    # ---- Normalize (no 'nan'; consistent types) ----
    df = raw.copy()
    df["customer"] = df[cols["name"]].map(clean_str)
    df["type"] = df[cols["type"]].map(clean_str)
    df["num"] = df[cols["num"]].map(clean_str) if cols["num"] else ""
    df["po"] = df[cols["po"]].map(clean_str) if cols["po"] else ""
    df["terms"] = df[cols["terms"]].map(clean_str) if cols["terms"] else ""
    df["invoice_date"] = pd.to_datetime(df[cols["date"]], errors="coerce") if cols["date"] else pd.NaT
    df["due_date"] = pd.to_datetime(df[cols["due_date"]], errors="coerce") if cols["due_date"] else pd.NaT
    df["amount"] = df[cols["open_balance"]].map(parse_money).astype(float)

    # Days past due: prefer supplied column else compute from due date
    if cols["days_past_due"]:
        dpd = pd.to_numeric(df[cols["days_past_due"]], errors="coerce")
        df["days_past_due"] = dpd.where(dpd.notna(), (pd.Timestamp(as_of) - df["due_date"]).dt.days)
    else:
        df["days_past_due"] = (pd.Timestamp(as_of) - df["due_date"]).dt.days
    df["days_past_due"] = df["days_past_due"].fillna(0).astype(int)

    # Aging buckets: normalize labels or compute from DPD
    if cols["aging"]:
        tmp = df[cols["aging"]].map(lambda x: BUCKET_MAP.get(str(x).strip(), str(x).strip()))
        needs_compute = tmp.isna() | (tmp.eq(""))
        df["bucket"] = tmp.where(~needs_compute, df["days_past_due"].map(bucketize))
    else:
        df["bucket"] = df["days_past_due"].map(bucketize)

    df["is_overdue"] = df["days_past_due"] > 0
    df["invoice_age_days"] = (pd.Timestamp(as_of) - df["invoice_date"]).dt.days
    # Keep only non-zero balances and real rows
    df = df[(~df["type"].isna()) & (df["amount"].abs() > 0.00001)].copy()

    # ---- Output root ----
    out_root = settings.output_root or Path(f"./Customer_Statements_{as_of.isoformat()}")
    out_root.mkdir(parents=True, exist_ok=True)

    # ---- Templating ----
    env = Environment(loader=BaseLoader(), autoescape=select_autoescape())
    t_statement = env.from_string(STATEMENT_HTML)
    t_index = env.from_string(INDEX_HTML)
    t_email = env.from_string(EMAIL_TXT)

    # ---- Per-customer statements ----
    summaries = []
    for cust in sorted(df["customer"].dropna().unique()):
        cdf = df.loc[df["customer"].eq(cust)].copy()
        cust_dir = out_root / slugify(cust)
        cust_dir.mkdir(parents=True, exist_ok=True)

        total_due = float(cdf["amount"].sum())
        bucket_sums = cdf.groupby("bucket")["amount"].sum().reindex(BUCKET_CANON, fill_value=0.0)
        overdue_total = float(cdf.loc[cdf["is_overdue"], "amount"].sum())

        # These are the KPIs a CEO/AR lead cares about:
        avg_since_inv = int(cdf["invoice_age_days"].dropna().mean() or 0)
        avg_past_due = int(cdf.loc[cdf["is_overdue"], "days_past_due"].mean()) if cdf["is_overdue"].any() else 0
        oldest_past_due = int(cdf.loc[cdf["is_overdue"], "days_past_due"].max()) if cdf["is_overdue"].any() else 0

        metrics = {
            "Invoices": int(len(cdf)),
            "Overdue invoices": int(cdf["is_overdue"].sum()),
            "Average days since invoice": avg_since_inv,
            "Average days past due": avg_past_due,
            "Oldest days past due": oldest_past_due,
            "Total due": fmt_money(total_due),
            "Overdue total": fmt_money(overdue_total),
        }
        overdue_sorted = cdf[cdf["is_overdue"]].sort_values("amount", ascending=False)
        metrics["Largest overdue invoice"] = (
            f"{overdue_sorted['num'].iat[0]} ({fmt_money(overdue_sorted['amount'].iat[0])})"
            if not overdue_sorted.empty else "N/A"
        )

        # Row model for the HTML table (format amounts/dates here)
        rows = []
        for _, r in cdf.sort_values(["is_overdue", "due_date", "invoice_date", "num"],
                                    ascending=[False, True, True, True]).iterrows():
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

        # Render statement + write
        html = t_statement.render(
            company=company, as_of=as_of.isoformat(),
            customer=cust, metrics=metrics, rows=rows,
            total_due_fmt=fmt_money(total_due),
            bucket_totals={b: fmt_money(bucket_sums[b]) for b in BUCKET_CANON}
        )
        statement_path = cust_dir / f"{slugify(cust)}_statement_{as_of.isoformat()}.html"
        statement_path.write_text(html, encoding="utf-8")

        # Render email draft (branded)
        email_txt = t_email.render(company=company, as_of=as_of.isoformat(), customer=cust,
                                   total_due_fmt=fmt_money(total_due))
        (cust_dir / "email_template.txt").write_text(textwrap.dedent(email_txt).strip(), encoding="utf-8")

        summaries.append({
            "Customer": cust,
            "Statement": str(statement_path),
            **{b: float(bucket_sums[b]) for b in BUCKET_CANON},
            "Total Due": total_due
        })

    if not summaries:
        raise SystemExit("No billable rows after filtering. Check your Open Balance parsing.")

    # ---- Control files ----
    summary = pd.DataFrame(summaries).sort_values("Total Due", ascending=False)
    summary.to_csv(out_root / "send_statements.csv", index=False)

    engine = excel_engine_or_csv_fallback()
    if engine:
        with pd.ExcelWriter(out_root / "Aging_Summary.xlsx", engine=engine) as writer:
            # Detail (Raw) — coerce likely numeric/date cols so Excel shows proper types (no 30.0)
            raw_out = raw.copy()
            for c in ("Days_Past_Due", "Days Past Due", "Open_Balance", "Open Balance", "Date", "Due_Date", "Due Date"):
                if c in raw_out.columns:
                    if "Days" in c:
                        raw_out[c] = pd.to_numeric(raw_out[c], errors="coerce").fillna(0).astype("int64")
                    elif "Balance" in c or "Open" in c:
                        raw_out[c] = pd.to_numeric(raw_out[c], errors="coerce")
                    elif "Date" in c:
                        raw_out[c] = pd.to_datetime(raw_out[c], errors="coerce")

            raw_out.to_excel(writer, index=False, sheet_name="Detail (Raw)")
            if engine == "xlsxwriter":
                _apply_formats_xlsxwriter(writer, "Detail (Raw)", raw_out)
            else:
                _apply_formats_openpyxl(writer, "Detail (Raw)")

            # Detail (Clean) — already normalized, but apply formats for readability
            clean_cols = ["customer", "type", "num", "po", "terms", "invoice_date", "due_date", "amount",
                          "days_past_due", "bucket", "is_overdue", "invoice_age_days"]
            clean_out = pd.DataFrame(df, columns=clean_cols).copy()
            clean_out["days_past_due"] = clean_out["days_past_due"].astype("int64")
            clean_out["invoice_age_days"] = pd.to_numeric(clean_out["invoice_age_days"], errors="coerce").fillna(
                0).astype("int64")
            clean_out.to_excel(writer, index=False, sheet_name="Detail (Clean)")
            if engine == "xlsxwriter":
                _apply_formats_xlsxwriter(writer, "Detail (Clean)", clean_out)
            else:
                _apply_formats_openpyxl(writer, "Detail (Clean)")

            # By Customer — totals sheet, format amounts & auto width
            summary.to_excel(writer, index=False, sheet_name="By Customer")
            if engine == "xlsxwriter":
                _apply_formats_xlsxwriter(writer, "By Customer", summary)
            else:
                _apply_formats_openpyxl(writer, "By Customer")
    else:
        # CSV fallback
        raw.to_csv(out_root / "Detail_Raw.csv", index=False)
        df[["customer", "type", "num", "po", "terms", "invoice_date", "due_date", "amount", "days_past_due", "bucket",
            "is_overdue", "invoice_age_days"]].to_csv(out_root / "Detail_Clean.csv", index=False)
        summary.to_csv(out_root / "By_Customer.csv", index=False)

    # ---- Index page ----
    rows = []
    for _, r in summary.iterrows():
        rel = os.path.relpath(r["Statement"], out_root).replace("\\", "/")
        rows.append({"customer": r["Customer"], "rel_path": rel, "total_due_fmt": fmt_money(r["Total Due"])})
    index_html = t_index.render(
        company=company, as_of=as_of.isoformat(),
        rows=rows, grand_total_fmt=fmt_money(summary["Total Due"].sum())
    )
    (out_root / "index.html").write_text(index_html, encoding="utf-8")

    # ---- Zip bundle ----
    zip_path = Path(f"{out_root}.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(out_root):
            for f in files:
                fp = Path(root) / f
                z.write(fp, arcname=str(fp.relative_to(out_root)))

    print(f"✅ Built {len(summaries)} statements into {out_root.resolve()}")
    print(f"   Open: {(out_root / 'index.html').resolve()}")
