package com.tentamus.lims.pricing.service;

import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.pricing.domain.CatalogueEntry;
import com.tentamus.lims.pricing.domain.PriceAdjustment;
import com.tentamus.lims.pricing.domain.RushFeeSchedule;
import com.tentamus.lims.pricing.repo.CatalogueRepository;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * The test catalogue and rush fee schedules: reading them, saving a test's pricing page, and repricing by a percentage.
 * The pricing rules (no negative prices or TAT, no preparation fee on Base Price Only, named schedules and tiers) are
 * checked by {@link CatalogueEntry} and {@link RushFeeSchedule} before anything is written.
 */
@Service
public class CatalogueService {
    private final CatalogueRepository repo;
    private final UnitOfWork uow;

    public CatalogueService(CatalogueRepository repo, UnitOfWork uow) {
        this.repo = repo;
        this.uow = uow;
    }

    public List<Map<String, Object>> rushSchedules() { return repo.rushSchedules(); }

    public List<Map<String, Object>> saveSchedules(RequestContext ctx, List<Map<String, Object>> rows) {
        for (Map<String, Object> r : rows) RushFeeSchedule.checkSchedule(CatalogueRepository.SCHEDULES.pick(r), r.get("id") == null);
        return uow.run(ctx, d -> CatalogueRepository.SCHEDULES.upsert(d, rows, Map.of()));
    }

    public List<Map<String, Object>> saveTiers(RequestContext ctx, String scheduleId, List<Map<String, Object>> rows) {
        for (Map<String, Object> r : rows) RushFeeSchedule.checkTier(CatalogueRepository.TIERS.pick(r), r.get("id") == null);
        return uow.run(ctx, d -> CatalogueRepository.TIERS.upsert(d, rows, Map.of("schedule_id", scheduleId)));
    }

    public List<Map<String, Object>> catalogue() { return repo.catalogue(); }

    public List<Map<String, Object>> csvRows(boolean publicOnly) { return repo.activeForCsv(publicOnly); }

    /** One test's catalogue page: the test, its entry, list price, analyte prices, rush tiers, versions, service line types. */
    public Map<String, Object> page(String testId) {
        Map<String, Object> test = repo.test(testId);
        Map<String, Object> entry = repo.entry(testId);
        if (test == null || entry == null) throw new RuleException("Test not found");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("test", test);
        out.put("entry", entry);
        out.put("list_price", repo.entryOf(testId).listPrice());
        out.put("analytes", repo.analytePrices(entry.get("id")));
        out.put("tiers", repo.rushTiers(entry.get("id"), entry.get("rush_schedule_id")));
        out.put("versions", repo.versions(testId));
        out.put("service_line_types", repo.serviceLineTypes(test.get("service_line_type_id")));
        return out;
    }

    /** Saves the pricing page: the test, its entry, analyte prices and per-test rush approval overrides, in one transaction. */
    @SuppressWarnings("unchecked")
    public Map<String, Object> save(RequestContext ctx, String testId, Map<String, Object> body) {
        Map<String, Object> test = new LinkedHashMap<>(map(body.get("test")));
        Map<String, Object> entry = new LinkedHashMap<>(map(body.get("entry")));
        List<Map<String, Object>> analytes = list(body.get("analytes"));
        List<Map<String, Object>> approvals = list(body.get("approvals"));
        uow.run(ctx, d -> {
            test.put("id", testId);
            CatalogueRepository.TESTS.upsert(d, List.of(test), Map.of());
            Map<String, Object> e = repo.entry(testId);
            if (e == null) throw new RuleException("Test not found");
            Map<String, Object> merged = new LinkedHashMap<>(e);
            merged.putAll(CatalogueRepository.ENTRIES.pick(entry));
            CatalogueEntry.check(merged);
            for (Map<String, Object> a : analytes) CatalogueEntry.checkAnalytePrice(CatalogueRepository.ANALYTE_PRICES.pick(a).get("price"));
            entry.put("id", e.get("id"));
            CatalogueRepository.ENTRIES.upsert(d, List.of(entry), Map.of());
            CatalogueRepository.ANALYTE_PRICES.upsert(d, analytes, Map.of("catalog_entry_id", e.get("id")));
            for (Map<String, Object> a : approvals) {
                Object o = a.get("override");
                if (o == null || "".equals(o)) continue;
                repo.setRushApproval(d, e.get("id"), a.get("tier_id"), o);
            }
            return null;
        });
        return Map.of("ok", true);
    }

    /** Changes the price of the selected tests (or all) by a percentage; returns how many changed. */
    public Map<String, Object> reprice(RequestContext ctx, Map<String, Object> body) {
        double pct;
        try { pct = Double.parseDouble(String.valueOf(body.get("pct")).trim()); } catch (NumberFormatException e) { pct = Double.NaN; }
        if (!Double.isFinite(pct) || pct == 0) throw new RuleException("Give the percentage to change the prices by (e.g. 3 or -5)");
        List<String> tests = null;
        if (body.get("tests") instanceof List<?> l) {
            tests = new ArrayList<>();
            for (Object t : l) if (RequestContext.isUuid(t)) tests.add(t.toString());
            if (tests.isEmpty()) throw new RuleException("Select the tests to update, or choose all tests");
        }
        PriceAdjustment adjustment = PriceAdjustment.of(new BigDecimal(Js.number(pct)), "Cent");
        if (ctx.reason().isBlank()) throw RuleException.database("A Reason for Change is required to update catalogue prices");
        final List<String> ids = tests;
        return uow.run(ctx, d -> Map.of("n", repo.reprice(d, ids, null, adjustment)));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object o) { return o instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of(); }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> list(Object o) { return o instanceof List<?> l ? (List<Map<String, Object>>) l : List.of(); }
}
