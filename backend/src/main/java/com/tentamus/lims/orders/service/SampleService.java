package com.tentamus.lims.orders.service;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.orders.domain.LabOrder;
import com.tentamus.lims.orders.domain.RequestedTest;
import com.tentamus.lims.orders.domain.Sample;
import com.tentamus.lims.orders.domain.SampleCode;
import com.tentamus.lims.orders.domain.SampleLists;
import com.tentamus.lims.orders.domain.ServingTestOrder;
import com.tentamus.lims.orders.domain.TatClock;
import com.tentamus.lims.orders.repo.OrderRepository;
import com.tentamus.lims.orders.repo.RequestedTestRepository;
import com.tentamus.lims.orders.repo.SampleRepository;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Samples on an order: saving them by grid (checked by {@link Sample}, which also says which serving test "Results per
 * serving" orders), logging (sample IDs, the clock of each test: {@link SampleCode}, {@link TatClock}, the order's status:
 * {@link LabOrder}), cancelling samples and tests, and asking the client for a serving test.
 */
@Service
public class SampleService {
    private final SampleRepository samples;
    private final RequestedTestRepository tests;
    private final OrderRepository orders;
    private final TestOrderingService ordering;
    private final AccessPolicy access;
    private final UnitOfWork uow;

    public SampleService(SampleRepository samples, RequestedTestRepository tests, OrderRepository orders, TestOrderingService ordering, AccessPolicy access, UnitOfWork uow) {
        this.samples = samples;
        this.tests = tests;
        this.orders = orders;
        this.ordering = ordering;
        this.access = access;
        this.uow = uow;
    }

    public List<Map<String, Object>> saveSamples(RequestContext ctx, String orderId, List<Map<String, Object>> rows) {
        boolean reason = !ctx.reason().isBlank();
        return uow.run(ctx, d -> {
            SampleLists lists = samples.lists();
            List<Map<String, Object>> out = new ArrayList<>();
            for (Map<String, Object> row : rows) {
                boolean isUpdate = row.get("id") != null;
                Map<String, Object> stored = isUpdate ? samples.find(row.get("id")) : null;
                Map<String, Object> vals = OrderRepository.SAMPLES.pick(row);
                if (isUpdate && vals.isEmpty()) continue;
                Sample s = Sample.of(stored);
                if (isUpdate && stored == null) { out.add(null); continue; }
                Map<String, Object> written = s.accept(vals, lists, reason);
                Map<String, Object> saved;
                if (isUpdate) saved = OrderRepository.SAMPLES.update(d, row.get("id").toString(), written);
                else {
                    written.put("lab_order_id", orderId);
                    saved = OrderRepository.SAMPLES.insert(d, written, "id");
                }
                out.add(saved);
                Object unit = written.containsKey("serving_unit") ? written.get("serving_unit") : s.get("serving_unit");
                String role = s.servingTestToOrder(written, samples.dimensionOf(unit));
                if (role != null) orderServingTest(saved.get("id"), role);
            }
            return out;
        });
    }

    /** Orders the serving test the per-serving results need (inside the caller's transaction). */
    private void orderServingTest(Object sample, String role) {
        ServingTestOrder o = tests.servingOrder(sample, role);
        switch (o.way()) {
            case ALREADY_ORDERED -> { }
            case FROM_QUOTE -> ordering.orderTest(sample, o.quotedLineId(), null);
            case AT_CATALOGUE_PRICE -> tests.insertServing(sample, o.labTestId());
        }
    }

    /** Asks the client for the serving test the per-serving results need (it waits for their consent). */
    public Map<String, Object> requestServingTest(RequestContext ctx, String sampleId, Map<String, Object> b) {
        if (!RequestContext.isUuid(sampleId)) throw new RuleException("Sample not found");
        Map<String, Object> s = orders.sampleLab(sampleId);
        if (s == null) throw new RuleException("Sample not found");
        access.checkSite(ctx, (String) s.get("site_id"));
        String role = "Density".equals(b.get("role")) ? "Density" : "Serving weight";
        String reason = blank(b.get("reason")) ? "Request for the " + role.toLowerCase() + " test" : b.get("reason").toString();
        // a split request is the bench's record (testing): its function stays in the database
        return uow.run(ctx, reason, d -> d.one("SELECT request_serving_test(?::uuid, ?, ?) AS id", sampleId, role, blank(b.get("note")) ? null : b.get("note")));
    }

    /** Logs samples: each gets its ID, its tests' clocks start, and the order is submitted, then received once none is expected. */
    public Map<String, Object> log(RequestContext ctx, Map<String, Object> b) {
        return uow.run(ctx, d -> {
            int n = 0;
            for (Map<String, Object> row : samples.toLog(b.get("sample_ids"))) {
                Sample s = Sample.of(row);
                s.assertHasTests(((Number) row.get("active_tests")).intValue());
                Map<String, Object> lab = samples.lab(row.get("lab_order_id"));
                Sample.assertLoggable(Boolean.TRUE.equals(lab.get("custody_signature_required")));
                TatClock clock = samples.clock(lab.get("id"), (String) lab.get("time_zone"));
                String now = samples.now();
                SampleCode code = SampleCode.of((String) lab.get("site_code"), clock.labDate(TatClock.instant(now)),
                    samples.nextDayNumber(lab.get("id"), clock.labDate(TatClock.instant(now))));
                samples.markLogged(row.get("id"), now, code.value(), ctx.userId());
                for (Map<String, Object> t : samples.clockInputs(row.get("id"))) startClock(clock, t, now);
                Map<String, Object> o = samples.orderStatus(row.get("lab_order_id"));
                String status = (String) o.get("status");
                if ("Draft".equals(status)) samples.setOrderStatus(row.get("lab_order_id"), "Submitted");
                String next = LabOrder.statusAfterLogging(status, Boolean.TRUE.equals(o.get("any_expected")));
                if (!next.equals(status) && !"Submitted".equals(next)) samples.setOrderStatus(row.get("lab_order_id"), next);
                orders.stampSubmitted(row.get("lab_order_id"));
                n++;
            }
            return Map.of("logged", n);
        });
    }

    private void startClock(TatClock clock, Map<String, Object> t, String loggedAt) {
        String start = TatClock.clockStart(loggedAt, (String) t.get("created_text"));
        String unit = (String) t.get("tat_unit");
        String day0 = null, due = null;
        if (unit != null) {
            Object cut = t.get("cutoff_time");
            var d0 = clock.day0(TatClock.instant(start), cut == null ? null : LocalTime.parse(cut.toString()), unit);
            day0 = d0.toString();
            if (t.get("tat_days") != null) due = clock.due(d0, ((Number) t.get("tat_days")).intValue(), unit).toString();
        }
        samples.startClock(t.get("id"), start, RequestedTest.statusWhenClockStarts((String) t.get("status")), day0, due, loggedAt);
    }

    /** Cancels samples (and their tests) and tests, always with a reason; nothing is deleted. */
    public Map<String, Object> cancel(RequestContext ctx, String orderId, Map<String, Object> b) {
        if (!RequestContext.isUuid(orderId)) throw new RuleException("Order not found");
        Map<String, Object> o = orders.orderLab(orderId);
        if (o == null) throw new RuleException("Order not found");
        access.checkSite(ctx, (String) o.get("site_id"));
        List<Object> sampleIds = list(b.get("sample_ids")).stream().filter(RequestContext::isUuid).toList();
        List<Object> testIds = list(b.get("test_ids")).stream().filter(RequestContext::isUuid).toList();
        if (sampleIds.isEmpty() && testIds.isEmpty()) throw new RuleException("Choose the samples or tests to cancel");
        if (blank(b.get("reason")) || b.get("reason").toString().trim().isEmpty()) throw new RuleException("Say why they are cancelled");
        return uow.run(ctx, b.get("reason").toString(), d -> {
            int s = 0, n = 0;
            for (Object id : sampleIds) {
                Map<String, Object> stored = samples.find(id);
                if (stored == null || !orderId.equals(stored.get("lab_order_id")) || "Cancelled".equals(stored.get("status"))) continue;
                Sample.of(stored).assertCancellable(samples.cancelProblems(id));
                d.update("UPDATE sample SET status = 'Cancelled' WHERE id = ?::uuid", id);
                d.update("UPDATE requested_test SET status = 'Cancelled' WHERE sample_id = ?::uuid AND status <> 'Cancelled'", id);
                s++;
            }
            for (Object id : testIds) {
                RequestedTest t = tests.find(id);
                if (t == null || "Cancelled".equals(t.status())) continue;
                t.checkChange(Map.of("status", "Cancelled"), true, samples.cancelProblem(id));
                n += d.rows("""
                    UPDATE requested_test SET status = 'Cancelled' WHERE id = ?::uuid AND status <> 'Cancelled'
                       AND sample_id IN (SELECT id FROM sample WHERE lab_order_id = ?::uuid) RETURNING id""", id, orderId).size();
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("samples", s);
            out.put("tests", n);
            return out;
        });
    }

    private static List<Object> list(Object o) { return o instanceof List<?> l ? new ArrayList<>(l) : List.of(); }

    private static boolean blank(Object v) { return v == null || "".equals(v) || Boolean.FALSE.equals(v); }
}
