package com.tentamus.lims.clients.repo;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.RecordWriter;
import com.tentamus.lims.core.paging.PagedList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Repository;

/** Reads and writes contacts and their links to clients (client_contact, with the roles per client). */
@Repository
public class ContactRepository {
    static final String LIST_SQL = """
        SELECT ct.*, COALESCE((SELECT string_agg(COALESCE(cl.display_name, cl.legal_name), ', ' ORDER BY cl.legal_name)
          FROM client_contact cc JOIN client cl ON cl.id = cc.client_id WHERE cc.contact_id = ct.id AND cc.status = 'Active'), '') AS clients
          FROM contact ct""";
    public static final List<String> CONTACT_FIELDS = List.of("first_name", "last_name", "email", "phone", "job_title", "portal_access", "status");
    public static final List<String> LINK_FIELDS = List.of("client_id", "contact_id", "roles", "portal_visible", "status");
    private final Db db;
    private final RecordWriter contacts = new RecordWriter("contact", CONTACT_FIELDS);
    private final RecordWriter links = new RecordWriter("client_contact", LINK_FIELDS);

    public ContactRepository(Db db) { this.db = db; }

    public RecordWriter contactWriter() { return contacts; }
    public RecordWriter linkWriter() { return links; }

    public List<Map<String, Object>> all() { return db.rows(LIST_SQL + " ORDER BY ct.last_name, ct.first_name"); }

    public Map<String, Object> page(Map<String, String> query) {
        return PagedList.of(LIST_SQL)
            .filter("active", "status::text = 'Active'").filter("inactive", "status::text <> 'Active'").filter("all", "true")
            .search("contact_code", "first_name", "last_name", "first_name || ' ' || last_name", "email", "phone", "clients")
            .ids("contact_code", "email").order("ORDER BY created_at DESC, contact_code DESC")
            .run(db, query);
    }

    public Map<String, Object> findLink(String id) { return db.one("SELECT * FROM client_contact WHERE id = ?", id); }

    public Set<String> knownRoles() {
        return toSet(db.rows("SELECT role_code FROM contact_role"));
    }

    public Set<String> onePerClientRoles() {
        return toSet(db.rows("SELECT role_code FROM contact_role WHERE one_per_client"));
    }

    /** Whether another active contact of the client already holds the role. */
    public boolean roleTaken(String clientId, String exceptLinkId, String role) {
        return db.one("SELECT 1 AS x FROM client_contact WHERE client_id = ? AND (?::uuid IS NULL OR id <> ?::uuid) AND status = 'Active' AND ? = ANY(roles)",
            clientId, exceptLinkId, exceptLinkId, role) != null;
    }

    private static Set<String> toSet(List<Map<String, Object>> rows) {
        Set<String> s = new HashSet<>();
        for (Map<String, Object> r : rows) s.add((String) r.get("role_code"));
        return s;
    }
}
