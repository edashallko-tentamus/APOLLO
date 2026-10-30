package com.tentamus.lims.packages.service;

import static com.tentamus.lims.core.web.Answers.*;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.time.LabClock;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.packages.domain.PriceChange;
import com.tentamus.lims.packages.domain.QuotedPackage;
import com.tentamus.lims.packages.domain.TestPackage;
import com.tentamus.lims.packages.repo.PackageRepository;
import com.tentamus.lims.pricing.domain.Amount;
import com.tentamus.lims.pricing.domain.CatalogueEntry;
import com.tentamus.lims.pricing.domain.PriceAdjustment;
import com.tentamus.lims.pricing.repo.CatalogueRepository;
import com.tentamus.lims.quotes.domain.QuoteVersion;
import com.tentamus.lims.quotes.repo.ProjectRepository;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.stereotype.Service;

/**
 * Test packages in the catalogue, on quotes and on orders (cancelling one of its tests takes off only that test's
 * share), and price changes from an effective date. The rules are the domain's ({@link TestPackage},
 * {@link QuotedPackage}, {@link PriceChange}). A change starting today is applied when it is made; later ones by the
 * hourly job (applyDue).
 */
@Service
public class PackagesService {
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(PackagesService.class);
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final PackageRepository packages;
    private final CatalogueRepository catalogue;
    private final ProjectRepository quotes;
    private final LabClock clock;

    public PackagesService(Db db, UnitOfWork uow, AccessPolicy access, PackageRepository packages, CatalogueRepository catalogue, ProjectRepository quotes,
                           LabClock clock) {
        this.db = db;
        this.uow = uow;
        this.access = access;
        this.packages = packages;
        this.catalogue = catalogue;
        this.quotes = quotes;
        this.clock = clock;
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
        return new Object[] { TestPackage.name(Js.string(b.get("package_name"))), Js.orNull(b.get("description")), Js.truthy(b.get("show_in_public_catalogue")) };
    }

    public Map<String, Object> create(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        Object[] h = header(body);
        return uow.run(ctx.withSite(site).orReason("New package"), d -> {
            Map<String, Object> p = d.one("INSERT INTO test_package (site_id, package_name, description, show_in_public_catalogue) VALUES (?::uuid, ?, ?, ?) RETURNING id, package_code",
                site, h[0], h[1], h[2]);
            int n = 0;
            for (Object id : uuids(body.get("tests"))) d.update("INSERT INTO test_package_item (package_id, test_id, sort_order, component_price) VALUES (?::uuid, ?::uuid, ?, ?::numeric)",
                p.get("id"), id, ++n, newItemPrice(d, site, id, null));
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
                    Map<String, Object> item = packages.item(d, it.get("id"), pid);
                    if (item != null) {
                        Map<String, Object> t = packages.test(d, item.get("test_id"));
                        TestPackage.checkPrice(it.get("component_price"), (String) t.get("test_name"), true);
                        Object status = Js.orNull(it.get("status"));
                        if ("Active".equals(status != null ? status : item.get("status")))
                            TestPackage.checkTest((String) item.get("site_id"), (String) t.get("site_id"), (String) t.get("test_name"), Boolean.TRUE.equals(t.get("priced")));
                    }
                    d.update("""
                        UPDATE test_package_item SET sort_order = COALESCE(?::int, sort_order), component_price = ?::numeric, status = COALESCE(?::record_status, status)
                         WHERE id = ?::uuid AND package_id = ?::uuid""", Js.num(it.get("sort_order")), Js.num(it.get("component_price")), Js.orNull(it.get("status")), it.get("id"), pid);
                } else if (RequestContext.isUuid(it.get("test_id"))) {
                    Object next = d.one("SELECT COALESCE(max(sort_order), 0) + 1 AS n FROM test_package_item WHERE package_id = ?::uuid", pid).get("n");
                    Double sort = Js.num(it.get("sort_order"));
                    d.update("INSERT INTO test_package_item (package_id, test_id, sort_order, component_price) VALUES (?::uuid, ?::uuid, ?::int, ?::numeric)",
                        pid, it.get("test_id"), sort != null ? sort : next, newItemPrice(d, (String) p.get("site_id"), it.get("test_id"), it.get("component_price")));
                }
            }
            for (Map<String, Object> a : rows(body, "analytes")) {
                if (!RequestContext.isUuid(a.get("item_id")) || !RequestContext.isUuid(a.get("analyte_id"))) continue;
                Map<String, Object> item = packages.item(d, a.get("item_id"), pid);
                if (item != null) TestPackage.checkAnalyte((String) packages.test(d, item.get("test_id")).get("pricing_mode"),
                    packages.analytePricedOnTest(d, item.get("test_id"), a.get("analyte_id")));
                d.update("""
                    INSERT INTO test_package_analyte (item_id, analyte_id, included) VALUES (?::uuid, ?::uuid, ?)
                      ON CONFLICT (item_id, analyte_id) DO UPDATE SET included = EXCLUDED.included""", a.get("item_id"), a.get("analyte_id"), !Boolean.FALSE.equals(a.get("included")));
            }
            return ok();
        });
    }

    /** A new package line's price: as typed, else the test's catalogue price; the test must be the lab's, active and priced. */
    private Object newItemPrice(Db d, String packageSite, Object testId, Object typed) {
        Map<String, Object> t = packages.test(d, testId);
        if (t == null) throw new RuleException("Test not found");
        TestPackage.checkTest(packageSite, (String) t.get("site_id"), (String) t.get("test_name"), Boolean.TRUE.equals(t.get("priced")));
        Double price = Js.num(typed);
        TestPackage.checkPrice(price, (String) t.get("test_name"), false);
        if (price != null) return price;
        CatalogueEntry e = catalogue.entryOf(d, testId);
        return e == null ? null : e.listPrice();
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
        return uow.run(ctx.orReason("Quote edited"), d -> {
            QuoteVersion version = quotes.quoteVersion(d, v.get("id"));
            Map<String, Object> pkg = packages.packageRow(d, body.get("package_id"));
            QuotedPackage.checkAdd(version, pkg == null ? null : (String) pkg.get("package_code"), pkg == null ? null : (String) pkg.get("status"),
                pkg == null ? null : (String) pkg.get("site_id"), pkg == null ? null : (String) pkg.get("site_code"), packages.siteCode(d, version.siteId()),
                pkg == null ? List.of() : packages.errors(d, pkg.get("id")), pkg != null && packages.onVersion(d, version.id(), pkg.get("id")));
            return map("id", packages.addToVersion(d, version.id(), pkg, QuotedPackage.quantity(quantity), packages.lines(d, pkg.get("id"))));
        });
    }

    public Map<String, Object> setQuoted(RequestContext ctx, String id, Map<String, Object> body) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Package not found");
        return uow.run(ctx.orReason("Quote edited"), d -> {
            Map<String, Object> qp = packages.quoted(d, id);
            if (qp == null || !"Active".equals(qp.get("status"))) throw RuleException.database("Package not found on the quote");
            Double p = Js.num(body.get("package_price")), q = Js.num(body.get("quantity"));
            BigDecimal price = p == null ? null : Amount.of(Js.number(p));
            Long quantity = q == null ? null : (long) Math.round(q);
            QuotedPackage.checkChange(quotes.quoteVersion(d, qp.get("project_version_id")), price, quantity);
            List<BigDecimal> shares = price != null && price.compareTo(Amount.of(qp.get("package_price"))) != 0
                ? QuotedPackage.allocate(price, PackageRepository.prices(packages.quotedLines(d, id))) : null;
            packages.setQuoted(d, id, price, quantity, shares);
            return ok();
        });
    }

    public Map<String, Object> removeQuoted(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Package not found");
        return uow.run(ctx.orReason("Quote edited"), d -> {
            Map<String, Object> qp = packages.quoted(d, id);
            if (qp == null || !"Active".equals(qp.get("status"))) throw RuleException.database("Package not found on the quote");
            quotes.quoteVersion(d, qp.get("project_version_id")).requireEditable(QuotedPackage.LOCKED);
            packages.removeQuoted(d, id);
            return ok();
        });
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
        LocalDate today = clock.today(site);
        return uow.run(ctx.withSite(site), d -> {
            PriceChange.checkNew(LocalDate.parse(on), today, tests, packages.allOwnLab(d, tests, site), new BigDecimal(Js.number(pct)), reason);
            Map<String, Object> pc = d.one("""
                INSERT INTO catalog_price_change (site_id, tests, pct, rounding, include_packages, effective_on, reason)
                VALUES (?::uuid, ?::uuid[], ?, ?, ?, ?::date, ?) RETURNING id, change_code""",
                site, tests, pct, "Dollar".equals(body.get("rounding")) ? "Dollar" : "Cent", !Boolean.FALSE.equals(body.get("include_packages")), on, reason);
            Object applied = LocalDate.parse(on).isAfter(today) ? null : apply(d, packages.priceChange(d, pc.get("id")), today);
            return map("id", pc.get("id"), "change_code", pc.get("change_code"), "applied", applied);
        });
    }

    /**
     * The hourly job: applies every scheduled change whose day has come, each as the person who scheduled it, in its own
     * transaction. A change that cannot be applied keeps its reason in last_error (written as System). Returns how many applied.
     */
    public int applyDue() {
        int n = 0;
        for (Map<String, Object> due : db.rows("SELECT * FROM catalog_price_change_due")) {
            String site = (String) due.get("site_id");
            RequestContext as = new RequestContext((String) due.get("created_by"), site, site, "Scheduled price change " + due.get("change_code"), "127.0.0.1");
            try {
                uow.run(as, d -> apply(d, packages.priceChange(d, due.get("id")), clock.today(site)));
                n++;
            } catch (RuntimeException e) {
                log.error("Price change {} could not be applied: {}", due.get("change_code"), e.getMessage());
                try {
                    Object system = db.one("SELECT id FROM app_user WHERE username = 'system'").get("id");
                    String msg = String.valueOf(e.getMessage());
                    uow.run(new RequestContext((String) system, site, site, "The scheduled price change could not be applied", "127.0.0.1"),
                        d -> d.update("UPDATE catalog_price_change SET last_error = ? WHERE id = ?::uuid", msg.length() > 500 ? msg.substring(0, 500) : msg, due.get("id")));
                } catch (RuntimeException ignored) {
                    // as in Node: recording the error never stops the other changes
                }
            }
        }
        return n;
    }

    /** Java's own apply_catalog_price_change: the lab's tests, their analyte prices and their prices in packages. */
    private int apply(Db d, PriceChange c, LocalDate today) {
        PriceAdjustment a = c.toApply(today);
        d.one("SELECT set_config('lims.reason', ?, true) AS r", c.auditReason());
        int n = catalogue.reprice(d, c.tests(), c.siteId(), a);
        int m = c.includePackages() ? packages.repricePackages(d, c, a) : 0;
        packages.markApplied(d, c, n, m);
        return n;
    }

    public Map<String, Object> cancelChange(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Price change not found");
        Map<String, Object> pc = db.one("SELECT site_id FROM catalog_price_change WHERE id = ?::uuid", id);
        if (pc == null) throw new RuleException("Price change not found");
        access.checkSite(ctx, (String) pc.get("site_id"));
        return uow.run(ctx.withSite((String) pc.get("site_id")), d -> {
            PriceChange c = packages.priceChange(d, id);
            c.checkCancel();
            if (!c.isCancelled()) packages.markCancelled(d, c);
            return ok();
        });
    }
}
