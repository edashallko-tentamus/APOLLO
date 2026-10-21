// OOS investigations (R-2, migration 027): the automatic data checks worked out from the record when an investigation
// is opened (and again on request until it is concluded), and the investigation report (PDF) signed at the
// conclusion. The steps and their rules are in the database (open_oos, sign_oos_analyst, sign_oos_supervisor,
// conclude_oos, order_oos_retest...).
'use strict';
const COA = require('./coa');
const V = require('./verification');
const { esc, fmtDate, fmtDateTime } = COA;

const chk = (code, title, level, detail) => ({ code, title, level, detail });

// The automatic data checks: what can be checked without a person (they inform the investigation; they decide nothing)
async function checks(db, oosId) {
  const o = await db.one(`SELECT x.*, s.sample_code, s.logged_at, s.condition, s.retained_quantity, s.retained_unit, s.lab_order_id, a.analyte_name
      FROM oos_investigation x JOIN sample s ON s.id = x.sample_id JOIN analyte a ON a.id = x.analyte_id WHERE x.id = $1`, [oosId]);
  if (!o) throw new Error('OOS investigation not found');
  const out = [];
  if (!o.batch_id) return [chk('batch', 'Batch', 'Info', 'No batch is linked to the result')];
  const b = await db.one('SELECT id, batch_code, status::text AS status, test_version_id FROM test_batch WHERE id = $1', [o.batch_id]);
  // 1. materials in date at the time they were used
  const lots = await db.rows(`SELECT DISTINCT l.lot_code, COALESCE(l.item_name, l.item_description) AS name, l.expiration_date, l.retest_date, m.created_at::date AS used_on
      FROM entry_material m JOIN step_run r ON r.id = m.step_run_id JOIN inventory_lot l ON l.id = m.lot_id
     WHERE r.batch_id = $1 AND m.status = 'Active'`, [b.id]);
  const badLots = lots.filter((l) => (l.expiration_date && new Date(l.expiration_date) < new Date(l.used_on)) || (l.retest_date && new Date(l.retest_date) < new Date(l.used_on)));
  out.push(badLots.length ? chk('lots', 'Standards, reagents and media in date when used', 'Fail', badLots.map((l) => `${l.lot_code} ${l.name}: expiry ${fmtDate(l.expiration_date)}, used ${fmtDate(l.used_on)}`).join('; '))
    : chk('lots', 'Standards, reagents and media in date when used', lots.length ? 'Pass' : 'Info', lots.length ? `${lots.length} lot${lots.length > 1 ? 's' : ''} used in ${b.batch_code}, all in date` : `No lots recorded in ${b.batch_code}`));
  // 2. instruments calibrated and in service at the time of use
  const eq = await db.rows(`SELECT DISTINCT e.id, e.equipment_code, e.equipment_name, e.calibration_required, ee.created_at AS used_at
      FROM entry_equipment ee JOIN step_run r ON r.id = ee.step_run_id JOIN equipment e ON e.id = ee.equipment_id WHERE r.batch_id = $1 AND ee.status = 'Active'`, [b.id]);
  const eqBad = [];
  for (const e of eq) {
    const tag = await db.one(`SELECT tag_code, reason::text AS reason FROM equipment_tag WHERE equipment_id = $1 AND tagged_out_at <= $2 AND (tagged_in_at IS NULL OR tagged_in_at >= $2) LIMIT 1`, [e.id, e.used_at]);
    if (tag) eqBad.push(`${e.equipment_code} was tagged out (${tag.tag_code}, ${tag.reason})`);
    if (e.calibration_required) {
      const cal = await db.one(`SELECT calibration_code FROM calibration WHERE equipment_id = $1 AND performed_date <= $2::date AND expiration_date >= $2::date
        AND COALESCE(status::text, 'Active') <> 'Inactive' LIMIT 1`, [e.id, e.used_at]);
      if (!cal) eqBad.push(`${e.equipment_code} had no calibration valid on ${fmtDate(e.used_at)}`);
    }
  }
  out.push(eqBad.length ? chk('equipment', 'Instruments calibrated and in service when used', 'Fail', eqBad.join('; '))
    : chk('equipment', 'Instruments calibrated and in service when used', eq.length ? 'Pass' : 'Info', eq.length ? eq.map((e) => e.equipment_code).join(', ') + ': in service, calibration valid' : 'No instrument recorded'));
  // 3. batch QC
  const qc = await db.rows(`SELECT label, analyte_name, limit_type, verdict FROM batch_qc_verdicts($1)`, [b.id]);
  const acc = await db.rows(`SELECT entry_id, analyte_id FROM qc_acceptance WHERE batch_id = $1 AND status = 'Active'`, [b.id]).catch(() => []);
  const failing = qc.filter((q) => !/^Pass/.test(q.verdict || '') && !/Not judged/.test(q.verdict || ''));
  out.push(!qc.length ? chk('qc', 'Batch QC', 'Info', 'The batch has no QC')
    : failing.length ? chk('qc', 'Batch QC', acc.length >= failing.length ? 'Info' : 'Fail', `${failing.length} QC verdict${failing.length > 1 ? 's' : ''} not passing${acc.length ? ` (${acc.length} accepted with a justification in QC Review)` : ''}: ${failing.slice(0, 4).map((q) => `${q.label} ${q.analyte_name || ''} ${q.limit_type}: ${q.verdict}`).join('; ')}`)
      : chk('qc', 'Batch QC', 'Pass', `${qc.length} QC verdicts in ${b.batch_code}, all passing`));
  // 4. the result worked out again from the readings
  const live = await db.rows(`SELECT r.value::text AS value, r.run_no, r.is_final, r.entry_id FROM batch_results($1) r JOIN batch_entry e ON e.id = r.entry_id
     WHERE e.requested_test_id = $2 AND r.analyte_id = $3 AND r.is_final`, [b.id, o.requested_test_id, o.analyte_id]).catch(() => []);
  const tr = o.test_result_id ? await db.one('SELECT value_num::text AS v, reported, entry_id, run_no FROM test_result WHERE id = $1', [o.test_result_id]) : null;
  const target = tr ? live.find((l) => l.entry_id === tr.entry_id && Number(l.run_no) === Number(tr.run_no)) : live[0];
  if (target && target.value !== null && (tr ? tr.v : o.value_num) !== null) {
    const stored = tr ? tr.v : String(o.value_num);
    const same = Math.abs(Number(target.value) - Number(stored)) <= Math.abs(Number(stored)) * 1e-9 + 1e-12;
    out.push(chk('calc', 'Result worked out again from the readings', same ? 'Pass' : 'Fail', `From the readings: ${Number(target.value).toPrecision(9)}; investigated: ${Number(stored).toPrecision(9)}${tr ? ` (reported ${tr.reported})` : ''}`));
  } else out.push(chk('calc', 'Result worked out again from the readings', 'Info', 'The calculation could not be repeated here (a qualitative result, or a reading missing)'));
  // 5. the people: in the step's department group (training records are not in LIMS3 yet)
  const ppl = await db.rows(`SELECT DISTINCT u.full_name, ws.step_name, user_in_department(r.performed_by, COALESCE(ws.department_id, t.department_id)) AS ok
      FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id JOIN test_batch tb ON tb.id = r.batch_id JOIN test t ON t.id = tb.test_id JOIN app_user u ON u.id = r.performed_by
     WHERE r.batch_id = $1 AND r.performed_by IS NOT NULL AND ws.step_type::text NOT IN ('QC Review')`, [b.id]).catch(() => []);
  const notIn = ppl.filter((p) => p.ok === false);
  out.push(notIn.length ? chk('people', 'Analysts in the step\'s department (training)', 'Fail', notIn.map((p) => `${p.full_name}: ${p.step_name}`).join('; '))
    : chk('people', 'Analysts in the step\'s department (training)', 'Pass', `${[...new Set(ppl.map((p) => p.full_name))].join(', ') || 'Nobody recorded'}: in the department group (training records are not in LIMS3 yet)`));
  // 6. raw data attached to every reading step
  const reads = await db.rows(`SELECT ws.step_name, (SELECT count(*) FROM step_attachment sa WHERE sa.step_run_id = r.id AND sa.status = 'Active')::int AS files
      FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = $1 AND ws.step_type::text = 'Data Entry'`, [b.id]);
  const noFile = reads.filter((x) => !x.files);
  out.push(chk('rawdata', 'Raw data attached to the reading steps', noFile.length ? 'Info' : 'Pass', noFile.length ? `No file on: ${noFile.map((x) => x.step_name).join(', ')}` : `${reads.length} reading step${reads.length === 1 ? '' : 's'} with raw data`));
  // 7. the specification as now on the test
  const sp = await db.one(`SELECT min_value::text AS min, max_value::text AS max, text_value, unit, source::text AS source FROM specification
     WHERE requested_test_id = $1 AND analyte_id = $2 AND status = 'Active' LIMIT 1`, [o.requested_test_id, o.analyte_id]);
  out.push(chk('spec', 'Specification on the test', sp ? 'Info' : 'Fail', sp ? `${sp.text_value || [sp.min !== null ? '≥ ' + Number(sp.min) : '', sp.max !== null ? '≤ ' + Number(sp.max) : ''].filter(Boolean).join(' and ')}${sp.unit ? ' ' + sp.unit : ''} (${sp.source}); check it is the client's intended limit and unit`
    : 'The test has no specification now'));
  // 8. the sample: condition on receipt and retained material for a retest
  out.push(chk('sample', 'Sample on receipt and retained material', o.condition && o.condition !== 'Acceptable' ? 'Fail' : 'Info',
    `Condition on receipt: ${o.condition || 'not recorded'}; retained: ${o.retained_quantity === null || o.retained_quantity === undefined ? 'not recorded' : `${Number(o.retained_quantity)} ${o.retained_unit || ''}`}`));
  // 9. this client's earlier results for the analyte
  const hist = await db.rows(`SELECT tr.value_num::float8 AS v FROM test_result tr JOIN requested_test rt ON rt.id = tr.requested_test_id JOIN sample s2 ON s2.id = rt.sample_id
      JOIN lab_order o2 ON o2.id = s2.lab_order_id WHERE o2.client_id = (SELECT client_id FROM lab_order WHERE id = $1) AND tr.analyte_id = $2 AND tr.status = 'Active'
       AND tr.stage = 'Final' AND tr.result_key IS NULL AND rt.id <> $3 AND tr.value_num IS NOT NULL ORDER BY tr.approved_at DESC LIMIT 30`, [o.lab_order_id, o.analyte_id, o.requested_test_id]);
  if (hist.length >= 3) {
    const v = hist.map((h) => Number(Number(h.v).toPrecision(4))).sort((x, y) => x - y);
    out.push(chk('history', 'This client\'s earlier results', 'Info', `${hist.length} earlier results for ${o.analyte_name}: ${v[0]} to ${v[v.length - 1]} (median ${v[Math.floor(v.length / 2)]})`));
  } else out.push(chk('history', 'This client\'s earlier results', 'Info', `${hist.length} earlier result${hist.length === 1 ? '' : 's'} for ${o.analyte_name}: too few to compare`));
  return out;
}

// The investigation report (Phase I or Check and Acknowledge), as it stands with the conclusion being signed
async function report(db, oosId, pending) {
  const o = await db.one(`SELECT x.*, s.sample_code, s.client_sample_id, s.description, s.lot, COALESCE(c.display_name, c.legal_name) AS client_name, si.site_name, si.time_zone,
        t.test_name, a.analyte_name, b.batch_code, ou.full_name AS opened_by_name, au.full_name AS analyst_name, su.full_name AS supervisor_name
      FROM oos_investigation x JOIN sample s ON s.id = x.sample_id JOIN lab_order lo ON lo.id = s.lab_order_id JOIN client c ON c.id = lo.client_id
      JOIN lab_site si ON si.id = x.site_id JOIN requested_test rt ON rt.id = x.requested_test_id JOIN test t ON t.id = rt.test_id JOIN analyte a ON a.id = x.analyte_id
      LEFT JOIN test_batch b ON b.id = x.batch_id JOIN app_user ou ON ou.id = x.opened_by LEFT JOIN app_user au ON au.id = x.analyst_by LEFT JOIN app_user su ON su.id = x.supervisor_by
     WHERE x.id = $1`, [oosId]);
  const items = await db.rows(`SELECT id, section, item_text FROM oos_checklist_item WHERE procedure = $1 AND status = 'Active' ORDER BY section, sort_order`, [o.procedure]);
  const tz = o.time_zone; const phase1 = o.procedure === 'Full Phase I (21 CFR 211)';
  const answers = (sec, ans) => `<table><thead><tr><th>Item</th><th style="width:60px">Answer</th><th>Comment</th></tr></thead><tbody>${items.filter((i) => i.section === sec)
    .map((i) => { const a = (ans || {})[i.id] || {}; return `<tr><td>${esc(i.item_text)}</td><td><b>${esc(a.answer || '')}</b></td><td>${esc(a.comment || '')}</td></tr>`; }).join('')}</tbody></table>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font: 9.5pt/1.4 "Helvetica Neue", Arial, sans-serif; color: #1d2329; }
    h1 { font-size: 15pt; color: #1f3a2c; margin: 0 0 2px; } h2 { font-size: 11pt; color: #1f3a2c; margin: 16px 0 5px; border-bottom: 1px solid #c9d3cf; padding-bottom: 2px; }
    .sub { color: #5c6773; margin-bottom: 10px; } table { width: 100%; border-collapse: collapse; margin: 4px 0; } th { background: #eef2f0; text-align: left; font-size: 8.5pt; padding: 4px 6px; }
    td { padding: 4px 6px; border-bottom: 1px solid #e3e8e6; vertical-align: top; } .kv td:first-child { width: 28%; color: #5c6773; font-weight: 600; }
    .Fail { color: #b42318; font-weight: 700; } .Pass { color: #1e7a4a; font-weight: 700; } .sig { margin-top: 4px; color: #333; }
  </style></head><body>
  <h1>${phase1 ? 'OOS investigation, Phase I (laboratory)' : 'OOS check and acknowledgement'}: ${esc(o.oos_code)}</h1>
  <div class="sub">${esc(o.site_name)} · ${esc(o.procedure)} · opened ${esc(fmtDateTime(o.opened_at, tz))} by ${esc(o.opened_by_name)}</div>
  <table class="kv"><tbody>
    <tr><td>Client</td><td>${esc(o.client_name)}</td></tr><tr><td>Sample</td><td>${esc(o.sample_code)} (${esc(o.client_sample_id || '')}) ${esc(o.description || '')}${o.lot ? ', lot ' + esc(o.lot) : ''}</td></tr>
    <tr><td>Test</td><td>${esc(o.test_name)}${o.batch_code ? ', batch ' + esc(o.batch_code) : ''}</td></tr>
    <tr><td>Result</td><td><b>${esc(o.analyte_name)}: ${esc(o.reported || '')} ${esc(o.unit || '')}</b></td></tr><tr><td>Specification</td><td>${esc(o.spec_text || '')}</td></tr>
    ${o.opened_reason ? `<tr><td>Why opened</td><td>${esc(o.opened_reason)}</td></tr>` : ''}
  </tbody></table>
  <h2>Automatic data checks</h2><table><thead><tr><th>Check</th><th style="width:55px">Result</th><th>Detail</th></tr></thead><tbody>
    ${(o.auto_checks || []).map((c) => `<tr><td>${esc(c.title)}</td><td class="${esc(c.level)}">${esc(c.level)}</td><td>${esc(c.detail)}</td></tr>`).join('')}</tbody></table>
  ${phase1 ? `<h2>Analyst section</h2>${answers('Analyst', o.analyst_answers)}${o.hypothesis ? `<p><b>Hypothesis testing:</b> ${esc(o.hypothesis)}</p>` : ''}${o.analyst_comment ? `<p>${esc(o.analyst_comment)}</p>` : ''}
    <div class="sig">Signed by ${esc(o.analyst_name || '')}, ${esc(fmtDateTime(o.analyst_at, tz))}</div>
    <h2>Supervisor section</h2>${answers('Supervisor', o.supervisor_answers)}${o.supervisor_comment ? `<p>${esc(o.supervisor_comment)}</p>` : ''}
    <div class="sig">Signed by ${esc(o.supervisor_name || '')}, ${esc(fmtDateTime(o.supervisor_at, tz))}</div>`
    : `<h2>Review checklist</h2>${answers('Reviewer', pending.answers)}`}
  <h2>Conclusion${phase1 ? ' (QA)' : ''}</h2>
  <p><b>${esc(pending.conclusion)}</b>${pending.cause ? `. Assignable cause: ${esc(pending.cause)}` : ''}</p><p>${esc(pending.comment)}</p>
  <p>${pending.conclusion === 'OOS confirmed' ? 'No laboratory error was found: the result stands and is reported as out of specification. The client is told when it is released.' : 'The result is invalid: it is not reported, and a laboratory investigation retest (re-prep from the retained sample, not billed) replaces it.'}</p>
  <div class="sig">Signed by ${esc(pending.by)}, ${esc(fmtDateTime(pending.at, tz))}</div>
  </body></html>`;
  return COA.htmlToPdf(html, `${o.oos_code} · ${o.procedure} · ${o.site_name} · Sandbox (not validated)`);
}

module.exports = { checks, report };
