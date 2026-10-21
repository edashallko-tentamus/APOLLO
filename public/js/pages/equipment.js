// Equipment (Phase 1, migration 009): the register (list, Add many, Excel export and upload), the due and overdue list,
// each lab's Equipment types and Departments lists, the equipment form (new, duplicate, edit, owners) and the equipment
// page: status, tag-out, recording work, calibrations, qualifications, maintenance schedules, the maintenance log,
// documents, release to service, out of service / retire, and transfer to another lab.
import { api, esc, pageHeader, toast, modal, state, currentSite, badge, link, signDialog, setDirtyCheck } from '../app.js';
import { Grid } from '../grid.js';
import { editableGrid, section, pagedList } from './common.js';
import { equipmentCard } from './logbooks.js';
import { equipmentCard as sensorCard } from './sensors.js';
import { bulkButtons, wireBulk, printTable } from '../bulkio.js';
import { printLabels } from '../labels.js';

const signed = (opts, fn) => signDialog({ ...opts, submit: ({ reason, signature }) => fn(reason, signature) });

const css = document.createElement('style');
css.textContent = `
.eqtabs { display: flex; gap: 6px; flex-wrap: wrap; margin: -4px 0 14px; }
.eqtabs a { text-decoration: none; border: 1px solid var(--line); background: #fff; color: var(--ink); padding: 6px 12px; border-radius: 7px; font-size: 13.5px; }
.eqtabs a.on { background: var(--green-700); border-color: var(--green-700); color: #fff; }
.eqtabs a small { opacity: .8; margin-left: 4px; }
.eqbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; } .eqbar .sp { flex: 1; }
table.grid td.cbad { background: #FDECEA; color: var(--err-ink); font-weight: 600; }
table.grid td.cwarn { background: #FFF4DE; color: var(--warn-ink); font-weight: 600; }
table.grid td.cok { color: var(--green-700); font-weight: 600; }
.statcards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
.statcard { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; background: #fff; }
.statcard span { display: block; color: var(--muted); font-size: 12.5px; } .statcard b { font-size: 16px; }
.statcard.alert { background: #FFF4DE; border-color: #F3D19C; } .statcard.alert b, .statcard.alert span { color: var(--warn-ink); }
.statcard.deficient { background: #FDECEA; border-color: #F5B5AE; } .statcard.deficient b, .statcard.deficient span { color: var(--err-ink); }
.statcard.conforms b { color: var(--green-700); }
.actbar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
.eyebrow { color: var(--muted); font-size: 12.5px; font-weight: 600; letter-spacing: .3px; margin-bottom: -2px; }
.tagcard { border: 1px solid #F5B5AE; background: #FFF7F6; border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; }
.tagcard h3 { margin: 0 0 4px; font-size: 15px; color: var(--err-ink); }
.tagcard .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
.ownerchips span { display: inline-block; background: #E8EEFB; color: #2F5BA8; border-radius: 12px; padding: 1px 10px; margin: 0 4px 4px 0; font-size: 12.5px; font-weight: 600; }
.ownerchips span.person { background: var(--green-50); color: var(--green-700); }
.eqform .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; } .eqform .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0 16px; }
.eqform .field { margin-bottom: 10px; } .eqform .field > label { display: block; font-weight: 600; font-size: 13px; margin-bottom: 2px; }
.eqform input:not([type=checkbox]), .eqform select, .eqform textarea { width: 100%; padding: 7px 9px; border: 1px solid var(--line); border-radius: 6px; font: inherit; }
.ownerpick { display: flex; flex-wrap: wrap; gap: 6px 16px; padding: 4px 0; } .ownerpick label { display: inline-flex; gap: 6px; align-items: center; font-weight: 400 !important; font-size: 13.5px; }
.a-Available { color: var(--green-700); font-weight: 700; } .a-Tagged { color: var(--err-ink); font-weight: 700; } .a-Out, .a-Retired { color: #6B7580; font-weight: 700; }
.eqfoot { color: var(--muted); font-size: 12.5px; border-top: 1px solid var(--line); padding-top: 10px; margin-top: 6px; }
@media (max-width: 900px) { .statcards, .eqform .grid2, .eqform .grid3 { grid-template-columns: 1fr; } }
`;
document.head.appendChild(css);

const d8 = (v) => (v ? String(v).slice(0, 10) : '');
const dLocal = (ts) => { if (!ts) return ''; const t = new Date(ts); t.setMinutes(t.getMinutes() - t.getTimezoneOffset()); return t.toISOString().slice(0, 10); }; // a moment, as a local date
const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '');
const kv = (pairs) => `<dl class="kv">${pairs.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v === null || v === undefined || v === '' ? '—' : v}</dd>`).join('')}</dl>`;
const today = () => { const t = new Date(); t.setMinutes(t.getMinutes() - t.getTimezoneOffset()); return t.toISOString().slice(0, 10); };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const calCls = (s) => (s === 'Deficient' ? 'cbad' : s === 'Alert' ? 'cwarn' : s === 'Conforms' ? 'cok' : '');
const mntCls = (s) => (s === 'Overdue' || s === 'Due today' ? 'cbad' : s === 'Due soon' ? 'cwarn' : '');
const availCls = (a) => 'a-' + String(a || '').split(' ')[0];
const REASONS = ['Maintenance', 'Repair', 'Calibration', 'Qualification'];
const EVENT_TYPES = ['Maintenance', 'Repair', 'Service visit', 'Check', 'Note'];
const QUAL_TYPES = ['IQ', 'OQ', 'PQ', 'IQ/OQ', 'IQ/OQ/PQ', 'Requalification'];
const DOC_TYPES = ['Calibration certificate', 'Service report', 'Qualification report', 'Manual', 'Photo', 'Error log', 'Invoice', 'Checklist', 'Other'];

function needLab(main) {
  if (currentSite()) return true;
  main.innerHTML = '<div class="card err">Choose your lab (top right) first. If none is listed, ask an administrator to add you to a group at a lab.</div>';
  return false;
}
async function fileToBase64(file) {
  const buf = await file.arrayBuffer(); let bin = ''; const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function filePayload(file) {
  if (!file) return null;
  if (file.size > 3.5 * 1024 * 1024) throw new Error('The file is larger than 3.5 MB. Save a smaller PDF and try again.');
  return { file_name: file.name, mime_type: file.type || 'application/pdf', content_base64: await fileToBase64(file) };
}
// Service companies come from the shared supplier list (Purchasing); the name is stored with the record
async function vendorOptions() {
  try { return (await api('/purchasing/suppliers')).filter((x) => x.supplier_record_status === 'Active' && x.supplier_type !== 'Manufacturer').map((x) => x.supplier_name); } catch (_) { return []; }
}
const docUrl = (id) => `/api/equipment/documents/${id}/file?s=${encodeURIComponent(state.site || '')}`;
const fileField = (label = 'Certificate or report (optional)') => `<div class="field"><label for="f_file">${esc(label)}</label><input type="file" id="f_file" accept="application/pdf,image/png,image/jpeg"><div class="help">PDF or image, up to 3.5 MB. Stored unchanged with its SHA-256 fingerprint.</div></div>`;

const TABS = [['#/equipment', 'Equipment'], ['#/equipment/due', 'Due and overdue'], ['#/equipment/lists', 'Equipment types and departments']];
const tabs = (cur, counts = {}) => `<div class="eqtabs">${TABS.map(([h, l]) => `<a href="${h}" class="${h === cur ? 'on' : ''}">${esc(l)}${counts[h] ? ` <small>${counts[h]}</small>` : ''}</a>`).join('')}</div>`;

// ================================================================ THE REGISTER
const FILTERS = {
  active: ['In use', (r) => r.admin_status !== 'Retired'],
  tagged: ['Tagged out', (r) => r.availability === 'Tagged out'],
  caldue: ['Calibration due', (r) => r.admin_status === 'In Service' && ['Alert', 'Deficient'].includes(r.calibration_status)],
  mine: ['Mine', (r) => r.mine && r.admin_status !== 'Retired'],
  retired: ['Retired', (r) => r.admin_status === 'Retired'],
};
const PRINT_COLS = [
  { title: 'ID', get: (r) => r.equipment_code }, { title: 'Name', get: (r) => r.equipment_name }, { title: 'Type', get: (r) => r.type_name },
  { title: 'Manufacturer / model', get: (r) => [r.manufacturer, r.model].filter(Boolean).join(' ') }, { title: 'Serial', get: (r) => r.serial_number },
  { title: 'Calibration expires', get: (r) => d8(r.cal_expires) }, { title: 'Calibration', get: (r) => r.calibration_status },
  { title: 'Availability', get: (r) => r.availability + (r.tagged_for ? ` (${r.tagged_for})` : '') }, { title: 'Owners', get: (r) => r.owners },
];

export async function list(main) {
  if (!needLab(main)) return;
  const me = await api('/equipment/me');
  const site = currentSite();
  const f = FILTERS[state.query.get('show')] ? state.query.get('show') : 'active';
  main.innerHTML = pageHeader(`Equipment: ${site.site_code}`, `Every instrument and small item in ${esc(site.site_name)}, from the HPLC to each pipette. Availability and calibration status are worked out from tags and calibration records; nobody types them. Newest first, 50 at a time; scan or type an ID or serial number and press Enter to open it.`,
    '', { kind: 'equipmentlist' }) + tabs('#/equipment') + `
    <div class="eqbar">
      <span class="sp"></span>${bulkButtons('equipment')}<button class="btn" id="print">Print</button>
      ${me.can_edit ? '<button class="btn" id="many">Add many (paste)</button><button class="btn primary" id="new">+ New equipment</button>' : ''}
    </div><div id="g"></div>`;
  const list = pagedList({
    el: main.querySelector('#g'), url: '/equipment', filter: f, q: state.query.get('find') || '',
    filters: Object.entries(FILTERS).map(([k, [l]]) => [k, l]),
    placeholder: 'Search by ID, name, type, maker, model, serial or owner; scan or type an ID and press Enter',
    open: (r) => { location.hash = '#/equipment/' + r.id; },
    render: (body, rows) => new Grid(body, {
      rows: rows.map((r) => ({ ...r, _pick: false })), emptyText: 'No equipment here yet.',
      onRowOpen: (r) => { location.hash = '#/equipment/' + r.id; },
      rowClass: (r) => (r.admin_status === 'Retired' ? 'mutedrow' : ''),
      columns: [
        ...(me.can_edit ? [{ field: '_dup', title: '', type: 'button', width: 82, label: 'Duplicate', onClick: (r) => { location.hash = '#/equipment/new?from=' + r.id; } }] : []),
        { field: 'equipment_code', title: 'ID', type: 'link', width: 82, href: (r) => '#/equipment/' + r.id },
        { field: 'equipment_name', title: 'Name', type: 'readonly', width: 190 },
        { field: 'type_name', title: 'Type', type: 'readonly', width: 115 },
        { field: 'department_code', title: 'Dept', type: 'readonly', width: 58 },
        { field: 'mfr', title: 'Manufacturer / model', type: 'readonly', width: 165, compute: (r) => [r.manufacturer, r.model].filter(Boolean).join(' ') },
        { field: 'serial_number', title: 'Serial', type: 'readonly', width: 100 },
        { field: 'cal_expires', title: 'Calibration expires', type: 'readonly', width: 100, format: (v, r) => (r.calibration_required ? d8(v) || 'None' : 'Not required'), cellClass: (r) => calCls(r.calibration_status) },
        { field: 'maintenance_due', title: 'Next maintenance', type: 'readonly', width: 100, format: (v) => d8(v) || '–', cellClass: (r) => mntCls(r.maintenance_status) },
        { field: 'availability', title: 'Availability', type: 'readonly', width: 150, format: (v, r) => v + (r.tagged_for ? `: ${r.tagged_for}` : ''), cellClass: (r) => (r.availability === 'Tagged out' ? 'cbad' : r.availability === 'Available' ? 'cok' : '') },
        { field: 'owners', title: 'Owners', type: 'readonly', width: 150, format: (v) => v || 'Nobody (fix this)' },
        { field: '_pick', title: '☐', type: 'bool', width: 40, help: 'Tick rows to export or print only those' },
      ],
    }),
  });
  const g = () => list.grid();
  const picked = () => (g() ? g().rows.filter((r) => r._pick) : []);
  wireBulk(main, { selected: () => picked().map((r) => r.id), done: () => list.reload() });
  main.querySelector('#print').onclick = () => { const p = picked(); printTable(`Equipment: ${site.site_code} (${FILTERS[list.state.f][0]})`, PRINT_COLS, p.length ? p : (g() ? g().v.map((i) => g().rows[i]) : [])); };
  if (me.can_edit) {
    main.querySelector('#new').onclick = () => { location.hash = '#/equipment/new'; };
    main.querySelector('#many').onclick = () => { location.hash = '#/equipment/add'; };
  }
}

// ================================================================ DUE AND OVERDUE (what each owner must do)
export async function due(main) {
  if (!needLab(main)) return;
  const rows = await api('/equipment/due');
  const site = currentSite();
  const mineOnly = state.query.get('mine') === '1';
  const shown = mineOnly ? rows.filter((r) => r.mine) : rows;
  main.innerHTML = pageHeader(`Equipment due and overdue: ${site.site_code}`, 'Calibrations expiring or expired, maintenance due, equipment tagged out (waiting for work or release), and equipment nobody is responsible for. Expired calibrations and maintenance marked "tag out when due" are tagged out automatically.',
    '', { kind: 'equipmentlist' }) + tabs('#/equipment/due', { '#/equipment/due': rows.length || '' }) + `
    <div class="eqbar"><a class="tab ${mineOnly ? '' : 'on'}" href="#/equipment/due" style="text-decoration:none">Everything <small>${rows.length}</small></a>
      <a class="tab ${mineOnly ? 'on' : ''}" href="#/equipment/due?mine=1" style="text-decoration:none">Only equipment I am responsible for <small>${rows.filter((r) => r.mine).length}</small></a></div>
    <div id="g"></div>`;
  new Grid(main.querySelector('#g'), {
    rows: shown, readOnly: true, search: true, emptyText: 'Nothing due. Everything is calibrated, maintained and available.',
    onRowOpen: (r) => { location.hash = '#/equipment/' + r.equipment_id; },
    columns: [
      { field: 'urgency', title: 'Urgency', type: 'readonly', width: 90, cellClass: (r) => (r.urgency === 'Due soon' ? 'cwarn' : 'cbad') },
      { field: 'kind', title: 'What', type: 'readonly', width: 100 },
      { field: 'equipment_code', title: 'ID', type: 'link', width: 90, href: (r) => '#/equipment/' + r.equipment_id },
      { field: 'equipment_name', title: 'Name', type: 'readonly', width: 210 },
      { field: 'type_name', title: 'Type', type: 'readonly', width: 120 },
      { field: 'what', title: 'Detail', type: 'readonly', width: 340 },
      { field: 'due_date', title: 'Due / since', type: 'readonly', width: 100, format: d8 },
      { field: 'owners', title: 'Responsible', type: 'readonly', width: 190, format: (v) => v || 'Nobody' },
      { field: 'mine', title: 'Mine', type: 'readonly', width: 55, format: (v) => (v ? 'Yes' : '') },
    ],
  });
}

// ================================================================ EACH LAB'S LISTS: EQUIPMENT TYPES, DEPARTMENTS
export async function lists(main) {
  if (!needLab(main)) return;
  const [L, me] = await Promise.all([api('/equipment/lists'), api('/equipment/me')]);
  const site = currentSite();
  main.innerHTML = pageHeader(`Equipment types and departments: ${site.site_code}`, `${esc(site.site_name)}'s own lists, picked on each piece of equipment. A type or department in use cannot be removed: set it Inactive.`,
    '', { kind: 'equipmentlists' }) + tabs('#/equipment/lists') + `
    ${me.can_lists ? '' : '<div class="notice">You can view these lists. Changing them needs the equipment.lists permission in this lab.</div>'}
    <div class="cols"><div class="card">${section('Equipment types')}<div id="tg"></div></div><div class="card">${section('Departments')}<div id="dg"></div></div></div>`;
  editableGrid({
    el: main.querySelector('#tg'), rows: L.types, allowAdd: me.can_lists, readOnly: !me.can_lists, what: 'equipment types', search: true,
    newRow: () => ({ status: 'Active' }), rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''),
    sign: (rows) => ({ meaning: 'Changed by', action: `Equipment types (${site.site_code}): ${rows.length} change(s)` }),
    columns: [{ field: 'type_name', title: 'Type', required: true, width: 170 }, { field: 'description', title: 'Description', width: 240 },
      { field: 'equipment_count', title: 'In use', type: 'readonly', width: 60 }, { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 80 }],
    save: (rows, reason, signature) => api('/equipment/types/bulk', { method: 'POST', body: { rows, reason, signature } }),
    afterSave: () => lists(main),
  });
  editableGrid({
    el: main.querySelector('#dg'), rows: L.departments, allowAdd: me.can_lists, readOnly: !me.can_lists, what: 'departments',
    newRow: () => ({ status: 'Active' }), rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''),
    sign: (rows) => ({ meaning: 'Changed by', action: `Departments (${site.site_code}): ${rows.length} change(s)` }),
    columns: [{ field: 'department_code', title: 'Code', required: true, width: 80 }, { field: 'department_name', title: 'Department', required: true, width: 180 },
      { field: 'equipment_count', title: 'In use', type: 'readonly', width: 60 }, { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 80 }],
    save: (rows, reason, signature) => api('/equipment/departments/bulk', { method: 'POST', body: { rows, reason, signature } }),
    afterSave: () => lists(main),
  });
}

// ================================================================ NEW / DUPLICATE / EDIT
const sel = (id, options, value, blank = true) => `<select id="${id}">${blank ? '<option value=""></option>' : ''}${options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(value ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
const inp = (id, value, type = 'text', attrs = '') => `<input id="${id}" type="${type}" value="${esc(value ?? '')}" ${attrs}>`;
const fld = (label, ctrl, help = '', req = false) => `<div class="field"><label>${esc(label)}${req ? ' <span class="req">*</span>' : ''}</label>${ctrl}${help ? `<div class="help">${help}</div>` : ''}</div>`;

export async function form(main, editId) {
  if (!needLab(main)) return;
  const fromId = state.query.get('from');
  const [L, src] = await Promise.all([api('/equipment/lists'), editId || fromId ? api('/equipment/' + (editId || fromId)) : null]);
  const site = currentSite();
  const e = src ? src.eq : { calibration_alert_days: 30 };
  // Duplicate copies type, department, maker, model, calibration settings and owners; clears ID, serial and asset tag
  const v = editId ? e : { ...e, serial_number: '', asset_tag: '', equipment_name: fromId ? e.equipment_name + ' (copy)' : '', in_service_date: fromId ? '' : '' };
  const ownersNow = src ? src.owners : [];
  const has = (k, id) => ownersNow.some((o) => o[k] === id);
  const types = L.types.filter((t) => t.status === 'Active' || t.id === v.equipment_type_id).map((t) => ({ value: t.id, label: t.type_name }));
  const depts = L.departments.filter((d) => d.status === 'Active' || d.id === v.department_id).map((d) => ({ value: d.id, label: `${d.department_code} ${d.department_name}` }));
  const locs = L.locations.map((l) => ({ value: l.id, label: `${l.location_code}: ${l.path}` }));
  main.innerHTML = `<div class="eyebrow">${editId ? esc(e.equipment_code) : fromId ? 'Duplicate of ' + esc(e.equipment_code) : 'New'} · ${esc(site.site_code)}</div>` +
    pageHeader(editId ? `Edit ${e.equipment_name}` : 'New equipment', 'Saving asks for your electronic signature. At least one group or person must be responsible for it: they get its calibration and maintenance warnings.',
      `<a class="btn ghost" href="${editId ? '#/equipment/' + editId : '#/equipment'}">Cancel</a>`) + `
    ${types.length ? '' : '<div class="notice">This lab has no equipment types yet: add them on the Equipment types and departments tab first.</div>'}
    <div class="card eqform">
      <div class="grid2">${fld('Name', inp('e_name', v.equipment_name), 'What people call it, e.g. "HPLC 2 (pesticides)" or "Pipette P200 #4"', true)}
        ${fld('Type', sel('e_type', types, v.equipment_type_id), 'From this lab\'s Equipment types list', true)}</div>
      <div class="grid3">${fld('Manufacturer', inp('e_mfr', v.manufacturer))}${fld('Model', inp('e_model', v.model))}${fld('Department', sel('e_dept', depts, v.department_id), 'Every piece of equipment belongs to a department', true)}</div>
      <div class="grid3">${fld('Serial number', inp('e_serial', v.serial_number), 'Unique for the manufacturer')}${fld('Asset tag', inp('e_asset', v.asset_tag))}${fld('In service since', inp('e_since', d8(v.in_service_date), 'date'))}</div>
      <div class="grid2">${fld('Location', sel('e_loc', locs, v.location_id), 'From Inventory > Storage locations (optional)')}${fld('Location note', inp('e_locnote', v.location_note), 'e.g. "Bench 3, left"')}</div>
      <div class="grid3">${fld('Calibration', `<label class="cb"><input type="checkbox" id="e_calreq" ${v.calibration_required ? 'checked' : ''}> Needs calibration</label>`)}
        ${fld('Calibration interval (months)', inp('e_interval', v.calibration_interval_months, 'number', 'min="1" step="1"'), 'Sets the default expiry of each calibration')}
        ${fld('Warn this many days before expiry', inp('e_alert', v.calibration_alert_days ?? 30, 'number', 'min="0" step="1"'), 'Default 30 (not yet confirmed with the labs)')}</div>
      ${fld('Qualification', `<label class="cb"><input type="checkbox" id="e_qualreq" ${v.qualification_required ? 'checked' : ''}> Needs IQ/OQ/PQ</label>`)}
      ${fld('Responsible: groups', `<div class="ownerpick">${L.groups.map((g) => `<label title="${esc(g.description || '')}"><input type="checkbox" data-og="${g.id}" ${has('group_id', g.id) ? 'checked' : ''}> ${esc(g.group_name)}</label>`).join('')}</div>`, 'Everyone in a ticked group is responsible (for example HPLC Team or Lab Supervisor)', true)}
      ${fld('Responsible: named people', `<div class="ownerpick">${L.people.map((u) => `<label><input type="checkbox" data-ou="${u.id}" ${has('user_id', u.id) ? 'checked' : ''}> ${esc(u.full_name)}</label>`).join('')}</div>`, 'Optional, for example a General Manager')}
      ${fld('Notes', `<textarea id="e_notes" rows="2">${esc(v.notes || '')}</textarea>`)}
      <div class="merr" id="ferr"></div>
      <div class="actbar"><button class="btn primary" id="save">${editId ? 'Save changes' : 'Create equipment'}</button></div>
    </div>`;
  const val = (id) => main.querySelector('#' + id).value.trim();
  let touched = false; main.querySelector('.eqform').addEventListener('input', () => { touched = true; });
  setDirtyCheck(() => touched);
  main.querySelector('#save').onclick = async () => {
    const row = {
      equipment_name: val('e_name'), equipment_type_id: val('e_type') || null, department_id: val('e_dept') || null, manufacturer: val('e_mfr') || null,
      model: val('e_model') || null, serial_number: val('e_serial') || null, asset_tag: val('e_asset') || null, location_id: val('e_loc') || null,
      location_note: val('e_locnote') || null, in_service_date: val('e_since') || null, notes: val('e_notes') || null,
      calibration_required: main.querySelector('#e_calreq').checked, qualification_required: main.querySelector('#e_qualreq').checked,
      calibration_interval_months: val('e_interval') === '' ? null : Number(val('e_interval')), calibration_alert_days: val('e_alert') === '' ? 30 : Number(val('e_alert')),
    };
    const owners = [...main.querySelectorAll('[data-og]:checked')].map((c) => ({ group_id: c.dataset.og })).concat([...main.querySelectorAll('[data-ou]:checked')].map((c) => ({ user_id: c.dataset.ou })));
    const err = (m) => { main.querySelector('#ferr').textContent = m; };
    if (!row.equipment_name) return err('Give it a name.');
    if (!row.equipment_type_id) return err('Pick its type.');
    if (!row.department_id) return err('Pick the department it belongs to.');
    if (!owners.length) return err('Tick at least one group or person responsible for it.');
    err('');
    const r = await signed({ what: editId ? `Changes to ${e.equipment_code} ${row.equipment_name}` : `New equipment: ${row.equipment_name}`, meaning: editId ? 'Changed by' : 'Created by', needReason: !!editId },
      (reason, signature) => api(editId ? '/equipment/' + editId : '/equipment', { method: editId ? 'PUT' : 'POST', body: { row, owners, reason, signature } }));
    if (!r) return;
    setDirtyCheck(null);
    toast(editId ? 'Saved and signed.' : `Created ${r.equipment_code} and signed.`);
    location.hash = '#/equipment/' + (editId || r.id);
  };
}

// ================================================================ ADD MANY (paste from Excel, fill down)
export async function addMany(main) {
  if (!needLab(main)) return;
  const L = await api('/equipment/lists');
  const site = currentSite();
  const types = L.types.filter((t) => t.status === 'Active').map((t) => ({ value: t.id, label: t.type_name }));
  const depts = L.departments.filter((d) => d.status === 'Active').map((d) => ({ value: d.id, label: d.department_code, match: [d.department_name] }));
  const groups = L.groups.map((g) => ({ value: g.id, label: g.group_name }));
  main.innerHTML = pageHeader(`Add many: ${site.site_code}`, 'For pipettes, thermometers, balances and other items you add in batches. Paste rows from Excel (Ctrl+V) and fill down (Ctrl+D) the type, maker and responsible group. One signature covers them all. To add owners beyond one group, edit each item afterwards, or use Upload XLSX on the list.',
    '<a class="btn ghost" href="#/equipment">Back to the list</a>') + tabs('#/equipment') + '<div class="card"><div id="g"></div></div>';
  editableGrid({
    el: main.querySelector('#g'), rows: Array.from({ length: 8 }, () => ({ calibration_required: true, calibration_alert_days: 30 })), allowAdd: true,
    newRow: () => ({ calibration_required: true, calibration_alert_days: 30 }), what: 'new equipment', needReason: false,
    sign: (rows) => ({ meaning: 'Created by', action: `New equipment: ${plural(rows.filter((r) => r.equipment_name).length, 'item')}` }),
    columns: [
      { field: 'equipment_name', title: 'Name', required: true, width: 190 },
      { field: 'equipment_type_id', title: 'Type', type: 'select', options: types, required: true, width: 140 },
      { field: 'department_id', title: 'Dept', type: 'select', options: depts, required: true, width: 80 },
      { field: 'manufacturer', title: 'Manufacturer', width: 120 }, { field: 'model', title: 'Model', width: 140 },
      { field: 'serial_number', title: 'Serial', width: 110 }, { field: 'asset_tag', title: 'Asset tag', width: 90 },
      { field: 'calibration_required', title: 'Needs calibration', type: 'bool', width: 85 },
      { field: 'calibration_interval_months', title: 'Interval (months)', type: 'int', min: 1, width: 85 },
      { field: 'calibration_alert_days', title: 'Warn (days)', type: 'int', min: 0, width: 75 },
      { field: 'owner_group_id', title: 'Responsible group', type: 'select', options: groups, required: true, width: 150 },
    ],
    // the starting rows count as unchanged, so their defaults are added back here
    save: (rows, reason, signature) => api('/equipment/many', { method: 'POST', body: { rows: rows.filter((r) => r.equipment_name).map((r) => ({ calibration_required: true, calibration_alert_days: 30, ...r })), reason, signature } }),
    afterSave: () => { location.hash = '#/equipment'; },
  });
}

// ================================================================ THE EQUIPMENT PAGE
function statCard(label, text, cls) { return `<div class="statcard ${cls || ''}"><span>${esc(label)}</span><b>${esc(text)}</b></div>`; }

export async function detail(main, id) {
  const [d, me] = await Promise.all([api('/equipment/' + id), api('/equipment/me')]);
  const e = d.eq;
  const retired = e.admin_status === 'Retired';
  const openTags = d.tags.filter((t) => !t.tagged_in_at);
  const btn = (key, label, show, primary) => (show ? `<button class="btn ${primary ? 'primary' : ''}" data-act="${key}">${esc(label)}</button>` : '');
  const calText = !e.calibration_required ? 'Not required' : !e.cal_id ? 'Deficient: no calibration on record'
    : e.cal_result === 'Fail' ? 'Deficient: last calibration failed' : e.cal_days_left < 0 ? `Deficient: expired ${d8(e.cal_expires)}`
      : `${e.calibration_status}: expires ${d8(e.cal_expires)} (${plural(e.cal_days_left, 'day')})`;
  const calClass = { Deficient: 'deficient', Alert: 'alert', Conforms: 'conforms' }[e.calibration_status] || '';
  const avText = e.availability === 'Tagged out' ? `Tagged out: ${e.tagged_for}` : e.availability;
  const mText = e.maintenance_due ? `${e.maintenance_status}: ${e.maintenance_task} (${d8(e.maintenance_due)})` : 'No schedule';
  const tagCard = (t) => {
    const release = t.reason !== 'Maintenance';
    const workDone = Number(t.work_count) > 0;
    const needCal = t.reason === 'Calibration' && !Number(t.passing_calibrations);
    const needQual = t.reason === 'Qualification' && !Number(t.passing_qualifications);
    const canIn = release ? me.can_release && !t.i_worked_on_it && workDone && !needCal && !needQual : me.can_tag;
    const hint = release
      ? (!workDone || needCal || needQual ? `Next: record the ${needCal ? 'passing calibration' : needQual ? 'passing qualification' : 'work done'}, then someone with the release permission who did not tag it out or do the work releases it.`
        : t.i_worked_on_it ? 'You tagged it out or did or recorded the work, so someone else must release it.' : me.can_release ? 'Work recorded: ready for your release.' : 'Work recorded: waiting for release by QA (equipment.release).')
      : 'Record what was done and tag it back in (the summary can be typed when tagging in).';
    return `<div class="tagcard"><h3>${esc(t.tag_code)}: tagged out for ${esc(t.reason.toLowerCase())}${t.source !== 'Manual' ? ` (automatic: ${esc(t.source.toLowerCase())})` : ''}</h3>
      <div>${esc(t.description || t.task_name || '')}</div>
      <div class="help">Tagged out ${esc(dt(t.tagged_out_at))} by ${esc(t.tagged_out_name)} · Work records: ${Number(t.work_count)}</div>
      <div class="row">
        ${me.can_tag && !release ? `<button class="btn" data-work="${t.id}">Record work</button>` : ''}
        ${release && t.reason === 'Calibration' && me.can_calibrate ? `<button class="btn" data-calib="${t.id}">Record calibration</button>` : ''}
        ${release && t.reason === 'Qualification' && me.can_calibrate ? `<button class="btn" data-qual="${t.id}">Record qualification</button>` : ''}
        ${release && t.reason === 'Repair' && me.can_tag ? `<button class="btn" data-work="${t.id}">Record repair</button>` : ''}
        ${canIn ? `<button class="btn primary" data-in="${t.id}">${release ? 'Release to service' : 'Tag back in'}</button>` : ''}
        <span class="help">${esc(hint)}</span></div></div>`;
  };

  main.innerHTML = `<div class="eyebrow">${esc(e.equipment_code)} · ${esc(e.site_code)} · ${esc(e.type_name)}</div>` + pageHeader(e.equipment_name,
    `${badge(e.admin_status)} <span class="${availCls(e.availability)}">${esc(avText)}</span>`,
    `<a class="btn ghost" href="#/equipment">All equipment</a> <button class="btn" id="eqlabel" title="Barcode label with the name and calibration expiry (Dymo, 1 x 2 1/8 in.)">Print label</button>${me.can_edit ? ` <a class="btn" href="#/equipment/new?from=${e.id}">Duplicate</a> <a class="btn primary" href="#/equipment/${e.id}/edit">Edit</a>` : ''}`, { kind: 'equipment', id }) + `
    <div class="actbar">
      ${btn('tagout', 'Tag out', me.can_tag && !retired, true)}
      ${btn('work', 'Record maintenance or a check', me.can_tag && !retired)}
      ${btn('calib', 'Record calibration', me.can_calibrate && !retired)}
      ${btn('qual', 'Record qualification', me.can_calibrate && !retired)}
      ${btn('doc', 'Upload document', (me.can_edit || me.can_tag || me.can_calibrate) && !retired)}
      ${btn('oos', 'Take out of service', me.can_edit && e.admin_status === 'In Service')}
      ${btn('ins', 'Put back in service', me.can_edit && e.admin_status !== 'In Service')}
      ${btn('retire', 'Retire', me.can_edit && !retired)}
      ${btn('transfer', 'Transfer to another lab', me.can_edit && !retired)}
    </div>
    ${Number(e.owner_count) ? '' : '<div class="notice">Nobody is responsible for this equipment (a group was set Inactive or a person left). Edit it and tick a group or person.</div>'}
    <div class="statcards">${statCard('Availability', avText, e.availability === 'Tagged out' ? 'deficient' : e.availability === 'Available' ? 'conforms' : '')}
      ${statCard('Calibration', calText, calClass)}${statCard('Next maintenance', mText, e.maintenance_status === 'Overdue' || e.maintenance_status === 'Due today' ? 'deficient' : e.maintenance_status === 'Due soon' ? 'alert' : '')}</div>
    ${openTags.map(tagCard).join('')}
    <div class="cols">
      <div class="card"><h2>Identity</h2>${kv([
        ['Equipment ID', esc(e.equipment_code) + ' <span class="help">(given by the system)</span>'], ['Type', esc(e.type_name)], ['Department', esc([e.department_code, e.department_name].filter(Boolean).join(' '))],
        ['Manufacturer', esc(e.manufacturer)], ['Model', esc(e.model)], ['Serial number', esc(e.serial_number)], ['Asset tag', esc(e.asset_tag)],
        ['Location', e.location_id ? link('#/inventory/locations/' + e.location_id, e.location_code) + ` <span class="help">${esc(e.location_path || '')}</span>` : ''], ['Location note', esc(e.location_note)],
        ['In service since', esc(d8(e.in_service_date))], ['Notes', esc(e.notes)]])}</div>
      <div class="card"><h2>Responsible and settings</h2>${kv([
        ['Responsible', `<span class="ownerchips">${d.owners.map((o) => `<span class="${o.user_id ? 'person' : ''}">${esc(o.group_name || o.full_name)}</span>`).join('') || '<b class="bad">Nobody</b>'}</span>`],
        ['Calibration', e.calibration_required ? `Required${e.calibration_interval_months ? `, every ${plural(e.calibration_interval_months, 'month')}` : ''}; warn ${plural(e.calibration_alert_days, 'day')} before expiry` : 'Not required'],
        ['IQ/OQ/PQ', e.qualification_required ? 'Required' : 'Not required'],
        ['Current calibration', e.cal_id ? `${esc(e.cal_code)}: ${esc(d8(e.cal_date))} to ${esc(d8(e.cal_expires))} (${esc(e.cal_result)})` : ''],
        ['Status', esc(e.admin_status)]])}</div>
    </div>
    <div id="eqsn"></div>
    <div id="eqlb"></div>
    <div class="card">${section('Calibration history', 'One record per calibration, newest first; the newest active one is current. Changing an expiry, date or result needs the release permission and someone other than whoever did or recorded it.')}<div id="cg"></div></div>
    <div class="card">${section('Maintenance schedules', 'When each task is next due. "Tag out when due" tags the equipment out automatically on that day. Recording the work moves the next due date on.')}<div id="sg"></div></div>
    <div class="card">${section('Maintenance log', 'Every tag-out, tag-in, repair, maintenance, check and service visit, newest first. Append-only.')}<div id="lg"></div></div>
    <div class="card">${section('Qualifications (IQ/OQ/PQ)')}<div id="qg"></div></div>
    <div class="card">${section('Documents', 'Certificates, service reports, manuals, photos. Kept exactly as uploaded with their SHA-256 fingerprint; set one Inactive instead of deleting it.')}<div id="dg"></div></div>
    ${d.transfers.length ? `<div class="card">${section('Transfers between labs')}<div id="xg"></div></div>` : ''}
    <div class="eqfoot">Created ${esc(dt(e.created_at))} by ${esc(e.created_by_name)} · Last changed ${esc(dt(e.modified_at))} by ${esc(e.modified_by_name)} · Audit trail: the clock icon next to the name</div>`;
  equipmentCard(main.querySelector('#eqlb'), e.id);   // its logbooks (L-1, migration 034)
  sensorCard(main.querySelector('#eqsn'), e.id);   // its sensors (0.25.0)

  main.querySelector('#eqlabel').onclick = () => printLabels('equipment', [e.id]);
  // Calibration history (QA corrections in the grid: expiry, date, result, withdraw)
  editableGrid({
    el: main.querySelector('#cg'), rows: d.calibrations, readOnly: !(me.can_release || me.can_calibrate), what: 'calibration records',
    emptyText: 'No calibrations recorded.', rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''),
    sign: (rows) => ({ meaning: 'Changed by', action: `Calibration records of ${e.equipment_code}: ${rows.length} change(s)` }),
    columns: [
      { field: 'calibration_code', title: 'Record', type: 'readonly', width: 95 },
      { field: 'performed_date', title: 'Calibrated', type: 'date', width: 100, editable: () => me.can_release, format: d8 },
      { field: 'expiration_date', title: 'Expires', type: 'date', width: 100, editable: () => me.can_release, format: d8 },
      { field: 'result', title: 'Result', type: 'select', options: ['Pass', 'Fail'], width: 70, editable: () => me.can_release, cellClass: (r) => (r.result === 'Fail' ? 'cbad' : '') },
      { field: 'performed_by', title: 'Done by', type: 'readonly', width: 170 },
      { field: 'certificate_number', title: 'Certificate #', width: 120, editable: () => me.can_calibrate },
      { field: 'docs', title: 'Certificate', type: 'link', width: 140, format: (v) => (v && v.length ? v[0].title : ''), href: (r) => (r.docs && r.docs.length ? docUrl(r.docs[0].id) : null) },
      { field: 'tag_code', title: 'Under tag', type: 'readonly', width: 95 },
      { field: 'recorded_by', title: 'Recorded by', type: 'readonly', width: 130 },
      { field: 'notes', title: 'Notes', width: 200, editable: () => me.can_calibrate },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 80, editable: () => me.can_release, help: 'Inactive = withdrawn (entered in error); needs the release permission' },
    ],
    save: async (rows, reason, signature) => { for (const r of rows) await api('/equipment/calibrations/' + r.id, { method: 'PUT', body: { row: r, reason, signature } }); },
    afterSave: () => detail(main, id),
  });
  main.querySelectorAll('#cg a[data-link]').forEach((a) => { a.target = '_blank'; });

  editableGrid({
    el: main.querySelector('#sg'), rows: d.schedules, allowAdd: me.can_edit && !retired, readOnly: !me.can_edit || retired, what: 'maintenance schedules',
    emptyText: 'No maintenance scheduled.', newRow: () => ({ interval_unit: 'months', interval_count: 1, alert_days: 7, tag_out_when_due: true, status: 'Active' }),
    rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''),
    sign: (rows) => ({ meaning: 'Changed by', action: `Maintenance schedules of ${e.equipment_code}: ${rows.length} change(s)` }),
    columns: [
      { field: 'task_name', title: 'Task', required: true, width: 230 },
      { field: 'interval_count', title: 'Every', type: 'int', min: 1, required: true, width: 60 },
      { field: 'interval_unit', title: 'Unit', type: 'select', options: ['days', 'weeks', 'months', 'years'], required: true, width: 80 },
      { field: 'next_due_date', title: 'Next due', type: 'date', required: true, width: 100, format: d8, cellClass: (r) => (r.days_left === undefined || r.days_left === null ? '' : r.days_left <= 0 ? 'cbad' : r.days_left <= r.alert_days ? 'cwarn' : '') },
      { field: 'alert_days', title: 'Warn (days)', type: 'int', min: 0, width: 75 },
      { field: 'tag_out_when_due', title: 'Tag out when due', type: 'bool', width: 90 },
      { field: 'instructions', title: 'Instructions / SOP', width: 220 },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 80 },
    ],
    save: (rows, reason, signature) => api(`/equipment/${id}/schedules`, { method: 'POST', body: { rows, reason, signature } }),
    afterSave: () => detail(main, id),
  });

  // The maintenance log: tags, work records, calibrations and qualifications on one timeline
  const log = [
    ...d.tags.map((t) => ({ when: t.tagged_out_at, date: dLocal(t.tagged_out_at), what: `Tagged out (${t.reason})`, ref: t.tag_code, detail: t.description || '', who: t.tagged_out_name + (t.source !== 'Manual' ? ' (automatic)' : '') })),
    ...d.tags.filter((t) => t.tagged_in_at).map((t) => ({ when: t.tagged_in_at, date: dLocal(t.tagged_in_at), what: t.tag_in_meaning === 'Released by' ? 'Released to service' : 'Tagged back in', ref: t.tag_code, detail: `${t.reason}`, who: t.tagged_in_name })),
    ...d.events.map((v) => ({ when: v.created_at, date: d8(v.performed_date), what: v.event_type, ref: v.event_code, detail: v.summary + (v.task_name ? ` [schedule: ${v.task_name}]` : '') + (v.tag_code ? ` [${v.tag_code}]` : ''), who: v.performed_by + (v.recorded_by !== v.performed_by ? ` (recorded by ${v.recorded_by})` : ''), inactive: v.status === 'Inactive' })),
    ...d.calibrations.map((k) => ({ when: k.created_at, date: d8(k.performed_date), what: `Calibration: ${k.result}`, ref: k.calibration_code, detail: `Expires ${d8(k.expiration_date)}${k.certificate_number ? ', certificate ' + k.certificate_number : ''}`, who: k.performed_by, inactive: k.status === 'Inactive' })),
    ...d.qualifications.map((q) => ({ when: q.created_at, date: d8(q.performed_date), what: `${q.qualification_type}: ${q.result}`, ref: q.qualification_code, detail: q.protocol_reference || '', who: q.performed_by, inactive: q.status === 'Inactive' })),
    ...d.transfers.map((x) => ({ when: x.created_at, date: dLocal(x.created_at), what: 'Transferred', ref: '', detail: `${x.from_code} to ${x.to_code}${x.notes ? ': ' + x.notes : ''}`, who: x.by_name })),
  ].sort((a, b) => String(b.when).localeCompare(String(a.when)));
  new Grid(main.querySelector('#lg'), { readOnly: true, search: true, rows: log, emptyText: 'Nothing recorded yet.', rowClass: (r) => (r.inactive ? 'mutedrow' : ''), columns: [
    { field: 'date', title: 'Date', type: 'readonly', width: 95 }, { field: 'what', title: 'What', type: 'readonly', width: 170 },
    { field: 'ref', title: 'Record', type: 'readonly', width: 100 }, { field: 'detail', title: 'Detail', type: 'readonly', width: 430 },
    { field: 'who', title: 'By', type: 'readonly', width: 230 }] });

  editableGrid({
    el: main.querySelector('#qg'), rows: d.qualifications, readOnly: !me.can_release, what: 'qualification records', emptyText: 'No qualifications recorded.',
    rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''),
    sign: (rows) => ({ meaning: 'Changed by', action: `Qualification records of ${e.equipment_code}: ${rows.length} change(s)` }),
    columns: [
      { field: 'qualification_code', title: 'Record', type: 'readonly', width: 90 }, { field: 'qualification_type', title: 'Type', type: 'readonly', width: 110 },
      { field: 'performed_date', title: 'Done', type: 'date', width: 100, format: d8 }, { field: 'result', title: 'Result', type: 'select', options: ['Pass', 'Fail'], width: 70 },
      { field: 'performed_by', title: 'Done by', type: 'readonly', width: 170 }, { field: 'protocol_reference', title: 'Protocol', width: 130 },
      { field: 'tag_code', title: 'Under tag', type: 'readonly', width: 95 }, { field: 'notes', title: 'Notes', width: 200 },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 80 }],
    save: async (rows, reason, signature) => { for (const r of rows) await api('/equipment/qualifications/' + r.id, { method: 'PUT', body: { row: r, reason, signature } }); },
    afterSave: () => detail(main, id),
  });

  editableGrid({
    el: main.querySelector('#dg'), rows: d.documents, readOnly: !(me.can_edit || me.can_tag || me.can_calibrate), what: 'equipment documents', emptyText: 'No documents uploaded.',
    rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''),
    sign: (rows) => ({ meaning: 'Changed by', action: `Documents of ${e.equipment_code}: ${rows.length} change(s)` }),
    columns: [
      { field: 'file_name', title: 'File', type: 'link', width: 200, href: (r) => docUrl(r.id) },
      { field: 'title', title: 'Title', width: 220 }, { field: 'doc_type', title: 'Type', type: 'select', options: DOC_TYPES, width: 160 },
      { field: 'linked', title: 'For', type: 'readonly', width: 110, compute: (r) => r.calibration_code || r.qualification_code || r.event_code || r.tag_code || '' },
      { field: 'uploaded_by', title: 'Uploaded', type: 'readonly', width: 190, format: (v, r) => `${v} ${dt(r.created_at)}` },
      { field: 'sha256', title: 'SHA-256', type: 'readonly', width: 110, format: (v) => (v ? v.slice(0, 12) + '…' : '') },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 80 }],
    save: (rows, reason, signature) => api('/equipment/documents/bulk', { method: 'POST', body: { rows, reason, signature } }),
    afterSave: () => detail(main, id),
  });
  main.querySelectorAll('#dg a[data-link]').forEach((a) => { a.target = '_blank'; });

  if (d.transfers.length) new Grid(main.querySelector('#xg'), { readOnly: true, rows: d.transfers, columns: [
    { field: 'created_at', title: 'When', type: 'readonly', width: 140, format: dt }, { field: 'from_code', title: 'From', type: 'readonly', width: 70 },
    { field: 'to_code', title: 'To', type: 'readonly', width: 70 }, { field: 'by_name', title: 'By', type: 'readonly', width: 150 }, { field: 'notes', title: 'Notes', type: 'readonly', width: 300 }] });

  // ------------------------------------------------------------ actions
  const reload = () => detail(main, id);
  const name = `${e.equipment_code} ${e.equipment_name}`;
  const post = (path, body) => (reason, signature) => api(path, { method: 'POST', body: { ...body, reason: reason || body.reason, signature } });
  const tagOpts = (reason) => openTags.filter((t) => !reason || t.reason === reason).map((t) => ({ value: t.id, label: `${t.tag_code} (${t.reason})` }));

  async function recordWork(tagId) {
    const tag = d.tags.find((t) => t.id === tagId);
    const v = await modal({ title: `Record ${tag ? tag.reason.toLowerCase() : 'maintenance or a check'}: ${e.equipment_code}`, okText: 'Next: sign',
      intro: 'What was done, when and by whom. Leave "Done by a company" empty if you did it yourself. Scheduled work moves that schedule\'s next due date on.',
      fields: [
        { name: 'event_type', label: 'Kind', type: 'select', options: EVENT_TYPES, value: tag ? (tag.reason === 'Repair' ? 'Repair' : 'Maintenance') : 'Maintenance', blank: false },
        { name: 'performed_date', label: 'Date done', type: 'date', value: today(), required: true },
        { name: 'summary', label: 'What was done', type: 'textarea', required: true },
        { name: 'performed_by_vendor', label: 'Done by a company (from the supplier list; empty if you did it)', type: 'select', options: await vendorOptions() },
        { name: 'tag_id', label: 'Under tag', type: 'select', options: tagOpts(), value: tagId || '' },
        { name: 'schedule_id', label: 'For scheduled task', type: 'select', options: d.schedules.filter((s) => s.status === 'Active').map((s) => ({ value: s.id, label: `${s.task_name} (due ${d8(s.next_due_date)})` })), value: tag && tag.schedule_id ? tag.schedule_id : '' },
      ] });
    if (!v) return false;
    return signed({ what: `${v.event_type} on ${name}: ${v.summary}`, meaning: 'Performed by', needReason: false }, post(`/equipment/${id}/events`, { row: v }));
  }
  async function recordCalibration(tagId) {
    const calTag = tagId || (tagOpts('Calibration')[0] || {}).value || '';
    let file = null;
    const v = await modal({ title: `Record calibration: ${e.equipment_code}`, okText: 'Next: sign', wide: true,
      intro: `${e.calibration_interval_months ? `Leave the expiry empty to use the interval (${plural(e.calibration_interval_months, 'month')}).` : 'This equipment has no interval: give the expiry date.'} Leave "Done by a company" empty if you did it yourself.`,
      fields: [
        { name: 'performed_date', label: 'Calibrated on', type: 'date', value: today(), required: true },
        { name: 'result', label: 'Result', type: 'select', options: ['Pass', 'Fail'], value: 'Pass', blank: false },
        { name: 'expiration_date', label: 'Expires', type: 'date' },
        { name: 'performed_by_vendor', label: 'Done by a company (from the supplier list; empty if you did it)', type: 'select', options: await vendorOptions() },
        { name: 'certificate_number', label: 'Certificate number' },
        { name: 'tag_id', label: 'Under tag', type: 'select', options: tagOpts(), value: calTag },
        { name: 'notes', label: 'Notes' },
      ], html: fileField('Calibration certificate (optional)'), collect: (m) => { file = m.querySelector('#f_file')?.files[0] || null; return {}; } });
    if (!v) return false;
    return signed({ what: `Calibration of ${name} on ${v.performed_date}: ${v.result}`, meaning: 'Recorded by', needReason: false },
      async (reason, signature) => api(`/equipment/${id}/calibrations`, { method: 'POST', body: { row: v, file: await filePayload(file), signature } }));
  }
  async function recordQualification(tagId) {
    let file = null;
    const v = await modal({ title: `Record qualification: ${e.equipment_code}`, okText: 'Next: sign', wide: true,
      fields: [
        { name: 'qualification_type', label: 'Qualification', type: 'select', options: QUAL_TYPES, value: 'IQ/OQ/PQ', blank: false },
        { name: 'performed_date', label: 'Done on', type: 'date', value: today(), required: true },
        { name: 'result', label: 'Result', type: 'select', options: ['Pass', 'Fail'], value: 'Pass', blank: false },
        { name: 'performed_by_vendor', label: 'Done by a company (from the supplier list; empty if you did it)', type: 'select', options: await vendorOptions() }, { name: 'protocol_reference', label: 'Protocol / report reference' },
        { name: 'tag_id', label: 'Under tag', type: 'select', options: tagOpts(), value: tagId || (tagOpts('Qualification')[0] || {}).value || '' },
        { name: 'notes', label: 'Notes' },
      ], html: fileField('Qualification report (optional)'), collect: (m) => { file = m.querySelector('#f_file')?.files[0] || null; return {}; } });
    if (!v) return false;
    return signed({ what: `${v.qualification_type} of ${name} on ${v.performed_date}: ${v.result}`, meaning: 'Recorded by', needReason: false },
      async (reason, signature) => api(`/equipment/${id}/qualifications`, { method: 'POST', body: { row: v, file: await filePayload(file), signature } }));
  }

  const act = async (key) => {
    try {
      let done = null;
      if (key === 'tagout') {
        const v = await modal({ title: `Tag out ${e.equipment_code} ${e.equipment_name}`, okText: 'Next: sign',
          intro: 'It becomes unavailable until it is tagged back in. After repair, calibration or qualification, someone with the release permission who did not tag it out or do the work must release it.',
          fields: [{ name: 'reason_code', label: 'Reason', type: 'select', options: REASONS, required: true }, { name: 'description', label: 'What is wrong / why', type: 'textarea' }] });
        if (!v) return;
        done = await signed({ what: `Tag out ${name} for ${v.reason_code.toLowerCase()}${v.description ? ': ' + v.description : ''}`, meaning: 'Tagged out by', needReason: false }, post(`/equipment/${id}/tag-out`, v));
        if (done) toast('Tagged out and signed.');
      }
      if (key === 'work') { done = await recordWork(null); if (done) toast('Recorded and signed.'); }
      if (key === 'calib') { done = await recordCalibration(null); if (done) toast('Calibration recorded and signed.'); }
      if (key === 'qual') { done = await recordQualification(null); if (done) toast('Qualification recorded and signed.'); }
      if (key === 'doc') {
        let file = null;
        const v = await modal({ title: `Upload a document: ${e.equipment_code}`, okText: 'Next: sign',
          fields: [{ name: 'doc_type', label: 'Kind', type: 'select', options: DOC_TYPES, value: 'Service report', blank: false }, { name: 'title', label: 'Title' },
            { name: 'tag_id', label: 'For tag', type: 'select', options: tagOpts() }], html: fileField('File'),
          collect: (m) => { file = m.querySelector('#f_file')?.files[0] || null; return {}; } });
        if (!v) return;
        if (!file) { toast('Choose the file to upload.', 'err'); return; }
        const payload = { ...(await filePayload(file)), ...v };
        done = await signed({ what: `Document ${file.name} for ${name}`, meaning: 'Uploaded by', needReason: false }, post(`/equipment/${id}/documents`, { file: payload }));
        if (done) toast('Uploaded and signed.');
      }
      if (key === 'oos' || key === 'ins' || key === 'retire') {
        const to = { oos: 'Out of Service', ins: 'In Service', retire: 'Retired' }[key];
        done = await signed({ what: `${name}: ${to}${key === 'retire' ? ' (it keeps its history; it can no longer be tagged or calibrated)' : ''}`, meaning: 'Changed by' }, post(`/equipment/${id}/status`, { admin_status: to }));
        if (done) toast(`${to}: saved and signed.`);
      }
      if (key === 'transfer') {
        const labs = await api('/equipment/transfer-options');
        if (!labs.length) { toast('There is no other lab to transfer to.', 'err'); return; }
        const v = await modal({ title: `Transfer ${e.equipment_code} to another lab`, okText: 'Next: sign',
          intro: 'Its whole history goes with it. It arrives tagged out for Qualification, and the receiving lab releases it after qualifying it. Your lab\'s owners, department and location are cleared; name the receiving lab\'s department and responsible group.',
          fields: [{ name: 'to_site_id', label: 'To lab', type: 'select', options: labs.map((s) => ({ value: s.id, label: `${s.site_code} ${s.site_name}` })), required: true },
            { name: 'department_id', label: 'Department at the receiving lab', type: 'select', options: labs.flatMap((s) => s.departments.map((d) => ({ value: d.id, label: `${s.site_code}: ${d.department_code} ${d.department_name}` }))), required: true },
            { name: 'owner_group_id', label: 'Responsible group at the receiving lab', type: 'select', options: labs.flatMap((s) => s.groups.map((g) => ({ value: g.id, label: `${s.site_code}: ${g.group_name}` }))), required: true },
            { name: 'notes', label: 'Notes' }] });
        if (!v) return;
        const lab = labs.find((s) => s.id === v.to_site_id);
        done = await signed({ what: `Transfer ${name} to ${lab.site_code}`, meaning: 'Transferred by', needReason: false }, post(`/equipment/${id}/transfer`, v));
        if (done) { toast(`Transferred to ${lab.site_code}. It is now in their register, tagged out for qualification.`); location.hash = '#/equipment'; return; }
      }
      if (done) reload();
    } catch (err) { toast(err.message, 'err'); }
  };
  main.querySelectorAll('[data-act]').forEach((b) => { b.onclick = () => act(b.dataset.act); });
  main.querySelectorAll('[data-work]').forEach((b) => { b.onclick = async () => { if (await recordWork(b.dataset.work)) { toast('Recorded and signed.'); reload(); } }; });
  main.querySelectorAll('[data-calib]').forEach((b) => { b.onclick = async () => { if (await recordCalibration(b.dataset.calib)) { toast('Calibration recorded and signed.'); reload(); } }; });
  main.querySelectorAll('[data-qual]').forEach((b) => { b.onclick = async () => { if (await recordQualification(b.dataset.qual)) { toast('Qualification recorded and signed.'); reload(); } }; });
  main.querySelectorAll('[data-in]').forEach((b) => {
    b.onclick = async () => {
      const t = d.tags.find((x) => x.id === b.dataset.in);
      const release = t.reason !== 'Maintenance';
      let body = {};
      if (!release && !Number(t.work_count)) {
        const v = await modal({ title: `Tag ${e.equipment_code} back in`, okText: 'Next: sign', intro: 'Say what was done (it goes in the maintenance log).',
          fields: [{ name: 'summary', label: 'What was done', type: 'textarea', required: true }, { name: 'performed_date', label: 'Date done', type: 'date', value: today(), required: true }] });
        if (!v) return; body = v;
      }
      const ok = await signed({ what: `${release ? 'Release to service' : 'Tag back in'}: ${name} (${t.tag_code}, ${t.reason})`, meaning: release ? 'Released by' : 'Returned to service by', needReason: false },
        post(`/equipment/tags/${t.id}/tag-in`, body));
      if (ok) { toast(release ? 'Released to service and signed.' : 'Tagged back in and signed.'); reload(); }
    };
  });
}
