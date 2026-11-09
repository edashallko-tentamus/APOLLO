package com.tentamus.lims.clients.repo;

import com.tentamus.lims.clients.domain.ClientLicense;
import com.tentamus.lims.clients.domain.LicenseState;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.RecordWriter;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.springframework.stereotype.Repository;

/**
 * Reads and writes client licenses. Rows have the columns of the former client_license_view; their state and days left
 * are worked out by {@link LicenseState} on the lab's own date.
 */
@Repository
public class LicenseRepository {
    static final String SELECT = """
        SELECT l.id, l.license_code, l.client_id, l.license_type, l.license_number, l.issuing_authority, l.issued_on, l.expires_on,
               l.document_id, l.note, l.status, l.retired_reason, l.record_version, l.created_at, l.created_by, l.modified_at, l.modified_by,
               l.status::text AS status_text, COALESCE(c.display_name, c.legal_name) AS client_name, c.client_code,
               c.account_status::text AS account_status, f.file_name AS document_name, u.full_name AS created_by_name
          FROM client_license l JOIN client c ON c.id = l.client_id
          LEFT JOIN document_file f ON f.id = l.document_id JOIN app_user u ON u.id = l.created_by""";
    private final Db db;
    private final RecordWriter writer = new RecordWriter("client_license",
        Stream.concat(ClientLicense.FIELDS.stream(), Stream.of("status", "retired_reason", "document_id")).toList());

    public LicenseRepository(Db db) { this.db = db; }

    public RecordWriter writer() { return writer; }

    public List<Map<String, Object>> ofClient(String clientId, LocalDate today) {
        return withState(db.rows(SELECT + " WHERE l.client_id = ? ORDER BY (l.status = 'Retired'), l.license_type, l.expires_on DESC NULLS FIRST", clientId), today);
    }

    /** Every active license: expired first, then expiring soon, then by expiry date and client. */
    public List<Map<String, Object>> active(LocalDate today) {
        List<Map<String, Object>> rows = new ArrayList<>(withState(db.rows(SELECT + " WHERE l.status = 'Active' ORDER BY l.expires_on NULLS LAST, client_name"), today));
        rows.sort(Comparator.comparingInt(r -> urgency((String) r.get("state"))));   // stable: keeps the expiry and name order
        return rows;
    }

    public Map<String, Object> find(String id) { return db.one("SELECT * FROM client_license WHERE id = ?", id); }

    /** The scanned copy's name and type, or null when the license has none. */
    public Map<String, Object> fileInfo(String id) {
        return db.one("SELECT f.file_name, f.mime_type FROM client_license l JOIN document_file f ON f.id = l.document_id WHERE l.id = ?", id);
    }

    public byte[] fileBytes(String id) {
        Map<String, Object> r = db.one("SELECT encode(f.content, 'base64') AS b64 FROM client_license l JOIN document_file f ON f.id = l.document_id WHERE l.id = ?", id);
        return r == null ? null : java.util.Base64.getMimeDecoder().decode((String) r.get("b64"));
    }

    private static List<Map<String, Object>> withState(List<Map<String, Object>> rows, LocalDate today) {
        for (Map<String, Object> r : rows) {
            LicenseState s = LicenseState.on(r.get("expires_on") == null ? null : LocalDate.parse(r.get("expires_on").toString()),
                r.get("status") == null ? null : r.get("status").toString(), today);
            r.put("state", s.state());
            r.put("days_left", s.daysLeft());
        }
        return rows;
    }

    private static int urgency(String state) {
        return new LicenseState(state, null).urgency();
    }
}
