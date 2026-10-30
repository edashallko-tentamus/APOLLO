package com.tentamus.lims.reports.domain;

import com.tentamus.lims.core.documents.Html;
import com.tentamus.lims.core.excel.Js;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * What one COA version shows (coa.js content()): the stored content (the map, saved as coa_version.content and checked by
 * the database against the record when signed), plus what goes to the PDF but is never stored: the lab's images, the
 * report photos and, per test, what still holds its per-serving results (for the release check only).
 */
public final class CoaContent {
    public static final String DECISION_RULE = "Conformance is stated against the specification provided by the client, by simple acceptance: the reported result is compared with the limit; measurement uncertainty is not taken into account.";

    private final Map<String, Object> stored;
    private final String logo;
    private final String mark;
    private final Map<Integer, String> photoData;
    private final Map<String, String> servingProblems;

    public CoaContent(Map<String, Object> stored, String logo, String mark, Map<Integer, String> photoData, Map<String, String> servingProblems) {
        this.stored = stored;
        this.logo = logo;
        this.mark = mark;
        this.photoData = photoData;
        this.servingProblems = servingProblems;
    }

    /** The content as stored and answered (JSON). */
    public Map<String, Object> stored() { return stored; }

    public String logo() { return logo; }

    public String mark() { return mark; }

    public String photo(int slot) { return photoData.get(slot); }

    /** What holds a test's per-serving results (serving_problem), or null. */
    public String servingProblem(Object requestedTestId) { return servingProblems.get(String.valueOf(requestedTestId)); }

    public Object get(String key) { return stored.get(key); }

    @SuppressWarnings("unchecked")
    public Map<String, Object> part(String key) { return (Map<String, Object>) stored.get(key); }

    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> list(String key) { return stored.get(key) instanceof List<?> l ? (List<Map<String, Object>>) l : List.of(); }

    @SuppressWarnings("unchecked")
    public static List<Map<String, Object>> results(Map<String, Object> test) { return (List<Map<String, Object>>) test.get("results"); }

    /** The report ID the client sees (the sample ID, R and the version), or the COA code for older content. */
    public String reportId() { return Js.truthy(stored.get("report_id")) ? Html.text(stored.get("report_id")) : Html.text(stored.get("coa_code")); }

    public List<Map<String, Object>> testsFinalizedNow() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> t : list("tests")) if (Boolean.TRUE.equals(t.get("finalized_now"))) out.add(t);
        return out;
    }

    /** The parts (one per report template); content made before migration 030 has none: one part with everything. */
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> sections() {
        List<Map<String, Object>> secs = list("sections");
        if (!secs.isEmpty()) return secs;
        List<Object> tests = new ArrayList<>(), pending = new ArrayList<>();
        for (Map<String, Object> t : list("tests")) tests.add(t.get("requested_test_id"));
        for (Map<String, Object> p : list("pending")) pending.add(p.get("requested_test_id"));
        Map<String, Object> one = new LinkedHashMap<>();
        one.put("template", new LinkedHashMap<>(Map.of("options", Map.of())));
        one.put("tests", tests);
        one.put("pending", pending);
        return List.of(one);
    }

    /** The values each data-check cell of the rendered COA must show (coa.js expectedCells). */
    public Map<String, String> expectedCells() {
        Map<String, String> m = new LinkedHashMap<>();
        Map<String, Object> order = part("order"), sample = part("sample"), auth = part("authorized");
        put(m, "h:report_id", reportId());
        put(m, "h:version_no", Html.text(stored.get("version_no")));
        put(m, "h:order_code", order.get("order_code"));
        put(m, "h:sample_code", sample.get("sample_code"));
        put(m, "h:client_sample_id", sample.get("client_sample_id"));
        put(m, "h:lot", sample.get("lot"));
        put(m, "h:authorized_by", auth.get("by"));
        put(m, "h:verify_code", stored.get("verify_code"));
        List<Map<String, Object>> secs = sections();
        for (Map<String, Object> t : list("tests")) {
            Map<String, Object> part = partOf(secs, t);
            boolean hasSpec = false;
            for (Map<String, Object> x : list("tests")) if (partOf(secs, x) == part) for (Map<String, Object> r : results(x)) hasSpec |= Js.truthy(r.get("spec"));
            for (Map<String, Object> r : results(t)) {
                String id = Html.text(r.get("id"));
                m.put("r:" + id + ":reported", jsString(r.get("reported")));
                m.put("r:" + id + ":unit", jsString(r.get("unit")));
                if (hasSpec) {
                    m.put("r:" + id + ":spec", jsString(r.get("spec")));
                    m.put("r:" + id + ":conf", Js.truthy(r.get("spec")) ? jsString(r.get("conformance")) : "");
                }
            }
        }
        return m;
    }

    private static Map<String, Object> partOf(List<Map<String, Object>> secs, Map<String, Object> t) {
        for (Map<String, Object> x : secs) if (x.get("tests") instanceof List<?> l && l.contains(t.get("requested_test_id"))) return x;
        return secs.get(0);
    }

    private static void put(Map<String, String> m, String k, Object v) { if (v != null && !"".equals(v)) m.put(k, Html.text(v)); }

    /** String(v) as the comparison wrote it (null is "null"). */
    static String jsString(Object v) { return v == null ? "null" : Html.text(v); }

    /** Compares the cells read back from the rendered page with the record: what differs, at most per cell. */
    public static List<String> mismatches(Map<String, String> expected, List<String[]> seen) {
        Map<String, String> got = new LinkedHashMap<>();
        for (String[] s : seen) got.put(s[0], s[1]);
        List<String> out = new ArrayList<>();
        for (Map.Entry<String, String> e : expected.entrySet()) {
            if (!got.containsKey(e.getKey())) out.add(e.getKey() + ": not on the PDF");
            else if (!got.get(e.getKey()).equals(e.getValue().trim())) out.add(e.getKey() + ": the PDF shows \"" + got.get(e.getKey()) + "\", the record \"" + e.getValue() + "\"");
        }
        return out;
    }
}
