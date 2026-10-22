// Projects (client-specific quoted test packages), quote versions, analyte trimming, rush terms, printable quote
import { api, esc, pageHeader, toast, modal, state, money, badge, setDirtyCheck, confirmBox } from '../app.js';
import { Grid, fmt } from '../grid.js';
import { section, specDialog, pagedList } from './common.js';
import { testPicker, sendQuote, decide } from './quotes.js';
import { quoteChargesCard } from './charges.js';

export async function newProject(clientId) {
  const clients = await api('/clients');
  const v = await modal({ title: 'New project', okText: 'Create and start quote', fields: [
    { name: 'client_id', label: 'Client', type: 'select', required: true, value: clientId, options: clients.map((c) => ({ value: c.id, label: c.legal_name })) },
    { name: 'project_name', label: 'Project name', required: true, help: 'Usually one product or purpose, e.g. "Protein Powder Release Panel"' },
    { name: 'purpose', label: 'Purpose' },
    { name: 'available_to_child_clients', label: 'Sharing', type: 'checkbox', cbLabel: 'Child clients (sites) may order under this project' },
    { name: 'is_list_price_acceptance', label: 'List price acceptance', type: 'checkbox', cbLabel: 'Client accepts catalogue list pricing (no discounts)' },
  ] });
  if (!v) return;
  try { const r = await api('/projects', { method: 'POST', body: { row: v } }); location.hash = '#/quote/' + r.version_id; } catch (e) { toast(e.message, 'err'); }
}

export async function list(main) {
  main.innerHTML = pageHeader('Projects', 'A project is a reusable, client-specific quoted list of tests for a product or a recurring testing bundle. Each re-quote is a new version; orders keep the terms of the version they used. One-off customer requests are Quotes.',
    '<button class="btn primary" id="new">+ New project</button> <a class="btn ghost" href="#/quotes">Quotes</a>', { kind: 'projects' }) + '<div id="g"></div>';
  // one page at a time from the server (0.35.0), newest first
  pagedList({ el: main.querySelector('#g'), url: '/projects', q: state.query.get('find') || '', filter: state.query.get('show') || 'all',
    filters: [['all', 'All'], ['open', 'Open'], ['accepted', 'Accepted'], ['closed', 'Closed']],
    placeholder: 'Search by code, project or client; type a project code and press Enter to open it',
    open: (r) => { location.hash = '#/projects/' + r.id; },
    render: (body, rows) => new Grid(body, {
    readOnly: true, rows, emptyText: 'No projects here.', onRowOpen: (r) => { location.hash = '#/quote/' + r.latest_version_id; },
    columns: [
      { field: 'project_code', title: 'Code', type: 'link', width: 100, href: (r) => '#/projects/' + r.id },
      { field: 'project_name', title: 'Project', type: 'readonly', width: 260 },
      { field: 'client_name', title: 'Client', type: 'link', width: 170, href: (r) => '#/clients/' + r.client_id },
      { field: 'latest_version', title: 'Version', type: 'link', width: 70, href: (r) => (r.latest_version_id ? '#/quote/' + r.latest_version_id : null) },
      { field: 'latest_status', title: 'Status', type: 'readonly', width: 150 },
      { field: 'line_count', title: 'Tests', type: 'readonly', width: 60 },
      { field: 'is_list_price_acceptance', title: 'List price only', type: 'readonly', width: 110, format: (v) => (v ? 'Yes' : '') },
      { field: 'available_to_child_clients', title: 'Shared to sites', type: 'readonly', width: 115, format: (v) => (v ? 'Yes' : '') },
      { field: 'latest_version_id', title: '', type: 'button', width: 110, label: 'Open quote', onClick: (r) => { location.hash = '#/quote/' + r.latest_version_id; } },
    ],
  }) });
  main.querySelector('#new').onclick = () => newProject();
}

export async function detail(main, id) {
  const d = await api('/projects/' + id);
  const p = d.project;
  main.innerHTML = pageHeader(p.project_name, `<a href="#/projects/${p.id}">${esc(p.project_code)}</a> · <a href="#/clients/${p.client_id}">${esc(p.client_name)}</a> ${p.is_list_price_acceptance ? badge('List price acceptance') : ''}`,
    '<a class="btn ghost" href="#/projects">All projects</a> <button class="btn" id="edit">Edit project</button> <button class="btn primary" id="nv">Start new version (re-quote)</button>', { kind: 'project', id }) + `
    <div class="card">${section('Versions', 'Re-pricing or changing tests creates a new version, copied from the latest. Accepting it supersedes the previous accepted version.')}<div id="g"></div></div>`;
  new Grid(main.querySelector('#g'), {
    readOnly: true, rows: d.versions, onRowOpen: (r) => { location.hash = '#/quote/' + r.id; },
    columns: [
      { field: 'version_no', title: 'Version', type: 'link', width: 110, compute: (r) => `${p.project_code} v${r.version_no}`, href: (r) => '#/quote/' + r.id },
      { field: 'status', title: 'Status', type: 'readonly', width: 150 },
      { field: 'total', title: 'Quote total', type: 'money', width: 120 },
      { field: 'quoted_at', title: 'Quoted', type: 'readonly', width: 160, format: (v) => (v ? new Date(v).toLocaleDateString() : '') },
      { field: 'valid_until', title: 'Valid until', type: 'readonly', width: 110 },
      { field: 'accepted_by', title: 'Accepted by', type: 'readonly', width: 150 },
      { field: 'accepted_at', title: 'Accepted', type: 'readonly', width: 120, format: (v) => (v ? new Date(v).toLocaleDateString() : '') },
    ],
  });
  main.querySelector('#nv').onclick = async () => {
    try { const r = await api(`/projects/${id}/versions`, { method: 'POST', body: {} }); location.hash = '#/quote/' + r.id; } catch (e) { toast(e.message, 'err'); }
  };
  main.querySelector('#edit').onclick = async () => {
    const v = await modal({ title: 'Edit project', fields: [
      { name: 'project_name', label: 'Project name', required: true, value: p.project_name }, { name: 'purpose', label: 'Purpose', value: p.purpose },
      { name: 'available_to_child_clients', label: 'Sharing', type: 'checkbox', value: p.available_to_child_clients, cbLabel: 'Child clients (sites) may order under this project' },
      { name: 'status', label: 'Status', type: 'select', blank: false, value: p.status, options: ['Active', 'Inactive'] }] });
    if (!v) return;
    try { await api('/projects/' + id, { method: 'PUT', body: { row: v } }); detail(main, id); } catch (e) { toast(e.message, 'err'); }
  };
}

const issueOf = (r) => (r.status === 'Removed' ? '' : r.final_price === null || r.final_price === undefined ? 'Missing final price'
  : r.final_price > r.list_price ? 'Above list price' : r.list_price > 0 && (r.list_price - r.final_price) / r.list_price >= 0.5 ? 'Discount 50% or more'
  : r.final_price === 0 ? 'Zero price' : '');

export async function version(main, vid) {
  const [d, pk] = await Promise.all([api('/versions/' + vid), api(`/versions/${vid}/packages`).catch(() => ({ rows: [], options: [], allowed: false }))]);
  if (d.version.kind === 'Stability') { location.replace('#/stability/quotes/' + d.version.project_id); return; }   // migration 032
  const v = d.version; const ed = v.editable; const lpa = v.is_list_price_acceptance;
  const actions = [];
  const isQuote = v.kind === 'Quote';
  const sendable = ['Draft', 'Submitted for Quote', 'Quoted'].includes(v.status) && !(v.status === 'Quoted' && v.valid_until && v.valid_until < new Date().toISOString().slice(0, 10));
  if (sendable) actions.push(`<button class="btn ${v.status === 'Quoted' && v.sent_at ? '' : 'primary'}" id="send">${v.sent_at ? 'Send again…' : 'Send to client…'}</button>`);
  if (isQuote && v.status === 'Quoted') actions.push('<button class="btn primary" id="qacc">Accept…</button>', '<button class="btn" id="qrej">Reject…</button>');
  if (isQuote && v.status === 'Draft') actions.push('<button class="btn" data-act="Quoted">Issue without sending</button>');
  else if (v.status === 'Draft') actions.push('<button class="btn" data-act="Submitted for Quote">Submit for quote</button>', '<button class="btn primary" data-act="Quoted">Issue quote</button>');
  if (v.status === 'Submitted for Quote') actions.push('<button class="btn primary" data-act="Quoted">Issue quote</button>', '<button class="btn" data-act="Rejected">Reject</button>');
  if (v.status === 'Quoted' && !isQuote) actions.push('<button class="btn primary" data-act="Accepted">Record client acceptance</button>', '<button class="btn" data-act="Rejected">Client rejected</button>');
  if (v.status === 'Quoted') actions.push('<button class="btn" data-act="Expired">Expire</button>');
  if (['Accepted', 'Superseded', 'Rejected', 'Expired'].includes(v.status)) actions.push('<button class="btn primary" id="nv">Start new version (re-quote)</button>');
  const pdfHref = `/api/quotes/versions/${vid}/pdf${['Draft', 'Submitted for Quote'].includes(v.status) || !v.sent_at ? '?fresh=1' : ''}`;
  main.innerHTML = pageHeader(isQuote ? `Quote ${v.project_code} · v${v.version_no}` : `${v.project_name} · v${v.version_no}`,
    `${isQuote ? `${esc(v.project_name)} · ` : `<a href="#/projects/${v.project_id}">${esc(v.project_code)}</a> · `}<a href="#/clients/${v.client_id}">${esc(v.client_name)}</a> ${badge(v.status)} ${lpa ? badge('List price acceptance') : ''} ${v.account_status !== 'Active' ? badge('Client ' + v.account_status) : ''}${v.latest_version_no > v.version_no ? ' ' + badge('Newer version exists') : ''}`,
    `${isQuote ? '<a class="btn ghost" href="#/quotes">All quotes</a> <button class="btn ghost" id="qedit">Details…</button>' : `<a class="btn ghost" href="#/projects/${v.project_id}">All versions</a>`} <a class="btn ghost" target="_blank" href="${pdfHref}">Quotation PDF</a> <a class="btn ghost" href="#/print/${vid}">Print</a> ${actions.join(' ')}`,
    { kind: isQuote ? 'quote' : 'version', id: isQuote ? v.project_id : vid }) + `
  <div class="card meta3">
    ${isQuote ? `<div><span>For</span><b>${esc((d.contacts.find((c) => c.id === v.quote_contact_id) || {}).name || '—')}</b></div><div><span>Prepared by</span><b>${esc(v.owner_name || '—')}</b></div>` : ''}
    <div><span>Quoting lab</span><b title="The lab this quote was made in: its own tests are in-house, other labs' tests are subcontracted">${esc(v.quote_site_code || 'Not recorded (made before 0.16.1)')}</b></div>
    <div><span>Valid until</span><b>${esc(v.valid_until || 'Set when issued')}</b></div>
    <div><span>Quoted</span><b>${v.quoted_at ? new Date(v.quoted_at).toLocaleDateString() + (v.quoted_by_name ? ' by ' + esc(v.quoted_by_name) : '') : '—'}</b></div>
    <div><span>${v.status === 'Rejected' ? 'Rejected' : 'Accepted by'}</span><b>${v.status === 'Rejected' ? esc((v.rejected_reason || 'No reason given') + (v.decided_via === 'Client link' ? ' (online)' : '')) : esc((v.accepted_by || '—') + (v.decided_via === 'Client link' && v.status === 'Accepted' ? ' (online)' : ''))}</b></div>
  </div>
  ${v.sent_at ? `<div class="qsent">Sent ${esc(new Date(v.sent_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))} to <b>${esc(v.sent_to_name || '')}</b> &lt;${esc(v.sent_to_email || '')}&gt;. The client accepts or declines through the link in the email${v.client_token ? `; you can also paste it in a chat or email yourself:<input readonly id="qlink" value="${esc(location.origin + '/quote-response.html?t=' + v.client_token)}">` : '.'}</div>` : ''}
  ${ed ? '' : `<div class="notice">This version is ${esc(v.status)} and locked. ${v.status === 'Accepted' ? 'Orders use these terms.' : ''} To change prices or tests, start a new version.</div>`}
  <div class="card">${section('Tests on this quote', lpa ? 'List price acceptance: final price always equals list price.' :
    'List price comes from the catalogue and cannot be typed over. Type the final price per sample, or the discount % (the final price follows); paste and fill down work in both. For analyte-priced tests, click the analyte button to remove analytes: the list price recalculates and the discount % is kept.',
    ed && !lpa ? '<button class="btn" id="pctall">Apply a discount % to every line…</button>' : '')}
    <div class="savebar" id="lsb"><span class="pending"></span><button class="btn ghost" id="lundo">Discard</button><button class="btn primary" id="lsave">Save lines</button></div>
    <div id="lg"></div></div>
  ${pk.rows.length || (ed && pk.allowed) ? `<div class="card">${section('Packages on this quote', 'A package is several tests at one price per sample, taken from the Test catalogue. Type over the package price to negotiate it; each test\'s share follows. On the order, cancelling one of its tests takes off only that test\'s share.')}
    <div class="savebar" id="psb"><span class="pending"></span><button class="btn ghost" id="pundo">Discard</button><button class="btn primary" id="psave">Save packages</button></div>
    <div id="pg"></div>
    ${ed && pk.allowed ? `<div class="pkadd"><select id="pkpick"><option value="">Add a package…</option>${pk.options.filter((o) => !pk.rows.some((r) => r.package_id === o.id)).map((o) => `<option value="${o.id}" ${o.errors ? 'disabled' : ''}>${esc(o.package_code)} ${esc(o.package_name)} · ${money(o.package_price)}${o.errors ? ' (has problems to fix in the catalogue)' : ''}</option>`).join('')}</select>
      <input id="pkqty" type="number" min="1" value="1" style="width:70px" title="Samples"> <button class="btn" id="pkadd">+ Add package</button></div>` : ''}</div>` : ''}
  <div class="card"><div class="totals" id="tot"></div></div>
  <div class="card" id="qchg" style="display:none"></div>
  ${ed ? `<div class="card">${section('Add tests', 'Switch between labs to quote tests from any of them on the same quote; each line shows the lab that does the work.',
    '<button class="btn" id="servline" title="Adds the lab\'s Serving weight or Density test at its catalogue price, so the client sees what results per serving cost">+ Per-serving calculation…</button>')}<div id="qpick"></div></div>` : ''}
  <div class="card">${section('Rush terms on this quote', 'Surcharges are copied from each rush schedule. Set a discount per tier: e.g. keep Same Day at full price, make a 5 Day rush free (100%). Example amounts use the first test on this quote with that schedule.')}
    <div class="savebar" id="rsb"><span class="pending"></span><button class="btn primary" id="rsave">Save rush terms</button></div><div id="rg"></div></div>`;

  // ---- lines
  const lg = new Grid(main.querySelector('#lg'), {
    rows: d.lines.map((l) => ({ ...l, id: l.line_id, status: 'Active' })), readOnly: !ed,
    rowClass: (r) => (r.status === 'Removed' ? 'mutedrow' : ''),
    onChange: () => { lineBar(); totals(); },
    columns: [
      { field: 'test_code', title: 'Code', type: 'link', width: 75, href: (r) => (r.test_id ? '#/catalog/' + r.test_id : null) },
      { field: 'test_name', title: 'Test', type: 'readonly', width: 210 },
      // another network lab's test is subcontracted (the 20-30 rule, migration 031)
      { field: 'lab', title: 'Lab', type: 'readonly', width: 150, compute: (r) => (r.is_subcontracted ? `${r.lab} (subcontracted)` : r.lab), cellClass: (r) => (r.is_subcontracted ? 'flag' : ''),
        help: 'The lab that does the test. Subcontracted: another Tentamus lab; its price is that lab\'s catalogue price less the in-network discount, plus this lab\'s markup.' },
      { field: 'analytes', title: 'Analytes', type: 'button', width: 95, label: (r) => (r.pricing_mode === 'Analyte Selection' ? `${r.analytes_included} of ${r.analytes_total}` : '—'),
        onClick: (r) => { if (r.pricing_mode === 'Analyte Selection') analyteDialog(r, ed, () => version(main, vid)); } },
      { field: 'quantity', title: 'Qty', type: 'int', min: 1, width: 60 },
      { field: 'list_price', title: 'List', type: 'money', width: 95, compute: (r) => r.list_price },
      { field: 'final_price', title: 'Final price', type: 'money', min: 0, width: 105, editable: () => !lpa },
      { field: 'd_amt', title: 'Discount $', type: 'money', width: 95, compute: (r) => (r.final_price === null || r.final_price === undefined ? null : r.list_price - r.final_price) },
      // 0.36.0 (Cecilia): a discount typed as a percentage sets the final price (to the cent)
      { field: 'd_pct', title: 'Discount %', type: 'pct', width: 90, compute: (r) => (r.final_price === null || r.final_price === undefined || !r.list_price ? null : (r.list_price - r.final_price) / r.list_price * 100),
        assign: (r, v) => { r.final_price = Math.round(Number(r.list_price || 0) * (1 - Number(v) / 100) * 100) / 100; }, editable: () => !lpa,
        help: 'Type a discount % to set the final price, or type the final price and the % follows' },
      { field: 'total', title: 'Line total', type: 'money', width: 105, compute: (r) => (r.final_price === null || r.final_price === undefined ? null : r.final_price * (r.quantity || 0)) },
      { field: 'tat', title: 'Std TAT', type: 'readonly', width: 90, compute: (r) => `${r.standard_tat} ${r.tat_unit === 'Business Days' ? 'bus.' : 'cal.'} days` },
      { field: 'rush_schedule', title: 'Rush schedule', type: 'readonly', width: 120 },
      { field: 'issue', title: 'Check', type: 'readonly', width: 150, compute: issueOf, cellClass: (r) => (issueOf(r) ? 'flag' : '') },
      { field: 'special_instructions', title: 'Instructions', width: 160 },
      // the trash button takes a line off the quote (Alex: easier than choosing Removed); kept in the audit trail
      { field: 'trash', title: '', type: 'button', width: 44, help: 'Remove this test from the quote', label: (r) => (ed && r.line_id ? '🗑' : ''), onClick: (r) => removeLine(r) },
      { field: 'specs', title: 'Specs', type: 'button', width: 95, label: (r) => (Number(r.spec_count) ? `${r.spec_count} limit${Number(r.spec_count) === 1 ? '' : 's'}` : 'Unspecified'),
        help: 'Specification limits for this quoted test; they are copied to every test ordered from this quote. Unspecified: results are reported as they are.',
        onClick: (r) => { if (r.line_id) specDialog({ quoted_line: r.line_id }, () => version(main, vid)); } },
      { field: 'cost_price', title: 'In-network cost', type: 'money', width: 110, compute: (r) => (r.is_subcontracted ? r.cost_price : null),
        help: 'Subcontracted tests only: what the other lab charges (its catalogue price less the in-network discount). Internal: not on the quotation.' },
    ],
  });
  // serving size, Part B (033): the per-serving calculation as a priced line on the quote
  const sl = main.querySelector('#servline');
  if (sl) sl.onclick = async () => {
    const v = await modal({ title: 'Per-serving calculation', okText: 'Add to the quote',
      intro: 'Results per serving need the serving measured: the Serving weight test (units weighed and averaged) for tablets, capsules, powders; the Density test for liquids served by volume. The line is priced from the catalogue; type over the final price to discount it.',
      fields: [{ name: 'role', label: 'Measurement', type: 'select', blank: false, value: 'Serving weight', options: [{ value: 'Serving weight', label: 'Serving weight (solids)' }, { value: 'Density', label: 'Density (liquids)' }] },
        { name: 'quantity', label: 'Quantity (samples)', type: 'number', value: 1 }] });
    if (!v) return;
    try { await api(`/versions/${vid}/serving-line`, { method: 'POST', body: v }); toast(`${v.role} test added to the quote.`); version(main, vid); } catch (e) { toast(e.message, 'err'); }
  };
  async function removeLine(r) {
    if (!ed || !r.line_id) return;
    if (lg.changeCount() > 0) { toast('Save or discard your other changes to the lines first.', 'err'); return; }
    if (!(await confirmBox('Remove the test', `Remove ${esc(r.test_code)} ${esc(r.test_name)} from this quote?`, 'Remove'))) return;
    try { await api(`/versions/${vid}/lines`, { method: 'POST', body: { rows: [{ id: r.line_id, status: 'Removed' }] } }); toast(`${r.test_name} removed.`); version(main, vid); } catch (e) { toast(e.message, 'err'); }
  }
  const lsb = main.querySelector('#lsb');
  function lineBar() { const n = lg.changeCount(); lsb.classList.toggle('show', n > 0); lsb.querySelector('.pending').textContent = `${n} line${n === 1 ? '' : 's'} changed (not saved)`; }
  // ---- packages (P-1, migration 047)
  const pkRows = pk.rows.map((r) => ({ ...r, tests_text: r.tests.map((t) => t.test_name + (t.pricing_mode === 'Analyte Selection' ? ` (${t.analytes_included} of ${t.analytes_total})` : '') + ': ' + money(t.final_price)).join('; ') }));
  const pg = main.querySelector('#pg') ? new Grid(main.querySelector('#pg'), {
    rows: pkRows, readOnly: !ed, emptyText: 'No packages on this quote.',
    onChange: () => { pkBar(); totals(); },
    columns: [
      { field: 'package_code', title: 'Package', type: 'link', width: 90, href: (r) => '#/catalog/packages/' + r.package_id },
      { field: 'package_name', title: 'Name', type: 'readonly', width: 190 },
      { field: 'tests_text', title: 'Tests and their shares', type: 'readonly', width: 360 },
      { field: 'quantity', title: 'Qty', type: 'int', min: 1, width: 60 },
      { field: 'list_price', title: 'Tests at list', type: 'money', width: 100, editable: () => false },
      { field: 'package_price', title: 'Package price', type: 'money', min: 0, width: 110 },
      { field: 'd_pct', title: 'Discount %', type: 'pct', width: 90, compute: (r) => (r.list_price ? (r.list_price - (r.package_price || 0)) / r.list_price * 100 : null),
        assign: (r, v) => { r.package_price = Math.round(Number(r.list_price || 0) * (1 - Number(v) / 100) * 100) / 100; }, help: 'Type a discount % to set the package price' },
      { field: 'total', title: 'Total', type: 'money', width: 105, compute: (r) => (r.package_price || 0) * (r.quantity || 0) },
      { field: 'specs', title: 'Specs', type: 'button', width: 120, label: (r) => `${r.tests.reduce((n, t) => n + Number(t.spec_count || 0), 0)} limits…`,
        help: 'Specification limits for the package\'s tests', onClick: (r) => pkSpecs(r) },
      { field: 'trash', title: '', type: 'button', width: 44, help: 'Remove this package from the quote', label: () => (ed ? '🗑' : ''), onClick: (r) => pkRemove(r) },
    ],
  }) : null;
  const psb = main.querySelector('#psb');
  function pkBar() { if (!pg) return; const n = pg.changeCount(); psb.classList.toggle('show', n > 0); psb.querySelector('.pending').textContent = `${n} package${n === 1 ? '' : 's'} changed (not saved)`; }
  async function pkSpecs(r) {
    if (r.tests.length === 1) return specDialog({ quoted_line: r.tests[0].line_id }, () => version(main, vid));
    const v = await modal({ title: 'Specifications', okText: 'Open', fields: [{ name: 'line', label: 'Test', type: 'select', blank: false, options: r.tests.map((t) => ({ value: t.line_id, label: `${t.test_name} (${Number(t.spec_count) || 'no'} limits)` })) }] });
    if (v) specDialog({ quoted_line: v.line }, () => version(main, vid));
  }
  async function pkRemove(r) {
    if (!ed) return;
    if (!(await confirmBox('Remove the package', `Remove ${esc(r.package_code)} ${esc(r.package_name)} and its ${r.tests.length} tests from this quote?`, 'Remove'))) return;
    try { await api(`/quoted-packages/${r.id}/remove`, { method: 'POST', body: {} }); toast(`${r.package_name} removed.`); version(main, vid); } catch (e) { toast(e.message, 'err'); }
  }
  if (pg) {
    main.querySelector('#pundo').onclick = () => version(main, vid);
    main.querySelector('#psave').onclick = async () => {
      if (pg.hasErrors()) { toast('Fix the cells marked in red first.', 'err'); return; }
      const ids = new Set(pg.getChanges().map((x) => x.id));
      try {
        for (const r of pg.rows.filter((x) => ids.has(x.id))) await api(`/quoted-packages/${r.id}`, { method: 'PUT', body: { package_price: r.package_price, quantity: r.quantity } });
        setDirtyCheck(null); toast('Packages saved.'); version(main, vid);
      } catch (e) { toast(e.message, 'err'); }
    };
  }
  const pka = main.querySelector('#pkadd');
  if (pka) pka.onclick = async () => {
    const id = main.querySelector('#pkpick').value;
    if (!id) { toast('Choose a package first.', 'err'); return; }
    try { await api(`/versions/${vid}/packages`, { method: 'POST', body: { package_id: id, quantity: Number(main.querySelector('#pkqty').value) || 1 } }); toast('Package added.'); version(main, vid); } catch (e) { toast(e.message, 'err'); }
  };
  function totals() {
    const act = lg.rows.filter((r) => r.status !== 'Removed');
    const pks = pg ? pg.rows : [];
    const list = act.reduce((s, r) => s + r.list_price * (r.quantity || 0), 0) + pks.reduce((s, r) => s + Number(r.list_price || 0) * (r.quantity || 0), 0);
    const fin = act.reduce((s, r) => s + (r.final_price || 0) * (r.quantity || 0), 0) + pks.reduce((s, r) => s + Number(r.package_price || 0) * (r.quantity || 0), 0);
    main.querySelector('#tot').innerHTML = `<span>List value <b>${money(list)}</b></span><span>Discount <b>${money(list - fin)}</b> (${list ? ((list - fin) / list * 100).toFixed(2) : '0.00'}%)</span><span class="big">Quote total <b>${money(fin)}</b></span>`;
  }
  totals();
  quoteChargesCard(main.querySelector('#qchg'), vid).catch(() => {});   // 0.36.0: kits, shipping, fees, discounts at this client's price
  setDirtyCheck(() => lg.changeCount() > 0 || rg.changeCount() > 0 || (pg && pg.changeCount() > 0));
  main.querySelector('#lundo').onclick = () => version(main, vid);
  // 0.36.0: one discount % for every line still on the quote (then check and Save lines)
  const pa = main.querySelector('#pctall');
  if (pa) pa.onclick = async () => {
    const v = await modal({ title: 'Discount every line', okText: 'Apply', intro: 'Sets each line\'s final price to its list price less this percentage (rounded to the cent). Nothing is saved until you click Save lines.',
      fields: [{ name: 'pct', label: 'Discount %', type: 'number', required: true }] });
    if (!v) return;
    const pct = Number(v.pct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) { toast('Give a discount between 0 and 100 %.', 'err'); return; }
    lg.rows.forEach((r) => { if (r.status !== 'Removed') r.final_price = Math.round(Number(r.list_price || 0) * (1 - pct / 100) * 100) / 100; });
    lg.render(); lineBar(); totals();
    toast(`${pct} % applied to every line: check, then Save lines.`);
  };
  main.querySelector('#lsave').onclick = async () => {
    if (lg.hasErrors()) { toast('Fix the cells marked in red first.', 'err'); return; }
    const rows = lg.getChanges().map((r) => { const o = { ...r }; delete o.d_amt; delete o.d_pct; delete o.total; return o; });
    try { await api(`/versions/${vid}/lines`, { method: 'POST', body: { rows } }); setDirtyCheck(null); toast('Lines saved.'); version(main, vid); } catch (e) { toast(e.message, 'err'); }
  };
  const qp = main.querySelector('#qpick');
  if (qp) testPicker(qp, vid, new Set(d.lines.map((l) => l.test_code)), () => version(main, vid), { prefill: isQuote && !lpa }).catch((e) => toast(e.message, 'err'));

  // ---- rush terms
  const example = (r) => { const line = d.lines.find((l) => l.rush_schedule === r.schedule_name && l.final_price !== null); return line; };
  const rg = new Grid(main.querySelector('#rg'), {
    rows: d.rush, readOnly: !ed, emptyText: 'No rush schedules on the tests in this quote.',
    onChange: () => { const n = rg.changeCount(); const b = main.querySelector('#rsb'); b.classList.toggle('show', n > 0); b.querySelector('.pending').textContent = `${n} tier${n === 1 ? '' : 's'} changed`; },
    columns: [
      { field: 'schedule_name', title: 'Schedule', type: 'readonly', width: 140 },
      { field: 'tier_name', title: 'Tier', type: 'readonly', width: 160 },
      { field: 'rush_tat', title: 'Rush TAT', type: 'readonly', width: 120, format: (v, r) => `${v} ${r.tat_unit === 'Business Days' ? 'business' : 'calendar'} days` },
      { field: 'surcharge_value', title: 'Surcharge', type: 'readonly', width: 100, format: (v, r) => (r.surcharge_type === 'Flat' ? money(v) : v + '% of price') },
      { field: 'discount_pct', title: 'Quote discount', type: 'pct', min: 0, max: 100, width: 115 },
      { field: 'eff', title: 'Client pays', type: 'readonly', width: 150, compute: (r) => (r.surcharge_type === 'Flat' ? money(r.surcharge_value * (1 - (r.discount_pct || 0) / 100)) + ' per test'
        : (r.surcharge_value * (1 - (r.discount_pct || 0) / 100)).toFixed(1) + '% of price') },
      { field: 'ex', title: 'Example', type: 'readonly', width: 260, compute: (r) => { const l = example(r); if (!l) return '';
        const fee = r.surcharge_type === 'Flat' ? r.surcharge_value : l.final_price * r.surcharge_value / 100;
        const net = fee * (1 - (r.discount_pct || 0) / 100);
        return `${l.test_name.slice(0, 22)}: ${money(fee)} − ${money(fee - net)} = ${money(net)}`; } },
    ],
  });
  main.querySelector('#rsave').onclick = async () => {
    if (rg.hasErrors()) { toast('Discount must be between 0 and 100%.', 'err'); return; }
    try { await api(`/versions/${vid}/rush-terms`, { method: 'POST', body: { rows: rg.getChanges() } }); setDirtyCheck(null); toast('Rush terms saved.'); version(main, vid); } catch (e) { toast(e.message, 'err'); }
  };

  // ---- lifecycle actions
  main.querySelectorAll('[data-act]').forEach((b) => b.onclick = async () => {
    if (lg.changeCount() || rg.changeCount()) { toast('Save or discard your changes first.', 'err'); return; }
    const status = b.dataset.act; const body = { status };
    if (status === 'Quoted') {
      const def = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
      const r = await modal({ title: 'Issue quote', okText: 'Issue', intro: 'Issuing locks the prices, analytes and rush terms on this version. List prices and rush surcharges are frozen as they are now.',
        fields: [{ name: 'valid_until', label: 'Valid until', type: 'date', value: def }] });
      if (!r) return; body.valid_until = r.valid_until || null;
    } else if (status === 'Accepted') {
      const r = await modal({ title: 'Record client acceptance', okText: 'Accept quote', intro: 'Acceptance must come from an active contact of this client. Once accepted, the client can order these tests at these prices; a previously accepted version is superseded.',
        fields: [{ name: 'accepted_by_contact_id', label: 'Accepted by', type: 'select', required: true, options: d.contacts.map((c) => ({ value: c.id, label: `${c.name} (${(c.roles || []).join(', ')})` })) }] });
      if (!r) return; body.accepted_by_contact_id = r.accepted_by_contact_id;
    } else if (!(await confirmBox(status, `Mark this version as ${status}?`))) return;
    try { await api(`/versions/${vid}/status`, { method: 'POST', body }); toast('Version is now ' + status + '.'); version(main, vid); } catch (e) { toast(e.message, 'err'); }
  });
  // ---- quotes: send, accept, reject, details
  const sb = main.querySelector('#send');
  if (sb) sb.onclick = () => { if (lg.changeCount() || rg.changeCount()) { toast('Save or discard your changes first.', 'err'); return; } sendQuote({ ...v, id: vid }, d.contacts, () => version(main, vid)); };
  const qr = { version_id: vid, client_id: v.client_id, quote_contact_id: v.quote_contact_id, sent_to_contact_id: v.sent_to_contact_id, project_code: v.project_code };
  const qa = main.querySelector('#qacc'); if (qa) qa.onclick = () => decide(qr, 'Accepted', () => version(main, vid));
  const qj = main.querySelector('#qrej'); if (qj) qj.onclick = () => decide(qr, 'Rejected', () => version(main, vid));
  const qe = main.querySelector('#qedit');
  if (qe) qe.onclick = async () => {
    const people = await api('/quotes/people').catch(() => []);
    const r = await modal({ title: `${v.project_code} details`, fields: [{ name: 'project_name', label: 'Reference', value: v.project_name, required: true },
      { name: 'quote_contact_id', label: 'For (contact)', type: 'select', value: v.quote_contact_id || '', options: d.contacts.map((c) => ({ value: c.id, label: c.name })) },
      { name: 'owner_id', label: 'Prepared by', type: 'select', blank: false, value: v.owner_id, options: people.map((p) => ({ value: p.id, label: p.full_name })), help: 'Hand the quote to another sales person: it moves to their "My open quotes".' }] });
    if (!r) return;
    try { await api('/quotes/' + v.project_id, { method: 'PUT', body: r }); toast('Saved.'); version(main, vid); } catch (e) { toast(e.message, 'err'); }
  };
  const nv = main.querySelector('#nv');
  if (nv) nv.onclick = async () => { try { const r = await api(`/projects/${v.project_id}/versions`, { method: 'POST', body: {} }); location.hash = '#/quote/' + r.id; } catch (e) { toast(e.message, 'err'); } };
}

// Analyte selection for one analyte-priced line, with a live preview of the new price
async function analyteDialog(line, editable, done) {
  const rows = await api(`/lines/${line.line_id}/analytes`);
  const sumIncl = rows.filter((r) => r.included).reduce((s, r) => s + r.analyte_price, 0);
  const basePrep = line.list_price - sumIncl;
  const m = document.createElement('div'); m.className = 'modal-bg';
  m.innerHTML = `<div class="modal wide"><h3>Analytes on ${esc(line.test_name)}</h3>
    <p class="intro">Untick analytes the client does not need. The list price recalculates and the negotiated discount (${line.discount_pct ?? 0}%) is kept. Select a block of cells and press Space to tick or untick them all, or use Ctrl+D.</p>
    <div id="ag"></div><div class="preview" id="pv"></div>
    <div class="mbtns"><button class="btn ghost" data-x>Cancel</button>${editable ? '<button class="btn primary" data-ok>Apply</button>' : ''}</div></div>`;
  document.body.appendChild(m);
  const g = new Grid(m.querySelector('#ag'), {
    rows, readOnly: !editable, onChange: preview,
    columns: [
      { field: 'included', title: 'Included', type: 'bool', width: 80 },
      { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 200 },
      { field: 'report_name', title: 'Report name', type: 'readonly', width: 180 },
      { field: 'analyte_price', title: 'Price', type: 'money', width: 90 },
    ],
  });
  function preview() {
    const inc = g.rows.filter((r) => r.included);
    const newList = basePrep + inc.reduce((s, r) => s + r.analyte_price, 0);
    const newFinal = line.final_price === null ? null : (line.list_price ? newList * line.final_price / line.list_price : line.final_price);
    m.querySelector('#pv').innerHTML = `<span>${inc.length} of ${g.rows.length} analytes</span><span>List ${money(line.list_price)} → <b>${money(newList)}</b></span>
      <span>Final ${line.final_price === null ? 'not set' : money(line.final_price) + ' → <b>' + money(newFinal) + '</b>'}</span><span>Difference <b>${line.final_price === null ? money(newList - line.list_price) : money(newFinal - line.final_price)}</b> per sample</span>`;
  }
  preview();
  const close = () => { g.destroy(); m.remove(); };
  m.querySelector('[data-x]').onclick = close;
  const ok = m.querySelector('[data-ok]');
  if (ok) ok.onclick = async () => {
    const changes = g.getChanges();
    if (!changes.length) { close(); return; }
    if (!g.rows.some((r) => r.included)) { toast('At least one analyte must stay included.', 'err'); return; }
    try { await api(`/lines/${line.line_id}/analytes`, { method: 'POST', body: { rows: changes } }); close(); toast('Analytes updated; price recalculated.'); done(); } catch (e) { toast(e.message, 'err'); }
  };
}

// Printable quote (client-facing)
export async function print(main, vid) {
  const [d, pk] = await Promise.all([api('/versions/' + vid), api(`/versions/${vid}/packages`).catch(() => ({ rows: [] }))]);
  const v = d.version; const lines = d.lines; const pks = pk.rows || [];
  const total = lines.reduce((s, l) => s + (l.line_total || 0), 0) + pks.reduce((s, p) => s + Number(p.package_price) * p.quantity, 0);
  const listTotal = lines.reduce((s, l) => s + l.list_price * l.quantity, 0) + pks.reduce((s, p) => s + Number(p.list_price) * p.quantity, 0);
  const scheds = [...new Set(d.rush.map((r) => r.schedule_name))];
  main.innerHTML = `<div class="noprint printbar"><a class="btn ghost" href="#/quote/${vid}">Back to quote</a> <button class="btn primary" id="qprint">Print or save as PDF</button>
    ${['Draft', 'Submitted for Quote'].includes(v.status) ? '<span class="help">Draft: prices are not final until the quote is issued.</span>' : ''}</div>
  <div class="quote">
    <div class="qhead"><div><div class="qlogo">Tentamus North America</div><div class="help">Laboratory testing services · LIMS3 Sandbox (demo)</div></div>
      <div class="qmeta"><h1>Quotation</h1><div>${esc(v.project_code)} · version ${v.version_no}</div><div>Status: ${esc(v.status)}</div>
      <div>Issued: ${v.quoted_at ? new Date(v.quoted_at).toLocaleDateString() : 'Not yet issued'}</div><div>Valid until: ${esc(v.valid_until || '—')}</div></div></div>
    <div class="qto"><b>Prepared for</b><div>${esc(v.client_legal_name)}</div><div>${esc(v.billing_address || '')}</div>
      <div class="qproj"><b>Project:</b> ${esc(v.project_name)}${v.purpose ? ' · ' + esc(v.purpose) : ''}</div></div>
    <table class="qt"><thead><tr><th>Test</th><th class="num">Qty</th><th class="num">List price</th><th class="num">Your price</th><th class="num">Discount</th><th class="num">Line total</th><th>Standard TAT</th><th>Rush schedule</th></tr></thead>
    <tbody>${pks.map((p) => `<tr><td><b>Package: ${esc(p.package_name)}</b><div class="help">${p.tests.map((t) => esc(t.test_name)).join(', ')}</div></td>
      <td class="num">${p.quantity}</td><td class="num">${money(p.list_price)}</td><td class="num">${money(p.package_price)}</td>
      <td class="num">${money(p.list_price - p.package_price)}</td><td class="num">${money(p.package_price * p.quantity)}</td><td></td><td></td></tr>`).join('')}${lines.map((l) => `<tr><td><b>${esc(l.test_name)}</b>${l.pricing_mode === 'Analyte Selection' ? `<div class="help">${l.analytes_included} of ${l.analytes_total} analytes</div>` : ''}${l.special_instructions ? `<div class="help">${esc(l.special_instructions)}</div>` : ''}</td>
      <td class="num">${l.quantity}</td><td class="num">${money(l.list_price)}</td><td class="num">${money(l.final_price)}</td>
      <td class="num">${l.final_price === null ? '' : money(l.discount_amount) + '<div class="help">' + fmt.pct(l.discount_pct) + '</div>'}</td>
      <td class="num">${money(l.line_total)}</td><td>${l.standard_tat} ${l.tat_unit === 'Business Days' ? 'business' : 'calendar'} days</td><td>${esc(l.rush_schedule || '—')}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="5" class="num">List value ${money(listTotal)} · You save ${money(listTotal - total)}</td><td class="num"><b>${money(total)}</b></td><td colspan="2"></td></tr></tfoot></table>
    ${scheds.length ? `<h2>Rush options</h2><p class="help">Standard TAT is the maximum. Rush tiers below are available for the tests listed with that schedule; the surcharge applies to your price for each test.</p>
    ${scheds.map((s) => `<table class="qt small"><thead><tr><th colspan="5">${esc(s)}</th></tr><tr><th>Tier</th><th>Turnaround</th><th class="num">Surcharge</th><th class="num">Your rush discount</th><th class="num">You pay</th></tr></thead><tbody>
      ${d.rush.filter((r) => r.schedule_name === s).map((r) => `<tr><td>${esc(r.tier_name)}</td><td>${r.rush_tat} ${r.tat_unit === 'Business Days' ? 'business' : 'calendar'} days</td>
      <td class="num">${r.surcharge_type === 'Flat' ? money(r.surcharge_value) : r.surcharge_value + '% of price'}</td><td class="num">${Number(r.discount_pct) ? Number(r.discount_pct) + '%' : '—'}</td>
      <td class="num">${r.surcharge_type === 'Flat' ? money(r.surcharge_value * (1 - r.discount_pct / 100)) : (r.surcharge_value * (1 - r.discount_pct / 100)).toFixed(1) + '% of price'}</td></tr>`).join('')}</tbody></table>`).join('')}` : ''}
    <div class="qterms"><b>Terms.</b> Prices are per sample in USD. Testing may only be ordered against an accepted quotation. Turnaround starts on the day samples are logged (Day 0); samples logged after a test's cutoff time start the next working day.</div>
  </div>`;
  main.querySelector('#qprint').addEventListener('click', () => window.print());
}
