package com.tentamus.lims.admin.service;

import static com.tentamus.lims.core.web.Answers.*;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.RecordWriter;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.files.DocumentStore;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * The remaining core routes: people with their labs and rights, reference lists (contact roles, enums), the start
 * page's counts, canned reasons, a new test, the Users and lab access page, handwritten signatures, a quote's serving
 * line. Signing in, passwords and the audit trail stay in the Node backend for now (it holds the sessions and every
 * module's audit scopes).
 */
@Service
public class AdminService {
    private static final List<String> ENUMS = List.of("account_status", "report_delivery", "analyte_class", "master_status", "record_status", "tat_unit", "surcharge_type",
        "pricing_mode", "project_version_status", "line_status", "submission_channel", "oos_procedure");
    private static final RecordWriter REASONS = new RecordWriter("reason_code", List.of("module", "reason_text", "sort_order", "status"));
    private static final RecordWriter QUOTE_LINE = new RecordWriter("quoted_test_configuration", List.of("test_id", "quantity", "special_instructions"));
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final SignatureService signatures;

    public AdminService(Db db, UnitOfWork uow, AccessPolicy access, SignatureService signatures) {
        this.db = db;
        this.uow = uow;
        this.access = access;
        this.signatures = signatures;
    }

    private void requireAdmin(RequestContext ctx) { access.require(ctx, "admin.users", "open this page"); }

    /** People with the labs they can open; for the signed-in person, their groups and permissions in each lab. */
    public List<Map<String, Object>> users(RequestContext ctx) {
        return db.rows("""
            SELECT u.id, u.username, u.full_name, u.is_admin,
              COALESCE((SELECT json_agg(json_build_object('id', s.id, 'site_code', s.site_code, 'site_name', s.site_name,
                  'view_only', NOT user_can_access_site(u.id, s.id)) ORDER BY s.site_code)
                FROM lab_site s WHERE s.status = 'Active' AND user_can_view_site(u.id, s.id)), '[]') AS sites,
              CASE WHEN u.id::text = ? THEN COALESCE((SELECT json_object_agg(s.id, json_build_object(
                  'groups', (SELECT COALESCE(json_agg(DISTINCT g.group_name), '[]') FROM group_member m JOIN lab_group g ON g.id = m.group_id
                              WHERE m.user_id = u.id AND m.status = 'Active' AND g.status = 'Active' AND (g.site_id = s.id OR g.site_id IS NULL)),
                  'perms', (SELECT COALESCE(json_agg(p.code), '[]') FROM permission p WHERE p.status = 'Active' AND user_has_permission_at(u.id, p.code, s.id))))
                FROM lab_site s WHERE s.status = 'Active' AND user_can_view_site(u.id, s.id)), '{}') END AS access
              FROM app_user u WHERE u.is_active AND u.username <> 'system' ORDER BY (u.username = 'akiddle') DESC, u.full_name""",
            ctx.userId() == null ? "" : ctx.userId());
    }

    public Map<String, Object> meta() {
        Map<String, Object> enums = new LinkedHashMap<>();
        for (String t : ENUMS) enums.put(t, db.rows("SELECT unnest(enum_range(NULL::" + t + "))::text AS v").stream().map(r -> r.get("v")).toList());
        return map("contactRoles", db.rows("SELECT role_code, role_name, description, one_per_client FROM contact_role ORDER BY sort_order"), "enums", enums);
    }

    /** The start page's counts (this lab's when the person can open it). */
    public Map<String, Object> startCounts(RequestContext ctx) {
        String site = ctx.siteId() != null && access.load(ctx.userId()).canView(ctx.siteId()) ? ctx.siteId() : "";
        return db.one("""
            WITH p AS (SELECT ?::text AS site)
            SELECT
              (SELECT count(*) FROM lab_order WHERE status IN ('Draft','Submitted','Received') AND site_id::text = (SELECT site FROM p) AND origin::text <> 'Workflow Verification') AS open_orders,
              (SELECT count(*) FROM requested_test_view WHERE rush_status = 'Pending Approval' AND status <> 'Cancelled' AND site_id::text = (SELECT site FROM p)) AS rush_pending,
              (SELECT count(*) FROM client) AS clients, (SELECT count(*) FROM client WHERE account_status = 'On Hold') AS on_hold,
              (SELECT count(*) FROM contact) AS contacts, (SELECT count(*) FROM analyte WHERE status = 'Active') AS analytes,
              (SELECT count(*) FROM test WHERE status = 'Active') AS tests, (SELECT count(*) FROM project) AS projects,
              (SELECT count(*) FROM project_version WHERE status IN ('Draft','Submitted for Quote')) AS open_quotes,
              (SELECT count(*) FROM quote_line_review WHERE issue IS NOT NULL AND version_status IN ('Draft','Submitted for Quote')) AS pricing_issues,
              (SELECT count(*) FROM audit_log) AS audit_entries""", site);
    }

    // ---------------------------------------------------------------- canned reasons
    /** The module's own reasons plus the General ones (the Reason for Change box). */
    public List<Map<String, Object>> reasons(Map<String, String> query) {
        String module = query.get("module") == null || query.get("module").isEmpty() ? "General" : query.get("module");
        return db.rows("""
            SELECT id, module, reason_text FROM reason_code WHERE status = 'Active' AND module IN (?, 'General')
             ORDER BY (module = 'General'), sort_order, reason_text""", module);
    }

    public List<Map<String, Object>> allReasons() { return db.rows("SELECT * FROM reason_code ORDER BY module, sort_order, reason_text"); }

    public List<Map<String, Object>> saveReasons(RequestContext ctx, Map<String, Object> body) {
        return uow.run(ctx, d -> REASONS.upsert(d, rows(body, "rows"), Map.of()));
    }

    /** A new test of this lab (the designer's first step). */
    public Map<String, Object> createTest(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        return uow.run(ctx, d -> d.one("SELECT create_test(?::uuid, ?) AS id", site, body.get("test_name")));
    }

    // ---------------------------------------------------------------- Users and lab access
    public Map<String, Object> adminUsers(RequestContext ctx) {
        requireAdmin(ctx);
        String site = ctx.siteId() == null ? "" : ctx.siteId();
        Map<String, Object> me = db.one("SELECT is_admin FROM app_user WHERE id = ?::uuid", ctx.userId());
        return map("sites", db.rows("SELECT id, site_code, site_name, status FROM lab_site ORDER BY site_code"),
            // automated verification accounts are not people: never in groups
            "users", db.rows("""
                SELECT id, username, full_name, is_admin, is_active, last_login_at, locked_at, must_change_password, (password_hash IS NOT NULL) AS has_password, title,
                    (signature_document_id IS NOT NULL) AS has_signature, signature_set_at FROM app_user WHERE username <> 'system' AND NOT is_automated ORDER BY full_name"""),
            "groups", db.rows("""
                SELECT g.id, g.group_name, g.site_id, g.description FROM lab_group g WHERE g.status = 'Active' AND (g.site_id = NULLIF(?, '')::uuid OR g.site_id IS NULL)
                 ORDER BY g.site_id IS NULL, g.is_standard DESC, g.group_name""", site),
            "members", db.rows("""
                SELECT m.user_id, m.group_id FROM group_member m JOIN lab_group g ON g.id = m.group_id
                 WHERE m.status = 'Active' AND (g.site_id = NULLIF(?, '')::uuid OR g.site_id IS NULL)""", site),
            "site", db.one("SELECT id, site_code, site_name FROM lab_site WHERE id = NULLIF(?, '')::uuid", site),
            "isSystemAdmin", me != null && Js.truthy(me.get("is_admin")));
    }

    /** A person's handwritten signature (an image) and title, recorded by a lab administrator, signed. */
    public Map<String, Object> setSignature(RequestContext ctx, String userId, Map<String, Object> body) {
        requireAdmin(ctx);
        if (!RequestContext.isUuid(userId)) throw new RuleException("User not found");
        String b64 = Js.string(body.get("b64"));
        if (!b64.isEmpty() && !Js.string(body.get("mime_type")).matches("^image/(png|jpeg)$"))
            throw new RuleException("The signature must be a PNG or JPEG image (a scan or photo of the handwritten signature)");
        return signatures.signed(ctx.orReason("Handwritten signature recorded"), body, new SignatureService.Meaning("Recorded by", "Handwritten signature and title", "Admin"), d -> {
            Object doc = null;
            if (!b64.isEmpty()) {
                byte[] buf;
                try { buf = Base64.getMimeDecoder().decode(b64); } catch (IllegalArgumentException e) { buf = new byte[0]; }
                String name = Js.truthy(body.get("file_name")) ? Js.string(body.get("file_name")) : "signature";
                doc = d.one("INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES (?, ?, ?, ?, decode(?, 'base64')) RETURNING id",
                    name.substring(0, Math.min(200, name.length())), body.get("mime_type"), buf.length, DocumentStore.sha256(buf), b64).get("id");
            }
            d.one("SELECT set_user_signature(?::uuid, ?::uuid, ?)", userId, doc, Js.orBlank(body.get("title")));
            return ok();
        });
    }

    /** The signature image: {b64, mime_type}; only for people working in this lab (or for a system administrator). */
    public Map<String, Object> signature(RequestContext ctx, String userId) {
        requireAdmin(ctx);
        if (!RequestContext.isUuid(userId)) throw new RuleException("User not found");
        String site = access.currentSite(ctx);
        Map<String, Object> here = db.one("SELECT user_can_access_site(?::uuid, ?::uuid) AS ok, (SELECT is_admin FROM app_user WHERE id = ?::uuid) AS sys", userId, site, ctx.userId());
        if (!Js.truthy(here.get("ok")) && !Js.truthy(here.get("sys"))) throw new RuleException("This person does not work in this lab");
        Map<String, Object> d = db.one("SELECT f.mime_type, encode(f.content, 'base64') AS b64 FROM app_user u JOIN document_file f ON f.id = u.signature_document_id WHERE u.id = ?::uuid", userId);
        if (d == null) throw new RuleException("No signature on file");
        return d;
    }

    /** A quote: add the lab's serving test at its catalogue price, so the client sees what the per-serving calculation costs. */
    public Map<String, Object> servingLine(RequestContext ctx, String vid, Map<String, Object> body) {
        if (!RequestContext.isUuid(vid)) throw new RuleException("Quote not found");
        Map<String, Object> v = db.one("SELECT p.site_id FROM project_version pv JOIN project p ON p.id = pv.project_id WHERE pv.id = ?::uuid", vid);
        if (v == null) throw new RuleException("Quote not found");
        Object site = v.get("site_id") != null ? v.get("site_id") : access.currentSite(ctx);
        String role = "Density".equals(body.get("role")) ? "Density" : "Serving weight";
        Object test = db.one("SELECT lab_serving_test(?::uuid, ?) AS id", site, role).get("id");
        if (test == null) throw new RuleException("This lab has no " + role + " test with an approved workflow yet (Test catalogue: \"Serving test\")");
        double q = Js.toNumber(body.get("quantity"));
        Object quantity = !body.containsKey("quantity") || Double.isNaN(q) || q == 0 ? (Object) 1 : q;
        return uow.run(ctx.orReason("Quote edited"), d -> {
            Map<String, Object> row = QUOTE_LINE.upsert(d, List.of(map("test_id", test, "quantity", quantity, "special_instructions", "Per-serving calculation")),
                Map.of("project_version_id", vid)).get(0);
            d.update("UPDATE quoted_test_configuration SET final_price = list_price WHERE id = ?::uuid AND final_price IS NULL", row.get("id"));
            return row;
        });
    }
}
