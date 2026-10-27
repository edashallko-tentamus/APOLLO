package com.tentamus.lims.orders.service;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.RecordWriter;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.paging.PagedList;
import com.tentamus.lims.core.web.RequestContext;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Intake: the dashboard (rush waiting for approval, incoming rush work, expected samples, samples logged in the last day),
 * intake's rush decisions, and the Outbox with its email templates (nothing is sent in the Sandbox).
 */
@Service
public class IntakeService {
    private static final RecordWriter RUSH_DECISION = new RecordWriter("rush_decision",
        List.of("requested_test_id", "decision", "requested_tier_id", "replacement_tier_id", "reason"));
    private static final RecordWriter TEMPLATES = new RecordWriter("email_template", List.of("template_name", "subject", "body", "is_active"));
    private static final String OUTBOX_SQL = """
        SELECT e.*, o.order_code, u.full_name AS triggered_by, p.project_code AS quote_code, p.id AS quote_project_id
          FROM email_outbox e LEFT JOIN lab_order o ON o.id = e.lab_order_id JOIN app_user u ON u.id = e.created_by
          LEFT JOIN project_version pv ON pv.id = e.project_version_id LEFT JOIN project p ON p.id = pv.project_id
         WHERE COALESCE(o.site_id, e.site_id) = ?::uuid""";
    private final Db db;
    private final AccessPolicy access;
    private final UnitOfWork uow;

    public IntakeService(Db db, AccessPolicy access, UnitOfWork uow) {
        this.db = db;
        this.access = access;
        this.uow = uow;
    }

    public Map<String, Object> dashboard(RequestContext ctx) {
        String site = access.currentSite(ctx);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("pending", db.rows("""
            SELECT r.*, (SELECT client_name FROM lab_order_view o WHERE o.id = r.lab_order_id) AS client_name,
              r.approval_due_at < now() AS overdue FROM requested_test_view r WHERE r.rush_status = 'Pending Approval' AND r.status <> 'Cancelled' AND r.site_id = ?::uuid
             ORDER BY r.rush_requested_at""", site));
        out.put("incoming", db.rows("""
            SELECT r.*, (SELECT client_name FROM lab_order_view o WHERE o.id = r.lab_order_id) AS client_name
              FROM requested_test_view r WHERE r.rush_status IN ('Auto-accepted','Approved') AND r.status <> 'Cancelled' AND r.site_id = ?::uuid
             ORDER BY r.due_date NULLS FIRST, r.rush_requested_at""", site));
        out.put("expected", db.rows("""
            SELECT o.id AS lab_order_id, o.order_code, o.client_name, o.site_code, o.submission_channel,
              count(*) FILTER (WHERE s.status = 'Expected') AS expected_samples, o.account_status
              FROM lab_order_view o JOIN sample s ON s.lab_order_id = o.id WHERE s.status = 'Expected' AND o.site_id = ?::uuid
             GROUP BY o.id, o.order_code, o.client_name, o.site_code, o.submission_channel, o.account_status ORDER BY o.order_code""", site));
        out.put("today", db.rows("""
            SELECT s.id AS sample_id, s.sample_code, s.client_sample_id, s.description, s.logged_at, s.due_date, s.test_count, o.order_code, o.client_name, o.id AS lab_order_id
              FROM sample_view s JOIN lab_order_view o ON o.id = s.lab_order_id
             WHERE s.logged_at >= now() - interval '24 hours' AND o.site_id = ?::uuid AND o.origin::text <> 'Workflow Verification' ORDER BY s.logged_at DESC""", site));
        out.put("tiers", db.rows("SELECT rt.id, rt.schedule_id, rt.tier_name, rt.rush_tat, rt.tat_unit FROM rush_fee_tier rt WHERE rt.status = 'Active' ORDER BY rt.rush_tat"));
        return out;
    }

    /** Intake approves a rush, or does not accept it (the database then queues the fixed email naming the staff member). */
    public List<Map<String, Object>> rushDecision(RequestContext ctx, Map<String, Object> b) {
        Object reason = b.get("reason");
        String r = reason != null && !"".equals(reason) && !Boolean.FALSE.equals(reason) ? reason.toString()
            : "Approved".equals(b.get("decision")) ? "Rush approved by intake" : "";
        return uow.run(ctx, r, d -> RUSH_DECISION.upsert(d, List.of(b), Map.of()));
    }

    public Object outbox(RequestContext ctx, Map<String, String> query) {
        String site = access.currentSite(ctx);
        if (!PagedList.wanted(query)) return db.rows(OUTBOX_SQL + " ORDER BY e.created_at DESC LIMIT 200", site);
        return PagedList.of(OUTBOX_SQL, site).search("subject", "to_address", "to_name", "order_code", "quote_code", "template", "triggered_by")
            .ids("order_code", "quote_code").order("ORDER BY created_at DESC").run(db, query);
    }

    public Map<String, Object> templates(RequestContext ctx) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("rows", db.rows("SELECT * FROM email_template ORDER BY template_name"));
        out.put("can_edit", access.has(ctx, "outbox.templates"));
        return out;
    }

    /** Templates are only changed, never added here (rows without an id are ignored). */
    public List<Map<String, Object>> saveTemplates(RequestContext ctx, List<Map<String, Object>> rows) {
        List<Map<String, Object>> existing = rows.stream().filter(r -> r.get("id") != null && !"".equals(r.get("id"))).toList();
        return uow.run(ctx, d -> TEMPLATES.upsert(d, existing, Map.of()));
    }
}
