/* ================= AR Dashboard JS (light-only) ================= */

/* ---- Global State ---- */
window.AR_PALETTE = ['#1E88E5','#43A047','#FB8C00','#E53935','#8E24AA','#00ACC1']; // vivid, opaque
window.CURRENT_PAYLOAD = null;
window.ORIGINAL_PAYLOAD = null;
window.ACTIVE_CUSTOMER = null;

/* ---- Utils ---- */
const moneyFmt = new Intl.NumberFormat(undefined, { style:'currency', currency:'USD', maximumFractionDigits:2 });
const dateFmt = (s)=> s;

function money(x){ return moneyFmt.format(Number(x||0)); }

/* ================= Builders ================= */

/** Balances chart
 *  mode: 'stacked' (by aging bucket) or 'totals' (single bar per item)
 *  When filtered to a company, items are invoices; otherwise items are customers.
 */
function buildBalancesBar(ctx, bucketData, mode){
  const items = bucketData.customers;
  const labels = items.map((_, i)=> 'C'+(i+1));

  if (mode === 'totals') {
    const totals = items.map((_, idx)=>{
      let sum = 0;
      for (const b of bucketData.buckets) sum += Number((bucketData.data[b]||[])[idx] || 0);
      return sum;
    });
    return new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{
        label: 'Total Balance',
        data: totals,
        backgroundColor: window.AR_PALETTE[0],
        borderWidth: 0
      }]},
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (it)=> items[it[0].dataIndex],
              label: (it)=> `Total: ${money(it.parsed.y)}`
            }
          }
        },
        scales: {
          x: { ticks: { display: false } },
          y: { ticks: { callback: v => money(v) } }
        },
        onClick: (evt, elems) => { if (!elems || !elems.length) return; const name = items[elems[0].index]; if (window.ACTIVE_CUSTOMER) { setCustomerFilter(null); } else { setCustomerFilter(name); } }
      }
    });
  }

  // Stacked by aging bucket
  const datasets = bucketData.buckets.map((bkt, idx)=> ({
    label: bkt,
    data: (bucketData.data[bkt]||[]).map(v=>Number(v||0)),
    backgroundColor: window.AR_PALETTE[idx % window.AR_PALETTE.length],
    borderWidth: 0
  }));

  return new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            title: (it)=> items[it[0].dataIndex],
            label: (it)=> `${it.dataset.label}: ${money(it.parsed.y)}`
          }
        }
      },
      scales: {
        x: { ticks: { display: false }, stacked: true },
        y: { ticks: { callback: v => money(v) }, stacked: true }
      },
      onClick: (evt, elems) => { if (!elems || !elems.length) return; const name = items[elems[0].index]; if (window.ACTIVE_CUSTOMER) { setCustomerFilter(null); } else { setCustomerFilter(name); } }
    }
  });
}

/** Aging pie */
function buildPie(ctx, agingSummary){
  const labels = agingSummary.map(r=>r.bucket);
  const data = agingSummary.map(r=>Number(r.amount||0));
  return new Chart(ctx, {
    type: 'pie',
    data: { labels, datasets: [{ data, backgroundColor: window.AR_PALETTE.slice(0, labels.length) }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: (i)=> `${i.label}: ${money(i.parsed)}` } }
      }
    }
  });
}

/** Overdue risk: single vivid color; sums overdue only; sort by overdue amount */
function buildRiskBar(ctx, riskTop){
  const labels = riskTop.map(r=> r.customer || r['Customer'] || 'Unknown');
  const data = riskTop.map(r=> Number(r.overdue_amount||0));
  return new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Overdue Amount', data, borderWidth: 0, backgroundColor: window.AR_PALETTE[0] }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display:false }, tooltip: { callbacks: { label: (i)=> money(i.parsed.x) } } },
      scales: { x: { ticks: { callback: v=> money(v) } } },
      onClick: (evt, elems) => { if (!elems || !elems.length) return; const name = labels[elems[0].index]; if (window.ACTIVE_CUSTOMER) { setCustomerFilter(null); } else { setCustomerFilter(name); } }
    }
  });
}

/** Aging summary table */
function fillAgingTable(tbl, agingSummary, total){
  const tbody = tbl.querySelector('tbody');
  tbody.innerHTML = '';
  agingSummary.forEach(r=>{
    const amt = Number(r.amount||0);
    const tr = document.createElement('tr');
    const pc = total ? (amt/total) : 0;
    tr.innerHTML = `<td>${r.bucket}</td>
                    <td class="text-end">${money(amt)}</td>
                    <td class="text-end">${(pc*100).toFixed(1)}%</td>`;
    tbody.appendChild(tr);
  });
}

/** Invoice detail table w/ default sort on Open Balance desc */
function buildDetailTable(data){
  if (window._detail) { $('#detailTable').DataTable().destroy(); }
  $('#detailTable').empty();
  const cols = Array.from(data.reduce((set, r)=>{ Object.keys(r).forEach(k=>set.add(k)); return set; }, new Set()));
  data.forEach(r => cols.forEach(c => { if(!(c in r)) r[c]=''; }));
  const obIdx = cols.indexOf('Open Balance');
  window._detail = $('#detailTable').DataTable({
    data, destroy:true, responsive:true, pageLength:25,
    order: obIdx>=0 ? [[obIdx, 'desc']] : [],
    columns: cols.map(k => ({ title:k, data:k }))
  });
}

/* ================= Filtering + Aggregation ================= */

/** Aggregate from detailed rows */
function aggregateFromDetail(detail){
  const as_of = new Date().toISOString().slice(0,10);
  const aging = ['Current','1–30','31–60','61–90','91–120','120+'];

  const total_ar = detail.reduce((a,r)=> a + Number(r['Open Balance']||0), 0);
  const current_total = detail.filter(r=> r['Aging Bucket']==='Current')
                              .reduce((a,r)=> a + Number(r['Open Balance']||0), 0);
  const over_90 = detail.filter(r=> ['91–120','120+'].includes(r['Aging Bucket']))
                        .reduce((a,r)=> a + Number(r['Open Balance']||0), 0);
  const overdue_total = total_ar - current_total;

  // aging summary
  const aging_map = new Map(aging.map(b=>[b,0]));
  for (const r of detail) aging_map.set(r['Aging Bucket'], (aging_map.get(r['Aging Bucket'])||0) + Number(r['Open Balance']||0));
  const aging_summary = aging.map(b => ({ bucket:b, amount: aging_map.get(b)||0 }));

  // customer buckets
  const byCust = new Map();
  for (const r of detail){
    const c = r.Customer || r['Customer']; if (!c) continue;
    if (!byCust.has(c)) byCust.set(c, {});
    const obj = byCust.get(c);
    obj[r['Aging Bucket']] = (obj[r['Aging Bucket']]||0) + Number(r['Open Balance']||0);
  }
  const custTotals = Array.from(byCust.entries()).map(([k,v])=> [k, aging.reduce((a,b)=> a + (v[b]||0), 0)]);
  custTotals.sort((a,b)=> b[1]-a[1]);
  const top = custTotals.slice(0,20).map(([k])=>k);
  const data = Object.fromEntries(aging.map(b=> [b, top.map(c=> (byCust.get(c)||{})[b]||0)]));

  // overdue risk: overdue only
  const overdue = detail.filter(r=> r['Aging Bucket']!=='Current');
  const riskMap = new Map();
  for (const r of overdue){
    const c = r.Customer || r['Customer']; if (!c) continue;
    if (!riskMap.has(c)) riskMap.set(c, { customer:c, overdue_amount:0, max_days_past_due:0, invoices:0 });
    const o = riskMap.get(c);
    o.overdue_amount += Number(r['Open Balance']||0);
    o.max_days_past_due = Math.max(o.max_days_past_due, Number(r['Days Past Due']||0));
    o.invoices += 1;
  }
  const risk = Array.from(riskMap.values()).sort((a,b)=> b.overdue_amount - a.overdue_amount).slice(0,15);

  return {
    as_of,
    totals: { total_ar, current_total, overdue_total, over_90, customers_overdue: risk.length, invoices_overdue: overdue.length },
    aging_summary,
    cust_bucket: { customers: top, buckets: aging, data },
    risk_top: risk,
    invoice_detail: detail
  };
}

/** Build per-invoice charts when a company is active */
function buildInvoiceChartsForCustomer(detail){
  const aging = ['Current','1–30','31–60','61–90','91–120','120+'];
  const invoices = detail.map((r, idx)=>{
    const label = r['Invoice Number'] || r['Date'] || ('Inv ' + (idx+1));
    return { label, amount: Number(r['Open Balance']||0), bucket: r['Aging Bucket']||'Current', days: Number(r['Days Past Due']||0) };
  });
  invoices.sort((a,b)=> b.amount - a.amount);
  const top = invoices.slice(0,30);
  const customers = top.map(x=> x.label);
  const data = {};
  for (const b of aging) data[b] = top.map(inv => inv.bucket===b ? inv.amount : 0);

  // risk: overdue invoices only
  const risk = top.filter(inv => inv.bucket!=='Current')
                  .map(inv => ({ customer: inv.label, overdue_amount: inv.amount, max_days_past_due: inv.days, invoices: 1 }))
                  .sort((a,b)=> b.overdue_amount - a.overdue_amount);

  return { cust_bucket: { customers, buckets: aging, data }, risk_top: risk };
}

/** Apply/clear customer filter */
function setCustomerFilter(customerName){
  const badge = document.getElementById('activeFilter');
  if (!window.ORIGINAL_PAYLOAD) window.ORIGINAL_PAYLOAD = window.CURRENT_PAYLOAD;

  if (!customerName){
    window.ACTIVE_CUSTOMER = null;
    if (badge) { badge.classList.add('d-none'); badge.textContent=''; }
    buildAll(window.ORIGINAL_PAYLOAD);
    return;
  }

  // toggle off if same
  if (window.ACTIVE_CUSTOMER === customerName){
    setCustomerFilter(null);
    return;
  }

  window.ACTIVE_CUSTOMER = customerName;
  const filtered = window.ORIGINAL_PAYLOAD.invoice_detail.filter(r => (r.Customer||'') === customerName);
  const payload = aggregateFromDetail(filtered);
  const charts = buildInvoiceChartsForCustomer(filtered);
  payload.cust_bucket = charts.cust_bucket;
  payload.risk_top = charts.risk_top;

  if (badge){
    badge.classList.remove('d-none');
    badge.textContent = 'Filter: ' + customerName + '  ×';
    badge.title = 'Click to clear filter';
  }
  buildAll(payload);
}

/* Clear filter via badge click */
document.addEventListener('click', (e)=>{
  if (e.target && e.target.id === 'activeFilter') setCustomerFilter(null);
});

/* ================= Main build ================= */
function buildAll(payload){
  if (!window.ORIGINAL_PAYLOAD) window.ORIGINAL_PAYLOAD = payload;
  window.CURRENT_PAYLOAD = payload;

  document.getElementById('asOf').textContent = payload.as_of;
  document.getElementById('kpiTotal').textContent = money(payload.totals.total_ar);
  document.getElementById('kpiCurrent').textContent = money(payload.totals.current_total);
  document.getElementById('kpiOverdue').textContent = money(payload.totals.overdue_total);
  document.getElementById('kpiOver90').textContent = money(payload.totals.over_90);
  document.getElementById('badgeOverdue').textContent = `${payload.totals.customers_overdue} customers, ${money(payload.totals.overdue_total)}`;

  if (window._stacked) window._stacked.destroy();
  if (window._pie) window._pie.destroy();
  if (window._risk) window._risk.destroy();

  const mode = (document.getElementById('toggleTotals') && document.getElementById('toggleTotals').checked) ? 'totals' : 'stacked';
  window._stacked = buildBalancesBar(document.getElementById('stackedBar'), payload.cust_bucket, mode);
  window._pie = buildPie(document.getElementById('agingPie'), payload.aging_summary);
  window._risk = buildRiskBar(document.getElementById('riskBar'), payload.risk_top);

  fillAgingTable(document.getElementById('agingTable'), payload.aging_summary, payload.totals.total_ar);
  buildDetailTable(payload.invoice_detail);

  // Bind/rebind totals toggle
  const el = document.getElementById('toggleTotals');
  if (el) {
    el.onchange = ()=> {
      if (window._stacked) window._stacked.destroy();
      const newMode = el.checked ? 'totals' : 'stacked';
      window._stacked = buildBalancesBar(document.getElementById('stackedBar'), window.CURRENT_PAYLOAD.cust_bucket, newMode);
    };
  }
}

/* ================= CSV -> Payload ================= */
function toPayloadFromCSV(rows){
  if (!rows || rows.length===0) return null;
  const headers = Object.keys(rows[0] || {});
  const cols = headers.map(h => String(h).trim().toLowerCase());
  function find(...names){ for (let i=0;i<cols.length;i++) if (names.includes(cols[i])) return headers[i]; return null; }

  const c_customer = find('customer','name','customer_name');
  const c_type     = find('type','transaction_type');
  const c_txn      = find('date','txn_date','transaction_date','invoice_date');
  const c_due      = find('due date','due_date','duedate');
  const c_num      = find('num','no','invoice_number','doc_num','txn_no');
  const c_bal      = find('open balance','open_balance','open amount','openamount','open_amt','amount due','amount_due','balance','amount','amt');
  const c_memo     = find('memo','description','memo/description','memo_description');

  function toNum(x){ const n = Number(String(x||'').replace(/[^0-9\.-]/g,'')); return isFinite(n)?n:0; }
  function parseDate(s){ const d = new Date(s); return isNaN(d) ? null : d; }

  const today = new Date();
  const rowsFiltered = rows.filter(r => {
    const t = String(r[c_type] || '').toLowerCase();
    if (!t) return false;
    if (['payment','deposit','journal','total','subtotal','refund'].includes(t)) return false;
    return t.includes('inv') || t === 'invoice';
  }).filter(r => String(r[c_customer]||'').trim().length > 0);

  const detail = rowsFiltered.map(r => {
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
    if (c_num) rec['Invoice Number'] = r[c_num];
    if (c_memo) rec['Memo'] = r[c_memo];
    return rec;
  });

  return aggregateFromDetail(detail);
}

/* ================= File upload ================= */
document.addEventListener('DOMContentLoaded', function(){
  const input = document.getElementById('fileInput');
  if (!input) return;
  input.addEventListener('change', (e)=>{
    const file = e.target.files[0];
    if (!file) return;
    Papa.parse(file, {
      header: true, dynamicTyping: false, skipEmptyLines: 'greedy',
      complete: (res)=> {
        const payload = toPayloadFromCSV(res.data);
        if (!payload) { alert('Could not read any rows from the CSV.'); return; }
        buildAll(payload);
      }
    });
  });
});
