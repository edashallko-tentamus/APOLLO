package com.tentamus.lims.orders.service;

import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.orders.domain.AnalyteTrim;
import com.tentamus.lims.orders.domain.RequestedTest;
import com.tentamus.lims.orders.domain.TestOrdering;
import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.orders.repo.OrderRepository;
import com.tentamus.lims.orders.repo.RequestedTestRepository;
import com.tentamus.lims.orders.repo.SampleRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Ordering tests on samples (a project's quoted tests, or one quoted line), changing them (rush, status, instructions,
 * TAT override: {@link RequestedTest}), rush for the whole order, and trimming a test's analytes ({@link AnalyteTrim}).
 * The database still works out each test's price, rush fee and due date as it is written.
 */
@Service
public class TestOrderingService {
    private final RequestedTestRepository tests;
    private final SampleRepository samples;
    private final OrderRepository orders;
    private final AccessPolicy access;
    private final UnitOfWork uow;

    public TestOrderingService(RequestedTestRepository tests, SampleRepository samples, OrderRepository orders, AccessPolicy access, UnitOfWork uow) {
        this.tests = tests;
        this.samples = samples;
        this.orders = orders;
        this.access = access;
        this.uow = uow;
    }

    /** Orders a quoted line on a sample (inside the caller's transaction). */
    public String orderTest(Object sample, Object line, Object rushTier) {
        String version = tests.ordering(sample, line).check();
        return tests.insertQuoted(sample, line, version, rushTier);
    }

    /** Orders all of a project's quoted tests on each sample (tests already on a sample are skipped). */
    public Map<String, Object> applyProject(RequestContext ctx, Map<String, Object> b) {
        return uow.run(ctx, d -> {
            long n = 0;
            for (Object s : list(b.get("sample_ids"))) {
                List<Map<String, Object>> lines = tests.projectLines(s, b.get("project_id"));
                int added = 0;
                for (Map<String, Object> l : lines)
                    if (!tests.hasTest(s, l.get("test_id"))) { orderTest(s, l.get("line_id"), null); added++; }
                TestOrdering.assertProjectOrderable(added, lines.size());
                n += added;
            }
            return Map.of("added", n);
        });
    }

    /** Orders one quoted line on each sample that does not already have that test. */
    public Map<String, Object> addTest(RequestContext ctx, Map<String, Object> b) {
        return uow.run(ctx, d -> {
            int n = 0;
            for (Object s : list(b.get("sample_ids")))
                if (!tests.hasLineTest(s, b.get("line_id"))) { orderTest(s, b.get("line_id"), null); n++; }
            return Map.of("added", n);
        });
    }

    public List<Map<String, Object>> saveTests(RequestContext ctx, List<Map<String, Object>> rows) {
        boolean reason = !ctx.reason().isBlank();
        return uow.run(ctx, d -> {
            for (Map<String, Object> r : rows) {
                if (r.get("id") == null) continue;
                RequestedTest t = tests.find(r.get("id"));
                if (t == null) continue;
                Map<String, Object> changes = OrderRepository.TESTS.pick(r);
                boolean cancelling = "Cancelled".equals(changes.get("status")) && !"Cancelled".equals(t.status());
                t.checkChange(changes, reason, cancelling ? samples.cancelProblem(t.id()) : null);
            }
            return OrderRepository.TESTS.upsert(d, rows, Map.of());
        });
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

    public List<Map<String, Object>> analytes(RequestContext ctx, String testId) {
        if (!RequestContext.isUuid(testId)) throw new RuleException("Test not found");
        Map<String, Object> r = orders.testLab(testId);
        if (r == null) throw new RuleException("Test not found");
        access.checkSite(ctx, (String) r.get("site_id"));
        return orders.analytesOf(testId);
    }

    /** Takes quoted analytes off a test or puts them back; the test is repriced, and at least one stays. */
    public List<Map<String, Object>> saveAnalytes(RequestContext ctx, List<Map<String, Object>> rows) {
        boolean reason = !ctx.reason().isBlank();
        return uow.run(ctx, d -> {
            List<Object> repriced = new ArrayList<>();
            for (Map<String, Object> r : rows) {
                if (r.get("id") == null) continue;
                Map<String, Object> a = tests.analyte(r.get("id"));
                if (a == null) continue;
                if (new AnalyteTrim((String) a.get("test_status"), Boolean.TRUE.equals(a.get("started"))).checkChange(a, OrderRepository.ANALYTES.pick(r), reason)
                    && !repriced.contains(a.get("requested_test_id"))) repriced.add(a.get("requested_test_id"));
            }
            List<Map<String, Object>> out = OrderRepository.ANALYTES.upsert(d, rows, Map.of());
            for (Object t : repriced) {
                AnalyteTrim.assertOneLeft(tests.includedCount(t));
                tests.touch(t);
            }
            return out;
        });
    }

    private static List<Object> list(Object o) { return o instanceof List<?> l ? new ArrayList<>(l) : List.of(); }

    private static boolean blank(Object v) { return v == null || "".equals(v) || Boolean.FALSE.equals(v); }
}
