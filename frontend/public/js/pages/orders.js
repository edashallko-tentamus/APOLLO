// Lab orders: create, samples grid with each sample's tests underneath (analytes, rush, TAT override),
// apply projects, logging; and the sample page
import { api, esc, pageHeader, toast, modal, state, money, badge, askReason, setDirtyCheck, confirmBox, link, currentSite, signDialog } from '../app.js';
import { Grid } from '../grid.js';
import { section, specDialog, pagedList } from './common.js';
import { printLabels } from '../labels.js';
import { orderBillingCard } from './billing.js';
import { custodyCard, receiveDialog, openPhotoDialog, photosCard } from './custody.js';
import { testPicker } from './picker.js';
import { orderChargesCard } from './charges.js';
import { contextMenu } from './testing.js';

const CONDITIONS = ['Acceptable', 'Damaged', 'Temperature excursion', 'Short shipped', 'Leaking', 'Other'];
const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '');
const d8 = (v) => (v ? new Date(v + 'T12:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : '');
const unit = (u) => (u === 'Business Days' ? 'bus.' : 'cal.');
const hasVal = (v) => v !== null && v !== undefined;

export async function list(main) {
  const site = currentSite();
  main.innerHTML = pageHeader('Lab orders', `Orders for ${esc(site ? site.site_code : 'your lab')}. The samples a client orders at one time; tests can only come from the client's accepted quotes. Newest first, 50 at a time; scan or type an order, PO or sample ID and press Enter to open it.`,
    '<button class="btn primary" id="new">+ New lab order</button>', { kind: 'orders' }) + '<div id="g"></div>';
  main.querySelector('#new').onclick = () => newOrder();
  // one page at a time from the server (0.35.0)
  pagedList({
    el: main.querySelector('#g'), url: '/orders', q: state.query.get('find') || '',
    filters: [['current', 'Current'], ['finished', 'Reported'], ['all', 'All']],
    placeholder: 'Search by order, client, PO or contact; scan or type an order, PO or sample ID and press Enter',
    open: (r) => { location.hash = r.sample_id ? '#/samples/' + r.sample_id : '#/orders/' + r.id; },
    render: (body, rows) => new Grid(body, {
      readOnly: true, rows, onRowOpen: (r) => { location.hash = '#/orders/' + r.id; }, emptyText: 'No orders here.',
      rowClass: (r) => (r.account_status === 'On Hold' ? 'warnrow' : ''),
      columns: [
        { field: 'order_code', title: 'Order', type: 'link', width: 100, href: (r) => '#/orders/' + r.id },
        { field: 'client_name', title: 'Client', type: 'link', width: 190, href: (r) => '#/clients/' + r.client_id },
        { field: 'status', title: 'Status', type: 'readonly', width: 95 },
        { field: 'submission_channel', title: 'Channel', type: 'readonly', width: 80 },
        { field: 'po_number', title: 'PO', type: 'readonly', width: 100 },
        { field: 'logged_count', title: 'Samples logged', type: 'readonly', width: 115, format: (v, r) => `${v} of ${r.sample_count}` },
        { field: 'due_date', title: 'Due', type: 'readonly', width: 110, format: d8 },
        { field: 'rush_pending', title: 'Rush', type: 'readonly', width: 140, format: (v, r) => [v ? `${v} awaiting approval` : '', r.rush_active ? `${r.rush_active} active` : ''].filter(Boolean).join(' · ') },
        { field: 'order_value', title: 'Value', type: 'money', width: 100 },
        { field: 'account_status', title: 'Client', type: 'readonly', width: 85, format: (v) => (v === 'Active' ? '' : v) },
      ],
    }),
  });
}

export async function newOrder(clientId) {
  const site = currentSite();
  if (!site) { toast('You are not assigned to a lab, so you cannot create orders. Ask an administrator.', 'err'); return; }
  const clients = await api('/clients');
  const a = await modal({ title: 'New lab order', okText: 'Next', intro: `Testing lab: <b>${esc(site.site_code)}</b> (${esc(site.site_name)}). To order for another lab, switch lab at the top right first.`, fields: [
    { name: 'client_id', label: 'Client', type: 'select', required: true, value: clientId,
      options: clients.filter((c) => c.account_status !== 'Inactive').map((c) => ({ value: c.id, label: c.legal_name + (c.account_status === 'On Hold' ? ' (On Hold: reports will be held)' : '') })) },
  ] });
  if (!a) return;
  const setup = await api('/order-setup/' + a.client_id);
  if (!setup.contacts.length) { toast('This client has no contact with the Ordering role. Add one on the client page first.', 'err'); return; }
  if (!Number(setup.orderableCount)) toast('Note: this client has no accepted quote yet, so no tests can be added until it is quoted or accepts list price.', 'err');
  const b = await modal({ title: 'New lab order: details', okText: 'Create order', fields: [
    { name: 'ordering_contact_id', label: 'Ordering contact', type: 'select', required: true, blank: false, options: setup.contacts.map((c) => ({ value: c.id, label: c.name })) },
    { name: 'submission_channel', label: 'Submission channel', type: 'select', blank: false, value: 'Walk-in', options: state.meta.enums.submission_channel || ['Online', 'Walk-in', 'Paper', 'Phone'] },
    { name: 'po_number', label: 'Purchase order number' }, { name: 'notes', label: 'Notes', type: 'textarea' }] });
  if (!b) return;
  try { const r = await api('/orders', { method: 'POST', body: { row: { ...a, ...b } } }); location.hash = '#/orders/' + r.id; } catch (e) { toast(e.message, 'err'); }
}

const hiddenTests = new Map(); // order id -> sample ids whose tests are hidden (tests show by default)
export async function detail(main, id) {
  const d = await api('/orders/' + id);
  const o = d.order;
  // the client's license the order names (0.32.0, migration 055)
  const licText = (l) => (!l ? '—' : `${l.license_type} ${l.license_number}${l.expires_on ? `, expires ${d8(l.expires_on)}` : ''}${l.state === 'Expired' ? ' (EXPIRED)' : l.state === 'Expiring soon' ? ' (expiring soon)' : l.state === 'Retired' ? ' (retired)' : ''}`);
  const curLic = (d.licenses || []).find((l) => l.id === o.client_license_id);
  const projects = [...new Map(d.orderable.map((l) => [l.project_id, l])).values()];
  const expected = d.samples.filter((s) => s.status === 'Expected');
  // the chain of custody (0.29.0): receiving signs it; a lab may require that
  const cus = await api(`/orders/${id}/custody`).catch(() => null);
  if (!hiddenTests.has(id)) hiddenTests.set(id, new Set());
  const hidden = hiddenTests.get(id);
  main.innerHTML = pageHeader(`Lab order ${o.order_code}`,
    `${link('#/clients/' + o.client_id, `${o.client_code} ${o.client_name}`)} · ${esc(o.site_code)} · ${esc(o.submission_channel)} ${badge(o.status)} ${o.is_gmp_client ? badge('GMP') : ''}`,
    `<a class="btn ghost" href="#/orders">All orders</a> ${o.status === 'Draft' ? '<button class="btn" id="submit">Submit order</button>' : ''}
     <button class="btn" id="edit">Edit order</button> <button class="btn" id="labels" ${d.samples.some((s) => s.sample_code) ? '' : 'disabled title="Labels print once samples are logged (they need their sample ID)"'}>Print labels</button>
     <button class="btn primary" id="receive" ${expected.length ? '' : 'disabled'} title="Log the ticked samples and sign the chain of custody (Received by)">Receive and sign (${expected.length})</button>
     ${cus && cus.required ? '' : `<button class="btn ghost" id="log" ${expected.length ? '' : 'disabled'} title="Log without a signed receipt on the chain of custody">Log samples without signing (${expected.length})</button>`}`,
    { kind: 'order', id }) + `
  ${o.account_status === 'On Hold' ? '<div class="notice"><b>Client is On Hold.</b> Samples can be logged and tested, but reports cannot be released until the hold is lifted.</div>' : ''}
  <div class="card meta3 wide">
    <div><span>Ordering contact</span><b>${link('#/contacts?find=' + encodeURIComponent(o.ordering_contact_code), o.ordering_contact)}</b></div><div><span>PO</span><b>${esc(o.po_number || '—')}</b></div><div><span>Client license</span><b class="${curLic && curLic.state === 'Expired' ? 'bad' : ''}">${esc(licText(curLic))}</b></div>
    <div><span>Samples logged</span><b>${o.logged_count} of ${o.sample_count}</b></div><div><span>Order due</span><b>${d8(o.due_date) || '—'}</b></div>
    <div><span>Order value</span><b>${money(o.order_value)}</b></div><div><span>Rush</span><b>${o.rush_pending ? o.rush_pending + ' awaiting approval' : o.rush_active ? o.rush_active + ' active' : 'None'}</b></div>
  </div>
  <div class="card">${section('Samples and tests', 'Add rows, paste from Excel, fill down with Ctrl+D. Several bottles or bags can be one sample (Containers). Each sample\'s tests are listed under it (▾ shows or hides them). Logging assigns the sample ID and starts the clock (Day 0).',
    `<button class="btn" id="applyP" ${projects.length ? '' : 'disabled'}>Apply project to ticked samples</button> <button class="btn" id="addT">Add tests to ticked samples…</button>
     ${(d.packages || []).length ? '<button class="btn" id="addPk">Add a package to ticked samples</button>' : ''}
     <button class="btn" id="rushAll">Rush the whole order</button> <button class="btn ghost" id="cancelS" title="Cancel the ticked samples and their tests (kept, greyed; a reason is asked)">Cancel ticked samples…</button> <button class="btn ghost" id="toggleAll"></button>`)}
    ${(d.elsewhere || []).length ? `<p class="help" id="subc">Quoted tests that belong to another lab are subcontracted from ${esc(o.site_code)} and cannot be ordered here yet: ${esc(d.elsewhere.map((x) => `${x.test_name} (${x.site_code})`).join(', '))}. Order them at that lab.</p>` : ''}
    <div class="savebar" id="tsb"><span class="pending"></span><button class="btn ghost" id="tundo">Discard test changes</button><button class="btn primary" id="tsave">Save tests</button></div>
    <div id="sg"></div></div>
  ${d.attachments && d.attachments.length ? `<div class="card">${section('Attachments', 'Submission forms, chains of custody and other files (added from a sample\'s page).')}<ul>${d.attachments.map((a) => `<li><a href="/api/attachments/${a.id}/file?s=${encodeURIComponent(state.site || '')}" target="_blank" rel="noopener">${esc(a.label || a.file_name)}</a> <span class="help">${esc(a.kind)}${a.sample_id ? '' : ', whole order'}</span></li>`).join('')}</ul></div>` : ''}
  <div class="card" id="ochg" style="display:none"></div>
  <div class="card" id="ocus"></div>
  <div class="card" id="obill" style="display:none"></div>
  <div class="card" id="ocoas" style="display:none">${section('Certificates of Analysis', 'Every COA issued for this order\'s samples, newest version first (the report ID is the sample ID followed by R and the version).')}<div id="ocg"></div></div>
  ${d.emails.length ? `<div class="card">${section('Emails sent for this order', 'Sandbox: stored in the Outbox, not actually sent.')}<div id="eg"></div></div>` : ''}`;
  custodyCard(main.querySelector('#ocus'), id, { data: cus, onChange: () => detail(main, id) }).catch(() => {});
  // miscellaneous charges (0.36.0): kits, shipping, fees, discounts; billed at once
  orderChargesCard(main.querySelector('#ochg'), id, { samples: d.samples }).catch(() => {});
  // the order's billing (I-1, migration 036): shown to people who see invoicing
  orderBillingCard(main.querySelector('#obill'), id).catch(() => {});
  // the order's COAs (Alex, 2026-10-14)
  api(`/orders/${id}/coas`).then((x) => {
    if (!x.rows.length) return;
    main.querySelector('#ocoas').style.display = '';
    new Grid(main.querySelector('#ocg'), { readOnly: true, rows: x.rows, rowClass: (v) => (v.latest ? '' : 'mutedrow'), columns: [
      { field: 'report_id', title: 'Report', type: 'link', width: 170, onClick: (v) => window.open(`/api/reports/coa/${v.id}/pdf?s=${encodeURIComponent(state.site || '')}`, '_blank') },
      { field: 'version_no', title: 'Version', type: 'readonly', width: 70 },
      { field: 'is_final', title: 'Final', type: 'readonly', width: 60, format: (v) => (v ? 'Yes' : '') },
      { field: 'latest', title: 'Current', type: 'readonly', width: 70, format: (v) => (v ? 'Yes' : 'Replaced') },
      { field: 'sample_code', title: 'Sample', type: 'link', width: 125, href: (v) => '#/samples/' + v.sample_id },
      { field: 'client_sample_id', title: 'Client sample ID', type: 'readonly', width: 130 },
      { field: 'issued_at', title: 'Issued', type: 'readonly', width: 150, format: dt },
      { field: 'issued_by_name', title: 'Finalized by', type: 'readonly', width: 150 },
      { field: 'verify_code', title: 'Verification code', type: 'link', width: 150, onClick: (v) => window.open(`/verify.html?c=${v.verify_code}`, '_blank') }] });
  }).catch(() => {});

  // ---- each sample's tests (a grid in the sample's detail row)
  const tierLabel = (t) => `${t.tier_name} (${t.rush_tat} ${unit(t.tat_unit)} days)`;
  const tierOpts = (r) => [{ value: null, label: 'Standard' }, ...d.tiers.filter((t) => r && t.schedule_id === r.test_rush_schedule_id).map((t) => ({ value: t.id, label: tierLabel(t) }))];
  const testColumns = [
    { field: 'test_name', title: 'Test', type: 'link', width: 200, href: (r) => '#/catalog/' + r.test_id },
    { field: 'quote', title: 'Quote', type: 'link', width: 100, compute: (r) => (r.project_code ? `${r.project_code} v${r.project_version_no}` : r.media_lot_id ? 'Lot QA testing' : r.serving_order ? 'Catalogue price' : r.catalogue_order ? 'List price' : ''),
      href: (r) => (r.project_version_id ? '#/quote/' + r.project_version_id : r.media_lot_id ? '#/inventory/lots/' + r.media_lot_id : null), help: 'The accepted quote version this test is priced from; List price: not on the client\'s quote (0.36.0)' },
    { field: 'analytes', title: 'Analytes', type: 'button', width: 85, label: (r) => (r.pricing_mode === 'Analyte Selection' ? `${r.analytes_included} of ${r.analytes_total}` : '—'),
      onClick: (r) => { if (r.pricing_mode === 'Analyte Selection') analyteDialog(r, () => detail(main, id)); } },
    { field: 'list_price', title: 'List', type: 'money', width: 85 },
    { field: 'price', title: 'Price', type: 'money', width: 85 },
    { field: 'rush_tier_id', title: 'Rush tier', type: 'select', width: 190, editable: (r) => r.status !== 'Cancelled' && !!r.test_rush_schedule_id, options: tierOpts,
      help: 'Pick a rush tier: type to search, or press Enter and use the arrow keys. Rush status, fee, TAT and due date follow from it.',
      format: (v, r) => { if (!r.test_rush_schedule_id) return 'No rush for this test'; const t = tierOpts(r).find((x) => x.value === (v ?? null)); return t ? t.label : ''; } },
    { field: 'rush_status', title: 'Rush status', type: 'readonly', width: 125, help: 'Set automatically from the rush tier: Auto-accepted, or Pending Approval until intake approves or declines it',
      format: (v) => (v === 'None' ? '' : v), cellClass: (r) => (r.rush_status === 'Pending Approval' ? 'flag' : '') },
    { field: 'rush_fee', title: 'Rush fee', type: 'money', width: 80 },
    { field: 'tat_override', title: 'TAT', type: 'int', min: 0, width: 125, editable: (r) => r.status !== 'Cancelled', editValue: (r) => r.tat_override ?? r.tat_days,
      help: 'Calculated from the standard or rush turnaround. Type a number of days to override it (needs a Reason for Change; the price does not change). Press Delete to go back to the calculated TAT.',
      format: (v, r) => (hasVal(v) ? `${v} ${unit(r.tat_unit)} days ✎` : hasVal(r._origOverride) ? 'Calculated (on save)' : hasVal(r.tat_days) ? `${r.tat_days} ${unit(r.tat_unit)} days` : ''),
      cellClass: (r) => (hasVal(r.tat_override) ? 'override' : '') },
    { field: 'day0', title: 'Day 0', type: 'readonly', width: 100, format: d8 },
    { field: 'due_date', title: 'Due', type: 'readonly', width: 100, format: d8 },
    { field: 'status', title: 'Status', type: 'select', width: 95, options: ['Ordered', 'In Pool', 'Cancelled'], editable: (r) => r.status !== 'Cancelled',
      validate: (v, r) => (v !== 'Cancelled' && v !== (d.tests.find((x) => x.id === r.id) || {}).status ? 'You can only change a test to Cancelled' : null) },
    { field: 'special_instructions', title: 'Instructions', width: 150 },
    { field: 'specs', title: 'Specs', type: 'button', width: 95, label: (r) => (Number(r.spec_count) ? `${r.spec_count} limit${Number(r.spec_count) === 1 ? '' : 's'}` : 'Unspecified'),
      help: 'Specification limits for this test (copied from the quote; can be set here). Unspecified: results are reported as they are.', onClick: (r) => specDialog({ requested_test: r.id }, () => detail(main, id)) },
    // packages (P-1, migration 047): the test's price is its share of the package price
    { field: 'package', title: 'Package', type: 'readonly', width: 200, compute: (r) => (r.ordered_package_id ? `${r.package_code} ${r.package_name}${r.package_status && r.package_status !== 'Intact' ? ' (' + r.package_status.toLowerCase() + ')' : ''}` : ''),
      help: 'The package this test was ordered in. Its price is its share of the package price; cancelling it takes off only that share.' },
    // cancelling (0.34.0, migration 057): kept, greyed, with a reason; refused once the test has results or is in a batch
    { field: '_cancel', title: '', type: 'button', width: 80, label: (r) => (r.id && r.status !== 'Cancelled' ? 'Cancel…' : ''),
      help: 'Cancel this test (it stays on the order, greyed). Not possible once it has results or is in a batch.', onClick: (r) => { if (r.id && r.status !== 'Cancelled') cancelItems({ tests: [r] }); } },
  ];
  const testsBySample = new Map();
  d.tests.forEach((t) => { if (!testsBySample.has(t.sample_id)) testsBySample.set(t.sample_id, []); testsBySample.get(t.sample_id).push({ ...t, _origOverride: t.tat_override }); });
  const testGrids = [];
  function testPanel(s, el) {
    el.innerHTML = `<div class="dtool"><span class="dtitle">Tests on ${esc(s.sample_code || s.client_sample_id || 'this sample')}</span>
      <button class="mini" data-addt>+ Add tests</button> <button class="mini" data-applyp ${projects.length ? '' : 'disabled'}>+ Apply a project</button>${(d.packages || []).length ? ' <button class="mini" data-addpk>+ Add a package</button>' : ''}</div><div class="stests"></div>`;   // not "dgrid": the dashboards' layout style uses that name
    const g = new Grid(el.querySelector('.stests'), { rows: testsBySample.get(s.id) || [], emptyText: 'No tests yet: add a test or apply a project.', onChange: tBar,
      rowClass: (r) => (r.status === 'Cancelled' ? 'mutedrow' : r.rush_status === 'Pending Approval' ? 'warnrow' : ''), columns: testColumns });
    testGrids.push(g);
    // right-click a selection of tests: cancel them
    el.querySelector('.stests').addEventListener('contextmenu', (e) => {
      if (!e.target.closest('td')) return;
      const sel = g.selectedRows().filter((r) => r.id && r.status !== 'Cancelled');
      if (!sel.length) return;
      e.preventDefault();
      contextMenu(e.clientX, e.clientY, [[`Cancel ${sel.length === 1 ? sel[0].test_name : sel.length + ' selected tests'}…`, () => cancelItems({ tests: sel })]]);
    });
    el.querySelector('[data-addt]').onclick = () => addTest([s.id]);
    el.querySelector('[data-applyp]').onclick = () => applyProject([s.id]);
    const pkb = el.querySelector('[data-addpk]'); if (pkb) pkb.onclick = () => addPackage([s.id]);
  }
  const tsb = main.querySelector('#tsb');
  const testChanges = () => testGrids.reduce((n, g) => n + g.changeCount(), 0);
  function tBar() {
    const n = testChanges(); const e = testGrids.reduce((x, g) => x + g.errors.size, 0);
    tsb.classList.toggle('show', n > 0 || e > 0);
    tsb.querySelector('.pending').innerHTML = `${n} test${n === 1 ? '' : 's'} changed${e ? ' · <b class="bad">fix red cells</b>' : ''}`;
  }

  // ---- samples
  const matrixOpts = () => d.matrices.map((m) => ({ value: m, label: m }));
  // older samples may hold a matrix typed before the list existed, or one since set Inactive
  const matrixText = (v) => (!v ? '' : d.matrices.find((m) => m.toLowerCase() === String(v).toLowerCase()) || v + ' (not on the list)');
  const sRows = d.samples.map((s) => ({ ...s, _pick: s.status === 'Expected' }));
  // pick lists from the Units list (migration 031): by what they measure, or the serving units
  const unitOpts = (dims, serving = false) => (d.units || []).filter((u) => (serving ? u.is_serving_unit : dims.includes(u.dimension)))
    .map((u) => ({ value: u.unit_code, label: u.unit_code === u.unit_name ? u.unit_code : `${u.unit_code} (${u.unit_name})` }));
  const sg = new Grid(main.querySelector('#sg'), {
    rows: sRows, allowAdd: true, newRow: () => ({ status: 'Expected', number_of_units: 1, _pick: true }), emptyText: 'No samples yet: add rows or paste from Excel.',
    rowClass: (r) => (r.status === 'Cancelled' ? 'mutedrow' : ''),
    onChange: sBar,
    detail: { open: (r) => !!r.id && !hidden.has(r.id), key: (r) => r.id, render: testPanel },
    columns: [
      { field: '_open', title: 'Tests', type: 'button', width: 62, help: 'Show or hide this sample\'s tests',
        label: (r) => (r.id ? `${hidden.has(r.id) ? '▸' : '▾'} ${r.test_count ?? 0}` : ''), onClick: (r) => { if (!r.id) return; if (hidden.has(r.id)) hidden.delete(r.id); else hidden.add(r.id); sg.render(); toggleLabel(); } },
      { field: '_pick', title: '✓', type: 'bool', width: 36, help: 'Tick samples to apply a project, add a test or log them' },
      { field: 'sample_code', title: 'Sample ID', type: 'link', width: 125, href: (r) => (r.id ? '#/samples/' + r.id : null), format: (v) => v || 'Not logged' },
      { field: 'client_sample_id', title: 'Client sample ID', width: 130 },
      { field: 'description', title: 'Description', width: 190 },
      { field: 'matrix', title: 'Matrix', type: 'select', width: 130, options: matrixOpts, format: matrixText, help: 'From the controlled Matrix list (Admin > Matrices). Type to search.' },
      { field: 'compliance_category', title: 'Category', type: 'select', width: 150, options: () => (d.categories || []).map((m) => ({ value: m, label: m })), help: 'What the sample is, from the sample submission form (Admin > Matrices, Compliance categories). Type to search.' },
      { field: 'product', title: 'Product', width: 150 },
      { field: 'lot', title: 'Lot', width: 85 },
      { field: 'batch', title: 'Batch', width: 80 },
      // Alex (2026-10-14): "Unit" and "Units" side by side were confusing. Containers (how many bottles or bags make up
      // the sample) comes first; the amount received and its unit sit apart, with the serving after them (031)
      { field: 'number_of_units', title: 'Containers', type: 'int', min: 1, width: 90, help: 'How many bottles, bags or boxes make up this one sample (also the number of labels printed)' },
      { field: 'condition', title: 'Condition', type: 'select', options: CONDITIONS, width: 150 },
      { field: 'receipt_temperature', title: 'Temp °C', type: 'number', width: 75 },
      { field: 'preservation', title: 'Preservation', width: 110 },
      { field: 'quantity_received', title: 'Amount received', type: 'number', min: 0, width: 120, help: 'The total amount received, e.g. 500 (g): the retain is taken from it' },
      { field: 'quantity_unit', title: 'Amount unit', type: 'select', width: 100, options: () => unitOpts(['Mass', 'Volume', 'Count']), help: 'From the Units list (Admin > Units). Type to search.' },
      { field: 'serving_count', title: 'Serving', type: 'number', min: 0, width: 75, help: 'The serving as the label states it, e.g. 2 (capsules)' },
      { field: 'serving_count_unit', title: 'Serving unit', type: 'select', width: 105, options: () => unitOpts(null, true), help: 'A serving unit from the Units list: capsule, tablet, scoop, packet...' },
      { field: 'serving_size', title: 'Serving weight/vol', type: 'number', min: 0, width: 125, help: 'What one serving weighs or measures, e.g. 1.2 (g) for 2 capsules: results per serving and limits per serving use it' },
      { field: 'serving_unit', title: 'Weight/vol unit', type: 'select', width: 105, options: () => unitOpts(['Mass', 'Volume']), help: 'g, mg or mL...' },
      { field: 'servings_per_package', title: 'Servings / package', type: 'number', min: 0, width: 125, help: 'From the label: for limits per package (e.g. 10 mg per package)' },
      // serving size, Part B (033): ticking orders the Serving weight test (or the Density test for a serving by volume)
      { field: 'report_per_serving', title: 'Per serving', type: 'bool', width: 90,
        help: 'Results per serving: orders the Serving weight test (Density for a serving by volume) at its quoted or catalogue price; nothing per serving is released until it is measured and approved' },
      { field: 'due_date', title: 'Due', type: 'readonly', width: 100, format: d8 },
      { field: 'sample_value', title: 'Value', type: 'money', width: 90 },
      { field: 'status', title: 'Status', type: 'select', options: ['Expected', 'Logged', 'Cancelled'], width: 95, editable: (r, isNew) => !isNew && r.status === 'Expected' },
      // receipt photos (0.29.0), 4:3; a photo report layout prints the ones marked Report photo 1 and 2
      { field: 'photo_count', title: 'Photos', type: 'button', width: 90, label: (r) => (r.id ? (Number(r.photo_count) ? `${r.photo_count} photo${Number(r.photo_count) === 1 ? '' : 's'}` : 'Add…') : ''),
        help: 'Photos of the sample at receipt, cropped to 4:3. Open the sample page to mark which ones a photo report prints.', onClick: (r) => { if (r.id) openPhotoDialog(r, () => detail(main, id)); } },
      // cannabis samples (0.32.0, migration 055): the METRC package tag; optional, printed on the COA and the chain of custody
      { field: 'metrc_id', title: 'METRC ID', width: 230, help: 'Cannabis samples: the METRC package tag (24 letters and digits, starting 1A). Printed on the COA and the chain of custody.',
        validate: (v) => { const s = String(v ?? '').replace(/\s/g, '').toUpperCase(); return s && !/^1A[0-9A-Z]{22}$/.test(s) ? 'A METRC tag is 24 letters and digits, starting 1A' : null; } },
      { field: '_cancel', title: '', type: 'button', width: 80, label: (r) => (r.id && r.status !== 'Cancelled' ? 'Cancel…' : ''),
        help: 'Cancel this sample and its tests (kept, greyed). Not possible once a test has results or is in a batch.', onClick: (r) => { if (r.id && r.status !== 'Cancelled') cancelItems({ samples: [r] }); } },
    ],
  });
  // right-click a selection of samples: cancel them
  main.querySelector('#sg').addEventListener('contextmenu', (e) => {
    const td = e.target.closest('td'); if (!td || td.closest('.stests')) return;
    const sel = sg.selectedRows().filter((r) => r.id && r.status !== 'Cancelled');
    if (!sel.length) return;
    e.preventDefault();
    contextMenu(e.clientX, e.clientY, [[`Cancel ${sel.length === 1 ? (sel[0].sample_code || sel[0].client_sample_id || 'sample') : sel.length + ' selected samples'} and their tests…`, () => cancelItems({ samples: sel })]]);
  });
  const sbar = document.createElement('div'); sbar.className = 'savebar'; sbar.innerHTML = '<span class="pending"></span><button class="btn ghost">Discard</button><button class="btn primary">Save samples</button>';
  main.querySelector('#sg').before(sbar);
  const sampleChanges = () => sg.getChanges().filter((r) => Object.keys(r).some((k) => !['_pick', '_open', 'id'].includes(k)));
  function sBar() {
    const n = sampleChanges().length;
    sbar.classList.toggle('show', n > 0 || sg.errors.size > 0);
    sbar.querySelector('.pending').innerHTML = `${n} sample${n === 1 ? '' : 's'} changed${sg.errors.size ? ' · <b class="bad">fix red cells</b>' : ''}`;
  }
  const testsUnsaved = () => { if (testChanges()) { toast('Save or discard the test changes first.', 'err'); return true; } return false; };
  sbar.querySelectorAll('button')[0].onclick = () => detail(main, id);
  sbar.querySelectorAll('button')[1].onclick = async () => {
    if (sg.hasErrors()) { toast('Fix the cells marked in red first.', 'err'); return; }
    if (testsUnsaved()) return;
    const rows = sampleChanges().map((r) => { const x = { ...r }; ['_pick', '_open', 'sample_code', 'test_count', 'due_date', 'sample_value'].forEach((k) => delete x[k]); return x; })
      .filter((r) => Object.keys(r).some((k) => k !== 'id'));
    const touchesLogged = rows.some((r) => r.id && d.samples.find((s) => s.id === r.id)?.logged_at);
    let reason = '';
    if (touchesLogged) { reason = await askReason('logged samples on ' + o.order_code); if (!reason) return; }
    try { await api(`/orders/${id}/samples`, { method: 'POST', body: { rows, reason } }); setDirtyCheck(null); toast('Samples saved.'); detail(main, id); } catch (e) { toast(e.message, 'err'); }
  };
  const picked = () => sg.rows.filter((r) => r._pick && r.id);
  const unsaved = () => sg.rows.some((r, i) => sg.isNew[i] && r.client_sample_id) || sampleChanges().length > 0;
  setDirtyCheck(() => testChanges() > 0 || unsaved());

  // show / hide every sample's tests
  const tg = main.querySelector('#toggleAll');
  function toggleLabel() { tg.textContent = d.samples.some((s) => !hidden.has(s.id)) ? 'Hide all tests' : 'Show all tests'; tg.disabled = !d.samples.length; }
  toggleLabel();
  tg.onclick = () => { if (d.samples.some((s) => !hidden.has(s.id))) d.samples.forEach((s) => hidden.add(s.id)); else hidden.clear(); sg.render(); toggleLabel(); };

  // ---- save tests
  main.querySelector('#tundo').onclick = () => detail(main, id);
  main.querySelector('#tsave').onclick = async () => {
    if (testGrids.some((g) => g.hasErrors())) { toast('Fix the cells marked in red first (hover for the reason).', 'err'); return; }
    const rows = testGrids.flatMap((g) => g.getChanges()); if (!rows.length) return;
    const needReason = rows.some((r) => 'tat_override' in r || d.tests.find((x) => x.id === r.id)?.clock_start);
    // a test of a package: show what cancelling it takes off before saving (option B, Alex 2026-10-19)
    const pkCancels = rows.filter((r) => r.status === 'Cancelled' && (d.tests.find((x) => x.id === r.id) || {}).ordered_package_id);
    if (pkCancels.length) {
      try {
        const pv = (await Promise.all(pkCancels.map((r) => api(`/requested-tests/${r.id}/package-cancel`)))).filter(Boolean);
        if (pv.length && !(await confirmBox('Cancel tests in a package', `<ul>${pv.map((x) => `<li>${esc(x.sample_code)} ${esc(x.test_name)}: ${money(x.share)} comes off package ${esc(x.package_code)} ${esc(x.package_name)} (${money(x.package_price)} per sample). ${x.remaining_tests ? `The ${x.remaining_tests} test${x.remaining_tests === 1 ? '' : 's'} left keep their shares: ${money(x.still_charged)}.` : 'Nothing is left of the package.'}</li>`).join('')}</ul>`, 'Continue'))) return;
      } catch (e) { toast(e.message, 'err'); return; }
    }
    let reason = '';
    if (needReason) { reason = await askReason(rows.some((r) => 'tat_override' in r) ? 'the turnaround (TAT) of tests on ' + o.order_code : 'tests on logged samples'); if (!reason) return; }
    try { await api(`/orders/${id}/tests`, { method: 'POST', body: { rows, reason } }); setDirtyCheck(null); toast('Tests saved. Rush requests needing approval are now on the intake dashboard.'); detail(main, id); } catch (e) { toast(e.message, 'err'); }
  };

  // ---- actions
  const ready = () => { if (unsaved()) { toast('Save the samples first.', 'err'); return false; } return !testsUnsaved(); };
  async function applyProject(ids) {
    if (!ready()) return;
    if (!ids.length) { toast('Tick one or more samples first.', 'err'); return; }
    const v = await modal({ title: `Apply a project to ${ids.length} sample${ids.length === 1 ? '' : 's'}`, okText: 'Apply', intro: 'All of the project\'s quoted tests are added. Cancel any that are not needed afterwards.',
      fields: [{ name: 'project_id', label: 'Project (accepted quote)', type: 'select', required: true, blank: false,
        options: projects.map((p) => ({ value: p.project_id, label: `${p.project_code} · ${p.project_name}${p.via_parent ? ' (shared from parent)' : ''}` })) }] });
    if (!v) return;
    try { const r = await api(`/orders/${id}/apply-project`, { method: 'POST', body: { sample_ids: ids, project_id: v.project_id } }); ids.forEach((x) => hidden.delete(x)); toast(`${r.added} test${r.added === 1 ? '' : 's'} added.`); detail(main, id); } catch (e) { toast(e.message, 'err'); }
  }
  // 0.36.0: the drill-down picker (service line > type > department, or search); any test of this lab, the client's
  // quoted price when there is one, else the list price
  async function addTest(ids) {
    if (!ready()) return;
    if (!ids.length) { toast('Tick one or more samples first.', 'err'); return; }
    const names = ids.map((x) => { const s = d.samples.find((y) => y.id === x) || {}; return s.sample_code || s.client_sample_id || 'sample'; });
    testPicker({ orderId: id, sampleIds: ids, sampleLabel: ids.length === 1 ? names[0] : `${ids.length} samples`, tiers: d.tiers,
      onAdded: () => { ids.forEach((x) => hidden.delete(x)); detail(main, id); } });
  }
  async function addPackage(ids) {
    if (!ready()) return;
    if (!ids.length) { toast('Tick one or more samples first.', 'err'); return; }
    const v = await modal({ title: `Add a package to ${ids.length} sample${ids.length === 1 ? '' : 's'}`, okText: 'Add', intro: 'Packages on this client\'s accepted quotes. All of the package\'s tests are ordered, each at its share of the package price.',
      fields: [{ name: 'qp', label: 'Package', type: 'select', required: true, blank: false,
        options: d.packages.map((p) => ({ value: p.quoted_package_id, label: `${p.package_code} ${p.package_name} · ${money(p.package_price)} (${p.project_code}; ${p.tests})` })) }] });
    if (!v) return;
    try { const r = await api(`/orders/${id}/add-package`, { method: 'POST', body: { sample_ids: ids, quoted_package_id: v.qp } }); ids.forEach((x) => hidden.delete(x)); toast(`Package added to ${r.added} sample${r.added === 1 ? '' : 's'}.`); detail(main, id); } catch (e) { toast(e.message, 'err'); }
  }
  // Cancel samples or tests (0.34.0, Alex: "you can't remove tests or samples once they have been added"): nothing is
  // deleted; they stay on the order, greyed, with the reason. The database refuses a test with results or in a batch.
  async function cancelItems({ samples = [], tests = [] }) {
    if (!ready()) return;
    if (!samples.length && !tests.length) { toast('Tick or select the samples or tests to cancel.', 'err'); return; }
    const name = (s) => s.sample_code || s.client_sample_id || 'a sample';
    const sampleName = (sid) => name(d.samples.find((x) => x.id === sid) || {});
    const lines = [...samples.map((s) => `<li>Sample ${esc(name(s))} and its ${Number(s.test_count) || 0} test${Number(s.test_count) === 1 ? '' : 's'}</li>`),
      ...tests.map((t) => `<li>${esc(t.test_name)} on ${esc(sampleName(t.sample_id))}${t.ordered_package_id ? ' (part of a package: only its share comes off)' : ''}</li>`)];
    if (!(await confirmBox(`Cancel ${samples.length ? samples.length + ' sample' + (samples.length === 1 ? '' : 's') : tests.length + ' test' + (tests.length === 1 ? '' : 's')}`,
      `<ul>${lines.join('')}</ul><p>They stay on the order, greyed out, and can be ordered again later. A test that has results or is in a batch cannot be cancelled: take it out of the batch first.</p>`, 'Next: reason'))) return;
    const reason = await askReason('cancelling on ' + o.order_code); if (!reason) return;
    try {
      const r = await api(`/orders/${id}/cancel`, { method: 'POST', body: { sample_ids: samples.map((s) => s.id), test_ids: tests.map((t) => t.id), reason } });
      toast(r.samples ? `${r.samples} sample${r.samples === 1 ? '' : 's'} cancelled with their tests.` : `${r.tests} test${r.tests === 1 ? '' : 's'} cancelled.`);
      detail(main, id);
    } catch (e) { toast(e.message, 'err'); }
  }
  main.querySelector('#cancelS').onclick = () => cancelItems({ samples: picked().filter((r) => r.status !== 'Cancelled') });
  const apk = main.querySelector('#addPk'); if (apk) apk.onclick = () => addPackage(picked().map((r) => r.id));
  main.querySelector('#applyP').onclick = () => applyProject(picked().map((r) => r.id));
  main.querySelector('#addT').onclick = () => addTest(picked().map((r) => r.id));
  main.querySelector('#rushAll').onclick = async () => {
    if (testsUnsaved()) return;
    const used = [...new Set(d.tests.filter((t) => t.status !== 'Cancelled' && t.test_rush_schedule_id).map((t) => t.test_rush_schedule_id))];
    if (!used.length) { toast('No tests on this order have a rush schedule.', 'err'); return; }
    const fields = used.map((sid) => {
      const tiers = d.tiers.filter((t) => t.schedule_id === sid);
      return { name: sid, label: tiers[0]?.schedule_name || 'Rush', type: 'select', blank: false, value: '',
        options: [{ value: '', label: 'Standard turnaround' }, ...tiers.map((t) => ({ value: t.id, label: `${t.tier_name} (${t.rush_tat} ${t.tat_unit === 'Business Days' ? 'business' : 'calendar'} days)` }))] };
    });
    const v = await modal({ title: 'Rush the whole order', okText: 'Apply', intro: 'Choose a tier for each rush schedule on this order. Tiers that need approval go to the intake dashboard; the rest are accepted straight away.', fields });
    if (!v) return;
    const logged = d.tests.some((t) => t.clock_start);
    let reason = ''; if (logged) { reason = await askReason('rush on this order'); if (!reason) return; }
    try { const r = await api(`/orders/${id}/rush`, { method: 'POST', body: { tiers: v, reason } }); toast(`${r.changed} test${r.changed === 1 ? '' : 's'} updated.`); detail(main, id); } catch (e) { toast(e.message, 'err'); }
  };
  // sample labels (Dymo, 2 1/8 x 4 in., with the tests and due dates): one per unit received, for every logged sample
  main.querySelector('#labels').onclick = () => printLabels('sample', d.samples.filter((s) => s.sample_code && s.status !== 'Cancelled').map((s) => s.id));
  main.querySelector('#receive').onclick = async () => {
    if (!ready()) return;
    const rows = picked().filter((r) => r.status === 'Expected');
    receiveDialog(o, rows.length ? rows : [], cus, () => detail(main, id));
  };
  if (main.querySelector('#log')) main.querySelector('#log').onclick = async () => {
    if (!ready()) return;
    const ids = picked().filter((r) => r.status === 'Expected').map((r) => r.id);
    if (!ids.length) { toast('Tick the samples to log.', 'err'); return; }
    if (!(await confirmBox('Log samples', `Log ${ids.length} sample${ids.length === 1 ? '' : 's'} now? Each gets its sample ID (${esc(o.site_code)}yymmdd###) and the turnaround clock starts (Day 0 = today, or the next working day if after a test's cutoff time).`, 'Log samples'))) return;
    try { const r = await api(`/orders/${id}/log`, { method: 'POST', body: { sample_ids: ids } }); toast(`${r.logged} sample${r.logged === 1 ? '' : 's'} logged.`); detail(main, id); } catch (e) { toast(e.message, 'err'); }
  };
  const sub = main.querySelector('#submit');
  if (sub) sub.onclick = async () => { try { await api('/orders/' + id, { method: 'PUT', body: { row: { status: 'Submitted' } } }); detail(main, id); } catch (e) { toast(e.message, 'err'); } };
  main.querySelector('#edit').onclick = async () => {
    const v = await modal({ title: 'Edit order', fields: [
      { name: 'ordering_contact_id', label: 'Ordering contact', type: 'select', blank: false, value: o.ordering_contact_id, options: d.contacts.map((c) => ({ value: c.id, label: c.name })) },
      { name: 'po_number', label: 'PO number', value: o.po_number },
      // the client's license the order is for (0.32.0): printed on the COA; an expired one is marked
      { name: 'client_license_id', label: 'Client license', type: 'select', value: o.client_license_id || '', options: (d.licenses || []).filter((l) => l.status_text === 'Active' || l.id === o.client_license_id).map((l) => ({ value: l.id, label: licText(l) })),
        help: (d.licenses || []).length ? 'Printed on the COA. Licenses are added on the client\'s page.' : 'This client has no licenses yet: add them on the client\'s page.' },
      { name: 'notes', label: 'Notes', type: 'textarea', value: o.notes }] });
    if (!v) return;
    if (v.client_license_id === '') v.client_license_id = null;
    try { await api('/orders/' + id, { method: 'PUT', body: { row: v } }); detail(main, id); } catch (e) { toast(e.message, 'err'); }
  };
  if (d.emails.length) new Grid(main.querySelector('#eg'), { readOnly: true, rows: d.emails, onRowOpen: showEmail,
    columns: [{ field: 'created_at', title: 'When', type: 'readonly', width: 150, format: dt }, { field: 'template', title: 'Type', type: 'readonly', width: 150 },
      { field: 'to_address', title: 'To', type: 'readonly', width: 230 }, { field: 'subject', title: 'Subject', type: 'link', onClick: showEmail }] });
}

// Sample page: everything about one sample, with links to its order, client, tests and quotes
export async function sample(main, id) {
  const d = await api('/samples/' + id);
  const s = d.sample; const o = d.order;
  const kv = (pairs) => `<dl class="kv">${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v === null || v === undefined || v === '' ? '—' : v}</dd>`).join('')}</dl>`;
  main.innerHTML = pageHeader(`Sample ${s.sample_code || s.client_sample_id || '(not logged)'}`,
    `${link('#/orders/' + o.id, o.order_code)} · ${link('#/clients/' + o.client_id, `${o.client_code} ${o.client_name}`)} · ${esc(o.site_code)} ${badge(s.status)}`,
    `${s.sample_code ? '<button class="btn" id="labels">Print labels</button> ' : ''}<a class="btn" href="#/orders/${o.id}">Edit on the order</a>`, { kind: 'sample', id }) + `
  <div class="cols">
    <div class="card"><h2>Sample</h2>${kv([['Sample ID', esc(s.sample_code || 'Not logged yet')], ['Client sample ID', esc(s.client_sample_id)], ['Description', esc(s.description)],
      ['Matrix', esc(s.matrix)], ['Product', esc(s.product)], ['Lot', esc(s.lot)], ['Batch', esc(s.batch)], ['METRC ID', esc(s.metrc_id || '')], ['Category', esc(s.compliance_category)],
      ['Serving', esc([s.serving_count ? `${Number(s.serving_count)} ${s.serving_count_unit || ''}` : '', s.serving_size ? `${Number(s.serving_size)} ${s.serving_unit || ''}` : ''].filter(Boolean).join(', ') + (s.servings_per_package ? `; ${Number(s.servings_per_package)} per package` : ''))]])}</div>
    <div class="card"><h2>Receipt and turnaround</h2>${kv([['Amount received', s.quantity_received === null ? '' : esc(`${s.quantity_received} ${s.quantity_unit || ''}`)], ['Containers', esc(s.number_of_units)],
      ['Condition', esc(s.condition)], ['Temperature', s.receipt_temperature === null ? '' : esc(s.receipt_temperature + ' °C')], ['Preservation', esc(s.preservation)],
      ['Logged', s.logged_at ? esc(`${dt(s.logged_at)} by ${s.logged_by_name || ''}`) : 'Not logged yet'], ['Due', esc(d8(s.due_date))], ['Value', money(s.sample_value)]])}</div>
  </div>
  <div class="card">${section('Tests', 'Change tests, rush or TAT on the order page.')}<div id="tg"></div></div>
  <div class="card">${section('Results', 'Approved results (QC Review) with the specification they were compared with, and the batches the sample was tested in. A preliminary result (a timepoint released before the final review) is marked as not final.')}<div id="rg"></div><div id="rbat" class="help" style="margin-top:8px"></div></div>
  ${servingCard(s, d)}
  <div class="card" id="p2card" style="display:none"></div>
  <div class="card" id="phcard"></div>
  <div class="card" id="coacard"></div>`;
  main.querySelector('#labels')?.addEventListener('click', () => printLabels('sample', [s.id]));
  // the unplanned case (033): ask the client for the serving test; their consent (Split-off requests, below) orders it
  main.querySelectorAll('[data-sreq]').forEach((b) => { b.onclick = async () => {
    const role = b.dataset.sreq;
    const v = await modal({ title: `Request the ${role.toLowerCase()} test`, okText: 'Raise the request',
      intro: `The results per serving need the ${role.toLowerCase()} measured. The request waits for the client's consent (it costs extra); record their answer under Split-off requests on this page, and consent orders the test.`,
      fields: [{ name: 'note', label: 'Note (e.g. how the client is being asked)', type: 'textarea' }] });
    if (!v) return;
    try { await api(`/samples/${s.id}/serving-request`, { method: 'POST', body: { role, note: v.note } }); toast('Request raised: it waits for the client\'s consent.'); sample(main, id); } catch (e) { toast(e.message, 'err'); }
  }; });
  photosCard(main.querySelector('#phcard'), { id, sample_code: s.sample_code, client_sample_id: s.client_sample_id }).catch(() => {});   // receipt photos (0.29.0)
  import('./reports.js').then((m) => m.sampleCoaCard(main.querySelector('#coacard'), id)).catch(() => {});
  new Grid(main.querySelector('#tg'), { readOnly: true, rows: d.tests, emptyText: 'No tests ordered.',
    rowClass: (r) => (r.status === 'Cancelled' ? 'mutedrow' : ''),
    columns: [
      { field: 'test_name', title: 'Test', type: 'link', width: 200, href: (r) => '#/catalog/' + r.test_id },
      { field: 'quote', title: 'Quote', type: 'link', width: 100, compute: (r) => (r.project_code ? `${r.project_code} v${r.project_version_no}` : r.media_lot_id ? 'Lot QA testing' : r.serving_order ? 'Catalogue price' : ''),
        href: (r) => (r.project_version_id ? '#/quote/' + r.project_version_id : r.media_lot_id ? '#/inventory/lots/' + r.media_lot_id : null) },
      { field: 'analytes', title: 'Analytes', type: 'readonly', width: 80, compute: (r) => (r.pricing_mode === 'Analyte Selection' ? `${r.analytes_included} of ${r.analytes_total}` : '—') },
      { field: 'price', title: 'Price', type: 'money', width: 85 },
      { field: 'rush_tier_name', title: 'Rush tier', type: 'readonly', width: 120, format: (v) => v || 'Standard' },
      { field: 'rush_status', title: 'Rush status', type: 'readonly', width: 120, format: (v) => (v === 'None' ? '' : v) },
      { field: 'rush_fee', title: 'Rush fee', type: 'money', width: 80 },
      { field: 'tat_days', title: 'TAT', type: 'readonly', width: 125, format: (v, r) => (hasVal(v) ? `${v} ${unit(r.tat_unit)} days${hasVal(r.tat_override) ? ' ✎' : ''}` : '') },
      { field: 'day0', title: 'Day 0', type: 'readonly', width: 100, format: d8 },
      { field: 'due_date', title: 'Due', type: 'readonly', width: 100, format: d8 },
      { field: 'status', title: 'Status', type: 'readonly', width: 90 },
    ] });
  // WD-3: approved results and the batches (links)
  try {
    const r = await api(`/testing/samples/${id}/results`);
    // R-2: the OOS investigation of a nonconforming final result (a link), or "Open OOS…" when none is open
    const oosFor = await api(`/oos/for?sample=${id}`).catch(() => ({ rows: [], can_open: false }));
    const oosOf = (x) => oosFor.rows.find((o) => o.requested_test_id === x.requested_test_id && o.analyte_id === x.analyte_id);
    const mayOpen = (x) => x.conformance === 'Does not conform' && !x.result_key && x.stage === 'Final' && oosFor.can_open;
    phase2Card(main.querySelector('#p2card'), s, oosFor, () => sample(main, id));
    new Grid(main.querySelector('#rg'), { readOnly: true, rows: r.results, emptyText: 'No approved results yet.',
      rowClass: (x) => (x.conformance === 'Does not conform' ? 'tbnc' : ''),
      columns: [
        { field: 'test_name', title: 'Test', type: 'readonly', width: 230 },
        { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 150 },
        // WD-5: a timepoint's result (e.g. day 7) and its stage; a preliminary result is released before the final one
        { field: 'result_name', title: 'Result of', type: 'readonly', width: 140, compute: (x) => x.result_name || 'Final result' },
        { field: 'stage', title: 'Stage', type: 'readonly', width: 190, compute: (x) => (x.stage === 'Preliminary' ? 'Preliminary: not a final result' : 'Final'),
          cellClass: (x) => (x.stage === 'Preliminary' ? 'flag' : '') },
        { field: 'reported', title: 'Result', type: 'readonly', width: 100, align: 'right' },
        { field: 'unit', title: 'Unit', type: 'readonly', width: 70 },
        { field: 'spec', title: 'Specification', type: 'readonly', width: 150, compute: (x) => (x.spec_text || [x.spec_min !== null && x.spec_min !== undefined ? '≥ ' + x.spec_min : '', x.spec_max !== null && x.spec_max !== undefined ? '≤ ' + x.spec_max : ''].filter(Boolean).join(' and ')) + (x.spec_unit && !x.spec_text ? ' ' + x.spec_unit : '') },
        { field: 'conformance', title: 'Conformance', type: 'readonly', width: 140, cellClass: (x) => (x.conformance === 'Does not conform' ? 'flag' : '') },
        { field: 'oos', title: 'OOS', type: 'button', width: 130, label: (x) => { const o = oosOf(x); return o ? o.oos_code + (o.status === 'Closed' ? ' (closed)' : '') : mayOpen(x) ? 'Open OOS…' : ''; },
          onClick: async (x) => {
            const o = oosOf(x); if (o) { location.hash = '#/oos/' + o.id; return; }
            if (!mayOpen(x)) return;
            const { openOos } = await import('./oos.js');
            try { await openOos({ requested_test_id: x.requested_test_id, analyte_id: x.analyte_id, batch_id: x.batch_id, label: `${x.analyte_name} ${x.reported}${x.unit ? ' ' + x.unit : ''} in ${s.sample_code}` }); } catch (e) { toast(e.message, 'err'); }
          } },
        { field: 'batch_code', title: 'Batch', type: 'link', width: 105, href: (x) => '#/testing/batches/' + x.batch_id },
        { field: 'approved_by_name', title: 'Approved by', type: 'readonly', width: 150 },
        { field: 'approved_at', title: 'Approved', type: 'readonly', width: 140, format: dt },
      ] });
    if (r.splits.length) {
      main.querySelector('#rbat').insertAdjacentHTML('afterend', `<h3 style="margin:14px 0 6px">Split-off requests</h3><div id="rsp"></div>`);
      const { decideSplit, alertText } = await import('./testing.js');
      new Grid(main.querySelector('#rsp'), { readOnly: true, rows: r.splits, columns: [
        { field: 'origin_test_name', title: 'From', type: 'readonly', width: 200 },
        { field: 'batch_code', title: 'Batch', type: 'link', width: 105, href: (x) => '#/testing/batches/' + x.batch_id },
        { field: 'finding', title: 'Finding', type: 'readonly', width: 180 },
        { field: 'test_name', title: 'Test to order', type: 'readonly', width: 200 },
        { field: 'status', title: 'Status', type: 'readonly', width: 130, cellClass: (x) => (['Awaiting consent', 'To order'].includes(x.status) ? 'flag' : '') },
        { field: 'decision_note', title: 'Note', type: 'readonly', width: 220 },
        { field: 'alerts', title: 'Client alerted', type: 'readonly', width: 280, help: 'Presumptive result email: who was told, when, and whose step sent it (the Outbox keeps the email)', compute: (x) => alertText(x.alerts) },
        { field: 'yes', title: '', type: 'button', width: 120, label: (x) => (r.can_decide && x.status === 'Awaiting consent' ? 'Consent given…' : ''), onClick: (x) => decideSplit(x, 'Consent given') },
        { field: 'no', title: '', type: 'button', width: 90, label: (x) => (r.can_decide && x.status === 'Awaiting consent' ? 'Declined…' : ''), onClick: (x) => decideSplit(x, 'Declined') },
      ] });
    }
    main.querySelector('#rbat').innerHTML = r.batches.length ? 'Batches: ' + r.batches.map((x) => `${link('#/testing/batches/' + x.id, x.batch_code)} (${esc(x.test_name)}, ${esc(x.status)}${x.entry_status === 'Superseded' ? ', re-prepped' : ''})`).join(' · ') : '';
  } catch (_) { main.querySelector('#rg').innerHTML = '<div class="help">Results are not available.</div>'; }
}

// Serving size, Part B (migration 033): what the sample's serving is based on, what still holds results per serving,
// and the request for the serving test when nobody ordered it
function servingCard(s, d) {
  const held = d.serving_held || []; const ordered = d.serving_tests || [];
  if (!held.length && !s.report_per_serving && !s.unit_weight_result_id && !s.density_result_id && !ordered.length) return '';
  const n = (v) => (v === null || v === undefined ? '' : String(Number(v)));
  const has = (role) => ordered.some((x) => x.serving_role === role);
  const needs = (re) => held.some((h) => re.test(h.problem || ''));
  const btns = [!has('Serving weight') && needs(/serving weight/) ? '<button class="btn" data-sreq="Serving weight">Request the serving weight test…</button>' : '',
    !has('Density') && needs(/density/) ? '<button class="btn" data-sreq="Density">Request the density test…</button>' : ''].filter(Boolean).join(' ');
  return `<div class="card" id="servcard">${section('Serving for results per serving', 'The serving weight and the density come only from their approved tests (Serving weight: the average of the units weighed; Density). Nothing per serving is released before they are measured, approved and used.')}
    <dl class="kv">
      <dt>Results per serving</dt><dd>${s.report_per_serving ? 'Asked for on the order' : 'Not asked for on the order'}</dd>
      <dt>Unit weight</dt><dd>${s.unit_weight_result_id ? esc(`${n(s.unit_weight)} ${s.unit_weight_unit || ''} (measured)`) : 'Not measured'}</dd>
      <dt>Density</dt><dd>${s.density_result_id ? esc(`${n(s.density)} ${s.density_unit || ''} (measured)`) : 'Not measured'}</dd>
      <dt>Serving tests</dt><dd>${ordered.length ? esc(ordered.map((x) => `${x.test_name} (${x.status})`).join(', ')) : 'None ordered'}</dd>
    </dl>
    ${held.length ? `<div class="notice" id="servheld"><b>Held:</b> ${esc(held.map((h) => `${h.test_name}: ${h.problem}`).join('; '))}.</div>` : ''}
    ${btns ? `<p>${btns}</p>` : ''}</div>`;
}

// OOS Phase II (migration 028): after a confirmed OOS is released (the OOS email goes out with the COA), the client decides:
// a Phase II retest (ordered here or from the OOS page) or no retest. Either closes the loop; the final COA is then issued.
function phase2Card(el, s, oosFor, reload) {
  const rows = oosFor.rows.filter((o) => o.conclusion === 'OOS confirmed');
  if (!rows.length) return;
  el.style.display = '';
  const open = rows.filter((o) => o.client_notified_at && !o.phase2_decision);
  el.innerHTML = `${section('OOS: the client\'s Phase II decision', 'A confirmed OOS result is released on the COA and the client is emailed then (not when the OOS is found). The client then asks for a Phase II retest or no retest. Record it here; until then the COA is not marked final.')}
    <div id="p2g"></div>`;
  new Grid(el.querySelector('#p2g'), { readOnly: true, rows, rowClass: (o) => (open.includes(o) ? 'warnrow' : ''), columns: [
    { field: 'oos_code', title: 'OOS', type: 'link', width: 110, href: (o) => '#/oos/' + o.id },
    { field: 'test_name', title: 'Test', type: 'readonly', width: 200 },
    { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 140 },
    { field: 'reported', title: 'Result', type: 'readonly', width: 100, compute: (o) => `${o.reported || ''}${o.unit ? ' ' + o.unit : ''}` },
    { field: 'client_notified_at', title: 'Client emailed', type: 'readonly', width: 140, format: (v) => (v ? dt(v) : 'Not yet (sent when the COA is issued)') },
    { field: 'phase2_decision', title: 'Phase II', type: 'readonly', width: 200, compute: (o) => (o.phase2_decision ? `${o.phase2_decision}${o.phase2_by_name ? ', ' + o.phase2_by_name : ''}` : o.client_notified_at ? 'Waiting for the client' : '') },
    { field: 'phase2_note', title: 'Note', type: 'readonly', width: 200 },
    { field: 'retest', title: '', type: 'button', width: 175, label: (o) => (oosFor.can_phase2 && open.includes(o) ? 'Order Phase II retest…' : ''), onClick: (o) => retest(o) },
    { field: 'none', title: '', type: 'button', width: 150, label: (o) => (oosFor.can_phase2 && open.includes(o) ? 'No retest: close…' : ''), onClick: (o) => noRetest(o) },
  ] });
  async function retest(o) {
    const v = await modal({ title: `Phase II retest of ${s.sample_code}`, okText: 'Next: sign',
      intro: 'A re-prep from the retained sample, billed by QA\'s determination once its result is approved. The original result stays on the issued COA; the retest makes a new COA version.',
      fields: [{ name: 'replicates', label: 'Replicates', type: 'select', blank: false, value: '1', options: [{ value: '1', label: 'Single' }, { value: '2', label: 'Duplicate' }, { value: '3', label: 'Triplicate' }] }] });
    if (!v) return;
    const done = await signDialog({ what: `${o.oos_code}: order the Phase II retest`, meaning: 'Ordered by', needReason: false,
      submit: ({ signature }) => api(`/oos/${o.id}/retest`, { method: 'POST', body: { kind: 'Client', replicates: v.replicates, response_id: null, signature } }) });
    if (done) { toast('Phase II retest ordered: it is in the backlog.'); reload(); }
  }
  async function noRetest(o) {
    const v = await modal({ title: `${o.oos_code}: no retest`, okText: 'Next: sign',
      intro: 'The client does not want a Phase II retest. This closes the loop: the COA can then be issued as the final report (Report Finalization, "Final COA due").',
      fields: [{ name: 'note', label: 'How the client told us (e.g. email of 14 Oct from J. Smith)', type: 'textarea', required: true }] });
    if (!v) return;
    const done = await signDialog({ what: `${o.oos_code}: client's Phase II decision, no retest`, meaning: 'Recorded by', needReason: false,
      submit: ({ signature }) => api(`/oos/${o.id}/phase2`, { method: 'POST', body: { note: v.note, signature } }) });
    if (done) { toast('Recorded: no retest. Issue the final COA from Report Finalization.'); reload(); }
  }
}

export function showEmail(e) {
  modal({ title: e.subject, okText: 'Close', wide: true,
    html: `<div class="email"><div><b>To:</b> ${esc(e.to_name || '')} &lt;${esc(e.to_address || '')}&gt;</div><div><b>Status:</b> ${esc(e.delivery_status)} · ${dt(e.created_at)}</div>${e.coa_version_id ? `<div><b>Attachment:</b> <a href="/api/reports/coa/${e.coa_version_id}/pdf?s=${encodeURIComponent(state.site || '')}" target="_blank" rel="noopener">the COA (PDF)</a></div>` : ''}${e.document_id ? `<div><b>Attachment:</b> <a href="${e.project_version_id ? `/api/quotes/versions/${e.project_version_id}/pdf` : `/api/outbox/${e.id}/document?s=${encodeURIComponent(state.site || '')}`}" target="_blank" rel="noopener">${e.project_version_id ? 'the quotation (PDF)' : 'the investigation report (PDF)'}</a></div>` : ''}<pre>${esc(e.body)}</pre></div>` });
}

async function analyteDialog(test, done) {
  const rows = await api(`/requested-tests/${test.id}/analytes`);
  const m = document.createElement('div'); m.className = 'modal-bg';
  m.innerHTML = `<div class="modal wide"><h3>Analytes: ${esc(test.test_name)} on ${esc(test.sample_code || test.client_sample_id || 'sample')}</h3>
    <p class="intro">Only analytes on the client's quote are listed. Untick what is not needed; the price keeps the quoted discount %. Analytes removed on the quote cannot be added here.</p>
    <div id="ag"></div><div class="preview" id="pv"></div>
    <div class="mbtns"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>Apply</button></div></div>`;
  document.body.appendChild(m);
  const g = new Grid(m.querySelector('#ag'), { rows, onChange: pv, readOnly: test.status === 'Cancelled',
    columns: [{ field: 'included', title: 'Included', type: 'bool', width: 80 }, { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 200 },
      { field: 'report_name', title: 'Report name', type: 'readonly', width: 180 }, { field: 'analyte_price', title: 'Price', type: 'money', width: 90 }] });
  const basePrep = test.list_price - rows.filter((r) => r.included).reduce((s, r) => s + r.analyte_price, 0);
  function pv() {
    const inc = g.rows.filter((r) => r.included); const nl = basePrep + inc.reduce((s, r) => s + r.analyte_price, 0);
    const np = test.list_price ? nl * test.price / test.list_price : test.price;
    m.querySelector('#pv').innerHTML = `<span>${inc.length} of ${g.rows.length} analytes</span><span>List ${money(test.list_price)} → <b>${money(nl)}</b></span><span>Price ${money(test.price)} → <b>${money(np)}</b></span><span>Difference <b>${money(np - test.price)}</b></span>`;
  }
  pv();
  const close = () => { g.destroy(); m.remove(); };
  m.querySelector('[data-x]').onclick = close;
  m.querySelector('[data-ok]').onclick = async () => {
    const changes = g.getChanges(); if (!changes.length) { close(); return; }
    let reason = ''; if (test.clock_start) { reason = await askReason('analytes on a logged sample'); if (!reason) return; }
    try { await api(`/requested-tests/${test.id}/analytes`, { method: 'POST', body: { rows: changes, reason } }); close(); toast('Analytes updated; price recalculated.'); done(); } catch (e) { toast(e.message, 'err'); }
  };
}
