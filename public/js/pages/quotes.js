// Quotes (migration 029): standalone quotes for customers, alongside project quotes. The list (My open quotes / All
// quotes, filters, Accept and Reject on each quoted row), a new quote, sending a quote to the client (PDF and email
// with an accept/decline link), and the lab-tab test picker used on the quote page (projects.js version()).
import { api, esc, pageHeader, toast, modal, state, money, badge, can } from '../app.js';
import { Grid } from '../grid.js';
import { pagedList } from './common.js';

const css = document.createElement('style');
css.textContent = `
.qfil { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 0 0 10px; }
.qfil .chips { display: flex; gap: 6px; flex-wrap: wrap; }
.qfil .chips button { border: 1px solid var(--line); background: #fff; border-radius: 14px; padding: 4px 11px; cursor: pointer; font: inherit; font-size: 12.5px; }
.qfil .chips button.on { background: var(--green-700); color: #fff; border-color: var(--green-700); }
.qfil select { padding: 5px 8px; border: 1px solid var(--line); border-radius: 6px; font: inherit; }
.qfil .n { color: var(--muted); font-size: 12.5px; margin-left: auto; }
.qpick .tabs { margin-bottom: 8px; } .qpick .row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
.qpick .row input[type=search] { flex: 1; min-width: 220px; padding: 6px 9px; border: 1px solid var(--line); border-radius: 6px; font: inherit; }
.qpick .row input[type=number] { width: 70px; padding: 6px; border: 1px solid var(--line); border-radius: 6px; font: inherit; }
.qsent { background: var(--green-50); border: 1px solid #cfe5d8; border-radius: 8px; padding: 8px 12px; margin: 0 0 12px; font-size: 13px; }
.qsent input { width: 100%; font: 12.5px ui-monospace, Menlo, Consolas, monospace; padding: 4px 6px; margin-top: 4px; border: 1px solid var(--line); border-radius: 5px; }
`;
document.head.appendChild(css);

const d8 = (v) => { if (!v) return ''; const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/); return (m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(v)).toLocaleDateString([], { dateStyle: 'medium' }); };
const OPEN = ['Draft', 'Submitted for Quote', 'Quoted'];
const view = { tab: 'mine', status: 'open', type: 'all', lab: '', owner: '' };   // kept while the page is reloaded

// ---------------------------------------------------------------- the list
export async function list(main) {
  const q = state.query;
  if (q.get('tab')) view.tab = q.get('tab') === 'all' ? 'all' : 'mine';
  const mine = view.tab === 'mine';
  const d = await api('/quotes?page=1&size=1' + (mine ? '' : '&tab=all'));
  main.innerHTML = pageHeader('Quotes', 'Every quote and project quote, newest first, 50 at a time. A standalone quote is for one customer request; a project is a reusable package of tests for a product. Accept or reject a quote here when the client answers by phone or email; answers through the link in the quote email are recorded by themselves.',
    `${d.can_edit ? '<button class="btn primary" id="new">+ New quote</button>' : ''} <a class="btn ghost" href="#/projects">Projects</a>`, { kind: 'quotes' })
    + `<div class="tabs"><a class="tab ${mine ? 'on' : ''}" href="#/quotes?tab=mine" id="tmine">My open quotes</a><a class="tab ${mine ? '' : 'on'}" href="#/quotes?tab=all" id="tall">All quotes</a></div>
    <div class="qfil">
      <label>Type <select id="ty"><option value="all">Quotes and projects</option><option value="Quote">Quotes only</option><option value="Project">Projects only</option><option value="Stability">Stability quotes only</option></select></label>
      <label>Lab <select id="lab"><option value="">All labs</option>${d.labs.map((l) => `<option value="${l.id}">${esc(l.site_code)}</option>`).join('')}</select></label>
      ${mine ? '' : `<label>Prepared by <select id="own"><option value="">Anyone</option>${(d.owners || []).map((o) => `<option value="${o.id}">${esc(o.name || '')}</option>`).join('')}</select></label>`}
      </div><div class="card"><div id="g"></div></div>`;
  const $ = (s) => main.querySelector(s);
  $('#ty').value = view.type; $('#lab').value = view.lab; if ($('#own')) $('#own').value = view.owner;
  const params = () => ({ ...(mine ? {} : { tab: 'all' }), ...(view.type !== 'all' ? { ty: view.type } : {}), ...(view.lab ? { lab: view.lab } : {}), ...(!mine && view.owner ? { own: view.owner } : {}) });
  const canDecide = (r) => d.can_edit && r.status === 'Quoted' && !r.past_valid;
  // one page at a time from the server (0.35.0); the status chips are its tabs
  const lst = pagedList({
    el: $('#g'), url: '/quotes', params: params(), q: q.get('find') || '',
    filter: mine ? 'open' : (q.get('show') || view.status),
    filters: mine ? [] : [['open', 'Open'], ['waiting', 'Waiting for the client'], ['Accepted', 'Accepted'], ['Rejected', 'Rejected'], ['expired', 'Expired'], ['all', 'All']],
    placeholder: 'Search by quote, reference, client or person; type or scan a quote number and press Enter',
    open: (r) => { location.hash = r.kind === 'Stability' ? '#/stability/quotes/' + r.project_id : '#/quote/' + r.version_id; },
    render: (body, rows) => new Grid(body, { readOnly: true, rows, keyField: 'version_id',
      emptyText: mine ? 'You have no open quotes. "+ New quote" starts one.' : 'No quotes match.',
      rowClass: (r) => (r.past_valid ? 'tbnc' : ['Rejected', 'Expired', 'Superseded'].includes(r.status) ? 'mutedrow' : ''),
      columns: [
        { field: 'project_code', title: 'Quote', type: 'link', width: 100, compute: (r) => `${r.project_code}${r.version_no > 1 ? ' v' + r.version_no : ''}`, href: (r) => (r.kind === 'Stability' ? '#/stability/quotes/' + r.project_id : '#/quote/' + r.version_id) },
        { field: 'client_name', title: 'Client', type: 'link', width: 150, href: (r) => '#/clients/' + r.client_id },
        { field: 'project_name', title: 'Reference', type: 'readonly', width: 200 },
        { field: 'total', title: 'Total', type: 'money', width: 95 },
        { field: 'status', title: 'Status', type: 'readonly', width: 120, compute: (r) => (r.past_valid ? 'Past valid date' : r.status === 'Submitted for Quote' ? 'Submitted' : r.status),
          cellClass: (r) => ({ Accepted: 'tbpass', Rejected: 'tbfail' }[r.status] || (r.past_valid ? 'tbfail' : r.status === 'Quoted' ? 'tbwait' : '')) },
        { field: 'acc', title: '', type: 'button', width: 76, label: (r) => (canDecide(r) ? 'Accept…' : ''), onClick: (r) => canDecide(r) && decide(r, 'Accepted', () => lst.reload()) },
        { field: 'rej', title: '', type: 'button', width: 72, label: (r) => (canDecide(r) ? 'Reject…' : ''), onClick: (r) => canDecide(r) && decide(r, 'Rejected', () => lst.reload()) },
        { field: 'owner_name', title: 'Prepared by', type: 'readonly', width: 150 },
        { field: 'quote_contact_name', title: 'For', type: 'readonly', width: 120, compute: (r) => r.quote_contact_name || r.sent_to_name || '' },
        { field: 'labs', title: 'Labs', type: 'readonly', width: 90 },
        { field: 'sent', title: 'Sent', type: 'readonly', width: 130, compute: (r) => (r.sent_at ? d8(r.sent_at) : r.quoted_at ? 'Issued, not sent' : '') },
        { field: 'valid_until', title: 'Valid until', type: 'readonly', width: 100, format: d8 },
        { field: 'decision', title: 'Decision', type: 'readonly', width: 220, compute: (r) => (r.status === 'Accepted' ? `By ${r.accepted_by_name || ''}${r.decided_via === 'Client link' ? ' (online)' : ''}`
          : r.status === 'Rejected' ? `${r.decided_via === 'Client link' ? 'Online' : ''}${r.rejected_reason ? (r.decided_via === 'Client link' ? ': ' : '') + r.rejected_reason : ''}` : '') },
        { field: 'kind', title: 'Type', type: 'readonly', width: 70 },
        { field: 'line_count', title: 'Tests', type: 'readonly', width: 55 },
      ] }),
  });
  const refilter = () => { if (!mine) view.status = lst.state.f; lst.setParams(params()); };
  $('#ty').onchange = () => { view.type = $('#ty').value; refilter(); };
  $('#lab').onchange = () => { view.lab = $('#lab').value; refilter(); };
  if ($('#own')) $('#own').onchange = () => { view.owner = $('#own').value; refilter(); };
  const nb = $('#new'); if (nb) nb.onclick = () => newQuote();
}

// ---------------------------------------------------------------- accept / reject (list and quote page)
// r: { version_id, client_id, quote_contact_id, project_code }
export async function decide(r, decision, done) {
  if (decision === 'Accepted') {
    const cl = await api('/clients/' + r.client_id);
    const people = cl.contacts.filter((x) => x.status === 'Active' && x.contact_status === 'Active');
    const v = await modal({ title: `Accept ${r.project_code}`, okText: 'Record acceptance',
      intro: 'Record that the client accepted this quote (by phone, email or purchase order). The client can then order these tests at these prices; an earlier accepted version is superseded.',
      fields: [{ name: 'contact_id', label: 'Accepted by', type: 'select', required: true, value: r.sent_to_contact_id || r.quote_contact_id || '', options: people.map((x) => ({ value: x.contact_id, label: x.contact_name })) },
        { name: 'note', label: 'How (optional)', help: 'For example "PO 4471 received" or "by phone".' }] });
    if (!v) return;
    try { await api(`/quotes/versions/${r.version_id}/decide`, { method: 'POST', body: { decision, contact_id: v.contact_id, note: v.note } }); toast(`${r.project_code} accepted.`); done(); } catch (e) { toast(e.message, 'err'); }
  } else {
    const v = await modal({ title: `Reject ${r.project_code}`, okText: 'Record rejection', intro: 'Record that the client turned this quote down. The reason helps the sales team (price, turnaround, scope, went elsewhere).',
      fields: [{ name: 'note', label: 'Why', type: 'textarea', required: true }] });
    if (!v) return;
    try { await api(`/quotes/versions/${r.version_id}/decide`, { method: 'POST', body: { decision, note: v.note } }); toast(`${r.project_code} rejected.`); done(); } catch (e) { toast(e.message, 'err'); }
  }
}

// ---------------------------------------------------------------- a new quote
export async function newQuote(clientId) {
  const clients = await api('/clients');
  const v = await modal({ title: 'New quote', okText: 'Next', intro: 'A quote for one customer request. For a product the client will test again and again, make a project instead.',
    fields: [{ name: 'client_id', label: 'Client', type: 'select', required: true, value: clientId || '', options: clients.filter((c) => c.status !== 'Inactive').map((c) => ({ value: c.id, label: c.legal_name })) },
      { name: 'project_name', label: 'Reference (optional)', help: 'What the client asked for, e.g. "Collagen powder, 3 lots". Leave blank for "Quote for <client>".' }] });
  if (!v) return;
  const cl = await api('/clients/' + v.client_id);
  const people = cl.contacts.filter((x) => x.status === 'Active' && x.contact_status === 'Active');
  let contact = '';
  if (people.length) {
    const w = await modal({ title: 'Who is the quote for?', okText: 'Create quote', fields: [{ name: 'quote_contact_id', label: 'Contact', type: 'select', value: people[0].contact_id,
      options: people.map((x) => ({ value: x.contact_id, label: `${x.contact_name}${x.email ? ' <' + x.email + '>' : ''}` })) }] });
    if (!w) return; contact = w.quote_contact_id;
  }
  try { const r = await api('/quotes', { method: 'POST', body: { ...v, quote_contact_id: contact } }); toast(`${r.project_code} started: add the tests.`); location.hash = '#/quote/' + r.version_id; } catch (e) { toast(e.message, 'err'); }
}

// ---------------------------------------------------------------- send to the client
export async function sendQuote(v, contacts, done) {
  const issued = v.status === 'Quoted';
  const def = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const people = contacts.filter((c) => c.email);
  if (!people.length) { toast('None of this client\'s contacts has an email address: add one on the client first.', 'err'); return; }
  const r = await modal({ title: `Send ${v.project_code} to the client`, okText: issued ? 'Send' : 'Issue and send',
    intro: `${issued ? '' : 'Sending issues the quote: its prices, analytes and rush terms are locked. '}The client gets the quotation as a PDF and a link to accept or decline it online. In the Sandbox the email goes to the Outbox.`,
    fields: [{ name: 'contact_id', label: 'To', type: 'select', required: true, value: v.sent_to_contact_id || v.quote_contact_id || people[0].id, options: people.map((c) => ({ value: c.id, label: `${c.name} <${c.email}>` })) },
      ...(issued ? [] : [{ name: 'valid_until', label: 'Valid until', type: 'date', value: def }]),
      { name: 'message', label: 'Message (optional)', type: 'textarea', help: 'Added to the email, e.g. what you agreed on the phone.' }] });
  if (!r) return;
  try {
    const out = await api(`/quotes/versions/${v.id}/send`, { method: 'POST', body: r });
    toast('Quote sent: the email is in the Outbox.');
    done(out);
  } catch (e) { toast(e.message, 'err'); }
}

// ---------------------------------------------------------------- the test picker with lab tabs (quote page)
const pick = { lab: null, find: '', qty: 1 };
export async function testPicker(host, vid, have, onAdded, { prefill = false } = {}) {
  const cat = await api('/quotes/catalog?v=' + vid);   // each test at the client's price on this quote (031)
  const labs = [...new Map(cat.filter((t) => t.site_id).map((t) => [t.site_id, t.site_code])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const cur = state.site && labs.some(([id]) => id === state.site) ? state.site : labs[0]?.[0] || 'all';
  if (pick.lab === null) pick.lab = cur;
  const render = () => {
    const rows = cat.filter((t) => !have.has(t.test_code) && (pick.lab === 'all' || t.site_id === pick.lab)
      && (!pick.find || (t.test_name + ' ' + t.test_code).toLowerCase().includes(pick.find.toLowerCase())));
    host.innerHTML = `<div class="qpick"><div class="tabs">${labs.map(([id, code]) => `<button class="tab ${pick.lab === id ? 'on' : ''}" data-lab="${id}">${esc(code)} <small>${cat.filter((t) => t.site_id === id).length}</small></button>`).join('')}
        <button class="tab ${pick.lab === 'all' ? 'on' : ''}" data-lab="all">All labs</button></div>
      <div class="row"><input type="search" id="qfind" placeholder="Find a test (name or code)" value="${esc(pick.find)}"><label>Quantity <input type="number" id="qqty" min="1" value="${pick.qty}"></label>
        <button class="btn primary" id="qaddsel">Add selected</button></div>
      <div class="help" style="margin-bottom:6px">Each lab's own tests. Another lab's test is <b>subcontracted</b>: its price less the in-network discount, plus your lab's markup (the 20-30 rule, lab settings). Click "+ Add", or select several rows (Shift or Ctrl+click) and "Add selected".${prefill ? ' New lines start at the list price: type over the final price to give a discount.' : ''}</div><div id="qcat"></div></div>`;
    const g = new Grid(host.querySelector('#qcat'), { readOnly: true, rows, keyField: 'test_id', emptyText: 'No more tests in this lab\'s catalogue.',
      columns: [
        { field: 'add', title: '', type: 'button', width: 70, label: () => '+ Add', onClick: (t) => add([t]) },
        { field: 'site_code', title: 'Lab', type: 'readonly', width: 150, compute: (t) => (t.subcontracted ? `${t.site_code} (subcontracted)` : t.site_code || ''), cellClass: (t) => (t.subcontracted ? 'flag' : '') },
        { field: 'test_code', title: 'Code', type: 'readonly', width: 75 },
        { field: 'test_name', title: 'Test', type: 'readonly', width: 300 },
        { field: 'pricing_mode', title: 'Pricing', type: 'readonly', width: 140 },
        { field: 'list_price', title: 'List price', type: 'money', width: 95, help: 'The client\'s list price on this quote (a subcontracted test\'s includes the 20-30 rule)' },
        { field: 'catalogue_price', title: 'Catalogue', type: 'money', width: 90, help: 'The performing lab\'s catalogue price' },
        { field: 'tat', title: 'Std TAT', type: 'readonly', width: 100, compute: (t) => `${t.standard_tat} ${t.tat_unit === 'Business Days' ? 'bus.' : 'cal.'} days` },
        { field: 'rush_schedule', title: 'Rush schedule', type: 'readonly', width: 120 },
        { field: 'orderable', title: 'Note', type: 'readonly', width: 170, compute: (t) => (t.orderable ? '' : 'No approved workflow yet') },
      ] });
    host.querySelectorAll('[data-lab]').forEach((b) => { b.onclick = () => { pick.lab = b.dataset.lab; render(); }; });
    const f = host.querySelector('#qfind');
    f.oninput = () => { pick.find = f.value; const pos = f.selectionStart; render(); const f2 = host.querySelector('#qfind'); f2.focus(); f2.setSelectionRange(pos, pos); };
    host.querySelector('#qqty').onchange = (e) => { pick.qty = Math.max(1, Number(e.target.value) || 1); };
    host.querySelector('#qaddsel').onclick = () => { const sel = g.selectedRows(); if (!sel.length) { toast('Select the tests to add first.', 'err'); return; } add(sel); };
  };
  async function add(tests) {
    try {
      await api(`/versions/${vid}/lines`, { method: 'POST', body: { rows: tests.map((t) => ({ test_id: t.test_id, quantity: pick.qty })), prefill } });
      toast(`${tests.length} test${tests.length === 1 ? '' : 's'} added.`); onAdded();
    } catch (e) { toast(e.message, 'err'); }
  }
  render();
}

export const canQuote = () => can('quotes.edit');
export { badge, money };

// #/quotes/<quote id> (links from the audit trail): open its latest version
export async function open(main, id) {
  const d = await api('/projects/' + id);
  if (d.project && d.project.kind === 'Stability') { location.replace('#/stability/quotes/' + id); return; }
  const v = d.versions[0];
  if (!v) { main.innerHTML = '<div class="card">This quote has no version.</div>'; return; }
  location.replace('#/quote/' + v.id);
}
