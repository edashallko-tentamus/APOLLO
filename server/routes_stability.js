// Stability studies (migration 032). The quote's sending, the client's link, accepting and rejecting are the quote
// routes (routes_quotes.js: a stability quote is a project of kind 'Stability'); here: the stability quotes list,
// a new one, its design (one save for the plan, conditions, timepoints, tests and matrix), a new version; the
// studies, placement in chambers, pull orders, recording pulls, the cumulative report; conditions, chambers, racks.
'use strict';
const S = require('./stability');
const COA = require('./coa');
const { verifySignature } = require('./auth');

module.exports = function registerStability({ route, tx, signedTx, upsertRows, currentSite, checkSite, hasPermission, isUuid, AUDIT_SCOPES, AUDIT_LISTS, AUDIT_CHECKS }) {
  const r = route;
  const pg = (v) => (Array.isArray(v) ? v : String(v || '').replace(/^\{|\}$/g, '').split(',').filter(Boolean));
  const isAdmin = async (c) => !!(await c.db.one('SELECT is_admin FROM app_user WHERE id = $1', [c.userId]) || {}).is_admin;

  // ---------------------------------------------------------------- setup: conditions, chambers, racks
  r('GET', '/api/stability/setup', async (c) => {
    const site = await currentSite(c);
    const conditions = await c.db.rows(`SELECT sc.*, sc.status::text AS status, s.site_code,
        (SELECT count(*) FROM stability_chamber ch WHERE ch.condition_id = sc.id AND ch.site_id = $1 AND ch.status = 'Active')::int AS chambers
      FROM stability_condition sc LEFT JOIN lab_site s ON s.id = sc.site_id WHERE sc.site_id IS NULL OR sc.site_id = $1 ORDER BY sc.site_id NULLS FIRST, sc.sort_order, sc.condition_name`, [site]);
    const chambers = await c.db.rows(`SELECT ch.id, ch.equipment_id, ch.condition_id, ch.notes, ch.status::text AS status, e.equipment_code, e.equipment_name, e.admin_status::text AS admin_status,
        sc.condition_name, ev.availability,
        (SELECT count(*) FROM stability_rack rk WHERE rk.chamber_id = ch.id AND rk.status = 'Active')::int AS racks,
        (SELECT count(*) FROM stability_storage s JOIN stability_rack rk ON rk.id = s.rack_id WHERE rk.chamber_id = ch.id AND s.status = 'Stored')::int AS stored
      FROM stability_chamber ch JOIN equipment e ON e.id = ch.equipment_id JOIN stability_condition sc ON sc.id = ch.condition_id
      LEFT JOIN equipment_view ev ON ev.id = e.id WHERE ch.site_id = $1 ORDER BY e.equipment_name`, [site]).catch(async () => c.db.rows(`SELECT ch.id, ch.equipment_id, ch.condition_id, ch.notes, ch.status::text AS status,
        e.equipment_code, e.equipment_name, e.admin_status::text AS admin_status, sc.condition_name, NULL AS availability, 0 AS racks, 0 AS stored
      FROM stability_chamber ch JOIN equipment e ON e.id = ch.equipment_id JOIN stability_condition sc ON sc.id = ch.condition_id WHERE ch.site_id = $1 ORDER BY e.equipment_name`, [site]));
    const racks = await c.db.rows(`SELECT rk.id, rk.chamber_id, rk.rack_code, rk.description, rk.positions, rk.status::text AS status, e.equipment_name, sc.condition_name,
        (SELECT string_agg(s.storage_code || COALESCE(' @ ' || s.position, ''), ', ') FROM stability_storage s WHERE s.rack_id = rk.id AND s.status = 'Stored') AS holds
      FROM stability_rack rk JOIN stability_chamber ch ON ch.id = rk.chamber_id JOIN equipment e ON e.id = ch.equipment_id JOIN stability_condition sc ON sc.id = ch.condition_id
      WHERE ch.site_id = $1 ORDER BY e.equipment_name, rk.rack_code`, [site]);
    const equipment = await c.db.rows(`SELECT e.id, e.equipment_code, e.equipment_name, t.type_name FROM equipment e JOIN equipment_type t ON t.id = e.equipment_type_id
      WHERE e.site_id = $1 AND e.admin_status <> 'Retired' ORDER BY (t.type_name ILIKE '%stability%') DESC, e.equipment_name`, [site]);
    const upcoming = await c.db.rows(`SELECT p.id, p.study_id, p.study_code, p.client_name, p.condition_name, p.timepoint_label, p.scheduled_date, p.window_start, p.window_end, p.status,
        p.equipment_name, p.equipment_code, p.rack_code, p.position, p.storage_code, p.units_required, p.overdue
      FROM stability_pull_view p WHERE p.site_id = $1 AND p.status IN ('Scheduled','Ordered') AND p.scheduled_date <= site_today($1) + 120 ORDER BY p.scheduled_date, p.equipment_name`, [site]);
    const lab = await c.db.one('SELECT stability_pull_window_days, stability_reserve_pct, site_code FROM lab_site WHERE id = $1', [site]);
    return { conditions, chambers, racks, equipment, upcoming, lab, can: await hasPermission(c, 'stability.configure'), sysadmin: await isAdmin(c) };
  });
  r('POST', '/api/stability/conditions', async (c) => {
    const site = await currentSite(c);
    return tx({ ...c, siteId: site, reason: c.body.reason || 'Stability conditions changed' }, (t) => upsertRows(t, 'stability_condition',
      (c.body.rows || []).map((x) => (x.id ? (({ site_id, ...rest }) => rest)(x) : { ...x, site_id: x.site_id === 'all' ? null : site })),
      ['condition_name', 'condition_type', 'temperature_c', 'temperature_tol', 'humidity_pct', 'humidity_tol', 'description', 'sort_order', 'status', 'site_id']));
  });
  r('POST', '/api/stability/chambers', async (c) => {
    const site = await currentSite(c);
    return tx({ ...c, siteId: site, reason: c.body.reason || 'Stability chambers changed' }, (t) => upsertRows(t, 'stability_chamber', c.body.rows || [], ['equipment_id', 'condition_id', 'notes', 'status'], { site_id: site }));
  });
  r('POST', '/api/stability/racks', async (c) => {
    const site = await currentSite(c);
    return tx({ ...c, siteId: site, reason: c.body.reason || 'Stability racks changed' }, (t) => upsertRows(t, 'stability_rack', c.body.rows || [], ['chamber_id', 'rack_code', 'description', 'positions', 'status']));
  });

  // ---------------------------------------------------------------- stability quotes
  r('GET', '/api/stability/quotes', async (c) => ({
    rows: await c.db.rows(`SELECT q.*, pl.product, s.site_code, st.id AS study_id, st.study_code, st.status AS study_status
      FROM quote_list_view q LEFT JOIN stability_plan pl ON pl.project_version_id = q.version_id LEFT JOIN lab_site s ON s.id = pl.site_id
      LEFT JOIN stability_study st ON st.project_id = q.project_id WHERE q.kind = 'Stability' ORDER BY COALESCE(q.sent_at, q.quoted_at, q.version_created_at) DESC`),
    labs: await c.db.rows(`SELECT id, site_code, site_name, stability_pull_window_days FROM lab_site WHERE status = 'Active' ORDER BY site_code`),
    me: c.userId, can_edit: await hasPermission(c, 'quotes.edit') }));

  r('POST', '/api/stability/quotes', (c) => tx({ ...c, reason: c.body.reason || 'New stability quote' }, async (t) => {
    const b = c.body || {};
    if (!isUuid(b.client_id)) throw new Error('Choose the client');
    if (!isUuid(b.site_id)) throw new Error('Choose the lab that stores and tests the study');
    const cl = await t.one('SELECT COALESCE(display_name, legal_name) AS name FROM client WHERE id = $1', [b.client_id]);
    const lab = await t.one('SELECT stability_pull_window_days AS w FROM lab_site WHERE id = $1', [b.site_id]);
    const p = await t.one(`INSERT INTO project (client_id, project_name, kind, quote_contact_id, site_id) VALUES ($1, $2, 'Stability', $3, $4) RETURNING id, project_code`,
      [b.client_id, String(b.project_name || '').trim() || `Stability study for ${cl.name}`, isUuid(b.quote_contact_id) ? b.quote_contact_id : null, b.site_id]);
    const v = await t.one('SELECT new_project_version($1) AS id', [p.id]);
    await t.query(`INSERT INTO stability_plan (project_version_id, site_id, product, lot, unit_name) VALUES ($1, $2, $3, $4, $5)`,
      [v.id, b.site_id, b.product || null, b.lot || null, String(b.unit_name || '').trim() || 'units']);
    // a start: real time and accelerated, the usual ICH timepoints, the lab's pull window
    await t.query(`INSERT INTO stability_version_condition (project_version_id, condition_id, sort_order)
      SELECT $1, id, sort_order FROM stability_condition WHERE site_id IS NULL AND condition_name IN ('25 °C / 60% RH','40 °C / 75% RH') AND status = 'Active'`, [v.id]);
    await t.query(`INSERT INTO stability_timepoint (project_version_id, label, interval_value, interval_unit, days_early, days_late)
      SELECT $1, l, n, 'Months', CASE WHEN n = 0 THEN 0 ELSE $2 END, CASE WHEN n = 0 THEN 0 ELSE $2 END
        FROM (VALUES ('T0', 0), ('3 M', 3), ('6 M', 6), ('9 M', 9), ('12 M', 12), ('18 M', 18), ('24 M', 24)) x(l, n)`, [v.id, lab.w]);
    return { id: p.id, version_id: v.id, project_code: p.project_code };
  }));

  const quotePage = async (c, pid) => {
    if (!isUuid(pid)) throw new Error('Stability quote not found');
    const p = await c.db.one(`SELECT p.*, COALESCE(cl.display_name, cl.legal_name) AS client_name, ou.full_name AS owner_name,
        NULLIF(btrim(COALESCE(qc.first_name, '') || ' ' || COALESCE(qc.last_name, '')), '') AS quote_contact_name
      FROM project p JOIN client cl ON cl.id = p.client_id LEFT JOIN app_user ou ON ou.id = COALESCE(p.owner_id, p.created_by)
      LEFT JOIN contact qc ON qc.id = p.quote_contact_id WHERE p.id = $1 AND p.kind = 'Stability'`, [pid]);
    if (!p) throw new Error('Stability quote not found');
    const versions = await c.db.rows(`SELECT pv.*, pv.status::text AS status, NULLIF(btrim(COALESCE(sc.first_name, '') || ' ' || COALESCE(sc.last_name, '')), '') AS sent_to_name,
        NULLIF(btrim(COALESCE(ac.first_name, '') || ' ' || COALESCE(ac.last_name, '')), '') AS accepted_by_name
      FROM project_version pv LEFT JOIN contact sc ON sc.id = pv.sent_to_contact_id LEFT JOIN contact ac ON ac.id = pv.accepted_by_contact_id
      WHERE pv.project_id = $1 ORDER BY pv.version_no DESC`, [pid]);
    const v = versions[0];
    const d = await S.design(c.db, v.id);
    const site = d.plan ? d.plan.site_id : null;
    const conditions = await c.db.rows(`SELECT id, condition_name, condition_type, site_id FROM stability_condition WHERE status = 'Active' AND (site_id IS NULL OR site_id = $1) ORDER BY site_id NULLS FIRST, sort_order, condition_name`, [site]);
    const catalog = await c.db.rows(`SELECT tc.test_id, tc.test_code, tc.test_name, tc.list_price, tc.pricing_mode, t.site_id,
        EXISTS (SELECT 1 FROM test_version tv WHERE tv.test_id = t.id AND tv.status = 'Effective') AS has_effective
      FROM test_catalogue tc JOIN test t ON t.id = tc.test_id WHERE tc.test_status = 'Active' AND (t.site_id IS NULL OR t.site_id = $1) ORDER BY tc.test_name`, [site]);
    const contacts = await c.db.rows(`SELECT ct.id, NULLIF(btrim(COALESCE(ct.first_name, '') || ' ' || COALESCE(ct.last_name, '')), '') AS name, ct.email, cc.roles
      FROM client_contact cc JOIN contact ct ON ct.id = cc.contact_id WHERE cc.client_id = $1 AND cc.status = 'Active' AND ct.status = 'Active' ORDER BY ct.last_name`, [p.client_id]);
    const study = await c.db.one('SELECT id, study_code, status, project_version_id, amendment_no FROM stability_study WHERE project_id = $1', [pid]);
    const tok = v.client_token ? `${(process.env.LIMS_PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '')}/quote-response.html?t=${v.client_token}` : null;
    return { project: p, version: v, versions, design: d, years: S.priceByYear(d), problems: d.problems, conditions, catalog, contacts, study, link: tok,
      labs: await c.db.rows(`SELECT id, site_code, stability_pull_window_days FROM lab_site WHERE status = 'Active' ORDER BY site_code`),
      editable: ['Draft', 'Submitted for Quote'].includes(v.status), can_edit: await hasPermission(c, 'quotes.edit') };
  };
  r('GET', '/api/stability/quotes/:id', (c) => quotePage(c, c.params.id));

  // One save for the whole design. body: { plan, condition_ids, timepoints[], lines[{test_id, final_price, units, t0}], matrix[{test_id, condition_id, labels[]}] }
  r('POST', '/api/stability/versions/:vid/design', async (c) => {
    const vid = c.params.vid;
    if (!isUuid(vid)) throw new Error('Version not found');
    const b = c.body || {};
    return tx({ ...c, reason: b.reason || 'Stability study design changed' }, async (t) => {
      const v = await t.one(`SELECT pv.status::text AS status FROM project_version pv JOIN project p ON p.id = pv.project_id WHERE pv.id = $1 AND p.kind = 'Stability'`, [vid]);
      if (!v) throw new Error('Version not found');
      if (!['Draft', 'Submitted for Quote'].includes(v.status)) throw new Error('The design is locked once the quote is issued: start a new version to change it');
      // the plan
      if (b.plan) {
        const pl = b.plan;
        await t.query(`UPDATE stability_plan SET product = $2, lot = $3, protocol_ref = $4, unit_name = COALESCE(NULLIF(btrim($5), ''), 'units'),
          planned_placement = $6, escalation_pct = COALESCE($7, 0), reserve_pct = $8, notes = $9 WHERE project_version_id = $1`,
          [vid, pl.product || null, pl.lot || null, pl.protocol_ref || null, pl.unit_name || '', pl.planned_placement || null,
            pl.escalation_pct === '' || pl.escalation_pct === null || pl.escalation_pct === undefined ? null : Number(pl.escalation_pct),
            pl.reserve_pct === '' || pl.reserve_pct === null || pl.reserve_pct === undefined ? null : Number(pl.reserve_pct), pl.notes || null]);
      }
      // conditions
      if (Array.isArray(b.condition_ids)) {
        const want = b.condition_ids.filter(isUuid);
        await t.query(`UPDATE stability_cell SET status = 'Removed' WHERE project_version_id = $1 AND status = 'Active' AND condition_id IS NOT NULL AND NOT (condition_id = ANY($2::uuid[]))`, [vid, want]);
        await t.query(`UPDATE stability_version_condition SET status = 'Removed' WHERE project_version_id = $1 AND status = 'Active' AND NOT (condition_id = ANY($2::uuid[]))`, [vid, want]);
        let i = 0;
        for (const id of want) {
          i += 1;
          const has = await t.one(`SELECT id FROM stability_version_condition WHERE project_version_id = $1 AND condition_id = $2 AND status = 'Active'`, [vid, id]);
          if (has) await t.query('UPDATE stability_version_condition SET sort_order = $2 WHERE id = $1 AND sort_order <> $2', [has.id, i]);
          else await t.query('INSERT INTO stability_version_condition (project_version_id, condition_id, sort_order) VALUES ($1, $2, $3)', [vid, id, i]);
        }
      }
      // timepoints (by id; new ones by label)
      if (Array.isArray(b.timepoints)) {
        const keep = [];
        for (const x of b.timepoints) {
          const label = String(x.label || '').trim(); if (!label) continue;
          const vals = [label, Number(x.interval_value), x.interval_unit || 'Months', Number(x.days_early ?? 7), Number(x.days_late ?? x.days_early ?? 7)];
          if (Number.isNaN(vals[1])) throw new Error(`${label}: type the interval (0 for T0)`);
          if (isUuid(x.id)) { await t.query(`UPDATE stability_timepoint SET label = $2, interval_value = $3, interval_unit = $4, days_early = $5, days_late = $6 WHERE id = $1 AND project_version_id = $7`, [x.id, ...vals, vid]); keep.push(x.id); }
          else keep.push((await t.one(`INSERT INTO stability_timepoint (project_version_id, label, interval_value, interval_unit, days_early, days_late) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [vid, ...vals])).id);
        }
        await t.query(`UPDATE stability_cell SET status = 'Removed' WHERE project_version_id = $1 AND status = 'Active' AND NOT (timepoint_id = ANY($2::uuid[]))`, [vid, keep]);
        await t.query(`UPDATE stability_timepoint SET status = 'Removed' WHERE project_version_id = $1 AND status = 'Active' AND NOT (id = ANY($2::uuid[]))`, [vid, keep]);
      }
      // tests (quote lines) and the matrix
      if (Array.isArray(b.lines)) {
        const want = b.lines.filter((x) => isUuid(x.test_id));
        const ids = want.map((x) => x.test_id);
        await t.query(`UPDATE stability_cell c SET status = 'Removed' FROM quoted_test_configuration q WHERE q.id = c.line_id AND c.project_version_id = $1 AND c.status = 'Active' AND NOT (q.test_id = ANY($2::uuid[]))`, [vid, ids]);
        await t.query(`UPDATE quoted_test_configuration SET status = 'Removed' WHERE project_version_id = $1 AND status = 'Active' AND NOT (test_id = ANY($2::uuid[]))`, [vid, ids]);
        const tps = await t.rows(`SELECT id, label, interval_value FROM stability_timepoint WHERE project_version_id = $1 AND status = 'Active'`, [vid]);
        const t0 = tps.find((x) => Number(x.interval_value) === 0);
        const conds = (await t.rows(`SELECT condition_id FROM stability_version_condition WHERE project_version_id = $1 AND status = 'Active'`, [vid])).map((x) => x.condition_id);
        for (const x of want) {
          let line = await t.one(`SELECT id, list_price FROM quoted_test_configuration WHERE project_version_id = $1 AND test_id = $2 AND status = 'Active'`, [vid, x.test_id]);
          if (!line) line = await t.one('INSERT INTO quoted_test_configuration (project_version_id, test_id) VALUES ($1, $2) RETURNING id, list_price', [vid, x.test_id]);
          const fp = x.final_price === '' || x.final_price === null || x.final_price === undefined ? line.list_price : Number(x.final_price);
          await t.query('UPDATE quoted_test_configuration SET final_price = $2 WHERE id = $1 AND final_price IS DISTINCT FROM $2', [line.id, fp]);
          const units = Math.max(1, Math.round(Number(x.units) || 1));
          // the cells this line should have: T0 when ticked, and the matrix rows' timepoints per condition
          const wantCells = [];
          if (x.t0 && t0) wantCells.push([t0.id, null]);
          for (const m of (b.matrix || []).filter((y) => y.test_id === x.test_id && conds.includes(y.condition_id))) {
            for (const lb of m.labels || []) { const tp = tps.find((y) => y.label === lb && Number(y.interval_value) > 0); if (tp) wantCells.push([tp.id, m.condition_id]); }
          }
          const have = await t.rows(`SELECT id, timepoint_id, condition_id, units_required FROM stability_cell WHERE line_id = $1 AND status = 'Active'`, [line.id]);
          for (const h of have) {
            if (!wantCells.some(([tp, cd]) => tp === h.timepoint_id && (cd || null) === (h.condition_id || null))) await t.query(`UPDATE stability_cell SET status = 'Removed' WHERE id = $1`, [h.id]);
            else if (Number(h.units_required) !== units) await t.query('UPDATE stability_cell SET units_required = $2 WHERE id = $1', [h.id, units]);
          }
          for (const [tp, cd] of wantCells) {
            if (!have.some((h) => h.timepoint_id === tp && (h.condition_id || null) === (cd || null))) {
              await t.query('INSERT INTO stability_cell (project_version_id, line_id, timepoint_id, condition_id, units_required) VALUES ($1, $2, $3, $4, $5)', [vid, line.id, tp, cd, units]);
            }
          }
        }
      }
      return { ok: true };
    });
  });
  r('POST', '/api/stability/quotes/:id/new-version', (c) => tx({ ...c, reason: c.body.reason || 'New version of the stability quote' }, async (t) => ({
    version_id: (await t.one('SELECT new_stability_version($1) AS id', [c.params.id])).id })));

  // ---------------------------------------------------------------- studies
  const makeDue = (c, site) => c.db.tx({ userId: c.userId, reason: 'Stability pulls due', siteId: site }, (t) => t.one('SELECT create_due_stability_pulls($1) AS n', [site])).catch(() => ({ n: 0 }));
  r('GET', '/api/stability/studies', async (c) => {
    const site = await currentSite(c);
    await makeDue(c, site);
    return { rows: await c.db.rows(`SELECT * FROM stability_study_view WHERE site_id = $1 ORDER BY CASE status WHEN 'Awaiting material' THEN 0 WHEN 'Active' THEN 1 ELSE 2 END, next_pull NULLS LAST, study_code`, [site]),
      pulls: await c.db.rows(`SELECT * FROM stability_pull_view WHERE site_id = $1 AND status IN ('Scheduled','Ordered') AND scheduled_date <= site_today($1) + 60 ORDER BY scheduled_date, study_code`, [site]),
      today: (await c.db.one('SELECT site_today($1) AS d', [site])).d, can_manage: await hasPermission(c, 'stability.manage') };
  });
  r('GET', '/api/stability/studies/:id', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Study not found');
    const st = await c.db.one('SELECT * FROM stability_study_view WHERE id = $1', [c.params.id]);
    if (!st) throw new Error('Study not found');
    await checkSite(c, st.site_id);
    await makeDue(c, st.site_id);
    const d = await S.design(c.db, st.project_version_id);
    const storage = await c.db.rows('SELECT * FROM stability_storage_view WHERE study_id = $1 ORDER BY storage_code', [st.id]);
    const pulls = await c.db.rows(`SELECT * FROM stability_pull_view WHERE study_id = $1 ORDER BY scheduled_date, condition_name`, [st.id]);
    const racks = await c.db.rows(`SELECT rk.id, rk.rack_code, rk.positions, ch.condition_id, e.equipment_code, e.equipment_name, e.admin_status::text AS admin_status
      FROM stability_rack rk JOIN stability_chamber ch ON ch.id = rk.chamber_id JOIN equipment e ON e.id = ch.equipment_id
      WHERE ch.site_id = $1 AND rk.status = 'Active' AND ch.status = 'Active' ORDER BY e.equipment_name, rk.rack_code`, [st.site_id]);
    const placed = new Set(storage.map((x) => x.condition_id));
    const need = d.conditions.filter((cd) => st.status === 'Awaiting material' || !placed.has(cd.condition_id)).map((cd) => {
      const units = d.cells.filter((x) => x.condition_id === cd.condition_id).reduce((s, x) => s + Number(x.units_required), 0);
      return { condition_id: cd.condition_id, condition_name: cd.condition_name, units, with_reserve: Math.ceil(units * (1 + Number(st.reserve_pct) / 100)) };
    });
    const t0 = d.timepoints.find((x) => Number(x.interval_value) === 0);
    const t0units = t0 ? d.cells.filter((x) => x.timepoint_id === t0.id).reduce((s, x) => s + Number(x.units_required), 0) : 0;
    const t0tests = await c.db.rows(`SELECT rt.id, t.test_name, rt.status::text AS status, rt.due_date FROM requested_test rt JOIN test t ON t.id = rt.test_id WHERE rt.sample_id = $1 ORDER BY t.test_name`, [st.t0_sample_id]);
    const amendments = await c.db.rows(`SELECT a.*, fv.version_no AS from_version, tv.version_no AS to_version, u.full_name AS applied_by_name FROM stability_amendment a
      JOIN project_version fv ON fv.id = a.from_version_id JOIN project_version tv ON tv.id = a.to_version_id JOIN app_user u ON u.id = a.applied_by
      WHERE a.study_id = $1 ORDER BY a.amendment_no DESC`, [st.id]);
    const excursions = await c.db.rows(`SELECT logbook_entry_id, entry_code, equipment_id, equipment_code, equipment_name, entry_at, window_start, window_end, to_jsonb(problems) AS problems, failure_reason,
        storage_code, condition_name, assessment_id, decision, justification, assessed_at, assessed_by_name, affected_pulls
      FROM stability_excursion_status_view WHERE study_id = $1 ORDER BY entry_at DESC`, [st.id]);
    const reports = await c.db.rows(`SELECT r.id, r.report_code, r.version_no, r.is_final, r.issued_at, u.full_name AS issued_by_name FROM stability_report r JOIN app_user u ON u.id = r.issued_by
      WHERE r.study_id = $1 ORDER BY r.version_no DESC`, [st.id]);
    const reportProblems = await c.db.rows('SELECT * FROM stability_report_problems($1, $2)', [st.id, c.userId]);
    const perm = (code) => hasPermission(c, code, st.site_id);
    return { study: st, design: d, storage, pulls, racks, need, t0units, t0tests, amendments, excursions, reports, report_problems: reportProblems,
      today: (await c.db.one('SELECT site_today($1) AS d', [st.site_id])).d,
      can_manage: await perm('stability.manage'), can_cancel: await perm('stability.cancel'), can_assess: await perm('stability.assess'),
      can_report: await perm('reports.finalize'), can_amend: await perm('quotes.edit') };
  });
  r('POST', '/api/stability/studies/:id/place', async (c) => {
    const st = await c.db.one('SELECT id, site_id FROM stability_study WHERE id = $1', [c.params.id]);
    if (!st) throw new Error('Study not found');
    await checkSite(c, st.site_id);
    const b = c.body || {};
    return tx({ ...c, siteId: st.site_id, reason: b.reason || 'Stability material placed in the chambers' }, (t) => t.one('SELECT place_stability_study($1, $2::date, $3::jsonb, $4) AS pulls',
      [st.id, b.placement_date || null, JSON.stringify(b.rows || []), b.t0_units === '' ? null : Number(b.t0_units)]));
  });
  r('POST', '/api/stability/pulls/:id/record', async (c) => {
    const p = await c.db.one('SELECT p.id, s.site_id FROM stability_pull p JOIN stability_study s ON s.id = p.study_id WHERE p.id = $1', [c.params.id]);
    if (!p) throw new Error('Pull not found');
    await checkSite(c, p.site_id);
    const b = c.body || {};
    return tx({ ...c, siteId: p.site_id, reason: b.reason || 'Stability pull taken' }, (t) => t.one('SELECT record_stability_pull($1, $2::timestamptz, $3, $4) AS left',
      [p.id, b.pulled_at || null, Number(b.units) || null, b.note || '']));
  });
  r('POST', '/api/stability/pulls/create-due', async (c) => {
    const site = await currentSite(c);
    return tx({ ...c, siteId: site, reason: 'Stability pull orders made' }, (t) => t.one('SELECT create_due_stability_pulls($1) AS n', [site]));
  });
  r('GET', '/api/stability/studies/:id/report', async (c) => {
    const st = await c.db.one('SELECT site_id FROM stability_study WHERE id = $1', [c.params.id]);
    if (!st) throw new Error('Study not found');
    await checkSite(c, st.site_id);
    return S.reportData(c.db, c.params.id);
  });
  r('GET', '/api/stability/studies/:id/report.pdf', async (c) => {
    const st = await c.db.one('SELECT site_id, study_code FROM stability_study WHERE id = $1', [c.params.id]);
    if (!st) throw new Error('Study not found');
    await checkSite(c, st.site_id);
    const out = await S.reportPdf(c.db, c.params.id);
    return { __raw: true, body: out.buf, type: 'application/pdf', headers: { 'Content-Disposition': `inline; filename="${st.study_code} stability summary.pdf"` } };
  });

  // ---------------------------------------------------------------- S-2 (migration 041): cancel, dispose, excursions, issued reports
  const studyOf = async (c, id) => {
    if (!isUuid(id)) throw new Error('Study not found');
    const st = await c.db.one('SELECT id, site_id, study_code FROM stability_study WHERE id = $1', [id]);
    if (!st) throw new Error('Study not found');
    await checkSite(c, st.site_id);
    return st;
  };
  // cancel: signed "Cancelled by", with the reason and every stored material's fate
  r('POST', '/api/stability/studies/:id/cancel', async (c) => {
    const st = await studyOf(c, c.params.id);
    const b = c.body || {};
    return signedTx({ ...c, siteId: st.site_id, reason: b.reason || '' }, { meaning: 'Cancelled by', action: `Stability study ${st.study_code} cancelled`, module: 'Stability' },
      (t) => t.one('SELECT cancel_stability_study($1, $2, $3::jsonb) AS pulls', [st.id, b.reason || '', JSON.stringify(b.dispositions || [])]));
  });
  // material no longer needed: signed "Disposed by"
  r('POST', '/api/stability/storage/:id/dispose', async (c) => {
    const s = await c.db.one(`SELECT s.id, s.storage_code, st.site_id FROM stability_storage s JOIN stability_study st ON st.id = s.study_id WHERE s.id = $1`, [isUuid(c.params.id) ? c.params.id : null]);
    if (!s) throw new Error('Stored material not found');
    await checkSite(c, s.site_id);
    const b = c.body || {};
    return signedTx({ ...c, siteId: s.site_id, reason: b.reason || '' }, { meaning: 'Disposed by', action: `${s.storage_code}: ${b.disposition || ''}`, module: 'Stability' },
      (t) => t.query('SELECT dispose_stability_material($1, $2, $3)', [s.id, b.disposition || null, b.note || null]).then(() => ({ ok: true })));
  });
  // QA's assessment of an excursion for this study: signed "Assessed by", with the justification
  r('POST', '/api/stability/studies/:id/excursions/:entry/assess', async (c) => {
    const st = await studyOf(c, c.params.id);
    const b = c.body || {};
    return signedTx({ ...c, siteId: st.site_id, reason: b.reason || 'Chamber excursion assessed' }, { meaning: 'Assessed by', action: `Excursion assessed for ${st.study_code}: ${b.decision || ''}`, module: 'Stability' },
      async (t) => ({ id: (await t.one('SELECT assess_stability_excursion($1, $2, $3, $4) AS id', [st.id, isUuid(c.params.entry) ? c.params.entry : null, b.decision || null, b.justification || ''])).id }));
  });

  // the issued report: the signer's signature and title (as on a COA)
  const signer = (db, userId) => db.one(`SELECT u.full_name, u.title, f.mime_type AS sig_type, encode(f.content, 'base64') AS sig_b64
    FROM app_user u LEFT JOIN document_file f ON f.id = u.signature_document_id WHERE u.id = $1`, [userId]);
  const issueParts = async (db, st, userId) => {
    const next = await db.one(`SELECT COALESCE(max(version_no), 0) + 1 AS n FROM stability_report WHERE study_id = $1`, [st.id]);
    const meta = await db.one(`SELECT stability_report_fingerprint($1) AS fingerprint, stability_report_is_final($1) AS is_final, clock_timestamp() AS at,
        (SELECT time_zone FROM lab_site WHERE id = $2) AS tz`, [st.id, st.site_id]);
    const me = await signer(db, userId);
    const data = await S.reportData(db, st.id, { issued: true });
    const issue = { report_code: `${st.study_code}-SR${next.n}`, version_no: next.n, is_final: !!meta.is_final, by: me.full_name, title: me.title || '',
      signature: me.sig_b64 ? `data:${me.sig_type};base64,${me.sig_b64}` : null, at: meta.at, tz: meta.tz };
    const content = { report_code: issue.report_code, version_no: issue.version_no, is_final: issue.is_final, fingerprint: meta.fingerprint,
      issued_by: issue.by, signer_title: issue.title, result_ids: data.result_ids, sections: data.sections, excursions: data.excursions, amendments: data.amendments,
      study: { code: data.study.study_code, status: data.study.status, client: data.study.client_name, product: data.study.product, lot: data.study.lot, placement_date: data.study.placement_date } };
    return { data, issue, content };
  };
  // a preview of the report that would be issued now (marked as a preview, not signed)
  r('GET', '/api/stability/studies/:id/report-preview.pdf', async (c) => {
    const st = await studyOf(c, c.params.id);
    const { data, issue } = await issueParts(c.db, st, c.userId);
    const html = S.reportHtml(data, { ...issue, signature: null }).replace('<body>', '<body><div style="border:2px solid #c68a00;color:#8a5a00;padding:6px 10px;margin-bottom:10px;font-weight:700">PREVIEW: not issued</div>');
    const out = await COA.htmlToPdf(html, `${issue.report_code} PREVIEW, NOT ISSUED · Tentamus North America`);
    return { __raw: true, body: out.buf, type: 'application/pdf', headers: { 'Content-Disposition': `inline; filename="${issue.report_code} preview.pdf"` } };
  });
  // issue: the password first, then the PDF as it will stand, then the signed issue with it
  r('POST', '/api/stability/studies/:id/reports', async (c) => {
    const st = await studyOf(c, c.params.id);
    await verifySignature(c);
    const blocks = (await c.db.rows('SELECT problem FROM stability_report_problems($1, $3) WHERE severity = $2', [st.id, 'Block', c.userId])).map((x) => x.problem);
    if (blocks.length) throw new Error('The report cannot be issued: ' + blocks.join('; '));
    const { data, issue, content } = await issueParts(c.db, st, c.userId);
    const pdf = await COA.htmlToPdf(S.reportHtml(data, issue), `${issue.report_code} · ${issue.is_final ? 'Final' : 'Interim'} stability report · Tentamus North America`);
    return c.db.tx({ userId: c.userId, reason: c.body.reason || `Stability report ${issue.report_code} issued`, siteId: st.site_id }, async (t) => {
      await t.one('SELECT sign_action($1, $2, $3, $4) AS id', ['Issued by', `Stability report ${issue.report_code}${issue.is_final ? ' (Final)' : ''}`, 'Stability', null]);
      const d = await t.one(`INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ($1, 'application/pdf', $2, $3, decode($4, 'base64')) RETURNING id`,
        [`${issue.report_code} stability report.pdf`, pdf.buf.length, pdf.sha256, pdf.buf.toString('base64')]);
      const id = (await t.one('SELECT issue_stability_report($1, $2::jsonb, $3, $4) AS id', [st.id, JSON.stringify(content), d.id, pdf.sha256])).id;
      return { id, report_code: issue.report_code, is_final: issue.is_final };
    });
  });
  // Report Finalization > Stability reports: the lab's studies that have, or will have, a report to issue
  r('GET', '/api/stability/reports-due', async (c) => {
    const site = await currentSite(c);
    const rows = await c.db.rows(`SELECT s.id, s.study_code, s.client_id, s.client_name, s.product, s.status, s.pulls_done, s.pulls_total, s.excursions_open,
        s.last_report_code, s.last_report_at, cardinality(stability_finalized_results(s.id)) AS finalized,
        (SELECT string_agg(p.problem, '; ') FROM stability_report_problems(s.id, $2) p WHERE p.severity = 'Block') AS blocked,
        (SELECT p.problem FROM stability_report_problems(s.id, $2) p WHERE p.severity = 'Info') AS next_report
      FROM stability_study_view s WHERE s.site_id = $1 AND s.status <> 'Awaiting material'
      ORDER BY (SELECT count(*) FROM stability_report_problems(s.id, $2) p WHERE p.severity = 'Block') = 0 DESC, s.study_code`, [site, c.userId]);
    return { rows, can_report: await hasPermission(c, 'reports.finalize') };
  });
  r('GET', '/api/stability/reports/:id/pdf', async (c) => {
    const rp = await c.db.one(`SELECT r.report_code, s.site_id, encode(f.content, 'base64') AS b64 FROM stability_report r JOIN stability_study s ON s.id = r.study_id
      JOIN document_file f ON f.id = r.document_id WHERE r.id = $1`, [isUuid(c.params.id) ? c.params.id : null]);
    if (!rp) throw new Error('Report not found');
    await checkSite(c, rp.site_id);
    return { __raw: true, body: Buffer.from(rp.b64, 'base64'), type: 'application/pdf', headers: { 'Content-Disposition': `inline; filename="${rp.report_code} stability report.pdf"` } };
  });

  AUDIT_CHECKS.stability_study = (c, id) => studyOf(c, id);
  AUDIT_SCOPES.stability_study = `SELECT 'stability_study', $1::uuid UNION ALL SELECT 'stability_storage', id FROM stability_storage WHERE study_id = $1
    UNION ALL SELECT 'stability_pull', id FROM stability_pull WHERE study_id = $1
    UNION ALL SELECT 'stability_amendment', id FROM stability_amendment WHERE study_id = $1
    UNION ALL SELECT 'stability_excursion_assessment', id FROM stability_excursion_assessment WHERE study_id = $1
    UNION ALL SELECT 'stability_report', id FROM stability_report WHERE study_id = $1`;
  AUDIT_SCOPES.stability_quote = `SELECT 'project', $1::uuid UNION ALL SELECT 'project_version', id FROM project_version WHERE project_id = $1
    UNION ALL SELECT 'quoted_test_configuration', q.id FROM quoted_test_configuration q JOIN project_version pv ON pv.id = q.project_version_id WHERE pv.project_id = $1
    UNION ALL SELECT 'stability_plan', x.id FROM stability_plan x JOIN project_version pv ON pv.id = x.project_version_id WHERE pv.project_id = $1
    UNION ALL SELECT 'stability_version_condition', x.id FROM stability_version_condition x JOIN project_version pv ON pv.id = x.project_version_id WHERE pv.project_id = $1
    UNION ALL SELECT 'stability_timepoint', x.id FROM stability_timepoint x JOIN project_version pv ON pv.id = x.project_version_id WHERE pv.project_id = $1
    UNION ALL SELECT 'stability_cell', x.id FROM stability_cell x JOIN project_version pv ON pv.id = x.project_version_id WHERE pv.project_id = $1`;
  AUDIT_LISTS.stability_setup = ['stability_condition', 'stability_chamber', 'stability_rack'];
  AUDIT_LISTS.stability_studies = ['stability_study', 'stability_storage', 'stability_pull', 'stability_amendment', 'stability_excursion_assessment', 'stability_report'];
  AUDIT_LISTS.stability_quotes = ['project', 'stability_plan', 'stability_timepoint', 'stability_cell'];
  void pg;
};

// The hourly job: pull orders for every lab, as the system user
module.exports.makeDuePulls = async (db) => {
  const sys = await db.one(`SELECT id FROM app_user WHERE username = 'system'`);
  if (!sys) return { n: 0 };
  return db.tx({ userId: sys.id, reason: 'Stability pulls due today (hourly job)' }, (t) => t.one('SELECT create_due_stability_pulls(NULL) AS n'));
};
