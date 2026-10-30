package com.tentamus.lims.testing.repo;

import com.fasterxml.jackson.databind.JsonNode;
import com.tentamus.lims.core.db.Db;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Repository;

/** What the testing screens read: the backlog, batch lists, one batch with everything recorded in it, QC Review. */
@Repository
public class TestingRepository {
    private final Db db;

    public TestingRepository(Db db) { this.db = db; }

    public Map<String, Object> batch(String id) { return db.one("SELECT * FROM test_batch_view WHERE id = ?::uuid", id); }

    public Map<String, Object> run(String id) {
        return db.one("""
            SELECT r.*, ws.step_name, ws.step_type, ws.step_key, ws.config, b.site_id, b.batch_code FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id
              JOIN test_batch b ON b.id = r.batch_id WHERE r.id = ?::uuid""", id);
    }

    public List<Map<String, Object>> backlog(String site) {
        return db.rows("""
            SELECT p.*, d.department_code, d.department_name, o.order_code, o.id AS lab_order_id, COALESCE(cl.display_name, cl.legal_name) AS client_name
                FROM test_pool_view p LEFT JOIN department d ON d.id = p.department_id JOIN sample s ON s.id = p.sample_id JOIN lab_order o ON o.id = s.lab_order_id
                JOIN client cl ON cl.id = o.client_id
               WHERE p.site_id = ?::uuid ORDER BY d.department_code NULLS LAST, p.test_name, p.priority_rank, p.due_date NULLS LAST, p.logged_at, p.sample_code""", site);
    }

    /** The largest batch each test version allows (its Batching step's max_samples). */
    public Map<String, Object> maxSamples(List<Object> versionIds) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map<String, Object> m : db.rows("""
            SELECT ws.test_version_id, (ws.config->>'max_samples')::int AS max_samples FROM workflow_step ws
             WHERE ws.step_type = 'Batching' AND ws.status = 'Active' AND ws.test_version_id = ANY(?::uuid[])""", versionIds))
            out.put((String) m.get("test_version_id"), m.get("max_samples"));
        return out;
    }

    public List<Map<String, Object>> people(Object site) {
        return db.rows("""
            SELECT u.id, u.full_name, u.username FROM app_user u WHERE u.is_active AND u.username <> 'system' AND user_has_permission_at(u.id, 'testing.perform', ?::uuid)
             ORDER BY u.full_name""", site);
    }

    /** One batch with its entries, steps, values, materials, equipment, files, results, QC verdicts, runs and timepoints. */
    public Map<String, Object> batchPage(Map<String, Object> b, String user) {
        Object id = b.get("id");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("batch", b);
        out.put("entries", db.rows("""
            SELECT e.*, s.id AS sample_id, s.sample_code, s.client_sample_id, s.matrix, s.description,
                 entry_product_category(e.id) AS product_category_id, (SELECT category_name FROM product_category WHERE id = entry_product_category(e.id)) AS product_category, rt.due_date, rt.rush_status::text AS rush_status,
                 p.label AS parent_label, rp.reason AS reprep_reason, dl.label AS daily_label, db.batch_code AS daily_batch_code, db.id AS daily_batch_id, rt.media_lot_id,
                 rr.status AS reprep_to_status, rr.reason AS reprep_to_reason, rb.batch_code AS reprep_to_batch_code, rb.id AS reprep_to_batch_id, ru.full_name AS reprep_by_name, rr.created_at AS reprep_at,
                 oe.label AS reprep_of_label, ob.batch_code AS reprep_of_batch_code, ob.id AS reprep_of_batch_id
               FROM batch_entry e LEFT JOIN requested_test rt ON rt.id = e.requested_test_id LEFT JOIN sample s ON s.id = rt.sample_id
               LEFT JOIN batch_entry p ON p.id = e.parent_entry_id LEFT JOIN reprep_request rp ON rp.id = e.reprep_request_id
               LEFT JOIN batch_entry dl ON dl.id = e.daily_of_entry_id LEFT JOIN test_batch db ON db.id = dl.batch_id
               LEFT JOIN LATERAL (SELECT x.* FROM reprep_request x WHERE x.origin_entry_id = e.id ORDER BY x.created_at DESC LIMIT 1) rr ON e.status = 'Superseded'
               LEFT JOIN test_batch rb ON rb.id = rr.batch_id LEFT JOIN app_user ru ON ru.id = rr.created_by
               LEFT JOIN batch_entry oe ON oe.id = rp.origin_entry_id LEFT JOIN test_batch ob ON ob.id = oe.batch_id
              WHERE e.batch_id = ?::uuid AND e.removed_at IS NULL ORDER BY e.position""", id));
        out.put("steps", db.rows("""
            SELECT r.id, r.status, r.fields, r.notes, r.completed_at, r.performed_by, pu.full_name AS performed_name, r.witness_id, wu.full_name AS witness_name,
                 ws.id AS step_id, ws.step_key, ws.step_name, ws.step_type, ws.sort_order, ws.config, ws.instructions,
                 COALESCE((SELECT jsonb_agg(jsonb_build_object('equipment_type_id', se.equipment_type_id, 'type_name', et.type_name, 'is_main', se.is_main))
                    FROM workflow_step_equipment se JOIN equipment_type et ON et.id = se.equipment_type_id WHERE se.step_id = ws.id AND se.status = 'Active'), '[]') AS equipment_types,
                 COALESCE((SELECT jsonb_agg(m.problem) FROM step_run_missing(r.id) m), '[]') AS missing
               FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id LEFT JOIN app_user pu ON pu.id = r.performed_by LEFT JOIN app_user wu ON wu.id = r.witness_id
              WHERE r.batch_id = ?::uuid ORDER BY ws.sort_order, ws.step_name""", id));
        out.put("analytes", db.rows("""
            SELECT tva.*, a.analyte_name, a.report_name FROM test_version_analyte tva JOIN analyte a ON a.id = tva.analyte_id
             WHERE tva.test_version_id = ?::uuid AND tva.status = 'Active' ORDER BY tva.sort_order, a.analyte_name""", b.get("test_version_id")));
        out.put("values", db.rows("""
            SELECT ev.*, u.full_name AS entered_by FROM entry_value ev JOIN step_run r ON r.id = ev.step_run_id JOIN app_user u ON u.id = ev.modified_by
             WHERE r.batch_id = ?::uuid AND ev.status = 'Active'""", id));
        out.put("materials", db.rows("""
            SELECT em.*, l.lot_code, COALESCE(l.item_name, ch.chemical_name) AS item_name, l.expiration_date, (SELECT entry_code FROM logbook_entry WHERE id = em.logbook_entry_id) AS logbook_entry_code
              FROM entry_material em JOIN step_run r ON r.id = em.step_run_id
              JOIN inventory_lot l ON l.id = em.lot_id LEFT JOIN chemical ch ON ch.id = l.chemical_id WHERE r.batch_id = ?::uuid AND em.status = 'Active' ORDER BY em.created_at""", id));
        out.put("equipment_used", db.rows("""
            SELECT q.*, e.equipment_code, e.equipment_name FROM entry_equipment q JOIN step_run r ON r.id = q.step_run_id JOIN equipment e ON e.id = q.equipment_id
             WHERE r.batch_id = ?::uuid AND q.status = 'Active' ORDER BY q.created_at""", id));
        out.put("attachments", db.rows("""
            SELECT a.id, a.step_run_id, a.label, a.analytical_run_no, a.created_at, d.file_name, d.size_bytes, u.full_name AS uploaded_by FROM step_attachment a JOIN step_run r ON r.id = a.step_run_id
              JOIN document_file d ON d.id = a.document_id JOIN app_user u ON u.id = a.created_by WHERE r.batch_id = ?::uuid AND a.status = 'Active' ORDER BY a.created_at""", id));
        out.put("reanalyses", db.rows("""
            SELECT x.*, u.full_name AS requested_by FROM reanalysis_request x JOIN step_run r ON r.id = x.step_run_id JOIN app_user u ON u.id = x.created_by
             WHERE r.batch_id = ?::uuid ORDER BY x.created_at""", id));
        out.put("results", db.rows("SELECT * FROM batch_results(?::uuid)", id));
        out.put("verdicts", db.rows("SELECT * FROM batch_qc_verdicts(?::uuid)", id));
        out.put("deps", db.rows("""
            SELECT d.step_id, d.depends_on_step_id FROM workflow_step_dependency d JOIN workflow_step ws ON ws.id = d.step_id
             WHERE ws.test_version_id = ?::uuid AND d.status = 'Active'""", b.get("test_version_id")));
        // the incubator's sensor over the load, when one is linked (0.25.0)
        out.put("loads", db.rows("""
            SELECT l.*, (SELECT to_jsonb(x) FROM sensor_range(l.equipment_id, 'temperature', l.time_in, COALESCE(l.time_out, clock_timestamp())) x) AS sensor
              FROM incubation_load_view l WHERE l.batch_id = ?::uuid AND l.status = 'Active' ORDER BY l.time_in""", id));
        out.put("splits", db.rows("SELECT v.*, split_alerts(v.id) AS alerts FROM split_request_view v WHERE v.batch_id = ?::uuid ORDER BY v.created_at", id));
        out.put("run_counts", db.rows("""
            SELECT r.id AS step_run_id, e.id AS entry_id, entry_runs(r.id, e.id) AS runs FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id
              JOIN batch_entry e ON e.batch_id = r.batch_id WHERE r.batch_id = ?::uuid AND ws.step_type = 'Data Entry'""", id));
        // analytical runs at the reading steps and which run each reading belongs to; timepoint reviews (WD-5, migration 021)
        out.put("runs", db.rows("""
            SELECT ar.step_run_id, ar.run_no, ar.reason, ar.created_at, u.full_name AS requested_by FROM analytical_run ar JOIN step_run r ON r.id = ar.step_run_id
              JOIN app_user u ON u.id = ar.created_by WHERE r.batch_id = ?::uuid ORDER BY ar.step_run_id, ar.run_no""", id));
        out.put("reading_runs", db.rows("""
            SELECT r.id AS step_run_id, e.id AS entry_id, g AS run_no, reading_run(r.id, e.id, g) AS run FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id
              JOIN batch_entry e ON e.batch_id = r.batch_id CROSS JOIN LATERAL generate_series(1, entry_runs(r.id, e.id)) g WHERE r.batch_id = ?::uuid AND ws.step_type = 'Data Entry'""", id));
        List<Map<String, Object>> timepoints = db.rows("""
            SELECT t.*, u.full_name AS released_by_name,
                 (SELECT COALESCE(jsonb_agg(p.id), '[]') FROM step_ancestors(t.step_id) a JOIN step_run p ON p.step_id = a.step_id AND p.batch_id = ?::uuid
                    JOIN workflow_step w ON w.id = p.step_id WHERE w.step_type <> 'QC Review') AS feeds
               FROM batch_timepoints(?::uuid) t LEFT JOIN app_user u ON u.id = t.released_by""", id, id);
        for (Map<String, Object> t : timepoints) t.put("keys", pgList(t.get("keys")));
        out.put("timepoints", timepoints);
        // the steps a reviewer may approve now: all once the batch waits for review; earlier, those feeding a timepoint ready for review
        if ("Awaiting Review".equals(b.get("status"))) out.put("markable", null);
        else {
            Set<String> markable = new LinkedHashSet<>();
            for (Map<String, Object> t : timepoints)
                if (Boolean.TRUE.equals(t.get("ready")) && !Boolean.TRUE.equals(t.get("released")) && t.get("feeds") instanceof JsonNode f) for (JsonNode x : f) markable.add(x.asText());
            out.put("markable", new ArrayList<>(markable));
        }
        // the reviewer's approval of each step (migration 020); readings that are not results (migration 039)
        out.put("review_marks", db.rows("SELECT s.*, u.full_name AS marked_by_name FROM review_step_runs(?::uuid) s LEFT JOIN app_user u ON u.id = s.marked_by", id));
        out.put("invalid_readings", db.rows("SELECT * FROM batch_invalid_readings(?::uuid)", id));
        Map<String, Object> categories = new LinkedHashMap<>();
        for (Map<String, Object> c : db.rows("SELECT id, category_name FROM product_category")) categories.put((String) c.get("id"), c.get("category_name"));
        out.put("categories", categories);
        out.put("performer", performer(id, user));
        // the analyst's picks of the reported reading (0.27.0, migration 048)
        out.put("picks", db.rows("""
            SELECT p.id, p.requested_test_id, p.analyte_id, p.entry_id, p.run_no, p.note, p.created_at, u.full_name AS picked_by, an.analyte_name
              FROM analyst_pick p JOIN app_user u ON u.id = p.created_by LEFT JOIN analyte an ON an.id = p.analyte_id WHERE p.batch_id = ?::uuid AND p.status = 'Active'""", id));
        return out;
    }

    /** Whether the person did bench work in the batch (performed or witnessed a step other than QC Review). */
    public boolean performer(Object batchId, String user) {
        return Boolean.TRUE.equals(db.one("""
            SELECT EXISTS (SELECT 1 FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = ?::uuid AND ws.step_type <> 'QC Review'
               AND ?::uuid IN (r.performed_by, r.witness_id)) AS x""", batchId, user).get("x"));
    }

    public boolean started(Object batchId) { return Boolean.TRUE.equals(db.one("SELECT batch_started(?::uuid) AS x", batchId).get("x")); }

    public long waiting(Object site, Object version) {
        return ((Number) db.one("SELECT count(*) AS n FROM test_pool_view WHERE site_id = ?::uuid AND test_version_id = ?::uuid", site, version).get("n")).longValue();
    }

    /** What can be picked at the bench: this lab's equipment (with availability and calibration) and usable lots. */
    public Map<String, Object> options(Map<String, Object> b) {
        Object site = b.get("site_id");
        List<Map<String, Object>> lots = db.rows("""
            SELECT l.id, l.lot_code, COALESCE(l.item_name, ch.chemical_name) AS item_name, l.manufacturer_lot, l.expiration_date, l.chemical_types, l.unit, lot_on_hand(l.id) AS on_hand,
                 (SELECT string_agg(a.analyte_name || COALESCE(' ' || trim(trailing '.' from trim(trailing '0' from la.concentration::text)) || ' ' || la.concentration_unit, ''), ', ' ORDER BY a.analyte_name)
                    FROM lot_analyte la JOIN analyte a ON a.id = la.analyte_id WHERE la.lot_id = l.id AND la.status = 'Active') AS analytes
               FROM inventory_lot l LEFT JOIN chemical ch ON ch.id = l.chemical_id
              WHERE l.site_id = ?::uuid AND l.receipt_status = 'Received' AND l.status = 'Available' AND (l.expiration_date IS NULL OR l.expiration_date >= site_today(l.site_id))
                AND (l.retest_date IS NULL OR l.retest_date >= site_today(l.site_id)) AND NOT ('Consumable' = ANY(l.chemical_types) AND cardinality(l.chemical_types) = 1)
              ORDER BY item_name, l.lot_code""", site);
        // lots that need QA testing before use (migration 040; media since 023): why one is not released for this batch's test
        for (Map<String, Object> m : db.rows("""
            SELECT l.id, lot_qa_problem(l.id, ?::uuid, ?::uuid) AS why FROM inventory_lot l
             WHERE l.site_id = ?::uuid AND lot_qa_required(l.id) AND lot_qa_problem(l.id, ?::uuid, ?::uuid) IS NOT NULL""",
            b.get("test_id"), b.get("id"), site, b.get("test_id"), b.get("id")))
            for (Map<String, Object> l : lots) if (l.get("id").equals(m.get("id"))) l.put("not_qualified", "QA testing: " + m.get("why"));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("equipment", db.rows("""
            SELECT id, equipment_code, equipment_name, equipment_type_id, type_name, availability, calibration_status FROM equipment_view
             WHERE site_id = ?::uuid AND admin_status <> 'Retired' ORDER BY type_name, equipment_name""", site));
        out.put("lots", lots);
        out.put("people", people(site));
        return out;
    }

    public List<Map<String, Object>> pool(Map<String, Object> b) {
        return db.rows("""
            SELECT p.*, COALESCE(cl.display_name, cl.legal_name) AS client_name FROM test_pool_view p JOIN sample s ON s.id = p.sample_id
                JOIN lab_order o ON o.id = s.lab_order_id JOIN client cl ON cl.id = o.client_id
               WHERE p.site_id = ?::uuid AND p.test_version_id = ?::uuid ORDER BY p.priority_rank, p.due_date NULLS LAST, p.logged_at, p.sample_code""",
            b.get("site_id"), b.get("test_version_id"));
    }

    /** QC Review: the items to report, the problems, QC verdicts and acceptances, stored results, timepoints and loads. */
    public Map<String, Object> review(Map<String, Object> b, String user) {
        Object id = b.get("id");
        boolean awaiting = "Awaiting Review".equals(b.get("status"));
        List<Map<String, Object>> items = awaiting ? db.rows("SELECT * FROM batch_review_items(?::uuid)", id) : new ArrayList<>();
        List<Object> problems = awaiting ? db.rows("SELECT problem FROM batch_review_problems(?::uuid)", id).stream().map(x -> x.get("problem")).toList() : List.of();
        List<Map<String, Object>> stored = db.rows("SELECT * FROM test_result_view WHERE batch_id = ?::uuid AND status = 'Active' ORDER BY sample_code, analyte_name", id);
        List<Object> ids = new ArrayList<>();
        for (String k : List.of("reviewed_by", "returned_by", "cancelled_by")) if (b.get(k) != null) ids.add(b.get(k));
        Map<Object, Object> name = new LinkedHashMap<>();
        for (Map<String, Object> p : db.rows("SELECT id, full_name FROM app_user WHERE id = ANY(?::uuid[])", ids)) name.put(p.get("id"), p.get("full_name"));
        // timepoint reviews (WD-5): what each releases, what stops it, and what was released
        List<Map<String, Object>> timepoints = db.rows("SELECT t.*, u.full_name AS released_by_name FROM batch_timepoints(?::uuid) t LEFT JOIN app_user u ON u.id = t.released_by", id);
        Set<Object> releasedKeys = new LinkedHashSet<>();
        for (Map<String, Object> t : timepoints) {
            t.put("keys", pgList(t.get("keys")));
            if (Boolean.TRUE.equals(t.get("released"))) releasedKeys.addAll((List<?>) t.get("keys"));
        }
        for (Map<String, Object> tp : timepoints) {
            List<Map<String, Object>> tpItems = new ArrayList<>();
            if (!Boolean.TRUE.equals(tp.get("released")) && Boolean.TRUE.equals(tp.get("ready")) && !List.of("Approved", "Cancelled").contains(b.get("status"))) {
                tp.put("problems", db.rows("SELECT problem FROM timepoint_problems(?::uuid)", tp.get("step_run_id")).stream().map(x -> x.get("problem")).toList());
                for (Object k : (List<?>) tp.get("keys")) if (!releasedKeys.contains(k)) tpItems.addAll(db.rows("SELECT * FROM batch_review_items(?::uuid, ?)", id, k));
            } else tp.put("problems", List.of());
            tp.put("items", tpItems);
            tp.put("stored", db.rows("SELECT * FROM test_result_view WHERE batch_id = ?::uuid AND released_step_run_id = ?::uuid AND status = 'Active' ORDER BY sample_code, analyte_name",
                id, tp.get("step_run_id")));
            tp.put("feeds", db.rows("""
                SELECT p.id FROM step_ancestors(?::uuid) a JOIN step_run p ON p.step_id = a.step_id AND p.batch_id = ?::uuid JOIN workflow_step w ON w.id = p.step_id
                 WHERE w.step_type <> 'QC Review'""", tp.get("step_id"), id).stream().map(x -> x.get("id")).toList());
        }
        // a "hit": a result above the LOQ (not "< LOQ" or ND), or a qualitative result that means found; the screen nests and
        // shows only these (plus anything to act on) under each sample (Alex, 2026-10-13)
        Map<Object, List<Object>> found = new LinkedHashMap<>();
        for (Map<String, Object> x : db.rows("SELECT analyte_id, found_values FROM test_version_analyte WHERE test_version_id = ?::uuid", b.get("test_version_id")))
            found.put(x.get("analyte_id"), pgList(x.get("found_values")));
        for (Map<String, Object> x : items) x.put("hit", x.get("chosen_entry_id") != null && hit(x, found));
        for (Map<String, Object> x : stored) x.put("hit", hit(x, found));
        for (Map<String, Object> tp : timepoints) for (Object o : (List<?>) tp.get("items")) {
            @SuppressWarnings("unchecked") Map<String, Object> x = (Map<String, Object>) o;
            x.put("hit", x.get("chosen_entry_id") != null && hit(x, found));
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("items", items);
        out.put("problems", problems);
        out.put("verdicts", db.rows("SELECT * FROM batch_qc_verdicts(?::uuid)", id));
        out.put("accepted", db.rows("SELECT q.*, u.full_name AS accepted_by FROM qc_acceptance q JOIN app_user u ON u.id = q.created_by WHERE q.batch_id = ?::uuid AND q.status = 'Active'", id));
        out.put("stored", stored);
        out.put("performer", performer(id, user));
        out.put("timepoints", timepoints);
        out.put("used_runs", awaiting ? pgList(db.one("SELECT batch_used_runs(?::uuid) AS u", id).get("u")).stream().map(x -> (Object) toNumber(x)).toList() : List.of(1));
        // incubator loads outside their window or temperature, and the reviewer's acceptance of each (WD-5.1)
        out.put("loads", db.rows("""
            SELECT l.id, l.step_run_id, l.equipment_id, l.equipment_code, l.time_in, l.time_out, l.note, l.check_text, ws.step_name,
                  a.justification AS accepted_justification, a.check_text AS accepted_check, u.full_name AS accepted_by, a.created_at AS accepted_at
                FROM incubation_load_view l JOIN step_run r ON r.id = l.step_run_id JOIN workflow_step ws ON ws.id = r.step_id
                LEFT JOIN load_acceptance a ON a.load_id = l.id AND a.status = 'Active' LEFT JOIN app_user u ON u.id = a.created_by
               WHERE l.batch_id = ?::uuid AND l.status = 'Active' AND l.check_text IS NOT NULL ORDER BY l.time_in""", id));
        out.put("reviewed_by_name", name.get(b.get("reviewed_by")));
        out.put("returned_by_name", name.get(b.get("returned_by")));
        out.put("cancelled_by_name", name.get(b.get("cancelled_by")));
        return out;
    }

    private static final java.util.regex.Pattern NOT_FOUND = java.util.regex.Pattern.compile("^\\s*(<|nd\\b|n\\.d\\.)", java.util.regex.Pattern.CASE_INSENSITIVE);

    private static boolean hit(Map<String, Object> x, Map<Object, List<Object>> found) {
        Object text = x.get("value_text"), reported = x.get("reported");
        if (text != null && !"".equals(text)) return found.getOrDefault(x.get("analyte_id"), List.of()).contains(text);
        return reported != null && !"".equals(reported) && !NOT_FOUND.matcher(com.tentamus.lims.core.excel.Js.string(reported)).find();
    }

    /** A number as JavaScript's Number() gives it: whole numbers as integers (so they are written 1, not 1.0). */
    private static Number toNumber(Object v) {
        double d = com.tentamus.lims.core.excel.Js.toNumber(v);
        return d == Math.rint(d) && Math.abs(d) < 1e15 ? (Number) (long) d : (Number) d;
    }

    /** PostgreSQL array text ({a,b}) as a list; a list stays as it is (the Node backend's pgList). */
    public static List<Object> pgList(Object v) {
        if (v instanceof List<?> l) return new ArrayList<>(l);
        if (v == null || "{}".equals(v)) return new ArrayList<>();
        String s = v.toString().replaceAll("^\\{|\\}$", "");
        List<Object> out = new ArrayList<>();
        for (String x : s.split(",", -1)) out.add(x.replaceAll("^\"|\"$", ""));
        return out;
    }

    public List<Map<String, Object>> openBatches(String site, String version) {
        return db.rows("""
            SELECT b.id, b.batch_code, b.status, b.assigned_name, b.sample_count, b.qc_count, b.created_at FROM test_batch_view b
             WHERE b.site_id = ?::uuid AND b.test_version_id = ?::uuid AND b.status IN ('Open','In Progress') AND NOT batch_started(b.id) ORDER BY b.batch_code""", site, version);
    }

    /** Approved results of a sample, its batches and split-off requests (the sample page). */
    public Map<String, Object> sampleResults(String sample) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("results", db.rows("SELECT * FROM test_result_view WHERE sample_id = ?::uuid AND status = 'Active' ORDER BY test_name, analyte_name", sample));
        out.put("batches", db.rows("""
            SELECT DISTINCT b.id, b.batch_code, b.status::text AS status, t.test_name, e.status AS entry_status
                FROM batch_entry e JOIN test_batch b ON b.id = e.batch_id JOIN requested_test rt ON rt.id = e.requested_test_id JOIN test t ON t.id = b.test_id
               WHERE rt.sample_id = ?::uuid ORDER BY b.batch_code""", sample));
        out.put("splits", db.rows("SELECT v.*, split_alerts(v.id) AS alerts FROM split_request_view v WHERE v.sample_id = ?::uuid ORDER BY v.created_at", sample));
        return out;
    }
}
