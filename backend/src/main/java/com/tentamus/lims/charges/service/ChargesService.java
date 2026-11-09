package com.tentamus.lims.charges.service;

import static com.tentamus.lims.core.web.Answers.*;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.charges.domain.Charge;
import com.tentamus.lims.charges.domain.OrderCharge;
import com.tentamus.lims.charges.repo.OrderChargeStore;
import com.tentamus.lims.pricing.domain.Amount;
import com.tentamus.lims.quotes.domain.QuoteVersion;
import com.tentamus.lims.quotes.repo.ProjectRepository;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Service lines, the test picker on a lab order (any test of the lab at its list price, the client's quoted tests
 * first), and miscellaneous charges in the catalogue, on quotes and on lab orders. The charge rules are the domain's
 * ({@link Charge}, {@link OrderCharge}); ordering at list price stays in the database (Orders and Invoicing rely on it).
 */
@Service
public class ChargesService {
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final ProjectRepository quotes;
    private final OrderChargeStore charges;

    public ChargesService(Db db, UnitOfWork uow, AccessPolicy access, ProjectRepository quotes, OrderChargeStore charges) {
        this.charges = charges;
        this.db = db;
        this.uow = uow;
        this.access = access;
        this.quotes = quotes;
    }

    private Map<String, Object> orderOf(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Order not found");
        Map<String, Object> o = db.one("SELECT id, site_id, client_id, order_code, status::text AS status FROM lab_order WHERE id = ?::uuid", id);
        if (o == null) throw new RuleException("Order not found");
        access.checkSite(ctx, (String) o.get("site_id"));
        return o;
    }

    private static String trimmed(Object v) { return Js.string(v).trim(); }

    private static Object status(Object v) { return Js.truthy(v) ? v : "Active"; }

    // ---------------------------------------------------------------- service lines (shared by every lab)
    public Map<String, Object> serviceLines(RequestContext ctx) {
        String site = access.currentSite(ctx);
        return map("lines", db.rows("SELECT * FROM service_line ORDER BY sort_order, line_name"),
            "types", db.rows("""
                SELECT t.*, sl.line_name, (SELECT count(*) FROM test x WHERE x.service_line_type_id = t.id AND x.site_id = ?::uuid AND x.status = 'Active')::int AS test_count
                  FROM service_line_type t JOIN service_line sl ON sl.id = t.service_line_id ORDER BY sl.sort_order, sl.line_name, t.sort_order, t.type_name""", site),
            "can_edit", access.has(ctx, "catalog.edit"));
    }

    public Map<String, Object> saveLines(RequestContext ctx, Map<String, Object> body) {
        uow.run(ctx.orReason("Service lines changed"), d -> {
            if (rows(body, "rows").stream().anyMatch(x -> !trimmed(x.get("line_name")).isEmpty())) access.requireToChange(ctx, "service_line", "catalog.edit");
            for (Map<String, Object> x : rows(body, "rows")) {
                if (trimmed(x.get("line_name")).isEmpty()) continue;
                if (RequestContext.isUuid(x.get("id"))) d.update("UPDATE service_line SET line_name = ?, sort_order = ?, status = ? WHERE id = ?::uuid",
                    trimmed(x.get("line_name")), Js.intOr(x.get("sort_order"), 0), status(x.get("status")), x.get("id"));
                else d.update("INSERT INTO service_line (line_name, sort_order) VALUES (?, ?)", trimmed(x.get("line_name")), Js.intOr(x.get("sort_order"), 0));
            }
            return null;
        });
        return ok();
    }

    public Map<String, Object> saveTypes(RequestContext ctx, Map<String, Object> body) {
        uow.run(ctx.orReason("Service line types changed"), d -> {
            if (rows(body, "rows").stream().anyMatch(x -> !trimmed(x.get("type_name")).isEmpty())) access.requireToChange(ctx, "service_line_type", "catalog.edit");
            for (Map<String, Object> x : rows(body, "rows")) {
                if (trimmed(x.get("type_name")).isEmpty()) continue;
                if (RequestContext.isUuid(x.get("id"))) d.update("UPDATE service_line_type SET type_name = ?, sort_order = ?, status = ? WHERE id = ?::uuid",
                    trimmed(x.get("type_name")), Js.intOr(x.get("sort_order"), 0), status(x.get("status")), x.get("id"));
                else {
                    if (!RequestContext.isUuid(x.get("service_line_id"))) throw new RuleException("Choose the service line of \"" + Js.string(x.get("type_name")) + "\"");
                    d.update("INSERT INTO service_line_type (service_line_id, type_name, sort_order) VALUES (?::uuid, ?, ?)",
                        x.get("service_line_id"), trimmed(x.get("type_name")), Js.intOr(x.get("sort_order"), 0));
                }
            }
            return null;
        });
        return ok();
    }

    /** The lab's tests and their service line type (fill down and paste on the Service lines tab). */
    public List<Map<String, Object>> tests(RequestContext ctx) {
        String site = access.currentSite(ctx);
        return db.rows("""
            SELECT t.id, t.test_code, t.test_name, t.service_line_type_id, d.department_name, sl.line_name, slt.type_name
              FROM test t LEFT JOIN department d ON d.id = t.department_id LEFT JOIN service_line_type slt ON slt.id = t.service_line_type_id
              LEFT JOIN service_line sl ON sl.id = slt.service_line_id
             WHERE t.site_id = ?::uuid AND t.status = 'Active' ORDER BY t.test_name""", site);
    }

    public Map<String, Object> saveTests(RequestContext ctx, Map<String, Object> body) {
        uow.run(ctx.orReason("Service line types of tests"), d -> {
            for (Map<String, Object> x : rows(body, "rows")) {
                if (!RequestContext.isUuid(x.get("id"))) continue;
                Object type = uuidOrNull(x.get("service_line_type_id"));
                d.update("UPDATE test SET service_line_type_id = ?::uuid WHERE id = ?::uuid AND service_line_type_id IS DISTINCT FROM ?::uuid", type, x.get("id"), type);
            }
            return null;
        });
        return ok();
    }

    /** The client's service lines (what the picker opens on). */
    public List<Map<String, Object>> clientLines(String clientId) {
        if (!RequestContext.isUuid(clientId)) throw new RuleException("Client not found");
        return db.rows("""
            SELECT sl.id, sl.line_name, (csl.id IS NOT NULL AND csl.status = 'Active') AS chosen FROM service_line sl
              LEFT JOIN client_service_line csl ON csl.service_line_id = sl.id AND csl.client_id = ?::uuid WHERE sl.status = 'Active' ORDER BY sl.sort_order, sl.line_name""", clientId);
    }

    public Map<String, Object> saveClientLines(RequestContext ctx, String clientId, Map<String, Object> body) {
        if (!RequestContext.isUuid(clientId)) throw new RuleException("Client not found");
        List<Object> ids = uuids(body.get("ids"));
        uow.run(ctx.orReason("Client service lines changed"), d -> {
            if (!ids.isEmpty() || d.one("""
                SELECT 1 FROM client_service_line WHERE client_id = ?::uuid AND status = 'Active' AND NOT (service_line_id = ANY (?::uuid[])) LIMIT 1""", clientId, ids) != null)
                access.requireToChange(ctx, "client_service_line", "master.clients");
            d.update("UPDATE client_service_line SET status = 'Inactive' WHERE client_id = ?::uuid AND status = 'Active' AND NOT (service_line_id = ANY (?::uuid[]))", clientId, ids);
            for (Object id : ids) d.update("""
                INSERT INTO client_service_line (client_id, service_line_id) VALUES (?::uuid, ?::uuid)
                  ON CONFLICT (client_id, service_line_id) DO UPDATE SET status = 'Active' WHERE client_service_line.status <> 'Active'""", clientId, id);
            return null;
        });
        return ok();
    }

    // ---------------------------------------------------------------- the test picker on a lab order
    /** The lab's orderable tests with their line, type and department, the client's price, and why a test cannot be ordered. */
    public Map<String, Object> picker(RequestContext ctx, String orderId) {
        Map<String, Object> o = orderOf(ctx, orderId);
        Object client = o.get("client_id"), site = o.get("site_id");
        return map("tests", db.rows("""
                WITH q AS (
                  SELECT DISTINCT ON (ol.test_id) ol.test_id, ol.line_id, ol.final_price, ol.project_code FROM orderable_lines(?::uuid) ol
                   JOIN quoted_test_configuration x ON x.id = ol.line_id JOIN project_version pv ON pv.id = x.project_version_id
                   ORDER BY ol.test_id, pv.accepted_at DESC NULLS LAST, ol.final_price)
                SELECT t.id, t.test_code, t.test_name, e.description, e.standard_tat, e.tat_unit::text AS tat_unit, e.rush_schedule_id, catalog_list_price(e.id) AS list_price,
                       q.final_price AS quote_price, q.project_code, d.id AS department_id, d.department_name, slt.id AS type_id, slt.type_name, sl.id AS line_id, sl.line_name,
                       catalogue_order_problem(?::uuid, t.id) AS problem, e.pricing_mode::text AS pricing_mode
                  FROM test t JOIN test_catalog_entry e ON e.test_id = t.id LEFT JOIN q ON q.test_id = t.id
                  LEFT JOIN department d ON d.id = t.department_id LEFT JOIN service_line_type slt ON slt.id = t.service_line_type_id LEFT JOIN service_line sl ON sl.id = slt.service_line_id
                 WHERE t.site_id = ?::uuid AND t.status = 'Active' AND t.serving_role IS NULL
                 ORDER BY (q.test_id IS NULL), t.test_name""", client, site, site),
            "lines", db.rows("""
                SELECT sl.id, sl.line_name, sl.sort_order,
                    EXISTS (SELECT 1 FROM client_service_line csl WHERE csl.client_id = ?::uuid AND csl.service_line_id = sl.id AND csl.status = 'Active') AS client_line
                  FROM service_line sl WHERE sl.status = 'Active' ORDER BY sl.sort_order, sl.line_name""", client),
            "elsewhere", db.rows("""
                SELECT DISTINCT ol.test_name, ls.site_code FROM orderable_lines(?::uuid) ol JOIN test tt ON tt.id = ol.test_id JOIN lab_site ls ON ls.id = tt.site_id
                 WHERE tt.site_id <> ?::uuid ORDER BY ls.site_code, ol.test_name""", client, site));
    }

    /** Tests from the picker on the chosen samples: the quote's price when the client has one, else the list price. */
    public Map<String, Object> orderTests(RequestContext ctx, String orderId, Map<String, Object> body) {
        Map<String, Object> o = orderOf(ctx, orderId);
        List<Object> samples = uuids(body.get("sample_ids")), tests = uuids(body.get("test_ids"));
        if (samples.isEmpty()) throw new RuleException("Choose the samples to add the tests to");
        if (tests.isEmpty()) throw new RuleException("Choose the tests to add");
        Object tier = uuidOrNull(body.get("rush_tier_id"));
        return uow.run(ctx, d -> {
            int added = 0, skipped = 0, listPrice = 0;
            for (Object s : samples) {
                if (d.one("SELECT 1 AS x FROM sample WHERE id = ?::uuid AND lab_order_id = ?::uuid", s, o.get("id")) == null) throw new RuleException("That sample is on another order");
                for (Object test : tests) {
                    if (d.one("SELECT 1 AS x FROM requested_test WHERE sample_id = ?::uuid AND test_id = ?::uuid AND status <> 'Cancelled' AND retest_of_id IS NULL", s, test) != null) { skipped++; continue; }
                    // a rush tier only on tests of its schedule
                    Object useTier = tier != null && d.one("""
                        SELECT 1 AS x FROM test_catalog_entry e JOIN rush_fee_tier tr ON tr.schedule_id = e.rush_schedule_id WHERE e.test_id = ?::uuid AND tr.id = ?::uuid""", test, tier) != null ? tier : null;
                    Object id = d.one("SELECT order_catalogue_test(?::uuid, ?::uuid, ?::uuid) AS id", s, test, useTier).get("id");
                    added++;
                    if (Js.truthy(d.one("SELECT catalogue_order FROM requested_test WHERE id = ?::uuid", id).get("catalogue_order"))) listPrice++;
                }
            }
            return map("added", added, "skipped", skipped, "list_price", listPrice);
        });
    }

    // ---------------------------------------------------------------- the catalogue of charges
    public Map<String, Object> items(RequestContext ctx) {
        String site = access.currentSite(ctx);
        Map<String, Object> me = db.one("SELECT is_admin FROM app_user WHERE id = ?::uuid", ctx.userId());
        return map("rows", db.rows("""
                SELECT ci.*, ls.site_code, sl.line_name, (SELECT count(*) FROM order_charge oc WHERE oc.charge_item_id = ci.id)::int AS used
                  FROM charge_item ci LEFT JOIN lab_site ls ON ls.id = ci.site_id LEFT JOIN service_line sl ON sl.id = ci.service_line_id
                 WHERE ci.site_id IS NULL OR ci.site_id = ?::uuid ORDER BY ci.status, ci.kind = 'Discount', ci.charge_name""", site),
            "can_edit", access.has(ctx, "catalog.edit"), "is_admin", me != null && Js.truthy(me.get("is_admin")), "site", site);
    }

    public Map<String, Object> saveItems(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        uow.run(ctx.orReason("Charges changed"), d -> {
            for (Map<String, Object> x : rows(body, "rows")) {
                if (trimmed(x.get("charge_name")).isEmpty()) continue;
                Double price = Js.num(x.get("price"));
                Charge.checkItem(trimmed(x.get("charge_name")), price == null ? null : Amount.of(Js.number(price)));
                Object[] v = { trimmed(x.get("charge_name")), Js.truthy(x.get("kind")) ? x.get("kind") : "Other", Js.orNull(x.get("description")), price == null ? 0 : price,
                    uuidOrNull(x.get("service_line_id")), status(x.get("status")) };
                if (RequestContext.isUuid(x.get("id"))) {
                    Map<String, Object> stored = d.one("SELECT site_id FROM charge_item WHERE id = ?::uuid", x.get("id"));
                    if (stored != null) mayKeepCharges(ctx, (String) stored.get("site_id"));
                } else mayKeepCharges(ctx, "Every lab".equals(x.get("scope")) ? null : site);
                if (RequestContext.isUuid(x.get("id"))) d.update("UPDATE charge_item SET charge_name = ?, kind = ?, description = ?, price = ?, service_line_id = ?::uuid, status = ? WHERE id = ?::uuid",
                    v[0], v[1], v[2], v[3], v[4], v[5], x.get("id"));
                else d.update("INSERT INTO charge_item (charge_name, kind, description, price, service_line_id, status, site_id) VALUES (?, ?, ?, ?, ?::uuid, ?, ?::uuid)",
                    v[0], v[1], v[2], v[3], v[4], v[5], "Every lab".equals(x.get("scope")) ? null : site);
            }
            return null;
        });
        return ok();
    }

    /** Charges for every lab are kept by system administrators, a lab's by catalog.edit there (charge_item_rules until 072). */
    private void mayKeepCharges(RequestContext ctx, String site) {
        if (site == null) access.requireSystemAdmin(ctx, "Charges for every lab are kept by system administrators; choose your lab");
        else access.requireAt(ctx, "catalog.edit", site);
    }

    // ---------------------------------------------------------------- charges on a quote or project version
    private Map<String, Object> versionOf(String vid) {
        if (!RequestContext.isUuid(vid)) throw new RuleException("Quote not found");
        Map<String, Object> v = db.one("""
            SELECT pv.id, p.site_id, p.client_id, version_is_editable(pv.id) AS editable FROM project_version pv JOIN project p ON p.id = pv.project_id WHERE pv.id = ?::uuid""", vid);
        if (v == null) throw new RuleException("Quote not found");
        return v;
    }

    public Map<String, Object> quoteCharges(RequestContext ctx, String vid) {
        Map<String, Object> v = versionOf(vid);
        Object site = v.get("site_id") != null ? v.get("site_id") : access.currentSite(ctx);
        return map("rows", db.rows("""
                SELECT qc.*, ci.charge_code, ci.charge_name, ci.kind, ci.description, qc.quantity * qc.unit_price * charge_sign(ci.kind) AS line_total
                  FROM quoted_charge qc JOIN charge_item ci ON ci.id = qc.charge_item_id WHERE qc.project_version_id = ?::uuid AND qc.status = 'Active'
                 ORDER BY ci.kind = 'Discount', ci.charge_name""", v.get("id")),
            "items", db.rows("SELECT id, charge_code, charge_name, kind, price FROM charge_item WHERE status = 'Active' AND (site_id IS NULL OR site_id = ?::uuid) ORDER BY kind = 'Discount', charge_name", site),
            "editable", v.get("editable"));
    }

    public Map<String, Object> addQuoteCharge(RequestContext ctx, String vid, Map<String, Object> body) {
        Map<String, Object> v = versionOf(vid);
        if (!RequestContext.isUuid(body.get("charge_item_id"))) throw new RuleException("Choose the charge");
        return uow.run(ctx.orReason("Quote edited"), d -> {
            Map<String, Object> item = d.one("SELECT status::text AS status FROM charge_item WHERE id = ?::uuid", body.get("charge_item_id"));
            Charge.checkAddToQuote(quotes.quoteVersion(d, v.get("id")), item == null ? null : (String) item.get("status"),
                map("quantity", Js.intOr(body.get("quantity"), 1), "unit_price", Js.num(body.get("unit_price"))));
            return d.one("""
            INSERT INTO quoted_charge (project_version_id, charge_item_id, quantity, unit_price, note)
            VALUES (?::uuid, ?::uuid, ?, COALESCE(?::numeric, (SELECT price FROM charge_item WHERE id = ?::uuid)), ?) RETURNING id""",
            v.get("id"), body.get("charge_item_id"), Js.intOr(body.get("quantity"), 1), Js.num(body.get("unit_price")), body.get("charge_item_id"), Js.orNull(body.get("note")));
        });
    }

    public Map<String, Object> changeQuoteCharge(RequestContext ctx, String id, Map<String, Object> body) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Charge not found");
        return uow.run(ctx.orReason("Quote edited"), d -> {
            QuoteVersion v = quotes.quoteVersion(d, d.one("SELECT project_version_id FROM quoted_charge WHERE id = ?::uuid", id) instanceof Map<?, ?> r ? r.get("project_version_id") : null);
            if (v != null) Charge.checkQuoteChange(v, Js.truthy(body.get("remove")) ? Map.of() : map("unit_price", Js.num(body.get("unit_price"))));
            if (Js.truthy(body.get("remove"))) { d.update("UPDATE quoted_charge SET status = 'Inactive' WHERE id = ?::uuid", id); return ok(); }
            Long q = Js.parseInt(body.get("quantity"));
            d.update("UPDATE quoted_charge SET quantity = COALESCE(?::int, quantity), unit_price = COALESCE(?::numeric, unit_price), note = ? WHERE id = ?::uuid",
                q == null || q == 0 ? null : q, Js.num(body.get("unit_price")), Js.orNull(body.get("note")), id);
            return ok();
        });
    }

    // ---------------------------------------------------------------- charges on a lab order
    public Map<String, Object> orderCharges(RequestContext ctx, String orderId) {
        Map<String, Object> o = orderOf(ctx, orderId);
        return map("rows", db.rows("""
                SELECT oc.*, ci.charge_code, ci.charge_name, ci.kind, s.sample_code, oc.quantity * oc.unit_price AS amount,
                    (SELECT COALESCE(i.invoice_number, i.draft_code) FROM invoice_line l JOIN invoice i ON i.id = l.invoice_id WHERE l.id = charge_invoice_line(oc.id)) AS invoice_code,
                    (SELECT l.invoice_id FROM invoice_line l WHERE l.id = charge_invoice_line(oc.id)) AS invoice_id,
                    charge_billing_closed(oc.id) AS credited, p.project_code
                  FROM order_charge oc JOIN charge_item ci ON ci.id = oc.charge_item_id LEFT JOIN sample s ON s.id = oc.sample_id
                  LEFT JOIN quoted_charge qc ON qc.id = oc.quoted_charge_id LEFT JOIN project_version pv ON pv.id = qc.project_version_id LEFT JOIN project p ON p.id = pv.project_id
                 WHERE oc.lab_order_id = ?::uuid ORDER BY oc.status, oc.created_at""", o.get("id")),
            "items", db.rows("""
                SELECT ci.id, ci.charge_code, ci.charge_name, ci.kind, ci.price, cp.unit_price AS client_price, cp.project_code
                  FROM charge_item ci LEFT JOIN LATERAL client_charge_price(?::uuid, ci.id) cp ON true
                 WHERE ci.status = 'Active' AND (ci.site_id IS NULL OR ci.site_id = ?::uuid) ORDER BY ci.kind = 'Discount', ci.charge_name""", o.get("client_id"), o.get("site_id")),
            "can_edit", access.load(ctx.userId()).can("orders.edit", (String) o.get("site_id")));
    }

    public Map<String, Object> addOrderCharge(RequestContext ctx, String orderId, Map<String, Object> body) {
        Map<String, Object> o = orderOf(ctx, orderId);
        if (!RequestContext.isUuid(body.get("charge_item_id"))) throw new RuleException("Choose the charge");
        return uow.run(ctx, d -> {
            Object sample = uuidOrNull(body.get("sample_id"));
            Map<String, Object> s = sample == null ? null : d.one("SELECT lab_order_id FROM sample WHERE id = ?::uuid", sample);
            Map<String, Object> item = charges.item(d, body.get("charge_item_id"));
            Double typed = Js.num(body.get("unit_price"));
            OrderCharge.checkQuantity(Js.intOr(body.get("quantity"), 1));
            OrderCharge.checkNew((String) o.get("id"), (String) o.get("site_id"), sample == null ? null : sample.toString(), s == null ? null : (String) s.get("lab_order_id"),
                item == null ? null : (String) item.get("status"), item == null ? null : (String) item.get("site_id"), item == null ? BigDecimal.ZERO : Amount.of(item.get("price")),
                typed == null ? null : Amount.of(Js.number(typed)), !ctx.reason().isBlank());
            return charges.insert(d, o.get("id"), sample, body.get("charge_item_id"), Js.intOr(body.get("quantity"), 1),
                typed == null ? null : Amount.of(Js.number(typed)), Js.orNull(body.get("note")), "Order");
        });
    }

    public Map<String, Object> changeOrderCharge(RequestContext ctx, String id, Map<String, Object> body) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Charge not found");
        Map<String, Object> oc = db.one("SELECT lab_order_id FROM order_charge WHERE id = ?::uuid", id);
        if (oc == null) throw new RuleException("Charge not found");
        orderOf(ctx, (String) oc.get("lab_order_id"));
        return uow.run(ctx, d -> {
            Map<String, Object> c = d.one("""
                SELECT oc.id, oc.charge_no, oc.lab_order_id, oc.status, oc.quantity, oc.unit_price, ci.kind, charge_invoice_line(oc.id) IS NOT NULL AS invoiced
                  FROM order_charge oc JOIN charge_item ci ON ci.id = oc.charge_item_id WHERE oc.id = ?::uuid""", id);
            OrderCharge charge = new OrderCharge(id, (String) c.get("charge_no"), (String) c.get("lab_order_id"), (String) c.get("status"), Boolean.TRUE.equals(c.get("invoiced")));
            Long q = Js.parseInt(body.get("quantity"));
            Double price = Js.num(body.get("unit_price"));
            boolean changes = Js.truthy(body.get("cancel")) || (q != null && q != 0 && Amount.of(q).compareTo(Amount.of(c.get("quantity"))) != 0)
                || (price != null && Amount.of(Js.number(price)).abs().compareTo(Amount.of(c.get("unit_price")).abs()) != 0);
            charge.checkChange(changes, !ctx.reason().isBlank());
            if (q != null && q != 0) OrderCharge.checkQuantity(q);
            if (Js.truthy(body.get("cancel"))) d.update("UPDATE order_charge SET status = 'Cancelled' WHERE id = ?::uuid", id);
            else {
                d.update("UPDATE order_charge SET quantity = COALESCE(?::int, quantity), unit_price = COALESCE(?::numeric, unit_price), note = ? WHERE id = ?::uuid",
                    q == null || q == 0 ? null : q, price == null ? null : OrderCharge.signed((String) c.get("kind"), Amount.of(Js.number(price))), Js.orNull(body.get("note")), id);
            }
            return ok();
        });
    }
}
