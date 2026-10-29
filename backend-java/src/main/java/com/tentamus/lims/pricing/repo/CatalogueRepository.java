package com.tentamus.lims.pricing.repo;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.RecordWriter;
import com.tentamus.lims.pricing.domain.Amount;
import com.tentamus.lims.pricing.domain.CatalogueEntry;
import com.tentamus.lims.pricing.domain.PriceAdjustment;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Repository;

/** The test catalogue (Workflow Designer step 1: pricing, TAT, rush schedule) and the rush fee schedules. */
@Repository
public class CatalogueRepository {
    public static final RecordWriter TESTS = new RecordWriter("test", List.of("test_name", "status", "serving_role", "service_line_type_id"));
    public static final RecordWriter ENTRIES = new RecordWriter("test_catalog_entry", List.of("description", "pricing_mode", "base_price", "prep_fee",
        "standard_tat", "tat_unit", "cutoff_time", "rush_schedule_id", "show_in_public_catalogue"));
    public static final RecordWriter ANALYTE_PRICES = new RecordWriter("test_analyte_price", List.of("analyte_id", "price", "status"));
    public static final RecordWriter SCHEDULES = new RecordWriter("rush_fee_schedule", List.of("schedule_name", "description", "status"));
    public static final RecordWriter TIERS = new RecordWriter("rush_fee_tier", List.of("tier_name", "rush_tat", "tat_unit", "surcharge_type", "surcharge_value",
        "requires_approval", "escalation_hours", "sort_order", "status"));
    private final Db db;

    public CatalogueRepository(Db db) { this.db = db; }

    /** Every rush fee schedule with its tiers. */
    public List<Map<String, Object>> rushSchedules() {
        List<Map<String, Object>> schedules = db.rows("""
            SELECT s.*, (SELECT count(*) FROM test_catalog_entry e WHERE e.rush_schedule_id = s.id) AS test_count
              FROM rush_fee_schedule s ORDER BY schedule_name""");
        List<Map<String, Object>> tiers = db.rows("SELECT * FROM rush_fee_tier ORDER BY sort_order, tier_name");
        for (Map<String, Object> s : schedules) {
            List<Map<String, Object>> mine = new ArrayList<>();
            for (Map<String, Object> t : tiers) if (s.get("id").equals(t.get("schedule_id"))) mine.add(t);
            s.put("tiers", mine);
        }
        return schedules;
    }

    public List<Map<String, Object>> catalogue() { return db.rows("SELECT * FROM test_catalogue ORDER BY test_name"); }

    public List<Map<String, Object>> activeForCsv(boolean publicOnly) {
        return db.rows("SELECT test_code, test_name, description, pricing_mode, base_price, prep_fee, list_price, analyte_count, standard_tat, tat_unit, rush_schedule"
            + " FROM test_catalogue WHERE test_status = 'Active'" + (publicOnly ? " AND show_in_public_catalogue" : "") + " ORDER BY test_name");
    }

    public Map<String, Object> test(String testId) { return db.one("SELECT * FROM test WHERE id = ?", testId); }

    public Map<String, Object> entry(String testId) { return db.one("SELECT * FROM test_catalog_entry WHERE test_id = ?", testId); }

    /** A test's catalogue entry with its active analyte prices (keyed by analyte id), or null when it has none. */
    public CatalogueEntry entryOf(Db d, Object testId) {
        Map<String, Object> e = d.one("SELECT id, pricing_mode::text AS pricing_mode, base_price, prep_fee FROM test_catalog_entry WHERE test_id = ?::uuid", testId);
        if (e == null) return null;
        Map<String, BigDecimal> prices = new LinkedHashMap<>();
        for (Map<String, Object> a : d.rows("SELECT analyte_id, price FROM test_analyte_price WHERE catalog_entry_id = ?::uuid AND status = 'Active'", e.get("id")))
            prices.put((String) a.get("analyte_id"), Amount.of(a.get("price")));
        return new CatalogueEntry((String) e.get("pricing_mode"), Amount.of(e.get("base_price")), Amount.of(e.get("prep_fee")), prices);
    }

    public CatalogueEntry entryOf(Object testId) { return entryOf(db, testId); }

    /**
     * Moves the prices of active tests by a percentage: each test's base price and preparation fee, and its analyte
     * prices. Returns how many tests were repriced.
     *
     * @param tests  the tests, or null for every active test
     * @param siteId only that lab's tests, or null for every lab
     */
    public int reprice(Db d, List<String> tests, String siteId, PriceAdjustment a) {
        List<Map<String, Object>> entries = d.rows("""
            SELECT e.id, e.base_price, e.prep_fee FROM test_catalog_entry e JOIN test t ON t.id = e.test_id
             WHERE t.status = 'Active' AND (?::uuid IS NULL OR t.site_id = ?::uuid) AND (?::uuid[] IS NULL OR e.test_id = ANY (?::uuid[]))""",
            siteId, siteId, tests, tests);
        for (Map<String, Object> e : entries) {
            d.update("UPDATE test_catalog_entry SET base_price = ?, prep_fee = ? WHERE id = ?::uuid",
                a.apply(Amount.of(e.get("base_price"))), a.apply(Amount.of(e.get("prep_fee"))), e.get("id"));
            for (Map<String, Object> ap : d.rows("SELECT id, price FROM test_analyte_price WHERE catalog_entry_id = ?::uuid AND status = 'Active'", e.get("id")))
                d.update("UPDATE test_analyte_price SET price = ? WHERE id = ?::uuid", a.apply(Amount.of(ap.get("price"))), ap.get("id"));
        }
        return entries.size();
    }

    public List<Map<String, Object>> analytePrices(Object entryId) {
        return db.rows("""
            SELECT ap.*, a.analyte_code, a.analyte_name, a.analyte_class FROM test_analyte_price ap
              JOIN analyte a ON a.id = ap.analyte_id WHERE ap.catalog_entry_id = ? ORDER BY a.analyte_name""", entryId);
    }

    /** The rush tiers of the test's schedule, with the schedule's approval default, the test's override and the result. */
    public List<Map<String, Object>> rushTiers(Object entryId, Object scheduleId) {
        if (scheduleId == null) return List.of();
        return db.rows("""
            SELECT rt.*, rt.requires_approval AS schedule_default,
              (SELECT o.requires_approval FROM test_rush_approval o WHERE o.catalog_entry_id = ?::uuid AND o.tier_id = rt.id) AS override,
              (SELECT o.id FROM test_rush_approval o WHERE o.catalog_entry_id = ?::uuid AND o.tier_id = rt.id) AS override_id,
              rush_requires_approval(?::uuid, rt.id) AS effective FROM rush_fee_tier rt WHERE rt.schedule_id = ?::uuid AND rt.status = 'Active'
              ORDER BY sort_order""", entryId, entryId, entryId, scheduleId);
    }

    public List<Map<String, Object>> versions(String testId) {
        return db.rows("SELECT version_no, status, effective_from FROM test_version WHERE test_id = ? ORDER BY version_no", testId);
    }

    /** The service line types a test can be listed under (its current one even when retired). */
    public List<Map<String, Object>> serviceLineTypes(Object current) {
        return db.rows("""
            SELECT t.id, sl.line_name || ' > ' || t.type_name AS label FROM service_line_type t JOIN service_line sl ON sl.id = t.service_line_id
             WHERE (t.status = 'Active' AND sl.status = 'Active') OR t.id = ?::uuid ORDER BY sl.sort_order, sl.line_name, t.sort_order, t.type_name""", current);
    }

    public void setRushApproval(Db d, Object entryId, Object tierId, Object requiresApproval) {
        d.update("""
            INSERT INTO test_rush_approval (catalog_entry_id, tier_id, requires_approval) VALUES (?::uuid, ?::uuid, ?::boolean)
              ON CONFLICT (catalog_entry_id, tier_id) DO UPDATE SET requires_approval = EXCLUDED.requires_approval""", entryId, tierId, requiresApproval);
    }
}
