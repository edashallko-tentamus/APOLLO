package com.tentamus.lims.inventory.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The inventory rules moved out of the database in migration 062 (checked before by test_005 and test_035), and Java's
 * own copies of the lot, movement, unit and mixture rules the database keeps for other writers.
 */
class InventoryRulesTest {
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 28);
    private static final Units UNITS = new Units(
        List.of(new Units.Unit("g", "g", "Mass", true), new Units.Unit("kg", "kg", "Mass", true), new Units.Unit("mg", "mg", "Mass", true),
            new Units.Unit("L", "L", "Volume", true), new Units.Unit("mL", "mL", "Volume", true), new Units.Unit("each", "each", "Count", true),
            new Units.Unit("mg/L", "mg/L", "Mass/Volume", true), new Units.Unit("µg/mL", "µg/mL", "Mass/Volume", true),
            new Units.Unit("mg/kg", "mg/kg", "Mass/Mass", true), new Units.Unit("ppm", "ppm", "Parts per", true), new Units.Unit("M", "M", "Amount/Volume", true),
            new Units.Unit("mM", "mM", "Amount/Volume", true), new Units.Unit("N", "N", "Amount/Volume", true)),
        List.of(new Units.Conversion("kg", "g", new BigDecimal("1000"), "Any", true), new Units.Conversion("mg", "g", new BigDecimal("0.001"), "Any", true),
            new Units.Conversion("L", "mL", new BigDecimal("1000"), "Any", true), new Units.Conversion("µg/mL", "mg/L", BigDecimal.ONE, "Any", true),
            new Units.Conversion("ppm", "mg/L", BigDecimal.ONE, "Liquid", true), new Units.Conversion("ppm", "mg/kg", BigDecimal.ONE, "Solid", true),
            new Units.Conversion("M", "mM", new BigDecimal("1000"), "Any", true)));

    private static String refusal(Runnable r) {
        try { r.run(); } catch (RuleException e) { return e.getMessage(); }
        return null;
    }

    private static Map<String, Object> m(Object... kv) {
        Map<String, Object> out = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) out.put((String) kv[i], kv[i + 1]);
        return out;
    }

    private static Lot.Context ctx(StorageLocation loc) { return new Lot.Context(UNITS, loc, null, TODAY, null, false, null); }

    private static Lot reagent(Object... more) {
        Map<String, Object> v = m("id", "L1", "lot_code", "INV-000001", "site_id", "CFL", "item_name", "Methanol", "chemical_types", "{Reagent}",
            "receipt_status", "Received", "status", "Available", "quantity_received", "4", "unit", "L", "manufacturer_lot", "M-1", "expiration_date", "2027-01-01");
        for (int i = 0; i < more.length; i += 2) v.put((String) more[i], more[i + 1]);
        return Lot.of(v);
    }

    // ------------------------------------------------------------ storage locations (moved: storage_location_rules)
    @Test
    void storageLocations() {
        StorageLocation lab = new StorageLocation("LAB", "CFL", "LAB-1", "Lab 1", null, List.of(), false, "Active");
        StorageLocation fridge = new StorageLocation("FR", "CFL", "FR-1", "Fridge 1", "LAB", List.of("Refrigerated (2-8 °C)"), false, "Active");
        StorageLocation tps = new StorageLocation("TPS", "TPS", "TPS-1", "TPS lab", null, List.of(), false, "Active");
        assertEquals("LAB-1", StorageLocation.checked(null, m("site_id", "CFL", "location_code", " lab-1 ", "location_name", "Lab 1"),
            m("location_code", " lab-1 "), null, List.of()).get("location_code"));                                  // codes stored in capitals
        assertEquals("A storage location cannot be inside itself", refusal(() -> StorageLocation.checked(lab,
            m("site_id", "CFL", "location_code", "LAB-1", "location_name", "Lab 1", "parent_location_id", "FR"), m("parent_location_id", "FR"), fridge, List.of("FR", "LAB"))));
        assertEquals("A storage location must be inside a location in the same lab", refusal(() -> StorageLocation.checked(fridge,
            m("site_id", "CFL", "location_code", "FR-1", "location_name", "Fridge 1", "parent_location_id", "TPS"), m("parent_location_id", "TPS"), tps, List.of("TPS"))));
        assertEquals("A storage location cannot move to another lab", refusal(() -> StorageLocation.checked(fridge,
            m("site_id", "TPS", "location_code", "FR-1", "location_name", "Fridge 1"), m("site_id", "TPS"), null, List.of())));
        assertEquals("Give the location a code.", refusal(() -> StorageLocation.checked(null, m("site_id", "CFL", "location_code", " ", "location_name", "X"), m(), null, List.of())));
        assertTrue(refusal(() -> fridge.assertAccepts("CFL", "Flammables cabinet", "Lot INV-000001")).startsWith("Lot INV-000001 needs \"Flammables cabinet\" but Fridge 1 (FR-1) provides only"));
        assertEquals("Storage location FR-1 is in another lab", refusal(() -> fridge.assertAccepts("TPS", null, "x")));
        assertEquals("That storage location is not set up to hold samples", refusal(fridge::assertHoldsSamples));
    }

    // ------------------------------------------------------------ warning rules (moved: threshold_rule checks)
    @Test
    void warningRules() {
        assertTrue(refusal(() -> ThresholdRule.check(m("rule_name", "Bad", "subject", "Lot Expiry", "rule_type", "Percentage of Base", "value", 10)))
            .startsWith("That rule type does not fit what it watches"));
        assertEquals("Only stock (Lot Quantity) rules can be limited to one chemical.", refusal(() -> ThresholdRule.check(
            m("rule_name", "R", "subject", "Sample Retain", "rule_type", "Absolute Max-Min", "value", 1, "chemical_id", "C"))));
        assertEquals("A percentage cannot be more than 100.", refusal(() -> ThresholdRule.check(m("rule_name", "R", "subject", "Lot Quantity", "rule_type", "Percentage of Base", "value", 120))));
        assertNull(refusal(() -> ThresholdRule.check(m("rule_name", "Low stock 20%", "subject", "Lot Quantity", "rule_type", "Percentage of Base", "value", 20))));
        ThresholdRule low = ThresholdRule.of(m("subject", "Lot Quantity", "rule_type", "Percentage of Base", "value", 20));
        assertTrue(low.isBelow(new BigDecimal("0.5"), new BigDecimal("4")));
        assertFalse(low.isBelow(new BigDecimal("1"), new BigDecimal("4")));
        assertTrue(low.appliesTo("Lot Quantity", "CFL", null));
    }

    // ------------------------------------------------------------ Supplier COA (moved: supplier_coa_rules)
    @Test
    void supplierCoa() {
        Map<String, Object> stored = m("document_id", "D1", "sha256", "abc", "ai_proposed", "{\"manufacturer_lot\": \"PB-1\"}");
        Map<String, Object> changed = new HashMap<>(stored);
        changed.put("ai_proposed", "{}");
        assertEquals("The document and the AI proposal on a COA record cannot be changed; upload the COA again", refusal(() -> SupplierCoa.assertUnchanged(stored, changed)));
        assertNull(refusal(() -> SupplierCoa.assertUnchanged(stored, new HashMap<>(stored))));
        assertTrue(SupplierCoa.confirmationNeedsStamp(null, "{\"manufacturer_lot\": \"PB-1\"}"));   // confirmation records who and when
        assertFalse(SupplierCoa.confirmationNeedsStamp("x", "x"));
        assertFalse(SupplierCoa.confirmationNeedsStamp("x", null));
    }

    // ------------------------------------------------------------ QA testing (moved: lot_component_qa_rule, waive_lot_qa_testing, qa_testing_default_rules)
    @Test
    void qaTesting() {
        LotQaTesting waiting = new LotQaTesting(true, List.of());
        assertEquals("Awaiting QA testing", waiting.status());
        assertTrue(refusal(() -> waiting.assertMixtureComponent("INV-1", "NaCl")).matches("Lot INV-1 \\(NaCl\\) cannot go into a mixture: .*waiting for QA testing.*"));
        LotQaTesting named = new LotQaTesting(true, List.of(new LotQaTesting.Qualification("Passed", "T1", "WD Micro Screen", "2026-10-01 10:00:00")));
        assertEquals("Released for named tests", named.status());
        assertTrue(refusal(() -> named.assertMixtureComponent("INV-2", "TSA")).endsWith("released only for WD Micro Screen, not for every use"));
        assertNull(named.problem("T1", false));
        LotQaTesting every = new LotQaTesting(true, List.of(new LotQaTesting.Qualification("Passed", null, null, "2026-10-01 10:00:00")));
        assertEquals("Released for every use", every.status());
        assertNull(refusal(() -> every.assertMixtureComponent("INV-3", "x")));
        LotQaTesting rejected = new LotQaTesting(true, List.of(new LotQaTesting.Qualification("Failed", null, null, "2026-10-01 10:00:00"),
            new LotQaTesting.Qualification("Testing", null, null, "2026-10-02 10:00:00")));
        assertEquals("Rejected, retest under way", rejected.status());
        assertTrue(rejected.problem("T1", false).contains("rejected in QA testing"));
        assertNull(rejected.problem("T1", true));                                      // in its own QA batch
        LotQaTesting retestPassed = new LotQaTesting(true, List.of(new LotQaTesting.Qualification("Failed", null, null, "2026-10-01 10:00:00"),
            new LotQaTesting.Qualification("Passed", null, null, "2026-10-03 10:00:00")));
        assertEquals("Released for every use", retestPassed.status());
        assertNull(new LotQaTesting(false, List.of()).status());

        assertEquals("A reason is required to waive QA testing", refusal(() -> waiting.assertWaivable("INV-1", " ")));
        assertNull(refusal(() -> waiting.assertWaivable("INV-1", "COA reviewed")));
        assertEquals("Lot INV-1 does not need QA testing", refusal(() -> new LotQaTesting(false, List.of()).assertWaivable("INV-1", "r")));
        assertTrue(refusal(() -> rejected.assertWaivable("INV-1", "r")).contains("its result decides"));

        assertEquals("This lab tests Reagent before use: only QA can receive it without QA testing (inventory.qa_configure)",
            refusal(() -> LotQaTesting.requiredAtReceipt("0", List.of("Reagent"), false)));
        assertFalse(LotQaTesting.requiredAtReceipt("0", List.of("Reagent"), true));
        assertTrue(LotQaTesting.requiredAtReceipt("", List.of("Media"), false));
        assertTrue(LotQaTesting.requiredAtReceipt("1", List.of(), false));

        assertEquals("A lab's QA testing default keeps its lab and item type", refusal(() -> QaTestingDefault.checked(
            m("site_id", "CFL", "chemical_type", "Reagent"), m("chemical_type", "Solvent"))));
        assertNull(QaTestingDefault.checked(m("site_id", "CFL", "chemical_type", "Reagent"), m("note", "  ")).get("note"));
    }

    // ------------------------------------------------------------ dispose (moved: dispose_lot)
    @Test
    void dispose() {
        Lot old = reagent();
        assertEquals("A reason is required to dispose of a lot", refusal(() -> old.dispose(new BigDecimal("2"), "")));
        StockMovement off = old.dispose(new BigDecimal("2"), "Expired");
        assertEquals("Disposal", off.type());
        assertEquals(0, off.quantity().compareTo(new BigDecimal("-2")));               // the remainder is written off
        assertEquals("Adjustment", old.dispose(new BigDecimal("-1"), "Expired").type());   // a negative remainder is put back
        assertNull(old.dispose(BigDecimal.ZERO, "Expired"));
        Lot disposed = old.with(m("status", "Disposed"));
        assertEquals("Use Dispose to dispose of a lot, so the remaining quantity is written off", refusal(() -> disposed.checkSave(old, m("status", "Disposed"), ctx(null))));
        assertNull(refusal(() -> disposed.checkSave(old, m("status", "Disposed"), new Lot.Context(UNITS, null, null, TODAY, null, true, null))));
        assertEquals("A disposed lot cannot be reopened", refusal(() -> disposed.with(m("status", "Available")).checkSave(disposed, m("status", "Available"), ctx(null))));
    }

    // ------------------------------------------------------------ Java's own copy of the lot rules (inventory_lot_rules, kept)
    @Test
    void lotRules() {
        assertTrue(refusal(() -> Lot.of(m("site_id", "CFL", "chemical_types", "{Reagent}", "receipt_status", "Requested")).checkSave(null, m(), ctx(null)))
            .startsWith("Enter the item name"));
        assertEquals("Enter the manufacturer's lot number", refusal(() -> reagent("manufacturer_lot", null).checkSave(null, m(), ctx(null))));
        assertTrue(refusal(() -> reagent("unit", "gallonz").checkSave(null, m(), ctx(null))).startsWith("Unit \"gallonz\" is not on the Units list"));
        assertEquals("Purity and concentration do not apply to consumables", refusal(() ->
            reagent("chemical_types", "{Consumable}", "purity_pct", "99", "unit", "each").checkSave(null, m(), ctx(null))));
        Map<String, Object> out = reagent("unit", "ml", "physical_form", null).checkSave(null, m(), ctx(null));
        assertEquals("mL", out.get("unit"));                                          // the Units list's spelling
        assertEquals("Liquid", out.get("physical_form"));                             // Solid or Liquid from the unit
        StorageLocation fridge = new StorageLocation("FR", "CFL", "FR-1", "Fridge 1", null, List.of("Refrigerated (2-8 °C)"), false, "Active");
        assertTrue(refusal(() -> reagent("storage_condition", "Flammables cabinet", "storage_location_id", "FR").checkSave(null, m(), ctx(fridge)))
            .contains("needs \"Flammables cabinet\""));

        Lot requested = reagent("receipt_status", "Requested", "manufacturer_lot", null, "quantity_received", null);
        assertEquals("A lot cannot go from Requested to Ordered", refusal(() -> requested.with(m("receipt_status", "Ordered")).checkSave(requested, m("receipt_status", "Ordered"), ctx(null))));
        assertEquals("A new purchase starts as Requested and is approved by a Lab Supervisor", refusal(() -> reagent("receipt_status", "Approved").checkSave(null, m(), ctx(null))));
        Lot received = reagent();
        assertEquals("A received lot cannot go back to Ordered", refusal(() -> received.with(m("receipt_status", "Ordered")).checkSave(received, m("receipt_status", "Ordered"), ctx(null))));
        assertEquals("The quantity received and its unit cannot be changed after receipt; record an Adjustment instead",
            refusal(() -> received.with(m("quantity_received", "5")).checkSave(received, m("quantity_received", "5"), ctx(null))));
        assertEquals("A lot cannot move to another lab; use Transfer, which logs it as a new lot at the receiving lab",
            refusal(() -> received.with(m("site_id", "TPS")).checkSave(received, m("site_id", "TPS"), ctx(null))));
        assertEquals("A received lot cannot be cancelled; dispose of it instead", refusal(() -> received.with(m("status", "Cancelled")).checkSave(received, m("status", "Cancelled"), ctx(null))));

        Lot mix = reagent("chemical_types", "{In-house mixture}", "manufacturer_lot", null, "expiration_date", "2026-12-31");
        assertEquals("This mixture must expire on or before 2026-11-30 (its earliest-expiring component)", refusal(() ->
            mix.checkSave(mix, m(), new Lot.Context(UNITS, null, null, TODAY, LocalDate.of(2026, 11, 30), false, null))));
        assertTrue(refusal(() -> reagent("chemical_types", "{Reference Standard}").assertHasAnalyte(0)).endsWith("must be linked to at least one analyte"));
    }

    @Test
    void lotActions() {
        Lot requested = reagent("receipt_status", "Requested");
        assertEquals("Only an Ordered purchase or an In Transit transfer can be received (this lot is Requested)",
            refusal(() -> requested.receive(null, null, null, null, null, null, null, TODAY)));
        Map<String, Object> got = reagent("receipt_status", "Ordered").receive(new BigDecimal("4"), null, " PB-1 ", null, null, null, null, TODAY);
        assertEquals("Received", got.get("receipt_status"));
        assertEquals("PB-1", got.get("manufacturer_lot"));
        assertEquals("2026-10-28", got.get("received_date"));
        Lot pb = reagent();
        assertEquals("A transfer must go to a different lab", refusal(() -> pb.transferTo("CFL", BigDecimal.TEN, null)));
        assertEquals("Enter the quantity to transfer", refusal(() -> pb.transferTo("TPS", BigDecimal.ZERO, null)));
        Map<String, Object> sent = pb.transferTo("TPS", BigDecimal.TEN, "For TPS");
        assertEquals("In Transit", sent.get("receipt_status"));
        assertEquals("M-1", sent.get("manufacturer_lot"));
        assertEquals("L1", sent.get("transferred_from_lot_id"));
        assertEquals("A transfer must go to a different lab", refusal(() -> Lot.of(sent).checkSave(null, m(), new Lot.Context(UNITS, null, "TPS", TODAY, null, false, null))));
        assertEquals("Requested", pb.reorder(null, null).get("receipt_status"));
        assertEquals("An in-house mixture is prepared, not ordered; reorder its components",
            refusal(() -> reagent("chemical_types", "{In-house mixture}").reorder(null, null)));
    }

    // ------------------------------------------------------------ stock movements (inventory_txn_rules, kept) and use eligibility
    @Test
    void movementsAndUse() {
        Lot old = reagent("expiration_date", "2026-01-01");
        assertEquals("Lot INV-000001 expired on 2026-01-01 and cannot be used", refusal(() -> StockMovement.record(old, "Usage", new BigDecimal("0.1"), null, null, null, TODAY)));
        assertEquals("Expired", old.notUsableBecause(TODAY));
        assertEquals("An adjustment needs a reason (for example a stock count)", refusal(() -> StockMovement.record(reagent(), "Adjustment", new BigDecimal("-0.1"), null, null, "", TODAY)));
        Lot pending = reagent("receipt_status", "Requested");
        assertEquals("Lot INV-000001 has not been received yet", refusal(() -> StockMovement.record(pending, "Usage", BigDecimal.ONE, null, null, null, TODAY)));
        assertEquals("Not received yet (Requested)", pending.notUsableBecause(TODAY));
        assertEquals(0, StockMovement.record(reagent(), "Usage", new BigDecimal("0.5"), "HPLC", null, null, TODAY).quantity().compareTo(new BigDecimal("-0.5")));
        assertEquals("Enter a quantity other than zero.", refusal(() -> StockMovement.record(reagent(), "Usage", BigDecimal.ZERO, null, null, null, TODAY)));
        assertNull(reagent().notUsableBecause(TODAY));
    }

    // ------------------------------------------------------------ units and mixtures (unit_factor, mixture_* kept)
    @Test
    void unitsAndMixtures() {
        assertEquals(0, UNITS.factor("kg", "mg", null).compareTo(new BigDecimal("1000000")));   // chained, both directions
        assertEquals(0, UNITS.factor("ppm", "mg/L", "Liquid").compareTo(BigDecimal.ONE));
        assertNull(UNITS.factor("ppm", "mg/L", "Solid"));                                   // ppm = mg/L only for liquids
        assertNull(UNITS.factor("g", "mL", null));
        assertEquals("mL", UNITS.canonical(" ML ", Units.QUANTITY, "Unit"));

        Mixture.Component pb = new Mixture.Component("PB", "INV-000002", "mL", "Liquid", LocalDate.of(2027, 1, 1),
            List.of(new Mixture.AnalyteLine("A-PB", "Lead", null, new BigDecimal("1000"), "µg/mL", "Mass/Volume", null, null, null)));
        Mixture.Component cd = new Mixture.Component("CD", "INV-000003", "L", "Liquid", LocalDate.of(2026, 11, 15),
            List.of(new Mixture.AnalyteLine("A-CD", "Cadmium", null, null, "µg/mL", "Mass/Volume", null, null, null)));
        Mixture mix = Mixture.of(List.of(m("lot_id", "PB", "quantity", 1), m("lot_id", "CD", "quantity", 2, "unit", "mL")), Map.of("PB", pb, "CD", cd), UNITS);
        assertEquals(0, mix.portions().get(1).quantity().compareTo(new BigDecimal("0.002")));   // drawn in the lot's own unit
        assertEquals("This mixture must expire on or before 2026-11-15 (its earliest-expiring component)", refusal(() -> mix.expiry(LocalDate.of(2027, 1, 1))));
        assertEquals(LocalDate.of(2026, 11, 15), mix.expiry(null));
        assertEquals(0, mix.defaultQuantity("mL").compareTo(new BigDecimal("3")));
        List<Mixture.Concentration> c = mix.concentrations(new BigDecimal("100"), "mL", "Liquid", Map.of());
        assertEquals("Cadmium", c.get(0).analyteName());
        assertNull(c.get(0).concentration());
        assertEquals("Not calculated: INV-000003 has no Cadmium concentration", c.get(0).note());
        assertEquals(0, c.get(1).concentration().compareTo(new BigDecimal("10")));            // 1 mL of 1000 µg/mL in 100 mL
        assertEquals("µg/mL", c.get(1).unit());
        assertEquals("Calculated: 1 mg of Lead from INV-000002 in 100 mL", c.get(1).note());
        assertTrue(refusal(() -> Mixture.of(List.of(), Map.of(), UNITS).assertCanPrepare("Liquid", BigDecimal.ONE)).startsWith("A mixture needs at least one component lot"));
        assertEquals("Say whether the mixture is Solid or Liquid", refusal(() -> mix.assertCanPrepare(null, BigDecimal.ONE)));

        Mixture.Component molar = new Mixture.Component("NA", "INV-000004", "mL", "Liquid", null,
            List.of(new Mixture.AnalyteLine("A-NA", "Sodium", new BigDecimal("22.99"), new BigDecimal("1"), "M", "Amount/Volume", null, null, null)));
        List<Mixture.Concentration> mc = Mixture.of(List.of(m("lot_id", "NA", "quantity", 1)), Map.of("NA", molar), UNITS)
            .concentrations(new BigDecimal("1000"), "mL", "Liquid", Map.of());
        assertEquals(0, mc.get(0).concentration().compareTo(new BigDecimal("22.99")));        // 1 mL of 1 M sodium in 1 L
    }

    // ------------------------------------------------------------ sample storage and analyte lines (kept triggers' Java copies)
    @Test
    void sampleStorageAndAnalyteLines() {
        StorageLocation shelf = new StorageLocation("RET", "CFL", "RET-1", "Retain shelf", null, List.of("Ambient (15-25 °C)"), true, "Active");
        Map<String, Object> s = m("sample_code", "CFL261028001", "quantity_received", "500", "quantity_unit", "g", "retained_quantity", "600");
        assertEquals("Retained quantity (600 g) cannot be more than was received (500 g)", refusal(() -> SampleRetain.checked(s, m("retained_quantity", "600"), shelf, "CFL")));
        s.put("retained_quantity", "100");
        assertEquals("g", SampleRetain.checked(s, m("retained_quantity", "100"), null, "CFL").get("retained_unit"));
        StorageLocation fridge = new StorageLocation("FR", "CFL", "FR-1", "Fridge 1", null, List.of(), false, "Active");
        assertEquals("That storage location is not set up to hold samples", refusal(() -> SampleRetain.checked(s, m(), fridge, "CFL")));

        Lot tips = reagent("chemical_types", "{Consumable}");
        assertEquals("Consumables have no analytes", refusal(() -> LotAnalyteLine.checked(tips, null, m("lot_id", "L1", "analyte_id", "A"), true, UNITS)));
        assertEquals("That analyte is Retired", refusal(() -> LotAnalyteLine.checked(reagent(), null, m("lot_id", "L1", "analyte_id", "A"), false, UNITS)));
        assertEquals("Give the concentration a unit", refusal(() -> LotAnalyteLine.checked(reagent(), null, m("lot_id", "L1", "analyte_id", "A", "concentration", "5"), true, UNITS)));
        assertEquals("µg/mL", LotAnalyteLine.checked(reagent(), null, m("lot_id", "L1", "analyte_id", "A", "concentration", "5", "concentration_unit", "µg/ML"), true, UNITS)
            .get("concentration_unit"));
    }

    @Test
    void chemicalTypes() {
        ChemicalTypes t = ChemicalTypes.of("{Reagent,\"Reference Standard\"}");
        assertTrue(t.needsAnalyte());
        assertFalse(t.isMixture());
        assertEquals(List.of("In-house mixture", "Reagent", "Reference Standard"), t.asMixture().types());
        assertTrue(ChemicalTypes.of(List.of("Consumable")).isConsumableOnly());
    }
}
