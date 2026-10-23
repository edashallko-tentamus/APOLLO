// Intake dashboard (rush approvals and incoming work), Outbox, Sites and holidays (Admin)
import { api, esc, pageHeader, toast, modal, state, money, badge, currentSite, currentUser } from '../app.js';
import { Grid } from '../grid.js';
import { editableGrid, section, pagedList } from './common.js';
import { showEmail } from './orders.js';

const d8 = (v) => (v ? new Date(v + 'T12:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : '');
const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '');
const ago = (v) => { if (!v) return ''; const m = Math.round((Date.now() - new Date(v).getTime()) / 60000); return m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`; };

const orderLink = (r) => '#/orders/' + r.lab_order_id;
const sampleLink = (r) => (r.sample_id ? '#/samples/' + r.sample_id : null);

export async function dashboard(main) {
  const d = await api('/intake');
  const site = currentSite();
  const overdue = d.pending.filter((p) => p.overdue).length;
  main.innerHTML = pageHeader('Intake dashboard', `Rush requests, incoming work and today's samples for ${esc(site ? site.site_code : 'your lab')}.`, '', { kind: 'intake' }) + `
    <div class="tiles">
      <div class="tile ${d.pending.length ? 'warn' : ''}"><b>${d.pending.length}</b><span>Rush awaiting approval</span></div>
      <div class="tile ${overdue ? 'warn' : ''}"><b>${overdue}</b><span>Approvals overdue (escalate)</span></div>
      <div class="tile"><b>${d.incoming.length}</b><span>Rush tests active</span></div>
      <div class="tile"><b>${d.expected.reduce((s, x) => s + Number(x.expected_samples), 0)}</b><span>Samples expected</span></div>
      <div class="tile"><b>${d.today.length}</b><span>Samples logged (24 h)</span></div>
    </div>
    <div class="card">${section('Rush awaiting approval', 'These tiers need intake approval. Until approved, the test runs at standard turnaround and price. Overdue requests escalate to the lab manager.')}<div id="pg"></div></div>
    <div class="card">${section('Rush incoming', 'Accepted rushes (automatic or approved). Plan the work around these due dates.')}<div id="ig"></div></div>
    <div class="cols"><div class="card">${section('Samples expected', 'Orders with samples not yet logged.')}<div id="eg"></div></div>
    <div class="card">${section('Logged in the last 24 hours')}<div id="tg"></div></div></div>`;
  const clientLink = (r) => '#/clients/' + r.client_id;
  new Grid(main.querySelector('#pg'), { readOnly: true, rows: d.pending, emptyText: 'Nothing waiting for approval.',
    rowClass: (r) => (r.overdue ? 'warnrow' : ''),
    columns: [
      { field: 'order_code', title: 'Order', type: 'link', width: 95, href: orderLink },
      { field: 'client_name', title: 'Client', type: 'link', width: 140, href: clientLink },
      { field: 'sample_code', title: 'Sample', type: 'link', width: 125, compute: (r) => r.sample_code || r.client_sample_id, href: sampleLink },
      { field: 'test_name', title: 'Test', type: 'link', width: 180, href: (r) => '#/catalog/' + r.test_id },
      { field: 'rush_tier_name', title: 'Requested', type: 'readonly', width: 110 },
      { field: 'rush_requested_at', title: 'Requested', type: 'readonly', width: 120, format: ago },
      { field: 'approval_due_at', title: 'Approve by', type: 'readonly', width: 130, format: (v, r) => dt(v) + (r.overdue ? ' (overdue)' : ''), cellClass: (r) => (r.overdue ? 'flag' : '') },
      { field: 'ap', title: '', type: 'button', width: 85, label: 'Approve', onClick: (r) => decide(r, 'Approved', d, main) },
      { field: 'na', title: '', type: 'button', width: 120, label: 'Not accepted', onClick: (r) => decide(r, 'Not Accepted', d, main) },
    ] });
  new Grid(main.querySelector('#ig'), { readOnly: true, rows: d.incoming, emptyText: 'No active rush tests.',
    columns: [
      { field: 'order_code', title: 'Order', type: 'link', width: 95, href: orderLink },
      { field: 'client_name', title: 'Client', type: 'link', width: 140, href: clientLink },
      { field: 'sample_code', title: 'Sample', type: 'link', width: 125, compute: (r) => r.sample_code || `${r.client_sample_id} (not logged)`, href: sampleLink },
      { field: 'test_name', title: 'Test', type: 'link', width: 180, href: (r) => '#/catalog/' + r.test_id },
      { field: 'rush_tier_name', title: 'Rush', type: 'readonly', width: 110 },
      { field: 'rush_status', title: 'Status', type: 'readonly', width: 110 },
      { field: 'due_date', title: 'Due', type: 'readonly', width: 110, format: (v) => d8(v) || 'when logged' },
      { field: 'nax', title: '', type: 'button', width: 120, label: 'Not accepted', onClick: (r) => decide(r, 'Not Accepted', d, main) },
    ] });
  new Grid(main.querySelector('#eg'), { readOnly: true, rows: d.expected, emptyText: 'No samples expected.',
    columns: [{ field: 'order_code', title: 'Order', type: 'link', width: 95, href: orderLink }, { field: 'client_name', title: 'Client', type: 'readonly', width: 150 },
      { field: 'expected_samples', title: 'Samples', type: 'readonly', width: 70 },
      { field: 'account_status', title: 'Client', type: 'readonly', width: 80, format: (v) => (v === 'Active' ? '' : v) }] });
  new Grid(main.querySelector('#tg'), { readOnly: true, rows: d.today, emptyText: 'Nothing logged yet.',
    columns: [{ field: 'sample_code', title: 'Sample', type: 'link', width: 125, href: sampleLink }, { field: 'order_code', title: 'Order', type: 'link', width: 95, href: orderLink },
      { field: 'client_name', title: 'Client', type: 'readonly', width: 130 },
      { field: 'test_count', title: 'Tests', type: 'readonly', width: 55 }, { field: 'due_date', title: 'Due', type: 'readonly', width: 100, format: d8 }] });
}

async function decide(r, decision, d, main) {
  if (decision === 'Approved') {
    const v = await modal({ title: `Approve ${r.rush_tier_name} rush`, okText: 'Approve', intro: `${esc(r.test_name)} on ${esc(r.sample_code || r.client_sample_id)} for ${esc(r.client_name)}. The rush fee and rush due date apply from now.`,
      fields: [{ name: 'reason', label: 'Note (optional)' }] });
    if (!v) return;
    try { await api('/rush-decisions', { method: 'POST', body: { requested_test_id: r.id, decision, requested_tier_id: r.rush_tier_id, reason: v.reason || null } }); toast('Rush approved.'); dashboard(main); } catch (e) { toast(e.message, 'err'); }
    return;
  }
  const cur = d.tiers.find((t) => t.id === r.rush_tier_id);
  const slower = d.tiers.filter((t) => cur && t.schedule_id === cur.schedule_id && t.rush_tat > cur.rush_tat);
  const v = await modal({ title: `Rush not accepted: ${r.rush_tier_name}`, okText: 'Confirm and email client',
    intro: `${esc(r.test_name)} on ${esc(r.sample_code || r.client_sample_id)} for ${esc(r.client_name)}. An automatic email goes to the ordering contact with the new turnaround, the fee change, your reason and your name.`,
    fields: [
      { name: 'replacement_tier_id', label: 'Change it to', type: 'select', blank: false, value: '',
        options: [{ value: '', label: 'Standard turnaround (no rush fee)' }, ...slower.map((t) => ({ value: t.id, label: `${t.tier_name} rush (${t.rush_tat} ${t.tat_unit === 'Business Days' ? 'business' : 'calendar'} days)` }))] },
      { name: 'reason', label: 'Reason (sent to the client)', type: 'textarea', required: true }] });
  if (!v) return;
  try { await api('/rush-decisions', { method: 'POST', body: { requested_test_id: r.id, decision, requested_tier_id: r.rush_tier_id, replacement_tier_id: v.replacement_tier_id || null, reason: v.reason } }); toast('Rush declined; email placed in the Outbox.'); dashboard(main); } catch (e) { toast(e.message, 'err'); }
}

export async function outbox(main) {
  const site = currentSite();
  const tab = state.query.get('tab') === 'templates' ? 'templates' : 'emails';
  main.innerHTML = pageHeader('Outbox', `Every automatic email the system generates for ${esc(site ? site.site_code : 'your lab')}. In the Sandbox nothing is actually sent; this is exactly what the client would receive.`, '', { kind: tab === 'templates' ? 'templates' : 'outbox' })
    + `<div class="tabs"><a class="tab ${tab === 'emails' ? 'on' : ''}" href="#/outbox">Emails</a><a class="tab ${tab === 'templates' ? 'on' : ''}" href="#/outbox?tab=templates" id="tplTab">Templates</a></div><div id="g"></div>`;
  if (tab === 'templates') { (await import('./reports.js')).templates(main.querySelector('#g')); return; }
  // one page at a time from the server (0.35.0), newest first
  pagedList({ el: main.querySelector('#g'), url: '/outbox', q: state.query.get('find') || '', placeholder: 'Search by subject, recipient, order, quote or type',
    render: (body, rows) => new Grid(body, { readOnly: true, rows, onRowOpen: showEmail, emptyText: 'No emails here.',
    columns: [{ field: 'created_at', title: 'When', type: 'readonly', width: 150, format: dt }, { field: 'template', title: 'Type', type: 'readonly', width: 150 },
      { field: 'order_code', title: 'Order / quote', type: 'link', width: 105, compute: (r) => r.order_code || r.quote_code || '', href: (r) => (r.order_code ? orderLink(r) : r.quote_project_id ? '#/quotes/' + r.quote_project_id : null) }, { field: 'to_address', title: 'To', type: 'readonly', width: 230 },
      { field: 'subject', title: 'Subject', type: 'link', width: 380, onClick: showEmail }, { field: 'triggered_by', title: 'Triggered by', type: 'readonly', width: 140 },
      { field: 'delivery_status', title: 'Delivery', type: 'readonly', width: 140 }] }) });
}

export async function sites(main, selected) {
  const [rows, tzs] = await Promise.all([api('/sites'), api('/timezones')]);
  const cur = rows.find((s) => s.id === (selected || sites._sel)) || rows[0]; sites._sel = cur && cur.id;
  main.innerHTML = pageHeader('Sites and holidays', 'Admin. Each site has its own time zone (cutoff times are local) and holiday calendar (business-day turnaround skips these days). Only system administrators add or change labs (a new lab gets the standard groups); each lab\'s administrators keep its holidays. People get a lab by joining one of its groups (Admin, People and groups).', '', { kind: 'sites' }) + `
    <div class="card">${section('Sites')}<div id="sg"></div></div>
    <div class="card">${section(cur ? `Holidays: ${cur.site_code}` : 'Holidays', 'Paste a holiday list from Excel (date, description) or add rows.')}
      <div class="tabs">${rows.map((s) => `<button class="tab ${cur && s.id === cur.id ? 'on' : ''}" data-id="${s.id}">${esc(s.site_code)} <small>${s.holiday_count}</small></button>`).join('')}</div><div id="hg"></div></div>
    <div class="card" id="media"></div><div class="card" id="pname"></div>`;
  main.querySelectorAll('.tab[data-id]').forEach((b) => b.onclick = () => { location.hash = '#/admin/sites/' + b.dataset.id; });
  const sysAdmin = !!currentUser()?.is_admin;
  editableGrid({ el: main.querySelector('#sg'), rows, allowAdd: sysAdmin, readOnly: !sysAdmin, what: 'site settings', newRow: () => ({ status: 'Active', default_oos_procedure: 'Check and Acknowledge' }),
    columns: [
      { field: 'site_code', title: 'Code', type: 'text', width: 80, required: true, help: 'Lab prefix, used in sample IDs, e.g. CFL261012001' },
      { field: 'site_name', title: 'Name', width: 240, required: true },
      { field: 'time_zone', title: 'Time zone', type: 'select', width: 200, options: () => tzs.map((t) => t.name) },
      { field: 'address', title: 'Address', width: 220 },
      { field: 'default_oos_procedure', title: 'Default OOS procedure', type: 'select', width: 220, options: ['Full Phase I (21 CFR 211)', 'Check and Acknowledge'] },
      { field: 'require_workflow_verification', title: 'Verify workflows', type: 'bool', width: 110, help: 'A test version is approved only with a signed, passing workflow verification of its design (WD-6). Versions already approved keep their approval.' },
      { field: 'accreditation_body', title: 'Accreditation body', width: 150, help: 'Placeholder until the lab confirms it, e.g. A2LA or ANAB' },
      { field: 'accreditation_certificate', title: 'Certificate no.', width: 120 },
      { field: 'accreditation_statement', title: 'Accreditation statement (on the COA)', width: 320, help: 'Printed under the lab\'s name on every COA once filled in, e.g. "Accredited to ISO/IEC 17025:2017 (certificate 1234.01)". Empty: nothing is printed.' },
      // the 20-30 rule (migration 031): another network lab's test on this lab's quotes
      { field: 'subcontract_discount_pct', title: 'In-network discount %', type: 'number', min: 0, width: 110, help: 'Subcontracting to another Tentamus lab: the discount off that lab\'s catalogue price (the 20 of the 20-30 rule). Applies to new quote lines.' },
      { field: 'subcontract_markup_pct', title: 'Subcontract markup %', type: 'number', min: 0, width: 110, help: 'Added to that cost for the client (the 30 of the 20-30 rule). Applies to new quote lines.' },
      { field: 'stability_pull_window_days', title: 'Pull window (± days)', type: 'number', width: 120, help: 'Stability: the days early and late a new timepoint starts with (QA decision; 7 by default). Each timepoint can change it.' },
      { field: 'stability_reserve_pct', title: 'Stability reserve %', type: 'number', width: 120, help: 'Extra material asked for at placement, on top of every pull of the design' },
      { field: 'custody_signature_required', title: 'Signed receipt', type: 'bool', width: 110, help: 'Samples are logged only by "Receive and sign": the receiver signs the chain of custody with their password, and their handwritten signature goes in its Received area (0.29.0).' },
      { field: 'require_training', title: 'Training gate', type: 'bool', width: 110, help: 'Bench steps are signed only by people with a current qualification for the test (Training and competency). Grant the legacy qualifications first (0.31.0).' },
      { field: 'status', title: 'Status', type: 'select', width: 90, options: ['Active', 'Inactive'] },
    ],
    save: (r, reason) => api('/sites/bulk', { method: 'POST', body: { rows: r, reason } }), afterSave: () => sites(main) });
  if (!cur) return;
  const ls = await import('./labsetup.js');
  ls.mediaCard(main.querySelector('#media'), cur, () => sites(main, cur.id)).catch((e) => toast(e.message, 'err'));
  ls.productNameCard(main.querySelector('#pname'), sysAdmin).catch((e) => toast(e.message, 'err'));
  const hol = await api(`/sites/${cur.id}/holidays`);
  editableGrid({ el: main.querySelector('#hg'), rows: hol, allowAdd: true, what: `holidays for ${cur.site_code}`, newRow: () => ({ status: 'Active' }),
    columns: [
      { field: 'holiday_date', title: 'Date', type: 'date', width: 130, required: true, format: (v) => (v ? `${v} (${d8(v)})` : '') },
      { field: 'description', title: 'Holiday', width: 260, required: true },
      { field: 'status', title: 'Status', type: 'select', width: 90, options: ['Active', 'Inactive'] },
    ],
    save: (r, reason) => api(`/sites/${cur.id}/holidays/bulk`, { method: 'POST', body: { rows: r, reason } }), afterSave: () => sites(main, cur.id) });
}
