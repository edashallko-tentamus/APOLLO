package com.tentamus.lims.quotes.service;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.paging.PagedList;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.pricing.domain.Amount;
import com.tentamus.lims.quotes.domain.Project;
import com.tentamus.lims.quotes.domain.QuoteVersion;
import com.tentamus.lims.quotes.domain.SubcontractPrice;
import com.tentamus.lims.quotes.repo.ProjectRepository;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;

/**
 * Standalone quotes (one-off answers to a customer): the list with "My open quotes", a new quote, its details, the
 * catalogue at the client's price, and recording the client's acceptance or rejection. Sending a quote, its PDF and the
 * client's page are {@link QuoteSendService}'s.
 */
@Service
public class QuoteService {
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final ProjectRepository projects;
    private final ProjectService versions;

    public QuoteService(Db db, UnitOfWork uow, AccessPolicy access, ProjectRepository projects, ProjectService versions) {
        this.db = db;
        this.uow = uow;
        this.access = access;
        this.projects = projects;
        this.versions = versions;
    }

    /** Every quote's and project's latest version; one page at a time narrowed by tab, type, lab and who prepared it. */
    public Map<String, Object> list(RequestContext ctx, Map<String, String> q) {
        Map<String, Object> extra = new LinkedHashMap<>();
        extra.put("labs", db.rows("SELECT id, site_code, site_name FROM lab_site WHERE status = 'Active' ORDER BY site_code"));
        extra.put("me", ctx.userId());
        extra.put("can_edit", access.has(ctx, "quotes.edit"));
        if (!PagedList.wanted(q)) {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("rows", db.rows("SELECT * FROM quote_list_view ORDER BY COALESCE(sent_at, quoted_at, version_created_at) DESC"));
            out.putAll(extra);
            return out;
        }
        boolean all = "all".equals(q.get("tab"));
        List<Object> params = new ArrayList<>();
        List<String> where = new ArrayList<>();
        if (!all) { where.add("owner_id = ?::uuid"); params.add(ctx.userId()); where.add("is_open"); }
        if (q.get("ty") != null && Set.of("Quote", "Project", "Stability").contains(q.get("ty"))) { where.add("kind::text = ?"); params.add(q.get("ty")); }
        if (RequestContext.isUuid(q.get("lab"))) { where.add("site_ids::text LIKE '%' || ? || '%'"); params.add(q.get("lab")); }
        if (all && RequestContext.isUuid(q.get("own"))) { where.add("owner_id = ?::uuid"); params.add(q.get("own")); }
        String sql = "SELECT *, COALESCE(sent_at, quoted_at, version_created_at) AS list_at FROM quote_list_view"
            + (where.isEmpty() ? "" : " WHERE " + String.join(" AND ", where));
        PagedList page = PagedList.of(sql, params.toArray());
        if (!all) page.filter("open", "true");
        else page.filter("open", "is_open").filter("waiting", "status::text = 'Quoted' AND NOT past_valid").filter("Accepted", "status::text = 'Accepted'")
            .filter("Rejected", "status::text = 'Rejected'").filter("expired", "status::text = 'Expired' OR past_valid").filter("all", "true");
        Map<String, Object> out = new LinkedHashMap<>(page.search("project_code", "project_name", "client_name", "owner_name", "quote_contact_name", "sent_to_name")
            .ids("project_code").order("ORDER BY list_at DESC, project_code DESC").run(db, q));
        out.putAll(extra);
        out.put("owners", db.rows("SELECT DISTINCT owner_id AS id, owner_name AS name FROM quote_list_view WHERE owner_id IS NOT NULL ORDER BY owner_name"));
        return out;
    }

    /** A new quote for a client (and the contact it is for); its first version starts as a Draft. */
    public Map<String, Object> create(RequestContext ctx, Map<String, Object> b) {
        if (!RequestContext.isUuid(b.get("client_id"))) throw new RuleException("Choose the client");
        Object reason = b.get("reason");
        return uow.run(ctx, blank(reason) ? "New quote" : reason.toString(), d -> {
            Object contact = RequestContext.isUuid(b.get("quote_contact_id")) ? b.get("quote_contact_id") : null;
            if (contact != null) Project.checkQuoteContact(contact.toString(), projects.activeContactOf(d, b.get("client_id"), contact));
            Map<String, Object> cl = d.one("SELECT COALESCE(display_name, legal_name) AS name FROM client WHERE id = ?::uuid", b.get("client_id"));
            String name = b.get("project_name") == null ? "" : b.get("project_name").toString().trim();
            Map<String, Object> p = d.one("INSERT INTO project (client_id, project_name, purpose, kind, quote_contact_id) VALUES (?::uuid, ?, ?, 'Quote', ?::uuid) RETURNING id, project_code",
                b.get("client_id"), name.isEmpty() ? "Quote for " + (cl == null ? null : cl.get("name")) : name, blank(b.get("purpose")) ? null : b.get("purpose"),
                RequestContext.isUuid(b.get("quote_contact_id")) ? b.get("quote_contact_id") : null);
            Map<String, Object> v = d.one("SELECT new_project_version(?::uuid) AS id", p.get("id"));
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("id", p.get("id"));
            out.put("version_id", v.get("id"));
            out.put("project_code", p.get("project_code"));
            return out;
        });
    }

    /** The quote's name, contact and owner (handing it to another sales person). */
    public Map<String, Object> update(RequestContext ctx, String id, Map<String, Object> b) {
        Object reason = b.get("reason");
        uow.run(ctx, blank(reason) ? "Quote details changed" : reason.toString(), d -> {
            Map<String, Object> p = projects.projectRow(d, id);
            if (p != null && RequestContext.isUuid(b.get("quote_contact_id")))
                Project.checkQuoteContact(b.get("quote_contact_id").toString(), projects.activeContactOf(d, p.get("client_id"), b.get("quote_contact_id")));
            return d.update("""
            UPDATE project SET project_name = COALESCE(NULLIF(btrim(?), ''), project_name), quote_contact_id = ?::uuid, owner_id = COALESCE(?::uuid, owner_id)
             WHERE id = ?::uuid AND kind = 'Quote'""",
            b.get("project_name") == null || Boolean.FALSE.equals(b.get("project_name")) ? "" : b.get("project_name"),
            RequestContext.isUuid(b.get("quote_contact_id")) ? b.get("quote_contact_id") : null,
            RequestContext.isUuid(b.get("owner_id")) ? b.get("owner_id") : null, id);
        });
        return Map.of("ok", true);
    }

    /** The people who may own quotes (quotes.edit somewhere, or system administrators). */
    public List<Map<String, Object>> people() {
        return db.rows("""
            SELECT DISTINCT u.id, u.full_name FROM app_user u
             WHERE u.is_active AND NOT u.is_automated AND (u.is_admin OR EXISTS (SELECT 1 FROM group_member m JOIN group_permission gp ON gp.group_id = m.group_id AND gp.status = 'Active'
               WHERE m.user_id = u.id AND m.status = 'Active' AND gp.permission_code = 'quotes.edit')) ORDER BY u.full_name""");
    }

    /** The catalogue by lab; with a version, each test at the client's price on it (another lab's test is subcontracted). */
    public List<Map<String, Object>> catalogue(String versionId) {
        Map<String, Object> q = RequestContext.isUuid(versionId) ? db.one("""
            SELECT p.site_id, s.subcontract_discount_pct AS d, s.subcontract_markup_pct AS m FROM project_version pv JOIN project p ON p.id = pv.project_id
              LEFT JOIN lab_site s ON s.id = p.site_id WHERE pv.id = ?::uuid""", versionId) : null;
        Object site = q == null ? null : q.get("site_id");
        BigDecimal disc = q == null ? BigDecimal.valueOf(20) : Amount.of(q.get("d")), markup = q == null ? BigDecimal.valueOf(30) : Amount.of(q.get("m"));
        List<Map<String, Object>> rows = db.rows("""
            SELECT tc.test_id, tc.test_code, tc.test_name, tc.pricing_mode, tc.list_price AS catalogue_price, tc.standard_tat, tc.tat_unit,
                tc.rush_schedule, t.site_id, s.site_code, s.site_name,
                (?::uuid IS NOT NULL AND t.site_id IS NOT NULL AND t.site_id <> ?::uuid) AS subcontracted,
                tc.list_price,
                EXISTS (SELECT 1 FROM test_version tv WHERE tv.test_id = t.id AND tv.status = 'Effective') AS orderable
              FROM test_catalogue tc JOIN test t ON t.id = tc.test_id LEFT JOIN lab_site s ON s.id = t.site_id
             WHERE tc.test_status = 'Active' ORDER BY tc.test_name""", site, site);
        for (Map<String, Object> r : rows)
            if (Boolean.TRUE.equals(r.get("subcontracted"))) r.put("list_price", SubcontractPrice.of(Amount.of(r.get("list_price")), disc, markup).price());
        return rows;
    }

    /** The lab records the client's answer: Accepted (with the contact) or Rejected (with why). */
    public Map<String, Object> decide(RequestContext ctx, String vid, Map<String, Object> b) {
        QuoteVersion v = projects.quoteVersion(db, vid);
        if (v == null) throw new RuleException("Quote not found");
        Object decision = b.get("decision");
        String note = b.get("note") == null ? "" : b.get("note").toString();
        if ("Accepted".equals(decision)) {
            Object reason = b.get("reason");
            uow.run(ctx, blank(reason) ? "Client accepted the quote" : reason.toString(), d -> {
                versions.moveTo(d, v, QuoteVersion.ACCEPTED, Map.of("accepted_by_contact_id", RequestContext.isUuid(b.get("contact_id")) ? b.get("contact_id") : ""));
                return d.update("""
                UPDATE project_version SET status = 'Accepted', accepted_by_contact_id = ?::uuid, client_response_note = NULLIF(btrim(?), '') WHERE id = ?::uuid""",
                RequestContext.isUuid(b.get("contact_id")) ? b.get("contact_id") : null, note, vid);
            });
            return EMPTY_RESULT;
        }
        if ("Rejected".equals(decision)) {
            if (note.trim().isEmpty()) throw new RuleException("Say why the quote was rejected (price, turnaround, went elsewhere...)");
            uow.run(ctx, "Client rejected the quote", d -> {
                versions.moveTo(d, v, "Rejected", Map.of());
                return d.update("UPDATE project_version SET status = 'Rejected', rejected_reason = btrim(?) WHERE id = ?::uuid", note, vid);
            });
            return EMPTY_RESULT;
        }
        throw new RuleException("Accept or reject the quote");
    }

    /** What the Node backend answers for a change that returns no rows. */
    private static final Map<String, Object> EMPTY_RESULT = Map.of("fields", List.of(), "rows", List.of());

    private static boolean blank(Object v) { return v == null || "".equals(v) || Boolean.FALSE.equals(v); }
}
