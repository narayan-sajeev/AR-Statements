"""
Helpers: parsing, aliases, bucket calc, file finding, slugging.
"""
import re
import unicodedata
from pathlib import Path

import numpy as np
import pandas as pd

# Try the faster, well-tested library first
try:
    from slugify import slugify as _ext_slugify  # pip install python-slugify
except Exception:
    _ext_slugify = None

_re_space = re.compile(r"\s+")
_re_bad = re.compile(r"[^A-Za-z0-9. -]+")
_re_quotes = re.compile(r"[’'`]")


def clean_str(x):
    if x is None: return ""
    # handles pandas NaN too
    if isinstance(x, float) and pd.isna(x): return ""
    return str(x).strip()


def parse_money(x):
    if pd.isna(x): return np.nan
    if isinstance(x, (int, float)): return float(x)
    s = str(x).strip().replace(",", "").replace("$", "")
    try:
        return float(s)
    except:
        return np.nan


def fmt_money(x):
    try:
        return "${:,.2f}".format(float(x))
    except:
        return x


def clean_folder_name(name: str) -> str:
    s = str(name or "")
    if _ext_slugify:
        out = _ext_slugify(s, lowercase=False, separator=" ", max_length=120)
        out = out.replace("/", "-").replace("\\", "-")
        return out.strip() or "Unknown"
    # Fallback (ASCII only)
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.replace("&", " and ")
    s = _re_quotes.sub("", s)
    s = s.replace("/", "-").replace("\\", "-")
    s = _re_bad.sub(" ", s)
    s = _re_space.sub(" ", s).strip()
    return s[:120] or "Unknown"


# Column aliases...
ALIASES = {
    "name": ["Name", "Customer", "Customer Name", "Customer_Name"],
    "type": ["Type", "Txn Type", "Txn_Type", "Doc Type", "Doc_Type"],
    "date": ["Date", "Txn Date", "Txn_Date", "Invoice Date", "Invoice_Date"],
    "num": ["Num", "No", "Doc Num", "Doc_Num", "Invoice", "Invoice Number", "Invoice_Number"],
    "po": ["P. O. #", "PO", "P.O.#", "PO Number", "PO_Number", "P_O_Number"],
    "terms": ["Terms"],
    "due_date": ["Due Date", "Due_Date", "Due", "DueDt", "Due_Dt"],
    "open_balance": ["Open Balance", "Open_Balance", "Balance", "Open Amount", "Open_Amount", "Amt Open", "Amt_Open"],
    "class": ["Class", "Dept", "Department"],
    "aging": ["Aging", "Aging Bucket", "Aging_Bucket", "Aging_Bucket_Calc"],
    "days_past_due": ["Days Past Due", "Days_Past_Due", "Days Overdue", "Days_Overdue"],
}


def pick(df: pd.DataFrame, keys: list[str]) -> str | None:
    for k in keys:
        if k in df.columns: return k
    return None


def autodetect_csv(search_dirs: list[Path]) -> str | None:
    cands = []
    for d in search_dirs:
        if not d.exists(): continue
        cands += [p for p in d.glob("*.csv")]
    if not cands: return None
    cands.sort(
        key=lambda p: (sum(s in p.name.lower() for s in ["aging", "ar", "receivable", "qb", "ar_detail", "quickbooks"]),
                       p.stat().st_mtime), reverse=True)
    return str(cands[0])


def bucketize(days: int) -> str:
    if pd.isna(days): return "Current"
    d = int(days)
    if d <= 0: return "Current"
    if d <= 30: return "1-30"
    if d <= 60: return "31-60"
    if d <= 90: return "61-90"
    return "90+"
