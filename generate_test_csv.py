#!/usr/bin/env python3
import pandas as pd
from datetime import date, timedelta

today = pd.Timestamp("2025-08-08")

rows = [
    # Overdue positive in each bucket
    ("Bucket Current (future due)", "Invoice", today, "C-1", "", "Net 30", today + pd.Timedelta(days=5), 100.00),
    ("Bucket 1-30", "Invoice", today - pd.Timedelta(days=15), "A-1", "", "Net 0", today - pd.Timedelta(days=15),
     200.00),
    ("Bucket 31-60", "Invoice", today - pd.Timedelta(days=45), "B-1", "", "Net 0", today - pd.Timedelta(days=45),
     300.00),
    ("Bucket 61-90", "Invoice", today - pd.Timedelta(days=75), "C-1", "", "Net 0", today - pd.Timedelta(days=75),
     400.00),
    ("Bucket 90+", "Invoice", today - pd.Timedelta(days=120), "D-1", "", "Net 0", today - pd.Timedelta(days=120),
     500.00),
    # Credit (negative)
    ("Credit Example", "Credit Memo", today - pd.Timedelta(days=10), "CM-1", "", "Net 0", today - pd.Timedelta(days=10),
     -150.00),
    # Missing due date (should default to Current/0 dpd)
    ("Missing Due", "Invoice", today - pd.Timedelta(days=5), "MD-1", "", "Net 30", None, 50.00),
    # Weird customer name (slugify test)
    ("Zip's AW Direct / Statewide Towing, Inc.", "Invoice", today - pd.Timedelta(days=3), "Z-1", "", "",
     today - pd.Timedelta(days=1), 75.25),
    # Aging label normalization (>90 → 90+) – provide Days_Past_Due + Aging_Bucket_Calc
]

df = pd.DataFrame(rows, columns=["Name", "Type", "Date", "Num", "PO", "Terms", "Due Date", "Open Balance"])
# Extra aging columns for normalization test
df["Days_Past_Due"] = [0, 15, 45, 75, 120, 10, 0, 1]
df["Aging_Bucket_Calc"] = ["Current", "1-30", "31-60", "61-90", ">90", "1-30", "Current", "1-30"]

df.to_csv("edge_suite.csv", index=False)
print("Wrote edge_suite.csv")
