package com.tentamus.lims.methods.service;

import com.tentamus.lims.core.calc.Formula;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.access.UserAccess;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.signature.SignatureService.Meaning;
import com.tentamus.lims.core.web.ApiExceptionHandler;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.fasterxml.jackson.databind.JsonNode;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.methods.domain.*;
import com.tentamus.lims.methods.repo.DesignStore;
import com.tentamus.lims.methods.repo.MethodsRepository;
import java.util.Objects;
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
 * change is signed (Created by / Changed by, migration 015). The rules are the domain objects' (methods/domain, migration 066).
 */
@Service
public class DesignerService {
    private final Db db;
    private final AccessPolicy access;
    private final SignatureService signatures;
    private final MethodsRepository repo;
    private final ObjectMapper json;
    private final DesignStore store;

    public DesignerService(Db db, AccessPolicy access, SignatureService signatures, MethodsRepository repo, ObjectMapper json, DesignStore store) {
        this.db = db;
        this.access = access;
        this.signatures = signatures;
        this.repo = repo;
        this.json = json;
        this.store = store;
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
            store.requirePermission(d, "methods.design", site);
            Map<String, Object> t = new LinkedHashMap<>();
            t.put("test_name", name);
            t.put("site_id", site);
            t.put("department_id", or(b.get("department_id")));
            t = TestDefinition.checked(null, t, store.siteOf(d, "department", t.get("department_id")));
            String id = store.insert(d, "test", t);
            Object method = or(b.get("method_id"));
            if (method != null && !site.equals(store.siteOf(d, "method", method))) throw RuleException.database("The method must belong to the test's own lab");
            store.insert(d, "test_version", TestVersion.firstDraft(id, (String) method, null));
            store.internal(d, x -> store.insert(x, "test_catalog_entry", Map.of("test_id", id)));
            return d.one("SELECT id, (SELECT id FROM test_version WHERE test_id = ?::uuid) AS version_id FROM test WHERE id = ?::uuid", id, id);
        });
    }

    public Map<String, Object> test(RequestContext ctx, String id) { return withMe(ctx, repo.testPage(testOf(ctx, id), ctx.userId())); }

    public Map<String, Object> newVersion(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> t = testOf(ctx, id);
        return design(ctx, body, "Created by", "New version of " + t.get("test_code") + " " + t.get("test_name"), d -> {
            TestDefinition test = store.test(d, t.get("id"));
            store.requirePermission(d, "methods.design", test.siteId());
            List<TestVersion> versions = store.versions(d, test.id());
            TestVersion.assertNoDraft(versions);
            TestVersion src = TestVersion.sourceOf(versions);
            int no = TestVersion.nextNumber(versions);
            Map<String, Object> nv = src == null ? TestVersion.firstDraft(test.id(), null, null) : src.draftFrom(test.id(), no, src.methodId(), null);
            nv.put("version_no", no);
            String v = store.insert(d, "test_version", nv);
            if (src != null) copyContent(d, src, v, test.siteId(), test.siteId());
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("id", v);
            return out;
        });
    }

    /** Duplicate in the lab, or copy to another lab: a new test with a Draft version 1, its method, content and catalogue terms. */
    public Map<String, Object> copy(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> t = testOf(ctx, id);
        String site = RequestContext.isUuid(body.get("site_id")) ? body.get("site_id").toString() : access.currentSite(ctx);
        String name = str(body.get("test_name")).trim();
        if (name.isEmpty()) throw new RuleException("Name the copy");
        String kind = site.equals(t.get("site_id")) ? "Duplicate" : "Copy to another lab";
        return design(ctx, body, "Created by", kind + " of " + t.get("test_code") + " " + t.get("test_name") + ": " + name, d -> {
            TestDefinition from = store.test(d, t.get("id"));
            if (from.siteId() != null && !store.canViewSite(d, ctx.userId(), from.siteId())) throw RuleException.database("You cannot see the lab this test belongs to");
            store.requirePermission(d, "methods.design", site);
            boolean sameLab = site.equals(from.siteId());
            TestVersion src = TestVersion.sourceOf(store.versions(d, from.id()));
            String method = null;
            if (src != null && src.methodId() != null) {
                SopMethod m = SopMethod.of(store.row(d, "method", src.methodId()));
                if (site.equals(m.siteId())) method = m.id();
                else {
                    Map<String, Object> same = d.one("SELECT id FROM method WHERE site_id = ?::uuid AND lower(method_name) = lower(?)", site, m.name());
                    method = same != null ? (String) same.get("id") : store.insert(d, "method", SopMethod.checked(null, m.copyFor(site)));
                }
            }
            Map<String, Object> nt = new LinkedHashMap<>();
            nt.put("test_name", name);
            nt.put("site_id", site);
            nt.put("department_id", sameLab ? from.departmentId() : mapDepartment(d, from.departmentId(), site));
            nt.put("copied_from_test_id", from.id());
            nt = TestDefinition.checked(null, nt, store.siteOf(d, "department", nt.get("department_id")));
            String test = store.insert(d, "test", nt);
            String summary = "Copied from " + from.label() + (src == null ? "" : " version " + src.versionNo());
            String v = store.insert(d, "test_version", src == null ? TestVersion.firstDraft(test, method, summary) : src.draftFrom(test, 1, method, summary));
            if (src != null) copyContent(d, src, v, from.siteId(), site);
            store.internal(d, x -> copyCatalogue(x, from.id(), test));
            return d.one("SELECT t.id, t.test_code, t.site_id, (SELECT id FROM test_version WHERE test_id = t.id) AS version_id FROM test t WHERE t.id = ?::uuid", test);
        });
    }

    private String mapDepartment(Db d, String dept, String site) {
        Map<String, Object> r = dept == null ? null : d.one("""
            SELECT d2.id FROM department d1 JOIN department d2 ON upper(d2.department_code) = upper(d1.department_code) AND d2.site_id = ?::uuid
             WHERE d1.id = ?::uuid AND d2.status = 'Active'""", site, dept);
        return r == null ? null : (String) r.get("id");
    }

    /** A copy's catalogue terms come too (prices then changed in the catalogue); never in the public catalogue. */
    private Object copyCatalogue(Db d, String fromTest, String toTest) {
        Map<String, Object> e = d.one("SELECT * FROM test_catalog_entry WHERE test_id = ?::uuid", fromTest);
        if (e == null) return store.insert(d, "test_catalog_entry", Map.of("test_id", toTest));
        Map<String, Object> n = new LinkedHashMap<>();
        n.put("test_id", toTest);
        for (String k : List.of("description", "pricing_mode", "base_price", "prep_fee", "standard_tat", "tat_unit", "cutoff_time", "rush_schedule_id")) n.put(k, e.get(k));
        n.put("show_in_public_catalogue", false);
        String entry = store.insert(d, "test_catalog_entry", n);
        d.update("INSERT INTO test_analyte_price (catalog_entry_id, analyte_id, price) SELECT ?::uuid, analyte_id, price FROM test_analyte_price WHERE catalog_entry_id = ?::uuid AND status = 'Active'",
            entry, e.get("id"));
        return entry;
    }

    /** Copies a version's analytes, steps, equipment types and connections into a new Draft (another lab: mapped by code and name). */
    private void copyContent(Db d, TestVersion src, String to, String fromSite, String toSite) {
        boolean sameLab = Objects.equals(fromSite, toSite);
        VersionDesign design = store.design(d, src);
        VersionDesign.Copy copy = design.copyTo(to, sameLab, new VersionDesign.LabMap() {
            public String department(String id) { return mapDepartment(d, id, toSite); }

            public String equipmentType(String id) {
                Map<String, Object> r = d.one("""
                    SELECT e2.id FROM equipment_type e1 JOIN equipment_type e2 ON lower(e2.type_name) = lower(e1.type_name) AND e2.site_id = ?::uuid AND e2.status = 'Active'
                     WHERE e1.id = ?::uuid LIMIT 1""", toSite, id);
                return r == null ? null : (String) r.get("id");
            }
        }, store.activeAnalyteRows(d, src.id()));
        for (Map<String, Object> a : copy.analytes()) store.insert(d, "test_version_analyte", a);
        Map<String, String> ids = new LinkedHashMap<>();
        for (VersionDesign.StepCopy s : copy.steps()) {
            Map<String, Object> row = store.row(d, "workflow_step", s.step().id());
            String n = store.insert(d, "workflow_step", s.step().copyRow(to, s.department(), (String) row.get("instructions")));
            ids.put(s.step().id(), n);
            for (VersionDesign.Equipment e : s.equipment())
                d.update("INSERT INTO workflow_step_equipment (step_id, equipment_type_id, is_main) VALUES (?::uuid, ?::uuid, ?::boolean)", n, e.typeId(), e.main());
        }
        for (String[] l : copy.connections())
            d.update("INSERT INTO workflow_step_dependency (step_id, depends_on_step_id, dependency_type) VALUES (?::uuid, ?::uuid, ?::dependency_type)", ids.get(l[0]), ids.get(l[1]), l[2]);
    }

    // ---------------------------------------------------------------- a version in the designer
    public Map<String, Object> version(RequestContext ctx, String id) {
        Map<String, Object> v = versionOf(ctx, id);
        VersionDesign design = store.design(db, TestVersion.of(v));
        return withMe(ctx, repo.versionPage(v, ctx.userId(), design, store.authors(db, v.get("id"))));
    }

    public List<Map<String, Object>> problems(RequestContext ctx, String id) {
        return store.design(db, TestVersion.of(versionOf(ctx, id))).problems().stream().map(Problem::row).toList();
    }

    /** Tab 1: the test (name, department) and the version (method, procedure, rounding, below-LOQ reporting, report template). */
    public Object header(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> v = versionOf(ctx, id);
        Map<String, Object> test = MethodsRepository.TEST.pick(map(body.get("test"))), version = MethodsRepository.VERSION.pick(map(body.get("version")));
        return design(ctx, body, "Changed by", "Test and reporting: " + vName(v), d -> {
            TestDefinition t = store.test(d, v.get("test_id"));
            if (!test.isEmpty()) {
                Object dept = test.containsKey("department_id") ? test.get("department_id") : t.departmentId();
                MethodsRepository.TEST.update(d, t.id(), TestDefinition.checked(t, test, store.siteOf(d, "department", dept)));
            }
            if (!version.isEmpty()) {
                TestVersion tv = store.version(d, v.get("id"));
                Object method = version.containsKey("method_id") ? version.get("method_id") : tv.methodId();
                MethodsRepository.VERSION.update(d, tv.id(), tv.checkedSettings(version, store.siteOf(d, "method", method), t.siteId(), store.template(d, version.get("report_template_id"))));
            }
            return null;
        });
    }

    /** Tab 2: analytes (a grid save), each checked by its version and as an analyte of it. */
    public List<Map<String, Object>> analytes(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> v = versionOf(ctx, id);
        List<Map<String, Object>> rows = rows(body);
        boolean change = rows.stream().anyMatch(x -> truthy(x.get("id")));
        return design(ctx, body, change ? "Changed by" : "Created by", "Analytes: " + vName(v), d -> {
            VersionAnalyte.Units units = store.units(d);
            List<Map<String, Object>> out = new ArrayList<>();
            for (Map<String, Object> r : rows) {
                Map<String, Object> vals = MethodsRepository.ANALYTES.pick(r);
                if (r.get("id") != null) {
                    if (vals.isEmpty()) continue;
                    Map<String, Object> before = store.row(d, "test_version_analyte", r.get("id"));
                    if (before == null) { out.add(null); continue; }
                    store.version(d, before.get("test_version_id")).assertEditable();
                    out.add(MethodsRepository.ANALYTES.update(d, r.get("id").toString(), VersionAnalyte.checked(before, vals, true, units)));
                } else {
                    store.version(d, v.get("id")).assertEditable();
                    Map<String, Object> ok = new LinkedHashMap<>(VersionAnalyte.checked(null, vals, store.analyteActive(d, vals.get("analyte_id")), units));
                    ok.put("test_version_id", v.get("id"));
                    out.add(MethodsRepository.ANALYTES.insert(d, ok, "id"));
                }
            }
            return out;
        });
    }

    /** Tab 3: one step with its equipment types and the steps it follows (and, from a new step's side, the steps after it). */
    public Map<String, Object> saveStep(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> v = versionOf(ctx, id);
        Map<String, Object> s = map(body.get("step"));
        List<Map<String, Object>> equipment = list(body.get("equipment")).stream().filter(e -> RequestContext.isUuid(e.get("equipment_type_id"))).toList();
        List<Map<String, Object>> deps = list(body.get("deps")).stream().filter(e -> RequestContext.isUuid(e.get("depends_on_step_id"))).toList();
        JsonNode config = json.valueToTree(truthy(s.get("config")) ? s.get("config") : Map.of());
        String key = str(s.get("step_key")).trim();
        String name = Values.trimmed(s.get("step_name"));
        return design(ctx, body, truthy(s.get("id")) ? "Changed by" : "Created by", "Step \"" + str(s.get("step_name")) + "\": " + vName(v), d -> {
            TestVersion tv = store.version(d, v.get("id"));
            tv.assertEditable();
            TestDefinition t = store.test(d, tv.testId());
            WorkflowGraph graph = store.graph(d, tv.id());
            Object dept = or(s.get("department_id"));
            WorkflowStep before = null;
            Object stepId = s.get("id");
            if (truthy(stepId)) {
                before = graph.step(stepId.toString());
                if (before == null) throw new RuleException("Step not found");
            }
            WorkflowStep.check(before, tv.id(), key, name, str(s.get("step_type")), config, (String) dept, store.siteOf(d, "department", dept), t.siteId());
            if (before != null) {
                d.update("UPDATE workflow_step SET step_key = ?, step_name = ?, step_type = ?::step_type, department_id = ?::uuid, instructions = ?, config = ?::jsonb WHERE id = ?::uuid",
                    key, name, s.get("step_type"), dept, or(s.get("instructions")), config.toString(), stepId);
            } else {
                stepId = d.one("""
                    INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type, department_id, instructions, config, sort_order)
                      VALUES (?::uuid, ?, ?, ?::step_type, ?::uuid, ?, ?::jsonb, COALESCE((SELECT max(sort_order) FROM workflow_step WHERE test_version_id = ?::uuid), 0) + 1) RETURNING id""",
                    tv.id(), key, name, s.get("step_type"), dept, or(s.get("instructions")), config.toString(), tv.id()).get("id");
                graph.add(WorkflowStep.of(store.row(d, "workflow_step", stepId)));
            }
            String sid = stepId.toString();
            // equipment types: keep, add, change main, remove (each of the test's own lab)
            List<Map<String, Object>> curEq = d.rows("SELECT * FROM workflow_step_equipment WHERE step_id = ?::uuid AND status = 'Active'", sid);
            for (Map<String, Object> e : curEq) {
                Map<String, Object> want = find(equipment, "equipment_type_id", e.get("equipment_type_id"));
                if (want == null) d.update("UPDATE workflow_step_equipment SET status = 'Inactive' WHERE id = ?::uuid", e.get("id"));
                else if (truthy(want.get("is_main")) != Boolean.TRUE.equals(e.get("is_main")))
                    d.update("UPDATE workflow_step_equipment SET is_main = ?::boolean WHERE id = ?::uuid", truthy(want.get("is_main")), e.get("id"));
            }
            for (Map<String, Object> w : equipment)
                if (find(curEq, "equipment_type_id", w.get("equipment_type_id")) == null) {
                    WorkflowStep.checkEquipmentType(store.siteOf(d, "equipment_type", w.get("equipment_type_id")), t.siteId());
                    d.update("INSERT INTO workflow_step_equipment (step_id, equipment_type_id, is_main) VALUES (?::uuid, ?::uuid, ?::boolean)", sid, w.get("equipment_type_id"), truthy(w.get("is_main")));
                }
            // the steps it comes after (never a loop)
            for (WorkflowGraph.Dependency dep : graph.activeOf(sid)) {
                Map<String, Object> want = find(deps, "depends_on_step_id", dep.dependsOn());
                if (want == null) {
                    d.update("UPDATE workflow_step_dependency SET status = 'Inactive' WHERE id = ?::uuid", dep.id());
                    graph.disconnect(dep.id());
                } else if (!depType(want).equals(dep.type()))
                    d.update("UPDATE workflow_step_dependency SET dependency_type = ?::dependency_type WHERE id = ?::uuid", depType(want), dep.id());
            }
            for (Map<String, Object> w : deps) connect(d, graph, sid, w.get("depends_on_step_id").toString(), depType(w));
            // steps that should now come after this one (chosen from the new step's side)
            if (body.get("followed_by") instanceof List<?> next) for (Object nextId : next)
                if (RequestContext.isUuid(nextId)) connect(d, graph, nextId.toString(), sid, "Sequential");
            return Map.of("id", stepId);
        });
    }

    private static void connect(Db d, WorkflowGraph graph, String step, String dependsOn, String type) {
        if (graph.active(step, dependsOn) != null) return;
        graph.assertCanConnect(step, dependsOn);
        Object id = d.one("INSERT INTO workflow_step_dependency (step_id, depends_on_step_id, dependency_type) VALUES (?::uuid, ?::uuid, ?::dependency_type) RETURNING id",
            step, dependsOn, type).get("id");
        graph.connect(id.toString(), step, dependsOn, type);
    }

    private static String depType(Map<String, Object> d) { return truthy(d.get("dependency_type")) ? str(d.get("dependency_type")) : "Sequential"; }

    private static Map<String, Object> find(List<Map<String, Object>> rows, String key, Object value) {
        for (Map<String, Object> r : rows) if (value != null && value.equals(r.get(key))) return r;
        return null;
    }

    /** Removing a step removes its connections and its equipment types too. */
    public Map<String, Object> removeStep(RequestContext ctx, String id, String stepId, Map<String, Object> body) {
        Map<String, Object> v = versionOf(ctx, id);
        return design(ctx, body, "Changed by", "Step removed: " + vName(v), d -> {
            WorkflowGraph graph = store.graph(d, v.get("id"));
            WorkflowStep s = RequestContext.isUuid(stepId) ? graph.step(stepId) : null;
            Map<String, Object> out = new LinkedHashMap<>();   // what Node answered for its UPDATE: no fields, no rows
            out.put("fields", List.of());
            out.put("rows", List.of());
            if (s == null || !s.active()) return out;
            store.version(d, v.get("id")).assertEditable();
            d.update("UPDATE workflow_step SET status = 'Inactive' WHERE id = ?::uuid", stepId);
            for (String dep : graph.remove(stepId)) d.update("UPDATE workflow_step_dependency SET status = 'Inactive' WHERE id = ?::uuid", dep);
            d.update("UPDATE workflow_step_equipment SET status = 'Inactive' WHERE status = 'Active' AND step_id = ?::uuid", stepId);
            return out;
        });
    }

    public Object orderSteps(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> v = versionOf(ctx, id);
        return design(ctx, body, "Changed by", "Step order: " + vName(v), d -> {
            TestVersion tv = store.version(d, v.get("id"));
            int i = 0;
            if (body.get("ids") instanceof List<?> ids) for (Object stepId : ids) {
                if (!RequestContext.isUuid(stepId)) continue;
                i++;
                if (d.one("SELECT 1 AS x FROM workflow_step WHERE id = ?::uuid AND test_version_id = ?::uuid AND sort_order <> ?::int", stepId, tv.id(), i) == null) continue;
                tv.assertEditable();
                d.update("UPDATE workflow_step SET sort_order = ?::int WHERE id = ?::uuid", i, stepId);
            }
            return null;
        });
    }

    /** Tab 4: approval, signed "Approved by": no Errors, not by an author, the verification gate where the lab has it. */
    public Map<String, Object> approve(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> v = versionOf(ctx, id);
        return design(ctx.orReason("Test version approved"), body, "Approved by", "Test version: " + v.get("test_name") + " version " + Js.string(v.get("version_no")), d -> {
            TestVersion tv = store.lockVersion(d, v.get("id"));
            tv.assertApprovable();
            TestDefinition t = store.test(d, tv.testId());
            store.requirePermission(d, "methods.approve", t.siteId());
            boolean[] gate = store.verification(d, tv.id(), t.siteId());
            TestVersion approved = tv.approve(ctx.userId(), store.design(d, tv).problems(), store.authors(d, tv.id()), gate[0], gate[1]);
            store.internal(d, x -> {
                x.update("UPDATE test_version SET status = 'Superseded' WHERE test_id = ?::uuid AND status = 'Effective'", t.id());
                return x.update("""
                    UPDATE test_version SET status = ?::test_version_status, effective_from = now(), approved_by = ?::uuid, approved_at = now(),
                           approval_signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid WHERE id = ?::uuid""", approved.status(), ctx.userId(), tv.id());
            });
            // the answer Node gave (the database function's empty result)
            return d.raw("SELECT ''::void AS approve_test_version");
        });
    }

    /** Try a formula with example values: Java checks it; the calculation engine (formula_eval, the database's) works it out. */
    public Map<String, Object> formulaTest(RequestContext ctx, Map<String, Object> body) {
        String f = str(body.get("formula"));
        Formula formula = Formula.of(f);
        String problem = formula.problem();
        Map<String, Object> out = new LinkedHashMap<>();
        if (problem != null) { out.put("problem", problem); out.put("tokens", formula.tokens()); return out; }
        try {
            String values = json.writeValueAsString(body.get("values") instanceof Map<?, ?> m ? m : Map.of());
            out.put("value", db.one("SELECT formula_eval(?, ?::jsonb) AS value", f, values).get("value"));
        } catch (RuntimeException | JsonProcessingException e) {
            PSQLException pg = ApiExceptionHandler.find(e);
            out.put("problem", pg != null && pg.getServerErrorMessage() != null ? pg.getServerErrorMessage().getMessage() : e.getMessage());
        }
        out.put("tokens", formula.tokens());
        return out;
    }

    // ---------------------------------------------------------------- methods (SOPs)
    public Map<String, Object> methods(RequestContext ctx) { return withMe(ctx, Map.of("rows", repo.methods(access.currentSite(ctx)))); }

    public List<Map<String, Object>> saveMethods(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        List<Map<String, Object>> rows = rows(body);
        boolean change = rows.stream().anyMatch(x -> truthy(x.get("id")));
        return design(ctx, body, change ? "Changed by" : "Created by", "Methods (SOPs): " + rows.size() + " row(s)", d -> {
            List<Map<String, Object>> out = new ArrayList<>();
            for (Map<String, Object> r : rows) {
                Map<String, Object> vals = MethodsRepository.METHODS.pick(r);
                if (r.get("id") != null) {
                    if (vals.isEmpty()) continue;
                    Map<String, Object> before = store.row(d, "method", r.get("id"));
                    out.add(before == null ? null : MethodsRepository.METHODS.update(d, r.get("id").toString(), SopMethod.checked(SopMethod.of(before), vals)));
                } else {
                    Map<String, Object> all = new LinkedHashMap<>(vals);
                    all.put("site_id", site);
                    out.add(MethodsRepository.METHODS.insert(d, SopMethod.checked(null, all), "id"));
                }
            }
            return out;
        });
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
