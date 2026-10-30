package com.tentamus.lims.trending.service;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.DoubleUnaryOperator;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/**
 * The trending engine (the Node backend's trending.js): the data of each source (results, QC, logbook, stability,
 * counts, Pareto), I-MR, p and c charts, the Western Electric rules, capability, the stability regression with its
 * one-sided 95 % bound, and the SVG pictures. Numbers in the SVG text are written as JavaScript writes them
 * (String(n), toFixed, toPrecision, toExponential), and exp, log10 and pow use StrictMath (fdlibm, as V8 does).
 */
@Component
public class TrendEngine {
    public static final Map<String, String> RULES = new LinkedHashMap<>();
    public static final List<String> DEFAULT_RULES = List.of("R1", "R2", "R3", "R4", "R5", "LIM");
    public record Metric(String title, String chart, boolean test) {}
    public static final Map<String, Metric> COUNT_METRICS = new LinkedHashMap<>();
    public static final Map<String, String> PARETO_METRICS = new LinkedHashMap<>();
    private static final Map<String, String> COUNT_AXIS = new LinkedHashMap<>();

    static {
        RULES.put("R1", "A point beyond 3 sigma");
        RULES.put("R2", "2 of 3 points beyond 2 sigma on the same side");
        RULES.put("R3", "4 of 5 points beyond 1 sigma on the same side");
        RULES.put("R4", "8 points in a row on the same side of the centre line");
        RULES.put("R5", "6 points in a row steadily rising or falling");
        RULES.put("LIM", "A point outside its specification or acceptance limits");
        COUNT_METRICS.put("oos_opened", new Metric("OOS investigations opened", "c", true));
        COUNT_METRICS.put("oos_rate", new Metric("OOS rate (OOS per approved test)", "p", true));
        COUNT_METRICS.put("oos_confirmed", new Metric("OOS confirmed (no assignable cause)", "c", true));
        COUNT_METRICS.put("repreps", new Metric("Re-preparations requested", "c", true));
        COUNT_METRICS.put("reanalyses", new Metric("Re-analyses (analytical runs after the first)", "c", true));
        COUNT_METRICS.put("equipment_failures", new Metric("Failed equipment checks (logbooks)", "c", false));
        COUNT_METRICS.put("excursions", new Metric("Stability chamber excursions", "c", false));
        COUNT_METRICS.put("on_time", new Metric("Tests reported on time", "p", true));
        COUNT_METRICS.put("tat_days", new Metric("Turnaround, mean days from logging to report", "i", true));
        COUNT_METRICS.put("lots_rejected", new Metric("Inventory lots rejected by QA testing", "c", false));
        PARETO_METRICS.put("oos_by_test", "OOS investigations by test");
        PARETO_METRICS.put("oos_by_outcome", "OOS investigations by outcome");
        PARETO_METRICS.put("repreps_by_test", "Re-preparations by test");
        PARETO_METRICS.put("failures_by_equipment", "Failed equipment checks by equipment");
        PARETO_METRICS.put("failures_by_logbook", "Failed logbook entries by logbook");
        COUNT_AXIS.put("oos_opened", "OOS investigations");
        COUNT_AXIS.put("oos_rate", "OOS rate");
        COUNT_AXIS.put("oos_confirmed", "OOS confirmed");
        COUNT_AXIS.put("repreps", "Re-preparations");
        COUNT_AXIS.put("reanalyses", "Re-analyses");
        COUNT_AXIS.put("equipment_failures", "Failed equipment checks");
        COUNT_AXIS.put("excursions", "Excursions");
        COUNT_AXIS.put("on_time", "Reported on time");
        COUNT_AXIS.put("tat_days", "Turnaround");
        COUNT_AXIS.put("lots_rejected", "Lots rejected");
    }

    private final Db db;

    public TrendEngine(Db db) { this.db = db; }

    // ---------------------------------------------------------------- SQL with the Node text ($1, $2...)
    private static final Pattern DOLLAR = Pattern.compile("\\$(\\d+)");

    /** Runs Node's SQL as written: each $n becomes ? with its value, so a value used twice is sent twice. */
    List<Map<String, Object>> rows(String sql, Object... vals) {
        List<Object> args = new ArrayList<>();
        Matcher m = DOLLAR.matcher(sql);
        StringBuilder b = new StringBuilder();
        while (m.find()) { args.add(vals[Integer.parseInt(m.group(1)) - 1]); m.appendReplacement(b, "?"); }
        m.appendTail(b);
        return db.rows(b.toString(), args.toArray());
    }

    Map<String, Object> one(String sql, Object... vals) {
        List<Map<String, Object>> r = rows(sql, vals);
        return r.isEmpty() ? null : r.get(0);
    }

    // ---------------------------------------------------------------- JavaScript values
    static Double dv(Object o) {
        if (o == null) return null;
        if (o instanceof Number n) return n.doubleValue();
        return Js.toNumber(o);
    }

    /** The routes' num(): null for null and "", else Number(v). */
    static Double num(Object v) { return Js.num(v); }

    static boolean truthy(Object v) { return Js.truthy(v); }

    /** A value inside a JavaScript template literal: null and absent read "null", numbers as String(n). */
    static String tpl(Object v) {
        if (v == null) return "null";
        if (v instanceof Double || v instanceof Float) return js(((Number) v).doubleValue());
        if (v instanceof Number n) return Js.number(n);
        return v.toString();
    }

    /** Number.prototype.toString() in JavaScript. */
    static String js(double v) {
        if (Double.isNaN(v)) return "NaN";
        if (Double.isInfinite(v)) return v > 0 ? "Infinity" : "-Infinity";
        if (v == 0) return "0";
        BigDecimal d = new BigDecimal(Double.toString(Math.abs(v))).stripTrailingZeros();   // Java 19+: the shortest digits, as JavaScript
        String digits = d.unscaledValue().toString();
        int k = digits.length();
        int n = d.precision() - d.scale();
        String sign = v < 0 ? "-" : "";
        if (k <= n && n <= 21) return sign + digits + "0".repeat(n - k);
        if (0 < n && n <= 21) return sign + digits.substring(0, n) + "." + digits.substring(n);
        if (-6 < n && n <= 0) return sign + "0." + "0".repeat(-n) + digits;
        int e = n - 1;
        return sign + digits.charAt(0) + (k > 1 ? "." + digits.substring(1) : "") + "e" + (e >= 0 ? "+" : "-") + Math.abs(e);
    }

    /** Number.prototype.toFixed(f) in JavaScript (the exact binary value, halves away from zero). */
    static String toFixed(double v, int f) {
        if (Double.isNaN(v)) return "NaN";
        if (Math.abs(v) >= 1e21 || Double.isInfinite(v)) return js(v);
        String s = new BigDecimal(Math.abs(v)).setScale(f, RoundingMode.HALF_UP).toPlainString();
        return (v < 0 ? "-" : "") + s;
    }

    private static String dayOf(Object d) { return truthy(d) ? left(String.valueOf(d), 10) : ""; }

    private static String left(String s, int n) { return s.length() <= n ? s : s.substring(0, n); }

    private static String axisOf(Object label, Object unit) {
        return truthy(unit) && !"count".equals(unit) ? tpl(label) + " (" + tpl(unit) + ")" : label == null ? null : label.toString();
    }

    private static Double mode(List<Double> arr) {
        Map<Double, Integer> m = new LinkedHashMap<>();
        for (Double x : arr) if (x != null && !x.isNaN()) m.merge(x, 1, Integer::sum);
        Double best = null;
        int n = 0;
        for (Map.Entry<Double, Integer> e : m.entrySet()) if (e.getValue() > n) { best = e.getKey(); n = e.getValue(); }
        return best;
    }

    private static Map<String, Object> map(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    // ---------------------------------------------------------------- data
    private static String when(String col) {
        return "(" + col + " >= COALESCE($2::date, now()::date - 365) AND " + col + " < COALESCE($3::date, now()::date) + 1)";
    }

    private static String rangeOf(Object v) { return truthy(v) ? left(Js.string(v), 10) : null; }

    Map<String, Object> sourceData(String site, String src, Map<String, Object> p) {
        String from = rangeOf(p.get("from")), to = rangeOf(p.get("to"));
        if ("results".equals(src)) {
            if (!truthy(p.get("test_id")) || !truthy(p.get("analyte_id"))) throw new RuleException("Choose a test and an analyte");
            List<Map<String, Object>> rows = rows("""
                SELECT tr.id, tr.approved_at AS t, tr.value_num AS v, tr.reported, tr.unit, tr.spec_min, tr.spec_max, tr.conformance,
                    s.id AS sample_id, s.sample_code, s.matrix, s.product, s.lot, COALESCE(c.display_name, c.legal_name) AS client_name
                  FROM test_result tr JOIN requested_test rt ON rt.id = tr.requested_test_id JOIN sample s ON s.id = rt.sample_id
                  JOIN lab_order o ON o.id = s.lab_order_id JOIN client c ON c.id = o.client_id
                  WHERE o.site_id = $1 AND tr.status = 'Active' AND tr.stage = 'Final' AND tr.result_key IS NULL AND tr.value_num IS NOT NULL
                    AND rt.test_id = $4 AND tr.analyte_id = $5 AND """ + when("tr.approved_at") + """

                    AND o.origin::text <> 'Workflow Verification' AND rt.media_lot_id IS NULL
                    AND ($6::uuid IS NULL OR o.client_id = $6) AND ($7::text IS NULL OR s.matrix = $7) AND ($8::text IS NULL OR s.product ILIKE '%' || $8 || '%')
                  ORDER BY tr.approved_at, s.sample_code""",
                site, from, to, p.get("test_id"), p.get("analyte_id"), Js.orNull(p.get("client_id")), Js.orNull(p.get("matrix")), Js.orNull(p.get("product")));
            Double lo = mode(rows.stream().map(x -> num(x.get("spec_min"))).toList());
            Double hi = mode(rows.stream().map(x -> num(x.get("spec_max"))).toList());
            Object unit = rows.isEmpty() ? null : rows.get(0).get("unit");
            if (!truthy(unit)) unit = analyteUnit(p.get("test_id"), p.get("analyte_id"));
            Object name = analyteName(p.get("analyte_id"));
            List<Map<String, Object>> pts = new ArrayList<>();
            for (Map<String, Object> x : rows) {
                List<String> sub = new ArrayList<>();
                for (String k : List.of("client_name", "product", "lot")) if (truthy(x.get(k))) sub.add(Js.string(x.get(k)));
                pts.add(map("key", x.get("id"), "t", x.get("t"), "v", num(x.get("v")), "label", x.get("sample_code"), "sub", String.join(" · ", sub),
                    "href", "#/samples/" + tpl(x.get("sample_id")), "out", "Does not conform".equals(x.get("conformance"))));
            }
            return map("unit", unit, "lsl", lo, "usl", hi, "limitsLabel", "Specification", "yLabel", axisOf(truthy(name) ? name : "Result", unit),
                "xLabel", "Date approved", "points", pts);
        }
        if ("qc".equals(src)) {
            if (!truthy(p.get("test_id"))) throw new RuleException("Choose a test");
            // approved batches in the window; a batch being reviewed (QC Review) is added at the end, before its approval
            List<Map<String, Object>> batches = new ArrayList<>(rows("""
                SELECT b.id, b.batch_code, COALESCE(b.reviewed_at, clock_timestamp()) AS reviewed_at FROM test_batch b
                  WHERE b.site_id = $1 AND b.test_id = $4 AND NOT b.is_verification
                    AND ((b.status::text = 'Approved' AND """ + when("b.reviewed_at") + """
                ) OR b.id = ANY($5::uuid[]))
                  ORDER BY COALESCE(b.reviewed_at, clock_timestamp()) DESC LIMIT 150""",
                site, from, to, p.get("test_id"), p.get("include_batches") instanceof List<?> ib ? ib : List.of()));
            java.util.Collections.reverse(batches);
            List<Map<String, Object>> pts = new ArrayList<>();
            Double lo = null, hi = null;
            for (Map<String, Object> b : batches) {
                List<Map<String, Object>> v = rows("""
                    SELECT entry_id, label, qc_type, limit_type, analyte_id, analyte_name, measured, min_value, max_value, verdict, run_no
                      FROM batch_qc_verdicts($1::uuid) WHERE ($2::text IS NULL OR qc_type = $2) AND ($3::uuid IS NULL OR analyte_id = $3)
                       AND ($4::text IS NULL OR limit_type = $4) AND measured IS NOT NULL""",
                    b.get("id"), Js.orNull(p.get("qc_type")), Js.orNull(p.get("analyte_id")), Js.orNull(p.get("limit_type")));
                for (Map<String, Object> x : v) {
                    if (lo == null && x.get("min_value") != null) lo = num(x.get("min_value"));
                    if (hi == null && x.get("max_value") != null) hi = num(x.get("max_value"));
                    double run = x.get("run_no") == null ? 0 : dv(x.get("run_no"));
                    pts.add(map("key", tpl(b.get("id")) + ":" + tpl(x.get("entry_id")) + ":" + tpl(x.get("analyte_id")) + ":" + tpl(x.get("run_no")) + ":" + tpl(x.get("limit_type")),
                        "t", b.get("reviewed_at"), "v", num(x.get("measured")), "label", tpl(b.get("batch_code")) + " " + tpl(x.get("label")),
                        "sub", Js.string(Js.orBlank(x.get("analyte_name"))) + " · " + tpl(x.get("limit_type")) + (run > 1 ? " · run " + tpl(x.get("run_no")) : ""),
                        "href", "#/testing/batches/" + tpl(b.get("id")), "out", "Fail".equals(x.get("verdict")), "batch_id", b.get("id")));
                }
            }
            // recoveries and relative differences are percentages; anything else is measured in the analyte's own unit
            Object lt = p.get("limit_type");
            boolean pct = truthy(lt) && Pattern.compile("Recovery|RPD|%", Pattern.CASE_INSENSITIVE).matcher(Js.string(lt)).find();
            Object a = p.get("analyte_id");
            Object unit = pct ? "%" : truthy(a) && !"*".equals(a) ? analyteUnit(p.get("test_id"), a) : "";
            // "Recovery %" reads "Recovery (%)" on the axis, not "Recovery % (%)"
            List<String> what = new ArrayList<>();
            Object qt = p.get("qc_type");
            if (truthy(qt) && !"*".equals(qt)) what.add(Js.string(qt));
            String l = Js.string(truthy(lt) ? lt : "QC value").replaceAll("\\s*%$", "");
            if (!l.isEmpty()) what.add(l);
            return map("unit", unit, "lsl", lo, "usl", hi, "limitsLabel", "QC limits", "points", pts, "yLabel", axisOf(String.join(" ", what), unit), "xLabel", "Batch approved");
        }
        if ("logbook".equals(src)) {
            if (!truthy(p.get("logbook_id")) || !truthy(p.get("field_key"))) throw new RuleException("Choose a logbook and a field");
            Map<String, Object> f = one("""
                SELECT f.id, f.label, f.unit FROM logbook_field f JOIN logbook_version v ON v.id = f.version_id
                  JOIN logbook l ON l.id = v.logbook_id AND l.site_id = $3
                  WHERE v.logbook_id = $1 AND f.field_key = $2 ORDER BY v.version_no DESC LIMIT 1""", p.get("logbook_id"), p.get("field_key"), site);
            List<Map<String, Object>> rows = rows("""
                SELECT e.id, e.entry_code, e.entry_at AS t, (e.entry_values->>$5::text)::numeric AS v, e.result, e.equipment_id, eq.equipment_code
                  FROM logbook_entry e LEFT JOIN equipment eq ON eq.id = e.equipment_id
                  WHERE e.site_id = $1 AND e.logbook_id = $4 AND e.status <> 'Voided' AND jsonb_typeof(e.entry_values->$5::text) = 'number' AND """ + when("e.entry_at") + """

                    AND e.sensor_kind IS DISTINCT FROM 'Excursion'
                    AND ($6::uuid IS NULL OR e.equipment_id = $6::uuid) ORDER BY e.entry_at""",
                site, from, to, p.get("logbook_id"), p.get("field_key"), Js.orNull(p.get("equipment_id")));
            Map<String, Object> lim = map("lo", null, "hi", null);
            if (f != null) {
                Object eq = Js.orNull(p.get("equipment_id"));
                if (eq == null && !rows.isEmpty()) eq = rows.get(0).get("equipment_id");
                Map<String, Object> l = one("SELECT lo, hi FROM logbook_limits($1::uuid, $2::uuid)", f.get("id"), eq);
                if (l != null) lim = l;
            }
            List<Map<String, Object>> pts = new ArrayList<>();
            for (Map<String, Object> x : rows) pts.add(map("key", x.get("id"), "t", x.get("t"), "v", num(x.get("v")), "label", x.get("entry_code"),
                "sub", Js.orBlank(x.get("equipment_code")), "href", "#/logbooks/entries/" + tpl(x.get("id")), "out", "Fail".equals(x.get("result"))));
            return map("unit", f != null ? Js.orBlank(f.get("unit")) : "", "lsl", num(lim.get("lo")), "usl", num(lim.get("hi")), "limitsLabel", "Logbook limits",
                "yLabel", axisOf(f != null ? f.get("label") : p.get("field_key"), f != null ? f.get("unit") : ""), "xLabel", "Date recorded", "points", pts);
        }
        if ("stability".equals(src)) {
            if (!truthy(p.get("study_id")) || !truthy(p.get("analyte_id"))) throw new RuleException("Choose a study and an analyte");
            List<Map<String, Object>> rows = rows("""
                SELECT tr.id, tr.value_num AS v, tr.reported, tr.unit, tr.spec_min, tr.spec_max, c.condition_id, sc.condition_name,
                    t.interval_value, t.interval_unit, sa.sample_code, sa.id AS sample_id
                  FROM test_result tr JOIN requested_test rt ON rt.id = tr.requested_test_id JOIN stability_cell c ON c.id = rt.stability_cell_id
                  JOIN stability_timepoint t ON t.id = c.timepoint_id JOIN sample sa ON sa.id = rt.sample_id LEFT JOIN stability_condition sc ON sc.id = c.condition_id
                  WHERE rt.stability_study_id = $1 AND tr.analyte_id = $2 AND tr.status = 'Active' AND tr.result_key IS NULL AND tr.value_num IS NOT NULL
                    AND rt.status <> 'Cancelled' AND NOT test_is_replaced(rt.id) AND ($3::uuid IS NULL OR rt.test_id = $3::uuid)
                    AND EXISTS (SELECT 1 FROM stability_study st WHERE st.id = rt.stability_study_id AND st.site_id = $4)""",
                p.get("study_id"), p.get("analyte_id"), Js.orNull(p.get("test_id")), site);
            Object sunit = rows.isEmpty() ? "" : Js.orBlank(rows.get(0).get("unit"));
            Object name = analyteName(p.get("analyte_id"));
            List<Map<String, Object>> pts = new ArrayList<>();
            for (Map<String, Object> x : rows) {
                double iv = Js.toNumber(x.get("interval_value"));
                Object u = x.get("interval_unit");
                double months = "Months".equals(u) ? iv : "Weeks".equals(u) ? iv * 7 / 30.44 : iv / 30.44;
                pts.add(map("key", x.get("id"), "x", months, "v", num(x.get("v")), "series", truthy(x.get("condition_id")) ? x.get("condition_id") : "T0",
                    "seriesName", truthy(x.get("condition_name")) ? x.get("condition_name") : "T0 (baseline)", "label", x.get("sample_code"),
                    "href", "#/samples/" + tpl(x.get("sample_id"))));
            }
            return map("unit", sunit, "lsl", mode(rows.stream().map(x -> num(x.get("spec_min"))).toList()), "usl", mode(rows.stream().map(x -> num(x.get("spec_max"))).toList()),
                "limitsLabel", "Specification", "yLabel", axisOf(truthy(name) ? name : "Result", sunit), "xLabel", "Months on stability", "points", pts);
        }
        if ("counts".equals(src)) return countData(site, p, from, to);
        if ("pareto".equals(src)) return paretoData(site, p, from, to);
        throw new RuleException("Unknown source");
    }

    Object analyteName(Object id) {
        if (!truthy(id) || "*".equals(id)) return null;
        Map<String, Object> r = one("SELECT analyte_name FROM analyte WHERE id = $1::uuid", id);
        return r == null ? null : Js.orNull(r.get("analyte_name"));
    }

    /** The analyte's reporting unit on the test's effective version (or any version that has it). */
    Object analyteUnit(Object test, Object analyte) {
        if (!truthy(test) || !truthy(analyte) || "*".equals(analyte)) return "";
        Map<String, Object> r = one("""
            SELECT tva.reporting_unit FROM test_version_analyte tva JOIN test_version tv ON tv.id = tva.test_version_id
              WHERE tv.test_id = $1::uuid AND tva.analyte_id = $2::uuid AND tva.reporting_unit IS NOT NULL ORDER BY (tv.status = 'Effective') DESC, tv.version_no DESC LIMIT 1""", test, analyte);
        return r == null ? "" : Js.orBlank(r.get("reporting_unit"));
    }

    private static final DateTimeFormatter MONTH = DateTimeFormatter.ofPattern("MMM yyyy", Locale.US);

    private Map<String, Object> countData(String site, Map<String, Object> p, String from, String to) {
        Object metric = p.get("metric");
        Metric m = metric == null ? null : COUNT_METRICS.get(metric.toString());
        if (m == null) throw new RuleException("Choose what to count");
        String per = "Week".equals(p.get("period")) ? "week" : "month";
        Object test = Js.orNull(p.get("test_id"));
        java.util.function.Function<String, String> B = expr -> "date_trunc('" + per + "', " + expr + ")::date";
        String series = "SELECT g::date AS period FROM generate_series(date_trunc('" + per + "', COALESCE($2::date, now()::date - 365)), date_trunc('" + per
            + "', COALESCE($3::date, now()::date)), interval '1 " + per + "') g";
        String t4 = "($4::uuid IS NULL OR rt.test_id = $4::uuid)";
        String sql = switch (metric.toString()) {
            case "oos_opened", "oos_confirmed" -> "SELECT s.period, (SELECT count(*) FROM oos_investigation x JOIN requested_test rt ON rt.id = x.requested_test_id WHERE x.site_id = $1 AND x.status <> 'Cancelled'"
                + " AND " + B.apply("x.opened_at") + " = s.period AND " + t4 + " " + ("oos_confirmed".equals(metric) ? "AND x.conclusion = 'OOS confirmed'" : "") + ")::int AS d, NULL::int AS n FROM (" + series + ") s";
            case "oos_rate" -> "SELECT s.period, (SELECT count(*) FROM oos_investigation x JOIN requested_test rt ON rt.id = x.requested_test_id WHERE x.site_id = $1 AND x.status <> 'Cancelled'"
                + " AND " + B.apply("x.opened_at") + " = s.period AND " + t4 + ")::int AS d,"
                + " (SELECT count(DISTINCT tr.requested_test_id) FROM test_result tr JOIN requested_test rt ON rt.id = tr.requested_test_id JOIN sample sa ON sa.id = rt.sample_id JOIN lab_order o ON o.id = sa.lab_order_id"
                + " WHERE o.site_id = $1 AND tr.stage = 'Final' AND " + B.apply("tr.approved_at") + " = s.period AND " + t4 + " AND o.origin::text <> 'Workflow Verification')::int AS n FROM (" + series + ") s";
            case "repreps" -> "SELECT s.period, (SELECT count(*) FROM reprep_request x JOIN requested_test rt ON rt.id = x.requested_test_id JOIN sample sa ON sa.id = rt.sample_id JOIN lab_order o ON o.id = sa.lab_order_id"
                + " WHERE o.site_id = $1 AND " + B.apply("x.created_at") + " = s.period AND " + t4 + ")::int AS d, NULL::int AS n FROM (" + series + ") s";
            case "reanalyses" -> "SELECT s.period, (SELECT count(*) FROM analytical_run x JOIN step_run sr ON sr.id = x.step_run_id JOIN test_batch b ON b.id = sr.batch_id"
                + " WHERE b.site_id = $1 AND x.run_no > 1 AND NOT b.is_verification AND " + B.apply("x.created_at") + " = s.period AND ($4::uuid IS NULL OR b.test_id = $4::uuid))::int AS d, NULL::int AS n FROM (" + series + ") s";
            case "equipment_failures" -> "SELECT s.period, (SELECT count(*) FROM logbook_entry e WHERE e.site_id = $1 AND e.result = 'Fail' AND e.status <> 'Voided' AND e.equipment_id IS NOT NULL"
                + " AND " + B.apply("e.entry_at") + " = s.period)::int AS d, NULL::int AS n FROM (" + series + ") s";
            case "excursions" -> "SELECT s.period, (SELECT count(*) FROM logbook_entry e JOIN stability_chamber ch ON ch.equipment_id = e.equipment_id WHERE e.site_id = $1 AND e.result = 'Fail' AND e.status <> 'Voided'"
                + " AND " + B.apply("e.entry_at") + " = s.period)::int AS d, NULL::int AS n FROM (" + series + ") s";
            case "on_time" -> "SELECT s.period, (SELECT count(*) FROM test_tat_view x JOIN requested_test rt ON rt.id = x.requested_test_id WHERE x.site_id = $1 AND x.on_time AND " + B.apply("x.reported_on") + " = s.period AND " + t4 + ")::int AS d,"
                + " (SELECT count(*) FROM test_tat_view x JOIN requested_test rt ON rt.id = x.requested_test_id WHERE x.site_id = $1 AND x.on_time IS NOT NULL AND " + B.apply("x.reported_on") + " = s.period AND " + t4 + ")::int AS n FROM (" + series + ") s";
            case "tat_days" -> "SELECT s.period, (SELECT round(avg(COALESCE(x.login_days, 0) + COALESCE(x.lab_days, 0) + COALESCE(x.qa_days, 0)), 2) FROM test_tat_view x JOIN requested_test rt ON rt.id = x.requested_test_id"
                + " WHERE x.site_id = $1 AND " + B.apply("x.reported_on") + " = s.period AND " + t4 + ") AS d, NULL::int AS n FROM (" + series + ") s";
            case "lots_rejected" -> "SELECT s.period, (SELECT count(*) FROM media_qualification q JOIN inventory_lot l ON l.id = q.lot_id WHERE l.site_id = $1 AND q.status = 'Failed' AND " + B.apply("q.decided_at") + " = s.period)::int AS d,"
                + " NULL::int AS n FROM (" + series + ") s";
            default -> throw new RuleException("Unknown metric");
        };
        List<Map<String, Object>> rows = rows(sql + " ORDER BY 1", site, from, to, test);
        List<Map<String, Object>> pts = new ArrayList<>();
        for (Map<String, Object> x : rows) {
            if ("i".equals(m.chart()) && x.get("d") == null) continue;
            String day = dayOf(x.get("period"));
            double n = Js.toNumber(x.get("n"));
            Object v = "p".equals(m.chart()) ? (n != 0 && !Double.isNaN(n) ? Js.toNumber(x.get("d")) / n : null) : num(x.get("d"));
            Double nn = num(x.get("n"));
            if ("p".equals(m.chart()) && !truthy(nn)) continue;
            String label = "week".equals(per) ? "Week of " + day : LocalDate.parse(day).format(MONTH);
            pts.add(map("key", day, "t", day, "v", v, "d", num(x.get("d")), "n", nn, "label", label));
        }
        String noun = COUNT_AXIS.getOrDefault(metric.toString(), m.title());
        String yLabel = "p".equals(m.chart()) ? noun + " (%)" : "i".equals(m.chart()) ? noun + " (days)" : noun + " per " + per;
        return map("unit", "p".equals(m.chart()) ? "%" : "i".equals(m.chart()) ? "days" : "count", "chart", m.chart(), "title", m.title(), "points", pts, "period", per,
            "yLabel", yLabel, "xLabel", "week".equals(per) ? "Week" : "Month");
    }

    private Map<String, Object> paretoData(String site, Map<String, Object> p, String from, String to) {
        Object metric = p.get("metric");
        String title = metric == null ? null : PARETO_METRICS.get(metric.toString());
        if (title == null) throw new RuleException("Choose what to break down");
        String q = switch (metric.toString()) {
            case "oos_by_test" -> "SELECT t.test_name AS k, count(*)::int AS n FROM oos_investigation x JOIN requested_test rt ON rt.id = x.requested_test_id JOIN test t ON t.id = rt.test_id WHERE x.site_id = $1 AND x.status <> 'Cancelled' AND " + when("x.opened_at") + " GROUP BY 1";
            case "oos_by_outcome" -> "SELECT COALESCE(CASE WHEN x.conclusion = 'Assignable cause found' THEN 'Assignable cause: ' || COALESCE(NULLIF(btrim(x.assignable_cause), ''), 'not stated') ELSE x.conclusion END, 'Open') AS k, count(*)::int AS n FROM oos_investigation x WHERE x.site_id = $1 AND x.status <> 'Cancelled' AND " + when("x.opened_at") + " GROUP BY 1";
            case "repreps_by_test" -> "SELECT t.test_name AS k, count(*)::int AS n FROM reprep_request x JOIN requested_test rt ON rt.id = x.requested_test_id JOIN test t ON t.id = rt.test_id JOIN sample sa ON sa.id = rt.sample_id JOIN lab_order o ON o.id = sa.lab_order_id WHERE o.site_id = $1 AND " + when("x.created_at") + " GROUP BY 1";
            case "failures_by_equipment" -> "SELECT eq.equipment_code || ' ' || eq.equipment_name AS k, count(*)::int AS n FROM logbook_entry e JOIN equipment eq ON eq.id = e.equipment_id WHERE e.site_id = $1 AND e.result = 'Fail' AND e.status <> 'Voided' AND " + when("e.entry_at") + " GROUP BY 1";
            default -> "SELECT l.logbook_code || ' ' || l.logbook_name AS k, count(*)::int AS n FROM logbook_entry e JOIN logbook l ON l.id = e.logbook_id WHERE e.site_id = $1 AND e.result = 'Fail' AND e.status <> 'Voided' AND " + when("e.entry_at") + " GROUP BY 1";
        };
        List<Map<String, Object>> rows = rows(q + " ORDER BY 2 DESC, 1", site, from, to);
        long total = 0;
        for (Map<String, Object> x : rows) total += ((Number) x.get("n")).longValue();
        long cum = 0;
        List<Map<String, Object>> bars = new ArrayList<>();
        for (Map<String, Object> x : rows) {
            long n = ((Number) x.get("n")).longValue();
            cum += n;
            bars.add(map("label", x.get("k"), "n", n, "cum_pct", total != 0 ? (100.0 * cum) / total : 0.0));
        }
        return map("chart", "pareto", "title", title, "unit", "count", "total", total, "yLabel", "Number in the period", "y2Label", "Cumulative (%)", "bars", bars);
    }

    // ---------------------------------------------------------------- statistics
    private static Double frozenCl(Map<String, Object> frozen) { return frozen != null && frozen.get("cl") != null ? Js.toNumber(frozen.get("cl")) : null; }

    Map<String, Object> imr(List<Double> values, Map<String, Object> frozen) {
        List<Double> v = values.stream().filter(x -> x != null && !x.isNaN()).toList();
        int n = v.size();
        Double mean = null;
        if (n > 0) { double s = 0; for (double x : v) s += x; mean = s / n; }
        List<Double> mrs = new ArrayList<>();
        for (int i = 1; i < n; i++) mrs.add(Math.abs(v.get(i) - v.get(i - 1)));
        Double mrBar = null;
        if (!mrs.isEmpty()) { double s = 0; for (double x : mrs) s += x; mrBar = s / mrs.size(); }
        Double sdOverall = null;
        if (n > 1) { double s = 0; for (double x : v) s += (x - mean) * (x - mean); sdOverall = Math.sqrt(s / (n - 1)); }
        Double sigmaWithin = mrBar != null ? mrBar / 1.128 : null;
        Double fcl = frozenCl(frozen);
        Double cl = fcl != null ? fcl : mean;
        Double sigma = frozen != null && frozen.get("sigma") != null ? Js.toNumber(frozen.get("sigma")) : sigmaWithin;
        double c0 = cl == null ? 0 : cl;   // JavaScript: null + 3 * sigma is 3 * sigma
        Map<String, Object> st = map("n", n, "mean", mean, "cl", cl, "sigma", sigma, "sigmaWithin", sigmaWithin, "sdOverall", sdOverall,
            "ucl", sigma != null ? c0 + 3 * sigma : null, "lcl", sigma != null ? c0 - 3 * sigma : null, "mrBar", mrBar, "mrUcl", mrBar != null ? 3.267 * mrBar : null,
            "mrs", mrs, "frozen", fcl != null);
        st.put("min", n > 0 ? v.stream().mapToDouble(Double::doubleValue).min().getAsDouble() : null);
        st.put("max", n > 0 ? v.stream().mapToDouble(Double::doubleValue).max().getAsDouble() : null);
        return st;
    }

    private static double or0(Object v) { Double d = dv(v); return d == null || d.isNaN() ? 0 : d; }

    Map<String, Object> attribute(List<Map<String, Object>> points, String kind, Map<String, Object> frozen) {
        Double fcl = frozenCl(frozen);
        if ("p".equals(kind)) {
            double D = 0, N = 0;
            for (Map<String, Object> x : points) D += or0(x.get("d"));
            for (Map<String, Object> x : points) N += or0(x.get("n"));
            double pbar = fcl != null ? fcl : N != 0 ? D / N : 0;
            for (Map<String, Object> x : points) {
                double s = Math.sqrt(pbar * (1 - pbar) / dv(x.get("n")));
                x.put("cl", pbar); x.put("sigma", s); x.put("ucl", Math.min(1, pbar + 3 * s)); x.put("lcl", Math.max(0, pbar - 3 * s));
            }
            return map("n", points.size(), "cl", pbar, "mean", pbar, "total", D, "of", N, "frozen", fcl != null);
        }
        double sum = 0;
        for (Map<String, Object> x : points) sum += or0(x.get("v"));
        double cbar = fcl != null ? fcl : points.isEmpty() ? 0 : sum / points.size();
        double s = Math.sqrt(cbar);
        for (Map<String, Object> x : points) { x.put("cl", cbar); x.put("sigma", s); x.put("ucl", cbar + 3 * s); x.put("lcl", Math.max(0, cbar - 3 * s)); }
        double total = 0;
        for (Map<String, Object> x : points) total += or0(x.get("v"));
        return map("n", points.size(), "cl", cbar, "mean", cbar, "sigma", s, "ucl", cbar + 3 * s, "lcl", Math.max(0, cbar - 3 * s), "total", total, "frozen", fcl != null);
    }

    /** Western Electric rules, on points carrying cl and sigma (I chart: the chart's; p and c: per point). */
    List<Map<String, Object>> signals(List<Map<String, Object>> points, List<?> rules, Map<String, Object> lim) {
        Set<Object> on = new HashSet<>(rules != null && !rules.isEmpty() ? rules : DEFAULT_RULES);
        List<Map<String, Object>> out = new ArrayList<>();
        int len = points.size();
        Double[] z = new Double[len];
        for (int i = 0; i < len; i++) {
            Map<String, Object> p = points.get(i);
            Double v = dv(p.get("v")), sg = dv(p.get("sigma"));
            if (v == null || sg == null || sg == 0 || sg.isNaN()) { z[i] = null; continue; }
            double zz = (v - or0(p.get("cl"))) / sg;
            // p and c charts whose lower limit is 0 (rare events): a run of zeros below the centre line is not a signal
            z[i] = zz < 0 && p.containsKey("lcl") && dv(p.get("lcl")) <= 0 ? 0.0 : zz;
        }
        Set<String> seen = new HashSet<>();
        java.util.function.BiConsumer<Integer, String> add = (i, rule) -> {
            if (seen.add(i + ":" + rule)) out.add(map("i", i, "rule", rule, "key", points.get(i).get("key"), "label", points.get(i).get("label"), "text", RULES.get(rule)));
        };
        Double lsl = lim == null ? null : dv(lim.get("lsl")), usl = lim == null ? null : dv(lim.get("usl"));
        for (int i = 0; i < len; i++) {
            if (z[i] == null) continue;
            if (on.contains("R1") && Math.abs(z[i]) > 3) add.accept(i, "R1");
            if (on.contains("R2") && i >= 2) for (int sg : new int[] {1, -1}) {
                int c = 0;
                for (int k = i - 2; k <= i; k++) if (z[k] != null && z[k] * sg > 2) c++;
                if (c >= 2 && z[i] * sg > 2) add.accept(i, "R2");
            }
            if (on.contains("R3") && i >= 4) for (int sg : new int[] {1, -1}) {
                int c = 0;
                for (int k = i - 4; k <= i; k++) if (z[k] != null && z[k] * sg > 1) c++;
                if (c >= 4 && z[i] * sg > 1) add.accept(i, "R3");
            }
            if (on.contains("R4") && i >= 7) for (int sg : new int[] {1, -1}) {
                boolean ok = true;
                for (int k = i - 7; k <= i; k++) if (z[k] == null || z[k] * sg <= 0) ok = false;
                if (ok) add.accept(i, "R4");
            }
            if (on.contains("R5") && i >= 5) {
                boolean up = true, dn = true;
                for (int k = i - 4; k <= i; k++) {
                    Double a = dv(points.get(k - 1).get("v")), b = dv(points.get(k).get("v"));
                    if (a == null || b == null || !(b > a)) up = false;
                    if (a == null || b == null || !(b < a)) dn = false;
                }
                if (up || dn) add.accept(i, "R5");
            }
            if (on.contains("LIM") && lim != null) {
                double v = dv(points.get(i).get("v"));
                if ((lsl != null && v < lsl) || (usl != null && v > usl) || truthy(points.get(i).get("out"))) add.accept(i, "LIM");
            }
        }
        out.sort((a, b) -> Integer.compare((Integer) a.get("i"), (Integer) b.get("i")));
        return out;
    }

    Map<String, Object> capability(Map<String, Object> st, Double lsl, Double usl) {
        if (lsl == null && usl == null) return null;
        int n = (Integer) st.get("n");
        Map<String, Object> c = map("n", n, "note", n < 20 ? "Fewer than 20 points: indicative only" : "");
        Double sw = dv(st.get("sigmaWithin")), sd = dv(st.get("sdOverall"));
        double mean = or0(st.get("mean"));
        if (sw != null && sw != 0 && !sw.isNaN()) {
            if (lsl != null && usl != null) c.put("cp", (usl - lsl) / (6 * sw));
            c.put("cpk", Math.min(usl != null ? (usl - mean) / (3 * sw) : Double.POSITIVE_INFINITY, lsl != null ? (mean - lsl) / (3 * sw) : Double.POSITIVE_INFINITY));
        }
        if (sd != null && sd != 0 && !sd.isNaN())
            c.put("ppk", Math.min(usl != null ? (usl - mean) / (3 * sd) : Double.POSITIVE_INFINITY, lsl != null ? (mean - lsl) / (3 * sd) : Double.POSITIVE_INFINITY));
        return c;
    }

    // one-sided 95 % t quantiles (df 1 to 30), then the normal value
    private static final double[] T95 = {6.314, 2.920, 2.353, 2.132, 2.015, 1.943, 1.895, 1.860, 1.833, 1.812, 1.796, 1.782, 1.771, 1.761, 1.753, 1.746, 1.740, 1.734,
        1.729, 1.725, 1.721, 1.717, 1.714, 1.711, 1.708, 1.706, 1.703, 1.701, 1.699, 1.697};

    private static double t95(int df) { return df < 1 ? 0 : df <= 30 ? T95[df - 1] : 1.645; }   // null times anything is 0 in JavaScript

    /** A fit and its confidence band (the band is drawn, never answered). */
    record Fit(Map<String, Object> data, DoubleUnaryOperator band) {}

    /**
     * Least squares per condition (T0 joins every condition), the one-sided 95 % confidence bound of the mean, and the
     * time where it crosses the specification (ICH Q1E's approach), capped at twice the longest time measured.
     */
    List<Fit> regression(List<Map<String, Object>> points, Double lsl, Double usl) {
        Set<Object> conds = new LinkedHashSet<>();
        for (Map<String, Object> p : points) if (!"T0".equals(p.get("series"))) conds.add(p.get("series"));
        List<Map<String, Object>> t0 = points.stream().filter(p -> "T0".equals(p.get("series"))).toList();
        List<Fit> out = new ArrayList<>();
        for (Object c : conds) {
            List<Map<String, Object>> ps = new ArrayList<>(t0);
            for (Map<String, Object> p : points) if (java.util.Objects.equals(p.get("series"), c)) ps.add(p);
            ps.removeIf(p -> p.get("v") == null);
            int n = ps.size();
            Object nm = null;
            for (Map<String, Object> p : points) if (java.util.Objects.equals(p.get("series"), c)) { nm = p.get("seriesName"); break; }
            Object name = truthy(nm) ? nm : c;
            if (n < 3) { out.add(new Fit(map("series", c, "name", name, "n", n, "note", "Fewer than 3 points: no regression yet"), null)); continue; }
            double sx = 0, sy = 0;
            for (Map<String, Object> p : ps) sx += dv(p.get("x"));
            for (Map<String, Object> p : ps) sy += dv(p.get("v"));
            double mx = sx / n, my = sy / n, sxx = 0;
            for (Map<String, Object> p : ps) sxx += (dv(p.get("x")) - mx) * (dv(p.get("x")) - mx);
            if (sxx == 0) { out.add(new Fit(map("series", c, "name", name, "n", n, "note", "All points at one time: no regression yet"), null)); continue; }
            double sxy = 0;
            for (Map<String, Object> p : ps) sxy += (dv(p.get("x")) - mx) * (dv(p.get("v")) - my);
            double slope = sxy / sxx, icpt = my - slope * mx;
            double sse = 0;
            for (Map<String, Object> p : ps) { double r = dv(p.get("v")) - (icpt + slope * dv(p.get("x"))); sse += r * r; }
            double se = Math.sqrt(sse / (n - 2 == 0 ? 1 : n - 2));
            double tq = t95(n - 2);
            final double fmx = mx, fsxx = sxx;
            DoubleUnaryOperator band = x -> tq * se * Math.sqrt(1.0 / n + (x - fmx) * (x - fmx) / fsxx);
            double xmax = Double.NEGATIVE_INFINITY;
            for (Map<String, Object> p : ps) xmax = Math.max(xmax, dv(p.get("x")));
            double horizon = Math.max(24, xmax * 2);
            Double shelf = null;
            String side = null;
            for (double x = 0; x <= horizon + 1e-9; x += 0.05) {
                double y = icpt + slope * x;
                if (lsl != null && y - band.applyAsDouble(x) < lsl) { shelf = x; side = "lower"; break; }
                if (usl != null && y + band.applyAsDouble(x) > usl) { shelf = x; side = "upper"; break; }
            }
            double ss = 1;   // the Node code's reduce starts at 0 || 1, so the total sum of squares is one more
            for (Map<String, Object> p : ps) ss += (dv(p.get("v")) - my) * (dv(p.get("v")) - my);
            double r2 = 1 - sse / ss;
            String note = shelf == null ? "The 95 % bound stays inside the specification to " + Math.round(horizon) + " months"
                : "The 95 % " + side + " bound reaches the specification at " + toFixed(shelf, 1) + " months";
            out.add(new Fit(map("series", c, "name", name, "n", n, "slope", slope, "intercept", icpt, "r2", r2, "se", se, "xmax", xmax, "horizon", horizon,
                "shelf", shelf, "side", side, "note", note), band));
        }
        return out;
    }

    // ---------------------------------------------------------------- the chart (data, statistics, signals, SVG)
    private static final Pattern UUIDISH = Pattern.compile("^[0-9a-f-]{36}$", Pattern.CASE_INSENSITIVE);

    @SuppressWarnings("unchecked")
    public Map<String, Object> build(String site, Map<String, Object> def) {
        Object src = def.get("source");
        Map<String, Object> p = def.get("params") instanceof Map<?, ?> m ? (Map<String, Object>) m : new LinkedHashMap<>();
        List<?> highlight = def.get("highlight") instanceof List<?> l ? l : List.of();
        Map<String, Object> q = new LinkedHashMap<>(p);
        q.put("include_batches", highlight.stream().filter(x -> x != null && UUIDISH.matcher(x.toString()).matches()).toList());
        Map<String, Object> d = sourceData(site, src == null ? null : src.toString(), q);
        Map<String, Object> out = map("source", src, "params", p, "unit", d.get("unit"), "lsl", d.get("lsl"), "usl", d.get("usl"));
        if (d.get("limitsLabel") != null) out.put("limitsLabel", d.get("limitsLabel"));
        out.put("title", truthy(def.get("title")) ? def.get("title") : truthy(d.get("title")) ? d.get("title") : "");
        out.put("yLabel", truthy(d.get("yLabel")) ? d.get("yLabel") : axisOf("Value", d.get("unit")));
        out.put("y2Label", truthy(d.get("y2Label")) ? d.get("y2Label") : null);
        out.put("xLabel", truthy(d.get("xLabel")) ? d.get("xLabel") : "Date");
        out.put("highlighted", !highlight.isEmpty());
        if ("pareto".equals(src)) {
            out.put("chart", "pareto"); out.put("bars", d.get("bars")); out.put("total", d.get("total"));
            out.put("svg", renderPareto(out));
            return out;
        }
        if ("stability".equals(src)) {
            out.put("chart", "regression");
            List<Map<String, Object>> pts = (List<Map<String, Object>>) d.get("points");
            out.put("points", pts);
            List<Fit> fits = regression(pts, (Double) out.get("lsl"), (Double) out.get("usl"));
            out.put("fits", fits.stream().map(Fit::data).toList());
            out.put("svg", renderRegression(out, fits));
            return out;
        }
        String kind = "counts".equals(src) ? (String) d.get("chart") : "i";
        out.put("chart", kind);
        if (d.get("period") != null) out.put("period", d.get("period"));
        List<Map<String, Object>> pts = new ArrayList<>(((List<Map<String, Object>>) d.get("points")).stream().filter(x -> x.get("v") != null).toList());
        Map<String, Object> frozen = def.get("frozen") instanceof Map<?, ?> fm ? (Map<String, Object>) fm : null;
        Map<String, Object> st;
        List<?> rules = def.get("rules") instanceof List<?> rl ? rl : null;
        if ("i".equals(kind)) {
            st = imr(pts.stream().map(x -> dv(x.get("v"))).toList(), frozen);
            for (Map<String, Object> x : pts) { x.put("cl", st.get("cl")); x.put("sigma", st.get("sigma")); }
            out.put("stats", st);
            out.put("capability", capability(st, (Double) out.get("lsl"), (Double) out.get("usl")));
            out.put("signals", signals(pts, rules, map("lsl", out.get("lsl"), "usl", out.get("usl"))));
        } else {
            st = attribute(pts, kind, frozen);
            out.put("stats", st);
            List<?> base = rules != null ? rules : DEFAULT_RULES;
            out.put("signals", signals(pts, base.stream().filter(r -> !"LIM".equals(r)).toList(), null));
        }
        out.put("points", pts);
        out.put("svg", renderControl(out, highlight));
        if ("i".equals(kind)) out.put("mrSvg", renderMR(out));
        out.put("hist", "i".equals(kind) && pts.size() >= 5 ? renderHistogram(out) : null);
        st.remove("mrs");
        return out;
    }

    // ---------------------------------------------------------------- SVG
    private static final String INK = "#1d2a33", MUTED = "#66737f", GRID = "#e7ecef", CL = "#1f7a52", LIM = "#b45309", WARN = "#f4ede1", ZONE = "#eef6f1",
        SPEC = "#6d28d9", PT = "#34495e", SIG = "#c0392b", HL = "#0b6e99", BAR = "#3b6e8f";

    public static String esc(Object s) {
        String t = s == null ? "" : s instanceof Number n ? tpl(n) : s.toString();
        return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    public static String fmt(Double v) { return fmt(v, 3); }

    public static String fmt(Double v, int d) {
        if (v == null || v.isNaN()) return "";
        double a = Math.abs(v);
        if (a != 0 && (a >= 1e5 || a < 1e-3)) return Js.toExponential(v, 2);
        return js(Double.parseDouble(Js.toPrecision(v, d + (a >= 100 ? 1 : 0))));
    }

    private static String s(double v) { return js(v); }

    /** Tick values; whole numbers only for counts (no "0.2 events"). */
    static List<Double> niceTicks(double lo, double hi, int n, boolean whole) {
        if (lo == hi) { lo -= 1; hi += 1; }
        double span = hi - lo, step0 = span / n, mag = StrictMath.pow(10, Math.floor(StrictMath.log10(step0))), r = step0 / mag;
        double step = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
        if (whole) step = Math.max(1, (double) Math.round(step));
        List<Double> out = new ArrayList<>();
        for (double v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.add(Double.parseDouble(Js.toPrecision(v, 12)));
        return out;
    }

    private static String frame(int W, int H, String title, String sub) {
        return "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 " + W + " " + H + "\" width=\"" + W + "\" height=\"" + H
            + "\" font-family=\"Helvetica, Arial, sans-serif\" role=\"img\" aria-label=\"" + esc(title) + "\">\n"
            + "  <rect width=\"" + W + "\" height=\"" + H + "\" fill=\"#ffffff\"/>\n"
            + "  <text x=\"16\" y=\"24\" font-size=\"15\" font-weight=\"700\" fill=\"" + INK + "\">" + esc(title) + "</text>\n"
            + "  " + (truthy(sub) ? "<text x=\"16\" y=\"42\" font-size=\"11.5\" fill=\"" + MUTED + "\">" + esc(sub) + "</text>" : "");
    }

    // the axis titles: y rotated along the left edge, centred on the plot; x centred under the tick labels
    private static String yTitle(Object text, double T, double B, double H, double x) {
        if (!truthy(text)) return "";
        String y = s((T + H - B) / 2);
        return "<text x=\"" + s(x) + "\" y=\"" + y + "\" font-size=\"11.5\" font-weight=\"600\" fill=\"" + INK + "\" text-anchor=\"middle\" transform=\"rotate(-90 " + s(x) + " " + y + ")\">" + esc(text) + "</text>";
    }

    private static String yTitle(Object text, double T, double B, double H) { return yTitle(text, T, B, H, 16); }

    private static String xTitle(Object text, double L, double R, double W, double y) {
        return truthy(text) ? "<text x=\"" + s((L + W - R) / 2) + "\" y=\"" + s(y) + "\" font-size=\"11.5\" font-weight=\"600\" fill=\"" + INK + "\" text-anchor=\"middle\">" + esc(text) + "</text>" : "";
    }

    /** An item of a chart's key, drawn as it appears on the chart (line sample, dot, ring or shaded box). */
    record KeyItem(String kind, String color, String label, Double r, String dash) {
        static KeyItem line(String color, String label, String dash) { return new KeyItem("line", color, label, null, dash); }
        static KeyItem dot(String color, double r, String label) { return new KeyItem("dot", color, label, r, null); }
    }

    private static String key(List<KeyItem> items, double x0, double y, double maxW) {
        double x = x0;
        StringBuilder b = new StringBuilder();
        for (KeyItem it : items) {
            double w = 30 + it.label().length() * 6.3 + 18;
            if (x + w > x0 + maxW) break;
            switch (it.kind()) {
                case "line" -> b.append("<line x1=\"").append(s(x)).append("\" x2=\"").append(s(x + 24)).append("\" y1=\"").append(s(y - 4)).append("\" y2=\"").append(s(y - 4))
                    .append("\" stroke=\"").append(it.color()).append("\" stroke-width=\"1.8\" ").append(it.dash() != null ? "stroke-dasharray=\"" + it.dash() + "\"" : "").append("/>");
                case "dot" -> b.append("<circle cx=\"").append(s(x + 12)).append("\" cy=\"").append(s(y - 4)).append("\" r=\"").append(s(it.r() != null ? it.r() : 4))
                    .append("\" fill=\"").append(it.color()).append("\" stroke=\"#fff\" stroke-width=\"1\"/>");
                case "ring" -> b.append("<circle cx=\"").append(s(x + 12)).append("\" cy=\"").append(s(y - 4)).append("\" r=\"3.4\" fill=\"").append(HL).append("\"/><circle cx=\"")
                    .append(s(x + 12)).append("\" cy=\"").append(s(y - 4)).append("\" r=\"7\" fill=\"none\" stroke=\"").append(HL).append("\" stroke-width=\"1.5\"/>");
                case "box" -> b.append("<rect x=\"").append(s(x + 2)).append("\" y=\"").append(s(y - 10)).append("\" width=\"20\" height=\"12\" fill=\"").append(it.color()).append("\" stroke=\"#d5dde2\"/>");
                case "bar" -> b.append("<rect x=\"").append(s(x + 4)).append("\" y=\"").append(s(y - 11)).append("\" width=\"16\" height=\"13\" fill=\"").append(it.color()).append("\" opacity=\".75\"/>");
                default -> { }
            }
            b.append("<text x=\"").append(s(x + 30)).append("\" y=\"").append(s(y)).append("\" font-size=\"11\" fill=\"").append(INK).append("\">").append(esc(it.label())).append("</text>");
            x += w;
        }
        return b.toString();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> stats(Map<String, Object> ch) { return ch.get("stats") instanceof Map<?, ?> m ? (Map<String, Object>) m : new LinkedHashMap<>(); }

    private static boolean has(Map<String, Object> ch, String k) { return ch.get(k) != null; }

    private static List<KeyItem> controlKey(Map<String, Object> ch) {
        Object src = ch.get("source"), chart = ch.get("chart");
        String what = "logbook".equals(src) ? "Reading" : "counts".equals(src) ? ("p".equals(chart) ? "Rate" : "i".equals(chart) ? "Mean" : "Count") : "qc".equals(src) ? "QC value" : "Result";
        Map<String, Object> st = stats(ch);
        List<KeyItem> it = new ArrayList<>(List.of(KeyItem.dot(PT, 3.4, what), KeyItem.dot(SIG, 4.5, "Signal"),
            KeyItem.line(CL, Boolean.TRUE.equals(st.get("frozen")) ? "Centre line (frozen)" : "Centre line", null), KeyItem.line(LIM, "Control limits (± 3 sigma)", "6 4")));
        if ("i".equals(chart) && (has(ch, "lsl") || has(ch, "usl"))) it.add(KeyItem.line(SPEC, truthy(ch.get("limitsLabel")) ? ch.get("limitsLabel").toString() : "Limits", "2 3"));
        if ("i".equals(chart) && truthy(st.get("sigma"))) {
            it.add(new KeyItem("box", ZONE, "Within 1 sigma", null, null));
            it.add(new KeyItem("box", WARN, "2 to 3 sigma", null, null));
        }
        if (Boolean.TRUE.equals(ch.get("highlighted"))) it.add(new KeyItem("ring", null, "This batch", null, null));
        return it;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> points(Map<String, Object> ch) { return (List<Map<String, Object>>) ch.get("points"); }

    private static double minOf(List<Double> l) { double m = Double.POSITIVE_INFINITY; for (double x : l) { if (Double.isNaN(x)) return x; m = Math.min(m, x); } return m; }

    private static double maxOf(List<Double> l) { double m = Double.NEGATIVE_INFINITY; for (double x : l) { if (Double.isNaN(x)) return x; m = Math.max(m, x); } return m; }

    /** a || b for numbers: 0 and NaN are false. */
    private static double or(double a, double b) { return a != 0 && !Double.isNaN(a) ? a : b; }

    @SuppressWarnings("unchecked")
    private String renderControl(Map<String, Object> ch, List<?> highlight) {
        final int W = 1000, H = 440, L = 82, R = 150, T = 58, B = 108;
        List<Map<String, Object>> pts = points(ch);
        String chart = (String) ch.get("chart");
        double pc = "p".equals(chart) ? 100 : 1;
        Map<String, Object> st = stats(ch);
        List<Double> ys = new ArrayList<>();
        for (Map<String, Object> p : pts) ys.add(dv(p.get("v")) * pc);
        if ("i".equals(chart)) { if (st.get("ucl") != null) { ys.add(dv(st.get("ucl"))); ys.add(dv(st.get("lcl"))); } }
        else for (Map<String, Object> p : pts) { ys.add(dv(p.get("ucl")) * pc); ys.add(dv(p.get("lcl")) * pc); }
        Double lsl = dv(ch.get("lsl")), usl = dv(ch.get("usl"));
        if (lsl != null) ys.add(lsl);
        if (usl != null) ys.add(usl);
        double lo0 = ys.isEmpty() ? 0 : minOf(ys), hi0 = ys.isEmpty() ? 1 : maxOf(ys);
        double pad = or(or(hi0 - lo0, Math.abs(hi0)), 1) * 0.08;
        double lo = lo0 - pad, hi = hi0 + pad;
        if (!"i".equals(chart) && lo < 0) lo = 0;
        if ("c".equals(chart) && hi < 2) hi = 2;   // a count chart always shows at least 0, 1 and 2
        final double flo = lo, fhi = hi;
        int np = pts.size();
        java.util.function.IntToDoubleFunction X = i -> L + (np <= 1 ? (W - L - R) / 2.0 : ((double) i * (W - L - R)) / (np - 1));
        DoubleUnaryOperator Y = v -> T + (H - T - B) * (1 - (v - flo) / (fhi - flo));
        Set<Object> sigSet = new HashSet<>();
        for (Map<String, Object> sg : (List<Map<String, Object>>) ch.getOrDefault("signals", List.of())) sigSet.add(sg.get("i"));
        Set<String> hl = new HashSet<>();
        for (Object h : highlight) hl.add(tpl(h));
        StringBuilder b = new StringBuilder(frame(W, H, truthy(ch.get("title")) ? ch.get("title").toString() : "Control chart", chartSub(ch)));
        Double cl = dv(st.get("cl")), sigma = dv(st.get("sigma"));
        // zones (I chart): within 1 sigma pale green, 2 to 3 sigma pale amber
        if ("i".equals(chart) && sigma != null && sigma != 0 && !sigma.isNaN()) {
            double c0 = cl == null ? 0 : cl;
            double[][] zones = {{c0 - sigma, c0 + sigma}, {c0 + 2 * sigma, c0 + 3 * sigma}, {c0 - 3 * sigma, c0 - 2 * sigma}};
            for (int zi = 0; zi < 3; zi++) {
                double[] z = zones[zi];
                String col = zi == 0 ? ZONE : WARN;
                b.append("<rect x=\"").append(L).append("\" y=\"").append(s(Y.applyAsDouble(z[1]))).append("\" width=\"").append(W - L - R).append("\" height=\"")
                    .append(s(Math.max(0, Y.applyAsDouble(z[0]) - Y.applyAsDouble(z[1])))).append("\" fill=\"").append(col).append("\"/>");
            }
        }
        for (double t : niceTicks(lo, hi, 6, "c".equals(chart)))
            b.append("<line x1=\"").append(L).append("\" x2=\"").append(W - R).append("\" y1=\"").append(s(Y.applyAsDouble(t))).append("\" y2=\"").append(s(Y.applyAsDouble(t)))
                .append("\" stroke=\"").append(GRID).append("\"/><text x=\"").append(L - 8).append("\" y=\"").append(s(Y.applyAsDouble(t) + 4))
                .append("\" font-size=\"11\" text-anchor=\"end\" fill=\"").append(MUTED).append("\">").append(esc(fmt(t))).append("</text>");
        java.util.function.Consumer<Object[]> hline = a -> {
            Double v = (Double) a[0];
            if (v == null || v.isNaN()) return;
            String dash = (String) a[2];
            b.append("<line x1=\"").append(L).append("\" x2=\"").append(W - R).append("\" y1=\"").append(s(Y.applyAsDouble(v))).append("\" y2=\"").append(s(Y.applyAsDouble(v)))
                .append("\" stroke=\"").append(a[1]).append("\" stroke-width=\"1.6\" ").append(truthy(dash) ? "stroke-dasharray=\"" + dash + "\"" : "").append("/><text x=\"")
                .append(W - R + 6).append("\" y=\"").append(s(Y.applyAsDouble(v) + 4)).append("\" font-size=\"11\" fill=\"").append(a[1]).append("\">").append(esc(a[3])).append(' ')
                .append(esc(fmt(v))).append("</text>");
        };
        if ("i".equals(chart)) {
            hline.accept(new Object[] {dv(st.get("ucl")), LIM, "6 4", "UCL"});
            hline.accept(new Object[] {cl, CL, "", "CL"});
            hline.accept(new Object[] {dv(st.get("lcl")), LIM, "6 4", "LCL"});
        } else {
            hline.accept(new Object[] {(cl == null ? 0 : cl) * pc, CL, "", "CL"});
            if (np > 0) {
                for (String k : List.of("ucl", "lcl")) {
                    StringBuilder path = new StringBuilder();
                    for (int i = 0; i < np; i++) path.append(i > 0 ? " " : "").append(i > 0 ? 'L' : 'M').append(s(X.applyAsDouble(i))).append(',').append(s(Y.applyAsDouble(dv(pts.get(i).get(k)) * pc)));
                    b.append("<path d=\"").append(path).append("\" fill=\"none\" stroke=\"").append(LIM).append("\" stroke-dasharray=\"6 4\" stroke-width=\"1.4\"/>");
                }
                double lastU = dv(pts.get(np - 1).get("ucl")) * pc;
                b.append("<text x=\"").append(W - R + 6).append("\" y=\"").append(s(Y.applyAsDouble(lastU) + 4)).append("\" font-size=\"11\" fill=\"").append(LIM).append("\">UCL ")
                    .append(esc(fmt(lastU))).append("</text>");
            }
        }
        boolean qc = "qc".equals(ch.get("source"));
        if ("i".equals(chart)) {
            hline.accept(new Object[] {usl, SPEC, "2 3", qc ? "Max" : "USL"});
            hline.accept(new Object[] {lsl, SPEC, "2 3", qc ? "Min" : "LSL"});
        }
        Object unit = ch.get("unit");
        String u = "p".equals(chart) ? " %" : truthy(unit) && !"count".equals(unit) ? " " + tpl(unit) : "";
        if (np > 0) {
            StringBuilder path = new StringBuilder();
            for (int i = 0; i < np; i++) path.append(i > 0 ? " " : "").append(i > 0 ? 'L' : 'M').append(toFixed(X.applyAsDouble(i), 1)).append(',').append(toFixed(Y.applyAsDouble(dv(pts.get(i).get("v")) * pc), 1));
            b.append("<path d=\"").append(path).append("\" fill=\"none\" stroke=\"").append(PT).append("\" stroke-width=\"1.3\" opacity=\".7\"/>");
        }
        for (int i = 0; i < np; i++) {
            Map<String, Object> p = pts.get(i);
            boolean sig = sigSet.contains(i);
            boolean h = (p.get("key") != null && hl.contains(tpl(p.get("key")))) || (truthy(p.get("batch_id")) && hl.contains(tpl(p.get("batch_id"))));
            String cx = toFixed(X.applyAsDouble(i), 1), cy = toFixed(Y.applyAsDouble(dv(p.get("v")) * pc), 1);
            String title = tpl(p.get("label")) + ": " + fmt(dv(p.get("v")) * pc, 4) + u + (truthy(p.get("sub")) ? " · " + tpl(p.get("sub")) : "")
                + (truthy(p.get("t")) ? " · " + dayOf(p.get("t")) : "");
            b.append("<circle cx=\"").append(cx).append("\" cy=\"").append(cy).append("\" r=\"").append(h ? "6" : sig ? "5" : "3.4").append("\" fill=\"")
                .append(sig ? SIG : h ? HL : PT).append("\" stroke=\"#fff\" stroke-width=\"1\"><title>").append(esc(title)).append("</title></circle>");
            if (h) b.append("<circle cx=\"").append(cx).append("\" cy=\"").append(cy).append("\" r=\"9\" fill=\"none\" stroke=\"").append(HL).append("\" stroke-width=\"1.5\"/>");
        }
        // x labels: at most 10, dates or period names
        int every = Math.max(1, (int) Math.ceil(np / 10.0));
        for (int i = 0; i < np; i++) {
            if (i % every != 0 && i != np - 1) continue;
            Map<String, Object> p = pts.get(i);
            String x = s(X.applyAsDouble(i));
            b.append("<text x=\"").append(x).append("\" y=\"").append(H - B + 18).append("\" font-size=\"10.5\" text-anchor=\"end\" transform=\"rotate(-30 ").append(x).append(' ')
                .append(H - B + 18).append(")\" fill=\"").append(MUTED).append("\">").append(esc("counts".equals(ch.get("source")) ? p.get("label") : dayOf(p.get("t")))).append("</text>");
        }
        b.append("<line x1=\"").append(L).append("\" x2=\"").append(W - R).append("\" y1=\"").append(H - B).append("\" y2=\"").append(H - B).append("\" stroke=\"#c3ccd3\"/><line x1=\"")
            .append(L).append("\" x2=\"").append(L).append("\" y1=\"").append(T).append("\" y2=\"").append(H - B).append("\" stroke=\"#c3ccd3\"/>");
        b.append(yTitle(ch.get("yLabel"), T, B, H)).append(xTitle(ch.get("xLabel"), L, R, W, H - B + 62));
        if (np == 0) b.append("<text x=\"").append(s((W - R + L) / 2.0)).append("\" y=\"").append(s((T + H - B) / 2.0))
            .append("\" text-anchor=\"middle\" font-size=\"14\" fill=\"").append(MUTED).append("\">No data in this period</text>");
        return b.append(key(controlKey(ch), 16, H - 14, W - 32)).append("</svg>").toString();
    }

    @SuppressWarnings("unchecked")
    private String renderMR(Map<String, Object> ch) {
        final int W = 1000, H = 200, L = 82, R = 150, T = 30, B = 34;
        Map<String, Object> st = stats(ch);
        List<Double> mrs = st.get("mrs") instanceof List<?> l ? (List<Double>) l : List.of();
        StringBuilder b = new StringBuilder(frame(W, H, "Moving range", ""));
        if (mrs.isEmpty()) return b.append("<text x=\"").append(s(W / 2.0)).append("\" y=\"").append(s(H / 2.0)).append("\" text-anchor=\"middle\" font-size=\"12\" fill=\"").append(MUTED)
            .append("\">Needs at least two points</text></svg>").toString();
        double mrUcl = dv(st.get("mrUcl")), mrBar = dv(st.get("mrBar"));
        List<Double> all = new ArrayList<>(mrs);
        all.add(or(mrUcl, 0));
        double hi = or(maxOf(all) * 1.1, 1);
        int n = mrs.size() + 1;
        java.util.function.IntToDoubleFunction X = i -> L + (n <= 1 ? 0 : ((double) i * (W - L - R)) / (n - 1));
        DoubleUnaryOperator Y = v -> T + (H - T - B) * (1 - v / hi);
        for (double t : niceTicks(0, hi, 3, false))
            b.append("<line x1=\"").append(L).append("\" x2=\"").append(W - R).append("\" y1=\"").append(s(Y.applyAsDouble(t))).append("\" y2=\"").append(s(Y.applyAsDouble(t)))
                .append("\" stroke=\"").append(GRID).append("\"/><text x=\"").append(L - 8).append("\" y=\"").append(s(Y.applyAsDouble(t) + 4))
                .append("\" font-size=\"10.5\" text-anchor=\"end\" fill=\"").append(MUTED).append("\">").append(esc(fmt(t))).append("</text>");
        b.append("<line x1=\"").append(L).append("\" x2=\"").append(W - R).append("\" y1=\"").append(s(Y.applyAsDouble(mrBar))).append("\" y2=\"").append(s(Y.applyAsDouble(mrBar)))
            .append("\" stroke=\"").append(CL).append("\" stroke-width=\"1.5\"/><text x=\"").append(W - R + 6).append("\" y=\"").append(s(Y.applyAsDouble(mrBar) + 4))
            .append("\" font-size=\"11\" fill=\"").append(CL).append("\">MR̄ ").append(esc(fmt(mrBar))).append("</text>");
        b.append("<line x1=\"").append(L).append("\" x2=\"").append(W - R).append("\" y1=\"").append(s(Y.applyAsDouble(mrUcl))).append("\" y2=\"").append(s(Y.applyAsDouble(mrUcl)))
            .append("\" stroke=\"").append(LIM).append("\" stroke-dasharray=\"6 4\" stroke-width=\"1.5\"/><text x=\"").append(W - R + 6).append("\" y=\"").append(s(Y.applyAsDouble(mrUcl) + 4))
            .append("\" font-size=\"11\" fill=\"").append(LIM).append("\">UCL ").append(esc(fmt(mrUcl))).append("</text>");
        StringBuilder path = new StringBuilder();
        for (int i = 0; i < mrs.size(); i++) path.append(i > 0 ? " " : "").append(i > 0 ? 'L' : 'M').append(toFixed(X.applyAsDouble(i + 1), 1)).append(',').append(toFixed(Y.applyAsDouble(mrs.get(i)), 1));
        b.append("<path d=\"").append(path).append("\" fill=\"none\" stroke=\"").append(PT).append("\" stroke-width=\"1.2\"/>");
        for (int i = 0; i < mrs.size(); i++) b.append("<circle cx=\"").append(toFixed(X.applyAsDouble(i + 1), 1)).append("\" cy=\"").append(toFixed(Y.applyAsDouble(mrs.get(i)), 1))
            .append("\" r=\"2.8\" fill=\"").append(mrs.get(i) > mrUcl ? SIG : PT).append("\"/>");
        b.append("<line x1=\"").append(L).append("\" x2=\"").append(L).append("\" y1=\"").append(T).append("\" y2=\"").append(H - B).append("\" stroke=\"#c3ccd3\"/>")
            .append(yTitle(axisOf("Moving range", ch.get("unit")), T, B, H));
        b.append(key(List.of(KeyItem.dot(PT, 3, "Difference from the point before"), KeyItem.dot(SIG, 3.5, "Above its limit"), KeyItem.line(CL, "Average moving range", null),
            KeyItem.line(LIM, "Upper limit", "6 4")), 16, H - 8, W - 32));
        return b.append("</svg>").toString();
    }

    private String renderHistogram(Map<String, Object> ch) {
        final int W = 1000, H = 270, L = 82, R = 150, T = 30, B = 64;
        List<Double> v = points(ch).stream().map(p -> dv(p.get("v"))).toList();
        Map<String, Object> st = stats(ch);
        Double lsl = dv(ch.get("lsl")), usl = dv(ch.get("usl")), lcl = dv(st.get("lcl")), ucl = dv(st.get("ucl"));
        List<Double> a = new ArrayList<>(v);
        a.add(lsl != null ? lsl : Double.POSITIVE_INFINITY);
        a.add(lcl != null ? lcl : Double.POSITIVE_INFINITY);
        double lo0 = minOf(a);
        a = new ArrayList<>(v);
        a.add(usl != null ? usl : Double.NEGATIVE_INFINITY);
        a.add(ucl != null ? ucl : Double.NEGATIVE_INFINITY);
        double hi0 = maxOf(a);
        double pad = or(hi0 - lo0, 1) * 0.05, lo = lo0 - pad, hi = hi0 + pad;
        int k = Math.max(5, Math.min(20, (int) Math.ceil(Math.sqrt(v.size())) + 2));
        double w = (hi - lo) / k;
        int[] bins = new int[k];
        for (double x : v) bins[(int) Math.min(k - 1, Math.max(0, Math.floor((x - lo) / w)))] += 1;
        int mb = 0;
        for (int c : bins) mb = Math.max(mb, c);
        double top = or(mb * 1.15, 1);
        DoubleUnaryOperator X = x -> L + ((x - lo) / (hi - lo)) * (W - L - R);
        DoubleUnaryOperator Y = c -> T + (H - T - B) * (1 - c / top);
        StringBuilder b = new StringBuilder(frame(W, H, "Distribution", ""));
        for (double t : niceTicks(0, top, 4, true))
            b.append("<line x1=\"").append(L).append("\" x2=\"").append(W - R).append("\" y1=\"").append(s(Y.applyAsDouble(t))).append("\" y2=\"").append(s(Y.applyAsDouble(t)))
                .append("\" stroke=\"").append(GRID).append("\"/><text x=\"").append(L - 8).append("\" y=\"").append(s(Y.applyAsDouble(t) + 4))
                .append("\" font-size=\"10.5\" text-anchor=\"end\" fill=\"").append(MUTED).append("\">").append(esc(fmt(t))).append("</text>");
        for (int i = 0; i < k; i++) {
            int c = bins[i];
            b.append("<rect x=\"").append(s(X.applyAsDouble(lo + i * w) + 1)).append("\" y=\"").append(s(Y.applyAsDouble(c))).append("\" width=\"")
                .append(s(Math.max(0, X.applyAsDouble(lo + (i + 1) * w) - X.applyAsDouble(lo + i * w) - 2))).append("\" height=\"").append(s(H - B - Y.applyAsDouble(c)))
                .append("\" fill=\"").append(BAR).append("\" opacity=\".75\"><title>").append(c).append("</title></rect>");
        }
        // the normal curve from the mean and the overall standard deviation
        Double sd = dv(st.get("sdOverall"));
        if (sd != null && sd != 0 && !sd.isNaN()) {
            double mean = or0(st.get("mean"));
            StringBuilder path = new StringBuilder();
            for (int i = 0; i <= 80; i++) {
                double x = lo + (i / 80.0) * (hi - lo), q = (x - mean) / sd;
                double y = (v.size() * w) * StrictMath.exp(-0.5 * (q * q)) / (sd * Math.sqrt(2 * Math.PI));
                path.append(i > 0 ? " L" : "M").append(toFixed(X.applyAsDouble(x), 1)).append(',').append(toFixed(Y.applyAsDouble(y), 1));
            }
            b.append("<path d=\"").append(path).append("\" fill=\"none\" stroke=\"").append(CL).append("\" stroke-width=\"1.6\"/>");
        }
        for (Object[] vl : new Object[][] {{lsl, "LSL"}, {usl, "USL"}}) {
            if (vl[0] == null) continue;
            double x = (Double) vl[0];
            b.append("<line x1=\"").append(s(X.applyAsDouble(x))).append("\" x2=\"").append(s(X.applyAsDouble(x))).append("\" y1=\"").append(T).append("\" y2=\"").append(H - B)
                .append("\" stroke=\"").append(SPEC).append("\" stroke-dasharray=\"3 3\" stroke-width=\"1.5\"/><text x=\"").append(s(X.applyAsDouble(x) + 3)).append("\" y=\"")
                .append(T + 10).append("\" font-size=\"10.5\" fill=\"").append(SPEC).append("\">").append(esc(vl[1])).append("</text>");
        }
        for (double t : niceTicks(lo, hi, 6, false))
            b.append("<text x=\"").append(s(X.applyAsDouble(t))).append("\" y=\"").append(H - B + 15).append("\" font-size=\"10.5\" text-anchor=\"middle\" fill=\"").append(MUTED).append("\">")
                .append(esc(fmt(t))).append("</text>");
        if (ch.get("capability") instanceof Map<?, ?> c) {
            Double cp = dv(c.get("cp")), cpk = dv(c.get("cpk")), ppk = dv(c.get("ppk"));
            b.append("<text x=\"").append(W - R + 6).append("\" y=\"").append(T + 20).append("\" font-size=\"11.5\" fill=\"").append(INK).append("\">").append(c.containsKey("cp") ? "Cp " + fmt(cp, 2) : "")
                .append("</text><text x=\"").append(W - R + 6).append("\" y=\"").append(T + 38).append("\" font-size=\"11.5\" fill=\"").append(INK).append("\">")
                .append(cpk != null && Double.isFinite(cpk) ? "Cpk " + fmt(cpk, 2) : "").append("</text><text x=\"").append(W - R + 6).append("\" y=\"").append(T + 56)
                .append("\" font-size=\"11.5\" fill=\"").append(INK).append("\">").append(ppk != null && Double.isFinite(ppk) ? "Ppk " + fmt(ppk, 2) : "").append("</text>");
        }
        b.append("<line x1=\"").append(L).append("\" x2=\"").append(W - R).append("\" y1=\"").append(H - B).append("\" y2=\"").append(H - B).append("\" stroke=\"#c3ccd3\"/><line x1=\"")
            .append(L).append("\" x2=\"").append(L).append("\" y1=\"").append(T).append("\" y2=\"").append(H - B).append("\" stroke=\"#c3ccd3\"/>");
        b.append(yTitle("Number of points", T, B, H)).append(xTitle(ch.get("yLabel"), L, R, W, H - B + 32));
        List<KeyItem> it = new ArrayList<>(List.of(new KeyItem("bar", BAR, "Points in each range", null, null), KeyItem.line(CL, "Normal curve (mean, overall SD)", null)));
        if (lsl != null || usl != null) it.add(KeyItem.line(SPEC, truthy(ch.get("limitsLabel")) ? ch.get("limitsLabel").toString() : "Limits", "3 3"));
        return b.append(key(it, 16, H - 8, W - 32)).append("</svg>").toString();
    }

    @SuppressWarnings("unchecked")
    private String renderPareto(Map<String, Object> ch) {
        final int W = 1000, H = 430, L = 82, R = 90, T = 58, B = 130;
        List<Map<String, Object>> all = (List<Map<String, Object>>) ch.get("bars");
        List<Map<String, Object>> bars = all.subList(0, Math.min(15, all.size()));
        StringBuilder b = new StringBuilder(frame(W, H, truthy(ch.get("title")) ? ch.get("title").toString() : "Pareto",
            tpl(ch.get("total")) + " in the period" + (all.size() > 15 ? " (the 15 largest shown)" : "")));
        if (bars.isEmpty()) return b.append("<text x=\"").append(s(W / 2.0)).append("\" y=\"").append(s(H / 2.0)).append("\" text-anchor=\"middle\" font-size=\"14\" fill=\"").append(MUTED)
            .append("\">Nothing in this period</text></svg>").toString();
        double mx = Double.NEGATIVE_INFINITY;
        for (Map<String, Object> x : bars) mx = Math.max(mx, dv(x.get("n")));
        double top = Math.max(2, mx * 1.1), bw = (W - L - R) / (double) bars.size();
        DoubleUnaryOperator Y = v -> T + (H - T - B) * (1 - v / top);
        DoubleUnaryOperator Yp = v -> T + (H - T - B) * (1 - v / 100);
        for (double t : niceTicks(0, top, 4, true))
            b.append("<line x1=\"").append(L).append("\" x2=\"").append(W - R).append("\" y1=\"").append(s(Y.applyAsDouble(t))).append("\" y2=\"").append(s(Y.applyAsDouble(t)))
                .append("\" stroke=\"").append(GRID).append("\"/><text x=\"").append(L - 8).append("\" y=\"").append(s(Y.applyAsDouble(t) + 4))
                .append("\" font-size=\"11\" text-anchor=\"end\" fill=\"").append(MUTED).append("\">").append(esc(fmt(t))).append("</text>");
        for (int i = 0; i < bars.size(); i++) {
            Map<String, Object> bar = bars.get(i);
            double x = L + i * bw, n = dv(bar.get("n"));
            String ns = tpl(bar.get("n")), mid = s(x + bw / 2);
            b.append("<rect x=\"").append(s(x + bw * 0.12)).append("\" y=\"").append(s(Y.applyAsDouble(n))).append("\" width=\"").append(s(bw * 0.76)).append("\" height=\"")
                .append(s(H - B - Y.applyAsDouble(n))).append("\" fill=\"").append(i < 3 ? SIG : BAR).append("\" opacity=\"").append(i < 3 ? "0.85" : "0.7").append("\"><title>")
                .append(esc(bar.get("label"))).append(": ").append(ns).append("</title></rect>")
                .append("<text x=\"").append(mid).append("\" y=\"").append(s(Y.applyAsDouble(n) - 5)).append("\" font-size=\"11\" text-anchor=\"middle\" fill=\"").append(INK).append("\">").append(ns).append("</text>")
                .append("<text x=\"").append(mid).append("\" y=\"").append(H - B + 14).append("\" font-size=\"10.5\" text-anchor=\"end\" transform=\"rotate(-35 ").append(mid).append(' ')
                .append(H - B + 14).append(")\" fill=\"").append(MUTED).append("\">").append(esc(left(tpl(bar.get("label")), 34))).append("</text>");
        }
        StringBuilder path = new StringBuilder();
        for (int i = 0; i < bars.size(); i++) path.append(i > 0 ? " " : "").append(i > 0 ? 'L' : 'M').append(toFixed(L + i * bw + bw / 2, 1)).append(',')
            .append(toFixed(Yp.applyAsDouble(dv(bars.get(i).get("cum_pct"))), 1));
        b.append("<path d=\"").append(path).append("\" fill=\"none\" stroke=\"").append(CL).append("\" stroke-width=\"2\"/>");
        for (int i = 0; i < bars.size(); i++) b.append("<circle cx=\"").append(s(L + i * bw + bw / 2)).append("\" cy=\"").append(s(Yp.applyAsDouble(dv(bars.get(i).get("cum_pct")))))
            .append("\" r=\"3\" fill=\"").append(CL).append("\"/>");
        b.append("<line x1=\"").append(L).append("\" x2=\"").append(W - R).append("\" y1=\"").append(s(Yp.applyAsDouble(80))).append("\" y2=\"").append(s(Yp.applyAsDouble(80)))
            .append("\" stroke=\"").append(CL).append("\" stroke-dasharray=\"3 4\" opacity=\".6\"/>");
        for (int t : new int[] {0, 50, 80, 100}) b.append("<text x=\"").append(W - R + 6).append("\" y=\"").append(s(Yp.applyAsDouble(t) + 4)).append("\" font-size=\"10.5\" fill=\"").append(MUTED)
            .append("\">").append(t).append(" %</text>");
        b.append("<line x1=\"").append(L).append("\" x2=\"").append(W - R).append("\" y1=\"").append(H - B).append("\" y2=\"").append(H - B).append("\" stroke=\"#c3ccd3\"/><line x1=\"")
            .append(L).append("\" x2=\"").append(L).append("\" y1=\"").append(T).append("\" y2=\"").append(H - B).append("\" stroke=\"#c3ccd3\"/>");
        b.append(yTitle(truthy(ch.get("yLabel")) ? ch.get("yLabel") : "Number", T, B, H)).append(yTitle(truthy(ch.get("y2Label")) ? ch.get("y2Label") : "Cumulative (%)", T, B, H, W - 18));
        return b.append(key(List.of(new KeyItem("bar", SIG, "The three largest", null, null), new KeyItem("bar", BAR, "Others", null, null), KeyItem.line(CL, "Cumulative share", null),
            KeyItem.line(CL, "80 % mark", "3 4")), 16, H - 14, W - 32)).append("</svg>").toString();
    }

    private static final String[] SERIES = {"#1f7a52", "#b45309", "#0b6e99", "#7c3aed", "#be185d"};

    private String renderRegression(Map<String, Object> ch, List<Fit> fits) {
        final int W = 1000, H = 430, L = 82, R = 190, T = 58, B = 82;
        List<Map<String, Object>> pts = points(ch);
        List<Double> xs = new ArrayList<>(List.of(12.0));
        for (Map<String, Object> p : pts) xs.add(dv(p.get("x")));
        for (Fit f : fits) {
            Double horizon = dv(f.data().get("horizon"));
            if (horizon == null || horizon == 0 || horizon.isNaN()) continue;
            Double shelf = dv(f.data().get("shelf"));
            xs.add(Math.min(horizon, Math.max(dv(f.data().get("xmax")) * 1.5, shelf != null && shelf != 0 ? shelf : 0)));
        }
        double xmax = maxOf(xs) * 1.02;
        List<Double> ys = new ArrayList<>();
        for (Map<String, Object> p : pts) ys.add(dv(p.get("v")));
        Double lsl = dv(ch.get("lsl")), usl = dv(ch.get("usl"));
        if (lsl != null) ys.add(lsl);
        if (usl != null) ys.add(usl);
        double lo0 = ys.isEmpty() ? 0 : minOf(ys), hi0 = ys.isEmpty() ? 1 : maxOf(ys);
        double pad = or(hi0 - lo0, 1) * 0.12, lo = lo0 - pad, hi = hi0 + pad;
        DoubleUnaryOperator X = x -> L + (x / xmax) * (W - L - R);
        DoubleUnaryOperator Y = v -> T + (H - T - B) * (1 - (v - lo) / (hi - lo));
        StringBuilder b = new StringBuilder(frame(W, H, truthy(ch.get("title")) ? ch.get("title").toString() : "Stability trend",
            "Least squares per condition with its one-sided 95 % confidence bound; shelf life where the bound meets the specification"));
        for (double t : niceTicks(lo, hi, 6, false))
            b.append("<line x1=\"").append(L).append("\" x2=\"").append(W - R).append("\" y1=\"").append(s(Y.applyAsDouble(t))).append("\" y2=\"").append(s(Y.applyAsDouble(t)))
                .append("\" stroke=\"").append(GRID).append("\"/><text x=\"").append(L - 8).append("\" y=\"").append(s(Y.applyAsDouble(t) + 4))
                .append("\" font-size=\"11\" text-anchor=\"end\" fill=\"").append(MUTED).append("\">").append(esc(fmt(t))).append("</text>");
        for (double t : niceTicks(0, xmax, 8, false))
            b.append("<text x=\"").append(s(X.applyAsDouble(t))).append("\" y=\"").append(H - B + 16).append("\" font-size=\"10.5\" text-anchor=\"middle\" fill=\"").append(MUTED).append("\">")
                .append(esc(fmt(t))).append("</text>");
        for (Object[] sp : new Object[][] {{usl, "USL"}, {lsl, "LSL"}}) {
            if (sp[0] == null) continue;
            double v = (Double) sp[0];
            b.append("<line x1=\"").append(L).append("\" x2=\"").append(W - R).append("\" y1=\"").append(s(Y.applyAsDouble(v))).append("\" y2=\"").append(s(Y.applyAsDouble(v)))
                .append("\" stroke=\"").append(SPEC).append("\" stroke-dasharray=\"2 3\" stroke-width=\"1.6\"/><text x=\"").append(W - R + 6).append("\" y=\"").append(s(Y.applyAsDouble(v) + 4))
                .append("\" font-size=\"11\" fill=\"").append(SPEC).append("\">").append(sp[1]).append(' ').append(esc(fmt(v))).append("</text>");
        }
        int leg = 0;
        Object unit = ch.get("unit");
        String u = truthy(unit) ? " " + tpl(unit) : "";
        for (int k = 0; k < fits.size(); k++) {
            Map<String, Object> f = fits.get(k).data();
            String col = SERIES[k % SERIES.length];
            Double shelf = dv(f.get("shelf"));
            boolean fitted = f.containsKey("slope");
            if (fitted) {
                double slope = dv(f.get("slope")), icpt = dv(f.get("intercept")), fx = dv(f.get("xmax"));
                double xe = Math.min(xmax, shelf != null ? Math.max(shelf, fx) : xmax);
                b.append("<line x1=\"").append(s(X.applyAsDouble(0))).append("\" y1=\"").append(s(Y.applyAsDouble(icpt))).append("\" x2=\"").append(s(X.applyAsDouble(xe))).append("\" y2=\"")
                    .append(s(Y.applyAsDouble(icpt + slope * xe))).append("\" stroke=\"").append(col).append("\" stroke-width=\"2\"/>");
                StringBuilder up = new StringBuilder(), dn = new StringBuilder();
                for (int i = 0; i <= 40; i++) {
                    double x = (i / 40.0) * xe, y = icpt + slope * x, bd = fits.get(k).band().applyAsDouble(x);
                    String pre = (i > 0 ? " L" : "M") + toFixed(X.applyAsDouble(x), 1) + ",";
                    up.append(pre).append(toFixed(Y.applyAsDouble(y + bd), 1));
                    dn.append(pre).append(toFixed(Y.applyAsDouble(y - bd), 1));
                }
                b.append("<path d=\"").append(up).append("\" fill=\"none\" stroke=\"").append(col).append("\" stroke-dasharray=\"4 3\" opacity=\".7\"/><path d=\"").append(dn)
                    .append("\" fill=\"none\" stroke=\"").append(col).append("\" stroke-dasharray=\"4 3\" opacity=\".7\"/>");
                if (shelf != null) b.append("<line x1=\"").append(s(X.applyAsDouble(shelf))).append("\" x2=\"").append(s(X.applyAsDouble(shelf))).append("\" y1=\"").append(T).append("\" y2=\"")
                    .append(H - B).append("\" stroke=\"").append(col).append("\" stroke-dasharray=\"1 3\"/><text x=\"").append(s(X.applyAsDouble(shelf) + 4)).append("\" y=\"")
                    .append(T + 12 + k * 13).append("\" font-size=\"10.5\" fill=\"").append(col).append("\">").append(esc(fmt(shelf, 3))).append(" mo</text>");
            }
            int n = ((Number) f.get("n")).intValue();
            String legend = shelf != null ? "shelf life " + toFixed(shelf, 1) + " mo" : fitted ? "within spec" : n < 3 ? "too few points" : "one time point only";
            b.append("<rect x=\"").append(W - R + 8).append("\" y=\"").append(T + 40 + leg * 34).append("\" width=\"10\" height=\"10\" fill=\"").append(col).append("\"/><text x=\"")
                .append(W - R + 22).append("\" y=\"").append(T + 49 + leg * 34).append("\" font-size=\"11\" fill=\"").append(INK).append("\">").append(esc(f.get("name")))
                .append("</text><text x=\"").append(W - R + 22).append("\" y=\"").append(T + 63 + leg * 34).append("\" font-size=\"10\" fill=\"").append(MUTED).append("\">")
                .append(esc(legend)).append("</text>");
            leg += 1;
            for (Map<String, Object> p : pts) {
                if (!java.util.Objects.equals(p.get("series"), f.get("series"))) continue;
                double px = dv(p.get("x")), pv = dv(p.get("v"));
                b.append("<circle cx=\"").append(s(X.applyAsDouble(px))).append("\" cy=\"").append(s(Y.applyAsDouble(pv))).append("\" r=\"4\" fill=\"").append(col).append("\"><title>")
                    .append(esc(tpl(p.get("label")) + ": " + fmt(pv, 4) + u + " at " + fmt(px, 3) + " months")).append("</title></circle>");
            }
        }
        for (Map<String, Object> p : pts) {
            if (!"T0".equals(p.get("series"))) continue;
            double px = dv(p.get("x")), pv = dv(p.get("v"));
            b.append("<circle cx=\"").append(s(X.applyAsDouble(px))).append("\" cy=\"").append(s(Y.applyAsDouble(pv))).append("\" r=\"4.5\" fill=\"#fff\" stroke=\"").append(INK)
                .append("\" stroke-width=\"1.5\"><title>").append(esc("T0 " + tpl(p.get("label")) + ": " + fmt(pv, 4) + u)).append("</title></circle>");
        }
        if (pts.isEmpty()) b.append("<text x=\"").append(s((W - R + L) / 2.0)).append("\" y=\"").append(s(H / 2.0)).append("\" text-anchor=\"middle\" font-size=\"14\" fill=\"").append(MUTED)
            .append("\">No results yet</text>");
        b.append("<line x1=\"").append(L).append("\" x2=\"").append(W - R).append("\" y1=\"").append(H - B).append("\" y2=\"").append(H - B).append("\" stroke=\"#c3ccd3\"/><line x1=\"")
            .append(L).append("\" x2=\"").append(L).append("\" y1=\"").append(T).append("\" y2=\"").append(H - B).append("\" stroke=\"#c3ccd3\"/>");
        b.append(yTitle(ch.get("yLabel"), T, B, H)).append(xTitle(truthy(ch.get("xLabel")) ? ch.get("xLabel") : "Months on stability", L, R, W, H - B + 38));
        List<KeyItem> it = new ArrayList<>(List.of(KeyItem.line(SERIES[0], "Trend line (colour per condition)", null), KeyItem.line(SERIES[0], "95 % confidence bound", "4 3")));
        if (lsl != null || usl != null) it.add(KeyItem.line(SPEC, "Specification", "2 3"));
        return b.append(key(it, 16, H - 14, W - 32)).append("</svg>").toString();
    }

    @SuppressWarnings("unchecked")
    private static String chartSub(Map<String, Object> ch) {
        Map<String, Object> st = stats(ch);
        String chart = (String) ch.get("chart");
        List<String> parts = new ArrayList<>();
        parts.add(switch (chart == null ? "" : chart) { case "i" -> "Individuals chart"; case "p" -> "p chart (rate per period)"; case "c" -> "c chart (count per period)"; default -> ""; });
        int n = points(ch).size();
        parts.add(n + " point" + (n == 1 ? "" : "s"));
        Object unit = ch.get("unit");
        String u = truthy(unit) && !"count".equals(unit) && !"p".equals(chart) ? " " + tpl(unit) : "";
        if ("i".equals(chart) && st.get("cl") != null) {
            if (st.get("mean") != null) parts.add("mean " + fmt(dv(st.get("mean"))) + u);
            parts.add("sigma " + fmt(dv(st.get("sigma"))) + u + (Boolean.TRUE.equals(st.get("frozen")) ? " (frozen)" : ""));
        }
        if ("p".equals(chart)) parts.add(tpl(st.get("total")) + " of " + tpl(st.get("of")) + ", " + fmt(dv(st.get("cl")) * 100) + " % overall");
        if ("c".equals(chart)) parts.add(tpl(st.get("total")) + " in all, " + fmt(dv(st.get("cl"))) + " per " + (truthy(ch.get("period")) ? ch.get("period") : "period") + " on average");
        if (ch.get("signals") instanceof List<?> sg) parts.add(sg.size() + " signal" + (sg.size() == 1 ? "" : "s"));
        return String.join(" · ", parts.stream().filter(x -> !x.isEmpty()).toList());
    }
}
