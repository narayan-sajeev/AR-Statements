window.CURRENT_PAYLOAD = null;

// Vivid, consistent palette used across charts (no transparency)
window.AR_PALETTE = ['#1E88E5','#43A047','#FB8C00','#E53935','#8E24AA','#00ACC1'];

    // Currency formatters
    const fmt = new Intl.NumberFormat(undefined, {style:'currency', currency:'USD', maximumFractionDigits:2});

    function fmtMoney(x) { return fmt.format(x||0); }

    // Charts
    function buildBalancesBar(ctx, custBucket, mode) {
      const customers = custBucket.customers;
      const labels = customers.map((_, i) => 'C' + (i+1));

      // Solid, opaque colors for buckets
      const palette = window.AR_PALETTE;

      if (mode === 'totals') {
        // Collapse all buckets into a single total per customer
        const totals = customers.map((_, idx) => { let sum = 0; for (const b of custBucket.buckets) sum += Number(custBucket.data[b][idx] || 0); return sum; });
        return new Chart(ctx, {
          type: 'bar',
          data: { labels, datasets: [{
            label: 'Total Balance',
            data: totals,
            backgroundColor: '#2563EB', // solid color
            borderWidth: 0
          }]},
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  title: (items) => customers[items[0].dataIndex],
                  label: (item) => `Total: ${fmtMoney(item.parsed.y)}`
                }
              }
            },
            scales: {
              x: { ticks: { display: false } },
              y: { ticks: { callback: v => fmtMoney(v) } }
            }
          }
        });
      } else {
        // Stacked per aging bucket
        const datasets = custBucket.buckets.map((bkt, idx) => ({
          label: bkt,
          data: (custBucket.data[bkt] || []).map(v => Number(v || 0)),
          backgroundColor: palette[idx % palette.length], // opaque
          borderWidth: 0
        }));
        return new Chart(ctx, {
          type: 'bar',
          data: { labels, datasets },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'bottom' },
              tooltip: {
                callbacks: {
                  title: (items) => customers[items[0].dataIndex],
                  label: (item) => `${item.dataset.label}: ${fmtMoney(item.parsed.y)}`
                }
              }
            },
            scales: {
              x: { ticks: { display: false }, stacked: true },
              y: { ticks: { callback: (v)=> fmtMoney(v) }, stacked: true }
            }
          }
        });
      }
    }

    function buildPie(ctx, agingSummary) {
      const labels = agingSummary.map(r => r.bucket);
      const data = agingSummary.map(r => r.amount);
      return new Chart(ctx, {
        type: 'pie',
        data: { labels, datasets: [{ data, backgroundColor: window.AR_PALETTE.slice(0, labels.length) }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom' },
                     tooltip: { callbacks: { label: (i)=> `${i.label}: ${fmtMoney(i.parsed)}` } } }
        }
      });
    }

    function buildRiskBar(ctx, riskTop) {
      const labels = riskTop.map(r => r.customer || r['Customer'] || 'Unknown');
      const data = riskTop.map(r => r.overdue_amount);
      return new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Overdue Amount', data, borderWidth: 0, backgroundColor: window.AR_PALETTE[0] }]},
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (i)=> fmtMoney(i.parsed.x) } } },
          scales: { x: { ticks: { callback: (v)=> fmtMoney(v) } } }
        }
      });
    }

    function fillAgingTable(tbl, agingSummary, total) {
      const tbody = tbl.querySelector('tbody');
      tbody.innerHTML = '';
      agingSummary.forEach(r => {
        const tr = document.createElement('tr');
        const pc = total ? (r.amount/total) : 0;
        tr.innerHTML = `<td>${r.bucket}</td>
                        <td class="text-end">${fmtMoney(r.amount)}</td>
                        <td class="text-end">${(pc*100).toFixed(1)}%</td>`;
        tbody.appendChild(tr);
      });
    }

    function buildDetailTable(data) {
      if (window._detail) $('#detailTable').DataTable().destroy();
      // ensure consistent columns
      const cols = Array.from(data.reduce((set, r) => { Object.keys(r).forEach(k=>set.add(k)); return set; }, new Set()));
      data.forEach(r => cols.forEach(c => { if(!(c in r)) r[c]=''; }));
      window._detail = $('#detailTable').DataTable({
        data,
        destroy: true,
        responsive: true,
        pageLength: 25,
        columns: cols.map(k => ({ title: k, data: k }))
      });
    }

    function buildAll(payload) {
      window.CURRENT_PAYLOAD = payload;
      document.getElementById('asOf').textContent = payload.as_of;
      document.getElementById('kpiTotal').textContent = fmtMoney(payload.totals.total_ar);
      document.getElementById('kpiCurrent').textContent = fmtMoney(payload.totals.current_total);
      document.getElementById('kpiOverdue').textContent = fmtMoney(payload.totals.overdue_total);
      document.getElementById('kpiOver90').textContent = fmtMoney(payload.totals.over_90);
      document.getElementById('badgeOverdue').textContent = `${payload.totals.customers_overdue} customers, ${fmtMoney(payload.totals.overdue_total)}`;

      if (window._stacked) window._stacked.destroy();
      if (window._pie) window._pie.destroy();
      if (window._risk) window._risk.destroy();
      const mode = (document.getElementById('toggleTotals') && document.getElementById('toggleTotals').checked) ? 'totals' : 'stacked';
      window._stacked = buildBalancesBar(document.getElementById('stackedBar'), payload.cust_bucket, mode);
      // re-bind in case HTML re-rendered
      const el = document.getElementById('toggleTotals'); if (el) { el.removeEventListener('change', arToggleHandler); el.removeEventListener('click', arToggleHandler); el.addEventListener('change', arToggleHandler); el.addEventListener('click', arToggleHandler);}window._pie = buildPie(document.getElementById('agingPie'), payload.aging_summary);
      window._risk = buildRiskBar(document.getElementById('riskBar'), payload.risk_top);

      fillAgingTable(document.getElementById('agingTable'), payload.aging_summary, payload.totals.total_ar);
      buildDetailTable(payload.invoice_detail);
    }

    // Robust CSV parse -> payload
    function toPayloadFromCSV(csvRows) {
      if (!csvRows || csvRows.length === 0) return null;
      const headers = Object.keys(csvRows[0]);
      const cols = headers.map(h => h.trim().toLowerCase());
      function find(...names) {
        for (let i=0;i<cols.length;i++) if (names.includes(cols[i])) return headers[i];
        return null;
      }
      const c_customer = find('customer','name','customer_name');
      const c_type = find('type','transaction_type');
      const c_txn = find('date','txn_date','transaction_date','invoice_date');
      const c_due = find('due date','due_date','duedate');
      const c_num = find('num','no','invoice_number','doc_num','txn_no');
      // FIX: include spaced headers used by QuickBooks like "Open Balance" / "Open Amount" / "Amount Due"
      const c_bal = find('open balance','open_balance','open amount','openamount','open_amt','amount due','amount_due','balance','amount','amt');
      const c_memo = find('memo','description','memo/description','memo_description');

      function toNum(x){ const n=Number(String(x||'').replace(/[^0-9\.-]/g,'')); return isFinite(n)?n:0; }
      function parseDate(s){ const d=new Date(s); return isNaN(d)?null:d; }

      const today = new Date();
      const rows = csvRows.filter(r => {
        const t = String(r[c_type] || '').toLowerCase();
        if (!t) return false;
        if (['payment','deposit','journal','total','subtotal','refund'].includes(t)) return false;
        return t.includes('inv') || t === 'invoice';
      }).filter(r => String(r[c_customer]||'').trim().length>0);

      const recs = rows.map(r => {
        const due = parseDate(r[c_due]);
        const days = due ? Math.floor((today - due)/(1000*60*60*24)) : 0;
        const bucket = days <= 0 ? 'Current' : days<=30 ? '1–30' : days<=60 ? '31–60' : days<=90 ? '61–90' : days<=120 ? '91–120' : '120+';
        const rec = {
          Customer: r[c_customer],
          'Open Balance': toNum(r[c_bal]),
          'Days Past Due': days,
          'Aging Bucket': bucket
        };
        if (c_txn) rec['Date'] = r[c_txn];
        if (c_due) rec['Due Date'] = r[c_due];
        if (c_num) rec['Num'] = r[c_num];
        if (c_memo) rec['Memo'] = r[c_memo];
        return rec;
      });

      const total = recs.reduce((a,b)=>a+b['Open Balance'],0);
      const agingBuckets = ['Current','1–30','31–60','61–90','91–120','120+'];
      const summary = agingBuckets.map(b => ({
        bucket: b,
        amount: recs.filter(r=>r['Aging Bucket']===b).reduce((a,c)=>a+c['Open Balance'],0)
      }));

      const byCust = new Map();
      for (const r of recs) {
        const c = r.Customer;
        if (!byCust.has(c)) byCust.set(c, {});
        const obj = byCust.get(c);
        obj[r['Aging Bucket']] = (obj[r['Aging Bucket']]||0) + r['Open Balance'];
      }
      const custTotals = Array.from(byCust.entries()).map(([k,v]) => [k, agingBuckets.reduce((a,b)=>a+(v[b]||0),0)]);
      custTotals.sort((a,b)=>b[1]-a[1]);
      const top = custTotals.slice(0,20).map(([k]) => k);
      const data = Object.fromEntries(agingBuckets.map(b => [b, top.map(c => (byCust.get(c)||{})[b]||0)]));

      const overdue = recs.filter(r => r['Aging Bucket']!=='Current');
      const riskMap = new Map();
      for (const r of overdue) {
        const k = r.Customer;
        if (!riskMap.has(k)) riskMap.set(k, { overdue_amount:0, max_days_past_due:0, invoices:0 });
        const o = riskMap.get(k);
        o.overdue_amount += r['Open Balance'];
        o.max_days_past_due = Math.max(o.max_days_past_due, r['Days Past Due']);
        o.invoices += 1;
      }
      const risk = Array.from(riskMap.entries()).map(([customer,vals]) => ({ customer, ...vals }));
      risk.sort((a,b)=> b.overdue_amount - a.overdue_amount || b.max_days_past_due - a.max_days_past_due);

      return {
        as_of: new Date().toISOString().slice(0,10),
        totals: {
          total_ar: total,
          current_total: summary.find(x=>x.bucket==='Current')?.amount || 0,
          overdue_total: summary.filter(x=>x.bucket!=='Current').reduce((a,b)=>a+b.amount,0),
          over_90: summary.filter(x=>['91–120','120+'].includes(x.bucket)).reduce((a,b)=>a+b.amount,0),
          customers_overdue: risk.length,
          invoices_overdue: overdue.length
        },
        aging_summary: summary,
        cust_bucket: { customers: top, buckets: agingBuckets, data },
        risk_top: risk.slice(0,15),
        invoice_detail: recs
      };
    }

    // File upload
    document.getElementById('fileInput').addEventListener('change', (e)=>{
      const file = e.target.files[0];
      if (!file) return;
      Papa.parse(file, {
        header: true,
        dynamicTyping: false,
        skipEmptyLines: 'greedy',
        complete: function(results){
          const payload = toPayloadFromCSV(results.data);
          if (!payload) { alert('Could not read any rows from the CSV.'); return; }
          buildAll(payload);
        }
      });
    });

// Allow toggling between stacked and single total bars
document.getElementById('toggleStacked').addEventListener('click', function() {
    const chart = charts['balancesByCustomer'];
    if (!chart) return;
    const currentlyStacked = chart.options.scales.x.stacked;
    chart.options.scales.x.stacked = !currentlyStacked;
    chart.options.scales.y.stacked = !currentlyStacked;
    chart.update();
});

// --- Toggle handler for totals vs stacked ---
function arToggleHandler() {
  const el = document.getElementById('toggleTotals');
  if (!el || !window.CURRENT_PAYLOAD) return;
  if (window._stacked) window._stacked.destroy();
  const mode = el.checked ? 'totals' : 'stacked';
  window._stacked = buildBalancesBar(document.getElementById('stackedBar'), window.CURRENT_PAYLOAD.cust_bucket, mode);
}
document.addEventListener('DOMContentLoaded', function(){
  const el = document.getElementById('toggleTotals');
  if (el) {
    el.addEventListener('change', arToggleHandler);
    el.addEventListener('click', arToggleHandler);
  }
});
