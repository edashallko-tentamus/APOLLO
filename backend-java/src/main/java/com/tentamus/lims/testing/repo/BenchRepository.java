package com.tentamus.lims.testing.repo;

import com.fasterxml.jackson.databind.JsonNode;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.testing.domain.AnalyticalRun;
import com.tentamus.lims.testing.domain.Batch;
import com.tentamus.lims.testing.domain.BatchEntry;
import com.tentamus.lims.testing.domain.BatchPlan;
import com.tentamus.lims.testing.domain.BenchStep;
import com.tentamus.lims.testing.domain.EquipmentUse;
import com.tentamus.lims.testing.domain.RunOrder;
import com.tentamus.lims.testing.domain.StepDepartment;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Repository;

/** Loads the bench's domain objects (batches, entries, step runs, what they use) and writes them back. SQL only here. */
@Repository
public class BenchRepository {

    /** The kept database permission check (permission triggers move in a later wave): the database's own message. */
    public void requirePermission(Db d, String code, Object site) { d.one("SELECT require_permission_at(?, ?::uuid)", code, site); }

    public Batch batch(Db d, Object id) {
        Map<String, Object> r = d.one("""
            SELECT b.id, b.batch_code, b.site_id, b.test_id, b.test_version_id, b.status::text AS status, b.is_verification, t.test_name, v.version_no
              FROM test_batch b JOIN test t ON t.id = b.test_id JOIN test_version v ON v.id = b.test_version_id WHERE b.id = ?::uuid""", id);
        if (r == null) return null;
        return new Batch(s(r, "id"), s(r, "batch_code"), s(r, "site_id"), s(r, "test_id"), s(r, "test_version_id"), s(r, "status"),
            Boolean.TRUE.equals(r.get("is_verification")), s(r, "test_name"), i(r, "version_no"));
    }

    /** A step run as the person sees it (their department), locked for completion when asked. */
    public BenchStep step(Db d, Object runId, String user, boolean lock) {
        Map<String, Object> r = d.one("""
            SELECT r.id, r.batch_id, r.step_id, r.status, ws.step_name, ws.step_type::text AS step_type, ws.config->>'witness' AS witness, ws.config->>'replicates' AS replicates,
                   dep.id AS department_id, dep.department_name,
                   EXISTS (SELECT 1 FROM group_member m JOIN lab_group g ON g.id = m.group_id JOIN app_user u ON u.id = m.user_id
                            WHERE m.user_id = ?::uuid AND m.status = 'Active' AND g.status = 'Active' AND u.is_active AND g.department_id = dep.id) AS in_department,
                   NOT EXISTS (SELECT 1 FROM workflow_step_dependency x JOIN step_run p ON p.step_id = x.depends_on_step_id AND p.batch_id = r.batch_id
                                WHERE x.step_id = r.step_id AND x.status = 'Active' AND p.status <> 'Completed') AS ready,
                   (SELECT string_agg(s2.step_name, ', ') FROM workflow_step_dependency x JOIN workflow_step s2 ON s2.id = x.step_id
                      JOIN step_run p ON p.step_id = x.step_id AND p.batch_id = r.batch_id WHERE x.depends_on_step_id = r.step_id AND x.status = 'Active' AND p.status = 'Completed') AS later,
                   step_feeds_release(r.id) AS released
              FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id LEFT JOIN department dep ON dep.id = step_department(ws.id)
             WHERE r.id = ?::uuid""" + (lock ? " FOR UPDATE OF r" : ""), user, runId);
        if (r == null) return null;
        return new BenchStep(s(r, "id"), batch(d, r.get("batch_id")), s(r, "step_id"), s(r, "step_name"), s(r, "step_type"), s(r, "status"),
            r.get("witness") == null ? "None" : s(r, "witness"), new StepDepartment(s(r, "department_id"), s(r, "department_name"), Boolean.TRUE.equals(r.get("in_department"))),
            Boolean.TRUE.equals(r.get("ready")), s(r, "later"), s(r, "released"), BenchStep.weighingReplicates(r.get("replicates")));
    }

    /** The Batching step of a version and the person's place in its department, or null when it has none. */
    public Map<String, Object> batchingStep(Db d, Object version, String user) {
        return d.one("""
            SELECT ws.id, ws.config, dep.id AS department_id, dep.department_name,
                   EXISTS (SELECT 1 FROM group_member m JOIN lab_group g ON g.id = m.group_id JOIN app_user u ON u.id = m.user_id
                            WHERE m.user_id = ?::uuid AND m.status = 'Active' AND g.status = 'Active' AND u.is_active AND g.department_id = dep.id) AS in_department
              FROM workflow_step ws LEFT JOIN department dep ON dep.id = step_department(ws.id)
             WHERE ws.test_version_id = ?::uuid AND ws.status = 'Active' AND ws.step_type = 'Batching'""", user, version);
    }

    public static StepDepartment department(Map<String, Object> step) {
        return new StepDepartment(s(step, "department_id"), s(step, "department_name"), Boolean.TRUE.equals(step.get("in_department")));
    }

    public BatchEntry entry(Db d, Object id) {
        Map<String, Object> r = d.one("""
            SELECT e.id, e.batch_id, e.label, e.entry_type, e.qc_type, e.qc_class, e.status, e.superseded_reason, e.daily_of_entry_id, e.requested_test_id, e.reprep_request_id,
                   rt.media_lot_id IS NOT NULL AS media FROM batch_entry e LEFT JOIN requested_test rt ON rt.id = e.requested_test_id WHERE e.id = ?::uuid""", id);
        if (r == null) return null;
        return new BatchEntry(s(r, "id"), s(r, "batch_id"), s(r, "label"), s(r, "entry_type"), s(r, "qc_type"), s(r, "qc_class"), s(r, "status"), s(r, "superseded_reason"),
            s(r, "daily_of_entry_id"), s(r, "requested_test_id"), s(r, "reprep_request_id"), Boolean.TRUE.equals(r.get("media")));
    }

    public boolean analyteOnTest(Db d, Object version, Object analyte) {
        return analyte == null || d.one("SELECT 1 AS x FROM test_version_analyte WHERE test_version_id = ?::uuid AND analyte_id = ?::uuid AND status = 'Active'", version, analyte) != null;
    }

    /** An entry's readings at a step: 1 plus every re-analysis. */
    public int readings(Db d, Object run, Object entry) {
        return i(d.one("SELECT 1 + COALESCE((SELECT sum(runs)::int FROM reanalysis_request WHERE step_run_id = ?::uuid AND entry_id = ?::uuid), 0) AS n", run, entry), "n");
    }

    /** The analytical runs of a step run. */
    public int runsAt(Db d, Object run) { return i(d.one("SELECT COALESCE((SELECT max(run_no) FROM analytical_run WHERE step_run_id = ?::uuid), 1) AS n", run), "n"); }

    /** The batch's last reading (Data Entry) step run, or null. */
    public String readingRun(Db d, Object batch) {
        Map<String, Object> r = d.one("""
            SELECT r.id FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = ?::uuid AND ws.step_type = 'Data Entry' ORDER BY ws.sort_order DESC LIMIT 1""", batch);
        return r == null ? null : s(r, "id");
    }

    public LocalDate labToday(Db d, Object site) { return LocalDate.parse(d.one("SELECT site_today(?::uuid)::text AS d", site).get("d").toString()); }

    /** A lot's facts for using it at a step of a test version. */
    public Map<String, Object> lot(Db d, Object lot, Object version) {
        return d.one("""
            SELECT l.lot_code, l.site_id, l.receipt_status::text AS receipt_status, l.status::text AS status, l.expiration_date::text AS expires, l.retest_date::text AS retest,
                   l.chemical_types::text AS types, l.unit, l.physical_form::text AS form,
                   (NOT EXISTS (SELECT 1 FROM lot_analyte la WHERE la.lot_id = l.id AND la.status = 'Active')
                    OR EXISTS (SELECT 1 FROM lot_analyte la JOIN test_version_analyte tva ON tva.analyte_id = la.analyte_id AND tva.status = 'Active'
                                WHERE la.lot_id = l.id AND la.status = 'Active' AND tva.test_version_id = ?::uuid)) AS organisms_ok
              FROM inventory_lot l WHERE l.id = ?::uuid""", version, lot);
    }

    public EquipmentUse equipment(Db d, Object equipment, Object step) {
        Map<String, Object> r = d.one("SELECT equipment_code, site_id, availability, tagged_for, calibration_status, equipment_type_id, type_name FROM equipment_view WHERE id = ?::uuid", equipment);
        if (r == null) return null;
        List<String> types = new ArrayList<>();
        for (Map<String, Object> t : d.rows("SELECT equipment_type_id FROM workflow_step_equipment WHERE step_id = ?::uuid AND status = 'Active'", step)) types.add(s(t, "equipment_type_id"));
        return new EquipmentUse(s(r, "equipment_code"), s(r, "site_id"), s(r, "availability"), s(r, "tagged_for"), s(r, "calibration_status"),
            s(r, "equipment_type_id"), s(r, "type_name"), types);
    }

    /** What is still missing before a step can be completed (the kept read model step_run_missing, which reads the results). */
    public List<String> missing(Db d, Object run) {
        List<String> out = new ArrayList<>();
        for (Map<String, Object> m : d.rows("SELECT problem FROM step_run_missing(?::uuid)", run)) out.add(s(m, "problem"));
        return out;
    }

    // ---------------------------------------------------------------- batches: making, changing samples, run order
    public List<BatchPlan.PoolItem> pool(Db d, Object site, Object version, String items) {
        List<BatchPlan.PoolItem> out = new ArrayList<>();
        for (Map<String, Object> p : d.rows("""
            SELECT p.requested_test_id, p.reprep_request_id, p.kind, p.replicates, COALESCE(p.sample_code, p.client_sample_id) AS label, p.is_media,
                   (SELECT count(*)::int FROM batch_entry x WHERE x.requested_test_id = p.requested_test_id AND x.reprep_request_id IS NOT NULL) AS earlier
              FROM test_pool_view p WHERE p.site_id = ?::uuid AND p.test_version_id = ?::uuid
               AND (?::jsonb IS NULL OR EXISTS (SELECT 1 FROM jsonb_array_elements(?::jsonb) j
                     WHERE (j->>'requested_test_id')::uuid = p.requested_test_id AND (j->>'reprep_request_id') IS NOT DISTINCT FROM p.reprep_request_id::text))
             ORDER BY p.priority_rank, p.due_date NULLS LAST, p.logged_at, p.sample_code""", site, version, items, items))
            out.add(new BatchPlan.PoolItem(s(p, "requested_test_id"), s(p, "reprep_request_id"), "Re-prep".equals(p.get("kind")), i(p, "replicates"), s(p, "label"),
                Boolean.TRUE.equals(p.get("is_media")), i(p, "earlier")));
        return out;
    }

    /** Whether any of the chosen backlog items waits for another test version or lab. */
    public boolean otherVersion(Db d, String items, Batch b) {
        return d.one("""
            SELECT 1 AS x FROM jsonb_array_elements(?::jsonb) j JOIN test_pool_view p ON p.requested_test_id = (j->>'requested_test_id')::uuid
               AND (j->>'reprep_request_id') IS NOT DISTINCT FROM p.reprep_request_id::text WHERE p.test_version_id <> ?::uuid OR p.site_id <> ?::uuid LIMIT 1""",
            items, b.versionId(), b.siteId()) != null;
    }

    public static List<BatchPlan.QcSpec> qcSpecs(JsonNode config) {
        List<BatchPlan.QcSpec> out = new ArrayList<>();
        if (config == null || !config.path("qc").isArray()) return out;
        for (JsonNode q : config.get("qc"))
            out.add(new BatchPlan.QcSpec(text(q, "qc_type"), text(q, "qc_class"), text(q, "frequency"), num(q, "count"), num(q, "every_n")));
        return out;
    }

    public static int maxSamples(JsonNode config) {
        Integer n = config == null ? null : num(config, "max_samples");
        return n == null ? 500 : n;
    }

    /** The day's shared control of a QC type already held by an earlier batch of the test at the lab (outside verifications). */
    public BatchPlan.DailyControl daily(Db d, Object site, Object test, String qcType) {
        Map<String, Object> r = d.one("""
            SELECT x.id, x.qc_class, ob.batch_code FROM batch_entry x JOIN test_batch ob ON ob.id = x.batch_id JOIN lab_site ls ON ls.id = ob.site_id
             WHERE ob.site_id = ?::uuid AND ob.test_id = ?::uuid AND ob.status <> 'Cancelled' AND x.status = 'Active' AND ob.verification_id IS NULL
               AND x.qc_type = ? AND x.daily_of_entry_id IS NULL AND x.label LIKE '%(daily)' AND (ob.created_at AT TIME ZONE ls.time_zone)::date = site_today(?::uuid)
             ORDER BY ob.created_at LIMIT 1""", site, test, qcType, site);
        return r == null ? null : new BatchPlan.DailyControl(s(r, "id"), s(r, "qc_class"), s(r, "batch_code"));
    }

    public void insertEntries(Db d, Object batch, List<BatchPlan.PlannedEntry> entries) {
        for (BatchPlan.PlannedEntry e : entries)
            d.update("""
                INSERT INTO batch_entry (id, batch_id, position, entry_type, requested_test_id, reprep_request_id, label, replicate_no, qc_type, qc_class, parent_entry_id, daily_of_entry_id)
                VALUES (?::uuid, ?::uuid, ?, ?, ?::uuid, ?::uuid, ?, ?, ?, ?, ?::uuid, ?::uuid)""",
                e.id(), batch, e.position(), e.entryType(), e.requestedTestId(), e.reprepRequestId(), e.label(), e.replicateNo(), e.qcType(), e.qcClass(), e.parentEntryId(), e.dailyOfEntryId());
    }

    public void markBatched(Db d, List<String> repreps, Object batch) {
        if (!repreps.isEmpty()) d.update("UPDATE reprep_request SET status = 'Batched', batch_id = ?::uuid WHERE id = ANY(?::uuid[])", batch, repreps);
    }

    public int clientSamples(Db d, Object batch) {
        return i(d.one("""
            SELECT count(*)::int AS n FROM batch_entry e JOIN requested_test rt ON rt.id = e.requested_test_id
             WHERE e.batch_id = ?::uuid AND e.entry_type = 'Sample' AND e.status = 'Active' AND rt.media_lot_id IS NULL""", batch), "n");
    }

    public int lastPosition(Db d, Object batch) { return i(d.one("SELECT COALESCE(max(position), 0) AS n FROM batch_entry WHERE batch_id = ?::uuid", batch), "n"); }

    public boolean started(Db d, Object batch) { return Boolean.TRUE.equals(d.one("SELECT batch_started(?::uuid) AS x", batch).get("x")); }

    /** The QC brackets follow the client samples, the run order is set again, and a completed Batching step is to be confirmed again. */
    public void samplesChanged(Db d, Object batch, List<BatchPlan.QcSpec> qc, String user) {
        int n = clientSamples(d, batch);
        for (BatchPlan.QcSpec q : qc) {
            if (!"Every N".equals(q.frequency())) continue;
            int cur = i(d.one("""
                SELECT count(*)::int AS n FROM batch_entry WHERE batch_id = ?::uuid AND entry_type = 'QC' AND status = 'Active' AND qc_type = ? AND label ~ '-[0-9]+$'""", batch, q.qcType()), "n");
            BatchPlan.BracketChange c = BatchPlan.BracketChange.of(q, n, cur);
            int k = cur;
            for (String label : c.add())
                d.update("INSERT INTO batch_entry (batch_id, position, entry_type, qc_type, qc_class, label) VALUES (?::uuid, ?, 'QC', ?, ?, ?)", batch, 10000 + ++k, q.qcType(), q.qcClass(), label);
            if (c.remove() > 0)
                d.update("""
                    UPDATE batch_entry SET status = 'Superseded', superseded_reason = 'Removed from the batch (fewer samples)', removed_at = clock_timestamp(), removed_by = ?::uuid
                     WHERE id IN (SELECT id FROM batch_entry WHERE batch_id = ?::uuid AND entry_type = 'QC' AND status = 'Active' AND qc_type = ? AND label ~ '-[0-9]+$'
                                   ORDER BY (regexp_replace(label, '^.*-', ''))::int DESC LIMIT ?)""", user, batch, q.qcType(), c.remove());
        }
        reorder(d, batch, BatchPlan.smallestEveryN(qc));
        d.update("""
            UPDATE step_run r SET status = 'In progress' FROM workflow_step ws
             WHERE ws.id = r.step_id AND r.batch_id = ?::uuid AND ws.step_type = 'Batching' AND r.status = 'Completed'""", batch);
        d.one("SELECT refresh_batch_orders(?::uuid)", batch);
    }

    private void reorder(Db d, Object batch, Integer everyN) {
        List<RunOrder.Slot> slots = new ArrayList<>();
        for (Map<String, Object> e : d.rows("SELECT id, entry_type, qc_class, qc_type, label, parent_entry_id, status, position FROM batch_entry WHERE batch_id = ?::uuid", batch))
            slots.add(new RunOrder.Slot(s(e, "id"), s(e, "entry_type"), s(e, "qc_class"), s(e, "qc_type"), s(e, "label"), s(e, "parent_entry_id"), "Active".equals(e.get("status")), i(e, "position")));
        Map<String, Integer> pos = RunOrder.positions(slots, everyN);
        for (RunOrder.Slot x : slots)
            if (pos.containsKey(x.id()) && pos.get(x.id()) != x.position()) d.update("UPDATE batch_entry SET position = ? WHERE id = ?::uuid", pos.get(x.id()), x.id());
    }

    // ---------------------------------------------------------------- analytical runs
    /** The batch's active entries (and the chosen ones), as an analytical run sees them, in run order. */
    public List<AnalyticalRun.Candidate> runCandidates(Db d, BenchStep step, List<Object> chosen) {
        List<AnalyticalRun.Candidate> out = new ArrayList<>();
        for (Map<String, Object> e : d.rows("""
            SELECT be.id, be.label, (be.batch_id = ?::uuid AND be.status = 'Active' AND be.daily_of_entry_id IS NULL) AS here, be.qc_class = 'Analytical' AS analytical,
                   1 + COALESCE((SELECT sum(runs)::int FROM reanalysis_request x WHERE x.step_run_id = ?::uuid AND x.entry_id = be.id), 0) AS readings
              FROM batch_entry be WHERE (be.batch_id = ?::uuid AND be.status = 'Active' AND be.daily_of_entry_id IS NULL) OR be.id = ANY(?::uuid[])
             ORDER BY be.position""", step.batch().id(), step.runId(), step.batch().id(), chosen))
            out.add(new AnalyticalRun.Candidate(s(e, "id"), s(e, "label"), Boolean.TRUE.equals(e.get("here")), Boolean.TRUE.equals(e.get("analytical")), i(e, "readings")));
        return out;
    }

    /** Writes the run and its readings; the reading step and the calculations after it open again for them. Returns the run number. */
    public int addRun(Db d, BenchStep step, List<AnalyticalRun.Reading> readings, String reason) {
        int k = runsAt(d, step.runId()) + 1;
        Object run = d.one("""
            INSERT INTO analytical_run (step_run_id, run_no, reason, signature_id) VALUES (?::uuid, ?, ?, NULLIF(current_setting('lims.signature_id', true), '')::uuid) RETURNING id""",
            step.runId(), k, reason).get("id");
        for (AnalyticalRun.Reading x : readings)
            d.update("""
                INSERT INTO reanalysis_request (step_run_id, entry_id, runs, first_run_no, reason, signature_id, analytical_run_id)
                VALUES (?::uuid, ?::uuid, ?, ?, ?, NULLIF(current_setting('lims.signature_id', true), '')::uuid, ?::uuid)""", step.runId(), x.entryId(), x.runs(), x.firstRunNo(), reason, run);
        d.update("""
            UPDATE step_run SET status = 'In progress' WHERE batch_id = ?::uuid AND status = 'Completed'
               AND (id = ?::uuid OR step_id IN (SELECT s2.id FROM workflow_step s2 WHERE s2.test_version_id = ?::uuid AND s2.step_type = 'Calculation'
                                                AND ?::uuid IN (SELECT step_id FROM step_ancestors(s2.id))))""",
            step.batch().id(), step.runId(), step.batch().versionId(), step.stepId());
        setBatchStatus(d, step.batch().id(), step.batch().statusAfterReopen());
        return k;
    }

    public List<String> dilutionRuns(Db d, Object batch) {
        List<String> out = new ArrayList<>();
        for (Map<String, Object> r : d.rows("SELECT r.id FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = ?::uuid AND ws.step_type = 'Dilution'", batch)) out.add(s(r, "id"));
        return out;
    }

    /** An entry's latest dilution at or before an analytical run. */
    public JsonNode dilution(Db d, Object run, Object entry, int upTo) {
        Map<String, Object> r = d.one("""
            SELECT data FROM entry_value WHERE step_run_id = ?::uuid AND entry_id = ?::uuid AND analyte_id IS NULL AND status = 'Active' AND run_no <= GREATEST(?, 1)
             ORDER BY run_no DESC LIMIT 1""", run, entry, upTo);
        return r == null ? null : (JsonNode) r.get("data");
    }

    public void setBatchStatus(Db d, Object batch, String status) {
        d.update("UPDATE test_batch SET status = ?::batch_status WHERE id = ?::uuid AND status::text IS DISTINCT FROM ?", status, batch, status);
    }

    // ---------------------------------------------------------------- helpers
    static String s(Map<String, Object> r, String k) { return r.get(k) == null ? null : r.get(k).toString(); }

    static int i(Map<String, Object> r, String k) { return r.get(k) == null ? 0 : ((Number) r.get(k)).intValue(); }

    private static String text(JsonNode n, String k) { return n.hasNonNull(k) ? n.get(k).asText() : null; }

    private static Integer num(JsonNode n, String k) {
        if (!n.hasNonNull(k)) return null;
        try { return Integer.valueOf(n.get(k).asText().strip()); } catch (NumberFormatException e) { return null; }
    }
}
