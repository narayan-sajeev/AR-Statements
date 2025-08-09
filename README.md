# NETC — AR Statement Builder

Generate branded customer statements, a searchable index, and a clean aging workbook from a QuickBooks AR export.

## What it does

* Builds **per-customer statements** (Bootstrap 5) with clear collections metrics.
* Creates a **searchable index.html** with totals.
* Exports **Aging\_Summary.xlsx** with:

    * **Detail (Raw)** – your original export, typed (dates, currency, integer days).
    * **Detail (Clean)** – normalized columns for analysis.
    * **By Customer** – totals by customer and bucket.
* Normalizes aging buckets to **Current, 1-30, 31-60, 61-90, 90+** and renders **overdue rows in red** (amount bold),
  credits in green.

## Install

```bash
pip install pandas numpy jinja2 XlsxWriter openpyxl
```

> Any modern Python works. If you have multiple Pythons, run with the one that has the packages.

## Run

```bash
python run_statements.py
# or:
# python run_statements.py --input /path/to/ar.csv --as-of 2025-08-08 --outdir ./Statements_2025-08-08 --logo /path/to/logo.png
```

If `--input` is omitted, the tool auto-detects the newest `*.csv` in `.` / `./input` / `~/Downloads`.

## Output

```
Customer_Statements_<DATE>/
  index.html
  send_statements.csv
  Aging_Summary.xlsx
  <Customer>/  # one folder per customer
    <Customer>_statement_<DATE>.html
    email_template.txt
```

## Configure branding

Edit **config.py**:

* `name`, `address`, `email`, `phone`
* optional `logo_src` and `pay_now_url`

(Brand details are used in both statements and email drafts. Keep private info out of the repo.)

## CSV expectations

Flexible headers are supported (aliases included). If your export differs, update `ALIASES` in **utils.py**. If Days
Past Due / Aging Bucket aren’t present, the tool computes them.

## Notes

* Overdue styling is enforced and **Days Past Due are integers** everywhere.
* Bootstrap is loaded via CDN; offline use still works (unstyled).
