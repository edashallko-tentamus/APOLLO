// Admin > Lab setup > Waste classifications (0.30.0, migration 052): how each inventory item is disposed of
import { api, esc, pageHeader } from '../app.js';
import { section, editableGrid } from './common.js';

export async function wastePage(main) {
  const d = await api('/waste');
  const mayEdit = (r) => (r.site_id ? d.can_edit : d.sysadmin);
  const canAny = d.can_edit || d.sysadmin;
  const csv = (a) => (Array.isArray(a) ? a.join(', ') : a || '');
  const rows = d.rows.map((r) => ({ ...r, lab: r.site_id ? d.lab.site_code : 'Every lab', hazards: csv(r.hazard_classes), defaults: csv(r.default_for) }));
  const listCheck = (allowed) => (v) => { const bad = String(v || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean).filter((x) => !allowed.some((a) => a.toLowerCase() === x.toLowerCase())); return bad.length ? 'Not on the list: ' + bad.join(', ') : null; };
  const canon = (allowed) => (v) => String(v || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean).map((x) => allowed.find((a) => a.toLowerCase() === x.toLowerCase()) || x).join(', ');
  main.innerHTML = pageHeader('Waste classifications', `How each inventory item is disposed of. Every item has one: chosen on the item, or the default for its type. A classification marked "Needs review" (classify from the SDS) lists its items under Inventory > Waste to classify. Shared classifications (every lab) are kept by system administrators; ${esc(d.lab.site_code)}'s own by its Lab Supervisors, QA and General Managers. Confirm hazard classes and codes with the lab's EHS contact.`,
    '', { kind: 'waste' })
    + `<div class="card">${section('Classifications', `Hazard classes: ${esc(d.hazard_classes.join(', '))}. "Default for" takes item types (${esc(d.item_types.join(', '))}); one default per type in the lab (the lab's own default comes before the shared one). Paste from Excel, fill down with Ctrl+D.`)}<div id="wg"></div></div>`;
  editableGrid({ el: main.querySelector('#wg'), rows, allowAdd: canAny, readOnly: !canAny, what: 'the waste classifications',
    newRow: () => ({ status: 'Active', lab: d.can_edit ? d.lab.site_code : 'Every lab', needs_review: false, hazards: '', defaults: '' }),
    rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''),
    columns: [
      { field: 'waste_code', title: 'Code', type: 'readonly', width: 70 },
      { field: 'waste_name', title: 'Classification', width: 250, required: true, editable: (r, isNew) => isNew || mayEdit(r) },
      { field: 'lab', title: 'Lab', type: 'select', options: [d.lab.site_code, 'Every lab'], width: 90, editable: (r, isNew) => isNew },
      { field: 'hazards', title: 'Hazard classes', width: 190, editable: (r, isNew) => isNew || mayEdit(r), validate: listCheck(d.hazard_classes), canon: canon(d.hazard_classes),
        help: 'Comma-separated: ' + d.hazard_classes.join(', ') },
      { field: 'epa_codes', title: 'EPA codes', width: 130, editable: (r, isNew) => isNew || mayEdit(r), help: 'e.g. D001, F003 (RCRA), and state codes as the lab uses them' },
      { field: 'waste_stream', title: 'Waste stream', width: 170, editable: (r, isNew) => isNew || mayEdit(r), help: 'The accumulation container it goes to' },
      { field: 'container', title: 'Container', width: 190, editable: (r, isNew) => isNew || mayEdit(r) },
      { field: 'disposal_instructions', title: 'How to dispose of it', width: 300, editable: (r, isNew) => isNew || mayEdit(r) },
      { field: 'segregation', title: 'Keep away from', width: 220, editable: (r, isNew) => isNew || mayEdit(r) },
      { field: 'defaults', title: 'Default for', width: 190, editable: (r, isNew) => isNew || mayEdit(r), validate: listCheck(d.item_types), canon: canon(d.item_types),
        help: 'Item types that get this classification when none is chosen on the item' },
      { field: 'needs_review', title: 'Needs review', type: 'bool', width: 95, editable: (r, isNew) => isNew || mayEdit(r), help: 'A placeholder: its items still have to be classified from their SDS' },
      { field: 'items_in_use', title: 'Items', type: 'readonly', width: 60 },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 90, editable: (r, isNew) => isNew || mayEdit(r) },
    ],
    save: (changed, reason) => api('/waste', { method: 'POST', body: { reason, rows: changed.map((r) => {
      const out = { id: r.id };
      for (const k of ['waste_name', 'epa_codes', 'waste_stream', 'container', 'disposal_instructions', 'segregation', 'status']) if (r[k] !== undefined) out[k] = r[k];
      if (r.needs_review !== undefined) out.needs_review = r.needs_review === true || r.needs_review === 'true';
      if (r.hazards !== undefined) out.hazard_classes = canon(d.hazard_classes)(r.hazards).split(', ').filter(Boolean);
      if (r.defaults !== undefined) out.default_for = canon(d.item_types)(r.defaults).split(', ').filter(Boolean);
      if (!r.id) { const full = { ...r }; out.every_lab = (full.lab || '') === 'Every lab'; out.waste_name = full.waste_name; }
      return out; }) } }),
    afterSave: () => wastePage(main) });
}
