package com.tentamus.lims.methods.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.access.UserAccess;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.signature.SignatureService.Meaning;
import com.tentamus.lims.core.web.ApiExceptionHandler;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.methods.repo.MethodsRepository;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.postgresql.util.PSQLException;
import org.springframework.stereotype.Service;

/**
 * The Workflow Designer: tests and their versions, analytes, steps with their equipment types and the steps they follow,
 * approval, new versions, duplicates and copies to another lab, methods (SOPs) and the formula try-out. Every creation and
 * change is signed (Created by / Changed by, migration 015); the rules are the database's.
 */
@Service
public class DesignerService {
    private final Db db;
    private final AccessPolicy access;
    private final SignatureService signatures;
    private final MethodsRepository repo;
    private final ObjectMapper json;

    public DesignerService(Db db, AccessPolicy access, SignatureService signatures, MethodsRepository repo, ObjectMapper json) {
        this.db = db;
        this.access = access;
        this.signatures = signatures;
        this.repo = repo;
        this.json = json;
    }

    private <T> T design(RequestContext ctx, Map<String, Object> body, String meaning, String action, Function<Db, T> work) {
        return signatures.signed(ctx, body, new Meaning(meaning, action, "Methods"), work);
    }

    private static String vName(Map<String, Object> v) { return v.get("test_name") + ", version " + Js.string(v.get("version_no")); }

    private Map<String, Object> testOf(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Test not found");
        Map<String, Object> t = repo.test(id);
        if (t == null) throw new RuleException("Test not found");
        if (t.get("site_id") != null) access.checkSite(ctx, (String) t.get("site_id"));
        return t;
    }

    private Map<String, Object> versionOf(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Test version not found");
        Map<String, Object> v = repo.version(id);
        if (v == null) throw new RuleException("Test version not found");
        if (v.get("site_id") != null) access.checkSite(ctx, (String) v.get("site_id"));
        return v;
    }

    private Map<String, Object> me(RequestContext ctx) {
        UserAccess a = access.load(ctx.userId());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("can_design", a.can("methods.design", ctx.siteId()));
        out.put("can_approve", a.can("methods.approve", ctx.siteId()));
        out.put("can_catalog", a.can("catalog.edit", ctx.siteId()));
        return out;
    }

    private Map<String, Object> withMe(RequestContext ctx, Map<String, Object> m) {
        Map<String, Object> out = new LinkedHashMap<>(m);
        out.putAll(me(ctx));
        return out;
    }

    public Map<String, Object> meAnswer(RequestContext ctx) {
        access.currentSite(ctx);
        return me(ctx);
    }

    public Map<String, Object> newOptions(RequestContext ctx) { return repo.newOptions(access.currentSite(ctx)); }

    // ---------------------------------------------------------------- tests
    public Map<String, Object> tests(RequestContext ctx) {
        String site = access.currentSite(ctx);
        return withMe(ctx, Map.of("rows", repo.tests(site)));
    }

    public Map<String, Object> createTest(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        Map<String, Object> b = map(body.get("row"));
        String name = str(b.get("test_name")).trim();
        if (name.isEmpty()) throw new RuleException("Name the test");
        return design(ctx, body, "Created by", "New test: " + name, d -> {
            Object id = d.one("SELECT create_test(?::uuid, ?, ?::uuid, ?::uuid) AS id", site, name, or(b.get("department_id")), or(b.get("method_id"))).get("id");
            return d.one("SELECT id, (SELECT id FROM test_version WHERE test_id = ?::uuid) AS version_id FROM test WHERE id = ?::uuid", id, id);
        });
    }

    public Map<String, Object> test(RequestContext ctx, String id) { return withMe(ctx, repo.testPage(testOf(ctx, id), ctx.userId())); }

    public Map<String, Object> newVersion(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> t = testOf(ctx, id);
        return design(ctx, body, "Created by", "New version of " + t.get("test_code") + " " + t.get("test_name"),
            d -> d.one("SELECT new_test_version(?::uuid) AS id", t.get("id")));
    }

    public Map<String, Object> copy(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> t = testOf(ctx, id);
        String site = RequestContext.isUuid(body.get("site_id")) ? body.get("site_id").toString() : access.currentSite(ctx);
        String name = str(body.get("test_name")).trim();
        if (name.isEmpty()) throw new RuleException("Name the copy");
        String kind = site.equals(t.get("site_id")) ? "Duplicate" : "Copy to another lab";
        return design(ctx, body, "Created by", kind + " of " + t.get("test_code") + " " + t.get("test_name") + ": " + name, d -> {
            Object n = d.one("SELECT copy_test(?::uuid, ?::uuid, ?) AS id", t.get("id"), site, name).get("id");
            return d.one("SELECT t.id, t.test_code, t.site_id, (SELECT id FROM test_version WHERE test_id = t.id) AS version_id FROM test t WHERE t.id = ?::uuid", n);
        });
    }

    // ---------------------------------------------------------------- a version in the designer
    public Map<String, Object> version(RequestContext ctx, String id) { return withMe(ctx, repo.versionPage(versionOf(ctx, id), ctx.userId())); }

    public List<Map<String, Object>> problems(RequestContext ctx, String id) { return repo.problems(versionOf(ctx, id).get("id")); }

    /** Tab 1: the test (name, department) and the version (method, procedure, rounding, below-LOQ reporting). */
    public Object header(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> v = versionOf(ctx, id);
        Map<String, Object> test = map(body.get("test")), version = map(body.get("version"));
        return design(ctx, body, "Changed by", "Test and reporting: " + vName(v), d -> {
            if (!test.isEmpty()) MethodsRepository.TEST.upsert(d, List.of(withId(test, v.get("test_id"))), Map.of());
            if (!version.isEmpty()) MethodsRepository.VERSION.upsert(d, List.of(withId(version, v.get("id"))), Map.of());
            return null;
        });
    }

    /** Tab 2: analytes (a grid save); result values go as PostgreSQL array text. */
    public List<Map<String, Object>> analytes(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> v = versionOf(ctx, id);
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Map<String, Object> r : rows(body)) {
            Map<String, Object> o = new LinkedHashMap<>(r);
            for (String k : List.of("result_values", "found_values", "invalid_values")) if (o.get(k) instanceof List<?> l) o.put(k, pgArr(l));
            rows.add(o);
        }
        boolean change = rows.stream().anyMatch(x -> truthy(x.get("id")));
        return design(ctx, body, change ? "Changed by" : "Created by", "Analytes: " + vName(v),
            d -> MethodsRepository.ANALYTES.upsert(d, rows, Map.of("test_version_id", v.get("id"))));
    }

    static String pgArr(List<?> a) {
        StringBuilder b = new StringBuilder("{");
        for (int i = 0; i < a.size(); i++) b.append(i > 0 ? "," : "").append('"').append(Js.string(a.get(i)).replace("\\", "\\\\").replace("\"", "\\\"")).append('"');
        return b.append('}').toString();
    }

    /** Tab 3: one step with its equipment types and the steps it follows (and, from a new step's side, the steps after it). */
    public Map<String, Object> saveStep(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> v = versionOf(ctx, id);
        Map<String, Object> s = map(body.get("step"));
        List<Map<String, Object>> equipment = list(body.get("equipment")).stream().filter(e -> RequestContext.isUuid(e.get("equipment_type_id"))).toList();
        List<Map<String, Object>> deps = list(body.get("deps")).stream().filter(e -> RequestContext.isUuid(e.get("depends_on_step_id"))).toList();
        String config;
        try { config = json.writeValueAsString(truthy(s.get("config")) ? s.get("config") : Map.of()); } catch (JsonProcessingException e) { throw new IllegalArgumentException(e); }
        String key = str(s.get("step_key")).trim();
        return design(ctx, body, truthy(s.get("id")) ? "Changed by" : "Created by", "Step \"" + str(s.get("step_name")) + "\": " + vName(v), d -> {
            Object stepId = s.get("id");
            if (truthy(stepId)) {
                if (d.one("SELECT id FROM workflow_step WHERE id = ?::uuid AND test_version_id = ?::uuid", stepId, v.get("id")) == null) throw new RuleException("Step not found");
                d.update("UPDATE workflow_step SET step_key = ?, step_name = ?, step_type = ?, department_id = ?::uuid, instructions = ?, config = ?::jsonb WHERE id = ?::uuid",
                    key, s.get("step_name"), s.get("step_type"), or(s.get("department_id")), or(s.get("instructions")), config, stepId);
            } else {
                stepId = d.one("""
                    INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type, department_id, instructions, config, sort_order)
                      VALUES (?::uuid, ?, ?, ?, ?::uuid, ?, ?::jsonb, COALESCE((SELECT max(sort_order) FROM workflow_step WHERE test_version_id = ?::uuid), 0) + 1) RETURNING id""",
                    v.get("id"), key, s.get("step_name"), s.get("step_type"), or(s.get("department_id")), or(s.get("instructions")), config, v.get("id")).get("id");
            }
            // equipment types: keep, add, change main, remove
            List<Map<String, Object>> curEq = d.rows("SELECT * FROM workflow_step_equipment WHERE step_id = ?::uuid AND status = 'Active'", stepId);
            for (Map<String, Object> e : curEq) {
                Map<String, Object> want = find(equipment, "equipment_type_id", e.get("equipment_type_id"));
                if (want == null) d.update("UPDATE workflow_step_equipment SET status = 'Inactive' WHERE id = ?::uuid", e.get("id"));
                else if (truthy(want.get("is_main")) != Boolean.TRUE.equals(e.get("is_main")))
                    d.update("UPDATE workflow_step_equipment SET is_main = ?::boolean WHERE id = ?::uuid", truthy(want.get("is_main")), e.get("id"));
            }
            for (Map<String, Object> w : equipment)
                if (find(curEq, "equipment_type_id", w.get("equipment_type_id")) == null)
                    d.update("INSERT INTO workflow_step_equipment (step_id, equipment_type_id, is_main) VALUES (?::uuid, ?::uuid, ?::boolean)", stepId, w.get("equipment_type_id"), truthy(w.get("is_main")));
            // the steps it comes after
            List<Map<String, Object>> curDeps = d.rows("SELECT * FROM workflow_step_dependency WHERE step_id = ?::uuid AND status = 'Active'", stepId);
            for (Map<String, Object> dep : curDeps) {
                Map<String, Object> want = find(deps, "depends_on_step_id", dep.get("depends_on_step_id"));
                if (want == null) d.update("UPDATE workflow_step_dependency SET status = 'Inactive' WHERE id = ?::uuid", dep.get("id"));
                else if (!depType(want).equals(dep.get("dependency_type")))
                    d.update("UPDATE workflow_step_dependency SET dependency_type = ? WHERE id = ?::uuid", depType(want), dep.get("id"));
            }
            for (Map<String, Object> w : deps)
                if (find(curDeps, "depends_on_step_id", w.get("depends_on_step_id")) == null)
                    d.update("INSERT INTO workflow_step_dependency (step_id, depends_on_step_id, dependency_type) VALUES (?::uuid, ?::uuid, ?)", stepId, w.get("depends_on_step_id"), depType(w));
            // steps that should now come after this one (chosen from the new step's side)
            if (body.get("followed_by") instanceof List<?> next) for (Object nextId : next) {
                if (!RequestContext.isUuid(nextId)) continue;
                if (d.one("SELECT id FROM workflow_step_dependency WHERE step_id = ?::uuid AND depends_on_step_id = ?::uuid AND status = 'Active'", nextId, stepId) == null)
                    d.update("INSERT INTO workflow_step_dependency (step_id, depends_on_step_id) VALUES (?::uuid, ?::uuid)", nextId, stepId);
            }
            return Map.of("id", stepId);
        });
    }

    private static String depType(Map<String, Object> d) { return truthy(d.get("dependency_type")) ? str(d.get("dependency_type")) : "Sequential"; }

    private static Map<String, Object> find(List<Map<String, Object>> rows, String key, Object value) {
        for (Map<String, Object> r : rows) if (value != null && value.equals(r.get(key))) return r;
        return null;
    }

    public Map<String, Object> removeStep(RequestContext ctx, String id, String stepId, Map<String, Object> body) {
        Map<String, Object> v = versionOf(ctx, id);
        return design(ctx, body, "Changed by", "Step removed: " + vName(v),
            d -> d.raw("UPDATE workflow_step SET status = 'Inactive' WHERE id = ?::uuid AND test_version_id = ?::uuid", stepId, v.get("id")));
    }

    public Object orderSteps(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> v = versionOf(ctx, id);
        return design(ctx, body, "Changed by", "Step order: " + vName(v), d -> {
            int i = 0;
            if (body.get("ids") instanceof List<?> ids) for (Object stepId : ids) {
                if (!RequestContext.isUuid(stepId)) continue;
                i++;
                d.update("UPDATE workflow_step SET sort_order = ?::int WHERE id = ?::uuid AND test_version_id = ?::uuid AND sort_order <> ?::int", i, stepId, v.get("id"), i);
            }
            return null;
        });
    }

    /** Tab 4: approval (signed "Approved by"; the database refuses authors and versions with errors). */
    public Map<String, Object> approve(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> v = versionOf(ctx, id);
        return design(ctx, body, "Approved by", "Test version: " + v.get("test_name") + " version " + Js.string(v.get("version_no")),
            d -> d.raw("SELECT approve_test_version(?::uuid)", v.get("id")));
    }

    /** Try a formula with example values (the same engine results will use); the engine's refusal is the answer. */
    public Map<String, Object> formulaTest(RequestContext ctx, Map<String, Object> body) {
        String f = str(body.get("formula"));
        Map<String, Object> chk = db.one("SELECT formula_check(?) AS problem, formula_tokens(?) AS tokens", f, f);
        Map<String, Object> out = new LinkedHashMap<>();
        if (chk.get("problem") != null) { out.put("problem", chk.get("problem")); out.put("tokens", chk.get("tokens")); return out; }
        try {
            String values = json.writeValueAsString(body.get("values") instanceof Map<?, ?> m ? m : Map.of());
            out.put("value", db.one("SELECT formula_eval(?, ?::jsonb) AS value", f, values).get("value"));
        } catch (RuntimeException | JsonProcessingException e) {
            PSQLException pg = ApiExceptionHandler.find(e);
            out.put("problem", pg != null && pg.getServerErrorMessage() != null ? pg.getServerErrorMessage().getMessage() : e.getMessage());
        }
        out.put("tokens", chk.get("tokens"));
        return out;
    }

    // ---------------------------------------------------------------- methods (SOPs)
    public Map<String, Object> methods(RequestContext ctx) { return withMe(ctx, Map.of("rows", repo.methods(access.currentSite(ctx)))); }

    public List<Map<String, Object>> saveMethods(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        List<Map<String, Object>> rows = rows(body);
        boolean change = rows.stream().anyMatch(x -> truthy(x.get("id")));
        return design(ctx, body, change ? "Changed by" : "Created by", "Methods (SOPs): " + rows.size() + " row(s)",
            d -> MethodsRepository.METHODS.upsert(d, rows, Map.of("site_id", site)));
    }

    // ---------------------------------------------------------------- helpers
    @SuppressWarnings("unchecked")
    static Map<String, Object> map(Object o) { return o instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of(); }

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> list(Object o) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (o instanceof List<?> l) for (Object x : l) out.add(x instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of());
        return out;
    }

    static List<Map<String, Object>> rows(Map<String, Object> b) { return list(b == null ? null : b.get("rows")); }

    static String str(Object o) { return o == null ? "" : Js.string(o); }

    static Object or(Object v) { return truthy(v) ? v : null; }

    static boolean truthy(Object v) {
        return v != null && !Boolean.FALSE.equals(v) && !"".equals(v) && !(v instanceof Number n && n.doubleValue() == 0);
    }

    static Map<String, Object> withId(Map<String, Object> row, Object id) {
        Map<String, Object> r = new LinkedHashMap<>(row);
        r.put("id", id);
        return r;
    }
}
