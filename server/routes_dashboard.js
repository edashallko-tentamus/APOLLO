// Dashboards (D-1, migration 037). Home (the widgets of the person's groups at the lab), the GM dashboard (the labs
// where the person holds dashboard.gm) and the executive dashboard (every lab; dashboard.executive). Each widget is
// computed here from the database's views (turnaround, work in progress, revenue, low stock against demand); every
// number links to its page or opens the list behind it (detail). Each person's arrangement is kept per board. The
// finance figures (weekly update, forecasts) are typed on their own page. Thin: the definitions live in the database.
'use strict';
const XLSX = require('./xlsx');

module.exports = function registerDashboard({ route, tx, currentSite, hasPermission, isUuid, AUDIT_LISTS }) {
  const r = route;
  const q = (db, sql, p) => db.rows(sql, p);
  const one = (db, sql, p) => db.one(sql, p);
  const N = (v) => Number(v || 0);
  const pct = (a, b) => (N(b) ? Math.round((1000 * N(a)) / N(b)) / 10 : null);

  // ---------------------------------------------------------------- which labs a board covers
  async function sitesFor(c, board, lab) {
    if (board === 'home') return [await currentSite(c)];
    const all = await q(c.db, `SELECT id, site_code, site_name FROM lab_site WHERE status = 'Active' ORDER BY site_code`);
    const code = board === 'gm' ? 'dashboard.gm' : 'dashboard.executive';
    const mine = [];
    for (const s of all) if (await hasPermission(c, code, s.id)) mine.push(s.id);
    if (!mine.length) throw new Error(board === 'gm' ? 'The GM dashboard is for General Managers (dashboard.gm).' : 'The executive dashboard is for the Executive and Finance groups and system administrators (dashboard.executive).');
    if (isUuid(lab) && mine.includes(lab)) return [lab];
    return mine;
  }
  const today = async (db, sites) => (await one(db, 'SELECT site_today($1) AS d', [sites[0]])).d;

  // ---------------------------------------------------------------- the widgets
  const W = {};
  W.my_work = async (db, s, c) => {
    const x = await one(db, `SELECT
        (SELECT count(*) FROM test_batch b WHERE b.assigned_to = $2 AND b.site_id = ANY($1) AND b.status IN ('Open','In Progress') AND NOT b.is_verification) AS batches,
        (SELECT count(*) FROM finalization_claim_test t JOIN finalization_claim f ON f.id = t.claim_id WHERE f.claimed_by = $2 AND t.status = 'Active' AND f.site_id = ANY($1)) AS claims,
        (SELECT count(*) FROM invoice i WHERE i.claimed_by = $2 AND i.status = 'Draft' AND i.site_id = ANY($1)) AS drafts,
        (SELECT count(*) FROM quote_list_view v JOIN project p ON p.id = v.project_id WHERE v.owner_id = $2 AND v.is_open AND p.site_id = ANY($1)) AS quotes`, [s, c.userId]);
    return { kpis: [
      { label: 'My batches open', value: N(x.batches), href: '#/testing/batches?show=mine' },
      { label: 'Sample tests I claimed', value: N(x.claims), href: '#/reports/finalization?tab=mine' },
      { label: 'My draft invoices', value: N(x.drafts), href: '#/billing?tab=mine' },
      { label: 'My open quotes', value: N(x.quotes), href: '#/quotes' }] };
  };
  W.intake = async (db, s) => {
    const x = await one(db, `SELECT
        count(*) FILTER (WHERE (sm.logged_at AT TIME ZONE si.time_zone)::date = site_today(o.site_id)) AS today,
        count(*) FILTER (WHERE (sm.logged_at AT TIME ZONE si.time_zone)::date >= date_trunc('week', site_today(o.site_id))::date) AS week,
        count(*) FILTER (WHERE sm.status = 'Expected' AND o.status IN ('Submitted','Received')) AS expected
      FROM sample sm JOIN lab_order o ON o.id = sm.lab_order_id JOIN lab_site si ON si.id = o.site_id JOIN client c ON c.id = o.client_id
      WHERE o.site_id = ANY($1) AND NOT c.is_internal`, [s]);
    return { kpis: [
      { label: 'Logged today', value: N(x.today), href: '#/intake' },
      { label: 'Logged this week', value: N(x.week), detail: 'week' },
      { label: 'Expected, not received', value: N(x.expected), detail: 'expected', tone: N(x.expected) ? 'warn' : '' }] };
  };
  const OPEN_TESTS = `FROM requested_test rt JOIN sample sm ON sm.id = rt.sample_id JOIN lab_order o ON o.id = sm.lab_order_id JOIN client c ON c.id = o.client_id
      JOIN test t ON t.id = rt.test_id
     WHERE o.site_id = ANY($1) AND NOT c.is_internal AND rt.media_lot_id IS NULL AND rt.status <> 'Cancelled' AND o.status <> 'Draft'
       AND test_reported_at(rt.id) IS NULL AND NOT test_is_replaced(rt.id)`;
  W.rush = async (db, s) => {
    const x = await one(db, `SELECT count(*) FILTER (WHERE rt.rush_status = 'Pending Approval') AS pending,
        count(*) FILTER (WHERE rt.rush_fee > 0) AS in_lab, count(*) FILTER (WHERE rt.rush_fee > 0 AND rt.due_date < site_today(o.site_id)) AS late ${OPEN_TESTS}`, [s]);
    return { kpis: [
      { label: 'Waiting for approval', value: N(x.pending), href: '#/intake', tone: N(x.pending) ? 'warn' : '' },
      { label: 'Rush tests in the lab', value: N(x.in_lab), detail: 'rush' },
      { label: 'Rush overdue', value: N(x.late), detail: 'rush_late', tone: N(x.late) ? 'bad' : '' }] };
  };
  W.backlog = async (db, s) => {
    const rows = await q(db, `SELECT COALESCE(d.department_name, 'No department') AS department,
        count(*) FILTER (WHERE now() - p.pooled_at < interval '2 days') AS a0, count(*) FILTER (WHERE now() - p.pooled_at >= interval '2 days' AND now() - p.pooled_at < interval '5 days') AS a1,
        count(*) FILTER (WHERE now() - p.pooled_at >= interval '5 days' OR p.pooled_at IS NULL) AS a2, count(*) AS n
      FROM test_pool_view p LEFT JOIN department d ON d.id = p.department_id WHERE p.site_id = ANY($1) AND NOT p.is_media GROUP BY 1 ORDER BY n DESC`, [s]);
    return { kpis: [{ label: 'Tests waiting to be batched', value: rows.reduce((a, x) => a + N(x.n), 0), href: '#/testing' }],
      stacks: { legend: ['Under 2 days', '2 to 5 days', 'Over 5 days'], rows: rows.map((x) => ({ label: x.department, values: [N(x.a0), N(x.a1), N(x.a2)], href: '#/testing' })) } };
  };
  W.batches = async (db, s) => {
    const x = await one(db, `SELECT count(*) FILTER (WHERE status = 'Open') AS open, count(*) FILTER (WHERE status = 'In Progress') AS prog,
        count(*) FILTER (WHERE status = 'Awaiting Review') AS review FROM test_batch WHERE site_id = ANY($1) AND NOT is_verification`, [s]);
    return { kpis: [{ label: 'Open', value: N(x.open), href: '#/testing/batches' }, { label: 'In progress', value: N(x.prog), href: '#/testing/batches' },
      { label: 'Waiting for QC Review', value: N(x.review), href: '#/testing/batches?show=review', tone: N(x.review) ? 'warn' : '' }] };
  };
  W.overdue = async (db, s) => {
    const x = await one(db, `SELECT count(*) FILTER (WHERE rt.due_date < site_today(o.site_id)) AS late, count(*) FILTER (WHERE rt.due_date = site_today(o.site_id)) AS today,
        count(*) FILTER (WHERE rt.due_date = site_today(o.site_id) + 1) AS tomorrow ${OPEN_TESTS}`, [s]);
    return { kpis: [{ label: 'Overdue tests', value: N(x.late), detail: 'overdue', tone: N(x.late) ? 'bad' : '' },
      { label: 'Due today', value: N(x.today), detail: 'due_today', tone: N(x.today) ? 'warn' : '' }, { label: 'Due tomorrow', value: N(x.tomorrow), detail: 'due_tomorrow' }] };
  };
  W.tat = async (db, s) => {
    const x = await one(db, `SELECT count(*) AS n,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY login_days) AS login_med, avg(login_days) AS login_avg,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY lab_days) AS lab_med, avg(lab_days) AS lab_avg,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY qa_days) AS qa_med, avg(qa_days) AS qa_avg
      FROM test_tat_view WHERE site_id = ANY($1) AND reported_at > now() - interval '30 days'`, [s]);
    const seg = [['Login TAT', 'received to logged in', x.login_med, x.login_avg], ['Lab TAT', 'logged in to QC Review approval', x.lab_med, x.lab_avg],
      ['QA TAT', 'approval to COA issued', x.qa_med, x.qa_avg]];
    return { segments: seg.map(([label, help, med, avg]) => ({ label, help, median: med === null ? null : Math.round(N(med) * 10) / 10, average: avg === null ? null : Math.round(N(avg) * 10) / 10 })),
      kpis: [{ label: 'Tests reported (30 days)', value: N(x.n), detail: 'tat_slowest' }] };
  };
  // on time this month, last month and this year in a view with site_id, a date column and on_time (D-1.1)
  const onTimeCounts = (db, s, view, col) => one(db, `SELECT
        count(*) FILTER (WHERE ${col} >= date_trunc('month', site_today(site_id))::date) AS m_n,
        count(*) FILTER (WHERE ${col} >= date_trunc('month', site_today(site_id))::date AND on_time) AS m_ok,
        count(*) FILTER (WHERE ${col} >= (date_trunc('month', site_today(site_id)) - interval '1 month')::date AND ${col} < date_trunc('month', site_today(site_id))::date) AS p_n,
        count(*) FILTER (WHERE ${col} >= (date_trunc('month', site_today(site_id)) - interval '1 month')::date AND ${col} < date_trunc('month', site_today(site_id))::date AND on_time) AS p_ok,
        count(*) FILTER (WHERE ${col} >= date_trunc('year', site_today(site_id))::date) AS y_n,
        count(*) FILTER (WHERE ${col} >= date_trunc('year', site_today(site_id))::date AND on_time) AS y_ok
      FROM ${view} WHERE site_id = ANY($1)`, [s]);
  const tone = (p) => (p === null ? '' : p >= 90 ? 'good' : p >= 80 ? 'warn' : 'bad');
  const onTimeKpis = (x, details, plain) => [
    { label: `This month (${N(x.m_ok)} of ${N(x.m_n)})`, value: pct(x.m_ok, x.m_n), fmt: 'pct', detail: details[0], tone: plain ? '' : tone(pct(x.m_ok, x.m_n)) },
    { label: `Last month (${N(x.p_ok)} of ${N(x.p_n)})`, value: pct(x.p_ok, x.p_n), fmt: 'pct', detail: details[1], tone: plain ? '' : tone(pct(x.p_ok, x.p_n)) },
    { label: `This year (${N(x.y_ok)} of ${N(x.y_n)})`, value: pct(x.y_ok, x.y_n), fmt: 'pct', tone: plain ? '' : tone(pct(x.y_ok, x.y_n)) }];
  // Tests: the main figure is the QC Review approval against the test's due date; the release on a COA is shown smaller
  W.on_time = async (db, s) => {
    const qc = await onTimeCounts(db, s, 'test_qc_tat_view', 'approved_on');
    const rel = await onTimeCounts(db, s, 'test_tat_view', 'reported_on');
    return { kpis: onTimeKpis(qc, ['qc_late_month', 'qc_late_prev']),
      minor: { title: 'Released on a COA by the due date', kpis: onTimeKpis(rel, ['late_month', 'late_prev'], true) },
      note: 'Each test against its own due date: approved in QC Review (large) and released on a COA (small). Days the client was On Hold do not count.' };
  };
  // Samples: the complete COA against the sample's due date (the latest of its tests)
  W.on_time_samples = async (db, s) => {
    const x = await onTimeCounts(db, s, 'sample_tat_view', 'completed_on');
    return { kpis: onTimeKpis(x, ['smp_late_month', 'smp_late_prev']),
      note: 'A sample is on time when its complete COA (every test reported) is issued by its due date, the latest of its tests\'. Days the client was On Hold do not count.' };
  };
  W.signing = async (db, s, c) => {
    const x = await one(db, `SELECT
        (SELECT count(*) FROM test_batch WHERE site_id = ANY($1) AND status = 'Awaiting Review' AND NOT is_verification) AS qc,
        (SELECT count(*) FROM finalization_queue_view WHERE site_id = ANY($1)) AS fin,
        (SELECT count(*) FROM oos_investigation WHERE site_id = ANY($1) AND status IN ('Open','Analyst signed','Supervisor signed')) AS oos,
        (SELECT count(*) FROM logbook_entry e JOIN logbook l ON l.id = e.logbook_id WHERE e.site_id = ANY($1) AND e.status = 'Recorded' AND l.review_route = 'Logbook' AND l.status = 'Active') AS logbook,
        (SELECT count(DISTINCT t.equipment_id) FROM equipment_tag t JOIN equipment e ON e.id = t.equipment_id WHERE e.site_id = ANY($1) AND t.tagged_in_at IS NULL AND t.reason IN ('Repair','Calibration','Qualification')) AS equipment,
        (SELECT count(*) FROM purchase_line WHERE site_id = ANY($1) AND status IN ('Requested','Awaiting second approval')) AS purchase,
        (SELECT count(*) FROM invoice WHERE site_id = ANY($1) AND status = 'Draft') AS invoices,
        (SELECT count(*) FROM trend_chart WHERE site_id = ANY($1) AND status = 'Active' AND qa_status = 'Awaiting QA') AS charts`, [s]);
    const rows = [['QC Review: batches', x.qc, '#/testing/batches?show=review'], ['Report Finalization: sample tests', x.fin, '#/reports/finalization'],
      ['OOS investigations open', x.oos, '#/oos'], ['Logbook entries for QA', x.logbook, '#/logbooks/review'], ['Equipment waiting for release', x.equipment, '#/equipment'],
      ['Purchase requests to approve', x.purchase, '#/purchasing'], ['Draft invoices to issue', x.invoices, '#/billing?tab=drafts'],
      ['Control charts to approve', x.charts, '#/trending/charts?show=qa']];   // 0.24.1: QA reviewable trend charts waiting for QA
    return { list: rows.map(([label, n, href]) => ({ label, value: N(n), href })) };
  };
  W.supplies = async (db, s) => {
    const x = await one(db, `SELECT
        (SELECT count(*) FROM equipment_due_view WHERE site_id = ANY($1)) AS due,
        (SELECT count(*) FROM equipment_view WHERE site_id = ANY($1) AND availability = 'Tagged out') AS tagged,
        (SELECT count(*) FROM inventory_lot_view WHERE site_id = ANY($1) AND status = 'Available' AND receipt_status = 'Received' AND expiry_status IN ('Expiring','Expired')) AS expiring,
        (SELECT count(*) FROM inventory_lot_view WHERE site_id = ANY($1) AND status = 'Available' AND receipt_status = 'Received' AND low_stock) AS low,
        (SELECT count(*) FROM purchase_line WHERE site_id = ANY($1) AND status IN ('Requested','Awaiting second approval','Approved','Ordered','Partly received')) AS purchase`, [s]);
    return { kpis: [{ label: 'Equipment due', value: N(x.due), href: '#/equipment/due', tone: N(x.due) ? 'warn' : '' }, { label: 'Tagged out', value: N(x.tagged), href: '#/equipment' },
      { label: 'Lots expiring', value: N(x.expiring), href: '#/inventory', tone: N(x.expiring) ? 'warn' : '' }, { label: 'Lots low', value: N(x.low), href: '#/inventory', tone: N(x.low) ? 'warn' : '' },
      { label: 'Purchases open', value: N(x.purchase), href: '#/purchasing' }] };
  };
  const RISK = `SELECT l.lot_id, l.lot_code, l.item_name, l.department_name, l.on_hand, l.unit, l.pct_remaining, l.low_stock, l.expiry_status, l.expiration_date,
        (SELECT count(DISTINCT p.sample_id) FROM test_pool_view p WHERE p.site_id = l.site_id AND NOT p.is_media
          AND ((l.department_id IS NOT NULL AND p.department_id = l.department_id) OR p.test_id = ANY (l.used_by_tests))) AS samples_at_risk
      FROM low_stock_demand_view l WHERE l.site_id = ANY($1)`;
  W.low_stock_risk = async (db, s) => {
    const rows = await q(db, `${RISK} ORDER BY samples_at_risk DESC, l.pct_remaining NULLS LAST LIMIT 8`, [s]);
    const tot = await one(db, `SELECT count(*) AS lots, count(DISTINCT p.sample_id) AS samples FROM low_stock_demand_view l
        LEFT JOIN test_pool_view p ON p.site_id = l.site_id AND NOT p.is_media AND ((l.department_id IS NOT NULL AND p.department_id = l.department_id) OR p.test_id = ANY (l.used_by_tests))
       WHERE l.site_id = ANY($1)`, [s]);
    return { kpis: [{ label: 'Lots low or expiring', value: N(tot.lots), href: '#/inventory', tone: N(tot.lots) ? 'warn' : '' },
      { label: 'Samples waiting that need them', value: N(tot.samples), detail: 'risk_samples', tone: N(tot.samples) ? 'bad' : '' }],
      table: { columns: ['Lot', 'Item', 'Department', 'Left', 'Samples at risk'], rows: rows.map((x) => [
        { text: x.lot_code, href: '#/inventory/lots/' + x.lot_id }, { text: x.item_name || '' }, { text: x.department_name || 'No department set' },
        { text: N(x.on_hand) < 0 ? 'Negative: reconcile' : x.low_stock ? `${x.pct_remaining === null ? 'Low' : Math.round(N(x.pct_remaining)) + ' % left'}` : x.expiry_status || '' }, { text: String(N(x.samples_at_risk)), num: true }]) },
      note: 'A lot counts against the samples of its department (set on the item) and of the tests that used the same item in the last 180 days.' };
  };
  W.quotes = async (db, s) => {
    const x = await one(db, `SELECT count(*) FILTER (WHERE v.is_open) AS open, COALESCE(sum(v.total) FILTER (WHERE v.status = 'Quoted'), 0) AS value,
        count(*) FILTER (WHERE v.status = 'Accepted' AND v.accepted_at > now() - interval '90 days') AS won,
        count(*) FILTER (WHERE (v.status = 'Rejected' AND v.rejected_at > now() - interval '90 days') OR (v.status = 'Expired' AND v.version_created_at > now() - interval '90 days')) AS lost
      FROM quote_list_view v JOIN project p ON p.id = v.project_id WHERE p.site_id = ANY($1) AND v.kind IN ('Quote','Project','Stability')`, [s]);
    return { kpis: [{ label: 'Open quotes', value: N(x.open), href: '#/quotes' }, { label: 'Value quoted, waiting', value: N(x.value), fmt: 'money', href: '#/quotes' },
      { label: `Win rate, 90 days (${N(x.won)} won, ${N(x.lost)} lost)`, value: pct(x.won, N(x.won) + N(x.lost)), fmt: 'pct', href: '#/quotes' }] };
  };
  W.stability = async (db, s) => {
    const x = await one(db, `SELECT
        (SELECT count(*) FROM stability_pull_view WHERE site_id = ANY($1) AND status IN ('Scheduled','Ordered') AND scheduled_date <= site_today(site_id) + 7) AS pulls,
        (SELECT count(*) FROM stability_study WHERE site_id = ANY($1) AND status = 'Awaiting material') AS awaiting,
        (SELECT count(DISTINCT logbook_entry_id) FROM stability_excursion_view WHERE site_id = ANY($1) AND entry_at > now() - interval '30 days') AS excursions`, [s]);
    return { kpis: [{ label: 'Pulls due this week', value: N(x.pulls), href: '#/stability/studies' }, { label: 'Studies awaiting material', value: N(x.awaiting), href: '#/stability/studies' },
      { label: 'Chamber excursions (30 days)', value: N(x.excursions), href: '#/stability/studies', tone: N(x.excursions) ? 'warn' : '' }] };
  };
  W.billing = async (db, s) => {
    const x = await one(db, `SELECT (SELECT COALESCE(sum(amount), 0) FROM invoice_ready_view WHERE site_id = ANY($1)) AS ready,
        (SELECT count(*) FROM invoice_ready_view WHERE site_id = ANY($1)) AS ready_n,
        (SELECT count(*) FROM invoice_ready_view WHERE site_id = ANY($1) AND late_days > 0 AND rush_fee > 0) AS late,
        (SELECT count(*) FROM invoice WHERE site_id = ANY($1) AND status = 'Draft') AS drafts`, [s]);
    return { kpis: [{ label: `Ready to invoice (${N(x.ready_n)} tests)`, value: N(x.ready), fmt: 'money', href: '#/billing' },
      { label: 'Draft invoices', value: N(x.drafts), href: '#/billing?tab=drafts' }, { label: 'Late rushes to check', value: N(x.late), href: '#/billing', tone: N(x.late) ? 'warn' : '' }] };
  };
  const REV = (from, to) => `COALESCE((SELECT sum(total) FROM revenue_view WHERE site_id = ANY($1) AND invoice_date >= ${from} AND invoice_date < ${to}), 0)`;
  const M0 = `date_trunc('month', $2::date)::date`; const M1 = `(date_trunc('month', $2::date) + interval '1 month')::date`;
  const PM = `(date_trunc('month', $2::date) - interval '1 month')::date`; const Y0 = `date_trunc('year', $2::date)::date`; const Y1 = `(date_trunc('year', $2::date) + interval '1 year')::date`;
  W.revenue = async (db, s) => {
    const d = await today(db, s);
    const x = await one(db, `SELECT ${REV(M0, M1)} AS month, ${REV(PM, M0)} AS prev, ${REV(Y0, Y1)} AS year`, [s, d]);
    return { kpis: [{ label: 'This month', value: N(x.month), fmt: 'money', detail: 'rev_month' }, { label: 'Last month', value: N(x.prev), fmt: 'money', detail: 'rev_prev' },
      { label: 'This year', value: N(x.year), fmt: 'money', detail: 'rev_year' }], note: 'Revenue counts when the invoice is issued (credit notes taken off).' };
  };
  const STATES = ['Not Started', 'Incomplete', 'Finalized', 'Pending Invoice'];
  W.wip = async (db, s) => {
    const rows = await q(db, `SELECT wip_state, count(*) AS n, COALESCE(sum(value), 0) AS v FROM wip_view WHERE site_id = ANY($1) GROUP BY 1`, [s]);
    const by = Object.fromEntries(rows.map((x) => [x.wip_state, x]));
    const help = { 'Not Started': 'waiting to be batched', Incomplete: 'in a batch', Finalized: 'results approved, report not issued', 'Pending Invoice': 'report issued, not invoiced' };
    return { kpis: STATES.map((k) => ({ label: `${k} (${N(by[k] && by[k].n)})`, sub: help[k], value: N(by[k] && by[k].v), fmt: 'money', detail: 'wip:' + k })),
      total: rows.reduce((a, x) => a + N(x.v), 0) };
  };
  W.projection = async (db, s) => {
    const d = await today(db, s);
    const x = await one(db, `SELECT ${REV(M0, M1)} AS invoiced,
        COALESCE((SELECT sum(value) FROM wip_view WHERE site_id = ANY($1) AND (wip_state IN ('Pending Invoice','Finalized') OR due_date IS NULL OR due_date < ${M1})), 0) AS due,
        COALESCE((SELECT sum(value) FROM wip_view WHERE site_id = ANY($1) AND wip_state NOT IN ('Pending Invoice','Finalized') AND due_date >= ${M1}), 0) AS boost`, [s, d]);
    return { kpis: [{ label: 'Projected for the month', value: N(x.invoiced) + N(x.due), fmt: 'money', sub: `${fmtMoney(x.invoiced)} invoiced + ${fmtMoney(x.due)} work due this month`, detail: 'proj_due' },
      { label: 'Month-end boost', value: N(x.boost), fmt: 'money', sub: 'work due next month: what finishing it faster would add', detail: 'proj_boost' }] };
  };
  const SAMPLE_PERIOD = (from, to) => `FROM sample sm JOIN lab_order o ON o.id = sm.lab_order_id JOIN client c ON c.id = o.client_id JOIN lab_site si ON si.id = o.site_id
      WHERE o.site_id = ANY($1) AND NOT c.is_internal AND sm.status <> 'Cancelled' AND sm.logged_at IS NOT NULL
        AND (sm.logged_at AT TIME ZONE si.time_zone)::date >= ${from} AND (sm.logged_at AT TIME ZONE si.time_zone)::date < ${to}`;
  const SAMPLE_VALUE = `(SELECT COALESCE(sum(rt.price + rt.rush_fee), 0) FROM requested_test rt WHERE rt.sample_id = sm.id AND rt.status <> 'Cancelled')`;
  async function samplesIn(db, s, d, from, to) {
    const x = await one(db, `SELECT count(*) AS n, COALESCE(sum(${SAMPLE_VALUE}), 0) AS v ${SAMPLE_PERIOD(from, to)}`, [s, d]);
    return { n: N(x.n), v: N(x.v) };
  }
  const Q0 = `date_trunc('quarter', $2::date)::date`; const Q1 = `(date_trunc('quarter', $2::date) + interval '3 months')::date`;
  W.samples = async (db, s) => {
    const d = await today(db, s);
    const per = [['This month', M0, M1, 'smp_month'], ['Last month', PM, M0, 'smp_prev'], ['This quarter', Q0, Q1, 'smp_quarter'], ['Year to date', Y0, Y1, 'smp_year']];
    const kpis = [];
    for (const [label, a, b, k] of per) {
      const x = await samplesIn(db, s, d, a, b);
      kpis.push({ label, value: x.n, sub: x.n ? `average ${fmtMoney(x.v / x.n)} a sample` : '', detail: k });
    }
    return { kpis, note: 'Samples logged; the value is the work ordered on them at quoted prices.' };
  };
  // Labs side by side (D-1.1): revenue or EBITDA (LIMS revenue less the costs typed by finance) for the month, last
  // month, the quarter, the half year and the year, with three comparisons:
  //   this month to date against last month to the same day;
  //   last month against the average of the last three full months;
  //   this quarter to date against last quarter to the same point.
  // Potential revenue = work in progress + revenue this month. On time this month at the sample level.
  const COST = (from, to) => `COALESCE((SELECT sum(costs) FROM finance_week WHERE site_id = ANY($1) AND status = 'Active' AND week_ending >= ${from} AND week_ending < ${to}), 0)`;
  const WEEKS = (from, to) => `(SELECT count(*) FROM finance_week WHERE site_id = ANY($1) AND status = 'Active' AND week_ending >= ${from} AND week_ending < ${to})`;
  const dev = (a, b) => (b === null || a === null || !N(b) ? null : Math.round((1000 * (N(a) - N(b))) / Math.abs(N(b))) / 10);
  W.network = async (db, s) => {
    const d = await today(db, s);
    const H0 = `(CASE WHEN extract(month FROM $2::date) <= 6 THEN date_trunc('year', $2::date) ELSE date_trunc('year', $2::date) + interval '6 months' END)::date`;
    const H1 = `(${H0} + interval '6 months')::date`;
    const PMsp = `(${PM} + ($2::date - ${M0}) + 1)`;                          // last month to the same day
    const M3 = `(date_trunc('month', $2::date) - interval '3 months')::date`;  // the three full months before this one
    const LQ0 = `(date_trunc('quarter', $2::date) - interval '3 months')::date`; const LQsp = `(${LQ0} + ($2::date - ${Q0}) + 1)`;
    const P = { m: [M0, M1], p: [PM, M0], psp: [PM, PMsp], m3: [M3, M0], q: [Q0, Q1], lqsp: [LQ0, LQsp], h: [H0, H1], y: [Y0, Y1] };
    const rows = [];
    for (const site of s) {
      const lab = await one(db, 'SELECT site_code, site_name FROM lab_site WHERE id = $1', [site]);
      const ss = [site];
      const cols = Object.entries(P).map(([k, [a, b]]) => `${REV(a, b)} AS r_${k}, ${COST(a, b)} AS c_${k}, ${WEEKS(a, b)} AS w_${k}`).join(', ');
      const x = await one(db, `SELECT ${cols}`, [ss, d]);
      const rv = (k) => N(x['r_' + k]);
      const eb = (k) => (N(x['w_' + k]) ? N(x['r_' + k]) - N(x['c_' + k]) : null);   // no costs typed for the period: no EBITDA
      const sm = await samplesIn(db, ss, d, M0, M1); const sp = await samplesIn(db, ss, d, PM, M0); const sy = await samplesIn(db, ss, d, Y0, Y1);
      const ot = await one(db, `SELECT count(*) FILTER (WHERE on_time) AS ok, count(*) AS n FROM sample_tat_view WHERE site_id = $1 AND completed_on >= date_trunc('month', site_today(site_id))::date`, [site]);
      const wip = await one(db, 'SELECT COALESCE(sum(value), 0) AS v FROM wip_view WHERE site_id = $1', [site]);
      const m3 = (f) => { const v = f('m3'); return v === null ? null : v / 3; };
      rows.push({ site_id: site, lab: lab.site_code, name: lab.site_name,
        rev: { m: rv('m'), p: rv('p'), q: rv('q'), h: rv('h'), y: rv('y'), dev_m: dev(rv('m'), rv('psp')), dev_p3: dev(rv('p'), m3(rv)), dev_q: dev(rv('q'), rv('lqsp')) },
        ebitda: { m: eb('m'), p: eb('p'), q: eb('q'), h: eb('h'), y: eb('y'), dev_m: dev(eb('m'), eb('psp')), dev_p3: dev(eb('p'), m3(eb)), dev_q: dev(eb('q'), eb('lqsp')) },
        smp_m: sm.n, smp_p: sp.n, smp_y: sy.n, avg_y: sy.n ? sy.v / sy.n : 0, on_time: pct(ot.ok, ot.n), wip: N(wip.v), potential: N(wip.v) + rv('m') });
    }
    return { network: rows, note: 'Revenue = LIMS invoices issued (credit notes taken off). EBITDA = that revenue less the costs finance types each week; blank where no costs are typed. '
      + '% vs last month: this month to date against last month to the same day. Last month vs 3-month average: last month against the average of the last three full months. '
      + '% vs last quarter: this quarter to date against last quarter to the same point. Potential revenue = work in progress + revenue this month. On time: samples, this month.' };
  };
  // The finance update by month (executive: every lab; GM: the GM's lab). Revenue = LIMS invoiced; costs as typed;
  // EBITDA = LIMS revenue less costs (months with costs typed); the books' revenue shown last, for reconciling.
  async function financeRows(db, s) {
    const d = await today(db, s);
    const rows = await q(db, `WITH m AS (SELECT generate_series(date_trunc('year', $2::date), date_trunc('year', $2::date) + interval '11 months', interval '1 month')::date AS month)
      SELECT m.month,
        (SELECT sum(total) FROM revenue_view r WHERE r.site_id = ANY($1) AND date_trunc('month', r.invoice_date) = m.month) AS lims_rev,
        (SELECT sum(costs) FROM finance_week w WHERE w.site_id = ANY($1) AND w.status = 'Active' AND date_trunc('month', w.week_ending) = m.month) AS act_cost,
        (SELECT sum(revenue) FROM finance_week w WHERE w.site_id = ANY($1) AND w.status = 'Active' AND date_trunc('month', w.week_ending) = m.month) AS books_rev,
        (SELECT count(DISTINCT week_ending) FROM finance_week w WHERE w.site_id = ANY($1) AND w.status = 'Active' AND date_trunc('month', w.week_ending) = m.month) AS weeks,
        (SELECT sum(revenue) FROM finance_plan p WHERE p.site_id = ANY($1) AND p.status = 'Active' AND p.month = m.month AND p.plan = 'Budget forecast') AS bud_rev,
        (SELECT sum(costs) FROM finance_plan p WHERE p.site_id = ANY($1) AND p.status = 'Active' AND p.month = m.month AND p.plan = 'Budget forecast') AS bud_cost,
        (SELECT sum(revenue) FROM finance_plan p WHERE p.site_id = ANY($1) AND p.status = 'Active' AND p.month = m.month AND p.plan = 'Monthly forecast') AS fc_rev,
        (SELECT sum(costs) FROM finance_plan p WHERE p.site_id = ANY($1) AND p.status = 'Active' AND p.month = m.month AND p.plan = 'Monthly forecast') AS fc_cost
      FROM m ORDER BY m.month`, [s, d]);
    const nn = (v) => (v === null ? null : N(v));
    const e = (rv, c) => (rv === null && c === null ? null : N(rv) - N(c));
    return rows.map((x) => ({ month: x.month, weeks: N(x.weeks),
      act_rev: nn(x.lims_rev), act_cost: N(x.weeks) ? nn(x.act_cost) : null, act_ebitda: N(x.weeks) ? e(x.lims_rev, x.act_cost) : null, books_rev: nn(x.books_rev),
      bud_rev: nn(x.bud_rev), bud_cost: nn(x.bud_cost), bud_ebitda: e(x.bud_rev, x.bud_cost),
      fc_rev: nn(x.fc_rev), fc_cost: nn(x.fc_cost), fc_ebitda: e(x.fc_rev, x.fc_cost) }));
  }
  const FIN_NOTE = 'Revenue = LIMS invoiced (credit notes taken off). EBITDA = LIMS revenue less the costs finance types each week (costs exclude depreciation, amortization, interest and tax: to confirm with finance). Weeks in = the weeks of the month with costs typed. Revenue (books) is the figure finance types from the books, for reconciling.';
  W.finance = async (db, s) => ({ finance: await financeRows(db, s), note: FIN_NOTE });
  W.lab_finance = async (db, s) => ({ finance: await financeRows(db, s), note: FIN_NOTE });
  function fmtMoney(v) { return '$' + Math.round(N(v)).toLocaleString('en-US'); }

  // ---------------------------------------------------------------- the lists behind the numbers
  const TEST_COLS = `rt.id, sm.id AS sample_id, sm.sample_code, sm.client_sample_id, o.id AS lab_order_id, o.order_code, COALESCE(c.display_name, c.legal_name) AS client_name, t.test_name, rt.due_date, rt.rush_fee > 0 AS rush`;
  const DETAIL = {
    week: { title: 'Samples logged this week', sql: `SELECT sm.id AS sample_id, sm.sample_code, sm.client_sample_id, o.id AS lab_order_id, o.order_code, COALESCE(c.display_name, c.legal_name) AS client_name, sm.logged_at
        FROM sample sm JOIN lab_order o ON o.id = sm.lab_order_id JOIN lab_site si ON si.id = o.site_id JOIN client c ON c.id = o.client_id
        WHERE o.site_id = ANY($1) AND NOT c.is_internal AND (sm.logged_at AT TIME ZONE si.time_zone)::date >= date_trunc('week', site_today(o.site_id))::date ORDER BY sm.logged_at DESC` },
    expected: { title: 'Samples expected, not received', sql: `SELECT sm.id AS sample_id, sm.sample_code, sm.client_sample_id, o.id AS lab_order_id, o.order_code, COALESCE(c.display_name, c.legal_name) AS client_name, o.submitted_at
        FROM sample sm JOIN lab_order o ON o.id = sm.lab_order_id JOIN client c ON c.id = o.client_id
        WHERE o.site_id = ANY($1) AND NOT c.is_internal AND sm.status = 'Expected' AND o.status IN ('Submitted','Received') ORDER BY o.submitted_at` },
    rush: { title: 'Rush tests in the lab', sql: `SELECT ${TEST_COLS} ${OPEN_TESTS} AND rt.rush_fee > 0 ORDER BY rt.due_date` },
    rush_late: { title: 'Rush tests overdue', sql: `SELECT ${TEST_COLS} ${OPEN_TESTS} AND rt.rush_fee > 0 AND rt.due_date < site_today(o.site_id) ORDER BY rt.due_date` },
    overdue: { title: 'Overdue tests (not yet reported)', sql: `SELECT ${TEST_COLS} ${OPEN_TESTS} AND rt.due_date < site_today(o.site_id) ORDER BY rt.due_date` },
    due_today: { title: 'Tests due today', sql: `SELECT ${TEST_COLS} ${OPEN_TESTS} AND rt.due_date = site_today(o.site_id) ORDER BY sm.sample_code` },
    due_tomorrow: { title: 'Tests due tomorrow', sql: `SELECT ${TEST_COLS} ${OPEN_TESTS} AND rt.due_date = site_today(o.site_id) + 1 ORDER BY sm.sample_code` },
    tat_slowest: { title: 'Tests reported in the last 30 days, slowest first', sql: `SELECT v.requested_test_id AS id, v.sample_id, v.sample_code, v.lab_order_id, v.order_code, v.test_name, v.due_date, v.reported_on,
        round(v.login_days::numeric, 1) AS login_days, round(v.lab_days::numeric, 1) AS lab_days, round(v.qa_days::numeric, 1) AS qa_days, v.on_time, v.hold_days
        FROM test_tat_view v WHERE v.site_id = ANY($1) AND v.reported_at > now() - interval '30 days' ORDER BY COALESCE(v.lab_days, 0) + COALESCE(v.qa_days, 0) DESC LIMIT 500` },
    late_month: { title: 'Reported late this month', sql: `SELECT v.requested_test_id AS id, v.sample_id, v.sample_code, v.lab_order_id, v.order_code, v.test_name, v.due_date, v.reported_on, v.days_late, v.hold_days
        FROM test_tat_view v WHERE v.site_id = ANY($1) AND NOT v.on_time AND v.reported_on >= date_trunc('month', site_today(v.site_id))::date ORDER BY v.days_late DESC` },
    late_prev: { title: 'Reported late last month', sql: `SELECT v.requested_test_id AS id, v.sample_id, v.sample_code, v.lab_order_id, v.order_code, v.test_name, v.due_date, v.reported_on, v.days_late, v.hold_days
        FROM test_tat_view v WHERE v.site_id = ANY($1) AND NOT v.on_time AND v.reported_on >= (date_trunc('month', site_today(v.site_id)) - interval '1 month')::date
         AND v.reported_on < date_trunc('month', site_today(v.site_id))::date ORDER BY v.days_late DESC` },
    qc_late_month: { title: 'Tests approved in QC Review after their due date, this month', sql: `SELECT v.requested_test_id AS id, v.sample_id, v.sample_code, v.lab_order_id, v.order_code, v.test_name, v.due_date, v.approved_on, v.days_late, v.hold_days
        FROM test_qc_tat_view v WHERE v.site_id = ANY($1) AND NOT v.on_time AND v.approved_on >= date_trunc('month', site_today(v.site_id))::date ORDER BY v.days_late DESC` },
    qc_late_prev: { title: 'Tests approved in QC Review after their due date, last month', sql: `SELECT v.requested_test_id AS id, v.sample_id, v.sample_code, v.lab_order_id, v.order_code, v.test_name, v.due_date, v.approved_on, v.days_late, v.hold_days
        FROM test_qc_tat_view v WHERE v.site_id = ANY($1) AND NOT v.on_time AND v.approved_on >= (date_trunc('month', site_today(v.site_id)) - interval '1 month')::date
         AND v.approved_on < date_trunc('month', site_today(v.site_id))::date ORDER BY v.days_late DESC` },
    smp_late_month: { title: 'Samples completed after their due date, this month', sql: `SELECT v.sample_id, v.sample_code, v.client_sample_id, v.lab_order_id, v.order_code, v.tests, v.due_date, v.completed_on, v.days_late, v.hold_days
        FROM sample_tat_view v WHERE v.site_id = ANY($1) AND NOT v.on_time AND v.completed_on >= date_trunc('month', site_today(v.site_id))::date ORDER BY v.days_late DESC` },
    smp_late_prev: { title: 'Samples completed after their due date, last month', sql: `SELECT v.sample_id, v.sample_code, v.client_sample_id, v.lab_order_id, v.order_code, v.tests, v.due_date, v.completed_on, v.days_late, v.hold_days
        FROM sample_tat_view v WHERE v.site_id = ANY($1) AND NOT v.on_time AND v.completed_on >= (date_trunc('month', site_today(v.site_id)) - interval '1 month')::date
         AND v.completed_on < date_trunc('month', site_today(v.site_id))::date ORDER BY v.days_late DESC` },
    risk_samples: { title: 'Samples waiting that need low or expiring stock', sql: `SELECT DISTINCT p.sample_id, p.sample_code, p.client_sample_id, p.test_name, p.due_date, l.lot_code, l.item_name
        FROM low_stock_demand_view l JOIN test_pool_view p ON p.site_id = l.site_id AND NOT p.is_media AND ((l.department_id IS NOT NULL AND p.department_id = l.department_id) OR p.test_id = ANY (l.used_by_tests))
        WHERE l.site_id = ANY($1) ORDER BY p.due_date NULLS LAST, p.sample_code` },
    proj_due: { title: 'Work due to finish this month (not yet invoiced)', sql: `SELECT w.requested_test_id AS id, w.sample_id, w.sample_code, w.lab_order_id, w.order_code, w.client_name, w.test_name, w.due_date, w.wip_state, w.value
        FROM wip_view w WHERE w.site_id = ANY($1) AND (w.wip_state IN ('Pending Invoice','Finalized') OR w.due_date IS NULL OR w.due_date < (date_trunc('month', site_today(w.site_id)) + interval '1 month')::date) ORDER BY w.due_date NULLS LAST` },
    proj_boost: { title: 'Month-end boost: work due next month or later', sql: `SELECT w.requested_test_id AS id, w.sample_id, w.sample_code, w.lab_order_id, w.order_code, w.client_name, w.test_name, w.due_date, w.wip_state, w.value
        FROM wip_view w WHERE w.site_id = ANY($1) AND w.wip_state NOT IN ('Pending Invoice','Finalized') AND w.due_date >= (date_trunc('month', site_today(w.site_id)) + interval '1 month')::date ORDER BY w.due_date` },
  };
  const revDetail = (title, from, to) => ({ title, sql: `SELECT r.invoice_id AS id, i.invoice_number, r.invoice_date, i.kind, COALESCE(c.display_name, c.legal_name) AS client_name, r.total, r.catchup
      FROM revenue_view r JOIN invoice i ON i.id = r.invoice_id JOIN client c ON c.id = r.client_id WHERE r.site_id = ANY($1) AND r.invoice_date >= ${from} AND r.invoice_date < ${to}
      ORDER BY r.invoice_date DESC, i.invoice_number DESC`, today: true });
  DETAIL.rev_month = revDetail('Invoices and credit notes this month', M0, M1);
  DETAIL.rev_prev = revDetail('Invoices and credit notes last month', PM, M0);
  DETAIL.rev_year = revDetail('Invoices and credit notes this year', Y0, Y1);
  const smpDetail = (title, from, to) => ({ title, sql: `SELECT sm.id AS sample_id, sm.sample_code, sm.client_sample_id, o.id AS lab_order_id, o.order_code, COALESCE(c.display_name, c.legal_name) AS client_name,
      sm.logged_at, ${SAMPLE_VALUE} AS value ${SAMPLE_PERIOD(from, to)} ORDER BY sm.logged_at DESC LIMIT 2000`, today: true });
  DETAIL.smp_month = smpDetail('Samples logged this month', M0, M1);
  DETAIL.smp_prev = smpDetail('Samples logged last month', PM, M0);
  DETAIL.smp_quarter = smpDetail('Samples logged this quarter', Q0, Q1);
  DETAIL.smp_year = smpDetail('Samples logged this year', Y0, Y1);

  // ---------------------------------------------------------------- routes
  async function widgetsFor(c, board, sites) {
    if (board === 'home') return q(c.db, 'SELECT * FROM my_home_widgets($1, $2)', [sites[0], c.userId]);
    const order = board === 'executive' ? ['network', 'finance', 'revenue', 'projection', 'wip', 'samples', 'on_time_samples', 'on_time', 'tat']
      : ['lab_finance', 'revenue', 'projection', 'wip', 'samples', 'on_time_samples', 'on_time', 'tat', 'network', 'overdue', 'rush', 'quotes'];
    const ws = await q(c.db, 'SELECT * FROM dashboard_widget WHERE $1 = ANY (boards) ORDER BY sort_order', [board]);
    return ws.sort((a, b) => (order.indexOf(a.code) + 1 || 99) - (order.indexOf(b.code) + 1 || 99));
  }
  r('GET', '/api/dashboard/:board', async (c) => {
    const board = c.params.board;
    if (!['home', 'gm', 'executive'].includes(board)) throw new Error('Dashboard not found');
    const sites = await sitesFor(c, board, c.query.lab);
    const ws = await widgetsFor(c, board, sites);
    const layout = await one(c.db, 'SELECT layout, hidden FROM user_dashboard_layout WHERE user_id = $1 AND board = $2', [c.userId, board]);
    const only = c.query.only ? String(c.query.only).split(',') : null;
    const out = [];
    for (const w of ws) {
      if (only && !only.includes(w.code)) continue;
      if (layout && (layout.hidden || []).includes(w.code) && !only) { out.push({ code: w.code, title: w.title, hidden: true, description: w.description }); continue; }
      let data; let error = null;
      try { data = W[w.code] ? await W[w.code](c.db, sites, c) : {}; } catch (e) { error = e.message; }
      out.push({ code: w.code, title: w.title, category: w.category, description: w.description, w: w.default_w, h: w.default_h, data, error });
    }
    const labs = board === 'home' ? [] : await q(c.db, 'SELECT id, site_code, site_name FROM lab_site WHERE id = ANY($1) ORDER BY site_code', [await sitesFor(c, board)]);
    return { board, widgets: out, layout: layout ? layout.layout : [], hidden: layout ? layout.hidden : [], labs, lab: isUuid(c.query.lab) ? c.query.lab : null,
      at: new Date().toISOString() };
  });
  r('GET', '/api/dashboard/:board/detail', async (c) => {
    const board = c.params.board;
    const sites = await sitesFor(c, board, c.query.lab);
    const key = String(c.query.k || '');
    if (key.startsWith('wip:')) {
      const st = key.slice(4); if (!STATES.includes(st)) throw new Error('Unknown list');
      return { title: `Work in progress: ${st}`, rows: await q(c.db, `SELECT w.requested_test_id AS id, w.sample_id, w.sample_code, w.lab_order_id, w.order_code, w.client_name, w.test_name, w.due_date, w.value
        FROM wip_view w WHERE w.site_id = ANY($1) AND w.wip_state = $2 ORDER BY w.due_date NULLS LAST LIMIT 3000`, [sites, st]) };
    }
    const d = DETAIL[key]; if (!d) throw new Error('Unknown list');
    const params = d.today ? [sites, await today(c.db, sites)] : [sites];
    return { title: d.title, rows: await q(c.db, d.sql, params) };
  });
  r('PUT', '/api/dashboard/:board/layout', async (c) => {
    const board = c.params.board;
    if (!['home', 'gm', 'executive'].includes(board)) throw new Error('Dashboard not found');
    const layout = (Array.isArray(c.body.layout) ? c.body.layout : []).filter((x) => x && typeof x.code === 'string')
      .map((x) => ({ code: x.code, w: Math.min(12, Math.max(2, parseInt(x.w, 10) || 4)), h: Math.min(6, Math.max(1, parseInt(x.h, 10) || 2)) }));
    const hidden = (Array.isArray(c.body.hidden) ? c.body.hidden : []).filter((x) => typeof x === 'string');
    await c.db.tx({ userId: c.userId, siteId: c.siteId }, (t) => t.query(`INSERT INTO user_dashboard_layout (user_id, board, layout, hidden) VALUES ($1, $2, $3::jsonb, $4::text[])
      ON CONFLICT (user_id, board) DO UPDATE SET layout = EXCLUDED.layout, hidden = EXCLUDED.hidden`, [c.userId, board, JSON.stringify(layout), `{${hidden.map((h) => `"${h.replace(/"/g, '')}"`).join(',')}}`]));
  });
  r('POST', '/api/dashboard/:board/reset', async (c) => {
    await c.db.tx({ userId: c.userId, siteId: c.siteId }, (t) => t.query(`INSERT INTO user_dashboard_layout (user_id, board, layout, hidden) VALUES ($1, $2, '[]', '{}')
      ON CONFLICT (user_id, board) DO UPDATE SET layout = '[]', hidden = '{}'`, [c.userId, c.params.board]));
  });

  // The lab's departments (an inventory item names its department: low stock against demand)
  r('GET', '/api/departments', async (c) => q(c.db, `SELECT id, department_code, department_name FROM department WHERE site_id = $1 AND status = 'Active' ORDER BY department_name`, [await currentSite(c)]));

  // Each group's widgets (lab administrators)
  r('GET', '/api/admin/dashboard-widgets', async (c) => {
    const site = await currentSite(c);
    const me = await one(c.db, 'SELECT is_admin FROM app_user WHERE id = $1', [c.userId]);
    const groups = await q(c.db, `SELECT g.id, g.group_name, g.site_id, s.site_code FROM lab_group g LEFT JOIN lab_site s ON s.id = g.site_id
      WHERE g.status = 'Active' AND (g.site_id = $1 OR ($2 AND g.site_id IS NULL)) ORDER BY g.site_id NULLS LAST, g.group_name`, [site, !!(me && me.is_admin)]);
    const widgets = await q(c.db, `SELECT code, title, category, description, needs_any FROM dashboard_widget WHERE 'home' = ANY (boards) ORDER BY sort_order`);
    const on = await q(c.db, `SELECT group_id, widget_code FROM group_widget WHERE status = 'Active' AND group_id = ANY($1::uuid[])`, [groups.map((g) => g.id)]);
    return { groups, widgets, on, can_edit: await hasPermission(c, 'admin.groups', site) };
  });
  r('POST', '/api/admin/dashboard-widgets', async (c) => {
    await currentSite(c);
    const rows = Array.isArray(c.body.rows) ? c.body.rows : [];
    await tx({ ...c, reason: c.reason || 'Group dashboard widgets changed' }, async (t) => {
      for (const x of rows) {
        if (!isUuid(x.group_id) || typeof x.widget_code !== 'string') continue;
        await t.query(`INSERT INTO group_widget (group_id, widget_code, status) VALUES ($1, $2, $3::record_status)
          ON CONFLICT (group_id, widget_code) DO UPDATE SET status = EXCLUDED.status WHERE group_widget.status <> EXCLUDED.status`, [x.group_id, x.widget_code, x.on ? 'Active' : 'Inactive']);
      }
    });
  });

  // Finance figures (system administrators and the Finance group)
  const financeLabs = async (c) => {
    const all = await q(c.db, `SELECT id, site_code, site_name FROM lab_site WHERE status = 'Active' ORDER BY site_code`);
    const out = []; for (const s of all) if (await hasPermission(c, 'finance.enter', s.id)) out.push(s);
    if (!out.length) throw new Error('The finance figures are typed by system administrators and the Finance group (finance.enter).');
    return out;
  };
  r('GET', '/api/finance', async (c) => {
    const labs = await financeLabs(c);
    const year = parseInt(c.query.year, 10) || new Date().getFullYear();
    const ids = labs.map((l) => l.id);
    return { labs, year,
      // the week's revenue comes from the LIMS (invoices issued that week) and cannot be typed; the books' revenue is optional
      weeks: await q(c.db, `SELECT w.id, s.site_code, w.week_ending, lims_week_revenue(w.site_id, w.week_ending) AS lims_revenue, w.costs,
          lims_week_revenue(w.site_id, w.week_ending) - w.costs AS ebitda, w.revenue AS books_revenue, w.note FROM finance_week w JOIN lab_site s ON s.id = w.site_id
        WHERE w.site_id = ANY($1) AND w.status = 'Active' AND extract(year FROM w.week_ending) = $2 ORDER BY w.week_ending, s.site_code`, [ids, year]),
      plans: await q(c.db, `SELECT p.id, s.site_code, to_char(p.month, 'YYYY-MM') AS month, p.plan, p.revenue, p.costs, p.revenue - p.costs AS ebitda FROM finance_plan p JOIN lab_site s ON s.id = p.site_id
        WHERE p.site_id = ANY($1) AND p.status = 'Active' AND extract(year FROM p.month) = $2 ORDER BY p.month, s.site_code, p.plan`, [ids, year]) };
  });
  const siteOf = (labs, code) => { const l = labs.find((x) => x.site_code === String(code || '').trim().toUpperCase()); if (!l) throw new Error(`Lab "${code}" is not one you type figures for`); return l.id; };
  const num = (v, what) => { const n = Number(String(v ?? '').replace(/[$,\s]/g, '')); if (!Number.isFinite(n)) throw new Error(`${what}: type a number`); return n; };
  r('POST', '/api/finance/weeks', async (c) => {
    const labs = await financeLabs(c);
    const rows = Array.isArray(c.body.rows) ? c.body.rows : [];
    await tx({ ...c, reason: c.reason || 'Weekly finance update' }, async (t) => {
      for (const x of rows) {
        const site = siteOf(labs, x.site_code);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(x.week_ending || ''))) throw new Error('Week ending: a date (YYYY-MM-DD)');
        // the LIMS revenue is never taken from the request; only the books' figure (optional), the costs and the note
        const books = x.books_revenue === undefined || x.books_revenue === null || String(x.books_revenue).trim() === '' ? null : num(x.books_revenue, 'Revenue (books)');
        await t.query(`INSERT INTO finance_week (site_id, week_ending, revenue, costs, note) VALUES ($1, $2, $3, $4, NULLIF(btrim($5), ''))
          ON CONFLICT (site_id, week_ending) DO UPDATE SET revenue = EXCLUDED.revenue, costs = EXCLUDED.costs, note = EXCLUDED.note, status = 'Active'`,
          [site, x.week_ending, books, num(x.costs, 'Costs'), x.note || '']);
      }
    });
  });
  r('POST', '/api/finance/plans', async (c) => {
    const labs = await financeLabs(c);
    const rows = Array.isArray(c.body.rows) ? c.body.rows : [];
    await tx({ ...c, reason: c.reason || 'Forecast entered' }, async (t) => {
      for (const x of rows) {
        const site = siteOf(labs, x.site_code);
        if (!/^\d{4}-\d{2}$/.test(String(x.month || ''))) throw new Error('Month: year and month (YYYY-MM)');
        if (!['Budget forecast', 'Monthly forecast'].includes(x.plan)) throw new Error('Plan: Budget forecast or Monthly forecast');
        await t.query(`INSERT INTO finance_plan (site_id, month, plan, revenue, costs) VALUES ($1, ($2 || '-01')::date, $3, $4, $5)
          ON CONFLICT (site_id, month, plan) DO UPDATE SET revenue = EXCLUDED.revenue, costs = EXCLUDED.costs, status = 'Active'`,
          [site, x.month, x.plan, num(x.revenue, 'Revenue'), num(x.costs, 'Costs')]);
      }
    });
  });

  // The forecasts to and from Excel (D-1.1): download the year's forecasts of the labs the person types for; upload an
  // edited file to see every change and error first, then save it like the grid (with a reason)
  const PLAN_HEADERS = ['Lab', 'Month (YYYY-MM)', 'Plan', 'Revenue', 'Costs'];
  r('GET', '/api/finance/plans.xlsx', async (c) => {
    const labs = await financeLabs(c);
    const year = parseInt(c.query.year, 10) || new Date().getFullYear();
    const rows = await q(c.db, `SELECT s.site_code, to_char(m.month, 'YYYY-MM') AS month, pl.plan, p.revenue, p.costs
        FROM lab_site s CROSS JOIN generate_series(make_date($2, 1, 1), make_date($2, 12, 1), interval '1 month') m(month) CROSS JOIN (VALUES ('Budget forecast'), ('Monthly forecast')) pl(plan)
        LEFT JOIN finance_plan p ON p.site_id = s.id AND p.month = m.month::date AND p.plan = pl.plan AND p.status = 'Active'
       WHERE s.id = ANY($1) ORDER BY s.site_code, pl.plan, m.month`, [labs.map((l) => l.id), year]);
    const buf = XLSX.writeXlsx({ sheetName: `Forecasts ${year}`, headers: PLAN_HEADERS, widths: [8, 16, 18, 14, 14],
      rows: rows.map((x) => [x.site_code, x.month, x.plan, x.revenue === null ? '' : Number(x.revenue), x.costs === null ? '' : Number(x.costs)]) });
    return { __raw: true, body: buf, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', headers: { 'Content-Disposition': `attachment; filename="Forecasts ${year}.xlsx"` } };
  });
  r('POST', '/api/finance/plans/preview', async (c) => {
    const labs = await financeLabs(c);
    const tbl = XLSX.readTable(Buffer.from(String(c.body.content_base64 || ''), 'base64'), c.body.file_name || '');
    const head = (re) => tbl.headers.find((h) => re.test(h.toLowerCase()));
    const ix = { lab: head(/^lab/), month: head(/^month/), plan: head(/^plan/), revenue: head(/^revenue/), costs: head(/^costs?/) };
    const missing = Object.entries(ix).filter(([, h]) => !h).map(([k]) => k);
    if (missing.length) throw new Error(`The file needs the columns ${PLAN_HEADERS.join(', ')} (missing: ${missing.join(', ')}). Download the forecasts first and edit that file.`);
    const stored = await q(c.db, `SELECT s.site_code, to_char(p.month, 'YYYY-MM') AS month, p.plan, p.revenue, p.costs FROM finance_plan p JOIN lab_site s ON s.id = p.site_id
      WHERE p.site_id = ANY($1) AND p.status = 'Active'`, [labs.map((l) => l.id)]);
    const out = [];
    tbl.rows.forEach((raw) => {
      const cell = (k) => (raw[ix[k]] === undefined || raw[ix[k]] === null ? '' : String(raw[ix[k]]).trim());
      if (!['lab', 'month', 'plan', 'revenue', 'costs'].some((k) => cell(k) !== '')) return;   // empty row
      const row = { row: raw.__row, site_code: cell('lab').toUpperCase(), month: cell('month'), plan: cell('plan'), revenue: cell('revenue'), costs: cell('costs'), errors: [] };
      if (/^\d+(\.\d+)?$/.test(row.month)) row.month = XLSX.serialToDate(Number(row.month)).slice(0, 7);   // an Excel date
      if (/^\d{4}-\d{2}-\d{2}/.test(row.month)) row.month = row.month.slice(0, 7);
      if (!labs.some((l) => l.site_code === row.site_code)) row.errors.push(`Lab "${row.site_code}" is not one you type figures for`);
      if (!/^\d{4}-\d{2}$/.test(row.month)) row.errors.push('Month: year and month (YYYY-MM)');
      const plan = ['Budget forecast', 'Monthly forecast'].find((p) => p.toLowerCase() === row.plan.toLowerCase());
      if (!plan) row.errors.push('Plan: Budget forecast or Monthly forecast'); else row.plan = plan;
      for (const k of ['revenue', 'costs']) {
        const n = Number(row[k].replace(/[$,\s]/g, ''));
        if (row[k] === '' || !Number.isFinite(n) || n < 0) row.errors.push(`${k === 'revenue' ? 'Revenue' : 'Costs'}: a number, not negative`); else row[k] = n;
      }
      const was = stored.find((s) => s.site_code === row.site_code && s.month === row.month && s.plan === row.plan);
      row.action = row.errors.length ? 'Error' : !was ? 'Create' : (N(was.revenue) !== row.revenue || N(was.costs) !== row.costs) ? 'Update' : 'No change';
      row.was = was ? { revenue: N(was.revenue), costs: N(was.costs) } : null;
      out.push(row);
    });
    if (!out.length) throw new Error('The file has no rows');
    return { rows: out };
  });

  AUDIT_LISTS.dashboard_widgets = ['group_widget'];
  AUDIT_LISTS.finance = ['finance_week', 'finance_plan'];
};
