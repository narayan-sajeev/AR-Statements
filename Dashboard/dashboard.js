/* ================= AR Dashboard JS (light-only) ================= */

/* ---- Global State ---- */
window.AR_PALETTE = ['#1E88E5', '#43A047', '#FB8C00', '#E53935', '#8E24AA', '#00ACC1']; // vivid, opaque
window.AR_OVERDUE_COLOR = '#FF7043';
window.CURRENT_PAYLOAD = null;
window.ORIGINAL_PAYLOAD = null;
window.ACTIVE_CUSTOMER = null;
window.ACTIVE_BUCKET = null; // active aging-bucket filter (mutually exclusive with customer)

// Default-view-only user preference for totals mode
window.DEFAULT_TOTALS_ONLY = false;

/* ---- Canonical aging buckets + consistent colors ---- */
window.AR_BUCKETS = ['Current', '1–30', '31–60', '61–90', '91–120', '120+'];
window.AR_BUCKET_COLORS = Object.fromEntries(window.AR_BUCKETS.map((b, i) => [b, window.AR_PALETTE[i % window.AR_PALETTE.length]]));

/* ---- Label helpers: readable, no em dashes/hyphens for filter banner ---- */
function formatBucketLabel(b) {
    if (b === 'Current') return 'Current (not due)';
    if (b === '1–30') return '1-30 days overdue';
    if (b === '31–60') return '31-60 days overdue';
    if (b === '61–90') return '61-90 days overdue';
    if (b === '91–120') return '91-120 days overdue';
    if (b === '120+') return '120+ days overdue';
    return b;
}

function filterBannerText() {
    if (window.ACTIVE_CUSTOMER) return `Customer: ${window.ACTIVE_CUSTOMER}`;
    if (window.ACTIVE_BUCKET) return `Bucket: ${formatBucketLabel(window.ACTIVE_BUCKET)}`;
    return null;
}

function isDefaultView() {
    return !window.ACTIVE_CUSTOMER && !window.ACTIVE_BUCKET;
}

/* ---- Utils ---- */
const moneyFmt = new Intl.NumberFormat(undefined, {style: 'currency', currency: 'USD', maximumFractionDigits: 2});

function money(x) {
    return moneyFmt.format(Number(x || 0));
}

/* ---- Helper: keep only buckets with any non-zero values ---- */
function filterZeroBucketsForStacked(datasets) {
    const filtered = (datasets || []).filter(ds => (ds.data || []).some(v => Number(v) > 0));
    return filtered.length ? filtered : datasets; // fallback if all zero
}

/* ================= Builders ================= */

/** Balances chart
 *  mode: 'stacked' (by aging bucket) or 'totals' (single bar per item)
 *  When filtered to a company, items are invoices; otherwise items are customers.
 */
function buildBalancesBar(ctx, bucketData, mode) {
    const items = bucketData.customers;
    const labels = items.map((_, i) => 'C' + (i + 1));

    if (mode === 'totals') {
        const totals = items.map((_, idx) => {
            let sum = 0;
            for (const b of bucketData.buckets) sum += Number((bucketData.data[b] || [])[idx] || 0);
            return sum;
        });
        return new Chart(ctx, {
            type: 'bar', data: {
                labels, datasets: [{
                    label: 'Total Balance', data: totals, backgroundColor: window.AR_PALETTE[0], borderWidth: 0
                }]
            }, options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {display: false}, tooltip: {
                        callbacks: {
                            title: (it) => items[it[0].dataIndex], label: (it) => `Total: ${money(it.parsed.y)}`
                        }
                    }
                },
                scales: {x: {ticks: {display: false}}, y: {ticks: {callback: v => money(v)}}},
                onClick: (evt, elems) => {
                    if (!elems || !elems.length) return;
                    // If we're already in invoice mode (customer filter active), a bar click should CLEAR filters,
                    // not try to treat an invoice label like a customer.
                    if (window.ACTIVE_CUSTOMER) {
                        clearAllFilters();
                        return;
                    }
                    const name = items[elems[0].index];
                    if (window.ACTIVE_CUSTOMER === name) {
                        clearAllFilters();
                    } else {
                        setCustomerFilter(name);
                    }
                }
            }
        });
    }

    // Stacked by aging bucket — consistent colors per bucket
    const datasetsRaw = bucketData.buckets.map((bkt, idx) => ({
        label: bkt,
        data: (bucketData.data[bkt] || []).map(v => Number(v || 0)),
        backgroundColor: window.AR_BUCKET_COLORS[bkt] || window.AR_PALETTE[idx % window.AR_PALETTE.length],
        borderWidth: 0
    }));
    const datasets = filterZeroBucketsForStacked(datasetsRaw);

    return new Chart(ctx, {
        type: 'bar', data: {labels, datasets}, options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {position: 'bottom'}, tooltip: {
                    callbacks: {
                        title: (it) => items[it[0].dataIndex],
                        label: (it) => `${it.dataset.label}: ${money(it.parsed.y)}`
                    }
                }
            },
            scales: {x: {ticks: {display: false}, stacked: true}, y: {ticks: {callback: v => money(v)}, stacked: true}},
            onClick: (evt, elems) => {
                if (!elems || !elems.length) return;
                if (window.ACTIVE_CUSTOMER) { // invoice mode
                    clearAllFilters();
                    return;
                }
                const name = items[elems[0].index];
                if (window.ACTIVE_CUSTOMER === name) {
                    clearAllFilters();
                } else {
                    setCustomerFilter(name);
                }
            }
        }
    });
}

/** Aging pie — hide zero-amount buckets and keep consistent colors; clicking a slice applies ONLY the bucket filter */
function buildPie(ctx, agingSummary) {
    const labels = agingSummary.map(r => r.bucket);
    const data = agingSummary.map(r => Number(r.amount || 0));

    // remove zero buckets
    const pairs = labels.map((l, i) => ({l, v: data[i]})).filter(p => p.v > 0);
    const flabels = pairs.map(p => p.l);
    const fdata = pairs.map(p => p.v);

    const colors = flabels.map(l => window.AR_BUCKET_COLORS[l] || window.AR_PALETTE[0]);

    return new Chart(ctx, {
        type: 'pie', data: {labels: flabels, datasets: [{data: fdata, backgroundColor: colors}]}, options: {
            responsive: true, maintainAspectRatio: false, plugins: {
                legend: {position: 'bottom'}, tooltip: {callbacks: {label: (i) => `${i.label}: ${money(i.parsed)}`}}
            }, onClick: (evt, elems) => {
                if (!elems || !elems.length) return;
                const sliceIndex = elems[0].index;
                const bucket = flabels[sliceIndex];
                // Always set ONLY bucket filter (clears customer filter)
                if (window.ACTIVE_BUCKET === bucket && !window.ACTIVE_CUSTOMER) {
                    clearAllFilters();
                } else {
                    setBucketFilter(bucket);
                }
            }
        }
    });
}

/** Overdue risk: single vivid color; sums overdue only; sort by overdue amount */
function buildRiskBar(ctx, riskTop) {
    const labels = riskTop.map(r => r.customer || r['Customer'] || 'Unknown');
    const data = riskTop.map(r => Number(r.overdue_amount || 0));
    return new Chart(ctx, {
        type: 'bar', data: {
            labels, datasets: [{
                label: 'Overdue Amount',
                data,
                borderWidth: 0,
                backgroundColor: window.AR_OVERDUE_COLOR,
                hoverBackgroundColor: window.AR_OVERDUE_COLOR,
                borderColor: window.AR_OVERDUE_COLOR,
            }]
        }, options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {legend: {display: false}, tooltip: {callbacks: {label: (i) => money(i.parsed.x)}}},
            scales: {x: {ticks: {callback: v => money(v)}}},
            onClick: (evt, elems) => {
                if (!elems || !elems.length) return;
                if (window.ACTIVE_CUSTOMER) { // invoice mode
                    clearAllFilters();
                    return;
                }
                const name = labels[elems[0].index];
                if (window.ACTIVE_CUSTOMER === name) {
                    clearAllFilters();
                } else {
                    setCustomerFilter(name);
                }
            }
        }
    });
}

/** Aging summary table */
function fillAgingTable(tbl, agingSummary, total) {
    const tbody = tbl.querySelector('tbody');
    tbody.innerHTML = '';
    agingSummary.forEach(r => {
        const amt = Number(r.amount || 0);
        const tr = document.createElement('tr');
        const pc = total ? (amt / total) : 0;
        tr.innerHTML = `<td>${r.bucket}</td>
                    <td class="text-end">${money(amt)}</td>
                    <td class="text-end">${(pc * 100).toFixed(1)}%</td>`;
        tbody.appendChild(tr);
    });
}

/** Invoice detail table w/ default sort on Open Balance desc */
function buildDetailTable(data) {
    if (window._detail) {
        $('#detailTable').DataTable().destroy();
    }
    $('#detailTable').empty();
    const cols = Array.from(data.reduce((set, r) => {
        Object.keys(r).forEach(k => set.add(k));
        return set;
    }, new Set()));
    data.forEach(r => cols.forEach(c => {
        if (!(c in r)) r[c] = '';
    }));
    const obIdx = cols.indexOf('Open Balance');
    window._detail = $('#detailTable').DataTable({
        data,
        destroy: true,
        responsive: true,
        pageLength: 25,
        order: obIdx >= 0 ? [[obIdx, 'desc']] : [],
        columns: cols.map(k => ({title: k, data: k}))
    });
}

/* ================= Filtering + Aggregation ================= */
function updateFilterBanner() {
    const banner = document.getElementById('filterBanner');
    const nameEl = document.getElementById('filterName');
    if (!banner || !nameEl) return;
    const label = filterBannerText();
    if (label) {
        banner.classList.remove('d-none');
        nameEl.textContent = label;
        document.body.classList.add('filtered');
        try {
            document.title = label + " — AR Executive Summary";
        } catch (e) {
        }
    } else {
        banner.classList.add('d-none');
        nameEl.textContent = "";
        document.body.classList.remove('filtered');
        try {
            document.title = "AR Executive Summary";
        } catch (e) {
        }
    }
}

/** Clear all filters and rebuild from original payload */
function clearAllFilters() {
    window.ACTIVE_CUSTOMER = null;
    window.ACTIVE_BUCKET = null;
    const badge = document.getElementById('activeFilter');
    if (badge) {
        badge.classList.add('d-none');
        badge.textContent = '';
        badge.title = '';
    }
    updateFilterBanner();
    if (window.ORIGINAL_PAYLOAD) buildAll(window.ORIGINAL_PAYLOAD);
}

/** Aggregate from detailed rows */
function aggregateFromDetail(detail) {
    const as_of = new Date().toISOString().slice(0, 10);
    const aging = window.AR_BUCKETS.slice(); // CONSISTENT

    const total_ar = detail.reduce((a, r) => a + Number(r['Open Balance'] || 0), 0);
    const current_total = detail.filter(r => r['Aging Bucket'] === 'Current')
        .reduce((a, r) => a + Number(r['Open Balance'] || 0), 0);
    const over_90 = detail.filter(r => ['91–120', '120+'].includes(r['Aging Bucket']))
        .reduce((a, r) => a + Number(r['Open Balance'] || 0), 0);
    const overdue_total = total_ar - current_total;

    // aging summary
    const aging_map = new Map(aging.map(b => [b, 0]));
    for (const r of detail) aging_map.set(r['Aging Bucket'], (aging_map.get(r['Aging Bucket']) || 0) + Number(r['Open Balance'] || 0));
    const aging_summary = aging.map(b => ({bucket: b, amount: aging_map.get(b) || 0}));

    // customer buckets
    const byCust = new Map();
    for (const r of detail) {
        const c = r.Customer || r['Customer'];
        if (!c) continue;
        if (!byCust.has(c)) byCust.set(c, {});
        const obj = byCust.get(c);
        obj[r['Aging Bucket']] = (obj[r['Aging Bucket']] || 0) + Number(r['Open Balance'] || 0);
    }
    const custTotals = Array.from(byCust.entries()).map(([k, v]) => [k, aging.reduce((a, b) => a + (v[b] || 0), 0)]);
    custTotals.sort((a, b) => b[1] - a[1]);
    const top = custTotals.slice(0, 20).map(([k]) => k);
    const data = Object.fromEntries(aging.map(b => [b, top.map(c => (byCust.get(c) || {})[b] || 0)]));

    // overdue risk: overdue only
    const overdue = detail.filter(r => r['Aging Bucket'] !== 'Current');
    const riskMap = new Map();
    for (const r of overdue) {
        const c = r.Customer || r['Customer'];
        if (!c) continue;
        if (!riskMap.has(c)) riskMap.set(c, {customer: c, overdue_amount: 0, max_days_past_due: 0, invoices: 0});
        const o = riskMap.get(c);
        o.overdue_amount += Number(r['Open Balance'] || 0); // credits reduce overdue
        o.max_days_past_due = Math.max(o.max_days_past_due, Number(r['Days Past Due'] || 0));
        o.invoices += 1;
    }
    const risk = Array.from(riskMap.values()).map(r => ({...r, overdue_amount: Math.max(r.overdue_amount, 0)}))
        .sort((a, b) => b.overdue_amount - a.overdue_amount).slice(0, 15);

    return {
        as_of, totals: {
            total_ar,
            current_total,
            overdue_total,
            over_90,
            customers_overdue: risk.length,
            invoices_overdue: overdue.length
        }, aging_summary, cust_bucket: {customers: top, buckets: aging, data}, risk_top: risk, invoice_detail: detail
    };
}

/** Build per-invoice charts when a company is active */
function buildInvoiceChartsForCustomer(detail) {
    const aging = window.AR_BUCKETS.slice();

    // Build normalized invoice list
    const invoices = detail.map((r, idx) => {
        const base = r['Invoice Number'] || r['Date'] || ('Txn ' + (idx + 1));
        const label = (r['Type'] === 'Credit Memo' ? 'CM ' : '') + base;
        return {
            label,
            amount: Number(r['Open Balance'] || 0),
            bucket: r['Aging Bucket'] || 'Current',
            days: Number(r['Days Past Due'] || 0)
        };
    });

    // Top Balance: 20 largest invoices by open amount (any bucket)
    const top20ByAmount = [...invoices].sort((a, b) => b.amount - a.amount).slice(0, 20);
    const items = top20ByAmount.map(x => x.label);

    const data = {};
    for (const b of aging) data[b] = top20ByAmount.map(inv => (inv.bucket === b ? inv.amount : 0));

    // Overdue Risk: top 15 overdue invoices by amount
    const top15Overdue = invoices
        .filter(inv => inv.bucket !== 'Current')
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 15)
        .map(inv => ({customer: inv.label, overdue_amount: inv.amount, max_days_past_due: inv.days, invoices: 1}));

    return {cust_bucket: {customers: items, buckets: aging, data}, risk_top: top15Overdue};
}

/** Apply ONLY customer filter (clears bucket) */
function setCustomerFilter(customerName) {
    if (!window.ORIGINAL_PAYLOAD) window.ORIGINAL_PAYLOAD = window.CURRENT_PAYLOAD;

    // Always clear bucket when setting a customer filter (mutually exclusive)
    window.ACTIVE_BUCKET = null;

    if (!customerName) {
        clearAllFilters();
        return;
    }
    // If same customer is active, toggling off
    if (window.ACTIVE_CUSTOMER === customerName) {
        clearAllFilters();
        return;
    }

    window.ACTIVE_CUSTOMER = customerName;

    // Start from ORIGINAL rows, filter to customer only
    let rows = window.ORIGINAL_PAYLOAD.invoice_detail.filter(r => (r.Customer || '') === customerName);

    const payload = aggregateFromDetail(rows);
    const charts = buildInvoiceChartsForCustomer(rows);
    payload.cust_bucket = charts.cust_bucket;
    payload.risk_top = charts.risk_top;

    const badge = document.getElementById('activeFilter');
    if (badge) {
        badge.classList.remove('d-none');
        badge.textContent = `Filter: ${customerName} ×`; // readable
        badge.title = 'Click to clear filter';
    }
    updateFilterBanner();
    buildAll(payload);
}

/** Apply ONLY Aging Bucket filter (clears customer) */
function setBucketFilter(bucketName) {
    if (!window.ORIGINAL_PAYLOAD) window.ORIGINAL_PAYLOAD = window.CURRENT_PAYLOAD;

    // Always clear customer when setting a bucket filter (mutually exclusive)
    window.ACTIVE_CUSTOMER = null;

    if (!bucketName) {
        clearAllFilters();
        return;
    }
    // If same bucket is active, toggling off
    if (window.ACTIVE_BUCKET === bucketName) {
        clearAllFilters();
        return;
    }

    window.ACTIVE_BUCKET = bucketName;

    const rows = window.ORIGINAL_PAYLOAD.invoice_detail
        .filter(r => (r['Aging Bucket'] || '') === bucketName);

    const payload = aggregateFromDetail(rows);

    const badge = document.getElementById('activeFilter');
    if (badge) {
        badge.classList.remove('d-none');
        badge.textContent = `Filter: ${formatBucketLabel(bucketName)} ×`;
        badge.title = 'Click to clear filter';
    }
    updateFilterBanner();
    buildAll(payload);
}

/* Clear filter via badge click */
document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'activeFilter') clearAllFilters();
});

function updateBadges(payload) {
    // If either a customer or a bucket filter is active, we are effectively showing invoices
    const noun = (window.ACTIVE_CUSTOMER || window.ACTIVE_BUCKET) ? 'invoices' : 'customers';

    // --- Overdue Risk badge ---
    const shownOverdueTotal = (payload.risk_top || [])
        .reduce((a, r) => a + Number(r.overdue_amount || 0), 0);
    const shownCount = (payload.risk_top || []).length;
    const overdueBadge = document.getElementById('badgeOverdue');
    if (overdueBadge) overdueBadge.textContent = `${shownCount} ${noun}, ${money(shownOverdueTotal)}`;

    // --- Balances badge ---
    const el = document.getElementById('badgeBalances');
    if (el && payload.cust_bucket) {
        const items = payload.cust_bucket.customers || [];
        const buckets = payload.cust_bucket.buckets || [];
        const dataMap = payload.cust_bucket.data || {};

        const totalsPerItem = items.map((_, idx) => buckets.reduce((sum, b) => sum + Number((dataMap[b] || [])[idx] || 0), 0));
        const total = totalsPerItem.reduce((a, b) => a + b, 0);
        el.textContent = `${items.length} ${noun}, ${money(total)}`;
    }
}

/* ================= Main build ================= */
function buildAll(payload) {
    if (!window.ORIGINAL_PAYLOAD) window.ORIGINAL_PAYLOAD = payload;
    window.CURRENT_PAYLOAD = payload;

    const asOfEl = document.getElementById('asOf');
    if (asOfEl) asOfEl.textContent = payload.as_of;

    const kpiTotal = document.getElementById('kpiTotal');
    const kpiCurrent = document.getElementById('kpiCurrent');
    const kpiOverdue = document.getElementById('kpiOverdue');
    const kpiOver90 = document.getElementById('kpiOver90');
    if (kpiTotal) kpiTotal.textContent = money(payload.totals.total_ar);
    if (kpiCurrent) kpiCurrent.textContent = money(payload.totals.current_total);
    if (kpiOverdue) kpiOverdue.textContent = money(payload.totals.overdue_total);
    if (kpiOver90) kpiOver90.textContent = money(payload.totals.over_90);

    // Set initial overdue badge from shown data (not global totals)
    const shownOverdueTotal = (payload.risk_top || [])
        .reduce((a, r) => a + Number(r.overdue_amount || 0), 0);
    const shownCount = (payload.risk_top || []).length;
    const overdueBadge = document.getElementById('badgeOverdue');
    if (overdueBadge) overdueBadge.textContent = `${shownCount} customers, ${money(shownOverdueTotal)}`;

    updateBadges(payload);

    if (window._stacked) window._stacked.destroy();
    if (window._pie) window._pie.destroy();
    if (window._risk) window._risk.destroy();

    const toggleEl = document.getElementById('toggleTotals');
    const toggleWrap = toggleEl ? toggleEl.closest('.form-check') : null;
    const defaultView = isDefaultView();

    // Show toggle ONLY in default view; hide when filtered
    if (toggleWrap) toggleWrap.style.display = defaultView ? '' : 'none';

    // Reflect user's saved choice when in default; otherwise ignore/clear
    if (toggleEl) {
        toggleEl.checked = defaultView ? !!window.DEFAULT_TOTALS_ONLY : false;
    }

    // Mode logic:
    // - Default view: use user's toggle choice
    // - Filtered view: always stacked
    const mode = defaultView ? (toggleEl && toggleEl.checked ? 'totals' : 'stacked') : 'stacked';

    window._stacked = buildBalancesBar(document.getElementById('stackedBar'), payload.cust_bucket, mode);
    window._pie = buildPie(document.getElementById('agingPie'), payload.aging_summary);
    window._risk = buildRiskBar(document.getElementById('riskBar'), payload.risk_top);

    fillAgingTable(document.getElementById('agingTable'), payload.aging_summary, payload.totals.total_ar);
    buildDetailTable(payload.invoice_detail);

    // Refresh banner with current state
    updateFilterBanner();

    // Bind/rebind totals toggle — only acts in default view
    if (toggleEl) {
        toggleEl.onchange = () => {
            if (!isDefaultView()) return;               // ignore outside default view
            window.DEFAULT_TOTALS_ONLY = toggleEl.checked;
            if (window._stacked) window._stacked.destroy();
            const newMode = toggleEl.checked ? 'totals' : 'stacked';
            window._stacked = buildBalancesBar(document.getElementById('stackedBar'), window.CURRENT_PAYLOAD.cust_bucket, newMode);
        };
    }
}

/* ================= CSV -> Payload ================= */
function toPayloadFromCSV(rows) {
    if (!rows || rows.length === 0) return null;
    const headers = Object.keys(rows[0] || {});
    const cols = headers.map(h => String(h).trim().toLowerCase());

    function find(...names) {
        for (let i = 0; i < cols.length; i++) if (names.includes(cols[i])) return headers[i];
        return null;
    }

    const c_customer = find('customer', 'name', 'customer_name');
    const c_type = find('type', 'transaction_type');
    const c_txn = find('date', 'txn_date', 'transaction_date', 'invoice_date');
    const c_due = find('due date', 'due_date', 'duedate');
    const c_num = find('num', 'no', 'invoice_number', 'doc_num', 'txn_no');
    const c_bal = find('open balance', 'open_balance', 'open amount', 'openamount', 'open_amt', 'amount due', 'amount_due', 'balance', 'amount', 'amt');
    const c_memo = find('memo', 'description', 'memo/description', 'memo_description');

    function toNum(x) {
        const n = Number(String(x || '').replace(/[^0-9\.-]/g, ''));
        return isFinite(n) ? n : 0;
    }

    function parseDate(s) {
        const d = new Date(s);
        return isNaN(d) ? null : d;
    }

    const today = new Date();
    const rowsFiltered = rows.filter(r => {
        const t = String(r[c_type] || '').toLowerCase();
        if (!t) return false;
        if (['payment', 'deposit', 'journal', 'total', 'subtotal', 'refund'].includes(t)) return false;
        // Keep invoices and credit memos
        return t.includes('inv') || t === 'invoice' || t.includes('credit');
    }).filter(r => String(r[c_customer] || '').trim().length > 0);

    const detail = rowsFiltered.map(r => {
        const due = parseDate(r[c_due]);
        const days = due ? Math.floor((today - due) / (1000 * 60 * 60 * 24)) : 0;
        const bucket = days <= 0 ? 'Current' : days <= 30 ? '1–30' : days <= 60 ? '31–60' : days <= 90 ? '61–90' : days <= 120 ? '91–120' : '120+';
        const rec = {
            Customer: r[c_customer],
            Type: (String(r[c_type] || '').toLowerCase().includes('credit') ? 'Credit Memo' : 'Invoice'),
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
document.addEventListener('DOMContentLoaded', function () {
    const input = document.getElementById('fileInput');
    if (!input) return;
    input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        Papa.parse(file, {
            header: true, dynamicTyping: false, skipEmptyLines: 'greedy', complete: (res) => {
                const payload = toPayloadFromCSV(res.data);
                if (!payload) {
                    alert('Could not read any rows from the CSV.');
                    return;
                }
                buildAll(payload);
            }
        });
    });
});
