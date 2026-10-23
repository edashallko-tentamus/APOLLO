// Training and competency (0.31.0, migration 053): qualifications, competency attempts (initial and continuing, by
// training samples or by record), the rules per department, legacy qualifications, the training report per person.
'use strict';
const crypto = require('crypto');
const COA = require('./coa');
const { esc, fmtDate } = COA;

module.exports = function registerTraining({ route, tx, signedTx, currentSite, checkSite, hasPermission, isUuid, AUDIT_SCOPES, AUDIT_LISTS, AUDIT_CHECKS }) {
  const can = async (c) => ({ view: await hasPermission(c, 'training.view'), record: await hasPermission(c, 'training.record'),
    approve: await hasPermission(c, 'training.approve'), configure: await hasPermission(c, 'training.configure') });
  const needView = async (c, userId) => { if (userId !== c.userId && !(await hasPermission(c, 'training.view'))) throw new Error('You may see your own training only (training.view shows everyone\'s)'); };
  const attemptOf = async (c, id) => {
    if (!isUuid(id)) throw new Error('Attempt not found');
    const a = await c.db.one('SELECT * FROM competency_attempt_view WHERE id = $1', [id]);
    if (!a) throw new Error('Attempt not found');
    await checkSite(c, a.site_id);
    return a;
  };
  const peopleAt = (db, site) => db.rows(`SELECT DISTINCT u.id, u.full_name, u.username FROM app_user u JOIN group_member gm ON gm.user_id = u.id JOIN lab_group g ON g.id = gm.group_id
    WHERE g.site_id = $1 AND g.status = 'Active' AND gm.status = 'Active' AND u.is_active AND NOT u.is_automated AND u.username <> 'system' ORDER BY u.full_name`, [site]);

  // the lab's overview: people, open attempts, rules
  route('GET', '/api/training', async (c) => {
    const site = await currentSite(c);
    const cn = await can(c);
    const lab = await c.db.one('SELECT id, site_code, require_training FROM lab_site WHERE id = $1', [site]);
    const people = cn.view ? await c.db.rows(`WITH p AS (SELECT DISTINCT u.id, u.full_name FROM app_user u JOIN group_member gm ON gm.user_id = u.id JOIN lab_group g ON g.id = gm.group_id
        WHERE g.site_id = $1 AND g.status = 'Active' AND gm.status = 'Active' AND u.is_active AND NOT u.is_automated AND u.username <> 'system')
      SELECT p.id, p.full_name,
        (SELECT count(*) FROM analyst_qualification_view q WHERE q.user_id = p.id AND q.site_id = $1 AND q.status = 'Active' AND q.state IN ('Current','Due soon'))::int AS current,
        (SELECT count(*) FROM analyst_qualification_view q WHERE q.user_id = p.id AND q.site_id = $1 AND q.status = 'Active' AND q.state = 'Due soon')::int AS due_soon,
        (SELECT count(*) FROM analyst_qualification_view q WHERE q.user_id = p.id AND q.site_id = $1 AND q.status = 'Active' AND q.state = 'Lapsed')::int AS lapsed,
        (SELECT count(*) FROM competency_attempt a WHERE a.user_id = p.id AND a.site_id = $1 AND a.status IN ('In progress','Evaluated'))::int AS open_attempts,
        (SELECT string_agg(d.department_name, ', ' ORDER BY d.department_name) FROM department d WHERE d.site_id = $1 AND d.status = 'Active' AND department_trained(p.id, $1, d.id)) AS departments_trained,
        (SELECT max(q.last_competency_at) FROM analyst_qualification q WHERE q.user_id = p.id AND q.site_id = $1 AND q.status = 'Active') AS last_competency
      FROM p ORDER BY p.full_name`, [site]) : [];
    const attempts = await c.db.rows(`SELECT * FROM competency_attempt_view WHERE site_id = $1 AND (status IN ('In progress','Evaluated') OR modified_at > now() - interval '60 days')
      ${cn.view ? '' : 'AND user_id = $2'} ORDER BY (status = 'Evaluated') DESC, (status = 'In progress') DESC, created_at DESC`, cn.view ? [site] : [site, c.userId]);
    const rules = await c.db.rows(`SELECT r.*, d.department_name FROM training_rule r LEFT JOIN department d ON d.id = r.department_id WHERE r.site_id = $1 AND r.status = 'Active' ORDER BY d.department_name NULLS LAST`, [site]);
    const departments = await c.db.rows(`SELECT id, department_code, department_name FROM department WHERE site_id = $1 AND status = 'Active' ORDER BY department_name`, [site]);
    const me = await c.db.one('SELECT is_admin FROM app_user WHERE id = $1', [c.userId]);
    return { lab, people, attempts, rules, departments, can: { ...cn, sysadmin: !!(me && me.is_admin) }, me: c.userId };
  });

  // one person's training: qualifications, attempts, departments, what they did (the rolling counters)
  async function person(db, site, userId) {
    const u = await db.one('SELECT id, full_name, username, title FROM app_user WHERE id = $1', [userId]);
    if (!u) throw new Error('Person not found');
    const quals = await db.rows(`SELECT * FROM analyst_qualification_view WHERE user_id = $1 AND site_id = $2 ORDER BY status, department_name NULLS LAST, test_name`, [userId, site]);
    const attempts = await db.rows(`SELECT * FROM competency_attempt_view WHERE user_id = $1 AND site_id = $2 ORDER BY created_at DESC`, [userId, site]);
    const departments = await db.rows(`SELECT d.id, d.department_name, (training_rule_for($2, d.id)).dept_trained_after AS needed,
        (SELECT count(DISTINCT q.test_id) FROM analyst_qualification q JOIN test t ON t.id = q.test_id WHERE q.user_id = $1 AND q.site_id = $2 AND t.department_id = d.id AND q.status = 'Active' AND qualification_current($1, q.test_id))::int AS current_tests,
        department_trained($1, $2, d.id) AS trained, (training_rule_for($2, d.id)).unlock_any_test AS unlock_any_test, (training_rule_for($2, d.id)).unlock_can_train AS unlock_can_train
      FROM department d WHERE d.site_id = $2 AND d.status = 'Active' ORDER BY d.department_name`, [userId, site]);
    const activity = await db.rows(`SELECT t.id AS test_id, t.test_name, d.department_name, x12.runs AS runs_12m, xa.runs AS runs_total, xa.last_at
      FROM test t LEFT JOIN department d ON d.id = t.department_id, LATERAL training_runs($1, t.id, $2, 12) x12, LATERAL training_runs($1, t.id, $2, NULL) xa
      WHERE t.site_id = $2 AND xa.runs > 0 ORDER BY xa.last_at DESC`, [userId, site]);
    const lastSample = await db.one(`SELECT attempt_code, test_name, kind, decided_at FROM competency_attempt_view WHERE user_id = $1 AND site_id = $2 AND status = 'Approved' AND route = 'Training samples'
      ORDER BY decided_at DESC LIMIT 1`, [userId, site]);
    return { person: u, qualifications: quals, attempts, departments, activity, last_competency_sample: lastSample };
  }
  route('GET', '/api/training/people/:id', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Person not found');
    await needView(c, c.params.id);
    const site = await currentSite(c);
    const tests = await c.db.rows(`SELECT t.id, t.test_code, t.test_name, t.department_id, d.department_name, tv.id AS version_id,
        (SELECT json_agg(json_build_object('analyte_id', a.analyte_id, 'analyte', COALESCE(an.report_name, an.analyte_name), 'unit', a.reporting_unit) ORDER BY a.sort_order) FROM test_version_analyte a JOIN analyte an ON an.id = a.analyte_id
          WHERE a.test_version_id = tv.id AND a.status = 'Active') AS analytes
      FROM test t LEFT JOIN department d ON d.id = t.department_id LEFT JOIN test_version tv ON tv.test_id = t.id AND tv.status = 'Effective'
      WHERE t.site_id = $1 AND t.status = 'Active' ORDER BY t.test_name`, [site]);
    return { ...(await person(c.db, site, c.params.id)), tests, can: await can(c), me: c.userId };
  });
  // the training report: what the person trained on, how, when, their last competency sample, the counters
  route('GET', '/api/training/people/:id/report.pdf', async (c) => {
    if (c.query.s) c.siteId = c.query.s;
    if (!isUuid(c.params.id)) throw new Error('Person not found');
    await needView(c, c.params.id);
    const site = await currentSite(c);
    const lab = await c.db.one('SELECT site_code, site_name, time_zone FROM lab_site WHERE id = $1', [site]);
    const p = await person(c.db, site, c.params.id);
    const tz = lab.time_zone; const d8 = (v) => (v ? fmtDate(v, tz) : '');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body { font: 9.5pt/1.35 "Helvetica Neue", Arial, sans-serif; color: #1d2329; } h1 { font-size: 15pt; margin: 0; color: #1f3a2c; } h2 { font-size: 11pt; color: #1f3a2c; margin: 14px 0 4px; }
      .top { display: flex; justify-content: space-between; border-bottom: 2.5px solid #1f3a2c; padding-bottom: 8px; margin-bottom: 8px; } .sub { color: #5c6773; }
      table { width: 100%; border-collapse: collapse; } th { background: #eef2f0; text-align: left; font-size: 8pt; padding: 4px 5px; border-bottom: 1px solid #c9d3cf; }
      td { padding: 4px 5px; border-bottom: 1px solid #e3e8e6; vertical-align: top; } .lapsed { color: #9a2b2b; font-weight: 600; } .due { color: #8a5a00; font-weight: 600; }
    </style></head><body>
    <div class="top"><div><h1>Training report: ${esc(p.person.full_name)}</h1><div class="sub">${p.person.title ? esc(p.person.title) + ' · ' : ''}${esc(lab.site_name)}${lab.site_name !== lab.site_code ? ' (' + esc(lab.site_code) + ')' : ''}</div></div>
      <div class="sub" style="text-align:right">Printed ${esc(fmtDate(new Date(), tz))}<br>Last competency sample: ${p.last_competency_sample ? `${esc(p.last_competency_sample.test_name)}, ${esc(d8(p.last_competency_sample.decided_at))} (${esc(p.last_competency_sample.attempt_code)})` : 'none'}</div></div>
    <h2>Qualifications</h2><table><thead><tr><th>Test</th><th>Department</th><th>How</th><th>Granted</th><th>Last competency</th><th>Next due</th><th>Runs (12 months / all)</th><th>Last run</th><th>State</th></tr></thead><tbody>
    ${p.qualifications.map((q) => `<tr><td>${esc(q.test_name)}</td><td>${esc(q.department_name || '')}</td><td>${esc(q.source)}${q.attempt_code ? ' ' + esc(q.attempt_code) : ''}${q.conditions ? `<div class="sub">Conditional: ${esc(q.conditions)}</div>` : ''}</td>
      <td>${esc(d8(q.granted_at))}</td><td>${esc(d8(q.last_competency_at))}</td><td>${esc(d8(q.due_on))}</td><td>${q.runs_12m} / ${q.runs_total}</td><td>${esc(d8(q.last_run))}</td>
      <td class="${q.state === 'Lapsed' ? 'lapsed' : q.state === 'Due soon' ? 'due' : ''}">${esc(q.state)}${q.why ? `<div class="sub">${esc(q.why)}</div>` : ''}</td></tr>`).join('') || '<tr><td colspan="9">None</td></tr>'}</tbody></table>
    <h2>Departments</h2><table><thead><tr><th>Department</th><th>Current qualifications</th><th>Department trained</th></tr></thead><tbody>
    ${p.departments.map((d) => `<tr><td>${esc(d.department_name)}</td><td>${d.current_tests}${d.needed ? ' of ' + d.needed : ''}</td><td>${d.trained ? `Yes${d.unlock_any_test ? ': any test of the department' : ''}${d.unlock_can_train ? (d.unlock_any_test ? '; ' : ': ') + 'may train others' : ''}` : 'No'}</td></tr>`).join('')}</tbody></table>
    <h2>Competency (initial and continuing)</h2><table><thead><tr><th>Attempt</th><th>Kind</th><th>Test</th><th>Route</th><th>Evaluation</th><th>Evaluated by</th><th>Decision</th><th>Date</th></tr></thead><tbody>
    ${p.attempts.map((a) => `<tr><td>${esc(a.attempt_code)}</td><td>${esc(a.kind)}</td><td>${esc(a.test_name)}</td><td>${esc(a.route)}</td><td>${esc(a.evaluation || '')}${a.evaluation_note ? `<div class="sub">${esc(a.evaluation_note)}</div>` : ''}</td>
      <td>${esc(a.evaluated_by_name || '')}</td><td>${esc(a.status)}${a.decided_by_name ? ` (${esc(a.decided_by_name)})` : ''}</td><td>${esc(d8(a.decided_at || a.evaluated_at || a.created_at))}</td></tr>`).join('') || '<tr><td colspan="8">None</td></tr>'}</tbody></table>
    <h2>Work done (the rolling counter)</h2><table><thead><tr><th>Test</th><th>Department</th><th>Runs, last 12 months</th><th>Runs, all</th><th>Last run</th></tr></thead><tbody>
    ${p.activity.map((x) => `<tr><td>${esc(x.test_name)}</td><td>${esc(x.department_name || '')}</td><td>${x.runs_12m}</td><td>${x.runs_total}</td><td>${esc(d8(x.last_at))}</td></tr>`).join('') || '<tr><td colspan="5">None</td></tr>'}</tbody></table>
    <p class="sub">A run is a batch in which the person signed a bench step (QC Review not counted). Qualification states follow the lab's training rules.</p></body></html>`;
    const out = await COA.htmlToPdf(html, `Training report · ${p.person.full_name} · ${lab.site_code}`);
    return { __raw: true, body: out.buf, type: 'application/pdf', headers: { 'Content-Disposition': `inline; filename="training-${p.person.username}.pdf"` } };
  });

  // start an attempt (a trainer): training samples (an internal order is made) or a record
  route('POST', '/api/training/attempts', async (c) => {
    const b = c.body || {};
    if (!isUuid(b.user_id) || !isUuid(b.test_id)) throw new Error('Choose the person and the test');
    const known = (Array.isArray(b.known_values) ? b.known_values : []).filter((k) => isUuid(k.analyte_id) && (k.value !== '' && k.value !== undefined || k.min !== undefined || k.max !== undefined || k.text));
    return tx({ ...c, reason: b.reason || 'Competency started' }, (t) => t.one('SELECT start_competency_attempt($1, $2, $3, $4, $5, $6::jsonb, $7, $8::date) AS id',
      [b.user_id, b.test_id, b.kind || 'Initial', b.route || 'Record', Number(b.samples) || null, JSON.stringify(known), b.description || null, b.trained_on || null]));
  });
  route('GET', '/api/training/attempts/:id', async (c) => {
    const a = await attemptOf(c, c.params.id);
    await needView(c, a.user_id);
    const results = await c.db.rows('SELECT * FROM competency_results($1)', [a.id]);
    const samples = await c.db.rows(`SELECT s.id, s.sample_code, rt.id AS requested_test_id, rt.status::text AS status FROM requested_test rt JOIN sample s ON s.id = rt.sample_id WHERE rt.competency_attempt_id = $1 ORDER BY s.sample_code`, [a.id]);
    const evidence = await c.db.rows(`SELECT e.id, e.title, f.file_name, e.created_at, u.full_name AS by_name FROM competency_evidence e JOIN document_file f ON f.id = e.document_id JOIN app_user u ON u.id = e.created_by WHERE e.attempt_id = $1 ORDER BY e.created_at`, [a.id]);
    const ev = await c.db.one('SELECT can_evaluate_training($1, $2) AS ok', [c.userId, a.test_id]);
    return { attempt: a, results, samples, evidence, can: { ...(await can(c)), evaluate: !!(ev && ev.ok) && a.user_id !== c.userId }, me: c.userId };
  });
  route('POST', '/api/training/attempts/:id/evidence', async (c) => {
    const a = await attemptOf(c, c.params.id);
    const docs = Array.isArray(c.body.documents) ? c.body.documents : [];
    if (!docs.length) throw new Error('Choose a file');
    return tx({ ...c, reason: c.body.reason || 'Training evidence' }, async (t) => {
      for (const d of docs) {
        const buf = Buffer.from(String(d.base64 || '').replace(/^data:[^,]*,/, ''), 'base64');
        if (!buf.length) throw new Error('A file is empty');
        if (buf.length > 15 * 1024 * 1024) throw new Error('A file is larger than 15 MB');
        const sha = crypto.createHash('sha256').update(buf).digest('hex');
        const f = await t.one(`INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ($1, $2, $3, $4, decode($5, 'base64')) RETURNING id`,
          [d.file_name || 'evidence', d.mime_type || 'application/octet-stream', buf.length, sha, buf.toString('base64')]);
        await t.query('INSERT INTO competency_evidence (attempt_id, document_id, title) VALUES ($1, $2, $3)', [a.id, f.id, d.title || d.file_name || null]);
      }
      return { added: docs.length };
    });
  });
  route('GET', '/api/training/evidence/:id/file', async (c) => {
    if (c.query.s) c.siteId = c.query.s;
    if (!isUuid(c.params.id)) throw new Error('File not found');
    const d = await c.db.one(`SELECT f.file_name, f.mime_type, encode(f.content, 'base64') AS b64, a.site_id, a.user_id FROM competency_evidence e JOIN competency_attempt a ON a.id = e.attempt_id
      JOIN document_file f ON f.id = e.document_id WHERE e.id = $1`, [c.params.id]);
    if (!d) throw new Error('File not found');
    await checkSite(c, d.site_id); await needView(c, d.user_id);
    return { __raw: true, body: Buffer.from(d.b64, 'base64'), type: d.mime_type, headers: { 'Content-Disposition': `inline; filename="${String(d.file_name).replace(/[^\w.\- ]/g, '_')}"` } };
  });
  route('POST', '/api/training/attempts/:id/evaluate', async (c) => {
    const a = await attemptOf(c, c.params.id);
    return signedTx({ ...c, reason: c.body.note || null }, { meaning: 'Evaluated by', action: `Competency ${a.attempt_code} of ${a.full_name} on ${a.test_name}: ${c.body.evaluation}`, module: 'Training' },
      (t) => t.query('SELECT evaluate_competency_attempt($1, $2, $3)', [a.id, c.body.evaluation, c.body.note || null]).then(() => ({ ok: true })));
  });
  route('POST', '/api/training/attempts/:id/decide', async (c) => {
    const a = await attemptOf(c, c.params.id);
    const dec = c.body.decision === 'Rejected' ? 'Rejected' : 'Approved';
    return signedTx({ ...c, reason: c.body.note || null }, { meaning: dec === 'Approved' ? 'Approved by' : 'Rejected by', action: `Competency ${a.attempt_code} of ${a.full_name} on ${a.test_name}`, module: 'Training' },
      (t) => t.one('SELECT decide_competency_attempt($1, $2, $3) AS qualification_id', [a.id, dec, c.body.note || null]));
  });
  route('POST', '/api/training/attempts/:id/withdraw', async (c) => {
    const a = await attemptOf(c, c.params.id);
    if (!c.body.reason) throw new Error('Give the reason');
    return tx({ ...c, reason: c.body.reason }, (t) => t.query('SELECT withdraw_competency_attempt($1, $2)', [a.id, c.body.reason]).then(() => ({ ok: true })));
  });
  route('POST', '/api/training/qualifications/:id/withdraw', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Qualification not found');
    const q = await c.db.one('SELECT site_id, full_name, test_name FROM analyst_qualification_view WHERE id = $1', [c.params.id]);
    if (!q) throw new Error('Qualification not found');
    await checkSite(c, q.site_id);
    if (!c.body.reason) throw new Error('Give the reason');
    return signedTx({ ...c, reason: c.body.reason }, { meaning: 'Withdrawn by', action: `Qualification of ${q.full_name} on ${q.test_name}`, module: 'Training' },
      (t) => t.query('SELECT withdraw_qualification($1, $2)', [c.params.id, c.body.reason]).then(() => ({ ok: true })));
  });
  route('POST', '/api/training/legacy', async (c) => {
    const site = await currentSite(c);
    return signedTx({ ...c, reason: c.body.reason || 'Legacy qualifications when the lab starts training' }, { meaning: 'Approved by', action: 'Legacy qualifications (who did a test in the last 12 months)', module: 'Training' },
      (t) => t.one('SELECT grant_legacy_qualifications($1) AS granted', [site]));
  });
  // the rules per department (a reason for changes)
  route('POST', '/api/training/rules', async (c) => {
    const site = await currentSite(c);
    const rows = Array.isArray(c.body.rows) ? c.body.rows : [];
    const F = ['dept_trained_after', 'unlock_any_test', 'unlock_can_train', 'continuing_months', 'due_soon_days', 'min_runs', 'min_runs_months', 'allow_training_samples', 'allow_records', 'status'];
    return tx({ ...c, reason: c.body.reason || 'Training rules' }, async (t) => {
      for (const r of rows) {
        const f = {}; for (const k of F) if (r[k] !== undefined) f[k] = r[k] === '' ? null : r[k];
        // every department has its own rule since 0.32.0 (migration 055): a department named without the rule's id changes it
        const id = r.id || (isUuid(r.department_id) ? (await t.one(`SELECT id FROM training_rule WHERE site_id = $1 AND department_id = $2 AND status = 'Active'`, [site, r.department_id]) || {}).id : null);
        if (id) {
          const keys = Object.keys(f); if (!keys.length) continue;
          await t.query(`UPDATE training_rule SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 AND site_id = $${keys.length + 2}`, [id, ...keys.map((k) => f[k]), site]);
        } else {
          if (!isUuid(r.department_id)) throw new Error('Choose the department the rule is for');
          await t.query(`INSERT INTO training_rule (site_id, department_id, dept_trained_after, unlock_any_test, unlock_can_train, continuing_months, due_soon_days, min_runs, min_runs_months, allow_training_samples, allow_records)
            VALUES ($1, $2, $3, COALESCE($4, true), COALESCE($5, true), $6, COALESCE($7, 30), $8, $9, COALESCE($10, true), COALESCE($11, true))`,
          [site, r.department_id, f.dept_trained_after ?? null, f.unlock_any_test ?? null, f.unlock_can_train ?? null, f.continuing_months ?? null, f.due_soon_days ?? null, f.min_runs ?? null, f.min_runs_months ?? null, f.allow_training_samples ?? null, f.allow_records ?? null]);
        }
      }
      return { ok: true };
    });
  });

  AUDIT_CHECKS.training_person = (c, id) => needView(c, id);
  AUDIT_CHECKS.competency = async (c, id) => { const a = await attemptOf(c, id); await needView(c, a.user_id); };
  AUDIT_SCOPES.training_person = `SELECT 'analyst_qualification', id FROM analyst_qualification WHERE user_id = $1 UNION ALL SELECT 'competency_attempt', id FROM competency_attempt WHERE user_id = $1
    UNION ALL SELECT 'competency_evidence', e.id FROM competency_evidence e JOIN competency_attempt a ON a.id = e.attempt_id WHERE a.user_id = $1`;
  AUDIT_SCOPES.competency = `SELECT 'competency_attempt', $1::uuid UNION ALL SELECT 'competency_evidence', id FROM competency_evidence WHERE attempt_id = $1
    UNION ALL SELECT 'analyst_qualification', id FROM analyst_qualification WHERE attempt_id = $1`;
  AUDIT_LISTS.training = ['training_rule', 'analyst_qualification', 'competency_attempt'];
};
