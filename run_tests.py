#!/usr/bin/env python3
"""
Validate latest NETC AR output.

- Prefers newest "Customer_Statements_*" directory; falls back to ZIP.
- Checks: integer DPD, no literal 'nan' strings, bucket vocabulary, totals
  reconciliation, index grand total, presence of overdue/credit styling.
"""
import argparse
import io
import re
import sys
import zipfile
from pathlib import Path

import pandas as pd


def find_latest():
    dirs = [p for p in Path(".").glob("Customer_Statements_*") if p.is_dir()]
    zips = sorted(Path(".").glob("Customer_Statements_*.zip"), key=lambda p: p.stat().st_mtime, reverse=True)
    if dirs:
        dirs.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        return dirs[0], False
    if zips:
        return zips[0], True
    return None, None


def assert_true(cond, msg, errs):
    if not cond: errs.append(msg)


def read_text_file(base, is_zip, relpath):
    if is_zip:
        with zipfile.ZipFile(base) as z:
            return z.read(relpath).decode("utf-8", errors="ignore")
    return (base / relpath).read_text(encoding="utf-8", errors="ignore")


def read_send_statements(base, is_zip):
    if is_zip:
        with zipfile.ZipFile(base) as z:
            with z.open("send_statements.csv") as f:
                return pd.read_csv(f)
    return pd.read_csv(base / "send_statements.csv")


def read_excel(base, is_zip):
    if is_zip:
        with zipfile.ZipFile(base) as z:
            data = z.read("Aging_Summary.xlsx")
            xf = pd.ExcelFile(io.BytesIO(data))
            return {
                "raw": pd.read_excel(xf, "Detail (Raw)"),
                "clean": pd.read_excel(xf, "Detail (Clean)"),
                "bycust": pd.read_excel(xf, "By Customer"),
            }
    xf = pd.ExcelFile(base / "Aging_Summary.xlsx")
    return {
        "raw": pd.read_excel(xf, "Detail (Raw)"),
        "clean": pd.read_excel(xf, "Detail (Clean)"),
        "bycust": pd.read_excel(xf, "By Customer"),
    }


def class_present(html: str, cls: str) -> bool:
    return re.search(r'class=["\'][^"\']*\b' + re.escape(cls) + r'\b', html) is not None


def any_statement_has_class(base, is_zip, cls):
    if is_zip:
        with zipfile.ZipFile(base) as z:
            for n in z.namelist():
                if n.endswith(".html") and "_statement_" in n:
                    h = z.read(n).decode("utf-8", errors="ignore")
                    if class_present(h, cls): return True
        return False
    else:
        for p in base.rglob("*_statement_*.html"):
            h = p.read_text(encoding="utf-8", errors="ignore")
            if class_present(h, cls): return True
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", help="Output directory or zip", default=None)
    args = ap.parse_args()

    if args.out:
        base = Path(args.out)
        is_zip = base.suffix.lower() == ".zip"
        if not base.exists():
            print(f"Output not found: {base}");
            sys.exit(2)
    else:
        base, is_zip = find_latest()
        if base is None:
            print("No outputs found (Customer_Statements_*).");
            sys.exit(2)

    errs = []

    # Core files
    try:
        ss = read_send_statements(base, is_zip)
    except Exception as e:
        print(f"Failed to read send_statements.csv: {e}");
        sys.exit(1)
    try:
        xl = read_excel(base, is_zip)
    except Exception as e:
        print(f"Failed to read Aging_Summary.xlsx: {e}");
        sys.exit(1)

    raw = xl["raw"]
    clean = xl["clean"]
    bycust = xl["bycust"]

    assert_true("Customer" in ss.columns and "Total Due" in ss.columns, "send_statements.csv missing columns", errs)

    # DPD ints
    if "days_past_due" in clean.columns:
        frac = clean["days_past_due"].dropna().astype(float).mod(1).ne(0).any()
        assert_true(not frac, "Detail (Clean): days_past_due not integer", errs)

    # Literal 'nan' strings (not NaN cells)
    for col in ("terms", "po"):
        if col in clean.columns:
            bad_literal = clean[col].apply(lambda x: isinstance(x, str) and x.strip().lower() == "nan").any()
            assert_true(not bad_literal, f"Detail (Clean): found literal 'nan' string in {col}", errs)

    # Buckets
    if "bucket" in clean.columns:
        ok = {"Current", "1-30", "31-60", "61-90", "90+"}
        assert_true(set(clean["bucket"].dropna().unique()).issubset(ok), "Non-canonical bucket found", errs)

    # Totals reconcile
    sums = clean.groupby("customer")["amount"].sum().round(2)
    cmp1 = bycust.set_index("Customer")["Total Due"].round(2)
    cmp2 = ss.set_index("Customer")["Total Due"].round(2)
    for cust, v in sums.items():
        assert_true(abs(v - float(cmp1.get(cust, 0))) < 0.01, f"Mismatch total in By Customer for {cust}", errs)
        assert_true(abs(v - float(cmp2.get(cust, 0))) < 0.01, f"Mismatch total in send_statements for {cust}", errs)

    # Index grand total
    idx_html = read_text_file(base, is_zip, "index.html")
    grand_expected = float(ss["Total Due"].sum())
    m_attr = re.search(r'id=["\']grand-total["\']\s+[^>]*data-total=["\']([\d.]+)["\']', idx_html)
    if m_attr:
        shown = float(m_attr.group(1))
    else:
        m = re.search(r"Grand Total.*?\$([0-9,]+\.[0-9]{2})", idx_html, flags=re.S)
        shown = float(m.group(1).replace(",", "")) if m else None
    assert_true(shown is not None and abs(shown - grand_expected) < 0.01, "Grand total mismatch in index.html", errs)

    # Styling checks
    if ((clean["days_past_due"] > 0) & (clean["amount"] > 0)).any():
        assert_true(any_statement_has_class(base, is_zip, "overdue"),
                    "Overdue amounts present but no red styling found.", errs)
    if (clean["amount"] < 0).any():
        assert_true(any_statement_has_class(base, is_zip, "credit"),
                    "Negative amounts present but no credit (green) styling found.", errs)

    if errs:
        print("❌ TEST FAILURES:")
        for e in errs: print("-", e)
        sys.exit(1)
    print(f"✅ All checks passed on {'ZIP' if is_zip else 'DIR'}: {base}")


if __name__ == "__main__":
    main()
