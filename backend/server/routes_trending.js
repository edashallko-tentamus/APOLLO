// Trending and control charts (T-1, migration 043): options for the chart builder, building a chart (or one panel per
// analyte / QC type when the definition says "each"), saved charts (TC-0001), frozen limits, signal reviews, Trend
// watch, the report packs (OOS, lab performance, equipment and environment, everything watched), QC Review's applied
// charts, and the downloads (Excel; PDF built here from the definitions, never from pictures sent by the browser).
'use strict';
const T = require('./trending');
const COA = require('./coa');
const { writeXlsx } = require('./xlsx');

const PACKS = {
  oos: { title: 'OOS trends', intro: 'Out-of-specification investigations over time and what they are made of.', charts: [
    { source: 'counts', title: 'OOS investigations opened per month', params: { metric: 'oos_opened', period: 'Month' } },
    { source: 'counts', title: 'OOS rate per month (investigations per approved test)', params: { metric: 'oos_rate', period: 'Month' } },
    { source: 'counts', title: 'OOS confirmed per month (no assignable cause)', params: { metric: 'oos_confirmed', period: 'Month' } },
    { source: 'pareto', title: 'OOS investigations by test', params: { metric: 'oos_by_test' } },
    { source: 'pareto', title: 'OOS investigations by outcome', params: { metric: 'oos_by_outcome' } }] },
  lab: { title: 'Lab performance', intro: 'Rework and turnaround: re-preparations, re-analyses, on-time reporting and turnaround days.', charts: [
    { source: 'counts', title: 'Re-preparations per month', params: { metric: 'repreps', period: 'Month' } },
    { source: 'counts', title: 'Re-analyses per month', params: { metric: 'reanalyses', period: 'Month' } },
    { source: 'counts', title: 'Tests reported on time per month', params: { metric: 'on_time', period: 'Month' } },
    { source: 'counts', title: 'Turnaround, mean days per week', params: { metric: 'tat_days', period: 'Week' } },
    { source: 'pareto', title: 'Re-preparations by test', params: { metric: 'repreps_by_test' } }] },
  equipment: { title: 'Equipment and environment', intro: 'Failed equipment checks, stability chamber excursions and lots rejected by QA testing.', charts: [
    { source: 'counts', title: 'Failed equipment checks per month', params: { metric: 'equipment_failures', period: 'Month' } },
    { source: 'counts', title: 'Stability chamber excursions per month', params: { metric: 'excursions', period: 'Month' } },
    { source: 'counts', title: 'Inventory lots rejected by QA testing per month', params: { metric: 'lots_rejected', period: 'Month' } },
    { source: 'pareto', title: 'Failed equipment checks by equipment', params: { metric: 'failures_by_equipment' } },
    { source: 'pareto', title: 'Failed logbook entries by logbook', params: { metric: 'failures_by_logbook' } }] },
};

module.exports = function registerTrending({ route, tx, signedTx, currentSite, checkSite, hasPermission, requirePermission, isUuid, AUDIT_SCOPES, AUDIT_LISTS, AUDIT_CHECKS }) {
  const r = route;
  const view = (c) => requirePermission(c, 'trending.view', 'see trend charts');

  // what can be charted, for the builder's pick lists
  r('GET', '/api/trending/options', async (c) => {
    const site = await currentSite(c); await view(c);
    const tests = await c.db.rows(`SELECT t.id, t.test_code, t.test_name, tv.id AS version_id FROM test t JOIN test_version tv ON tv.test_id = t.id AND tv.status = 'Effective'
      WHERE (t.site_id = $1 OR t.site_id IS NULL) AND t.status = 'Active' ORDER BY t.test_name`, [site]);
    const analytes = await c.db.rows(`SELECT tv.test_id, a.id, a.analyte_name, tva.reporting_unit AS unit FROM test_version tv JOIN test_version_analyte tva ON tva.test_version_id = tv.id AND tva.status = 'Active'
      JOIN analyte a ON a.id = tva.analyte_id JOIN test t ON t.id = tv.test_id WHERE tv.status = 'Effective' AND (t.site_id = $1 OR t.site_id IS NULL) ORDER BY tva.sort_order, a.analyte_name`, [site]);
    // analytes that have results even when the Effective version lists none (tests made before the designer)
    const resultAnalytes = await c.db.rows(`SELECT DISTINCT rt.test_id, a.id, a.analyte_name, tr.unit FROM test_result tr JOIN requested_test rt ON rt.id = tr.requested_test_id JOIN analyte a ON a.id = tr.analyte_id
      JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id WHERE o.site_id = $1 AND tr.status = 'Active' AND tr.value_num IS NOT NULL`, [site]);
    for (const x of resultAnalytes) if (!analytes.some((y) => y.test_id === x.test_id && y.id === x.id)) analytes.push(x);
    const qcTypes = await c.db.rows(`SELECT tv.test_id, q->>'qc_type' AS qc_type, cr->>'limit_type' AS limit_type FROM test_version tv JOIN workflow_step ws ON ws.test_version_id = tv.id AND ws.step_type = 'Batching' AND ws.status = 'Active'
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ws.config->'qc', '[]')) q CROSS JOIN LATERAL jsonb_array_elements(COALESCE(q->'criteria', '[]')) cr
      JOIN test t ON t.id = tv.test_id WHERE tv.status = 'Effective' AND (t.site_id = $1 OR t.site_id IS NULL)`, [site]);
    const logbooks = await c.db.rows(`SELECT l.id, l.logbook_code, l.logbook_name, l.subject FROM logbook l WHERE l.site_id = $1 ORDER BY l.logbook_code`, [site]);
    const fields = await c.db.rows(`SELECT DISTINCT ON (l.id, f.field_key) l.id AS logbook_id, f.field_key, f.label, f.unit FROM logbook l JOIN logbook_version v ON v.logbook_id = l.id
      JOIN logbook_field f ON f.version_id = v.id WHERE l.site_id = $1 AND f.field_type IN ('Number','Calculated') ORDER BY l.id, f.field_key, v.version_no DESC`, [site]);
    const equipment = await c.db.rows(`SELECT DISTINCT e.logbook_id, eq.id, eq.equipment_code, eq.equipment_name FROM logbook_entry e JOIN equipment eq ON eq.id = e.equipment_id WHERE e.site_id = $1 ORDER BY eq.equipment_code`, [site]);
    const clients = await c.db.rows(`SELECT DISTINCT cl.id, COALESCE(cl.display_name, cl.legal_name) AS name FROM client cl JOIN lab_order o ON o.client_id = cl.id WHERE o.site_id = $1 ORDER BY 2`, [site]);
    const matrices = (await c.db.rows(`SELECT DISTINCT s.matrix FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE o.site_id = $1 AND s.matrix IS NOT NULL ORDER BY 1`, [site])).map((x) => x.matrix);
    const studies = await c.db.rows(`SELECT s.id, s.study_code, s.product, s.status FROM stability_study s WHERE s.site_id = $1 ORDER BY s.study_code`, [site]);
    const studyAnalytes = await c.db.rows(`SELECT DISTINCT rt.stability_study_id AS study_id, a.id, a.analyte_name FROM test_result tr JOIN requested_test rt ON rt.id = tr.requested_test_id JOIN analyte a ON a.id = tr.analyte_id
      JOIN stability_study s ON s.id = rt.stability_study_id WHERE s.site_id = $1 AND tr.status = 'Active' AND tr.value_num IS NOT NULL`, [site]);
    return { tests, analytes, qcTypes, logbooks, fields, equipment, clients, matrices, studies, studyAnalytes,
      metrics: Object.entries(T.COUNT_METRICS).map(([k, m]) => ({ key: k, title: m.title, chart: m.chart, test: !!m.test })),
      pareto: Object.entries(T.PARETO_METRICS).map(([k, t]) => ({ key: k, title: t })), rules: T.RULES,
      can_manage: await hasPermission(c, 'trending.manage') };
  });

  // a definition, expanded: "each" analyte or QC type gives one panel per combination
  const expand = async (db, site, def) => {
    const p = def.params || {};
    if (def.source === 'logbook' && p.equipment_id === '*') {
      const eq = await db.rows(`SELECT DISTINCT eq.id, eq.equipment_code, eq.equipment_name FROM logbook_entry e JOIN equipment eq ON eq.id = e.equipment_id
        WHERE e.site_id = $1 AND e.logbook_id = $2 AND e.status <> 'Voided' ORDER BY eq.equipment_code`, [site, p.logbook_id]);
      return eq.map((x) => ({ ...def, params: { ...p, equipment_id: x.id }, title: `${def.title || def.chart_name}: ${x.equipment_code} ${x.equipment_name}` }));
    }
    if (!['results', 'qc'].includes(def.source) || (p.analyte_id !== '*' && p.qc_type !== '*')) return [def];
    const vid = (await db.one(`SELECT id FROM test_version WHERE test_id = $1 AND status = 'Effective'`, [p.test_id]) || {}).id;
    let analytes = p.analyte_id === '*' ? await db.rows(`SELECT a.id, a.analyte_name FROM test_version_analyte tva JOIN analyte a ON a.id = tva.analyte_id WHERE tva.test_version_id = $1 AND tva.status = 'Active' ORDER BY tva.sort_order, a.analyte_name`, [vid]) : [{ id: p.analyte_id, analyte_name: null }];
    if (p.analyte_id === '*' && !analytes.length) analytes = await db.rows(`SELECT DISTINCT a.id, a.analyte_name FROM test_result tr JOIN requested_test rt ON rt.id = tr.requested_test_id JOIN analyte a ON a.id = tr.analyte_id WHERE rt.test_id = $1 AND tr.value_num IS NOT NULL ORDER BY 2`, [p.test_id]);
    let types = [{ qc_type: p.qc_type || null, limit_type: p.limit_type || null }];
    if (def.source === 'qc' && p.qc_type === '*') {
      types = await db.rows(`SELECT DISTINCT q->>'qc_type' AS qc_type, cr->>'limit_type' AS limit_type FROM workflow_step ws CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ws.config->'qc', '[]')) q
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(q->'criteria', '[]')) cr WHERE ws.test_version_id = $1 AND ws.step_type = 'Batching' AND ws.status = 'Active' ORDER BY 1, 2`, [vid]);
    }
    const out = [];
    for (const ty of types) for (const a of analytes) {
      out.push({ ...def, params: { ...p, analyte_id: a.id, qc_type: ty.qc_type, limit_type: ty.limit_type },
        title: [def.title || def.chart_name, ty.qc_type && p.qc_type === '*' ? `${ty.qc_type} (${ty.limit_type})` : null, a.analyte_name && p.analyte_id === '*' ? a.analyte_name : null].filter(Boolean).join(': ') });
    }
    return out;
  };
  const withReviews = async (db, chartId, panels) => {
    if (!chartId) return panels;
    const reviews = await db.rows(`SELECT rv.point_key, rv.rule, rv.outcome, rv.comment, rv.reviewed_at, u.full_name AS reviewed_by_name FROM trend_signal_review rv JOIN app_user u ON u.id = rv.reviewed_by
      WHERE rv.chart_id = $1 AND rv.status = 'Active'`, [chartId]);
    for (const p of panels) for (const s of p.signals || []) s.review = reviews.find((x) => x.point_key === s.key && x.rule === s.rule) || null;
    return panels;
  };
  const buildAll = async (c, site, def, chartId) => {
    const defs = await expand(c.db, site, def);
    const panels = [];
    for (const d of defs) { try { panels.push(await T.build(c.db, site, d)); } catch (e) { panels.push({ title: d.title, error: e.message }); } }
    return withReviews(c.db, chartId, panels);
  };
  const cleanDef = (b) => ({ source: b.source, title: b.title || '', params: b.params || {}, rules: Array.isArray(b.rules) ? b.rules : T.DEFAULT_RULES,
    frozen: b.frozen || null, highlight: b.highlight || [] });

  r('POST', '/api/trending/build', async (c) => {
    const site = await currentSite(c); await view(c);
    return { panels: await buildAll(c, site, cleanDef(c.body || {}), null) };
  });

  // ---------------------------------------------------------------- saved charts
  const chartOf = async (c, id) => {
    if (!isUuid(id)) throw new Error('Chart not found');
    const ch = await c.db.one(`SELECT tc.*, fu.full_name AS frozen_by_name, cu.full_name AS created_by_name, qu.full_name AS qa_approved_by_name,
        au.full_name AS applied_by_name, av.version_no AS applied_version_no, av.status::text AS applied_version_status, av.test_id AS applied_test_id
      FROM trend_chart tc LEFT JOIN app_user fu ON fu.id = tc.frozen_by JOIN app_user cu ON cu.id = tc.created_by LEFT JOIN app_user qu ON qu.id = tc.qa_approved_by
      LEFT JOIN app_user au ON au.id = tc.applied_by LEFT JOIN test_version av ON av.id = tc.applied_version_id WHERE tc.id = $1`, [id]);
    if (!ch) throw new Error('Chart not found');
    await checkSite(c, ch.site_id);
    return ch;
  };
  const defOf = (ch, extra = {}) => ({ source: ch.source, title: ch.chart_name, params: ch.params || {}, rules: typeof ch.rules === 'string' ? ch.rules.replace(/[{}]/g, '').split(',').filter(Boolean) : ch.rules,
    frozen: ch.frozen_cl !== null && ch.frozen_cl !== undefined ? { cl: ch.frozen_cl, sigma: ch.frozen_sigma } : null, ...extra });
  r('GET', '/api/trending/charts', async (c) => {
    const site = await currentSite(c); await view(c);
    return { rows: await c.db.rows(`SELECT tc.id, tc.chart_code, tc.chart_name, tc.description, tc.source, tc.params, tc.watch, tc.show_in_review, tc.frozen_cl IS NOT NULL AS frozen, tc.status::text AS status,
        tc.qa_review, tc.qa_status, u.full_name AS created_by_name, tc.modified_at FROM trend_chart tc JOIN app_user u ON u.id = tc.created_by WHERE tc.site_id = $1 ORDER BY tc.status, tc.chart_code`, [site]),
      can_manage: await hasPermission(c, 'trending.manage'), can_approve: await hasPermission(c, 'trending.approve') };
  });
  r('GET', '/api/trending/charts/:id', async (c) => {
    await view(c);
    const ch = await chartOf(c, c.params.id);
    const q = c.query || {};
    const params = { ...(ch.params || {}), from: q.from || undefined, to: q.to || undefined };
    const lim = await c.db.one('SELECT * FROM trend_limits_for_test($1)', [ch.id]);
    return { chart: ch, panels: await buildAll(c, ch.site_id, defOf({ ...ch, params }), ch.id), can_manage: await hasPermission(c, 'trending.manage'),
      can_approve: await hasPermission(c, 'trending.approve'), can_design: await hasPermission(c, 'methods.design'),
      limits_for_test: ch.source === 'qc' ? lim : null };
  });
  // QA approves the chart and its limits (signed "Approved by"; the database checks who may and who may not)
  r('POST', '/api/trending/charts/:id/approve', async (c) => {
    const ch = await chartOf(c, c.params.id);
    return signedTx({ ...c, siteId: ch.site_id, reason: (c.body || {}).reason || 'Trend chart and its limits approved' }, { meaning: 'Approved by', action: `Trend chart ${ch.chart_code} ${ch.chart_name} and its limits`, module: 'Trending' },
      (t) => t.query('SELECT approve_trend_chart($1)', [ch.id]).then(() => ({ ok: true })));
  });
  // An approved QC chart's frozen limits (centre line ± 3 sigma) into the test's Draft version (made from the effective one
  // when there is none): written into the Batching step's criterion for that QC type and analyte, signed "Changed by"
  // with a reason; the version is then approved as usual (signed, by someone who did not work on it).
  r('POST', '/api/trending/charts/:id/apply-limits', async (c) => {
    const ch = await chartOf(c, c.params.id);
    const x = await c.db.one('SELECT * FROM trend_limits_for_test($1)', [ch.id]);
    if (x.problem) throw new Error(x.problem);
    const round = (v) => Number(Number(v).toPrecision(4));
    const lcl = round(x.lcl); const ucl = round(x.ucl);
    const shape = ((await c.db.one('SELECT shape FROM qc_limit_type WHERE limit_type = $1', [x.limit_type])) || {}).shape || 'Range';
    const reason = (c.body || {}).reason || `Control limits from trend chart ${ch.chart_code}`;
    return signedTx({ ...c, siteId: ch.site_id, reason }, { meaning: 'Changed by', action: `QC limits for ${x.qc_type} ${x.limit_type} from trend chart ${ch.chart_code}`, module: 'Methods' }, async (t) => {
      let v = await t.one(`SELECT id, version_no FROM test_version WHERE test_id = $1 AND status = 'Draft'`, [x.test_id]);
      let created = false;
      if (!v) { const n = await t.one('SELECT new_test_version($1) AS id', [x.test_id]); v = await t.one('SELECT id, version_no FROM test_version WHERE id = $1', [n.id]); created = true; }
      const step = await t.one(`SELECT id, config FROM workflow_step WHERE test_version_id = $1 AND step_type = 'Batching' AND status = 'Active' ORDER BY sort_order LIMIT 1`, [v.id]);
      if (!step) throw new Error('The test has no Batching step to hold QC limits');
      const cfg = typeof step.config === 'string' ? JSON.parse(step.config) : (step.config || {});
      const q = (cfg.qc || []).find((y) => y.qc_type === x.qc_type);
      const cr = q && (q.criteria || []).find((y) => y.limit_type === x.limit_type);
      if (!cr) throw new Error(`The test's draft has no ${x.qc_type} ${x.limit_type} criterion any more: add it in the designer first`);
      // the criterion's rows per analyte: every analyte of the version (earlier layout: default + exceptions), then this one set
      const analytes = (await t.rows(`SELECT analyte_id FROM test_version_analyte WHERE test_version_id = $1 AND status = 'Active' ORDER BY sort_order`, [v.id])).map((a) => a.analyte_id);
      if (!analytes.includes(x.analyte_id)) throw new Error('The analyte is not on the test\'s draft version');
      if (!Array.isArray(cr.analytes)) {
        cr.analytes = analytes.map((id) => { const ov = (cr.overrides || []).find((o) => o.analyte_id === id) || cr;
          const a = { analyte_id: id, applies: true }; if (shape === 'Range') { a.min = ov.min ?? null; a.max = ov.max ?? null; } if (shape === 'Max') { a.max = ov.max ?? null; if (ov.limit_ref) a.limit_ref = ov.limit_ref; } return a; });
        delete cr.overrides;
      }
      let row = cr.analytes.find((a) => a.analyte_id === x.analyte_id);
      if (!row) { row = { analyte_id: x.analyte_id }; cr.analytes.push(row); }
      row.applies = true;
      if (shape === 'Range') { row.min = lcl; row.max = ucl; } else { row.max = ucl; delete row.limit_ref; }
      await t.query('UPDATE workflow_step SET config = $2::jsonb WHERE id = $1', [step.id, JSON.stringify(cfg)]);
      const note = `${x.qc_type} ${x.limit_type} limits from ${ch.chart_code}`;
      await t.query(`UPDATE test_version SET change_summary = CASE WHEN change_summary IS NULL OR change_summary = '' THEN $2 WHEN position($2 in change_summary) > 0 THEN change_summary ELSE change_summary || '; ' || $2 END WHERE id = $1`, [v.id, note]);
      await t.query('SELECT record_trend_limits_applied($1, $2)', [ch.id, v.id]);
      return { version_id: v.id, version_no: v.version_no, created, min: shape === 'Range' ? lcl : null, max: ucl };
    });
  });
  r('POST', '/api/trending/charts', async (c) => {
    const site = await currentSite(c);
    const b = c.body || {};
    if (isUuid(b.id)) await chartOf(c, b.id);   // checked before the transaction (the database runs one thing at a time)
    return tx({ ...c, siteId: site, reason: b.reason || (b.id ? 'Trend chart changed' : 'New trend chart') }, async (t) => {
      // a chart shown in QC Review is always QA reviewed (the database sets it too)
      const vals = [String(b.chart_name || '').trim(), b.description || null, b.source, JSON.stringify(b.params || {}), `{${(b.rules || T.DEFAULT_RULES).join(',')}}`, b.watch !== false, !!b.show_in_review, !!b.qa_review || !!b.show_in_review];
      if (isUuid(b.id)) {
        await t.query(`UPDATE trend_chart SET chart_name = $2, description = $3, source = $4, params = $5::jsonb, rules = $6::text[], watch = $7, show_in_review = $8, qa_review = $9 WHERE id = $1`, [b.id, ...vals]);
        return { id: b.id };
      }
      return t.one(`INSERT INTO trend_chart (site_id, chart_name, description, source, params, rules, watch, show_in_review, qa_review) VALUES ($1, $2, $3, $4, $5::jsonb, $6::text[], $7, $8, $9) RETURNING id, chart_code`, [site, ...vals]);
    });
  });
  // freeze the limits from a baseline period (the chart's points in it): centre line and sigma
  r('POST', '/api/trending/charts/:id/freeze', async (c) => {
    const ch = await chartOf(c, c.params.id);
    const b = c.body || {};
    const p = ch.params || {};
    if (p.analyte_id === '*' || p.qc_type === '*' || p.equipment_id === '*') throw new Error('Limits are frozen on a chart with one panel: this chart has a panel for each analyte, QC check or piece of equipment');
    if (!['results', 'qc', 'logbook', 'counts'].includes(ch.source)) throw new Error('Only control charts have limits to freeze');
    const base = await T.build(c.db, ch.site_id, defOf({ ...ch, frozen_cl: null }, { params: { ...p, from: b.from || null, to: b.to || null } }));
    if ((base.points || []).length < (base.chart === 'i' ? 20 : 6)) throw new Error(`The baseline has ${base.points.length} points: freeze limits from at least ${base.chart === 'i' ? 20 : 6}`);
    const st = base.stats;
    return tx({ ...c, siteId: ch.site_id, reason: b.reason || 'Control limits frozen from a baseline' }, (t) => t.query(`UPDATE trend_chart SET frozen_cl = $2, frozen_sigma = $3, frozen_from = $4, frozen_to = $5, frozen_n = $6 WHERE id = $1`,
      [ch.id, st.cl, base.chart === 'i' ? st.sigma : 0, b.from || null, b.to || null, base.points.length]).then(() => ({ cl: st.cl, sigma: st.sigma, n: base.points.length })));
  });
  r('POST', '/api/trending/charts/:id/unfreeze', async (c) => {
    const ch = await chartOf(c, c.params.id);
    return tx({ ...c, siteId: ch.site_id, reason: (c.body || {}).reason || 'Control limits recalculated from the data' }, (t) => t.query('UPDATE trend_chart SET frozen_cl = NULL WHERE id = $1', [ch.id]).then(() => ({ ok: true })));
  });
  r('POST', '/api/trending/charts/:id/retire', async (c) => {
    const ch = await chartOf(c, c.params.id);
    return tx({ ...c, siteId: ch.site_id, reason: (c.body || {}).reason || 'Trend chart retired' }, (t) => t.query(`UPDATE trend_chart SET status = 'Inactive', watch = false, show_in_review = false WHERE id = $1`, [ch.id]).then(() => ({ ok: true })));
  });
  // a person's review of a signal (outcome and comment; reason in the audit trail)
  r('POST', '/api/trending/signals/review', async (c) => {
    const b = c.body || {};
    const ch = await chartOf(c, b.chart_id);
    return tx({ ...c, siteId: ch.site_id, reason: b.reason || 'Trend signal reviewed' }, async (t) => {
      await t.query(`UPDATE trend_signal_review SET status = 'Inactive' WHERE chart_id = $1 AND point_key = $2 AND rule = $3 AND status = 'Active'`, [ch.id, String(b.point_key || ''), b.rule]);
      return t.one(`INSERT INTO trend_signal_review (chart_id, point_key, point_label, rule, outcome, comment) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [ch.id, String(b.point_key || ''), b.point_label || null, b.rule, b.outcome, String(b.comment || '').trim()]);
    });
  });

  // ---------------------------------------------------------------- Trend watch: every watched chart, its latest point and its signals
  r('GET', '/api/trending/watch', async (c) => {
    const site = await currentSite(c); await view(c);
    const charts = await c.db.rows(`SELECT * FROM trend_chart WHERE site_id = $1 AND status = 'Active' AND watch ORDER BY chart_code`, [site]);
    const out = [];
    for (const ch of charts) {
      const panels = await buildAll(c, site, defOf(ch), ch.id);
      for (const p of panels) {
        const sig = p.signals || [];
        out.push({ chart_id: ch.id, chart_code: ch.chart_code, chart_name: ch.chart_name, title: p.title, source: ch.source, chart: p.chart, error: p.error || null,
          n: (p.points || p.bars || []).length, last: (p.points || []).slice(-1)[0] || null, unit: p.unit,
          spark: (p.points || []).slice(-40).map((x) => x.v), cl: p.stats ? p.stats.cl : null, ucl: p.stats ? p.stats.ucl : null, lcl: p.stats ? p.stats.lcl : null,
          signals: sig.length, open: sig.filter((s) => !s.review).length,
          recent: sig.filter((s) => !s.review).slice(-3).map((s) => `${s.label}: ${s.text}`), frozen: ch.frozen_cl !== null, show_in_review: ch.show_in_review,
          qa_status: ch.qa_review ? ch.qa_status : null, y_label: p.yLabel || null });
      }
    }
    return { rows: out, can_manage: await hasPermission(c, 'trending.manage') };
  });

  // ---------------------------------------------------------------- report packs
  r('GET', '/api/trending/packs/:pack', async (c) => {
    const site = await currentSite(c); await view(c);
    const pack = packOf(c.params.pack);
    const q = c.query || {};
    const defs = SAVED.includes(c.params.pack) ? await savedDefs(c, site, c.params.pack) : pack.charts.map((d) => ({ ...d, params: { ...d.params, from: q.from || null, to: q.to || null, test_id: q.test_id || null } }));
    const panels = [];
    for (const d of defs) panels.push(...(await buildAll(c, site, cleanDef(d), d.chart_id || null)));
    return { title: pack.title, intro: pack.intro, panels };
  });
  // the packs made of saved charts: those on Trend watch, or every saved chart (0.24.1: "Download all" on Trend watch),
  // each with every panel (each analyte, QC check or piece of equipment)
  const SAVED = ['watched', 'all'];
  const packOf = (k) => {
    if (k === 'watched') return { title: 'Watched charts', intro: 'Every chart on Trend watch, with its signals and their reviews.', charts: [] };
    if (k === 'all') return { title: 'All saved charts', intro: 'Every saved chart of the lab, each with all its panels (every analyte, QC check or piece of equipment), its signals and their reviews, and its QA approval.', charts: [] };
    const p = PACKS[k]; if (!p) throw new Error('Unknown report'); return p;
  };
  const savedDefs = async (c, site, k, range = {}) => (await c.db.rows(`SELECT tc.*, qu.full_name AS qa_approved_by_name FROM trend_chart tc LEFT JOIN app_user qu ON qu.id = tc.qa_approved_by
      WHERE tc.site_id = $1 AND tc.status = 'Active' AND ($2 = 'all' OR tc.watch) ORDER BY tc.chart_code`, [site, k]))
    .map((ch) => ({ ...defOf(ch, { params: { ...(ch.params || {}), from: range.from || undefined, to: range.to || undefined } }), chart_id: ch.id,
      qa: ch.qa_review ? (ch.qa_status === 'Approved' ? `${ch.chart_code}: approved by QA (${ch.qa_approved_by_name || ''}, ${String(ch.qa_approved_at && new Date(ch.qa_approved_at).toISOString()).slice(0, 10)})` : `${ch.chart_code}: awaiting QA approval`) : `${ch.chart_code}: QA review not required` }));
  const watchedDefs = (c, site) => savedDefs(c, site, 'watched');

  // ---------------------------------------------------------------- QC Review: the charts applied to this batch's test, the batch's points ringed
  r('GET', '/api/trending/review/:batchId', async (c) => {
    if (!isUuid(c.params.batchId)) return { panels: [] };
    const b = await c.db.one('SELECT id, site_id, test_id, batch_code FROM test_batch WHERE id = $1', [c.params.batchId]);
    if (!b) return { panels: [] };
    await checkSite(c, b.site_id);
    if (!(await hasPermission(c, 'trending.view', b.site_id))) return { panels: [], hidden: true };
    // only charts QA has approved (0.24.1: a chart in QC Review is QA reviewed and counts once approved)
    const charts = await c.db.rows(`SELECT * FROM trend_chart WHERE site_id = $1 AND status = 'Active' AND show_in_review AND qa_status = 'Approved' AND source = 'qc' AND params->>'test_id' = $2::text ORDER BY chart_code`, [b.site_id, b.test_id]);
    const panels = [];
    for (const ch of charts) {
      // the batch is charted even before its approval: the window is the chart's plus this batch
      const ps = await buildAll(c, b.site_id, defOf(ch, { highlight: [b.id] }), ch.id);
      for (const p of ps) { p.chart_id = ch.id; p.chart_code = ch.chart_code; p.batch_signals = (p.signals || []).filter((s) => p.points[s.i] && p.points[s.i].batch_id === b.id); }
      panels.push(...ps);
    }
    return { panels, batch_code: b.batch_code };
  });

  // ---------------------------------------------------------------- downloads: Excel of the points, PDF of one chart or a report
  r('POST', '/api/trending/export.xlsx', async (c) => {
    const site = await currentSite(c); await view(c);
    const panels = await buildAll(c, site, cleanDef(c.body || {}), null);
    const p = panels[0] || {};
    const rows = (p.points || []).map((x, i) => [x.label, x.t ? String(x.t).slice(0, 10) : x.x ?? '', x.v, x.sub || '', (p.signals || []).filter((s) => s.i === i).map((s) => s.rule).join(' ')]);
    if (p.bars) rows.push(...p.bars.map((x) => [x.label, '', x.n, `cumulative ${x.cum_pct.toFixed(1)} %`, '']));
    const buf = writeXlsx({ sheetName: 'Trend', headers: ['Point', p.chart === 'regression' ? 'Months on stability' : p.xLabel || 'Date', p.yLabel || 'Value', 'Detail', 'Signals'], rows, widths: [28, 16, 22, 40, 14] });
    return { __raw: true, body: buf, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', headers: { 'Content-Disposition': `attachment; filename="${safe(p.title || 'trend')}.xlsx"` } };
  });
  r('POST', '/api/trending/pdf', async (c) => {
    const site = await currentSite(c); await view(c);
    const b = c.body || {};
    let title = 'Trend chart'; let intro = ''; let panels = [];
    if (b.pack) { const pack = packOf(b.pack); title = pack.title; intro = pack.intro;
      const defs = SAVED.includes(b.pack) ? await savedDefs(c, site, b.pack, { from: b.from, to: b.to }) : pack.charts.map((d) => ({ ...d, params: { ...d.params, from: b.from || null, to: b.to || null, test_id: b.test_id || null } }));
      for (const d of defs) { const ps = await buildAll(c, site, cleanDef(d), d.chart_id || null); if (d.qa && ps[0]) ps[0].qa = d.qa; panels.push(...ps); }
    } else if (isUuid(b.chart_id)) { const ch = await chartOf(c, b.chart_id); title = `${ch.chart_code} ${ch.chart_name}`; panels = await buildAll(c, ch.site_id, defOf({ ...ch, params: { ...(ch.params || {}), from: b.from || undefined, to: b.to || undefined } }), ch.id); }
    else { panels = await buildAll(c, site, cleanDef(b), null); title = (panels[0] || {}).title || title; }
    const lab = await c.db.one('SELECT site_code, site_name FROM lab_site WHERE id = $1', [site]);
    const me = await c.db.one('SELECT full_name, clock_timestamp() AS now FROM app_user WHERE id = $1', [c.userId]);
    const html = pdfHtml({ title, intro, panels, lab, me, from: b.from, to: b.to });
    const out = await COA.htmlToPdf(html, `${title} · ${lab.site_code} · printed ${new Date(me.now).toISOString().slice(0, 10)} by ${me.full_name}`);
    return { __raw: true, body: out.buf, type: 'application/pdf', headers: { 'Content-Disposition': `inline; filename="${safe(title)}.pdf"` } };
  });

  AUDIT_CHECKS.trend_chart = (c, id) => chartOf(c, id);
  AUDIT_SCOPES.trend_chart = `SELECT 'trend_chart', $1::uuid UNION ALL SELECT 'trend_signal_review', id FROM trend_signal_review WHERE chart_id = $1`;
  AUDIT_LISTS.trending = ['trend_chart', 'trend_signal_review'];
};

const safe = (s) => String(s || 'trend').replace(/:\s*/g, ' - ').replace(/[\\/*?"<>|]/g, '-').slice(0, 90);
function pdfHtml({ title, intro, panels, lab, me, from, to }) {
  const e = T.esc; const f = T.fmt;
  const block = (p) => {
    if (p.error) return `<section><h2>${e(p.title)}</h2><p class="m">${e(p.error)}</p></section>`;
    const st = p.stats || {};
    const facts = p.chart === 'pareto' ? [`${p.total} in all`] : p.chart === 'regression' ? (p.fits || []).map((x) => `${x.name}: ${x.note}${x.slope !== undefined ? ` (slope ${f(x.slope)} per month, r² ${f(x.r2, 2)})` : ''}`)
      : [`${(p.points || []).length} points`, st.cl !== undefined && st.cl !== null ? `centre line ${f(p.chart === 'p' ? st.cl * 100 : st.cl)}${p.chart === 'p' ? ' %' : ''}${st.frozen ? ' (frozen)' : ''}` : '',
        p.chart === 'i' && st.ucl !== null ? `limits ${f(st.lcl)} to ${f(st.ucl)}` : '', p.capability && p.capability.cpk !== undefined && Number.isFinite(p.capability.cpk) ? `Cpk ${f(p.capability.cpk, 2)}${p.capability.note ? ' (' + p.capability.note + ')' : ''}` : ''].filter(Boolean);
    const sig = (p.signals || []);
    return `<section><h2>${e(p.title)}</h2>${p.qa ? `<p class="m">${e(p.qa)}</p>` : ''}<div class="svg">${p.svg || ''}</div>${p.mrSvg ? `<div class="svg mr">${p.mrSvg}</div>` : ''}
      <p class="facts">${facts.map(e).join(' · ')}</p>
      ${sig.length ? `<table><thead><tr><th>Point</th><th>Rule</th><th>What it means</th><th>Review</th></tr></thead><tbody>${sig.map((s) => `<tr><td>${e(s.label)}</td><td>${e(s.rule)}</td><td>${e(s.text)}</td><td>${s.review ? `${e(s.review.outcome)}: ${e(s.review.comment)} (${e(s.review.reviewed_by_name)})` : '<i>Not reviewed</i>'}</td></tr>`).join('')}</tbody></table>`
        : p.chart && p.chart !== 'pareto' && p.chart !== 'regression' ? '<p class="m">No signals.</p>' : ''}</section>`;
  };
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font: 9pt Helvetica, Arial, sans-serif; color: #1d2a33; margin: 0; }
    .head { display: flex; justify-content: space-between; border-bottom: 2px solid #1f3a2c; padding-bottom: 8px; margin-bottom: 10px; }
    .brand { font-size: 15pt; font-weight: 700; color: #1f3a2c; } h1 { margin: 0; font-size: 15pt; color: #1f3a2c; text-align: right; } .m { color: #66737f; font-size: 8.5pt; }
    section { page-break-inside: avoid; margin-bottom: 14px; } h2 { font-size: 11pt; color: #1f3a2c; margin: 10px 0 4px; }
    .svg svg { width: 100%; height: auto; } .facts { margin: 4px 0; } table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    th { background: #eef3f0; text-align: left; font-size: 8pt; padding: 3px 4px; } td { border-bottom: 1px solid #e6ebe8; padding: 3px 4px; font-size: 8pt; vertical-align: top; }
  </style></head><body>
  <div class="head"><div><div class="brand">Tentamus North America</div><div class="m">${e(lab.site_name || lab.site_code)} · trending</div></div>
    <div><h1>${e(title)}</h1><div class="m" style="text-align:right">${from || to ? `${e(from || 'the start')} to ${e(to || 'today')}` : 'Default period'} · printed ${e(new Date(me.now).toISOString().slice(0, 16).replace('T', ' '))} UTC by ${e(me.full_name)}</div></div></div>
  ${intro ? `<p>${e(intro)}</p>` : ''}
  ${panels.map(block).join('') || '<p class="m">Nothing to chart.</p>'}
  <p class="m">Control limits are the centre line ± 3 sigma (individuals: sigma from the average moving range / 1.128; p: from the overall rate and each period's count; c: √mean). Signals follow the Western Electric rules: R1 a point beyond 3 sigma; R2 2 of 3 beyond 2 sigma; R3 4 of 5 beyond 1 sigma; R4 8 in a row on one side; R5 6 in a row rising or falling; LIM outside the specification or acceptance limits. A trend chart is a monitoring tool (ISO/IEC 17025 7.7); it does not change any result.</p>
  </body></html>`;
}
