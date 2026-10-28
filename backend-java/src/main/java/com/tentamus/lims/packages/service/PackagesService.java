package com.tentamus.lims.packages.service;

import static com.tentamus.lims.core.web.Answers.*;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.stereotype.Service;

/**
 * Test packages in the catalogue, on quotes and on orders (cancelling one of its tests takes off only that test's
 * share), and price changes from an effective date. The hourly job that applies scheduled changes stays in the Node
 * backend for now.
 */
@Service
public class PackagesService {
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;

    public PackagesService(Db db, UnitOfWork uow, AccessPolicy access) {
        this.db = db;
        this.uow = uow;
        this.access = access;
    }

    // ---------------------------------------------------------------- the catalogue
    public Map<String, Object> list(RequestContext ctx) {
        String site = access.currentSite(ctx);
        return map("rows", db.rows("SELECT * FROM test_package_view ORDER BY site_code, status, package_name"), "site", site, "can_edit", access.has(ctx, "catalog.edit"));
    }

    /** The lab's tests that can go in a package. */
    public Map<String, Object> options(RequestContext ctx) {
        String site = access.currentSite(ctx);
        return map("tests", db.rows("""
            SELECT t.id, t.test_code, t.test_name, e.pricing_mode::text AS pricing_mode, catalog_list_price(e.id) AS list_price,
                EXISTS (SELECT 1 FROM test_version v WHERE v.test_id = t.id AND v.status = 'Effective') AS approved
              FROM test t JOIN test_catalog_entry e ON e.test_id = t.id WHERE t.site_id = ?::uuid AND t.status = 'Active' ORDER BY t.test_name""", site));
    }

    private Map<String, Object> packageOf(String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Package not found");
        Map<String, Object> p = db.one("SELECT * FROM test_package_view WHERE id = ?::uuid", id);
        if (p == null) throw new RuleException("Package not found");
        return p;
    }

    public Map<String, Object> one(RequestContext ctx, String id) {
        Map<String, Object> p = packageOf(id);
        Object pid = p.get("id");
        return map("package", p,
            "lines", db.rows("SELECT * FROM test_package_lines(?::uuid) ORDER BY sort_order, test_name", pid),
            "analytes", db.rows("""
                SELECT i.id AS item_id, ap.analyte_id, a.analyte_name, ap.price AS catalogue_price, pa.id AS exception_id, COALESCE(pa.included, true) AS included
                  FROM test_package_item i JOIN test_catalog_entry e ON e.test_id = i.test_id AND e.pricing_mode = 'Analyte Selection'
                  JOIN test_analyte_price ap ON ap.catalog_entry_id = e.id AND ap.status = 'Active' JOIN analyte a ON a.id = ap.analyte_id
                  LEFT JOIN test_package_analyte pa ON pa.item_id = i.id AND pa.analyte_id = ap.analyte_id
                 WHERE i.package_id = ?::uuid AND i.status = 'Active' ORDER BY a.analyte_name""", pid),
            "problems", db.rows("SELECT * FROM test_package_problems(?::uuid)", pid),
            "quotes", db.rows("""
                SELECT p.project_code, pv.id AS version_id, pv.version_no, pv.status::text AS status, COALESCE(cl.display_name, cl.legal_name) AS client_name, qp.package_price, qp.quantity
                  FROM quoted_package qp JOIN project_version pv ON pv.id = qp.project_version_id JOIN project p ON p.id = pv.project_id JOIN client cl ON cl.id = p.client_id
                 WHERE qp.package_id = ?::uuid AND qp.status = 'Active' ORDER BY qp.created_at DESC LIMIT 50""", pid),
            "can_edit", access.load(ctx.userId()).can("catalog.edit", (String) p.get("site_id")));
    }

    private static Object[] header(Map<String, Object> b) {
        return new Object[] { Js.string(b.get("package_name")).trim(), Js.orNull(b.get("description")), Js.truthy(b.get("show_in_public_catalogue")) };
    }

    public Map<String, Object> create(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        Object[] h = header(body);
        return uow.run(ctx.withSite(site).orReason("New package"), d -> {
            Map<String, Object> p = d.one("INSERT INTO test_package (site_id, package_name, description, show_in_public_catalogue) VALUES (?::uuid, ?, ?, ?) RETURNING id, package_code",
                site, h[0], h[1], h[2]);
            int n = 0;
            for (Object id : uuids(body.get("tests"))) d.update("INSERT INTO test_package_item (package_id, test_id, sort_order) VALUES (?::uuid, ?::uuid, ?)", p.get("id"), id, ++n);
            return p;
        });
    }

    /** Header and lines in one save (a Reason for Change: the catalogue's rule). */
    @SuppressWarnings("unchecked")
    public Map<String, Object> save(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> p = packageOf(id);
        Object pid = p.get("id");
        return uow.run(ctx.withSite((String) p.get("site_id")), d -> {
            if (Js.truthy(body.get("header")) && body.get("header") instanceof Map<?, ?> hm) {
                Object[] h = header((Map<String, Object>) hm);
                d.update("UPDATE test_package SET package_name = ?, description = ?, show_in_public_catalogue = ? WHERE id = ?::uuid", h[0], h[1], h[2], pid);
            }
            for (Map<String, Object> it : rows(body, "items")) {
                if (RequestContext.isUuid(it.get("id"))) {
                    d.update("""
                        UPDATE test_package_item SET sort_order = COALESCE(?::int, sort_order), component_price = ?::numeric, status = COALESCE(?::record_status, status)
                         WHERE id = ?::uuid AND package_id = ?::uuid""", Js.num(it.get("sort_order")), Js.num(it.get("component_price")), Js.orNull(it.get("status")), it.get("id"), pid);
                } else if (RequestContext.isUuid(it.get("test_id"))) {
                    Object next = d.one("SELECT COALESCE(max(sort_order), 0) + 1 AS n FROM test_package_item WHERE package_id = ?::uuid", pid).get("n");
                    Double sort = Js.num(it.get("sort_order"));
                    d.update("INSERT INTO test_package_item (package_id, test_id, sort_order, component_price) VALUES (?::uuid, ?::uuid, ?::int, ?::numeric)",
                        pid, it.get("test_id"), sort != null ? sort : next, Js.num(it.get("component_price")));
                }
            }
            for (Map<String, Object> a : rows(body, "analytes")) {
                if (!RequestContext.isUuid(a.get("item_id")) || !RequestContext.isUuid(a.get("analyte_id"))) continue;
                d.update("""
                    INSERT INTO test_package_analyte (item_id, analyte_id, included) VALUES (?::uuid, ?::uuid, ?)
                      ON CONFLICT (item_id, analyte_id) DO UPDATE SET included = EXCLUDED.included""", a.get("item_id"), a.get("analyte_id"), !Boolean.FALSE.equals(a.get("included")));
            }
            return ok();
        });
    }

    public Map<String, Object> retire(RequestContext ctx, String id) {
        Map<String, Object> p = packageOf(id);
        return uow.run(ctx.withSite((String) p.get("site_id")), d -> { d.update("UPDATE test_package SET status = 'Retired' WHERE id = ?::uuid", p.get("id")); return ok(); });
    }

    // ---------------------------------------------------------------- quotes
    private Map<String, Object> versionOf(String vid) {
        if (!RequestContext.isUuid(vid)) throw new RuleException("Quote not found");
        Map<String, Object> v = db.one("""
            SELECT pv.id, pv.status::text AS status, version_is_editable(pv.id) AS editable, p.site_id, p.kind, p.is_list_price_acceptance, p.client_id
              FROM project_version pv JOIN project p ON p.id = pv.project_id WHERE pv.id = ?::uuid""", vid);
        if (v == null) throw new RuleException("Quote not found");
        return v;
    }

    public Map<String, Object> quotePackages(String vid) {
        Map<String, Object> v = versionOf(vid);
        List<Map<String, Object>> parts = db.rows("""
            SELECT q.id AS line_id, q.quoted_package_id, t.id AS test_id, t.test_code, t.test_name, q.list_price, q.final_price, q.quantity,
                e.pricing_mode::text AS pricing_mode, (SELECT count(*) FROM quoted_analyte_selection s WHERE s.line_id = q.id AND s.included)::int AS analytes_included,
                (SELECT count(*) FROM quoted_analyte_selection s WHERE s.line_id = q.id)::int AS analytes_total,
                (SELECT count(*) FROM specification sp WHERE sp.quoted_line_id = q.id AND sp.status = 'Active')::int AS spec_count, e.standard_tat, e.tat_unit::text AS tat_unit
              FROM quoted_test_configuration q JOIN test t ON t.id = q.test_id JOIN test_catalog_entry e ON e.test_id = t.id
             WHERE q.project_version_id = ?::uuid AND q.quoted_package_id IS NOT NULL AND q.status = 'Active' ORDER BY q.created_at""", v.get("id"));
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Map<String, Object> x : db.rows("""
            SELECT qp.*, qp.status::text AS status, p.status::text AS package_status FROM quoted_package qp JOIN test_package p ON p.id = qp.package_id
             WHERE qp.project_version_id = ?::uuid AND qp.status = 'Active' ORDER BY qp.created_at""", v.get("id"))) {
            Map<String, Object> r = new LinkedHashMap<>(x);
            r.put("tests", parts.stream().filter(p -> Objects.equals(p.get("quoted_package_id"), x.get("id"))).toList());
            rows.add(r);
        }
        boolean allowed = !"Stability".equals(v.get("kind")) && !Js.truthy(v.get("is_list_price_acceptance"));
        return map("rows", rows, "options", allowed ? db.rows("""
                SELECT id, package_code, package_name, package_price, list_value, test_count, tests, errors
                  FROM test_package_view WHERE site_id = ?::uuid AND status = 'Active' ORDER BY package_name""", v.get("site_id")) : List.of(),
            "editable", v.get("editable"), "allowed", allowed);
    }

    public Map<String, Object> addToQuote(RequestContext ctx, String vid, Map<String, Object> body) {
        Map<String, Object> v = versionOf(vid);
        if (!RequestContext.isUuid(body.get("package_id"))) throw new RuleException("Choose a package");
        double q = Js.toNumber(body.get("quantity"));
        double quantity = Math.max(1, !body.containsKey("quantity") || Double.isNaN(q) || q == 0 ? 1 : q);
        return uow.run(ctx.orReason("Quote edited"), d -> d.one("SELECT add_package_to_quote(?::uuid, ?::uuid, ?) AS id", v.get("id"), body.get("package_id"), quantity));
    }

    public Map<String, Object> setQuoted(RequestContext ctx, String id, Map<String, Object> body) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Package not found");
        return uow.run(ctx.orReason("Quote edited"), d -> {
            d.one("SELECT set_quoted_package(?::uuid, ?, ?)", id, Js.num(body.get("package_price")), Js.num(body.get("quantity")));
            return ok();
        });
    }

    public Map<String, Object> removeQuoted(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Package not found");
        return uow.run(ctx.orReason("Quote edited"), d -> { d.one("SELECT remove_quoted_package(?::uuid)", id); return ok(); });
    }

    // ---------------------------------------------------------------- orders
    public Map<String, Object> addToOrder(RequestContext ctx, String orderId, Map<String, Object> body) {
        if (!RequestContext.isUuid(orderId)) throw new RuleException("Order not found");
        Map<String, Object> o = db.one("SELECT site_id FROM lab_order WHERE id = ?::uuid", orderId);
        if (o == null) throw new RuleException("Order not found");
        access.checkSite(ctx, (String) o.get("site_id"));
        if (!RequestContext.isUuid(body.get("quoted_package_id"))) throw new RuleException("Choose a package");
        return uow.run(ctx, d -> {
            int n = 0;
            for (Object s : uuids(body.get("sample_ids"))) { d.one("SELECT order_package(?::uuid, ?::uuid) AS id", s, body.get("quoted_package_id")); n++; }
            return map("added", n);
        });
    }

    /** What cancelling this test of a package takes off (its share only; the other tests keep theirs); null when not in a package. */
    public Map<String, Object> cancelPreview(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Test not found");
        Map<String, Object> x = db.one("SELECT o.site_id FROM requested_test rt JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id WHERE rt.id = ?::uuid", id);
        if (x == null) throw new RuleException("Test not found");
        access.checkSite(ctx, (String) x.get("site_id"));
        return db.one("SELECT * FROM package_cancel_preview(?::uuid)", id);
    }

    public Map<String, Object> cancelOrdered(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Package not found");
        Map<String, Object> x = db.one("SELECT o.site_id FROM ordered_package op JOIN sample s ON s.id = op.sample_id JOIN lab_order o ON o.id = s.lab_order_id WHERE op.id = ?::uuid", id);
        if (x == null) throw new RuleException("Package not found");
        access.checkSite(ctx, (String) x.get("site_id"));
        return uow.run(ctx, d -> d.one("SELECT cancel_ordered_package(?::uuid) AS n", id));
    }

    // ---------------------------------------------------------------- dated price changes
    public Map<String, Object> priceChanges(RequestContext ctx) {
        String site = access.currentSite(ctx);
        return map("rows", db.rows("""
                SELECT pc.*, u.full_name AS created_by_name, cu.full_name AS cancelled_by_name, site_today(pc.site_id) AS today,
                    CASE WHEN pc.tests IS NULL THEN 'Every active test' ELSE (SELECT string_agg(t.test_name, ', ' ORDER BY t.test_name) FROM test t WHERE t.id = ANY (pc.tests)) END AS scope
                  FROM catalog_price_change pc JOIN app_user u ON u.id = pc.created_by LEFT JOIN app_user cu ON cu.id = pc.cancelled_by
                 WHERE pc.site_id = ?::uuid ORDER BY pc.effective_on DESC, pc.created_at DESC""", site),
            "today", db.one("SELECT site_today(?::uuid) AS d", site).get("d"), "can_edit", access.has(ctx, "catalog.edit"));
    }

    /** Scheduled; one starting today is applied at once (in the same transaction). */
    public Map<String, Object> schedule(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        double pct = body.containsKey("pct") ? Js.toNumber(body.get("pct")) : Double.NaN;
        if (Double.isNaN(pct) || Double.isInfinite(pct) || pct == 0) throw new RuleException("Give the percentage to change the prices by (e.g. 3 or -5)");
        List<Object> tests = body.get("tests") instanceof List<?> ? uuids(body.get("tests")) : null;
        if (tests != null && tests.isEmpty()) throw new RuleException("Select the tests to change, or choose every test");
        String on = Js.string(body.get("effective_on"));
        if (!on.matches("^\\d{4}-\\d{2}-\\d{2}$")) throw new RuleException("Give the date the new prices start");
        String reason = Js.string(body.get("reason")).trim();
        if (reason.isEmpty()) throw new RuleException("A Reason for Change is required for a price change");
        return uow.run(ctx.withSite(site), d -> {
            Map<String, Object> pc = d.one("""
                INSERT INTO catalog_price_change (site_id, tests, pct, rounding, include_packages, effective_on, reason)
                VALUES (?::uuid, ?::uuid[], ?, ?, ?, ?::date, ?) RETURNING id, change_code, effective_on <= site_today(site_id) AS due""",
                site, tests, pct, "Dollar".equals(body.get("rounding")) ? "Dollar" : "Cent", !Boolean.FALSE.equals(body.get("include_packages")), on, reason);
            Object applied = Js.truthy(pc.get("due")) ? d.one("SELECT apply_catalog_price_change(?::uuid) AS n", pc.get("id")).get("n") : null;
            return map("id", pc.get("id"), "change_code", pc.get("change_code"), "applied", applied);
        });
    }

    public Map<String, Object> cancelChange(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Price change not found");
        Map<String, Object> pc = db.one("SELECT site_id FROM catalog_price_change WHERE id = ?::uuid", id);
        if (pc == null) throw new RuleException("Price change not found");
        access.checkSite(ctx, (String) pc.get("site_id"));
        return uow.run(ctx.withSite((String) pc.get("site_id")), d -> { d.update("UPDATE catalog_price_change SET status = 'Cancelled' WHERE id = ?::uuid", id); return ok(); });
    }
}
