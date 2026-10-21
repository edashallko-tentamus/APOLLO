// OOS investigations (R-2, migration 027): the list, one investigation, its signed steps (open, analyst, supervisor,
// conclusion with the report PDF, cancel, retests, the retest determination), the client's answers (a public link),
// and the OOS checklists (QA). The rules live in the database.
'use strict';
const { page, wantsPage } = require('./paging');
const OOS = require('./oos');
const { verifySignature } = require('./auth');

module.exports = function registerOos({ route, tx, signedTx, upsertRows, currentSite, checkSite, hasPermission, isUuid, AUDIT_SCOPES, AUDIT_LISTS, AUDIT_CHECKS }) {
  const r = route;
  const oosOf = async (c, id) => {
    if (!isUuid(id)) throw new Error('OOS investigation not found');
    const o = await c.db.one('SELECT id, site_id, oos_code, status FROM oos_investigation WHERE id = $1', [id]);
    if (!o) throw new Error('OOS investigation not found');
    await checkSite(c, o.site_id);
    return o;
  };
  const signed = (c, meaning, action, fn, reason) => signedTx({ ...c, reason: reason || c.body.reason || meaning }, { meaning, action, module: 'Testing' }, fn);
  const runChecks = async (c, id) => {
    const list = await OOS.checks(c.db, id);
    await c.db.tx({ userId: c.userId, reason: 'Automatic data checks run', siteId: c.siteId }, (t) => t.query('SELECT record_oos_checks($1, $2::jsonb)', [id, JSON.stringify(list)]));
    return list;
  };
  const LIST = `SELECT x.id, x.oos_code, x.status, x.procedure::text AS procedure, x.conclusion, x.reported, x.unit, x.spec_text, x.opened_at, x.due_date, x.is_gmp,
      x.client_notified_at, x.retest_determination, s.id AS sample_id, s.sample_code, s.client_sample_id, t.test_name, a.analyte_name, b.batch_code, b.id AS batch_id,
      COALESCE(c.display_name, c.legal_name) AS client_name, ou.full_name AS opened_by_name,
      (x.status NOT IN ('Closed','Cancelled') AND x.due_date < site_today(x.site_id)) AS overdue,
      (SELECT count(*) FROM oos_client_response cr WHERE cr.oos_id = x.id AND cr.handled_at IS NULL)::int AS responses_waiting
    FROM oos_investigation x JOIN sample s ON s.id = x.sample_id JOIN lab_order lo ON lo.id = s.lab_order_id JOIN client c ON c.id = lo.client_id
    JOIN requested_test rt ON rt.id = x.requested_test_id JOIN test t ON t.id = rt.test_id JOIN analyte a ON a.id = x.analyte_id
    LEFT JOIN test_batch b ON b.id = x.batch_id JOIN app_user ou ON ou.id = x.opened_by`;

  r('GET', '/api/oos', async (c) => {
    const site = await currentSite(c);
    const can_open = await hasPermission(c, 'oos.open');
    // one page at a time, newest first (0.35.0)
    if (wantsPage(c)) return { ...(await page(c, { sql: `${LIST} WHERE x.site_id = $1`, params: [site],
      filters: { open: `(status::text NOT IN ('Closed','Cancelled') OR responses_waiting > 0)`, overdue: 'overdue', closed: `status::text IN ('Closed','Cancelled')`, all: 'true' },
      search: ['oos_code', 'sample_code', 'client_sample_id', 'client_name', 'test_name', 'analyte_name', 'batch_code', 'conclusion'], ids: ['oos_code', 'sample_code', 'batch_code'],
      order: 'ORDER BY opened_at DESC' })), can_open };
    return { rows: await c.db.rows(`${LIST} WHERE x.site_id = $1 ORDER BY (x.status IN ('Closed','Cancelled')), x.opened_at DESC`, [site]), can_open };
  });
  // the OOS state of the results of a batch (QC Review) or a sample (sample page)
  r('GET', '/api/oos/for', async (c) => {
    const where = isUuid(c.query.batch) ? 'x.batch_id = $1' : isUuid(c.query.sample) ? 'x.sample_id = $1' : null;
    if (!where) return { rows: [] };
    const rows = await c.db.rows(`SELECT x.id, x.oos_code, x.status, x.conclusion, x.requested_test_id, x.analyte_id, x.site_id, x.client_notified_at, x.phase2_decision, x.phase2_note,
        x.phase2_at, pu.full_name AS phase2_by_name, a.analyte_name, t.test_name, x.reported, x.unit,
        (SELECT count(*) FROM oos_client_response cr WHERE cr.oos_id = x.id)::int AS responses
      FROM oos_investigation x JOIN analyte a ON a.id = x.analyte_id JOIN requested_test rt ON rt.id = x.requested_test_id JOIN test t ON t.id = rt.test_id
      LEFT JOIN app_user pu ON pu.id = x.phase2_by WHERE ${where} AND x.status <> 'Cancelled' ORDER BY x.opened_at`, [c.query.batch || c.query.sample]);
    if (rows[0]) await checkSite(c, rows[0].site_id);
    return { rows, can_open: await hasPermission(c, 'oos.open'),
      can_phase2: (await hasPermission(c, 'orders.edit')) || (await hasPermission(c, 'oos.open')) || (await hasPermission(c, 'reports.finalize')) };
  });
  // the client's Phase II decision recorded on the sample (migration 028): "no re-test" closes the loop, signed
  r('POST', '/api/oos/:id/phase2', async (c) => {
    const o = await oosOf(c, c.params.id);
    return signed(c, 'Recorded by', `${o.oos_code}: client's Phase II decision (no re-test)`, (t) => t.query('SELECT record_oos_phase2($1, $2, $3)', [o.id, 'No retest', c.body.note || '']),
      'Phase II decision: no re-test');
  });
  r('GET', '/api/oos/config', async (c) => ({
    items: await c.db.rows(`SELECT id, procedure::text AS procedure, section, item_text, sort_order, status::text AS status FROM oos_checklist_item ORDER BY procedure, section, sort_order`),
    settings: await c.db.rows(`SELECT id, procedure::text AS procedure, close_within_days FROM oos_procedure_setting ORDER BY procedure`),
    can_edit: await hasPermission(c, 'oos.configure') }));
  r('GET', '/api/oos/:id', async (c) => {
    const o = await oosOf(c, c.params.id);
    const d = await c.db.one(`${LIST.replace('SELECT x.id,', 'SELECT x.*, x.id,')} WHERE x.id = $1`, [o.id]);
    const names = await c.db.rows(`SELECT id, full_name FROM app_user WHERE id = ANY($1::uuid[])`, [[d.analyst_by, d.supervisor_by, d.concluded_by, d.determined_by, d.cancelled_by].filter(Boolean)]);
    const nm = (id) => (names.find((n) => n.id === id) || {}).full_name || null;
    const items = await c.db.rows(`SELECT id, section, item_text, sort_order FROM oos_checklist_item WHERE procedure = $1 AND status = 'Active' ORDER BY section, sort_order`, [d.procedure]);
    const responses = await c.db.rows(`SELECT cr.*, hu.full_name AS handled_by_name, rt.id AS retest_id FROM oos_client_response cr LEFT JOIN app_user hu ON hu.id = cr.handled_by
      LEFT JOIN requested_test rt ON rt.id = cr.retest_requested_test_id WHERE cr.oos_id = $1 ORDER BY cr.received_at`, [o.id]);
    const retests = await c.db.rows(`SELECT rt.id, rt.source::text AS source, rt.status::text AS status, rt.billing_status, rt.retest_replicates, rt.price, rt.due_date,
        (SELECT string_agg(tr.reported || COALESCE(' ' || tr.unit, '') || ' (' || tr.conformance || ')', ', ') FROM test_result tr WHERE tr.requested_test_id = rt.id AND tr.status = 'Active' AND tr.stage = 'Final' AND tr.result_key IS NULL) AS result
      FROM requested_test rt WHERE rt.oos_investigation_id = $1 ORDER BY rt.created_at`, [o.id]);
    const site = o.site_id;
    const perm = async (code) => hasPermission(c, code, site);
    return { oos: { ...d, analyst_name: nm(d.analyst_by), supervisor_name: nm(d.supervisor_by), concluded_name: nm(d.concluded_by), determined_name: nm(d.determined_by), cancelled_name: nm(d.cancelled_by) },
      items, responses, retests, me: c.userId,
      can: { open: await perm('oos.open'), perform: await perm('testing.perform'), review: await perm('testing.review'), approve: await perm('oos.approve'), order: await perm('orders.edit') } };
  });

  // open (signed "Opened by"), then the automatic checks
  r('POST', '/api/oos/open', async (c) => {
    const rt = await c.db.one('SELECT o.site_id FROM requested_test rt JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id WHERE rt.id = $1', [c.body.requested_test_id]);
    if (!rt) throw new Error('Test not found');
    await checkSite(c, rt.site_id);
    const out = await signed(c, 'Opened by', 'OOS investigation opened', (t) => t.one('SELECT open_oos($1, $2, $3, $4) AS id',
      [c.body.requested_test_id, c.body.analyte_id, isUuid(c.body.batch_id) ? c.body.batch_id : null, c.body.reason || null]), 'OOS investigation opened');
    await runChecks(c, out.id).catch(() => {});
    return out;
  });
  r('POST', '/api/oos/:id/checks', async (c) => { const o = await oosOf(c, c.params.id); return { checks: await runChecks(c, o.id) }; });
  r('POST', '/api/oos/:id/analyst', async (c) => {
    const o = await oosOf(c, c.params.id);
    return signed(c, 'Investigated by', `${o.oos_code}: analyst section`, (t) => t.query('SELECT sign_oos_analyst($1, $2::jsonb, $3, $4)',
      [o.id, JSON.stringify(c.body.answers || {}), c.body.comment || null, c.body.hypothesis || null]), 'OOS investigation: analyst section signed');
  });
  r('POST', '/api/oos/:id/supervisor', async (c) => {
    const o = await oosOf(c, c.params.id);
    return signed(c, 'Reviewed by', `${o.oos_code}: supervisor section`, (t) => t.query('SELECT sign_oos_supervisor($1, $2::jsonb, $3)',
      [o.id, JSON.stringify(c.body.answers || {}), c.body.comment || null]), 'OOS investigation: supervisor section signed');
  });
  // conclude: the password first, then the report PDF as it will stand, then the signed conclusion with it
  r('POST', '/api/oos/:id/conclude', async (c) => {
    const o = await oosOf(c, c.params.id);
    await verifySignature(c);
    const me = await c.db.one('SELECT full_name, clock_timestamp() AS now FROM app_user WHERE id = $1', [c.userId]);
    const pdf = await OOS.report(c.db, o.id, { conclusion: c.body.conclusion, cause: c.body.cause, comment: c.body.comment, answers: c.body.answers || {}, by: me.full_name, at: me.now });
    return c.db.tx({ userId: c.userId, reason: 'OOS investigation concluded', siteId: c.siteId }, async (t) => {
      await t.one('SELECT sign_action($1, $2, $3, $4) AS id', ['Approved by', `${o.oos_code}: conclusion (${c.body.conclusion || ''})`, 'Testing', null]);
      const d = await t.one(`INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ($1, 'application/pdf', $2, $3, decode($4, 'base64')) RETURNING id`,
        [`${o.oos_code} investigation report.pdf`, pdf.buf.length, pdf.sha256, pdf.buf.toString('base64')]);
      await t.query('SELECT conclude_oos($1, $2, $3, $4, $5::jsonb, $6, $7)', [o.id, c.body.conclusion || '', c.body.cause || null, c.body.comment || '', JSON.stringify(c.body.answers || {}), d.id, pdf.sha256]);
      return { ok: true };
    });
  });
  r('POST', '/api/oos/:id/cancel', async (c) => {
    const o = await oosOf(c, c.params.id);
    return signed(c, 'Cancelled by', `${o.oos_code} cancelled`, (t) => t.query('SELECT cancel_oos($1, $2)', [o.id, c.body.reason || '']), c.body.reason);
  });
  r('POST', '/api/oos/:id/retest', async (c) => {
    const o = await oosOf(c, c.params.id);
    return signed(c, 'Ordered by', `${o.oos_code}: ${c.body.kind === 'Client' ? 'client' : 'lab investigation'} retest`, (t) => t.one('SELECT order_oos_retest($1, $2, $3, $4) AS id',
      [o.id, c.body.kind, Number(c.body.replicates) || 1, isUuid(c.body.response_id) ? c.body.response_id : null]));
  });
  r('POST', '/api/oos/:id/determination', async (c) => {
    const o = await oosOf(c, c.params.id);
    return signed(c, 'Approved by', `${o.oos_code}: retest determination`, (t) => t.query('SELECT record_retest_determination($1, $2, $3)', [o.id, c.body.determination || '', c.body.reason || '']),
      'Retest determination recorded');
  });
  r('POST', '/api/oos/responses/:rid/handled', async (c) => {
    const x = await c.db.one('SELECT o.id FROM oos_client_response cr JOIN oos_investigation o ON o.id = cr.oos_id WHERE cr.id = $1', [c.params.rid]);
    if (!x) throw new Error('Response not found');
    await oosOf(c, x.id);
    return tx({ ...c, reason: 'Client response handled' }, (t) => t.query('SELECT handle_oos_response($1, $2)', [c.params.rid, c.body.note || null]));
  });
  r('GET', '/api/oos/:id/report.pdf', async (c) => {
    if (c.query.s) c.siteId = c.query.s;
    const o = await oosOf(c, c.params.id);
    const d = await c.db.one(`SELECT encode(f.content, 'base64') AS b64 FROM oos_investigation x JOIN document_file f ON f.id = x.report_document_id WHERE x.id = $1`, [o.id]);
    if (!d) throw new Error('The report is made when the investigation is concluded');
    return { __raw: true, body: Buffer.from(d.b64, 'base64'), type: 'application/pdf', headers: { 'Content-Disposition': `inline; filename="${o.oos_code} investigation report.pdf"` } };
  });

  // a document attached to an Outbox email (the Phase I report on the OOS email)
  r('GET', '/api/outbox/:id/document', async (c) => {
    if (c.query.s) c.siteId = c.query.s;
    if (!isUuid(c.params.id)) throw new Error('Email not found');
    const e = await c.db.one(`SELECT o.site_id, f.file_name, f.mime_type, encode(f.content, 'base64') AS b64 FROM email_outbox e JOIN lab_order o ON o.id = e.lab_order_id
      JOIN document_file f ON f.id = e.document_id WHERE e.id = $1`, [c.params.id]);
    if (!e) throw new Error('This email has no attachment');
    await checkSite(c, e.site_id);
    return { __raw: true, body: Buffer.from(e.b64, 'base64'), type: e.mime_type, headers: { 'Content-Disposition': `inline; filename="${String(e.file_name).replace(/"/g, '')}"` } };
  });

  // the client's answer (no sign-in): what the link shows, and the answer recorded as the system
  r('GET', '/api/public/oos/:token', async (c) => {
    const x = await c.db.one(`SELECT x.oos_code, s.client_sample_id, s.sample_code, t.test_name, a.analyte_name, x.reported, x.unit, x.spec_text, si.site_name,
        (x.client_notified_at > clock_timestamp() - interval '90 days') AS valid
      FROM oos_investigation x JOIN sample s ON s.id = x.sample_id JOIN requested_test rt ON rt.id = x.requested_test_id JOIN test t ON t.id = rt.test_id
      JOIN analyte a ON a.id = x.analyte_id JOIN lab_site si ON si.id = x.site_id WHERE x.client_token = $1`, [String(c.params.token || '').slice(0, 80)]);
    if (!x || !x.valid) return { found: false };
    const answers = await c.db.rows(`SELECT cr.choice, cr.received_at FROM oos_client_response cr JOIN oos_investigation x ON x.id = cr.oos_id WHERE x.client_token = $1 ORDER BY cr.received_at`, [c.params.token]);
    return { found: true, ...x, answers };
  });
  r('POST', '/api/public/oos/:token', async (c) => {
    const sys = await c.db.one(`SELECT id FROM app_user WHERE username = 'system'`);
    const code = await c.db.tx({ userId: sys.id, reason: 'Client response through the OOS link' }, (t) => t.one('SELECT record_oos_client_response($1, $2, $3, $4) AS code',
      [String(c.params.token || '').slice(0, 80), c.body.choice || '', String(c.body.note || '').slice(0, 2000), String(c.body.name || '').slice(0, 200)]));
    return { ok: true, oos_code: code.code };
  });

  // QA: the checklists and target times
  r('POST', '/api/oos/config/items', (c) => tx(c, (t) => upsertRows(t, 'oos_checklist_item', c.body.rows || [], ['procedure', 'section', 'item_text', 'sort_order', 'status'])));
  r('POST', '/api/oos/config/settings', (c) => tx(c, (t) => upsertRows(t, 'oos_procedure_setting', (c.body.rows || []).filter((x) => x.id), ['close_within_days'])));

  AUDIT_SCOPES.oos = `SELECT 'oos_investigation', $1::uuid UNION ALL SELECT 'oos_client_response', id FROM oos_client_response WHERE oos_id = $1
    UNION ALL SELECT 'requested_test', id FROM requested_test WHERE oos_investigation_id = $1`;
  AUDIT_CHECKS.oos = async (c, id) => { await oosOf(c, id); };
  AUDIT_LISTS.oos_list = ['oos_investigation', 'oos_client_response'];
  AUDIT_LISTS.oos_config = ['oos_checklist_item', 'oos_procedure_setting'];
};
