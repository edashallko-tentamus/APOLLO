package com.tentamus.lims.reports.repo;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.reports.domain.FinalizationClaim;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Repository;

/** Loads and saves finalization claims; the permission checks stay in the database and keep its words. */
@Repository
public class ReportsStore {

    public void requirePermission(Db d, String code, String site) { d.one("SELECT require_permission_at(?, ?::uuid)", code, site); }

    public boolean hasPermission(Db d, String code, String site) {
        return Boolean.TRUE.equals(d.one("SELECT has_permission_at(?, ?::uuid) AS ok", code, site).get("ok"));
    }

    /** How many labs the tests belong to, and the lab when one. */
    public Map<String, Object> labsOf(Db d, List<Object> tests) {
        return d.one("""
            SELECT count(DISTINCT o.site_id)::int AS n, min(o.site_id::text) AS site FROM requested_test rt JOIN sample s ON s.id = rt.sample_id
              JOIN lab_order o ON o.id = s.lab_order_id WHERE rt.id = ANY (?::uuid[])""", tests);
    }

    public List<FinalizationClaim.Candidate> candidates(Db d, List<Object> tests) {
        return d.rows("""
            SELECT t.test_name, s.sample_code, test_awaits_finalization(rt.id) AS awaits, u.full_name AS holder
              FROM unnest(?::uuid[]) WITH ORDINALITY x(id, n) JOIN requested_test rt ON rt.id = x.id JOIN test t ON t.id = rt.test_id JOIN sample s ON s.id = rt.sample_id
              LEFT JOIN app_user u ON u.id = finalization_holder(rt.id) ORDER BY x.n""", tests).stream()
            .map(r -> new FinalizationClaim.Candidate((String) r.get("test_name"), (String) r.get("sample_code"), Boolean.TRUE.equals(r.get("awaits")), (String) r.get("holder")))
            .toList();
    }

    /** The claim and its tests (each test once); its id. */
    /** The database's guard (finalization_claim_rules) stays for Node's finalization: Java's claim and release are Report Finalization's own. */
    private static void internal(Db d, boolean on) { d.one("SELECT set_config('lims.claims_internal', ?, true)", on ? "1" : ""); }

    public Object insertClaim(Db d, String site, String note, List<Object> tests) {
        internal(d, true);
        Object id = d.one("INSERT INTO finalization_claim (site_id, claimed_by, note) VALUES (?::uuid, current_app_user(), ?) RETURNING id", site, note).get("id");
        d.update("INSERT INTO finalization_claim_test (claim_id, requested_test_id) SELECT ?::uuid, x FROM unnest(?::uuid[]) x GROUP BY x", id, tests);
        internal(d, false);
        return id;
    }

    public FinalizationClaim load(Db d, String id) {
        Map<String, Object> r = d.one("""
            SELECT c.id, c.claim_code, c.site_id, c.claimed_by, u.full_name, c.status FROM finalization_claim c JOIN app_user u ON u.id = c.claimed_by
             WHERE c.id = ?::uuid FOR UPDATE OF c""", id);
        return r == null ? null : new FinalizationClaim((String) r.get("id"), (String) r.get("claim_code"), (String) r.get("site_id"), (String) r.get("claimed_by"),
            (String) r.get("full_name"), (String) r.get("status"));
    }

    /** Releases the claim's held tests (all, or the ones named); closes the claim once none is held. How many were released. */
    public int release(Db d, FinalizationClaim c, List<Object> tests) {
        internal(d, true);
        int n = d.update("UPDATE finalization_claim_test SET status = 'Released' WHERE claim_id = ?::uuid AND status = 'Active' AND (?::uuid[] IS NULL OR requested_test_id = ANY (?::uuid[]))",
            c.id(), tests, tests);
        Map<String, Object> left = d.one("""
            SELECT bool_or(status = 'Active') AS held, bool_or(status = 'Done') AS done FROM finalization_claim_test WHERE claim_id = ?::uuid""", c.id());
        if (!Boolean.TRUE.equals(left.get("held")))
            d.update("UPDATE finalization_claim SET status = ?, closed_at = clock_timestamp() WHERE id = ?::uuid",
                FinalizationClaim.closedStatus(Boolean.TRUE.equals(left.get("done"))), c.id());
        internal(d, false);
        return n;
    }

    /** The sample of a test, and a canned reason's module (null when not found). */
    public String sampleOfTest(Db d, Object testId) {
        if (testId == null) return null;
        Map<String, Object> r = d.one("SELECT sample_id FROM requested_test WHERE id = ?::uuid", testId);
        return r == null ? null : (String) r.get("sample_id");
    }

    public String reasonModule(Db d, Object reasonId) {
        if (reasonId == null) return null;
        Map<String, Object> r = d.one("SELECT module::text AS module FROM reason_code WHERE id = ?::uuid", reasonId);
        return r == null ? null : (String) r.get("module");
    }
}
