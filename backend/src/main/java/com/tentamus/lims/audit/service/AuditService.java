package com.tentamus.lims.audit.service;

import com.tentamus.lims.audit.repo.AuditScopes;
import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.access.UserAccess;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * The audit trail pages (the Node backend's /api/audit routes in routes.js): the whole log, its tables, and what a page's
 * audit icon shows (a record and its parts, or the records of a list page). People see the entries of the labs they work
 * in and shared records; all-labs groups (data.view_all) and system administrators see every lab. The labels and links
 * of the entries still come from the database's audit_record_ref.
 */
@Service
public class AuditService {
    private static final String COLS = """
        a.id, a.table_name, a.record_id, a.action, a.record_version, a.changed_at, u.full_name AS changed_by, a.reason, a.changed_fields,
          audit_record_ref(a.table_name, a.record_id, a.new_row) AS ref,
          (SELECT s.full_name || ' (' || s.meaning || ')' || CASE WHEN s.method <> 'User ID and password' THEN ' by ' || lower(s.method) ELSE '' END
             FROM signature_event s WHERE s.id = a.signature_id) AS signature""";
    private final Db db;
    private final AccessPolicy access;

    public AuditService(Db db, AccessPolicy access) {
        this.db = db;
        this.access = access;
    }

    /** The condition keeping other labs' entries out (empty for those who see every lab); adds its parameter. */
    private String labFilter(RequestContext ctx, List<Object> params) {
        UserAccess a = access.load(ctx.userId());
        if (a.can("data.view_all", null)) return "";
        params.add(new ArrayList<>(a.memberSites()));
        return " AND (audit_row_site(a.new_row) IS NULL OR audit_row_site(a.new_row) = ANY(?::uuid[]))";
    }

    public List<Map<String, Object>> log(RequestContext ctx, Map<String, String> q) {
        String table = q.getOrDefault("table", ""), record = q.getOrDefault("record", "");
        List<Object> params = new ArrayList<>(List.of(table, table, record, record));
        String f = labFilter(ctx, params);
        return db.rows("SELECT " + COLS + " FROM audit_log a JOIN app_user u ON u.id = a.changed_by"
            + " WHERE (?::text = '' OR a.table_name = ?::text) AND (?::text = '' OR a.record_id::text = ?::text)" + f + " ORDER BY a.id DESC LIMIT 300", params.toArray());
    }

    public List<Map<String, Object>> tables() {
        return db.rows("SELECT table_name, count(*) AS n FROM audit_log GROUP BY table_name ORDER BY table_name");
    }

    public List<Map<String, Object>> scope(RequestContext ctx, Map<String, String> q) {
        String kind = q.get("kind"), id = q.get("id");
        if ("users".equals(kind)) access.require(ctx, "admin.users", "open this page");
        if ("sites".equals(kind)) access.require(ctx, "admin.lab", "see the lab settings");
        List<Object> params = new ArrayList<>();
        if (kind != null && AuditScopes.LISTS.containsKey(kind)) {
            params.add(AuditScopes.LISTS.get(kind));
            String f = labFilter(ctx, params);
            return db.rows("SELECT " + COLS + " FROM audit_log a JOIN app_user u ON u.id = a.changed_by WHERE a.table_name = ANY(?::text[])" + f
                + " ORDER BY a.id DESC LIMIT 500", params.toArray());
        }
        String scope = kind == null ? null : AuditScopes.SCOPES.get(kind);
        if (scope == null) throw new RuleException("Unknown audit view");
        String key = id;
        if (AuditScopes.SITE_KINDS.contains(kind)) key = access.currentSite(ctx);
        else if (!RequestContext.isUuid(id)) throw new RuleException("Record not found");
        checkRecord(ctx, kind, id);
        if ("order".equals(kind)) access.checkSite(ctx, site(db.one("SELECT site_id FROM lab_order WHERE id = ?::uuid", id)));
        if ("sample".equals(kind)) access.checkSite(ctx, site(db.one("SELECT o.site_id FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = ?::uuid", id)));
        params.add(key);
        String f = labFilter(ctx, params);   // and never another lab's entries among a record's parts
        return db.rows("WITH p AS (SELECT ?::uuid AS k), ids(t, id) AS (" + scope.replace("$1", "(SELECT k FROM p)") + ")"
            + " SELECT " + COLS + " FROM audit_log a JOIN ids ON ids.t = a.table_name AND ids.id = a.record_id JOIN app_user u ON u.id = a.changed_by"
            + " WHERE true" + f + " ORDER BY a.id DESC LIMIT 500", params.toArray());
    }

    /** The record's own check before its trail is shown (the Node routes' AUDIT_CHECKS): it exists and its lab is one the person can open. */
    private void checkRecord(RequestContext ctx, String kind, String id) {
        if ("training_person".equals(kind)) { needTrainingView(ctx, id); return; }
        AuditScopes.RecordLab r = AuditScopes.RECORD_LABS.get(kind);
        if (r == null) return;
        Map<String, Object> row = db.one(r.sql(), id);
        if (row == null) throw new RuleException(r.notFound());
        String site = (String) row.get("site_id");
        if (site != null || !AuditScopes.SITE_OPTIONAL.contains(kind)) access.checkSite(ctx, site);
        if ("invoice".equals(kind)) {
            UserAccess a = access.load(ctx.userId());
            if (!a.can("invoicing.view", site) && !a.can("invoicing.issue", site))
                throw new RuleException("You do not have permission to see invoicing in this lab (invoicing.view). Ask your lab administrator.");
        }
        if ("competency".equals(kind)) needTrainingView(ctx, (String) row.get("user_id"));
    }

    private void needTrainingView(RequestContext ctx, String userId) {
        if (!userId.equals(ctx.userId()) && !access.has(ctx, "training.view")) throw new RuleException("You may see your own training only (training.view shows everyone's)");
    }

    private static String site(Map<String, Object> row) { return row == null ? null : (String) row.get("site_id"); }
}
