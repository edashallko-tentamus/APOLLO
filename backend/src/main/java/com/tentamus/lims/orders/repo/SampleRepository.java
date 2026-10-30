package com.tentamus.lims.orders.repo;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.inventory.repo.UnitRepository;
import com.tentamus.lims.orders.domain.SampleLists;
import com.tentamus.lims.orders.domain.TatClock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Repository;

/** Samples as stored, the lists their values come from, the lab's calendar, and the writes of logging. */
@Repository
public class SampleRepository {
    private final Db db;
    private final UnitRepository units;

    public SampleRepository(Db db, UnitRepository units) {
        this.db = db;
        this.units = units;
    }

    /** The sample's columns, or null. */
    public Map<String, Object> find(Object id) { return id == null ? null : db.one("SELECT * FROM sample WHERE id = ?::uuid", id); }

    public SampleLists lists() {
        return new SampleLists(names("SELECT matrix_name FROM matrix WHERE status = 'Active'"),
            names("SELECT category_name FROM compliance_category WHERE status = 'Active'"), units.load(),
            names("SELECT unit_code FROM unit_of_measure WHERE is_serving_unit AND status = 'Active'"));
    }

    private List<String> names(String sql) { return db.rows(sql).stream().map(r -> (String) r.values().iterator().next()).toList(); }

    /** The lab of an order: id, code, time zone and whether it logs samples only through a signed receipt. */
    public Map<String, Object> lab(Object orderId) {
        return db.one("""
            SELECT ls.id, ls.site_code, ls.time_zone, ls.custody_signature_required FROM lab_order o JOIN lab_site ls ON ls.id = o.site_id WHERE o.id = ?::uuid""", orderId);
    }

    public TatClock clock(Object siteId, String timeZone) {
        Set<LocalDate> h = new HashSet<>();
        for (Map<String, Object> r : db.rows("SELECT holiday_date FROM site_holiday WHERE site_id = ?::uuid AND status = 'Active'", siteId))
            h.add(LocalDate.parse(r.get("holiday_date").toString()));
        return new TatClock(ZoneId.of(timeZone), h);
    }

    /** Samples to log: the given ones still expected and not logged, oldest first, with their order. */
    public List<Map<String, Object>> toLog(Object ids) {
        return db.rows("""
            SELECT s.*, (SELECT count(*) FROM requested_test rt WHERE rt.sample_id = s.id AND rt.status <> 'Cancelled')::int AS active_tests
              FROM sample s WHERE s.id = ANY(?::uuid[]) AND s.logged_at IS NULL AND s.status = 'Expected' ORDER BY s.created_at, s.id""", ids);
    }

    /** The lab's next number for its date (one counter per lab and day). */
    public int nextDayNumber(Object siteId, LocalDate day) {
        return ((Number) db.one("""
            INSERT INTO site_day_counter (site_id, day, last_no) VALUES (?::uuid, ?::date, 1)
            ON CONFLICT (site_id, day) DO UPDATE SET last_no = site_day_counter.last_no + 1 RETURNING last_no""", siteId, day.toString()).get("last_no")).intValue();
    }

    /** The database's clock for this transaction's writes (clock_timestamp(), as logging used). */
    public String now() { return db.one("SELECT clock_timestamp()::text AS t").get("t").toString(); }

    public void markLogged(Object id, String at, String code, String userId) {
        db.update("UPDATE sample SET logged_at = ?::timestamptz, logged_by = ?::uuid, status = 'Logged', sample_code = ? WHERE id = ?::uuid", at, userId, code, id);
    }

    /** A logged sample's open tests: what their clock needs. */
    public List<Map<String, Object>> clockInputs(Object sampleId) {
        return db.rows("""
            SELECT rt.id, rt.status::text AS status, rt.created_at::text AS created_text, rt.tat_days, rt.tat_unit::text AS tat_unit, e.cutoff_time::text AS cutoff_time
              FROM requested_test rt JOIN test_catalog_entry e ON e.test_id = rt.test_id WHERE rt.sample_id = ?::uuid AND rt.status <> 'Cancelled'""", sampleId);
    }

    /** Starts a test's clock (the database's requested-test trigger works out the same dates for its own writers). */
    public void startClock(Object testId, String clockStart, String status, String day0, String due, String recalcAt) {
        db.update("""
            UPDATE requested_test SET clock_start = ?::timestamptz, status = ?::requested_test_status, day0 = ?::date, due_date = ?::date, recalc_at = ?::timestamptz
             WHERE id = ?::uuid""", clockStart, status, day0, due, recalcAt, testId);
    }

    public Map<String, Object> orderStatus(Object orderId) {
        return db.one("""
            SELECT o.status::text AS status, o.submitted_at, EXISTS (SELECT 1 FROM sample s WHERE s.lab_order_id = o.id AND s.status = 'Expected') AS any_expected
              FROM lab_order o WHERE o.id = ?::uuid""", orderId);
    }

    public void setOrderStatus(Object orderId, String status) {
        db.update("UPDATE lab_order SET status = ?::lab_order_status WHERE id = ?::uuid", status, orderId);
    }

    /** Why each open test of a sample cannot be cancelled now (empty: it may be). */
    public List<String> cancelProblems(Object sampleId) {
        return db.rows("SELECT id FROM requested_test WHERE sample_id = ?::uuid AND status <> 'Cancelled'", sampleId).stream()
            .map(r -> cancelProblem(r.get("id"))).filter(p -> p != null).toList();
    }

    /** Why a requested test cannot be cancelled now, or null: its results, or the open batch it is in. */
    public String cancelProblem(Object testId) {
        Map<String, Object> r = db.one("""
            SELECT rt.status::text AS status, t.test_name || ' on ' || COALESCE(s.sample_code, s.client_sample_id, 'the sample') AS label,
                   (SELECT string_agg(DISTINCT tb.batch_code, ', ') FROM test_result tr JOIN test_batch tb ON tb.id = tr.batch_id
                     WHERE tr.requested_test_id = rt.id AND tr.status = 'Active') AS result_batches,
                   (SELECT tb.batch_code FROM batch_entry e JOIN test_batch tb ON tb.id = e.batch_id
                     WHERE e.requested_test_id = rt.id AND e.status = 'Active' AND tb.status::text <> 'Cancelled' ORDER BY tb.created_at DESC LIMIT 1) AS open_batch
              FROM requested_test rt JOIN test t ON t.id = rt.test_id JOIN sample s ON s.id = rt.sample_id WHERE rt.id = ?::uuid""", testId);
        if (r == null || "Cancelled".equals(r.get("status"))) return null;
        return com.tentamus.lims.orders.domain.RequestedTest.cancelProblem((String) r.get("label"), (String) r.get("result_batches"), (String) r.get("open_batch"));
    }

    /** What a unit measures (Mass, Volume...), or null. */
    public String dimensionOf(Object unit) {
        if (unit == null) return null;
        Map<String, Object> r = db.one("SELECT dimension::text AS d FROM unit_of_measure WHERE lower(unit_code) = lower(btrim(?)) LIMIT 1", unit.toString());
        return r == null ? null : (String) r.get("d");
    }
}
