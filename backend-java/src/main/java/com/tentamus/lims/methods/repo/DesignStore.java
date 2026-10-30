package com.tentamus.lims.methods.repo;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.methods.domain.DesignFacts;
import com.tentamus.lims.methods.domain.TestDefinition;
import com.tentamus.lims.methods.domain.TestVersion;
import com.tentamus.lims.methods.domain.VersionAnalyte;
import com.tentamus.lims.methods.domain.VersionDesign;
import com.tentamus.lims.methods.domain.WorkflowGraph;
import com.tentamus.lims.methods.domain.WorkflowStep;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import org.springframework.stereotype.Repository;

/** Loads and saves the Workflow Designer's domain objects inside a transaction (SQL only here). */
@Repository
public class DesignStore {

    public TestDefinition test(Db d, Object id) { return id == null ? null : TestDefinition.of(d.one("SELECT * FROM test WHERE id = ?::uuid", id)); }

    public TestVersion version(Db d, Object id) { return id == null ? null : TestVersion.of(d.one("SELECT * FROM test_version WHERE id = ?::uuid", id)); }

    public TestVersion lockVersion(Db d, Object id) { return TestVersion.of(d.one("SELECT * FROM test_version WHERE id = ?::uuid FOR UPDATE", id)); }

    public List<TestVersion> versions(Db d, Object testId) {
        return d.rows("SELECT * FROM test_version WHERE test_id = ?::uuid ORDER BY version_no", testId).stream().map(TestVersion::of).toList();
    }

    public Map<String, Object> row(Db d, String table, Object id) {
        if (!Set.of("test_version_analyte", "workflow_step", "specification", "method").contains(table)) throw new IllegalArgumentException(table);
        return id == null ? null : d.one("SELECT * FROM " + table + " WHERE id = ?::uuid", id);
    }

    public String siteOf(Db d, String table, Object id) {
        if (!Set.of("department", "equipment_type", "method").contains(table)) throw new IllegalArgumentException(table);
        Map<String, Object> r = id == null ? null : d.one("SELECT site_id FROM " + table + " WHERE id = ?::uuid", id);
        return r == null ? null : (String) r.get("site_id");
    }

    public TestVersion.Template template(Db d, Object id) {
        Map<String, Object> r = id == null ? null : d.one("SELECT id, template_name, site_id, status::text AS status FROM report_template WHERE id = ?::uuid", id);
        return r == null ? null : new TestVersion.Template((String) r.get("id"), (String) r.get("template_name"), (String) r.get("site_id"), (String) r.get("status"));
    }

    public boolean analyteActive(Db d, Object id) { return d.one("SELECT 1 AS x FROM analyte WHERE id = ?::uuid AND status = 'Active'", id) != null; }

    public String analyteName(Db d, Object id) {
        Map<String, Object> r = id == null ? null : d.one("SELECT analyte_name FROM analyte WHERE id = ?::uuid", id);
        return r == null ? null : (String) r.get("analyte_name");
    }

    public VersionAnalyte.Units units(Db d) {
        Map<String, String> m = new HashMap<>();
        for (Map<String, Object> u : d.rows("SELECT unit_code FROM unit_of_measure WHERE status = 'Active'")) m.putIfAbsent(u.get("unit_code").toString().toLowerCase(), u.get("unit_code").toString());
        return new VersionAnalyte.Units(m, (String) d.one("SELECT array_to_string(enum_range(NULL::unit_dimension), ', ') AS d").get("d"));
    }

    /** The version with its analytes, steps, connections and equipment, and what its review looks up. */
    public VersionDesign design(Db d, TestVersion v) {
        TestDefinition t = test(d, v.testId());
        List<VersionAnalyte> analytes = d.rows("""
            SELECT a.*, an.analyte_name, an.analyte_class FROM test_version_analyte a JOIN analyte an ON an.id = a.analyte_id
             WHERE a.test_version_id = ?::uuid AND a.status = 'Active' ORDER BY a.sort_order, an.analyte_name""", v.id()).stream().map(VersionAnalyte::of).toList();
        return new VersionDesign(t, v, analytes, graph(d, v.id()), equipment(d, v.id()), facts(d, t.siteId()));
    }

    public WorkflowGraph graph(Db d, Object versionId) {
        List<WorkflowStep> steps = d.rows("SELECT * FROM workflow_step WHERE test_version_id = ?::uuid", versionId).stream().map(WorkflowStep::of).toList();
        List<WorkflowGraph.Dependency> deps = d.rows("""
            SELECT d.* FROM workflow_step_dependency d JOIN workflow_step s ON s.id = d.step_id WHERE s.test_version_id = ?::uuid ORDER BY d.created_at""", versionId)
            .stream().map(WorkflowGraph.Dependency::of).toList();
        return new WorkflowGraph(steps, deps);
    }

    public List<VersionDesign.Equipment> equipment(Db d, Object versionId) {
        return d.rows("""
            SELECT e.step_id, e.equipment_type_id, e.is_main FROM workflow_step_equipment e JOIN workflow_step s ON s.id = e.step_id
             WHERE s.test_version_id = ?::uuid AND e.status = 'Active'""", versionId)
            .stream().map(r -> new VersionDesign.Equipment((String) r.get("step_id"), (String) r.get("equipment_type_id"), Boolean.TRUE.equals(r.get("is_main")))).toList();
    }

    public List<Map<String, Object>> activeAnalyteRows(Db d, Object versionId) {
        return d.rows("SELECT * FROM test_version_analyte WHERE test_version_id = ?::uuid AND status = 'Active'", versionId);
    }

    /** Everyone who created or changed the version or any of its parts (from the audit trail), and its creator. */
    public Set<String> authors(Db d, Object versionId) {
        Set<String> out = new HashSet<>();
        for (Map<String, Object> r : d.rows("""
            WITH parts(t, id) AS (
                SELECT 'test_version', ?::uuid
                UNION ALL SELECT 'test_version_analyte', id FROM test_version_analyte WHERE test_version_id = ?::uuid
                UNION ALL SELECT 'workflow_step', id FROM workflow_step WHERE test_version_id = ?::uuid
                UNION ALL SELECT 'workflow_step_equipment', e.id FROM workflow_step_equipment e JOIN workflow_step s ON s.id = e.step_id WHERE s.test_version_id = ?::uuid
                UNION ALL SELECT 'workflow_step_dependency', x.id FROM workflow_step_dependency x JOIN workflow_step s ON s.id = x.step_id WHERE s.test_version_id = ?::uuid)
            SELECT DISTINCT a.changed_by AS u FROM audit_log a JOIN parts ON parts.t = a.table_name AND parts.id = a.record_id
            UNION SELECT created_by FROM test_version WHERE id = ?::uuid""", versionId, versionId, versionId, versionId, versionId, versionId))
            if (r.get("u") != null) out.add(r.get("u").toString());
        return out;
    }

    /** The database's permission check (permissions stay in the database until the permissions wave). */
    public void requirePermission(Db d, String code, Object site) { d.one("SELECT require_methods_permission(?, ?::uuid) AS x", code, site); }

    public boolean canViewSite(Db d, Object user, Object site) {
        return Boolean.TRUE.equals(d.one("SELECT user_can_view_site(?::uuid, ?::uuid) AS ok", user, site).get("ok"));
    }

    /** Whether the lab asks for a passing verification, and whether this design has one (the kept version_verification). */
    public boolean[] verification(Db d, Object versionId, Object site) {
        Map<String, Object> r = d.one("""
            SELECT COALESCE((SELECT require_workflow_verification FROM lab_site WHERE id = ?::uuid), false) AS req, version_verification(?::uuid) IS NOT NULL AS ok""", site, versionId);
        return new boolean[] {Boolean.TRUE.equals(r.get("req")), Boolean.TRUE.equals(r.get("ok"))};
    }

    /** Runs a write the designer makes on the system's behalf (the catalogue entry of a new test, approval): the kept triggers let it through. */
    public <T> T internal(Db d, Function<Db, T> work) {
        Object was = d.one("SELECT COALESCE(current_setting('lims.methods_internal', true), '') AS w").get("w");
        d.one("SELECT set_config('lims.methods_internal', '1', true)");
        try { return work.apply(d); } finally { d.one("SELECT set_config('lims.methods_internal', ?, true)", was); }
    }

    public String insert(Db d, String table, Map<String, Object> vals) {
        Map<String, Object> nn = new LinkedHashMap<>();
        vals.forEach((k, v) -> { if (v != null) nn.put(k, v); });
        String cols = String.join(", ", nn.keySet()), marks = String.join(", ", nn.keySet().stream().map(k -> "config".equals(k) ? "?::jsonb" : "?").toList());
        return (String) d.one("INSERT INTO " + ident(table) + " (" + cols + ") VALUES (" + marks + ") RETURNING id", nn.values().toArray()).get("id");
    }

    private static String ident(String s) {
        if (!s.matches("^[a-z_]+$")) throw new IllegalArgumentException(s);
        return s;
    }

    /** The facts a version's review needs at its lab, each looked up once. */
    public DesignFacts facts(Db d, String site) {
        Map<String, Object> cache = new HashMap<>();
        return new DesignFacts() {
            @SuppressWarnings("unchecked")
            private <T> T once(String k, java.util.function.Supplier<T> f) { return (T) cache.computeIfAbsent(k, x -> f.get()); }

            private Map<String, Object> one(String key, String sql, Object id) {
                Map<String, Object> r = once(key + id, () -> id == null ? Map.of() : java.util.Objects.requireNonNullElse(d.one(sql, id), Map.of()));
                return r;
            }

            public String methodStatus(String id) { return (String) one("m", "SELECT status::text AS s FROM method WHERE id = ?::uuid", id).get("s"); }

            public String departmentName(String id) { return (String) one("d", "SELECT department_name AS n, department_has_people(id) AS p FROM department WHERE id = ?::uuid", id).get("n"); }

            public boolean departmentHasPeople(String id) { return Boolean.TRUE.equals(one("d", "SELECT department_name AS n, department_has_people(id) AS p FROM department WHERE id = ?::uuid", id).get("p")); }

            public boolean priced(String testId) { return !one("p", "SELECT 1 AS x FROM test_catalog_entry WHERE test_id = ?::uuid LIMIT 1", testId).isEmpty(); }

            public boolean qcType(String t) { return t != null && !one("q", "SELECT 1 AS x FROM qc_type WHERE qc_type = ?", t).isEmpty(); }

            public String limitShape(String t) { return t == null ? null : (String) one("l", "SELECT shape FROM qc_limit_type WHERE limit_type = ?", t).get("shape"); }

            private Map<String, Object> category(String id) { return one("c", "SELECT category_name, status::text AS status FROM product_category WHERE id::text = ?", id); }

            public String categoryName(String id) { return (String) category(id).get("category_name"); }

            public boolean categoryActive(String id) { return "Active".equals(category(id).get("status")); }

            public String analyteName(String id) { return (String) one("a", "SELECT analyte_name FROM analyte WHERE id::text = ?", id).get("analyte_name"); }

            public TestDefinition test(String id) {
                Map<String, Object> r = one("t", "SELECT * FROM test WHERE id = ?::uuid", id);
                return r.isEmpty() ? null : TestDefinition.of(r);
            }

            public List<String> publishedKeys() {
                return once("keys", () -> com.tentamus.lims.methods.domain.Values.list(d.one("SELECT logbook_published_keys(?::uuid) AS k", site).get("k")));
            }
        };
    }
}
