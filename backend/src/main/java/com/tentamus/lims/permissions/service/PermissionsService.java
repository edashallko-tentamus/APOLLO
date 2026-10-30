package com.tentamus.lims.permissions.service;

import static com.tentamus.lims.core.web.Answers.*;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.excel.Xlsx;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.stereotype.Service;

/**
 * Permissions and lab groups: the permission list, this lab's groups and their permissions, memberships, and the
 * permission matrix with its change history (on screen and as Excel). The rules live in the database: who may change
 * groups and memberships, signatures, no self-promotion, the view-only all-labs group.
 */
@Service
public class PermissionsService {
    private static final DateTimeFormatter ISO = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);
    private final Db db;
    private final AccessPolicy access;
    private final SignatureService signatures;

    public PermissionsService(Db db, AccessPolicy access, SignatureService signatures) {
        this.db = db;
        this.access = access;
        this.signatures = signatures;
    }

    /** A file to download: its bytes and name. */
    public record Download(byte[] file, String fileName) {}

    private SignatureService.Meaning approved(String action) { return new SignatureService.Meaning("Approved by", action, "Admin"); }

    private void requireAuditOrAdmin(RequestContext ctx) {
        if (!access.has(ctx, "audit.view") && !access.has(ctx, "admin.users") && !access.has(ctx, "admin.groups"))
            throw new RuleException("You need the audit trail or lab administration permission to see the permission matrix.");
    }

    public List<Map<String, Object>> permissions() { return db.rows("SELECT * FROM permission ORDER BY sort_order, code"); }

    /** This lab's groups (and the all-labs groups), each with its permissions and member count. */
    public Map<String, Object> groups(RequestContext ctx) {
        String site = access.currentSite(ctx);
        Map<String, Object> me = db.one("SELECT is_admin FROM app_user WHERE id = ?::uuid", ctx.userId());
        return map("groups", db.rows("""
                SELECT g.*, s.site_code,
                    (SELECT count(*) FROM group_member m JOIN app_user u ON u.id = m.user_id WHERE m.group_id = g.id AND m.status = 'Active' AND u.is_active) AS member_count,
                    (SELECT COALESCE(json_agg(gp.permission_code ORDER BY gp.permission_code), '[]') FROM group_permission gp WHERE gp.group_id = g.id AND gp.status = 'Active') AS permissions
                  FROM lab_group g LEFT JOIN lab_site s ON s.id = g.site_id WHERE g.site_id = ?::uuid OR g.site_id IS NULL
                 ORDER BY g.site_id IS NULL, g.status, g.is_standard DESC, lower(g.group_name)""", site),
            "permissions", db.rows("SELECT * FROM permission WHERE status = 'Active' ORDER BY sort_order, code"),
            "departments", db.rows("SELECT id, department_code, department_name FROM department WHERE site_id = ?::uuid AND status = 'Active' ORDER BY department_code", site),
            "canEdit", access.has(ctx, "admin.groups"), "canEditAllLabs", me != null && Js.truthy(me.get("is_admin")));
    }

    /** Create, rename, describe or retire this lab's groups (signed). */
    public List<Map<String, Object>> saveGroups(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        access.require(ctx, "admin.groups", "change groups");
        List<Map<String, Object>> list = rows(body, "rows");
        return signatures.signed(ctx, body, approved("Groups at this lab: " + list.size() + " change(s)"), d -> {
            List<Map<String, Object>> out = new ArrayList<>();
            for (Map<String, Object> r : list) {
                if (Js.truthy(r.get("id"))) {
                    Map<String, Object> g = d.one("SELECT site_id FROM lab_group WHERE id = ?::uuid", r.get("id"));
                    if (g == null || !Objects.equals(g.get("site_id"), site)) throw new RuleException("That group belongs to another lab.");
                    // only the fields that were changed (a group can be marked as one of the lab's departments)
                    out.add(d.one("""
                        UPDATE lab_group SET group_name = COALESCE(?, group_name), description = CASE WHEN ?::boolean THEN ? ELSE description END,
                            status = COALESCE(?::record_status, status), department_id = CASE WHEN ?::boolean THEN ?::uuid ELSE department_id END
                         WHERE id = ?::uuid RETURNING id""", Js.orNull(r.get("group_name")), r.containsKey("description"), Js.orNull(r.get("description")), Js.orNull(r.get("status")),
                        r.containsKey("department_id"), Js.orNull(r.get("department_id")), r.get("id")));
                } else {
                    out.add(d.one("INSERT INTO lab_group (site_id, group_name, description, department_id) VALUES (?::uuid, ?, ?, ?::uuid) RETURNING id",
                        site, r.get("group_name"), Js.orNull(r.get("description")), Js.orNull(r.get("department_id"))));
                }
            }
            return out;
        });
    }

    /** The group x permission matrix: rows [{group_id, permission_code, active}] (signed). */
    public Map<String, Object> saveGroupPermissions(RequestContext ctx, Map<String, Object> body) {
        access.currentSite(ctx);
        List<Map<String, Object>> list = rows(body, "rows");
        return signatures.signed(ctx, body, approved("Group permissions: " + list.size() + " change(s)"), d -> {
            for (Map<String, Object> r : list) d.update("""
                INSERT INTO group_permission (group_id, permission_code, status) VALUES (?::uuid, ?, ?)
                  ON CONFLICT (group_id, permission_code) DO UPDATE SET status = EXCLUDED.status WHERE group_permission.status <> EXCLUDED.status""",
                r.get("group_id"), r.get("permission_code"), Js.truthy(r.get("active")) ? "Active" : "Inactive");
            return map("changed", list.size());
        });
    }

    /** Who is in which group at this lab: rows [{user_id, group_id, active}] (signed). */
    public Map<String, Object> saveMemberships(RequestContext ctx, Map<String, Object> body) {
        access.currentSite(ctx);
        access.require(ctx, "admin.users", "open this page");
        List<Map<String, Object>> list = rows(body, "rows");
        return signatures.signed(ctx, body, approved("Group membership: " + list.size() + " change(s)"), d -> {
            for (Map<String, Object> r : list) d.update("""
                INSERT INTO group_member (group_id, user_id, status) VALUES (?::uuid, ?::uuid, ?)
                  ON CONFLICT (group_id, user_id) DO UPDATE SET status = EXCLUDED.status WHERE group_member.status <> EXCLUDED.status""",
                r.get("group_id"), r.get("user_id"), Js.truthy(r.get("active")) ? "Active" : "Inactive");
            return map("changed", list.size());
        });
    }

    // ---------------------------------------------------------------- the permission matrix and its history
    private Map<String, Object> matrix(String site) {
        List<Map<String, Object>> permissions = db.rows("SELECT code, module, area, description FROM permission WHERE status = 'Active' ORDER BY sort_order, code");
        List<Map<String, Object>> users = db.rows("""
            WITH p AS (SELECT ?::uuid AS site)
            SELECT u.id, u.username, u.full_name, u.is_admin,
                (SELECT string_agg(g.group_name, ', ' ORDER BY g.group_name) FROM group_member m JOIN lab_group g ON g.id = m.group_id
                  WHERE m.user_id = u.id AND m.status = 'Active' AND g.status = 'Active' AND (g.site_id = (SELECT site FROM p) OR g.site_id IS NULL)) AS groups
              FROM app_user u WHERE u.is_active AND u.username <> 'system'
               AND (u.is_admin OR EXISTS (SELECT 1 FROM group_member m JOIN lab_group g ON g.id = m.group_id
                     WHERE m.user_id = u.id AND m.status = 'Active' AND g.status = 'Active' AND (g.site_id = (SELECT site FROM p) OR g.site_id IS NULL)))
             ORDER BY u.full_name""", site);
        Map<String, Object> held = new HashMap<>();
        for (Map<String, Object> h : db.rows("""
            SELECT user_id, permission_code, string_agg(through_groups, ', ') AS through FROM user_permission_view
             WHERE site_id = ?::uuid OR site_id IS NULL GROUP BY user_id, permission_code""", site)) held.put(h.get("user_id") + "|" + h.get("permission_code"), h.get("through"));
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> u : users) {
            Map<String, Object> r = new LinkedHashMap<>(u);
            boolean admin = Js.truthy(u.get("is_admin"));
            for (Map<String, Object> p : permissions) {
                Object through = held.get(u.get("id") + "|" + p.get("code"));
                r.put((String) p.get("code"), admin ? "System administrator" : Js.truthy(through) ? through : "");
            }
            out.add(r);
        }
        return map("permissions", permissions, "rows", out);
    }

    public Map<String, Object> matrixPage(RequestContext ctx) {
        String site = access.currentSite(ctx);
        requireAuditOrAdmin(ctx);
        Map<String, Object> out = map("site", db.one("SELECT site_code, site_name FROM lab_site WHERE id = ?::uuid", site));
        out.putAll(matrix(site));
        out.put("generatedAt", ISO.format(Instant.now()));
        return out;
    }

    public List<Map<String, Object>> history(RequestContext ctx) {
        String site = access.currentSite(ctx);
        requireAuditOrAdmin(ctx);
        return db.rows("SELECT * FROM permission_change_view WHERE site_id = ?::uuid OR site_id IS NULL ORDER BY audit_id DESC LIMIT 1000", site);
    }

    private static String when(Object iso) { return iso == null ? "" : iso.toString().replace('T', ' ').substring(0, Math.min(19, iso.toString().length())); }

    /** Excel: who holds what (for GMP and ISO 17025 audits), or the change history (what=history). */
    @SuppressWarnings("unchecked")
    public Download matrixXlsx(RequestContext ctx, Map<String, String> query) {
        String site = access.currentSite(ctx);
        requireAuditOrAdmin(ctx);
        Object code = db.one("SELECT site_code FROM lab_site WHERE id = ?::uuid", site).get("site_code");
        String stamp = ISO.format(Instant.now()).substring(0, 16).replace('T', ' ').replaceFirst(":", "");
        if ("history".equals(query.get("what"))) {
            List<List<Object>> rows = new ArrayList<>();
            for (Map<String, Object> r : db.rows("SELECT * FROM permission_change_view WHERE site_id = ?::uuid OR site_id IS NULL ORDER BY audit_id", site))
                rows.add(List.of(when(r.get("changed_at")), Js.string(r.get("table_name")).replace('_', ' ') + " " + Js.string(r.get("action")).toLowerCase(), Js.string(r.get("group_name")),
                    Js.string(r.get("member_name")), Js.string(r.get("permission_code")), Js.string(r.get("status")), Js.string(r.get("changed_by")), Js.string(r.get("signed_by")),
                    Js.string(r.get("signature_meaning")), when(r.get("signed_at")), Js.string(r.get("reason"))));
            byte[] file = Xlsx.write("Permission history", List.of("When", "Change", "Group", "Person", "Permission", "Status", "Changed by", "Signed by", "Signature meaning", "Signed at", "Reason"),
                rows, List.of(20, 22, 22, 22, 18, 10, 20, 20, 16, 20, 40));
            return new Download(file, code + " permission history " + stamp + ".xlsx");
        }
        Map<String, Object> m = matrix(site);
        List<Map<String, Object>> perms = (List<Map<String, Object>>) m.get("permissions");
        List<String> headers = new ArrayList<>(List.of("Name", "User ID", "Groups"));
        List<Integer> widths = new ArrayList<>(List.of(24, 14, 30));
        for (Map<String, Object> p : perms) { headers.add(p.get("module") + " > " + p.get("area") + " (" + p.get("code") + ")"); widths.add(18); }
        List<List<Object>> rows = new ArrayList<>();
        for (Map<String, Object> r : (List<Map<String, Object>>) m.get("rows")) {
            List<Object> row = new ArrayList<>(List.of(Js.string(r.get("full_name")), Js.string(r.get("username")),
                Js.truthy(r.get("is_admin")) ? "System administrator" : Js.string(r.get("groups"))));
            for (Map<String, Object> p : perms) row.add(Js.string(r.get((String) p.get("code"))));
            rows.add(row);
        }
        return new Download(Xlsx.write(code + " permissions", headers, rows, widths), code + " permission matrix " + stamp + ".xlsx");
    }
}
