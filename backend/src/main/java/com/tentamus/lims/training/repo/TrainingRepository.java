package com.tentamus.lims.training.repo;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.training.domain.CompetencyAttempt;
import com.tentamus.lims.training.domain.KnownValue;
import com.tentamus.lims.training.domain.Qualification;
import com.tentamus.lims.training.domain.TrainingRule;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Repository;

/**
 * Loads and saves training records: rules, attempts, qualifications, the training samples' internal order. The read
 * helpers training_rule_for and department_trained stay in the database (views and the bench gate use them).
 */
@Repository
public class TrainingRepository {
    private static final String SIG = "NULLIF(current_setting('lims.signature_id', true), '')::uuid";

    /** require_permission_at's refusal text for a permission. */
    public String permissionRefusal(Db d, String code) {
        Map<String, Object> p = d.one("SELECT lower(description) AS d FROM permission WHERE code = ?", code);
        return "You do not have permission to do this: " + (p == null ? "" : p.get("d")) + " (" + code + "). Ask your lab administrator to add you to a group that has it.";
    }

    public Map<String, Object> test(Db d, Object id) {
        return d.one("SELECT id, site_id, department_id, test_name FROM test WHERE id = ?::uuid", id);
    }

    public TrainingRule ruleFor(Db d, Object site, Object dept) {
        Map<String, Object> r = d.one("SELECT * FROM training_rule_for(?::uuid, ?::uuid)", site, dept);
        return r == null || r.get("id") == null ? null : TrainingRule.of(r);
    }

    public boolean departmentTrained(Db d, Object user, Object site, Object dept) {
        if (dept == null) return false;
        Map<String, Object> r = d.one("SELECT department_trained(?::uuid, ?::uuid, ?::uuid) AS ok", user, site, dept);
        return r != null && Boolean.TRUE.equals(r.get("ok"));
    }

    public Map<String, Object> trainee(Db d, Object id) {
        return d.one("SELECT id, full_name FROM app_user WHERE id = ?::uuid AND is_active AND NOT is_automated", id);
    }

    public String activeQualification(Db d, Object user, Object test) {
        Map<String, Object> q = d.one("SELECT id FROM analyst_qualification WHERE user_id = ?::uuid AND test_id = ?::uuid AND status = 'Active'", user, test);
        return q == null ? null : (String) q.get("id");
    }

    public boolean openAttempt(Db d, Object user, Object test) {
        return d.one("SELECT 1 AS x FROM competency_attempt WHERE user_id = ?::uuid AND test_id = ?::uuid AND status IN ('In progress','Evaluated') LIMIT 1", user, test) != null;
    }

    public String effectiveVersion(Db d, Object test) {
        Map<String, Object> v = d.one("SELECT id FROM test_version WHERE test_id = ?::uuid AND status = 'Effective'", test);
        return v == null ? null : (String) v.get("id");
    }

    public CompetencyAttempt attempt(Db d, Object id) {
        Map<String, Object> a = d.one("SELECT * FROM competency_attempt WHERE id = ?::uuid FOR UPDATE", id);
        if (a == null) return null;
        return new CompetencyAttempt((String) a.get("id"), (String) a.get("attempt_code"), (String) a.get("user_id"), (String) a.get("test_id"),
            (String) a.get("site_id"), (String) a.get("kind"), (String) a.get("route"), (String) a.get("status"), (String) a.get("evaluation"),
            (String) a.get("evaluation_note"), (String) a.get("evaluated_by"));
    }

    public Map<String, Object> insertAttempt(Db d, Object user, Object test, Object site, String kind, String route, String qualification, String known,
                                             String description, Object trainedOn) {
        return d.one("""
            INSERT INTO competency_attempt (user_id, test_id, site_id, kind, route, qualification_id, known_values, description, trained_on)
            VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?, ?::uuid, ?::jsonb, ?, ?::date) RETURNING id, attempt_code""",
            user, test, site, kind, route, qualification, "Training samples".equals(route) ? known : "[]", description, trainedOn);
    }

    /** The training samples: an internal order (Received) with N logged samples TRN-<n>-<i>, each with the test and the known values as its specification. */
    public void makeTrainingSamples(Db d, String attemptId, String attemptCode, Object test, String testName, Object site, String version, String traineeName,
                                    int samples, List<KnownValue> known, Object loggedBy) {
        d.one("SELECT set_config('lims.group_sync', '1', true)");   // the system makes the internal order and samples (checked before)
        String client = trainingClient(d);
        Map<String, Object> ct = d.one("SELECT cc.contact_id FROM client_contact cc WHERE cc.client_id = ?::uuid AND 'ORDERING' = ANY (cc.roles) LIMIT 1", client);
        Object order = d.one("INSERT INTO lab_order (client_id, site_id, ordering_contact_id, notes, status) VALUES (?::uuid, ?::uuid, ?::uuid, ?, 'Received') RETURNING id",
            client, site, ct == null ? null : ct.get("contact_id"), "Training samples " + attemptCode + ": " + testName + " for " + traineeName).get("id");
        for (int i = 1; i <= samples; i++) {
            Object sample = d.one("""
                INSERT INTO sample (lab_order_id, sample_code, client_sample_id, description, received_at, logged_at, logged_by, status, number_of_units)
                VALUES (?::uuid, ?, ?, ?, clock_timestamp(), clock_timestamp(), ?::uuid, 'Logged', 1) RETURNING id""",
                order, "TRN-" + attemptCode.substring(3) + "-" + i, attemptCode + " sample " + i, "Training sample for " + traineeName, loggedBy).get("id");
            Object rt = d.one("INSERT INTO requested_test (sample_id, test_id, test_version_id, competency_attempt_id) VALUES (?::uuid, ?::uuid, ?::uuid, ?::uuid) RETURNING id",
                sample, test, version, attemptId).get("id");
            for (KnownValue k : known)
                d.update("""
                    INSERT INTO specification (requested_test_id, analyte_id, min_value, max_value, text_value, unit, source)
                    VALUES (?::uuid, ?::uuid, ?::numeric, ?::numeric, ?,
                            (SELECT reporting_unit FROM test_version_analyte WHERE test_version_id = ?::uuid AND analyte_id = ?::uuid AND status = 'Active' LIMIT 1), 'Lab')""",
                    rt, k.analyteId(), k.min() == null ? null : k.min().toPlainString(), k.max() == null ? null : k.max().toPlainString(), k.text(), version, k.analyteId());
        }
        d.one("SELECT set_config('lims.group_sync', '', true)");
        d.update("UPDATE competency_attempt SET lab_order_id = ?::uuid WHERE id = ?::uuid", order, attemptId);
    }

    public boolean analyteOnVersion(Db d, String version, String analyte) {
        return d.one("SELECT 1 AS x FROM test_version_analyte WHERE test_version_id = ?::uuid AND analyte_id = ?::uuid AND status = 'Active'", version, analyte) != null;
    }

    /** The internal client "Internal: training and competency", made on first use with its ordering contact. */
    private String trainingClient(Db d) {
        Map<String, Object> c = d.one("SELECT id FROM client WHERE is_internal AND legal_name = 'Internal: training and competency'");
        if (c != null) return (String) c.get("id");
        String client = (String) d.one("""
            INSERT INTO client (legal_name, display_name, account_status, is_internal)
            VALUES ('Internal: training and competency', 'Internal: training and competency', 'Active', true) RETURNING id""").get("id");
        Map<String, Object> ct = d.one("SELECT id FROM contact WHERE lower(email) = 'training@lims3.internal'");
        Object contact = ct != null ? ct.get("id") : d.one("""
            INSERT INTO contact (first_name, last_name, email, job_title) VALUES ('Lab', 'Training', 'training@lims3.internal', 'The lab itself (training samples)') RETURNING id""").get("id");
        d.update("INSERT INTO client_contact (client_id, contact_id, roles, portal_visible) VALUES (?::uuid, ?::uuid, '{ORDERING}', false) ON CONFLICT DO NOTHING", client, contact);
        return client;
    }

    public int testsWaiting(Db d, String attempt) {
        return ((Number) d.one("""
            SELECT count(*)::int AS n FROM requested_test rt WHERE rt.competency_attempt_id = ?::uuid AND rt.status <> 'Cancelled'
               AND NOT EXISTS (SELECT 1 FROM test_result tr WHERE tr.requested_test_id = rt.id AND tr.status = 'Active' AND tr.stage = 'Final')""", attempt).get("n")).intValue();
    }

    public boolean hasEvidence(Db d, String attempt) {
        return d.one("SELECT 1 AS x FROM competency_evidence WHERE attempt_id = ?::uuid LIMIT 1", attempt) != null;
    }

    public void saveEvaluation(Db d, CompetencyAttempt a) {
        d.update("UPDATE competency_attempt SET status = ?, evaluation = ?, evaluation_note = ?, evaluated_by = ?::uuid, evaluated_at = clock_timestamp(), evaluation_signature_id = "
            + SIG + " WHERE id = ?::uuid", a.status(), a.evaluation(), a.evaluationNote(), a.evaluatedBy(), a.id());
    }

    public void saveDecision(Db d, CompetencyAttempt a, Object decider) {
        d.update("UPDATE competency_attempt SET status = ?, decision_note = ?, decided_by = ?::uuid, decided_at = clock_timestamp(), decision_signature_id = " + SIG
            + " WHERE id = ?::uuid", a.status(), a.decisionNote(), decider, a.id());
    }

    public String grantQualification(Db d, CompetencyAttempt a, Object approver) {
        return (String) d.one("INSERT INTO analyst_qualification (user_id, test_id, site_id, source, attempt_id, conditions, approved_by, signature_id) "
            + "VALUES (?::uuid, ?::uuid, ?::uuid, 'Initial competency', ?::uuid, ?, ?::uuid, " + SIG + ") RETURNING id",
            a.userId(), a.testId(), a.siteId(), a.id(), a.conditions(), approver).get("id");
    }

    /** A continuing competency keeps the qualification up; null when it is no longer active. */
    public String keepUpQualification(Db d, CompetencyAttempt a) {
        Map<String, Object> q = d.one("""
            UPDATE analyst_qualification SET last_competency_at = clock_timestamp(), conditions = ?
             WHERE id = (SELECT qualification_id FROM competency_attempt WHERE id = ?::uuid) AND status = 'Active' RETURNING id""", a.conditions(), a.id());
        return q == null ? null : (String) q.get("id");
    }

    /** Withdrawn: the attempt, and its training sample tests not yet batched are cancelled. */
    public void saveWithdrawal(Db d, CompetencyAttempt a) {
        d.update("UPDATE competency_attempt SET status = ?, withdrawn_reason = ? WHERE id = ?::uuid", a.status(), a.withdrawnReason(), a.id());
        d.one("SELECT set_config('lims.group_sync', '1', true)");
        d.update("""
            UPDATE requested_test SET status = 'Cancelled' WHERE competency_attempt_id = ?::uuid AND status <> 'Cancelled'
               AND NOT EXISTS (SELECT 1 FROM batch_entry e WHERE e.requested_test_id = requested_test.id AND e.status::text <> 'Superseded')""", a.id());
        d.one("SELECT set_config('lims.group_sync', '', true)");
    }

    public Qualification qualification(Db d, Object id) {
        Map<String, Object> q = d.one("SELECT id, site_id, status::text AS status FROM analyst_qualification WHERE id = ?::uuid FOR UPDATE", id);
        return q == null ? null : new Qualification((String) q.get("id"), (String) q.get("site_id"), (String) q.get("status"));
    }

    public void saveQualification(Db d, Qualification q) {
        d.update("UPDATE analyst_qualification SET status = ?::record_status, withdrawn_reason = ? WHERE id = ?::uuid", q.status(), q.withdrawnReason(), q.id());
    }

    /** Legacy qualifications: whoever signed a bench step of a test at the lab in the last 12 months and holds none; their last run is their last competency. */
    public int grantLegacy(Db d, Object site, Object approver) {
        return d.update("INSERT INTO analyst_qualification (user_id, test_id, site_id, source, granted_at, last_competency_at, approved_by, signature_id) "
            + "SELECT x.user_id, x.test_id, ?::uuid, 'Legacy', clock_timestamp(), x.last_at, ?::uuid, " + SIG + """
               FROM (SELECT r.performed_by AS user_id, b.test_id, max(r.completed_at) AS last_at
                       FROM step_run r JOIN test_batch b ON b.id = r.batch_id JOIN workflow_step ws ON ws.id = r.step_id JOIN app_user u ON u.id = r.performed_by
                      WHERE b.site_id = ?::uuid AND r.completed_at > now() - interval '12 months' AND ws.step_type::text <> 'QC Review'
                        AND NOT b.is_verification AND b.status::text <> 'Cancelled' AND NOT u.is_automated AND u.is_active
                      GROUP BY r.performed_by, b.test_id) x
              WHERE NOT EXISTS (SELECT 1 FROM analyst_qualification q WHERE q.user_id = x.user_id AND q.test_id = x.test_id AND q.status = 'Active')""",
            site, approver, site);
    }

    /** A rule row and the lab of its department, for the rule check. */
    public Map<String, Object> rule(Db d, Object id, Object site) {
        return d.one("SELECT * FROM training_rule WHERE id = ?::uuid AND site_id = ?::uuid", id, site);
    }

    public String departmentSite(Db d, Object dept) {
        if (dept == null) return null;
        Map<String, Object> r = d.one("SELECT site_id FROM department WHERE id = ?::uuid", dept);
        return r == null ? null : (String) r.get("site_id");
    }
}
