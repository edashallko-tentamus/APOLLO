// Trending and control charts (T-1, migration 043). Built without Alex's input on his instruction (2026-10-17):
// "Anything with commonality as data or records can be control charted. Charts are downloadable. Some charts - like
// analyte charts can be applied. Be creative ... OOS etc."
//
// What is charted (sources):
//   results    approved sample results of a test's analyte (filters: client, matrix, product), against the specification
//   qc         QC checks of a test's approved batches (LCS / CCV recovery, blank value, RPD...), against the QC limits
//   logbook    a numeric logbook field (balance checks, temperatures, inoculum counts), per piece of equipment, against its limits
//   stability  a stability study's results over time per condition, with a regression and the shelf life (ICH Q1E style)
//   counts     events per week or month (OOS opened, OOS rate, re-preps, re-analyses, equipment failures, chamber excursions,
//              on-time reporting, turnaround, lots rejected by QA testing)
//   pareto     what the events are made of (OOS by test or by outcome, re-preps by test, failures by equipment or logbook)
// Charts: I-MR (individuals and moving range) for values; p for rates; c for counts; regression for stability; Pareto.
// Signals (Western Electric rules): R1 a point beyond 3 sigma; R2 2 of 3 beyond 2 sigma on one side; R3 4 of 5 beyond
// 1 sigma on one side; R4 8 in a row on one side; R5 6 in a row rising or falling; LIM a point outside its specification
// or acceptance limits. Limits are calculated from the points shown, or frozen from a baseline (a saved chart).
// Statistics are computed here, not in the database: charts are read-only views of approved records (nothing is
// written from them except a saved chart, frozen limits and signal reviews, which the database keeps).
'use strict';

const RULES = {
  R1: 'A point beyond 3 sigma',
  R2: '2 of 3 points beyond 2 sigma on the same side',
  R3: '4 of 5 points beyond 1 sigma on the same side',
  R4: '8 points in a row on the same side of the centre line',
  R5: '6 points in a row steadily rising or falling',
  LIM: 'A point outside its specification or acceptance limits',
};
const DEFAULT_RULES = ['R1', 'R2', 'R3', 'R4', 'R5', 'LIM'];

const COUNT_METRICS = {
  oos_opened: { title: 'OOS investigations opened', chart: 'c', test: true },
  oos_rate: { title: 'OOS rate (OOS per approved test)', chart: 'p', test: true },
  oos_confirmed: { title: 'OOS confirmed (no assignable cause)', chart: 'c', test: true },
  repreps: { title: 'Re-preparations requested', chart: 'c', test: true },
  reanalyses: { title: 'Re-analyses (analytical runs after the first)', chart: 'c', test: true },
  equipment_failures: { title: 'Failed equipment checks (logbooks)', chart: 'c' },
  excursions: { title: 'Stability chamber excursions', chart: 'c' },
  on_time: { title: 'Tests reported on time', chart: 'p', test: true },
  tat_days: { title: 'Turnaround, mean days from logging to report', chart: 'i', test: true },
  lots_rejected: { title: 'Inventory lots rejected by QA testing', chart: 'c' },
};
const PARETO_METRICS = {
  oos_by_test: 'OOS investigations by test',
  oos_by_outcome: 'OOS investigations by outcome',
  repreps_by_test: 'Re-preparations by test',
  failures_by_equipment: 'Failed equipment checks by equipment',
  failures_by_logbook: 'Failed logbook entries by logbook',
};

// what the y axis of an event chart measures (0.24.1: every axis names its quantity and unit)
const COUNT_AXIS = {
  oos_opened: 'OOS investigations', oos_rate: 'OOS rate', oos_confirmed: 'OOS confirmed', repreps: 'Re-preparations', reanalyses: 'Re-analyses',
  equipment_failures: 'Failed equipment checks', excursions: 'Excursions', on_time: 'Reported on time', tat_days: 'Turnaround', lots_rejected: 'Lots rejected',
};
// "Temperature (°C)": the quantity, then its unit when there is one worth showing
const axisOf = (label, unit) => (unit && unit !== 'count' ? `${label} (${unit})` : label);
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const iso = (d) => (d ? new Date(d).toISOString() : null);
const dayOf = (d) => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10) : '');

// ---------------------------------------------------------------- data
const rangeOf = (p, defDays) => {
  const to = p.to ? String(p.to).slice(0, 10) : null;
  const from = p.from ? String(p.from).slice(0, 10) : null;
  return { from, to, defDays };
};
const WHEN = (col, r) => `(${col} >= COALESCE($2::date, now()::date - ${r.defDays}) AND ${col} < COALESCE($3::date, now()::date) + 1)`;

async function sourceData(db, site, src, p) {
  const r = rangeOf(p, src === 'counts' || src === 'pareto' ? 365 : 365);
  const args = [site, r.from, r.to];
  if (src === 'results') {
    if (!p.test_id || !p.analyte_id) throw new Error('Choose a test and an analyte');
    const rows = await db.rows(`SELECT tr.id, tr.approved_at AS t, tr.value_num AS v, tr.reported, tr.unit, tr.spec_min, tr.spec_max, tr.conformance,
        s.id AS sample_id, s.sample_code, s.matrix, s.product, s.lot, COALESCE(c.display_name, c.legal_name) AS client_name
      FROM test_result tr JOIN requested_test rt ON rt.id = tr.requested_test_id JOIN sample s ON s.id = rt.sample_id
      JOIN lab_order o ON o.id = s.lab_order_id JOIN client c ON c.id = o.client_id
      WHERE o.site_id = $1 AND tr.status = 'Active' AND tr.stage = 'Final' AND tr.result_key IS NULL AND tr.value_num IS NOT NULL
        AND rt.test_id = $4 AND tr.analyte_id = $5 AND ${WHEN('tr.approved_at', r)}
        AND o.origin::text <> 'Workflow Verification' AND rt.media_lot_id IS NULL
        AND ($6::uuid IS NULL OR o.client_id = $6) AND ($7::text IS NULL OR s.matrix = $7) AND ($8::text IS NULL OR s.product ILIKE '%' || $8 || '%')
      ORDER BY tr.approved_at, s.sample_code`, [...args, p.test_id, p.analyte_id, p.client_id || null, p.matrix || null, p.product || null]);
    const lo = mode(rows.map((x) => num(x.spec_min))); const hi = mode(rows.map((x) => num(x.spec_max)));
    const unit = (rows[0] || {}).unit || await analyteUnit(db, p.test_id, p.analyte_id);
    return { unit, lsl: lo, usl: hi, limitsLabel: 'Specification', yLabel: axisOf(await analyteName(db, p.analyte_id) || 'Result', unit), xLabel: 'Date approved',
      points: rows.map((x) => ({ key: x.id, t: iso(x.t), v: num(x.v), label: x.sample_code, sub: [x.client_name, x.product, x.lot].filter(Boolean).join(' · '),
        href: '#/samples/' + x.sample_id, out: x.conformance === 'Does not conform' })) };
  }
  if (src === 'qc') {
    if (!p.test_id) throw new Error('Choose a test');
    // approved batches in the window; a batch being reviewed (QC Review) is added at the end, before its approval
    const batches = await db.rows(`SELECT b.id, b.batch_code, COALESCE(b.reviewed_at, clock_timestamp()) AS reviewed_at FROM test_batch b
      WHERE b.site_id = $1 AND b.test_id = $4 AND NOT b.is_verification
        AND ((b.status::text = 'Approved' AND ${WHEN('b.reviewed_at', r)}) OR b.id = ANY($5::uuid[]))
      ORDER BY COALESCE(b.reviewed_at, clock_timestamp()) DESC LIMIT 150`, [...args, p.test_id, p.include_batches || []]);
    const pts = []; let lo = null; let hi = null;
    for (const b of batches.reverse()) {
      const v = await db.rows(`SELECT entry_id, label, qc_type, limit_type, analyte_id, analyte_name, measured, min_value, max_value, verdict, run_no
        FROM batch_qc_verdicts($1) WHERE ($2::text IS NULL OR qc_type = $2) AND ($3::uuid IS NULL OR analyte_id = $3) AND ($4::text IS NULL OR limit_type = $4)
          AND measured IS NOT NULL`, [b.id, p.qc_type || null, p.analyte_id || null, p.limit_type || null]);
      for (const x of v) {
        if (lo === null && x.min_value !== null) lo = num(x.min_value);
        if (hi === null && x.max_value !== null) hi = num(x.max_value);
        pts.push({ key: `${b.id}:${x.entry_id}:${x.analyte_id}:${x.run_no}:${x.limit_type}`, t: iso(b.reviewed_at), v: num(x.measured), label: `${b.batch_code} ${x.label}`,
          sub: `${x.analyte_name || ''} · ${x.limit_type}${x.run_no > 1 ? ' · run ' + x.run_no : ''}`, href: '#/testing/batches/' + b.id, out: x.verdict === 'Fail', batch_id: b.id });
      }
    }
    // recoveries and relative differences are percentages; anything else is measured in the analyte's own unit
    const pct = p.limit_type && /Recovery|RPD|%/i.test(p.limit_type);
    const unit = pct ? '%' : p.analyte_id && p.analyte_id !== '*' ? await analyteUnit(db, p.test_id, p.analyte_id) : '';
    // "Recovery %" reads "Recovery (%)" on the axis, not "Recovery % (%)"
    const what = [p.qc_type && p.qc_type !== '*' ? p.qc_type : null, (p.limit_type || 'QC value').replace(/\s*%$/, '')].filter(Boolean).join(' ');
    return { unit, lsl: lo, usl: hi, limitsLabel: 'QC limits', points: pts, yLabel: axisOf(what, unit), xLabel: 'Batch approved' };
  }
  if (src === 'logbook') {
    if (!p.logbook_id || !p.field_key) throw new Error('Choose a logbook and a field');
    const f = await db.one(`SELECT f.id, f.label, f.unit FROM logbook_field f JOIN logbook_version v ON v.id = f.version_id
      JOIN logbook l ON l.id = v.logbook_id AND l.site_id = $3
      WHERE v.logbook_id = $1 AND f.field_key = $2 ORDER BY v.version_no DESC LIMIT 1`, [p.logbook_id, p.field_key, args[0]]);
    const rows = await db.rows(`SELECT e.id, e.entry_code, e.entry_at AS t, (e.entry_values->>$5)::numeric AS v, e.result, e.equipment_id, eq.equipment_code
      FROM logbook_entry e LEFT JOIN equipment eq ON eq.id = e.equipment_id
      WHERE e.site_id = $1 AND e.logbook_id = $4 AND e.status <> 'Voided' AND jsonb_typeof(e.entry_values->$5) = 'number' AND ${WHEN('e.entry_at', r)}
        AND e.sensor_kind IS DISTINCT FROM 'Excursion'   -- a sensor's logbook is charted by its hours (0.25.1)
        AND ($6::uuid IS NULL OR e.equipment_id = $6) ORDER BY e.entry_at`, [...args, p.logbook_id, p.field_key, p.equipment_id || null]);
    let lim = { lo: null, hi: null };
    if (f) lim = (await db.one('SELECT lo, hi FROM logbook_limits($1, $2)', [f.id, p.equipment_id || (rows[0] || {}).equipment_id || null])) || lim;
    return { unit: f ? f.unit || '' : '', lsl: num(lim.lo), usl: num(lim.hi), limitsLabel: 'Logbook limits', yLabel: axisOf(f ? f.label : p.field_key, f ? f.unit : ''), xLabel: 'Date recorded',
      points: rows.map((x) => ({ key: x.id, t: iso(x.t), v: num(x.v), label: x.entry_code, sub: x.equipment_code || '', href: '#/logbooks/entries/' + x.id, out: x.result === 'Fail' })) };
  }
  if (src === 'stability') {
    if (!p.study_id || !p.analyte_id) throw new Error('Choose a study and an analyte');
    const rows = await db.rows(`SELECT tr.id, tr.value_num AS v, tr.reported, tr.unit, tr.spec_min, tr.spec_max, c.condition_id, sc.condition_name,
        t.interval_value, t.interval_unit, sa.sample_code, sa.id AS sample_id
      FROM test_result tr JOIN requested_test rt ON rt.id = tr.requested_test_id JOIN stability_cell c ON c.id = rt.stability_cell_id
      JOIN stability_timepoint t ON t.id = c.timepoint_id JOIN sample sa ON sa.id = rt.sample_id LEFT JOIN stability_condition sc ON sc.id = c.condition_id
      WHERE rt.stability_study_id = $1 AND tr.analyte_id = $2 AND tr.status = 'Active' AND tr.result_key IS NULL AND tr.value_num IS NOT NULL
        AND rt.status <> 'Cancelled' AND NOT test_is_replaced(rt.id) AND ($3::uuid IS NULL OR rt.test_id = $3)
        AND EXISTS (SELECT 1 FROM stability_study st WHERE st.id = rt.stability_study_id AND st.site_id = $4)   -- this lab's studies only (0.32.0)`, [p.study_id, p.analyte_id, p.test_id || null, args[0]]);
    const months = (x) => (x.interval_unit === 'Months' ? Number(x.interval_value) : x.interval_unit === 'Weeks' ? Number(x.interval_value) * 7 / 30.44 : Number(x.interval_value) / 30.44);
    const sunit = (rows[0] || {}).unit || '';
    return { unit: sunit, lsl: mode(rows.map((x) => num(x.spec_min))), usl: mode(rows.map((x) => num(x.spec_max))), limitsLabel: 'Specification',
      yLabel: axisOf(await analyteName(db, p.analyte_id) || 'Result', sunit), xLabel: 'Months on stability',
      points: rows.map((x) => ({ key: x.id, x: months(x), v: num(x.v), series: x.condition_id || 'T0', seriesName: x.condition_name || 'T0 (baseline)', label: x.sample_code, href: '#/samples/' + x.sample_id })) };
  }
  if (src === 'counts') return countData(db, site, p, r);
  if (src === 'pareto') return paretoData(db, site, p, r);
  throw new Error('Unknown source');
}

const analyteName = async (db, id) => (id && id !== '*' ? ((await db.one('SELECT analyte_name FROM analyte WHERE id = $1', [id])) || {}).analyte_name || null : null);
// the analyte's reporting unit on the test's effective version (or any version that has it)
const analyteUnit = async (db, test, analyte) => {
  if (!test || !analyte || analyte === '*') return '';
  const r = await db.one(`SELECT tva.reporting_unit FROM test_version_analyte tva JOIN test_version tv ON tv.id = tva.test_version_id
    WHERE tv.test_id = $1 AND tva.analyte_id = $2 AND tva.reporting_unit IS NOT NULL ORDER BY (tv.status = 'Effective') DESC, tv.version_no DESC LIMIT 1`, [test, analyte]);
  return (r || {}).reporting_unit || '';
};
const mode = (arr) => { const m = new Map(); for (const x of arr) if (x !== null && !Number.isNaN(x)) m.set(x, (m.get(x) || 0) + 1); let best = null; let n = 0; for (const [k, c] of m) if (c > n) { best = k; n = c; } return best; };

async function countData(db, site, p, r) {
  const m = COUNT_METRICS[p.metric]; if (!m) throw new Error('Choose what to count');
  const per = p.period === 'Week' ? 'week' : 'month';
  const test = p.test_id || null;
  const B = (expr) => `date_trunc('${per}', ${expr})::date`;
  const series = `SELECT g::date AS period FROM generate_series(date_trunc('${per}', COALESCE($2::date, now()::date - 365)), date_trunc('${per}', COALESCE($3::date, now()::date)), interval '1 ${per}') g`;
  let sql;
  switch (p.metric) {
    case 'oos_opened': case 'oos_confirmed':
      sql = `SELECT s.period, (SELECT count(*) FROM oos_investigation x JOIN requested_test rt ON rt.id = x.requested_test_id WHERE x.site_id = $1 AND x.status <> 'Cancelled'
               AND ${B('x.opened_at')} = s.period AND ($4::uuid IS NULL OR rt.test_id = $4) ${p.metric === 'oos_confirmed' ? "AND x.conclusion = 'OOS confirmed'" : ''})::int AS d, NULL::int AS n FROM (${series}) s`; break;
    case 'oos_rate':
      sql = `SELECT s.period, (SELECT count(*) FROM oos_investigation x JOIN requested_test rt ON rt.id = x.requested_test_id WHERE x.site_id = $1 AND x.status <> 'Cancelled'
               AND ${B('x.opened_at')} = s.period AND ($4::uuid IS NULL OR rt.test_id = $4))::int AS d,
             (SELECT count(DISTINCT tr.requested_test_id) FROM test_result tr JOIN requested_test rt ON rt.id = tr.requested_test_id JOIN sample sa ON sa.id = rt.sample_id JOIN lab_order o ON o.id = sa.lab_order_id
               WHERE o.site_id = $1 AND tr.stage = 'Final' AND ${B('tr.approved_at')} = s.period AND ($4::uuid IS NULL OR rt.test_id = $4) AND o.origin::text <> 'Workflow Verification')::int AS n FROM (${series}) s`; break;
    case 'repreps':
      sql = `SELECT s.period, (SELECT count(*) FROM reprep_request x JOIN requested_test rt ON rt.id = x.requested_test_id JOIN sample sa ON sa.id = rt.sample_id JOIN lab_order o ON o.id = sa.lab_order_id
               WHERE o.site_id = $1 AND ${B('x.created_at')} = s.period AND ($4::uuid IS NULL OR rt.test_id = $4))::int AS d, NULL::int AS n FROM (${series}) s`; break;
    case 'reanalyses':
      sql = `SELECT s.period, (SELECT count(*) FROM analytical_run x JOIN step_run sr ON sr.id = x.step_run_id JOIN test_batch b ON b.id = sr.batch_id
               WHERE b.site_id = $1 AND x.run_no > 1 AND NOT b.is_verification AND ${B('x.created_at')} = s.period AND ($4::uuid IS NULL OR b.test_id = $4))::int AS d, NULL::int AS n FROM (${series}) s`; break;
    case 'equipment_failures':
      sql = `SELECT s.period, (SELECT count(*) FROM logbook_entry e WHERE e.site_id = $1 AND e.result = 'Fail' AND e.status <> 'Voided' AND e.equipment_id IS NOT NULL
               AND ${B('e.entry_at')} = s.period)::int AS d, NULL::int AS n FROM (${series}) s`; break;
    case 'excursions':
      sql = `SELECT s.period, (SELECT count(*) FROM logbook_entry e JOIN stability_chamber ch ON ch.equipment_id = e.equipment_id WHERE e.site_id = $1 AND e.result = 'Fail' AND e.status <> 'Voided'
               AND ${B('e.entry_at')} = s.period)::int AS d, NULL::int AS n FROM (${series}) s`; break;
    case 'on_time':
      sql = `SELECT s.period, (SELECT count(*) FROM test_tat_view x JOIN requested_test rt ON rt.id = x.requested_test_id WHERE x.site_id = $1 AND x.on_time AND ${B('x.reported_on')} = s.period AND ($4::uuid IS NULL OR rt.test_id = $4))::int AS d,
             (SELECT count(*) FROM test_tat_view x JOIN requested_test rt ON rt.id = x.requested_test_id WHERE x.site_id = $1 AND x.on_time IS NOT NULL AND ${B('x.reported_on')} = s.period AND ($4::uuid IS NULL OR rt.test_id = $4))::int AS n FROM (${series}) s`; break;
    case 'tat_days':
      sql = `SELECT s.period, (SELECT round(avg(COALESCE(x.login_days, 0) + COALESCE(x.lab_days, 0) + COALESCE(x.qa_days, 0)), 2) FROM test_tat_view x JOIN requested_test rt ON rt.id = x.requested_test_id
               WHERE x.site_id = $1 AND ${B('x.reported_on')} = s.period AND ($4::uuid IS NULL OR rt.test_id = $4)) AS d, NULL::int AS n FROM (${series}) s`; break;
    case 'lots_rejected':
      sql = `SELECT s.period, (SELECT count(*) FROM media_qualification q JOIN inventory_lot l ON l.id = q.lot_id WHERE l.site_id = $1 AND q.status = 'Failed' AND ${B('q.decided_at')} = s.period)::int AS d,
             NULL::int AS n FROM (${series}) s`; break;
    default: throw new Error('Unknown metric');
  }
  const rows = await db.rows(sql + ' ORDER BY 1', sql.includes('$4') ? [site, r.from, r.to, test] : [site, r.from, r.to]);
  const lab = (d) => (per === 'week' ? 'Week of ' + dayOf(d) : new Date(dayOf(d) + 'T00:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' }));
  const pts = rows.filter((x) => m.chart !== 'i' || x.d !== null).map((x) => ({ key: dayOf(x.period), t: dayOf(x.period), v: m.chart === 'p' ? (Number(x.n) ? Number(x.d) / Number(x.n) : null) : num(x.d),
    d: num(x.d), n: num(x.n), label: lab(x.period) })).filter((x) => m.chart !== 'p' || x.n);
  const noun = COUNT_AXIS[p.metric] || m.title;
  const yLabel = m.chart === 'p' ? `${noun} (%)` : m.chart === 'i' ? `${noun} (days)` : `${noun} per ${per}`;
  return { unit: m.chart === 'p' ? '%' : m.chart === 'i' ? 'days' : 'count', chart: m.chart, title: m.title, points: pts, period: per, yLabel, xLabel: per === 'week' ? 'Week' : 'Month' };
}

async function paretoData(db, site, p, r) {
  if (!PARETO_METRICS[p.metric]) throw new Error('Choose what to break down');
  const W = (col) => WHEN(col, r);
  const q = {
    oos_by_test: `SELECT t.test_name AS k, count(*)::int AS n FROM oos_investigation x JOIN requested_test rt ON rt.id = x.requested_test_id JOIN test t ON t.id = rt.test_id WHERE x.site_id = $1 AND x.status <> 'Cancelled' AND ${W('x.opened_at')} GROUP BY 1`,
    oos_by_outcome: `SELECT COALESCE(CASE WHEN x.conclusion = 'Assignable cause found' THEN 'Assignable cause: ' || COALESCE(NULLIF(btrim(x.assignable_cause), ''), 'not stated') ELSE x.conclusion END, 'Open') AS k, count(*)::int AS n FROM oos_investigation x WHERE x.site_id = $1 AND x.status <> 'Cancelled' AND ${W('x.opened_at')} GROUP BY 1`,
    repreps_by_test: `SELECT t.test_name AS k, count(*)::int AS n FROM reprep_request x JOIN requested_test rt ON rt.id = x.requested_test_id JOIN test t ON t.id = rt.test_id JOIN sample sa ON sa.id = rt.sample_id JOIN lab_order o ON o.id = sa.lab_order_id WHERE o.site_id = $1 AND ${W('x.created_at')} GROUP BY 1`,
    failures_by_equipment: `SELECT eq.equipment_code || ' ' || eq.equipment_name AS k, count(*)::int AS n FROM logbook_entry e JOIN equipment eq ON eq.id = e.equipment_id WHERE e.site_id = $1 AND e.result = 'Fail' AND e.status <> 'Voided' AND ${W('e.entry_at')} GROUP BY 1`,
    failures_by_logbook: `SELECT l.logbook_code || ' ' || l.logbook_name AS k, count(*)::int AS n FROM logbook_entry e JOIN logbook l ON l.id = e.logbook_id WHERE e.site_id = $1 AND e.result = 'Fail' AND e.status <> 'Voided' AND ${W('e.entry_at')} GROUP BY 1`,
  }[p.metric];
  const rows = await db.rows(q + ' ORDER BY 2 DESC, 1', [site, r.from, r.to]);
  const total = rows.reduce((s, x) => s + x.n, 0); let cum = 0;
  return { chart: 'pareto', title: PARETO_METRICS[p.metric], unit: 'count', total, yLabel: 'Number in the period', y2Label: 'Cumulative (%)',
    bars: rows.map((x) => { cum += x.n; return { label: x.k, n: x.n, cum_pct: total ? (100 * cum) / total : 0 }; }) };
}

// ---------------------------------------------------------------- statistics
function imr(values, frozen) {
  const v = values.filter((x) => x !== null && !Number.isNaN(x));
  const n = v.length;
  const mean = n ? v.reduce((s, x) => s + x, 0) / n : null;
  const mrs = []; for (let i = 1; i < n; i++) mrs.push(Math.abs(v[i] - v[i - 1]));
  const mrBar = mrs.length ? mrs.reduce((s, x) => s + x, 0) / mrs.length : null;
  const sdOverall = n > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : null;
  const sigmaWithin = mrBar !== null ? mrBar / 1.128 : null;
  const cl = frozen && frozen.cl !== null && frozen.cl !== undefined ? Number(frozen.cl) : mean;
  const sigma = frozen && frozen.sigma !== null && frozen.sigma !== undefined ? Number(frozen.sigma) : sigmaWithin;
  return { n, mean, cl, sigma, sigmaWithin, sdOverall, ucl: sigma !== null ? cl + 3 * sigma : null, lcl: sigma !== null ? cl - 3 * sigma : null,
    mrBar, mrUcl: mrBar !== null ? 3.267 * mrBar : null, mrs, frozen: !!(frozen && frozen.cl !== null && frozen.cl !== undefined),
    min: n ? Math.min(...v) : null, max: n ? Math.max(...v) : null };
}
function attribute(points, kind, frozen) {
  if (kind === 'p') {
    const D = points.reduce((s, x) => s + (x.d || 0), 0); const N = points.reduce((s, x) => s + (x.n || 0), 0);
    const pbar = frozen && frozen.cl !== null && frozen.cl !== undefined ? Number(frozen.cl) : N ? D / N : 0;
    for (const x of points) { const s = Math.sqrt(pbar * (1 - pbar) / x.n); x.cl = pbar; x.sigma = s; x.ucl = Math.min(1, pbar + 3 * s); x.lcl = Math.max(0, pbar - 3 * s); }
    return { n: points.length, cl: pbar, mean: pbar, total: D, of: N, frozen: !!(frozen && frozen.cl !== null && frozen.cl !== undefined) };
  }
  const cbar = frozen && frozen.cl !== null && frozen.cl !== undefined ? Number(frozen.cl) : points.length ? points.reduce((s, x) => s + (x.v || 0), 0) / points.length : 0;
  const s = Math.sqrt(cbar);
  for (const x of points) { x.cl = cbar; x.sigma = s; x.ucl = cbar + 3 * s; x.lcl = Math.max(0, cbar - 3 * s); }
  return { n: points.length, cl: cbar, mean: cbar, sigma: s, ucl: cbar + 3 * s, lcl: Math.max(0, cbar - 3 * s), total: points.reduce((t, x) => t + (x.v || 0), 0),
    frozen: !!(frozen && frozen.cl !== null && frozen.cl !== undefined) };
}
// Western Electric rules, on points carrying cl and sigma (I chart: the chart's; p and c: per point)
function signals(points, rules, lim) {
  const on = new Set(rules && rules.length ? rules : DEFAULT_RULES);
  const out = [];
  // p and c charts whose lower limit is 0 (rare events): a run of zeros below the centre line is not a signal, so the low side does not count
  const z = points.map((p) => { if (p.v === null || !p.sigma) return null; const v = (p.v - p.cl) / p.sigma; return v < 0 && p.lcl !== undefined && p.lcl <= 0 ? 0 : v; });
  const add = (i, rule) => { if (!out.some((s) => s.i === i && s.rule === rule)) out.push({ i, rule, key: points[i].key, label: points[i].label, text: RULES[rule] }); };
  for (let i = 0; i < points.length; i++) {
    if (z[i] === null) continue;
    if (on.has('R1') && Math.abs(z[i]) > 3) add(i, 'R1');
    if (on.has('R2') && i >= 2) { for (const sg of [1, -1]) { const c = [i - 2, i - 1, i].filter((k) => z[k] !== null && z[k] * sg > 2).length; if (c >= 2 && z[i] * sg > 2) add(i, 'R2'); } }
    if (on.has('R3') && i >= 4) { for (const sg of [1, -1]) { const c = [i - 4, i - 3, i - 2, i - 1, i].filter((k) => z[k] !== null && z[k] * sg > 1).length; if (c >= 4 && z[i] * sg > 1) add(i, 'R3'); } }
    if (on.has('R4') && i >= 7) { for (const sg of [1, -1]) { let ok = true; for (let k = i - 7; k <= i; k++) if (z[k] === null || z[k] * sg <= 0) ok = false; if (ok) add(i, 'R4'); } }
    if (on.has('R5') && i >= 5) { let up = true; let dn = true; for (let k = i - 4; k <= i; k++) { const a = points[k - 1].v; const b = points[k].v; if (a === null || b === null || !(b > a)) up = false; if (a === null || b === null || !(b < a)) dn = false; } if (up || dn) add(i, 'R5'); }
    if (on.has('LIM') && lim && ((lim.lsl !== null && lim.lsl !== undefined && points[i].v < lim.lsl) || (lim.usl !== null && lim.usl !== undefined && points[i].v > lim.usl) || points[i].out)) add(i, 'LIM');
  }
  return out.sort((a, b) => a.i - b.i);
}
function capability(st, lsl, usl) {
  if ((lsl === null || lsl === undefined) && (usl === null || usl === undefined)) return null;
  const c = { n: st.n, note: st.n < 20 ? 'Fewer than 20 points: indicative only' : '' };
  if (st.sigmaWithin) {
    if (lsl !== null && lsl !== undefined && usl !== null && usl !== undefined) c.cp = (usl - lsl) / (6 * st.sigmaWithin);
    c.cpk = Math.min(usl !== null && usl !== undefined ? (usl - st.mean) / (3 * st.sigmaWithin) : Infinity, lsl !== null && lsl !== undefined ? (st.mean - lsl) / (3 * st.sigmaWithin) : Infinity);
  }
  if (st.sdOverall) c.ppk = Math.min(usl !== null && usl !== undefined ? (usl - st.mean) / (3 * st.sdOverall) : Infinity, lsl !== null && lsl !== undefined ? (st.mean - lsl) / (3 * st.sdOverall) : Infinity);
  return c;
}
// one-sided 95 % t quantiles (df 1 to 30), then the normal value
const T95 = [6.314, 2.920, 2.353, 2.132, 2.015, 1.943, 1.895, 1.860, 1.833, 1.812, 1.796, 1.782, 1.771, 1.761, 1.753, 1.746, 1.740, 1.734, 1.729, 1.725, 1.721, 1.717, 1.714, 1.711, 1.708, 1.706, 1.703, 1.701, 1.699, 1.697];
const t95 = (df) => (df < 1 ? null : df <= 30 ? T95[df - 1] : 1.645);
// Least squares per condition (T0 joins every condition), the one-sided 95 % confidence bound of the mean, and the
// time where it crosses the specification (ICH Q1E's approach), capped at twice the longest time measured
function regression(points, lsl, usl) {
  const conds = [...new Set(points.filter((p) => p.series !== 'T0').map((p) => p.series))];
  const t0 = points.filter((p) => p.series === 'T0');
  return conds.map((c) => {
    const ps = [...t0, ...points.filter((p) => p.series === c)].filter((p) => p.v !== null);
    const n = ps.length; const name = (points.find((p) => p.series === c) || {}).seriesName || c;
    if (n < 3) return { series: c, name, n, note: 'Fewer than 3 points: no regression yet' };
    const mx = ps.reduce((s, p) => s + p.x, 0) / n; const my = ps.reduce((s, p) => s + p.v, 0) / n;
    const sxx = ps.reduce((s, p) => s + (p.x - mx) ** 2, 0);
    if (!sxx) return { series: c, name, n, note: 'All points at one time: no regression yet' };
    const slope = ps.reduce((s, p) => s + (p.x - mx) * (p.v - my), 0) / sxx; const icpt = my - slope * mx;
    const sse = ps.reduce((s, p) => s + (p.v - (icpt + slope * p.x)) ** 2, 0); const se = Math.sqrt(sse / (n - 2 || 1));
    const tq = t95(n - 2);
    const band = (x) => tq * se * Math.sqrt(1 / n + (x - mx) ** 2 / sxx);
    const xmax = Math.max(...ps.map((p) => p.x)); const horizon = Math.max(24, xmax * 2);
    let shelf = null; let side = null;
    for (let x = 0; x <= horizon + 1e-9; x += 0.05) {
      const y = icpt + slope * x;
      if (lsl !== null && lsl !== undefined && y - band(x) < lsl) { shelf = x; side = 'lower'; break; }
      if (usl !== null && usl !== undefined && y + band(x) > usl) { shelf = x; side = 'upper'; break; }
    }
    const r2 = 1 - sse / ps.reduce((s, p) => s + (p.v - my) ** 2, 0 || 1);
    return { series: c, name, n, slope, intercept: icpt, r2, se, band, xmax, horizon, shelf, side,
      note: shelf === null ? `The 95 % bound stays inside the specification to ${Math.round(horizon)} months` : `The 95 % ${side} bound reaches the specification at ${shelf.toFixed(1)} months` };
  });
}

// ---------------------------------------------------------------- the chart (data, statistics, signals, SVG)
async function build(db, site, def) {
  const src = def.source; const p = def.params || {};
  const d = await sourceData(db, site, src, { ...p, include_batches: (def.highlight || []).filter((x) => /^[0-9a-f-]{36}$/i.test(x)) });
  const out = { source: src, params: p, unit: d.unit, lsl: d.lsl ?? null, usl: d.usl ?? null, limitsLabel: d.limitsLabel, title: def.title || d.title || '',
    yLabel: d.yLabel || axisOf('Value', d.unit), y2Label: d.y2Label || null, xLabel: d.xLabel || 'Date', highlighted: (def.highlight || []).length > 0 };
  if (src === 'pareto') { out.chart = 'pareto'; out.bars = d.bars; out.total = d.total; out.svg = renderPareto(out); return out; }
  if (src === 'stability') { out.chart = 'regression'; out.points = d.points; out.fits = regression(d.points, out.lsl, out.usl); out.svg = renderRegression(out);
    out.fits = out.fits.map(({ band, ...x }) => x); return out; }
  const kind = src === 'counts' ? d.chart : 'i';
  out.chart = kind; out.period = d.period;
  const pts = d.points.filter((x) => x.v !== null);
  if (kind === 'i') {
    const st = imr(pts.map((x) => x.v), def.frozen);
    for (const x of pts) { x.cl = st.cl; x.sigma = st.sigma; }
    out.stats = st; out.capability = capability(st, out.lsl, out.usl);
    out.signals = signals(pts, def.rules, { lsl: out.lsl, usl: out.usl });
  } else {
    out.stats = attribute(pts, kind, def.frozen);
    out.signals = signals(pts, (def.rules || DEFAULT_RULES).filter((r) => r !== 'LIM'), null);
  }
  out.points = pts;
  out.svg = renderControl(out, def.highlight);
  if (kind === 'i') out.mrSvg = renderMR(out);
  out.hist = kind === 'i' && pts.length >= 5 ? renderHistogram(out) : null;
  delete out.stats.mrs;
  return out;
}

// ---------------------------------------------------------------- SVG
// 0.24.1 (Alex, 2026-10-19): every chart names what its axes measure, with the unit ("Temperature (°C)", "Excursions
// per month"), counts are drawn on whole numbers, and the key under the chart shows each line and mark as it is drawn
// (a short sample of the line or the dot) next to its name, instead of a sentence describing them.
const C = { ink: '#1d2a33', muted: '#66737f', grid: '#e7ecef', cl: '#1f7a52', lim: '#b45309', warn: '#f4ede1', zone: '#eef6f1', spec: '#6d28d9', pt: '#34495e', sig: '#c0392b', hl: '#0b6e99', bar: '#3b6e8f' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (v, d = 3) => { if (v === null || v === undefined || Number.isNaN(v)) return ''; const a = Math.abs(v); if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(2); return Number(v.toPrecision(d + (a >= 100 ? 1 : 0))).toString(); };
// tick values; whole numbers only for counts (no "0.2 events")
function niceTicks(lo, hi, n = 6, whole = false) {
  if (lo === hi) { lo -= 1; hi += 1; }
  const span = hi - lo; const step0 = span / n; const mag = 10 ** Math.floor(Math.log10(step0)); const r = step0 / mag;
  let step = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
  if (whole) step = Math.max(1, Math.round(step));
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(12));
  return out;
}
function frame(W, H, title, sub) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Helvetica, Arial, sans-serif" role="img" aria-label="${esc(title)}">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <text x="16" y="24" font-size="15" font-weight="700" fill="${C.ink}">${esc(title)}</text>
  ${sub ? `<text x="16" y="42" font-size="11.5" fill="${C.muted}">${esc(sub)}</text>` : ''}`;
}
// the axis titles: y rotated along the left edge, centred on the plot; x centred under the tick labels
const yTitle = (text, T, B, H, x = 16) => (text ? `<text x="${x}" y="${(T + H - B) / 2}" font-size="11.5" font-weight="600" fill="${C.ink}" text-anchor="middle" transform="rotate(-90 ${x} ${(T + H - B) / 2})">${esc(text)}</text>` : '');
const xTitle = (text, L, R, W, y) => (text ? `<text x="${(L + W - R) / 2}" y="${y}" font-size="11.5" font-weight="600" fill="${C.ink}" text-anchor="middle">${esc(text)}</text>` : '');
// the key: each item drawn as it appears on the chart (line sample, dot, ring or shaded box) followed by its name
function key(items, x0, y, maxW) {
  let x = x0; let s = '';
  for (const it of items) {
    const w = 30 + it.label.length * 6.3 + 18;
    if (x + w > x0 + maxW) break;
    if (it.kind === 'line') s += `<line x1="${x}" x2="${x + 24}" y1="${y - 4}" y2="${y - 4}" stroke="${it.color}" stroke-width="${it.width || 1.8}" ${it.dash ? `stroke-dasharray="${it.dash}"` : ''}/>`;
    if (it.kind === 'dot') s += `<circle cx="${x + 12}" cy="${y - 4}" r="${it.r || 4}" fill="${it.color}" stroke="#fff" stroke-width="1"/>`;
    if (it.kind === 'ring') s += `<circle cx="${x + 12}" cy="${y - 4}" r="3.4" fill="${C.hl}"/><circle cx="${x + 12}" cy="${y - 4}" r="7" fill="none" stroke="${C.hl}" stroke-width="1.5"/>`;
    if (it.kind === 'box') s += `<rect x="${x + 2}" y="${y - 10}" width="20" height="12" fill="${it.color}" stroke="#d5dde2"/>`;
    if (it.kind === 'bar') s += `<rect x="${x + 4}" y="${y - 11}" width="16" height="13" fill="${it.color}" opacity=".75"/>`;
    s += `<text x="${x + 30}" y="${y}" font-size="11" fill="${C.ink}">${esc(it.label)}</text>`;
    x += w;
  }
  return s;
}
function controlKey(ch) {
  const it = [{ kind: 'dot', color: C.pt, r: 3.4, label: ch.source === 'logbook' ? 'Reading' : ch.source === 'counts' ? (ch.chart === 'p' ? 'Rate' : ch.chart === 'i' ? 'Mean' : 'Count') : ch.source === 'qc' ? 'QC value' : 'Result' },
    { kind: 'dot', color: C.sig, r: 4.5, label: 'Signal' },
    { kind: 'line', color: C.cl, label: ch.stats && ch.stats.frozen ? 'Centre line (frozen)' : 'Centre line' },
    { kind: 'line', color: C.lim, dash: '6 4', label: 'Control limits (± 3 sigma)' }];
  if (ch.chart === 'i' && ((ch.lsl !== null && ch.lsl !== undefined) || (ch.usl !== null && ch.usl !== undefined))) it.push({ kind: 'line', color: C.spec, dash: '2 3', label: ch.limitsLabel || 'Limits' });
  if (ch.chart === 'i' && ch.stats && ch.stats.sigma) it.push({ kind: 'box', color: C.zone, label: 'Within 1 sigma' }, { kind: 'box', color: C.warn, label: '2 to 3 sigma' });
  if (ch.highlighted) it.push({ kind: 'ring', label: 'This batch' });
  return it;
}
function renderControl(ch, highlight) {
  const W = 1000; const H = 440; const L = 82; const R = 150; const T = 58; const B = 108;
  const pts = ch.points; const pc = ch.chart === 'p' ? 100 : 1;
  const st = ch.stats;
  const vals = pts.map((p) => p.v * pc);
  const ys = [...vals];
  if (ch.chart === 'i') { if (st.ucl !== null) ys.push(st.ucl, st.lcl); }
  else { for (const p of pts) ys.push(p.ucl * pc, p.lcl * pc); }
  if (ch.lsl !== null && ch.lsl !== undefined) ys.push(ch.lsl);
  if (ch.usl !== null && ch.usl !== undefined) ys.push(ch.usl);
  let lo = ys.length ? Math.min(...ys) : 0; let hi = ys.length ? Math.max(...ys) : 1; const pad = (hi - lo || Math.abs(hi) || 1) * 0.08; lo -= pad; hi += pad;
  if (ch.chart !== 'i' && lo < 0) lo = 0;
  if (ch.chart === 'c' && hi < 2) hi = 2;   // a count chart always shows at least 0, 1 and 2
  const X = (i) => L + (pts.length <= 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (pts.length - 1));
  const Y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const sigSet = new Set((ch.signals || []).map((s) => s.i));
  const hl = new Set(highlight || []);
  let s = frame(W, H, ch.title || 'Control chart', chartSub(ch));
  // zones (I chart): within 1 sigma pale green, 2 to 3 sigma pale amber
  if (ch.chart === 'i' && st.sigma) {
    const z = (a, b, col) => `<rect x="${L}" y="${Y(b)}" width="${W - L - R}" height="${Math.max(0, Y(a) - Y(b))}" fill="${col}"/>`;
    s += z(st.cl - st.sigma, st.cl + st.sigma, C.zone) + z(st.cl + 2 * st.sigma, st.cl + 3 * st.sigma, C.warn) + z(st.cl - 3 * st.sigma, st.cl - 2 * st.sigma, C.warn);
  }
  for (const t of niceTicks(lo, hi, 6, ch.chart === 'c')) s += `<line x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}" stroke="${C.grid}"/><text x="${L - 8}" y="${Y(t) + 4}" font-size="11" text-anchor="end" fill="${C.muted}">${esc(fmt(t))}</text>`;
  const hline = (v, col, dash, label) => { if (v === null || v === undefined || Number.isNaN(v)) return; s += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${col}" stroke-width="1.6" ${dash ? `stroke-dasharray="${dash}"` : ''}/><text x="${W - R + 6}" y="${Y(v) + 4}" font-size="11" fill="${col}">${esc(label)} ${esc(fmt(v))}</text>`; };
  if (ch.chart === 'i') { hline(st.ucl, C.lim, '6 4', 'UCL'); hline(st.cl, C.cl, '', 'CL'); hline(st.lcl, C.lim, '6 4', 'LCL'); }
  else {
    hline(st.cl * pc, C.cl, '', 'CL');
    const step = (key) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(i)},${Y(p[key] * pc)}`).join(' ');
    if (pts.length) s += `<path d="${step('ucl')}" fill="none" stroke="${C.lim}" stroke-dasharray="6 4" stroke-width="1.4"/><path d="${step('lcl')}" fill="none" stroke="${C.lim}" stroke-dasharray="6 4" stroke-width="1.4"/>`
      + `<text x="${W - R + 6}" y="${Y(pts[pts.length - 1].ucl * pc) + 4}" font-size="11" fill="${C.lim}">UCL ${esc(fmt(pts[pts.length - 1].ucl * pc))}</text>`;
  }
  if (ch.chart === 'i') { hline(ch.usl, C.spec, '2 3', ch.source === 'qc' ? 'Max' : 'USL'); hline(ch.lsl, C.spec, '2 3', ch.source === 'qc' ? 'Min' : 'LSL'); }
  const u = ch.chart === 'p' ? ' %' : ch.unit && ch.unit !== 'count' ? ' ' + ch.unit : '';
  if (pts.length) s += `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.v * pc).toFixed(1)}`).join(' ')}" fill="none" stroke="${C.pt}" stroke-width="1.3" opacity=".7"/>`;
  pts.forEach((p, i) => {
    const sig = sigSet.has(i); const h = hl.has(p.key) || (p.batch_id && hl.has(p.batch_id));
    s += `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.v * pc).toFixed(1)}" r="${h ? 6 : sig ? 5 : 3.4}" fill="${sig ? C.sig : h ? C.hl : C.pt}" stroke="#fff" stroke-width="1"><title>${esc(`${p.label}: ${fmt(p.v * pc, 4)}${u}${p.sub ? ' · ' + p.sub : ''}${p.t ? ' · ' + dayOf(p.t) : ''}`)}</title></circle>`;
    if (h) s += `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.v * pc).toFixed(1)}" r="9" fill="none" stroke="${C.hl}" stroke-width="1.5"/>`;
  });
  // x labels: at most 10, dates or period names
  const every = Math.max(1, Math.ceil(pts.length / 10));
  pts.forEach((p, i) => { if (i % every === 0 || i === pts.length - 1) s += `<text x="${X(i)}" y="${H - B + 18}" font-size="10.5" text-anchor="end" transform="rotate(-30 ${X(i)} ${H - B + 18})" fill="${C.muted}">${esc(ch.source === 'counts' ? p.label : dayOf(p.t))}</text>`; });
  s += `<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="#c3ccd3"/><line x1="${L}" x2="${L}" y1="${T}" y2="${H - B}" stroke="#c3ccd3"/>`;
  s += yTitle(ch.yLabel, T, B, H) + xTitle(ch.xLabel, L, R, W, H - B + 62);
  if (!pts.length) s += `<text x="${(W - R + L) / 2}" y="${(T + H - B) / 2}" text-anchor="middle" font-size="14" fill="${C.muted}">No data in this period</text>`;
  s += key(controlKey(ch), 16, H - 14, W - 32) + '</svg>';
  return s;
}
function renderMR(ch) {
  const W = 1000; const H = 200; const L = 82; const R = 150; const T = 30; const B = 34;
  const st = ch.stats; const mrs = st.mrs || [];
  let s = frame(W, H, 'Moving range', '');
  if (!mrs.length) return s + `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="12" fill="${C.muted}">Needs at least two points</text></svg>`;
  const hi = Math.max(...mrs, st.mrUcl || 0) * 1.1 || 1;
  const n = mrs.length + 1;
  const X = (i) => L + (n <= 1 ? 0 : (i * (W - L - R)) / (n - 1)); const Y = (v) => T + (H - T - B) * (1 - v / hi);
  for (const t of niceTicks(0, hi, 3)) s += `<line x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}" stroke="${C.grid}"/><text x="${L - 8}" y="${Y(t) + 4}" font-size="10.5" text-anchor="end" fill="${C.muted}">${esc(fmt(t))}</text>`;
  s += `<line x1="${L}" x2="${W - R}" y1="${Y(st.mrBar)}" y2="${Y(st.mrBar)}" stroke="${C.cl}" stroke-width="1.5"/><text x="${W - R + 6}" y="${Y(st.mrBar) + 4}" font-size="11" fill="${C.cl}">MR̄ ${esc(fmt(st.mrBar))}</text>`;
  s += `<line x1="${L}" x2="${W - R}" y1="${Y(st.mrUcl)}" y2="${Y(st.mrUcl)}" stroke="${C.lim}" stroke-dasharray="6 4" stroke-width="1.5"/><text x="${W - R + 6}" y="${Y(st.mrUcl) + 4}" font-size="11" fill="${C.lim}">UCL ${esc(fmt(st.mrUcl))}</text>`;
  s += `<path d="${mrs.map((m, i) => `${i ? 'L' : 'M'}${X(i + 1).toFixed(1)},${Y(m).toFixed(1)}`).join(' ')}" fill="none" stroke="${C.pt}" stroke-width="1.2"/>`;
  mrs.forEach((m, i) => { s += `<circle cx="${X(i + 1).toFixed(1)}" cy="${Y(m).toFixed(1)}" r="2.8" fill="${m > st.mrUcl ? C.sig : C.pt}"/>`; });
  s += `<line x1="${L}" x2="${L}" y1="${T}" y2="${H - B}" stroke="#c3ccd3"/>` + yTitle(axisOf('Moving range', ch.unit), T, B, H);
  s += key([{ kind: 'dot', color: C.pt, r: 3, label: 'Difference from the point before' }, { kind: 'dot', color: C.sig, r: 3.5, label: 'Above its limit' },
    { kind: 'line', color: C.cl, label: 'Average moving range' }, { kind: 'line', color: C.lim, dash: '6 4', label: 'Upper limit' }], 16, H - 8, W - 32);
  return s + '</svg>';
}
function renderHistogram(ch) {
  const W = 1000; const H = 270; const L = 82; const R = 150; const T = 30; const B = 64;
  const v = ch.points.map((p) => p.v); const st = ch.stats;
  const lo0 = Math.min(...v, ch.lsl ?? Infinity, st.lcl ?? Infinity); const hi0 = Math.max(...v, ch.usl ?? -Infinity, st.ucl ?? -Infinity);
  const pad = (hi0 - lo0 || 1) * 0.05; const lo = lo0 - pad; const hi = hi0 + pad;
  const k = Math.max(5, Math.min(20, Math.ceil(Math.sqrt(v.length)) + 2)); const w = (hi - lo) / k;
  const bins = new Array(k).fill(0); for (const x of v) bins[Math.min(k - 1, Math.max(0, Math.floor((x - lo) / w)))] += 1;
  const top = Math.max(...bins) * 1.15 || 1;
  const X = (x) => L + ((x - lo) / (hi - lo)) * (W - L - R); const Y = (c) => T + (H - T - B) * (1 - c / top);
  let s = frame(W, H, 'Distribution', '');
  for (const t of niceTicks(0, top, 4, true)) s += `<line x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}" stroke="${C.grid}"/><text x="${L - 8}" y="${Y(t) + 4}" font-size="10.5" text-anchor="end" fill="${C.muted}">${esc(fmt(t))}</text>`;
  bins.forEach((c, i) => { s += `<rect x="${X(lo + i * w) + 1}" y="${Y(c)}" width="${Math.max(0, X(lo + (i + 1) * w) - X(lo + i * w) - 2)}" height="${H - B - Y(c)}" fill="${C.bar}" opacity=".75"><title>${c}</title></rect>`; });
  // the normal curve from the mean and the overall standard deviation
  if (st.sdOverall) {
    const path = []; for (let i = 0; i <= 80; i++) { const x = lo + (i / 80) * (hi - lo); const y = (v.length * w) * Math.exp(-0.5 * ((x - st.mean) / st.sdOverall) ** 2) / (st.sdOverall * Math.sqrt(2 * Math.PI)); path.push(`${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(y).toFixed(1)}`); }
    s += `<path d="${path.join(' ')}" fill="none" stroke="${C.cl}" stroke-width="1.6"/>`;
  }
  const vl = (x, col, label) => { if (x === null || x === undefined) return; s += `<line x1="${X(x)}" x2="${X(x)}" y1="${T}" y2="${H - B}" stroke="${col}" stroke-dasharray="3 3" stroke-width="1.5"/><text x="${X(x) + 3}" y="${T + 10}" font-size="10.5" fill="${col}">${esc(label)}</text>`; };
  vl(ch.lsl, C.spec, 'LSL'); vl(ch.usl, C.spec, 'USL');
  for (const t of niceTicks(lo, hi)) s += `<text x="${X(t)}" y="${H - B + 15}" font-size="10.5" text-anchor="middle" fill="${C.muted}">${esc(fmt(t))}</text>`;
  const c = ch.capability;
  if (c) s += `<text x="${W - R + 6}" y="${T + 20}" font-size="11.5" fill="${C.ink}">${c.cp !== undefined ? 'Cp ' + fmt(c.cp, 2) : ''}</text><text x="${W - R + 6}" y="${T + 38}" font-size="11.5" fill="${C.ink}">${c.cpk !== undefined && Number.isFinite(c.cpk) ? 'Cpk ' + fmt(c.cpk, 2) : ''}</text><text x="${W - R + 6}" y="${T + 56}" font-size="11.5" fill="${C.ink}">${c.ppk !== undefined && Number.isFinite(c.ppk) ? 'Ppk ' + fmt(c.ppk, 2) : ''}</text>`;
  s += `<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="#c3ccd3"/><line x1="${L}" x2="${L}" y1="${T}" y2="${H - B}" stroke="#c3ccd3"/>`;
  s += yTitle('Number of points', T, B, H) + xTitle(ch.yLabel, L, R, W, H - B + 32);
  const it = [{ kind: 'bar', color: C.bar, label: 'Points in each range' }, { kind: 'line', color: C.cl, label: 'Normal curve (mean, overall SD)' }];
  if ((ch.lsl !== null && ch.lsl !== undefined) || (ch.usl !== null && ch.usl !== undefined)) it.push({ kind: 'line', color: C.spec, dash: '3 3', label: ch.limitsLabel || 'Limits' });
  return s + key(it, 16, H - 8, W - 32) + '</svg>';
}
function renderPareto(ch) {
  const W = 1000; const H = 430; const L = 82; const R = 90; const T = 58; const B = 130;
  const bars = ch.bars.slice(0, 15);
  let s = frame(W, H, ch.title || 'Pareto', `${ch.total} in the period${ch.bars.length > 15 ? ' (the 15 largest shown)' : ''}`);
  if (!bars.length) return s + `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="14" fill="${C.muted}">Nothing in this period</text></svg>`;
  const top = Math.max(2, Math.max(...bars.map((b) => b.n)) * 1.1); const bw = (W - L - R) / bars.length;
  const Y = (v) => T + (H - T - B) * (1 - v / top); const Yp = (v) => T + (H - T - B) * (1 - v / 100);
  for (const t of niceTicks(0, top, 4, true)) s += `<line x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}" stroke="${C.grid}"/><text x="${L - 8}" y="${Y(t) + 4}" font-size="11" text-anchor="end" fill="${C.muted}">${esc(fmt(t))}</text>`;
  bars.forEach((b, i) => {
    const x = L + i * bw;
    s += `<rect x="${x + bw * 0.12}" y="${Y(b.n)}" width="${bw * 0.76}" height="${H - B - Y(b.n)}" fill="${i < 3 ? C.sig : C.bar}" opacity="${i < 3 ? 0.85 : 0.7}"><title>${esc(b.label)}: ${b.n}</title></rect>`
      + `<text x="${x + bw / 2}" y="${Y(b.n) - 5}" font-size="11" text-anchor="middle" fill="${C.ink}">${b.n}</text>`
      + `<text x="${x + bw / 2}" y="${H - B + 14}" font-size="10.5" text-anchor="end" transform="rotate(-35 ${x + bw / 2} ${H - B + 14})" fill="${C.muted}">${esc(String(b.label).slice(0, 34))}</text>`;
  });
  s += `<path d="${bars.map((b, i) => `${i ? 'L' : 'M'}${(L + i * bw + bw / 2).toFixed(1)},${Yp(b.cum_pct).toFixed(1)}`).join(' ')}" fill="none" stroke="${C.cl}" stroke-width="2"/>`;
  bars.forEach((b, i) => { s += `<circle cx="${L + i * bw + bw / 2}" cy="${Yp(b.cum_pct)}" r="3" fill="${C.cl}"/>`; });
  s += `<line x1="${L}" x2="${W - R}" y1="${Yp(80)}" y2="${Yp(80)}" stroke="${C.cl}" stroke-dasharray="3 4" opacity=".6"/>`;
  for (const t of [0, 50, 80, 100]) s += `<text x="${W - R + 6}" y="${Yp(t) + 4}" font-size="10.5" fill="${C.muted}">${t} %</text>`;
  s += `<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="#c3ccd3"/><line x1="${L}" x2="${L}" y1="${T}" y2="${H - B}" stroke="#c3ccd3"/>`;
  s += yTitle(ch.yLabel || 'Number', T, B, H) + yTitle(ch.y2Label || 'Cumulative (%)', T, B, H, W - 18);
  return s + key([{ kind: 'bar', color: C.sig, label: 'The three largest' }, { kind: 'bar', color: C.bar, label: 'Others' },
    { kind: 'line', color: C.cl, label: 'Cumulative share' }, { kind: 'line', color: C.cl, dash: '3 4', label: '80 % mark' }], 16, H - 14, W - 32) + '</svg>';
}
const SERIES = ['#1f7a52', '#b45309', '#0b6e99', '#7c3aed', '#be185d'];
function renderRegression(ch) {
  const W = 1000; const H = 430; const L = 82; const R = 190; const T = 58; const B = 82;
  const pts = ch.points; const fits = ch.fits;
  const xmax = Math.max(12, ...pts.map((p) => p.x), ...fits.filter((f) => f.horizon).map((f) => Math.min(f.horizon, Math.max(f.xmax * 1.5, f.shelf || 0)))) * 1.02;
  const ys = pts.map((p) => p.v); if (ch.lsl !== null && ch.lsl !== undefined) ys.push(ch.lsl); if (ch.usl !== null && ch.usl !== undefined) ys.push(ch.usl);
  let lo = ys.length ? Math.min(...ys) : 0; let hi = ys.length ? Math.max(...ys) : 1; const pad = (hi - lo || 1) * 0.12; lo -= pad; hi += pad;
  const X = (x) => L + (x / xmax) * (W - L - R); const Y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  let s = frame(W, H, ch.title || 'Stability trend', 'Least squares per condition with its one-sided 95 % confidence bound; shelf life where the bound meets the specification');
  for (const t of niceTicks(lo, hi)) s += `<line x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}" stroke="${C.grid}"/><text x="${L - 8}" y="${Y(t) + 4}" font-size="11" text-anchor="end" fill="${C.muted}">${esc(fmt(t))}</text>`;
  for (const t of niceTicks(0, xmax, 8)) s += `<text x="${X(t)}" y="${H - B + 16}" font-size="10.5" text-anchor="middle" fill="${C.muted}">${esc(fmt(t))}</text>`;
  const spec = (v, lab) => { if (v === null || v === undefined) return; s += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${C.spec}" stroke-dasharray="2 3" stroke-width="1.6"/><text x="${W - R + 6}" y="${Y(v) + 4}" font-size="11" fill="${C.spec}">${lab} ${esc(fmt(v))}</text>`; };
  spec(ch.usl, 'USL'); spec(ch.lsl, 'LSL');
  let leg = 0;
  fits.forEach((f, k) => {
    const col = SERIES[k % SERIES.length];
    if (f.slope !== undefined) {
      const xe = Math.min(xmax, f.shelf !== null && f.shelf !== undefined ? Math.max(f.shelf, f.xmax) : xmax);
      s += `<line x1="${X(0)}" y1="${Y(f.intercept)}" x2="${X(xe)}" y2="${Y(f.intercept + f.slope * xe)}" stroke="${col}" stroke-width="2"/>`;
      const up = []; const dn = []; for (let i = 0; i <= 40; i++) { const x = (i / 40) * xe; const y = f.intercept + f.slope * x; const b = f.band(x); up.push(`${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(y + b).toFixed(1)}`); dn.push(`${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(y - b).toFixed(1)}`); }
      s += `<path d="${up.join(' ')}" fill="none" stroke="${col}" stroke-dasharray="4 3" opacity=".7"/><path d="${dn.join(' ')}" fill="none" stroke="${col}" stroke-dasharray="4 3" opacity=".7"/>`;
      if (f.shelf !== null && f.shelf !== undefined) s += `<line x1="${X(f.shelf)}" x2="${X(f.shelf)}" y1="${T}" y2="${H - B}" stroke="${col}" stroke-dasharray="1 3"/><text x="${X(f.shelf) + 4}" y="${T + 12 + k * 13}" font-size="10.5" fill="${col}">${esc(fmt(f.shelf, 3))} mo</text>`;
    }
    s += `<rect x="${W - R + 8}" y="${T + 40 + leg * 34}" width="10" height="10" fill="${col}"/><text x="${W - R + 22}" y="${T + 49 + leg * 34}" font-size="11" fill="${C.ink}">${esc(f.name)}</text><text x="${W - R + 22}" y="${T + 63 + leg * 34}" font-size="10" fill="${C.muted}">${esc(f.shelf !== null && f.shelf !== undefined ? 'shelf life ' + f.shelf.toFixed(1) + ' mo' : f.slope !== undefined ? 'within spec' : f.n < 3 ? 'too few points' : 'one time point only')}</text>`;
    leg += 1;
    for (const p of pts.filter((q) => q.series === f.series)) s += `<circle cx="${X(p.x)}" cy="${Y(p.v)}" r="4" fill="${col}"><title>${esc(`${p.label}: ${fmt(p.v, 4)}${ch.unit ? ' ' + ch.unit : ''} at ${fmt(p.x, 3)} months`)}</title></circle>`;
  });
  for (const p of pts.filter((q) => q.series === 'T0')) s += `<circle cx="${X(p.x)}" cy="${Y(p.v)}" r="4.5" fill="#fff" stroke="${C.ink}" stroke-width="1.5"><title>${esc(`T0 ${p.label}: ${fmt(p.v, 4)}${ch.unit ? ' ' + ch.unit : ''}`)}</title></circle>`;
  if (!pts.length) s += `<text x="${(W - R + L) / 2}" y="${H / 2}" text-anchor="middle" font-size="14" fill="${C.muted}">No results yet</text>`;
  s += `<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="#c3ccd3"/><line x1="${L}" x2="${L}" y1="${T}" y2="${H - B}" stroke="#c3ccd3"/>`;
  s += yTitle(ch.yLabel, T, B, H) + xTitle(ch.xLabel || 'Months on stability', L, R, W, H - B + 38);
  const it = [{ kind: 'line', color: SERIES[0], label: 'Trend line (colour per condition)' }, { kind: 'line', color: SERIES[0], dash: '4 3', label: '95 % confidence bound' }];
  if ((ch.lsl !== null && ch.lsl !== undefined) || (ch.usl !== null && ch.usl !== undefined)) it.push({ kind: 'line', color: C.spec, dash: '2 3', label: 'Specification' });
  return s + key(it, 16, H - 14, W - 32) + '</svg>';
}
function chartSub(ch) {
  const st = ch.stats || {};
  const parts = [{ i: 'Individuals chart', p: 'p chart (rate per period)', c: 'c chart (count per period)' }[ch.chart] || ''];
  parts.push(`${ch.points.length} point${ch.points.length === 1 ? '' : 's'}`);
  const u = ch.unit && ch.unit !== 'count' && ch.chart !== 'p' ? ' ' + ch.unit : '';
  if (ch.chart === 'i' && st.cl !== null && st.cl !== undefined) parts.push(...(st.mean !== null && st.mean !== undefined ? [`mean ${fmt(st.mean)}${u}`] : []), `sigma ${fmt(st.sigma)}${u}${st.frozen ? ' (frozen)' : ''}`);
  if (ch.chart === 'p') parts.push(`${st.total} of ${st.of}, ${fmt(st.cl * 100)} % overall`);
  if (ch.chart === 'c') parts.push(`${st.total} in all, ${fmt(st.cl)} per ${ch.period || 'period'} on average`);
  if (ch.signals) parts.push(`${ch.signals.length} signal${ch.signals.length === 1 ? '' : 's'}`);
  return parts.filter(Boolean).join(' · ');
}

module.exports = { build, sourceData, imr, attribute, signals, capability, regression, RULES, DEFAULT_RULES, COUNT_METRICS, PARETO_METRICS, renderControl, esc, fmt };
