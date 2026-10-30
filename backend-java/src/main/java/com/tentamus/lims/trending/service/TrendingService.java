package com.tentamus.lims.trending.service;

import static com.tentamus.lims.core.web.Answers.*;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.excel.Xlsx;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.web.ApiExceptionHandler;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.trending.domain.SignalReview;
import com.tentamus.lims.trending.domain.TrendChart;
import com.tentamus.lims.trending.repo.TrendChartRepository;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.postgresql.util.PSQLException;
import org.springframework.stereotype.Service;

/**
 * Trending and control charts: what can be charted, building a chart (one panel per analyte, QC check or piece of
 * equipment when the definition says "each"), saved charts with frozen limits and QA approval, applying an approved QC
 * chart's limits to the test's draft version, signal reviews, Trend watch, the report packs, QC Review's applied charts
 * and the Excel download. The PDF download (POST /api/trending/pdf) stays in the Node backend: it is printed by headless
 * Chromium.
 */
@Service
public class TrendingService {
    private static final String[][][] PACK_CHARTS = {
        {{"counts", "OOS investigations opened per month", "oos_opened", "Month"}, {"counts", "OOS rate per month (investigations per approved test)", "oos_rate", "Month"},
            {"counts", "OOS confirmed per month (no assignable cause)", "oos_confirmed", "Month"}, {"pareto", "OOS investigations by test", "oos_by_test", null},
            {"pareto", "OOS investigations by outcome", "oos_by_outcome", null}},
        {{"counts", "Re-preparations per month", "repreps", "Month"}, {"counts", "Re-analyses per month", "reanalyses", "Month"},
            {"counts", "Tests reported on time per month", "on_time", "Month"}, {"counts", "Turnaround, mean days per week", "tat_days", "Week"},
            {"pareto", "Re-preparations by test", "repreps_by_test", null}},
        {{"counts", "Failed equipment checks per month", "equipment_failures", "Month"}, {"counts", "Stability chamber excursions per month", "excursions", "Month"},
            {"counts", "Inventory lots rejected by QA testing per month", "lots_rejected", "Month"}, {"pareto", "Failed equipment checks by equipment", "failures_by_equipment", null},
            {"pareto", "Failed logbook entries by logbook", "failures_by_logbook", null}}};
    private static final Map<String, String[]> PACKS = Map.of(
        "oos", new String[] {"OOS trends", "Out-of-specification investigations over time and what they are made of.", "0"},
        "lab", new String[] {"Lab performance", "Rework and turnaround: re-preparations, re-analyses, on-time reporting and turnaround days.", "1"},
        "equipment", new String[] {"Equipment and environment", "Failed equipment checks, stability chamber excursions and lots rejected by QA testing.", "2"});
    private static final List<String> SAVED = List.of("watched", "all");

    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final SignatureService signatures;
    private final TrendEngine engine;
    private final ObjectMapper json;
    private final TrendChartRepository charts;

    public TrendingService(Db db, UnitOfWork uow, AccessPolicy access, SignatureService signatures, TrendEngine engine, ObjectMapper json, TrendChartRepository charts) {
        this.charts = charts;
        this.db = db;
        this.uow = uow;
        this.access = access;
        this.signatures = signatures;
        this.engine = engine;
        this.json = json;
    }

    private void view(RequestContext ctx) { access.require(ctx, "trending.view", "see trend charts"); }

    @SuppressWarnings("unchecked")
    private Map<String, Object> mapOf(Object v) {
        if (v instanceof JsonNode n && n.isObject()) return json.convertValue(n, LinkedHashMap.class);
        if (v instanceof Map<?, ?> m) return new LinkedHashMap<>((Map<String, Object>) m);
        return new LinkedHashMap<>();
    }

    private String toJson(Object v) {
        try { return json.writeValueAsString(v); } catch (JsonProcessingException e) { throw new IllegalArgumentException(e); }
    }

    // ---------------------------------------------------------------- what can be charted, for the builder's pick lists
    public Map<String, Object> options(RequestContext ctx) {
        String site = access.currentSite(ctx);
        view(ctx);
        List<Map<String, Object>> tests = db.rows("""
            SELECT t.id, t.test_code, t.test_name, tv.id AS version_id FROM test t JOIN test_version tv ON tv.test_id = t.id AND tv.status = 'Effective'
              WHERE (t.site_id = ?::uuid OR t.site_id IS NULL) AND t.status = 'Active' ORDER BY t.test_name""", site);
        List<Map<String, Object>> analytes = new ArrayList<>(db.rows("""
            SELECT tv.test_id, a.id, a.analyte_name, tva.reporting_unit AS unit FROM test_version tv JOIN test_version_analyte tva ON tva.test_version_id = tv.id AND tva.status = 'Active'
              JOIN analyte a ON a.id = tva.analyte_id JOIN test t ON t.id = tv.test_id WHERE tv.status = 'Effective' AND (t.site_id = ?::uuid OR t.site_id IS NULL) ORDER BY tva.sort_order, a.analyte_name""", site));
        // analytes that have results even when the Effective version lists none (tests made before the designer)
        List<Map<String, Object>> resultAnalytes = db.rows("""
            SELECT DISTINCT rt.test_id, a.id, a.analyte_name, tr.unit FROM test_result tr JOIN requested_test rt ON rt.id = tr.requested_test_id JOIN analyte a ON a.id = tr.analyte_id
              JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id WHERE o.site_id = ?::uuid AND tr.status = 'Active' AND tr.value_num IS NOT NULL""", site);
        for (Map<String, Object> x : resultAnalytes) {
            boolean known = analytes.stream().anyMatch(y -> java.util.Objects.equals(y.get("test_id"), x.get("test_id")) && java.util.Objects.equals(y.get("id"), x.get("id")));
            if (!known) analytes.add(x);
        }
        List<Map<String, Object>> qcTypes = db.rows("""
            SELECT tv.test_id, q->>'qc_type' AS qc_type, cr->>'limit_type' AS limit_type FROM test_version tv JOIN workflow_step ws ON ws.test_version_id = tv.id AND ws.step_type = 'Batching' AND ws.status = 'Active'
              CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ws.config->'qc', '[]')) q CROSS JOIN LATERAL jsonb_array_elements(COALESCE(q->'criteria', '[]')) cr
              JOIN test t ON t.id = tv.test_id WHERE tv.status = 'Effective' AND (t.site_id = ?::uuid OR t.site_id IS NULL)""", site);
        List<Map<String, Object>> logbooks = db.rows("SELECT l.id, l.logbook_code, l.logbook_name, l.subject FROM logbook l WHERE l.site_id = ?::uuid ORDER BY l.logbook_code", site);
        List<Map<String, Object>> fields = db.rows("""
            SELECT DISTINCT ON (l.id, f.field_key) l.id AS logbook_id, f.field_key, f.label, f.unit FROM logbook l JOIN logbook_version v ON v.logbook_id = l.id
              JOIN logbook_field f ON f.version_id = v.id WHERE l.site_id = ?::uuid AND f.field_type IN ('Number','Calculated') ORDER BY l.id, f.field_key, v.version_no DESC""", site);
        List<Map<String, Object>> equipment = db.rows("""
            SELECT DISTINCT e.logbook_id, eq.id, eq.equipment_code, eq.equipment_name FROM logbook_entry e JOIN equipment eq ON eq.id = e.equipment_id WHERE e.site_id = ?::uuid ORDER BY eq.equipment_code""", site);
        List<Map<String, Object>> clients = db.rows("""
            SELECT DISTINCT cl.id, COALESCE(cl.display_name, cl.legal_name) AS name FROM client cl JOIN lab_order o ON o.client_id = cl.id WHERE o.site_id = ?::uuid ORDER BY 2""", site);
        List<Object> matrices = db.rows("SELECT DISTINCT s.matrix FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE o.site_id = ?::uuid AND s.matrix IS NOT NULL ORDER BY 1", site)
            .stream().map(x -> x.get("matrix")).toList();
        List<Map<String, Object>> studies = db.rows("SELECT s.id, s.study_code, s.product, s.status FROM stability_study s WHERE s.site_id = ?::uuid ORDER BY s.study_code", site);
        List<Map<String, Object>> studyAnalytes = db.rows("""
            SELECT DISTINCT rt.stability_study_id AS study_id, a.id, a.analyte_name FROM test_result tr JOIN requested_test rt ON rt.id = tr.requested_test_id JOIN analyte a ON a.id = tr.analyte_id
              JOIN stability_study s ON s.id = rt.stability_study_id WHERE s.site_id = ?::uuid AND tr.status = 'Active' AND tr.value_num IS NOT NULL""", site);
        List<Map<String, Object>> metrics = new ArrayList<>();
        TrendEngine.COUNT_METRICS.forEach((k, m) -> metrics.add(map("key", k, "title", m.title(), "chart", m.chart(), "test", m.test())));
        List<Map<String, Object>> pareto = new ArrayList<>();
        TrendEngine.PARETO_METRICS.forEach((k, t) -> pareto.add(map("key", k, "title", t)));
        return map("tests", tests, "analytes", analytes, "qcTypes", qcTypes, "logbooks", logbooks, "fields", fields, "equipment", equipment, "clients", clients,
            "matrices", matrices, "studies", studies, "studyAnalytes", studyAnalytes, "metrics", metrics, "pareto", pareto, "rules", TrendEngine.RULES,
            "can_manage", access.has(ctx, "trending.manage"));
    }

    // ---------------------------------------------------------------- a definition, expanded: "each" gives one panel per combination
    /** def.title || def.chart_name inside a template: an absent name reads "undefined", as in the Node backend. */
    private static String nameOf(Map<String, Object> def) {
        if (Js.truthy(def.get("title"))) return Js.string(def.get("title"));
        return def.containsKey("chart_name") ? TrendEngine.tpl(def.get("chart_name")) : "undefined";
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> expand(String site, Map<String, Object> def) {
        Map<String, Object> p = def.get("params") instanceof Map<?, ?> m ? (Map<String, Object>) m : new LinkedHashMap<>();
        if ("logbook".equals(def.get("source")) && "*".equals(p.get("equipment_id"))) {
            List<Map<String, Object>> eq = db.rows("""
                SELECT DISTINCT eq.id, eq.equipment_code, eq.equipment_name FROM logbook_entry e JOIN equipment eq ON eq.id = e.equipment_id
                  WHERE e.site_id = ?::uuid AND e.logbook_id = ?::uuid AND e.status <> 'Voided' ORDER BY eq.equipment_code""", site, p.get("logbook_id"));
            List<Map<String, Object>> out = new ArrayList<>();
            for (Map<String, Object> x : eq) {
                Map<String, Object> d = new LinkedHashMap<>(def);
                Map<String, Object> q = new LinkedHashMap<>(p);
                q.put("equipment_id", x.get("id"));
                d.put("params", q);
                d.put("title", nameOf(def) + ": " + TrendEngine.tpl(x.get("equipment_code")) + " " + TrendEngine.tpl(x.get("equipment_name")));
                out.add(d);
            }
            return out;
        }
        Object source = def.get("source");
        boolean eachAnalyte = "*".equals(p.get("analyte_id")), eachQc = "*".equals(p.get("qc_type"));
        if (!("results".equals(source) || "qc".equals(source)) || (!eachAnalyte && !eachQc)) return List.of(def);
        Map<String, Object> v = db.one("SELECT id FROM test_version WHERE test_id = ?::uuid AND status = 'Effective'", p.get("test_id"));
        Object vid = v == null ? null : v.get("id");
        List<Map<String, Object>> analytes = eachAnalyte ? db.rows("""
            SELECT a.id, a.analyte_name FROM test_version_analyte tva JOIN analyte a ON a.id = tva.analyte_id WHERE tva.test_version_id = ?::uuid AND tva.status = 'Active'
              ORDER BY tva.sort_order, a.analyte_name""", vid) : List.of(map("id", p.get("analyte_id"), "analyte_name", null));
        if (eachAnalyte && analytes.isEmpty()) analytes = db.rows("""
            SELECT DISTINCT a.id, a.analyte_name FROM test_result tr JOIN requested_test rt ON rt.id = tr.requested_test_id JOIN analyte a ON a.id = tr.analyte_id
              WHERE rt.test_id = ?::uuid AND tr.value_num IS NOT NULL ORDER BY 2""", p.get("test_id"));
        List<Map<String, Object>> types = List.of(map("qc_type", Js.orNull(p.get("qc_type")), "limit_type", Js.orNull(p.get("limit_type"))));
        if ("qc".equals(source) && eachQc) types = db.rows("""
            SELECT DISTINCT q->>'qc_type' AS qc_type, cr->>'limit_type' AS limit_type FROM workflow_step ws CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ws.config->'qc', '[]')) q
              CROSS JOIN LATERAL jsonb_array_elements(COALESCE(q->'criteria', '[]')) cr WHERE ws.test_version_id = ?::uuid AND ws.step_type = 'Batching' AND ws.status = 'Active' ORDER BY 1, 2""", vid);
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> ty : types) for (Map<String, Object> a : analytes) {
            Map<String, Object> q = new LinkedHashMap<>(p);
            q.put("analyte_id", a.get("id"));
            q.put("qc_type", ty.get("qc_type"));
            q.put("limit_type", ty.get("limit_type"));
            List<String> title = new ArrayList<>();
            Object base = Js.truthy(def.get("title")) ? def.get("title") : def.get("chart_name");
            if (Js.truthy(base)) title.add(TrendEngine.tpl(base));
            if (Js.truthy(ty.get("qc_type")) && eachQc) title.add(TrendEngine.tpl(ty.get("qc_type")) + " (" + TrendEngine.tpl(ty.get("limit_type")) + ")");
            if (Js.truthy(a.get("analyte_name")) && eachAnalyte) title.add(TrendEngine.tpl(a.get("analyte_name")));
            Map<String, Object> d = new LinkedHashMap<>(def);
            d.put("params", q);
            d.put("title", String.join(": ", title));
            out.add(d);
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> withReviews(Object chartId, List<Map<String, Object>> panels) {
        if (chartId == null) return panels;
        List<Map<String, Object>> reviews = db.rows("""
            SELECT rv.point_key, rv.rule, rv.outcome, rv.comment, rv.reviewed_at, u.full_name AS reviewed_by_name FROM trend_signal_review rv JOIN app_user u ON u.id = rv.reviewed_by
              WHERE rv.chart_id = ?::uuid AND rv.status = 'Active'""", chartId);
        for (Map<String, Object> p : panels) {
            if (!(p.get("signals") instanceof List<?> sigs)) continue;
            for (Object o : sigs) {
                Map<String, Object> s = (Map<String, Object>) o;
                s.put("review", reviews.stream().filter(x -> java.util.Objects.equals(x.get("point_key"), s.get("key")) && java.util.Objects.equals(x.get("rule"), s.get("rule")))
                    .findFirst().orElse(null));
            }
        }
        return panels;
    }

    /** The message a failed panel shows: the database's own words, or the rule's. */
    private static String messageOf(RuntimeException e) {
        PSQLException pg = ApiExceptionHandler.find(e);
        if (pg != null && pg.getServerErrorMessage() != null) return pg.getServerErrorMessage().getMessage();
        return e.getMessage();
    }

    private List<Map<String, Object>> buildAll(String site, Map<String, Object> def, Object chartId) {
        List<Map<String, Object>> panels = new ArrayList<>();
        for (Map<String, Object> d : expand(site, def)) {
            try { panels.add(engine.build(site, d)); } catch (RuntimeException e) { panels.add(map("title", d.get("title"), "error", messageOf(e))); }
        }
        return withReviews(chartId, panels);
    }

    private static Map<String, Object> cleanDef(Map<String, Object> b) {
        return map("source", b.get("source"), "title", Js.truthy(b.get("title")) ? b.get("title") : "", "params", Js.truthy(b.get("params")) ? b.get("params") : new LinkedHashMap<>(),
            "rules", b.get("rules") instanceof List<?> l ? l : TrendEngine.DEFAULT_RULES, "frozen", Js.orNull(b.get("frozen")),
            "highlight", Js.truthy(b.get("highlight")) ? b.get("highlight") : List.of());
    }

    public Map<String, Object> build(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        view(ctx);
        return map("panels", buildAll(site, cleanDef(body), null));
    }

    // ---------------------------------------------------------------- saved charts
    private Map<String, Object> chartOf(RequestContext ctx, Object id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Chart not found");
        Map<String, Object> ch = db.one("""
            SELECT tc.*, fu.full_name AS frozen_by_name, cu.full_name AS created_by_name, qu.full_name AS qa_approved_by_name,
                au.full_name AS applied_by_name, av.version_no AS applied_version_no, av.status::text AS applied_version_status, av.test_id AS applied_test_id
              FROM trend_chart tc LEFT JOIN app_user fu ON fu.id = tc.frozen_by JOIN app_user cu ON cu.id = tc.created_by LEFT JOIN app_user qu ON qu.id = tc.qa_approved_by
              LEFT JOIN app_user au ON au.id = tc.applied_by LEFT JOIN test_version av ON av.id = tc.applied_version_id WHERE tc.id = ?::uuid""", id);
        if (ch == null) throw new RuleException("Chart not found");
        access.checkSite(ctx, (String) ch.get("site_id"));
        return ch;
    }

    /** A saved chart as a definition; params replaced when given. */
    private Map<String, Object> defOf(Map<String, Object> ch, Map<String, Object> params) {
        Object rules = ch.get("rules");
        if (rules instanceof String s) rules = java.util.Arrays.stream(s.replaceAll("[{}]", "").split(",")).filter(x -> !x.isEmpty()).toList();
        return map("source", ch.get("source"), "title", ch.get("chart_name"), "params", params != null ? params : mapOf(ch.get("params")), "rules", rules,
            "frozen", ch.get("frozen_cl") != null ? map("cl", ch.get("frozen_cl"), "sigma", ch.get("frozen_sigma")) : null);
    }

    public Map<String, Object> charts(RequestContext ctx) {
        String site = access.currentSite(ctx);
        view(ctx);
        return map("rows", db.rows("""
            SELECT tc.id, tc.chart_code, tc.chart_name, tc.description, tc.source, tc.params, tc.watch, tc.show_in_review, tc.frozen_cl IS NOT NULL AS frozen, tc.status::text AS status,
                tc.qa_review, tc.qa_status, u.full_name AS created_by_name, tc.modified_at FROM trend_chart tc JOIN app_user u ON u.id = tc.created_by WHERE tc.site_id = ?::uuid ORDER BY tc.status, tc.chart_code""", site),
            "can_manage", access.has(ctx, "trending.manage"), "can_approve", access.has(ctx, "trending.approve"));
    }

    public Map<String, Object> chart(RequestContext ctx, String id, Map<String, String> query) {
        view(ctx);
        Map<String, Object> ch = chartOf(ctx, id);
        Map<String, Object> params = mapOf(ch.get("params"));
        if (Js.truthy(query.get("from"))) params.put("from", query.get("from")); else params.remove("from");
        if (Js.truthy(query.get("to"))) params.put("to", query.get("to")); else params.remove("to");
        Map<String, Object> lim = db.one("SELECT * FROM trend_limits_for_test(?::uuid)", ch.get("id"));
        String site = (String) ch.get("site_id");
        return map("chart", ch, "panels", buildAll(site, defOf(ch, params), ch.get("id")), "can_manage", access.has(ctx, "trending.manage"),
            "can_approve", access.has(ctx, "trending.approve"), "can_design", access.has(ctx, "methods.design"), "limits_for_test", "qc".equals(ch.get("source")) ? lim : null);
    }

    /** QA approves the chart and its limits (signed "Approved by"; {@link TrendChart#approve} decides who may not). */
    public Map<String, Object> approve(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> ch = chartOf(ctx, id);
        RequestContext c = ctx.withSite((String) ch.get("site_id")).withReason(Js.truthy(body.get("reason")) ? Js.string(body.get("reason")) : "Trend chart and its limits approved");
        return signatures.signed(c, body, new SignatureService.Meaning("Approved by", "Trend chart " + TrendEngine.tpl(ch.get("chart_code")) + " " + TrendEngine.tpl(ch.get("chart_name")) + " and its limits", "Trending"),
            d -> {
                TrendChart t = charts.load(d, ch.get("id"));
                if (t == null) throw RuleException.database("Chart not found");
                access.require(c, "trending.approve", "approve trend charts");
                t.approve(c.userId());
                charts.update(d, t);
                return ok();
            });
    }

    /** Number(Number(v).toPrecision(4)), kept whole when it is (JSON 100, not 100.0). */
    private static Number round4(Object v) {
        double d = Double.parseDouble(Js.toPrecision(Js.toNumber(v), 4));
        return d == Math.rint(d) && Math.abs(d) < 1e15 ? (Number) (long) d : d;
    }

    private static void putNumber(ObjectNode o, String k, Number n) {
        if (n instanceof Long l) o.put(k, l); else o.put(k, n.doubleValue());
    }

    /**
     * An approved QC chart's frozen limits (centre line ± 3 sigma) into the test's Draft version (made from the effective
     * one when there is none): written into the Batching step's criterion for that QC type and analyte, signed "Changed by".
     */
    public Map<String, Object> applyLimits(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> ch = chartOf(ctx, id);
        Map<String, Object> x = db.one("SELECT * FROM trend_limits_for_test(?::uuid)", ch.get("id"));
        if (x != null && Js.truthy(x.get("problem"))) throw new RuleException(Js.string(x.get("problem")));
        Number lcl = round4(x.get("lcl")), ucl = round4(x.get("ucl"));
        Map<String, Object> sh = db.one("SELECT shape FROM qc_limit_type WHERE limit_type = ?", x.get("limit_type"));
        String shape = sh != null && Js.truthy(sh.get("shape")) ? Js.string(sh.get("shape")) : "Range";
        String reason = Js.truthy(body.get("reason")) ? Js.string(body.get("reason")) : "Control limits from trend chart " + TrendEngine.tpl(ch.get("chart_code"));
        String qcType = (String) x.get("qc_type"), limitType = (String) x.get("limit_type"), analyteId = (String) x.get("analyte_id");
        RequestContext c = ctx.withSite((String) ch.get("site_id")).withReason(reason);
        String action = "QC limits for " + TrendEngine.tpl(qcType) + " " + TrendEngine.tpl(limitType) + " from trend chart " + TrendEngine.tpl(ch.get("chart_code"));
        return signatures.signed(c, body, new SignatureService.Meaning("Changed by", action, "Methods"), d -> {
            Map<String, Object> v = d.one("SELECT id, version_no FROM test_version WHERE test_id = ?::uuid AND status = 'Draft'", x.get("test_id"));
            boolean created = false;
            if (v == null) {
                Map<String, Object> n = d.one("SELECT new_test_version(?::uuid) AS id", x.get("test_id"));
                v = d.one("SELECT id, version_no FROM test_version WHERE id = ?::uuid", n.get("id"));
                created = true;
            }
            Map<String, Object> step = d.one("SELECT id, config FROM workflow_step WHERE test_version_id = ?::uuid AND step_type = 'Batching' AND status = 'Active' ORDER BY sort_order LIMIT 1", v.get("id"));
            if (step == null) throw new RuleException("The test has no Batching step to hold QC limits");
            ObjectNode cfg = configOf(step.get("config"));
            JsonNode q = find(cfg.path("qc"), "qc_type", qcType);
            JsonNode found = q == null ? null : find(q.path("criteria"), "limit_type", limitType);
            if (!(found instanceof ObjectNode cr)) throw new RuleException("The test's draft has no " + TrendEngine.tpl(qcType) + " " + TrendEngine.tpl(limitType) + " criterion any more: add it in the designer first");
            // the criterion's rows per analyte: every analyte of the version (earlier layout: default + exceptions), then this one set
            List<Object> analytes = d.rows("SELECT analyte_id FROM test_version_analyte WHERE test_version_id = ?::uuid AND status = 'Active' ORDER BY sort_order", v.get("id"))
                .stream().map(a -> a.get("analyte_id")).toList();
            if (!analytes.contains(analyteId)) throw new RuleException("The analyte is not on the test's draft version");
            if (!cr.path("analytes").isArray()) {
                ArrayNode rows = json.createArrayNode();
                for (Object aid : analytes) {
                    JsonNode ov = find(cr.path("overrides"), "analyte_id", (String) aid);
                    if (ov == null) ov = cr;
                    ObjectNode a = rows.addObject();
                    a.put("analyte_id", (String) aid);
                    a.put("applies", true);
                    if ("Range".equals(shape)) { a.set("min", orNullNode(ov.get("min"))); a.set("max", orNullNode(ov.get("max"))); }
                    if ("Max".equals(shape)) { a.set("max", orNullNode(ov.get("max"))); if (truthyNode(ov.get("limit_ref"))) a.set("limit_ref", ov.get("limit_ref")); }
                }
                cr.set("analytes", rows);
                cr.remove("overrides");
            }
            ArrayNode list = (ArrayNode) cr.get("analytes");
            ObjectNode row = (ObjectNode) find(list, "analyte_id", analyteId);
            if (row == null) { row = list.addObject(); row.put("analyte_id", analyteId); }
            row.put("applies", true);
            if ("Range".equals(shape)) { putNumber(row, "min", lcl); putNumber(row, "max", ucl); } else { putNumber(row, "max", ucl); row.remove("limit_ref"); }
            d.update("UPDATE workflow_step SET config = ?::jsonb WHERE id = ?::uuid", cfg.toString(), step.get("id"));
            String note = TrendEngine.tpl(qcType) + " " + TrendEngine.tpl(limitType) + " limits from " + TrendEngine.tpl(ch.get("chart_code"));
            d.update("""
                UPDATE test_version SET change_summary = CASE WHEN change_summary IS NULL OR change_summary = '' THEN ?::text WHEN position(?::text in change_summary) > 0 THEN change_summary
                  ELSE change_summary || '; ' || ?::text END WHERE id = ?::uuid""", note, note, note, v.get("id"));
            TrendChart t = charts.load(d, ch.get("id"));
            Map<String, Object> again = d.one("SELECT * FROM trend_limits_for_test(?::uuid)", ch.get("id"));
            if (again != null && Js.truthy(again.get("problem"))) throw RuleException.database(Js.string(again.get("problem")));
            access.require(c, "methods.design", "design tests");
            t.limitsApplied((String) v.get("id"), charts.draftOfTest(d, v.get("id"), x.get("test_id")), c.userId());
            charts.update(d, t);
            return map("version_id", v.get("id"), "version_no", v.get("version_no"), "created", created, "min", "Range".equals(shape) ? lcl : null, "max", ucl);
        });
    }

    private ObjectNode configOf(Object c) {
        try {
            JsonNode n = c instanceof JsonNode j ? j.deepCopy() : c instanceof String s ? json.readTree(s) : null;
            return n instanceof ObjectNode o ? o : json.createObjectNode();
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException(e);
        }
    }

    /** The first element of an array whose field equals the text (the Node code's find(y => y.k === v)). */
    private static JsonNode find(JsonNode arr, String k, String v) {
        if (arr == null || !arr.isArray()) return null;
        for (JsonNode y : arr) if (y.path(k).isTextual() && y.path(k).asText().equals(v)) return y;
        return null;
    }

    private JsonNode orNullNode(JsonNode n) { return n == null ? json.nullNode() : n; }

    private static boolean truthyNode(JsonNode n) {
        if (n == null || n.isNull() || n.isMissingNode()) return false;
        if (n.isBoolean()) return n.asBoolean();
        if (n.isNumber()) return n.asDouble() != 0 && !Double.isNaN(n.asDouble());
        if (n.isTextual()) return !n.asText().isEmpty();
        return true;
    }

    public Map<String, Object> save(RequestContext ctx, Map<String, Object> b) {
        String site = access.currentSite(ctx);
        if (RequestContext.isUuid(b.get("id"))) chartOf(ctx, b.get("id"));   // checked before the transaction
        String reason = Js.truthy(b.get("reason")) ? Js.string(b.get("reason")) : Js.truthy(b.get("id")) ? "Trend chart changed" : "New trend chart";
        List<?> rules = Js.truthy(b.get("rules")) && b.get("rules") instanceof List<?> l ? l : TrendEngine.DEFAULT_RULES;
        String rulesText = "{" + String.join(",", rules.stream().map(r -> r == null ? "" : TrendEngine.tpl(r)).toList()) + "}";
        boolean show = Js.truthy(b.get("show_in_review"));
        Object[] vals = {Js.string(Js.orBlank(b.get("chart_name"))).trim(), Js.orNull(b.get("description")), b.get("source"), toJson(Js.truthy(b.get("params")) ? b.get("params") : Map.of()),
            rulesText, !Boolean.FALSE.equals(b.get("watch")), show, Js.truthy(b.get("qa_review")) || show};
        List<String> ruleList = rules.stream().map(r -> r == null ? "" : TrendEngine.tpl(r)).toList();
        return uow.run(ctx.withSite(site), reason, d -> {
            boolean update = RequestContext.isUuid(b.get("id"));
            TrendChart before = update ? charts.load(d, b.get("id")) : null;
            TrendChart t = before != null ? before.copy() : new TrendChart();
            if (before == null) t.siteId = site;
            t.name = (String) vals[0]; t.description = (String) vals[1]; t.source = (String) vals[2]; t.params = charts.node(vals[3]); t.rules = ruleList;
            t.watch = (Boolean) vals[5]; t.showInReview = (Boolean) vals[6]; t.qaReview = (Boolean) vals[7];
            save(ctx.withSite(t.siteId), d, before, t);
            return update ? map("id", b.get("id")) : charts.insert(d, t);
        });
    }

    /** Checks a chart change with its rules and writes it (taking a chart off QA review needs trending.approve). */
    private void save(RequestContext c, Db d, TrendChart before, TrendChart t) {
        if (t.checkSave(before, c.userId())) access.require(c, "trending.approve", "take a chart off QA review");
        if (before != null) charts.update(d, t);
    }

    /** Freeze the limits from a baseline period (the chart's points in it): centre line and sigma. */
    @SuppressWarnings("unchecked")
    public Map<String, Object> freeze(RequestContext ctx, String id, Map<String, Object> b) {
        Map<String, Object> ch = chartOf(ctx, id);
        Map<String, Object> p = mapOf(ch.get("params"));
        if ("*".equals(p.get("analyte_id")) || "*".equals(p.get("qc_type")) || "*".equals(p.get("equipment_id")))
            throw new RuleException("Limits are frozen on a chart with one panel: this chart has a panel for each analyte, QC check or piece of equipment");
        if (!List.of("results", "qc", "logbook", "counts").contains(ch.get("source"))) throw new RuleException("Only control charts have limits to freeze");
        Map<String, Object> params = new LinkedHashMap<>(p);
        params.put("from", Js.orNull(b.get("from")));
        params.put("to", Js.orNull(b.get("to")));
        Map<String, Object> def = defOf(ch, params);
        def.put("frozen", null);
        Map<String, Object> base = engine.build((String) ch.get("site_id"), def);
        List<Object> pts = base.get("points") instanceof List<?> l ? (List<Object>) l : List.of();
        boolean i = "i".equals(base.get("chart"));
        if (pts.size() < (i ? 20 : 6)) throw new RuleException("The baseline has " + pts.size() + " points: freeze limits from at least " + (i ? 20 : 6));
        Map<String, Object> st = (Map<String, Object>) base.get("stats");
        String reason = Js.truthy(b.get("reason")) ? Js.string(b.get("reason")) : "Control limits frozen from a baseline";
        return uow.run(ctx.withSite((String) ch.get("site_id")), reason, d -> {
            TrendChart before = charts.load(d, ch.get("id")), t = before.copy();
            t.frozenCl = Js.toNumber(st.get("cl")); t.frozenSigma = i ? Js.toNumber(st.get("sigma")) : 0.0;
            t.frozenFrom = (String) Js.orNull(b.get("from")); t.frozenTo = (String) Js.orNull(b.get("to")); t.frozenN = pts.size();
            save(ctx.withSite(t.siteId), d, before, t);
            Map<String, Object> out = map("cl", st.get("cl"));
            if (st.containsKey("sigma")) out.put("sigma", st.get("sigma"));
            out.put("n", pts.size());
            return out;
        });
    }

    public Map<String, Object> unfreeze(RequestContext ctx, String id, Map<String, Object> b) {
        Map<String, Object> ch = chartOf(ctx, id);
        String reason = Js.truthy(b.get("reason")) ? Js.string(b.get("reason")) : "Control limits recalculated from the data";
        return uow.run(ctx.withSite((String) ch.get("site_id")), reason, d -> {
            TrendChart before = charts.load(d, ch.get("id")), t = before.copy();
            t.frozenCl = null;
            save(ctx.withSite(t.siteId), d, before, t);
            return ok();
        });
    }

    public Map<String, Object> retire(RequestContext ctx, String id, Map<String, Object> b) {
        Map<String, Object> ch = chartOf(ctx, id);
        String reason = Js.truthy(b.get("reason")) ? Js.string(b.get("reason")) : "Trend chart retired";
        return uow.run(ctx.withSite((String) ch.get("site_id")), reason, d -> {
            TrendChart before = charts.load(d, ch.get("id")), t = before.copy();
            t.status = "Inactive"; t.watch = false; t.showInReview = false;
            save(ctx.withSite(t.siteId), d, before, t);
            return ok();
        });
    }

    /** A person's review of a signal (outcome and comment; reason in the audit trail). */
    public Map<String, Object> reviewSignal(RequestContext ctx, Map<String, Object> b) {
        Map<String, Object> ch = chartOf(ctx, b.get("chart_id"));
        String reason = Js.truthy(b.get("reason")) ? Js.string(b.get("reason")) : "Trend signal reviewed";
        String key = Js.string(Js.orBlank(b.get("point_key")));
        return uow.run(ctx.withSite((String) ch.get("site_id")), reason, d -> {
            String rule = b.get("rule") == null ? null : Js.string(b.get("rule"));
            String comment = new SignalReview(key, rule, (String) b.get("outcome"), Js.string(Js.orBlank(b.get("comment")))).checkedComment();
            return charts.review(d, (String) ch.get("id"), key, (String) Js.orNull(b.get("point_label")), rule, (String) b.get("outcome"), comment);
        });
    }

    // ---------------------------------------------------------------- Trend watch: every watched chart, its latest point and its signals
    @SuppressWarnings("unchecked")
    public Map<String, Object> watch(RequestContext ctx) {
        String site = access.currentSite(ctx);
        view(ctx);
        List<Map<String, Object>> charts = db.rows("SELECT * FROM trend_chart WHERE site_id = ?::uuid AND status = 'Active' AND watch ORDER BY chart_code", site);
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> ch : charts) {
            for (Map<String, Object> p : buildAll(site, defOf(ch, null), ch.get("id"))) {
                List<Map<String, Object>> sig = p.get("signals") instanceof List<?> l ? (List<Map<String, Object>>) l : List.of();
                List<Map<String, Object>> pts = p.get("points") instanceof List<?> l ? (List<Map<String, Object>>) l : null;
                List<?> items = pts != null ? pts : p.get("bars") instanceof List<?> l ? l : List.of();
                List<Map<String, Object>> open = sig.stream().filter(s -> s.get("review") == null).toList();
                Map<String, Object> st = p.get("stats") instanceof Map<?, ?> m ? (Map<String, Object>) m : null;
                Map<String, Object> row = map("chart_id", ch.get("id"), "chart_code", ch.get("chart_code"), "chart_name", ch.get("chart_name"), "title", p.get("title"), "source", ch.get("source"));
                if (p.containsKey("chart")) row.put("chart", p.get("chart"));
                row.put("error", Js.orNull(p.get("error")));
                row.put("n", items.size());
                row.put("last", pts == null || pts.isEmpty() ? null : pts.get(pts.size() - 1));
                if (p.containsKey("unit")) row.put("unit", p.get("unit"));
                List<Object> spark = new ArrayList<>();
                if (pts != null) for (Map<String, Object> x : pts.subList(Math.max(0, pts.size() - 40), pts.size())) spark.add(x.get("v"));
                row.put("spark", spark);
                // a p chart's statistics have no ucl or lcl: Node leaves the keys out (undefined)
                for (String k : List.of("cl", "ucl", "lcl")) if (st == null) row.put(k, null); else if (st.containsKey(k)) row.put(k, st.get(k));
                row.put("signals", sig.size());
                row.put("open", open.size());
                row.put("recent", open.subList(Math.max(0, open.size() - 3), open.size()).stream().map(s -> TrendEngine.tpl(s.get("label")) + ": " + TrendEngine.tpl(s.get("text"))).toList());
                row.put("frozen", ch.get("frozen_cl") != null);
                row.put("show_in_review", ch.get("show_in_review"));
                row.put("qa_status", Boolean.TRUE.equals(ch.get("qa_review")) ? ch.get("qa_status") : null);
                row.put("y_label", Js.orNull(p.get("yLabel")));
                out.add(row);
            }
        }
        return map("rows", out, "can_manage", access.has(ctx, "trending.manage"));
    }

    // ---------------------------------------------------------------- report packs
    private static String[] packOf(String k) {
        if ("watched".equals(k)) return new String[] {"Watched charts", "Every chart on Trend watch, with its signals and their reviews.", null};
        if ("all".equals(k)) return new String[] {"All saved charts", "Every saved chart of the lab, each with all its panels (every analyte, QC check or piece of equipment), its signals and their reviews, and its QA approval.", null};
        String[] p = k == null ? null : PACKS.get(k);
        if (p == null) throw new RuleException("Unknown report");
        return p;
    }

    public Map<String, Object> pack(RequestContext ctx, String name, Map<String, String> q) {
        String site = access.currentSite(ctx);
        view(ctx);
        String[] pack = packOf(name);
        List<Map<String, Object>> defs = new ArrayList<>();
        if (SAVED.contains(name)) {
            for (Map<String, Object> ch : db.rows("SELECT tc.* FROM trend_chart tc WHERE tc.site_id = ?::uuid AND tc.status = 'Active' AND (?::text = 'all' OR tc.watch) ORDER BY tc.chart_code", site, name)) {
                // the pack's range replaces the chart's own (none here: Node sets them to undefined)
                Map<String, Object> params = mapOf(ch.get("params"));
                params.remove("from");
                params.remove("to");
                Map<String, Object> d = defOf(ch, params);
                d.put("chart_id", ch.get("id"));
                defs.add(d);
            }
        } else {
            for (String[] c : PACK_CHARTS[Integer.parseInt(pack[2])]) {
                Map<String, Object> params = map("metric", c[2]);
                if (c[3] != null) params.put("period", c[3]);
                params.put("from", Js.orNull(q.get("from")));
                params.put("to", Js.orNull(q.get("to")));
                params.put("test_id", Js.orNull(q.get("test_id")));
                defs.add(map("source", c[0], "title", c[1], "params", params));
            }
        }
        List<Map<String, Object>> panels = new ArrayList<>();
        for (Map<String, Object> d : defs) panels.addAll(buildAll(site, cleanDef(d), d.get("chart_id")));
        return map("title", pack[0], "intro", pack[1], "panels", panels);
    }

    // ---------------------------------------------------------------- QC Review: the charts applied to this batch's test, the batch's points ringed
    @SuppressWarnings("unchecked")
    public Map<String, Object> review(RequestContext ctx, String batchId) {
        if (!RequestContext.isUuid(batchId)) return map("panels", List.of());
        Map<String, Object> b = db.one("SELECT id, site_id, test_id, batch_code FROM test_batch WHERE id = ?::uuid", batchId);
        if (b == null) return map("panels", List.of());
        String site = (String) b.get("site_id");
        access.checkSite(ctx, site);
        if (!access.load(ctx.userId()).can("trending.view", site)) return map("panels", List.of(), "hidden", true);
        // only charts QA has approved (0.24.1: a chart in QC Review is QA reviewed and counts once approved)
        List<Map<String, Object>> charts = db.rows("""
            SELECT * FROM trend_chart WHERE site_id = ?::uuid AND status = 'Active' AND show_in_review AND qa_status = 'Approved' AND source = 'qc' AND params->>'test_id' = ?::text
             ORDER BY chart_code""", site, b.get("test_id"));
        List<Map<String, Object>> panels = new ArrayList<>();
        for (Map<String, Object> ch : charts) {
            // the batch is charted even before its approval: the window is the chart's plus this batch
            Map<String, Object> def = defOf(ch, null);
            def.put("highlight", List.of(b.get("id")));
            for (Map<String, Object> p : buildAll(site, def, ch.get("id"))) {
                p.put("chart_id", ch.get("id"));
                p.put("chart_code", ch.get("chart_code"));
                List<Map<String, Object>> pts = p.get("points") instanceof List<?> l ? (List<Map<String, Object>>) l : List.of();
                List<Map<String, Object>> sig = p.get("signals") instanceof List<?> l ? (List<Map<String, Object>>) l : List.of();
                p.put("batch_signals", sig.stream().filter(s -> {
                    int i = (Integer) s.get("i");
                    return i < pts.size() && java.util.Objects.equals(pts.get(i).get("batch_id"), b.get("id"));
                }).toList());
                panels.add(p);
            }
        }
        return map("panels", panels, "batch_code", b.get("batch_code"));
    }

    // ---------------------------------------------------------------- the Excel download of the points
    public record Download(byte[] file, String fileName) {}

    private static String safe(Object s) {
        String t = Js.truthy(s) ? Js.string(s) : "trend";
        t = t.replaceAll(":\\s*", " - ").replaceAll("[\\\\/*?\"<>|]", "-");
        return t.length() <= 90 ? t : t.substring(0, 90);
    }

    @SuppressWarnings("unchecked")
    public Download exportXlsx(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        view(ctx);
        List<Map<String, Object>> panels = buildAll(site, cleanDef(body), null);
        Map<String, Object> p = panels.isEmpty() ? Map.of() : panels.get(0);
        List<Map<String, Object>> sig = p.get("signals") instanceof List<?> l ? (List<Map<String, Object>>) l : List.of();
        List<List<Object>> rows = new ArrayList<>();
        if (p.get("points") instanceof List<?> pts) for (int i = 0; i < pts.size(); i++) {
            Map<String, Object> x = (Map<String, Object>) pts.get(i);
            final int k = i;
            Object when = Js.truthy(x.get("t")) ? TrendEngine.tpl(x.get("t")).substring(0, Math.min(10, TrendEngine.tpl(x.get("t")).length())) : x.get("x") != null ? x.get("x") : "";
            List<Object> r = new ArrayList<>();
            r.add(x.get("label")); r.add(when); r.add(x.get("v")); r.add(Js.orBlank(x.get("sub")));
            r.add(String.join(" ", sig.stream().filter(s -> java.util.Objects.equals(s.get("i"), k)).map(s -> TrendEngine.tpl(s.get("rule"))).toList()));
            rows.add(r);
        }
        if (p.get("bars") instanceof List<?> bars) for (Object o : bars) {
            Map<String, Object> x = (Map<String, Object>) o;
            rows.add(new ArrayList<>(java.util.Arrays.asList(x.get("label"), "", x.get("n"), "cumulative " + TrendEngine.toFixed(((Number) x.get("cum_pct")).doubleValue(), 1) + " %", "")));
        }
        String x = "regression".equals(p.get("chart")) ? "Months on stability" : Js.truthy(p.get("xLabel")) ? Js.string(p.get("xLabel")) : "Date";
        String y = Js.truthy(p.get("yLabel")) ? Js.string(p.get("yLabel")) : "Value";
        byte[] file = Xlsx.write("Trend", List.of("Point", x, y, "Detail", "Signals"), rows, List.of(28, 16, 22, 40, 14));
        return new Download(file, safe(p.get("title")) + ".xlsx");
    }
}
