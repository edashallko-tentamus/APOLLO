// Stability studies (migration 032): the data behind a stability quote and a study, the quotation PDF (the study
// matrix, the dates, the price per pull and per study year) and the cumulative report (per condition, one table per
// test: analytes down, timepoints across, against the specification).
'use strict';
const COA = require('./coa');
const { esc, fmtDate } = COA;

const money = (v) => (v === null || v === undefined || v === '' ? '' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const dOnly = (d) => { if (!d) return ''; const m = String(d instanceof Date ? d.toISOString() : d).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }) : fmtDate(d); };
const iso = (d) => { const m = String(d || '').match(/^\d{4}-\d{2}-\d{2}/); return m ? m[0] : ''; };
const addInterval = (base, n, unit) => { const d = new Date(base + 'T00:00:00Z'); if (unit === 'Months') d.setUTCMonth(d.getUTCMonth() + Number(n)); else d.setUTCDate(d.getUTCDate() + Number(n) * (unit === 'Weeks' ? 7 : 1)); return d.toISOString().slice(0, 10); };
const intervalText = (t) => (Number(t.interval_value) === 0 ? 'Baseline' : `${t.interval_value} ${String(t.interval_unit).toLowerCase().replace(/s$/, Number(t.interval_value) === 1 ? '' : 's')}`);

// The design of one version: plan, conditions, timepoints, lines and cells (and the planned dates when a placement date is planned)
async function design(db, vid) {
  const plan = await db.one(`SELECT pl.*, s.site_code, s.site_name, s.stability_pull_window_days, s.stability_reserve_pct FROM stability_plan pl JOIN lab_site s ON s.id = pl.site_id WHERE pl.project_version_id = $1`, [vid]);
  const conditions = await db.rows(`SELECT vc.id, vc.condition_id, vc.sort_order, sc.condition_name, sc.condition_type, sc.temperature_c, sc.humidity_pct
    FROM stability_version_condition vc JOIN stability_condition sc ON sc.id = vc.condition_id WHERE vc.project_version_id = $1 AND vc.status = 'Active' ORDER BY vc.sort_order, sc.sort_order, sc.condition_name`, [vid]);
  const timepoints = await db.rows(`SELECT * FROM stability_timepoint WHERE project_version_id = $1 AND status = 'Active'
    ORDER BY CASE interval_unit WHEN 'Days' THEN interval_value WHEN 'Weeks' THEN interval_value * 7 ELSE interval_value * 30.4 END, label`, [vid]);
  const lines = await db.rows(`SELECT q.id, q.test_id, q.quantity, q.list_price, q.final_price, q.line_total, q.discount_pct, t.test_code, t.test_name, t.site_id AS test_site_id,
      e.pricing_mode, e.standard_tat, e.tat_unit,
      EXISTS (SELECT 1 FROM test_version v WHERE v.test_id = q.test_id AND v.status = 'Effective') AS has_effective,
      (SELECT max(c.units_required) FROM stability_cell c WHERE c.line_id = q.id AND c.status = 'Active') AS units
    FROM quoted_test_configuration q JOIN test t ON t.id = q.test_id JOIN test_catalog_entry e ON e.test_id = t.id
    WHERE q.project_version_id = $1 AND q.status = 'Active' ORDER BY t.test_name`, [vid]);
  const cells = await db.rows(`SELECT id, line_id, timepoint_id, condition_id, units_required FROM stability_cell WHERE project_version_id = $1 AND status = 'Active'`, [vid]);
  const problems = await db.rows('SELECT * FROM stability_quote_problems($1)', [vid]);
  if (plan && plan.planned_placement) {
    const base = iso(plan.planned_placement);
    for (const t of timepoints) {
      t.planned_date = Number(t.interval_value) === 0 ? base : addInterval(base, t.interval_value, t.interval_unit);
      if (Number(t.interval_value) > 0) {
        const adj = await db.one('SELECT stability_adjust_date($1, $2::date, $3, $4) AS d', [plan.site_id, t.planned_date, t.days_early, t.days_late]);
        t.planned_date = iso(adj.d);
      }
    }
  }
  return { plan, conditions, timepoints, lines, cells, problems };
}

// The price of the study, per year (escalation compounded on each anniversary of acceptance)
function priceByYear(d) {
  const esc = Number((d.plan && d.plan.escalation_pct) || 0);
  const t0 = d.timepoints.find((t) => Number(t.interval_value) === 0);
  const years = new Map();
  for (const c of d.cells) {
    const tp = d.timepoints.find((t) => t.id === c.timepoint_id); const l = d.lines.find((x) => x.id === c.line_id);
    if (!tp || !l) continue;
    const months = tp.interval_unit === 'Months' ? Number(tp.interval_value) : tp.interval_unit === 'Weeks' ? Number(tp.interval_value) * 7 / 30.44 : Number(tp.interval_value) / 30.44;
    const y = Math.max(1, Math.floor(months / 12 + 1e-9) + 1) + (tp === t0 ? 0 : 0);
    const price = Math.round(Number(l.final_price || 0) * Math.pow(1 + esc / 100, y - 1) * 100) / 100;
    const cur = years.get(y) || { year: y, tests: 0, total: 0 }; cur.tests += 1; cur.total += price; years.set(y, cur);
  }
  return [...years.values()].sort((a, b) => a.year - b.year);
}

async function quoteData(db, vid) {
  const Q = require('./quotes');
  const base = await Q.data(db, vid);
  return { ...base, design: await design(db, vid) };
}

function quoteHtml({ v, design: d }, { preview = false } = {}) {
  const years = priceByYear(d);
  const total = years.reduce((s, y) => s + y.total, 0);
  const pulls = d.timepoints.filter((t) => Number(t.interval_value) > 0);
  const t0 = d.timepoints.find((t) => Number(t.interval_value) === 0);
  const has = (l, tp, cond) => d.cells.some((c) => c.line_id === l.id && c.timepoint_id === tp.id && (c.condition_id || null) === (cond || null));
  const cols = [t0, ...pulls].filter(Boolean);
  const head = cols.map((t) => `<th class="c">${esc(t.label)}${t.planned_date ? `<div class="m">${esc(dOnly(t.planned_date))}</div>` : ''}</th>`).join('');
  const table = (cond) => `<h2>${esc(cond.condition_name)} <span class="m">${esc(cond.condition_type)}</span></h2>
    <table><thead><tr><th>Test</th>${head}<th class="n">Times</th></tr></thead><tbody>
    ${d.lines.map((l) => { const marks = cols.map((t) => (Number(t.interval_value) === 0 ? has(l, t, null) : has(l, t, cond.condition_id)));
      if (!marks.some(Boolean)) return '';
      return `<tr><td>${esc(l.test_name)}</td>${marks.map((m, i) => `<td class="c">${m ? (i === 0 && t0 ? 'T0' : '&#10003;') : ''}</td>`).join('')}<td class="n">${marks.filter(Boolean).length}</td></tr>`; }).join('')}
    </tbody></table>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font: 9.5pt Helvetica, Arial, sans-serif; color: #1d2329; margin: 0; }
    .head { display: flex; justify-content: space-between; border-bottom: 2px solid #1f3a2c; padding-bottom: 10px; margin-bottom: 12px; }
    .brand { font-size: 17pt; font-weight: 700; color: #1f3a2c; } .m { color: #5c6773; font-size: 8pt; font-weight: 400; }
    h1 { margin: 0; font-size: 17pt; color: #1f3a2c; text-align: right; } .meta { text-align: right; font-size: 9pt; }
    .to { display: flex; gap: 36px; margin-bottom: 10px; } .to b { display: block; color: #5c6773; font-size: 8pt; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; margin: 4px 0 10px; } th { background: #eef3f0; text-align: left; font-size: 8pt; padding: 4px 5px; border-bottom: 1px solid #c8d3cc; vertical-align: bottom; }
    td { padding: 4px 5px; border-bottom: 1px solid #e6ebe8; vertical-align: top; font-size: 8.5pt; } .n { text-align: right; white-space: nowrap; } .c { text-align: center; }
    h2 { font-size: 10.5pt; color: #1f3a2c; margin: 14px 0 2px; } .tot { display: flex; justify-content: flex-end; gap: 24px; font-size: 10pt; } .big { font-size: 13pt; font-weight: 700; color: #1f3a2c; }
    .terms { font-size: 8pt; color: #5c6773; margin-top: 14px; border-top: 1px solid #e6ebe8; padding-top: 8px; } .draft { border: 2px solid #c68a00; color: #8a5a00; padding: 6px 10px; margin-bottom: 10px; font-weight: 700; }
    .facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 20px; margin: 6px 0 10px; } .facts div b { color: #5c6773; font-size: 8pt; display: block; text-transform: uppercase; }
  </style></head><body>
  ${preview ? '<div class="draft">PREVIEW: not issued. Prices are final only when the quotation is issued.</div>' : ''}
  <div class="head"><div><div class="brand">Tentamus North America</div><div class="m">Stability testing · ${esc(d.plan ? d.plan.site_name : '')}</div></div>
    <div><h1>Stability study quotation</h1><div class="meta">${esc(v.project_code)} · version ${v.version_no}<br>Issued: ${v.quoted_at ? esc(fmtDate(v.quoted_at)) : 'not yet issued'}<br>Valid until: ${v.valid_until ? esc(dOnly(v.valid_until)) : 'no expiry date'}</div></div></div>
  <div class="to"><div><b>Prepared for</b>${esc(v.client_legal_name)}${v.quote_contact_name ? `<br>Attn: ${esc(v.quote_contact_name)}` : ''}</div><div><b>Prepared by</b>${esc(v.owner_name || '')}</div>${v.project_name ? `<div><b>Reference</b>${esc(v.project_name)}</div>` : ''}</div>
  <div class="facts">
    <div><b>Product</b>${esc((d.plan && d.plan.product) || '')}</div><div><b>Lot</b>${esc((d.plan && d.plan.lot) || '')}</div><div><b>Protocol</b>${esc((d.plan && d.plan.protocol_ref) || '')}</div>
    <div><b>Conditions</b>${esc(d.conditions.map((c) => c.condition_name).join('; '))}</div>
    <div><b>Timepoints</b>${esc(d.timepoints.map((t) => t.label).join(', '))}</div>
    <div><b>Placement</b>${d.plan && d.plan.planned_placement ? esc(dOnly(d.plan.planned_placement)) + ' (planned)' : 'on receipt of the material'}</div>
  </div>
  ${d.conditions.map(table).join('')}
  <h2>Price</h2>
  <table><thead><tr><th>Test</th><th class="n">List price</th><th class="n">Your price per test</th><th class="n">Times in the study</th><th class="n">Material per test (${esc((d.plan && d.plan.unit_name) || 'units')})</th><th class="n">Total (year-one prices)</th></tr></thead><tbody>
    ${d.lines.map((l) => `<tr><td>${esc(l.test_name)}</td><td class="n">${money(l.list_price)}</td><td class="n">${money(l.final_price)}</td><td class="n">${d.cells.filter((c) => c.line_id === l.id).length}</td>
      <td class="n">${l.units || 1}</td><td class="n">${money(Number(l.final_price || 0) * d.cells.filter((c) => c.line_id === l.id).length)}</td></tr>`).join('')}
  </tbody></table>
  ${years.length > 1 || Number(d.plan && d.plan.escalation_pct) ? `<h2>By study year</h2><table><thead><tr><th>Study year</th><th class="n">Tests performed</th><th class="n">Price factor</th><th class="n">Amount</th></tr></thead><tbody>
    ${years.map((y) => `<tr><td>Year ${y.year}</td><td class="n">${y.tests}</td><td class="n">${Math.pow(1 + Number(d.plan.escalation_pct || 0) / 100, y.year - 1).toFixed(4)}</td><td class="n">${money(y.total)}</td></tr>`).join('')}</tbody></table>` : ''}
  <div class="tot"><span class="big">Study total ${money(total)}</span></div>
  <div class="terms"><b>Terms.</b> Prices are per test in USD. The client ships all the material at the start; T0 (baseline) is tested when the material is placed in the chambers, and each later timepoint is pulled from the chamber on its date and billed when it is completed. ${Number(d.plan && d.plan.escalation_pct) ? `Prices rise ${Number(d.plan.escalation_pct)}% on each anniversary of acceptance, compounded; each pull is billed at the price for the study year it falls in.` : 'Prices hold for the whole study.'} Pull dates that fall on a weekend or holiday move to the nearest working day inside each timepoint's window (± ${d.timepoints.filter((t) => Number(t.interval_value) > 0).map((t) => t.days_late).filter((x, i, a) => a.indexOf(x) === i).join('/') || 7} days). Turnaround for each pull counts from its scheduled date. The material needed is ${d.lines.length ? 'listed above per test' : 'agreed'}, plus a reserve of ${Number((d.plan && (d.plan.reserve_pct ?? d.plan.stability_reserve_pct)) || 10)}%.</div>
  </body></html>`;
}

// ---------------------------------------------------------------- the cumulative report
// Results are keyed by the timepoint's interval (an amendment gives the study new timepoint rows, but the 3-month
// pull stays the 3-month pull), by test and by condition. A condition dropped by an amendment keeps its column of
// results; T0 shows under every condition. issued: only finalized results (the issued report); otherwise every
// approved result, preliminary ones marked (the summary on the study page).
const tpKey = (t) => (Number(t.interval_value) === 0 ? 'T0' : `${Number(t.interval_value)}|${t.interval_unit}`);
const tpDays = (t) => (Number(t.interval_value) === 0 ? 0 : t.interval_unit === 'Days' ? Number(t.interval_value) : t.interval_unit === 'Weeks' ? Number(t.interval_value) * 7 : Number(t.interval_value) * 30.4);
async function reportData(db, studyId, { issued = false } = {}) {
  const st = await db.one('SELECT * FROM stability_study_view WHERE id = $1', [studyId]);
  if (!st) throw new Error('Study not found');
  const d = await design(db, st.project_version_id);
  const rows = await db.rows(`SELECT rt.id AS requested_test_id, rt.test_id, t.test_name, rt.stability_pull_id, tp.interval_value, tp.interval_unit, tp.label AS tp_label, c.condition_id,
      test_is_finalized(rt.id) AS finalized, tr.id AS result_id, tr.analyte_id, a.analyte_name, tr.reported, tr.unit, tr.stage, tr.conformance,
      sp.min_value, sp.max_value, sp.text_value, sp.unit AS spec_unit, sa.sample_code
    FROM requested_test rt JOIN test t ON t.id = rt.test_id JOIN stability_cell c ON c.id = rt.stability_cell_id JOIN stability_timepoint tp ON tp.id = c.timepoint_id
    JOIN sample sa ON sa.id = rt.sample_id
    LEFT JOIN test_result tr ON tr.requested_test_id = rt.id AND tr.status = 'Active' AND tr.result_key IS NULL
    LEFT JOIN analyte a ON a.id = tr.analyte_id
    LEFT JOIN specification sp ON sp.requested_test_id = rt.id AND sp.analyte_id = tr.analyte_id AND sp.status = 'Active'
    WHERE rt.stability_study_id = $1 AND rt.status <> 'Cancelled' AND sa.status <> 'Cancelled' AND NOT test_is_replaced(rt.id)`, [studyId]);
  // the analytes each test reports (its Effective version), with the quote's client specification: shown before any result exists
  const planned = await db.rows(`SELECT q.test_id, a.id AS analyte_id, a.analyte_name, tva.reporting_unit AS unit, tva.sort_order,
      sp.min_value, sp.max_value, sp.text_value, sp.unit AS spec_unit
    FROM quoted_test_configuration q JOIN test_version tv ON tv.test_id = q.test_id AND tv.status = 'Effective'
    JOIN test_version_analyte tva ON tva.test_version_id = tv.id AND tva.status = 'Active' AND NOT COALESCE(tva.hide_on_report, false)
    JOIN analyte a ON a.id = tva.analyte_id
    LEFT JOIN specification sp ON sp.quoted_line_id = q.id AND sp.analyte_id = a.id AND sp.status = 'Active'
    WHERE q.project_version_id = $1 AND q.status = 'Active' ORDER BY tva.sort_order, a.analyte_name`, [st.project_version_id]);
  const pulls = await db.rows(`SELECT p.id, p.status, p.condition_id, t.interval_value, t.interval_unit, t.label FROM stability_pull p JOIN stability_timepoint t ON t.id = p.timepoint_id WHERE p.study_id = $1`, [studyId]);
  const storage = await db.rows('SELECT condition_id, condition_name, storage_code, status, disposition_note, disposed_at, disposed_by_name FROM stability_storage_view WHERE study_id = $1 ORDER BY storage_code', [studyId]);
  const excursions = await db.rows(`SELECT logbook_entry_id, entry_code, equipment_code, equipment_name, entry_at, window_start, window_end, to_jsonb(problems) AS problems, failure_reason,
      storage_code, condition_name, assessment_id, decision, justification, assessed_at, assessed_by_name, to_jsonb(affected_pull_ids) AS affected_pull_ids, affected_pulls
    FROM stability_excursion_status_view WHERE study_id = $1 ORDER BY entry_at`, [studyId]);
  const amendments = await db.rows(`SELECT a.amendment_no, a.applied_at, a.pulls_added, a.pulls_cancelled, a.pulls_changed, fv.version_no AS from_version, tv.version_no AS to_version
    FROM stability_amendment a JOIN project_version fv ON fv.id = a.from_version_id JOIN project_version tv ON tv.id = a.to_version_id WHERE a.study_id = $1 ORDER BY a.amendment_no`, [studyId]);
  const flagged = new Set(excursions.filter((x) => x.decision === 'Impact: results flagged').flatMap((x) => x.affected_pull_ids || []));
  const lineTest = new Map(d.lines.map((l) => [l.id, l]));
  const tpOf = new Map(d.timepoints.map((t) => [t.id, t]));
  const cancelled = st.status === 'Cancelled';
  const pullStatus = (k, cond) => { const ps = pulls.filter((p) => tpKey(p) === k && p.condition_id === cond); return ps.find((p) => p.status !== 'Cancelled')?.status || (ps.length ? 'Cancelled' : null); };
  // the conditions: the study's version, then any it no longer has but stored material for
  const conds = d.conditions.map((c) => ({ condition_id: c.condition_id, condition_name: c.condition_name, condition_type: c.condition_type }));
  for (const s of storage) if (!conds.some((c) => c.condition_id === s.condition_id)) conds.push({ condition_id: s.condition_id, condition_name: s.condition_name, condition_type: 'No longer in the study', dropped: true });
  const sections = conds.map((cond) => {
    const keys = new Map([['T0', 'T0']]);
    const t0 = d.timepoints.find((t) => Number(t.interval_value) === 0); if (t0) keys.set('T0', t0.label);
    const add = (t) => { const k = tpKey(t); if (!keys.has(k)) keys.set(k, t.label || t.tp_label); };
    for (const c of d.cells) { if (c.condition_id === cond.condition_id) { const t = tpOf.get(c.timepoint_id); if (t) add(t); } }
    for (const p of pulls) if (p.condition_id === cond.condition_id && p.status !== 'Cancelled') add(p);
    for (const r of rows) if (r.condition_id === cond.condition_id) add({ interval_value: r.interval_value, interval_unit: r.interval_unit, tp_label: r.tp_label });
    const tps = [...keys.entries()].map(([k, label]) => ({ key: k, label, days: k === 'T0' ? 0 : tpDays({ interval_value: k.split('|')[0], interval_unit: k.split('|')[1] }) }))
      .sort((a, b) => a.days - b.days);
    const here = (r) => r.condition_id === cond.condition_id || (r.condition_id === null && Number(r.interval_value) === 0);
    const cellHere = (c) => c.condition_id === cond.condition_id || c.condition_id === null;
    const testIds = []; const names = new Map();
    for (const c of d.cells.filter(cellHere)) { const l = lineTest.get(c.line_id); if (l && !testIds.includes(l.test_id)) { testIds.push(l.test_id); names.set(l.test_id, l.test_name); } }
    for (const r of rows.filter(here)) if (!testIds.includes(r.test_id)) { testIds.push(r.test_id); names.set(r.test_id, r.test_name); }
    const tests = testIds.sort((a, b) => String(names.get(a)).localeCompare(String(names.get(b)))).map((tid) => {
      const mine = rows.filter((r) => r.test_id === tid && here(r));
      const shown = mine.filter((r) => r.analyte_id && (!issued || (r.finalized && r.stage === 'Final')));
      const byId = new Map(planned.filter((x) => x.test_id === tid).map((x) => [x.analyte_id, { ...x }]));
      for (const x of shown) byId.set(x.analyte_id, { ...(byId.get(x.analyte_id) || {}), ...Object.fromEntries(Object.entries(x).filter(([, v]) => v !== null && v !== undefined)) });
      const expected = (k) => mine.some((r) => tpKey(r) === k)
        || (!cancelled && pullStatus(k, k === 'T0' ? null : cond.condition_id) !== 'Cancelled'
            && d.cells.some((c) => { const l = lineTest.get(c.line_id); const t = tpOf.get(c.timepoint_id); return l && t && l.test_id === tid && tpKey(t) === k && (k === 'T0' ? c.condition_id === null : c.condition_id === cond.condition_id); }));
      return { test_name: names.get(tid), analytes: [...byId.values()].map((a) => {
        const spec = [a.min_value !== null && a.min_value !== undefined ? `≥ ${Number(a.min_value)}` : '', a.max_value !== null && a.max_value !== undefined ? `≤ ${Number(a.max_value)}` : '', a.text_value || ''].filter(Boolean).join(' and ');
        return { analyte_name: a.analyte_name, unit: a.unit || a.spec_unit || '', spec: spec ? `${spec}${a.spec_unit ? ' ' + a.spec_unit : ''}` : '',
          values: tps.map((t) => { const r = shown.find((x) => x.analyte_id === a.analyte_id && tpKey(x) === t.key);
            return r ? { text: r.reported, stage: r.stage, conformance: r.conformance, flagged: flagged.has(r.stability_pull_id) } : expected(t.key) ? { text: '', pending: true } : null; }) }; }) };
    });
    return { condition: cond, timepoints: tps, tests, storage: storage.filter((s) => s.condition_id === cond.condition_id) };
  });
  const resultIds = [...new Set(rows.filter((r) => r.result_id && r.finalized && r.stage === 'Final').map((r) => r.result_id))].sort();
  return { study: st, design: d, sections, excursions, amendments, storage, issued, result_ids: resultIds };
}

// The summary (study page, "Summary report (PDF)") or, with issue = { report_code, version_no, is_final, by, title,
// signature, at, tz }, the issued report the client is sent.
function reportHtml(r, issue = null) {
  const st = r.study;
  const cell = (v) => (v === null ? '<td class="c na">–</td>' : v.pending ? '<td class="c pend">pending</td>'
    : `<td class="c ${v.conformance === 'Does not conform' ? 'oos' : ''}">${esc(v.text)}${v.stage === 'Preliminary' ? '<sup>P</sup>' : ''}${v.flagged ? '<sup class="ex">E</sup>' : ''}</td>`);
  const tz = (issue && issue.tz) || undefined;
  const when = (v) => (v ? new Date(v).toLocaleString('en-US', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }) : '');
  const title = issue ? `Stability report ${issue.report_code}` : 'Stability summary report';
  const sub = issue ? `${issue.is_final ? 'Final report' : `Interim report, version ${issue.version_no}`} · ${esc(st.study_code)} · ${esc(st.project_code)} v${st.version_no}<br>Issued ${esc(when(issue.at))}`
    : `${esc(st.study_code)} · ${esc(st.project_code)} v${st.version_no}<br>Results as of ${esc(fmtDate(new Date()))} · not issued, not a Certificate of Analysis`;
  const exc = r.excursions.length ? `<h2>Chamber excursions and their assessment</h2>
    <table><thead><tr><th class="l">When</th><th class="l">Chamber</th><th class="l">Material</th><th class="l">Reading</th><th class="l">Back in range</th><th class="l">Assessment</th><th class="l">Justification</th><th class="l">Pulls concerned</th></tr></thead><tbody>
    ${r.excursions.map((x) => `<tr><td class="l">${esc(when(x.entry_at))}</td><td class="l">${esc(x.equipment_code)} ${esc(x.equipment_name)}</td><td class="l">${esc(x.storage_code)}</td>
      <td class="l">${esc((x.problems || []).join('; '))}${x.failure_reason ? ` (${esc(x.failure_reason)})` : ''}</td><td class="l">${x.window_end ? esc(when(x.window_end)) : 'not yet'}</td>
      <td class="l"><b>${esc(x.decision || 'Not assessed yet')}</b>${x.assessed_by_name ? `<br><span class="m">${esc(x.assessed_by_name)}, ${esc(when(x.assessed_at))}</span>` : ''}</td>
      <td class="l">${esc(x.justification || '')}</td><td class="l">${esc(x.affected_pulls || '')}</td></tr>`).join('')}</tbody></table>` : '';
  const amd = r.amendments.length ? `<h2>Amendments</h2><ul class="amd">${r.amendments.map((a) => `<li>Amendment ${a.amendment_no}: quote version ${a.to_version} (replacing version ${a.from_version}) accepted ${esc(when(a.applied_at))}: ${a.pulls_added} pull(s) added, ${a.pulls_cancelled} cancelled, ${a.pulls_changed} moved. Pulls already taken were not changed.</li>`).join('')}</ul>` : '';
  const can = st.status === 'Cancelled' ? `<h2>Study cancelled</h2><p>Cancelled ${esc(when(st.cancelled_at))} by ${esc(st.cancelled_by_name || '')}: ${esc(st.cancel_reason || '')}.
    Material: ${r.storage.map((s) => `${esc(s.storage_code)} (${esc(s.condition_name)}) ${esc({ Destroyed: 'destroyed', Returned: 'returned to the client', Retained: 'kept as a retain', 'Used up': 'used up', Stored: 'stored' }[s.status] || s.status)}${s.disposition_note ? ': ' + esc(s.disposition_note) : ''}`).join('; ')}.</p>` : '';
  const sig = issue ? `<div class="sig">${issue.signature ? `<img src="${issue.signature}" alt="Signature of ${esc(issue.by)}">` : '<div style="height:40px"></div>'}
    <div class="sigline">${esc(issue.by)}${issue.title ? `<br>${esc(issue.title)}` : ''}<br>Signed ${esc(when(issue.at))} (electronic signature)</div></div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font: 9pt Helvetica, Arial, sans-serif; color: #1d2329; margin: 0; }
    .head { display: flex; justify-content: space-between; border-bottom: 2px solid #1f3a2c; padding-bottom: 8px; margin-bottom: 10px; }
    .brand { font-size: 15pt; font-weight: 700; color: #1f3a2c; } h1 { margin: 0; font-size: 15pt; color: #1f3a2c; text-align: right; } .m { color: #5c6773; font-size: 8pt; }
    .facts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px 16px; margin-bottom: 8px; } .facts b { display: block; color: #5c6773; font-size: 7.5pt; text-transform: uppercase; }
    h2 { font-size: 11pt; color: #1f3a2c; margin: 14px 0 4px; border-bottom: 1px solid #c8d3cc; } h3 { font-size: 9.5pt; margin: 8px 0 2px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 6px; } th { background: #eef3f0; font-size: 7.5pt; padding: 3px 4px; text-align: center; border-bottom: 1px solid #c8d3cc; }
    th.l, td.l { text-align: left; } td { padding: 3px 4px; border-bottom: 1px solid #e6ebe8; font-size: 8pt; vertical-align: top; } .c { text-align: center; }
    .pend { color: #8a95a0; font-style: italic; } .na { color: #c0c7cd; } .oos { color: #b42318; font-weight: 700; } sup { color: #8a5a00; } sup.ex { color: #b42318; font-weight: 700; }
    .note { font-size: 7.5pt; color: #5c6773; margin-top: 10px; } .amd { margin: 0; padding-left: 16px; } .dropped { color: #5c6773; font-weight: 400; font-size: 8.5pt; }
    .sig { margin-top: 18px; width: 260px; } .sig img { max-height: 46px; max-width: 220px; } .sigline { border-top: 1px solid #1d2329; padding-top: 3px; font-size: 8pt; }
  </style></head><body>
  <div class="head"><div><div class="brand">Tentamus North America</div><div class="m">${esc(st.site_code)} · stability testing</div></div>
    <div><h1>${esc(title)}</h1><div class="m" style="text-align:right">${sub}</div></div></div>
  <div class="facts"><div><b>Client</b>${esc(st.client_name)}</div><div><b>Product</b>${esc(st.product || '')}</div><div><b>Lot</b>${esc(st.lot || '')}</div><div><b>Placed</b>${st.placement_date ? esc(dOnly(st.placement_date)) : 'not yet'}</div>
    <div><b>Study</b>${esc(st.study_code)} (${esc(st.status)})</div><div><b>Conditions</b>${esc(r.sections.map((s) => s.condition.condition_name).join('; '))}</div><div><b>Pulls</b>${st.pulls_done} of ${st.pulls_total} taken</div><div><b>Amendments</b>${st.amendment_no || 'none'}</div></div>
  ${r.sections.map((s) => `<h2>${esc(s.condition.condition_name)}${s.condition.dropped ? ' <span class="dropped">(no longer in the study)</span>' : ''}</h2>${s.tests.map((t) => `<h3>${esc(t.test_name)}</h3>
    <table><thead><tr><th class="l">Analyte</th><th class="l">Unit</th><th class="l">Specification</th>${s.timepoints.map((tp) => `<th>${esc(tp.label)}</th>`).join('')}</tr></thead><tbody>
    ${t.analytes.length ? t.analytes.map((a) => `<tr><td class="l">${esc(a.analyte_name)}</td><td class="l">${esc(a.unit)}</td><td class="l">${esc(a.spec)}</td>${a.values.map(cell).join('')}</tr>`).join('')
      : `<tr><td class="l pend" colspan="${3 + s.timepoints.length}">No results yet</td></tr>`}</tbody></table>`).join('')}`).join('')}
  ${exc}${amd}${can}
  <div class="note">T0 is the baseline, tested at placement, shown under every condition. ${issue ? 'Only finalized results are reported; pending: not yet pulled, tested or finalized.' : '<sup>P</sup> preliminary result (not final). Pending: the timepoint has not been pulled or reviewed yet.'}
    <sup class="ex">E</sup> material that was in a chamber during an excursion assessed as having an impact (see the excursions above). Each pull's results are also reported on its own Certificate of Analysis.</div>
  ${sig}
  </body></html>`;
}

async function reportPdf(db, studyId) {
  const r = await reportData(db, studyId);
  return COA.htmlToPdf(reportHtml(r), `${r.study.study_code} stability summary · Tentamus North America`);
}

module.exports = { design, priceByYear, quoteData, quoteHtml, reportData, reportHtml, reportPdf, intervalText, money, dOnly };
