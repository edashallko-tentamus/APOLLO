package com.tentamus.lims.clients.repo;

import com.tentamus.lims.clients.domain.Client;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.RecordWriter;
import com.tentamus.lims.core.paging.PagedList;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Repository;

/** Reads and writes clients. What a client may do (order, release reports) is decided by {@link Client}, not here. */
@Repository
public class ClientRepository {
    static final String LIST_SQL = """
        SELECT c.*, COALESCE(c.display_name, c.legal_name) AS name, p.legal_name AS parent_name,
          (SELECT count(*) FROM client_contact cc WHERE cc.client_id = c.id AND cc.status = 'Active') AS contact_count,
          (SELECT count(*) FROM project pr WHERE pr.client_id = c.id) AS project_count
          FROM client c LEFT JOIN client p ON p.id = c.parent_client_id""";
    private final Db db;
    private final RecordWriter writer = new RecordWriter("client", Client.EDITABLE);

    public ClientRepository(Db db) { this.db = db; }

    public RecordWriter writer() { return writer; }

    public List<Map<String, Object>> all() {
        return withStatusRules(db.rows(LIST_SQL + " ORDER BY c.legal_name"));
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> page(Map<String, String> query) {
        Map<String, Object> page = PagedList.of(LIST_SQL)
            .filter("current", "account_status::text <> 'Inactive'").filter("active", "account_status::text = 'Active'")
            .filter("hold", "account_status::text = 'On Hold'").filter("inactive", "account_status::text = 'Inactive'").filter("all", "true")
            .search("client_code", "legal_name", "display_name", "parent_name", "billing_address").ids("client_code")
            .order("ORDER BY created_at DESC, client_code DESC")
            .run(db, query);
        withStatusRules((List<Map<String, Object>>) page.get("rows"));
        if (page.get("exact") instanceof Map<?, ?> e) withStatusRules(List.of((Map<String, Object>) e));
        return page;
    }

    public Map<String, Object> find(String id) {
        Map<String, Object> c = db.one("SELECT c.*, p.legal_name AS parent_name FROM client c LEFT JOIN client p ON p.id = c.parent_client_id WHERE c.id = ?", id);
        if (c != null) withStatusRules(List.of(c));
        return c;
    }

    public List<Map<String, Object>> contactsOf(String id) {
        return db.rows("""
            SELECT cc.id, cc.contact_id, cc.roles, cc.portal_visible, cc.status, ct.contact_code,
              ct.first_name || ' ' || ct.last_name AS contact_name, ct.email, ct.status AS contact_status
              FROM client_contact cc JOIN contact ct ON ct.id = cc.contact_id WHERE cc.client_id = ? ORDER BY ct.last_name""", id);
    }

    public List<Map<String, Object>> projectsOf(String id) {
        return db.rows("""
            SELECT p.id, p.project_code, p.project_name, p.is_list_price_acceptance, p.status,
              (SELECT pv.status FROM project_version pv WHERE pv.project_id = p.id ORDER BY version_no DESC LIMIT 1) AS latest_status,
              (SELECT max(version_no) FROM project_version pv WHERE pv.project_id = p.id) AS latest_version
              FROM project p WHERE p.client_id = ? ORDER BY p.project_code""", id);
    }

    public List<Map<String, Object>> childrenOf(String id) {
        return db.rows("SELECT id, client_code, legal_name, account_status FROM client WHERE parent_client_id = ?", id);
    }

    /** The quoted lines this client may order. Still worked out by the database (the Quotes feature has not moved yet). */
    public List<Map<String, Object>> orderableLines(String id) {
        return db.rows("""
            SELECT ol.*, pv.project_id, pv.id AS project_version_id, pv.version_no FROM orderable_lines(?) ol
              JOIN quoted_test_configuration q ON q.id = ol.line_id JOIN project_version pv ON pv.id = q.project_version_id
             ORDER BY ol.project_code, ol.test_name""", id);
    }

    /** The given client and every client above it. */
    public List<String> selfAndAncestors(String clientId) {
        return db.rows("""
            WITH RECURSIVE up AS (SELECT id, parent_client_id FROM client WHERE id = ?
              UNION ALL SELECT c.id, c.parent_client_id FROM client c JOIN up ON c.id = up.parent_client_id)
            SELECT id FROM up""", clientId).stream().map(r -> (String) r.get("id")).toList();
    }

    private static List<Map<String, Object>> withStatusRules(List<Map<String, Object>> rows) {
        for (Map<String, Object> r : rows) {
            String status = r.get("account_status") == null ? null : r.get("account_status").toString();
            r.put("can_order", Client.canOrder(status));
            r.put("can_release", Client.canReleaseReport(status));
        }
        return rows;
    }
}
