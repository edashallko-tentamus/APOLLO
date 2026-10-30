package com.tentamus.lims.core.access;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;

/** Loads a person's access and answers permission questions; the refusal messages are the database rules' own words. */
@Service
public class AccessPolicy {
    private final Db db;

    public AccessPolicy(Db db) { this.db = db; }

    public UserAccess load(String userId) {
        if (!RequestContext.isUuid(userId)) return new UserAccess(userId, false, List.of(), Set.of());
        Map<String, Object> u = db.one("SELECT is_admin, is_active FROM app_user WHERE id = ?", userId);
        boolean admin = u != null && Boolean.TRUE.equals(u.get("is_admin")) && Boolean.TRUE.equals(u.get("is_active"));
        List<UserAccess.Grant> grants = db.rows("""
            SELECT DISTINCT g.site_id, gp.permission_code
              FROM group_member m JOIN lab_group g ON g.id = m.group_id
              JOIN group_permission gp ON gp.group_id = g.id JOIN permission p ON p.code = gp.permission_code
             WHERE m.user_id = ? AND m.status = 'Active' AND g.status = 'Active' AND gp.status = 'Active' AND p.status = 'Active'""", userId)
            .stream().map(r -> new UserAccess.Grant((String) r.get("site_id"), (String) r.get("permission_code"))).toList();
        Set<String> sites = new HashSet<>();
        for (Map<String, Object> r : db.rows("""
            SELECT DISTINCT g.site_id FROM group_member m JOIN lab_group g ON g.id = m.group_id
             WHERE m.user_id = ? AND m.status = 'Active' AND g.status = 'Active' AND g.site_id IS NOT NULL""", userId)) sites.add((String) r.get("site_id"));
        return new UserAccess(userId, admin, grants, sites);
    }

    public boolean has(RequestContext ctx, String permission) {
        return load(ctx.userId()).can(permission, ctx.siteId());
    }

    /** "You do not have permission to <what> in this lab (code: description). …": the Node backend's requirePermission. */
    public void require(RequestContext ctx, String permission, String what) {
        if (has(ctx, permission)) return;
        Map<String, Object> p = db.one("SELECT lower(description) AS d FROM permission WHERE code = ?", permission);
        throw new RuleException("You do not have permission to " + what + " in this lab (" + permission + (p == null ? "" : ": " + p.get("d"))
            + "). Ask your lab administrator.");
    }

    public void requireSystemAdmin(RequestContext ctx) {
        requireSystemAdmin(ctx, null);
    }

    /** As requireSystemAdmin, with the refusal a database rule gave (null: the general one). */
    public void requireSystemAdmin(RequestContext ctx, String refusal) {
        if (load(ctx.userId()).systemAdmin()) return;
        throw refusal == null ? new RuleException("Only a system administrator can do this.") : RuleException.database(refusal);
    }

    /**
     * Refuses a change to a record of a lab without the permission at that lab, with the message of the database's
     * require_permission_at (the permission triggers moved here in migration 072).
     */
    public void requireAt(RequestContext ctx, String permission, String siteId) {
        if (load(ctx.userId()).can(permission, siteId)) return;
        Map<String, Object> p = db.one("SELECT lower(description) AS d FROM permission WHERE code = ?", permission);
        throw RuleException.database("You do not have permission to do this: " + (p == null ? "" : p.get("d")) + " (" + permission
            + "). Ask your lab administrator to add you to a group that has it.");
    }

    /** The lab chosen in the header, which the person must be able to open: the Node backend's currentSite. */
    public String currentSite(RequestContext ctx) {
        if (ctx.siteId() == null) throw new RuleException("Choose your lab (top right) first. If none is listed, ask an administrator to assign you to a lab.");
        if (!load(ctx.userId()).canView(ctx.siteId())) throw new RuleException("You are not assigned to this lab. Choose another lab (top right) or ask an administrator.");
        return ctx.siteId();
    }

    /** A record of another lab: refused unless the person can at least view that lab. */
    public void checkSite(RequestContext ctx, String siteId) {
        if (!RequestContext.isUuid(siteId) || !load(ctx.userId()).canView(siteId))
            throw new RuleException("This record belongs to a lab you are not assigned to. Ask an administrator for access.");
    }

    /**
     * Refuses a change to a shared list without the permission, with the message of the database's
     * require_list_permission trigger: "You do not have permission to change client: create and change clients, … (master.clients). …".
     */
    public void requireToChange(RequestContext ctx, String table, String permission) {
        if (has(ctx, permission)) return;
        Map<String, Object> p = db.one("SELECT lower(description) AS d FROM permission WHERE code = ?", permission);
        throw RuleException.database("You do not have permission to change " + table.replace('_', ' ') + ": "
            + (p == null ? "" : p.get("d")) + " (" + permission + "). Ask your lab administrator.");
    }
}
