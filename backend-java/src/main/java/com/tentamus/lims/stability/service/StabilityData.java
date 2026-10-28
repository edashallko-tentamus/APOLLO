package com.tentamus.lims.stability.service;

import static com.tentamus.lims.core.web.Answers.map;

import com.fasterxml.jackson.databind.JsonNode;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.web.RuleException;
import java.text.Collator;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The data behind a stability quote and a study, as the Node backend's stability.js builds it: a version's design (plan,
 * conditions, timepoints with their planned dates, lines, cells, problems), the price per study year and the cumulative
 * report's data (per condition, one table per test: analytes down, timepoints across). The quotation PDF and the report
 * PDFs (quoteHtml, reportHtml, reportPdf) need headless Chromium and stay in Node.
 */
public final class StabilityData {
    private static final Pattern ISO = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}");
    private static final Collator COLLATOR = Collator.getInstance(Locale.ENGLISH);

    private StabilityData() {}

    /** A computed number as JavaScript writes it in JSON (100, not 100.0). */
    static Object jsNum(double v) {
        return v == Math.rint(v) && !Double.isInfinite(v) && Math.abs(v) < 9e15 ? (Object) (long) v : (Object) v;
    }

    static double num(Object v) { return Js.toNumber(v); }

    private static String iso(Object d) {
        Matcher m = ISO.matcher(d == null ? "" : d.toString());
        return m.find() ? m.group() : "";
    }

    /** JavaScript Date setUTCMonth / setUTCDate: a day past the month's end runs into the next month (Jan 31 + 1 month = Mar 3). */
    static String addInterval(String base, Object n, Object unit) {
        LocalDate d = LocalDate.parse(base);
        double v = num(n);
        if ("Months".equals(unit)) return d.withDayOfMonth(1).plusMonths((long) v).plusDays(d.getDayOfMonth() - 1L).toString();
        return d.plusDays((long) (v * ("Weeks".equals(unit) ? 7 : 1))).toString();
    }

    /** The design of one version (and the planned dates when a placement date is planned). */
    public static Map<String, Object> design(Db db, Object vid) {
        Map<String, Object> plan = db.one("""
            SELECT pl.*, s.site_code, s.site_name, s.stability_pull_window_days, s.stability_reserve_pct FROM stability_plan pl JOIN lab_site s ON s.id = pl.site_id
             WHERE pl.project_version_id = ?::uuid""", vid);
        List<Map<String, Object>> conditions = db.rows("""
            SELECT vc.id, vc.condition_id, vc.sort_order, sc.condition_name, sc.condition_type, sc.temperature_c, sc.humidity_pct
              FROM stability_version_condition vc JOIN stability_condition sc ON sc.id = vc.condition_id WHERE vc.project_version_id = ?::uuid AND vc.status = 'Active'
             ORDER BY vc.sort_order, sc.sort_order, sc.condition_name""", vid);
        List<Map<String, Object>> timepoints = db.rows("""
            SELECT * FROM stability_timepoint WHERE project_version_id = ?::uuid AND status = 'Active'
             ORDER BY CASE interval_unit WHEN 'Days' THEN interval_value WHEN 'Weeks' THEN interval_value * 7 ELSE interval_value * 30.4 END, label""", vid);
        List<Map<String, Object>> lines = db.rows("""
            SELECT q.id, q.test_id, q.quantity, q.list_price, q.final_price, q.line_total, q.discount_pct, t.test_code, t.test_name, t.site_id AS test_site_id,
                e.pricing_mode, e.standard_tat, e.tat_unit,
                EXISTS (SELECT 1 FROM test_version v WHERE v.test_id = q.test_id AND v.status = 'Effective') AS has_effective,
                (SELECT max(c.units_required) FROM stability_cell c WHERE c.line_id = q.id AND c.status = 'Active') AS units
              FROM quoted_test_configuration q JOIN test t ON t.id = q.test_id JOIN test_catalog_entry e ON e.test_id = t.id
             WHERE q.project_version_id = ?::uuid AND q.status = 'Active' ORDER BY t.test_name""", vid);
        List<Map<String, Object>> cells = db.rows("SELECT id, line_id, timepoint_id, condition_id, units_required FROM stability_cell WHERE project_version_id = ?::uuid AND status = 'Active'", vid);
        List<Map<String, Object>> problems = db.rows("SELECT * FROM stability_quote_problems(?::uuid)", vid);
        if (plan != null && plan.get("planned_placement") != null) {
            String base = iso(plan.get("planned_placement"));
            for (Map<String, Object> t : timepoints) {
                boolean zero = num(t.get("interval_value")) == 0;
                String planned = zero ? base : addInterval(base, t.get("interval_value"), t.get("interval_unit"));
                if (num(t.get("interval_value")) > 0) {
                    Map<String, Object> adj = db.one("SELECT stability_adjust_date(?::uuid, ?::date, ?, ?) AS d", plan.get("site_id"), planned, t.get("days_early"), t.get("days_late"));
                    planned = iso(adj.get("d"));
                }
                t.put("planned_date", planned);
            }
        }
        return map("plan", plan, "conditions", conditions, "timepoints", timepoints, "lines", lines, "cells", cells, "problems", problems);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> list(Map<String, Object> d, String key) { return (List<Map<String, Object>>) d.get(key); }

    private static Map<String, Object> byId(List<Map<String, Object>> rows, Object id) {
        for (Map<String, Object> r : rows) if (Objects.equals(r.get("id"), id)) return r;
        return null;
    }

    /** The price of the study, per year (escalation compounded on each anniversary of acceptance). */
    @SuppressWarnings("unchecked")
    public static List<Map<String, Object>> priceByYear(Map<String, Object> d) {
        Map<String, Object> plan = (Map<String, Object>) d.get("plan");
        Object e = plan == null ? null : plan.get("escalation_pct");
        double esc = num(Js.truthy(e) ? e : 0);
        Map<Integer, double[]> years = new java.util.TreeMap<>();
        for (Map<String, Object> c : list(d, "cells")) {
            Map<String, Object> tp = byId(list(d, "timepoints"), c.get("timepoint_id"));
            Map<String, Object> l = byId(list(d, "lines"), c.get("line_id"));
            if (tp == null || l == null) continue;
            double v = num(tp.get("interval_value"));
            double months = "Months".equals(tp.get("interval_unit")) ? v : "Weeks".equals(tp.get("interval_unit")) ? v * 7 / 30.44 : v / 30.44;
            int y = (int) Math.max(1, Math.floor(months / 12 + 1e-9) + 1);
            Object fp = l.get("final_price");
            double price = Math.round(num(Js.truthy(fp) ? fp : 0) * Math.pow(1 + esc / 100, y - 1) * 100) / 100.0;
            double[] cur = years.computeIfAbsent(y, k -> new double[2]);
            cur[0] += 1;
            cur[1] += price;
        }
        List<Map<String, Object>> out = new ArrayList<>();
        years.forEach((y, v) -> out.add(map("year", y, "tests", (long) v[0], "total", jsNum(v[1]))));
        return out;
    }

    // ---------------------------------------------------------------- the cumulative report
    private static String tpKey(Map<String, Object> t) {
        double v = num(t.get("interval_value"));
        return v == 0 ? "T0" : Js.number(v) + "|" + t.get("interval_unit");
    }

    private static double tpDays(Object value, Object unit) {
        double v = num(value);
        if (v == 0) return 0;
        return "Days".equals(unit) ? v : "Weeks".equals(unit) ? v * 7 : v * 30.4;
    }

    private static Object or(Object a, Object b) { return Js.truthy(a) ? a : b; }

    /** The report's data: issued = only finalized results; otherwise every approved result, preliminary ones marked. */
    public static Map<String, Object> reportData(Db db, Object studyId, boolean issued) {
        Map<String, Object> st = db.one("SELECT * FROM stability_study_view WHERE id = ?::uuid", studyId);
        if (st == null) throw new RuleException("Study not found");
        Map<String, Object> d = design(db, st.get("project_version_id"));
        List<Map<String, Object>> rows = db.rows("""
            SELECT rt.id AS requested_test_id, rt.test_id, t.test_name, rt.stability_pull_id, tp.interval_value, tp.interval_unit, tp.label AS tp_label, c.condition_id,
                test_is_finalized(rt.id) AS finalized, tr.id AS result_id, tr.analyte_id, a.analyte_name, tr.reported, tr.unit, tr.stage, tr.conformance,
                sp.min_value, sp.max_value, sp.text_value, sp.unit AS spec_unit, sa.sample_code
              FROM requested_test rt JOIN test t ON t.id = rt.test_id JOIN stability_cell c ON c.id = rt.stability_cell_id JOIN stability_timepoint tp ON tp.id = c.timepoint_id
              JOIN sample sa ON sa.id = rt.sample_id
              LEFT JOIN test_result tr ON tr.requested_test_id = rt.id AND tr.status = 'Active' AND tr.result_key IS NULL
              LEFT JOIN analyte a ON a.id = tr.analyte_id
              LEFT JOIN specification sp ON sp.requested_test_id = rt.id AND sp.analyte_id = tr.analyte_id AND sp.status = 'Active'
             WHERE rt.stability_study_id = ?::uuid AND rt.status <> 'Cancelled' AND sa.status <> 'Cancelled' AND NOT test_is_replaced(rt.id)""", studyId);
        List<Map<String, Object>> planned = db.rows("""
            SELECT q.test_id, a.id AS analyte_id, a.analyte_name, tva.reporting_unit AS unit, tva.sort_order,
                sp.min_value, sp.max_value, sp.text_value, sp.unit AS spec_unit
              FROM quoted_test_configuration q JOIN test_version tv ON tv.test_id = q.test_id AND tv.status = 'Effective'
              JOIN test_version_analyte tva ON tva.test_version_id = tv.id AND tva.status = 'Active' AND NOT COALESCE(tva.hide_on_report, false)
              JOIN analyte a ON a.id = tva.analyte_id
              LEFT JOIN specification sp ON sp.quoted_line_id = q.id AND sp.analyte_id = a.id AND sp.status = 'Active'
             WHERE q.project_version_id = ?::uuid AND q.status = 'Active' ORDER BY tva.sort_order, a.analyte_name""", st.get("project_version_id"));
        List<Map<String, Object>> pulls = db.rows("""
            SELECT p.id, p.status, p.condition_id, t.interval_value, t.interval_unit, t.label FROM stability_pull p JOIN stability_timepoint t ON t.id = p.timepoint_id
             WHERE p.study_id = ?::uuid""", studyId);
        List<Map<String, Object>> storage = db.rows("""
            SELECT condition_id, condition_name, storage_code, status, disposition_note, disposed_at, disposed_by_name FROM stability_storage_view
             WHERE study_id = ?::uuid ORDER BY storage_code""", studyId);
        List<Map<String, Object>> excursions = db.rows("""
            SELECT logbook_entry_id, entry_code, equipment_code, equipment_name, entry_at, window_start, window_end, to_jsonb(problems) AS problems, failure_reason,
                storage_code, condition_name, assessment_id, decision, justification, assessed_at, assessed_by_name, to_jsonb(affected_pull_ids) AS affected_pull_ids, affected_pulls
              FROM stability_excursion_status_view WHERE study_id = ?::uuid ORDER BY entry_at""", studyId);
        List<Map<String, Object>> amendments = db.rows("""
            SELECT a.amendment_no, a.applied_at, a.pulls_added, a.pulls_cancelled, a.pulls_changed, fv.version_no AS from_version, tv.version_no AS to_version
              FROM stability_amendment a JOIN project_version fv ON fv.id = a.from_version_id JOIN project_version tv ON tv.id = a.to_version_id
             WHERE a.study_id = ?::uuid ORDER BY a.amendment_no""", studyId);

        Set<String> flagged = new HashSet<>();
        for (Map<String, Object> x : excursions) {
            if (!"Impact: results flagged".equals(x.get("decision"))) continue;
            if (x.get("affected_pull_ids") instanceof JsonNode n && n.isArray()) for (JsonNode p : n) flagged.add(p.asText());
        }
        List<Map<String, Object>> lines = list(d, "lines"), tpsAll = list(d, "timepoints"), cells = list(d, "cells");
        boolean cancelled = "Cancelled".equals(st.get("status"));

        List<Map<String, Object>> conds = new ArrayList<>();
        for (Map<String, Object> c : list(d, "conditions"))
            conds.add(map("condition_id", c.get("condition_id"), "condition_name", c.get("condition_name"), "condition_type", c.get("condition_type")));
        for (Map<String, Object> s : storage) {
            if (conds.stream().noneMatch(c -> Objects.equals(c.get("condition_id"), s.get("condition_id"))))
                conds.add(map("condition_id", s.get("condition_id"), "condition_name", s.get("condition_name"), "condition_type", "No longer in the study", "dropped", true));
        }

        Map<String, Object> t0 = null;
        for (Map<String, Object> t : tpsAll) if (num(t.get("interval_value")) == 0) { t0 = t; break; }
        List<Map<String, Object>> sections = new ArrayList<>();
        for (Map<String, Object> cond : conds) {
            Object cid = cond.get("condition_id");
            LinkedHashMap<String, Object> keys = new LinkedHashMap<>();
            keys.put("T0", t0 != null ? t0.get("label") : "T0");
            for (Map<String, Object> c : cells) {
                if (!Objects.equals(c.get("condition_id"), cid)) continue;
                Map<String, Object> t = byId(tpsAll, c.get("timepoint_id"));
                if (t != null) keys.putIfAbsent(tpKey(t), or(t.get("label"), t.get("tp_label")));
            }
            for (Map<String, Object> p : pulls)
                if (Objects.equals(p.get("condition_id"), cid) && !"Cancelled".equals(p.get("status"))) keys.putIfAbsent(tpKey(p), or(p.get("label"), p.get("tp_label")));
            for (Map<String, Object> r : rows) if (Objects.equals(r.get("condition_id"), cid)) keys.putIfAbsent(tpKey(r), r.get("tp_label"));
            List<Map<String, Object>> tps = new ArrayList<>();
            List<Double> days = new ArrayList<>();
            keys.forEach((k, label) -> {
                String[] parts = k.split("\\|", -1);
                double dd = "T0".equals(k) ? 0 : tpDays(parts[0], parts.length > 1 ? parts[1] : null);
                Map<String, Object> tp = new LinkedHashMap<>();
                tp.put("key", k);
                tp.put("label", label);
                tp.put("days", jsNum(dd));
                tps.add(tp);
                days.add(dd);
            });
            List<Integer> idx = new ArrayList<>();
            for (int i = 0; i < tps.size(); i++) idx.add(i);
            idx.sort((a, b) -> Double.compare(days.get(a), days.get(b)));
            List<Map<String, Object>> sorted = new ArrayList<>();
            for (int i : idx) sorted.add(tps.get(i));

            java.util.function.Predicate<Map<String, Object>> here = r -> Objects.equals(r.get("condition_id"), cid)
                || (r.get("condition_id") == null && num(r.get("interval_value")) == 0);
            List<Object> testIds = new ArrayList<>();
            Map<Object, Object> names = new LinkedHashMap<>();
            for (Map<String, Object> c : cells) {
                if (!(Objects.equals(c.get("condition_id"), cid) || c.get("condition_id") == null)) continue;
                Map<String, Object> l = byId(lines, c.get("line_id"));
                if (l != null && !testIds.contains(l.get("test_id"))) { testIds.add(l.get("test_id")); names.put(l.get("test_id"), l.get("test_name")); }
            }
            for (Map<String, Object> r : rows)
                if (here.test(r) && !testIds.contains(r.get("test_id"))) { testIds.add(r.get("test_id")); names.put(r.get("test_id"), r.get("test_name")); }
            testIds.sort((a, b) -> COLLATOR.compare(String.valueOf(names.get(a)), String.valueOf(names.get(b))));

            List<Map<String, Object>> tests = new ArrayList<>();
            for (Object tid : testIds) {
                List<Map<String, Object>> mine = rows.stream().filter(r -> Objects.equals(r.get("test_id"), tid) && here.test(r)).toList();
                List<Map<String, Object>> shown = mine.stream().filter(r -> Js.truthy(r.get("analyte_id"))
                    && (!issued || (Boolean.TRUE.equals(r.get("finalized")) && "Final".equals(r.get("stage"))))).toList();
                LinkedHashMap<Object, Map<String, Object>> analytes = new LinkedHashMap<>();
                for (Map<String, Object> x : planned) if (Objects.equals(x.get("test_id"), tid)) analytes.put(x.get("analyte_id"), new LinkedHashMap<>(x));
                for (Map<String, Object> x : shown) {
                    Map<String, Object> merged = new LinkedHashMap<>(analytes.getOrDefault(x.get("analyte_id"), Map.of()));
                    x.forEach((k, v) -> { if (v != null) merged.put(k, v); });
                    analytes.put(x.get("analyte_id"), merged);
                }
                List<Map<String, Object>> out = new ArrayList<>();
                for (Map<String, Object> a : analytes.values()) {
                    List<String> spec = new ArrayList<>();
                    if (a.get("min_value") != null) spec.add("≥ " + Js.number(num(a.get("min_value"))));
                    if (a.get("max_value") != null) spec.add("≤ " + Js.number(num(a.get("max_value"))));
                    if (Js.truthy(a.get("text_value"))) spec.add(a.get("text_value").toString());
                    String s = String.join(" and ", spec);
                    List<Object> values = new ArrayList<>();
                    for (Map<String, Object> t : sorted) {
                        String k = (String) t.get("key");
                        Map<String, Object> r = null;
                        for (Map<String, Object> x : shown) if (Objects.equals(x.get("analyte_id"), a.get("analyte_id")) && tpKey(x).equals(k)) { r = x; break; }
                        if (r != null) values.add(map("text", r.get("reported"), "stage", r.get("stage"), "conformance", r.get("conformance"),
                            "flagged", r.get("stability_pull_id") != null && flagged.contains(r.get("stability_pull_id").toString())));
                        else if (expected(k, mine, pulls, cells, lines, tpsAll, tid, cid, cancelled)) values.add(map("text", "", "pending", true));
                        else values.add(null);
                    }
                    out.add(map("analyte_name", a.get("analyte_name"), "unit", or(or(a.get("unit"), a.get("spec_unit")), ""),
                        "spec", s.isEmpty() ? "" : s + (Js.truthy(a.get("spec_unit")) ? " " + a.get("spec_unit") : ""), "values", values));
                }
                tests.add(map("test_name", names.get(tid), "analytes", out));
            }
            sections.add(map("condition", cond, "timepoints", sorted, "tests", tests,
                "storage", storage.stream().filter(s -> Objects.equals(s.get("condition_id"), cid)).toList()));
        }
        TreeSet<String> resultIds = new TreeSet<>();
        for (Map<String, Object> r : rows)
            if (r.get("result_id") != null && Boolean.TRUE.equals(r.get("finalized")) && "Final".equals(r.get("stage"))) resultIds.add(r.get("result_id").toString());
        return map("study", st, "design", d, "sections", sections, "excursions", excursions, "amendments", amendments, "storage", storage,
            "issued", issued, "result_ids", new ArrayList<>(resultIds));
    }

    /** Whether a timepoint still expects a result (shown as pending) rather than having none planned. */
    private static boolean expected(String k, List<Map<String, Object>> mine, List<Map<String, Object>> pulls, List<Map<String, Object>> cells,
                                    List<Map<String, Object>> lines, List<Map<String, Object>> tps, Object tid, Object cid, boolean cancelled) {
        if (mine.stream().anyMatch(r -> tpKey(r).equals(k))) return true;
        if (cancelled) return false;
        Object pc = "T0".equals(k) ? null : cid;
        String status = null;
        boolean any = false;
        for (Map<String, Object> p : pulls) {
            if (!tpKey(p).equals(k) || !Objects.equals(p.get("condition_id"), pc)) continue;
            any = true;
            if (!"Cancelled".equals(p.get("status"))) { status = (String) p.get("status"); break; }
        }
        if (status == null && any) status = "Cancelled";
        if ("Cancelled".equals(status)) return false;
        for (Map<String, Object> c : cells) {
            Map<String, Object> l = byId(lines, c.get("line_id")), t = byId(tps, c.get("timepoint_id"));
            if (l != null && t != null && Objects.equals(l.get("test_id"), tid) && tpKey(t).equals(k)
                && ("T0".equals(k) ? c.get("condition_id") == null : Objects.equals(c.get("condition_id"), cid))) return true;
        }
        return false;
    }
}
