package com.tentamus.lims.quotes.repo;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.RecordWriter;
import com.tentamus.lims.core.paging.PagedList;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.quotes.domain.Project;
import com.tentamus.lims.quotes.domain.QuoteLine;
import com.tentamus.lims.quotes.domain.QuoteVersion;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Repository;

/**
 * Projects and quotes (a quote is a project of kind 'Quote'), their versions, quoted lines, rush terms and analyte choices.
 */
@Repository
public class ProjectRepository {
    static final String PROJECTS_SQL = """
        SELECT p.*, COALESCE(cl.display_name, cl.legal_name) AS client_name,
          lv.version_no AS latest_version, lv.status AS latest_status, lv.id AS latest_version_id,
          (SELECT count(*) FROM quoted_test_configuration q WHERE q.project_version_id = lv.id AND q.status = 'Active') AS line_count
          FROM project p JOIN client cl ON cl.id = p.client_id
          LEFT JOIN LATERAL (SELECT * FROM project_version pv WHERE pv.project_id = p.id ORDER BY version_no DESC LIMIT 1) lv ON true
         WHERE p.kind = 'Project'""";
    public static final RecordWriter NEW_PROJECT = new RecordWriter("project", Project.NEW);
    public static final RecordWriter PROJECT = new RecordWriter("project", Project.EDITABLE);
    public static final RecordWriter VERSION = new RecordWriter("project_version", List.of("valid_until", "notes"));
    public static final RecordWriter VERSION_STATUS = new RecordWriter("project_version", List.of("status", "valid_until", "accepted_by_contact_id"));
    public static final RecordWriter LINES = new RecordWriter("quoted_test_configuration", List.of("test_id", "quantity", "final_price", "special_instructions", "status"));
    public static final RecordWriter RUSH_TERMS = new RecordWriter("quote_rush_term", List.of("discount_pct"));
    public static final RecordWriter ANALYTE_CHOICES = new RecordWriter("quoted_analyte_selection", List.of("included"));
    private final Db db;

    public ProjectRepository(Db db) { this.db = db; }

    public List<Map<String, Object>> projects() { return db.rows(PROJECTS_SQL + " ORDER BY p.project_code DESC"); }

    public Map<String, Object> page(Map<String, String> query) {
        return PagedList.of(PROJECTS_SQL)
            .filter("open", "latest_status::text IN ('Draft','Submitted for Quote','Quoted')").filter("accepted", "latest_status::text = 'Accepted'")
            .filter("closed", "latest_status::text IN ('Superseded','Rejected','Expired')").filter("all", "true").defaultFilter("all")
            .search("project_code", "project_name", "client_name").ids("project_code").order("ORDER BY project_code DESC")
            .run(db, query);
    }

    public Map<String, Object> project(String id) {
        return db.one("""
            SELECT p.*, COALESCE(cl.display_name, cl.legal_name) AS client_name FROM project p
              JOIN client cl ON cl.id = p.client_id WHERE p.id = ?""", id);
    }

    public List<Map<String, Object>> versionsOf(String projectId) {
        return db.rows("""
            SELECT pv.*, ct.first_name || ' ' || ct.last_name AS accepted_by,
              (SELECT sum(line_total) FROM quoted_test_configuration q WHERE q.project_version_id = pv.id AND q.status = 'Active') AS total
              FROM project_version pv LEFT JOIN contact ct ON ct.id = pv.accepted_by_contact_id WHERE pv.project_id = ? ORDER BY version_no DESC""", projectId);
    }

    public Map<String, Object> newVersion(Db d, Object projectId) { return d.one("SELECT new_project_version(?::uuid) AS id", projectId); }

    /** One version with its project, client, owner and sending details. */
    public Map<String, Object> version(String vid) {
        return db.one("""
            SELECT pv.*, p.project_code, p.project_name, p.purpose, p.client_id, p.is_list_price_acceptance,
              p.available_to_child_clients, COALESCE(cl.display_name, cl.legal_name) AS client_name, cl.legal_name AS client_legal_name,
              cl.billing_address, cl.account_status, ct.first_name || ' ' || ct.last_name AS accepted_by, version_is_editable(pv.id) AS editable,
              p.kind, p.quote_contact_id, p.site_id AS quote_site_id, (SELECT site_code FROM lab_site WHERE id = p.site_id) AS quote_site_code,
              COALESCE(p.owner_id, p.created_by) AS owner_id, ou.full_name AS owner_name, qu.full_name AS quoted_by_name,
              NULLIF(btrim(COALESCE(sc.first_name, '') || ' ' || COALESCE(sc.last_name, '')), '') AS sent_to_name, sc.email AS sent_to_email,
              (SELECT max(version_no) FROM project_version x WHERE x.project_id = p.id) AS latest_version_no
              FROM project_version pv JOIN project p ON p.id = pv.project_id JOIN client cl ON cl.id = p.client_id
              LEFT JOIN contact ct ON ct.id = pv.accepted_by_contact_id LEFT JOIN app_user ou ON ou.id = COALESCE(p.owner_id, p.created_by)
              LEFT JOIN app_user qu ON qu.id = pv.quoted_by LEFT JOIN contact sc ON sc.id = pv.sent_to_contact_id WHERE pv.id = ?""", vid);
    }

    /** The quoted lines outside packages, with the lab doing each test (another network lab's is subcontracted). */
    public List<Map<String, Object>> lines(String vid) {
        return db.rows("""
            SELECT r.*, t.id AS test_id, (SELECT count(*) FROM specification sp WHERE sp.quoted_line_id = r.line_id AND sp.status = 'Active') AS spec_count,
              COALESCE(ls.site_code, '') AS lab, q.is_subcontracted, q.cost_price, q.sc_discount_pct, q.sc_markup_pct
              FROM quote_line_review r JOIN test t ON t.test_code = r.test_code JOIN quoted_test_configuration q ON q.id = r.line_id
              LEFT JOIN lab_site ls ON ls.id = t.site_id WHERE r.project_version_id = ? AND q.quoted_package_id IS NULL
             ORDER BY q.is_subcontracted, ls.site_code NULLS LAST, r.test_name""", vid);
    }

    public List<Map<String, Object>> rushTerms(String vid) {
        return db.rows("SELECT * FROM quote_rush_term WHERE project_version_id = ? ORDER BY schedule_name, rush_tat", vid);
    }

    public List<Map<String, Object>> clientContacts(Object clientId) {
        return db.rows("""
            SELECT ct.id, ct.first_name || ' ' || ct.last_name AS name, ct.email, cc.roles FROM client_contact cc
              JOIN contact ct ON ct.id = cc.contact_id WHERE cc.client_id = ?::uuid AND cc.status = 'Active' AND ct.status = 'Active' ORDER BY ct.last_name""", clientId);
    }

    public List<Map<String, Object>> activeCatalogue() {
        return db.rows("SELECT test_id, test_code, test_name, pricing_mode, list_price FROM test_catalogue WHERE test_status = 'Active' ORDER BY test_name");
    }

    /** New lines start at their list price (worked out by the database: the client's price, subcontracted or not). */
    public void prefill(Db d, List<String> lineIds) {
        d.update("UPDATE quoted_test_configuration SET final_price = list_price WHERE id = ANY(?::uuid[]) AND final_price IS NULL", lineIds);
    }

    // ---------------------------------------------------------------- the domain objects the quoting rules work on
    private static final String QUOTE_VERSION_SQL = """
        SELECT pv.id, pv.project_id, p.client_id, p.site_id, p.kind, p.is_list_price_acceptance, pv.status::text AS status,
               pv.valid_until::text AS valid_until, pv.notes
          FROM project_version pv JOIN project p ON p.id = pv.project_id WHERE pv.id = """;

    /** A version as the quoting rules see it; null when it does not exist. */
    public QuoteVersion quoteVersion(Db d, Object versionId) {
        return RequestContext.isUuid(versionId) ? toVersion(d.one(QUOTE_VERSION_SQL + "?::uuid", versionId)) : null;
    }

    public QuoteVersion versionOfLine(Db d, Object lineId) {
        return toVersion(d.one(QUOTE_VERSION_SQL + "(SELECT project_version_id FROM quoted_test_configuration WHERE id = ?::uuid)", lineId));
    }

    public QuoteVersion versionOfRushTerm(Db d, Object termId) {
        return toVersion(d.one(QUOTE_VERSION_SQL + "(SELECT project_version_id FROM quote_rush_term WHERE id = ?::uuid)", termId));
    }

    private static QuoteVersion toVersion(Map<String, Object> r) {
        if (r == null) return null;
        return new QuoteVersion((String) r.get("id"), (String) r.get("project_id"), (String) r.get("client_id"), (String) r.get("site_id"),
            (String) r.get("kind"), Boolean.TRUE.equals(r.get("is_list_price_acceptance")), (String) r.get("status"), (String) r.get("valid_until"), (String) r.get("notes"));
    }

    /** What a status move needs: the active lines, those without a final price, and whether the acceptor is an active contact. */
    /** @param acceptor the accepting contact sent with the move; empty to keep the stored one */
    public QuoteVersion.Readiness readiness(Db d, QuoteVersion v, java.util.Optional<Object> acceptor) {
        Map<String, Object> r = d.one("""
            SELECT (SELECT count(*) FROM quoted_test_configuration WHERE project_version_id = ?::uuid AND status = 'Active') AS lines,
                   (SELECT count(*) FROM quoted_test_configuration WHERE project_version_id = ?::uuid AND status = 'Active' AND final_price IS NULL) AS unpriced,
                   EXISTS (SELECT 1 FROM client_contact cc JOIN contact ct ON ct.id = cc.contact_id
                            WHERE cc.client_id = ?::uuid AND cc.status = 'Active' AND ct.status = 'Active'
                              AND cc.contact_id = CASE WHEN ?::boolean THEN ?::uuid ELSE (SELECT accepted_by_contact_id FROM project_version WHERE id = ?::uuid) END) AS acceptor_ok""",
            v.id(), v.id(), v.clientId(), acceptor.isPresent(), acceptor.filter(RequestContext::isUuid).orElse(null), v.id());
        return new QuoteVersion.Readiness(((Number) r.get("lines")).intValue(), ((Number) r.get("unpriced")).intValue(), Boolean.TRUE.equals(r.get("acceptor_ok")));
    }

    /** A quoted line, with the code of the package it belongs to; null when it does not exist. */
    public QuoteLine line(Db d, Object lineId) {
        Map<String, Object> r = d.one("""
            SELECT q.id, q.test_id, qp.package_code FROM quoted_test_configuration q LEFT JOIN quoted_package qp ON qp.id = q.quoted_package_id
             WHERE q.id = ?::uuid""", lineId);
        return r == null ? null : new QuoteLine((String) r.get("id"), (String) r.get("test_id"), (String) r.get("package_code"));
    }

    /** An active test with catalogue pricing can be quoted. */
    public boolean quotable(Db d, Object testId) {
        return RequestContext.isUuid(testId) && d.one("""
            SELECT 1 AS x FROM test t JOIN test_catalog_entry e ON e.test_id = t.id WHERE t.id = ?::uuid AND t.status = 'Active'""", testId) != null;
    }

    /** An analyte choice's line: whether it is in a package, and its version. */
    public Map<String, Object> analyteChoiceLine(Db d, Object choiceId) {
        return d.one("""
            SELECT q.id AS line_id, q.quoted_package_id IS NOT NULL AS in_package FROM quoted_analyte_selection s
              JOIN quoted_test_configuration q ON q.id = s.line_id WHERE s.id = ?::uuid""", choiceId);
    }

    public boolean activeContactOf(Db d, Object clientId, Object contactId) {
        return d.one("SELECT 1 AS x FROM client_contact WHERE client_id = ?::uuid AND contact_id = ?::uuid AND status = 'Active'", clientId, contactId) != null;
    }

    public Map<String, Object> projectRow(Db d, Object projectId) {
        return d.one("SELECT id, client_id, kind FROM project WHERE id = ?::uuid", projectId);
    }

    public List<Map<String, Object>> analyteChoices(String lineId) {
        return db.rows("""
            SELECT s.*, a.analyte_code, a.analyte_name, a.report_name FROM quoted_analyte_selection s
              JOIN analyte a ON a.id = s.analyte_id WHERE s.line_id = ? ORDER BY a.analyte_name""", lineId);
    }
}
