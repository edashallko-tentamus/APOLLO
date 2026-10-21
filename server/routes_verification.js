// Workflow verification API (WD-6, migration 024): a draft test version's verification protocol (written by the
// server from the design: requirements, samples, inputs and expected results), QA's approval of it, the automated run,
// and QA's signature on the report. Every step is signed. The rules (who may do what, the design fingerprint, the gate
// on approving the version) live in the database; the protocol writer and the run are in verification.js.
'use strict';
const V = require('./verification');
const EV = require('./evidence');
const REPORT = require('./verification_report');

module.exports = function registerVerification({ route, signedTx, checkSite, hasPermission, isUuid, AUDIT_SCOPES, AUDIT_CHECKS }) {
  const r = route;
  const versionOf = async (c, id) => {
    if (!isUuid(id)) throw new Error('Test version not found');
    const v = await c.db.one(`SELECT v.id, v.version_no, v.status::text AS status, t.id AS test_id, t.test_code, t.test_name, t.site_id, s.site_code, s.require_workflow_verification
      FROM test_version v JOIN test t ON t.id = v.test_id LEFT JOIN lab_site s ON s.id = t.site_id WHERE v.id = $1`, [id]);
    if (!v) throw new Error('Test version not found');
    if (v.site_id) await checkSite(c, v.site_id);
    return v;
  };
  const verOf = async (c, id) => {
    if (!isUuid(id)) throw new Error('Verification not found');
    const w = await c.db.one(`SELECT w.*, v.version_no, v.status::text AS version_status, t.test_code, t.test_name, t.id AS test_id, s.site_code, s.site_name,
        test_version_config_hash(w.test_version_id) = w.config_hash AS current
      FROM workflow_verification w JOIN test_version v ON v.id = w.test_version_id JOIN test t ON t.id = v.test_id JOIN lab_site s ON s.id = w.site_id WHERE w.id = $1`, [id]);
    if (!w) throw new Error('Verification not found');
    await checkSite(c, w.site_id);
    return w;
  };
  const me = async (c) => ({ can_design: await hasPermission(c, 'methods.design'), can_verify: await hasPermission(c, 'methods.verify'), user_id: c.userId });
  const signed = (c, meaning, action, fn) => signedTx(c, { meaning, action, module: 'Methods' }, fn);

  // The verifications of a version, and whether the gate is open
  r('GET', '/api/verification/versions/:id', async (c) => {
    const v = await versionOf(c, c.params.id);
    const rows = await c.db.rows(`SELECT w.id, w.verification_code, w.status, w.outcome, w.created_at, w.report_signed_at, w.cancelled_reason,
        w.config_hash = test_version_config_hash(w.test_version_id) AS current, cu.full_name AS prepared_by_name,
        (SELECT count(*) FROM verification_check k WHERE k.verification_id = w.id)::int AS checks,
        (SELECT count(*) FROM verification_check k WHERE k.verification_id = w.id AND k.result = 'Pass')::int AS passed
      FROM workflow_verification w JOIN app_user cu ON cu.id = w.created_by WHERE w.test_version_id = $1 ORDER BY w.created_at DESC`, [v.id]);
    const gate = await c.db.one('SELECT version_verification($1) AS id', [v.id]);
    return { version: v, required: !!v.require_workflow_verification, passing: gate.id, rows, ...(await me(c)) };
  });

  // Write the protocol (signed "Prepared by"): requirements, samples, inputs and expected results from the design
  r('POST', '/api/verification/versions/:id/protocol', async (c) => {
    const v = await versionOf(c, c.params.id);
    const D = await V.loadDesign(c.db, v.id);
    const P = V.buildProtocol(D);
    return signed({ ...c, reason: c.body.reason || 'Workflow verification protocol written' }, 'Prepared by', `Workflow verification protocol: ${v.test_name} version ${v.version_no}`,
      async (t) => t.one('SELECT create_verification($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb) AS id',
        [v.id, D.hash, V.GENERATOR, JSON.stringify(P.plan), JSON.stringify(P.requirements), JSON.stringify(P.checks)]));
  });

  // The whole document: protocol, run, evidence and report
  const doc = async (c) => {
    const w = await verOf(c, c.params.id);
    const sig = async (id) => (id ? c.db.one(`SELECT full_name, meaning, action, method, signed_at FROM signature_event WHERE id = $1`, [id]) : null);
    const [requirements, checks, batches, samples, prepared, approved, executed, report, preparer, method] = [
      await c.db.rows('SELECT * FROM verification_requirement WHERE verification_id = $1 ORDER BY sort_order', [w.id]),
      await c.db.rows('SELECT * FROM verification_check WHERE verification_id = $1 ORDER BY sort_order', [w.id]),
      await c.db.rows(`SELECT id, batch_code, status::text AS status FROM test_batch WHERE verification_id = $1 ORDER BY batch_code`, [w.id]),
      w.lab_order_id ? await c.db.rows(`SELECT id, sample_code, client_sample_id FROM sample WHERE lab_order_id = $1 ORDER BY sample_code`, [w.lab_order_id]) : [],
      await sig(w.prepared_signature_id), await sig(w.protocol_signature_id), await sig(w.execution_signature_id), await sig(w.report_signature_id),
      await c.db.one('SELECT full_name FROM app_user WHERE id = $1', [w.created_by]),
      await c.db.one('SELECT m.method_name, m.sop_code FROM test_version v LEFT JOIN method m ON m.id = v.method_id WHERE v.id = $1', [w.test_version_id]),
    ];
    const order = w.lab_order_id ? await c.db.one('SELECT order_code, status::text AS status FROM lab_order WHERE id = $1', [w.lab_order_id]) : null;
    const evidence = await c.db.rows(`SELECT seq, title, page_ref, check_codes, sha256, width_px, height_px, captured_at FROM verification_evidence WHERE verification_id = $1 ORDER BY seq`, [w.id]);
    return { verification: { ...w, prepared_by_name: preparer && preparer.full_name, method_name: method && method.method_name, sop_code: method && method.sop_code },
      requirements, checks, batches, samples, order, evidence, signatures: { prepared, approved, executed, evidence: await sig(w.evidence_signature_id), report },
      capturing: !w.evidence_captured_at && !!(capturing.get(w.id) || {}).started, capture_error: w.evidence_captured_at ? null : (capturing.get(w.id) || {}).error || null, ...(await me(c)) };
  };
  r('GET', '/api/verification/:id', doc);

  // QA approves the protocol (signed "Approved by")
  r('POST', '/api/verification/:id/approve-protocol', async (c) => {
    const w = await verOf(c, c.params.id);
    return signed({ ...c, reason: 'Verification protocol approved' }, 'Approved by', `Verification protocol ${w.verification_code}: ${w.test_name} version ${w.version_no}`,
      async (t) => { await t.query('SELECT approve_verification_protocol($1)', [w.id]); return { ok: true }; });
  });

  // Execute (signed "Executed by"): the automated run, in one transaction; if the run itself breaks, nothing is kept
  r('POST', '/api/verification/:id/execute', async (c) => {
    const w = await verOf(c, c.params.id);
    const log = [];
    let res;
    try {
      res = await signed({ ...c, reason: 'Workflow verification executed' }, 'Executed by', `Verification ${w.verification_code}: automated run of ${w.test_name} version ${w.version_no}`,
        async (t) => {
          const out = await V.execute(t, w.id, log);
          const o = await t.one('SELECT finish_verification_run($1, $2::jsonb) AS outcome', [w.id, JSON.stringify(log)]);
          return { outcome: o.outcome, batches: out.batches, blocked: out.blocked };
        });
    } catch (e) {
      if (/signature|password|user ID|locked/i.test(e.message)) throw e;
      throw new Error(`The run stopped and nothing was kept (the protocol is still approved): ${e.message}`);
    }
    // The run is kept. The screenshots of its pages are taken now, in the background, under the executor's signature
    // just given (a minute or so; the page shows it and refreshes). If it fails, "Capture the evidence" tries again.
    capturing.set(w.id, { started: Date.now() });
    captureEvidence(c, w, false).then(() => capturing.delete(w.id), (e) => capturing.set(w.id, { error: e.message }));
    res.capturing = true;
    return res;
  });

  // Screenshots of every page the run's checks point to, recorded and signed "Evidence captured by"
  const capturing = new Map(); // verification id -> { started } while capturing, { error } if the last try failed
  const captureEvidence = async (c, w0, verify = true) => {
    const w = await verOf(c, w0.id); // after the run: its order and batches
    const captured = await EV.capture(c.db, { verification: w, userId: c.userId, siteId: c.siteId || w.site_id, port: Number(process.env.PORT || 3000) });
    const action = { meaning: 'Evidence captured by', action: `Verification ${w.verification_code}: screenshots of the run's pages`, module: 'Methods' };
    const store = async (t) => ({ pages: await EV.record(t, w.id, captured), missed: captured.missed });
    if (verify) return signedTx({ ...c, reason: 'Objective evidence captured' }, action, store);
    // the password was checked moments ago for the run itself, in the same request
    return c.db.tx({ userId: c.userId, reason: 'Objective evidence captured', siteId: c.siteId }, async (t) => {
      await t.one('SELECT sign_action($1, $2, $3, $4) AS id', [action.meaning, action.action, action.module, 'Objective evidence captured']);
      return store(t);
    });
  };
  r('POST', '/api/verification/:id/capture-evidence', async (c) => {
    const w = await verOf(c, c.params.id);
    if (w.status !== 'Executed') throw new Error('Evidence is captured after the run and before QA signs the report');
    if (w.evidence_captured_at) throw new Error('The evidence for this verification is already captured');
    if ((capturing.get(w.id) || {}).started) throw new Error('The evidence is being captured now: wait a moment');
    const { verifySignature } = require('./auth');
    await verifySignature(c); // check the password before spending a minute in the browser
    capturing.set(w.id, { started: Date.now() });
    try { const out = await captureEvidence(c, w); capturing.delete(w.id); return out; } catch (e) { capturing.set(w.id, { error: e.message }); throw e; }
  });

  // One screenshot (opened in a new tab: the lab comes in the link)
  r('GET', '/api/verification/:id/evidence/:seq', async (c) => {
    if (c.query.s) c.siteId = c.query.s;
    const w = await verOf(c, c.params.id);
    const d = await c.db.one(`SELECT e.seq, encode(f.content, 'base64') AS b64 FROM verification_evidence e JOIN document_file f ON f.id = e.document_id
      WHERE e.verification_id = $1 AND e.seq = $2`, [w.id, Number(c.params.seq) || 0]);
    if (!d) throw new Error('Screenshot not found');
    return { __raw: true, body: Buffer.from(d.b64, 'base64'), type: 'image/png',
      headers: { 'Content-Disposition': `inline; filename="${w.verification_code}-E${String(d.seq).padStart(2, '0')}.png"`, 'Cache-Control': 'private, max-age=31536000, immutable' } };
  });

  // The protocol and report as a Word document, made from the record when asked (nothing is stored)
  r('GET', '/api/verification/:id/report.docx', async (c) => {
    if (c.query.s) c.siteId = c.query.s;
    const d = await doc(c);
    const ev = await c.db.rows(`SELECT e.seq, e.title, e.page_ref, e.check_codes, e.sha256, e.width_px, e.height_px, e.captured_at, encode(f.content, 'base64') AS b64
      FROM verification_evidence e JOIN document_file f ON f.id = e.document_id WHERE e.verification_id = $1 ORDER BY e.seq`, [d.verification.id]);
    const body = REPORT.build(d, ev.map((x) => ({ ...x, png: Buffer.from(x.b64, 'base64') })));
    const v = d.verification;
    return { __raw: true, body, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      headers: { 'Content-Disposition': `attachment; filename="${v.verification_code} ${String(v.test_code).replace(/[^\w.\- ]/g, '_')} v${v.version_no}.docx"` } };
  });

  // QA signs the report (signed "Approved by"): a conclusion, and why each requirement not tested is acceptable
  r('POST', '/api/verification/:id/sign-report', async (c) => {
    const w = await verOf(c, c.params.id);
    const j = c.body.justifications && typeof c.body.justifications === 'object' ? c.body.justifications : {};
    return signed({ ...c, reason: 'Verification report signed' }, 'Approved by', `Verification report ${w.verification_code}: ${w.test_name} version ${w.version_no}`,
      async (t) => ({ outcome: (await t.one('SELECT sign_verification_report($1, $2, $3::jsonb) AS o', [w.id, c.body.conclusion || '', JSON.stringify(j)])).o }));
  });

  // Cancel a verification not signed off (signed, with the reason)
  r('POST', '/api/verification/:id/cancel', async (c) => {
    const w = await verOf(c, c.params.id);
    if (!String(c.body.reason || '').trim()) throw new Error('Say why the verification is cancelled');
    return signed(c, 'Cancelled by', `Verification ${w.verification_code}`, async (t) => { await t.query('SELECT cancel_verification($1)', [w.id]); return { ok: true }; });
  });

  AUDIT_SCOPES.verification = `SELECT 'workflow_verification', $1::uuid UNION ALL SELECT 'verification_requirement', id FROM verification_requirement WHERE verification_id = $1
    UNION ALL SELECT 'verification_check', id FROM verification_check WHERE verification_id = $1
    UNION ALL SELECT 'verification_evidence', id FROM verification_evidence WHERE verification_id = $1`;
  AUDIT_CHECKS.verification = async (c, id) => { await verOf(c, id); };
};
