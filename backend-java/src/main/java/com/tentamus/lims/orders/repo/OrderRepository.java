package com.tentamus.lims.orders.repo;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.RecordWriter;
import com.tentamus.lims.core.paging.PagedList;
import com.tentamus.lims.orders.domain.LabOrder;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Repository;

/** Lab orders, their samples and requested tests, and the lists an order page needs. */
@Repository
public class OrderRepository {
    /** Orders of origin Workflow Verification are the automated runs' own: shown on their verification, not in the lab's lists. */
    static final String ORDERS_SQL = "SELECT * FROM lab_order_view WHERE site_id = ?::uuid AND origin::text <> 'Workflow Verification'";
    static final String TESTS_SQL = """
        SELECT v.*, rt2.serving_order, rt2.catalogue_order, (SELECT count(*) FROM specification sp WHERE sp.requested_test_id = v.id AND sp.status = 'Active') AS spec_count,
            rt2.ordered_package_id, op.order_package_code, op.status AS package_status, tp.package_code, tp.package_name
          FROM requested_test_view v JOIN requested_test rt2 ON rt2.id = v.id LEFT JOIN ordered_package op ON op.id = rt2.ordered_package_id
          LEFT JOIN test_package tp ON tp.id = op.package_id""";
    static final String SERVING_COLUMNS = "s2.serving_size, s2.serving_unit, s2.serving_count, s2.serving_count_unit, s2.servings_per_package, s2.report_per_serving, "
        + "s2.unit_weight, s2.unit_weight_unit, s2.unit_weight_result_id, s2.density, s2.density_unit, s2.density_result_id, s2.metrc_id";

    public static final RecordWriter NEW_ORDER = new RecordWriter("lab_order", List.of("client_id", "site_id", "ordering_contact_id", "submission_channel",
        "po_number", "notes", "client_license_id"));
    public static final RecordWriter ORDER = new RecordWriter("lab_order", List.of("po_number", "notes", "status", "ordering_contact_id", "submission_channel",
        "client_license_id"));
    public static final RecordWriter SAMPLES = new RecordWriter("sample", List.of("client_sample_id", "description", "matrix", "product", "lot", "batch",
        "quantity_received", "quantity_unit", "number_of_units", "condition", "receipt_temperature", "preservation", "received_at", "status", "compliance_category",
        "serving_size", "serving_unit", "serving_count", "serving_count_unit", "servings_per_package", "report_per_serving", "metrc_id"));
    public static final RecordWriter TESTS = new RecordWriter("requested_test", List.of("rush_tier_id", "status", "special_instructions", "tat_override"));
    public static final RecordWriter ANALYTES = new RecordWriter("requested_analyte", List.of("included"));
    private final Db db;

    public OrderRepository(Db db) { this.db = db; }

    public List<Map<String, Object>> orders(String site) { return db.rows(ORDERS_SQL + " ORDER BY order_code DESC", site); }

    /** Current work first; finished = reported. A sample ID typed or scanned opens its order. */
    public Map<String, Object> page(String site, Map<String, String> query) {
        return PagedList.of(ORDERS_SQL, site)
            .filter("current", "status::text NOT IN ('Reported','Complete')").filter("finished", "status::text IN ('Reported','Complete')").filter("all", "true")
            .search("order_code", "client_name", "client_code", "po_number", "ordering_contact").ids("order_code", "po_number").order("ORDER BY order_code DESC")
            .findExact(q -> db.one("""
                SELECT o.id, o.order_code, s.id AS sample_id FROM sample s JOIN lab_order o ON o.id = s.lab_order_id
                 WHERE o.site_id = ?::uuid AND upper(replace(s.sample_code, ' ', '')) = upper(replace(?, ' ', '')) LIMIT 1""", site, q))
            .run(db, query);
    }

    public Map<String, Object> order(Object id) { return db.one("SELECT * FROM lab_order_view WHERE id = ?::uuid", id); }

    /** Not in lab_order_view (055). */
    public Object licenseOf(Object orderId) { return db.one("SELECT client_license_id FROM lab_order WHERE id = ?::uuid", orderId).get("client_license_id"); }

    public Map<String, Object> orderLab(String id) { return db.one("SELECT id, site_id FROM lab_order WHERE id = ?::uuid", id); }

    /** The stored order the rules read, or null. */
    public LabOrder.State state(Object id) {
        Map<String, Object> r = db.one("""
            SELECT o.id, o.client_id, o.status::text AS status, o.ordering_contact_id, o.client_license_id,
                   EXISTS (SELECT 1 FROM sample s WHERE s.lab_order_id = o.id) AS has_samples FROM lab_order o WHERE o.id = ?::uuid""", id);
        return r == null ? null : new LabOrder.State((String) r.get("id"), (String) r.get("client_id"), (String) r.get("status"),
            (String) r.get("ordering_contact_id"), (String) r.get("client_license_id"), Boolean.TRUE.equals(r.get("has_samples")));
    }

    /** May the client order, and is the contact one of its active ordering contacts. */
    public LabOrder.Party party(Object client, Object contact) {
        Map<String, Object> r = db.one("""
            SELECT (SELECT account_status::text FROM client WHERE id = ?::uuid) AS account_status,
                   EXISTS (SELECT 1 FROM client_contact cc JOIN contact ct ON ct.id = cc.contact_id
                            WHERE cc.contact_id = ?::uuid AND cc.client_id = ?::uuid AND cc.status = 'Active' AND ct.status = 'Active'
                              AND 'ORDERING' = ANY(cc.roles)) AS contact_orders""", client, contact, client);
        return new LabOrder.Party((String) r.get("account_status"), Boolean.TRUE.equals(r.get("contact_orders")));
    }

    /** Submitting stamps the time once (the database stamps it too, for the orders its own functions submit). */
    public void stampSubmitted(Object id) {
        Map<String, Object> r = db.one("SELECT status::text AS status, submitted_at FROM lab_order WHERE id = ?::uuid", id);
        if (r != null && LabOrder.stampsSubmitted((String) r.get("status"), r.get("submitted_at")))
            db.update("UPDATE lab_order SET submitted_at = clock_timestamp() WHERE id = ?::uuid", id);
    }

    public LabOrder.License license(Object id) {
        if (id == null) return null;
        Map<String, Object> r = db.one("SELECT license_code, client_id, status::text AS status FROM client_license WHERE id = ?::uuid", id);
        return r == null ? null : new LabOrder.License((String) r.get("license_code"), (String) r.get("client_id"), (String) r.get("status"));
    }

    public List<Map<String, Object>> samplesOf(String orderId) {
        return db.rows("SELECT sv.*, (SELECT count(*) FROM sample_photo ph WHERE ph.sample_id = sv.id AND ph.status = 'Active')::int AS photo_count, " + SERVING_COLUMNS
            + " FROM sample_view sv JOIN sample s2 ON s2.id = sv.id WHERE sv.lab_order_id = ?::uuid ORDER BY sv.created_at, sv.client_sample_id", orderId);
    }

    public List<Map<String, Object>> testsOfOrder(String orderId) {
        return db.rows(TESTS_SQL + " WHERE v.lab_order_id = ?::uuid ORDER BY v.logged_at NULLS LAST, v.client_sample_id, v.test_name", orderId);
    }

    public List<Map<String, Object>> testsOfSample(String sampleId) { return db.rows(TESTS_SQL + " WHERE v.sample_id = ?::uuid ORDER BY v.test_name", sampleId); }

    public List<Map<String, Object>> orderablePackages(Object client, Object site) {
        return db.rows("SELECT * FROM orderable_packages(?::uuid) WHERE site_id = ?::uuid ORDER BY project_code, package_name", client, site);
    }

    /** The client's quoted lines this lab can order (another lab's tests are subcontracted: not ordered here). */
    public List<Map<String, Object>> orderableLines(Object client, Object site) {
        return db.rows("""
            SELECT ol.*, pv.project_id, pv.id AS project_version_id, pv.version_no FROM orderable_lines(?::uuid) ol JOIN quoted_test_configuration q ON q.id = ol.line_id
              JOIN project_version pv ON pv.id = q.project_version_id JOIN test tt ON tt.id = ol.test_id
             WHERE tt.site_id IS NULL OR tt.site_id = ?::uuid ORDER BY ol.project_code, ol.test_name""", client, site);
    }

    public List<Map<String, Object>> quotedElsewhere(Object client, Object site) {
        return db.rows("""
            SELECT DISTINCT ol.test_name, ls.site_code FROM orderable_lines(?::uuid) ol JOIN test tt ON tt.id = ol.test_id JOIN lab_site ls ON ls.id = tt.site_id
             WHERE tt.site_id <> ?::uuid ORDER BY ls.site_code, ol.test_name""", client, site);
    }

    public List<Map<String, Object>> units() {
        return db.rows("SELECT unit_code, unit_name, dimension::text AS dimension, is_serving_unit FROM unit_of_measure WHERE status = 'Active' ORDER BY sort_order, unit_code");
    }

    public List<Map<String, Object>> rushTiers() {
        return db.rows("""
            SELECT rt.id, rt.schedule_id, s.schedule_name, rt.tier_name, rt.rush_tat, rt.tat_unit, rt.sort_order
              FROM rush_fee_tier rt JOIN rush_fee_schedule s ON s.id = rt.schedule_id WHERE rt.status = 'Active' ORDER BY s.schedule_name, rt.rush_tat""");
    }

    public List<Map<String, Object>> orderingContacts(Object client) {
        return db.rows("""
            SELECT ct.id, ct.first_name || ' ' || ct.last_name AS name FROM client_contact cc JOIN contact ct ON ct.id = cc.contact_id
             WHERE cc.client_id = ?::uuid AND cc.status = 'Active' AND ct.status = 'Active' AND 'ORDERING' = ANY(cc.roles) ORDER BY ct.last_name""", client);
    }

    public List<Map<String, Object>> emails(String orderId) { return db.rows("SELECT * FROM email_outbox WHERE lab_order_id = ?::uuid ORDER BY created_at DESC", orderId); }

    public List<Object> names(String sql) { return db.rows(sql).stream().map(r -> r.values().iterator().next()).toList(); }

    public List<Map<String, Object>> attachments(String orderId) {
        return db.rows("""
            SELECT a.id, a.kind, a.label, a.sample_id, f.file_name, a.created_at FROM sample_attachment a JOIN document_file f ON f.id = a.document_id
             WHERE a.lab_order_id = ?::uuid AND a.status = 'Active' ORDER BY a.created_at""", orderId);
    }

    /** The client's licenses the order can name: current first, the order's own even if retired, judged on the lab's date. */
    public List<Map<String, Object>> licenses(Object client, Object current, Object site) {
        return db.rows("""
            SELECT id, license_code, license_type, license_number, issuing_authority, expires_on, license_state_on(expires_on, status::text, site_today(?::uuid)) AS state, status_text
              FROM client_license_view WHERE client_id = ?::uuid AND (status = 'Active' OR id = ?::uuid)
             ORDER BY (license_state_on(expires_on, status::text, site_today(?::uuid)) = 'Expired'), license_type, expires_on DESC NULLS FIRST""", site, client, current, site);
    }

    public Map<String, Object> sample(String id) {
        return db.one("SELECT sv.*, " + SERVING_COLUMNS + " FROM sample_view sv JOIN sample s2 ON s2.id = sv.id WHERE sv.id = ?::uuid", id);
    }

    public Map<String, Object> sampleLab(String id) {
        return db.one("SELECT o.site_id FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = ?::uuid", id);
    }

    public Object fullName(Object userId) {
        Map<String, Object> r = db.one("SELECT full_name FROM app_user WHERE id = ?::uuid", userId);
        return r == null ? null : r.get("full_name");
    }

    /** What still holds results per serving, and the serving tests on the sample (033). */
    public List<Map<String, Object>> servingHeld(String sampleId) {
        return db.rows("""
            SELECT rt.id, t.test_name, serving_problem(rt.id) AS problem FROM requested_test rt JOIN test t ON t.id = rt.test_id
             WHERE rt.sample_id = ?::uuid AND rt.status <> 'Cancelled' AND serving_problem(rt.id) IS NOT NULL ORDER BY t.test_name""", sampleId);
    }

    public List<Map<String, Object>> servingTests(String sampleId) {
        return db.rows("""
            SELECT t.serving_role, t.test_name, rt.status::text AS status FROM requested_test rt JOIN test t ON t.id = rt.test_id
             WHERE rt.sample_id = ?::uuid AND rt.status <> 'Cancelled' AND t.serving_role IS NOT NULL""", sampleId);
    }

    public Object orderableCount(String client) { return db.one("SELECT count(*) AS n FROM orderable_lines(?::uuid)", client).get("n"); }

    public Map<String, Object> testLab(String testId) {
        return db.one("SELECT o.site_id FROM requested_test rt JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id WHERE rt.id = ?::uuid", testId);
    }

    public List<Map<String, Object>> analytesOf(String testId) {
        return db.rows("""
            SELECT ra.*, a.analyte_name, a.report_name FROM requested_analyte ra
              JOIN analyte a ON a.id = ra.analyte_id WHERE ra.requested_test_id = ?::uuid ORDER BY a.analyte_name""", testId);
    }
}
