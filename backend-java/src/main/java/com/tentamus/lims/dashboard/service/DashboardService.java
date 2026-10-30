package com.tentamus.lims.dashboard.service;

import com.tentamus.lims.dashboard.domain.DashboardLayout;
import com.tentamus.lims.dashboard.domain.FinanceFigure;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.access.UserAccess;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.web.ApiExceptionHandler;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.postgresql.util.PSQLException;
import org.springframework.stereotype.Service;

import static com.tentamus.lims.core.web.Answers.map;
import static com.tentamus.lims.core.web.Answers.ok;

/**
 * Dashboards (D-1): Home (the widgets of the person's groups at the lab), the GM dashboard (labs where the person holds
 * dashboard.gm) and the executive dashboard (every lab; dashboard.executive). Each widget is worked out from the
 * database's views; live widgets every time, the others kept in memory per board, labs, widget and person until someone
 * asks again (?refresh=1, ?only=). Also each person's layout, each group's widgets, the lab's departments and the finance
 * figures (weeks, forecasts, their Excel download and upload preview). The performance report (report.xlsx) stays in
 * the Node backend: it needs the styled multi-sheet workbook writer the Java core does not have.
 * The SQL is Node's own, with its $n placeholders (pg() turns them into positional ?).
 */
@Service
public class DashboardService {
    private static final Pattern DOLLAR = Pattern.compile("\\$(\\d+)");
    private static final DateTimeFormatter ISO = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final List<String> BOARDS = List.of("home", "gm", "executive");
    private static final List<String> LIVE = List.of("my_work", "intake", "rush", "backlog", "batches", "overdue", "signing");
    private static final List<String> STATES = List.of("Not Started", "Incomplete", "Finalized", "Pending Invoice");
    private static final List<String> PLANS = List.of("Budget forecast", "Monthly forecast");
    public static final List<String> PLAN_HEADERS = List.of("Lab", "Month (YYYY-MM)", "Plan", "Revenue", "Costs");

    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    // the non-live widgets' last figures; a restart forgets them, as in Node
    private final Map<String, Map<String, Object>> cache = new ConcurrentHashMap<>();

    public DashboardService(Db db, UnitOfWork uow, AccessPolicy access) {
        this.db = db;
        this.uow = uow;
        this.access = access;
    }

    // ---------------------------------------------------------------- JavaScript values
    /** Number(v || 0). */
    static double N(Object v) { return Js.toNumber(v); }

    /** A double as JSON.stringify writes it: whole numbers without ".0", NaN as null. */
    static Object js(double d) {
        if (Double.isNaN(d) || Double.isInfinite(d)) return null;
        if (d == Math.rint(d) && Math.abs(d) < 9.007199254740991e15) return (long) d;
        return d;
    }

    static Object js(Double d) { return d == null ? null : js(d.doubleValue()); }

    static Double pct(Object a, Object b) { return N(b) != 0 ? Math.round((1000 * N(a)) / N(b)) / 10.0 : null; }

    static String fmtMoney(Object v) { return "$" + String.format(Locale.US, "%,d", Math.round(N(v))); }

    static String now() { return ISO.format(Instant.now().truncatedTo(ChronoUnit.MILLIS)); }

    private record Sql(String text, Object[] params) {}

    /** Node's SQL with $n placeholders: each one becomes ? with its value, so a value used twice is passed twice. */
    static Sql pg(String sql, Object... p) {
        Matcher m = DOLLAR.matcher(sql);
        StringBuilder b = new StringBuilder();
        List<Object> args = new ArrayList<>();
        while (m.find()) { args.add(p[Integer.parseInt(m.group(1)) - 1]); m.appendReplacement(b, "?"); }
        m.appendTail(b);
        return new Sql(b.toString(), args.toArray());
    }

    private List<Map<String, Object>> q(Db d, String sql, Object... p) { Sql s = pg(sql, p); return d.rows(s.text(), s.params()); }

    private Map<String, Object> one(Db d, String sql, Object... p) { Sql s = pg(sql, p); return d.one(s.text(), s.params()); }

    private List<Map<String, Object>> q(String sql, Object... p) { return q(db, sql, p); }

    private Map<String, Object> one(String sql, Object... p) { return one(db, sql, p); }

    private static Map<String, Object> kpi(Object... kv) { return map(kv); }

    private static String tone(boolean when, String t) { return when ? t : ""; }

    // ---------------------------------------------------------------- which labs a board covers
    private List<String> sitesFor(RequestContext c, String board, String lab) {
        if (board.equals("home")) return List.of(access.currentSite(c));
        String code = board.equals("gm") ? "dashboard.gm" : "dashboard.executive";
        UserAccess a = access.load(c.userId());
        List<String> mine = new ArrayList<>();
        if (RequestContext.isUuid(c.userId()))
            for (Map<String, Object> s : q("SELECT id, site_code, site_name FROM lab_site WHERE status = 'Active' ORDER BY site_code"))
                if (a.can(code, (String) s.get("id"))) mine.add((String) s.get("id"));
        if (mine.isEmpty()) throw new RuleException(board.equals("gm") ? "The GM dashboard is for General Managers (dashboard.gm)."
            : "The executive dashboard is for the Executive and Finance groups and system administrators (dashboard.executive).");
        if (RequestContext.isUuid(lab) && mine.contains(lab)) return List.of(lab);
        return mine;
    }

    private Object today(List<String> sites) { return one("SELECT site_today($1) AS d", sites.get(0)).get("d"); }

    // ---------------------------------------------------------------- the widgets
    private static final String OPEN_TESTS = """
        FROM requested_test rt JOIN sample sm ON sm.id = rt.sample_id JOIN lab_order o ON o.id = sm.lab_order_id JOIN client c ON c.id = o.client_id
              JOIN test t ON t.id = rt.test_id
             WHERE o.site_id = ANY($1) AND NOT c.is_internal AND rt.media_lot_id IS NULL AND rt.status <> 'Cancelled' AND o.status <> 'Draft'
               AND test_reported_at(rt.id) IS NULL AND NOT test_is_replaced(rt.id)""";
    private static final String M0 = "date_trunc('month', $2::date)::date";
    private static final String M1 = "(date_trunc('month', $2::date) + interval '1 month')::date";
    private static final String PM = "(date_trunc('month', $2::date) - interval '1 month')::date";
    private static final String Y0 = "date_trunc('year', $2::date)::date";
    private static final String Y1 = "(date_trunc('year', $2::date) + interval '1 year')::date";
    private static final String Q0 = "date_trunc('quarter', $2::date)::date";
    private static final String Q1 = "(date_trunc('quarter', $2::date) + interval '3 months')::date";
    private static final String SAMPLE_VALUE = "(SELECT COALESCE(sum(rt.price + rt.rush_fee), 0) FROM requested_test rt WHERE rt.sample_id = sm.id AND rt.status <> 'Cancelled')";
    private static final String FIN_NOTE = "Revenue = LIMS invoiced (credit notes taken off). EBITDA = LIMS revenue less the costs finance types each week (costs exclude depreciation, amortization, interest and tax: to confirm with finance). Weeks in = the weeks of the month with costs typed. Revenue (books) is the figure finance types from the books, for reconciling.";
    private static final String RISK = """
        SELECT l.lot_id, l.lot_code, l.item_name, l.department_name, l.on_hand, l.unit, l.pct_remaining, l.low_stock, l.expiry_status, l.expiration_date,
                (SELECT count(DISTINCT p.sample_id) FROM test_pool_view p WHERE p.site_id = l.site_id AND NOT p.is_media
                  AND ((l.department_id IS NOT NULL AND p.department_id = l.department_id) OR p.test_id = ANY (l.used_by_tests))) AS samples_at_risk
              FROM low_stock_demand_view l WHERE l.site_id = ANY($1)""";

    private static String rev(String from, String to) {
        return "COALESCE((SELECT sum(total) FROM revenue_view WHERE site_id = ANY($1) AND invoice_date >= " + from + " AND invoice_date < " + to + "), 0)";
    }

    private static String cost(String from, String to) {
        return "COALESCE((SELECT sum(costs) FROM finance_week WHERE site_id = ANY($1) AND status = 'Active' AND week_ending >= " + from + " AND week_ending < " + to + "), 0)";
    }

    private static String weeks(String from, String to) {
        return "(SELECT count(*) FROM finance_week WHERE site_id = ANY($1) AND status = 'Active' AND week_ending >= " + from + " AND week_ending < " + to + ")";
    }

    private static String samplePeriod(String from, String to) {
        return "FROM sample sm JOIN lab_order o ON o.id = sm.lab_order_id JOIN client c ON c.id = o.client_id JOIN lab_site si ON si.id = o.site_id\n"
            + "      WHERE o.site_id = ANY($1) AND NOT c.is_internal AND sm.status <> 'Cancelled' AND sm.logged_at IS NOT NULL\n"
            + "        AND (sm.logged_at AT TIME ZONE si.time_zone)::date >= " + from + " AND (sm.logged_at AT TIME ZONE si.time_zone)::date < " + to;
    }

    private double[] samplesIn(List<String> s, Object d, String from, String to) {
        Map<String, Object> x = one("SELECT count(*) AS n, COALESCE(sum(" + SAMPLE_VALUE + "), 0) AS v " + samplePeriod(from, to), s, d);
        return new double[] { N(x.get("n")), N(x.get("v")) };
    }

    private static String onTimeTone(Double p) { return p == null ? "" : p >= 90 ? "good" : p >= 80 ? "warn" : "bad"; }

    private Map<String, Object> onTimeCounts(List<String> s, String view, String col) {
        return one("SELECT\n"
            + "        count(*) FILTER (WHERE " + col + " >= date_trunc('month', site_today(site_id))::date) AS m_n,\n"
            + "        count(*) FILTER (WHERE " + col + " >= date_trunc('month', site_today(site_id))::date AND on_time) AS m_ok,\n"
            + "        count(*) FILTER (WHERE " + col + " >= (date_trunc('month', site_today(site_id)) - interval '1 month')::date AND " + col + " < date_trunc('month', site_today(site_id))::date) AS p_n,\n"
            + "        count(*) FILTER (WHERE " + col + " >= (date_trunc('month', site_today(site_id)) - interval '1 month')::date AND " + col + " < date_trunc('month', site_today(site_id))::date AND on_time) AS p_ok,\n"
            + "        count(*) FILTER (WHERE " + col + " >= date_trunc('year', site_today(site_id))::date) AS y_n,\n"
            + "        count(*) FILTER (WHERE " + col + " >= date_trunc('year', site_today(site_id))::date AND on_time) AS y_ok\n"
            + "      FROM " + view + " WHERE site_id = ANY($1)", s);
    }

    private static List<Object> onTimeKpis(Map<String, Object> x, String[] details, boolean plain) {
        Double m = pct(x.get("m_ok"), x.get("m_n")), p = pct(x.get("p_ok"), x.get("p_n")), y = pct(x.get("y_ok"), x.get("y_n"));
        return List.of(
            kpi("label", "This month (" + js(N(x.get("m_ok"))) + " of " + js(N(x.get("m_n"))) + ")", "value", js(m), "fmt", "pct", "detail", details[0], "tone", plain ? "" : onTimeTone(m)),
            kpi("label", "Last month (" + js(N(x.get("p_ok"))) + " of " + js(N(x.get("p_n"))) + ")", "value", js(p), "fmt", "pct", "detail", details[1], "tone", plain ? "" : onTimeTone(p)),
            kpi("label", "This year (" + js(N(x.get("y_ok"))) + " of " + js(N(x.get("y_n"))) + ")", "value", js(y), "fmt", "pct", "tone", plain ? "" : onTimeTone(y)));
    }

    /** One widget's figures; an unknown widget gives {} (Node: W[code] ? ... : {}). */
    private Map<String, Object> widget(String code, List<String> s, RequestContext c) {
        switch (code) {
            case "my_work": {
                Map<String, Object> x = one("""
                    SELECT
                        (SELECT count(*) FROM test_batch b WHERE b.assigned_to = $2 AND b.site_id = ANY($1) AND b.status IN ('Open','In Progress') AND NOT b.is_verification) AS batches,
                        (SELECT count(*) FROM finalization_claim_test t JOIN finalization_claim f ON f.id = t.claim_id WHERE f.claimed_by = $2 AND t.status = 'Active' AND f.site_id = ANY($1)) AS claims,
                        (SELECT count(*) FROM invoice i WHERE i.claimed_by = $2 AND i.status = 'Draft' AND i.site_id = ANY($1)) AS drafts,
                        (SELECT count(*) FROM quote_list_view v JOIN project p ON p.id = v.project_id WHERE v.owner_id = $2 AND v.is_open AND p.site_id = ANY($1)) AS quotes""", s, c.userId());
                return map("kpis", List.of(
                    kpi("label", "My batches open", "value", js(N(x.get("batches"))), "href", "#/testing/batches?show=mine"),
                    kpi("label", "Sample tests I claimed", "value", js(N(x.get("claims"))), "href", "#/reports/finalization?tab=mine"),
                    kpi("label", "My draft invoices", "value", js(N(x.get("drafts"))), "href", "#/billing?tab=mine"),
                    kpi("label", "My open quotes", "value", js(N(x.get("quotes"))), "href", "#/quotes")));
            }
            case "intake": {
                Map<String, Object> x = one("""
                    SELECT
                        count(*) FILTER (WHERE (sm.logged_at AT TIME ZONE si.time_zone)::date = site_today(o.site_id)) AS today,
                        count(*) FILTER (WHERE (sm.logged_at AT TIME ZONE si.time_zone)::date >= date_trunc('week', site_today(o.site_id))::date) AS week,
                        count(*) FILTER (WHERE sm.status = 'Expected' AND o.status IN ('Submitted','Received')) AS expected
                      FROM sample sm JOIN lab_order o ON o.id = sm.lab_order_id JOIN lab_site si ON si.id = o.site_id JOIN client c ON c.id = o.client_id
                      WHERE o.site_id = ANY($1) AND NOT c.is_internal""", s);
                return map("kpis", List.of(
                    kpi("label", "Logged today", "value", js(N(x.get("today"))), "href", "#/intake"),
                    kpi("label", "Logged this week", "value", js(N(x.get("week"))), "detail", "week"),
                    kpi("label", "Expected, not received", "value", js(N(x.get("expected"))), "detail", "expected", "tone", tone(N(x.get("expected")) != 0, "warn"))));
            }
            case "rush": {
                Map<String, Object> x = one("SELECT count(*) FILTER (WHERE rt.rush_status = 'Pending Approval') AS pending,\n"
                    + "        count(*) FILTER (WHERE rt.rush_fee > 0) AS in_lab, count(*) FILTER (WHERE rt.rush_fee > 0 AND rt.due_date < site_today(o.site_id)) AS late " + OPEN_TESTS, s);
                return map("kpis", List.of(
                    kpi("label", "Waiting for approval", "value", js(N(x.get("pending"))), "href", "#/intake", "tone", tone(N(x.get("pending")) != 0, "warn")),
                    kpi("label", "Rush tests in the lab", "value", js(N(x.get("in_lab"))), "detail", "rush"),
                    kpi("label", "Rush overdue", "value", js(N(x.get("late"))), "detail", "rush_late", "tone", tone(N(x.get("late")) != 0, "bad"))));
            }
            case "backlog": {
                List<Map<String, Object>> rows = q("""
                    SELECT COALESCE(d.department_name, 'No department') AS department,
                        count(*) FILTER (WHERE now() - p.pooled_at < interval '2 days') AS a0, count(*) FILTER (WHERE now() - p.pooled_at >= interval '2 days' AND now() - p.pooled_at < interval '5 days') AS a1,
                        count(*) FILTER (WHERE now() - p.pooled_at >= interval '5 days' OR p.pooled_at IS NULL) AS a2, count(*) AS n
                      FROM test_pool_view p LEFT JOIN department d ON d.id = p.department_id WHERE p.site_id = ANY($1) AND NOT p.is_media GROUP BY 1 ORDER BY n DESC""", s);
                double total = 0;
                List<Object> stacks = new ArrayList<>();
                for (Map<String, Object> x : rows) {
                    total += N(x.get("n"));
                    stacks.add(map("label", x.get("department"), "values", List.of(js(N(x.get("a0"))), js(N(x.get("a1"))), js(N(x.get("a2")))), "href", "#/testing"));
                }
                return map("kpis", List.of(kpi("label", "Tests waiting to be batched", "value", js(total), "href", "#/testing")),
                    "stacks", map("legend", List.of("Under 2 days", "2 to 5 days", "Over 5 days"), "rows", stacks));
            }
            case "batches": {
                Map<String, Object> x = one("""
                    SELECT count(*) FILTER (WHERE status = 'Open') AS open, count(*) FILTER (WHERE status = 'In Progress') AS prog,
                        count(*) FILTER (WHERE status = 'Awaiting Review') AS review FROM test_batch WHERE site_id = ANY($1) AND NOT is_verification""", s);
                return map("kpis", List.of(kpi("label", "Open", "value", js(N(x.get("open"))), "href", "#/testing/batches"),
                    kpi("label", "In progress", "value", js(N(x.get("prog"))), "href", "#/testing/batches"),
                    kpi("label", "Waiting for QC Review", "value", js(N(x.get("review"))), "href", "#/testing/batches?show=review", "tone", tone(N(x.get("review")) != 0, "warn"))));
            }
            case "overdue": {
                Map<String, Object> x = one("SELECT count(*) FILTER (WHERE rt.due_date < site_today(o.site_id)) AS late, count(*) FILTER (WHERE rt.due_date = site_today(o.site_id)) AS today,\n"
                    + "        count(*) FILTER (WHERE rt.due_date = site_today(o.site_id) + 1) AS tomorrow " + OPEN_TESTS, s);
                return map("kpis", List.of(kpi("label", "Overdue tests", "value", js(N(x.get("late"))), "detail", "overdue", "tone", tone(N(x.get("late")) != 0, "bad")),
                    kpi("label", "Due today", "value", js(N(x.get("today"))), "detail", "due_today", "tone", tone(N(x.get("today")) != 0, "warn")),
                    kpi("label", "Due tomorrow", "value", js(N(x.get("tomorrow"))), "detail", "due_tomorrow")));
            }
            case "tat": {
                Map<String, Object> x = one("""
                    SELECT count(*) AS n,
                        percentile_cont(0.5) WITHIN GROUP (ORDER BY login_days) AS login_med, avg(login_days) AS login_avg,
                        percentile_cont(0.5) WITHIN GROUP (ORDER BY lab_days) AS lab_med, avg(lab_days) AS lab_avg,
                        percentile_cont(0.5) WITHIN GROUP (ORDER BY qa_days) AS qa_med, avg(qa_days) AS qa_avg
                      FROM test_tat_view WHERE site_id = ANY($1) AND reported_at > now() - interval '30 days'""", s);
                String[][] seg = { { "Login TAT", "received to logged in", "login_med", "login_avg" }, { "Lab TAT", "logged in to QC Review approval", "lab_med", "lab_avg" },
                    { "QA TAT", "approval to COA issued", "qa_med", "qa_avg" } };
                List<Object> segments = new ArrayList<>();
                for (String[] g : seg) {
                    Object med = x.get(g[2]), avg = x.get(g[3]);
                    segments.add(map("label", g[0], "help", g[1], "median", med == null ? null : js(Math.round(N(med) * 10) / 10.0),
                        "average", avg == null ? null : js(Math.round(N(avg) * 10) / 10.0)));
                }
                return map("segments", segments, "kpis", List.of(kpi("label", "Tests reported (30 days)", "value", js(N(x.get("n"))), "detail", "tat_slowest")));
            }
            case "on_time": {
                Map<String, Object> qc = onTimeCounts(s, "test_qc_tat_view", "approved_on");
                Map<String, Object> rel = onTimeCounts(s, "test_tat_view", "reported_on");
                return map("kpis", onTimeKpis(qc, new String[] { "qc_late_month", "qc_late_prev" }, false),
                    "minor", map("title", "Released on a COA by the due date", "kpis", onTimeKpis(rel, new String[] { "late_month", "late_prev" }, true)),
                    "note", "Each test against its own due date: approved in QC Review (large) and released on a COA (small). Days the client was On Hold do not count.");
            }
            case "on_time_samples": {
                Map<String, Object> x = onTimeCounts(s, "sample_tat_view", "completed_on");
                return map("kpis", onTimeKpis(x, new String[] { "smp_late_month", "smp_late_prev" }, false),
                    "note", "A sample is on time when its complete COA (every test reported) is issued by its due date, the latest of its tests'. Days the client was On Hold do not count.");
            }
            case "signing": {
                Map<String, Object> x = one("""
                    SELECT
                        (SELECT count(*) FROM test_batch WHERE site_id = ANY($1) AND status = 'Awaiting Review' AND NOT is_verification) AS qc,
                        (SELECT count(*) FROM finalization_queue_view WHERE site_id = ANY($1)) AS fin,
                        (SELECT count(*) FROM oos_investigation WHERE site_id = ANY($1) AND status IN ('Open','Analyst signed','Supervisor signed')) AS oos,
                        (SELECT count(*) FROM logbook_entry e JOIN logbook l ON l.id = e.logbook_id WHERE e.site_id = ANY($1) AND e.status = 'Recorded' AND l.review_route = 'Logbook' AND l.status = 'Active') AS logbook,
                        (SELECT count(DISTINCT t.equipment_id) FROM equipment_tag t JOIN equipment e ON e.id = t.equipment_id WHERE e.site_id = ANY($1) AND t.tagged_in_at IS NULL AND t.reason IN ('Repair','Calibration','Qualification')) AS equipment,
                        (SELECT count(*) FROM purchase_line WHERE site_id = ANY($1) AND status IN ('Requested','Awaiting second approval')) AS purchase,
                        (SELECT count(*) FROM invoice WHERE site_id = ANY($1) AND status = 'Draft') AS invoices,
                        (SELECT count(*) FROM trend_chart WHERE site_id = ANY($1) AND status = 'Active' AND qa_status = 'Awaiting QA') AS charts""", s);
                String[][] rows = { { "QC Review: batches", "qc", "#/testing/batches?show=review" }, { "Report Finalization: sample tests", "fin", "#/reports/finalization" },
                    { "OOS investigations open", "oos", "#/oos" }, { "Logbook entries for QA", "logbook", "#/logbooks/review" }, { "Equipment waiting for release", "equipment", "#/equipment" },
                    { "Purchase requests to approve", "purchase", "#/purchasing" }, { "Draft invoices to issue", "invoices", "#/billing?tab=drafts" },
                    { "Control charts to approve", "charts", "#/trending/charts?show=qa" } };
                List<Object> list = new ArrayList<>();
                for (String[] r : rows) list.add(map("label", r[0], "value", js(N(x.get(r[1]))), "href", r[2]));
                return map("list", list);
            }
            case "supplies": {
                Map<String, Object> x = one("""
                    SELECT
                        (SELECT count(*) FROM equipment_due_view WHERE site_id = ANY($1)) AS due,
                        (SELECT count(*) FROM equipment_view WHERE site_id = ANY($1) AND availability = 'Tagged out') AS tagged,
                        (SELECT count(*) FROM inventory_lot_view WHERE site_id = ANY($1) AND status = 'Available' AND receipt_status = 'Received' AND expiry_status IN ('Expiring','Expired')) AS expiring,
                        (SELECT count(*) FROM inventory_lot_view WHERE site_id = ANY($1) AND status = 'Available' AND receipt_status = 'Received' AND low_stock) AS low,
                        (SELECT count(*) FROM purchase_line WHERE site_id = ANY($1) AND status IN ('Requested','Awaiting second approval','Approved','Ordered','Partly received')) AS purchase""", s);
                return map("kpis", List.of(kpi("label", "Equipment due", "value", js(N(x.get("due"))), "href", "#/equipment/due", "tone", tone(N(x.get("due")) != 0, "warn")),
                    kpi("label", "Tagged out", "value", js(N(x.get("tagged"))), "href", "#/equipment"),
                    kpi("label", "Lots expiring", "value", js(N(x.get("expiring"))), "href", "#/inventory", "tone", tone(N(x.get("expiring")) != 0, "warn")),
                    kpi("label", "Lots low", "value", js(N(x.get("low"))), "href", "#/inventory", "tone", tone(N(x.get("low")) != 0, "warn")),
                    kpi("label", "Purchases open", "value", js(N(x.get("purchase"))), "href", "#/purchasing")));
            }
            case "low_stock_risk": {
                List<Map<String, Object>> rows = q(RISK + " ORDER BY samples_at_risk DESC, l.pct_remaining NULLS LAST LIMIT 8", s);
                Map<String, Object> tot = one("""
                    SELECT count(*) AS lots, count(DISTINCT p.sample_id) AS samples FROM low_stock_demand_view l
                        LEFT JOIN test_pool_view p ON p.site_id = l.site_id AND NOT p.is_media AND ((l.department_id IS NOT NULL AND p.department_id = l.department_id) OR p.test_id = ANY (l.used_by_tests))
                       WHERE l.site_id = ANY($1)""", s);
                List<Object> table = new ArrayList<>();
                for (Map<String, Object> x : rows) {
                    String left = N(x.get("on_hand")) < 0 ? "Negative: reconcile"
                        : Js.truthy(x.get("low_stock")) ? (x.get("pct_remaining") == null ? "Low" : Math.round(N(x.get("pct_remaining"))) + " % left")
                        : Js.string(Js.orBlank(x.get("expiry_status")));
                    table.add(List.of(map("text", x.get("lot_code"), "href", "#/inventory/lots/" + Js.string(x.get("lot_id"))), map("text", Js.orBlank(x.get("item_name"))),
                        map("text", Js.truthy(x.get("department_name")) ? x.get("department_name") : "No department set"), map("text", left),
                        map("text", Js.string(js(N(x.get("samples_at_risk")))), "num", true)));
                }
                return map("kpis", List.of(kpi("label", "Lots low or expiring", "value", js(N(tot.get("lots"))), "href", "#/inventory", "tone", tone(N(tot.get("lots")) != 0, "warn")),
                    kpi("label", "Samples waiting that need them", "value", js(N(tot.get("samples"))), "detail", "risk_samples", "tone", tone(N(tot.get("samples")) != 0, "bad"))),
                    "table", map("columns", List.of("Lot", "Item", "Department", "Left", "Samples at risk"), "rows", table),
                    "note", "A lot counts against the samples of its department (set on the item) and of the tests that used the same item in the last 180 days.");
            }
            case "quotes": {
                Map<String, Object> x = one("""
                    SELECT count(*) FILTER (WHERE v.is_open) AS open, COALESCE(sum(v.total) FILTER (WHERE v.status = 'Quoted'), 0) AS value,
                        count(*) FILTER (WHERE v.status = 'Accepted' AND v.accepted_at > now() - interval '90 days') AS won,
                        count(*) FILTER (WHERE (v.status = 'Rejected' AND v.rejected_at > now() - interval '90 days') OR (v.status = 'Expired' AND v.version_created_at > now() - interval '90 days')) AS lost
                      FROM quote_list_view v JOIN project p ON p.id = v.project_id WHERE p.site_id = ANY($1) AND v.kind IN ('Quote','Project','Stability')""", s);
                double won = N(x.get("won")), lost = N(x.get("lost"));
                return map("kpis", List.of(kpi("label", "Open quotes", "value", js(N(x.get("open"))), "href", "#/quotes"),
                    kpi("label", "Value quoted, waiting", "value", js(N(x.get("value"))), "fmt", "money", "href", "#/quotes"),
                    kpi("label", "Win rate, 90 days (" + js(won) + " won, " + js(lost) + " lost)", "value", js(pct(won, won + lost)), "fmt", "pct", "href", "#/quotes")));
            }
            case "stability": {
                Map<String, Object> x = one("""
                    SELECT
                        (SELECT count(*) FROM stability_pull_view WHERE site_id = ANY($1) AND status IN ('Scheduled','Ordered') AND scheduled_date <= site_today(site_id) + 7) AS pulls,
                        (SELECT count(*) FROM stability_study WHERE site_id = ANY($1) AND status = 'Awaiting material') AS awaiting,
                        (SELECT count(DISTINCT logbook_entry_id) FROM stability_excursion_view WHERE site_id = ANY($1) AND entry_at > now() - interval '30 days') AS excursions""", s);
                return map("kpis", List.of(kpi("label", "Pulls due this week", "value", js(N(x.get("pulls"))), "href", "#/stability/studies"),
                    kpi("label", "Studies awaiting material", "value", js(N(x.get("awaiting"))), "href", "#/stability/studies"),
                    kpi("label", "Chamber excursions (30 days)", "value", js(N(x.get("excursions"))), "href", "#/stability/studies", "tone", tone(N(x.get("excursions")) != 0, "warn"))));
            }
            case "billing": {
                Map<String, Object> x = one("""
                    SELECT (SELECT COALESCE(sum(amount), 0) FROM invoice_ready_view WHERE site_id = ANY($1)) AS ready,
                        (SELECT count(*) FROM invoice_ready_view WHERE site_id = ANY($1)) AS ready_n,
                        (SELECT count(*) FROM invoice_ready_view WHERE site_id = ANY($1) AND late_days > 0 AND rush_fee > 0) AS late,
                        (SELECT count(*) FROM invoice WHERE site_id = ANY($1) AND status = 'Draft') AS drafts""", s);
                return map("kpis", List.of(kpi("label", "Ready to invoice (" + js(N(x.get("ready_n"))) + " tests)", "value", js(N(x.get("ready"))), "fmt", "money", "href", "#/billing"),
                    kpi("label", "Draft invoices", "value", js(N(x.get("drafts"))), "href", "#/billing?tab=drafts"),
                    kpi("label", "Late rushes to check", "value", js(N(x.get("late"))), "href", "#/billing", "tone", tone(N(x.get("late")) != 0, "warn"))));
            }
            case "revenue": {
                Object d = today(s);
                Map<String, Object> x = one("SELECT " + rev(M0, M1) + " AS month, " + rev(PM, M0) + " AS prev, " + rev(Y0, Y1) + " AS year", s, d);
                return map("kpis", List.of(kpi("label", "This month", "value", js(N(x.get("month"))), "fmt", "money", "detail", "rev_month"),
                    kpi("label", "Last month", "value", js(N(x.get("prev"))), "fmt", "money", "detail", "rev_prev"),
                    kpi("label", "This year", "value", js(N(x.get("year"))), "fmt", "money", "detail", "rev_year")),
                    "note", "Revenue counts when the invoice is issued (credit notes taken off).");
            }
            case "wip": {
                List<Map<String, Object>> rows = q("SELECT wip_state, count(*) AS n, COALESCE(sum(value), 0) AS v FROM wip_view WHERE site_id = ANY($1) GROUP BY 1", s);
                Map<String, Map<String, Object>> by = new LinkedHashMap<>();
                double total = 0;
                for (Map<String, Object> x : rows) { by.put(Js.string(x.get("wip_state")), x); total += N(x.get("v")); }
                Map<String, String> help = Map.of("Not Started", "waiting to be batched", "Incomplete", "in a batch", "Finalized", "results approved, report not issued",
                    "Pending Invoice", "report issued, not invoiced");
                List<Object> kpis = new ArrayList<>();
                for (String k : STATES) {
                    Map<String, Object> b = by.get(k);
                    kpis.add(kpi("label", k + " (" + js(N(b == null ? null : b.get("n"))) + ")", "sub", help.get(k), "value", js(N(b == null ? null : b.get("v"))), "fmt", "money", "detail", "wip:" + k));
                }
                return map("kpis", kpis, "total", js(total));
            }
            case "projection": {
                Object d = today(s);
                Map<String, Object> x = one("SELECT " + rev(M0, M1) + " AS invoiced,\n"
                    + "        COALESCE((SELECT sum(value) FROM wip_view WHERE site_id = ANY($1) AND (wip_state IN ('Pending Invoice','Finalized') OR due_date IS NULL OR due_date < " + M1 + ")), 0) AS due,\n"
                    + "        COALESCE((SELECT sum(value) FROM wip_view WHERE site_id = ANY($1) AND wip_state NOT IN ('Pending Invoice','Finalized') AND due_date >= " + M1 + "), 0) AS boost", s, d);
                return map("kpis", List.of(kpi("label", "Projected for the month", "value", js(N(x.get("invoiced")) + N(x.get("due"))), "fmt", "money",
                        "sub", fmtMoney(x.get("invoiced")) + " invoiced + " + fmtMoney(x.get("due")) + " work due this month", "detail", "proj_due"),
                    kpi("label", "Month-end boost", "value", js(N(x.get("boost"))), "fmt", "money", "sub", "work due next month: what finishing it faster would add", "detail", "proj_boost")));
            }
            case "samples": {
                Object d = today(s);
                String[][] per = { { "This month", M0, M1, "smp_month" }, { "Last month", PM, M0, "smp_prev" }, { "This quarter", Q0, Q1, "smp_quarter" }, { "Year to date", Y0, Y1, "smp_year" } };
                List<Object> kpis = new ArrayList<>();
                for (String[] p : per) {
                    double[] x = samplesIn(s, d, p[1], p[2]);
                    kpis.add(kpi("label", p[0], "value", js(x[0]), "sub", x[0] != 0 ? "average " + fmtMoney(x[1] / x[0]) + " a sample" : "", "detail", p[3]));
                }
                return map("kpis", kpis, "note", "Samples logged; the value is the work ordered on them at quoted prices.");
            }
            case "network": return network(s);
            case "finance": case "lab_finance": return map("finance", financeRows(s), "note", FIN_NOTE);
            default: return new LinkedHashMap<>();
        }
    }

    private static Double dev(Double a, Double b) {
        return b == null || a == null || b == 0 ? null : Math.round((1000 * (a - b)) / Math.abs(b)) / 10.0;
    }

    private static Double div3(Double v) { return v == null ? null : v / 3; }

    // Labs side by side (D-1.1): revenue and EBITDA by period, with three comparisons; potential revenue; on time this month
    private Map<String, Object> network(List<String> s) {
        Object d = today(s);
        String h0 = "(CASE WHEN extract(month FROM $2::date) <= 6 THEN date_trunc('year', $2::date) ELSE date_trunc('year', $2::date) + interval '6 months' END)::date";
        String h1 = "(" + h0 + " + interval '6 months')::date";
        String pmsp = "(" + PM + " + ($2::date - " + M0 + ") + 1)";
        String m3 = "(date_trunc('month', $2::date) - interval '3 months')::date";
        String lq0 = "(date_trunc('quarter', $2::date) - interval '3 months')::date";
        String lqsp = "(" + lq0 + " + ($2::date - " + Q0 + ") + 1)";
        String[][] p = { { "m", M0, M1 }, { "p", PM, M0 }, { "psp", PM, pmsp }, { "m3", m3, M0 }, { "q", Q0, Q1 }, { "lqsp", lq0, lqsp }, { "h", h0, h1 }, { "y", Y0, Y1 } };
        List<String> cols = new ArrayList<>();
        for (String[] e : p) cols.add(rev(e[1], e[2]) + " AS r_" + e[0] + ", " + cost(e[1], e[2]) + " AS c_" + e[0] + ", " + weeks(e[1], e[2]) + " AS w_" + e[0]);
        List<Object> rows = new ArrayList<>();
        for (String site : s) {
            Map<String, Object> lab = one("SELECT site_code, site_name FROM lab_site WHERE id = $1", site);
            List<String> ss = List.of(site);
            Map<String, Object> x = one("SELECT " + String.join(", ", cols), ss, d);
            java.util.function.Function<String, Double> rv = k -> N(x.get("r_" + k));
            // no costs typed for the period: no EBITDA
            java.util.function.Function<String, Double> eb = k -> N(x.get("w_" + k)) != 0 ? N(x.get("r_" + k)) - N(x.get("c_" + k)) : null;
            double[] sm = samplesIn(ss, d, M0, M1), sp = samplesIn(ss, d, PM, M0), sy = samplesIn(ss, d, Y0, Y1);
            Map<String, Object> ot = one("SELECT count(*) FILTER (WHERE on_time) AS ok, count(*) AS n FROM sample_tat_view WHERE site_id = $1 AND completed_on >= date_trunc('month', site_today(site_id))::date", site);
            Map<String, Object> wip = one("SELECT COALESCE(sum(value), 0) AS v FROM wip_view WHERE site_id = $1", site);
            rows.add(map("site_id", site, "lab", lab.get("site_code"), "name", lab.get("site_name"),
                "rev", periods(rv), "ebitda", periods(eb),
                "smp_m", js(sm[0]), "smp_p", js(sp[0]), "smp_y", js(sy[0]), "avg_y", js(sy[0] != 0 ? sy[1] / sy[0] : 0), "on_time", js(pct(ot.get("ok"), ot.get("n"))),
                "wip", js(N(wip.get("v"))), "potential", js(N(wip.get("v")) + rv.apply("m"))));
        }
        return map("network", rows, "note", "Revenue = LIMS invoices issued (credit notes taken off). EBITDA = that revenue less the costs finance types each week; blank where no costs are typed. "
            + "% vs last month: this month to date against last month to the same day. Last month vs 3-month average: last month against the average of the last three full months. "
            + "% vs last quarter: this quarter to date against last quarter to the same point. Potential revenue = work in progress + revenue this month. On time: samples, this month.");
    }

    private static Map<String, Object> periods(java.util.function.Function<String, Double> f) {
        return map("m", js(f.apply("m")), "p", js(f.apply("p")), "q", js(f.apply("q")), "h", js(f.apply("h")), "y", js(f.apply("y")),
            "dev_m", js(dev(f.apply("m"), f.apply("psp"))), "dev_p3", js(dev(f.apply("p"), div3(f.apply("m3")))), "dev_q", js(dev(f.apply("q"), f.apply("lqsp"))));
    }

    // The finance update by month: revenue = LIMS invoiced; costs as typed; EBITDA where costs are typed; the books' revenue last
    private List<Object> financeRows(List<String> s) {
        Object d = today(s);
        List<Map<String, Object>> rows = q("""
            WITH m AS (SELECT generate_series(date_trunc('year', $2::date), date_trunc('year', $2::date) + interval '11 months', interval '1 month')::date AS month)
              SELECT m.month,
                (SELECT sum(total) FROM revenue_view r WHERE r.site_id = ANY($1) AND date_trunc('month', r.invoice_date) = m.month) AS lims_rev,
                (SELECT sum(costs) FROM finance_week w WHERE w.site_id = ANY($1) AND w.status = 'Active' AND date_trunc('month', w.week_ending) = m.month) AS act_cost,
                (SELECT sum(revenue) FROM finance_week w WHERE w.site_id = ANY($1) AND w.status = 'Active' AND date_trunc('month', w.week_ending) = m.month) AS books_rev,
                (SELECT count(DISTINCT week_ending) FROM finance_week w WHERE w.site_id = ANY($1) AND w.status = 'Active' AND date_trunc('month', w.week_ending) = m.month) AS weeks,
                (SELECT sum(revenue) FROM finance_plan p WHERE p.site_id = ANY($1) AND p.status = 'Active' AND p.month = m.month AND p.plan = 'Budget forecast') AS bud_rev,
                (SELECT sum(costs) FROM finance_plan p WHERE p.site_id = ANY($1) AND p.status = 'Active' AND p.month = m.month AND p.plan = 'Budget forecast') AS bud_cost,
                (SELECT sum(revenue) FROM finance_plan p WHERE p.site_id = ANY($1) AND p.status = 'Active' AND p.month = m.month AND p.plan = 'Monthly forecast') AS fc_rev,
                (SELECT sum(costs) FROM finance_plan p WHERE p.site_id = ANY($1) AND p.status = 'Active' AND p.month = m.month AND p.plan = 'Monthly forecast') AS fc_cost
              FROM m ORDER BY m.month""", s, d);
        List<Object> out = new ArrayList<>();
        for (Map<String, Object> x : rows) {
            boolean wk = N(x.get("weeks")) != 0;
            out.add(map("month", x.get("month"), "weeks", js(N(x.get("weeks"))),
                "act_rev", nn(x.get("lims_rev")), "act_cost", wk ? nn(x.get("act_cost")) : null, "act_ebitda", wk ? e(x.get("lims_rev"), x.get("act_cost")) : null, "books_rev", nn(x.get("books_rev")),
                "bud_rev", nn(x.get("bud_rev")), "bud_cost", nn(x.get("bud_cost")), "bud_ebitda", e(x.get("bud_rev"), x.get("bud_cost")),
                "fc_rev", nn(x.get("fc_rev")), "fc_cost", nn(x.get("fc_cost")), "fc_ebitda", e(x.get("fc_rev"), x.get("fc_cost"))));
        }
        return out;
    }

    private static Object nn(Object v) { return v == null ? null : js(N(v)); }

    private static Object e(Object rv, Object c) { return rv == null && c == null ? null : js(N(rv) - N(c)); }

    // ---------------------------------------------------------------- the lists behind the numbers
    private record Detail(String title, String sql, boolean today) {}

    private static final String TEST_COLS = "rt.id, sm.id AS sample_id, sm.sample_code, sm.client_sample_id, o.id AS lab_order_id, o.order_code, COALESCE(c.display_name, c.legal_name) AS client_name, t.test_name, rt.due_date, rt.rush_fee > 0 AS rush";
    private static final Map<String, Detail> DETAIL = new LinkedHashMap<>();

    private static void detail(String key, String title, String sql) { DETAIL.put(key, new Detail(title, sql, false)); }

    private static Detail revDetail(String title, String from, String to) {
        return new Detail(title, "SELECT r.invoice_id AS id, i.invoice_number, r.invoice_date, i.kind, COALESCE(c.display_name, c.legal_name) AS client_name, r.total, r.catchup\n"
            + "      FROM revenue_view r JOIN invoice i ON i.id = r.invoice_id JOIN client c ON c.id = r.client_id WHERE r.site_id = ANY($1) AND r.invoice_date >= " + from + " AND r.invoice_date < " + to + "\n"
            + "      ORDER BY r.invoice_date DESC, i.invoice_number DESC", true);
    }

    private static Detail smpDetail(String title, String from, String to) {
        return new Detail(title, "SELECT sm.id AS sample_id, sm.sample_code, sm.client_sample_id, o.id AS lab_order_id, o.order_code, COALESCE(c.display_name, c.legal_name) AS client_name,\n"
            + "      sm.logged_at, " + SAMPLE_VALUE + " AS value " + samplePeriod(from, to) + " ORDER BY sm.logged_at DESC LIMIT 2000", true);
    }

    static {
        detail("week", "Samples logged this week", """
            SELECT sm.id AS sample_id, sm.sample_code, sm.client_sample_id, o.id AS lab_order_id, o.order_code, COALESCE(c.display_name, c.legal_name) AS client_name, sm.logged_at
                FROM sample sm JOIN lab_order o ON o.id = sm.lab_order_id JOIN lab_site si ON si.id = o.site_id JOIN client c ON c.id = o.client_id
                WHERE o.site_id = ANY($1) AND NOT c.is_internal AND (sm.logged_at AT TIME ZONE si.time_zone)::date >= date_trunc('week', site_today(o.site_id))::date ORDER BY sm.logged_at DESC""");
        detail("expected", "Samples expected, not received", """
            SELECT sm.id AS sample_id, sm.sample_code, sm.client_sample_id, o.id AS lab_order_id, o.order_code, COALESCE(c.display_name, c.legal_name) AS client_name, o.submitted_at
                FROM sample sm JOIN lab_order o ON o.id = sm.lab_order_id JOIN client c ON c.id = o.client_id
                WHERE o.site_id = ANY($1) AND NOT c.is_internal AND sm.status = 'Expected' AND o.status IN ('Submitted','Received') ORDER BY o.submitted_at""");
        detail("rush", "Rush tests in the lab", "SELECT " + TEST_COLS + " " + OPEN_TESTS + " AND rt.rush_fee > 0 ORDER BY rt.due_date");
        detail("rush_late", "Rush tests overdue", "SELECT " + TEST_COLS + " " + OPEN_TESTS + " AND rt.rush_fee > 0 AND rt.due_date < site_today(o.site_id) ORDER BY rt.due_date");
        detail("overdue", "Overdue tests (not yet reported)", "SELECT " + TEST_COLS + " " + OPEN_TESTS + " AND rt.due_date < site_today(o.site_id) ORDER BY rt.due_date");
        detail("due_today", "Tests due today", "SELECT " + TEST_COLS + " " + OPEN_TESTS + " AND rt.due_date = site_today(o.site_id) ORDER BY sm.sample_code");
        detail("due_tomorrow", "Tests due tomorrow", "SELECT " + TEST_COLS + " " + OPEN_TESTS + " AND rt.due_date = site_today(o.site_id) + 1 ORDER BY sm.sample_code");
        detail("tat_slowest", "Tests reported in the last 30 days, slowest first", """
            SELECT v.requested_test_id AS id, v.sample_id, v.sample_code, v.lab_order_id, v.order_code, v.test_name, v.due_date, v.reported_on,
                round(v.login_days::numeric, 1) AS login_days, round(v.lab_days::numeric, 1) AS lab_days, round(v.qa_days::numeric, 1) AS qa_days, v.on_time, v.hold_days
                FROM test_tat_view v WHERE v.site_id = ANY($1) AND v.reported_at > now() - interval '30 days' ORDER BY COALESCE(v.lab_days, 0) + COALESCE(v.qa_days, 0) DESC LIMIT 500""");
        detail("late_month", "Reported late this month", """
            SELECT v.requested_test_id AS id, v.sample_id, v.sample_code, v.lab_order_id, v.order_code, v.test_name, v.due_date, v.reported_on, v.days_late, v.hold_days
                FROM test_tat_view v WHERE v.site_id = ANY($1) AND NOT v.on_time AND v.reported_on >= date_trunc('month', site_today(v.site_id))::date ORDER BY v.days_late DESC""");
        detail("late_prev", "Reported late last month", """
            SELECT v.requested_test_id AS id, v.sample_id, v.sample_code, v.lab_order_id, v.order_code, v.test_name, v.due_date, v.reported_on, v.days_late, v.hold_days
                FROM test_tat_view v WHERE v.site_id = ANY($1) AND NOT v.on_time AND v.reported_on >= (date_trunc('month', site_today(v.site_id)) - interval '1 month')::date
                 AND v.reported_on < date_trunc('month', site_today(v.site_id))::date ORDER BY v.days_late DESC""");
        detail("qc_late_month", "Tests approved in QC Review after their due date, this month", """
            SELECT v.requested_test_id AS id, v.sample_id, v.sample_code, v.lab_order_id, v.order_code, v.test_name, v.due_date, v.approved_on, v.days_late, v.hold_days
                FROM test_qc_tat_view v WHERE v.site_id = ANY($1) AND NOT v.on_time AND v.approved_on >= date_trunc('month', site_today(v.site_id))::date ORDER BY v.days_late DESC""");
        detail("qc_late_prev", "Tests approved in QC Review after their due date, last month", """
            SELECT v.requested_test_id AS id, v.sample_id, v.sample_code, v.lab_order_id, v.order_code, v.test_name, v.due_date, v.approved_on, v.days_late, v.hold_days
                FROM test_qc_tat_view v WHERE v.site_id = ANY($1) AND NOT v.on_time AND v.approved_on >= (date_trunc('month', site_today(v.site_id)) - interval '1 month')::date
                 AND v.approved_on < date_trunc('month', site_today(v.site_id))::date ORDER BY v.days_late DESC""");
        detail("smp_late_month", "Samples completed after their due date, this month", """
            SELECT v.sample_id, v.sample_code, v.client_sample_id, v.lab_order_id, v.order_code, v.tests, v.due_date, v.completed_on, v.days_late, v.hold_days
                FROM sample_tat_view v WHERE v.site_id = ANY($1) AND NOT v.on_time AND v.completed_on >= date_trunc('month', site_today(v.site_id))::date ORDER BY v.days_late DESC""");
        detail("smp_late_prev", "Samples completed after their due date, last month", """
            SELECT v.sample_id, v.sample_code, v.client_sample_id, v.lab_order_id, v.order_code, v.tests, v.due_date, v.completed_on, v.days_late, v.hold_days
                FROM sample_tat_view v WHERE v.site_id = ANY($1) AND NOT v.on_time AND v.completed_on >= (date_trunc('month', site_today(v.site_id)) - interval '1 month')::date
                 AND v.completed_on < date_trunc('month', site_today(v.site_id))::date ORDER BY v.days_late DESC""");
        detail("risk_samples", "Samples waiting that need low or expiring stock", """
            SELECT DISTINCT p.sample_id, p.sample_code, p.client_sample_id, p.test_name, p.due_date, l.lot_code, l.item_name
                FROM low_stock_demand_view l JOIN test_pool_view p ON p.site_id = l.site_id AND NOT p.is_media AND ((l.department_id IS NOT NULL AND p.department_id = l.department_id) OR p.test_id = ANY (l.used_by_tests))
                WHERE l.site_id = ANY($1) ORDER BY p.due_date NULLS LAST, p.sample_code""");
        detail("proj_due", "Work due to finish this month (not yet invoiced)", """
            SELECT w.requested_test_id AS id, w.sample_id, w.sample_code, w.lab_order_id, w.order_code, w.client_name, w.test_name, w.due_date, w.wip_state, w.value
                FROM wip_view w WHERE w.site_id = ANY($1) AND (w.wip_state IN ('Pending Invoice','Finalized') OR w.due_date IS NULL OR w.due_date < (date_trunc('month', site_today(w.site_id)) + interval '1 month')::date) ORDER BY w.due_date NULLS LAST""");
        detail("proj_boost", "Month-end boost: work due next month or later", """
            SELECT w.requested_test_id AS id, w.sample_id, w.sample_code, w.lab_order_id, w.order_code, w.client_name, w.test_name, w.due_date, w.wip_state, w.value
                FROM wip_view w WHERE w.site_id = ANY($1) AND w.wip_state NOT IN ('Pending Invoice','Finalized') AND w.due_date >= (date_trunc('month', site_today(w.site_id)) + interval '1 month')::date ORDER BY w.due_date""");
        DETAIL.put("rev_month", revDetail("Invoices and credit notes this month", M0, M1));
        DETAIL.put("rev_prev", revDetail("Invoices and credit notes last month", PM, M0));
        DETAIL.put("rev_year", revDetail("Invoices and credit notes this year", Y0, Y1));
        DETAIL.put("smp_month", smpDetail("Samples logged this month", M0, M1));
        DETAIL.put("smp_prev", smpDetail("Samples logged last month", PM, M0));
        DETAIL.put("smp_quarter", smpDetail("Samples logged this quarter", Q0, Q1));
        DETAIL.put("smp_year", smpDetail("Samples logged this year", Y0, Y1));
    }

    // ---------------------------------------------------------------- boards
    private List<Map<String, Object>> widgetsFor(RequestContext c, String board, List<String> sites) {
        if (board.equals("home")) return q("SELECT * FROM my_home_widgets($1, $2)", sites.get(0), c.userId());
        List<String> order = board.equals("executive") ? List.of("network", "finance", "revenue", "projection", "wip", "samples", "on_time_samples", "on_time", "tat")
            : List.of("lab_finance", "revenue", "projection", "wip", "samples", "on_time_samples", "on_time", "tat", "network", "overdue", "rush", "quotes");
        List<Map<String, Object>> ws = new ArrayList<>(q("SELECT * FROM dashboard_widget WHERE $1 = ANY (boards) ORDER BY sort_order", board));
        ws.sort((a, b) -> rank(order, a) - rank(order, b));
        return ws;
    }

    private static int rank(List<String> order, Map<String, Object> w) { int i = order.indexOf(Js.string(w.get("code"))) + 1; return i == 0 ? 99 : i; }

    private static String errorText(RuntimeException e) {
        PSQLException pg = ApiExceptionHandler.find(e);
        if (pg != null && pg.getServerErrorMessage() != null) return pg.getServerErrorMessage().getMessage();
        return e.getMessage() == null ? e.toString() : e.getMessage();
    }

    private void remember(String key, Map<String, Object> v) {
        cache.put(key, v);
        if (cache.size() > 5000) {
            String old = ISO.format(Instant.now().minus(24, ChronoUnit.HOURS));
            cache.entrySet().removeIf(x -> ((String) x.getValue().get("at")).compareTo(old) < 0);
        }
    }

    /** GET /api/dashboard/:board: every widget of the board (live ones worked out again, others from memory unless refreshed). */
    public Map<String, Object> board(RequestContext c, String board, Map<String, String> query) {
        if (!BOARDS.contains(board)) throw new RuleException("Dashboard not found");
        List<String> sites = sitesFor(c, board, query.get("lab"));
        List<Map<String, Object>> ws = widgetsFor(c, board, sites);
        Map<String, Object> layout = one("SELECT layout, hidden FROM user_dashboard_layout WHERE user_id = $1 AND board = $2", c.userId(), board);
        String onlyQ = query.get("only");
        List<String> only = onlyQ != null && !onlyQ.isEmpty() ? Arrays.asList(onlyQ.split(",", -1)) : null;
        boolean refresh = "1".equals(query.get("refresh"));
        List<String> sorted = new ArrayList<>(sites);
        sorted.sort(null);
        List<Object> hidden = layout != null && layout.get("hidden") instanceof List<?> h ? new ArrayList<>(h) : List.of();
        List<Object> out = new ArrayList<>();
        for (Map<String, Object> w : ws) {
            String code = Js.string(w.get("code"));
            if (only != null && !only.contains(code)) continue;
            if (layout != null && hidden.contains(code) && only == null) {
                out.add(map("code", w.get("code"), "title", w.get("title"), "hidden", true, "description", w.get("description")));
                continue;
            }
            boolean live = LIVE.contains(code);
            String key = board + "|" + String.join(",", sorted) + "|" + code + "|" + c.userId();
            Map<String, Object> got = live || refresh ? null : cache.get(key);
            if (got == null) {
                got = new LinkedHashMap<>();
                try { got.put("data", widget(code, sites, c)); got.put("error", null); }
                catch (RuntimeException e) { got.put("error", errorText(e)); }   // Node leaves data undefined: the key is not sent
                got.put("at", now());
                if (!live && got.get("error") == null) remember(key, got);
            }
            Map<String, Object> o = map("code", w.get("code"), "title", w.get("title"), "category", w.get("category"), "description", w.get("description"),
                "w", w.get("default_w"), "h", w.get("default_h"));
            if (got.containsKey("data")) o.put("data", got.get("data"));
            o.put("error", got.get("error"));
            o.put("live", live);
            o.put("at", got.get("at"));
            out.add(o);
        }
        List<Map<String, Object>> labs = board.equals("home") ? List.of()
            : q("SELECT id, site_code, site_name FROM lab_site WHERE id = ANY($1) ORDER BY site_code", sitesFor(c, board, null));
        String lab = query.get("lab");
        return map("board", board, "widgets", out, "layout", layout != null ? layout.get("layout") : List.of(), "hidden", layout != null ? layout.get("hidden") : List.of(),
            "labs", labs, "lab", RequestContext.isUuid(lab) ? lab : null, "at", now());
    }

    /** GET /api/dashboard/:board/detail?k=: the list behind a number. */
    public Map<String, Object> detail(RequestContext c, String board, Map<String, String> query) {
        List<String> sites = sitesFor(c, board, query.get("lab"));
        String key = query.get("k") == null ? "" : query.get("k");
        if (key.startsWith("wip:")) {
            String st = key.substring(4);
            if (!STATES.contains(st)) throw new RuleException("Unknown list");
            return map("title", "Work in progress: " + st, "rows", q("""
                SELECT w.requested_test_id AS id, w.sample_id, w.sample_code, w.lab_order_id, w.order_code, w.client_name, w.test_name, w.due_date, w.value
                    FROM wip_view w WHERE w.site_id = ANY($1) AND w.wip_state = $2 ORDER BY w.due_date NULLS LAST LIMIT 3000""", sites, st));
        }
        Detail d = DETAIL.get(key);
        if (d == null) throw new RuleException("Unknown list");
        List<Map<String, Object>> rows = d.today() ? q(d.sql(), sites, today(sites)) : q(d.sql(), sites);
        return map("title", d.title(), "rows", rows);
    }

    /** PUT /api/dashboard/:board/layout: the person's own arrangement (not audited). */
    public Map<String, Object> saveLayout(RequestContext c, String board, Map<String, Object> body) {
        if (!BOARDS.contains(board)) throw new RuleException("Dashboard not found");
        List<Object> layout = new ArrayList<>();
        if (body.get("layout") instanceof List<?> l)
            for (Object o : l) if (o instanceof Map<?, ?> x && x.get("code") instanceof String code)
                layout.add(map("code", code, "w", Math.min(12, Math.max(2, Js.intOr(x.get("w"), 4))), "h", Math.min(6, Math.max(1, Js.intOr(x.get("h"), 2)))));
        StringBuilder hidden = new StringBuilder("{");
        if (body.get("hidden") instanceof List<?> l)
            for (Object o : l) if (o instanceof String h) hidden.append(hidden.length() > 1 ? "," : "").append('"').append(h.replace("\"", "")).append('"');
        hidden.append('}');
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> widgets = (List<Map<String, Object>>) (List<?>) layout;
        new DashboardLayout(c.userId(), widgets).check(c.userId());
        String json;
        try { json = JSON.writeValueAsString(layout); } catch (Exception e) { throw new IllegalStateException(e); }
        uow.run(c, "", t -> {
            Sql s = pg("""
                INSERT INTO user_dashboard_layout (user_id, board, layout, hidden) VALUES ($1, $2, $3::jsonb, $4::text[])
                  ON CONFLICT (user_id, board) DO UPDATE SET layout = EXCLUDED.layout, hidden = EXCLUDED.hidden, updated_at = now()""", c.userId(), board, json, hidden.toString());
            return t.update(s.text(), s.params());
        });
        return ok();
    }

    /** POST /api/dashboard/:board/reset. */
    public Map<String, Object> reset(RequestContext c, String board) {
        uow.run(c, "", t -> {
            Sql s = pg("""
                INSERT INTO user_dashboard_layout (user_id, board, layout, hidden) VALUES ($1, $2, '[]', '{}')
                  ON CONFLICT (user_id, board) DO UPDATE SET layout = '[]', hidden = '{}', updated_at = now()""", c.userId(), board);
            return t.update(s.text(), s.params());
        });
        return ok();
    }

    /** GET /api/departments: the lab's departments. */
    public List<Map<String, Object>> departments(RequestContext c) {
        return q("SELECT id, department_code, department_name FROM department WHERE site_id = $1 AND status = 'Active' ORDER BY department_name", access.currentSite(c));
    }

    /** GET /api/admin/dashboard-widgets: each group's Home widgets. */
    public Map<String, Object> groupWidgets(RequestContext c) {
        String site = access.currentSite(c);
        Map<String, Object> me = one("SELECT is_admin FROM app_user WHERE id = $1", c.userId());
        List<Map<String, Object>> groups = q("""
            SELECT g.id, g.group_name, g.site_id, s.site_code FROM lab_group g LEFT JOIN lab_site s ON s.id = g.site_id
              WHERE g.status = 'Active' AND (g.site_id = $1 OR ($2 AND g.site_id IS NULL)) ORDER BY g.site_id NULLS LAST, g.group_name""", site, me != null && Js.truthy(me.get("is_admin")));
        List<Map<String, Object>> widgets = q("SELECT code, title, category, description, needs_any FROM dashboard_widget WHERE 'home' = ANY (boards) ORDER BY sort_order");
        List<Object> ids = new ArrayList<>();
        for (Map<String, Object> g : groups) ids.add(g.get("id"));
        List<Map<String, Object>> on = q("SELECT group_id, widget_code FROM group_widget WHERE status = 'Active' AND group_id = ANY($1::uuid[])", ids);
        return map("groups", groups, "widgets", widgets, "on", on, "can_edit", RequestContext.isUuid(c.userId()) && access.load(c.userId()).can("admin.groups", site));
    }

    /** POST /api/admin/dashboard-widgets: switch widgets on or off per group (the database checks admin.groups). */
    public Map<String, Object> saveGroupWidgets(RequestContext c, Map<String, Object> body) {
        access.currentSite(c);
        List<?> rows = body.get("rows") instanceof List<?> l ? l : List.of();
        uow.run(c.orReason("Group dashboard widgets changed"), t -> {
            for (Object o : rows) {
                if (!(o instanceof Map<?, ?> x) || !RequestContext.isUuid(x.get("group_id")) || !(x.get("widget_code") instanceof String)) continue;
                Sql s = pg("""
                    INSERT INTO group_widget (group_id, widget_code, status) VALUES ($1, $2, $3::record_status)
                      ON CONFLICT (group_id, widget_code) DO UPDATE SET status = EXCLUDED.status WHERE group_widget.status <> EXCLUDED.status""",
                    x.get("group_id"), x.get("widget_code"), Js.truthy(x.get("on")) ? "Active" : "Inactive");
                t.update(s.text(), s.params());
            }
            return null;
        });
        return ok();
    }

    // ---------------------------------------------------------------- finance figures
    private List<Map<String, Object>> financeLabs(RequestContext c) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (RequestContext.isUuid(c.userId())) {
            UserAccess a = access.load(c.userId());
            for (Map<String, Object> s : q("SELECT id, site_code, site_name FROM lab_site WHERE status = 'Active' ORDER BY site_code"))
                if (a.can("finance.enter", (String) s.get("id"))) out.add(s);
        }
        if (out.isEmpty()) throw new RuleException("The finance figures are typed by system administrators and the Finance group (finance.enter).");
        return out;
    }

    private static List<Object> ids(List<Map<String, Object>> labs) {
        List<Object> out = new ArrayList<>();
        for (Map<String, Object> l : labs) out.add(l.get("id"));
        return out;
    }

    /** parseInt(c.query.year, 10) || new Date().getFullYear() (the server's local year). */
    private static long year(Map<String, String> query) { return Js.intOr(query.get("year"), java.time.LocalDate.now().getYear()); }

    /** GET /api/finance: the year's weeks and forecasts of the labs the person types for. */
    public Map<String, Object> finance(RequestContext c, Map<String, String> query) {
        List<Map<String, Object>> labs = financeLabs(c);
        long year = year(query);
        List<Object> ids = ids(labs);
        // the week's revenue comes from the LIMS (invoices issued that week) and cannot be typed; the books' revenue is optional
        return map("labs", labs, "year", year,
            "weeks", q("""
                SELECT w.id, s.site_code, w.week_ending, lims_week_revenue(w.site_id, w.week_ending) AS lims_revenue, w.costs,
                      lims_week_revenue(w.site_id, w.week_ending) - w.costs AS ebitda, w.revenue AS books_revenue, w.note FROM finance_week w JOIN lab_site s ON s.id = w.site_id
                    WHERE w.site_id = ANY($1) AND w.status = 'Active' AND extract(year FROM w.week_ending) = $2 ORDER BY w.week_ending, s.site_code""", ids, year),
            "plans", q("""
                SELECT p.id, s.site_code, to_char(p.month, 'YYYY-MM') AS month, p.plan, p.revenue, p.costs, p.revenue - p.costs AS ebitda FROM finance_plan p JOIN lab_site s ON s.id = p.site_id
                    WHERE p.site_id = ANY($1) AND p.status = 'Active' AND extract(year FROM p.month) = $2 ORDER BY p.month, s.site_code, p.plan""", ids, year));
    }

    /** `${v}` of a request value: undefined (absent) and null as JavaScript writes them. */
    private static String template(Map<?, ?> x, String k) {
        if (!x.containsKey(k)) return "undefined";
        Object v = x.get(k);
        return v == null ? "null" : Js.string(v);
    }

    private static String siteOf(List<Map<String, Object>> labs, Map<?, ?> x) {
        Object code = x.get("site_code");
        String want = Js.string(Js.orBlank(code)).trim().toUpperCase(Locale.ROOT);
        for (Map<String, Object> l : labs) if (want.equals(l.get("site_code"))) return (String) l.get("id");
        throw new RuleException("Lab \"" + template(x, "site_code") + "\" is not one you type figures for");
    }

    private static final Pattern MONEY_JUNK = Pattern.compile("(?U)[$,\\s]");
    private static final Pattern JS_DECIMAL = Pattern.compile("^[+-]?(Infinity|(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?)$");
    private static final Pattern JS_RADIX = Pattern.compile("^0([xX][0-9a-fA-F]+|[oO][0-7]+|[bB][01]+)$");

    /** Number(text) in JavaScript for text without spaces: "" is 0, anything not a JavaScript number is NaN. */
    static double jsNumber(String t) {
        if (t.isEmpty()) return 0;
        if (JS_RADIX.matcher(t).matches()) {
            char k = Character.toLowerCase(t.charAt(1));
            try { return new java.math.BigInteger(t.substring(2), k == 'x' ? 16 : k == 'o' ? 8 : 2).doubleValue(); } catch (NumberFormatException e) { return Double.NaN; }
        }
        if (!JS_DECIMAL.matcher(t).matches()) return Double.NaN;
        return t.endsWith("Infinity") ? (t.startsWith("-") ? Double.NEGATIVE_INFINITY : Double.POSITIVE_INFINITY) : Double.parseDouble(t);
    }

    /** The finance routes' num(v, what): Number(String(v ?? '')) without $ , and spaces; refused unless finite. */
    private static double money(Object v, String what) {
        double n = jsNumber(MONEY_JUNK.matcher(Js.string(v)).replaceAll(""));
        if (Double.isNaN(n) || Double.isInfinite(n)) throw new RuleException(what + ": type a number");
        return n;
    }

    /** POST /api/finance/weeks: costs (and the books' revenue) per lab and week. */
    public Map<String, Object> saveWeeks(RequestContext c, Map<String, Object> body) {
        List<Map<String, Object>> labs = financeLabs(c);
        List<?> rows = body.get("rows") instanceof List<?> l ? l : List.of();
        uow.run(c.orReason("Weekly finance update"), t -> {
            for (Object o : rows) {
                Map<?, ?> x = o instanceof Map<?, ?> m ? m : Map.of();
                String site = siteOf(labs, x);
                if (!Js.string(Js.orBlank(x.get("week_ending"))).matches("^\\d{4}-\\d{2}-\\d{2}$")) throw new RuleException("Week ending: a date (YYYY-MM-DD)");
                // the LIMS revenue is never taken from the request; only the books' figure (optional), the costs and the note
                Object b = x.get("books_revenue");
                Double books = b == null || Js.string(b).trim().isEmpty() ? null : money(b, "Revenue (books)");
                double costs = money(x.get("costs"), "Costs");
                new FinanceFigure(weekEnding(x.get("week_ending")), books, costs).check(java.time.LocalDate.now(java.time.ZoneOffset.UTC));
                Sql s = pg("""
                    INSERT INTO finance_week (site_id, week_ending, revenue, costs, note) VALUES ($1, $2, $3, $4, NULLIF(btrim($5), ''))
                      ON CONFLICT (site_id, week_ending) DO UPDATE SET revenue = EXCLUDED.revenue, costs = EXCLUDED.costs, note = EXCLUDED.note, status = 'Active'""",
                    site, x.get("week_ending"), books, costs, Js.orBlank(x.get("note")));
                t.update(s.text(), s.params());
            }
            return null;
        });
        return ok();
    }

    private static java.time.LocalDate weekEnding(Object v) {
        try { return java.time.LocalDate.parse(Js.string(v)); } catch (java.time.format.DateTimeParseException e) { throw new RuleException("Week ending: a date (YYYY-MM-DD)"); }
    }

    /** POST /api/finance/plans: the Budget and Monthly forecasts per lab and month. */
    public Map<String, Object> savePlans(RequestContext c, Map<String, Object> body) {
        List<Map<String, Object>> labs = financeLabs(c);
        List<?> rows = body.get("rows") instanceof List<?> l ? l : List.of();
        uow.run(c.orReason("Forecast entered"), t -> {
            for (Object o : rows) {
                Map<?, ?> x = o instanceof Map<?, ?> m ? m : Map.of();
                String site = siteOf(labs, x);
                if (!Js.string(Js.orBlank(x.get("month"))).matches("^\\d{4}-\\d{2}$")) throw new RuleException("Month: year and month (YYYY-MM)");
                if (!(x.get("plan") instanceof String p) || !PLANS.contains(p)) throw new RuleException("Plan: Budget forecast or Monthly forecast");
                double revenue = money(x.get("revenue"), "Revenue"), costs = money(x.get("costs"), "Costs");
                new FinanceFigure(null, revenue, costs).check(java.time.LocalDate.now(java.time.ZoneOffset.UTC));
                Sql s = pg("""
                    INSERT INTO finance_plan (site_id, month, plan, revenue, costs) VALUES ($1, ($2 || '-01')::date, $3, $4, $5)
                      ON CONFLICT (site_id, month, plan) DO UPDATE SET revenue = EXCLUDED.revenue, costs = EXCLUDED.costs, status = 'Active'""",
                    site, x.get("month"), x.get("plan"), revenue, costs);
                t.update(s.text(), s.params());
            }
            return null;
        });
        return ok();
    }

    /** A file to download: its bytes and name. */
    public record Download(byte[] file, String fileName) {}

    /** GET /api/finance/plans.xlsx: the year's forecasts, every month and plan, to edit in Excel. */
    public Download plansXlsx(RequestContext c, Map<String, String> query) {
        List<Map<String, Object>> labs = financeLabs(c);
        long year = year(query);
        List<List<Object>> rows = new ArrayList<>();
        for (Map<String, Object> x : q("""
            SELECT s.site_code, to_char(m.month, 'YYYY-MM') AS month, pl.plan, p.revenue, p.costs
                FROM lab_site s CROSS JOIN generate_series(make_date($2, 1, 1), make_date($2, 12, 1), interval '1 month') m(month) CROSS JOIN (VALUES ('Budget forecast'), ('Monthly forecast')) pl(plan)
                LEFT JOIN finance_plan p ON p.site_id = s.id AND p.month = m.month::date AND p.plan = pl.plan AND p.status = 'Active'
               WHERE s.id = ANY($1) ORDER BY s.site_code, pl.plan, m.month""", ids(labs), year)) {
            List<Object> r = new ArrayList<>();
            r.add(x.get("site_code")); r.add(x.get("month")); r.add(x.get("plan"));
            r.add(x.get("revenue") == null ? "" : js(N(x.get("revenue"))));
            r.add(x.get("costs") == null ? "" : js(N(x.get("costs"))));
            rows.add(r);
        }
        byte[] buf = com.tentamus.lims.core.excel.Xlsx.write("Forecasts " + year, PLAN_HEADERS, rows, List.of(8, 16, 18, 14, 14));
        return new Download(buf, "Forecasts " + year + ".xlsx");
    }

    /** Excel stores dates as days since 1899-12-30 (xlsx.js serialToDate). */
    static String serialToDate(double n) {
        return Instant.ofEpochMilli(Math.round((n - 25569) * 864e5)).atOffset(ZoneOffset.UTC).toLocalDate().toString();
    }

    /** POST /api/finance/plans/preview: an edited forecasts file read back, each row's change or errors, nothing saved. */
    public Map<String, Object> previewPlans(RequestContext c, Map<String, Object> body) {
        List<Map<String, Object>> labs = financeLabs(c);
        byte[] file = java.util.Base64.getMimeDecoder().decode(Js.string(Js.orBlank(body.get("content_base64"))));
        com.tentamus.lims.core.excel.Xlsx.Table tbl = com.tentamus.lims.core.excel.Xlsx.read(file, Js.string(Js.orBlank(body.get("file_name"))));
        String[][] cols = { { "lab", "^lab" }, { "month", "^month" }, { "plan", "^plan" }, { "revenue", "^revenue" }, { "costs", "^costs?" } };
        Map<String, String> ix = new LinkedHashMap<>();
        List<String> missing = new ArrayList<>();
        for (String[] k : cols) {
            Pattern re = Pattern.compile(k[1]);
            String h = tbl.headers().stream().filter(x -> re.matcher(x.toLowerCase(Locale.ROOT)).find()).findFirst().orElse(null);
            ix.put(k[0], h);
            if (h == null) missing.add(k[0]);
        }
        if (!missing.isEmpty()) throw new RuleException("The file needs the columns " + String.join(", ", PLAN_HEADERS) + " (missing: " + String.join(", ", missing)
            + "). Download the forecasts first and edit that file.");
        List<Map<String, Object>> stored = q("""
            SELECT s.site_code, to_char(p.month, 'YYYY-MM') AS month, p.plan, p.revenue, p.costs FROM finance_plan p JOIN lab_site s ON s.id = p.site_id
              WHERE p.site_id = ANY($1) AND p.status = 'Active'""", ids(labs));
        List<Object> out = new ArrayList<>();
        for (Map<String, Object> raw : tbl.rows()) {
            java.util.function.Function<String, String> cell = k -> { Object v = raw.get(ix.get(k)); return v == null ? "" : Js.string(v).trim(); };
            if (List.of("lab", "month", "plan", "revenue", "costs").stream().allMatch(k -> cell.apply(k).isEmpty())) continue;   // empty row
            List<String> errors = new ArrayList<>();
            Map<String, Object> row = map("row", raw.get("__row"), "site_code", cell.apply("lab").toUpperCase(Locale.ROOT), "month", cell.apply("month"), "plan", cell.apply("plan"),
                "revenue", cell.apply("revenue"), "costs", cell.apply("costs"), "errors", errors);
            String month = (String) row.get("month");
            if (month.matches("^\\d+(\\.\\d+)?$")) month = serialToDate(Double.parseDouble(month)).substring(0, 7);   // an Excel date
            if (Pattern.compile("^\\d{4}-\\d{2}-\\d{2}").matcher(month).find()) month = month.substring(0, 7);
            row.put("month", month);
            String code = (String) row.get("site_code");
            if (labs.stream().noneMatch(l -> code.equals(l.get("site_code")))) errors.add("Lab \"" + code + "\" is not one you type figures for");
            if (!month.matches("^\\d{4}-\\d{2}$")) errors.add("Month: year and month (YYYY-MM)");
            String asked = (String) row.get("plan");
            String plan = PLANS.stream().filter(p -> p.toLowerCase(Locale.ROOT).equals(asked.toLowerCase(Locale.ROOT))).findFirst().orElse(null);
            if (plan == null) errors.add("Plan: Budget forecast or Monthly forecast"); else row.put("plan", plan);
            for (String k : List.of("revenue", "costs")) {
                String t = (String) row.get(k);
                double n = jsNumber(MONEY_JUNK.matcher(t).replaceAll(""));
                if (t.isEmpty() || Double.isNaN(n) || Double.isInfinite(n) || n < 0) errors.add((k.equals("revenue") ? "Revenue" : "Costs") + ": a number, not negative");
                else row.put(k, js(n));
            }
            Map<String, Object> was = null;
            for (Map<String, Object> s : stored)
                if (code.equals(s.get("site_code")) && row.get("month").equals(s.get("month")) && row.get("plan").equals(s.get("plan"))) { was = s; break; }
            String action = !errors.isEmpty() ? "Error" : was == null ? "Create"
                : (N(was.get("revenue")) != N(row.get("revenue")) || N(was.get("costs")) != N(row.get("costs"))) ? "Update" : "No change";
            row.put("action", action);
            row.put("was", was == null ? null : map("revenue", js(N(was.get("revenue"))), "costs", js(N(was.get("costs")))));
            out.add(row);
        }
        if (out.isEmpty()) throw new RuleException("The file has no rows");
        return map("rows", out);
    }
}
