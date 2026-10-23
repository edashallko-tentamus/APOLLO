// Search everything (0.35.0, Alex): the box at the top of every page. Any ID, name or number (typed or scanned)
// finds the records it belongs to: orders, samples, inventory, equipment, batches, clients, contacts, quotes and
// projects, invoices, OOS investigations, COAs, stability studies, purchasing, logbooks, tests, trend charts.
// Lab records come from the lab being worked in; shared records (clients, contacts, suppliers, quotes) from
// everywhere. An exact ID match is returned as `exact` so the screen opens it at once (Enter, or a scanner).
// Opening a record still runs that page's own checks; this only finds it.
'use strict';

// each source: what it is, the columns an exact ID matches, the text columns searched, and where its page is
// $1 = the lab, $2 = '%text%', $3 = the text as typed (exact matches ignore case and spaces)
const X = (col) => `upper(replace(${col}::text, ' ', '')) = upper(replace($3, ' ', ''))`;
const SOURCES = [
  { kind: 'Sample', sql: `SELECT s.id, COALESCE(s.sample_code, s.client_sample_id, 'Not logged') AS code, COALESCE(s.client_sample_id, s.description, '') AS title, o.order_code AS sub, '#/samples/' || s.id AS href,
      (${X('s.sample_code')} OR ${X('s.metrc_id')}) AS exact, s.created_at
      FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE o.site_id = $1 AND (s.sample_code ILIKE $2 OR s.client_sample_id ILIKE $2 OR s.metrc_id ILIKE $2 OR s.description ILIKE $2)` },
  { kind: 'Lab order', sql: `SELECT o.id, o.order_code AS code, COALESCE(c.display_name, c.legal_name) AS title, COALESCE('PO ' || o.po_number, '') AS sub, '#/orders/' || o.id AS href,
      (${X('o.order_code')} OR ${X('o.po_number')}) AS exact, o.created_at
      FROM lab_order o JOIN client c ON c.id = o.client_id WHERE o.site_id = $1 AND (o.order_code ILIKE $2 OR o.po_number ILIKE $2)` },
  { kind: 'COA', sql: `SELECT s.id, s.sample_code || '-R' || v.version_no AS code, COALESCE(s.client_sample_id, '') AS title, 'Version ' || v.version_no || CASE WHEN v.is_final THEN ', final' ELSE '' END AS sub,
      '#/samples/' || s.id AS href, (${X(`s.sample_code || '-R' || v.version_no`)} OR ${X('v.verify_code')}) AS exact, v.issued_at AS created_at
      FROM coa_version v JOIN coa ON coa.id = v.coa_id JOIN sample s ON s.id = coa.sample_id WHERE coa.site_id = $1
        AND ((s.sample_code || '-R' || v.version_no) ILIKE $2 OR v.verify_code ILIKE $2)` },
  { kind: 'Inventory', sql: `SELECT l.id, l.lot_code AS code, l.material AS title, COALESCE('Lot ' || l.manufacturer_lot, '') AS sub, '#/inventory/lots/' || l.id AS href,
      (${X('l.lot_code')} OR ${X('l.manufacturer_lot')}) AS exact, l.created_at
      FROM inventory_lot_view l WHERE l.site_id = $1 AND (l.lot_code ILIKE $2 OR l.material ILIKE $2 OR l.manufacturer_lot ILIKE $2 OR l.cas_display ILIKE $2)` },
  { kind: 'Equipment', sql: `SELECT e.id, e.equipment_code AS code, e.equipment_name AS title, concat_ws(' · ', e.type_name, CASE WHEN e.serial_number IS NOT NULL THEN 'S/N ' || e.serial_number END) AS sub,
      '#/equipment/' || e.id AS href, (${X('e.equipment_code')} OR ${X('e.serial_number')}) AS exact, e.created_at
      FROM equipment_view e WHERE e.site_id = $1 AND (e.equipment_code ILIKE $2 OR e.equipment_name ILIKE $2 OR e.serial_number ILIKE $2 OR e.model ILIKE $2)` },
  { kind: 'Batch', sql: `SELECT b.id, b.batch_code AS code, b.test_code || ' ' || b.test_name AS title, b.status::text AS sub, '#/testing/batches/' || b.id AS href,
      ${X('b.batch_code')} AS exact, b.created_at
      FROM test_batch_view b WHERE b.site_id = $1 AND NOT b.is_verification AND (b.batch_code ILIKE $2)` },
  { kind: 'Client', sql: `SELECT c.id, c.client_code AS code, COALESCE(c.display_name, c.legal_name) AS title, c.account_status::text AS sub, '#/clients/' || c.id AS href,
      ${X('c.client_code')} AS exact, c.created_at
      FROM client c WHERE $1::uuid IS NOT NULL AND (c.client_code ILIKE $2 OR c.legal_name ILIKE $2 OR c.display_name ILIKE $2)` },
  { kind: 'Contact', sql: `SELECT ct.id, ct.contact_code AS code, ct.first_name || ' ' || ct.last_name AS title, ct.email AS sub, '#/contacts?find=' || ct.contact_code AS href,
      (${X('ct.contact_code')} OR ${X('ct.email')}) AS exact, ct.created_at
      FROM contact ct WHERE $1::uuid IS NOT NULL AND (ct.contact_code ILIKE $2 OR (ct.first_name || ' ' || ct.last_name) ILIKE $2 OR ct.email ILIKE $2)` },
  { kind: 'Quote or project', sql: `SELECT p.id, p.project_code AS code, p.project_name AS title, p.kind::text || ' · ' || COALESCE(cl.display_name, cl.legal_name) AS sub,
      CASE p.kind::text WHEN 'Project' THEN '#/projects/' WHEN 'Stability' THEN '#/stability/quotes/' ELSE '#/quotes/' END || p.id AS href,
      ${X('p.project_code')} AS exact, p.created_at
      FROM project p JOIN client cl ON cl.id = p.client_id WHERE $1::uuid IS NOT NULL AND (p.project_code ILIKE $2 OR p.project_name ILIKE $2)` },
  { kind: 'Stability study', sql: `SELECT s.id, s.study_code AS code, s.product AS title, s.client_name AS sub, '#/stability/studies/' || s.id AS href,
      ${X('s.study_code')} AS exact, s.created_at
      FROM stability_study_view s WHERE s.site_id = $1 AND (s.study_code ILIKE $2 OR s.product ILIKE $2)` },
  { kind: 'OOS investigation', sql: `SELECT x.id, x.oos_code AS code, a.analyte_name || ' in ' || s.sample_code AS title, x.status::text AS sub, '#/oos/' || x.id AS href,
      ${X('x.oos_code')} AS exact, x.opened_at AS created_at
      FROM oos_investigation x JOIN sample s ON s.id = x.sample_id JOIN analyte a ON a.id = x.analyte_id WHERE x.site_id = $1 AND x.oos_code ILIKE $2` },
  { kind: 'Invoice', perm: ['invoicing.view', 'invoicing.issue'], sql: `SELECT i.id, i.code, i.client_name AS title, i.kind::text || ' · ' || i.status::text AS sub, '#/billing/invoices/' || i.id AS href,
      (${X('i.code')} OR ${X('i.invoice_number')}) AS exact, i.created_at
      FROM invoice_view i WHERE i.site_id = $1 AND (i.code ILIKE $2 OR i.invoice_number::text ILIKE $2)` },
  { kind: 'Purchase request', sql: `SELECT v.id, v.line_code AS code, v.description AS title, v.status::text AS sub, '#/purchasing/requests/' || v.id AS href,
      ${X('v.line_code')} AS exact, v.requested_at AS created_at
      FROM purchase_line_view v WHERE v.site_id = $1 AND (v.line_code ILIKE $2 OR v.description ILIKE $2 OR v.catalog_number ILIKE $2)` },
  { kind: 'Purchase order', sql: `SELECT o.id, o.po_code AS code, s.supplier_name AS title, COALESCE('Finance PO ' || o.external_po_number, '') AS sub, '#/purchasing/orders/' || o.id AS href,
      (${X('o.po_code')} OR ${X('o.external_po_number')}) AS exact, o.ordered_at AS created_at
      FROM purchase_order o JOIN supplier s ON s.id = o.supplier_id WHERE o.site_id = $1 AND (o.po_code ILIKE $2 OR o.external_po_number ILIKE $2)` },
  { kind: 'Supplier', sql: `SELECT s.id, s.supplier_code AS code, s.supplier_name AS title, '' AS sub, '#/purchasing/suppliers/' || s.id AS href,
      ${X('s.supplier_code')} AS exact, s.created_at
      FROM supplier s WHERE $1::uuid IS NOT NULL AND (s.supplier_code ILIKE $2 OR s.supplier_name ILIKE $2)` },
  { kind: 'Logbook', sql: `SELECT l.id, l.logbook_code AS code, l.logbook_name AS title, l.kind::text AS sub, '#/logbooks/' || l.id AS href,
      ${X('l.logbook_code')} AS exact, l.created_at
      FROM logbook l WHERE l.site_id = $1 AND (l.logbook_code ILIKE $2 OR l.logbook_name ILIKE $2)` },
  { kind: 'Logbook entry', sql: `SELECT e.id, e.entry_code AS code, l.logbook_name AS title, e.status::text AS sub, '#/logbooks/entries/' || e.id AS href,
      ${X('e.entry_code')} AS exact, e.created_at
      FROM logbook_entry e JOIN logbook l ON l.id = e.logbook_id WHERE l.site_id = $1 AND e.entry_code ILIKE $2` },
  { kind: 'Test', sql: `SELECT t.id, t.test_code AS code, t.test_name AS title, COALESCE(ls.site_code, '') AS sub, '#/methods/tests/' || t.id AS href,
      ${X('t.test_code')} AS exact, t.created_at
      FROM test t LEFT JOIN lab_site ls ON ls.id = t.site_id WHERE (t.site_id = $1 OR t.site_id IS NULL) AND (t.test_code ILIKE $2 OR t.test_name ILIKE $2)` },
  { kind: 'Trend chart', sql: `SELECT t.id, t.chart_code AS code, t.chart_name AS title, t.source::text AS sub, '#/trending/charts/' || t.id AS href,
      ${X('t.chart_code')} AS exact, t.created_at
      FROM trend_chart t WHERE t.site_id = $1 AND t.status = 'Active' AND (t.chart_code ILIKE $2 OR t.chart_name ILIKE $2)` },
];

module.exports = function register(route, { currentSite, hasPermission }) {
  route('GET', '/api/search', async (c) => {
    const q = String(c.query.q || '').trim().slice(0, 100);
    if (q.length < 2) return { q, results: [], exact: null };
    const site = await currentSite(c);
    const like = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    const each = Math.min(20, Math.max(3, parseInt(c.query.each, 10) || 6));
    const results = [];
    for (const s of SOURCES) {
      if (s.perm) { let ok = false; for (const p of s.perm) if (await hasPermission(c, p)) { ok = true; break; } if (!ok) continue; }
      try {
        const rows = await c.db.rows(`SELECT * FROM (${s.sql}) x ORDER BY exact DESC, created_at DESC NULLS LAST LIMIT ${each}`, [site, like, q]);
        for (const r of rows) results.push({ kind: s.kind, id: r.id, code: r.code, title: r.title, sub: r.sub, href: r.href, exact: !!r.exact });
      } catch (e) { results.push({ kind: s.kind, error: e.message }); }
    }
    const exacts = results.filter((r) => r.exact);
    // one exact match opens it; a sample ID that is also its COA's first part prefers the sample
    const exact = exacts.length === 1 ? exacts[0] : exacts.find((r) => r.kind === 'Sample') || null;
    return { q, results: results.filter((r) => !r.error), errors: results.filter((r) => r.error), exact };
  });
};
