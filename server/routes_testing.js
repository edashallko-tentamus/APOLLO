// Testing API (WD-2, migration 016): the backlog (pool) per department, autobatch, batches and the worklist, the batch
// page (entries, steps, recorded values, equipment, materials, raw data files, live results and QC verdicts), step
// completion signed "Performed by" (with an optional or required witness who signs too), reopening, re-analysis and
// re-prep (signed, with a reason) and assignment. Thin: every rule lives in the database.
'use strict';
const { page, wantsPage } = require('./paging');
const { verifyPassword } = require('./auth');
const rate = require('./ratelimit');

const MESSAGES = {
  entry_value_uq: 'That value was just recorded by someone else; reload the batch.',
  step_run_batch_id_step_id_key: 'The step already has a run in this batch.',
};
function translate(e) {
  const m = String(e.message || e);
  for (const [k, v] of Object.entries(MESSAGES)) if (m.includes(`"${k}"`)) { const n = new Error(v); n.code = e.code; return n; }
  // department steps: say plainly what to do (system administrators are not in department groups by default, by design:
  // bench work depends on training, not rights; nobody can add themselves to a group)
  const dep = m.match(/^"?(.+?)"? is done by the (.+?) department; you are not in a group for it/);
  if (dep) {
    const what = dep[1].startsWith('Batching ') ? `the batching for ${dep[1].slice(9)}` : `"${dep[1]}"`;
    const n = new Error(`Only people in a ${dep[2]} department group can do ${what}. `
      + `Ask a lab administrator to add you to the ${dep[2]} group (Admin > People and groups); nobody can add themselves. `
      + 'System administrators are not in department groups unless added: bench work depends on training.');
    n.code = e.code; return n;
  }
  return e;
}
// the same JSON whatever the key order (the database keeps keys sorted)
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
// Postgres array text ({a,b}) as a list (the wire client returns arrays as text)
const pgList = (v) => (Array.isArray(v) ? v : v === null || v === undefined || v === '{}' ? [] : String(v).replace(/^\{|\}$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')));

module.exports = function registerTesting({ route, tx, signedTx, currentSite, checkSite, hasPermission, isUuid, AUDIT_SCOPES, SITE_AUDIT_KINDS, AUDIT_CHECKS }) {
  const r = (method, pattern, fn) => route(method, pattern, async (c) => { try { return await fn(c); } catch (e) { throw translate(e); } });
  const batchOf = async (c, id) => {
    if (!isUuid(id)) throw new Error('Batch not found');
    const b = await c.db.one('SELECT * FROM test_batch_view WHERE id = $1', [id]);
    if (!b) throw new Error('Batch not found');
    await checkSite(c, b.site_id);
    return b;
  };
  const runOf = async (c, id) => {
    if (!isUuid(id)) throw new Error('Step not found');
    const x = await c.db.one(`SELECT r.*, ws.step_name, ws.step_type, ws.step_key, ws.config, b.site_id, b.batch_code FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id
      JOIN test_batch b ON b.id = r.batch_id WHERE r.id = $1`, [id]);
    if (!x) throw new Error('Step not found');
    await checkSite(c, x.site_id);
    return x;
  };
  const me = async (c) => ({ can_perform: await hasPermission(c, 'testing.perform'), can_assign: await hasPermission(c, 'testing.assign'),
    can_review: await hasPermission(c, 'testing.review'), user_id: c.userId });
  const signed = (c, meaning, action, fn) => signedTx(c, { meaning, action, module: 'Testing' }, fn);
  const withReason = (c, fallback) => ({ ...c, reason: c.body.reason || fallback });

  // ------------------------------------------------------------ backlog, batches, worklist
  r('GET', '/api/testing/backlog', async (c) => {
    const site = await currentSite(c);
    const rows = await c.db.rows(`SELECT p.*, d.department_code, d.department_name, o.order_code, o.id AS lab_order_id, COALESCE(cl.display_name, cl.legal_name) AS client_name
        FROM test_pool_view p LEFT JOIN department d ON d.id = p.department_id JOIN sample s ON s.id = p.sample_id JOIN lab_order o ON o.id = s.lab_order_id
        JOIN client cl ON cl.id = o.client_id
       WHERE p.site_id = $1 ORDER BY d.department_code NULLS LAST, p.test_name, p.priority_rank, p.due_date NULLS LAST, p.logged_at, p.sample_code`, [site]);
    const maxes = await c.db.rows(`SELECT ws.test_version_id, (ws.config->>'max_samples')::int AS max_samples FROM workflow_step ws
       WHERE ws.step_type = 'Batching' AND ws.status = 'Active' AND ws.test_version_id = ANY($1::uuid[])`, [[...new Set(rows.map((x) => x.test_version_id))]]);
    return { rows, max_samples: Object.fromEntries(maxes.map((m) => [m.test_version_id, m.max_samples])), ...(await me(c)) };
  });
  r('POST', '/api/testing/batches', async (c) => {
    const site = await currentSite(c);
    const { test_version_id, items } = c.body;
    if (!isUuid(test_version_id)) throw new Error('Choose the test');
    return tx(withReason(c, 'Batch created'), async (t) => {
      const x = await t.one('SELECT create_batch($1, $2, $3::jsonb) AS id', [site, test_version_id, Array.isArray(items) && items.length ? JSON.stringify(items) : null]);
      return t.one('SELECT id, batch_code FROM test_batch WHERE id = $1', [x.id]);
    });
  });
  r('GET', '/api/testing/batches', async (c) => {
    const site = await currentSite(c);
    const show = c.query.show || 'open';
    const where = show === 'mine' ? "AND b.assigned_to = $2 AND b.status IN ('Open','In Progress')"
      : show === 'review' ? "AND b.status = 'Awaiting Review'" : show === 'all' ? '' : "AND b.status IN ('Open','In Progress','Awaiting Review')";
    // verification batches (WD-6) are the automated runs' own: shown on their verification, never in the lab's lists
    // every batch ever made: one page at a time (0.35.0), newest first; the working lists (open, mine, review) stay whole
    const paged = show === 'all' && wantsPage(c) ? await page(c, { sql: `SELECT b.* FROM test_batch_view b WHERE b.site_id = $1 AND NOT b.is_verification`, params: [site],
      filters: { all: 'true', approved: `status::text = 'Approved'`, cancelled: `status::text = 'Cancelled'` },
      search: ['batch_code', 'test_code', 'test_name', 'assigned_name', 'department_code'], ids: ['batch_code'], order: 'ORDER BY created_at DESC, batch_code DESC' }) : null;
    const rows = paged ? paged.rows : await c.db.rows(`SELECT b.* FROM test_batch_view b WHERE b.site_id = $1 AND NOT b.is_verification ${where} ORDER BY b.earliest_due NULLS LAST, b.batch_code LIMIT 1000`,
      show === 'mine' ? [site, c.userId] : [site]);
    const counts = await c.db.one(`SELECT count(*) FILTER (WHERE status IN ('Open','In Progress','Awaiting Review')) AS open,
        count(*) FILTER (WHERE assigned_to = $2 AND status IN ('Open','In Progress')) AS mine, count(*) FILTER (WHERE status = 'Awaiting Review') AS review,
        count(*) AS all FROM test_batch WHERE site_id = $1 AND NOT is_verification`, [site, c.userId]);
    // who batches can be assigned to (Assign selected: a supervisor organizes the day from this list)
    const people = await c.db.rows(`SELECT u.id, u.full_name, u.username FROM app_user u WHERE u.is_active AND u.username <> 'system' AND user_has_permission_at(u.id, 'testing.perform', $1)
        ORDER BY u.full_name`, [site]);
    return { ...(paged || {}), rows, counts: paged ? paged.counts : counts, people, ...(await me(c)) };
  });

  // ------------------------------------------------------------ one batch
  r('GET', '/api/testing/batches/:id', async (c) => {
    const b = await batchOf(c, c.params.id);
    const q = (sql, p = [b.id]) => c.db.rows(sql, p);
    const [loads, splits] = await Promise.all([
      // the incubator's sensor over the load, when one is linked (0.25.0)
      q(`SELECT l.*, (SELECT to_jsonb(x) FROM sensor_range(l.equipment_id, 'temperature', l.time_in, COALESCE(l.time_out, clock_timestamp())) x) AS sensor FROM incubation_load_view l WHERE l.batch_id = $1 AND l.status = 'Active' ORDER BY l.time_in`),
      q(`SELECT v.*, split_alerts(v.id) AS alerts FROM split_request_view v WHERE v.batch_id = $1 ORDER BY v.created_at`),
    ]);
    const [entries, steps, analytes, values, materials, equipmentUsed, attachments, reanalyses, results, verdicts, deps] = await Promise.all([
      q(`SELECT e.*, s.id AS sample_id, s.sample_code, s.client_sample_id, s.matrix, s.description,
             entry_product_category(e.id) AS product_category_id, (SELECT category_name FROM product_category WHERE id = entry_product_category(e.id)) AS product_category, rt.due_date, rt.rush_status::text AS rush_status,
             p.label AS parent_label, rp.reason AS reprep_reason, dl.label AS daily_label, db.batch_code AS daily_batch_code, db.id AS daily_batch_id, rt.media_lot_id,
             -- 0.28.1: a re-prepped entry stays on show: where its re-prep went; a re-prep entry: where it came from
             rr.status AS reprep_to_status, rr.reason AS reprep_to_reason, rb.batch_code AS reprep_to_batch_code, rb.id AS reprep_to_batch_id, ru.full_name AS reprep_by_name, rr.created_at AS reprep_at,
             oe.label AS reprep_of_label, ob.batch_code AS reprep_of_batch_code, ob.id AS reprep_of_batch_id
           FROM batch_entry e LEFT JOIN requested_test rt ON rt.id = e.requested_test_id LEFT JOIN sample s ON s.id = rt.sample_id
           LEFT JOIN batch_entry p ON p.id = e.parent_entry_id LEFT JOIN reprep_request rp ON rp.id = e.reprep_request_id
           LEFT JOIN batch_entry dl ON dl.id = e.daily_of_entry_id LEFT JOIN test_batch db ON db.id = dl.batch_id
           LEFT JOIN LATERAL (SELECT x.* FROM reprep_request x WHERE x.origin_entry_id = e.id ORDER BY x.created_at DESC LIMIT 1) rr ON e.status = 'Superseded'
           LEFT JOIN test_batch rb ON rb.id = rr.batch_id LEFT JOIN app_user ru ON ru.id = rr.created_by
           LEFT JOIN batch_entry oe ON oe.id = rp.origin_entry_id LEFT JOIN test_batch ob ON ob.id = oe.batch_id
          WHERE e.batch_id = $1 AND e.removed_at IS NULL ORDER BY e.position`),
      q(`SELECT r.id, r.status, r.fields, r.notes, r.completed_at, r.performed_by, pu.full_name AS performed_name, r.witness_id, wu.full_name AS witness_name,
             ws.id AS step_id, ws.step_key, ws.step_name, ws.step_type, ws.sort_order, ws.config, ws.instructions,
             COALESCE((SELECT jsonb_agg(jsonb_build_object('equipment_type_id', se.equipment_type_id, 'type_name', et.type_name, 'is_main', se.is_main))
                FROM workflow_step_equipment se JOIN equipment_type et ON et.id = se.equipment_type_id WHERE se.step_id = ws.id AND se.status = 'Active'), '[]') AS equipment_types,
             COALESCE((SELECT jsonb_agg(m.problem) FROM step_run_missing(r.id) m), '[]') AS missing
           FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id LEFT JOIN app_user pu ON pu.id = r.performed_by LEFT JOIN app_user wu ON wu.id = r.witness_id
          WHERE r.batch_id = $1 ORDER BY ws.sort_order, ws.step_name`),
      q(`SELECT tva.*, a.analyte_name, a.report_name FROM test_version_analyte tva JOIN analyte a ON a.id = tva.analyte_id
          WHERE tva.test_version_id = $1 AND tva.status = 'Active' ORDER BY tva.sort_order, a.analyte_name`, [b.test_version_id]),
      q(`SELECT ev.*, u.full_name AS entered_by FROM entry_value ev JOIN step_run r ON r.id = ev.step_run_id JOIN app_user u ON u.id = ev.modified_by
          WHERE r.batch_id = $1 AND ev.status = 'Active'`),
      q(`SELECT em.*, l.lot_code, COALESCE(l.item_name, ch.chemical_name) AS item_name, l.expiration_date, (SELECT entry_code FROM logbook_entry WHERE id = em.logbook_entry_id) AS logbook_entry_code FROM entry_material em JOIN step_run r ON r.id = em.step_run_id
           JOIN inventory_lot l ON l.id = em.lot_id LEFT JOIN chemical ch ON ch.id = l.chemical_id WHERE r.batch_id = $1 AND em.status = 'Active' ORDER BY em.created_at`),
      q(`SELECT q.*, e.equipment_code, e.equipment_name FROM entry_equipment q JOIN step_run r ON r.id = q.step_run_id JOIN equipment e ON e.id = q.equipment_id
          WHERE r.batch_id = $1 AND q.status = 'Active' ORDER BY q.created_at`),
      q(`SELECT a.id, a.step_run_id, a.label, a.analytical_run_no, a.created_at, d.file_name, d.size_bytes, u.full_name AS uploaded_by FROM step_attachment a JOIN step_run r ON r.id = a.step_run_id
           JOIN document_file d ON d.id = a.document_id JOIN app_user u ON u.id = a.created_by WHERE r.batch_id = $1 AND a.status = 'Active' ORDER BY a.created_at`),
      q(`SELECT x.*, u.full_name AS requested_by FROM reanalysis_request x JOIN step_run r ON r.id = x.step_run_id JOIN app_user u ON u.id = x.created_by
          WHERE r.batch_id = $1 ORDER BY x.created_at`),
      q('SELECT * FROM batch_results($1)'),
      q('SELECT * FROM batch_qc_verdicts($1)'),
      q(`SELECT d.step_id, d.depends_on_step_id FROM workflow_step_dependency d JOIN workflow_step ws ON ws.id = d.step_id
          WHERE ws.test_version_id = $1 AND d.status = 'Active'`, [b.test_version_id]),
    ]);
    const runCounts = await q(`SELECT r.id AS step_run_id, e.id AS entry_id, entry_runs(r.id, e.id) AS runs FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id
        JOIN batch_entry e ON e.batch_id = r.batch_id WHERE r.batch_id = $1 AND ws.step_type = 'Data Entry'`);
    // analytical runs at the reading steps and which run each reading belongs to; timepoint reviews (WD-5, migration 021)
    const [runs, readingRuns, timepoints] = await Promise.all([
      q(`SELECT ar.step_run_id, ar.run_no, ar.reason, ar.created_at, u.full_name AS requested_by FROM analytical_run ar JOIN step_run r ON r.id = ar.step_run_id
           JOIN app_user u ON u.id = ar.created_by WHERE r.batch_id = $1 ORDER BY ar.step_run_id, ar.run_no`),
      q(`SELECT r.id AS step_run_id, e.id AS entry_id, g AS run_no, reading_run(r.id, e.id, g) AS run FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id
           JOIN batch_entry e ON e.batch_id = r.batch_id CROSS JOIN LATERAL generate_series(1, entry_runs(r.id, e.id)) g WHERE r.batch_id = $1 AND ws.step_type = 'Data Entry'`),
      q(`SELECT t.*, u.full_name AS released_by_name,
             (SELECT COALESCE(jsonb_agg(p.id), '[]') FROM step_ancestors(t.step_id) a JOIN step_run p ON p.step_id = a.step_id AND p.batch_id = $1
                JOIN workflow_step w ON w.id = p.step_id WHERE w.step_type <> 'QC Review') AS feeds
           FROM batch_timepoints($1) t LEFT JOIN app_user u ON u.id = t.released_by`),
    ]);
    timepoints.forEach((x) => { x.keys = pgList(x.keys); });
    // the steps a reviewer may approve now: all once the batch waits for review; earlier, those feeding a timepoint ready for review
    const markable = b.status === 'Awaiting Review' ? null
      : [...new Set(timepoints.filter((x) => x.ready && !x.released).flatMap((x) => x.feeds))];
    // the reviewer's approval of each step (migration 020), and whether the person asking did any of the work
    const reviewMarks = await q(`SELECT s.*, u.full_name AS marked_by_name FROM review_step_runs($1) s LEFT JOIN app_user u ON u.id = s.marked_by`);
    // readings that are not results (migration 039): flagged at the bench and in QC Review
    const invalidReadings = await q('SELECT * FROM batch_invalid_readings($1)');
    const categories = Object.fromEntries((await c.db.rows('SELECT id, category_name FROM product_category')).map((x) => [x.id, x.category_name]));
    const performer = (await c.db.one(`SELECT EXISTS (SELECT 1 FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = $1 AND ws.step_type <> 'QC Review'
        AND $2 IN (r.performed_by, r.witness_id)) AS x`, [b.id, c.userId])).x;
    // samples can be added or removed until bench work is recorded (migration 023); how many are waiting to join
    const started = (await c.db.one('SELECT batch_started($1) AS x', [b.id])).x;
    const waiting = Number((await c.db.one('SELECT count(*) AS n FROM test_pool_view WHERE site_id = $1 AND test_version_id = $2', [b.site_id, b.test_version_id])).n);
    const who = await me(c);
    // the analyst's picks of the reported reading (0.27.0, migration 048)
    const picks = await q(`SELECT p.id, p.requested_test_id, p.analyte_id, p.entry_id, p.run_no, p.note, p.created_at, u.full_name AS picked_by, an.analyte_name
        FROM analyst_pick p JOIN app_user u ON u.id = p.created_by LEFT JOIN analyte an ON an.id = p.analyte_id WHERE p.batch_id = $1 AND p.status = 'Active'`);
    return { batch: b, entries, steps, analytes, values, materials, equipment_used: equipmentUsed, attachments, reanalyses, results, verdicts, deps, loads, splits,
      run_counts: runCounts, review_marks: reviewMarks, invalid_readings: invalidReadings, categories, performer, runs, reading_runs: readingRuns, timepoints, markable, ...who,
      picks, can_pick: b.status === 'In Progress' && await hasPermission(c, 'testing.pick_run', b.site_id),
      can_edit_samples: who.can_perform && !started && ['Open', 'In Progress'].includes(b.status), backlog_waiting: waiting };
  });
  // What can be picked at the bench: this lab's equipment (with availability and calibration) and usable lots
  r('GET', '/api/testing/batches/:id/options', async (c) => {
    const b = await batchOf(c, c.params.id);
    const [equipment, lots, people] = await Promise.all([
      c.db.rows(`SELECT id, equipment_code, equipment_name, equipment_type_id, type_name, availability, calibration_status FROM equipment_view
          WHERE site_id = $1 AND admin_status <> 'Retired' ORDER BY type_name, equipment_name`, [b.site_id]),
      c.db.rows(`SELECT l.id, l.lot_code, COALESCE(l.item_name, ch.chemical_name) AS item_name, l.manufacturer_lot, l.expiration_date, l.chemical_types, l.unit, lot_on_hand(l.id) AS on_hand,
             (SELECT string_agg(a.analyte_name || COALESCE(' ' || trim(trailing '.' from trim(trailing '0' from la.concentration::text)) || ' ' || la.concentration_unit, ''), ', ' ORDER BY a.analyte_name)
                FROM lot_analyte la JOIN analyte a ON a.id = la.analyte_id WHERE la.lot_id = l.id AND la.status = 'Active') AS analytes
           FROM inventory_lot l LEFT JOIN chemical ch ON ch.id = l.chemical_id
          WHERE l.site_id = $1 AND l.receipt_status = 'Received' AND l.status = 'Available' AND (l.expiration_date IS NULL OR l.expiration_date >= site_today(l.site_id))
            AND (l.retest_date IS NULL OR l.retest_date >= site_today(l.site_id)) AND NOT ('Consumable' = ANY(l.chemical_types) AND cardinality(l.chemical_types) = 1)
          ORDER BY item_name, l.lot_code`, [b.site_id]),
      c.db.rows(`SELECT u.id, u.full_name, u.username FROM app_user u WHERE u.is_active AND u.username <> 'system' AND user_has_permission_at(u.id, 'testing.perform', $1)
          ORDER BY u.full_name`, [b.site_id]),
    ]);
    // lots that need QA testing before use (migration 040; media since 023): why one is not released for this batch's test
    // (the database refuses them)
    const held = await c.db.rows(`SELECT l.id, lot_qa_problem(l.id, $2, $3) AS why FROM inventory_lot l
      WHERE l.site_id = $1 AND lot_qa_required(l.id) AND lot_qa_problem(l.id, $2, $3) IS NOT NULL`, [b.site_id, b.test_id, b.id]);
    for (const m of held) {
      const l = lots.find((x) => x.id === m.id);
      if (l) l.not_qualified = 'QA testing: ' + m.why;
    }
    return { equipment, lots, people };
  });

  // ------------------------------------------------------------ adding and removing samples before a batch starts (migration 023; no signature: Alex)
  // the backlog items that can join this batch (same lab and test version)
  r('GET', '/api/testing/batches/:id/pool', async (c) => {
    const b = await batchOf(c, c.params.id);
    const rows = await c.db.rows(`SELECT p.*, COALESCE(cl.display_name, cl.legal_name) AS client_name FROM test_pool_view p JOIN sample s ON s.id = p.sample_id
        JOIN lab_order o ON o.id = s.lab_order_id JOIN client cl ON cl.id = o.client_id
       WHERE p.site_id = $1 AND p.test_version_id = $2 ORDER BY p.priority_rank, p.due_date NULLS LAST, p.logged_at, p.sample_code`, [b.site_id, b.test_version_id]);
    return { rows };
  });
  r('POST', '/api/testing/batches/:id/add', async (c) => {
    const b = await batchOf(c, c.params.id);
    const items = (Array.isArray(c.body.items) ? c.body.items : []).filter((x) => isUuid(x.requested_test_id))
      .map((x) => ({ requested_test_id: x.requested_test_id, reprep_request_id: isUuid(x.reprep_request_id) ? x.reprep_request_id : null }));
    if (!items.length) throw new Error('Choose the samples to add');
    return tx(withReason(c, 'Sample added to the batch'), async (t) => ({ added: (await t.one('SELECT add_batch_items($1, $2::jsonb) AS n', [b.id, JSON.stringify(items)])).n, batch_code: b.batch_code }));
  });
  r('POST', '/api/testing/entries/:id/remove', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Entry not found');
    const e = await c.db.one('SELECT batch_id, label FROM batch_entry WHERE id = $1', [c.params.id]);
    if (!e) throw new Error('Entry not found');
    await batchOf(c, e.batch_id);
    return tx(withReason(c, 'Sample removed from the batch'), async (t) => ({ removed: (await t.one('SELECT remove_batch_entry($1) AS n', [c.params.id])).n, label: e.label }));
  });
  // open batches a backlog item could join (right-click "Add to batch" in the backlog): same lab and version, nothing recorded yet
  r('GET', '/api/testing/open-batches', async (c) => {
    const site = await currentSite(c);
    if (!isUuid(c.query.version)) return { rows: [] };
    return { rows: await c.db.rows(`SELECT b.id, b.batch_code, b.status, b.assigned_name, b.sample_count, b.qc_count, b.created_at FROM test_batch_view b
       WHERE b.site_id = $1 AND b.test_version_id = $2 AND b.status IN ('Open','In Progress') AND NOT batch_started(b.id) ORDER BY b.batch_code`, [site, c.query.version]) };
  });

  // Values: one row per entry (and analyte and reading). New values are recorded under the user's name; a changed
  // value is a correction and needs the reason the screen asks for. Empty cells are not recorded.
  r('POST', '/api/testing/step-runs/:id/values', async (c) => {
    const run = await runOf(c, c.params.id);
    const rows = Array.isArray(c.body.rows) ? c.body.rows : [];
    return tx(c, async (t) => {
      let n = 0;
      for (const x of rows) {
        if (!isUuid(x.entry_id)) throw new Error('Unknown entry');
        const analyte = isUuid(x.analyte_id) ? x.analyte_id : null;
        const runNo = Number(x.run_no) || 1;
        const vnum = num(x.value_num);
        if (vnum !== null && !Number.isFinite(vnum)) throw new Error('Not a number: ' + x.value_num);
        const vtext = x.value_text === undefined || x.value_text === null ? null : String(x.value_text);
        const data = x.data && typeof x.data === 'object' ? JSON.stringify(x.data) : '{}';
        const old = await t.one(`SELECT id, value_num, value_text, data FROM entry_value WHERE step_run_id = $1 AND entry_id = $2 AND analyte_id IS NOT DISTINCT FROM $3::uuid AND run_no = $4 AND status = 'Active'`,
          [run.id, x.entry_id, analyte, runNo]);
        if (old && num(old.value_num) === vnum && (old.value_text ?? null) === (vtext && vtext.trim() ? vtext : null) && canon(old.data || {}) === canon(JSON.parse(data))) continue; // unchanged
        if (old) await t.query('UPDATE entry_value SET value_num = $2, value_text = $3, data = $4::jsonb WHERE id = $1', [old.id, vnum, vtext, data]);
        else if (vnum !== null || (vtext && vtext.trim()) || data !== '{}') {
          await t.query('INSERT INTO entry_value (step_run_id, entry_id, analyte_id, run_no, value_num, value_text, data) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)',
            [run.id, x.entry_id, analyte, runNo, vnum, vtext, data]);
        } else continue;
        n += 1;
      }
      return { saved: n };
    });
  });
  r('POST', '/api/testing/step-runs/:id/fields', async (c) => {
    const run = await runOf(c, c.params.id);
    const f = c.body.fields && typeof c.body.fields === 'object' ? c.body.fields : {};
    return tx(c, (t) => t.one('UPDATE step_run SET fields = $2::jsonb, notes = COALESCE($3, notes) WHERE id = $1 RETURNING id', [run.id, JSON.stringify(f), c.body.notes ?? null]));
  });
  // Equipment and materials: for the selected entries, or the whole batch when none are given
  r('POST', '/api/testing/step-runs/:id/equipment', async (c) => {
    const run = await runOf(c, c.params.id);
    if (!isUuid(c.body.equipment_id)) throw new Error('Choose the equipment');
    const ids = (c.body.entry_ids || []).filter(isUuid);
    return tx(c, async (t) => {
      for (const e of ids.length ? ids : [null]) {
        const k = Number(c.body.analytical_run_no) || 1;   // the analytical run it was used for (reading steps; WD-5)
        await t.query(`UPDATE entry_equipment SET status = 'Inactive' WHERE step_run_id = $1 AND entry_id IS NOT DISTINCT FROM $2::uuid AND status = 'Active' AND analytical_run_no = $4
          AND equipment_id IN (SELECT id FROM equipment WHERE equipment_type_id = (SELECT equipment_type_id FROM equipment WHERE id = $3))`, [run.id, e, c.body.equipment_id, k]);
        await t.query('INSERT INTO entry_equipment (step_run_id, entry_id, equipment_id, analytical_run_no) VALUES ($1, $2, $3, $4)', [run.id, e, c.body.equipment_id, k]);
      }
      return { added: ids.length || 1 };
    });
  });
  r('POST', '/api/testing/step-runs/:id/materials', async (c) => {
    const run = await runOf(c, c.params.id);
    if (!isUuid(c.body.lot_id)) throw new Error('Choose the lot');
    const ids = (c.body.entry_ids || []).filter(isUuid);
    return tx(c, async (t) => {
      for (const e of ids.length ? ids : [null]) {
        // a lot with logbook values carries its entry (migration 035): chosen by the database, or by the analyst when there are several
        await t.query('INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit, logbook_entry_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [run.id, e, c.body.lot_id, c.body.purpose || 'Reagent', num(c.body.volume), c.body.volume_unit || null, isUuid(c.body.logbook_entry_id) ? c.body.logbook_entry_id : null]);
      }
      return { added: ids.length || 1 };
    });
  });
  r('POST', '/api/testing/used/:kind/:id/remove', async (c) => {
    const table = { equipment: 'entry_equipment', material: 'entry_material', file: 'step_attachment' }[c.params.kind];
    if (!table || !isUuid(c.params.id)) throw new Error('Not found');
    const x = await c.db.one(`SELECT step_run_id FROM ${table} WHERE id = $1`, [c.params.id]);
    if (!x) throw new Error('Not found');
    await runOf(c, x.step_run_id);
    return tx(withReason(c, ''), (t) => t.one(`UPDATE ${table} SET status = 'Inactive' WHERE id = $1 RETURNING id`, [c.params.id]));
  });
  r('POST', '/api/testing/step-runs/:id/attachments', async (c) => {
    const run = await runOf(c, c.params.id);
    const { file_name, mime_type, content_base64, label } = c.body;
    if (!content_base64) throw new Error('Choose the file to attach');
    if (content_base64.length > 28_000_000) throw new Error('The file is too large (20 MB at most)');
    return tx(c, async (t) => {
      const d = await t.one(`INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ($1, $2, 0, '', decode($3, 'base64')) RETURNING id`,
        [String(file_name || 'raw-data').slice(0, 200), mime_type || 'application/octet-stream', content_base64]);
      return t.one('INSERT INTO step_attachment (step_run_id, document_id, label, analytical_run_no) VALUES ($1, $2, $3, $4) RETURNING id', [run.id, d.id, label || null, Number(c.body.analytical_run_no) || 1]);
    });
  });
  r('GET', '/api/testing/attachments/:id/file', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('File not found');
    const d = await c.db.one(`SELECT f.file_name, f.mime_type, encode(f.content, 'base64') AS b64, b.site_id FROM step_attachment a JOIN document_file f ON f.id = a.document_id
      JOIN step_run r ON r.id = a.step_run_id JOIN test_batch b ON b.id = r.batch_id WHERE a.id = $1`, [c.params.id]);
    if (!d) throw new Error('File not found');
    if (c.query.s) c.siteId = c.query.s; // opened in a new tab: the lab comes in the link
    await checkSite(c, d.site_id);
    return { __raw: true, body: Buffer.from(d.b64, 'base64'), type: d.mime_type,
      headers: { 'Content-Disposition': `attachment; filename="${String(d.file_name).replace(/[^\w.\- ]/g, '_')}"` } };
  });
  r('POST', '/api/testing/entries/:id/parent', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Entry not found');
    const e = await c.db.one('SELECT batch_id FROM batch_entry WHERE id = $1', [c.params.id]);
    if (!e) throw new Error('Entry not found');
    await batchOf(c, e.batch_id);
    return tx(withReason(c, 'Spiked sample chosen'), (t) => t.one('UPDATE batch_entry SET parent_entry_id = $2 WHERE id = $1 RETURNING id', [c.params.id, c.body.parent_entry_id || null]));
  });

  // ------------------------------------------------------------ incubation loads (WD-4)
  const when = (v) => { if (v === 'now') return new Date().toISOString(); if (v === null || v === undefined || v === '') return null; const d = new Date(v); if (Number.isNaN(d.getTime())) throw new Error('Not a date and time: ' + v); return d.toISOString(); };
  r('POST', '/api/testing/step-runs/:id/loads', async (c) => {
    const run = await runOf(c, c.params.id);
    if (!isUuid(c.body.equipment_id)) throw new Error('Choose the incubator');
    const ids = (c.body.entry_ids || []).filter(isUuid);
    return tx(c, (t) => t.one(`INSERT INTO incubation_load (step_run_id, equipment_id, entry_ids, time_in, time_out, temperature, note) VALUES ($1, $2, $3::uuid[], $4, $5, $6, $7) RETURNING id`,
      [run.id, c.body.equipment_id, ids.length ? ids : null, when(c.body.time_in || 'now'), when(c.body.time_out), num(c.body.temperature), c.body.note || null]));
  });
  r('POST', '/api/testing/loads/:id', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Load not found');
    const l = await c.db.one('SELECT step_run_id FROM incubation_load WHERE id = $1', [c.params.id]);
    if (!l) throw new Error('Load not found');
    await runOf(c, l.step_run_id);
    const b = c.body; const sets = []; const vals = [c.params.id];
    const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if ('time_in' in b) add('time_in', when(b.time_in));
    if ('time_out' in b) add('time_out', when(b.time_out));
    if ('temperature' in b) add('temperature', num(b.temperature));
    if ('note' in b) add('note', b.note || null);
    if (b.remove) add('status', 'Inactive');
    if (!sets.length) return { ok: true };
    return tx(c, (t) => t.one(`UPDATE incubation_load SET ${sets.join(', ')} WHERE id = $1 RETURNING id`, vals));
  });
  // ------------------------------------------------------------ split-off requests (WD-4): the customer's decision
  r('GET', '/api/testing/split-requests', async (c) => {
    const site = await currentSite(c);
    return { rows: await c.db.rows(`SELECT q.* FROM split_request_view q WHERE q.site_id = $1 AND q.status IN ('Awaiting consent','Consent given','To order')
        AND NOT EXISTS (SELECT 1 FROM test_batch b WHERE b.id = q.batch_id AND b.is_verification) ORDER BY q.created_at`, [site]),
      can_decide: await hasPermission(c, 'orders.edit') };
  });
  r('POST', '/api/testing/split-requests/:id/decide', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Request not found');
    const x = await c.db.one('SELECT site_id FROM split_request_view WHERE id = $1', [c.params.id]);
    if (!x) throw new Error('Request not found');
    await checkSite(c, x.site_id);
    return tx(withReason(c, 'Customer decision on a split-off test'), async (t) => { await t.query('SELECT decide_split_request($1, $2, $3)', [c.params.id, c.body.decision, c.body.note || '']); return { ok: true }; });
  });

  // ------------------------------------------------------------ signed actions
  // The witness types their own user ID and password in the same dialog; both signatures go on the step.
  async function checkWitness(c, w) {
    if (!w || !w.username || !w.password) throw new Error('The witness enters their user ID and password.');
    rate.checkFailures(c.ip);
    const u = await c.db.one("SELECT * FROM app_user WHERE lower(username) = lower($1) AND username <> 'system'", [String(w.username).trim()]);
    if (!u || !u.is_active || !u.password_hash) { rate.noteFailure(c.ip); throw new Error('The witness user ID or password is not correct.'); }
    if (u.locked_at) throw new Error('The witness account is locked. Ask an administrator to unlock it.');
    if (u.id === c.userId) throw new Error('The witness must be someone else.');
    if (!verifyPassword(String(w.password), u.password_hash)) {
      rate.noteFailure(c.ip);
      const n = (u.failed_attempts || 0) + 1;
      await c.db.query('UPDATE app_user SET failed_attempts = $2::int, locked_at = CASE WHEN $2::int >= 5 THEN clock_timestamp() ELSE locked_at END WHERE id = $1', [u.id, n]);
      throw new Error('The witness user ID or password is not correct. Nothing was signed.');
    }
    if (u.failed_attempts) await c.db.query('UPDATE app_user SET failed_attempts = 0 WHERE id = $1', [u.id]);
    return u;
  }
  r('POST', '/api/testing/step-runs/:id/complete', async (c) => {
    const run = await runOf(c, c.params.id);
    const witness = c.body.witness ? await checkWitness(c, c.body.witness) : null;
    const what = `${run.step_name} of ${run.batch_code}`;
    return signed(withReason(c, 'Step completed'), 'Performed by', what, async (t) => {
      let wsig = null;
      if (witness) wsig = (await t.one('SELECT sign_witness($1, $2) AS id', [witness.id, `Witnessed: ${what}`])).id;
      await t.query('SELECT complete_step($1, $2)', [run.id, wsig]);
      return { ok: true };
    });
  });
  r('POST', '/api/testing/step-runs/:id/reopen', async (c) => {
    const run = await runOf(c, c.params.id);
    if (!String(c.body.reason || '').trim()) throw new Error('Say why the step is reopened');
    return signed(c, 'Reopened by', `${run.step_name} of ${run.batch_code}`, async (t) => { await t.query('SELECT reopen_step($1)', [run.id]); return { ok: true }; });
  });
  r('POST', '/api/testing/step-runs/:id/reanalysis', async (c) => {
    const run = await runOf(c, c.params.id);
    const ids = (c.body.entry_ids || []).filter(isUuid);
    if (!ids.length) throw new Error('Select the samples to re-analyse');
    const runs = Number(c.body.runs);
    const word = { 1: 'single', 2: 'duplicate', 3: 'triplicate' }[runs] || runs;
    return signed(c, 'Requested by', `Re-analysis (${word}) of ${ids.length} entr${ids.length === 1 ? 'y' : 'ies'} in ${run.batch_code}`,
      async (t) => ({ n: (await t.one('SELECT request_reanalysis($1, $2::uuid[], $3) AS n', [run.id, ids, runs])).n }));
  });
  // Add an analytical run (WD-5): the chosen samples read again in a new run, with the run's own analytical QC
  r('POST', '/api/testing/step-runs/:id/runs', async (c) => {
    const run = await runOf(c, c.params.id);
    const ids = (c.body.entry_ids || []).filter(isUuid);
    if (!ids.length) throw new Error('Choose the samples to read again in the new run');
    const reps = Number(c.body.replicates);
    const word = { 1: 'single', 2: 'duplicate', 3: 'triplicate' }[reps] || reps;
    // 0.27.0: the chosen samples diluted further for this run (aliquot + diluent), recorded with it
    const al = c.body.aliquot === '' || c.body.aliquot === undefined || c.body.aliquot === null ? null : Number(c.body.aliquot);
    const dil = al === null ? null : Number(c.body.diluent || 0);
    if (al !== null && !(al > 0)) throw new Error('A further dilution needs an aliquot above zero');
    return signed(c, 'Requested by', `New analytical run (${word}) of ${ids.length} entr${ids.length === 1 ? 'y' : 'ies'} at ${run.step_name} of ${run.batch_code}${al !== null ? `, diluted further ${al} + ${dil}` : ''}`,
      async (t) => ({ run_no: (await t.one('SELECT add_analytical_run_diluted($1, $2::uuid[], $3, $4, $5) AS k', [run.id, ids, reps, al, dil])).k }));
  });
  // the analyst's pick of the reading reported for a sample (all its analytes, or one), with a note (migration 048)
  r('POST', '/api/testing/entries/:id/pick', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Entry not found');
    const e = await c.db.one('SELECT e.id, b.site_id FROM batch_entry e JOIN test_batch b ON b.id = e.batch_id WHERE e.id = $1', [c.params.id]);
    if (!e) throw new Error('Entry not found');
    await checkSite(c, e.site_id);
    return tx({ ...c, siteId: e.site_id, reason: c.body.reason || 'Reading picked by the analyst' }, async (t) => {
      await t.query('SELECT set_analyst_pick($1, $2, $3, $4)', [e.id, Number(c.body.run_no), isUuid(c.body.analyte_id) ? c.body.analyte_id : null, c.body.note || '']);
      return { ok: true };
    });
  });
  r('POST', '/api/testing/picks/:id/clear', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Pick not found');
    const p = await c.db.one('SELECT p.id, b.site_id FROM analyst_pick p JOIN test_batch b ON b.id = p.batch_id WHERE p.id = $1', [c.params.id]);
    if (!p) throw new Error('Pick not found');
    await checkSite(c, p.site_id);
    return tx({ ...c, siteId: p.site_id, reason: c.body.reason || 'Analyst\'s pick taken off' }, async (t) => { await t.query('SELECT clear_analyst_pick($1)', [p.id]); return { ok: true }; });
  });
  r('POST', '/api/testing/batches/:id/reprep', async (c) => {
    const b = await batchOf(c, c.params.id);
    const ids = (c.body.entry_ids || []).filter(isUuid);
    if (!ids.length) throw new Error('Select the samples to re-prepare');
    const reps = Number(c.body.replicates);
    const word = { 1: 'single', 2: 'duplicate', 3: 'triplicate' }[reps] || reps;
    return signed(c, 'Requested by', `Re-prep (${word}) of ${ids.length} sample${ids.length === 1 ? '' : 's'} from ${b.batch_code}`,
      async (t) => ({ n: (await t.one('SELECT request_reprep($1::uuid[], $2) AS n', [ids, reps])).n }));
  });
  r('POST', '/api/testing/batches/:id/assign', async (c) => {
    const b = await batchOf(c, c.params.id);
    if (!isUuid(c.body.user_id)) throw new Error('Choose who does the batch');
    return tx(withReason(c, 'Batch assigned'), async (t) => { await t.query('SELECT assign_batch($1, $2)', [b.id, c.body.user_id]); return { ok: true }; });
  });

  // ------------------------------------------------------------ QC Review (WD-3, migration 018)
  r('GET', '/api/testing/batches/:id/review', async (c) => {
    const b = await batchOf(c, c.params.id);
    const performer = await c.db.one(`SELECT EXISTS (SELECT 1 FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = $1 AND ws.step_type <> 'QC Review'
        AND $2 IN (r.performed_by, r.witness_id)) AS x`, [b.id, c.userId]);
    const [items, problems, verdicts, accepted, stored, people] = await Promise.all([
      b.status === 'Awaiting Review' ? c.db.rows('SELECT * FROM batch_review_items($1)', [b.id]) : [],
      b.status === 'Awaiting Review' ? c.db.rows('SELECT problem FROM batch_review_problems($1)', [b.id]) : [],
      c.db.rows('SELECT * FROM batch_qc_verdicts($1)', [b.id]),
      c.db.rows(`SELECT q.*, u.full_name AS accepted_by FROM qc_acceptance q JOIN app_user u ON u.id = q.created_by WHERE q.batch_id = $1 AND q.status = 'Active'`, [b.id]),
      c.db.rows(`SELECT * FROM test_result_view WHERE batch_id = $1 AND status = 'Active' ORDER BY sample_code, analyte_name`, [b.id]),
      c.db.rows('SELECT id, full_name FROM app_user WHERE id = ANY($1::uuid[])', [[b.reviewed_by, b.returned_by, b.cancelled_by].filter(Boolean)]),
    ]);
    const name = Object.fromEntries(people.map((p) => [p.id, p.full_name]));
    // timepoint reviews (WD-5): what each releases, what stops it, and what was released
    const timepoints = await c.db.rows('SELECT t.*, u.full_name AS released_by_name FROM batch_timepoints($1) t LEFT JOIN app_user u ON u.id = t.released_by', [b.id]);
    timepoints.forEach((x) => { x.keys = pgList(x.keys); });
    const releasedKeys = new Set(timepoints.filter((x) => x.released).flatMap((x) => x.keys));
    for (const tp of timepoints) {
      tp.items = [];
      if (!tp.released && tp.ready && !['Approved', 'Cancelled'].includes(b.status)) {
        tp.problems = (await c.db.rows('SELECT problem FROM timepoint_problems($1)', [tp.step_run_id])).map((x) => x.problem);
        for (const k of tp.keys.filter((x) => !releasedKeys.has(x))) tp.items.push(...await c.db.rows('SELECT * FROM batch_review_items($1, $2)', [b.id, k]));
      } else tp.problems = [];
      tp.stored = await c.db.rows(`SELECT * FROM test_result_view WHERE batch_id = $1 AND released_step_run_id = $2 AND status = 'Active' ORDER BY sample_code, analyte_name`, [b.id, tp.step_run_id]);
      tp.feeds = (await c.db.rows(`SELECT p.id FROM step_ancestors($1) a JOIN step_run p ON p.step_id = a.step_id AND p.batch_id = $2 JOIN workflow_step w ON w.id = p.step_id
          WHERE w.step_type <> 'QC Review'`, [tp.step_id, b.id])).map((x) => x.id);
    }
    // incubator loads outside their window or temperature, and the reviewer's acceptance of each (WD-5.1)
    const loads = await c.db.rows(`SELECT l.id, l.step_run_id, l.equipment_id, l.equipment_code, l.time_in, l.time_out, l.note, l.check_text, ws.step_name,
          a.justification AS accepted_justification, a.check_text AS accepted_check, u.full_name AS accepted_by, a.created_at AS accepted_at
        FROM incubation_load_view l JOIN step_run r ON r.id = l.step_run_id JOIN workflow_step ws ON ws.id = r.step_id
        LEFT JOIN load_acceptance a ON a.load_id = l.id AND a.status = 'Active' LEFT JOIN app_user u ON u.id = a.created_by
       WHERE l.batch_id = $1 AND l.status = 'Active' AND l.check_text IS NOT NULL ORDER BY l.time_in`, [b.id]);
    const usedRuns = b.status === 'Awaiting Review' ? pgList((await c.db.one('SELECT batch_used_runs($1) AS u', [b.id])).u).map(Number) : [1];
    // a "hit": a result above the LOQ (not "< LOQ" or ND), or a qualitative result that means found; the screen nests and
    // shows only these (plus anything to act on) under each sample (Alex, 2026-10-13)
    const found = Object.fromEntries((await c.db.rows('SELECT analyte_id, found_values FROM test_version_analyte WHERE test_version_id = $1', [b.test_version_id]))
      .map((x) => [x.analyte_id, x.found_values || []]));
    const isHit = (x) => (x.value_text ? (found[x.analyte_id] || []).includes(x.value_text)
      : x.reported !== null && x.reported !== undefined && x.reported !== '' && !/^\s*(<|nd\b|n\.d\.)/i.test(String(x.reported)));
    items.forEach((x) => { x.hit = !!x.chosen_entry_id && isHit(x); });
    stored.forEach((x) => { x.hit = isHit(x); });
    timepoints.forEach((tp) => tp.items.forEach((x) => { x.hit = !!x.chosen_entry_id && isHit(x); }));
    return { items, problems: problems.map((x) => x.problem), verdicts, accepted, stored, performer: performer.x, timepoints, used_runs: usedRuns, loads,
      reviewed_by_name: name[b.reviewed_by] || null, returned_by_name: name[b.returned_by] || null, cancelled_by_name: name[b.cancelled_by] || null, ...(await me(c)) };
  });
  r('POST', '/api/testing/batches/:id/choose', async (c) => {
    const b = await batchOf(c, c.params.id);
    const rows = Array.isArray(c.body.rows) ? c.body.rows : [];
    return tx(withReason(c, 'Reportable reading chosen'), async (t) => {
      for (const x of rows) {
        if (Array.isArray(x.readings) && x.readings.length > 1) {   // the average of the readings ticked (WD-5)
          await t.query('SELECT average_results($1, $2, $3, $4::jsonb, $5, $6)', [b.id, x.requested_test_id, x.analyte_id, JSON.stringify(x.readings), x.justification || null, x.result_key || null]);
        } else {
          await t.query('SELECT choose_result($1, $2, $3, $4, $5, $6, $7)', [b.id, x.requested_test_id, x.analyte_id, x.entry_id, Number(x.run_no), x.justification || null, x.result_key || null]);
        }
      }
      return { saved: rows.length };
    });
  });
  r('POST', '/api/testing/batches/:id/accept-qc', async (c) => {
    const b = await batchOf(c, c.params.id);
    const x = c.body;
    return tx(withReason(c, 'QC accepted by the reviewer'), async (t) => {
      await t.query('SELECT accept_qc($1, $2, $3, $4, $5, $6)', [b.id, x.entry_id, isUuid(x.analyte_id) ? x.analyte_id : null, x.limit_type, x.justification || '', Number(x.analytical_run) || 1]);
      return { ok: true };
    });
  });
  // The reviewer accepts an incubator load outside its window or temperature, with a justification (WD-5.1)
  r('POST', '/api/testing/batches/:id/accept-load', async (c) => {
    const b = await batchOf(c, c.params.id);
    if (!isUuid(c.body.load_id)) throw new Error('Load not found');
    return tx(withReason(c, 'Incubator load accepted by the reviewer'), async (t) => {
      await t.query('SELECT accept_load($1, $2, $3)', [b.id, c.body.load_id, c.body.justification || '']);
      return { ok: true };
    });
  });
  // The reviewer approves each step with a click (a recorded mark, not a signature), or undoes it (migration 020)
  r('POST', '/api/testing/batches/:id/steps/:runId/review-mark', async (c) => {
    const b = await batchOf(c, c.params.id);
    if (!isUuid(c.params.runId)) throw new Error('Step not found');
    const undo = c.body.undo === true;
    return tx(withReason(c, undo ? 'Step approval undone in QC Review' : 'Step approved in QC Review'), async (t) => {
      const r = await t.one('SELECT id FROM step_run WHERE id = $1 AND batch_id = $2', [c.params.runId, b.id]);
      if (!r) throw new Error('Step not found in this batch');
      await t.query(undo ? 'SELECT withdraw_review_step($1)' : 'SELECT approve_review_step($1)', [r.id]);
      return { ok: true };
    });
  });
  r('POST', '/api/testing/batches/:id/approve', async (c) => {
    const b = await batchOf(c, c.params.id);
    return signed(withReason(c, 'Batch reviewed and approved'), 'Reviewed by', `QC Review and approval of ${b.batch_code}`,
      async (t) => ({ results: (await t.one('SELECT approve_batch($1) AS n', [b.id])).n }));
  });
  // Release a timepoint's results as preliminary (WD-5): signed "Reviewed by"
  r('POST', '/api/testing/batches/:id/timepoints/:runId/release', async (c) => {
    const b = await batchOf(c, c.params.id);
    if (!isUuid(c.params.runId)) throw new Error('Step not found');
    const s = await c.db.one('SELECT ws.step_name FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.id = $1 AND r.batch_id = $2', [c.params.runId, b.id]);
    if (!s) throw new Error('Step not found in this batch');
    return signed(withReason(c, 'Timepoint reviewed: preliminary results released'), 'Reviewed by', `${s.step_name} of ${b.batch_code}: release preliminary results`,
      async (t) => ({ results: (await t.one('SELECT release_timepoint($1) AS n', [c.params.runId])).n }));
  });
  r('POST', '/api/testing/batches/:id/return', async (c) => {
    const b = await batchOf(c, c.params.id);
    if (!isUuid(c.body.step_run_id)) throw new Error('Choose the step to reopen');
    if (!String(c.body.reason || '').trim()) throw new Error('Say what the analyst needs to fix');
    return signed(c, 'Returned by', `Return ${b.batch_code} to the analyst`, async (t) => { await t.query('SELECT return_batch($1, $2)', [b.id, c.body.step_run_id]); return { ok: true }; });
  });
  r('POST', '/api/testing/batches/:id/cancel', async (c) => {
    const b = await batchOf(c, c.params.id);
    if (!String(c.body.reason || '').trim()) throw new Error('Say why the batch is cancelled');
    return signed(c, 'Cancelled by', `Cancel ${b.batch_code}`, async (t) => { await t.query('SELECT cancel_batch($1)', [b.id]); return { ok: true }; });
  });
  // Approved results of a sample (shown on the sample page)
  r('GET', '/api/testing/samples/:id/results', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Sample not found');
    const s = await c.db.one('SELECT o.site_id FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = $1', [c.params.id]);
    if (!s) throw new Error('Sample not found');
    await checkSite(c, s.site_id);
    const results = await c.db.rows(`SELECT * FROM test_result_view WHERE sample_id = $1 AND status = 'Active' ORDER BY test_name, analyte_name`, [c.params.id]);
    const batches = await c.db.rows(`SELECT DISTINCT b.id, b.batch_code, b.status::text AS status, t.test_name, e.status AS entry_status
        FROM batch_entry e JOIN test_batch b ON b.id = e.batch_id JOIN requested_test rt ON rt.id = e.requested_test_id JOIN test t ON t.id = b.test_id
       WHERE rt.sample_id = $1 ORDER BY b.batch_code`, [c.params.id]);
    const splits = await c.db.rows('SELECT v.*, split_alerts(v.id) AS alerts FROM split_request_view v WHERE v.sample_id = $1 ORDER BY v.created_at', [c.params.id]);
    return { results, batches, splits, can_decide: await hasPermission(c, 'orders.edit') };
  });

  // ------------------------------------------------------------ audit trail of a batch (everything recorded in it)
  AUDIT_SCOPES.batch = `SELECT 'test_batch', $1::uuid
    UNION ALL SELECT 'batch_entry', id FROM batch_entry WHERE batch_id = $1
    UNION ALL SELECT 'step_run', id FROM step_run WHERE batch_id = $1
    UNION ALL SELECT 'entry_value', v.id FROM entry_value v JOIN step_run r ON r.id = v.step_run_id WHERE r.batch_id = $1
    UNION ALL SELECT 'entry_material', m.id FROM entry_material m JOIN step_run r ON r.id = m.step_run_id WHERE r.batch_id = $1
    UNION ALL SELECT 'entry_equipment', q.id FROM entry_equipment q JOIN step_run r ON r.id = q.step_run_id WHERE r.batch_id = $1
    UNION ALL SELECT 'step_attachment', a.id FROM step_attachment a JOIN step_run r ON r.id = a.step_run_id WHERE r.batch_id = $1
    UNION ALL SELECT 'reanalysis_request', x.id FROM reanalysis_request x JOIN step_run r ON r.id = x.step_run_id WHERE r.batch_id = $1
    UNION ALL SELECT 'analytical_run', x.id FROM analytical_run x JOIN step_run r ON r.id = x.step_run_id WHERE r.batch_id = $1
    UNION ALL SELECT 'reprep_request', p.id FROM reprep_request p JOIN batch_entry e ON e.id = p.origin_entry_id WHERE e.batch_id = $1 OR p.batch_id = $1
    UNION ALL SELECT 'result_choice', id FROM result_choice WHERE batch_id = $1
    UNION ALL SELECT 'qc_acceptance', id FROM qc_acceptance WHERE batch_id = $1
    UNION ALL SELECT 'load_acceptance', id FROM load_acceptance WHERE batch_id = $1
    UNION ALL SELECT 'test_result', id FROM test_result WHERE batch_id = $1
    UNION ALL SELECT 'incubation_load', l.id FROM incubation_load l JOIN step_run r ON r.id = l.step_run_id WHERE r.batch_id = $1
    UNION ALL SELECT 'split_request', id FROM split_request WHERE batch_id = $1`;
  AUDIT_SCOPES.batches = `SELECT 'test_batch', id FROM test_batch WHERE site_id = $1 AND NOT is_verification`;
  SITE_AUDIT_KINDS.push('batches');
  AUDIT_CHECKS.batch = async (c, id) => { await batchOf(c, id); };
};
