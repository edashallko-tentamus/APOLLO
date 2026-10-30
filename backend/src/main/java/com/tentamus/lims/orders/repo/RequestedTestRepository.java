package com.tentamus.lims.orders.repo;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.orders.domain.RequestedTest;
import com.tentamus.lims.orders.domain.RushDecision;
import com.tentamus.lims.orders.domain.ServingTestOrder;
import com.tentamus.lims.orders.domain.TestOrdering;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Repository;

/** Requested tests and their analytes: what ordering and changing them reads, and the rows they write. */
@Repository
public class RequestedTestRepository {
    private final Db db;

    public RequestedTestRepository(Db db) { this.db = db; }

    /** The stored test the change rules read, or null. */
    public RequestedTest find(Object id) {
        Map<String, Object> r = db.one("""
            SELECT rt.id, rt.status::text AS status, rt.rush_tier_id, rt.special_instructions, rt.tat_override, rt.clock_start IS NOT NULL AS started
              FROM requested_test rt WHERE rt.id = ?::uuid""", id);
        return r == null ? null : new RequestedTest((String) r.get("id"), null, (String) r.get("status"), (String) r.get("rush_tier_id"),
            (String) r.get("special_instructions"), r.get("tat_override") == null ? null : ((Number) r.get("tat_override")).intValue(), Boolean.TRUE.equals(r.get("started")));
    }

    /** What ordering a quoted line on a sample needs to know. */
    public TestOrdering ordering(Object sample, Object line) {
        Map<String, Object> r = db.one("""
            WITH s AS (SELECT s.status::text AS status, o.client_id FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = ?::uuid),
                 q AS (SELECT test_id FROM quoted_test_configuration WHERE id = ?::uuid)
            SELECT (SELECT status FROM s) AS status,
                   EXISTS (SELECT 1 FROM s, orderable_lines(s.client_id) ol WHERE ol.line_id = ?::uuid) AS orderable,
                   (SELECT c.account_status::text FROM s JOIN client c ON c.id = s.client_id) AS account_status,
                   (SELECT v.id FROM q JOIN test_version v ON v.test_id = q.test_id AND v.status = 'Effective' LIMIT 1) AS version_id""", sample, line, line);
        return new TestOrdering((String) r.get("status"), Boolean.TRUE.equals(r.get("orderable")), (String) r.get("account_status"), (String) r.get("version_id"));
    }

    /** Inserts the requested test (the database works out its price, rush and due date), then the quote's analytes. */
    public String insertQuoted(Object sample, Object line, String version, Object rushTier) {
        String id = (String) db.one("""
            INSERT INTO requested_test (sample_id, test_id, test_version_id, quoted_line_id, rush_tier_id)
            SELECT ?::uuid, q.test_id, ?::uuid, q.id, ?::uuid FROM quoted_test_configuration q WHERE q.id = ?::uuid RETURNING id""", sample, version, rushTier, line).get("id");
        if (db.one("""
            SELECT 1 AS x FROM requested_test rt JOIN test_catalog_entry e ON e.test_id = rt.test_id WHERE rt.id = ?::uuid AND e.pricing_mode = 'Analyte Selection'""", id) != null) {
            db.update("""
                INSERT INTO requested_analyte (requested_test_id, analyte_id, analyte_price, included)
                SELECT ?::uuid, qs.analyte_id, qs.analyte_price, true FROM quoted_analyte_selection qs WHERE qs.line_id = ?::uuid AND qs.included""", id, line);
            touch(id);
        }
        return id;
    }

    /** Has the sample an active test of the line's test already. */
    public boolean hasLineTest(Object sample, Object line) {
        return db.one("""
            SELECT 1 AS x FROM requested_test rt JOIN quoted_test_configuration q ON q.id = ?::uuid
             WHERE rt.sample_id = ?::uuid AND rt.test_id = q.test_id AND rt.status <> 'Cancelled'""", line, sample) != null;
    }

    /** The client's orderable lines of a project (for the sample's order). */
    public List<Map<String, Object>> projectLines(Object sample, Object project) {
        return db.rows("""
            SELECT ol.line_id, ol.test_id FROM sample s JOIN lab_order o ON o.id = s.lab_order_id, orderable_lines(o.client_id) ol
              JOIN quoted_test_configuration q ON q.id = ol.line_id JOIN project_version pv ON pv.id = q.project_version_id
             WHERE s.id = ?::uuid AND pv.project_id = ?::uuid""", sample, project);
    }

    public boolean hasTest(Object sample, Object test) {
        return db.one("SELECT 1 AS x FROM requested_test WHERE sample_id = ?::uuid AND test_id = ?::uuid AND status <> 'Cancelled'", sample, test) != null;
    }

    /** Asks the database to work the price out again (after analytes change). */
    public void touch(Object id) { db.update("UPDATE requested_test SET recalc_at = clock_timestamp() WHERE id = ?::uuid", id); }

    /** What ordering a serving test of this role on the sample can use. */
    public ServingTestOrder servingOrder(Object sample, String role) {
        Map<String, Object> r = db.one("""
            WITH s AS (SELECT s.id, o.client_id, o.site_id FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = ?::uuid)
            SELECT (SELECT r.id FROM s JOIN requested_test r ON r.sample_id = s.id JOIN test t ON t.id = r.test_id
                     WHERE t.serving_role = ? AND r.status <> 'Cancelled' LIMIT 1) AS existing,
                   (SELECT ol.line_id FROM s, orderable_lines(s.client_id) ol JOIN test t ON t.id = ol.test_id
                     WHERE t.serving_role = ? AND t.site_id = s.site_id ORDER BY ol.line_id LIMIT 1) AS line,
                   (SELECT lab_serving_test(s.site_id, ?) FROM s) AS lab_test,
                   (SELECT ls.site_code FROM s JOIN lab_site ls ON ls.id = s.site_id) AS site_code""", sample, role, role, role);
        return new ServingTestOrder(role, (String) r.get("existing"), (String) r.get("line"), (String) r.get("lab_test"), (String) r.get("site_code"));
    }

    /** A serving test ordered at its catalogue price (not on the client's quote). */
    public String insertServing(Object sample, Object test) {
        return (String) db.one("""
            INSERT INTO requested_test (sample_id, test_id, test_version_id, serving_order, special_instructions)
            SELECT ?::uuid, ?::uuid, v.id, true, 'For the results per serving' FROM test_version v WHERE v.test_id = ?::uuid AND v.status = 'Effective' LIMIT 1
            RETURNING id""", sample, test, test).get("id");
    }

    // ---------------------------------------------------------------- analytes
    /** A requested analyte with its test's status and whether the clock has started. */
    public Map<String, Object> analyte(Object id) {
        return db.one("""
            SELECT ra.id, ra.requested_test_id, ra.analyte_id, ra.analyte_price, ra.included, rt.status::text AS test_status, rt.clock_start IS NOT NULL AS started
              FROM requested_analyte ra JOIN requested_test rt ON rt.id = ra.requested_test_id WHERE ra.id = ?::uuid""", id);
    }

    public boolean onQuoteLine(Object test, Object analyte) {
        return db.one("""
            SELECT 1 AS x FROM requested_test rt JOIN quoted_analyte_selection qs ON qs.line_id = rt.quoted_line_id
             WHERE rt.id = ?::uuid AND qs.analyte_id = ?::uuid AND qs.included""", test, analyte) != null;
    }

    public int includedCount(Object test) {
        return ((Number) db.one("SELECT count(*)::int AS n FROM requested_analyte WHERE requested_test_id = ?::uuid AND included", test).get("n")).intValue();
    }

    // ---------------------------------------------------------------- rush
    public RushDecision.Tier tier(Object id) {
        if (id == null || "".equals(id)) return null;
        Map<String, Object> r = db.one("SELECT id, tier_name, schedule_id, rush_tat FROM rush_fee_tier WHERE id = ?::uuid", id);
        return r == null ? null : new RushDecision.Tier((String) r.get("id"), (String) r.get("tier_name"), (String) r.get("schedule_id"), ((Number) r.get("rush_tat")).intValue());
    }

    /** The test's rush, fee and due date, with what the email names. */
    public Map<String, Object> rushFacts(Object test) {
        return db.one("""
            SELECT rt.rush_tier_id, rt.rush_status::text AS rush_status, rt.rush_fee, rt.due_date, s.sample_code, s.client_sample_id, o.id AS order_id, o.order_code,
                   ct.email, ct.first_name, ct.last_name, t.test_name, si.site_name
              FROM requested_test rt JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id JOIN contact ct ON ct.id = o.ordering_contact_id
              JOIN test t ON t.id = rt.test_id JOIN lab_site si ON si.id = o.site_id WHERE rt.id = ?::uuid""", test);
    }

    /** Sets the rush as intake decided it (the database is told the status is explicit, so it does not re-evaluate it). */
    public void setRush(Object test, Object tier, String status, boolean tierChanges) {
        if (!tierChanges) { db.update("UPDATE requested_test SET rush_status = ?::rush_status WHERE id = ?::uuid", status, test); return; }
        db.one("SELECT set_config('lims.rush_explicit', '1', true) AS x");
        db.update("UPDATE requested_test SET rush_tier_id = ?::uuid, rush_status = ?::rush_status WHERE id = ?::uuid", tier, status, test);
        db.one("SELECT set_config('lims.rush_explicit', '', true) AS x");
    }

    public Map<String, Object> insertDecision(Map<String, Object> vals) {
        return db.one("""
            INSERT INTO rush_decision (requested_test_id, decision, requested_tier_id, replacement_tier_id, reason)
            VALUES (?::uuid, ?::rush_decision_type, ?::uuid, ?::uuid, ?) RETURNING id""",
            vals.get("requested_test_id"), vals.get("decision"), vals.get("requested_tier_id"), vals.get("replacement_tier_id"), vals.get("reason"));
    }

    public Object staffName(Object user) {
        Map<String, Object> r = db.one("SELECT full_name FROM app_user WHERE id = ?::uuid", user);
        return r == null ? null : r.get("full_name");
    }
}
