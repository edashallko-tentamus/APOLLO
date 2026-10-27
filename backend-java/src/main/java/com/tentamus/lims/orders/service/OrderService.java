package com.tentamus.lims.orders.service;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.paging.PagedList;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.orders.repo.OrderRepository;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Lab orders and samples: the list, an order's page, samples by grid, ordering tests (from a project or a quoted line),
 * rush for the whole order, logging, cancelling, and a test's analytes. Ordering rules (quoted or list price, due dates,
 * sample IDs, who may change what) are still enforced by the database.
 */
@Service
public class OrderService {
    private final OrderRepository repo;
    private final AccessPolicy access;
    private final UnitOfWork uow;

    public OrderService(OrderRepository repo, AccessPolicy access, UnitOfWork uow) {
        this.repo = repo;
        this.access = access;
        this.uow = uow;
    }

    public Object list(RequestContext ctx, Map<String, String> query) {
        String site = access.currentSite(ctx);
        return PagedList.wanted(query) ? repo.page(site, query) : repo.orders(site);
    }

    /** A new order is always for the lab the person is working in. */
    public Map<String, Object> create(RequestContext ctx, Map<String, Object> row) {
        String site = access.currentSite(ctx);
        Map<String, Object> r = new LinkedHashMap<>(row);
        r.put("site_id", site);
        return uow.run(ctx, d -> OrderRepository.NEW_ORDER.upsert(d, List.of(r), Map.of()).get(0));
    }

    public List<Map<String, Object>> update(RequestContext ctx, String id, Map<String, Object> row) {
        Map<String, Object> r = new LinkedHashMap<>(row);
        r.put("id", id);
        return uow.run(ctx, d -> OrderRepository.ORDER.upsert(d, List.of(r), Map.of()));
    }

    /** An order's page: the order, its samples and tests, what can be ordered, and the lists its grids pick from. */
    public Map<String, Object> page(RequestContext ctx, String id) {
        Map<String, Object> order = repo.order(id);
        if (order == null) throw new RuleException("Order not found");
        access.checkSite(ctx, (String) order.get("site_id"));
        Object license = repo.licenseOf(order.get("id"));
        order.put("client_license_id", license);
        Object client = order.get("client_id"), site = order.get("site_id");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("order", order);
        out.put("samples", repo.samplesOf(id));
        out.put("tests", repo.testsOfOrder(id));
        out.put("orderable", repo.orderableLines(client, site));
        out.put("packages", repo.orderablePackages(client, site));
        out.put("tiers", repo.rushTiers());
        out.put("contacts", repo.orderingContacts(client));
        out.put("emails", repo.emails(id));
        out.put("matrices", repo.names("SELECT matrix_name FROM matrix WHERE status = 'Active' ORDER BY lower(matrix_name)"));
        out.put("categories", repo.names("SELECT category_name FROM compliance_category WHERE status = 'Active' ORDER BY sort_order, category_name"));
        out.put("attachments", repo.attachments(id));
        out.put("units", repo.units());
        out.put("elsewhere", repo.quotedElsewhere(client, site));
        out.put("licenses", repo.licenses(client, license, site));
        return out;
    }

    /** A sample's page: the sample (with who logged it), its order and tests, and what holds results per serving. */
    public Map<String, Object> sample(RequestContext ctx, String id) {
        Map<String, Object> sample = repo.sample(id);
        if (sample == null) throw new RuleException("Sample not found");
        Map<String, Object> order = repo.order(sample.get("lab_order_id"));
        access.checkSite(ctx, (String) order.get("site_id"));
        sample.put("logged_by_name", sample.get("logged_by") == null ? null : repo.fullName(sample.get("logged_by")));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("sample", sample);
        out.put("order", order);
        out.put("tests", repo.testsOfSample(id));
        out.put("serving_held", repo.servingHeld(id));
        out.put("serving_tests", repo.servingTests(id));
        return out;
    }

    /** For a new order: the client's ordering contacts and how many quoted lines it can order. */
    public Map<String, Object> setup(String clientId) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("contacts", repo.orderingContacts(clientId));
        out.put("orderableCount", repo.orderableCount(clientId));
        return out;
    }

    public List<Map<String, Object>> saveSamples(RequestContext ctx, String orderId, List<Map<String, Object>> rows) {
        return uow.run(ctx, d -> OrderRepository.SAMPLES.upsert(d, rows, Map.of("lab_order_id", orderId)));
    }

    /** Asks the client for the serving test the per-serving results need (it waits for their consent). */
    public Map<String, Object> requestServingTest(RequestContext ctx, String sampleId, Map<String, Object> b) {
        if (!RequestContext.isUuid(sampleId)) throw new RuleException("Sample not found");
        Map<String, Object> s = repo.sampleLab(sampleId);
        if (s == null) throw new RuleException("Sample not found");
        access.checkSite(ctx, (String) s.get("site_id"));
        String role = "Density".equals(b.get("role")) ? "Density" : "Serving weight";
        String reason = blank(b.get("reason")) ? "Request for the " + role.toLowerCase() + " test" : b.get("reason").toString();
        return uow.run(ctx, reason, d -> d.one("SELECT request_serving_test(?::uuid, ?, ?) AS id", sampleId, role, blank(b.get("note")) ? null : b.get("note")));
    }

    /** Orders all of a project's quoted tests on each sample. */
    public Map<String, Object> applyProject(RequestContext ctx, Map<String, Object> b) {
        return uow.run(ctx, d -> {
            long n = 0;
            for (Object s : list(b.get("sample_ids"))) n += ((Number) d.one("SELECT apply_project(?::uuid, ?::uuid) AS n", s, b.get("project_id")).get("n")).longValue();
            return Map.of("added", n);
        });
    }

    /** Orders one quoted line on each sample that does not already have that test. */
    public Map<String, Object> addTest(RequestContext ctx, Map<String, Object> b) {
        return uow.run(ctx, d -> {
            int n = 0;
            for (Object s : list(b.get("sample_ids"))) {
                boolean exists = d.one("""
                    SELECT 1 AS x FROM requested_test rt JOIN quoted_test_configuration q ON q.id = ?::uuid
                     WHERE rt.sample_id = ?::uuid AND rt.test_id = q.test_id AND rt.status <> 'Cancelled'""", b.get("line_id"), s) != null;
                if (!exists) { d.one("SELECT order_test(?::uuid, ?::uuid) AS id", s, b.get("line_id")); n++; }
            }
            return Map.of("added", n);
        });
    }

    public List<Map<String, Object>> saveTests(RequestContext ctx, List<Map<String, Object>> rows) {
        return uow.run(ctx, d -> OrderRepository.TESTS.upsert(d, rows, Map.of()));
    }

    /** Rush for the whole order: per rush schedule, the tier chosen (or none) for every test on that schedule. */
    public Map<String, Object> rush(RequestContext ctx, String orderId, Map<String, Object> b) {
        Map<?, ?> tiers = b.get("tiers") instanceof Map<?, ?> m ? m : Map.of();
        return uow.run(ctx, d -> {
            int n = 0;
            for (Map.Entry<?, ?> e : tiers.entrySet()) {
                Object tier = blank(e.getValue()) ? null : e.getValue();
                n += d.rows("""
                    UPDATE requested_test rt SET rush_tier_id = ?::uuid FROM sample s, test_catalog_entry e
                     WHERE rt.sample_id = s.id AND s.lab_order_id = ?::uuid AND e.test_id = rt.test_id AND e.rush_schedule_id = ?::uuid AND rt.status <> 'Cancelled'
                       AND rt.rush_tier_id IS DISTINCT FROM ?::uuid RETURNING rt.id""", tier, orderId, e.getKey(), tier).size();
            }
            return Map.of("changed", n);
        });
    }

    public Map<String, Object> log(RequestContext ctx, Map<String, Object> b) {
        return uow.run(ctx, d -> d.one("SELECT log_samples(?::uuid[]) AS logged", b.get("sample_ids")));
    }

    /** Cancels samples (and their tests) and tests, always with a reason; nothing is deleted. */
    public Map<String, Object> cancel(RequestContext ctx, String orderId, Map<String, Object> b) {
        if (!RequestContext.isUuid(orderId)) throw new RuleException("Order not found");
        Map<String, Object> o = repo.orderLab(orderId);
        if (o == null) throw new RuleException("Order not found");
        access.checkSite(ctx, (String) o.get("site_id"));
        List<Object> samples = list(b.get("sample_ids")).stream().filter(RequestContext::isUuid).toList();
        List<Object> tests = list(b.get("test_ids")).stream().filter(RequestContext::isUuid).toList();
        if (samples.isEmpty() && tests.isEmpty()) throw new RuleException("Choose the samples or tests to cancel");
        if (blank(b.get("reason")) || b.get("reason").toString().trim().isEmpty()) throw new RuleException("Say why they are cancelled");
        return uow.run(ctx, b.get("reason").toString(), d -> {
            int s = 0, n = 0;
            for (Object id : samples)
                s += d.rows("UPDATE sample SET status = 'Cancelled' WHERE id = ?::uuid AND lab_order_id = ?::uuid AND status <> 'Cancelled' RETURNING id", id, orderId).size();
            for (Object id : tests)
                n += d.rows("""
                    UPDATE requested_test SET status = 'Cancelled' WHERE id = ?::uuid AND status <> 'Cancelled'
                       AND sample_id IN (SELECT id FROM sample WHERE lab_order_id = ?::uuid) RETURNING id""", id, orderId).size();
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("samples", s);
            out.put("tests", n);
            return out;
        });
    }

    public List<Map<String, Object>> analytes(RequestContext ctx, String testId) {
        if (!RequestContext.isUuid(testId)) throw new RuleException("Test not found");
        Map<String, Object> r = repo.testLab(testId);
        if (r == null) throw new RuleException("Test not found");
        access.checkSite(ctx, (String) r.get("site_id"));
        return repo.analytesOf(testId);
    }

    public List<Map<String, Object>> saveAnalytes(RequestContext ctx, List<Map<String, Object>> rows) {
        return uow.run(ctx, d -> OrderRepository.ANALYTES.upsert(d, rows, Map.of()));
    }

    private static List<Object> list(Object o) { return o instanceof List<?> l ? new ArrayList<>(l) : List.of(); }

    private static boolean blank(Object v) { return v == null || "".equals(v) || Boolean.FALSE.equals(v); }
}
