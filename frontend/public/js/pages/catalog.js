// Test catalogue and the Test Workflow Designer, step 1: pricing, TAT, cutoff and rush
import { api, esc, pageHeader, toast, modal, state, money, askReason, setDirtyCheck, badge, can, confirmBox } from '../app.js';
import { Grid } from '../grid.js';
import { section, editableGrid } from './common.js';

// Tabs (P-1, migration 047): Tests | Packages | Price changes
// 0.36.0 (migration 058): Charges (kits, shipping, fees, discounts) and Service lines (the order's test picker)
const TABS = [['tests', 'Tests'], ['packages', 'Packages'], ['prices', 'Price changes'], ['charges', 'Charges'], ['lines', 'Service lines']];
const tabBar = (tab) => `<div class="tabs">${TABS.map(([k, l]) => `<a class="tab ${k === tab ? 'on' : ''}" href="#/catalog${k === 'tests' ? '' : '?tab=' + k}">${esc(l)}</a>`).join('')}</div>`;
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export async function list(main) {
  const tab = TABS.some(([k]) => k === state.query?.get('tab')) ? state.query.get('tab') : 'tests';
  if (tab === 'packages') return packagesTab(main);
  if (tab === 'prices') return pricesTab(main);
  if (tab === 'charges') return chargesTab(main);
  if (tab === 'lines') return linesTab(main);
  const rows = await api('/catalog');
  const site = state.site;
  main.innerHTML = pageHeader('Test catalogue', 'Built by the Test Workflow Designer (step 1). Pricing lives here, outside the validated test version.',
    `<a class="btn ghost" href="/api/catalog.csv">Download catalogue (CSV)</a> <a class="btn ghost" href="/api/catalog.csv?public=1">Public catalogue (CSV)</a> ${can('catalog.edit') ? '<button class="btn" id="reprice">Update prices…</button>' : ''} <button class="btn primary" id="new">+ New test</button>`, { kind: 'catalog' })
    + tabBar(tab)
    + '<p class="help">Select tests (Ctrl+click or Shift+click for several) and "Update prices…" changes them by a percentage from the date you choose; with nothing selected it can change every active test of this lab.</p><div id="g"></div>';
  const g = new Grid(main.querySelector('#g'), {
    readOnly: true, search: true, filter: state.query.get('find') || '', rows, onRowOpen: (r) => { location.hash = '#/catalog/' + r.test_id; },
    rowClass: (r) => (r.test_status === 'Retired' ? 'mutedrow' : ''),
    columns: [
      { field: 'test_code', title: 'Code', type: 'link', width: 85, href: (r) => '#/catalog/' + r.test_id },
      { field: 'test_name', title: 'Test', type: 'link', width: 230, href: (r) => '#/catalog/' + r.test_id },
      { field: 'site_code', title: 'Lab', type: 'readonly', width: 60 },
      { field: 'pricing_mode', title: 'Pricing mode', type: 'readonly', width: 170 },
      { field: 'base_price', title: 'Base', type: 'money', width: 85 },
      { field: 'prep_fee', title: 'Prep fee', type: 'money', width: 85 },
      { field: 'analyte_count', title: 'Analytes', type: 'readonly', width: 75, align: 'right', format: (v, r) => (r.pricing_mode === 'Analyte Selection' ? v : '') },
      { field: 'list_price', title: 'List price', type: 'money', width: 95 },
      { field: 'standard_tat', title: 'Std TAT', type: 'readonly', width: 120, format: (v, r) => `${v} ${r.tat_unit === 'Business Days' ? 'business' : 'calendar'} days` },
      { field: 'cutoff_time', title: 'Cutoff', type: 'readonly', width: 70, format: (v) => (v || '').slice(0, 5) },
      { field: 'rush_schedule', title: 'Rush schedule', type: 'readonly', width: 130 },
      { field: 'show_in_public_catalogue', title: 'Public', type: 'readonly', width: 65, format: (v) => (v ? 'Yes' : '') },
    ],
  });
  // new tests are made in the Workflow Designer (they belong to a lab and a department, and are approved there)
  main.querySelector('#new').onclick = () => { location.hash = '#/methods?new=1'; };
  // dated price change (P-1, Alex 2026-10-19): one test, a selection or every active test of this lab, by a percentage,
  // rounded to the cent or the dollar, from an effective date; quotes already made keep their prices
  const rb = main.querySelector('#reprice');
  if (rb) rb.onclick = async () => {
    const mine = rows.filter((r) => r.test_status !== 'Retired' && r.site_id === site);
    const sel = g.selectedRows().filter((r) => r.test_status !== 'Retired');
    const other = sel.filter((r) => r.site_id !== site);
    const ids = [...new Set(sel.filter((r) => r.site_id === site).map((r) => r.test_id))];
    const v = await modal({ title: 'Update catalogue prices', okText: 'Next: reason',
      intro: `Each part of the price (base price, preparation fee, analyte prices) changes by the percentage, so the list price follows. With "Packages" ticked, these tests' prices in packages change by the same percentage. Quotes already made keep their prices; quotes made from the start date use the new ones.${other.length ? ` <b>${other.length} selected test${other.length === 1 ? ' is' : 's are'} another lab's and will be left out</b> (change them from that lab).` : ''}`,
      fields: [
        { name: 'scope', label: 'Tests', type: 'select', blank: false, value: ids.length ? 'selected' : 'all',
          options: [...(ids.length ? [{ value: 'selected', label: `The ${ids.length} selected test${ids.length === 1 ? '' : 's'}` }] : []), { value: 'all', label: `Every active test of this lab (${mine.length})` }] },
        { name: 'pct', label: 'Change by (%)', type: 'number', required: true, help: 'e.g. 3 for a 3 % increase, -5 for a 5 % decrease' },
        { name: 'effective_on', label: 'New prices start on', type: 'date', required: true, value: todayIso(), help: 'Today changes the prices at once; a later date is scheduled and applied that morning.' },
        { name: 'rounding', label: 'Round each price to', type: 'select', blank: false, value: 'Cent', options: [{ value: 'Cent', label: 'The cent ($104.03)' }, { value: 'Dollar', label: 'The dollar ($104.00)' }] },
        { name: 'include_packages', label: 'Packages', type: 'checkbox', value: true, cbLabel: 'Also change these tests\' prices in packages' }] });
    if (!v) return;
    const pct = Number(v.pct);
    if (!pct) { toast('Give the percentage (not 0).', 'err'); return; }
    const scope = v.scope === 'selected' ? mine.filter((r) => ids.includes(r.test_id)) : mine;
    const ex = scope.find((r) => Number(r.list_price) > 0);
    const r1 = (x) => (v.rounding === 'Dollar' ? Math.round(x) : Math.round(x * 100) / 100);
    const today = v.effective_on <= todayIso();
    if (!(await confirmBox('Update catalogue prices', `${pct > 0 ? 'Raise' : 'Lower'} the prices of ${scope.length} test${scope.length === 1 ? '' : 's'} by ${Math.abs(pct)} % ${today ? 'now' : 'from ' + esc(v.effective_on)}?${ex ? ` For example ${esc(ex.test_name)}: ${money(ex.list_price)} becomes about ${money(r1(ex.list_price * (1 + pct / 100)))}.` : ''}`, 'Continue'))) return;
    const reason = await askReason('catalogue prices'); if (reason === null) return;
    try {
      const r = await api('/price-changes', { method: 'POST', body: { pct, tests: v.scope === 'selected' ? ids : null, effective_on: v.effective_on, rounding: v.rounding, include_packages: v.include_packages, reason } });
      toast(r.applied !== null && r.applied !== undefined ? `${r.change_code}: ${r.applied} price${r.applied === 1 ? '' : 's'} changed by ${pct} %.` : `${r.change_code} scheduled for ${v.effective_on}.`);
      if (r.applied === null || r.applied === undefined) location.hash = '#/catalog?tab=prices'; else list(main);
    } catch (e) { toast(e.message, 'err'); }
  };
}

// ---------------------------------------------------------------- packages
async function packagesTab(main) {
  const d = await api('/packages');
  main.innerHTML = pageHeader('Test catalogue', 'Packages: several tests sold together at one price, quoted without being rebuilt. Each test carries its share of the price, so it is invoiced when its report is issued, and cancelling one takes off only its share.',
    d.can_edit ? '<button class="btn primary" id="newpkg">+ New package</button>' : '', { kind: 'packages' })
    + tabBar('packages') + '<div id="g"></div>';
  new Grid(main.querySelector('#g'), {
    readOnly: true, search: true, rows: d.rows, emptyText: 'No packages yet. "+ New package" puts tests together.',
    onRowOpen: (r) => { location.hash = '#/catalog/packages/' + r.id; },
    rowClass: (r) => (r.status === 'Retired' ? 'mutedrow' : ''),
    columns: [
      { field: 'package_code', title: 'Code', type: 'link', width: 90, href: (r) => '#/catalog/packages/' + r.id },
      { field: 'package_name', title: 'Package', type: 'link', width: 230, href: (r) => '#/catalog/packages/' + r.id },
      { field: 'site_code', title: 'Lab', type: 'readonly', width: 60 },
      { field: 'tests', title: 'Tests', type: 'readonly', width: 320 },
      { field: 'list_value', title: 'Tests at list', type: 'money', width: 100 },
      { field: 'package_price', title: 'Package price', type: 'money', width: 110 },
      { field: 'discount_pct', title: 'Discount', type: 'readonly', width: 120, align: 'right', format: (v, r) => (Number(r.discount) > 0 ? `${money(r.discount)} (${Number(v)} %)` : '') },
      { field: 'errors', title: 'Problems', type: 'readonly', width: 90, format: (v) => (v ? `${v} to fix` : '') },
      { field: 'show_in_public_catalogue', title: 'Public', type: 'readonly', width: 65, format: (v) => (v ? 'Yes' : '') },
      { field: 'status', title: 'Status', type: 'readonly', width: 80 },
    ],
  });
  const nb = main.querySelector('#newpkg');
  if (nb) nb.onclick = async () => {
    const v = await modal({ title: 'New package', okText: 'Create and add tests',
      intro: 'The package belongs to this lab and holds this lab\'s tests. On the next page you add the tests and type each one\'s price in the package; the package price and the discount are worked out from them.',
      fields: [
        { name: 'package_name', label: 'Package name', required: true },
        { name: 'description', label: 'Description (optional)' }] });
    if (!v) return;
    try {
      const r = await api('/packages', { method: 'POST', body: v });
      location.hash = '#/catalog/packages/' + r.id;
    } catch (e) { toast(e.message, 'err'); }
  };
}

export async function packageEditor(main, id) {
  const [d, opts] = await Promise.all([api('/packages/' + id), api('/packages/options')]);
  const p = d.package; const ed = d.can_edit && p.status === 'Active';
  // 049 (Alex, 2026-10-19): each test is priced in the package; the package price is their sum and the discount is
  // worked out from the catalogue prices
  const form = { package_name: p.package_name, description: p.description || '', show_in_public_catalogue: !!p.show_in_public_catalogue };
  const lineOf = (itemId) => d.lines.find((l) => l.item_id === itemId) || {};
  const pctOff = (list, price) => (Number(list) > 0 && Number(price) < Number(list) ? Math.round((1 - Number(price) / Number(list)) * 1000) / 10 : 0);
  const itemRows = d.lines.map((l) => ({ id: l.item_id, test_id: l.test_id, test_name: l.test_name, pricing_mode: l.pricing_mode, list_price: l.list_price,
    component_price: l.typed_price, analytes: l.pricing_mode === 'Analyte Selection' ? `${l.analytes_in} of ${l.analytes_total}` : '', status: 'Active' }));
  const anRows = d.analytes.map((a) => ({ id: a.item_id + ':' + a.analyte_id, item_id: a.item_id, analyte_id: a.analyte_id, test_name: lineOf(a.item_id).test_name || '',
    analyte_name: a.analyte_name, catalogue_price: a.catalogue_price, included: a.included }));
  const errors = d.problems.filter((x) => x.severity === 'Error');
  main.innerHTML = pageHeader(p.package_name, `${esc(p.package_code)} ${badge(p.status)} · ${esc(p.site_code)} · Test catalogue package`,
    `<a class="btn ghost" href="#/catalog?tab=packages">Packages</a> ${ed ? '<button class="btn ghost" id="retire">Retire…</button> <button class="btn primary" id="save">Save</button>' : ''}`, { kind: 'test_package', id: p.id }) + `
  ${d.problems.length ? `<div class="card ${errors.length ? 'warn' : ''}"><h2>${errors.length ? 'To fix before it can be quoted' : 'Worth a look'}</h2><ul>${d.problems.map((x) => `<li><b>${esc(x.severity)}:</b> ${esc(x.problem)}</li>`).join('')}</ul></div>` : ''}
  <div class="cols">
    <div class="card"><h2>Package</h2><div class="frm">
      <label>Package name<input data-f="package_name" value="${esc(form.package_name)}" ${ed ? '' : 'disabled'}></label>
      <label>Description<input data-f="description" value="${esc(form.description)}" ${ed ? '' : 'disabled'}></label>
      <div class="row3" id="pksum">
        <div class="listprice"><span>Package price</span><b data-s="price">${money(p.package_price)}</b><small>The tests' prices added up</small></div>
        <div class="listprice"><span>Tests at catalogue price</span><b data-s="list">${money(p.list_value)}</b><small>The analytes in the package</small></div>
        <div class="listprice"><span>Discount</span><b data-s="disc">${money(p.discount)}</b><small data-s="pct">${Number(p.discount_pct)} % off</small></div>
      </div>
      <label class="cb"><input type="checkbox" data-f="show_in_public_catalogue" ${form.show_in_public_catalogue ? 'checked' : ''} ${ed ? '' : 'disabled'}> Show in public catalogue</label>
    </div></div>
    <div class="card"><h2>On quotes</h2>${d.quotes.length ? `<table class="tbl"><tr><th>Quote</th><th>Client</th><th>Status</th><th>Price</th></tr>${d.quotes.map((q) => `<tr><td><a href="#/quote/${q.version_id}">${esc(q.project_code)} v${q.version_no}</a></td><td>${esc(q.client_name)}</td><td>${badge(q.status)}</td><td>${money(q.package_price)}</td></tr>`).join('')}</table>`
      : '<p class="help">Not on any quote yet. Quotes take the package from Pricing: open a quote and use "Add a package".</p>'}
      <p class="help">Changing the package changes new quotes only. A quote keeps the price and shares it was given.</p></div>
  </div>
  <div class="card">${section('Tests in the package', 'Type each test\'s price in the package: that is what it is quoted and invoiced at, and the package price is their sum. A test added starts at its catalogue price (no discount). The discount is worked out from the catalogue prices.',
    ed ? '<button class="btn" id="addT">+ Add tests</button>' : '')}<div id="ig"></div></div>
  <div class="card" id="anCard" style="${anRows.length ? '' : 'display:none'}">${section('Analytes of analyte-priced tests', 'Untick an analyte to leave it out of the package. The test\'s catalogue price follows after saving; its price in the package stays as typed, so lower it too if it should.')}<div id="ag"></div></div>`;

  const active = () => ig.rows.filter((r) => r.status !== 'Inactive');
  function summary() {
    const price = active().reduce((s, r) => s + (Number(r.component_price ?? r.list_price) || 0), 0);
    const list = active().reduce((s, r) => s + (Number(r.list_price) || 0), 0);
    const q = (k) => main.querySelector(`#pksum [data-s=${k}]`);
    q('price').textContent = money(price); q('list').textContent = money(list);
    q('disc').textContent = money(Math.max(list - price, 0)); q('pct').textContent = `${pctOff(list, price)} % off`;
  }
  const ig = new Grid(main.querySelector('#ig'), {
    rows: itemRows, readOnly: !ed, emptyText: 'No tests yet: "+ Add tests".', onChange: summary,
    columns: [
      { field: 'test_name', title: 'Test', type: 'readonly', width: 240 },
      { field: 'pricing_mode', title: 'Pricing mode', type: 'readonly', width: 150 },
      { field: 'analytes', title: 'Analytes', type: 'readonly', width: 80 },
      { field: 'list_price', title: 'Catalogue price', type: 'money', width: 115, editable: () => false },
      { field: 'component_price', title: 'Price in the package', type: 'money', min: 0, required: true, width: 145 },
      { field: 'discount', title: 'Discount', type: 'readonly', width: 120, align: 'right',
        format: (v, r) => { const lp = Number(r.list_price) || 0; const pr = Number(r.component_price ?? lp); return lp - pr > 0 ? `${money(lp - pr)} (${pctOff(lp, pr)} %)` : (pr > lp ? 'Above catalogue' : ''); } },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 95 },
    ],
  });
  const ag = anRows.length ? new Grid(main.querySelector('#ag'), {
    rows: anRows, readOnly: !ed,
    columns: [
      { field: 'test_name', title: 'Test', type: 'readonly', width: 200 },
      { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 200 },
      { field: 'catalogue_price', title: 'Catalogue price', type: 'money', width: 115, editable: () => false },
      { field: 'included', title: 'In the package', type: 'bool', width: 115 },
    ],
  }) : null;

  function read() {
    main.querySelectorAll('[data-f]').forEach((el) => { form[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value; });
  }
  read();
  const orig = JSON.stringify(form);
  const pending = [];  // tests added since the last save
  const headerDirty = () => { read(); return JSON.stringify(form) !== orig; };
  const dirty = () => headerDirty() || ig.changeCount() > 0 || (ag && ag.changeCount() > 0) || pending.length > 0;
  setDirtyCheck(dirty);
  main.querySelectorAll('[data-f]').forEach((el) => el.addEventListener('input', read));
  if (!ed) return;

  main.querySelector('#addT').onclick = async () => {
    const have = new Set([...ig.rows.map((r) => r.test_id), ...pending]);
    const avail = opts.tests.filter((t) => !have.has(t.id) && Number(t.list_price) > 0);
    const v = await modal({ title: 'Add tests to the package', okText: 'Add', wide: true,
      intro: 'This lab\'s active, priced tests. A test with no approved workflow can be packaged but not ordered until it has one.',
      html: `<div class="picklist">${avail.map((t) => `<label class="cb"><input type="checkbox" value="${t.id}"> ${esc(t.test_name)} <small>${esc(t.test_code)} · ${money(t.list_price)}${t.approved ? '' : ' · no approved workflow'}</small></label>`).join('') || 'Every priced test of this lab is in the package already.'}</div>`,
      collect: (m) => ({ picked: [...m.querySelectorAll('.picklist input:checked')].map((x) => x.value) }) });
    if (!v || !v.picked.length) return;
    v.picked.forEach((tid) => {
      const t = opts.tests.find((x) => x.id === tid); pending.push(tid);
      ig.rows.push({ test_id: tid, test_name: t.test_name, pricing_mode: t.pricing_mode, list_price: t.list_price, component_price: Number(t.list_price), analytes: '', status: 'Active' });
      ig.orig.push({}); ig.isNew.push(true);
    });
    ig._view(); ig.render(); summary();
    toast(`${v.picked.length} test${v.picked.length === 1 ? '' : 's'} added: Save to keep ${v.picked.length === 1 ? 'it' : 'them'}.`);
  };

  main.querySelector('#save').onclick = async () => {
    if (ig.hasErrors() || (ag && ag.hasErrors())) { toast('Fix the cells marked in red first.', 'err'); return; }
    if (!dirty()) { toast('Nothing to save.'); return; }
    read();
    const reason = await askReason(`package ${p.package_code}`); if (reason === null) return;
    // existing items are sent whole (price and status), new ones by test with their price
    const changed = new Set(ig.getChanges().map((r) => r.id).filter(Boolean));
    const items = ig.rows.filter((r) => (r.id && changed.has(r.id)) || (!r.id && pending.includes(r.test_id)))
      .map((r) => (r.id ? { id: r.id, component_price: r.component_price, status: r.status } : { test_id: r.test_id, component_price: r.component_price }));
    const achg = ag ? new Set(ag.getChanges().map((r) => r.id)) : new Set();
    const analytes = ag ? ag.rows.filter((r) => achg.has(r.id)).map((r) => ({ item_id: r.item_id, analyte_id: r.analyte_id, included: !!r.included })) : [];
    const body = { reason, items, analytes };
    if (headerDirty()) body.header = { ...form };
    try { await api('/packages/' + p.id, { method: 'PUT', body }); setDirtyCheck(null); toast('Saved.'); packageEditor(main, id); } catch (e) { toast(e.message, 'err'); }
  };
  main.querySelector('#retire').onclick = async () => {
    if (!(await confirmBox('Retire the package', `Retire ${esc(p.package_code)} ${esc(p.package_name)}? New quotes can no longer take it. Quotes and orders that have it keep it.`, 'Retire'))) return;
    const reason = await askReason(`package ${p.package_code}`); if (reason === null) return;
    try { await api(`/packages/${p.id}/retire`, { method: 'POST', body: { reason } }); setDirtyCheck(null); toast('Retired.'); packageEditor(main, id); } catch (e) { toast(e.message, 'err'); }
  };
}

// ---------------------------------------------------------------- price changes
async function pricesTab(main) {
  const d = await api('/price-changes');
  main.innerHTML = pageHeader('Test catalogue', 'Price changes made with "Update prices…" (Tests tab): applied on their start date, the first time the hourly job runs that day. A scheduled one can be cancelled until then.',
    d.can_edit ? '<button class="btn" id="cancelpc">Cancel selected…</button>' : '', { kind: 'price_changes' })
    + tabBar('prices') + '<div id="g"></div>';
  const g = new Grid(main.querySelector('#g'), {
    readOnly: true, rows: d.rows, emptyText: 'No price changes yet. Select tests on the Tests tab and use "Update prices…".',
    rowClass: (r) => (r.status === 'Cancelled' ? 'mutedrow' : ''),
    columns: [
      { field: 'change_code', title: 'Change', type: 'readonly', width: 80 },
      { field: 'effective_on', title: 'Starts', type: 'readonly', width: 100, format: (v) => String(v || '').slice(0, 10) },
      { field: 'pct', title: 'Change', type: 'readonly', width: 75, align: 'right', format: (v) => `${Number(v) > 0 ? '+' : ''}${Number(v)} %` },
      { field: 'scope', title: 'Tests', type: 'readonly', width: 280 },
      { field: 'rounding', title: 'Rounded to', type: 'readonly', width: 90, format: (v) => (v === 'Dollar' ? 'Dollar' : 'Cent') },
      { field: 'include_packages', title: 'Packages', type: 'readonly', width: 80, format: (v) => (v ? 'Yes' : 'No') },
      { field: 'status', title: 'Status', type: 'readonly', width: 90 },
      { field: 'reason', title: 'Reason', type: 'readonly', width: 220 },
      { field: 'created_by_name', title: 'By', type: 'readonly', width: 130 },
      { field: 'last_error', title: 'Note', type: 'readonly', width: 220, format: (v, r) => (r.status === 'Cancelled' ? `Cancelled by ${r.cancelled_by_name || ''}` : v || '') },
    ],
  });
  const cb = main.querySelector('#cancelpc');
  if (cb) cb.onclick = async () => {
    const sel = g.selectedRows().filter((r) => r.status === 'Scheduled');
    if (!sel.length) { toast('Select a scheduled price change first.', 'err'); return; }
    if (!(await confirmBox('Cancel price changes', `Cancel ${sel.map((r) => esc(r.change_code)).join(', ')}? Prices stay as they are.`, 'Cancel them'))) return;
    const reason = await askReason('the price change'); if (reason === null) return;
    try { for (const r of sel) await api(`/price-changes/${r.id}/cancel`, { method: 'POST', body: { reason } }); toast('Cancelled.'); pricesTab(main); } catch (e) { toast(e.message, 'err'); }
  };
}

// ---------------------------------------------------------------- charges (0.36.0)
async function chargesTab(main) {
  const d = await api('/charge-items');
  const lines = (await api('/service-lines')).lines;
  main.innerHTML = pageHeader('Test catalogue', 'Charges that are not tests: sampling kits, shipping, report fees, surcharges and discounts. They go on lab orders (billed at once, never on a COA), on quotes at a price per client, and on draft invoices. A Discount is taken off.',
    '', { kind: 'charges' }) + tabBar('charges')
    + `<p class="help">${d.can_edit ? `Add rows or paste from Excel; fill down with Ctrl+D. A new charge is this lab's${d.is_admin ? ', or every lab\'s (choose in Applies to; system administrators only)' : ''}. Retire a charge by setting it Inactive.` : 'Changed by people with catalog.edit (General Managers).'}</p><div id="g"></div>`;
  editableGrid({ el: main.querySelector('#g'), rows: d.rows, search: true, readOnly: !d.can_edit, allowAdd: d.can_edit, what: 'charges',
    newRow: () => ({ kind: 'Other', price: 0, status: 'Active', scope: 'This lab' }), rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''),
    emptyText: 'No charges yet. Add rows: e.g. Sampling kit (Kit), Ground shipping (Shipping), Rush report fee (Report fee), Loyalty discount (Discount).',
    columns: [
      { field: 'charge_code', title: 'Code', type: 'readonly', width: 80 },
      { field: 'charge_name', title: 'Charge', width: 220, required: true },
      { field: 'kind', title: 'Kind', type: 'select', width: 110, options: ['Kit', 'Shipping', 'Report fee', 'Surcharge', 'Discount', 'Other'] },
      { field: 'price', title: 'Price', type: 'money', min: 0, width: 95, help: 'The default price (a Discount: the amount taken off). Each client\'s price can be set on their quote.' },
      { field: 'description', title: 'Description', width: 240 },
      { field: 'service_line_id', title: 'Service line', type: 'select', width: 150, options: () => [{ value: null, label: '' }, ...lines.map((l) => ({ value: l.id, label: l.line_name }))],
        format: (v) => (lines.find((l) => l.id === v) || {}).line_name || '' },
      { field: 'scope', title: 'Applies to', type: 'select', width: 110, options: d.is_admin ? ['This lab', 'Every lab'] : ['This lab'], editable: (r, isNew) => isNew,
        format: (v, r) => (r.id ? (r.site_id ? r.site_code : 'Every lab') : v) },
      { field: 'status', title: 'Status', type: 'select', width: 95, options: ['Active', 'Inactive'] },
      { field: 'used', title: 'Used', type: 'readonly', width: 60, help: 'How many times it is on lab orders' }],
    save: (rows, reason) => api('/charge-items', { method: 'POST', body: { rows, reason } }), afterSave: () => chargesTab(main) });
}

// ---------------------------------------------------------------- service lines (0.36.0)
async function linesTab(main) {
  const [d, tests] = await Promise.all([api('/service-lines'), api('/service-lines/tests')]);
  const typeLabel = (id) => { const t = d.types.find((x) => x.id === id); return t ? `${t.line_name} > ${t.type_name}` : ''; };
  main.innerHTML = pageHeader('Test catalogue', 'Service line > service line type > department: how the order\'s test picker narrows this lab\'s tests (Cecilia, 2026-10-21). Service lines and types are shared by every lab; each lab puts its own tests under them. Clients\' service lines are set on the client page.',
    '', { kind: 'service_lines' }) + tabBar('lines')
    + `<div class="cols"><div class="card">${section('Service lines', d.can_edit ? 'Add, rename or set Inactive. Paste and fill down work.' : '')}<div id="lg"></div></div>
       <div class="card">${section('Service line types', d.can_edit ? 'Each type sits under one service line. Paste and fill down work.' : '')}<div id="tg"></div></div></div>
       <div class="card">${section('This lab\'s tests', 'Pick each test\'s service line type (type to search); select a block and fill down with Ctrl+D, or paste from Excel. Its department is set in the Workflow Designer.')}<div id="xg"></div></div>`;
  editableGrid({ el: main.querySelector('#lg'), rows: d.lines, readOnly: !d.can_edit, allowAdd: d.can_edit, what: 'service lines', newRow: () => ({ status: 'Active', sort_order: (d.lines.length + 1) * 10 }),
    rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''), columns: [
      { field: 'line_name', title: 'Service line', width: 200, required: true },
      { field: 'sort_order', title: 'Order', type: 'int', width: 70 },
      { field: 'status', title: 'Status', type: 'select', width: 95, options: ['Active', 'Inactive'] }],
    save: (rows, reason) => api('/service-lines', { method: 'POST', body: { rows, reason } }), afterSave: () => linesTab(main) });
  editableGrid({ el: main.querySelector('#tg'), rows: d.types, readOnly: !d.can_edit, allowAdd: d.can_edit, what: 'service line types', newRow: () => ({ status: 'Active', sort_order: 10 }),
    rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''), columns: [
      { field: 'service_line_id', title: 'Service line', type: 'select', width: 170, required: true, editable: (r, isNew) => isNew,
        options: () => d.lines.map((l) => ({ value: l.id, label: l.line_name })), format: (v) => (d.lines.find((l) => l.id === v) || {}).line_name || '' },
      { field: 'type_name', title: 'Type', width: 190, required: true },
      { field: 'sort_order', title: 'Order', type: 'int', width: 70 },
      { field: 'status', title: 'Status', type: 'select', width: 95, options: ['Active', 'Inactive'] },
      { field: 'test_count', title: 'Tests here', type: 'readonly', width: 80 }],
    save: (rows, reason) => api('/service-lines/types', { method: 'POST', body: { rows, reason } }), afterSave: () => linesTab(main) });
  editableGrid({ el: main.querySelector('#xg'), rows: tests, search: true, readOnly: !d.can_edit, what: 'the service line types of tests', columns: [
    { field: 'test_code', title: 'Code', type: 'link', width: 85, href: (r) => '#/catalog/' + r.id },
    { field: 'test_name', title: 'Test', type: 'readonly', width: 260 },
    { field: 'department_name', title: 'Department', type: 'readonly', width: 140 },
    { field: 'service_line_type_id', title: 'Service line > type', type: 'select', width: 280,
      options: () => [{ value: null, label: '' }, ...d.types.filter((t) => t.status === 'Active').map((t) => ({ value: t.id, label: `${t.line_name} > ${t.type_name}` }))], format: typeLabel }],
    save: (rows, reason) => api('/service-lines/tests', { method: 'POST', body: { rows, reason } }), afterSave: () => linesTab(main) });
}

export async function editor(main, testId) {
  const [d, schedules, analytes] = await Promise.all([api('/catalog/' + testId), api('/rush-schedules'), api('/analytes')]);
  const e = d.entry; const en = state.meta.enums;
  const form = {
    test_name: d.test.test_name, status: d.test.status, serving_role: d.test.serving_role || '', service_line_type_id: d.test.service_line_type_id || '', description: e.description || '', pricing_mode: e.pricing_mode,
    base_price: e.base_price, prep_fee: e.prep_fee, standard_tat: e.standard_tat, tat_unit: e.tat_unit,
    cutoff_time: (e.cutoff_time || '').slice(0, 5), rush_schedule_id: e.rush_schedule_id || '', show_in_public_catalogue: e.show_in_public_catalogue,
  };
  let orig = null; // captured after the form is first read, so number/text formatting never counts as a change
  main.innerHTML = pageHeader(d.test.test_name, `<a href="#/catalog/${testId}">${esc(d.test.test_code)}</a> ${badge(d.test.status)} · Test Workflow Designer · Step 1 of 5: Pricing and turnaround`,
    '<a class="btn ghost" href="#/catalog">Catalogue</a> <button class="btn primary" id="save">Save</button>', { kind: 'test', id: testId }) + `
  <div class="steps"><span class="on">1 Pricing and TAT</span><span>2 Method and analytes</span><span>3 Workflow steps</span><span>4 Calculations and limits</span><span>5 Review and approve</span></div>
  <div class="cols">
    <div class="card">
      <h2>Pricing</h2>
      <div class="frm">
        <label>Test name<input data-f="test_name" value="${esc(form.test_name)}"></label>
        <label>Description<input data-f="description" value="${esc(form.description)}"></label>
        <label>Serving test<select data-f="serving_role" id="f_serving_role">${[['', 'No: an ordinary test'], ['Serving weight', 'Serving weight (its result is the average unit weight)'], ['Density', 'Density (g/mL)']].map(([v, l]) => `<option value="${v}" ${v === form.serving_role ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
          <small>Its approved result is fed back to the sample for results per serving (ordered by the "Per serving" tick on an order).</small></label>
        <label>Service line > type<select data-f="service_line_type_id"><option value=""></option>${(d.service_line_types || []).map((t) => `<option value="${esc(t.id)}" ${t.id === form.service_line_type_id ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
          <small>Where the order's test picker lists this test (Test catalogue > Service lines).</small></label>
        <div class="radios">${en.pricing_mode.map((m) => `<label class="radio"><input type="radio" name="pm" value="${esc(m)}" ${m === form.pricing_mode ? 'checked' : ''}>
          <b>${esc(m)}</b><small>${{ 'Base Price Only': 'One price for the whole test.', 'Base + Preparation Fee': 'Base price plus a preparation fee.', 'Analyte Selection': 'Each analyte has a price and can be switched on or off. Base and prep fee are added if filled in.' }[m]}</small></label>`).join('')}</div>
        <div class="row3">
          <label>Base price<input data-f="base_price" inputmode="decimal" value="${esc(form.base_price)}"></label>
          <label class="pf">Preparation fee<input data-f="prep_fee" inputmode="decimal" value="${esc(form.prep_fee)}"></label>
          <div class="listprice"><span>List price</span><b id="lp"></b><small id="lpd"></small></div>
        </div>
      </div>
    </div>
    <div class="card">
      <h2>Turnaround and rush</h2>
      <div class="frm">
        <div class="row3">
          <label>Standard TAT (maximum)<input data-f="standard_tat" inputmode="numeric" value="${esc(form.standard_tat)}"></label>
          <label>Unit<select data-f="tat_unit">${en.tat_unit.map((u) => `<option ${u === form.tat_unit ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
          <label>Cutoff time<input data-f="cutoff_time" type="time" value="${esc(form.cutoff_time)}"></label>
        </div>
        <p class="help">Day 0 is the day the test is logged. Logged after the cutoff (site local time), Day 0 moves to the next working day. The test still goes straight into the testing pool.</p>
        <label>Rush fee schedule<select data-f="rush_schedule_id"><option value="">No rush available</option>${schedules.map((s) => `<option value="${s.id}" ${s.id === form.rush_schedule_id ? 'selected' : ''}>${esc(s.schedule_name)}</option>`).join('')}</select></label>
        <label class="cb"><input type="checkbox" data-f="show_in_public_catalogue" ${form.show_in_public_catalogue ? 'checked' : ''}> Show in public catalogue</label>
        <label>Test status<select data-f="status"><option ${form.status === 'Active' ? 'selected' : ''}>Active</option><option ${form.status === 'Retired' ? 'selected' : ''}>Retired</option></select></label>
      </div>
    </div>
  </div>
  <div class="card" id="anCard">${section('Analyte prices', 'Used when the pricing mode is Analyte Selection. Paste analyte names and prices straight from Excel, or set one price and fill down.',
    '<button class="btn" id="addAn">+ Add analytes</button>')}<div id="ag"></div></div>
  <div class="card">${section('Rush tiers for this test', 'Each tier uses the schedule\'s approval default unless you override it for this test. Changing the schedule takes effect after saving.')}<div id="rg"></div></div>
  <div class="card"><h2>Test versions</h2><p class="help">Scientific content (method, analytes, workflow, formulas) is versioned in the Workflow Designer. Price changes never create a new version.</p>
    ${d.versions.map((v) => `Version ${v.version_no} ${badge(v.status)}`).join(' · ')}
    ${d.versions.some((v) => v.status === 'Effective') ? '' : '<div class="notice" style="margin-top:10px">This test has no Effective version, so it cannot be ordered yet. Its version is built and approved in the Workflow Designer.</div>'}
    <div style="margin-top:10px"><a class="btn" href="#/methods/tests/${testId}">Open in the Workflow Designer</a></div></div>`;

  const ag = new Grid(main.querySelector('#ag'), {
    rows: d.analytes, allowAdd: true, newRow: () => ({ status: 'Active', price: null }), onChange: refresh,
    columns: [
      { field: 'analyte_id', title: 'Analyte', type: 'select', width: 230, required: true, editable: (r, isNew) => isNew,
        options: () => analytes.filter((a) => a.status === 'Active').map((a) => ({ value: a.id, label: a.analyte_name })) },
      { field: 'analyte_class', title: 'Class', type: 'readonly', width: 140, compute: (r) => (analytes.find((a) => a.id === r.analyte_id) || {}).analyte_class || '' },
      { field: 'price', title: 'Price', type: 'money', min: 0, width: 110, required: true },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 100 },
      { field: 'analyte_code', title: 'Analyte code', type: 'link', width: 105, compute: (r) => r.analyte_code || (analytes.find((a) => a.id === r.analyte_id) || {}).analyte_code || '',
        href: (r) => { const c = r.analyte_code || (analytes.find((a) => a.id === r.analyte_id) || {}).analyte_code; return c ? '#/analytes?find=' + encodeURIComponent(c) : null; } },
    ],
  });
  const tierRows = (d.tiers || []).map((t) => ({ ...t }));
  const rg = new Grid(main.querySelector('#rg'), {
    rows: tierRows, emptyText: 'No rush schedule assigned.', onChange: refresh,
    columns: [
      { field: 'tier_name', title: 'Tier', type: 'readonly', width: 170 },
      { field: 'rush_tat', title: 'Rush TAT', type: 'readonly', width: 130, format: (v, r) => `${v} ${r.tat_unit === 'Business Days' ? 'business' : 'calendar'} days` },
      { field: 'surcharge_value', title: 'Surcharge', type: 'readonly', width: 100, format: (v, r) => (r.surcharge_type === 'Flat' ? money(v) : v + '%') },
      { field: 'schedule_default', title: 'Schedule default', type: 'readonly', width: 140, format: (v) => (v ? 'Needs approval' : 'No approval') },
      { field: 'override', title: 'This test', type: 'select', width: 190,
        options: [{ value: true, label: 'Needs approval' }, { value: false, label: 'No approval needed' }],
        format: (v) => (v === null || v === undefined ? 'Use schedule default' : v ? 'Needs approval' : 'No approval needed') },
      { field: 'effective', title: 'Result', type: 'readonly', width: 130, compute: (r) => (r.override === null || r.override === undefined ? r.schedule_default : r.override), format: (v) => (v ? 'Intake approves' : 'Auto-accepted') },
    ],
  });

  function read() {
    main.querySelectorAll('[data-f]').forEach((el) => { form[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value; });
    form.pricing_mode = main.querySelector('input[name=pm]:checked').value;
  }
  function refresh() {
    read();
    const base = Number(form.base_price) || 0; const prep = Number(form.prep_fee) || 0;
    const m = form.pricing_mode;
    main.querySelector('.pf').style.opacity = m === 'Base Price Only' ? 0.4 : 1;
    main.querySelector('[data-f=prep_fee]').disabled = m === 'Base Price Only';
    main.querySelector('#anCard').style.display = m === 'Analyte Selection' ? '' : 'none';
    const an = ag.rows.filter((r) => r.status !== 'Inactive' && typeof r.price === 'number');
    const sum = an.reduce((s, r) => s + r.price, 0);
    const lp = base + (m === 'Base Price Only' ? 0 : prep) + (m === 'Analyte Selection' ? sum : 0);
    main.querySelector('#lp').textContent = money(lp);
    main.querySelector('#lpd').textContent = m === 'Base Price Only' ? 'base' : m === 'Base + Preparation Fee' ? `${money(base)} base + ${money(prep)} prep` :
      `${money(base)} base + ${money(prep)} prep + ${an.length} analytes (${money(sum)})`;
  }
  main.querySelectorAll('[data-f], input[name=pm]').forEach((el) => el.addEventListener('input', refresh));
  main.querySelectorAll('input[name=pm]').forEach((el) => el.addEventListener('change', () => {
    if (el.value === 'Base Price Only') main.querySelector('[data-f=prep_fee]').value = 0; refresh(); }));
  refresh();
  orig = JSON.stringify(form);
  const dirty = () => { read(); return JSON.stringify(form) !== orig || ag.changeCount() > 0 || rg.changeCount() > 0; };
  setDirtyCheck(dirty);

  main.querySelector('#addAn').onclick = async () => {
    const have = new Set(ag.rows.map((r) => r.analyte_id));
    const avail = analytes.filter((a) => a.status === 'Active' && !have.has(a.id));
    const v = await modal({ title: 'Add analytes', okText: 'Add', wide: true,
      html: `<div class="picklist">${avail.map((a) => `<label class="cb"><input type="checkbox" value="${a.id}"> ${esc(a.analyte_name)} <small>${esc(a.analyte_class)}</small></label>`).join('') || 'All analytes are already on this test.'}</div>`,
      fields: [{ name: 'price', label: 'Starting price for each (change afterwards with fill down)', value: '0' }],
      collect: (m) => ({ picked: [...m.querySelectorAll('.picklist input:checked')].map((x) => x.value) }) });
    if (!v || !v.picked.length) return;
    v.picked.forEach((id) => { ag.rows.push({ analyte_id: id, price: Number(v.price) || 0, status: 'Active' }); ag.orig.push({}); ag.isNew.push(true); });
    ag._view(); ag.render(); refresh();
  };

  main.querySelector('#save').onclick = async () => {
    read();
    if (ag.hasErrors() || rg.hasErrors()) { toast('Fix the cells marked in red first.', 'err'); return; }
    if (!dirty()) { toast('Nothing to save.'); return; }
    const reason = await askReason(`catalogue terms for ${d.test.test_code}`); if (!reason) return;
    const body = {
      reason,
      test: { test_name: form.test_name, status: form.status, serving_role: form.serving_role || null, service_line_type_id: form.service_line_type_id || null },
      entry: { description: form.description, pricing_mode: form.pricing_mode, base_price: Number(form.base_price) || 0,
        prep_fee: form.pricing_mode === 'Base Price Only' ? 0 : Number(form.prep_fee) || 0, standard_tat: Number(form.standard_tat),
        tat_unit: form.tat_unit, cutoff_time: form.cutoff_time, rush_schedule_id: form.rush_schedule_id || null,
        show_in_public_catalogue: form.show_in_public_catalogue },
      analytes: ag.getChanges(),
      approvals: rg.getChanges().map((r) => ({ tier_id: r.id, override: r.override })),
    };
    try { await api('/catalog/' + testId, { method: 'PUT', body }); setDirtyCheck(null); toast('Saved.'); editor(main, testId); } catch (err) { toast(err.message, 'err'); }
  };
}
