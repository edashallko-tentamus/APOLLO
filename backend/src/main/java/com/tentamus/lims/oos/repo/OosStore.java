package com.tentamus.lims.oos.repo;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.oos.domain.Checklist;
import com.tentamus.lims.oos.domain.OosInvestigation;
import com.tentamus.lims.oos.domain.OosOpening;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Repository;

/**
 * Loads and saves OOS investigations, their client answers and retests. The permission and signature checks stay in
 * the database (require_permission_at, assert_signed) and keep its words.
 */
@Repository
public class OosStore {

    public void requirePermission(Db d, String code, String site) { d.one("SELECT require_permission_at(?, ?::uuid)", code, site); }

    public boolean has(Db d, String code, String site) {
        return Boolean.TRUE.equals(d.one("SELECT has_permission_at(?, ?::uuid) AS ok", code, site).get("ok"));
    }

    public void assertSigned(Db d, String what) { d.one("SELECT assert_signed(?)", what); }

    /** The investigation, locked for the step. */
    public OosInvestigation load(Db d, Object id) {
        Map<String, Object> r = d.one("""
            SELECT id, oos_code, site_id, sample_id, requested_test_id, analyte_id, batch_id, status, procedure::text AS procedure, analyst_by, opened_by,
                conclusion, client_notified_at IS NOT NULL AS notified, phase2_decision FROM oos_investigation WHERE id = ?::uuid FOR UPDATE""", id);
        if (r == null) throw RuleException.database("OOS investigation not found");
        return new OosInvestigation(s(r, "id"), s(r, "oos_code"), s(r, "site_id"), s(r, "sample_id"), s(r, "requested_test_id"), s(r, "analyte_id"), s(r, "batch_id"),
            s(r, "status"), s(r, "procedure"), s(r, "analyst_by"), s(r, "opened_by"), s(r, "conclusion"), Boolean.TRUE.equals(r.get("notified")), s(r, "phase2_decision"));
    }

    /** The database's guard (oos_tables_rules) stays for Node's conclusion and the client's page: Java's writes are the OOS page's own. */
    private static void internal(Db d, boolean on) { d.one("SELECT set_oos_internal(?::boolean)", on); }

    private static String s(Map<String, Object> r, String k) { return (String) r.get(k); }

    private static BigDecimal n(Map<String, Object> r, String k) {
        Object v = r.get(k);
        return v == null ? null : v instanceof BigDecimal b ? b : new BigDecimal(v.toString());
    }

    // ---------------------------------------------------------------- opening
    /** The test's lab, sample and GMP flag; null when the test does not exist. */
    public Map<String, Object> testOf(Db d, Object rt) {
        return d.one("""
            SELECT o.site_id, s.id AS sample_id, sample_is_gmp(s.id) AS gmp, si.default_oos_procedure::text AS lab_default FROM requested_test rt JOIN sample s ON s.id = rt.sample_id
              JOIN lab_order o ON o.id = s.lab_order_id JOIN lab_site si ON si.id = o.site_id WHERE rt.id = ?::uuid""", rt);
    }

    public String openCode(Db d, Object rt, Object analyte) {
        Map<String, Object> r = d.one("SELECT oos_code FROM oos_investigation WHERE requested_test_id = ?::uuid AND analyte_id = ?::uuid AND status NOT IN ('Closed','Cancelled') LIMIT 1", rt, analyte);
        return r == null ? null : s(r, "oos_code");
    }

    public OosOpening.Result storedResult(Db d, Object rt, Object analyte) {
        Map<String, Object> r = d.one("""
            SELECT id, batch_id, reported, value_num, unit, conformance, spec_text, spec_min, spec_max, spec_unit FROM test_result
             WHERE requested_test_id = ?::uuid AND analyte_id = ?::uuid AND result_key IS NULL AND status = 'Active' AND stage = 'Final'""", rt, analyte);
        return r == null ? null : new OosOpening.Result(s(r, "id"), s(r, "batch_id"), s(r, "reported"), n(r, "value_num"), s(r, "unit"), s(r, "conformance"),
            s(r, "spec_text"), n(r, "spec_min"), n(r, "spec_max"), s(r, "spec_unit"));
    }

    public String closedCodeOf(Db d, String resultId) {
        if (resultId == null) return null;
        Map<String, Object> r = d.one("SELECT oos_code FROM oos_investigation WHERE test_result_id = ?::uuid AND status = 'Closed' LIMIT 1", resultId);
        return r == null ? null : s(r, "oos_code");
    }

    public String batchCode(Db d, Object batch) {
        if (batch == null) return null;
        Map<String, Object> r = d.one("SELECT batch_code FROM test_batch WHERE id = ?::uuid", batch);
        return r == null ? null : s(r, "batch_code");
    }

    /** The batch's QC Review reading of the result (the kept read model batch_review_items). */
    public OosOpening.Result reading(Db d, Object batch, Object rt, Object analyte) {
        if (batch == null) return null;
        Map<String, Object> r = d.one("""
            SELECT reported, value, unit, conformance, spec_text, spec_min, spec_max, spec_unit FROM batch_review_items(?::uuid) i
             WHERE i.requested_test_id = ?::uuid AND i.analyte_id = ?::uuid LIMIT 1""", batch, rt, analyte);
        return r == null ? null : new OosOpening.Result(null, null, s(r, "reported"), n(r, "value"), s(r, "unit"), s(r, "conformance"), s(r, "spec_text"),
            n(r, "spec_min"), n(r, "spec_max"), s(r, "spec_unit"));
    }

    public Integer closeWithinDays(Db d, String procedure) {
        Map<String, Object> r = d.one("SELECT close_within_days FROM oos_procedure_setting WHERE procedure::text = ?", procedure);
        return r == null || r.get("close_within_days") == null ? null : ((Number) r.get("close_within_days")).intValue();
    }

    public Object insert(Db d, Map<String, Object> t, Object rt, Object analyte, OosOpening.Result res, String procedure, int days, String reason) {
        internal(d, true);
        Object id = d.one("""
            INSERT INTO oos_investigation (site_id, sample_id, requested_test_id, analyte_id, batch_id, test_result_id, procedure, is_gmp, reported, value_num, unit, spec_text,
                opened_reason, opened_by, open_signature_id, due_date)
            VALUES (?::uuid, ?::uuid, ?::uuid, ?::uuid, ?::uuid, ?::uuid, ?::oos_procedure, ?, ?, ?::numeric, ?, ?, ?, current_app_user(),
                NULLIF(current_setting('lims.signature_id', true), '')::uuid, site_today(?::uuid) + ?::int) RETURNING id""",
            t.get("site_id"), t.get("sample_id"), rt, analyte, res.batchId(), res.resultId(), procedure, t.get("gmp"), res.reported(), res.value(), res.unit(), res.spec(),
            OosInvestigation.text(reason), t.get("site_id"), days).get("id");
        internal(d, false);
        return id;
    }

    // ---------------------------------------------------------------- the steps
    public void saveChecks(Db d, String id, String checksJson) {
        internal(d, true);
        d.update("UPDATE oos_investigation SET auto_checks = COALESCE(?::jsonb, '[]'), auto_checked_at = clock_timestamp() WHERE id = ?::uuid", checksJson, id);
        internal(d, false);
    }

    public List<Checklist.Item> items(Db d, String procedure, String section) {
        return d.rows("SELECT id, item_text FROM oos_checklist_item WHERE procedure::text = ? AND section = ? AND status = 'Active' ORDER BY sort_order", procedure, section)
            .stream().map(r -> new Checklist.Item(s(r, "id"), s(r, "item_text"))).toList();
    }

    /** The person performed or witnessed a bench step (not the QC Review) of the batch. */
    public boolean didBenchWork(Db d, String batch) {
        if (batch == null) return false;
        return Boolean.TRUE.equals(d.one("""
            SELECT EXISTS (SELECT 1 FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = ?::uuid AND ws.step_type <> 'QC Review'
                AND current_app_user() IN (r.performed_by, r.witness_id)) AS ok""", batch).get("ok"));
    }

    public void signAnalyst(Db d, String id, String answersJson, String comment, String hypothesis) {
        internal(d, true);
        d.update("""
            UPDATE oos_investigation SET analyst_answers = ?::jsonb, analyst_comment = ?, hypothesis = ?, analyst_by = current_app_user(), analyst_at = clock_timestamp(),
                analyst_signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid, status = 'Analyst signed' WHERE id = ?::uuid""",
            answersJson, OosInvestigation.text(comment), OosInvestigation.text(hypothesis), id);
        internal(d, false);
    }

    public void signSupervisor(Db d, String id, String answersJson, String comment) {
        internal(d, true);
        d.update("""
            UPDATE oos_investigation SET supervisor_answers = ?::jsonb, supervisor_comment = ?, supervisor_by = current_app_user(), supervisor_at = clock_timestamp(),
                supervisor_signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid, status = 'Supervisor signed' WHERE id = ?::uuid""",
            answersJson, OosInvestigation.text(comment), id);
        internal(d, false);
    }

    public void cancel(Db d, String id, String reason) {
        internal(d, true);
        d.update("UPDATE oos_investigation SET status = 'Cancelled', cancelled_reason = ?, cancelled_by = current_app_user(), cancelled_at = clock_timestamp() WHERE id = ?::uuid",
            reason.strip(), id);
        internal(d, false);
    }

    // ---------------------------------------------------------------- retests
    /** The original test's sample: its code, whether its retained sample is used up, and whether a retest replaces the test. */
    public Map<String, Object> retestFacts(Db d, String rt) {
        return d.one("""
            SELECT s.sample_code, (s.retained_quantity IS NOT NULL AND s.retained_quantity <= 0) AS gone, test_is_replaced(r.id) AS replaced, o.id AS order_id, o.status::text AS order_status
              FROM requested_test r JOIN sample s ON s.id = r.sample_id JOIN lab_order o ON o.id = s.lab_order_id WHERE r.id = ?::uuid""", rt);
    }

    /**
     * The retest: a new requested test repeating the original, with its specification; for a lab investigation the original
     * results are kept Superseded. The answer it came from is handled. Its id.
     */
    public Object orderRetest(Db d, OosInvestigation o, OosInvestigation.Retest r, Object response) {
        internal(d, true);   // the client's answer (oos_tables_rules) and the retest's billing status (requested_test_billing)
        if (r.invalidatesResults()) {
            d.one("SELECT set_testing_internal(true)");
            d.update("UPDATE test_result SET status = 'Superseded', invalidated_oos_id = ?::uuid WHERE requested_test_id = ?::uuid AND status = 'Active'", o.id(), o.requestedTestId());
            d.one("SELECT set_testing_internal(false)");
        }
        Object id = d.one("""
            INSERT INTO requested_test (sample_id, test_id, test_version_id, quoted_line_id, source, special_instructions, retest_of_id, oos_investigation_id, billing_status, retest_replicates)
            SELECT sample_id, test_id, test_version_id, quoted_line_id, ?::test_source, ?, id, ?::uuid, ?, ? FROM requested_test WHERE id = ?::uuid RETURNING id""",
            r.source(), r.instructions(), o.id(), r.billingStatus(), r.replicates(), o.requestedTestId()).get("id");
        d.update("""
            INSERT INTO specification (requested_test_id, analyte_id, min_value, max_value, text_value, unit, source)
            SELECT ?::uuid, sp.analyte_id, sp.min_value, sp.max_value, sp.text_value, sp.unit, sp.source FROM specification sp
             WHERE sp.requested_test_id = ?::uuid AND sp.status = 'Active'
               AND NOT EXISTS (SELECT 1 FROM specification x WHERE x.requested_test_id = ?::uuid AND x.analyte_id = sp.analyte_id AND x.status = 'Active')""",
            id, o.requestedTestId(), id);
        if (response != null)
            d.update("""
                UPDATE oos_client_response SET retest_requested_test_id = ?::uuid, handled_by = current_app_user(), handled_at = clock_timestamp(),
                    handled_note = COALESCE(handled_note, 'Retest ordered') WHERE id = ?::uuid AND oos_id = ?::uuid""", id, response, o.id());
        internal(d, false);
        return id;
    }

    public void recordPhase2Retest(Db d, String id) {
        internal(d, true);
        d.update("""
            UPDATE oos_investigation SET phase2_decision = 'Retest ordered', phase2_by = current_app_user(), phase2_at = clock_timestamp(),
                phase2_note = COALESCE(phase2_note, 'Client re-test ordered') WHERE id = ?::uuid AND phase2_decision IS NULL""", id);
        internal(d, false);
    }

    /** A reported or approved order has work again. */
    public void reopenOrder(Db d, Object order, String status) {
        if (!"Reported".equals(status) && !"Approved".equals(status)) return;
        d.one("SELECT set_config('lims.group_sync', '1', true)");
        d.update("UPDATE lab_order SET status = 'Received' WHERE id = ?::uuid", order);
        d.one("SELECT set_config('lims.group_sync', '', true)");
        d.one("SELECT refresh_order_status(?::uuid)", order);
    }

    // ---------------------------------------------------------------- determination, Phase II, the client's answers
    /** The client retest: its id and whether its final result is approved (null when none was ordered). */
    public Map<String, Object> clientRetest(Db d, String oos) {
        return d.one("""
            SELECT r.id, EXISTS (SELECT 1 FROM test_result WHERE requested_test_id = r.id AND status = 'Active' AND stage = 'Final' AND result_key IS NULL) AS approved
              FROM requested_test r WHERE r.oos_investigation_id = ?::uuid AND r.source = 'Client OOS Retest' AND r.status <> 'Cancelled' LIMIT 1""", oos);
    }

    public String determination(Db d, String oos) {
        return (String) d.one("SELECT retest_determination FROM oos_investigation WHERE id = ?::uuid", oos).get("retest_determination");
    }

    public void determine(Db d, String oos, String determination, String reason, Object retest, String billing) {
        internal(d, true);   // the investigation (oos_tables_rules) and the retest's billing (requested_test_billing)
        d.update("""
            UPDATE oos_investigation SET retest_determination = ?, determination_reason = ?, determined_by = current_app_user(), determined_at = clock_timestamp(),
                determination_signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid WHERE id = ?::uuid""", determination, reason.strip(), oos);
        d.update("UPDATE requested_test SET billing_status = ? WHERE id = ?::uuid", billing, retest);
        internal(d, false);
    }

    public void recordNoRetest(Db d, OosInvestigation o, String note) {
        internal(d, true);
        d.update("UPDATE oos_investigation SET phase2_decision = 'No retest', phase2_note = ?, phase2_by = current_app_user(), phase2_at = clock_timestamp() WHERE id = ?::uuid",
            note.strip(), o.id());
        // the system writes the COA note (no reports.notes needed)
        d.one("SELECT set_config('lims.group_sync', '1', true)");
        d.update("INSERT INTO coa_note (sample_id, requested_test_id, analyte_id, kind, note_text) VALUES (?::uuid, ?::uuid, ?::uuid, 'COA', ?)",
            o.sampleId(), o.requestedTestId(), o.analyteId(), o.noRetestNote());
        d.one("SELECT set_config('lims.group_sync', '', true)");
        internal(d, false);
    }

    /** The answer and its investigation's lab; null when not found. */
    public Map<String, Object> response(Db d, String id) {
        return d.one("""
            SELECT cr.id, cr.handled_at IS NOT NULL AS handled, o.site_id FROM oos_client_response cr JOIN oos_investigation o ON o.id = cr.oos_id WHERE cr.id = ?::uuid FOR UPDATE OF cr""", id);
    }

    public void handle(Db d, String id, String note) {
        internal(d, true);
        d.update("UPDATE oos_client_response SET handled_by = current_app_user(), handled_at = clock_timestamp(), handled_note = ? WHERE id = ?::uuid", OosInvestigation.text(note), id);
        internal(d, false);
    }
}
