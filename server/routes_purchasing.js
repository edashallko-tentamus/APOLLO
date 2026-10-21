// Purchasing API (Phase 1, migration 011). Registered from routes.js. Thin like the rest: the rules (approved suppliers
// only, never approving your own request, second approval above the lab's amount, one supplier per order, partial
// receipts and back-orders, equipment received into the register) live in the database.
'use strict';

const MESSAGES = {
  purchase_receipt_note: 'Describe the problem with the delivery (what was damaged, how warm it arrived, what was missing).',
  purchase_line_quantity_check: 'Enter a quantity above zero.',
  purchase_line_unit_price_check: 'The price cannot be negative.',
  purchase_line_description_check: 'Describe what is to be bought.',
  vendor_qualification_dates: 'The expiry cannot be before the approval date.',
  supplier_risk_class_uq: 'That risk class name is already used.',
  supplier_risk_class_requal_months_check: 'Re-qualify every 1 month or more.',
  purchasing_setting_second_approval_over_check: 'The amount cannot be negative.',
  purchase_line_item_url_check: 'The web link must be a full web address starting with http:// or https://.',
  purchase_receipt_actual_unit_price_check: 'The actual price cannot be negative.',
};
function translate(e) {
  const m = String(e.message || e);
  for (const [k, v] of Object.entries(MESSAGES)) if (m.includes(`"${k}"`)) { const n = new Error(v); n.code = e.code; return n; }
  return e;
}
const SLIP_TYPES = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/;
const LINE_FIELDS = ['description', 'supplier_id', 'catalog_number', 'quantity', 'unit', 'unit_price', 'needed_by', 'justification', 'item_url', 'scope_ids'];
const DOC_TYPES = /^(application\/pdf|image\/(png|jpeg|gif|webp)|text\/plain|application\/vnd\.openxmlformats-officedocument\.(spreadsheetml\.sheet|wordprocessingml\.document))$/;
const DOC_KINDS = ['Questionnaire', 'Certificate', 'Audit report', 'Quality agreement', 'Other'];
// a request's scopes (V-1, migration 050): only for services and other purchases, chosen by the requester
const cleanScopes = (row, isUuid) => {
  if (!row || !('scope_ids' in row)) return row;
  const ids = Array.isArray(row.scope_ids) ? row.scope_ids.filter(isUuid) : (isUuid(row.scope_ids) ? [row.scope_ids] : []);
  return { ...row, scope_ids: ids.length ? ids : undefined };
};

module.exports = function registerPurchasing({ route, tx, signedTx, upsertRows, currentSite, checkSite, hasPermission, isUuid, AUDIT_SCOPES, AUDIT_LISTS, SITE_AUDIT_KINDS, AUDIT_CHECKS }) {
  const r = (method, pattern, fn) => route(method, pattern, async (c) => { try { return await fn(c); } catch (e) { throw translate(e); } });
  const sign = (c, meaning, action, fn, fallbackReason) => signedTx({ ...c, reason: c.body.reason || fallbackReason || '' }, { meaning, action, module: 'Purchasing' }, fn);
  const lineOf = async (c, id) => {
    if (!isUuid(id)) throw new Error('Request not found');
    const l = await c.db.one('SELECT * FROM purchase_line_view WHERE id = $1', [id]);
    if (!l) throw new Error('Request not found');
    await checkSite(c, l.site_id);
    return l;
  };
  const codes = (rows) => rows.map((x) => x.line_code).join(', ');

  r('GET', '/api/purchasing/me', async (c) => {
    await currentSite(c);
    const out = {};
    for (const k of ['request', 'approve', 'approve_over', 'order', 'receive', 'suppliers', 'qualify', 'qualify_corporate']) out['can_' + k] = await hasPermission(c, 'purchasing.' + k);
    out.can_settings = await hasPermission(c, 'admin.lab');
    out.is_system_admin = !!(await c.db.one('SELECT is_admin FROM app_user WHERE id = $1', [c.userId]))?.is_admin;
    return out;
  });

  // ------------------------------------------------------------ the request queue
  r('GET', '/api/purchasing/lines', async (c) => {
    const site = await currentSite(c);
    const setting = await c.db.one('SELECT * FROM purchasing_setting WHERE site_id = $1', [site]);
    const rows = await c.db.rows(`SELECT v.*, (v.requested_by = $2) AS mine, pl.scope_ids, scope_names(pl.scope_ids) AS scope_text
      FROM purchase_line_view v JOIN purchase_line pl ON pl.id = v.id WHERE v.site_id = $1
      ORDER BY CASE v.status WHEN 'Awaiting second approval' THEN 0 WHEN 'Requested' THEN 1 WHEN 'Approved' THEN 2 WHEN 'Ordered' THEN 3 WHEN 'Partly received' THEN 4 ELSE 5 END, v.requested_at DESC`, [site, c.userId]);
    return { rows, setting };
  });
  r('GET', '/api/purchasing/lines/:id', async (c) => {
    const l = await lineOf(c, c.params.id);
    const receipts = await c.db.rows(`SELECT r.*, u.full_name AS received_by, il.lot_code, e.equipment_code, f.file_name AS slip_name
      FROM purchase_receipt r JOIN app_user u ON u.id = r.created_by LEFT JOIN inventory_lot il ON il.id = r.lot_id LEFT JOIN equipment e ON e.id = r.equipment_id
      LEFT JOIN document_file f ON f.id = r.packing_slip_id WHERE r.purchase_line_id = $1 ORDER BY r.received_at`, [l.id]);
    const lots = await c.db.rows(`SELECT id, lot_code, receipt_status, status, quantity_received, requested_quantity, unit, manufacturer_lot FROM inventory_lot
      WHERE purchase_line_id = $1 ORDER BY created_at`, [l.id]);
    const sc = await c.db.one('SELECT scope_ids, scope_names(scope_ids) AS scope_text FROM purchase_line WHERE id = $1', [l.id]);
    return { line: { ...l, scope_ids: sc.scope_ids, scope_text: sc.scope_ids ? sc.scope_text : '' }, receipts, lots };
  });
  r('POST', '/api/purchasing/lines', async (c) => {
    const site = await currentSite(c);
    const row = c.body.row || {};
    if (!['Equipment', 'Service', 'Other'].includes(row.line_type)) throw new Error('Pick what kind of purchase it is (equipment, a service, or other); request inventory items from the Inventory page');
    return sign(c, 'Requested by', `Purchase request: ${row.description || ''}`, async (t) => {
      const [x] = await upsertRows(t, 'purchase_line', [{ ...cleanScopes(row, isUuid), id: undefined }], ['line_type', ...LINE_FIELDS], { site_id: site });
      return t.one('SELECT id, line_code FROM purchase_line WHERE id = $1', [x.id]);
    });
  });
  r('PUT', '/api/purchasing/lines/:id', async (c) => {
    const l = await lineOf(c, c.params.id);
    const cancel = c.body.row && c.body.row.status === 'Cancelled';
    return sign(c, cancel ? 'Cancelled by' : 'Changed by', `${cancel ? 'Cancel' : 'Change'} request ${l.line_code} ${l.description}`, (t) =>
      upsertRows(t, 'purchase_line', [{ ...cleanScopes(c.body.row || {}, isUuid), id: l.id }], [...LINE_FIELDS, 'status']));
  });
  r('POST', '/api/purchasing/approve', async (c) => {
    await currentSite(c);
    const rows = await c.db.rows('SELECT id, line_code FROM purchase_line WHERE id = ANY($1::uuid[]) AND site_id = $2', [c.body.ids || [], c.siteId]);
    if (!rows.length) throw new Error('Tick the requests to approve');
    return sign(c, 'Approved by', `Approve ${rows.length} purchase request(s): ${codes(rows)}`, (t) => t.one('SELECT approve_purchase_lines($1::uuid[]) AS n', [rows.map((x) => x.id)]));
  });
  r('POST', '/api/purchasing/reject', async (c) => {
    await currentSite(c);
    const rows = await c.db.rows('SELECT id, line_code FROM purchase_line WHERE id = ANY($1::uuid[]) AND site_id = $2', [c.body.ids || [], c.siteId]);
    if (!rows.length) throw new Error('Tick the requests to reject');
    return sign(c, 'Rejected by', `Reject ${rows.length} purchase request(s): ${codes(rows)}`, (t) => t.one('SELECT reject_purchase_lines($1::uuid[], $2) AS n', [rows.map((x) => x.id), c.body.reason || '']));
  });

  // ------------------------------------------------------------ purchase orders
  r('POST', '/api/purchasing/orders', async (c) => {
    await currentSite(c);
    const rows = await c.db.rows('SELECT id, line_code FROM purchase_line WHERE id = ANY($1::uuid[]) AND site_id = $2', [c.body.line_ids || [], c.siteId]);
    if (!rows.length) throw new Error('Tick the approved requests to order');
    return sign(c, 'Ordered by', `Purchase order for ${codes(rows)}${c.body.external_po_number ? ' (PO ' + c.body.external_po_number + ')' : ''}`, async (t) => {
      const po = await t.one('SELECT create_purchase_order($1::uuid[], $2, $3, $4) AS id', [rows.map((x) => x.id), c.body.external_po_number || null, c.body.confirmation_number || null, c.body.notes || null]);
      return t.one('SELECT id, po_code FROM purchase_order WHERE id = $1', [po.id]);
    });
  });
  r('GET', '/api/purchasing/orders', async (c) => {
    const site = await currentSite(c);
    return c.db.rows(`SELECT o.*, s.supplier_name, u.full_name AS ordered_by,
        (SELECT count(*) FROM purchase_line l WHERE l.purchase_order_id = o.id) AS line_count,
        (SELECT sum(l.quantity * l.unit_price) FROM purchase_line l WHERE l.purchase_order_id = o.id) AS amount,
        (SELECT CASE WHEN bool_and(l.status IN ('Received','Cancelled')) THEN 'Received' WHEN bool_or(l.status IN ('Partly received','Received')) THEN 'Partly received' ELSE 'Open' END
           FROM purchase_line l WHERE l.purchase_order_id = o.id) AS receipt_state
      FROM purchase_order o JOIN supplier s ON s.id = o.supplier_id JOIN app_user u ON u.id = o.created_by WHERE o.site_id = $1 ORDER BY o.ordered_at DESC`, [site]);
  });
  r('GET', '/api/purchasing/orders/:id', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Order not found');
    const o = await c.db.one(`SELECT o.*, s.supplier_name, s.account_number, s.contact_name, s.email AS supplier_email, s.phone AS supplier_phone, s.address AS supplier_address,
        u.full_name AS ordered_by, ls.site_code, ls.site_name FROM purchase_order o JOIN supplier s ON s.id = o.supplier_id JOIN app_user u ON u.id = o.created_by
        JOIN lab_site ls ON ls.id = o.site_id WHERE o.id = $1`, [c.params.id]);
    if (!o) throw new Error('Order not found');
    await checkSite(c, o.site_id);
    return { order: o, lines: await c.db.rows('SELECT * FROM purchase_line_view WHERE purchase_order_id = $1 ORDER BY line_code', [o.id]) };
  });
  r('PUT', '/api/purchasing/orders/:id', async (c) => {
    const o = await c.db.one('SELECT id, po_code, site_id FROM purchase_order WHERE id = $1', [c.params.id]);
    if (!o) throw new Error('Order not found');
    await checkSite(c, o.site_id);
    return sign(c, 'Changed by', `Purchase order ${o.po_code} changed`, (t) => upsertRows(t, 'purchase_order', [{ ...(c.body.row || {}), id: o.id }], ['external_po_number', 'confirmation_number', 'notes']));
  });

  // ------------------------------------------------------------ receiving
  r('POST', '/api/purchasing/lines/:id/receive', async (c) => {
    const l = await lineOf(c, c.params.id);
    const b = c.body;
    if (b.slip && b.slip.content_base64 && !SLIP_TYPES.test(b.slip.mime_type || '')) throw new Error('Upload the packing slip as a PDF or an image (PNG or JPEG)');
    return sign(c, 'Received by', `Received ${b.quantity ?? ''} ${l.unit || ''} on ${l.line_code} ${l.description}${b.discrepancy && b.discrepancy !== 'None' ? ' (' + b.discrepancy + ')' : ''}`, async (t) => {
      let slip = null;
      if (b.slip && b.slip.content_base64) {
        slip = (await t.one(`INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ($1, $2, 0, '', decode($3, 'base64')) RETURNING id`,
          [b.slip.file_name || 'packing-slip', b.slip.mime_type, b.slip.content_base64])).id;
      }
      // actual_price: what was really paid per unit (optional); inventory: put an Other or Service purchase into inventory now (migration 023)
      const rc = await t.one(`SELECT receive_purchase_line($1, $2, $3, $4::receipt_discrepancy, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13::jsonb) AS id`,
        [l.id, b.quantity === '' || b.quantity === undefined ? null : Number(b.quantity), !!b.more_to_come, b.discrepancy || 'None', b.note || null, slip,
          b.manufacturer_lot || null, b.expiration_date || null, b.retest_date || null, b.storage_location_id || null, b.equipment ? JSON.stringify(b.equipment) : null,
          b.actual_price === '' || b.actual_price === undefined || b.actual_price === null ? null : Number(b.actual_price), b.inventory ? JSON.stringify(b.inventory) : null]);
      return t.one('SELECT r.id, r.receipt_code, r.lot_id, l.lot_code FROM purchase_receipt r LEFT JOIN inventory_lot l ON l.id = r.lot_id WHERE r.id = $1', [rc.id]);
    });
  });
  r('GET', '/api/purchasing/receipts/:id/slip', async (c) => {
    const d = await c.db.one(`SELECT f.file_name, f.mime_type, encode(f.content, 'base64') AS b64, l.site_id FROM purchase_receipt r
      JOIN document_file f ON f.id = r.packing_slip_id JOIN purchase_line l ON l.id = r.purchase_line_id WHERE r.id = $1`, [c.params.id]);
    if (!d) throw new Error('Packing slip not found');
    if (c.query.s) c.siteId = c.query.s;
    await checkSite(c, d.site_id);
    return { __raw: true, body: Buffer.from(d.b64, 'base64'), type: d.mime_type, headers: { 'Content-Disposition': `inline; filename="${String(d.file_name).replace(/[^\w.\- ]/g, '_')}"` } };
  });

  // ------------------------------------------------------------ suppliers, qualifications, risk classes
  r('GET', '/api/purchasing/suppliers', async (c) => {
    const site = await currentSite(c);
    return c.db.rows(`SELECT v.*, s.website, s.email, s.phone, s.account_number, s.contact_name,
        (SELECT count(*) FROM vendor_qualification q WHERE q.supplier_id = s.id) AS qualification_count,
        (SELECT count(*) FROM purchase_line l WHERE l.supplier_id = s.id AND l.site_id = $1) AS request_count
      FROM supplier_status_view v JOIN supplier s ON s.id = v.supplier_id WHERE v.site_id = $1 ORDER BY lower(v.supplier_name)`, [site]);
  });
  r('GET', '/api/purchasing/suppliers/:id', async (c) => {
    const site = await currentSite(c);
    if (!isUuid(c.params.id)) throw new Error('Supplier not found');
    const sup = await c.db.one(`SELECT s.*, v.approval_status, v.approved_until, v.lab_specific, v.risk_class, d.decided_at
      FROM supplier s JOIN supplier_status_view v ON v.supplier_id = s.id AND v.site_id = $2 CROSS JOIN LATERAL vendor_decision(s.id, $2, NULL) d WHERE s.id = $1`, [c.params.id, site]);
    if (!sup) throw new Error('Supplier not found');
    const [qualifications, lines, classes, documents, promotions, scopes, row] = await Promise.all([
      c.db.rows(`SELECT q.*, rc.class_name, ls.site_code, u.full_name AS recorded_by, se.full_name AS signed_by, se.meaning AS signature_meaning,
          CASE WHEN q.approval_status = 'Approved' THEN scope_names(q.scope_ids) END AS scope_text, pq.qualification_code AS promoted_from_code
        FROM vendor_qualification q JOIN supplier_risk_class rc ON rc.id = q.risk_class_id LEFT JOIN lab_site ls ON ls.id = q.site_id JOIN app_user u ON u.id = q.created_by
        LEFT JOIN signature_event se ON se.id = q.signature_id LEFT JOIN vendor_qualification pq ON pq.id = q.promoted_from_id
        WHERE q.supplier_id = $1 AND (q.site_id IS NULL OR q.site_id = $2)
        ORDER BY q.approval_date DESC, q.created_at DESC`, [sup.id, site]),
      c.db.rows(`SELECT v.*, scope_names(pl.scope_ids) AS scope_text FROM purchase_line_view v JOIN purchase_line pl ON pl.id = v.id
        WHERE v.supplier_id = $1 AND v.site_id = $2 ORDER BY v.requested_at DESC LIMIT 200`, [sup.id, site]),
      c.db.rows("SELECT * FROM supplier_risk_class WHERE status = 'Active' AND (site_id IS NULL OR site_id = $1) ORDER BY site_id NULLS FIRST, sort_order, class_name", [site]),
      c.db.rows(`SELECT d.id, d.qualification_id, d.promotion_id, d.doc_kind, d.title, d.certificate_expires, d.status, d.created_at, f.file_name, u.full_name AS added_by
        FROM vendor_document d JOIN document_file f ON f.id = d.document_id JOIN app_user u ON u.id = d.created_by
        LEFT JOIN vendor_qualification q ON q.id = d.qualification_id LEFT JOIN vendor_promotion p ON p.id = d.promotion_id
        WHERE COALESCE(q.supplier_id, p.supplier_id) = $1 AND (q.id IS NULL OR q.site_id IS NULL OR q.site_id = $2) ORDER BY d.created_at DESC`, [sup.id, site]),
      c.db.rows('SELECT * FROM vendor_promotion_view WHERE supplier_id = $1 ORDER BY created_at DESC', [sup.id]),
      c.db.rows("SELECT id, scope_name, description, line_types::text[] AS line_types, chemical_types::text[] AS chemical_types FROM supply_scope WHERE status = 'Active' ORDER BY sort_order, scope_name"),
      c.db.one('SELECT * FROM vendor_approval_view WHERE supplier_id = $1 AND site_id = $2', [sup.id, site]),
    ]);
    return { supplier: sup, qualifications, lines, classes, documents, promotions, scopes, row };
  });
  // a vendor's evidence: files with their kind, title and certificate expiry
  const addDocs = async (t, docs, owner) => {
    for (const d of docs || []) {
      if (!d || !d.content_base64) continue;
      if (!DOC_TYPES.test(d.mime_type || '')) throw new Error('Attach a PDF, an image (PNG or JPEG), a text file, or an Excel or Word file');
      if (!DOC_KINDS.includes(d.doc_kind)) throw new Error('Say what each document is (questionnaire, certificate, audit report, quality agreement or other)');
      const f = await t.one(`INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ($1, $2, 0, '', decode($3, 'base64')) RETURNING id`,
        [d.file_name || 'document', d.mime_type, d.content_base64]);
      await t.query(`INSERT INTO vendor_document (qualification_id, promotion_id, document_id, doc_kind, title, certificate_expires) VALUES ($1, $2, $3, $4, $5, $6)`,
        [owner.qualification_id || null, owner.promotion_id || null, f.id, d.doc_kind, d.title || null, d.certificate_expires || null]);
    }
  };
  r('POST', '/api/purchasing/suppliers/:id/qualifications', async (c) => {
    const site = await currentSite(c);
    const s = await c.db.one('SELECT id, supplier_name FROM supplier WHERE id = $1', [c.params.id]);
    if (!s) throw new Error('Supplier not found');
    const v = c.body.row || {};
    const corporate = v.level === 'corporate';
    const scopes = v.all_scopes ? null : (Array.isArray(v.scope_ids) ? v.scope_ids.filter(isUuid) : []);
    if (v.approval_status === 'Approved' && scopes && !scopes.length) throw new Error('Tick what the vendor is approved for, or "Every scope"');
    const meaning = { Approved: 'Approved by', Suspended: 'Suspended by', 'Not Approved': 'Rejected by' }[v.approval_status] || 'Approved by';
    return sign(c, meaning, `Vendor approval of ${s.supplier_name}: ${v.approval_status || ''} (${corporate ? 'corporate, every lab' : 'this lab'})`, async (t) => {
      const q = await t.one(`INSERT INTO vendor_qualification (supplier_id, site_id, risk_class_id, approval_status, accreditations, approval_date, expiration_date, justification, scope_ids)
        VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, site_today($7)), $8, $9, $10::uuid[]) RETURNING id, qualification_code, expiration_date`,
      [s.id, corporate ? null : site, v.risk_class_id || null, v.approval_status || null, v.accreditations || null, v.approval_date || null, site, v.expiration_date || null, v.justification || null,
        v.approval_status === 'Approved' ? scopes : null]);
      await addDocs(t, c.body.documents, { qualification_id: q.id });
      return q;
    });
  });
  r('POST', '/api/purchasing/qualifications/:id/withdraw', async (c) => {
    const q = await c.db.one('SELECT q.id, q.qualification_code, q.site_id, s.supplier_name FROM vendor_qualification q JOIN supplier s ON s.id = q.supplier_id WHERE q.id = $1', [c.params.id]);
    if (!q) throw new Error('Qualification not found');
    if (q.site_id) await checkSite(c, q.site_id); else await currentSite(c);
    return sign(c, 'Withdrawn by', `Withdraw qualification ${q.qualification_code} of ${q.supplier_name}`, (t) => t.query("UPDATE vendor_qualification SET status = 'Inactive' WHERE id = $1", [q.id]));
  });
  // documents added later to an approval (or to an open proposal)
  r('POST', '/api/purchasing/qualifications/:id/documents', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Approval not found');
    const q = await c.db.one('SELECT id, site_id, qualification_code FROM vendor_qualification WHERE id = $1', [c.params.id]);
    if (!q) throw new Error('Approval not found');
    if (q.site_id) await checkSite(c, q.site_id); else await currentSite(c);
    if (!(c.body.documents || []).length) throw new Error('Choose a file to attach');
    return tx({ ...c, reason: c.body.reason || `Document attached to ${q.qualification_code}` }, (t) => addDocs(t, c.body.documents, { qualification_id: q.id }).then(() => ({ ok: true })));
  });
  r('POST', '/api/purchasing/documents/:id/withdraw', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Document not found');
    const d = await c.db.one(`SELECT d.id, COALESCE(q.site_id, p.site_id) AS site_id FROM vendor_document d LEFT JOIN vendor_qualification q ON q.id = d.qualification_id
      LEFT JOIN vendor_promotion p ON p.id = d.promotion_id WHERE d.id = $1`, [c.params.id]);
    if (!d) throw new Error('Document not found');
    if (d.site_id) await checkSite(c, d.site_id); else await currentSite(c);
    return tx({ ...c, reason: c.body.reason }, (t) => t.query("UPDATE vendor_document SET status = 'Inactive' WHERE id = $1", [d.id]).then(() => ({ ok: true })));
  });
  r('GET', '/api/purchasing/documents/:id/file', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Document not found');
    const d = await c.db.one(`SELECT f.file_name, f.mime_type, encode(f.content, 'base64') AS b64, COALESCE(q.site_id, p.site_id) AS site_id
      FROM vendor_document d JOIN document_file f ON f.id = d.document_id LEFT JOIN vendor_qualification q ON q.id = d.qualification_id
      LEFT JOIN vendor_promotion p ON p.id = d.promotion_id WHERE d.id = $1`, [c.params.id]);
    if (!d) throw new Error('Document not found');
    if (c.query.s) c.siteId = c.query.s;   // opened in a new tab: the lab comes in the link
    if (d.site_id) await checkSite(c, d.site_id); else await currentSite(c);
    return { __raw: true, body: Buffer.from(d.b64, 'base64'), type: d.mime_type,
      headers: { 'Content-Disposition': `inline; filename="${String(d.file_name).replace(/[^\w.\- ]/g, '_')}"` } };
  });

  // ------------------------------------------------------------ corporate approval: proposals, decisions, notices
  r('POST', '/api/purchasing/qualifications/:id/propose', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Approval not found');
    const q = await c.db.one('SELECT q.id, q.site_id, q.qualification_code, s.supplier_name FROM vendor_qualification q JOIN supplier s ON s.id = q.supplier_id WHERE q.id = $1', [c.params.id]);
    if (!q || !q.site_id) throw new Error('Propose one of this lab\'s approvals');
    await checkSite(c, q.site_id);
    const b = c.body || {};
    const scopes = Array.isArray(b.scope_ids) && b.scope_ids.filter(isUuid).length ? b.scope_ids.filter(isUuid) : null;
    return sign(c, 'Proposed by', `Propose ${q.supplier_name} (${q.qualification_code}) for corporate approval`, async (t) => {
      const p = await t.one('SELECT propose_vendor_promotion($1, $2, $3::uuid[], $4) AS id', [q.id, b.risk_class_id || null, scopes, b.note || null]);
      return t.one('SELECT id, promotion_code FROM vendor_promotion WHERE id = $1', [p.id]);
    });
  });
  r('POST', '/api/purchasing/promotions/:id/decide', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Proposal not found');
    const p = await c.db.one('SELECT p.id, p.promotion_code, s.supplier_name FROM vendor_promotion p JOIN supplier s ON s.id = p.supplier_id WHERE p.id = $1', [c.params.id]);
    if (!p) throw new Error('Proposal not found');
    await currentSite(c);
    const b = c.body || {};
    const approve = b.decision === 'Approved';
    const scopes = Array.isArray(b.scope_ids) && b.scope_ids.filter(isUuid).length ? b.scope_ids.filter(isUuid) : null;
    return sign(c, approve ? 'Approved by' : 'Rejected by', `${approve ? 'Approve' : 'Reject'} ${p.promotion_code}: ${p.supplier_name} for every lab`, (t) =>
      t.one('SELECT decide_vendor_promotion($1, $2, $3, $4, $5::uuid[]) AS id', [p.id, approve ? 'Approved' : 'Rejected', b.note || null, b.risk_class_id || null, scopes]));
  });
  r('POST', '/api/purchasing/promotions/:id/withdraw', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Proposal not found');
    const p = await c.db.one('SELECT id, site_id FROM vendor_promotion WHERE id = $1', [c.params.id]);
    if (!p) throw new Error('Proposal not found');
    await checkSite(c, p.site_id);
    return tx({ ...c, reason: (c.body || {}).reason }, (t) => t.query('SELECT withdraw_vendor_promotion($1)', [p.id]).then(() => ({ ok: true })));
  });
  r('POST', '/api/purchasing/notices/acknowledge', async (c) => {
    const site = await currentSite(c);
    const ids = ((c.body || {}).ids || []).filter(isUuid);
    if (!ids.length) throw new Error('Tick the notices you have read');
    return tx({ ...c, reason: 'Notice acknowledged' }, (t) => t.one('SELECT acknowledge_vendor_notices(ARRAY(SELECT id FROM vendor_notice WHERE id = ANY ($1::uuid[]) AND site_id = $2)) AS n', [ids, site]));
  });
  // the Vendor approvals page: every vendor at this lab, the proposals, the notices
  r('GET', '/api/purchasing/vendors', async (c) => {
    const site = await currentSite(c);
    const [rows, promotions, notices, scopes] = await Promise.all([
      c.db.rows('SELECT * FROM vendor_approval_view WHERE site_id = $1 ORDER BY lower(supplier_name)', [site]),
      c.db.rows(`SELECT * FROM vendor_promotion_view WHERE status = 'Proposed' OR (site_id = $1 AND decided_at > now() - interval '60 days') ORDER BY status <> 'Proposed', created_at DESC`, [site]),
      c.db.rows(`SELECT n.*, s.supplier_name, s.supplier_code, u.full_name AS acknowledged_by_name FROM vendor_notice n JOIN supplier s ON s.id = n.supplier_id
        LEFT JOIN app_user u ON u.id = n.acknowledged_by WHERE n.site_id = $1 AND (n.acknowledged_at IS NULL OR n.acknowledged_at > now() - interval '30 days') ORDER BY n.acknowledged_at IS NOT NULL, n.created_at DESC`, [site]),
      c.db.rows("SELECT id, scope_name FROM supply_scope WHERE status = 'Active' ORDER BY sort_order, scope_name"),
    ]);
    return { rows, promotions, notices, scopes };
  });
  // the supply scopes (kept by Corporate QA)
  r('GET', '/api/purchasing/scopes', async (c) => {
    await currentSite(c);
    return c.db.rows(`SELECT sc.id, sc.scope_name, sc.description, sc.chemical_types::text[] AS chemical_types, sc.line_types::text[] AS line_types, sc.default_for::text AS default_for,
        sc.sort_order, sc.status, (SELECT count(*) FROM vendor_qualification q WHERE sc.id = ANY (q.scope_ids))::int AS used FROM supply_scope sc ORDER BY sc.sort_order, sc.scope_name`);
  });
  r('POST', '/api/purchasing/scopes', async (c) => {
    await currentSite(c);
    const rows = (c.body.rows || []).map((x) => {
      const o = { ...x };
      for (const k of ['chemical_types', 'line_types']) if (k in o) o[k] = '{' + (Array.isArray(o[k]) ? o[k] : String(o[k] || '').split(',')).map((v) => String(v).trim()).filter(Boolean).map((v) => '"' + v.replace(/"/g, '') + '"').join(',') + '}';
      if ('default_for' in o && !o.default_for) o.default_for = null;
      return o;
    });
    return sign(c, 'Changed by', `Supply scopes: ${rows.length} change(s)`, (t) => upsertRows(t, 'supply_scope', rows, ['scope_name', 'description', 'chemical_types', 'line_types', 'default_for', 'sort_order', 'status']));
  });
  r('GET', '/api/purchasing/risk-classes', async (c) => {
    const site = await currentSite(c);
    return c.db.rows(`SELECT rc.*, ls.site_code, (SELECT count(*) FROM vendor_qualification q WHERE q.risk_class_id = rc.id) AS used
      FROM supplier_risk_class rc LEFT JOIN lab_site ls ON ls.id = rc.site_id WHERE rc.site_id IS NULL OR rc.site_id = $1 ORDER BY rc.site_id NULLS FIRST, rc.sort_order, rc.class_name`, [site]);
  });
  r('POST', '/api/purchasing/risk-classes', async (c) => {
    const site = await currentSite(c);
    const rows = c.body.rows || [];
    return sign(c, 'Changed by', `Supplier risk classes: ${rows.length} change(s)`, async (t) => {
      const out = [];
      for (const row of rows) {
        const shared = row.id ? (await t.one('SELECT site_id IS NULL AS s FROM supplier_risk_class WHERE id = $1', [row.id])).s : !!row.shared;
        out.push(...await upsertRows(t, 'supplier_risk_class', [row], ['class_name', 'requal_months', 'description', 'sort_order', 'status'], shared ? {} : { site_id: site }));
      }
      return out;
    });
  });
  r('GET', '/api/purchasing/settings', async (c) => c.db.one('SELECT * FROM purchasing_setting WHERE site_id = $1', [await currentSite(c)]));
  r('PUT', '/api/purchasing/settings', async (c) => {
    const site = await currentSite(c);
    const v = c.body.row || {};
    return sign(c, 'Changed by', `Purchasing settings: second approval over ${v.second_approval_over ?? 'no amount'}`, (t) =>
      t.query('UPDATE purchasing_setting SET second_approval_over = $2 WHERE site_id = $1', [site, v.second_approval_over === '' || v.second_approval_over === null || v.second_approval_over === undefined ? null : Number(v.second_approval_over)]));
  });

  // ------------------------------------------------------------ audit trail behind each page
  AUDIT_SCOPES.purchasing = `SELECT 'purchase_line', id FROM purchase_line WHERE site_id = $1 UNION ALL SELECT 'purchase_order', id FROM purchase_order WHERE site_id = $1
    UNION ALL SELECT 'purchase_receipt', r.id FROM purchase_receipt r JOIN purchase_line l ON l.id = r.purchase_line_id WHERE l.site_id = $1
    UNION ALL SELECT 'purchasing_setting', id FROM purchasing_setting WHERE site_id = $1`;
  AUDIT_SCOPES.purchaseline = `SELECT 'purchase_line', $1::uuid UNION ALL SELECT 'purchase_receipt', id FROM purchase_receipt WHERE purchase_line_id = $1
    UNION ALL SELECT 'inventory_lot', id FROM inventory_lot WHERE purchase_line_id = $1`;
  AUDIT_CHECKS.purchaseline = (c, id) => lineOf(c, id);
  AUDIT_SCOPES.purchaseorder = `SELECT 'purchase_order', $1::uuid UNION ALL SELECT 'purchase_line', id FROM purchase_line WHERE purchase_order_id = $1`;
  AUDIT_CHECKS.purchaseorder = async (c, id) => { const o = await c.db.one('SELECT site_id FROM purchase_order WHERE id = $1', [id]); if (!o) throw new Error('Order not found'); await checkSite(c, o.site_id); };
  AUDIT_SCOPES.supplier = `SELECT 'supplier', $1::uuid UNION ALL SELECT 'vendor_qualification', id FROM vendor_qualification WHERE supplier_id = $1
    UNION ALL SELECT 'vendor_promotion', id FROM vendor_promotion WHERE supplier_id = $1
    UNION ALL SELECT 'vendor_document', d.id FROM vendor_document d LEFT JOIN vendor_qualification q ON q.id = d.qualification_id LEFT JOIN vendor_promotion p ON p.id = d.promotion_id
      WHERE COALESCE(q.supplier_id, p.supplier_id) = $1`;
  AUDIT_SCOPES.vendors = `SELECT 'vendor_qualification', id FROM vendor_qualification WHERE site_id IS NULL OR site_id = $1
    UNION ALL SELECT 'vendor_promotion', id FROM vendor_promotion WHERE site_id = $1 OR status = 'Proposed'
    UNION ALL SELECT 'vendor_notice', id FROM vendor_notice WHERE site_id = $1 UNION ALL SELECT 'supply_scope', id FROM supply_scope`;
  AUDIT_SCOPES.riskclasses = `SELECT 'supplier_risk_class', id FROM supplier_risk_class WHERE site_id IS NULL OR site_id = $1`;
  SITE_AUDIT_KINDS.push('purchasing', 'riskclasses', 'vendors');
};
