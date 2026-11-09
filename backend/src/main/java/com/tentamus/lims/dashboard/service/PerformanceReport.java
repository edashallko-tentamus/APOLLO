package com.tentamus.lims.dashboard.service;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.access.UserAccess;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.excel.Xlsx;
import com.tentamus.lims.core.excel.Xlsx.Cell;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;

/**
 * The performance report (0.35.0, GET /api/finance/report.xlsx): one workbook for a date range, a Summary a General
 * Manager or executive reads in a minute (headline by lab, by month, top clients, quality), then the raw data behind it,
 * one tab per LIMS record type with the LIMS's own column names. Revenue and costs on the Summary are SUMIFS formulas over
 * the raw tabs (cached values written too). Labs: those the person types finance for, or sees on the GM or executive board.
 */
@Service
public class PerformanceReport {
    private static final Pattern YMD = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");
    private static final Pattern DATE_KEY = Pattern.compile("(_date|_on|week_ending|^day0|^month)$");
    private static final Pattern STARTS_DATE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}.*", Pattern.DOTALL);
    private static final Pattern AT_KEY = Pattern.compile("_at$");
    private static final Pattern STARTS_TS = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}T.*", Pattern.DOTALL);
    private static final Pattern MONEY_KEY = Pattern.compile("(total|price|fee|amount|revenue|costs|^value)$");
    private static final Pattern INT_TEXT = Pattern.compile("^-?\\d+(\\.\\d+)?$");
    private static final Pattern COUNT_KEY = Pattern.compile("(days|count|late|tests|^n|_no|terms_days)$");

    private final Db db;
    private final AccessPolicy access;

    public PerformanceReport(Db db, AccessPolicy access) {
        this.db = db;
        this.access = access;
    }

    private List<Map<String, Object>> q(String sql, Object... p) { DashboardService.Sql s = DashboardService.pg(sql, p); return db.rows(s.text(), s.params()); }

    private Map<String, Object> one(String sql, Object... p) { DashboardService.Sql s = DashboardService.pg(sql, p); return db.one(s.text(), s.params()); }

    private static double N(Object v) { return DashboardService.N(v); }

    private static String isoDate(Object v) { String s = Js.string(Js.orBlank(v)); return s.substring(0, Math.min(10, s.length())); }

    private static String str(Object v) { return v == null ? null : Js.string(v); }

    /** Labs the person types finance for, or sees on the GM or executive board. */
    private List<Map<String, Object>> reportLabs(RequestContext c) {
        List<Map<String, Object>> out = new ArrayList<>();
        UserAccess a = RequestContext.isUuid(c.userId()) ? access.load(c.userId()) : null;
        for (Map<String, Object> s : q("SELECT id, site_code, site_name FROM lab_site WHERE status = 'Active' ORDER BY site_code")) {
            String id = (String) s.get("id");
            if (a != null && (a.can("finance.enter", id) || a.can("dashboard.executive", id) || a.can("dashboard.gm", id))) out.add(s);
        }
        if (out.isEmpty()) throw new RuleException("The performance report is for General Managers, the Executive and Finance groups and system administrators.");
        return out;
    }

    private static double sum(List<Map<String, Object>> rows, Function<Map<String, Object>, Object> f, Predicate<Map<String, Object>> pred) {
        double a = 0;
        for (Map<String, Object> x : rows) if (pred.test(x)) a += N(f.apply(x));
        return a;
    }

    private static double sum(List<Map<String, Object>> rows, Function<Map<String, Object>, Object> f) { return sum(rows, f, x -> true); }

    private static Double median(List<Double> arr) {
        List<Double> a = new ArrayList<>(arr.stream().filter(Double::isFinite).sorted().toList());
        if (a.isEmpty()) return null;
        int m = a.size() / 2;
        return a.size() % 2 == 1 ? a.get(m) : (a.get(m - 1) + a.get(m)) / 2;
    }

    private static long days(String a, String b) { return ChronoUnit.DAYS.between(LocalDate.parse(a), LocalDate.parse(b)) + 1; }

    private static Instant instant(Object v) {
        String s = Js.string(v);
        try { return s.length() == 10 ? LocalDate.parse(s).atStartOfDay(ZoneOffset.UTC).toInstant() : OffsetDateTime.parse(s).toInstant(); }
        catch (RuntimeException e) { return null; }
    }

    private static Double ratio(Object a, Object b) { return N(b) != 0 ? N(a) / N(b) : null; }

    private static boolean truthy(Object v) { return Js.truthy(v); }

    // ---------------------------------------------------------------- cells
    private static Cell T(Object v) { return Cell.of(v, "title"); }

    private static Cell H(Object v) { return Cell.of(v, "head"); }

    private static Cell S(Object v) { return Cell.of(v, "sub"); }

    private static Cell note(Object v) { return Cell.of(v, "note"); }

    private static Cell money(Double v, String f, boolean bold) { return Cell.formula(v == null ? null : (Object) (Math.round(v * 100) / 100.0), f, bold ? "money0b" : "money0"); }

    private static Cell money(Double v) { return money(v, null, false); }

    private static Cell pctc(Double v, String f, boolean bold) { return Cell.formula(v, f, bold ? "pctb" : "pct"); }

    private static Cell pctc(Double v) { return pctc(v, null, false); }

    private static Cell intc(Object v, boolean bold) { return Cell.of(v == null ? null : (Object) N(v), bold ? "intb" : "int"); }

    private static Cell intc(Object v) { return intc(v, false); }

    private static Cell dec(Double v, boolean bold) { return Cell.of(v == null ? null : (Object) (Math.round(v * 10) / 10.0), bold ? "decb" : "dec"); }

    /** v || null for a figure. */
    private static Double orNull(double v) { return v != 0 && !Double.isNaN(v) ? v : null; }

    private static List<Object> row(Object... cells) { return new ArrayList<>(Arrays.asList(cells)); }

    private static List<Object> heads(String... names) { List<Object> r = new ArrayList<>(); for (String n : names) r.add(H(n)); return r; }

    /** A raw tab's cell: dates, times and money typed from the LIMS column name, counts held as text made numbers. */
    private static Object cell(Object v, String k) {
        if (v == null) return null;
        String s = Js.string(v);
        if (DATE_KEY.matcher(k).find() && STARTS_DATE.matcher(s).matches()) return Cell.date(isoDate(v));
        if (AT_KEY.matcher(k).find() && STARTS_TS.matcher(s).matches()) return Cell.dateTime(s);
        if (MONEY_KEY.matcher(k).find() && !"".equals(v) && Double.isFinite(Js.toNumber(v))) return Cell.of(Js.toNumber(v), "money");
        if (v instanceof String t && INT_TEXT.matcher(t).matches() && COUNT_KEY.matcher(k).find()) return Js.toNumber(t);
        return v;
    }

    private static Xlsx.Sheet raw(String name, List<String> cols, List<Map<String, Object>> data) {
        List<List<Object>> rows = new ArrayList<>();
        rows.add(heads(cols.toArray(String[]::new)));
        for (Map<String, Object> x : data) { List<Object> r = new ArrayList<>(); for (String k : cols) r.add(cell(x.get(k), k)); rows.add(r); }
        List<Integer> widths = cols.stream().map(k -> Math.min(40, Math.max(k.length() + 2, 12))).toList();
        return new Xlsx.Sheet(name, rows, widths, 1, true, true);
    }

    /** The report for ?from=&to=&labs=: the workbook and its file name. */
    public DashboardService.Download report(RequestContext c, Map<String, String> query) {
        List<Map<String, Object>> labs = reportLabs(c);
        if (truthy(query.get("labs"))) {
            List<String> want = Arrays.stream(query.get("labs").toUpperCase().split(",", -1)).map(String::trim).toList();
            labs = labs.stream().filter(l -> want.contains(l.get("site_code"))).toList();
        }
        if (labs.isEmpty()) throw new RuleException("None of those labs is one you may report on.");
        String from = Js.string(Js.orBlank(query.get("from")));
        String to0 = Js.string(Js.orBlank(query.get("to")));
        if (!YMD.matcher(from).matches() || !YMD.matcher(to0).matches()) throw new RuleException("From and To: dates (YYYY-MM-DD)");
        if (from.compareTo(to0) > 0) throw new RuleException("From must be on or before To");
        if (ChronoUnit.DAYS.between(LocalDate.parse(from), LocalDate.parse(to0)) > 731) throw new RuleException("Choose at most two years");
        // nothing has happened after today: a period running into the future ends today (budgets are not counted ahead)
        String now = isoDate(one("SELECT site_today($1) AS d", labs.get(0).get("id")).get("d"));
        if (from.compareTo(now) > 0) throw new RuleException("From is in the future");
        String to = to0.compareTo(now) > 0 ? now : to0;
        List<Object> ids = labs.stream().map(l -> l.get("id")).toList();
        Object[] P = {ids, from, to};
        Map<String, Object> me = one("SELECT full_name FROM app_user WHERE id = $1", c.userId());

        // ---- the raw data (LIMS column names)
        List<Map<String, Object>> invoices = q("""
            SELECT i.invoice_number, i.kind, i.site_code, i.order_code, i.client_name, i.po_number, i.invoice_date, i.due_date, i.payment_terms_days,
                i.list_total, i.discount_total, i.rush_total, i.total, i.credits_number, i.catchup, i.line_count, i.sample_count, i.late_rush_count, i.issued_at, i.issued_by_name, i.sent_at, i.push_status
              FROM invoice_view i WHERE i.status = 'Issued' AND i.site_id = ANY($1) AND i.invoice_date BETWEEN $2 AND $3 ORDER BY i.invoice_date, i.invoice_number""", P);
        List<Map<String, Object>> lines = q("""
            SELECT i.invoice_number, i.site_code, i.client_name, i.invoice_date, l.line_no, l.kind, l.sample_code, l.client_sample_id, l.test_code, l.test_name,
                l.completed_on, l.due_date, l.late_days, l.list_price, l.quoted_price, l.price, l.rush_billed, l.rush_fee, l.amount, l.price_note, l.rush_note, l.line_note
              FROM invoice_line l JOIN invoice_view i ON i.id = l.invoice_id WHERE i.status = 'Issued' AND i.site_id = ANY($1) AND i.invoice_date BETWEEN $2 AND $3
              ORDER BY i.invoice_date, i.invoice_number, l.line_no""", P);
        List<Map<String, Object>> weeks = q("""
            SELECT s.site_code, w.week_ending, lims_week_revenue(w.site_id, w.week_ending) AS lims_revenue, w.costs, w.revenue AS books_revenue, w.note
              FROM finance_week w JOIN lab_site s ON s.id = w.site_id WHERE w.site_id = ANY($1) AND w.status = 'Active' AND w.week_ending BETWEEN $2 AND $3 ORDER BY w.week_ending, s.site_code""", P);
        List<Map<String, Object>> plans = q("""
            SELECT s.site_code, p.month, p.plan, p.revenue, p.costs FROM finance_plan p JOIN lab_site s ON s.id = p.site_id
              WHERE p.site_id = ANY($1) AND p.status = 'Active' AND p.month BETWEEN date_trunc('month', $2::date) AND $3 ORDER BY p.month, s.site_code, p.plan""", P);
        // the period's samples first, then the turnaround of just those (0.37.1: joining sample_tat_view worked it out for every
        // sample ever, once per row: over 10 minutes on Alex's data; asked by sample ID it takes about 2 s for a year)
        List<Map<String, Object>> samples = q("""
            SELECT s.id, s.sample_code, s.client_sample_id, ls.site_code, o.order_code, COALESCE(cl.display_name, cl.legal_name) AS client_name, s.matrix, s.received_at, s.logged_at,
                (s.logged_at AT TIME ZONE ls.time_zone)::date AS logged_on
              FROM sample s JOIN lab_order o ON o.id = s.lab_order_id JOIN lab_site ls ON ls.id = o.site_id JOIN client cl ON cl.id = o.client_id
              WHERE o.site_id = ANY($1) AND NOT cl.is_internal AND s.logged_at IS NOT NULL AND (s.logged_at AT TIME ZONE ls.time_zone)::date BETWEEN $2 AND $3
              ORDER BY s.logged_at, s.sample_code""", P);
        Map<Object, Map<String, Object>> tat = new LinkedHashMap<>();
        if (!samples.isEmpty())
            for (Map<String, Object> t : q("""
                SELECT sample_id, day0, due_date, tests, completed_on, all_reported, hold_days, on_time, days_late
                  FROM sample_tat_view WHERE sample_id = ANY($1::uuid[])""", samples.stream().map(x -> x.get("id")).toList())) tat.put(t.get("sample_id"), t);
        for (Map<String, Object> x : samples) {
            Map<String, Object> t = tat.getOrDefault(x.remove("id"), Map.of());
            for (String k : List.of("day0", "due_date", "tests", "completed_on", "all_reported", "hold_days", "on_time", "days_late")) x.put(k, t.get(k));
        }
        List<Map<String, Object>> tests = q("""
            SELECT t.sample_code, ls.site_code, t.order_code, t.test_name, d.department_name, t.is_rush, t.day0, t.due_date, t.received_at, t.logged_at, t.approved_at,
                t.reported_at, t.reported_on, t.login_days, t.lab_days, t.qa_days, t.hold_days, t.on_time, t.days_late
              FROM test_tat_view t JOIN lab_site ls ON ls.id = t.site_id LEFT JOIN department d ON d.id = t.department_id
              WHERE t.site_id = ANY($1) AND t.reported_on BETWEEN $2 AND $3 ORDER BY t.reported_at, t.sample_code""", P);
        List<Map<String, Object>> wip = q("""
            SELECT ls.site_code, w.order_code, w.sample_code, w.client_name, w.test_name, w.due_date, w.wip_state, w.value
              FROM wip_view w JOIN lab_site ls ON ls.id = w.site_id WHERE w.site_id = ANY($1) ORDER BY ls.site_code, w.due_date NULLS LAST, w.sample_code""", ids);
        List<Map<String, Object>> oos = q("""
            SELECT x.oos_code, ls.site_code, s.sample_code, a.analyte_name, x.procedure::text AS procedure, x.is_gmp, x.reported, x.unit, x.spec_text, x.status,
                x.opened_at, x.due_date, x.conclusion, x.assignable_cause, x.concluded_at, x.retest_determination, x.phase2_decision,
                (x.opened_at AT TIME ZONE ls.time_zone)::date AS opened_on
              FROM oos_investigation x JOIN lab_site ls ON ls.id = x.site_id JOIN sample s ON s.id = x.sample_id JOIN analyte a ON a.id = x.analyte_id
              WHERE x.site_id = ANY($1) AND (x.opened_at AT TIME ZONE ls.time_zone)::date BETWEEN $2 AND $3 ORDER BY x.opened_at""", P);
        List<Map<String, Object>> retests = q("""
            SELECT ls.site_code, count(*) AS n FROM requested_test rt JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id JOIN lab_site ls ON ls.id = o.site_id
              WHERE rt.retest_of_id IS NOT NULL AND o.site_id = ANY($1) AND (rt.created_at AT TIME ZONE ls.time_zone)::date BETWEEN $2 AND $3 GROUP BY ls.site_code""", P);

        // ---- the figures for the Summary
        List<String> codes = labs.stream().map(l -> (String) l.get("site_code")).toList();
        // a monthly figure counts for the share of its month inside the range (budget prorated by days)
        Function<Object, Double> share = month -> {
            String m0 = isoDate(month);
            LocalDate first = LocalDate.parse(m0.substring(0, 7) + "-01");
            String mEnd = first.withDayOfMonth(first.lengthOfMonth()).toString();
            String lo = m0.compareTo(from) > 0 ? m0 : from, hi = mEnd.compareTo(to) < 0 ? mEnd : to;
            return hi.compareTo(lo) < 0 ? 0.0 : (double) days(lo, hi) / days(m0, mEnd);
        };
        java.util.function.BiFunction<String, String, Double> budget = (lab, which) ->
            sum(plans, p -> N(p.get("revenue")) * share.apply(p.get("month")), p -> (lab == null || Objects.equals(p.get("site_code"), lab)) && which.equals(p.get("plan")));
        Function<Map<String, Object>, Double> tatDays = t -> {
            Instant a = t.get("logged_at") == null ? null : instant(t.get("logged_at")), b = t.get("reported_at") == null ? null : instant(t.get("reported_at"));
            return a != null && b != null ? (b.toEpochMilli() - a.toEpochMilli()) / 864e5 : Double.NaN;
        };

        // sheet names (the formulas refer to them)
        String shInv = "Invoices", shLines = "Invoice lines", shWeeks = "Finance weeks", shPlans = "Finance plans", shSamples = "Samples", shTests = "Tests",
            shWip = "Work in progress", shOos = "OOS investigations";
        List<String> invCols = List.of("invoice_number", "kind", "site_code", "order_code", "client_name", "po_number", "invoice_date", "due_date", "payment_terms_days", "list_total",
            "discount_total", "rush_total", "total", "credits_number", "catchup", "line_count", "sample_count", "late_rush_count", "issued_at", "issued_by_name", "sent_at", "push_status");
        List<String> weekCols = List.of("site_code", "week_ending", "lims_revenue", "costs", "books_revenue", "note");
        int nInv = invoices.size() + 1, nWk = weeks.size() + 1;

        List<List<Object>> rows = new ArrayList<>();
        rows.add(row(T("Performance report")));
        String generated = Instant.now().toString().substring(0, 16).replace('T', ' ');
        rows.add(row(note(from + " to " + to + "  ·  Labs: " + String.join(", ", codes) + "  ·  Generated " + generated + " UTC by " + (me != null ? Js.string(me.get("full_name")) : ""))));
        rows.add(row());

        // headline by lab
        rows.add(row(S("Headline by lab")));
        rows.add(heads("Lab", "Revenue (net)", "Budget", "vs budget", "Costs", "EBITDA", "EBITDA margin", "Samples logged", "Tests reported", "Samples on time", "Tests on time",
            "Median days, logged to reported", "Work in progress now", "Open OOS now"));
        int first = rows.size() + 1;
        List<Map<String, Object>> openOos;
        try {
            openOos = q("SELECT ls.site_code, count(*) AS n FROM oos_investigation x JOIN lab_site ls ON ls.id = x.site_id WHERE x.site_id = ANY($1) AND x.status NOT IN ('Closed','Cancelled') GROUP BY 1", ids);
        } catch (RuntimeException e) {
            openOos = List.of();
        }
        for (String lab : codes) {
            int rn = rows.size() + 1;
            double rev = sum(invoices, x -> x.get("total"), x -> lab.equals(x.get("site_code")));
            double bud = budget.apply(lab, "Budget forecast");
            double cost = sum(weeks, x -> x.get("costs"), x -> lab.equals(x.get("site_code")));
            boolean hasCost = weeks.stream().anyMatch(x -> lab.equals(x.get("site_code")));
            List<Map<String, Object>> sm = samples.stream().filter(x -> lab.equals(x.get("site_code"))).toList();
            List<Map<String, Object>> smDone = sm.stream().filter(x -> truthy(x.get("all_reported")) && x.get("on_time") != null).toList();
            List<Map<String, Object>> ts = tests.stream().filter(x -> lab.equals(x.get("site_code"))).toList();
            double wipV = sum(wip, x -> x.get("value"), x -> lab.equals(x.get("site_code")));
            boolean hasBud = bud != 0 && !Double.isNaN(bud);
            rows.add(row(lab,
                money(rev, sumifs(shInv, invCols, nInv, "total", "site_code", lab), false),
                money(orNull(bud)),
                pctc(hasBud ? rev / bud - 1 : null, hasBud ? "IF(C" + rn + "=0,\"\",B" + rn + "/C" + rn + "-1)" : null, false),
                money(hasCost ? cost : null, hasCost ? sumifs(shWeeks, weekCols, nWk, "costs", "site_code", lab) : null, false),
                money(hasCost ? rev - cost : null, hasCost ? "B" + rn + "-E" + rn : null, false),
                pctc(hasCost && rev != 0 ? (rev - cost) / rev : null, hasCost ? "IF(B" + rn + "=0,\"\",F" + rn + "/B" + rn + ")" : null, false),
                intc(sm.size()), intc(ts.size()),
                pctc(ratio(smDone.stream().filter(x -> truthy(x.get("on_time"))).count(), smDone.size())),
                pctc(ratio(ts.stream().filter(x -> truthy(x.get("on_time"))).count(), ts.size())),
                dec(median(ts.stream().map(tatDays).toList()), false),
                money(wipV), intc(N(openOos.stream().filter(x -> lab.equals(x.get("site_code"))).findFirst().map(x -> x.get("n")).orElse(null)))));
        }
        int last = rows.size();
        if (codes.size() > 1) {
            int rn = rows.size() + 1;
            Function<String, String> col = k -> "SUM(" + k + first + ":" + k + last + ")";
            double rev = sum(invoices, x -> x.get("total")), bud = budget.apply(null, "Budget forecast"), cost = sum(weeks, x -> x.get("costs"));
            boolean hasBud = bud != 0 && !Double.isNaN(bud), wk = !weeks.isEmpty();
            List<Map<String, Object>> smDone = samples.stream().filter(x -> truthy(x.get("all_reported")) && x.get("on_time") != null).toList();
            rows.add(row(Cell.of("All labs", "bold"), money(rev, col.apply("B"), true), money(orNull(bud), col.apply("C"), true),
                pctc(hasBud ? rev / bud - 1 : null, "IF(C" + rn + "=0,\"\",B" + rn + "/C" + rn + "-1)", true),
                money(wk ? cost : null, wk ? col.apply("E") : null, true), money(wk ? rev - cost : null, wk ? "B" + rn + "-E" + rn : null, true),
                pctc(wk && rev != 0 ? (rev - cost) / rev : null, wk ? "IF(B" + rn + "=0,\"\",F" + rn + "/B" + rn + ")" : null, true),
                intc(samples.size(), true), intc(tests.size(), true), pctc(ratio(smDone.stream().filter(x -> truthy(x.get("on_time"))).count(), smDone.size()), null, true),
                pctc(ratio(tests.stream().filter(x -> truthy(x.get("on_time"))).count(), tests.size()), null, true), dec(median(tests.stream().map(tatDays).toList()), true),
                money(sum(wip, x -> x.get("value")), col.apply("M"), true), intc(sum(openOos, x -> x.get("n")), true)));
        }
        rows.add(row());

        // by month
        rows.add(row(S("By month")));
        rows.add(heads("Month", "Revenue (net)", "Budget", "vs budget", "Monthly forecast", "Costs", "EBITDA", "EBITDA margin", "Samples logged", "Samples on time", "Tests reported", "Tests on time"));
        List<String> months = new ArrayList<>();
        for (LocalDate d = LocalDate.parse(from.substring(0, 7) + "-01"); d.toString().compareTo(to) <= 0; d = d.plusMonths(1)) months.add(d.toString().substring(0, 7));
        for (String m : months) {
            int rn = rows.size() + 1;
            Predicate<Object> inM = v -> truthy(v) && isoDate(v).startsWith(m) && isoDate(v).length() >= 7;
            double rev = sum(invoices, x -> x.get("total"), x -> inM.test(x.get("invoice_date")));
            double bud = sum(plans, p -> N(p.get("revenue")) * share.apply(p.get("month")), p -> "Budget forecast".equals(p.get("plan")) && inM.test(p.get("month")));
            double fc = sum(plans, p -> N(p.get("revenue")) * share.apply(p.get("month")), p -> "Monthly forecast".equals(p.get("plan")) && inM.test(p.get("month")));
            List<Map<String, Object>> wk = weeks.stream().filter(x -> inM.test(x.get("week_ending"))).toList();
            double cost = sum(wk, x -> x.get("costs"));
            List<Map<String, Object>> sm = samples.stream().filter(x -> inM.test(x.get("logged_on"))).toList();
            List<Map<String, Object>> smDone = sm.stream().filter(x -> truthy(x.get("all_reported")) && x.get("on_time") != null).toList();
            List<Map<String, Object>> ts = tests.stream().filter(x -> inM.test(x.get("reported_on"))).toList();
            boolean hasBud = bud != 0 && !Double.isNaN(bud), hasWk = !wk.isEmpty();
            rows.add(row(m, money(rev), money(orNull(bud)), pctc(hasBud ? rev / bud - 1 : null, hasBud ? "IF(C" + rn + "=0,\"\",B" + rn + "/C" + rn + "-1)" : null, false), money(orNull(fc)),
                money(hasWk ? cost : null), money(hasWk ? rev - cost : null, hasWk ? "B" + rn + "-F" + rn : null, false),
                pctc(hasWk && rev != 0 ? (rev - cost) / rev : null, hasWk ? "IF(B" + rn + "=0,\"\",G" + rn + "/B" + rn + ")" : null, false),
                intc(sm.size()), pctc(ratio(smDone.stream().filter(x -> truthy(x.get("on_time"))).count(), smDone.size())), intc(ts.size()),
                pctc(ratio(ts.stream().filter(x -> truthy(x.get("on_time"))).count(), ts.size()))));
        }
        rows.add(row());

        // top clients
        rows.add(row(S("Top 10 clients by revenue")));
        rows.add(heads("Client", "Revenue (net)", "Share of revenue", "Invoices", "Samples logged"));
        Map<Object, double[]> byClient = new LinkedHashMap<>();
        for (Map<String, Object> x : invoices) {
            double[] o = byClient.computeIfAbsent(x.get("client_name"), k -> new double[2]);
            o[0] += N(x.get("total"));
            if ("Invoice".equals(str(x.get("kind")))) o[1] += 1;
        }
        double totalRev = sum(invoices, x -> x.get("total"));
        List<Map.Entry<Object, double[]>> top = new ArrayList<>(byClient.entrySet());
        top.sort((a, b) -> Double.compare(b.getValue()[0], a.getValue()[0]));
        if (top.size() > 10) top = top.subList(0, 10);
        if (top.isEmpty()) rows.add(row(note("No invoices issued in this period.")));
        for (Map.Entry<Object, double[]> e : top) {
            rows.add(row(e.getKey(), money(e.getValue()[0]), pctc(totalRev != 0 ? e.getValue()[0] / totalRev : null), intc(e.getValue()[1]),
                intc(samples.stream().filter(x -> Objects.equals(x.get("client_name"), e.getKey())).count())));
        }
        rows.add(row());

        // quality
        rows.add(row(S("Quality and timeliness")));
        rows.add(heads("Lab", "OOS opened", "OOS confirmed", "Assignable cause found", "Retests ordered", "Tests reported late", "Average days late (late tests)", "Rush tests reported"));
        for (String lab : codes) {
            List<Map<String, Object>> ox = oos.stream().filter(x -> lab.equals(x.get("site_code"))).toList();
            List<Map<String, Object>> late = tests.stream().filter(x -> lab.equals(x.get("site_code")) && Boolean.FALSE.equals(x.get("on_time"))).toList();
            rows.add(row(lab, intc(ox.size()), intc(ox.stream().filter(x -> "OOS confirmed".equals(x.get("conclusion"))).count()),
                intc(ox.stream().filter(x -> "Assignable cause found".equals(x.get("conclusion"))).count()),
                intc(N(retests.stream().filter(x -> lab.equals(x.get("site_code"))).findFirst().map(x -> x.get("n")).orElse(null))), intc(late.size()),
                dec(late.isEmpty() ? null : sum(late, x -> x.get("days_late")) / late.size(), false),
                intc(tests.stream().filter(x -> lab.equals(x.get("site_code")) && truthy(x.get("is_rush"))).count())));
        }
        rows.add(row());

        // definitions
        rows.add(row(S("How each figure is worked out")));
        for (String d : List.of(
            "Revenue (net): invoices issued in the period less credit notes issued in the period (Invoices tab, column total). The formula in each lab row adds that column for the lab.",
            "Budget: the lab's Budget forecast for each month (Finance plans tab), counted for the days of the month inside the period.",
            "Costs: the weekly costs Finance types (Finance weeks tab), weeks ending inside the period. EBITDA = Revenue (net) less Costs; blank where no costs were typed.",
            "Samples logged: client samples logged in the period (Samples tab; internal QA, media and training samples left out).",
            "Samples on time: of those samples with every test reported, the share whose complete report came by the latest due date (client On Hold days added).",
            "Tests reported: tests whose first COA was issued in the period (Tests tab). Tests on time: reported by their own due date, On Hold days added.",
            "Median days, logged to reported: calendar days from logging the sample to the test's first issued COA.",
            "Work in progress now and Open OOS now: as of the moment the report was made, whatever the period (Work in progress tab).",
            "Every other tab is the LIMS data behind these figures, with the LIMS column names, so it can be filtered, pivoted or checked.")) rows.add(row(note(d)));

        // ---- the raw tabs
        List<String> lineCols = List.of("invoice_number", "site_code", "client_name", "invoice_date", "line_no", "kind", "sample_code", "client_sample_id", "test_code", "test_name",
            "completed_on", "due_date", "late_days", "list_price", "quoted_price", "price", "rush_billed", "rush_fee", "amount", "price_note", "rush_note", "line_note");
        List<String> planCols = List.of("site_code", "month", "plan", "revenue", "costs");
        List<String> sampleCols = List.of("sample_code", "client_sample_id", "site_code", "order_code", "client_name", "matrix", "received_at", "logged_at", "day0", "due_date", "tests",
            "completed_on", "all_reported", "hold_days", "on_time", "days_late");
        List<String> testCols = List.of("sample_code", "site_code", "order_code", "test_name", "department_name", "is_rush", "day0", "due_date", "received_at", "logged_at", "approved_at",
            "reported_at", "reported_on", "login_days", "lab_days", "qa_days", "hold_days", "on_time", "days_late");
        List<String> wipCols = List.of("site_code", "order_code", "sample_code", "client_name", "test_name", "due_date", "wip_state", "value");
        List<String> oosCols = List.of("oos_code", "site_code", "sample_code", "analyte_name", "procedure", "is_gmp", "reported", "unit", "spec_text", "status", "opened_at", "due_date",
            "conclusion", "assignable_cause", "concluded_at", "retest_determination", "phase2_decision");
        Xlsx.Sheet summary = new Xlsx.Sheet("Summary", rows, List.of(26, 15, 14, 11, 15, 14, 13, 13, 13, 13, 13, 16, 17, 12), 0, false, false);
        byte[] buf = Xlsx.writeWorkbook(List.of(summary, raw(shInv, invCols, invoices), raw(shLines, lineCols, lines), raw(shWeeks, weekCols, weeks), raw(shPlans, planCols, plans),
            raw(shSamples, sampleCols, samples), raw(shTests, testCols, tests), raw(shWip, wipCols, wip), raw(shOos, oosCols, oos)));
        return new DashboardService.Download(buf, "Performance " + String.join("-", codes) + " " + from + " to " + to + ".xlsx");
    }

    /** SUMIFS over a raw tab's column for one lab (the range at least row 2). */
    static String sumifs(String sheet, List<String> cols, int n, String valueCol, String labCol, String lab) {
        String v = Xlsx.colName(cols.indexOf(valueCol)), l = Xlsx.colName(cols.indexOf(labCol));
        int end = Math.max(2, n);
        return "SUMIFS('" + sheet + "'!$" + v + "$2:$" + v + "$" + end + ",'" + sheet + "'!$" + l + "$2:$" + l + "$" + end + ",\"" + lab + "\")";
    }
}
