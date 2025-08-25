# Accounts Receivable (AR) Statements

This repository contains tools for automating and visualizing **Accounts Receivable (AR) management** at **New England Truck Center**. It combines two components that both operate on the same QuickBooks export (`qb_ar_aging_detail_<DATE>.csv`):

1. **Customer Statement Generator** (Python scripts)  
   - Automates creation of customer statements from AR data.  
   - Outputs ready-to-send PDF or email templates.  

2. **AR Executive Dashboard** (HTML/CSS/JS)  
   - An interactive, browser-based dashboard for real-time AR insights.  
   - Provides KPIs, visualizations, and invoice drill-downs.  

Both tools are kept in this folder because they exclusively depend on the **QuickBooks AR Aging Detail export** (`qb_ar_aging_detail_<DATE>.csv`) as their data source.

---

## 📂 Project Structure

```

ar_statements/
├── qb_ar_aging_detail_<DATE>.csv     # QuickBooks AR Aging Detail export
│
├── statements.py                     # Main script for generating customer statements
├── config.py                         # Configuration (paths, email templates, formatting)
├── utils.py                          # Helper functions (date parsing, balances, etc.)
│
├── dashboard.html                    # Main AR Executive Dashboard interface
├── dashboard.css                     # Styling for dashboard UI
├── dashboard.js                      # Dashboard interactivity & data processing

````

---

## ⚙️ Customer Statement Generator (Python)

- **Input:** `qb_ar_aging_detail_<DATE>.csv` (QuickBooks export)  
- **Output:** Customer statements (PDF or HTML templates for email).  
- **Key Features:**  
  - Generates individualized statements by customer.  
  - Summarizes open invoices, overdue balances, and totals.  
  - Configurable branding and message templates (`config.py`).  

### Running the Generator
```bash
python statements.py
````

Place the latest QuickBooks export (`qb_ar_aging_detail_<DATE>.csv`) in the folder before running.

---

## 📊 AR Executive Dashboard (HTML/JS/CSS)

* **Input:** `qb_ar_aging_detail_<DATE>.csv` uploaded via dashboard.
* **Output:** Interactive dashboard in browser.
* **Key Features:**

  * **KPIs:** Total AR, Current, Overdue, 90+ Days
  * **Charts:** Balances by aging bucket, overall distribution, largest overdue exposures
  * **Tables:** Aging summary and detailed invoice breakdown
  * **Filtering:** Search and filter by customer or bucket.

### Running the Dashboard

1. Open `dashboard.html` in a browser.
2. Upload the most recent `qb_ar_aging_detail_<DATE>.csv`.
3. Explore KPIs, charts, and invoice details interactively.

---

## 🚀 Future Enhancements

* Automate email sending with SMTP integration.
* Add multi-period trend analysis to dashboard.
* Extend CSV parsing to handle custom QB export formats.