// Excel export and bulk upload for the inventory tabs and the Units lists.
// Export: an .xlsx of the list (or only the ticked rows). Upload: the same sheet back (or a CSV). Rows are matched
// on their ID; rows without an ID are created. The upload is first previewed (every change and every error per
// row), then applied in one transaction with one Reason for Change; the database rules check every row, and the
// first refused row stops the whole upload so nothing is half-saved.
'use strict';
const { writeXlsx, readTable, serialToDate } = require('./xlsx');

const ARR = (v) => (Array.isArray(v) ? v : v === null || v === undefined || v === '' ? [] : String(v).replace(/^\{|\}$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')));
const s = (v) => (v === null || v === undefined ? '' : String(v));
const d10 = (v) => (v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : '');
const num = (v) => (v === null || v === undefined || v === '' ? '' : Number(v));

// Column types: how a cell is read back. ref: name of a lookup (code or name -> id)
function parseCell(col, raw, L) {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return { value: null };
  const t = col.type || 'text';
  const txt = typeof raw === 'string' ? raw.trim() : raw;
  if (t === 'number') { const n = typeof txt === 'number' ? txt : Number(String(txt).replace(/[,\s]/g, '')); return Number.isNaN(n) ? { error: `${col.h}: "${txt}" is not a number` } : { value: n }; }
  if (t === 'date') {
    if (typeof txt === 'number') return { value: serialToDate(txt) };
    let m = String(txt).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return { value: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` };
    m = String(txt).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return { value: `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` };
    return { error: `${col.h}: "${txt}" is not a date (use YYYY-MM-DD)` };
  }
  if (t === 'bool') { const v = String(txt).toLowerCase(); return { value: ['yes', 'y', 'true', '1', 'x'].includes(v) } ; }
  if (t === 'list') {
    const items = String(txt).split(/[;,]/).map((x) => x.trim()).filter(Boolean);
    const allowed = L[col.allowed] || []; const out = [];
    for (const it of items) { const hit = allowed.find((a) => a.toLowerCase() === it.toLowerCase()); if (!hit) return { error: `${col.h}: "${it}" is not one of ${allowed.join(', ')}` }; out.push(hit); }
    return { value: out };
  }
  if (t === 'choice') {
    const allowed = L[col.allowed] || []; const hit = allowed.find((a) => a.toLowerCase() === String(txt).toLowerCase());
    return hit ? { value: hit } : { error: `${col.h}: "${txt}" is not one of ${allowed.join(', ')}` };
  }
  if (t === 'ref') {
    const map = L[col.ref]; const hit = map && map.get(String(txt).trim().toLowerCase());
    return hit ? { value: hit } : { error: `${col.h}: "${txt}" was not found` };
  }
  return { value: String(txt) };
}
// For comparing what is stored with what was uploaded
function norm(col, v) {
  if (v === null || v === undefined || v === '') return '';
  if (col.type === 'number') return String(Number(v));
  if (col.type === 'date') return d10(v);
  if (col.type === 'bool') return v ? 'Yes' : 'No';
  if (col.type === 'list') return ARR(v).map((x) => x.toLowerCase()).sort().join(',');
  return String(v).trim();
}

// ---------------------------------------------------------------- what each tab exports and accepts
// key: the column that identifies a row. creates: whether rows without a match are created.
// Each column: h (header), f (database field), get(row) (export value), type, ro (export only), ref/allowed (lookups)
const KINDS = {
  lots: {
    title: 'Inventory', table: 'inventory_lot', site: true, key: 'lot_code', keyHeader: 'ID', creates: true, newKeyGenerated: true,
    list: 'SELECT * FROM inventory_lot_view WHERE site_id = $1 ORDER BY material, lot_code',
    cols: [
      { h: 'ID', f: 'lot_code', ro: true, w: 12 },
      { h: 'Name', f: 'item_name', w: 34 },
      { h: 'Types', f: 'chemical_types', type: 'list', allowed: 'chemicalTypes', get: (r) => ARR(r.chemical_types).join(', '), w: 26 },
      { h: 'Solid or liquid', f: 'physical_form', type: 'choice', allowed: 'forms', w: 14 },
      { h: 'Analytes', f: '__analytes', type: 'analytes', get: (r) => s(r.analytes_text), w: 34 },
      { h: 'Lot #', f: 'manufacturer_lot', w: 14 },
      { h: 'Concentration', f: 'concentration', type: 'number', get: (r) => num(r.concentration), w: 13 },
      { h: 'Concentration unit', f: 'concentration_unit', w: 14 },
      { h: 'Purity %', f: 'purity_pct', type: 'number', get: (r) => num(r.purity_pct), w: 9 },
      { h: 'CAS', f: 'cas_number', w: 12 },
      { h: 'Vendor', f: 'supplier_id', type: 'ref', ref: 'suppliers', get: (r) => s(r.supplier_name), w: 24 },
      { h: 'Manufacturer', f: 'manufacturer_id', type: 'ref', ref: 'suppliers', get: (r) => s(r.manufacturer_name), w: 24 },
      { h: 'Catalog #', f: 'catalog_number', w: 14 },
      { h: 'Quantity received', f: 'quantity_received', type: 'number', get: (r) => num(r.quantity_received), w: 10 },
      { h: 'Unit', f: 'unit', w: 7 },
      { h: 'Received date', f: 'received_date', type: 'date', get: (r) => d10(r.received_date), w: 12 },
      { h: 'Expiration date', f: 'expiration_date', type: 'date', get: (r) => d10(r.expiration_date), w: 12 },
      { h: 'Retest date', f: 'retest_date', type: 'date', get: (r) => d10(r.retest_date), w: 12 },
      { h: 'Opened date', f: 'opened_date', type: 'date', get: (r) => d10(r.opened_date), w: 12 },
      { h: 'Storage location', f: 'storage_location_id', type: 'ref', ref: 'locations', get: (r) => s(r.location_code), w: 14 },
      { h: 'Storage condition', f: 'storage_condition', type: 'choice', allowed: 'conditions', w: 22 },
      { h: 'Status', f: 'status', type: 'choice', allowed: 'lotStatuses', w: 10 },
      { h: 'Notes', f: 'notes', w: 30 },
      { h: 'On hand', ro: true, get: (r) => num(r.on_hand), w: 9 },
      { h: 'Purchase status', ro: true, get: (r) => s(r.receipt_status), w: 13 },
      { h: 'Date made', ro: true, get: (r) => d10(r.date_made), w: 12 },
    ],
  },
  samplestorage: {
    title: 'Sample storage', table: 'sample', site: true, key: 'sample_code', keyHeader: 'Sample ID', creates: false,
    list: "SELECT * FROM sample_storage_view WHERE site_id = $1 AND status = 'Logged' ORDER BY sample_code",
    cols: [
      { h: 'Sample ID', f: 'sample_code', ro: true, w: 14 },
      { h: 'Client sample ID', ro: true, get: (r) => s(r.client_sample_id), w: 16 },
      { h: 'Description', ro: true, get: (r) => s(r.description), w: 26 },
      { h: 'Client', ro: true, get: (r) => s(r.client_name), w: 22 },
      { h: 'Order', ro: true, get: (r) => s(r.order_code), w: 11 },
      { h: 'Received', ro: true, get: (r) => (r.quantity_received === null ? '' : `${Number(r.quantity_received)} ${s(r.quantity_unit)}`), w: 10 },
      { h: 'Storage location', f: 'storage_location_id', type: 'ref', ref: 'sampleLocations', get: (r) => s(r.location_code), w: 14 },
      { h: 'Storage condition', f: 'storage_condition', type: 'choice', allowed: 'conditions', w: 22 },
      { h: 'Retained quantity', f: 'retained_quantity', type: 'number', get: (r) => num(r.retained_quantity), w: 10 },
      { h: 'Retained unit', f: 'retained_unit', w: 8 },
    ],
  },
  suppliers: {
    title: 'Suppliers and manufacturers', table: 'supplier', key: 'supplier_code', keyHeader: 'Code', creates: true, newKeyGenerated: true,
    list: 'SELECT * FROM supplier ORDER BY lower(supplier_name)',
    cols: [
      { h: 'Code', f: 'supplier_code', ro: true, w: 10 },
      { h: 'Name', f: 'supplier_name', w: 32 },
      { h: 'Type', f: 'supplier_type', type: 'choice', allowed: 'supplierTypes', w: 24 },
      { h: 'Website', f: 'website', w: 26 }, { h: 'Email', f: 'email', w: 28 }, { h: 'Phone', f: 'phone', w: 14 }, { h: 'Notes', f: 'notes', w: 26 },
      { h: 'Status', f: 'status', type: 'choice', allowed: 'activeInactive', w: 10 },
    ],
  },
  locations: {
    title: 'Storage locations', table: 'storage_location', site: true, key: 'location_code', keyHeader: 'Code', creates: true, siteField: 'site_id',
    list: 'SELECT l.*, p.location_code AS parent_code FROM storage_location l LEFT JOIN storage_location p ON p.id = l.parent_location_id WHERE l.site_id = $1 ORDER BY location_path(l.id)',
    cols: [
      { h: 'Code', f: 'location_code', key: true, w: 14 },
      { h: 'Name', f: 'location_name', w: 26 },
      { h: 'Type', f: 'location_type', type: 'choice', allowed: 'locationTypes', w: 12 },
      { h: 'Inside', f: 'parent_location_id', type: 'ref', ref: 'locations', get: (r) => s(r.parent_code), w: 12 },
      { h: 'Conditions it provides', f: 'supported_conditions', type: 'list', allowed: 'conditions', get: (r) => ARR(r.supported_conditions).join(', '), w: 40 },
      { h: 'Holds samples', f: 'holds_samples', type: 'bool', get: (r) => (r.holds_samples ? 'Yes' : 'No'), w: 9 },
      { h: 'Status', f: 'status', type: 'choice', allowed: 'activeInactive', w: 10 },
    ],
  },
  thresholds: {
    title: 'Warning rules', table: 'threshold_rule', key: 'id', keyHeader: 'Record ID', creates: true, newKeyGenerated: true,
    list: 'SELECT r.*, s.site_code FROM threshold_rule r LEFT JOIN lab_site s ON s.id = r.site_id ORDER BY r.subject, r.rule_name',
    cols: [
      { h: 'Record ID', f: 'id', ro: true, w: 38 },
      { h: 'Rule', f: 'rule_name', w: 44 },
      { h: 'Watches', f: 'subject', type: 'choice', allowed: 'subjects', w: 14 },
      { h: 'Type', f: 'rule_type', type: 'choice', allowed: 'ruleTypes', w: 20 },
      { h: 'Value', f: 'value', type: 'number', get: (r) => num(r.value), w: 8 },
      { h: 'Lab', f: 'site_id', type: 'ref', ref: 'sites', get: (r) => s(r.site_code), w: 8 },
      { h: 'Status', f: 'status', type: 'choice', allowed: 'activeInactive', w: 10 },
    ],
  },
  units: {
    title: 'Units', table: 'unit_of_measure', key: 'unit_code', keyHeader: 'Code', creates: true,
    list: 'SELECT * FROM unit_of_measure ORDER BY sort_order, unit_code',
    cols: [
      { h: 'Code', f: 'unit_code', key: true, w: 10 },
      { h: 'Name', f: 'unit_name', w: 34 },
      { h: 'Measures', f: 'dimension', type: 'choice', allowed: 'dimensions', w: 16 },
      { h: 'Order', f: 'sort_order', type: 'number', get: (r) => num(r.sort_order), w: 7 },
      { h: 'Status', f: 'status', type: 'choice', allowed: 'activeInactive', w: 10 },
    ],
  },
  equipment: {
    title: 'Equipment', table: 'equipment', site: true, key: 'equipment_code', keyHeader: 'ID', creates: true, newKeyGenerated: true, module: 'Equipment',
    list: 'SELECT * FROM equipment_view WHERE site_id = $1 ORDER BY lower(type_name), lower(equipment_name)',
    cols: [
      { h: 'ID', f: 'equipment_code', ro: true, w: 10 },
      { h: 'Name', f: 'equipment_name', w: 30 },
      { h: 'Type', f: 'equipment_type_id', type: 'ref', ref: 'equipmentTypes', get: (r) => s(r.type_name), w: 18 },
      { h: 'Department', f: 'department_id', type: 'ref', ref: 'departments', get: (r) => s(r.department_code), w: 11 },
      { h: 'Manufacturer', f: 'manufacturer', w: 18 }, { h: 'Model', f: 'model', w: 18 },
      { h: 'Serial number', f: 'serial_number', w: 16 }, { h: 'Asset tag', f: 'asset_tag', w: 12 },
      { h: 'Location', f: 'location_id', type: 'ref', ref: 'locations', get: (r) => s(r.location_code), w: 12 },
      { h: 'Location note', f: 'location_note', w: 18 },
      { h: 'Calibration required', f: 'calibration_required', type: 'bool', get: (r) => (r.calibration_required ? 'Yes' : 'No'), w: 11 },
      { h: 'Calibration interval (months)', f: 'calibration_interval_months', type: 'number', get: (r) => num(r.calibration_interval_months), w: 12 },
      { h: 'Calibration warning (days)', f: 'calibration_alert_days', type: 'number', get: (r) => num(r.calibration_alert_days), w: 11 },
      { h: 'IQ/OQ/PQ required', f: 'qualification_required', type: 'bool', get: (r) => (r.qualification_required ? 'Yes' : 'No'), w: 10 },
      { h: 'In service since', f: 'in_service_date', type: 'date', get: (r) => d10(r.in_service_date), w: 12 },
      { h: 'Owners', f: '__owners', type: 'owners', get: (r) => s(r.owners), w: 30 },
      { h: 'Status', f: 'admin_status', type: 'choice', allowed: 'adminStatuses', w: 13 },
      { h: 'Notes', f: 'notes', w: 26 },
      { h: 'Availability', ro: true, get: (r) => s(r.availability) + (r.tagged_for ? ` (${r.tagged_for})` : ''), w: 18 },
      { h: 'Calibration expires', ro: true, get: (r) => d10(r.cal_expires), w: 12 },
      { h: 'Calibration status', ro: true, get: (r) => s(r.calibration_status), w: 13 },
    ],
    // Owners: the complete set from the sheet (groups of this lab, or people by user ID or name); others removed (kept as history)
    afterRow: async (t, id, { __owners }) => {
      const cur = await t.rows('SELECT * FROM equipment_owner WHERE equipment_id = $1', [id]);
      const key = (o) => (o.group_id ? 'g' + o.group_id : 'u' + o.user_id);
      const want = new Set(__owners.map(key));
      for (const k of want) {
        const ex = cur.find((o) => key(o) === k);
        if (!ex) await t.query('INSERT INTO equipment_owner (equipment_id, group_id, user_id) VALUES ($1, $2, $3)', [id, k[0] === 'g' ? k.slice(1) : null, k[0] === 'u' ? k.slice(1) : null]);
        else if (ex.status !== 'Active') await t.query("UPDATE equipment_owner SET status = 'Active' WHERE id = $1", [ex.id]);
      }
      for (const ex of cur.filter((o) => o.status === 'Active' && !want.has(key(o)))) await t.query("UPDATE equipment_owner SET status = 'Inactive' WHERE id = $1", [ex.id]);
    },
  },
  conversions: {
    title: 'Unit conversions', table: 'unit_conversion', key: 'id', keyHeader: 'Record ID', creates: true, newKeyGenerated: true,
    list: `SELECT c.*, f.unit_code AS from_code, t.unit_code AS to_code FROM unit_conversion c JOIN unit_of_measure f ON f.id = c.from_unit_id
      JOIN unit_of_measure t ON t.id = c.to_unit_id ORDER BY f.sort_order, f.unit_code, t.unit_code`,
    cols: [
      { h: 'Record ID', f: 'id', ro: true, w: 38 },
      { h: 'From', f: 'from_unit_id', type: 'ref', ref: 'units', get: (r) => s(r.from_code), w: 10 },
      { h: 'To', f: 'to_unit_id', type: 'ref', ref: 'units', get: (r) => s(r.to_code), w: 10 },
      { h: 'Factor (1 From = factor To)', f: 'factor', type: 'number', get: (r) => num(r.factor), w: 16 },
      { h: 'Applies to', f: 'applies_to', type: 'choice', allowed: 'appliesTo', w: 10 },
      { h: 'Assumption', f: 'assumption', w: 44 },
      { h: 'Status', f: 'status', type: 'choice', allowed: 'activeInactive', w: 10 },
    ],
  },
};

async function lookups(db, site) {
  const en = async (t) => (await db.rows(`SELECT unnest(enum_range(NULL::${t}))::text AS v`)).map((x) => x.v);
  const map = (rows, keys) => { const m = new Map(); for (const r of rows) for (const k of keys) if (r[k]) m.set(String(r[k]).toLowerCase(), r.id); return m; };
  const L = {
    chemicalTypes: await en('chemical_type'), conditions: await en('storage_condition'), locationTypes: await en('location_type'),
    supplierTypes: await en('supplier_type'), lotStatuses: await en('lot_status'), subjects: await en('threshold_subject'),
    ruleTypes: await en('threshold_type'), dimensions: await en('unit_dimension'),
    forms: ['Solid', 'Liquid'], activeInactive: ['Active', 'Inactive'], appliesTo: ['Any', 'Liquid', 'Solid'],
    suppliers: map(await db.rows('SELECT id, supplier_code, supplier_name FROM supplier'), ['supplier_code', 'supplier_name']),
    sites: map(await db.rows('SELECT id, site_code FROM lab_site'), ['site_code']),
    units: map(await db.rows('SELECT id, unit_code FROM unit_of_measure'), ['unit_code']),
    analytes: map(await db.rows('SELECT id, analyte_code, analyte_name, report_name FROM analyte'), ['analyte_code', 'analyte_name', 'report_name']),
  };
  L.adminStatuses = ['In Service', 'Out of Service', 'Retired'];
  if (site) {
    L.equipmentTypes = map(await db.rows("SELECT id, type_name FROM equipment_type WHERE site_id = $1 AND status = 'Active'", [site]), ['type_name']);
    L.departments = map(await db.rows("SELECT id, department_code, department_name FROM department WHERE site_id = $1 AND status = 'Active'", [site]), ['department_code', 'department_name']);
    L.ownerGroups = map(await db.rows("SELECT id, group_name FROM lab_group WHERE site_id = $1 AND status = 'Active'", [site]), ['group_name']);
    L.ownerPeople = map(await db.rows("SELECT id, username, full_name FROM app_user WHERE is_active AND username <> 'system' AND user_can_access_site(id, $1)", [site]), ['username', 'full_name']);
    L.locations = map(await db.rows('SELECT id, location_code FROM storage_location WHERE site_id = $1', [site]), ['location_code']);
    L.sampleLocations = map(await db.rows('SELECT id, location_code FROM storage_location WHERE site_id = $1 AND holds_samples', [site]), ['location_code']);
  } else L.locations = new Map();
  return L;
}

// "Lead 1000 µg/mL; Cadmium 1000 µg/mL" (or just "Lead") -> [{ analyte_id, concentration, concentration_unit }]
function parseAnalytes(txt, L) {
  if (txt === null || txt === undefined || String(txt).trim() === '') return { value: [] };
  const out = [];
  for (const part of String(txt).split(';').map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^(.+?)(?:\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*(\S.*)?)?$/);
    const name = m[1].trim(); const id = L.analytes.get(name.toLowerCase());
    if (!id) return { error: `Analytes: "${name}" is not on the Analytes list` };
    if (m[2] !== undefined && !m[3]) return { error: `Analytes: give a unit after ${m[2]} for ${name}` };
    out.push({ analyte_id: id, concentration: m[2] === undefined ? null : Number(m[2]), concentration_unit: m[3] ? m[3].trim() : null, label: part });
  }
  return { value: out };
}

function exportFile(def, rows) {
  const cols = def.cols;
  return writeXlsx({ sheetName: def.title, headers: cols.map((c) => c.h), widths: cols.map((c) => c.w),
    rows: rows.map((r) => cols.map((c) => (c.get ? c.get(r) : r[c.f] === null || r[c.f] === undefined ? '' : r[c.f]))) });
}

// Compare the uploaded sheet with what is stored. Returns { rows: [{ row, key, action, changes, errors, payload }], unknownHeaders, missing }
async function preview(db, def, current, buf, fileName, site) {
  const { headers, rows } = readTable(buf, fileName);
  const L = await lookups(db, site);
  const byHeader = new Map(def.cols.map((c) => [c.h.toLowerCase(), c]));
  const unknownHeaders = headers.filter((h) => !byHeader.has(h.toLowerCase()));
  const keyCol = def.cols.find((c) => c.f === def.key);
  if (!headers.some((h) => h.toLowerCase() === keyCol.h.toLowerCase())) throw new Error(`The sheet needs a "${keyCol.h}" column (export the list first and edit that file)`);
  const index = new Map(current.map((r) => [String(r[def.key]).toLowerCase(), r]));
  const seen = new Set(); const out = [];
  for (const raw of rows) {
    const get = (c) => { const h = headers.find((x) => x.toLowerCase() === c.h.toLowerCase()); return h === undefined ? undefined : raw[h]; };
    const keyVal = s(get(keyCol)).trim();
    const existing = keyVal ? index.get(keyVal.toLowerCase()) : null;
    const res = { row: raw.__row, key: keyVal || '(new)', action: 'No change', changes: {}, errors: [], payload: {} };
    if (keyVal && seen.has(keyVal.toLowerCase())) res.errors.push(`${keyCol.h} ${keyVal} appears more than once in the file`);
    if (keyVal) seen.add(keyVal.toLowerCase());
    if (!existing) {
      if (!def.creates) res.errors.push(`${keyCol.h} ${keyVal || '(empty)'} was not found`);
      else if (keyVal && def.newKeyGenerated) res.errors.push(`${keyCol.h} ${keyVal} was not found (leave ${keyCol.h} empty to create a new row; the system gives it an ID)`);
    }
    for (const c of def.cols) {
      if (c.ro || (c.f === def.key && def.newKeyGenerated)) continue;
      const v = get(c); if (v === undefined) continue; // column not in the file: left as it is
      if (c.type === 'owners') {
        const items = String(v ?? '').split(/[;,]/).map((x) => x.trim()).filter(Boolean); const out = []; let bad = null;
        for (const it of items) {
          const g = L.ownerGroups && L.ownerGroups.get(it.toLowerCase()); const u = L.ownerPeople && L.ownerPeople.get(it.toLowerCase());
          if (g) out.push({ group_id: g }); else if (u) out.push({ user_id: u }); else { bad = it; break; }
        }
        if (bad) { res.errors.push(`Owners: "${bad}" is not a group of this lab or a person working here`); continue; }
        if (!out.length) { res.errors.push('Owners: name at least one group or person responsible for it'); continue; }
        const canon = (x) => String(x || '').toLowerCase().split(/[;,]/).map((y) => y.trim()).filter(Boolean).sort().join(';');
        if (!existing || canon(v) !== canon(existing.owners)) { res.changes[c.h] = [existing ? s(existing.owners) : '', s(v)]; res.payload.__owners = out; }
        continue;
      }
      if (c.type === 'analytes') {
        const p = parseAnalytes(v, L); if (p.error) { res.errors.push(p.error); continue; }
        const cur = existing ? s(existing.analytes_text) : '';
        const canon = (x) => x.toLowerCase().replace(/\s+/g, ' ').split(';').map((y) => y.trim()).filter(Boolean).sort().join(';');
        if (canon(p.value.map((a) => a.label).join(';')) !== canon(cur)) { res.changes[c.h] = [cur, s(v)]; res.payload.__analytes = p.value; }
        continue;
      }
      const p = parseCell(c, v, L); if (p.error) { res.errors.push(p.error); continue; }
      const old = existing ? existing[c.f] : null;
      if (norm(c, p.value) !== norm(c, c.type === 'list' ? ARR(old) : old)) {
        res.changes[c.h] = [existing ? (c.get ? c.get(existing) : s(old)) : '', c.type === 'list' ? p.value.join(', ') : s(v)];
        res.payload[c.f] = p.value;
      }
    }
    if (existing) res.payload.id = existing.id;
    res.action = res.errors.length ? 'Error' : !existing ? 'Create' : Object.keys(res.changes).length ? 'Update' : 'No change';
    out.push(res);
  }
  return { rows: out, unknownHeaders, total: rows.length };
}

module.exports = { KINDS, exportFile, preview, ARR };
