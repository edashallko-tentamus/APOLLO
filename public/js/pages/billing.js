// Billing (I-1, migration 036). Alex (2026-10-15): the LIMS does all the invoicing; any completed work (its COA issued)
// can be invoiced at any time, in partial invoices per lab order; the reviewer groups and claims the work (like Report
// Finalization), checks the discounts and late rushes, then issues the invoice (signed), which emails it to the
// client and queues it for the lab's QuickBooks Online company. Corrections by credit note.
// Tabs: Ready to invoice, My drafts, All drafts, Invoices, QuickBooks queue, Settings; the invoice page; the order's
// billing card (order page).
import { api, esc, pageHeader, toast, modal, link, signDialog, state, can, askReason, money } from '../app.js';
import { Grid } from '../grid.js';
import { section, editableGrid } from './common.js';

const css = document.createElement('style');
css.textContent = `
.bltabs { display: flex; gap: 6px; flex-wrap: wrap; margin: -4px 0 12px; }
.bltabs a { text-decoration: none; border: 1px solid var(--line); background: #fff; color: var(--ink); padding: 6px 12px; border-radius: 7px; font-size: 13.5px; }
.bltabs a.on { background: var(--s-pricing, #7a4d8c); border-color: var(--s-pricing, #7a4d8c); color: #fff; } .bltabs small { opacity: .8; margin-left: 3px; }
.blfil { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin: 0 0 8px; font-size: 13px; }
.blfil button { border: 1px solid var(--line); background: #fff; border-radius: 14px; padding: 3px 10px; cursor: pointer; font-size: 12.5px; } .blfil button.on { border-color: var(--s-pricing, #7a4d8c); font-weight: 700; background: #F3E9F6; }
.blsum { display: flex; gap: 22px; flex-wrap: wrap; margin: 2px 0 10px; font-size: 13px; } .blsum b { font-size: 17px; display: block; color: var(--ink); } .blsum span { color: var(--muted); }
tr.bllate td { background: #fff1e6; } td.bllate { color: #a13d12; font-weight: 700; } tr.blretest td { background: #fbf7ec; }
td.blneg { color: #a13d12; }
.blinv { display: grid; grid-template-columns: minmax(320px, 1fr) 300px; gap: 12px; align-items: start; } .blinv .card { margin: 0 0 12px; }
.bltot div { display: flex; justify-content: space-between; padding: 3px 0; font-size: 13.5px; } .bltot .big { font-size: 18px; font-weight: 700; border-top: 1px solid var(--line); margin-top: 6px; padding-top: 8px; }
.blbanner { border-left: 4px solid #c68a00; background: #fff8e6; padding: 8px 12px; border-radius: 4px; margin: 0 0 12px; font-size: 13px; }
.blbanner.cn { border-color: #7a4d8c; background: #F3E9F6; }
.blopts { width: 100%; border-collapse: collapse; font-size: 13px; margin: 6px 0; } .blopts td, .blopts th { padding: 5px 6px; border-bottom: 1px solid #eef1f3; text-align: left; }
.blopts tr.met td { background: #eef8f1; } .blopts tr.missed td { color: #8a949c; } .blopts label { cursor: pointer; }
pre.bljson { background: #f6f8f7; border: 1px solid var(--line); border-radius: 6px; padding: 8px; font-size: 11.5px; max-height: 320px; overflow: auto; white-space: pre-wrap; }
@media (max-width: 1100px) { .blinv { grid-template-columns: 1fr; } }
`;
document.head.appendChild(css);

const d8 = (v) => { if (!v) return ''; const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString([], { dateStyle: 'medium' }) : ''; };
const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
const sq = () => '?s=' + encodeURIComponent(state.site || '');
const pdfOf = (id) => window.open(`/api/billing/invoices/${id}/pdf${sq()}`, '_blank');
const canIssue = () => can('invoicing.issue');

const TABS = [['ready', 'Ready to invoice'], ['mine', 'My draft invoices'], ['drafts', 'All drafts'], ['issued', 'Invoices and credit notes'], ['queue', 'QuickBooks queue'], ['settings', 'Settings']];
let readyFilter = 'all';
let issuedDays = 120;

export async function list(main) {
  const tab = TABS.some(([k]) => k === state.query?.get('tab')) ? state.query.get('tab') : 'ready';
  const intro = {
    ready: 'Work whose COA has been issued to the client and is not invoiced yet. Select the work to invoice and claim it: each lab order\'s work goes onto your own draft invoice, which nobody else can change or issue. Orange rows are rushes reported late.',
    mine: 'Your draft invoices. Open each one to check the prices and discounts against the quote and any late rush, then select the drafts and issue them with one signature: each is numbered, dated today, emailed to the client\'s billing contacts and queued for QuickBooks.',
    drafts: 'Every draft invoice at this lab and who is checking it. Only the holder changes or issues a draft; a lab administrator can take one back with a reason.',
    issued: 'Invoices and credit notes issued at this lab, newest first. An issued invoice never changes: correct it with a credit note from its page.',
    queue: 'What was queued for this lab\'s QuickBooks Online company, as its API takes it. Nothing is sent until a system administrator connects the lab (Settings).',
    settings: 'Clients\' payment terms, and this lab\'s accounting company (each lab is its own QuickBooks Online company).' }[tab];
  main.innerHTML = pageHeader('Billing', intro, '', { kind: 'billing' })
    + `<div class="bltabs">${TABS.map(([k, l]) => `<a href="#/billing?tab=${k}" class="${k === tab ? 'on' : ''}">${esc(l)}</a>`).join('')}</div>`
    + (canIssue() ? '' : '<div class="card warn">You can see invoicing here. Claiming, checking and issuing invoices needs the invoicing.issue permission (Accounting and General Managers).</div>')
    + '<div id="body"></div>';
  const body = main.querySelector('#body');
  if (tab === 'ready') return readyTab(body, main);
  if (tab === 'settings') return settingsTab(body, main);
  if (tab === 'queue') return queueTab(body);
  return invoicesTab(body, main, tab);
}

// ---------------------------------------------------------------- ready to invoice
async function readyTab(body, main) {
  const d = await api('/billing/ready');
  const lateRush = (r) => Number(r.late_days) > 0 && Number(r.rush_fee) > 0;
  const FILTERS = { all: ['All', () => true], late: ['Late rush', lateRush], rush: ['Rush', (r) => Number(r.rush_fee) > 0], retest: ['Retests', (r) => r.is_retest || r.was_retested],
    discount: ['Discounted', (r) => Number(r.discount) > 0], stability: ['Stability pulls', (r) => r.stability] };
  if (!FILTERS[readyFilter]) readyFilter = 'all';
  const rows = d.rows.filter(FILTERS[readyFilter][1]);
  const sum = (a) => a.reduce((s, r) => s + Number(r.amount || 0), 0);
  body.innerHTML = `<div class="card">${section('Completed work not yet invoiced', '', `<button class="btn primary" id="claim" ${d.can_issue ? '' : 'disabled'}>Claim selected into my drafts</button>`)}
    <div class="blsum"><div><b>${money(sum(d.rows))}</b><span>${d.rows.length} test${d.rows.length === 1 ? '' : 's'} ready</span></div>
      <div><b>${new Set(d.rows.map((r) => r.order_code)).size}</b><span>lab orders</span></div>
      <div><b>${d.rows.filter(lateRush).length}</b><span>late rushes to check</span></div></div>
    <div class="blfil">Show: ${Object.entries(FILTERS).map(([k, [l, fn]]) => `<button data-f="${k}" class="${k === readyFilter ? 'on' : ''}">${esc(l)} <small>${d.rows.filter(fn).length}</small></button>`).join('')}</div>
    <div id="g"></div></div>`;
  body.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { readyFilter = b.dataset.f; readyTab(body, main); }; });
  const g = new Grid(body.querySelector('#g'), { readOnly: true, search: true, rows, emptyText: 'Nothing is waiting to be invoiced: completed work appears here once its COA is issued.',
    rowClass: (r) => (lateRush(r) ? 'bllate' : r.is_retest ? 'blretest' : ''), columns: [
      { field: 'completed_on', title: 'Reported', type: 'readonly', width: 110, format: d8 },
      { field: 'order_code', title: 'Order', type: 'link', width: 95, href: (r) => '#/orders/' + r.lab_order_id },
      { field: 'po_number', title: 'PO', type: 'readonly', width: 90 },
      { field: 'client_name', title: 'Client', type: 'link', width: 170, href: (r) => '#/clients/' + r.client_id },
      { field: 'sample_code', title: 'Sample', type: 'link', width: 125, href: (r) => '#/samples/' + r.sample_id },
      { field: 'client_sample_id', title: 'Client sample ID', type: 'readonly', width: 115 },
      { field: 'test_name', title: 'Test', type: 'readonly', width: 200 },
      { field: 'list_price', title: 'List', type: 'money', width: 80 },
      { field: 'discount', title: 'Discount', type: 'money', width: 80 },
      { field: 'price', title: 'Price', type: 'money', width: 80 },
      { field: 'rush_fee', title: 'Rush fee', type: 'money', width: 80 },
      { field: 'late_days', title: 'Late', type: 'readonly', width: 95, format: (v, r) => (Number(v) > 0 ? `${v} day${Number(v) === 1 ? '' : 's'}${Number(r.rush_fee) > 0 ? ' (rush)' : ''}` : ''), cellClass: (r) => (lateRush(r) ? 'bllate' : '') },
      { field: 'amount', title: 'Amount', type: 'money', width: 90 },
      { field: 'notes', title: 'Notes', type: 'readonly', width: 300, compute: (r) => [r.rush_tier_name && Number(r.rush_fee) > 0 ? 'Rush: ' + r.rush_tier_name : '', r.is_retest ? `Retest of ${r.retest_of}${r.oos_code ? ' (' + r.oos_code + ')' : ''}${r.billing_status === 'Non-billable' ? ', not charged' : ''}` : '',
        r.was_retested ? 'Retested' : '', r.stability ? 'Stability pull' : ''].filter(Boolean).join(' · ') }] });
  body.querySelector('#claim').onclick = async () => {
    const s = g.selectedRows();
    if (!s.length) { toast('Select the work to invoice (Ctrl+click or Shift+click for several; Ctrl+A for everything shown).', 'err'); return; }
    try {
      const x = await api('/billing/claim', { method: 'POST', body: { tests: [...new Set(s.map((r) => r.requested_test_id))] } });
      toast(`${s.length} test${s.length === 1 ? '' : 's'} claimed onto ${x.invoices.length} draft invoice${x.invoices.length === 1 ? '' : 's'} (one per lab order).`);
      location.hash = x.invoices.length === 1 ? '#/billing/invoices/' + x.invoices[0] : '#/billing?tab=mine';
    } catch (e) { toast(e.message, 'err'); }
  };
}

// ---------------------------------------------------------------- drafts and issued invoices
async function invoicesTab(body, main, tab) {
  const d = await api(`/billing/invoices?tab=${tab}${tab === 'issued' ? '&days=' + issuedDays : ''}`);
  const cols = [
    { field: 'code', title: tab === 'issued' ? 'Number' : 'Draft', type: 'link', width: 135, href: (r) => '#/billing/invoices/' + r.id },
    ...(tab === 'issued' ? [{ field: 'kind', title: 'Kind', type: 'readonly', width: 90 }, { field: 'invoice_date', title: 'Date', type: 'readonly', width: 105, format: d8 },
      { field: 'due_date', title: 'Due', type: 'readonly', width: 105, format: (v, r) => (r.kind === 'Invoice' ? d8(v) : '') }] : []),
    { field: 'client_name', title: 'Client', type: 'link', width: 180, href: (r) => '#/clients/' + r.client_id },
    { field: 'order_code', title: 'Order', type: 'link', width: 95, href: (r) => '#/orders/' + r.lab_order_id },
    { field: 'po_number', title: 'PO', type: 'readonly', width: 90 },
    { field: 'line_count', title: 'Tests', type: 'readonly', width: 55 },
    { field: 'sample_count', title: 'Samples', type: 'readonly', width: 65 },
    { field: 'total', title: 'Total', type: 'money', width: 95, cellClass: (r) => (Number(r.total) < 0 ? 'blneg' : '') },
    ...(tab === 'issued' ? [
      { field: 'credited', title: 'Credited', type: 'readonly', width: 85, format: (v) => (Number(v) ? money(v) : '') },
      { field: 'credits_number', title: 'Credits', type: 'readonly', width: 120 },
      { field: 'catchup', title: 'Catch-up', type: 'readonly', width: 75, format: (v) => (v ? 'Yes' : '') },
      { field: 'push_status', title: 'QuickBooks', type: 'readonly', width: 150, format: (v, r) => (r.catchup ? 'Not sent (catch-up)' : v || '') },
      { field: 'issued_by_name', title: 'Issued by', type: 'readonly', width: 140 },
      { field: 'pdf', title: '', type: 'button', width: 60, label: 'PDF', onClick: (r) => pdfOf(r.id) }]
      : [{ field: 'late_rush_count', title: 'Late rushes', type: 'readonly', width: 85, format: (v) => (Number(v) ? v : '') },
        { field: 'claimed_by_name', title: 'Held by', type: 'readonly', width: 150, format: (v, r) => (r.claimed_by === d.me ? 'You' : v) },
        { field: 'created_at', title: 'Claimed', type: 'readonly', width: 140, format: dt },
        { field: 'internal_note', title: 'Internal note', type: 'readonly', width: 160 }]),
  ];
  if (tab === 'issued') {
    body.innerHTML = `<div class="card"><div class="blfil">Issued in the last: ${[30, 120, 365, 3650].map((n) => `<button data-d="${n}" class="${n === issuedDays ? 'on' : ''}">${n === 3650 ? 'All' : n + ' days'}</button>`).join('')}</div>
      <div class="blsum"><div><b>${money(d.rows.filter((r) => r.kind === 'Invoice').reduce((s, r) => s + Number(r.total), 0))}</b><span>invoiced</span></div>
        <div><b>${money(-d.rows.filter((r) => r.kind !== 'Invoice').reduce((s, r) => s + Number(r.total), 0))}</b><span>credited</span></div>
        <div><b>${d.rows.filter((r) => r.kind === 'Invoice').length}</b><span>invoices</span></div></div><div id="g"></div></div>`;
    body.querySelectorAll('[data-d]').forEach((b) => { b.onclick = () => { issuedDays = Number(b.dataset.d); invoicesTab(body, main, tab); }; });
    new Grid(body.querySelector('#g'), { readOnly: true, search: true, rows: d.rows, emptyText: 'Nothing issued in this period.', columns: cols });
    return;
  }
  body.innerHTML = `<div class="card">${section(tab === 'mine' ? 'My drafts' : 'All drafts at this lab', '', tab === 'mine'
    ? `<button class="btn primary" id="issue" ${d.rows.length && d.can_issue ? '' : 'disabled'}>Issue selected…</button> <button class="btn" id="rel" ${d.rows.length ? '' : 'disabled'}>Release selected</button>` : '')}
    <div class="blsum"><div><b>${money(d.rows.reduce((s, r) => s + Number(r.total), 0))}</b><span>${d.rows.length} draft${d.rows.length === 1 ? '' : 's'}</span></div></div><div id="g"></div></div>`;
  const g = new Grid(body.querySelector('#g'), { readOnly: true, search: true, rows: d.rows, emptyText: tab === 'mine' ? 'You hold no draft invoices. Claim completed work on the Ready to invoice tab.' : 'No draft invoices at this lab.',
    columns: tab === 'drafts' ? [...cols, { field: 'take', title: '', type: 'button', width: 110, label: (r) => (r.claimed_by !== d.me && d.can_release_any ? 'Take back…' : ''), onClick: async (r) => {
      const reason = await askReason(`taking ${r.code} back from ${r.claimed_by_name}`); if (reason === null) return;
      try { await api(`/billing/invoices/${r.id}/release`, { method: 'POST', body: { reason } }); toast(`${r.code} released: its work is ready to invoice again.`); invoicesTab(body, main, tab); } catch (e) { toast(e.message, 'err'); }
    } }] : cols });
  if (tab !== 'mine') return;
  body.querySelector('#issue').onclick = () => { const s = g.selectedRows(); issueDrafts(s.length ? s : d.rows, () => { location.hash = '#/billing?tab=issued'; }); };
  body.querySelector('#rel').onclick = async () => {
    const s = g.selectedRows(); if (!s.length) { toast('Select the drafts to release.', 'err'); return; }
    try { for (const r of s) await api(`/billing/invoices/${r.id}/release`, { method: 'POST', body: {} }); toast('Released: the work is ready to invoice again.'); invoicesTab(body, main, tab); } catch (e) { toast(e.message, 'err'); }
  };
}

async function issueDrafts(rows, done) {
  if (!rows.length) { toast('Select the draft invoices to issue.', 'err'); return; }
  const total = rows.reduce((s, r) => s + Number(r.total || 0), 0);
  const ok = await signDialog({ title: 'Issue invoices', meaning: 'Invoiced by', needReason: false, okText: 'Sign and issue',
    what: `${rows.length} invoice${rows.length === 1 ? '' : 's'} (${rows.map((r) => r.code).join(', ')}), ${money(total)} in all. Each is numbered and dated today, emailed with its PDF to the client's billing contacts and queued for QuickBooks`,
    submit: ({ signature }) => api('/billing/issue', { method: 'POST', body: { ids: rows.map((r) => r.id), signature } }) });
  if (!ok) return;
  const list = (ok.issued || []).map((x) => x.invoice_number).join(', ');
  toast(`Issued and sent: ${list}.`);
  done(ok);
}

async function queueTab(body) {
  const d = await api('/billing/invoices?tab=queue');
  body.innerHTML = '<div class="card"><div id="g"></div></div>';
  new Grid(body.querySelector('#g'), { readOnly: true, search: true, rows: d.rows, emptyText: 'Nothing queued yet: issued invoices and credit notes are queued here (catch-up invoices are not).', columns: [
    { field: 'code', title: 'Number', type: 'link', width: 140, href: (r) => '#/billing/invoices/' + r.id },
    { field: 'entity', title: 'Sent as', type: 'readonly', width: 95 },
    { field: 'client_name', title: 'Client', type: 'readonly', width: 180 },
    { field: 'order_code', title: 'Order', type: 'readonly', width: 95 },
    { field: 'invoice_date', title: 'Date', type: 'readonly', width: 105, format: d8 },
    { field: 'total', title: 'Total', type: 'money', width: 95 },
    { field: 'provider', title: 'Accounting', type: 'readonly', width: 140 },
    { field: 'push_status', title: 'Status', type: 'readonly', width: 160 },
    { field: 'queued_at', title: 'Queued', type: 'readonly', width: 145, format: dt },
    { field: 'last_error', title: 'Last error', type: 'readonly', width: 200 }] });
}

async function settingsTab(body, main) {
  const d = await api('/billing/settings');
  const c = d.connection || {};
  body.innerHTML = `<div class="card">${section(`${d.lab.site_code}: accounting company`, 'Each lab is its own QuickBooks Online company. Invoices are queued for it when issued and sent once a system administrator connects it (the connection itself is built with IT when the company and its access are ready).',
      d.is_admin ? '<button class="btn" id="edit">Change…</button>' : '')}
    <dl class="kv"><dt>Accounting system</dt><dd>${esc(c.provider || 'QuickBooks Online')}</dd><dt>Status</dt><dd><b>${esc(c.status || 'Not connected')}</b></dd>
      <dt>Company</dt><dd>${esc(c.company_name || 'not set')}${c.company_id ? ` (company ID ${esc(c.company_id)})` : ''}</dd><dt>Environment</dt><dd>${esc(c.environment || '')}</dd>
      <dt>Lines booked to</dt><dd>${esc(c.item_name || '')}</dd><dt>Payment details on invoices</dt><dd>${esc(d.lab.invoice_remit_to || 'not set (placeholder text is printed)')}</dd></dl></div>
    <div class="card">${section('Clients\' payment terms', `Days after the invoice date (30 = net 30; 0 = due on receipt). ${d.can_issue ? 'Type or paste, fill down with Ctrl+D, then save.' : 'Changed by people who issue invoices.'} Invoices go to each client's Billing contacts (else the order's contact).`)}<div id="tg"></div></div>`;
  editableGrid({ el: body.querySelector('#tg'), rows: d.clients, search: true, readOnly: !d.can_issue, what: 'payment terms', columns: [
    { field: 'client_code', title: 'Code', type: 'link', width: 90, href: (r) => '#/clients/' + r.id },
    { field: 'client_name', title: 'Client', type: 'readonly', width: 240 },
    { field: 'payment_terms_days', title: 'Payment terms (days)', type: 'int', width: 150 },
    { field: 'billing_emails', title: 'Billing contacts', type: 'readonly', width: 300, format: (v) => v || 'none (the order\'s contact is used)' }],
    save: (rows, reason) => api('/billing/settings/terms', { method: 'POST', body: { rows, reason } }), afterSave: () => list(main) });
  const ed = body.querySelector('#edit');
  if (ed) ed.onclick = async () => {
    const v = await modal({ title: `${d.lab.site_code}: accounting company`, okText: 'Save', fields: [
      { name: 'provider', label: 'Accounting system', type: 'select', blank: false, value: c.provider, options: ['QuickBooks Online', 'QuickBooks Desktop', 'SAP'] },
      { name: 'company_name', label: 'Company name', value: c.company_name || '' },
      { name: 'company_id', label: 'Company ID (QuickBooks Online realm ID)', value: c.company_id || '' },
      { name: 'environment', label: 'Environment', type: 'select', blank: false, value: c.environment, options: ['Sandbox', 'Production'] },
      { name: 'item_name', label: 'Product/service the lines are booked to', value: c.item_name || '' },
      { name: 'invoice_remit_to', label: 'Payment details printed on invoices', type: 'textarea', value: d.lab.invoice_remit_to || '' }] });
    if (!v) return;
    const reason = await askReason('the lab\'s accounting settings'); if (reason === null) return;
    try { await api('/billing/settings/connection', { method: 'PUT', body: { ...v, reason } }); toast('Saved.'); list(main); } catch (e) { toast(e.message, 'err'); }
  };
}

// ---------------------------------------------------------------- an invoice
export async function invoice(main, id) {
  const d = await api('/billing/invoices/' + id);
  const i = d.invoice;
  const draft = i.status === 'Draft';
  const mine = draft && i.claimed_by === d.me && d.can_issue;
  const credit = i.kind === 'Credit note';
  const title = draft ? `Draft invoice ${i.draft_code}` : `${i.kind} ${i.invoice_number}`;
  const sub = draft ? `${i.client_name}, order ${i.order_code}. Being checked by ${i.claimed_by === d.me ? 'you' : i.claimed_by_name}.`
    : `${i.client_name}, order ${i.order_code}. Issued ${dt(i.issued_at)} by ${i.issued_by_name || 'the system'}.`;
  const actions = [`<button class="btn" id="pdf">${draft ? 'Preview PDF' : 'PDF'}</button>`,
    mine ? '<button class="btn primary" id="issue">Issue…</button> <button class="btn" id="rel">Release draft</button>' : '',
    !draft && !credit && d.can_issue && Number(i.total) + 0 !== 0 ? '<button class="btn" id="credit">Credit…</button>' : ''].join(' ');
  main.innerHTML = pageHeader(title, esc(sub), actions, { kind: 'invoice', id: i.id })
    + (i.catchup ? '<div class="blbanner">Catch-up invoice: work completed before invoicing moved into LIMS3, dated the Friday of the week its COA was issued. It was not emailed or queued for QuickBooks.</div>' : '')
    + (credit ? `<div class="blbanner cn">Credits invoice ${link('#/billing/invoices/' + i.credit_of_id, i.credits_number)}. Reason: ${esc(i.reason || '')}</div>` : '')
    + (d.credits.length ? `<div class="blbanner cn">Credited by ${d.credits.map((x) => `${link('#/billing/invoices/' + x.id, x.code)} (${money(-Number(x.total))}, ${esc(x.reason || '')})`).join('; ')}.</div>` : '')
    + `<div class="blinv"><div>
        <div class="card">${section('Lines', draft ? (mine ? 'Check each line against the quote. Price… corrects the price billed (with a reason, printed under the line); Rush… bills a late rush at the tier whose turnaround was met, or standard. Take off what should not be invoiced yet.' : 'Only the person checking this draft changes it.') : '')}
          ${mine ? '<div class="blfil"><button class="btn" id="rm">Take selected lines off</button></div>' : ''}<div id="lg"></div></div>
        ${d.push ? `<div class="card">${section('QuickBooks Online', `Queued ${dt(d.push.created_at)} as ${esc(d.push.entity)}: ${esc(d.push.status)}${d.push.last_error ? ' (' + esc(d.push.last_error) + ')' : ''}.`, '<button class="btn ghost" id="pj">Show what is sent</button>')}<pre class="bljson" id="pjson" style="display:none">${esc(JSON.stringify(d.push.payload, null, 2))}</pre></div>` : ''}
        ${d.emails.length ? `<div class="card">${section('Emailed', 'Sandbox: stored in the Outbox, not actually sent.')}<ul>${d.emails.map((e) => `<li>${esc(e.to_address)}: ${esc(e.subject)} <span class="help">${dt(e.created_at)}</span></li>`).join('')}</ul></div>` : ''}
      </div><div>
        <div class="card bltot">${section(credit ? 'Credit' : 'Totals')}
          <div><span>List value</span><span>${money(i.list_total)}</span></div><div><span>Discounts</span><span>${money(-Number(i.discount_total))}</span></div>
          <div><span>Rush fees</span><span>${money(i.rush_total)}</span></div><div class="big"><span>${credit ? 'Credited' : 'Total'}</span><span>${money(i.total)}</span></div></div>
        <div class="card">${section('Details', '', mine ? '<button class="btn" id="edit">Change…</button>' : '')}<dl class="kv">
          <dt>Client</dt><dd>${link('#/clients/' + i.client_id, i.client_name)}</dd><dt>Order</dt><dd>${link('#/orders/' + i.lab_order_id, i.order_code)}</dd>
          <dt>PO</dt><dd>${esc(i.po_number || '')}</dd>
          ${draft ? '' : `<dt>Date</dt><dd>${d8(i.invoice_date)}</dd>${credit ? '' : `<dt>Due</dt><dd>${d8(i.due_date)} (net ${esc(i.payment_terms_days)})</dd>`}<dt>Bill to</dt><dd>${esc(i.bill_to_name || '')}${i.bill_to_address ? '<br><span class="help">' + esc(i.bill_to_address) + '</span>' : ''}</dd>`}
          <dt>Note on the invoice</dt><dd>${esc(i.note || '')}</dd><dt>Internal note</dt><dd>${esc(i.internal_note || '')}</dd></dl></div>
      </div></div>`;
  const late = (l) => Number(l.late_days) > 0 && l.rush_ordered;
  const g = new Grid(main.querySelector('#lg'), { readOnly: true, rows: d.lines, rowClass: (l) => (late(l) ? 'bllate' : l.retest_of_id ? 'blretest' : ''), columns: [
    { field: 'line_no', title: '#', type: 'readonly', width: 35 },
    { field: 'sample_code', title: 'Sample', type: 'link', width: 125, href: (l) => '#/samples/' + l.sample_id },
    { field: 'client_sample_id', title: 'Client sample ID', type: 'readonly', width: 110 },
    { field: 'test_name', title: 'Test', type: 'readonly', width: 190, format: (v, l) => (l.retest_of_id ? 'Retest: ' : '') + v },
    { field: 'completed_on', title: 'Reported', type: 'readonly', width: 105, format: d8 },
    { field: 'list_price', title: 'List', type: 'money', width: 75 },
    { field: 'quoted_price', title: 'Ordered at', type: 'money', width: 85 },
    { field: 'price', title: 'Billed', type: 'money', width: 80, cellClass: (l) => (Number(l.price) !== Number(l.quoted_price) ? 'bllate' : '') },
    { field: 'rush', title: 'Rush', type: 'readonly', width: 170, compute: (l) => (l.rush_ordered ? (l.rush_billed === l.rush_ordered ? l.rush_ordered : `${l.rush_ordered} ordered; ${l.rush_billed ? l.rush_billed + ' billed' : 'no rush fee'}`) : '') },
    { field: 'rush_fee', title: 'Rush fee', type: 'money', width: 80 },
    { field: 'late_days', title: 'Late', type: 'readonly', width: 75, format: (v) => (Number(v) > 0 ? `${v} day${Number(v) === 1 ? '' : 's'}` : ''), cellClass: (l) => (late(l) ? 'bllate' : '') },
    { field: 'amount', title: 'Amount', type: 'money', width: 90, cellClass: (l) => (Number(l.amount) < 0 ? 'blneg' : '') },
    { field: 'notes', title: 'Notes', type: 'readonly', width: 280, compute: (l) => [l.line_note, l.price_note ? 'Price: ' + l.price_note : '', l.rush_note ? 'Rush: ' + l.rush_note : '', l.credited_by ? 'Credited by ' + l.credited_by : ''].filter(Boolean).join(' · ') },
    ...(mine ? [{ field: 'p', title: '', type: 'button', width: 70, label: 'Price…', onClick: (l) => priceDialog(l, () => invoice(main, id)) },
      { field: 'r', title: '', type: 'button', width: 70, label: (l) => (l.rush_options && l.rush_options.length > 1 ? 'Rush…' : ''), onClick: (l) => rushDialog(l, () => invoice(main, id)) }] : []),
  ] });
  const $ = (s) => main.querySelector(s);
  $('#pdf').onclick = () => pdfOf(i.id);
  if ($('#pj')) $('#pj').onclick = () => { const p = $('#pjson'); p.style.display = p.style.display === 'none' ? '' : 'none'; };
  if ($('#issue')) $('#issue').onclick = () => issueDrafts([{ id: i.id, code: i.draft_code, total: i.total }], (r) => { const x = (r.issued || [])[0]; location.hash = '#/billing/invoices/' + (x ? x.id : i.id); invoice(main, i.id); });
  if ($('#rel')) $('#rel').onclick = async () => {
    try { await api(`/billing/invoices/${i.id}/release`, { method: 'POST', body: {} }); toast(`${i.draft_code} released: its work is ready to invoice again.`); location.hash = '#/billing?tab=ready'; } catch (e) { toast(e.message, 'err'); }
  };
  if ($('#rm')) $('#rm').onclick = async () => {
    const s = g.selectedRows(); if (!s.length) { toast('Select the lines to take off.', 'err'); return; }
    try { await api('/billing/lines/remove', { method: 'POST', body: { lines: s.map((l) => l.id) } }); toast('Taken off: that work is ready to invoice again.');
      if (s.length >= d.lines.length) location.hash = '#/billing?tab=mine'; else invoice(main, id); } catch (e) { toast(e.message, 'err'); }
  };
  if ($('#edit')) $('#edit').onclick = async () => {
    const v = await modal({ title: 'Invoice details', okText: 'Save', fields: [
      { name: 'po_number', label: 'Client PO number', value: i.po_number || '' },
      { name: 'note', label: 'Note printed on the invoice', type: 'textarea', value: i.note || '' },
      { name: 'internal_note', label: 'Internal note (not printed)', type: 'textarea', value: i.internal_note || '' }] });
    if (!v) return;
    try { await api('/billing/invoices/' + i.id, { method: 'PUT', body: v }); toast('Saved.'); invoice(main, id); } catch (e) { toast(e.message, 'err'); }
  };
  if ($('#credit')) $('#credit').onclick = () => creditDialog(i, d.lines.filter((l) => l.kind === 'Charge' && !l.credited_by), g.selectedRows(), (cn) => { location.hash = '#/billing/invoices/' + cn.id; });
}

async function priceDialog(l, done) {
  const v = await modal({ title: `Price billed: ${l.sample_code} ${l.test_name}`, okText: 'Save',
    intro: `List price ${money(l.list_price)}; ordered at ${money(l.quoted_price)} (from the quote). The reason is printed under the line.`, fields: [
      { name: 'price', label: 'Price billed', type: 'number', value: l.price, required: true },
      { name: 'note', label: 'Why it differs from the order', type: 'textarea', value: l.price_note || '' }] });
  if (!v) return;
  try { await api(`/billing/lines/${l.id}/price`, { method: 'POST', body: v }); toast('Price saved.'); done(); } catch (e) { toast(e.message, 'err'); }
}

async function rushDialog(l, done) {
  const opts = l.rush_options || [];
  const met = opts.filter((o) => o.met && o.tier_id);
  const closest = met.sort((a, b) => a.tat_days - b.tat_days)[0];
  const html = `<p class="intro">${Number(l.late_days) > 0 ? `Reported ${d8(l.completed_on)}, <b>${l.late_days} working day${Number(l.late_days) === 1 ? '' : 's'} after</b> the rush due date (${d8(l.due_date)}).` : 'Reported on time.'}
      ${closest ? ` The closest tier whose turnaround was met: <b>${esc(closest.tier_name)}</b>.` : ' No rush tier\'s turnaround was met.'}</p>
    <table class="blopts"><thead><tr><th></th><th>Tier</th><th>Would be due</th><th>Met?</th><th>Fee</th></tr></thead><tbody>
    ${opts.map((o, k) => { const allowed = o.is_ordered || o.met; const cur = (o.tier_id || null) === (l.rush_tier_id || null);
      return `<tr class="${o.met ? 'met' : 'missed'}"><td>${allowed ? `<input type="radio" name="tier" id="rt${k}" value="${esc(o.tier_id || '')}" ${cur ? 'checked' : ''}>` : ''}</td>
        <td><label for="rt${k}">${esc(o.tier_name)}${o.is_ordered && o.tier_id ? ' (ordered)' : ''}</label></td><td>${d8(o.due_date)}</td><td>${o.met ? 'Met' : 'Missed'}</td><td>${money(o.fee)}</td></tr>`; }).join('')}</tbody></table>`;
  const v = await modal({ title: `Rush billed: ${l.sample_code} ${l.test_name}`, okText: 'Save', wide: true, html,
    fields: [{ name: 'note', label: 'Why (printed under the line)', type: 'textarea', value: l.rush_note || (Number(l.late_days) > 0 ? `Reported ${l.late_days} working days late: billed at the tier met.` : '') }],
    collect: (m) => { const r = m.querySelector('input[name=tier]:checked'); return { tier_id: r ? r.value : undefined }; } });
  if (!v) return;
  if (v.tier_id === undefined) { toast('Choose the tier to bill.', 'err'); return; }
  try { await api(`/billing/lines/${l.id}/rush`, { method: 'POST', body: { tier_id: v.tier_id || null, note: v.note } }); toast('Rush saved.'); done(); } catch (e) { toast(e.message, 'err'); }
}

async function creditDialog(i, open, selected, done) {
  const sel = selected.filter((l) => open.some((o) => o.id === l.id));
  const lines = sel.length ? sel : open;
  if (!lines.length) { toast('Every line of this invoice is credited already.', 'err'); return; }
  const amount = lines.reduce((s, l) => s + Number(l.amount), 0);
  const v = await modal({ title: `Credit ${i.invoice_number}`, okText: 'Continue to sign',
    intro: `${sel.length ? 'The selected lines' : 'Every line not yet credited'}: ${lines.length} line${lines.length === 1 ? '' : 's'}, ${money(amount)}. Select lines on the invoice first to credit only some. The credit note is emailed to the client and queued for QuickBooks.`,
    fields: [{ name: 'credit_reason', label: 'Reason (printed on the credit note)', type: 'textarea', required: true },
      { name: 'rebill', label: 'Invoice the work again', type: 'checkbox', value: true, cbLabel: 'The work goes back to Ready to invoice (to be invoiced correctly). Untick for a credit that is final.' }] });
  if (!v) return;
  const ok = await signDialog({ title: 'Issue a credit note', meaning: 'Credited by', needReason: false, okText: 'Sign and issue',
    what: `a credit note of ${money(amount)} against ${i.invoice_number}`,
    submit: ({ signature }) => api(`/billing/invoices/${i.id}/credit`, { method: 'POST', body: { lines: sel.length ? sel.map((l) => l.id) : null, rebill: v.rebill, credit_reason: v.credit_reason, signature } }) });
  if (!ok) return;
  toast(`Credit note ${ok.credit_note.invoice_number} issued and sent.`);
  done(ok.credit_note);
}

// ---------------------------------------------------------------- the order's billing (order page)
export async function orderBillingCard(host, orderId) {
  let d;
  try { d = await api(`/orders/${orderId}/billing`); } catch (_) { return; }
  if (!d.allowed || !d.tests.length) return;
  const sum = (st) => d.tests.filter((t) => st.includes(t.state)).reduce((s, t) => s + Number(t.charge || 0), 0);
  host.style.display = '';
  host.innerHTML = section('Billing', 'Each test on this order and where its billing stands. Work is invoiced once its COA is issued; an order may be invoiced in parts.')
    + `<div class="blsum"><div><b>${money(sum(['Invoiced']))}</b><span>invoiced</span></div><div><b>${money(sum(['On a draft', 'Ready to invoice']))}</b><span>ready or on a draft</span></div>
       <div><b>${money(sum(['In the lab', 'Waiting for QA']))}</b><span>still in the lab</span></div><div><b>${money(sum(['Invoiced', 'On a draft', 'Ready to invoice', 'In the lab', 'Waiting for QA']))}</b><span>order total</span></div></div>
       ${d.invoices.length ? `<p class="help">Invoices: ${d.invoices.map((x) => `${link('#/billing/invoices/' + x.id, x.code)} ${x.status === 'Draft' ? '(draft, ' + esc(x.claimed_by_name || '') + ')' : d8(x.invoice_date)} ${money(x.total)}${x.catchup ? ' (catch-up)' : ''}`).join(' · ')}</p>` : ''}
       <div id="obg"></div>`;
  new Grid(host.querySelector('#obg'), { readOnly: true, rows: d.tests, rowClass: (t) => (t.is_retest ? 'blretest' : ''), columns: [
    { field: 'sample_code', title: 'Sample', type: 'readonly', width: 125 },
    { field: 'client_sample_id', title: 'Client sample ID', type: 'readonly', width: 120 },
    { field: 'test_name', title: 'Test', type: 'readonly', width: 210, format: (v, t) => (t.is_retest ? 'Retest: ' : '') + v },
    { field: 'state', title: 'Billing', type: 'readonly', width: 130 },
    { field: 'charge', title: 'Charge', type: 'money', width: 90 },
    { field: 'invoice_code', title: 'Invoice', type: 'link', width: 140, href: (t) => (t.invoice_id ? '#/billing/invoices/' + t.invoice_id : null) },
    { field: 'invoice_date', title: 'Invoiced', type: 'readonly', width: 105, format: d8 },
    { field: 'detail', title: 'Notes', type: 'readonly', width: 260 }] });
}
