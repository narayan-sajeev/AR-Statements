# HTML + email templates (Bootstrap 5 via CDN)

INDEX_HTML = """<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>{{ company.name }} — Customer Statements — {{ as_of }}</title>
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet"
      integrity="sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH" crossorigin="anonymous">
<style>
  body { margin: 24px; }
  .sticky-th th { position: sticky; top: 0; background: #f8f9fa; z-index: 1; }
  .pre { white-space: pre-line; }
  @media print { * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body class="container-lg">
  <header class="mb-3">
    <div class="d-flex align-items-center gap-3">
      {% if company.logo_src %}
        <img src="{{ company.logo_src }}" alt="{{ company.name }} logo" style="height:48px; width:auto;">
      {% endif %}
      <div>
        <h1 class="h3 mb-1">{{ company.name }} — Customer Statements</h1>
        <div class="text-muted small">
          {{ company.email }} • {{ company.phone }} • <span class="pre d-inline">{{ company.address }}</span>
        </div>
        <span class="badge text-bg-light mt-2">As of {{ as_of }}</span>
      </div>
    </div>
  </header>

  <div class="mb-3">
    <input id="q" class="form-control form-control-sm" placeholder="Search customer or amount…" oninput="filt()">
  </div>

  <div class="table-responsive">
    <table class="table table-sm table-striped align-middle">
      <thead class="sticky-th">
        <tr>
          <th>Customer</th>
          <th class="text-end">Total Due</th>
          <th>Statement</th>
        </tr>
      </thead>
      <tbody id="rows">
      {% for row in rows %}
        <tr>
          <td>{{ row.customer }}</td>
          <td class="text-end">{{ row.total_due_fmt }}</td>
          <td><a class="link-primary" href="{{ row.rel_path }}">Open statement</a></td>
        </tr>
      {% endfor %}
      </tbody>
      <tfoot class="table-group-divider">
        <tr>
          <td>Grand Total</td>
          <td id="grand-total" data-total="{{ grand_total }}" class="text-end fw-semibold">{{ grand_total_fmt }}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>
  </div>

<script>
function filt(){
  const q=(document.getElementById('q').value||'').toLowerCase();
  document.querySelectorAll('#rows tr').forEach(tr=>{
    const name = tr.children[0].innerText.toLowerCase();
    const amt  = tr.children[1].innerText.toLowerCase();
    tr.style.display = (name.includes(q)||amt.includes(q)) ? "" : "none";
  });
}
</script>
</body>
</html>
"""

STATEMENT_HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{ company.name }} — Statement — {{ customer }}</title>
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet"
      integrity="sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH" crossorigin="anonymous">
<style>
  body { margin: 24px; }
  .pre { white-space: pre-line; }
  /* Enforce colors even with Bootstrap/printing */
  .overdue td { color: #b10000 !important; }
  .credit  td { color: #0a6d0a !important; }
  /* Only bold the amount cell on special rows */
  .overdue td.amt, .credit td.amt { font-weight: 600; }
  @media print { * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body class="container-lg">
  <header class="mb-3">
    <div class="d-flex align-items-center gap-3">
      {% if company.logo_src %}<img src="{{ company.logo_src }}" alt="{{ company.name }}" style="height:48px; width:auto">{% endif %}
      <div>
        <h1 class="h4 mb-1">{{ company.name }} — Customer Statement</h1>
        <div class="text-muted small">
          {{ company.email }} • {{ company.phone }} • <span class="pre d-inline">{{ company.address }}</span>
        </div>
        <span class="badge text-bg-light mt-1">As of {{ as_of }}</span>
      </div>
    </div>
  </header>

  <section class="card mb-3">
    <div class="card-body">
      <h2 class="h5 mb-2">{{ customer }}</h2>
      {% for k,v in metrics.items() %}
        <div><span class="fw-semibold">{{ k }}:</span> {{ v }}</div>
      {% endfor %}
      {% if company.pay_now_url %}
        <div class="mt-2">
          <a class="btn btn-sm btn-primary" href="{{ company.pay_now_url }}">Pay now</a>
        </div>
      {% endif %}
    </div>
  </section>

  <section class="card mb-3">
    <div class="card-body">
      <h2 class="h6 mb-2">Invoice Detail</h2>
      <div class="table-responsive">
        <table class="table table-sm table-striped align-middle">
          <thead>
            <tr>
              <th>Type</th><th>Invoice #</th><th>Invoice Date</th><th>Due Date</th><th>Terms</th><th>PO #</th>
              <th class="text-end">Open Balance</th><th class="text-center">Bucket</th><th class="text-end">Days Past Due</th>
            </tr>
          </thead>
          <tbody>
          {% for r in rows %}
            <tr class="{% if r.is_overdue and r.amount>0 %}overdue{% endif %} {% if r.amount<0 %}credit{% endif %}">
              <td>{{ r.type }}</td>
              <td>{{ r.num }}</td>
              <td>{{ r.invoice_date }}</td>
              <td>{{ r.due_date }}</td>
              <td>{{ r.terms }}</td>
              <td>{{ r.po }}</td>
              <td class="text-end amt">{{ r.amount_fmt }}</td>
              <td class="text-center">{{ r.bucket }}</td>
              <td class="text-end">{{ (r.days_past_due | int) if r.days_past_due>0 else "" }}</td>
            </tr>
          {% endfor %}
          </tbody>
          <tfoot>
            <tr class="table-group-divider">
              <td colspan="6" class="text-end fw-semibold">Total due</td>
              <td class="text-end fw-semibold">{{ total_due_fmt }}</td>
              <td></td><td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  </section>

  <section class="card mb-3">
    <div class="card-body">
      <h2 class="h6 mb-2">Aging Summary</h2>
      <div class="table-responsive" style="max-width:460px">
        <table class="table table-sm align-middle">
          <thead><tr><th>Bucket</th><th class="text-end">Amount</th></tr></thead>
          <tbody>
            {% for b in ["Current","1-30","31-60","61-90","90+"] %}
              <tr><td>{{ b }}</td><td class="text-end">{{ bucket_totals[b] }}</td></tr>
            {% endfor %}
          </tbody>
          <tfoot class="table-group-divider">
            <tr><td class="fw-semibold">Total</td><td class="text-end fw-semibold">{{ total_due_fmt }}</td></tr>
          </tfoot>
        </table>
      </div>

      <div class="text-muted small">Overdue lines are red. Credits show in green.</div>
      <div class="text-muted small pre mt-2">{{ company.remit_to }}</div>
    </div>
  </section>
</body>
</html>
"""

EMAIL_TXT = """Subject: Statement as of {{ as_of }} — {{ customer }} — {{ company.name }}

Hi {{ customer }},

Please find your current statement attached/linked. As of {{ as_of }}, your outstanding balance is {{ total_due_fmt }}.

Remit to:
{{ company.remit_to }}

If you have questions or need copies of invoices, please email {{ company.email }} or call {{ company.phone }}.
{% if company.pay_now_url %}You may also pay online: {{ company.pay_now_url }}{% endif %}

Thanks,
Accounts Receivable
{{ company.name }}
"""
