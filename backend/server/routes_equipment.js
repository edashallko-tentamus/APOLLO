// Equipment API (Phase 1, migration 009). Registered from routes.js. Thin like the rest: the rules (owners, tag-out,
// release by someone else, calibration changes by QA, schedules, transfer) live in the database; these handlers read,
// write, sign and pass the user, lab and Reason for Change through.
'use strict';
const { page, wantsPage } = require('./paging');

const EQ_FIELDS = ['equipment_name', 'equipment_type_id', 'department_id', 'manufacturer', 'model', 'serial_number', 'asset_tag', 'location_id',
  'location_note', 'calibration_required', 'calibration_interval_months', 'calibration_alert_days', 'qualification_required', 'in_service_date', 'notes'];
const MESSAGES = {
  equipment_serial_uq: 'Another piece of equipment already has that manufacturer and serial number.',
  equipment_type_name_uq: 'That equipment type is already on this lab\'s list (names are unique, ignoring capitals).',
  department_code_uq: 'That department code is already used in this lab.',
  department_name_uq: 'That department name is already used in this lab.',
  calibration_dates: 'The expiry date cannot be before the calibration date.',
  calibration_who: 'Say who did it: a person or the service company.',
  qualification_who: 'Say who did it: a person or the service company.',
  equipment_event_who: 'Say who did it: a person or the service company.',
  equipment_event_summary_check: 'Describe the work done.',
  maintenance_schedule_interval_count_check: 'The interval must be at least 1.',
  equipment_calibration_alert_days_check: 'Warning days cannot be negative.',
  equipment_calibration_interval_months_check: 'The calibration interval must be at least 1 month.',
};
function translate(e) {
  const m = String(e.message || e);
  for (const [k, v] of Object.entries(MESSAGES)) if (m.includes(`"${k}"`)) { const n = new Error(v); n.code = e.code; return n; }
  return e;
}
const DOC_TYPES = /^(application\/pdf|image\/(png|jpeg|gif|webp)|text\/plain|text\/csv|application\/vnd\.openxmlformats-officedocument\.(spreadsheetml\.sheet|wordprocessingml\.document))$/;

module.exports = function registerEquipment({ route, tx, signedTx, upsertRows, currentSite, checkSite, hasPermission, requirePermission, isUuid,
  AUDIT_SCOPES, AUDIT_LISTS, SITE_AUDIT_KINDS, AUDIT_CHECKS }) {
  const r = (method, pattern, fn) => route(method, pattern, async (c) => { try { return await fn(c); } catch (e) { throw translate(e); } });
  const sign = (c, meaning, action, fn, fallbackReason) => signedTx({ ...c, reason: c.body.reason || fallbackReason || '' }, { meaning, action, module: 'Equipment' }, fn);
  const eqOf = async (c, id) => {
    const e = await c.db.one('SELECT id, site_id, equipment_code, equipment_name FROM equipment WHERE id = $1', [id]);
    if (!e) throw new Error('Equipment not found');
    await checkSite(c, e.site_id);
    return e;
  };
  const label = (e) => `${e.equipment_code} ${e.equipment_name}`;
  const systemId = async (db) => (await db.one("SELECT id FROM app_user WHERE username = 'system'")).id;
  // Automatic tag-outs (expired calibration, maintenance due) are made by System before equipment lists are read
  const autoTag = async (db, site) => db.tx({ userId: await systemId(db), reason: 'Automatic tag-out' }, (t) => t.one('SELECT equipment_auto_tag($1) AS n', [site || null]));

  // ------------------------------------------------------------ what the screens let me do here
  r('GET', '/api/equipment/me', async (c) => {
    await currentSite(c);
    const out = {};
    for (const k of ['edit', 'tag', 'calibrate', 'release', 'lists']) out['can_' + k] = await hasPermission(c, 'equipment.' + k);
    return out;
  });

  // ------------------------------------------------------------ the lab's lists, and the choices the forms need
  r('GET', '/api/equipment/lists', async (c) => {
    const site = await currentSite(c);
    const [types, departments, groups, people, locations] = await Promise.all([
      c.db.rows(`SELECT t.*, (SELECT count(*) FROM equipment e WHERE e.equipment_type_id = t.id AND e.admin_status <> 'Retired') AS equipment_count
        FROM equipment_type t WHERE t.site_id = $1 ORDER BY t.status, lower(t.type_name)`, [site]),
      c.db.rows(`SELECT d.*, (SELECT count(*) FROM equipment e WHERE e.department_id = d.id AND e.admin_status <> 'Retired') AS equipment_count
        FROM department d WHERE d.site_id = $1 ORDER BY d.status, d.department_code`, [site]),
      c.db.rows("SELECT id, group_name, description FROM lab_group WHERE site_id = $1 AND status = 'Active' ORDER BY is_standard DESC, lower(group_name)", [site]),
      c.db.rows(`SELECT u.id, u.full_name, u.username FROM app_user u WHERE u.is_active AND u.username <> 'system' AND user_can_access_site(u.id, $1) ORDER BY u.full_name`, [site]),
      c.db.rows("SELECT id, location_code, location_path(id) AS path FROM storage_location WHERE site_id = $1 AND status = 'Active' ORDER BY location_path(id)", [site]),
    ]);
    return { types, departments, groups, people, locations };
  });
  r('POST', '/api/equipment/types/bulk', async (c) => {
    const site = await currentSite(c);
    return sign(c, 'Changed by', `Equipment types list: ${(c.body.rows || []).length} change(s)`, (t) => upsertRows(t, 'equipment_type', c.body.rows || [], ['type_name', 'description', 'status'], { site_id: site }));
  });
  r('POST', '/api/equipment/departments/bulk', async (c) => {
    const site = await currentSite(c);
    return sign(c, 'Changed by', `Departments list: ${(c.body.rows || []).length} change(s)`, (t) => upsertRows(t, 'department', c.body.rows || [], ['department_code', 'department_name', 'status'], { site_id: site }));
  });

  // ------------------------------------------------------------ the register and the due list
  r('GET', '/api/equipment', async (c) => {
    const site = await currentSite(c);
    await autoTag(c.db, site);
    const sql = `SELECT e.*, is_equipment_owner($2, e.id) AS mine FROM equipment_view e WHERE e.site_id = $1`;
    if (!wantsPage(c)) return c.db.rows(sql + ` ORDER BY e.admin_status = 'Retired', lower(e.type_name), lower(e.equipment_name)`, [site, c.userId]);
    // one page at a time (0.35.0), newest first
    return page(c, { sql, params: [site, c.userId],
      filters: { active: `admin_status::text <> 'Retired'`, tagged: `availability = 'Tagged out'`,
        caldue: `admin_status::text = 'In Service' AND calibration_status IN ('Alert','Deficient')`, mine: `mine AND admin_status::text <> 'Retired'`,
        retired: `admin_status::text = 'Retired'` },
      search: ['equipment_code', 'equipment_name', 'type_name', 'manufacturer', 'model', 'serial_number', 'owners', 'department_code'],
      ids: ['equipment_code', 'serial_number'], order: 'ORDER BY created_at DESC, equipment_code DESC' });
  });
  r('GET', '/api/equipment/due', async (c) => {
    const site = await currentSite(c);
    await autoTag(c.db, site);
    return c.db.rows(`SELECT d.*, is_equipment_owner($2, d.equipment_id) AS mine FROM equipment_due_view d WHERE d.site_id = $1
      ORDER BY d.urgency = 'Due soon', d.due_date NULLS FIRST, d.equipment_code`, [site, c.userId]);
  });

  r('GET', '/api/equipment/transfer-options', async (c) => {
    const site = await currentSite(c);
    return c.db.rows(`SELECT s.id, s.site_code, s.site_name,
        (SELECT COALESCE(json_agg(json_build_object('id', g.id, 'group_name', g.group_name) ORDER BY g.is_standard DESC, g.group_name), '[]') FROM lab_group g
          WHERE g.site_id = s.id AND g.status = 'Active') AS groups,
        (SELECT COALESCE(json_agg(json_build_object('id', d.id, 'department_code', d.department_code, 'department_name', d.department_name) ORDER BY d.department_code), '[]')
          FROM department d WHERE d.site_id = s.id AND d.status = 'Active') AS departments
      FROM lab_site s WHERE s.status = 'Active' AND s.id <> $1 ORDER BY s.site_code`, [site]);
  });
  // ------------------------------------------------------------ one piece of equipment, with its whole history
  r('GET', '/api/equipment/:id', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Equipment not found');
    await eqOf(c, c.params.id);
    const id = c.params.id;
    const [eq, owners, calibrations, qualifications, schedules, tags, events, documents, transfers] = await Promise.all([
      c.db.one('SELECT * FROM equipment_view WHERE id = $1', [id]),
      c.db.rows(`SELECT o.id, o.group_id, o.user_id, g.group_name, u.full_name FROM equipment_owner o LEFT JOIN lab_group g ON g.id = o.group_id
        LEFT JOIN app_user u ON u.id = o.user_id WHERE o.equipment_id = $1 AND o.status = 'Active' ORDER BY o.user_id IS NOT NULL, COALESCE(g.group_name, u.full_name)`, [id]),
      c.db.rows(`SELECT k.*, COALESCE(u.full_name, k.performed_by_vendor) AS performed_by, cu.full_name AS recorded_by, t.tag_code,
          (SELECT json_agg(json_build_object('id', d.id, 'title', COALESCE(d.title, f.file_name))) FROM equipment_document d JOIN document_file f ON f.id = d.document_id
            WHERE d.calibration_id = k.id AND d.status = 'Active') AS docs
        FROM calibration k LEFT JOIN app_user u ON u.id = k.performed_by_user_id JOIN app_user cu ON cu.id = k.created_by LEFT JOIN equipment_tag t ON t.id = k.tag_id
        WHERE k.equipment_id = $1 ORDER BY k.status, k.performed_date DESC, k.created_at DESC`, [id]),
      c.db.rows(`SELECT q.*, COALESCE(u.full_name, q.performed_by_vendor) AS performed_by, cu.full_name AS recorded_by, t.tag_code
        FROM qualification q LEFT JOIN app_user u ON u.id = q.performed_by_user_id JOIN app_user cu ON cu.id = q.created_by LEFT JOIN equipment_tag t ON t.id = q.tag_id
        WHERE q.equipment_id = $1 ORDER BY q.status, q.performed_date DESC`, [id]),
      c.db.rows(`SELECT m.*, (m.next_due_date - site_today(e.site_id)) AS days_left FROM maintenance_schedule m JOIN equipment e ON e.id = m.equipment_id
        WHERE m.equipment_id = $1 ORDER BY m.status, m.next_due_date`, [id]),
      c.db.rows(`SELECT t.*, ou.full_name AS tagged_out_name, iu.full_name AS tagged_in_name, m.task_name,
          (SELECT count(*) FROM equipment_event v WHERE v.tag_id = t.id AND v.status = 'Active') + (SELECT count(*) FROM calibration v WHERE v.tag_id = t.id AND v.status = 'Active')
            + (SELECT count(*) FROM qualification v WHERE v.tag_id = t.id AND v.status = 'Active') AS work_count,
          (SELECT count(*) FROM calibration v WHERE v.tag_id = t.id AND v.status = 'Active' AND v.result = 'Pass') AS passing_calibrations,
          (SELECT count(*) FROM qualification v WHERE v.tag_id = t.id AND v.status = 'Active' AND v.result = 'Pass') AS passing_qualifications,
          ($2::uuid = ANY (COALESCE(tag_workers(t.id), '{}'))) AS i_worked_on_it
        FROM equipment_tag t JOIN app_user ou ON ou.id = t.tagged_out_by LEFT JOIN app_user iu ON iu.id = t.tagged_in_by LEFT JOIN maintenance_schedule m ON m.id = t.schedule_id
        WHERE t.equipment_id = $1 ORDER BY t.tagged_in_at IS NOT NULL, t.tagged_out_at DESC`, [id, c.userId]),
      c.db.rows(`SELECT v.*, COALESCE(u.full_name, v.performed_by_vendor) AS performed_by, cu.full_name AS recorded_by, t.tag_code, m.task_name
        FROM equipment_event v LEFT JOIN app_user u ON u.id = v.performed_by_user_id JOIN app_user cu ON cu.id = v.created_by
        LEFT JOIN equipment_tag t ON t.id = v.tag_id LEFT JOIN maintenance_schedule m ON m.id = v.schedule_id
        WHERE v.equipment_id = $1 ORDER BY v.performed_date DESC, v.created_at DESC`, [id]),
      c.db.rows(`SELECT d.id, d.doc_type, d.title, d.status, d.created_at, f.file_name, f.mime_type, f.size_bytes, f.sha256, u.full_name AS uploaded_by,
          k.calibration_code, q.qualification_code, v.event_code, t.tag_code
        FROM equipment_document d JOIN document_file f ON f.id = d.document_id JOIN app_user u ON u.id = d.created_by
        LEFT JOIN calibration k ON k.id = d.calibration_id LEFT JOIN qualification q ON q.id = d.qualification_id
        LEFT JOIN equipment_event v ON v.id = d.event_id LEFT JOIN equipment_tag t ON t.id = d.tag_id
        WHERE d.equipment_id = $1 ORDER BY d.status, d.created_at DESC`, [id]),
      c.db.rows(`SELECT x.*, fs.site_code AS from_code, ts.site_code AS to_code, u.full_name AS by_name FROM equipment_transfer x
        JOIN lab_site fs ON fs.id = x.from_site_id JOIN lab_site ts ON ts.id = x.to_site_id JOIN app_user u ON u.id = x.created_by
        WHERE x.equipment_id = $1 ORDER BY x.created_at DESC`, [id]),
    ]);
    return { eq, owners, calibrations, qualifications, schedules, tags, events, documents, transfers };
  });

  // Owners: the list sent back is the complete set (groups and people); others are removed (kept as history)
  async function syncOwners(t, id, owners) {
    if (!Array.isArray(owners)) return;
    const cur = await t.rows('SELECT * FROM equipment_owner WHERE equipment_id = $1', [id]);
    const key = (o) => (o.group_id ? 'g' + o.group_id : 'u' + o.user_id);
    const want = new Set(owners.filter((o) => o.group_id || o.user_id).map(key));
    for (const k of want) {
      const ex = cur.find((o) => key(o) === k);
      if (!ex) await t.query('INSERT INTO equipment_owner (equipment_id, group_id, user_id) VALUES ($1, $2, $3)', [id, k[0] === 'g' ? k.slice(1) : null, k[0] === 'u' ? k.slice(1) : null]);
      else if (ex.status !== 'Active') await t.query("UPDATE equipment_owner SET status = 'Active' WHERE id = $1", [ex.id]);
    }
    for (const ex of cur.filter((o) => o.status === 'Active' && !want.has(key(o)))) await t.query("UPDATE equipment_owner SET status = 'Inactive' WHERE id = $1", [ex.id]);
  }
  r('POST', '/api/equipment', async (c) => {
    const site = await currentSite(c);
    const row = c.body.row || {};
    return sign(c, 'Created by', `New equipment: ${row.equipment_name || ''}${row.serial_number ? ' (S/N ' + row.serial_number + ')' : ''}`, async (t) => {
      const [res] = await upsertRows(t, 'equipment', [{ ...row, id: undefined }], EQ_FIELDS, { site_id: site });
      await syncOwners(t, res.id, c.body.owners || []);
      return t.one('SELECT id, equipment_code FROM equipment WHERE id = $1', [res.id]);
    });
  });
  // Add many at once (paste from Excel, fill down): one owner group per row
  r('POST', '/api/equipment/many', async (c) => {
    const site = await currentSite(c);
    const rows = (c.body.rows || []).filter((x) => x.equipment_name);
    if (!rows.length) throw new Error('Nothing to add');
    return sign(c, 'Created by', `New equipment: ${rows.length} item(s)`, async (t) => {
      const out = [];
      for (const [i, row] of rows.entries()) {
        try {
          if (!row.owner_group_id) throw new Error('pick the group responsible for it');
          const [res] = await upsertRows(t, 'equipment', [{ ...row, id: undefined }], EQ_FIELDS, { site_id: site });
          await syncOwners(t, res.id, [{ group_id: row.owner_group_id }]);
          out.push(res);
        } catch (e) { const n = translate(e); n.message = `Row ${i + 1} (${row.equipment_name}): ${n.message}`; throw n; }
      }
      return { created: out.length };
    });
  });
  r('PUT', '/api/equipment/:id', async (c) => {
    const e = await eqOf(c, c.params.id);
    return sign(c, 'Changed by', `Changed ${label(e)}`, async (t) => {
      await upsertRows(t, 'equipment', [{ ...(c.body.row || {}), id: e.id }], EQ_FIELDS);
      await syncOwners(t, e.id, c.body.owners);
      return { id: e.id };
    });
  });
  r('POST', '/api/equipment/:id/status', async (c) => {
    const e = await eqOf(c, c.params.id);
    const to = c.body.admin_status;
    if (!['In Service', 'Out of Service', 'Retired'].includes(to)) throw new Error('Pick In Service, Out of Service or Retired');
    return sign(c, 'Changed by', `${label(e)}: ${to}`, (t) => t.query('UPDATE equipment SET admin_status = $2 WHERE id = $1', [e.id, to]));
  });

  // ------------------------------------------------------------ tag-out, the work, tag-in / release
  r('POST', '/api/equipment/:id/tag-out', async (c) => {
    const e = await eqOf(c, c.params.id);
    return sign(c, 'Tagged out by', `Tag out ${label(e)} for ${String(c.body.reason_code || '').toLowerCase()}`, (t) =>
      t.one('INSERT INTO equipment_tag (equipment_id, reason, description) VALUES ($1, $2, $3) RETURNING id, tag_code', [e.id, c.body.reason_code, c.body.description || null]));
  });
  const tagOf = async (c, tagId) => {
    const tg = await c.db.one('SELECT t.*, e.equipment_code, e.equipment_name, e.site_id FROM equipment_tag t JOIN equipment e ON e.id = t.equipment_id WHERE t.id = $1', [tagId]);
    if (!tg) throw new Error('Tag not found');
    await checkSite(c, tg.site_id);
    return tg;
  };
  const eventInsert = (t, eqId, v, tagId = null) => t.one(`INSERT INTO equipment_event (equipment_id, tag_id, schedule_id, event_type, performed_date, performed_by_user_id, performed_by_vendor, summary)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, event_code`,
  [eqId, tagId, v.schedule_id || null, v.event_type || 'Maintenance', v.performed_date || null, v.performed_by_vendor ? null : (v.performed_by_user_id || null), v.performed_by_vendor || null, v.summary]);
  // Maintenance log entry (with or without a tag); for scheduled work the schedule's next due date moves on
  r('POST', '/api/equipment/:id/events', async (c) => {
    const e = await eqOf(c, c.params.id);
    const v = c.body.row || {};
    if (v.tag_id) { const tg = await tagOf(c, v.tag_id); if (tg.equipment_id !== e.id) throw new Error('That tag belongs to other equipment'); }
    return sign(c, 'Performed by', `${v.event_type || 'Maintenance'} recorded for ${label(e)}`, (t) => eventInsert(t, e.id, v, v.tag_id || null));
  });
  r('POST', '/api/equipment/tags/:tagId/tag-in', async (c) => {
    const tg = await tagOf(c, c.params.tagId);
    const release = tg.reason !== 'Maintenance';
    return sign(c, release ? 'Released by' : 'Returned to service by', `${release ? 'Release to service' : 'Tag back in'}: ${tg.equipment_code} ${tg.equipment_name} (${tg.tag_code}, ${tg.reason})`, async (t) => {
      if (!release && c.body.summary) await eventInsert(t, tg.equipment_id, { event_type: 'Maintenance', summary: c.body.summary, schedule_id: tg.schedule_id, performed_date: c.body.performed_date }, tg.id);
      await t.query('UPDATE equipment_tag SET tagged_in_at = clock_timestamp() WHERE id = $1', [tg.id]);
      return { id: tg.id };
    });
  });

  // ------------------------------------------------------------ calibrations, qualifications, documents
  const addDoc = async (t, eqId, d, links = {}) => {
    if (!d || !d.content_base64) return null;
    if (!DOC_TYPES.test(d.mime_type || '')) throw new Error('Upload a PDF, an image (PNG or JPEG), a text or CSV file, or an Excel or Word file');
    const f = await t.one(`INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ($1, $2, 0, '', decode($3, 'base64')) RETURNING id`,
      [d.file_name || 'document', d.mime_type, d.content_base64]);
    return t.one(`INSERT INTO equipment_document (equipment_id, document_id, doc_type, title, calibration_id, qualification_id, event_id, tag_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [eqId, f.id, d.doc_type || 'Other', d.title || null, links.calibration_id || null, links.qualification_id || null, links.event_id || null, links.tag_id || null]);
  };
  r('POST', '/api/equipment/:id/calibrations', async (c) => {
    const e = await eqOf(c, c.params.id);
    const v = c.body.row || {};
    return sign(c, 'Recorded by', `Calibration of ${label(e)} on ${v.performed_date || ''}: ${v.result || ''}`, async (t) => {
      const k = await t.one(`INSERT INTO calibration (equipment_id, tag_id, performed_date, expiration_date, result, performed_by_user_id, performed_by_vendor, certificate_number, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, calibration_code, expiration_date`,
      [e.id, v.tag_id || null, v.performed_date || null, v.expiration_date || null, v.result || null, v.performed_by_vendor ? null : (v.performed_by_user_id || null), v.performed_by_vendor || null, v.certificate_number || null, v.notes || null]);
      await addDoc(t, e.id, c.body.file && { ...c.body.file, doc_type: 'Calibration certificate', title: c.body.file.title || `Certificate ${v.certificate_number || k.calibration_code}` }, { calibration_id: k.id, tag_id: v.tag_id });
      return k;
    });
  });
  // QA corrections: expiry, date, result, or withdraw (Inactive); notes and certificate number by the calibrator
  r('PUT', '/api/equipment/calibrations/:cid', async (c) => {
    const k = await c.db.one('SELECT equipment_id, calibration_code FROM calibration WHERE id = $1', [c.params.cid]);
    if (!k) throw new Error('Calibration not found');
    const e = await eqOf(c, k.equipment_id);
    return sign(c, 'Changed by', `Calibration ${k.calibration_code} of ${label(e)} changed`, (t) =>
      upsertRows(t, 'calibration', [{ ...(c.body.row || {}), id: c.params.cid }], ['expiration_date', 'performed_date', 'result', 'certificate_number', 'notes', 'status']));
  });
  r('POST', '/api/equipment/:id/qualifications', async (c) => {
    const e = await eqOf(c, c.params.id);
    const v = c.body.row || {};
    return sign(c, 'Recorded by', `${v.qualification_type || 'Qualification'} of ${label(e)} on ${v.performed_date || ''}: ${v.result || ''}`, async (t) => {
      const q = await t.one(`INSERT INTO qualification (equipment_id, tag_id, qualification_type, performed_date, result, performed_by_user_id, performed_by_vendor, protocol_reference, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, qualification_code`,
      [e.id, v.tag_id || null, v.qualification_type || null, v.performed_date || null, v.result || null, v.performed_by_vendor ? null : (v.performed_by_user_id || null), v.performed_by_vendor || null, v.protocol_reference || null, v.notes || null]);
      await addDoc(t, e.id, c.body.file && { ...c.body.file, doc_type: 'Qualification report', title: c.body.file.title || `${v.qualification_type} report ${v.protocol_reference || ''}`.trim() }, { qualification_id: q.id, tag_id: v.tag_id });
      return q;
    });
  });
  r('PUT', '/api/equipment/qualifications/:qid', async (c) => {
    const q = await c.db.one('SELECT equipment_id, qualification_code FROM qualification WHERE id = $1', [c.params.qid]);
    if (!q) throw new Error('Qualification not found');
    const e = await eqOf(c, q.equipment_id);
    return sign(c, 'Changed by', `Qualification ${q.qualification_code} of ${label(e)} changed`, (t) =>
      upsertRows(t, 'qualification', [{ ...(c.body.row || {}), id: c.params.qid }], ['performed_date', 'result', 'protocol_reference', 'notes', 'status']));
  });
  r('POST', '/api/equipment/:id/documents', async (c) => {
    const e = await eqOf(c, c.params.id);
    if (!c.body.file || !c.body.file.content_base64) throw new Error('Choose the file to upload');
    return sign(c, 'Uploaded by', `Document ${c.body.file.file_name || ''} for ${label(e)}`, (t) => addDoc(t, e.id, c.body.file, { tag_id: c.body.file.tag_id }));
  });
  r('POST', '/api/equipment/documents/bulk', async (c) => {
    const site = await currentSite(c);
    const rows = c.body.rows || [];
    for (const x of rows) { const d = await c.db.one('SELECT e.site_id FROM equipment_document d JOIN equipment e ON e.id = d.equipment_id WHERE d.id = $1', [x.id]); if (!d || d.site_id !== site) throw new Error('Document not found in this lab'); }
    return sign(c, 'Changed by', `Equipment documents: ${rows.length} change(s)`, (t) => upsertRows(t, 'equipment_document', rows.filter((x) => x.id), ['title', 'doc_type', 'status']));
  });
  r('GET', '/api/equipment/documents/:docId/file', async (c) => {
    const d = await c.db.one(`SELECT f.file_name, f.mime_type, encode(f.content, 'base64') AS b64, e.site_id FROM equipment_document d
      JOIN document_file f ON f.id = d.document_id JOIN equipment e ON e.id = d.equipment_id WHERE d.id = $1`, [c.params.docId]);
    if (!d) throw new Error('Document not found');
    if (c.query.s) c.siteId = c.query.s; // opened in a new tab: the lab comes in the link
    await checkSite(c, d.site_id);
    return { __raw: true, body: Buffer.from(d.b64, 'base64'), type: d.mime_type,
      headers: { 'Content-Disposition': `inline; filename="${String(d.file_name).replace(/[^\w.\- ]/g, '_')}"` } };
  });

  // ------------------------------------------------------------ maintenance schedules (grid on the equipment page)
  r('POST', '/api/equipment/:id/schedules', async (c) => {
    const e = await eqOf(c, c.params.id);
    const rows = c.body.rows || [];
    return sign(c, 'Changed by', `Maintenance schedules of ${label(e)}: ${rows.length} change(s)`, (t) =>
      upsertRows(t, 'maintenance_schedule', rows, ['task_name', 'interval_count', 'interval_unit', 'next_due_date', 'alert_days', 'tag_out_when_due', 'instructions', 'status'], { equipment_id: e.id }));
  });

  // ------------------------------------------------------------ transfer to another lab (history goes with it)
  r('POST', '/api/equipment/:id/transfer', async (c) => {
    const e = await eqOf(c, c.params.id);
    const to = await c.db.one('SELECT site_code FROM lab_site WHERE id = $1', [c.body.to_site_id]);
    if (!to) throw new Error('Pick the lab it is going to');
    return sign(c, 'Transferred by', `Transfer ${label(e)} to ${to.site_code}`, (t) =>
      t.one('SELECT transfer_equipment($1, $2, $3, $4, $5) AS id', [e.id, c.body.to_site_id, c.body.owner_group_id || null, c.body.department_id || null, c.body.notes || null]));
  });

  // ------------------------------------------------------------ audit trail behind each equipment page
  const PARTS = ['equipment_owner', 'maintenance_schedule', 'equipment_tag', 'equipment_event', 'calibration', 'qualification', 'equipment_document', 'equipment_transfer'];
  AUDIT_SCOPES.equipment = `SELECT 'equipment', $1::uuid ${PARTS.map((p) => `UNION ALL SELECT '${p}', id FROM ${p} WHERE equipment_id = $1`).join(' ')}`;
  AUDIT_CHECKS.equipment = (c, id) => eqOf(c, id);
  AUDIT_SCOPES.equipmentlist = `SELECT 'equipment', id FROM equipment WHERE site_id = $1
    ${PARTS.map((p) => `UNION ALL SELECT '${p}', x.id FROM ${p} x JOIN equipment e ON e.id = x.equipment_id WHERE e.site_id = $1`).join(' ')}`;
  AUDIT_SCOPES.equipmentlists = `SELECT 'equipment_type', id FROM equipment_type WHERE site_id = $1 UNION ALL SELECT 'department', id FROM department WHERE site_id = $1`;
  SITE_AUDIT_KINDS.push('equipmentlist', 'equipmentlists');
  void tx; void requirePermission; void AUDIT_LISTS;

  // Automatic tag-outs also run on their own every hour (and at start), so nothing waits for someone to open a page
  return { autoTag };
};
