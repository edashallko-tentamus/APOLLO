// The purchasing dialogs several screens open: place an order, a new request, change a request, receive a delivery,
// and the vendor-approval parts (scope tick boxes, document rows) that sit under a dialog's fields.
import { useState } from 'react';
import { createLine, createOrder, equipmentLists, listScopes, listSuppliers, receiveLine, storageLocations, updateLine } from '../../api/purchasing.js';
import SmartSelect from '../../components/SmartSelect.jsx';
import { d8, DISCREPANCIES, DOC_KINDS, fileToBase64, money, num, signed } from './shared.jsx';

const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

// ---------------------------------------------------------------- place an order (one supplier)
export async function placeOrder({ dialogs, toast }, lines) {
  const sup = [...new Set(lines.map((x) => x.supplier_name))];
  const v = await dialogs.form({ title: 'Place an order', okText: 'Next: sign',
    intro: `${lines.length} request(s) for ${sup.join(', ') || 'no supplier'}. One order goes to one supplier. Enter the PO number from the finance system if there is one (it can be added later).`,
    fields: [{ name: 'external_po_number', label: 'Finance PO number' }, { name: 'confirmation_number', label: "Supplier's order confirmation" }, { name: 'notes', label: 'Notes' }] });
  if (!v) return false;
  const r = await signed(dialogs, { what: `Order ${lines.map((x) => x.line_code).join(', ')} from ${sup.join(', ')}${v.external_po_number ? ' (PO ' + v.external_po_number + ')' : ''}`, meaning: 'Ordered by', needReason: false },
    (reason, signature) => createOrder({ line_ids: lines.map((x) => x.id), ...v, signature }));
  if (r) toast(`Order ${r.po_code} placed and signed.`);
  return !!r;
}

export async function supplierOptions() {
  const sup = await listSuppliers();
  return sup.filter((s) => s.supplier_record_status === 'Active' && s.supplier_type !== 'Manufacturer')
    .map((s) => ({ value: s.supplier_id, label: s.supplier_name + (s.approval_status === 'Approved' ? '' : ` (${s.approval_status}: cannot order)`) }));
}

// the scopes a service or other purchase can be for (V-1): offered by kind, the default first
async function scopeOptions() {
  const all = await listScopes({ fresh: true });
  return all.filter((x) => x.status === 'Active' && (x.line_types.includes('Service') || x.line_types.includes('Other')))
    .map((x) => ({ value: x.id, label: `${x.line_types.includes('Service') ? 'Service' : 'Other'}: ${x.scope_name}${x.default_for ? ' (default)' : ''}` }));
}

// ---------------------------------------------------------------- a new request (equipment, service, other)
export async function newRequest({ dialogs, toast }) {
  let opts, scopes;
  try { [opts, scopes] = await Promise.all([supplierOptions(), scopeOptions()]); } catch (e) { toast(e.message, 'err'); return; }
  const v = await dialogs.form({ title: 'New purchase request', okText: 'Next: sign', wide: true,
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
  const { scope_id: sc, ...row } = v;
  const r = await signed(dialogs, { what: `Purchase request: ${v.description}`, meaning: 'Requested by', needReason: false },
    (reason, signature) => createLine({ ...row, scope_ids: sc && v.line_type !== 'Equipment' ? [sc] : null, quantity: Number(v.quantity), unit_price: numOrNull(v.unit_price), item_url: v.item_url || null }, signature));
  if (r) { toast(`Request ${r.line_code} created and signed.`); window.location.hash = '#/purchasing/requests/' + r.id; }
}

// ---------------------------------------------------------------- change a request (before approval)
export async function editRequest({ dialogs, toast }, l) {
  let opts;
  try { opts = await supplierOptions(); } catch (e) { toast(e.message, 'err'); return false; }
  const v = await dialogs.form({ title: `Change ${l.line_code}`, okText: 'Next: sign', intro: 'A change after the first approval sends the request back for approval.',
    fields: [{ name: 'description', label: 'What', value: l.description, required: true }, { name: 'supplier_id', label: 'Supplier', type: 'select', options: opts, value: l.supplier_id || '' },
      { name: 'catalog_number', label: 'Catalog / quote number', value: l.catalog_number || '' }, { name: 'item_url', label: 'Web link to the item', type: 'url', value: l.item_url || '' },
      { name: 'quantity', label: 'Quantity', type: 'number', value: l.quantity, required: true },
      { name: 'unit_price', label: 'Estimated price per unit (USD)', type: 'number', value: l.unit_price ?? '' }, { name: 'needed_by', label: 'Needed by', type: 'date', value: d8(l.needed_by) },
      { name: 'justification', label: 'Why it is needed', type: 'textarea', value: l.justification || '' }] });
  if (!v) return false;
  return signed(dialogs, { what: `Changes to ${l.line_code}`, meaning: 'Changed by', needReason: true },
    (reason, signature) => updateLine(l.id, { ...v, quantity: Number(v.quantity), unit_price: numOrNull(v.unit_price), supplier_id: v.supplier_id || null, item_url: v.item_url || null }, reason, signature));
}

// ---------------------------------------------------------------- receive (part of) a delivery
// Inventory: lot number, expiry, location. Equipment: what it is and who is responsible. Returns true when the caller
// should reload (false when cancelled, or when the new inventory item opened to be filled out).
export async function receiveDialog({ dialogs, toast }, l, left) {
  const fields = [
    { name: 'quantity', label: `Quantity received (${l.unit || 'units'}; ${num(left)} still expected)`, type: 'number', value: left, required: true },
    { name: 'more_to_come', label: 'More to come?', type: 'checkbox', cbLabel: 'Yes: keep the rest open as a back-order', value: false },
    { name: 'discrepancy', label: 'Problem with the delivery', type: 'select', options: DISCREPANCIES, value: 'None', blank: false },
    { name: 'note', label: 'Note (required when there is a problem)', type: 'textarea' },
    { name: 'actual_price', label: `Actual price per ${l.unit || 'unit'} (USD, optional)`, type: 'number', value: '',
      help: `What was really paid, if it differs from the estimate${l.unit_price !== null && l.unit_price !== undefined ? ' (' + money(l.unit_price) + ')' : ''}. Kept on the receipt.` },
  ];
  const intoInv = ['Other', 'Service'].includes(l.line_type);
  try {
    if (intoInv) {
      // Alex, 2026-10-13: receiving supplies creates the inventory item, which then opens to be filled out
      fields.push({ name: 'into_inventory', label: 'Put into inventory?', type: 'checkbox', cbLabel: 'Yes: create the inventory item now (it opens next, to fill out)', value: l.line_type === 'Other' },
        { name: 'inv_type', label: 'Inventory type', type: 'select', options: ['Consumable', 'Reagent', 'Solvent', 'Media', 'Reference Standard', 'Microbiological Strain'], value: 'Consumable', blank: false,
          help: 'Media needs qualifying before use; a Reference Standard or Strain needs its analyte (add it on the item next).' },
        { name: 'inv_unit', label: 'Unit in inventory', value: l.unit || 'each', help: 'From the Units list, e.g. case, box, each, L' });
    }
    if (l.line_type === 'Inventory item' || intoInv) {
      const L = await storageLocations();
      fields.push({ name: 'manufacturer_lot', label: intoInv ? 'Lot # (if it has one)' : 'Lot #' }, { name: 'expiration_date', label: 'Expiration date', type: 'date' },
        { name: 'retest_date', label: 'Retest date', type: 'date' },
        { name: 'storage_location_id', label: 'Storage location', type: 'select', options: L.filter((x) => x.status === 'Active').map((x) => ({ value: x.id, label: `${x.location_code}: ${x.path}` })) });
    }
    if (l.line_type === 'Equipment') {
      const eq = await equipmentLists();
      fields.push({ name: 'equipment_name', label: 'Equipment name', value: l.description, required: true },
        { name: 'equipment_type_id', label: 'Type', type: 'select', options: eq.types.filter((t) => t.status === 'Active').map((t) => ({ value: t.id, label: t.type_name })), required: true },
        { name: 'department_id', label: 'Department', type: 'select', options: eq.departments.filter((x) => x.status === 'Active').map((x) => ({ value: x.id, label: `${x.department_code} ${x.department_name}` })), required: true },
        { name: 'manufacturer', label: 'Manufacturer' }, { name: 'model', label: 'Model' }, { name: 'serial_number', label: 'Serial number' },
        { name: 'owner_group_id', label: 'Responsible group', type: 'select', options: eq.groups.map((g) => ({ value: g.id, label: g.group_name })), required: true });
    }
  } catch (e) { toast(e.message, 'err'); return false; }
  fields.push({ name: 'slip', label: 'Packing slip (optional)', type: 'file', accept: 'application/pdf,image/png,image/jpeg' });
  const v = await dialogs.form({ title: `Receive ${l.line_code}: ${l.description}`, okText: 'Next: sign', wide: true,
    intro: l.line_type === 'Equipment' ? 'The equipment goes into the register tagged out for qualification; it is released after installation and IQ/OQ.' : l.line_type === 'Inventory item' ? 'This completes the inventory item (no second item is made). If part of the order is still to come, tick "More to come".'
      : 'Confirm the service was done or the items arrived. Supplies can go straight into inventory: tick "Put into inventory" and the new item opens to be filled out.',
    fields,
    // checked while the dialog is open, so nothing typed is lost
    submit: (x) => {
      if (x.discrepancy !== 'None' && !x.note) throw new Error('Describe the problem with the delivery in the note.');
      if (x.slip && x.slip.size > 3.5 * 1024 * 1024) throw new Error('The packing slip is larger than 3.5 MB.');
      return x;
    } });
  if (!v) return false;
  const body = { quantity: Number(v.quantity), more_to_come: v.more_to_come, discrepancy: v.discrepancy, note: v.note, manufacturer_lot: v.manufacturer_lot,
    expiration_date: v.expiration_date, retest_date: v.retest_date, storage_location_id: v.storage_location_id || null, actual_price: numOrNull(v.actual_price) };
  if (l.line_type === 'Equipment') body.equipment = { equipment_name: v.equipment_name, equipment_type_id: v.equipment_type_id, department_id: v.department_id, manufacturer: v.manufacturer, model: v.model, serial_number: v.serial_number, owner_group_id: v.owner_group_id };
  if (intoInv && v.into_inventory) body.inventory = { item_name: l.description, chemical_types: [v.inv_type || 'Consumable'], unit: v.inv_unit || null };
  if (v.slip) body.slip = { file_name: v.slip.name, mime_type: v.slip.type || 'application/pdf', content_base64: await fileToBase64(v.slip) };
  const ok = await signed(dialogs, { what: `Receive ${v.quantity} ${l.unit || ''} on ${l.line_code} ${l.description}${v.discrepancy !== 'None' ? ' (' + v.discrepancy + ')' : ''}${body.inventory ? ' into inventory' : ''}`, meaning: 'Received by', needReason: false },
    (reason, signature) => receiveLine(l.id, { ...body, signature }));
  if (ok && body.inventory && ok.lot_id) {
    // the new item opens to be filled out (storage, analytes, COA...)
    toast(`Received and signed. Inventory item ${ok.lot_code} created: fill it out and save.`);
    window.location.hash = `#/inventory/lots/${ok.lot_id}/edit`;
    return false;
  }
  if (ok) toast('Received and signed.');
  return !!ok;
}

// ---------------------------------------------------------------- vendor approvals: parts under a dialog's fields
// The dialog kit gives back only its own fields, so these keep their values in `holder` (read after the dialog closes).
export function ScopeBoxes({ scopes, ticked = [], allowEvery = false, holder }) {
  const [sel, setSel] = useState(() => new Set(ticked));
  const [every, setEvery] = useState(false);
  holder.all_scopes = every; holder.scope_ids = [...sel];
  const flip = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="field"><label>Approved for <span className="req">*</span></label>
      <div className="picklist">
        {allowEvery && <label className="cb"><input type="checkbox" checked={every} onChange={(e) => setEvery(e.target.checked)} /> <b>Every scope</b> <small>(anything bought from this vendor)</small></label>}
        {scopes.map((sc) => (
          <label key={sc.id} className="cb"><input type="checkbox" checked={sel.has(sc.id)} onChange={() => flip(sc.id)} /> {sc.scope_name} {sc.description && <small>{sc.description}</small>}</label>
        ))}
      </div>
    </div>
  );
}

const KIND_OPTS = DOC_KINDS.map((k) => ({ value: k, label: k }));
export function DocRows({ n, holder }) {
  const [rows, setRows] = useState(() => Array.from({ length: n }, () => ({ file: null, doc_kind: DOC_KINDS[0], title: '', certificate_expires: '' })));
  holder.docs = rows.filter((r) => r.file).map((r) => ({ ...r, title: r.title.trim(), certificate_expires: r.certificate_expires || null }));
  const set = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="field"><label>Documents (questionnaire, certificate, audit report…)</label>
      {rows.map((r, i) => (
        <div key={i} className="docrow">
          <input type="file" accept="application/pdf,image/png,image/jpeg,text/plain,.docx,.xlsx" style={{ maxWidth: 230 }} onChange={(e) => set(i, 'file', e.target.files[0] || null)} />
          <div style={{ width: 160 }}><SmartSelect value={r.doc_kind} options={KIND_OPTS} onChange={(v) => set(i, 'doc_kind', v)} /></div>
          <input placeholder="Title (e.g. ISO 17025 certificate)" style={{ flex: 1, minWidth: 160 }} value={r.title} onChange={(e) => set(i, 'title', e.target.value)} />
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12.5, color: 'var(--muted)' }}>Expires <input type="date" style={{ width: 150 }} value={r.certificate_expires} onChange={(e) => set(i, 'certificate_expires', e.target.value)} /></label>
        </div>
      ))}
    </div>
  );
}

export async function docsToBody(docs) {
  const out = [];
  for (const d of docs) {
    if (d.file.size > 15 * 1024 * 1024) throw new Error(`${d.file.name} is larger than 15 MB`);
    out.push({ file_name: d.file.name, mime_type: d.file.type || 'application/octet-stream', content_base64: await fileToBase64(d.file), doc_kind: d.doc_kind, title: d.title || null, certificate_expires: d.certificate_expires });
  }
  return out;
}
