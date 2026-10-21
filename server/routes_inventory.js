// Inventory API (slice 3). Registered from routes.js. Thin like the rest: rules live in the database
// (migration 005); these handlers read, write and pass the user, lab and Reason for Change through.
'use strict';

const bulk = require('./bulk');
const LOT_FIELDS = ['item_name', 'cas_number', 'physical_form', 'chemical_id', 'item_description', 'chemical_types', 'supplier_id', 'manufacturer_id', 'catalog_number', 'manufacturer_lot',
  'requested_quantity', 'quantity_received', 'unit', 'container_count', 'concentration', 'concentration_unit', 'purity_pct', 'received_date',
  'opened_date', 'expiration_date', 'retest_date', 'storage_condition', 'storage_location_id', 'status', 'notes', 'item_url', 'department_id', 'waste_classification_id'];
const COA_TYPES = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/;

// Readable messages for this slice's database checks
const MESSAGES = {
  inventory_lot_unit_check: 'Pick a unit from the list (g, mg, µg, kg, mL, L, µL, each, pack, box, vial, bottle, plate, tube, ampoule).',
  inventory_lot_chemical_types_check: 'Pick at least one Chemical Type.',
  inventory_lot_purity_pct_check: 'Purity must be above 0 and at most 100%.',
  chemical_cas_number_check: 'CAS Number is not valid (format or check digit).',
  chemical_name_uq: 'That chemical is already on the list (names are unique, ignoring capitals).',
  chemical_cas_uq: 'Another chemical already has that CAS Number.',
  supplier_name_uq: 'That supplier is already on the list.',
  storage_location_code_uq: 'That location code is already used in this lab.',
  threshold_rule_type_fits: 'That rule type does not fit what it watches: quantities use Percentage of Base or Absolute Max-Min; expiry uses Days Until/Since.',
  threshold_rule_chemical_fits: 'Only stock (Lot Quantity) rules can be limited to one chemical.',
  threshold_rule_pct: 'A percentage cannot be more than 100.',
  inventory_transaction_quantity_change_check: 'Enter a quantity other than zero.',
  lot_component_quantity_used_check: 'Enter how much of each component was used.',
  inventory_lot_cas_number_check: 'CAS Number is not valid (format or check digit).',
  inventory_lot_physical_form_check: 'Solid or liquid: pick Solid or Liquid.',
  unit_code_uq: 'That unit code is already on the Units list (codes are unique, ignoring capitals).',
  unit_conversion_uq: 'That conversion is already on the list (set the old one Inactive first).',
  unit_conversion_not_self: 'A unit cannot be converted to itself.',
  unit_conversion_factor_check: 'The factor must be more than 0.',
  lot_analyte_lot_id_analyte_id_key: 'That analyte is already on this item (each analyte once).',
  lot_analyte_tolerance_pct_check: 'Tolerance cannot be negative.',
  inventory_lot_item_url_check: 'The web link must be a full web address starting with http:// or https://.',
  media_qualification_one_live: 'That lot is already released, or in QA testing, for that use.',
};
// Keep or add each analyte line on an item; lines not in the list are set Inactive (never deleted)
async function syncAnalytes(t, lotId, list) {
  const cur = await t.rows('SELECT * FROM lot_analyte WHERE lot_id = $1', [lotId]);
  for (const a of list || []) {
    if (!a.analyte_id) continue;
    const ex = cur.find((x) => x.analyte_id === a.analyte_id);
    const vals = [a.concentration ?? null, a.concentration_unit || null, a.target_concentration ?? null, a.tolerance_pct ?? null,
      a.expressed_as || null, a.formula_weight ?? null, a.analyte_per_unit ?? null];
    if (!ex) await t.query(`INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit, target_concentration, tolerance_pct, expressed_as, formula_weight, analyte_per_unit)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [lotId, a.analyte_id, ...vals]);
    else await t.query(`UPDATE lot_analyte SET concentration = $2, concentration_unit = $3, target_concentration = $4, tolerance_pct = $5,
      expressed_as = $6, formula_weight = $7, analyte_per_unit = $8, status = 'Active' WHERE id = $1`, [ex.id, ...vals]);
  }
  for (const ex of cur.filter((x) => x.status === 'Active' && !(list || []).some((a) => a.analyte_id === x.analyte_id))) {
    await t.query("UPDATE lot_analyte SET status = 'Inactive' WHERE id = $1", [ex.id]);
  }
}
// Enum arrays (Chemical Type, storage conditions) can arrive as Postgres text such as {Reagent,"Reference Standard"}
function pgArray(v) {
  if (Array.isArray(v) || v === null || v === undefined) return v;
  const s = String(v); if (s === '{}') return [];
  const out = []; let cur = ''; let q = false; let quoted = false;
  for (let i = 1; i < s.length - 1; i++) {
    const ch = s[i];
    if (q) { if (ch === '\\') { cur += s[++i]; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') { q = true; quoted = true; } else if (ch === ',') { out.push(cur); cur = ''; quoted = false; } else cur += ch;
  }
  out.push(cur); void quoted;
  return out;
}
const ARRAY_FIELDS = ['chemical_types', 'supported_conditions'];
// ...and are sent as Postgres array text, which both engines (PostgreSQL wire client and PGlite) pass through unchanged
const toPgArray = (a) => '{' + a.map((x) => '"' + String(x).replace(/["\\]/g, (m) => '\\' + m) + '"').join(',') + '}';
function arraysOut(rows) {
  return (rows || []).map((r) => { const o = { ...r }; for (const k of ARRAY_FIELDS) if (Array.isArray(o[k])) o[k] = toPgArray(o[k]); return o; });
}
function fixArrays(x) {
  if (Array.isArray(x)) return x.map(fixArrays);
  if (x && typeof x === 'object' && !Buffer.isBuffer(x)) {
    for (const k of Object.keys(x)) {
      if (ARRAY_FIELDS.includes(k)) x[k] = pgArray(x[k]);
      else if (x[k] && typeof x[k] === 'object') fixArrays(x[k]);
    }
  }
  return x;
}
function translate(e) {
  const m = String(e.message || e);
  for (const [k, v] of Object.entries(MESSAGES)) if (m.includes(`"${k}"`)) { const n = new Error(v); n.code = e.code; return n; }
  return e;
}

module.exports = function registerInventory({ route, tx, signedTx, upsertRows, currentSite, checkSite, requireAdmin, requirePermission, hasPermission, isUuid, AUDIT_SCOPES, AUDIT_LISTS, SITE_AUDIT_KINDS, AUDIT_CHECKS }) {
  const r = (method, pattern, fn) => route(method, pattern, async (c) => {
    let out; try { out = await fn(c); } catch (e) { throw translate(e); }
    return out && out.__raw ? out : fixArrays(out);
  });
  const lotSite = async (c, id) => { const l = await c.db.one('SELECT site_id FROM inventory_lot WHERE id = $1', [id]); if (!l) throw new Error('Lot not found'); await checkSite(c, l.site_id); return l.site_id; };
  const withReason = (c, fallback) => ({ ...c, reason: c.body.reason || fallback });
  // The "Send for QA testing" choice made when an item is received (migration 040): '1' needs it, '0' does not (QA's call
  // when the lab's default asks for it), anything else: the lab's default for the item's types
  const qaChoice = (t, v) => t.query("SELECT set_config('lims.qa_testing', $1, true)", [v === true || v === '1' ? '1' : v === false || v === '0' ? '0' : '']);
  // Inventory changes are signed (user ID + password) with a meaning set by the action; routine usage is not
  const requireQaOrAdmin = (c) => requirePermission(c, 'inventory.upload', 'upload the inventory list from Excel'); // QA and administrators by default (migration 008)
  const lotWords = async (c, id, verb) => { const l = await c.db.one('SELECT lot_code, item_name FROM inventory_lot WHERE id = $1', [id]); return `${verb}: lot ${l.lot_code} ${l.item_name}`; };

  // ------------------------------------------------------------ who am I (what the screens let me edit)
  r('GET', '/api/inventory/me', async (c) => {
    if (!isUuid(c.userId)) return { can_maintain: false, can_approve: false };
    const can = (code) => hasPermission(c, code);
    return { can_maintain: await can('inventory.lists'), can_approve: await can('purchasing.approve'), can_edit: await can('inventory.edit'),
      can_use: await can('inventory.use'), can_adjust: await can('inventory.adjust'), can_request: await can('purchasing.request'), can_order: await can('purchasing.order'), can_upload: await can('inventory.upload'),
      can_qualify: await can('inventory.qualify'), can_qa_configure: await can('inventory.qa_configure') };
  });
  r('GET', '/api/inventory/meta', async (c) => {
    const en = async (t) => (await c.db.rows(`SELECT unnest(enum_range(NULL::${t}))::text AS v`)).map((x) => x.v);
    return {
      chemical_types: await en('chemical_type'), storage_conditions: await en('storage_condition'), location_types: await en('location_type'),
      supplier_types: await en('supplier_type'), lot_statuses: await en('lot_status'), receipt_statuses: await en('receipt_status'),
      txn_types: await en('inventory_txn_type'), threshold_subjects: await en('threshold_subject'), threshold_types: await en('threshold_type'),
      job_roles: await en('user_job_role'), units: (await c.db.one('SELECT inventory_units() AS u')).u,
      conc_units: (await c.db.rows("SELECT unit_code FROM unit_of_measure WHERE status = 'Active' AND dimension = ANY(concentration_dims()) ORDER BY sort_order, unit_code")).map((x) => x.unit_code),
      dimensions: await en('unit_dimension'), forms: ['Solid', 'Liquid'],
      ai: { enabled: !!process.env.ANTHROPIC_API_KEY, model: aiModel() },
    };
  });

  // ------------------------------------------------------------ Admin: Units and Unit conversions (QA and administrators maintain them)
  r('GET', '/api/units', (c) => c.db.rows(`SELECT u.*, (SELECT count(*) FROM unit_conversion x WHERE (x.from_unit_id = u.id OR x.to_unit_id = u.id) AND x.status = 'Active') AS conversion_count,
    (SELECT count(*) FROM inventory_lot l WHERE l.unit = u.unit_code OR l.concentration_unit = u.unit_code) AS used_count FROM unit_of_measure u ORDER BY u.sort_order, u.unit_code`));
  r('POST', '/api/units/bulk', (c) => signedTx(c, { meaning: 'Changed by', action: 'Units list', module: 'Admin' }, (t) => upsertRows(t, 'unit_of_measure', c.body.rows, ['unit_code', 'unit_name', 'dimension', 'sort_order', 'is_serving_unit', 'status'])));
  r('GET', '/api/unit-conversions', (c) => c.db.rows(`SELECT x.*, f.unit_code AS from_code, t.unit_code AS to_code, f.dimension AS from_dimension FROM unit_conversion x
    JOIN unit_of_measure f ON f.id = x.from_unit_id JOIN unit_of_measure t ON t.id = x.to_unit_id ORDER BY f.sort_order, f.unit_code, t.unit_code`));
  r('POST', '/api/unit-conversions/bulk', (c) => signedTx(c, { meaning: 'Changed by', action: 'Unit conversions list', module: 'Admin' }, (t) => upsertRows(t, 'unit_conversion', c.body.rows, ['from_unit_id', 'to_unit_id', 'factor', 'applies_to', 'assumption', 'status'])));
  // For each given unit, the units that can be used in its place (they convert to it): the mixture page's Unit choices
  r('GET', '/api/units/convertible', async (c) => { const out = {}; for (const u of String(c.query.units || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 40)) out[u] = (await c.db.rows('SELECT convertible_units($1, $2) AS u', [u, c.query.form || null])).map((x) => x.u); return out; });
  r('GET', '/api/units/convert', async (c) => c.db.one('SELECT unit_factor($1, $2, $3) AS factor', [c.query.from, c.query.to, c.query.form || null]));

  // ------------------------------------------------------------ lists: chemicals, suppliers, locations, warning rules
  r('GET', '/api/inventory/chemicals', (c) => c.db.rows(`SELECT ch.*, a.analyte_name,
    (SELECT count(*) FROM inventory_lot l WHERE l.chemical_id = ch.id) AS lot_count FROM chemical ch LEFT JOIN analyte a ON a.id = ch.analyte_id ORDER BY lower(ch.chemical_name)`));
  r('POST', '/api/inventory/chemicals/bulk', (c) => tx(c, (t) => upsertRows(t, 'chemical', c.body.rows, ['chemical_name', 'cas_number', 'analyte_id', 'synonyms', 'hazard_notes', 'status'])));
  r('GET', '/api/inventory/suppliers', (c) => c.db.rows(`SELECT s.*, (SELECT count(*) FROM inventory_lot l WHERE l.supplier_id = s.id OR l.manufacturer_id = s.id) AS lot_count
    FROM supplier s ORDER BY lower(s.supplier_name)`));
  r('POST', '/api/inventory/suppliers/bulk', (c) => signedTx(c, { meaning: 'Changed by', action: 'Supplier list', module: 'Purchasing' }, (t) => upsertRows(t, 'supplier', c.body.rows, ['supplier_name', 'supplier_type', 'website', 'email', 'phone', 'notes', 'status', 'account_number', 'contact_name', 'address'])));
  r('GET', '/api/inventory/locations', async (c) => c.db.rows(`SELECT l.*, location_path(l.id) AS path, p.location_code AS parent_code,
    (SELECT count(*) FROM inventory_lot i WHERE i.storage_location_id = l.id AND i.status NOT IN ('Disposed','Cancelled')) AS lot_count,
    (SELECT count(*) FROM sample s WHERE s.storage_location_id = l.id) AS sample_count
    FROM storage_location l LEFT JOIN storage_location p ON p.id = l.parent_location_id WHERE l.site_id = $1 ORDER BY location_path(l.id)`, [await currentSite(c)]));
  r('POST', '/api/inventory/locations/bulk', async (c) => { const site = await currentSite(c); return signedTx(c, { meaning: 'Changed by', action: 'Storage locations' }, (t) => upsertRows(t, 'storage_location', arraysOut(c.body.rows),
    ['location_code', 'location_name', 'location_type', 'parent_location_id', 'supported_conditions', 'holds_samples', 'status'], { site_id: site })); });
  // One storage location: where it is, what is inside it, and every lot and sample kept there
  r('GET', '/api/inventory/locations/:id', async (c) => {
    const loc = await c.db.one(`SELECT l.*, location_path(l.id) AS path, p.location_code AS parent_code, s.site_code FROM storage_location l
      LEFT JOIN storage_location p ON p.id = l.parent_location_id JOIN lab_site s ON s.id = l.site_id WHERE l.id = $1`, [c.params.id]);
    if (!loc) throw new Error('Storage location not found');
    await checkSite(c, loc.site_id);
    const children = await c.db.rows(`SELECT l.*, location_path(l.id) AS path,
      (SELECT count(*) FROM inventory_lot i WHERE i.storage_location_id = l.id AND i.status NOT IN ('Disposed','Cancelled')) AS lot_count,
      (SELECT count(*) FROM sample s WHERE s.storage_location_id = l.id) AS sample_count FROM storage_location l WHERE l.parent_location_id = $1 ORDER BY l.location_code`, [c.params.id]);
    const lots = await c.db.rows(`SELECT * FROM inventory_lot_view WHERE storage_location_id = $1 AND status NOT IN ('Disposed','Cancelled') ORDER BY material`, [c.params.id]);
    const samples = await c.db.rows('SELECT * FROM sample_storage_view WHERE storage_location_id = $1 ORDER BY sample_code', [c.params.id]);
    return { location: loc, children, lots, samples };
  });
  r('GET', '/api/inventory/thresholds', async (c) => c.db.rows(`SELECT r.*, s.site_code, ch.chemical_name FROM threshold_rule r
    LEFT JOIN lab_site s ON s.id = r.site_id LEFT JOIN chemical ch ON ch.id = r.chemical_id ORDER BY r.subject, r.rule_name`));
  r('POST', '/api/inventory/thresholds/bulk', (c) => signedTx(c, { meaning: 'Changed by', action: 'Warning rules' }, (t) => upsertRows(t, 'threshold_rule', c.body.rows, ['rule_name', 'subject', 'rule_type', 'value', 'site_id', 'chemical_id', 'status'])));
  r('GET', '/api/inventory/sites', (c) => c.db.rows("SELECT id, site_code, site_name FROM lab_site WHERE status = 'Active' ORDER BY site_code"));

  // ------------------------------------------------------------ lots
  r('GET', '/api/inventory/lots', async (c) => c.db.rows(`SELECT v.*, media_status(v.id) AS media_status, lot_qa_status(v.id) AS qa_status,
      w.waste_name, w.waste_code, w.needs_review AS waste_review, w.hazard_classes AS waste_hazards
    FROM inventory_lot_view v JOIN inventory_lot il ON il.id = v.id LEFT JOIN waste_classification w ON w.id = il.waste_classification_id WHERE v.site_id = $1
    ORDER BY (v.receipt_status = 'Received') DESC, (v.status IN ('Disposed','Cancelled')), v.material, v.lot_code`, [await currentSite(c)]));
  r('GET', '/api/inventory/dashboard', async (c) => c.db.one(`SELECT
    count(*) FILTER (WHERE receipt_status = 'Received' AND status = 'Available') AS available,
    count(*) FILTER (WHERE expiry_status = 'Expired' AND status NOT IN ('Disposed','Cancelled')) AS expired,
    count(*) FILTER (WHERE expiry_status = 'Expiring soon' AND status NOT IN ('Disposed','Cancelled')) AS expiring,
    count(*) FILTER (WHERE low_stock) AS low_stock, count(*) FILTER (WHERE negative_stock) AS negative,
    count(*) FILTER (WHERE receipt_status = 'Requested' AND status <> 'Cancelled') AS awaiting_approval,
    count(*) FILTER (WHERE receipt_status IN ('Approved','Ordered','In Transit') AND status <> 'Cancelled') AS on_order
    FROM inventory_lot_view WHERE site_id = $1`, [await currentSite(c)]));
  r('GET', '/api/inventory/lots/:id', async (c) => {
    await lotSite(c, c.params.id);
    const lot = await c.db.one('SELECT * FROM inventory_lot_view WHERE id = $1', [c.params.id]);
    const movements = await c.db.rows(`SELECT t.*, u.full_name AS by_name, rl.lot_code AS related_code, rl.id AS related_id, rs.site_code AS related_site,
      sum(t.quantity_change) OVER (ORDER BY t.txn_at, t.created_at) AS running_total
      FROM inventory_transaction t JOIN app_user u ON u.id = t.created_by LEFT JOIN inventory_lot rl ON rl.id = t.related_lot_id LEFT JOIN lab_site rs ON rs.id = rl.site_id
      WHERE t.lot_id = $1 ORDER BY t.txn_at, t.created_at`, [c.params.id]);
    const analytes = await c.db.rows(`SELECT la.*, a.analyte_name, a.analyte_code, a.cas_number AS analyte_cas,
      CASE WHEN la.target_concentration IS NULL THEN NULL WHEN la.concentration IS NULL THEN 'Not calculated'
           WHEN abs(la.concentration - la.target_concentration) <= la.target_concentration * COALESCE(la.tolerance_pct, 0) / 100 THEN 'Conforms' ELSE 'Alert' END AS conformance
      FROM lot_analyte la JOIN analyte a ON a.id = la.analyte_id WHERE la.lot_id = $1 AND la.status = 'Active' ORDER BY a.analyte_name`, [c.params.id]);
    const rules = await c.db.rows('SELECT * FROM lot_rule_results($1)', [c.params.id]);
    const components = await c.db.rows(`SELECT lc.*, v.lot_code, v.material, v.manufacturer_lot, v.unit, v.expiration_date, v.chemical_types_text, v.analytes_text FROM lot_component lc
      JOIN inventory_lot_view v ON v.id = lc.component_lot_id WHERE lc.lot_id = $1 ORDER BY v.material`, [c.params.id]);
    const usedIn = await c.db.rows(`SELECT lc.quantity_used, v.id, v.lot_code, v.material, v.expiration_date, v.status FROM lot_component lc
      JOIN inventory_lot_view v ON v.id = lc.lot_id WHERE lc.component_lot_id = $1 ORDER BY v.lot_code`, [c.params.id]);
    const coas = await c.db.rows(`SELECT c.id, c.file_name, c.sha256, c.extraction_method, c.ai_model, c.ai_proposed, c.values_confirmed, c.created_at,
      c.confirmed_at, u.full_name AS uploaded_by, cu.full_name AS confirmed_by_name, d.mime_type, d.size_bytes, c.status
      FROM supplier_coa c JOIN document_file d ON d.id = c.document_id JOIN app_user u ON u.id = c.created_by LEFT JOIN app_user cu ON cu.id = c.confirmed_by
      WHERE c.lot_id = $1 ORDER BY c.created_at DESC`, [c.params.id]);
    const related = await c.db.rows(`SELECT v.id, v.lot_code, v.site_code, v.receipt_status, v.status, 'Transferred to' AS relation FROM inventory_lot_view v WHERE v.transferred_from_lot_id = $1
      UNION ALL SELECT v.id, v.lot_code, v.site_code, v.receipt_status, v.status, 'Reordered as' FROM inventory_lot_view v WHERE v.reorder_of_lot_id = $1`, [c.params.id]);
    const purchase = await c.db.one(`SELECT v.id, v.line_code, v.status, v.po_code, v.external_po_number, v.requested_by FROM purchase_line_view v
      WHERE v.id = (SELECT purchase_line_id FROM inventory_lot WHERE id = $1)`, [c.params.id]);
    // media qualification (migration 023): what the lot is qualified for, and its test sample (the lot's own ID)
    // QA testing before use (migration 040, any item; was media qualification, 023)
    const media = await c.db.one(`SELECT l.qualification_required, l.item_url, l.department_id, (SELECT department_name FROM department WHERE id = l.department_id) AS department_name, media_status(l.id) AS media_status,
        l.waste_classification_id, (SELECT to_jsonb(w) FROM waste_classification w WHERE w.id = l.waste_classification_id) AS waste,
        lot_qa_status(l.id) AS qa_status, lot_qa_required(l.id) AS qa_required, lab_qa_default(l.site_id, l.chemical_types) AS qa_default,
        (SELECT s.id FROM sample s WHERE s.sample_code = l.lot_code) AS sample_id FROM inventory_lot l WHERE l.id = $1`, [c.params.id]);
    const qualifications = await c.db.rows(`SELECT q.*, COALESCE(ut.test_name, 'Every use') AS use_test_name, qt.test_name AS qualification_test_name, b.batch_code, u.full_name AS decided_by_name
      FROM media_qualification q LEFT JOIN test ut ON ut.id = q.use_test_id JOIN test qt ON qt.id = q.qualification_test_id
      LEFT JOIN test_batch b ON b.id = q.batch_id LEFT JOIN app_user u ON u.id = q.decided_by WHERE q.lot_id = $1 ORDER BY q.created_at`, [c.params.id]);
    return { lot: { ...lot, ...media }, analytes, rules, movements, components, usedIn, coas, related, purchase, qualifications };
  });
  // Receive many (paste grid): each row may name one analyte with its concentration
  r('POST', '/api/inventory/lots/bulk', async (c) => {
    const site = await currentSite(c);
    return signedTx(c, { meaning: 'Received by', action: `Receive many: ${(c.body.rows || []).length} item(s)` }, async (t) => {
      const out = [];
      for (const row of c.body.rows || []) {
        const { analyte_id: aid, analyte_concentration: ac, analyte_unit: au, qa_testing: qa, ...rest } = row;
        await qaChoice(t, row.id ? undefined : qa);
        const [res] = await upsertRows(t, 'inventory_lot', arraysOut([rest]), LOT_FIELDS, { site_id: site });
        const lotId = res ? res.id : row.id;
        if (aid) {
          const ex = await t.one('SELECT id FROM lot_analyte WHERE lot_id = $1 AND analyte_id = $2', [lotId, aid]);
          if (ex) await t.query('UPDATE lot_analyte SET concentration = $2, concentration_unit = $3, status = \'Active\' WHERE id = $1', [ex.id, ac ?? null, au || null]);
          else await t.query('INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit) VALUES ($1, $2, $3, $4)', [lotId, aid, ac ?? null, au || null]);
        }
        out.push({ id: lotId });
      }
      return out;
    });
  });
  // Create an inventory item (received now, or as a purchase request) with its analytes, in one save. The Supplier COA
  // can come with it (Alex, 2026-10-13): kept exactly as uploaded; the values the person saved on the form are what they
  // confirmed (any AI proposal is kept beside them for the audit trail).
  r('POST', '/api/inventory/items', async (c) => {
    const site = await currentSite(c);
    const fields = c.body.request ? [...LOT_FIELDS, 'receipt_status'] : LOT_FIELDS;
    const row = { ...c.body.row, ...(c.body.request ? { receipt_status: 'Requested' } : {}) };
    const coa = c.body.coa && c.body.coa.content_base64 ? c.body.coa : null;
    if (coa && !COA_TYPES.test(coa.mime_type || '')) throw new Error('Upload the COA as a PDF or an image (PNG or JPEG)');
    return signedTx(c, { meaning: c.body.request ? 'Requested by' : 'Created by', action: `New inventory item: ${row.item_name || ''}${coa ? ' (with its Supplier COA)' : ''}` }, async (t) => {
      await qaChoice(t, c.body.qa_testing);
      const [lot] = await upsertRows(t, 'inventory_lot', arraysOut([row]), fields, { site_id: site });
      await syncAnalytes(t, lot.id, c.body.analytes);
      if (coa) await saveCoa(t, lot.id, coa, coa.proposal || null, coa.confirmed || null);
      return lot;
    });
  });
  const saveCoa = async (t, lotId, f, proposal, confirmed) => {
    const doc = await t.one(`INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ($1, $2, 0, '', decode($3, 'base64')) RETURNING id`,
      [f.file_name || 'coa', f.mime_type, f.content_base64]);
    return t.one(`INSERT INTO supplier_coa (lot_id, document_id, file_name, sha256, extraction_method, ai_model, ai_proposed, values_confirmed)
      VALUES ($1, $2, '', '', $3, $4, $5::jsonb, $6::jsonb) RETURNING id, sha256`,
      [lotId, doc.id, proposal ? 'AI proposed, person confirmed' : 'Manual', proposal ? aiModel() : null, proposal ? JSON.stringify(proposal) : null, confirmed ? JSON.stringify(confirmed) : null]);
  };
  // Read a COA before the item exists (New Inventory Item): the AI proposes values to fill the form; nothing is saved
  r('POST', '/api/inventory/coa/read', async (c) => {
    await currentSite(c);
    const { mime_type, content_base64 } = c.body;
    if (!content_base64) throw new Error('Choose the COA file first');
    if (!COA_TYPES.test(mime_type || '')) throw new Error('Upload the COA as a PDF or an image (PNG or JPEG)');
    if (!process.env.ANTHROPIC_API_KEY) return { aiEnabled: false, proposal: null };
    return { aiEnabled: true, proposal: await readCoaWithAi(content_base64, mime_type) };
  });

  // ------------------------------------------------------------ media qualification (migration 023)
  // The tests a media lot can be qualified for, and the tests that can qualify it (this lab's tests with an approved version)
  r('GET', '/api/inventory/lots/:id/qualify-options', async (c) => {
    const site = await lotSite(c, c.params.id);
    const tests = await c.db.rows(`SELECT t.id, t.test_code, t.test_name, d.department_code FROM test t LEFT JOIN department d ON d.id = t.department_id
      WHERE t.site_id = $1 AND t.status = 'Active' AND EXISTS (SELECT 1 FROM test_version v WHERE v.test_id = t.id AND v.status = 'Effective')
      ORDER BY d.department_code NULLS LAST, t.test_name`, [site]);
    return { tests, can_qualify: await hasPermission(c, 'inventory.qualify') };
  });
  r('POST', '/api/inventory/lots/:id/qualify', async (c) => {
    await lotSite(c, c.params.id);
    // use_test_id empty = released for every use (migration 040)
    const items = (c.body.items || []).filter((x) => isUuid(x.qualification_test_id) && (!x.use_test_id || isUuid(x.use_test_id)))
      .map((x) => ({ use_test_id: x.use_test_id || null, qualification_test_id: x.qualification_test_id }));
    return tx(withReason(c, 'Sent for QA testing'), async (t) => {
      const x = await t.one('SELECT send_lot_for_qa_testing($1, $2::jsonb) AS sample_id', [c.params.id, JSON.stringify(items)]);
      return t.one('SELECT id AS sample_id, sample_code FROM sample WHERE id = $1', [x.sample_id]);
    });
  });
  // QA waives the QA testing of one lot (signed, with a reason; only before anything was sent for it)
  r('POST', '/api/inventory/lots/:id/waive-qa', async (c) => {
    await lotSite(c, c.params.id);
    if (!String(c.body.reason || '').trim()) throw new Error('Give the reason for waiving QA testing');
    return signedTx(c, { meaning: 'Approved by', action: await lotWords(c, c.params.id, 'QA testing waived') }, async (t) => {
      await t.query('SELECT waive_lot_qa_testing($1)', [c.params.id]);
      return { ok: true };
    });
  });
  // Each lab's QA testing defaults: which item types need QA testing before use (QA keeps them, with a reason)
  r('GET', '/api/inventory/qa-defaults', async (c) => {
    const site = await currentSite(c);
    const rows = await c.db.rows(`SELECT d.*, u.full_name AS modified_by_name,
        (SELECT count(*) FROM inventory_lot l WHERE l.site_id = d.site_id AND d.chemical_type = ANY (l.chemical_types) AND lot_qa_status(l.id) IN ('Awaiting QA testing','In QA testing','Rejected','Rejected, retest under way'))::int AS waiting
      FROM qa_testing_default d JOIN app_user u ON u.id = d.modified_by WHERE d.site_id = $1 ORDER BY d.chemical_type::text`, [site]);
    const lots = await c.db.rows(`SELECT v.id, v.lot_code, v.material, v.manufacturer_lot, v.chemical_types_text, v.received_date, lot_qa_status(v.id) AS qa_status
      FROM inventory_lot_view v WHERE v.site_id = $1 AND v.status NOT IN ('Disposed','Cancelled') AND lot_qa_status(v.id) IN ('Awaiting QA testing','In QA testing','Rejected','Rejected, retest under way')
      ORDER BY lot_qa_status(v.id), v.lot_code`, [site]);
    return { rows, lots, can_edit: await hasPermission(c, 'inventory.qa_configure') };
  });
  r('POST', '/api/inventory/qa-defaults', async (c) => {
    const site = await currentSite(c);
    if (!String(c.body.reason || '').trim()) throw new Error('A Reason for Change is required');
    return tx(withReason(c, ''), async (t) => {
      for (const row of c.body.rows || []) {
        if (!isUuid(row.id)) continue;
        await t.query('UPDATE qa_testing_default SET required = $2, note = $3 WHERE id = $1 AND site_id = $4 AND (required, COALESCE(note, \'\')) IS DISTINCT FROM ($2, COALESCE($3, \'\'))',
          [row.id, !!row.required, row.note || null, site]);
      }
      return { ok: true };
    });
  });
  AUDIT_LISTS.qa_testing = ['qa_testing_default'];

  // Edit an item and its analytes (one Reason for Change)
  r('PUT', '/api/inventory/items/:id', async (c) => {
    await lotSite(c, c.params.id);
    return signedTx(c, { meaning: 'Changed by', action: await lotWords(c, c.params.id, 'Changed') }, async (t) => {
      await upsertRows(t, 'inventory_lot', arraysOut([{ ...c.body.row, id: c.params.id }]), LOT_FIELDS);
      if (c.body.analytes) await syncAnalytes(t, c.params.id, c.body.analytes);
    });
  });
  r('PUT', '/api/inventory/lots/:id', async (c) => { await lotSite(c, c.params.id); return signedTx(c, { meaning: 'Changed by', action: await lotWords(c, c.params.id, 'Changed') }, (t) => upsertRows(t, 'inventory_lot', arraysOut([{ ...c.body.row, id: c.params.id }]), LOT_FIELDS)); });
  // New purchase request (not a reorder of an existing lot)
  r('POST', '/api/inventory/requests', async (c) => {
    const site = await currentSite(c);
    return signedTx(c, { meaning: 'Requested by', action: `Purchase request: ${c.body.row.item_name || ''}` }, (t) => upsertRows(t, 'inventory_lot', arraysOut([{ ...c.body.row, receipt_status: 'Requested' }]), [...LOT_FIELDS, 'receipt_status'], { site_id: site })).then((x) => x[0]);
  });
  r('POST', '/api/inventory/lots/:id/purchase-status', async (c) => {
    await lotSite(c, c.params.id);
    const to = c.body.receipt_status;
    if (!['Approved', 'Ordered'].includes(to)) throw new Error('Use Receive to receive a lot');
    // since migration 011 these go through Purchasing: the approval queue, and a purchase order of its own
    const line = (await c.db.one('SELECT purchase_line_id FROM inventory_lot WHERE id = $1', [c.params.id]))?.purchase_line_id;
    if (!line) throw new Error('This lot has no purchase request');
    return signedTx(withReason(c, to === 'Approved' ? 'Purchase request approved' : 'Ordered'), { meaning: to === 'Approved' ? 'Approved by' : 'Ordered by', module: 'Purchasing', action: await lotWords(c, c.params.id, to === 'Approved' ? 'Purchase approved' : 'Ordered') },
      (t) => (to === 'Approved' ? t.query('SELECT approve_purchase_lines($1::uuid[])', [[line]]) : t.query('SELECT create_purchase_order($1::uuid[], $2, $3, NULL)', [[line], c.body.external_po_number || null, c.body.confirmation_number || null])));
  });
  r('POST', '/api/inventory/lots/:id/cancel', async (c) => {
    await lotSite(c, c.params.id);
    return signedTx(c, { meaning: 'Cancelled by', action: await lotWords(c, c.params.id, 'Purchase request cancelled') }, (t) => t.query("UPDATE inventory_lot SET status = 'Cancelled' WHERE id = $1", [c.params.id]));
  });
  r('POST', '/api/inventory/lots/:id/reorder', async (c) => {
    await lotSite(c, c.params.id);
    return signedTx(c, { meaning: 'Requested by', action: await lotWords(c, c.params.id, 'Reorder of') }, (t) => t.one('SELECT reorder_lot($1, $2, $3) AS id', [c.params.id, c.body.quantity || null, c.body.notes || null]));
  });
  r('POST', '/api/inventory/lots/:id/receive', async (c) => {
    await lotSite(c, c.params.id);
    const b = c.body;
    return signedTx(withReason(c, 'Received into inventory'), { meaning: 'Received by', action: await lotWords(c, c.params.id, 'Received') }, (t) => t.query('SELECT receive_lot($1, $2, $3, $4, $5, $6, $7, $8)',
      [c.params.id, b.quantity || null, b.unit || null, b.manufacturer_lot || null, b.expiration_date || null, b.retest_date || null, b.storage_location_id || null, b.received_date || null]));
  });
  r('POST', '/api/inventory/lots/:id/transfer', async (c) => {
    await lotSite(c, c.params.id);
    return signedTx(c, { meaning: 'Transferred by', action: await lotWords(c, c.params.id, 'Transferred') }, (t) => t.one('SELECT transfer_lot($1, $2, $3, $4) AS id', [c.params.id, c.body.to_site_id, c.body.quantity, c.body.notes || null]));
  });
  r('POST', '/api/inventory/lots/:id/dispose', async (c) => { await lotSite(c, c.params.id); return signedTx(c, { meaning: 'Disposed by', action: await lotWords(c, c.params.id, 'Disposed') }, (t) => t.query('SELECT dispose_lot($1)', [c.params.id])); });

  // ------------------------------------------------------------ stock movements (usage, adjustment) for one or many lots
  r('POST', '/api/inventory/movements', async (c) => {
    const site = await currentSite(c);
    const routine = (c.body.rows || []).every((m) => (m.txn_type || 'Usage') === 'Usage'); // usage needs no signature; adjustments do
    const run = routine ? (fn) => tx(c, fn) : (fn) => signedTx(c, { meaning: 'Adjusted by', action: `Stock adjustment: ${(c.body.rows || []).length} line(s)` }, fn);
    return run(async (t) => {
      const out = [];
      for (const m of c.body.rows || []) {
        const lot = m.lot_id ? await t.one('SELECT id, site_id FROM inventory_lot WHERE id = $1', [m.lot_id])
          : await t.one('SELECT id, site_id FROM inventory_lot WHERE upper(lot_code) = upper($1)', [String(m.lot_code || '').trim()]);
        if (!lot) throw new Error(`Lot "${m.lot_code || ''}" not found`);
        if (lot.site_id !== site) throw new Error(`Lot ${m.lot_code || ''} belongs to another lab`);
        out.push(await t.one(`INSERT INTO inventory_transaction (lot_id, txn_type, quantity_change, reference, notes, txn_at)
          VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, clock_timestamp())) RETURNING id`,
          [lot.id, m.txn_type || 'Usage', m.quantity, m.reference || null, m.notes || null, m.txn_at || null]));
      }
      return out;
    });
  });

  // ------------------------------------------------------------ in-house mixtures
  r('POST', '/api/inventory/mixtures', async (c) => {
    const site = await currentSite(c); const b = c.body;
    return signedTx(c, { meaning: 'Prepared by', action: `In-house mixture: ${b.item_description || ''}` }, (t) => t.one(`SELECT make_mixture($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12) AS id`,
      [site, b.chemical_id || null, b.item_description || null, b.quantity, b.unit, b.concentration || null, b.concentration_unit || null,
        b.expiration_date || null, b.storage_condition || null, b.storage_location_id || null, JSON.stringify(b.components || []), b.notes || null]));
  });

  // Mixture page: the default quantity made and the calculated concentration of each analyte, before saving
  r('POST', '/api/inventory/mixtures/preview', async (c) => {
    await currentSite(c);
    const b = c.body; const comps = JSON.stringify((b.components || []).filter((x) => x.lot_id && Number(x.quantity) > 0));
    const def = b.unit ? (await c.db.one('SELECT mixture_default_quantity($1::jsonb, $2) AS q', [comps, b.unit])).q : null;
    const qty = Number(b.quantity) > 0 ? Number(b.quantity) : def;
    const analytes = qty && b.unit ? await c.db.rows(`SELECT m.*, a.cas_number FROM mixture_concentrations($1::jsonb, $2, $3, $4, $5::jsonb) m
      JOIN analyte a ON a.id = m.analyte_id ORDER BY m.analyte_name`, [comps, qty, b.unit, b.form || 'Liquid', JSON.stringify(b.out_units || {})]) : [];
    return { default_quantity: def, quantity: qty, analytes };
  });
  r('POST', '/api/inventory/mixtures/prepare', async (c) => {
    const site = await currentSite(c); const b = c.body;
    return signedTx(c, { meaning: 'Prepared by', action: `In-house mixture: ${b.item_name || ''}` }, (t) => t.one(`SELECT prepare_mixture($1, $2, $3::chemical_type[], $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13) AS id`,
      [site, b.item_name, toPgArray(b.chemical_types || []), b.physical_form, b.quantity, b.unit, b.expiration_date || null, b.storage_condition || null,
        b.storage_location_id || null, JSON.stringify(b.components || []), JSON.stringify(b.targets || []), b.notes || null, b.retest_date || null]));
  });

  // ------------------------------------------------------------ Excel export and bulk upload for every tab
  const bulkDef = (kind) => { const d = bulk.KINDS[kind]; if (!d) throw new Error('Unknown list'); return d; };
  const bulkRows = async (c, d) => fixArrays(await c.db.rows(d.list, d.site ? [await currentSite(c)] : []));
  r('POST', '/api/bulk/:kind/export', async (c) => {
    const d = bulkDef(c.params.kind);
    let rows = await bulkRows(c, d);
    if (Array.isArray(c.body.ids) && c.body.ids.length) rows = rows.filter((x) => c.body.ids.includes(x.id));
    if (c.body.template) rows = [];
    const site = d.site ? (await c.db.one('SELECT site_code FROM lab_site WHERE id = $1', [c.siteId])).site_code + ' ' : '';
    const stamp = new Date().toISOString().slice(0, 10);
    return { __raw: true, body: bulk.exportFile(d, rows), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      headers: { 'Content-Disposition': `attachment; filename="${(site + d.title).replace(/[^\w\- ]/g, '')} ${stamp}.xlsx"` } };
  });
  const decodeUpload = (c) => {
    if (!c.body.content_base64) throw new Error('Choose the Excel file to upload');
    const buf = Buffer.from(c.body.content_base64, 'base64');
    if (buf.length > 10 * 1024 * 1024) throw new Error('The file is larger than 10 MB');
    return buf;
  };
  r('POST', '/api/bulk/:kind/preview', async (c) => {
    const d = bulkDef(c.params.kind);
    if (c.params.kind === 'lots') await requireQaOrAdmin(c);
    const site = d.site ? await currentSite(c) : null;
    const p = await bulk.preview(c.db, d, await bulkRows(c, d), decodeUpload(c), c.body.file_name || '', site);
    return { ...p, rows: p.rows.map(({ payload, ...x }) => x) };
  });
  r('POST', '/api/bulk/:kind/apply', async (c) => {
    const d = bulkDef(c.params.kind);
    if (c.params.kind === 'lots') await requireQaOrAdmin(c);
    const site = d.site ? await currentSite(c) : null;
    const p = await bulk.preview(c.db, d, await bulkRows(c, d), decodeUpload(c), c.body.file_name || '', site);
    const bad = p.rows.filter((x) => x.action === 'Error');
    if (bad.length) throw new Error(`Fix the ${bad.length} row${bad.length === 1 ? '' : 's'} with errors first (row ${bad[0].row}: ${bad[0].errors[0]})`);
    const todo = p.rows.filter((x) => x.action === 'Create' || x.action === 'Update');
    if (!todo.length) return { created: 0, updated: 0 };
    const fields = d.cols.filter((x) => !x.ro && x.f && !x.f.startsWith('__')).map((x) => x.f);
    return signedTx(c, { meaning: 'Uploaded by', action: `Excel upload to ${d.title}: ${todo.length} row(s)`, module: d.module || (['units', 'conversions'].includes(c.params.kind) ? 'Admin' : 'Inventory') }, async (t) => {
      let created = 0; let updated = 0;
      for (const x of todo) {
        const { __analytes, __owners, ...payload } = x.payload;
        try {
          const fixed = d.site && !payload.id ? { [d.siteField || 'site_id']: site } : {};
          const [res] = Object.keys(payload).some((k) => k !== 'id') || !payload.id ? await upsertRows(t, d.table, arraysOut([payload]), fields, fixed) : [{ id: payload.id }];
          if (__analytes) await syncAnalytes(t, (res && res.id) || payload.id, __analytes);
          if (__owners && d.afterRow) await d.afterRow(t, (res && res.id) || payload.id, { __owners });
          if (payload.id) updated++; else created++;
        } catch (e) { const n = translate(e); n.message = `Row ${x.row} (${x.key}): ${n.message}`; throw n; }
      }
      return { created, updated };
    });
  });

  // ------------------------------------------------------------ Supplier COA: upload, AI proposal, person confirms
  r('POST', '/api/inventory/lots/:id/coa', async (c) => {
    await lotSite(c, c.params.id);
    const { file_name, mime_type, content_base64 } = c.body;
    if (!content_base64) throw new Error('Choose the COA file to upload');
    if (!/^(application\/pdf|image\/(png|jpeg|gif|webp))$/.test(mime_type || '')) throw new Error('Upload the COA as a PDF or an image (PNG or JPEG)');
    let proposal = null; let aiError = null;
    if (process.env.ANTHROPIC_API_KEY && c.body.use_ai !== false) {
      try { proposal = await readCoaWithAi(content_base64, mime_type); } catch (e) { aiError = e.message; }
    }
    const coa = await signedTx({ ...c, reason: c.body.reason || 'Supplier COA uploaded' }, { meaning: 'Uploaded by', action: await lotWords(c, c.params.id, `Supplier COA ${file_name || ''} uploaded`) }, async (t) => {
      const doc = await t.one(`INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ($1, $2, 0, '', decode($3, 'base64')) RETURNING id`,
        [file_name || 'coa', mime_type, content_base64]);
      return t.one(`INSERT INTO supplier_coa (lot_id, document_id, file_name, sha256, extraction_method, ai_model, ai_proposed)
        VALUES ($1, $2, '', '', $3, $4, $5::jsonb) RETURNING id, sha256`,
        [c.params.id, doc.id, proposal ? 'AI proposed, person confirmed' : 'Manual', proposal ? aiModel() : null, proposal ? JSON.stringify(proposal) : null]);
    });
    return { ...coa, proposal, aiError, aiEnabled: !!process.env.ANTHROPIC_API_KEY };
  });
  r('GET', '/api/inventory/coa/:id/file', async (c) => {
    const d = await c.db.one(`SELECT d.file_name, d.mime_type, encode(d.content, 'base64') AS b64, l.site_id FROM supplier_coa s
      JOIN document_file d ON d.id = s.document_id JOIN inventory_lot l ON l.id = s.lot_id WHERE s.id = $1`, [c.params.id]);
    if (!d) throw new Error('COA not found');
    if (c.query.s) c.siteId = c.query.s; // opened in a new tab: the session cookie says who is asking; the lab comes in the link
    await checkSite(c, d.site_id);
    return { __raw: true, body: Buffer.from(d.b64, 'base64'), type: d.mime_type,
      headers: { 'Content-Disposition': `inline; filename="${String(d.file_name).replace(/[^\w.\- ]/g, '_')}"` } };
  });
  // values: the lot fields the person confirmed (AI proposal or typed); they are written to the lot with the reason
  r('POST', '/api/inventory/coa/:id/confirm', async (c) => {
    const s = await c.db.one('SELECT lot_id FROM supplier_coa WHERE id = $1', [c.params.id]);
    if (!s) throw new Error('COA not found');
    await lotSite(c, s.lot_id);
    const allowed = ['manufacturer_lot', 'expiration_date', 'retest_date', 'purity_pct', 'concentration', 'concentration_unit', 'catalog_number'];
    const values = Object.fromEntries(Object.entries(c.body.values || {}).filter(([k, v]) => allowed.includes(k) && v !== '' && v !== null && v !== undefined));
    return signedTx(withReason(c, 'Values confirmed from the Supplier COA'), { meaning: 'Verified by', action: await lotWords(c, s.lot_id, 'Supplier COA values confirmed') }, async (t) => {
      if (Object.keys(values).length) await upsertRows(t, 'inventory_lot', [{ ...values, id: s.lot_id }], allowed);
      await t.query('UPDATE supplier_coa SET values_confirmed = $2::jsonb WHERE id = $1', [c.params.id, JSON.stringify(values)]);
    });
  });

  // ------------------------------------------------------------ sample storage and retained quantity
  r('GET', '/api/inventory/samples', async (c) => c.db.rows(`SELECT * FROM sample_storage_view WHERE site_id = $1 AND status = 'Logged'
    ORDER BY logged_at DESC NULLS LAST, sample_code`, [await currentSite(c)]));
  r('POST', '/api/inventory/samples/bulk', async (c) => {
    const site = await currentSite(c);
    return signedTx(c, { meaning: 'Changed by', action: `Sample storage: ${(c.body.rows || []).length} sample(s)` }, async (t) => {
      for (const row of c.body.rows || []) {
        const s = await t.one('SELECT o.site_id FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = $1', [row.id]);
        if (!s || s.site_id !== site) throw new Error('A sample in the list belongs to another lab');
      }
      return upsertRows(t, 'sample', (c.body.rows || []).filter((x) => x.id), ['storage_location_id', 'storage_condition', 'retained_quantity', 'retained_unit']);
    });
  });

  // (Admin > Job roles was replaced by lab groups in migration 008: see routes_permissions.js)

  // ------------------------------------------------------------ audit trail behind each inventory page
  AUDIT_SCOPES.lot = `SELECT 'inventory_lot', $1::uuid UNION ALL SELECT 'inventory_transaction', id FROM inventory_transaction WHERE lot_id = $1
    UNION ALL SELECT 'lot_component', id FROM lot_component WHERE lot_id = $1 UNION ALL SELECT 'supplier_coa', id FROM supplier_coa WHERE lot_id = $1
    UNION ALL SELECT 'lot_analyte', id FROM lot_analyte WHERE lot_id = $1`;
  AUDIT_SCOPES.location = `SELECT 'storage_location', $1::uuid UNION ALL SELECT 'storage_location', id FROM storage_location WHERE parent_location_id = $1`;
  AUDIT_CHECKS.location = async (c, id) => { const l = await c.db.one('SELECT site_id FROM storage_location WHERE id = $1', [id]); if (!l) throw new Error('Storage location not found'); await checkSite(c, l.site_id); };
  Object.assign(AUDIT_LISTS, { units: ['unit_of_measure'], conversions: ['unit_conversion'] });
  AUDIT_SCOPES.inventory = `SELECT 'inventory_lot', id FROM inventory_lot WHERE site_id = $1
    UNION ALL SELECT 'inventory_transaction', t.id FROM inventory_transaction t JOIN inventory_lot l ON l.id = t.lot_id WHERE l.site_id = $1`;
  AUDIT_SCOPES.locations = `SELECT 'storage_location', id FROM storage_location WHERE site_id = $1`;
  AUDIT_SCOPES.samplestorage = `SELECT 'sample', s.id FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE o.site_id = $1 AND s.storage_location_id IS NOT NULL`;
  SITE_AUDIT_KINDS.push('inventory', 'locations', 'samplestorage');
  AUDIT_CHECKS.lot = (c, id) => lotSite(c, id);
  Object.assign(AUDIT_LISTS, { chemicals: ['chemical'], suppliers: ['supplier'], thresholds: ['threshold_rule'] });
};

// ---------------------------------------------------------------- AI reading of a Supplier COA
// Off unless ANTHROPIC_API_KEY is set (IT approval needed: the document is sent to Anthropic's API to be read).
// The AI only proposes; a person confirms every value before it is saved, and the proposal is kept for the audit trail.
function aiModel() { return process.env.LIMS_AI_MODEL || 'claude-sonnet-5-5'; }
async function readCoaWithAi(b64, mime) {
  const source = { type: 'base64', media_type: mime, data: b64 };
  const block = mime === 'application/pdf' ? { type: 'document', source } : { type: 'image', source };
  const prompt = `This is a supplier Certificate of Analysis for a laboratory chemical, reference standard, reagent, medium or microbiological strain.
Read it and return ONLY a JSON object with these keys (use null when the document does not state the value; never guess):
{"chemical_name": string, "cas_number": string, "manufacturer_name": string, "catalog_number": string, "manufacturer_lot": string,
 "expiration_date": "YYYY-MM-DD", "retest_date": "YYYY-MM-DD", "purity_pct": number, "concentration": number, "concentration_unit": string,
 "evidence": {"<key>": "the exact text on the document that supports the value"}}
Dates written like 04/2027 mean the last day of that month. Purity is a percentage number without the % sign.`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: aiModel(), max_tokens: 1500, messages: [{ role: 'user', content: [block, { type: 'text', text: prompt }] }] }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('The AI could not read the COA: ' + (data.error?.message || res.status));
  const text = (data.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('The AI did not return values for this COA');
  return JSON.parse(m[0]);
}
