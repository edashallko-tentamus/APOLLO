package com.tentamus.lims.methods.repo;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.RecordWriter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Repository;

/** Tests and their versions as the designer shows them: analytes, steps, equipment types, dependencies, problems, lists. */
@Repository
public class MethodsRepository {
    public static final RecordWriter TEST = new RecordWriter("test", List.of("test_name", "department_id", "status"));
    public static final RecordWriter VERSION = new RecordWriter("test_version", List.of("method_id", "procedure_text", "change_summary", "rounding_mode",
        "rounding_digits", "nd_below_lod", "report_per_serving", "report_template_id"));
    public static final RecordWriter ANALYTES = new RecordWriter("test_version_analyte", List.of("analyte_id", "sort_order", "result_type", "reporting_unit", "loq", "lod",
        "rounding_mode", "rounding_digits", "hide_on_report", "hide_loq", "hide_lod", "default_spec_min", "default_spec_max", "default_spec_text", "result_values",
        "found_values", "invalid_values", "status", "uncertainty", "uncertainty_kind", "report_uncertainty"));
    public static final RecordWriter METHODS = new RecordWriter("method", List.of("method_name", "sop_code", "sop_link", "description", "status"));
    public static final RecordWriter SPECS = new RecordWriter("specification", List.of("analyte_id", "min_value", "max_value", "text_value", "unit", "source", "basis", "status"));
    private final Db db;

    public MethodsRepository(Db db) { this.db = db; }

    public Map<String, Object> test(String id) { return db.one("SELECT * FROM test_design_view WHERE id = ?::uuid", id); }

    public Map<String, Object> version(String id) {
        return db.one("SELECT v.*, t.site_id, t.test_name FROM test_version v JOIN test t ON t.id = v.test_id WHERE v.id = ?::uuid", id);
    }

    public List<Map<String, Object>> tests(String site) {
        return db.rows("""
            SELECT v.*, (SELECT count(*) FROM test_version_problems(v.draft_version_id) p WHERE p.severity = 'Error') AS draft_problems
              FROM test_design_view v WHERE v.site_id = ?::uuid OR v.site_id IS NULL ORDER BY v.site_id IS NULL, lower(v.test_name)""", site);
    }

    public Map<String, Object> newOptions(String site) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("departments", db.rows("SELECT id, department_code, department_name FROM department WHERE site_id = ?::uuid AND status = 'Active' ORDER BY department_code", site));
        out.put("methods", db.rows("SELECT id, method_name, sop_code FROM method WHERE site_id = ?::uuid AND status = 'Active' ORDER BY method_name", site));
        return out;
    }

    /** A test's page: its versions, the copies made from it and the labs the person can copy it to. */
    public Map<String, Object> testPage(Map<String, Object> t, String user) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("test", t);
        out.put("versions", db.rows("""
            SELECT v.id, v.version_no, v.status, v.effective_from, v.change_summary, v.created_at, cu.full_name AS created_by_name,
                au.full_name AS approved_by_name, v.approved_at, m.method_name, m.sop_code
              FROM test_version v JOIN app_user cu ON cu.id = v.created_by LEFT JOIN app_user au ON au.id = v.approved_by LEFT JOIN method m ON m.id = v.method_id
             WHERE v.test_id = ?::uuid ORDER BY v.version_no DESC""", t.get("id")));
        out.put("copies", db.rows("SELECT t.id, t.test_code, t.test_name, s.site_code FROM test t LEFT JOIN lab_site s ON s.id = t.site_id WHERE t.copied_from_test_id = ?::uuid ORDER BY t.test_code", t.get("id")));
        out.put("sites", db.rows("SELECT s.id, s.site_code, s.site_name FROM lab_site s WHERE s.status = 'Active' AND user_can_access_site(?::uuid, s.id) ORDER BY s.site_code", user));
        return out;
    }

    /** Everything the designer shows for one version, with the lists its pickers offer. */
    public Map<String, Object> versionPage(Map<String, Object> v, String user) {
        Object id = v.get("id"), testId = v.get("test_id"), site = v.get("site_id");
        Map<String, Object> version = new LinkedHashMap<>(v);
        Map<String, Object> approver = v.get("approved_by") == null ? null : db.one("SELECT full_name FROM app_user WHERE id = ?::uuid", v.get("approved_by"));
        version.put("approved_by_name", approver == null ? null : approver.get("full_name"));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("version", version);
        out.put("test", db.one("SELECT * FROM test_design_view WHERE id = ?::uuid", testId));
        out.put("analytes", db.rows("""
            SELECT a.*, an.analyte_name, an.analyte_code, an.analyte_class FROM test_version_analyte a JOIN analyte an ON an.id = a.analyte_id
             WHERE a.test_version_id = ?::uuid AND a.status = 'Active' ORDER BY a.sort_order, an.analyte_name""", id));
        out.put("steps", db.rows("""
            SELECT s.*, d.department_code, step_token_fields(s.id) AS tokens FROM workflow_step s LEFT JOIN department d ON d.id = s.department_id
             WHERE s.test_version_id = ?::uuid AND s.status = 'Active' ORDER BY s.sort_order, s.step_key""", id));
        out.put("equipment", db.rows("""
            SELECT e.id, e.step_id, e.equipment_type_id, e.is_main, et.type_name FROM workflow_step_equipment e JOIN equipment_type et ON et.id = e.equipment_type_id
              JOIN workflow_step s ON s.id = e.step_id WHERE s.test_version_id = ?::uuid AND e.status = 'Active' ORDER BY e.is_main DESC, et.type_name""", id));
        out.put("deps", db.rows("""
            SELECT d.id, d.step_id, d.depends_on_step_id, d.dependency_type FROM workflow_step_dependency d JOIN workflow_step s ON s.id = d.step_id
             WHERE s.test_version_id = ?::uuid AND d.status = 'Active'""", id));
        out.put("problems", problems(id));
        out.put("versions", db.rows("SELECT id, version_no, status FROM test_version WHERE test_id = ?::uuid ORDER BY version_no DESC", testId));
        out.put("entry", db.one("SELECT * FROM test_catalogue WHERE test_id = ?::uuid", testId));
        out.put("qcCriteria", db.rows("SELECT * FROM qc_criteria(?::uuid)", id));   // the limit each QC applies to each analyte (WD-1.2)
        out.put("authors", db.rows("SELECT u.full_name FROM test_version_authors(?::uuid) a JOIN app_user u ON u.id = a.user_id ORDER BY u.full_name", id)
            .stream().map(a -> a.get("full_name")).toList());
        out.put("i_worked_on_it", db.one("SELECT 1 AS x FROM test_version_authors(?::uuid) a WHERE a.user_id = ?::uuid", id, user) != null);
        Map<String, Object> lists = new LinkedHashMap<>();
        lists.put("departments", db.rows("""
            SELECT d.id, d.department_code, d.department_name, department_has_people(d.id) AS has_people,
                (SELECT string_agg(g.group_name, ', ') FROM lab_group g WHERE g.department_id = d.id AND g.status = 'Active') AS groups
              FROM department d WHERE d.site_id IS NOT DISTINCT FROM ?::uuid AND d.status = 'Active' ORDER BY d.department_code""", site));
        lists.put("types", db.rows("SELECT id, type_name FROM equipment_type WHERE site_id IS NOT DISTINCT FROM ?::uuid AND status = 'Active' ORDER BY type_name", site));
        lists.put("methods", db.rows("SELECT id, method_code, method_name, sop_code, status FROM method WHERE site_id IS NOT DISTINCT FROM ?::uuid ORDER BY method_name", site));
        lists.put("analytes", db.rows("SELECT id, analyte_code, analyte_name, analyte_class FROM analyte WHERE status = 'Active' ORDER BY analyte_name"));
        lists.put("units", db.rows("SELECT unit_code FROM unit_of_measure WHERE status = 'Active' ORDER BY sort_order, unit_code").stream().map(u -> u.get("unit_code")).toList());
        lists.put("tests", db.rows("""
            SELECT t.id, t.test_code, t.test_name FROM test t WHERE t.status = 'Active' AND t.id <> ?::uuid AND (t.site_id IS NULL OR t.site_id IS NOT DISTINCT FROM ?::uuid)
             ORDER BY t.test_name""", testId, site));
        lists.put("qcTypes", db.rows("SELECT * FROM qc_type ORDER BY sort_order"));
        lists.put("limitTypes", db.rows("SELECT * FROM qc_limit_type ORDER BY sort_order"));
        lists.put("categories", db.rows("SELECT id, category_name FROM product_category WHERE status = 'Active' ORDER BY sort_order, category_name"));
        // report templates this test may use (its lab's and every lab's; migration 030) and the lab's default
        lists.put("report_templates", db.rows("""
            SELECT id, template_code, template_name, site_id, status::text AS status FROM report_template WHERE (site_id IS NULL OR site_id IS NOT DISTINCT FROM ?::uuid)
             ORDER BY site_id NULLS FIRST, template_code""", site));
        lists.put("default_report_template", db.one("SELECT default_report_template(?::uuid) AS id", site).get("id"));
        out.put("lists", lists);
        return out;
    }

    public List<Map<String, Object>> problems(Object versionId) { return db.rows("SELECT * FROM test_version_problems(?::uuid)", versionId); }

    public List<Map<String, Object>> methods(String site) {
        return db.rows("""
            SELECT m.*, (SELECT count(DISTINCT v.test_id) FROM test_version v WHERE v.method_id = m.id) AS test_count
              FROM method m WHERE m.site_id = ?::uuid ORDER BY lower(m.method_name)""", site);
    }
}
