package com.tentamus.lims.reports.service;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.access.UserAccess;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.files.DocumentStore;
import com.tentamus.lims.core.paging.PagedList;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.reports.domain.CoaNote;
import com.tentamus.lims.reports.domain.FinalizationClaim;
import com.tentamus.lims.reports.domain.SampleAttachment;
import com.tentamus.lims.reports.repo.ReportsStore;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Report Finalization around the COA: the queue with its claims and urgency, claiming and releasing work, issued COAs,
 * an order's and a sample's COAs, notes, the issued PDFs, and sample attachments. Making a COA (the preview and the
 * signed finalization, with its PDF and release check) is the documents engine's and stays in the Node backend for now.
 */
@Service
public class ReportsService {
    private static final String ISSUED_SQL = """
        SELECT v.id, v.version_no, v.is_final, v.issued_at, v.group_code, v.verify_code, u.full_name AS issued_by_name, s.id AS sample_id, s.sample_code,
            s.sample_code || '-R' || v.version_no AS report_id, s.client_sample_id, o.id AS lab_order_id, o.order_code, COALESCE(cl.display_name, cl.legal_name) AS client_name, cl.id AS client_id,
            (SELECT count(*) FROM email_outbox e WHERE e.coa_version_id = v.id)::int AS emails
          FROM coa_version v JOIN coa ON coa.id = v.coa_id JOIN sample s ON s.id = coa.sample_id JOIN lab_order o ON o.id = s.lab_order_id JOIN client cl ON cl.id = o.client_id
          JOIN app_user u ON u.id = v.issued_by WHERE coa.site_id = ?::uuid""";
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final ReportsStore store;

    public ReportsService(Db db, UnitOfWork uow, AccessPolicy access, ReportsStore store) {
        this.db = db;
        this.uow = uow;
        this.access = access;
        this.store = store;
    }

    /** A sample of a lab the person may see; its lab. */
    private String sampleSite(RequestContext ctx, Object id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Sample not found");
        Map<String, Object> s = db.one("SELECT o.site_id FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = ?::uuid", id);
        if (s == null) throw new RuleException("Sample not found");
        access.checkSite(ctx, (String) s.get("site_id"));
        return (String) s.get("site_id");
    }

    private static List<Object> uuids(Object o) {
        List<Object> out = new ArrayList<>();
        if (o instanceof List<?> l) for (Object x : l) if (RequestContext.isUuid(x)) out.add(x);
        return out;
    }

    // ---------------------------------------------------------------- the queue
    /** The queue with who holds each test, its OOS and its urgency; the claims in progress; final COAs due after an OOS decision. */
    public Map<String, Object> queue(RequestContext ctx) {
        String site = access.currentSite(ctx);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("rows", db.rows("""
            SELECT q.*, ct.claim_id, fc.claim_code, fc.claimed_by, cu.full_name AS claimed_by_name, (fc.claimed_by = ?::uuid) AS mine,
                (SELECT x.id FROM oos_investigation x WHERE x.requested_test_id = q.requested_test_id AND x.status <> 'Cancelled' ORDER BY x.opened_at DESC LIMIT 1) AS oos_id,
                (q.due_date IS NOT NULL AND q.due_date <= site_today(q.site_id) + 1) AS due_soon, (q.due_date IS NOT NULL AND q.due_date < site_today(q.site_id)) AS overdue,
                (q.rush_status::text IN ('Auto-accepted','Approved')) AS rush
              FROM finalization_queue_view q LEFT JOIN finalization_claim_test ct ON ct.requested_test_id = q.requested_test_id AND ct.status = 'Active'
              LEFT JOIN finalization_claim fc ON fc.id = ct.claim_id LEFT JOIN app_user cu ON cu.id = fc.claimed_by
             WHERE q.site_id = ?::uuid ORDER BY q.due_date NULLS LAST, q.approved_at""", ctx.userId(), site));
        out.put("claims", db.rows("""
            SELECT fc.id, fc.claim_code, fc.claimed_by, u.full_name AS claimed_by_name, fc.note, fc.created_at, (fc.claimed_by = ?::uuid) AS mine,
                (SELECT count(*) FROM finalization_claim_test t WHERE t.claim_id = fc.id AND t.status = 'Active')::int AS open_tests,
                (SELECT count(*) FROM finalization_claim_test t WHERE t.claim_id = fc.id AND t.status = 'Done')::int AS done_tests,
                (SELECT string_agg(DISTINCT s.sample_code, ', ') FROM finalization_claim_test t JOIN requested_test rt ON rt.id = t.requested_test_id JOIN sample s ON s.id = rt.sample_id
                  WHERE t.claim_id = fc.id AND t.status = 'Active') AS samples
              FROM finalization_claim fc JOIN app_user u ON u.id = fc.claimed_by WHERE fc.site_id = ?::uuid AND fc.status = 'Active' ORDER BY fc.created_at""", ctx.userId(), site));
        out.put("final_due", db.rows("SELECT * FROM final_coa_due_view WHERE site_id = ?::uuid ORDER BY last_issued_at", site));
        out.put("user_id", ctx.userId());
        UserAccess a = access.load(ctx.userId());
        out.put("can_finalize", a.can("reports.finalize", ctx.siteId()));
        out.put("can_gmp", a.can("reports.finalize_gmp", ctx.siteId()));
        out.put("can_take_over", a.can("admin.users", ctx.siteId()));
        return out;
    }

    /** Claim sample tests (one batch, FB-...): nobody else finalizes them until finished or released. No signature. */
    public Map<String, Object> claim(RequestContext ctx, Map<String, Object> body) {
        access.currentSite(ctx);
        List<Object> tests = uuids(body.get("tests"));
        if (tests.isEmpty()) throw new RuleException("Choose the sample tests to claim");
        Object note = truthy(body.get("note")) ? body.get("note") : null;
        return uow.run(ctx, "Finalization claimed", d -> {
            Map<String, Object> labs = store.labsOf(d, tests);
            FinalizationClaim.checkChoice(tests.size(), ((Number) labs.get("n")).intValue());
            String site = (String) labs.get("site");
            store.requirePermission(d, "reports.finalize", site);
            FinalizationClaim.checkCandidates(store.candidates(d, tests));
            Object id = store.insertClaim(d, site, FinalizationClaim.note(note == null ? null : Js.string(note)), tests);
            return d.one("SELECT id, claim_code FROM finalization_claim WHERE id = ?::uuid", id);
        });
    }

    public Map<String, Object> release(RequestContext ctx, String id, Map<String, Object> body) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Claim not found");
        Map<String, Object> cl = db.one("SELECT site_id, claimed_by FROM finalization_claim WHERE id = ?::uuid", id);
        if (cl == null) throw new RuleException("Claim not found");
        access.checkSite(ctx, (String) cl.get("site_id"));
        List<Object> tests = uuids(body.get("tests"));
        String reason = truthy(body.get("reason")) ? Js.string(body.get("reason")) : "Finalization released";
        return uow.run(ctx, reason, d -> {
            FinalizationClaim c = store.load(d, id);
            if (c == null) throw RuleException.database("Claim not found");
            c.checkRelease(ctx.userId(), store.hasPermission(d, "admin.users", c.siteId()), reason);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("n", store.release(d, c, tests.isEmpty() ? null : tests));
            return out;
        });
    }

    /** Issued COAs, newest first: a page at a time, or the last N days (90 by default). */
    public Map<String, Object> issued(RequestContext ctx, Map<String, String> query) {
        String site = access.currentSite(ctx);
        if (PagedList.wanted(query)) return PagedList.of(ISSUED_SQL, site).filter("all", "true").filter("final", "is_final").filter("interim", "NOT is_final")
            .search("report_id", "sample_code", "client_sample_id", "order_code", "client_name", "verify_code", "issued_by_name", "group_code")
            .ids("report_id", "sample_code", "verify_code").order("ORDER BY issued_at DESC").run(db, query);
        double asked = Js.toNumber(query.get("days"));
        long days = (long) Math.min(Math.max(Double.isNaN(asked) || asked == 0 ? 90 : asked, 1), 3650);
        return Map.of("rows", db.rows(ISSUED_SQL + " AND v.issued_at > clock_timestamp() - make_interval(days => ?::int) ORDER BY v.issued_at DESC LIMIT 2000", site, days));
    }

    /** The COAs of an order's samples (the order page). */
    public Map<String, Object> orderCoas(RequestContext ctx, String orderId) {
        if (!RequestContext.isUuid(orderId)) throw new RuleException("Order not found");
        Map<String, Object> o = db.one("SELECT site_id FROM lab_order WHERE id = ?::uuid", orderId);
        if (o == null) throw new RuleException("Order not found");
        access.checkSite(ctx, (String) o.get("site_id"));
        return Map.of("rows", db.rows("""
            SELECT v.id, v.version_no, v.is_final, v.issued_at, v.verify_code, u.full_name AS issued_by_name, s.id AS sample_id, s.sample_code, s.client_sample_id,
                s.sample_code || '-R' || v.version_no AS report_id,
                (v.version_no = (SELECT max(v2.version_no) FROM coa_version v2 WHERE v2.coa_id = v.coa_id)) AS latest
              FROM coa_version v JOIN coa ON coa.id = v.coa_id JOIN sample s ON s.id = coa.sample_id JOIN app_user u ON u.id = v.issued_by
             WHERE s.lab_order_id = ?::uuid ORDER BY s.sample_code, v.version_no DESC""", orderId));
    }

    // ---------------------------------------------------------------- notes
    public Map<String, Object> addNote(RequestContext ctx, Map<String, Object> body) {
        sampleSite(ctx, body.get("sample_id"));
        String text = Js.string(body.get("note_text")).trim();
        if (truthy(body.get("reason_code_id")) && text.isEmpty()) {
            Map<String, Object> r = db.one("SELECT reason_text FROM reason_code WHERE id = ?::uuid", body.get("reason_code_id"));
            text = r == null || r.get("reason_text") == null ? "" : (String) r.get("reason_text");
        }
        String note = text;
        Object test = uuidOrNull(body.get("requested_test_id")), analyte = uuidOrNull(body.get("analyte_id")), canned = uuidOrNull(body.get("reason_code_id"));
        return uow.run(ctx, d -> {
            CoaNote.checkNew(Js.string(body.get("sample_id")), test == null ? null : test.toString(), store.sampleOfTest(d, test), analyte == null ? null : analyte.toString(),
                canned == null ? null : canned.toString(), store.reasonModule(d, canned), note);
            return d.one("""
            INSERT INTO coa_note (sample_id, requested_test_id, analyte_id, kind, note_text, reason_code_id) VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?, ?::uuid) RETURNING id""",
            body.get("sample_id"), uuidOrNull(body.get("requested_test_id")), uuidOrNull(body.get("analyte_id")), "Internal".equals(body.get("kind")) ? "Internal" : "COA", note,
            uuidOrNull(body.get("reason_code_id")));
        });
    }

    public Map<String, Object> removeNote(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> n = db.one("SELECT sample_id FROM coa_note WHERE id = ?::uuid", id);
        if (n == null) throw new RuleException("Note not found");
        sampleSite(ctx, n.get("sample_id"));
        String reason = truthy(body.get("reason")) ? Js.string(body.get("reason")) : "Note removed";
        return uow.run(ctx, reason, d -> d.raw("UPDATE coa_note SET status = 'Inactive' WHERE id = ?::uuid", id));
    }

    // ---------------------------------------------------------------- issued COAs of a sample, and their PDFs
    public Map<String, Object> sampleCoa(RequestContext ctx, String sampleId) {
        sampleSite(ctx, sampleId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("versions", db.rows("""
            SELECT v.id, v.version_no, v.is_final, v.sha256, v.prev_sha256, v.verify_code, v.issued_at, v.group_code, u.full_name AS issued_by_name, c.coa_code,
                s.sample_code || '-R' || v.version_no AS report_id, v.release_checks, v.internal_note
              FROM coa_version v JOIN coa c ON c.id = v.coa_id JOIN sample s ON s.id = c.sample_id JOIN app_user u ON u.id = v.issued_by WHERE c.sample_id = ?::uuid ORDER BY v.version_no DESC""",
            sampleId));
        out.put("notes", db.rows("""
            SELECT n.id, n.kind, n.note_text, COALESCE(an.report_name, an.analyte_name) AS analyte, t.test_name, u.full_name AS by_name, n.created_at
              FROM coa_note n JOIN app_user u ON u.id = n.created_by LEFT JOIN requested_test rt ON rt.id = n.requested_test_id LEFT JOIN test t ON t.id = rt.test_id
              LEFT JOIN analyte an ON an.id = n.analyte_id WHERE n.sample_id = ?::uuid AND n.status = 'Active' ORDER BY n.created_at""", sampleId));
        out.put("attachments", db.rows("""
            SELECT a.id, a.kind, a.label, a.sample_id, f.file_name, a.created_at, u.full_name AS added_by FROM sample_attachment a
              JOIN document_file f ON f.id = a.document_id JOIN app_user u ON u.id = a.created_by JOIN sample s ON s.lab_order_id = a.lab_order_id
             WHERE s.id = ?::uuid AND (a.sample_id IS NULL OR a.sample_id = ?::uuid) AND a.status = 'Active' ORDER BY a.created_at""", sampleId, sampleId));
        out.put("can_attach", access.has(ctx, "orders.edit") || access.has(ctx, "reports.notes"));
        return out;
    }

    /** An issued COA's PDF, named <sample>-R<version>.pdf. */
    public Map<String, Object> coaPdf(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("COA not found");
        Map<String, Object> v = db.one("""
            SELECT v.version_no, c.coa_code, c.site_id, s.sample_code, encode(f.content, 'base64') AS b64 FROM coa_version v JOIN coa c ON c.id = v.coa_id
              JOIN sample s ON s.id = c.sample_id JOIN document_file f ON f.id = v.document_id WHERE v.id = ?::uuid""", id);
        if (v == null) throw new RuleException("COA not found");
        access.checkSite(ctx, (String) v.get("site_id"));
        return v;
    }

    // ---------------------------------------------------------------- sample attachments (submission form, chain of custody...)
    public Map<String, Object> attach(RequestContext ctx, String sampleId, Map<String, Object> body) {
        sampleSite(ctx, sampleId);
        String b64 = Js.string(body.get("b64"));
        if (b64.isEmpty()) throw new RuleException("Choose a file");
        Object order = db.one("SELECT lab_order_id FROM sample WHERE id = ?::uuid", sampleId).get("lab_order_id");
        String reason = truthy(body.get("reason")) ? Js.string(body.get("reason")) : "Attachment added";
        byte[] bytes;
        try { bytes = Base64.getMimeDecoder().decode(b64); } catch (IllegalArgumentException e) { bytes = new byte[0]; }
        byte[] content = bytes;
        String name = truthy(body.get("file_name")) ? Js.string(body.get("file_name")) : "attachment";
        SampleAttachment.checkNew(Js.string(order), truthy(body.get("whole_order")) ? null : sampleId, Js.string(order));
        return uow.run(ctx, reason, d -> {
            Object doc = d.one("INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES (?, ?, ?, ?, decode(?, 'base64')) RETURNING id",
                name.substring(0, Math.min(200, name.length())), truthy(body.get("mime_type")) ? body.get("mime_type") : "application/octet-stream", content.length,
                DocumentStore.sha256(content), b64).get("id");
            return d.one("INSERT INTO sample_attachment (lab_order_id, sample_id, document_id, kind, label) VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?) RETURNING id",
                order, truthy(body.get("whole_order")) ? null : sampleId, doc, truthy(body.get("kind")) ? body.get("kind") : "Other", truthy(body.get("label")) ? body.get("label") : null);
        });
    }

    public Map<String, Object> attachmentFile(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("File not found");
        Map<String, Object> d = db.one("""
            SELECT f.file_name, f.mime_type, encode(f.content, 'base64') AS b64, o.site_id FROM sample_attachment a JOIN document_file f ON f.id = a.document_id
              JOIN lab_order o ON o.id = a.lab_order_id WHERE a.id = ?::uuid""", id);
        if (d == null) throw new RuleException("File not found");
        access.checkSite(ctx, (String) d.get("site_id"));
        return d;
    }

    private static Object uuidOrNull(Object v) { return RequestContext.isUuid(v) ? v : null; }

    private static boolean truthy(Object v) {
        return v != null && !Boolean.FALSE.equals(v) && !"".equals(v) && !(v instanceof Number n && n.doubleValue() == 0);
    }
}
