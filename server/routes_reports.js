// Result Finalization and the COA (R-1, migration 026): the queue of approved sample tests, the review of one COA at a
// time (the PDF, the sample's history beside it, the release check, notes), one signing act that issues each COA, the
// issued versions, the public verification check, sample attachments, email templates and compliance categories.
// The rules (who may finalize, GMP, holds, independence, the content matching the record) live in the database.
'use strict';
const crypto = require('crypto');
const COA = require('./coa');
const { verifySignature } = require('./auth');

module.exports = function registerReports({ route, tx, upsertRows, currentSite, checkSite, hasPermission, requirePermission, isUuid, AUDIT_SCOPES, AUDIT_LISTS, AUDIT_CHECKS }) {
  const r = route;
  const verifyBase = () => (process.env.LIMS_PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
  const sampleSite = async (c, id) => {
    if (!isUuid(id)) throw new Error('Sample not found');
    const s = await c.db.one('SELECT o.site_id FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = $1', [id]);
    if (!s) throw new Error('Sample not found');
    await checkSite(c, s.site_id);
    return s.site_id;
  };
  const uuids = (a) => (Array.isArray(a) ? a.filter(isUuid) : []);

  // ---------------------------------------------------------------- the queue
  // The queue, with who holds each test (migration 028 claims), its OOS (a link) and its urgency; the claims in progress;
  // the final COAs due after an OOS decision
  r('GET', '/api/reports/queue', async (c) => {
    const site = await currentSite(c);
    const rows = await c.db.rows(`SELECT q.*, ct.claim_id, fc.claim_code, fc.claimed_by, cu.full_name AS claimed_by_name, (fc.claimed_by = $2) AS mine,
        (SELECT x.id FROM oos_investigation x WHERE x.requested_test_id = q.requested_test_id AND x.status <> 'Cancelled' ORDER BY x.opened_at DESC LIMIT 1) AS oos_id,
        (q.due_date IS NOT NULL AND q.due_date <= site_today(q.site_id) + 1) AS due_soon, (q.due_date IS NOT NULL AND q.due_date < site_today(q.site_id)) AS overdue,
        (q.rush_status::text IN ('Auto-accepted','Approved')) AS rush
      FROM finalization_queue_view q LEFT JOIN finalization_claim_test ct ON ct.requested_test_id = q.requested_test_id AND ct.status = 'Active'
      LEFT JOIN finalization_claim fc ON fc.id = ct.claim_id LEFT JOIN app_user cu ON cu.id = fc.claimed_by
      WHERE q.site_id = $1 ORDER BY q.due_date NULLS LAST, q.approved_at`, [site, c.userId]);
    const claims = await c.db.rows(`SELECT fc.id, fc.claim_code, fc.claimed_by, u.full_name AS claimed_by_name, fc.note, fc.created_at, (fc.claimed_by = $2) AS mine,
        (SELECT count(*) FROM finalization_claim_test t WHERE t.claim_id = fc.id AND t.status = 'Active')::int AS open_tests,
        (SELECT count(*) FROM finalization_claim_test t WHERE t.claim_id = fc.id AND t.status = 'Done')::int AS done_tests,
        (SELECT string_agg(DISTINCT s.sample_code, ', ') FROM finalization_claim_test t JOIN requested_test rt ON rt.id = t.requested_test_id JOIN sample s ON s.id = rt.sample_id
          WHERE t.claim_id = fc.id AND t.status = 'Active') AS samples
      FROM finalization_claim fc JOIN app_user u ON u.id = fc.claimed_by WHERE fc.site_id = $1 AND fc.status = 'Active' ORDER BY fc.created_at`, [site, c.userId]);
    const finalDue = await c.db.rows('SELECT * FROM final_coa_due_view WHERE site_id = $1 ORDER BY last_issued_at', [site]);
    return { rows, claims, final_due: finalDue, user_id: c.userId, can_finalize: await hasPermission(c, 'reports.finalize'), can_gmp: await hasPermission(c, 'reports.finalize_gmp'),
      can_take_over: await hasPermission(c, 'admin.users') };
  });
  // claim sample tests (one batch, FB-...): nobody else finalizes them until they are finished or released. No signature.
  r('POST', '/api/reports/claim', async (c) => {
    await currentSite(c);
    const tests = uuids(c.body.tests);
    if (!tests.length) throw new Error('Choose the sample tests to claim');
    return tx({ ...c, reason: 'Finalization claimed' }, async (t) => {
      const x = await t.one('SELECT claim_finalization($1::uuid[], $2) AS id', [tests, c.body.note || null]);
      return t.one('SELECT id, claim_code FROM finalization_claim WHERE id = $1', [x.id]);
    });
  });
  r('POST', '/api/reports/claims/:id/release', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Claim not found');
    const cl = await c.db.one('SELECT site_id, claimed_by FROM finalization_claim WHERE id = $1', [c.params.id]);
    if (!cl) throw new Error('Claim not found');
    await checkSite(c, cl.site_id);
    const tests = uuids(c.body.tests);
    return tx({ ...c, reason: c.body.reason || 'Finalization released' }, (t) => t.one('SELECT release_finalization_claim($1, $2::uuid[]) AS n', [c.params.id, tests.length ? tests : null]));
  });
  // issued COAs (newest first): the archive of what was sent
  r('GET', '/api/reports/issued', async (c) => {
    const site = await currentSite(c);
    const days = Math.min(Math.max(Number(c.query.days) || 90, 1), 3650);
    return { rows: await c.db.rows(`SELECT v.id, v.version_no, v.is_final, v.issued_at, v.group_code, v.verify_code, u.full_name AS issued_by_name, s.id AS sample_id, s.sample_code,
        s.sample_code || '-R' || v.version_no AS report_id, s.client_sample_id, o.id AS lab_order_id, o.order_code, COALESCE(cl.display_name, cl.legal_name) AS client_name, cl.id AS client_id,
        (SELECT count(*) FROM email_outbox e WHERE e.coa_version_id = v.id)::int AS emails
      FROM coa_version v JOIN coa ON coa.id = v.coa_id JOIN sample s ON s.id = coa.sample_id JOIN lab_order o ON o.id = s.lab_order_id JOIN client cl ON cl.id = o.client_id
      JOIN app_user u ON u.id = v.issued_by WHERE coa.site_id = $1 AND v.issued_at > clock_timestamp() - make_interval(days => $2) ORDER BY v.issued_at DESC LIMIT 2000`, [site, days]) };
  });
  // the COAs of an order's samples (the order page)
  r('GET', '/api/orders/:id/coas', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Order not found');
    const o = await c.db.one('SELECT site_id FROM lab_order WHERE id = $1', [c.params.id]);
    if (!o) throw new Error('Order not found');
    await checkSite(c, o.site_id);
    return { rows: await c.db.rows(`SELECT v.id, v.version_no, v.is_final, v.issued_at, v.verify_code, u.full_name AS issued_by_name, s.id AS sample_id, s.sample_code, s.client_sample_id,
        s.sample_code || '-R' || v.version_no AS report_id,
        (v.version_no = (SELECT max(v2.version_no) FROM coa_version v2 WHERE v2.coa_id = v.coa_id)) AS latest
      FROM coa_version v JOIN coa ON coa.id = v.coa_id JOIN sample s ON s.id = coa.sample_id JOIN app_user u ON u.id = v.issued_by
      WHERE s.lab_order_id = $1 ORDER BY s.sample_code, v.version_no DESC`, [c.params.id]) };
  });

  // ---------------------------------------------------------------- one COA under review
  const previews = new Map(); // token -> { buf, at }
  const sweep = () => { const t = Date.now(); for (const [k, v] of previews) if (t - v.at > 30 * 60000) previews.delete(k); };
  async function sampleContext(c, sampleId) {
    const s = await c.db.one(`SELECT s.*, o.order_code, o.notes AS order_notes, o.po_number, o.submission_channel::text AS channel, o.id AS order_id,
        COALESCE(cl.display_name, cl.legal_name) AS client_name, cl.id AS client_id, cl.account_status::text AS account_status, cl.allow_partial_reports, cl.is_gmp_client,
        lu.full_name AS logged_by_name
      FROM sample s JOIN lab_order o ON o.id = s.lab_order_id JOIN client cl ON cl.id = o.client_id LEFT JOIN app_user lu ON lu.id = s.logged_by WHERE s.id = $1`, [sampleId]);
    const tests = await c.db.rows(`SELECT rt.id, t.test_name, rt.special_instructions, rt.status::text AS status, rt.due_date, test_is_finalized(rt.id) AS finalized,
        test_awaits_finalization(rt.id) AS awaits FROM requested_test rt JOIN test t ON t.id = rt.test_id WHERE rt.sample_id = $1 ORDER BY t.test_name`, [sampleId]);
    const attachments = await c.db.rows(`SELECT a.id, a.kind, a.label, a.sample_id, f.file_name, f.mime_type, a.created_at, u.full_name AS added_by
      FROM sample_attachment a JOIN document_file f ON f.id = a.document_id JOIN app_user u ON u.id = a.created_by
      WHERE a.lab_order_id = $1 AND (a.sample_id IS NULL OR a.sample_id = $2) AND a.status = 'Active' ORDER BY a.created_at`, [s.order_id, sampleId]);
    const notes = await c.db.rows(`SELECT n.id, n.kind, n.note_text, n.requested_test_id, n.analyte_id, COALESCE(an.report_name, an.analyte_name) AS analyte, t.test_name,
        u.full_name AS by_name, n.created_at FROM coa_note n JOIN app_user u ON u.id = n.created_by LEFT JOIN requested_test rt ON rt.id = n.requested_test_id
        LEFT JOIN test t ON t.id = rt.test_id LEFT JOIN analyte an ON an.id = n.analyte_id WHERE n.sample_id = $1 AND n.status = 'Active' ORDER BY n.created_at`, [sampleId]);
    const versions = await coaVersions(c, sampleId);
    const changes = await c.db.rows(`SELECT a.changed_at, a.changed_fields, a.reason, u.full_name FROM audit_log a JOIN app_user u ON u.id = a.changed_by
      WHERE a.table_name = 'sample' AND a.record_id = $1 AND a.action = 'UPDATE' AND NOT a.changed_fields ? 'logged_at' ORDER BY a.changed_at DESC LIMIT 20`, [sampleId]);
    const batches = await c.db.rows(`SELECT DISTINCT b.id, b.batch_code, b.status::text AS status, t.test_name FROM batch_entry e JOIN test_batch b ON b.id = e.batch_id
      JOIN requested_test rt ON rt.id = e.requested_test_id JOIN test t ON t.id = rt.test_id WHERE rt.sample_id = $1 ORDER BY b.batch_code`, [sampleId]);
    return { sample: s, tests, attachments, notes, versions, changes, batches };
  }
  async function coaVersions(c, sampleId) {
    return c.db.rows(`SELECT v.id, v.version_no, v.is_final, v.sha256, v.prev_sha256, v.verify_code, v.issued_at, v.group_code, u.full_name AS issued_by_name, c.coa_code,
        s.sample_code || '-R' || v.version_no AS report_id, v.release_checks, v.internal_note
      FROM coa_version v JOIN coa c ON c.id = v.coa_id JOIN sample s ON s.id = c.sample_id JOIN app_user u ON u.id = v.issued_by WHERE c.sample_id = $1 ORDER BY v.version_no DESC`, [sampleId]);
  }
  r('POST', '/api/reports/preview', async (c) => {
    const sampleId = c.body.sample_id; await sampleSite(c, sampleId);
    const tests = uuids(c.body.tests);
    const content = await COA.content(c.db, { sampleId, testIds: tests, userId: c.userId, verifyBase: verifyBase() });
    let made; let pdfError = null;
    try { made = await COA.pdf(content, { preview: true }); } catch (e) { pdfError = e.message; }
    const checks = await COA.checks(c.db, content, { userId: c.userId, readBack: made && made.readBack });
    if (pdfError) checks.unshift({ code: 'pdf', title: 'The PDF', level: 'Block', detail: pdfError });
    let token = null;
    if (made) { sweep(); token = crypto.randomBytes(16).toString('hex'); previews.set(token, { buf: made.buf, at: Date.now(), userId: c.userId }); }
    const canned = await c.db.rows(`SELECT id, reason_text FROM reason_code WHERE module = 'COA comments' AND status = 'Active' ORDER BY sort_order, reason_text`);
    return { content, checks, token, context: await sampleContext(c, sampleId), canned,
      can_notes: await hasPermission(c, 'reports.notes'), can_finalize: await hasPermission(c, 'reports.finalize'), can_gmp: await hasPermission(c, 'reports.finalize_gmp') };
  });
  r('GET', '/api/reports/preview/:token', async (c) => {
    const p = previews.get(c.params.token);
    if (!p || p.userId !== c.userId) throw new Error('This preview has expired: open the COA again');
    return { __raw: true, body: p.buf, type: 'application/pdf', headers: { 'Content-Disposition': 'inline; filename="COA preview.pdf"' } };
  });

  // ---------------------------------------------------------------- notes
  r('POST', '/api/reports/notes', async (c) => {
    await sampleSite(c, c.body.sample_id);
    let text = String(c.body.note_text || '').trim();
    if (c.body.reason_code_id && !text) text = (await c.db.one('SELECT reason_text FROM reason_code WHERE id = $1', [c.body.reason_code_id]) || {}).reason_text || '';
    return tx(c, (t) => t.one(`INSERT INTO coa_note (sample_id, requested_test_id, analyte_id, kind, note_text, reason_code_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [c.body.sample_id, isUuid(c.body.requested_test_id) ? c.body.requested_test_id : null, isUuid(c.body.analyte_id) ? c.body.analyte_id : null,
        c.body.kind === 'Internal' ? 'Internal' : 'COA', text, isUuid(c.body.reason_code_id) ? c.body.reason_code_id : null]));
  });
  r('POST', '/api/reports/notes/:id/remove', async (c) => {
    const n = await c.db.one('SELECT sample_id FROM coa_note WHERE id = $1', [c.params.id]);
    if (!n) throw new Error('Note not found');
    await sampleSite(c, n.sample_id);
    return tx({ ...c, reason: c.body.reason || 'Note removed' }, (t) => t.query(`UPDATE coa_note SET status = 'Inactive' WHERE id = $1`, [c.params.id]));
  });

  // ---------------------------------------------------------------- finalize a group (one signing act, one signature per COA)
  r('POST', '/api/reports/finalize', async (c) => {
    const items = Array.isArray(c.body.items) ? c.body.items : [];
    if (!items.length) throw new Error('Nothing to finalize');
    for (const it of items) await sampleSite(c, it.sample_id);
    await verifySignature(c); // the password once, before the PDFs are made
    const made = [];
    for (const it of items) {
      const content = await COA.content(c.db, { sampleId: it.sample_id, testIds: uuids(it.tests), userId: c.userId, verifyBase: verifyBase() });
      const pdf = await COA.pdf(content);
      const checks = await COA.checks(c.db, content, { userId: c.userId, readBack: pdf.readBack });
      const acks = it.acks && typeof it.acks === 'object' ? it.acks : {};
      for (const k of checks) if (k.level === 'Warning') k.ack = String(acks[k.code] || '').trim();
      made.push({ it, content, pdf, checks });
    }
    const reason = c.body.reason || 'Finalized for release';
    return c.db.tx({ userId: c.userId, reason, siteId: c.siteId }, async (t) => {
      const group = (await t.one('SELECT next_finalization_group() AS g')).g;
      const out = [];
      for (const m of made) {
        const { content, pdf, checks, it } = m;
        await t.one('SELECT sign_action($1, $2, $3, $4) AS id', ['Finalized by', `Report ${content.report_id} (version ${content.version_no}): ${content.sample.sample_code} (${group})`, 'Reports', reason]);
        const d = await t.one(`INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ($1, 'application/pdf', $2, $3, decode($4, 'base64')) RETURNING id`,
          [`${content.report_id}.pdf`, pdf.buf.length, pdf.sha256, pdf.buf.toString('base64')]);
        const v = await t.one('SELECT finalize_sample($1, $2::uuid[], $3::jsonb, $4, $5, $6::jsonb, $7, $8) AS id',
          [content.sample.id, uuids(it.tests), JSON.stringify(content), d.id, pdf.sha256, JSON.stringify(checks), group, it.internal_note || null]);
        out.push({ sample_id: content.sample.id, sample_code: content.sample.sample_code, coa_version_id: v.id, version_no: v.id ? content.version_no : null,
          coa_code: content.coa_code, report_id: content.report_id, is_final: content.is_final, held: !v.id });
      }
      return { group, issued: out };
    });
  });

  // ---------------------------------------------------------------- issued COAs
  r('GET', '/api/reports/samples/:id/coa', async (c) => {
    await sampleSite(c, c.params.id);
    const notes = await c.db.rows(`SELECT n.id, n.kind, n.note_text, COALESCE(an.report_name, an.analyte_name) AS analyte, t.test_name, u.full_name AS by_name, n.created_at
      FROM coa_note n JOIN app_user u ON u.id = n.created_by LEFT JOIN requested_test rt ON rt.id = n.requested_test_id LEFT JOIN test t ON t.id = rt.test_id
      LEFT JOIN analyte an ON an.id = n.analyte_id WHERE n.sample_id = $1 AND n.status = 'Active' ORDER BY n.created_at`, [c.params.id]);
    const attachments = await c.db.rows(`SELECT a.id, a.kind, a.label, a.sample_id, f.file_name, a.created_at, u.full_name AS added_by FROM sample_attachment a
      JOIN document_file f ON f.id = a.document_id JOIN app_user u ON u.id = a.created_by JOIN sample s ON s.lab_order_id = a.lab_order_id
      WHERE s.id = $1 AND (a.sample_id IS NULL OR a.sample_id = $1) AND a.status = 'Active' ORDER BY a.created_at`, [c.params.id]);
    return { versions: await coaVersions(c, c.params.id), notes, attachments, can_attach: (await hasPermission(c, 'orders.edit')) || (await hasPermission(c, 'reports.notes')) };
  });
  r('GET', '/api/reports/coa/:id/pdf', async (c) => {
    if (c.query.s) c.siteId = c.query.s;
    if (!isUuid(c.params.id)) throw new Error('COA not found');
    const v = await c.db.one(`SELECT v.version_no, c.coa_code, c.site_id, s.sample_code, encode(f.content, 'base64') AS b64 FROM coa_version v JOIN coa c ON c.id = v.coa_id
      JOIN sample s ON s.id = c.sample_id JOIN document_file f ON f.id = v.document_id WHERE v.id = $1`, [c.params.id]);
    if (!v) throw new Error('COA not found');
    await checkSite(c, v.site_id);
    return { __raw: true, body: Buffer.from(v.b64, 'base64'), type: 'application/pdf',
      headers: { 'Content-Disposition': `inline; filename="${String(v.sample_code).replace(/[^\w.\- ]/g, '_')}-R${v.version_no}.pdf"` } };
  });
  // anyone holding a COA (no sign-in): the issued version behind a verification code
  r('GET', '/api/public/coa/:code', async (c) => {
    const row = await c.db.one('SELECT * FROM coa_public_check($1)', [String(c.params.code || '').slice(0, 20)]);
    if (!row) return { found: false };
    return { found: true, ...row, superseded: row.latest_version > row.version_no };
  });

  // ---------------------------------------------------------------- sample attachments (submission form, chain of custody...)
  r('POST', '/api/samples/:id/attachments', async (c) => {
    await sampleSite(c, c.params.id);
    const b64 = String(c.body.b64 || '');
    if (!b64) throw new Error('Choose a file');
    const s = await c.db.one('SELECT lab_order_id FROM sample WHERE id = $1', [c.params.id]);
    return tx({ ...c, reason: c.body.reason || 'Attachment added' }, async (t) => {
      const buf = Buffer.from(b64, 'base64');
      const d = await t.one(`INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ($1, $2, $3, $4, decode($5, 'base64')) RETURNING id`,
        [String(c.body.file_name || 'attachment').slice(0, 200), c.body.mime_type || 'application/octet-stream', buf.length, crypto.createHash('sha256').update(buf).digest('hex'), b64]);
      return t.one('INSERT INTO sample_attachment (lab_order_id, sample_id, document_id, kind, label) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [s.lab_order_id, c.body.whole_order ? null : c.params.id, d.id, c.body.kind || 'Other', c.body.label || null]);
    });
  });
  r('GET', '/api/attachments/:id/file', async (c) => {
    if (c.query.s) c.siteId = c.query.s;
    if (!isUuid(c.params.id)) throw new Error('File not found');
    const d = await c.db.one(`SELECT f.file_name, f.mime_type, encode(f.content, 'base64') AS b64, o.site_id FROM sample_attachment a JOIN document_file f ON f.id = a.document_id
      JOIN lab_order o ON o.id = a.lab_order_id WHERE a.id = $1`, [c.params.id]);
    if (!d) throw new Error('File not found');
    await checkSite(c, d.site_id);
    return { __raw: true, body: Buffer.from(d.b64, 'base64'), type: d.mime_type, headers: { 'Content-Disposition': `inline; filename="${String(d.file_name).replace(/[^\w.\- ]/g, '_')}"` } };
  });

  // ---------------------------------------------------------------- email templates (Outbox) and compliance categories
  r('GET', '/api/outbox/templates', async (c) => ({ rows: await c.db.rows('SELECT * FROM email_template ORDER BY template_name'), can_edit: await hasPermission(c, 'outbox.templates') }));
  r('POST', '/api/outbox/templates', (c) => tx(c, (t) => upsertRows(t, 'email_template', (c.body.rows || []).filter((x) => x.id), ['template_name', 'subject', 'body', 'is_active'])));
  r('GET', '/api/compliance-categories', async (c) => ({ rows: await c.db.rows('SELECT * FROM compliance_category ORDER BY sort_order, category_name'), can_edit: await hasPermission(c, 'master.compliance') }));
  r('POST', '/api/compliance-categories', (c) => tx(c, (t) => upsertRows(t, 'compliance_category', c.body.rows || [], ['category_name', 'is_gmp', 'description', 'sort_order', 'status'])));

  AUDIT_CHECKS.sample_coa = (c, id) => sampleSite(c, id);
  AUDIT_SCOPES.sample_coa = `SELECT 'coa', c.id FROM coa c WHERE c.sample_id = $1 UNION ALL SELECT 'coa_version', v.id FROM coa_version v JOIN coa c ON c.id = v.coa_id WHERE c.sample_id = $1
    UNION ALL SELECT 'coa_note', n.id FROM coa_note n WHERE n.sample_id = $1
    UNION ALL SELECT 'result_finalization', f.id FROM result_finalization f JOIN requested_test rt ON rt.id = f.requested_test_id WHERE rt.sample_id = $1`;
  AUDIT_LISTS.finalization = ['result_finalization', 'coa_version', 'coa_note', 'finalization_claim', 'finalization_claim_test'];
  AUDIT_LISTS.templates = ['email_template'];
  AUDIT_LISTS.compliance = ['compliance_category'];
};
