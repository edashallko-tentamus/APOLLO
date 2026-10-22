// 0.36.0 (migration 058): miscellaneous charges on a lab order and on a quote. A charge has no workflow and never
// reaches a COA; on an order it is ready to invoice at once (shipping is billed before the kit goes out). The client's
// price comes from their accepted quote, else the catalogue price; a Discount is taken off.
import { api, esc, toast, modal, askReason, money } from '../app.js';
import { Grid } from '../grid.js';
import { section } from './common.js';

const d8 = (v) => { if (!v) return ''; const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString([], { dateStyle: 'medium' }) : ''; };
const itemLabel = (c) => `${c.charge_name} (${c.kind}, ${money(c.client_price ?? c.price)}${c.client_price !== null && c.client_price !== undefined ? ' from ' + c.project_code : ''})`;

// ---------------------------------------------------------------- a lab order's charges
export async function orderChargesCard(host, orderId, { samples = [], onChange } = {}) {
  let d;
  try { d = await api(`/orders/${orderId}/charges`); } catch (_) { return; }
  const reload = () => orderChargesCard(host, orderId, { samples, onChange });
  const active = d.rows.filter((r) => r.status === 'Active');
  host.style.display = '';
  host.innerHTML = section('Charges', 'Kits, shipping, report fees, surcharges and discounts on this order. Ready to invoice as soon as they are added; never printed on a COA.',
    d.can_edit ? '<button class="btn" id="ocadd">+ Add a charge…</button>' : '')
    + `<div class="blsum"><div><b>${money(active.reduce((s, r) => s + Number(r.amount || 0), 0))}</b><span>${active.length} charge${active.length === 1 ? '' : 's'}</span></div></div><div id="ochgg"></div>`;
  new Grid(host.querySelector('#ochgg'), { readOnly: true, rows: d.rows, emptyText: 'No charges on this order.', rowClass: (r) => (r.status === 'Cancelled' ? 'mutedrow' : ''), columns: [
    { field: 'charge_no', title: 'Charge', type: 'readonly', width: 95 },
    { field: 'charge_name', title: 'What', type: 'readonly', width: 200 },
    { field: 'kind', title: 'Kind', type: 'readonly', width: 90 },
    { field: 'sample_code', title: 'Sample', type: 'link', width: 125, href: (r) => (r.sample_id ? '#/samples/' + r.sample_id : null) },
    { field: 'quantity', title: 'Qty', type: 'readonly', width: 50 },
    { field: 'unit_price', title: 'Each', type: 'money', width: 85 },
    { field: 'amount', title: 'Amount', type: 'money', width: 90 },
    { field: 'price_from', title: 'Price', type: 'readonly', width: 120, compute: (r) => (r.project_code ? 'Quote ' + r.project_code : Math.abs(Number(r.unit_price)) !== Math.abs(Number(r.list_price)) ? 'Agreed' : 'Catalogue') },
    { field: 'invoice_code', title: 'Invoice', type: 'link', width: 135, href: (r) => (r.invoice_id ? '#/billing/invoices/' + r.invoice_id : null), format: (v, r) => v || (r.credited ? 'Credited' : r.status === 'Active' ? 'Not invoiced' : '') },
    { field: 'note', title: 'Note', type: 'readonly', width: 200 },
    { field: 'status', title: 'Status', type: 'readonly', width: 85 },
    { field: 'created_at', title: 'Added', type: 'readonly', width: 105, format: d8 },
    ...(d.can_edit ? [{ field: '_ch', title: '', type: 'button', width: 80, label: (r) => (r.status === 'Active' && !r.invoice_id && !r.credited ? 'Change…' : ''), onClick: (r) => { if (r.status === 'Active' && !r.invoice_id) changeCharge(r, reload, onChange); } },
      { field: '_cx', title: '', type: 'button', width: 80, label: (r) => (r.status === 'Active' && !r.invoice_id && !r.credited ? 'Cancel…' : ''), onClick: (r) => { if (r.status === 'Active' && !r.invoice_id) cancelCharge(r, reload, onChange); } }] : []),
  ] });
  const add = host.querySelector('#ocadd');
  if (add) add.onclick = async () => {
    if (!d.items.length) { toast('No charges are in the catalogue for this lab yet (Test catalogue > Charges).', 'err'); return; }
    const v = await modal({ title: 'Add a charge', okText: 'Add', intro: 'The client\'s price comes from their accepted quote, else the catalogue price. Type another price only when agreed with the client (a reason is asked).', fields: [
      { name: 'charge_item_id', label: 'Charge', type: 'select', blank: false, required: true, options: d.items.map((c) => ({ value: c.id, label: itemLabel(c) })) },
      { name: 'quantity', label: 'Quantity', type: 'number', value: 1 },
      { name: 'unit_price', label: 'Price each (empty: the client\'s price)', type: 'number', value: '' },
      { name: 'sample_id', label: 'For a sample (optional)', type: 'select', options: samples.filter((x) => x.id).map((x) => ({ value: x.id, label: x.sample_code || x.client_sample_id || 'Sample' })) },
      { name: 'note', label: 'Printed under the invoice line', value: '' }] });
    if (!v) return;
    const it = d.items.find((c) => c.id === v.charge_item_id) || {};
    const std = it.client_price ?? it.price;
    let reason = '';
    const typed = v.unit_price !== '' && Math.abs(Number(v.unit_price)) !== Math.abs(Number(std));   // the client's own price typed again counts as not typed
    if (typed) { reason = await askReason(`a charge at ${money(v.unit_price)} instead of ${money(std)}`); if (reason === null) return; }
    try { const r = await api(`/orders/${orderId}/charges`, { method: 'POST', body: { ...v, unit_price: typed ? v.unit_price : null, reason } }); toast(`${r.charge_no} added: ready to invoice.`); reload(); if (onChange) onChange(); } catch (e) { toast(e.message, 'err'); }
  };
}

async function changeCharge(r, reload, onChange) {
  const v = await modal({ title: `Change ${r.charge_no}`, okText: 'Continue', fields: [
    { name: 'quantity', label: 'Quantity', type: 'number', value: r.quantity },
    { name: 'unit_price', label: 'Price each', type: 'number', value: Math.abs(Number(r.unit_price)) },
    { name: 'note', label: 'Note', value: r.note || '' }] });
  if (!v) return;
  const reason = await askReason(`charge ${r.charge_no}`); if (reason === null) return;
  try { await api(`/order-charges/${r.id}`, { method: 'PUT', body: { ...v, reason } }); toast('Charge changed.'); reload(); if (onChange) onChange(); } catch (e) { toast(e.message, 'err'); }
}
async function cancelCharge(r, reload, onChange) {
  const reason = await askReason(`cancelling charge ${r.charge_no} (${r.charge_name})`); if (reason === null) return;
  try { await api(`/order-charges/${r.id}`, { method: 'PUT', body: { cancel: true, reason } }); toast('Charge cancelled (kept, greyed).'); reload(); if (onChange) onChange(); } catch (e) { toast(e.message, 'err'); }
}

// ---------------------------------------------------------------- a quote's charges
export async function quoteChargesCard(host, versionId, { onChange } = {}) {
  let d;
  try { d = await api(`/versions/${versionId}/charges`); } catch (_) { return; }
  const reload = () => quoteChargesCard(host, versionId, { onChange });
  if (!d.rows.length && !d.editable) { host.style.display = 'none'; return; }
  host.style.display = '';
  host.innerHTML = section('Charges on this quote', d.editable ? 'Kits, shipping, fees and discounts at this client\'s price. Once accepted, they are used whenever the charge goes on one of the client\'s orders.' : 'Locked with the quote: create a new version to change them.',
    d.editable ? '<button class="btn" id="qcadd">+ Add a charge…</button>' : '')
    + `<div id="qcg"></div><p class="help" id="qctot"></p>`;
  host.querySelector('#qctot').textContent = d.rows.length ? `Charges total: ${money(d.rows.reduce((s, r) => s + Number(r.line_total || 0), 0))}` : '';
  new Grid(host.querySelector('#qcg'), { readOnly: true, rows: d.rows, emptyText: 'No charges on this quote.', columns: [
    { field: 'charge_code', title: 'Code', type: 'readonly', width: 80 },
    { field: 'charge_name', title: 'Charge', type: 'readonly', width: 200 },
    { field: 'kind', title: 'Kind', type: 'readonly', width: 90 },
    { field: 'quantity', title: 'Qty', type: 'readonly', width: 50 },
    { field: 'list_price', title: 'List', type: 'money', width: 80 },
    { field: 'unit_price', title: 'Client price', type: 'money', width: 95 },
    { field: 'line_total', title: 'Total', type: 'money', width: 90 },
    { field: 'note', title: 'Note', type: 'readonly', width: 200 },
    ...(d.editable ? [{ field: '_e', title: '', type: 'button', width: 75, label: 'Change…', onClick: (r) => editQuoted(r, reload, onChange) },
      { field: '_r', title: '', type: 'button', width: 40, label: '🗑', help: 'Take this charge off the quote', onClick: (r) => removeQuoted(r, reload, onChange) }] : []),
  ] });
  const add = host.querySelector('#qcadd');
  if (add) add.onclick = async () => {
    if (!d.items.length) { toast('No charges are in the catalogue yet (Test catalogue > Charges).', 'err'); return; }
    const v = await modal({ title: 'Add a charge to the quote', okText: 'Add', fields: [
      { name: 'charge_item_id', label: 'Charge', type: 'select', blank: false, required: true, options: d.items.map((c) => ({ value: c.id, label: `${c.charge_name} (${c.kind}, ${money(c.price)})` })) },
      { name: 'quantity', label: 'Quantity', type: 'number', value: 1 },
      { name: 'unit_price', label: 'Client price each (empty: the catalogue price)', type: 'number', value: '' },
      { name: 'note', label: 'Note', value: '' }] });
    if (!v) return;
    try { await api(`/versions/${versionId}/charges`, { method: 'POST', body: v }); toast('Charge added.'); reload(); if (onChange) onChange(); } catch (e) { toast(e.message, 'err'); }
  };
}
async function editQuoted(r, reload, onChange) {
  const v = await modal({ title: `Change ${r.charge_name}`, okText: 'Save', fields: [
    { name: 'quantity', label: 'Quantity', type: 'number', value: r.quantity },
    { name: 'unit_price', label: 'Client price each', type: 'number', value: r.unit_price },
    { name: 'note', label: 'Note', value: r.note || '' }] });
  if (!v) return;
  try { await api(`/quoted-charges/${r.id}`, { method: 'PUT', body: v }); toast('Saved.'); reload(); if (onChange) onChange(); } catch (e) { toast(e.message, 'err'); }
}
async function removeQuoted(r, reload, onChange) {
  try { await api(`/quoted-charges/${r.id}`, { method: 'PUT', body: { remove: true } }); toast('Charge taken off the quote.'); reload(); if (onChange) onChange(); } catch (e) { toast(e.message, 'err'); }
}

// ---------------------------------------------------------------- a client's service lines (client page)
export async function clientServiceLinesCard(host, clientId, canEdit) {
  let rows;
  try { rows = await api(`/clients/${clientId}/service-lines`); } catch (_) { return; }
  host.style.display = '';
  const chosen = rows.filter((x) => x.chosen);
  host.innerHTML = section('Service lines', 'What this client buys from us. The test picker on their orders opens on these first.', canEdit ? '<button class="btn" id="cslch">Change…</button>' : '')
    + `<p>${chosen.length ? chosen.map((x) => `<span class="badge">${esc(x.line_name)}</span>`).join(' ') : '<span class="help">None chosen yet.</span>'}</p>`;
  const b = host.querySelector('#cslch');
  if (b) b.onclick = async () => {
    const v = await modal({ title: 'Client service lines', okText: 'Continue',
      html: `<div class="picklist">${rows.map((x) => `<label class="cb"><input type="checkbox" value="${esc(x.id)}" ${x.chosen ? 'checked' : ''}> ${esc(x.line_name)}</label>`).join('')}</div>`,
      collect: (m) => ({ ids: [...m.querySelectorAll('.picklist input:checked')].map((x) => x.value) }) });
    if (!v) return;
    const reason = await askReason('the client\'s service lines'); if (reason === null) return;
    try { await api(`/clients/${clientId}/service-lines`, { method: 'PUT', body: { ids: v.ids, reason } }); toast('Saved.'); clientServiceLinesCard(host, clientId, canEdit); } catch (e) { toast(e.message, 'err'); }
  };
}
