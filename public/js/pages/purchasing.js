// Purchasing (Phase 1, migration 011): the request queue (approve, reject, order), each request with its receipts,
// receiving (partial deliveries, problems, packing slips, equipment into the register), purchase orders, suppliers with
// their qualification history, the supplier risk classes, and each lab's purchasing settings.
import { api, esc, pageHeader, toast, modal, state, currentSite, badge, link, signDialog, can } from '../app.js';
import { Grid } from '../grid.js';
import { editableGrid, section } from './common.js';

const signed = (opts, fn) => signDialog({ ...opts, submit: ({ reason, signature }) => fn(reason, signature) });

const css = document.createElement('style');
css.textContent = `
.putabs { display: flex; gap: 6px; flex-wrap: wrap; margin: -4px 0 14px; }
.putabs a { text-decoration: none; border: 1px solid var(--line); background: #fff; color: var(--ink); padding: 6px 12px; border-radius: 7px; font-size: 13.5px; }
.putabs a.on { background: var(--green-700); border-color: var(--green-700); color: #fff; }
.pubar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; } .pubar .sp { flex: 1; }
table.grid td.cbad { background: #FDECEA; color: var(--err-ink); font-weight: 600; }
table.grid td.cwarn { background: #FFF4DE; color: var(--warn-ink); font-weight: 600; }
table.grid td.cok { color: var(--green-700); font-weight: 600; }
.statcards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
.statcard { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; background: #fff; }
.statcard span { display: block; color: var(--muted); font-size: 12.5px; } .statcard b { font-size: 16px; }
.statcard.alert { background: #FFF4DE; border-color: #F3D19C; } .statcard.alert b { color: var(--warn-ink); }
.statcard.deficient { background: #FDECEA; border-color: #F5B5AE; } .statcard.deficient b { color: var(--err-ink); }
.statcard.conforms b { color: var(--green-700); }
.actbar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
.eyebrow { color: var(--muted); font-size: 12.5px; font-weight: 600; letter-spacing: .3px; margin-bottom: -2px; }
.s-Approved { color: var(--green-700); font-weight: 700; } .s-Expired, .s-Suspended, .s-Not { color: var(--err-ink); font-weight: 700; }
@media (max-width: 900px) { .statcards { grid-template-columns: 1fr; } }
`;
document.head.appendChild(css);

const d8 = (v) => (v ? String(v).slice(0, 10) : '');
const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '');
const money = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
const num = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 6 }));
const today = () => { const t = new Date(); t.setMinutes(t.getMinutes() - t.getTimezoneOffset()); return t.toISOString().slice(0, 10); };
const kv = (pairs) => `<dl class="kv">${pairs.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v === null || v === undefined || v === '' ? '—' : v}</dd>`).join('')}</dl>`;
const supCls = (s) => (s === 'Approved' ? 'cok' : s ? 'cbad' : '');
const statCls = (s) => (['Awaiting second approval', 'Requested'].includes(s) ? 'cwarn' : s === 'Rejected' ? 'cbad' : ['Received'].includes(s) ? 'cok' : '');
const DISCREPANCIES = ['None', 'Damaged', 'Temperature excursion', 'Short shipped', 'Wrong item', 'Other'];

function needLab(main) {
  if (currentSite()) return true;
  main.innerHTML = '<div class="card err">Choose your lab (top right) first.</div>';
  return false;
}
async function fileToBase64(file) {
  const buf = await file.arrayBuffer(); let bin = ''; const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const TABS = [['#/purchasing', 'Requests'], ['#/purchasing/receive', 'Receive'], ['#/purchasing/orders', 'Purchase orders'],
  ['#/purchasing/suppliers', 'Vendor approvals'], ['#/purchasing/risk-classes', 'Risk classes and scopes'], ['#/purchasing/settings', 'Settings']];
const tabs = (cur) => `<div class="putabs">${TABS.map(([h, l]) => `<a href="${h}" class="${h === cur ? 'on' : ''}">${esc(l)}</a>`).join('')}</div>`;

// ================================================================ THE REQUEST QUEUE
const FILTERS = {
  approve: ['To approve', (r) => ['Requested', 'Awaiting second approval'].includes(r.status)],
  order: ['Approved, to order', (r) => r.status === 'Approved'],
  receive: ['Ordered, to receive', (r) => ['Ordered', 'Partly received'].includes(r.status)],
  mine: ['My requests', (r) => r.mine],
  all: ['All', () => true],
};
const LINE_COLS = (withPick) => [
  ...(withPick ? [{ field: '_pick', title: '☐', type: 'bool', width: 40, help: 'Tick requests to approve, reject or order together' }] : []),
  { field: 'line_code', title: 'Request', type: 'link', width: 95, href: (r) => '#/purchasing/requests/' + r.id },
  { field: 'status', title: 'Status', type: 'readonly', width: 150, cellClass: (r) => statCls(r.status) },
  { field: 'line_type', title: 'Kind', type: 'readonly', width: 105 },
  { field: 'description', title: 'What', type: 'readonly', width: 220 },
  { field: 'supplier_name', title: 'Supplier', type: 'readonly', width: 170, format: (v, r) => (v ? v + (r.supplier_status !== 'Approved' ? ` (${r.supplier_status})` : '') : 'No supplier yet'), cellClass: (r) => (r.supplier_id && r.supplier_status !== 'Approved' ? 'cbad' : '') },
  { field: 'qty', title: 'Quantity', type: 'readonly', width: 90, compute: (r) => `${num(r.quantity)} ${r.unit || ''}`.trim() },
  { field: 'amount', title: 'Amount', type: 'readonly', width: 95, align: 'right', format: (v, r) => (v === null ? 'No price' : money(v) + (r.needs_second ? ' *' : '')) },
  { field: 'requested_by_name', title: 'Requested by', type: 'readonly', width: 140 },
  { field: 'requested_at', title: 'Requested', type: 'readonly', width: 95, format: d8 },
  { field: 'po_code', title: 'Order', type: 'link', width: 110, href: (r) => (r.purchase_order_id ? '#/purchasing/orders/' + r.purchase_order_id : null), format: (v, r) => (v ? v + (r.external_po_number ? ' / ' + r.external_po_number : '') : '') },
  { field: 'scope_text', title: 'For', type: 'readonly', width: 170, help: 'What the request is for (its supply scope): the vendor must be approved for it' },
];

export async function requests(main) {
  if (!needLab(main)) return;
  const [d, me] = await Promise.all([api('/purchasing/lines'), api('/purchasing/me')]);
  const site = currentSite();
  const f = FILTERS[state.query.get('show')] ? state.query.get('show') : 'approve';
  const over = d.setting && d.setting.second_approval_over !== null ? Number(d.setting.second_approval_over) : null;
  main.innerHTML = pageHeader(`Purchasing: ${site.site_code}`, `Every purchase request in ${esc(site.site_name)}: inventory items (from Inventory), equipment, services and other items. Approve, then group approved requests of one supplier into an order with the finance PO number. ${over !== null ? `Requests above ${money(over)} also need a General Manager's approval (marked *).` : 'No second approval amount is set for this lab.'} Nobody approves their own request.`,
    '', { kind: 'purchasing' }) + tabs('#/purchasing') + `
    <div class="pubar">${Object.entries(FILTERS).map(([k, [l, fn]]) => `<a class="tab ${k === f ? 'on' : ''}" href="#/purchasing?show=${k}" style="text-decoration:none">${esc(l)} <small>${d.rows.filter(fn).length}</small></a>`).join('')}
      <span class="sp"></span>
      ${me.can_approve || me.can_approve_over ? '<button class="btn" id="approve">Approve ticked</button><button class="btn" id="reject">Reject ticked</button>' : ''}
      ${me.can_order ? '<button class="btn" id="order">Order ticked</button>' : ''}
      ${me.can_request ? '<button class="btn primary" id="new">+ New request</button>' : ''}</div>
    <div class="help" style="margin-bottom:8px">Inventory items are requested from Inventory (+ New Inventory Item as a request, or Reorder on any item); they appear here too.</div>
    <div id="g"></div>`;
  const rows = d.rows.filter(FILTERS[f][1]).map((r) => ({ ...r, _pick: false }));
  const g = new Grid(main.querySelector('#g'), { rows, search: true, filter: state.query.get('find') || '', emptyText: 'Nothing here.', onRowOpen: (r) => { location.hash = '#/purchasing/requests/' + r.id; },
    rowClass: (r) => (['Cancelled', 'Rejected', 'Received'].includes(r.status) ? 'mutedrow' : ''), columns: LINE_COLS(true) });
  const picked = () => g.rows.filter((r) => r._pick);
  const need = () => { const p = picked(); if (!p.length) toast('Tick the requests first.', 'err'); return p; };
  const reload = () => requests(main);
  const q = (id) => main.querySelector('#' + id);
  if (q('new')) q('new').onclick = () => newRequest(() => reload());
  if (q('approve')) q('approve').onclick = async () => {
    const p = need(); if (!p.length) return;
    const ok = await signed({ what: `Approve ${p.map((x) => x.line_code).join(', ')}`, meaning: 'Approved by', needReason: false },
      (reason, signature) => api('/purchasing/approve', { method: 'POST', body: { ids: p.map((x) => x.id), signature } }));
    if (ok) { toast('Approved and signed.'); reload(); }
  };
  if (q('reject')) q('reject').onclick = async () => {
    const p = need(); if (!p.length) return;
    const ok = await signed({ what: `Reject ${p.map((x) => x.line_code).join(', ')}`, meaning: 'Rejected by', needReason: true },
      (reason, signature) => api('/purchasing/reject', { method: 'POST', body: { ids: p.map((x) => x.id), reason, signature } }));
    if (ok) { toast('Rejected and signed.'); reload(); }
  };
  if (q('order')) q('order').onclick = async () => { const p = need(); if (!p.length) return; if (await placeOrder(p)) reload(); };
}

async function placeOrder(lines) {
  const sup = [...new Set(lines.map((x) => x.supplier_name))];
  const v = await modal({ title: 'Place an order', okText: 'Next: sign',
    intro: `${lines.length} request(s) for ${esc(sup.join(', ') || 'no supplier')}. One order goes to one supplier. Enter the PO number from the finance system if there is one (it can be added later).`,
    fields: [{ name: 'external_po_number', label: 'Finance PO number' }, { name: 'confirmation_number', label: "Supplier's order confirmation" }, { name: 'notes', label: 'Notes' }] });
  if (!v) return false;
  const r = await signed({ what: `Order ${lines.map((x) => x.line_code).join(', ')} from ${sup.join(', ')}${v.external_po_number ? ' (PO ' + v.external_po_number + ')' : ''}`, meaning: 'Ordered by', needReason: false },
    (reason, signature) => api('/purchasing/orders', { method: 'POST', body: { line_ids: lines.map((x) => x.id), ...v, signature } }));
  if (r) toast(`Order ${r.po_code} placed and signed.`);
  return !!r;
}

async function supplierOptions() {
  const sup = await api('/purchasing/suppliers');
  return sup.filter((s) => s.supplier_record_status === 'Active' && s.supplier_type !== 'Manufacturer')
    .map((s) => ({ value: s.supplier_id, label: s.supplier_name + (s.approval_status === 'Approved' ? '' : ` (${s.approval_status}: cannot order)`) }));
}

// the scopes a service or other purchase can be for (V-1): offered by kind, the default first
async function scopeOptions() {
  const all = await api('/purchasing/scopes');
  return all.filter((x) => x.status === 'Active' && (x.line_types.includes('Service') || x.line_types.includes('Other')))
    .map((x) => ({ value: x.id, label: `${x.line_types.includes('Service') ? 'Service' : 'Other'}: ${x.scope_name}${x.default_for ? ' (default)' : ''}` }));
}
async function newRequest(done) {
  const [opts, scopes] = await Promise.all([supplierOptions(), scopeOptions()]);
  const v = await modal({ title: 'New purchase request', okText: 'Next: sign', wide: true,
    intro: 'For equipment, services (for example a calibration visit) and other items such as supplies. An "Other" item can be put into inventory when it is received (tick it on the Receive form); chemicals, standards and media with analytes are best requested from Inventory.',
    fields: [
      { name: 'line_type', label: 'Kind', type: 'select', options: ['Equipment', 'Service', 'Other'], value: 'Equipment', blank: false },
      { name: 'description', label: 'What', required: true }, { name: 'supplier_id', label: 'Supplier', type: 'select', options: opts },
      { name: 'scope_id', label: 'For (services and other purchases)', type: 'select', options: scopes, help: 'What the vendor must be approved for. Equipment is always "Equipment"; left empty, a service is "Other services" and another purchase "Other purchases".' },
      { name: 'catalog_number', label: 'Catalog / quote number' }, { name: 'item_url', label: 'Web link to the item (optional)', type: 'url', help: 'The item\'s page on the supplier\'s website, e.g. https://…' },
      { name: 'quantity', label: 'Quantity', type: 'number', value: 1, required: true },
      { name: 'unit', label: 'Unit', value: 'each' }, { name: 'unit_price', label: 'Estimated price per unit (USD)', type: 'number' },
      { name: 'needed_by', label: 'Needed by', type: 'date' }, { name: 'justification', label: 'Why it is needed', type: 'textarea' },
    ] });
  if (!v) return;
  const r = await signed({ what: `Purchase request: ${v.description}`, meaning: 'Requested by', needReason: false },
    (reason, signature) => { const { scope_id: sc, ...row } = v; return api('/purchasing/lines', { method: 'POST', body: { row: { ...row, scope_ids: sc && v.line_type !== 'Equipment' ? [sc] : null, quantity: Number(v.quantity), unit_price: v.unit_price === '' ? null : Number(v.unit_price), item_url: v.item_url || null }, signature } }); });
  if (r) { toast(`Request ${r.line_code} created and signed.`); location.hash = '#/purchasing/requests/' + r.id; }
  else if (done) done();
}

// ================================================================ ONE REQUEST
export async function request(main, id) {
  const [d, me] = await Promise.all([api('/purchasing/lines/' + id), api('/purchasing/me')]);
  const l = d.line;
  const open = ['Requested', 'Awaiting second approval'].includes(l.status);
  const btn = (key, label, show, primary) => (show ? `<button class="btn ${primary ? 'primary' : ''}" data-act="${key}">${esc(label)}</button>` : '');
  const left = Number(l.quantity) - Number(l.received_quantity);
  main.innerHTML = `<div class="eyebrow">${esc(l.line_code)} · ${esc(l.site_code)} · ${esc(l.line_type)}</div>` + pageHeader(l.description, badge(l.status),
    '<a class="btn ghost" href="#/purchasing">All requests</a>', { kind: 'purchaseline', id }) + `
    <div class="actbar">
      ${btn('approve', l.status === 'Awaiting second approval' ? 'Give second approval' : 'Approve', open && (l.status === 'Requested' ? me.can_approve : me.can_approve_over), true)}
      ${btn('reject', 'Reject', open && me.can_approve)}
      ${btn('order', 'Order', l.status === 'Approved' && me.can_order, true)}
      ${btn('receive', 'Receive', ['Ordered', 'Partly received'].includes(l.status) && me.can_receive, true)}
      ${btn('edit', 'Change', open && l.line_type !== 'Inventory item')}
      ${btn('cancel', 'Cancel request', ['Requested', 'Awaiting second approval', 'Approved'].includes(l.status))}
    </div>
    ${l.supplier_id && l.supplier_status !== 'Approved' && !['Received', 'Cancelled', 'Rejected'].includes(l.status) ? `<div class="notice">${esc(l.supplier_name)} is ${esc(l.supplier_status.toLowerCase())} for this lab: this request cannot be approved or ordered until QA qualifies the supplier.</div>` : ''}
    ${l.status === 'Rejected' ? `<div class="notice">Rejected: ${esc(l.rejected_reason || '')}</div>` : ''}
    <div class="statcards">
      <div class="statcard ${['Requested', 'Awaiting second approval'].includes(l.status) ? 'alert' : l.status === 'Rejected' ? 'deficient' : 'conforms'}"><span>Status</span><b>${esc(l.status)}</b></div>
      <div class="statcard ${l.needs_second ? 'alert' : ''}"><span>Amount</span><b>${l.amount === null ? 'No price given' : esc(money(l.amount))}${l.needs_second ? ' (second approval)' : ''}</b></div>
      <div class="statcard"><span>Received</span><b>${esc(num(l.received_quantity))} of ${esc(num(l.quantity))} ${esc(l.unit || '')}</b></div>
      ${l.actual_amount !== null && l.actual_amount !== undefined ? `<div class="statcard"><span>Actually paid (received so far)</span><b>${esc(money(l.actual_amount))}</b></div>` : ''}
    </div>
    <div class="cols">
      <div class="card"><h2>Request</h2>${kv([
        ['Kind', esc(l.line_type)], ['What', esc(l.description)], ['For', esc(l.scope_text || '')], ['Supplier', l.supplier_id ? link('#/purchasing/suppliers/' + l.supplier_id, l.supplier_name) + ` <span class="${l.supplier_status === 'Approved' ? 'okc' : 'bad'}">(${esc(l.supplier_status)})</span>` : ''],
        ['Catalog / quote #', esc(l.catalog_number)],
        ['Web link', l.item_url ? `<a href="${esc(l.item_url)}" target="_blank" rel="noopener">${esc(l.item_url.replace(/^https?:\/\//, '').slice(0, 60))}</a>` : ''],
        ['Quantity', esc(`${num(l.quantity)} ${l.unit || ''}`)], ['Estimated price per unit', esc(money(l.unit_price))],
        ['Needed by', esc(d8(l.needed_by))], ['Why', esc(l.justification)],
        ['Inventory item', l.lot_code ? d.lots.map((x) => link('#/inventory/lots/' + x.id, x.lot_code) + ` (${esc(x.receipt_status)})`).join(', ') : ''],
        ['Equipment', l.equipment_id ? link('#/equipment/' + l.equipment_id, l.equipment_code) : '']])}</div>
      <div class="card"><h2>Approvals and order</h2>${kv([
        ['Requested', `${esc(l.requested_by_name)} ${esc(dt(l.requested_at))}`], ['Approved', l.approved_by ? `${esc(l.approved_by_name)} ${esc(dt(l.approved_at))}` : ''],
        ['Second approval', l.approved2_by ? `${esc(l.approved2_by_name)} ${esc(dt(l.approved2_at))}` : l.needs_second ? 'Needed (General Manager)' : 'Not needed'],
        ['Order', l.purchase_order_id ? link('#/purchasing/orders/' + l.purchase_order_id, l.po_code) + (l.external_po_number ? ` (finance PO ${esc(l.external_po_number)})` : '') : '']])}</div>
    </div>
    <div class="card">${section('Receipts', 'Each delivery against this request: how much, any problem, and the packing slip. What is not yet received stays open as a back-order.')}<div id="rg"></div></div>`;
  new Grid(main.querySelector('#rg'), { readOnly: true, rows: d.receipts, emptyText: 'Nothing received yet.', columns: [
    { field: 'receipt_code', title: 'Receipt', type: 'readonly', width: 95 }, { field: 'received_at', title: 'When', type: 'readonly', width: 140, format: dt },
    { field: 'quantity', title: 'Quantity', type: 'readonly', width: 80, format: (v) => `${num(v)} ${l.unit || ''}` },
    { field: 'actual_unit_price', title: 'Actual price / unit', type: 'readonly', width: 120, format: (v) => (v === null || v === undefined ? '' : money(v)) },
    { field: 'discrepancy', title: 'Problem', type: 'readonly', width: 150, cellClass: (r) => (r.discrepancy !== 'None' ? 'cwarn' : '') },
    { field: 'note', title: 'Note', type: 'readonly', width: 260 },
    { field: 'lot_code', title: 'Item', type: 'link', width: 100, href: (r) => (r.lot_id ? '#/inventory/lots/' + r.lot_id : r.equipment_id ? '#/equipment/' + r.equipment_id : null), format: (v, r) => v || r.equipment_code || '' },
    { field: 'slip_name', title: 'Packing slip', type: 'link', width: 150, href: (r) => (r.packing_slip_id ? `/api/purchasing/receipts/${r.id}/slip?s=${encodeURIComponent(state.site || '')}` : null) },
    { field: 'received_by', title: 'Received by', type: 'readonly', width: 140 }] });
  main.querySelectorAll('#rg a[data-link]').forEach((a) => { if (a.getAttribute('href').startsWith('/api/')) a.target = '_blank'; });

  const reload = () => request(main, id);
  const post = (path, body) => (reason, signature) => api(path, { method: 'POST', body: { ...body, reason, signature } });
  const act = async (key) => {
    try {
      let done = null;
      if (key === 'approve') done = await signed({ what: `${l.status === 'Awaiting second approval' ? 'Second approval' : 'Approve'} ${l.line_code} ${l.description}${l.amount !== null ? ' (' + money(l.amount) + ')' : ''}`, meaning: 'Approved by', needReason: false }, post('/purchasing/approve', { ids: [l.id] }));
      if (key === 'reject') done = await signed({ what: `Reject ${l.line_code} ${l.description}`, meaning: 'Rejected by', needReason: true }, post('/purchasing/reject', { ids: [l.id] }));
      if (key === 'order') done = await placeOrder([l]);
      if (key === 'receive') done = await receiveDialog(l, left);
      if (key === 'cancel') done = await signed({ what: `Cancel ${l.line_code} ${l.description}`, meaning: 'Cancelled by', needReason: true },
        (reason, signature) => api('/purchasing/lines/' + l.id, { method: 'PUT', body: { row: { status: 'Cancelled' }, reason, signature } }));
      if (key === 'edit') {
        const opts = await supplierOptions();
        const v = await modal({ title: `Change ${l.line_code}`, okText: 'Next: sign', intro: 'A change after the first approval sends the request back for approval.',
          fields: [{ name: 'description', label: 'What', value: l.description, required: true }, { name: 'supplier_id', label: 'Supplier', type: 'select', options: opts, value: l.supplier_id || '' },
            { name: 'catalog_number', label: 'Catalog / quote number', value: l.catalog_number || '' }, { name: 'item_url', label: 'Web link to the item', type: 'url', value: l.item_url || '' },
            { name: 'quantity', label: 'Quantity', type: 'number', value: l.quantity, required: true },
            { name: 'unit_price', label: 'Estimated price per unit (USD)', type: 'number', value: l.unit_price ?? '' }, { name: 'needed_by', label: 'Needed by', type: 'date', value: d8(l.needed_by) },
            { name: 'justification', label: 'Why it is needed', type: 'textarea', value: l.justification || '' }] });
        if (!v) return;
        done = await signed({ what: `Changes to ${l.line_code}`, meaning: 'Changed by', needReason: true },
          (reason, signature) => api('/purchasing/lines/' + l.id, { method: 'PUT', body: { row: { ...v, quantity: Number(v.quantity), unit_price: v.unit_price === '' ? null : Number(v.unit_price), supplier_id: v.supplier_id || null, item_url: v.item_url || null }, reason, signature } }));
      }
      if (done) { toast('Saved and signed.'); reload(); }
    } catch (e) { toast(e.message, 'err'); }
  };
  main.querySelectorAll('[data-act]').forEach((b) => { b.onclick = () => act(b.dataset.act); });
}

// Receive (part of) a delivery. Inventory: lot number, expiry, location. Equipment: what it is and who is responsible.
async function receiveDialog(l, left) {
  let file = null;
  const fields = [
    { name: 'quantity', label: `Quantity received (${l.unit || 'units'}; ${num(left)} still expected)`, type: 'number', value: left, required: true },
    { name: 'more_to_come', label: 'More to come?', type: 'checkbox', cbLabel: 'Yes: keep the rest open as a back-order', value: false },
    { name: 'discrepancy', label: 'Problem with the delivery', type: 'select', options: DISCREPANCIES, value: 'None', blank: false },
    { name: 'note', label: 'Note (required when there is a problem)', type: 'textarea' },
    { name: 'actual_price', label: `Actual price per ${l.unit || 'unit'} (USD, optional)`, type: 'number', value: '',
      help: `What was really paid, if it differs from the estimate${l.unit_price !== null && l.unit_price !== undefined ? ' (' + money(l.unit_price) + ')' : ''}. Kept on the receipt.` },
  ];
  let L = null; let eqLists = null;
  const intoInv = ['Other', 'Service'].includes(l.line_type);
  if (intoInv) {
    // Alex, 2026-10-13: receiving supplies creates the inventory item, which then opens to be filled out
    fields.push({ name: 'into_inventory', label: 'Put into inventory?', type: 'checkbox', cbLabel: 'Yes: create the inventory item now (it opens next, to fill out)', value: l.line_type === 'Other' },
      { name: 'inv_type', label: 'Inventory type', type: 'select', options: ['Consumable', 'Reagent', 'Solvent', 'Media', 'Reference Standard', 'Microbiological Strain'], value: 'Consumable', blank: false,
        help: 'Media needs qualifying before use; a Reference Standard or Strain needs its analyte (add it on the item next).' },
      { name: 'inv_unit', label: 'Unit in inventory', value: l.unit || 'each', help: 'From the Units list, e.g. case, box, each, L' });
  }
  if (l.line_type === 'Inventory item' || intoInv) {
    L = await api('/inventory/locations');
    fields.push({ name: 'manufacturer_lot', label: intoInv ? 'Lot # (if it has one)' : 'Lot #' }, { name: 'expiration_date', label: 'Expiration date', type: 'date' },
      { name: 'retest_date', label: 'Retest date', type: 'date' },
      { name: 'storage_location_id', label: 'Storage location', type: 'select', options: L.filter((x) => x.status === 'Active').map((x) => ({ value: x.id, label: `${x.location_code}: ${x.path}` })) });
  }
  if (l.line_type === 'Equipment') {
    eqLists = await api('/equipment/lists');
    fields.push({ name: 'equipment_name', label: 'Equipment name', value: l.description, required: true },
      { name: 'equipment_type_id', label: 'Type', type: 'select', options: eqLists.types.filter((t) => t.status === 'Active').map((t) => ({ value: t.id, label: t.type_name })), required: true },
      { name: 'department_id', label: 'Department', type: 'select', options: eqLists.departments.filter((x) => x.status === 'Active').map((x) => ({ value: x.id, label: `${x.department_code} ${x.department_name}` })), required: true },
      { name: 'manufacturer', label: 'Manufacturer' }, { name: 'model', label: 'Model' }, { name: 'serial_number', label: 'Serial number' },
      { name: 'owner_group_id', label: 'Responsible group', type: 'select', options: eqLists.groups.map((g) => ({ value: g.id, label: g.group_name })), required: true });
  }
  const v = await modal({ title: `Receive ${l.line_code}: ${l.description}`, okText: 'Next: sign', wide: true,
    intro: l.line_type === 'Equipment' ? 'The equipment goes into the register tagged out for qualification; it is released after installation and IQ/OQ.' : l.line_type === 'Inventory item' ? 'This completes the inventory item (no second item is made). If part of the order is still to come, tick "More to come".'
      : 'Confirm the service was done or the items arrived. Supplies can go straight into inventory: tick "Put into inventory" and the new item opens to be filled out.',
    fields, html: '<div class="field"><label for="f_slip">Packing slip (optional)</label><input type="file" id="f_slip" accept="application/pdf,image/png,image/jpeg"></div>',
    collect: (m) => { file = m.querySelector('#f_slip')?.files[0] || null; return {}; } });
  if (!v) return false;
  if (v.discrepancy !== 'None' && !v.note) { toast('Describe the problem with the delivery in the note.', 'err'); return false; }
  const body = { quantity: Number(v.quantity), more_to_come: v.more_to_come, discrepancy: v.discrepancy, note: v.note, manufacturer_lot: v.manufacturer_lot,
    expiration_date: v.expiration_date, retest_date: v.retest_date, storage_location_id: v.storage_location_id || null, actual_price: v.actual_price === '' ? null : Number(v.actual_price) };
  if (l.line_type === 'Equipment') body.equipment = { equipment_name: v.equipment_name, equipment_type_id: v.equipment_type_id, department_id: v.department_id, manufacturer: v.manufacturer, model: v.model, serial_number: v.serial_number, owner_group_id: v.owner_group_id };
  if (intoInv && v.into_inventory) body.inventory = { item_name: l.description, chemical_types: [v.inv_type || 'Consumable'], unit: v.inv_unit || null };
  if (file) {
    if (file.size > 3.5 * 1024 * 1024) { toast('The packing slip is larger than 3.5 MB.', 'err'); return false; }
    body.slip = { file_name: file.name, mime_type: file.type || 'application/pdf', content_base64: await fileToBase64(file) };
  }
  const ok = await signed({ what: `Receive ${v.quantity} ${l.unit || ''} on ${l.line_code} ${l.description}${v.discrepancy !== 'None' ? ' (' + v.discrepancy + ')' : ''}${body.inventory ? ' into inventory' : ''}`, meaning: 'Received by', needReason: false },
    (reason, signature) => api(`/purchasing/lines/${l.id}/receive`, { method: 'POST', body: { ...body, signature } }));
  if (ok && body.inventory && ok.lot_id) {
    // the new item opens to be filled out (storage, analytes, COA...)
    toast(`Received and signed. Inventory item ${ok.lot_code} created: fill it out and save.`);
    location.hash = `#/inventory/lots/${ok.lot_id}/edit`;
    return false;
  }
  if (ok) toast('Received and signed.');
  return !!ok;
}

// ================================================================ RECEIVE (what is expected)
export async function receive(main) {
  if (!needLab(main)) return;
  const [d, me] = await Promise.all([api('/purchasing/lines'), api('/purchasing/me')]);
  const site = currentSite();
  const rows = d.rows.filter((r) => ['Ordered', 'Partly received'].includes(r.status));
  main.innerHTML = pageHeader(`Receive: ${site.site_code}`, 'Everything ordered and not yet fully received. Click Receive on a line when the delivery arrives; record any problem and attach the packing slip.', '', { kind: 'purchasing' })
    + tabs('#/purchasing/receive') + '<div id="g"></div>';
  new Grid(main.querySelector('#g'), { rows, readOnly: false, search: true, emptyText: 'Nothing is waiting to be received.', onRowOpen: (r) => { location.hash = '#/purchasing/requests/' + r.id; },
    columns: [
      ...(me.can_receive ? [{ field: '_rcv', title: '', type: 'button', width: 80, label: 'Receive', onClick: async (r) => { if (await receiveDialog(r, Number(r.quantity) - Number(r.received_quantity))) receive(main); } }] : []),
      ...LINE_COLS(false).filter((c) => !['requested_at'].includes(c.field)),
      { field: 'outstanding', title: 'Still expected', type: 'readonly', width: 100, compute: (r) => `${num(Number(r.quantity) - Number(r.received_quantity))} ${r.unit || ''}` },
    ] });
}

// ================================================================ PURCHASE ORDERS
export async function orders(main) {
  if (!needLab(main)) return;
  const rows = await api('/purchasing/orders');
  const site = currentSite();
  main.innerHTML = pageHeader(`Purchase orders: ${site.site_code}`, 'Approved requests grouped by supplier, with the finance PO number and the supplier\'s confirmation.', '', { kind: 'purchasing' })
    + tabs('#/purchasing/orders') + '<div id="g"></div>';
  new Grid(main.querySelector('#g'), { rows, readOnly: true, search: true, emptyText: 'No orders yet.', onRowOpen: (r) => { location.hash = '#/purchasing/orders/' + r.id; }, columns: [
    { field: 'po_code', title: 'Order', type: 'link', width: 120, href: (r) => '#/purchasing/orders/' + r.id },
    { field: 'external_po_number', title: 'Finance PO', type: 'readonly', width: 120 }, { field: 'supplier_name', title: 'Supplier', type: 'readonly', width: 200 },
    { field: 'line_count', title: 'Lines', type: 'readonly', width: 60 }, { field: 'amount', title: 'Amount', type: 'readonly', width: 100, align: 'right', format: money },
    { field: 'receipt_state', title: 'Received', type: 'readonly', width: 120, cellClass: (r) => (r.receipt_state === 'Received' ? 'cok' : r.receipt_state === 'Partly received' ? 'cwarn' : '') },
    { field: 'ordered_at', title: 'Ordered', type: 'readonly', width: 140, format: dt }, { field: 'ordered_by', title: 'By', type: 'readonly', width: 140 }] });
}

export async function order(main, id) {
  const [d, me] = await Promise.all([api('/purchasing/orders/' + id), api('/purchasing/me')]);
  const o = d.order;
  main.innerHTML = `<div class="eyebrow">${esc(o.site_code)} · ${esc(o.supplier_name)}</div>` + pageHeader(`Purchase order ${o.po_code}`, o.external_po_number ? `Finance PO ${esc(o.external_po_number)}` : 'No finance PO number recorded yet',
    `<a class="btn ghost" href="#/purchasing/orders">All orders</a> ${me.can_order ? '<button class="btn" id="edit">Change PO number / confirmation</button>' : ''} <button class="btn" id="prt">Print</button>`, { kind: 'purchaseorder', id }) + `
    <div class="cols"><div class="card"><h2>Order</h2>${kv([['Order', esc(o.po_code)], ['Finance PO number', esc(o.external_po_number)], ["Supplier's confirmation", esc(o.confirmation_number)],
      ['Ordered', `${esc(o.ordered_by)} ${esc(dt(o.ordered_at))}`], ['Notes', esc(o.notes)]])}</div>
      <div class="card"><h2>Supplier</h2>${kv([['Supplier', link('#/purchasing/suppliers/' + o.supplier_id, o.supplier_name)], ['Our account #', esc(o.account_number)], ['Contact', esc(o.contact_name)],
        ['Email', esc(o.supplier_email)], ['Phone', esc(o.supplier_phone)], ['Address', esc(o.supplier_address)]])}</div></div>
    <div class="card">${section('Lines')}<div id="g"></div></div>`;
  new Grid(main.querySelector('#g'), { rows: d.lines, readOnly: true, columns: LINE_COLS(false).filter((c) => c.field !== 'po_code') });
  main.querySelector('#prt').onclick = () => window.print();
  const e = main.querySelector('#edit');
  if (e) e.onclick = async () => {
    const v = await modal({ title: `Change ${o.po_code}`, okText: 'Next: sign', fields: [{ name: 'external_po_number', label: 'Finance PO number', value: o.external_po_number || '' },
      { name: 'confirmation_number', label: "Supplier's confirmation", value: o.confirmation_number || '' }, { name: 'notes', label: 'Notes', value: o.notes || '' }] });
    if (!v) return;
    const ok = await signed({ what: `Changes to ${o.po_code}`, meaning: 'Changed by', needReason: true }, (reason, signature) => api('/purchasing/orders/' + o.id, { method: 'PUT', body: { row: v, reason, signature } }));
    if (ok) { toast('Saved and signed.'); order(main, id); }
  };
}

// ================================================================ VENDOR APPROVALS (V-1, migration 050)
// Every vendor at this lab: this lab's approval and the corporate one, what applies here, what is waiting.
// QA approves vendors (purchasing.qualify, this lab); Corporate QA approves them for every lab (purchasing.qualify_corporate).
const DOC_KINDS = ['Questionnaire', 'Certificate', 'Audit report', 'Quality agreement', 'Other'];
const expCls = (v) => { if (!v) return ''; const d = (new Date(v) - Date.now()) / 864e5; return d < 0 ? 'cbad' : d <= 60 ? 'cwarn' : ''; };
const levelText = (r) => (r.decided_at === 'Corporate' ? 'Corporate' : r.decided_at === 'This lab' ? 'This lab' : '');
const decisionText = (status, scopes) => (status ? status + (status === 'Approved' && scopes ? ` (${scopes})` : '') : '');

export async function suppliers(main) {
  if (!needLab(main)) return;
  const [d, me] = await Promise.all([api('/purchasing/vendors'), api('/purchasing/me')]);
  const rows = d.rows; const site = currentSite();
  const show = state.query.get('show') || 'all';
  const F = { all: ['All', () => true], approved: ['Approved here', (r) => r.approval_status === 'Approved'], attention: ['Not approved or expired', (r) => r.approval_status !== 'Approved'],
    due: ['Re-approve within 60 days', (r) => r.approval_status === 'Approved' && r.approved_until && (new Date(r.approved_until) - Date.now()) / 864e5 <= 60],
    certs: ['Certificates expiring', (r) => r.next_certificate_expiry && (new Date(r.next_certificate_expiry) - Date.now()) / 864e5 <= 60],
    corporate: ['Corporate approvals', (r) => !!r.corporate_status], stopped: ['Stopping requests', (r) => r.stopped_requests > 0] };
  const open = d.notices.filter((n) => !n.acknowledged_at);
  const waiting = d.promotions.filter((p) => p.status === 'Proposed');
  main.innerHTML = pageHeader(`Vendor approvals: ${site.site_code}`, `Whether each vendor may be used at ${esc(site.site_name)}, and for what. QA approves vendors for this lab; Corporate QA approves them for every lab. A lab can be stricter than corporate (suspend or reject a vendor here), never looser: while Corporate QA has a vendor suspended or rejected, no lab can use it. Purchase requests are approved separately, by Lab Supervisors and General Managers.`,
    '<a class="btn" href="#/inventory/suppliers">Supplier list</a>', { kind: 'vendors' }) + tabs('#/purchasing/suppliers') + `
    ${open.length ? `<div class="card warn" id="notices">${section(`Notices for ${site.site_code} (${open.length})`, 'Corporate QA\'s decisions that affect this lab. QA marks them as read (select some, or none for all).', me.can_qualify ? '<button class="btn" id="ack">Mark as read</button>' : '')}<div id="ng"></div></div>` : ''}
    ${waiting.length ? `<div class="card" id="waiting">${section(`Waiting for corporate approval (${waiting.length})`, me.can_qualify_corporate ? 'Open a vendor to approve it for every lab or reject the proposal (you cannot decide one you proposed).' : 'Proposals from the labs, waiting for Corporate QA.')}<div id="pg"></div></div>` : ''}
    <div class="pubar">${Object.entries(F).map(([k, [lbl, fn]]) => `<a class="tab ${k === show ? 'on' : ''}" href="#/purchasing/suppliers?show=${k}" style="text-decoration:none">${esc(lbl)} <small>${rows.filter(fn).length}</small></a>`).join('')}</div>
    ${me.can_qualify || me.can_qualify_corporate ? '' : '<div class="notice">QA approves vendors for this lab (purchasing.qualify); Corporate QA for every lab.</div>'}<div id="g"></div>`;
  new Grid(main.querySelector('#g'), { rows: rows.filter(F[F[show] ? show : 'all'][1]), readOnly: true, search: true, onRowOpen: (r) => { location.hash = '#/purchasing/suppliers/' + r.supplier_id; }, columns: [
    { field: 'supplier_code', title: 'Code', type: 'link', width: 85, href: (r) => '#/purchasing/suppliers/' + r.supplier_id },
    { field: 'supplier_name', title: 'Vendor', type: 'readonly', width: 210 }, { field: 'supplier_type', title: 'Type', type: 'readonly', width: 150 },
    { field: 'approval_status', title: 'Here', type: 'readonly', width: 120, cellClass: (r) => supCls(r.approval_status) },
    { field: 'decided_at', title: 'Decided by', type: 'readonly', width: 95, format: (v, r) => levelText(r) },
    { field: 'approved_until', title: 'Until', type: 'readonly', width: 95, format: d8, cellClass: (r) => (r.approval_status === 'Approved' ? expCls(r.approved_until) : '') },
    { field: 'local_status', title: 'This lab', type: 'readonly', width: 220, format: (v, r) => decisionText(v, r.local_scopes), cellClass: (r) => (r.local_status ? supCls(r.local_status) : '') },
    { field: 'corporate_status', title: 'Corporate', type: 'readonly', width: 220, format: (v, r) => decisionText(v, r.corporate_scopes), cellClass: (r) => (r.corporate_status ? supCls(r.corporate_status) : '') },
    { field: 'next_certificate_expiry', title: 'Certificate expires', type: 'readonly', width: 120, format: d8, cellClass: (r) => expCls(r.next_certificate_expiry) },
    { field: 'document_count', title: 'Documents', type: 'readonly', width: 85 },
    { field: 'stopped_requests', title: 'Stopped requests', type: 'readonly', width: 115, format: (v) => (v ? String(v) : ''), cellClass: (r) => (r.stopped_requests ? 'cbad' : '') },
    { field: 'promotion_code', title: 'Proposal', type: 'readonly', width: 90 }] });
  if (open.length) {
    const ng = new Grid(main.querySelector('#ng'), { rows: open, readOnly: true, columns: [
      { field: 'supplier_name', title: 'Vendor', type: 'link', width: 190, href: (r) => '#/purchasing/suppliers/' + r.supplier_id },
      { field: 'notice', title: 'Notice', type: 'readonly', width: 620 }, { field: 'created_at', title: 'When', type: 'readonly', width: 130, format: dt }] });
    const ack = main.querySelector('#ack');
    if (ack) ack.onclick = async () => {
      const ids = (ng.selectedRows().length ? ng.selectedRows() : ng.rows).map((r) => r.id);
      try { await api('/purchasing/notices/acknowledge', { method: 'POST', body: { ids } }); toast('Marked as read.'); suppliers(main); } catch (e) { toast(e.message, 'err'); }
    };
  }
  if (waiting.length) new Grid(main.querySelector('#pg'), { rows: waiting, readOnly: true, onRowOpen: (r) => { location.hash = '#/purchasing/suppliers/' + r.supplier_id; }, columns: [
    { field: 'promotion_code', title: 'Proposal', type: 'link', width: 90, href: (r) => '#/purchasing/suppliers/' + r.supplier_id },
    { field: 'supplier_name', title: 'Vendor', type: 'readonly', width: 190 }, { field: 'site_code', title: 'From', type: 'readonly', width: 60 },
    { field: 'scope_text', title: 'For', type: 'readonly', width: 230 }, { field: 'class_name', title: 'Risk class', type: 'readonly', width: 90 },
    { field: 'document_count', title: 'Documents', type: 'readonly', width: 85 }, { field: 'proposed_by_name', title: 'Proposed by', type: 'readonly', width: 140 },
    { field: 'created_at', title: 'When', type: 'readonly', width: 120, format: dt }, { field: 'note', title: 'Note', type: 'readonly', width: 240 }] });
}

// the scopes as tick boxes (and "Every scope"), and document rows, inside a dialog
const scopeBoxes = (scopes, ticked, allowEvery, every) => `<div class="field"><label>Approved for <span class="req">*</span></label><div class="picklist" id="scopebox">
  ${allowEvery ? `<label class="cb"><input type="checkbox" id="sc_every" ${every ? 'checked' : ''}> <b>Every scope</b> <small>(anything bought from this vendor)</small></label>` : ''}
  ${scopes.map((sc) => `<label class="cb"><input type="checkbox" class="sc" value="${sc.id}" ${ticked.includes(sc.id) ? 'checked' : ''}> ${esc(sc.scope_name)} ${sc.description ? `<small>${esc(sc.description)}</small>` : ''}</label>`).join('')}</div></div>`;
const docRows = (n) => `<div class="field"><label>Documents (questionnaire, certificate, audit report…)</label>${Array.from({ length: n }, (_, i) => `<div class="docrow" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">
  <input type="file" class="df" data-i="${i}" accept="application/pdf,image/png,image/jpeg,text/plain,.docx,.xlsx" style="max-width:230px">
  <select class="dk" data-i="${i}" style="width:160px">${DOC_KINDS.map((k) => `<option>${k}</option>`).join('')}</select>
  <input class="dtl" data-i="${i}" placeholder="Title (e.g. ISO 17025 certificate)" style="flex:1;min-width:160px"><label style="display:flex;gap:4px;align-items:center;font-size:12.5px;color:var(--muted)">Expires <input class="dexp" data-i="${i}" type="date" style="width:150px"></label></div>`).join('')}</div>`;
const readScopes = (m) => ({ all_scopes: !!m.querySelector('#sc_every')?.checked, scope_ids: [...m.querySelectorAll('#scopebox .sc:checked')].map((x) => x.value) });
const readDocs = (m) => [...m.querySelectorAll('.docrow')].map((r) => ({ file: r.querySelector('.df').files[0], doc_kind: r.querySelector('.dk').value, title: r.querySelector('.dtl').value.trim(), certificate_expires: r.querySelector('.dexp').value || null })).filter((x) => x.file);
async function docsToBody(docs) {
  const out = [];
  for (const d of docs) {
    if (d.file.size > 15 * 1024 * 1024) throw new Error(`${d.file.name} is larger than 15 MB`);
    out.push({ file_name: d.file.name, mime_type: d.file.type || 'application/octet-stream', content_base64: await fileToBase64(d.file), doc_kind: d.doc_kind, title: d.title || null, certificate_expires: d.certificate_expires });
  }
  return out;
}

export async function supplier(main, id) {
  const [d, me] = await Promise.all([api('/purchasing/suppliers/' + id), api('/purchasing/me')]);
  const s = d.supplier; const row = d.row || {}; const site = currentSite();
  const canLab = me.can_qualify; const canCorp = me.can_qualify_corporate;
  const local = d.qualifications.find((q) => q.site_id && q.status === 'Active');
  const corp = d.qualifications.find((q) => !q.site_id && q.status === 'Active');
  const openProp = d.promotions.find((p) => p.status === 'Proposed');
  const localCurrent = local && local.approval_status === 'Approved' && (!local.expiration_date || new Date(local.expiration_date) >= new Date(today()));
  const canPropose = canLab && localCurrent && !openProp && !(corp && corp.approval_status !== 'Approved');
  const shared = d.classes.filter((c) => !c.site_id);
  const classLabel = (c) => `${c.class_name} (re-approve every ${c.requal_months} months)${c.site_id ? ': this lab only' : ''}`;
  main.innerHTML = `<div class="eyebrow">${esc(s.supplier_code)} · ${esc(s.supplier_type)}</div>` + pageHeader(s.supplier_name, `<span class="s-${esc(String(s.approval_status).split(' ')[0])}">${esc(s.approval_status)} for ${esc(site.site_code)}</span>${s.approved_until ? ` until ${esc(d8(s.approved_until))}` : ''}${s.decided_at ? ` · decided ${s.decided_at === 'Corporate' ? 'by Corporate QA' : 'by this lab'}` : ''}`,
    `<a class="btn ghost" href="#/purchasing/suppliers">All vendors</a>
     ${canLab || canCorp ? '<button class="btn" id="adddoc">Attach document…</button>' : ''}
     ${canPropose ? '<button class="btn" id="propose">Propose for corporate approval…</button>' : ''}
     ${canLab || canCorp ? '<button class="btn primary" id="qual">Approve vendor…</button>' : ''}`, { kind: 'supplier', id }) + `
    ${openProp ? `<div class="card ${canCorp ? 'warn' : ''}" id="propcard">${section(`Proposed for corporate approval: ${openProp.promotion_code}`, `${esc(openProp.site_code)} (${esc(openProp.proposed_by_name)}, ${esc(dt(openProp.created_at))}) proposes ${esc(openProp.from_code)} for every lab: ${esc(openProp.scope_text)}, ${esc(openProp.class_name)}. ${openProp.document_count} document${openProp.document_count === 1 ? '' : 's'}.${openProp.note ? ' Note: ' + esc(openProp.note) : ''}`,
      `${canCorp ? '<button class="btn" id="rejprop">Reject proposal…</button> <button class="btn primary" id="okprop">Approve for every lab…</button>' : ''} ${canLab && openProp.site_id === site.id ? '<button class="btn ghost" id="wdprop">Withdraw proposal…</button>' : ''}`)}</div>` : ''}
    <div class="cols"><div class="card"><h2>Vendor</h2>${kv([['Code', esc(s.supplier_code)], ['Type', esc(s.supplier_type)], ['Our account #', esc(s.account_number)], ['Contact', esc(s.contact_name)],
      ['Email', esc(s.email)], ['Phone', esc(s.phone)], ['Website', esc(s.website)], ['Address', esc(s.address)], ['Notes', esc(s.notes)]])}</div>
      <div class="card"><h2>Here and now</h2>${kv([['Status', esc(s.approval_status)], ['Decided by', esc(levelText(s))], ['Approved until', esc(d8(s.approved_until))], ['Risk class', esc(s.risk_class)],
        ['This lab', local ? esc(`${local.qualification_code}: ${decisionText(local.approval_status, local.scope_text)}${local.expiration_date ? ' until ' + d8(local.expiration_date) : ''}`) : 'No decision'],
        ['Corporate', corp ? esc(`${corp.qualification_code}: ${decisionText(corp.approval_status, corp.scope_text)}${corp.expiration_date ? ' until ' + d8(corp.expiration_date) : ''}`) : 'No decision'],
        ['Next certificate expiry', esc(d8(row.next_certificate_expiry))]])}</div></div>
    <div class="card">${section('Approval history', 'Each decision is its own signed record; nothing is overwritten. Corporate (every lab) and this lab\'s own. A corporate suspension or rejection applies everywhere; otherwise this lab\'s decision comes first. Withdraw a record only if it was entered in error.')}<div id="qg"></div></div>
    <div class="card">${section('Documents', 'The evidence behind the approvals: questionnaires, certificates (with their expiry), audit reports, quality agreements. A document is never changed; withdraw it if attached in error.')}<div id="dg"></div></div>
    ${d.promotions.length ? `<div class="card">${section('Proposals for corporate approval')}<div id="prg"></div></div>` : ''}
    <div class="card">${section('Requests from this lab')}<div id="lg"></div></div>`;
  const mayEdit = (q) => (q.site_id ? canLab : canCorp);
  new Grid(main.querySelector('#qg'), { readOnly: true, rows: d.qualifications, emptyText: 'Never approved.', rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''), columns: [
    { field: 'qualification_code', title: 'Record', type: 'readonly', width: 85 }, { field: 'approval_status', title: 'Decision', type: 'readonly', width: 110, cellClass: (r) => supCls(r.approval_status) },
    { field: 'site_code', title: 'For', type: 'readonly', width: 95, format: (v) => v || 'Corporate' }, { field: 'scope_text', title: 'Approved for', type: 'readonly', width: 220 },
    { field: 'class_name', title: 'Risk class', type: 'readonly', width: 90 },
    { field: 'approval_date', title: 'Date', type: 'readonly', width: 95, format: d8 }, { field: 'expiration_date', title: 'Until', type: 'readonly', width: 95, format: d8 },
    { field: 'accreditations', title: 'Accreditations', type: 'readonly', width: 140 }, { field: 'justification', title: 'Justification', type: 'readonly', width: 230, format: (v, r) => (r.is_legacy ? 'Legacy (go-live): ' : '') + (v || '') },
    { field: 'signed_by', title: 'Signed', type: 'readonly', width: 170, format: (v, r) => (v ? `${v} (${r.signature_meaning})` : r.is_legacy ? 'Migration' : '') },
    { field: 'status', title: 'Record', type: 'readonly', width: 75, format: (v) => (v === 'Inactive' ? 'Withdrawn' : '') },
    ...(canLab || canCorp ? [{ field: '_w', title: '', type: 'button', width: 90, label: (r) => (r.status === 'Active' && mayEdit(r) ? 'Withdraw' : ''), onClick: async (r) => {
      if (r.status !== 'Active' || !mayEdit(r)) return;
      const ok = await signed({ what: `Withdraw ${r.qualification_code} (entered in error)`, meaning: 'Withdrawn by', needReason: true }, (reason, signature) => api(`/purchasing/qualifications/${r.id}/withdraw`, { method: 'POST', body: { reason, signature } }));
      if (ok) { toast('Withdrawn and signed.'); supplier(main, id); }
    } }] : [])] });
  const docEditable = (dd) => (dd.qualification_id ? mayEdit(d.qualifications.find((x) => x.id === dd.qualification_id) || { site_id: true }) : canLab);
  const recCode = (dd) => (dd.qualification_id ? (d.qualifications.find((q) => q.id === dd.qualification_id) || {}).qualification_code : (d.promotions.find((p) => p.id === dd.promotion_id) || {}).promotion_code) || '';
  new Grid(main.querySelector('#dg'), { readOnly: true, rows: d.documents, emptyText: 'No documents yet: "Attach document…".', rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''), columns: [
    { field: 'doc_kind', title: 'Kind', type: 'readonly', width: 120 },
    { field: 'title', title: 'Document', type: 'link', width: 260, format: (v, r) => v || r.file_name, onClick: (r) => window.open(`/api/purchasing/documents/${r.id}/file?s=${encodeURIComponent(state.site || '')}`, '_blank') },
    { field: '_rec', title: 'For', type: 'readonly', width: 90, compute: recCode },
    { field: 'certificate_expires', title: 'Certificate expires', type: 'readonly', width: 125, format: d8, cellClass: (r) => (r.status === 'Active' ? expCls(r.certificate_expires) : '') },
    { field: 'added_by', title: 'Added by', type: 'readonly', width: 150 }, { field: 'created_at', title: 'Added', type: 'readonly', width: 120, format: dt },
    { field: 'status', title: 'Record', type: 'readonly', width: 75, format: (v) => (v === 'Inactive' ? 'Withdrawn' : '') },
    ...(canLab || canCorp ? [{ field: '_wd', title: '', type: 'button', width: 90, label: (r) => (r.status === 'Active' && docEditable(r) ? 'Withdraw' : ''), onClick: async (r) => {
      if (r.status !== 'Active' || !docEditable(r)) return;
      const ok = await signed({ what: `Withdraw the document "${r.title || r.file_name}" (attached in error)`, sign: false, needReason: true }, (reason) => api(`/purchasing/documents/${r.id}/withdraw`, { method: 'POST', body: { reason } }));
      if (ok) { toast('Withdrawn.'); supplier(main, id); }
    } }] : [])] });
  if (d.promotions.length) new Grid(main.querySelector('#prg'), { readOnly: true, rows: d.promotions, columns: [
    { field: 'promotion_code', title: 'Proposal', type: 'readonly', width: 90 }, { field: 'status', title: 'Status', type: 'readonly', width: 95, cellClass: (r) => (r.status === 'Approved' ? 'cok' : r.status === 'Rejected' ? 'cbad' : r.status === 'Proposed' ? 'cwarn' : '') },
    { field: 'site_code', title: 'From', type: 'readonly', width: 60 }, { field: 'from_code', title: 'Lab approval', type: 'readonly', width: 95 },
    { field: 'scope_text', title: 'For', type: 'readonly', width: 220 }, { field: 'proposed_by_name', title: 'Proposed by', type: 'readonly', width: 140 },
    { field: 'decided_by_name', title: 'Decided by', type: 'readonly', width: 140 }, { field: 'decision_note', title: 'Decision', type: 'readonly', width: 240 },
    { field: 'corporate_code', title: 'Corporate record', type: 'readonly', width: 115 }] });
  new Grid(main.querySelector('#lg'), { readOnly: true, rows: d.lines, emptyText: 'No requests.', columns: LINE_COLS(false).filter((c) => c.field !== 'supplier_name') });

  const fail = (e) => toast(e.message, 'err');
  // ---- Approve vendor… (this lab, or every lab for Corporate QA)
  const q = main.querySelector('#qual');
  if (q) q.onclick = async () => {
    const levels = [...(canLab ? [{ value: 'lab', label: `This lab only (${site.site_code})` }] : []), ...(canCorp ? [{ value: 'corporate', label: 'Corporate: every lab' }] : [])];
    const v = await modal({ title: `Approve ${s.supplier_name}`, okText: 'Next: sign', wide: true,
      intro: 'A new decision record. Approved needs what the vendor is approved for. Suspended or Not Approved stops the whole vendor. The expiry comes from the risk class unless you give one. A corporate decision uses a shared risk class and applies to every lab.',
      fields: [{ name: 'level', label: 'Applies to', type: 'select', options: levels, value: levels[0].value, blank: false },
        { name: 'approval_status', label: 'Decision', type: 'select', options: ['Approved', 'Suspended', 'Not Approved'], value: 'Approved', blank: false },
        { name: 'risk_class_id', label: 'Risk class', type: 'select', options: d.classes.map((c) => ({ value: c.id, label: classLabel(c) })), required: true },
        { name: 'approval_date', label: 'Date of the review', type: 'date', value: today() }, { name: 'expiration_date', label: 'Expires (leave empty to use the risk class)', type: 'date' },
        { name: 'accreditations', label: 'Accreditations (e.g. ISO 17025, ISO 9001)' }, { name: 'justification', label: 'Justification / evidence', type: 'textarea' }],
      after: scopeBoxes(d.scopes, [], true, false) + docRows(2),
      collect: (m) => ({ ...readScopes(m), docs: readDocs(m) }) });
    if (!v) return;
    if (v.approval_status === 'Approved' && !v.all_scopes && !v.scope_ids.length) { toast('Tick what the vendor is approved for, or "Every scope".', 'err'); return; }
    let documents;
    try { documents = await docsToBody(v.docs); } catch (e) { fail(e); return; }
    const corporate = v.level === 'corporate';
    const ok = await signed({ what: `Vendor approval of ${s.supplier_name}: ${v.approval_status} (${corporate ? 'corporate, every lab' : 'this lab'})`, meaning: v.approval_status === 'Approved' ? 'Approved by' : v.approval_status === 'Suspended' ? 'Suspended by' : 'Rejected by', needReason: false },
      (reason, signature) => api(`/purchasing/suppliers/${s.id}/qualifications`, { method: 'POST', body: { row: v, documents, signature } }));
    if (ok) { toast('Decision recorded and signed.'); supplier(main, id); }
  };
  // ---- Attach document…
  const ad = main.querySelector('#adddoc');
  if (ad) ad.onclick = async () => {
    const recs = d.qualifications.filter((x) => x.status === 'Active' && mayEdit(x));
    if (!recs.length) { toast('Approve the vendor first: documents belong to an approval.', 'err'); return; }
    const v = await modal({ title: 'Attach documents', okText: 'Attach', wide: true,
      fields: [{ name: 'qualification_id', label: 'To the approval', type: 'select', blank: false, options: recs.map((x) => ({ value: x.id, label: `${x.qualification_code}: ${x.site_code || 'Corporate'}, ${x.approval_status}` })) }],
      after: docRows(3), collect: (m) => ({ docs: readDocs(m) }) });
    if (!v) return;
    if (!v.docs.length) { toast('Choose a file to attach.', 'err'); return; }
    try { await api(`/purchasing/qualifications/${v.qualification_id}/documents`, { method: 'POST', body: { documents: await docsToBody(v.docs) } }); toast('Attached.'); supplier(main, id); } catch (e) { fail(e); }
  };
  // ---- Propose for corporate approval…
  const pr = main.querySelector('#propose');
  if (pr) pr.onclick = async () => {
    const hasDoc = d.documents.some((x) => x.status === 'Active' && x.qualification_id === local.id);
    if (!hasDoc) { toast(`Attach at least one document to ${local.qualification_code} first ("Attach document…"): Corporate QA decides on the evidence.`, 'err'); return; }
    const every = !local.scope_ids;
    const v = await modal({ title: `Propose ${s.supplier_name} for corporate approval`, okText: 'Next: sign', wide: true,
      intro: `Corporate QA reviews ${esc(local.qualification_code)} and its documents, and approves the vendor for every lab or rejects the proposal. You can propose only what ${esc(site.site_code)} approved it for.`,
      fields: [{ name: 'risk_class_id', label: 'Shared risk class', type: 'select', required: true, options: shared.map((c) => ({ value: c.id, label: classLabel(c) })), value: (shared.find((c) => c.id === local.risk_class_id) || {}).id || '' },
        { name: 'note', label: 'Note for Corporate QA', type: 'textarea' }],
      after: every ? '<p class="help">This lab approved it for every scope; the proposal is for every scope too.</p>' : scopeBoxes(d.scopes.filter((sc) => local.scope_ids.includes(sc.id)), local.scope_ids, false, false),
      collect: (m) => readScopes(m) });
    if (!v) return;
    const ok = await signed({ what: `Propose ${s.supplier_name} (${local.qualification_code}) for corporate approval`, meaning: 'Proposed by', needReason: false },
      (reason, signature) => api(`/purchasing/qualifications/${local.id}/propose`, { method: 'POST', body: { risk_class_id: v.risk_class_id, scope_ids: every ? null : v.scope_ids, note: v.note, signature } }));
    if (ok) { toast('Proposed: waiting for Corporate QA.'); supplier(main, id); }
  };
  // ---- Corporate QA decides
  const decide = async (approve) => {
    const from = d.qualifications.find((x) => x.id === openProp.from_qualification_id) || {};
    const fromScopes = from.scope_ids || null;
    const v = await modal({ title: `${approve ? 'Approve' : 'Reject'} ${openProp.promotion_code}`, okText: 'Next: sign', wide: true,
      intro: approve ? `Approves ${esc(s.supplier_name)} for every lab, at most for what ${esc(openProp.site_code)} approved; the lab's documents are carried to the corporate record.` : `The proposal is rejected; ${esc(openProp.site_code)}'s own approval stands. The lab sees your reason.`,
      fields: [...(approve ? [{ name: 'risk_class_id', label: 'Shared risk class', type: 'select', blank: false, options: shared.map((c) => ({ value: c.id, label: classLabel(c) })), value: openProp.risk_class_id }] : []),
        { name: 'note', label: approve ? 'Note (optional)' : 'Why it is rejected', type: 'textarea', required: !approve }],
      after: approve && fromScopes ? scopeBoxes(d.scopes.filter((sc) => fromScopes.includes(sc.id)), openProp.scope_ids || fromScopes, false, false) : '',
      collect: (m) => readScopes(m) });
    if (!v) return;
    const ok = await signed({ what: `${approve ? 'Approve' : 'Reject'} ${openProp.promotion_code}: ${s.supplier_name} for every lab`, meaning: approve ? 'Approved by' : 'Rejected by', needReason: false },
      (reason, signature) => api(`/purchasing/promotions/${openProp.id}/decide`, { method: 'POST', body: { decision: approve ? 'Approved' : 'Rejected', note: v.note, risk_class_id: v.risk_class_id, scope_ids: approve && fromScopes ? v.scope_ids : null, signature } }));
    if (ok) { toast(approve ? 'Approved for every lab.' : 'Proposal rejected.'); supplier(main, id); }
  };
  const okp = main.querySelector('#okprop'); if (okp) okp.onclick = () => decide(true);
  const rjp = main.querySelector('#rejprop'); if (rjp) rjp.onclick = () => decide(false);
  const wdp = main.querySelector('#wdprop');
  if (wdp) wdp.onclick = async () => {
    const ok = await signed({ what: `Withdraw ${openProp.promotion_code}`, sign: false, needReason: true }, (reason) => api(`/purchasing/promotions/${openProp.id}/withdraw`, { method: 'POST', body: { reason } }));
    if (ok) { toast('Proposal withdrawn.'); supplier(main, id); }
  };
}

// ================================================================ RISK CLASSES AND SETTINGS
export async function riskClasses(main) {
  if (!needLab(main)) return;
  const [rows, me] = await Promise.all([api('/purchasing/risk-classes'), api('/purchasing/me')]);
  const site = currentSite();
  main.innerHTML = pageHeader('Risk classes and supply scopes', `How often vendors are re-approved, and what they can be approved for. The shared classes apply to every lab and to corporate approvals (kept by Corporate QA); ${esc(site.site_code)} can add its own (for example a Class IV re-approved every 5 years) for its own approvals.`, '', { kind: 'riskclasses' })
    + tabs('#/purchasing/risk-classes') + `${me.can_qualify || me.can_qualify_corporate ? '' : '<div class="notice">QA (purchasing.qualify) keeps this lab\'s classes; Corporate QA the shared ones and the supply scopes.</div>'}<div class="card">${section('Risk classes')}<div id="g"></div></div>
    <div class="card">${section('Supply scopes', 'What a vendor can be approved for. Inventory items fall under the scope of their item type; equipment, services and other purchases under the scope chosen on the request (or the default). Kept by Corporate QA.')}<div id="sg"></div></div>`;
  const canLab = me.can_qualify; const canShared = me.can_qualify_corporate;
  editableGrid({
    el: main.querySelector('#g'), rows: rows.map((r) => ({ ...r, scope: r.site_id ? site.site_code : 'All labs' })), allowAdd: canLab || canShared, readOnly: !(canLab || canShared), what: 'risk classes',
    newRow: () => ({ status: 'Active', requal_months: 24, sort_order: 10, scope: site.site_code, shared: !canLab && canShared }), rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''),
    sign: (rs) => ({ meaning: 'Changed by', action: `Supplier risk classes: ${rs.length} change(s)` }),
    columns: [
      { field: 'class_name', title: 'Class', required: true, width: 120, editable: (r, isNew) => isNew || (r.site_id ? canLab : canShared) },
      { field: 'requal_months', title: 'Re-qualify every (months)', type: 'int', min: 1, required: true, width: 150, editable: (r, isNew) => isNew || (r.site_id ? canLab : canShared) },
      { field: 'description', title: 'Description', width: 330, editable: (r, isNew) => isNew || (r.site_id ? canLab : canShared) },
      { field: 'scope', title: 'For', type: 'readonly', width: 80, compute: (r) => (r.site_id ? r.site_code || site.site_code : r.id ? 'All labs' : r.shared ? 'All labs' : site.site_code) },
      { field: 'used', title: 'Used', type: 'readonly', width: 60 },
      ...(canShared ? [{ field: 'shared', title: 'All labs (new)', type: 'bool', width: 95, editable: (r, isNew) => isNew && canLab, help: 'A new class for every lab (corporate approvals use these)' }] : []),
      { field: 'sort_order', title: 'Order', type: 'int', width: 60, editable: (r, isNew) => isNew || (r.site_id ? canLab : canShared) },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 85, editable: (r, isNew) => isNew || (r.site_id ? canLab : canShared) }],
    save: (rs, reason, signature) => api('/purchasing/risk-classes', { method: 'POST', body: { rows: rs.map((r) => { const o = { ...r }; delete o.scope; delete o.used; return o; }), reason, signature } }),
    afterSave: () => riskClasses(main),
  });
  const scopes = await api('/purchasing/scopes');
  const TYPES = ['Consumable', 'Solvent', 'Reagent', 'Media', 'Reference Standard', 'Microbiological Strain'];
  editableGrid({
    el: main.querySelector('#sg'), rows: scopes.map((x) => ({ ...x, chemical_types: x.chemical_types.join(', '), line_types: x.line_types.join(', ') })), allowAdd: canShared, readOnly: !canShared, what: 'supply scopes',
    newRow: () => ({ status: 'Active', sort_order: 20, line_types: 'Service', chemical_types: '' }), rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''),
    sign: (rs) => ({ meaning: 'Changed by', action: `Supply scopes: ${rs.length} change(s)` }),
    columns: [
      { field: 'scope_name', title: 'Scope', required: true, width: 190 }, { field: 'description', title: 'Description', width: 260 },
      { field: 'line_types', title: 'Requests of kind', width: 170, help: 'Inventory item, Equipment, Service, Other (comma-separated)' },
      { field: 'chemical_types', title: 'Item types', width: 200, help: `Inventory items of these types fall under it (one scope per type): ${TYPES.join(', ')}` },
      { field: 'default_for', title: 'Default for', type: 'select', options: ['', 'Equipment', 'Service', 'Other'], width: 105 },
      { field: 'used', title: 'Approvals', type: 'readonly', width: 80 }, { field: 'sort_order', title: 'Order', type: 'int', width: 60 },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 85 }],
    save: (rs, reason, signature) => api('/purchasing/scopes', { method: 'POST', body: { rows: rs.map((r) => { const o = { ...r }; delete o.used; return o; }), reason, signature } }),
    afterSave: () => riskClasses(main),
  });
}

export async function settings(main) {
  if (!needLab(main)) return;
  const [s, me] = await Promise.all([api('/purchasing/settings'), api('/purchasing/me')]);
  const site = currentSite();
  main.innerHTML = pageHeader(`Purchasing settings: ${site.site_code}`, 'Each lab decides when a General Manager must also approve a request.', '', { kind: 'purchasing' }) + tabs('#/purchasing/settings') + `
    <div class="card">${kv([['Second approval above', s.second_approval_over === null ? 'Not set: one approval is enough' : esc(money(s.second_approval_over)) + ' per request (quantity × price)'],
      ['Requests without a price', 'Need only one approval (the price is unknown)']])}
      ${me.can_settings ? '<div class="actbar" style="margin-top:12px"><button class="btn primary" id="edit">Change</button></div>' : '<p class="help">Changing this needs the admin.lab permission (lab administrators).</p>'}</div>`;
  const e = main.querySelector('#edit');
  if (e) e.onclick = async () => {
    const v = await modal({ title: 'Second approval amount', okText: 'Next: sign', intro: 'Leave empty for no second approval.',
      fields: [{ name: 'second_approval_over', label: 'Second approval above (USD)', type: 'number', value: s.second_approval_over ?? '' }] });
    if (!v) return;
    const ok = await signed({ what: `Second approval above ${v.second_approval_over === '' ? 'no amount' : money(v.second_approval_over)}`, meaning: 'Changed by', needReason: true },
      (reason, signature) => api('/purchasing/settings', { method: 'PUT', body: { row: v, reason, signature } }));
    if (ok) { toast('Saved and signed.'); settings(main); }
  };
}
void can;
