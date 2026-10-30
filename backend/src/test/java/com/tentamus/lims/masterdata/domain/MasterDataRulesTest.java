package com.tentamus.lims.masterdata.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** The master data rules moved out of the database in migration 060 (they were checked by test_001, 003, 004, 006 and 007). */
class MasterDataRulesTest {

    /** Facts as a test wants them. */
    private static final class Facts implements MasterFacts {
        Set<String> matricesInUse = Set.of(), unitsInUse = Set.of(), unitsWithConversions = Set.of(), zones = Set.of("America/Los_Angeles");
        Map<String, String> dims = Map.of();
        public boolean matrixUsedOnSamples(String n) { return matricesInUse.stream().anyMatch(m -> m.equalsIgnoreCase(n)); }
        public boolean unitUsedOnInventory(String c) { return unitsInUse.contains(c); }
        public boolean unitHasActiveConversions(String id) { return unitsWithConversions.contains(id); }
        public String unitDimension(String id) { return dims.get(id); }
        public boolean isTimeZone(String n) { return zones.contains(n); }
    }

    private static String refusal(Runnable r) {
        try { r.run(); } catch (RuleException e) { return e.getMessage(); }
        return null;
    }

    private static Map<String, Object> m(Object... kv) {
        Map<String, Object> out = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) out.put((String) kv[i], kv[i + 1]);
        return out;
    }

    private static final Facts NONE = new Facts();

    @Test
    void casCheckDigit() {
        assertTrue(CasNumber.isValid("7439-92-1"));     // lead
        assertTrue(CasNumber.isValid("50-81-7"));       // vitamin C
        assertTrue(CasNumber.isValid(null));
        assertFalse(CasNumber.isValid("7439-92-2"));    // wrong check digit
        assertFalse(CasNumber.isValid("1234-56-7"));
        assertFalse(CasNumber.isValid("7439921"));
    }

    @Test
    void analyteReportNameAndCas() {
        assertEquals("pH", new Analyte(null, m("analyte_name", "pH", "analyte_class", "Physical/General")).check(NONE).get("report_name"));
        assertEquals("Lead (Pb)", new Analyte(null, m("analyte_name", "Lead", "report_name", "Lead (Pb)", "analyte_class", "Chemical")).check(NONE).get("report_name"));
        assertEquals("Analyte name cannot be blank.", refusal(() -> new Analyte(null, m("analyte_name", " ", "analyte_class", "Chemical")).check(NONE)));
        assertEquals("CAS Number is not valid (format or check digit).",
            refusal(() -> new Analyte(null, m("analyte_name", "Fake", "analyte_class", "Chemical", "cas_number", "7439-92-2")).check(NONE)));
        assertEquals("Only Chemical analytes can have a CAS Number.",
            refusal(() -> new Analyte(null, m("analyte_name", "E. coli", "analyte_class", "Microbiological", "cas_number", "7439-92-1")).check(NONE)));
        Map<String, Object> lead = m("analyte_name", "Lead", "report_name", "Lead (Pb)", "analyte_class", "Chemical", "cas_number", "7439-92-1");
        assertEquals("Only Chemical analytes can have a CAS Number.", refusal(() -> new Analyte(lead, m("analyte_class", "Physical/General")).check(NONE)));
        assertEquals("Report name cannot be blank.", refusal(() -> new Analyte(lead, m("report_name", null)).check(NONE)));
    }

    @Test
    void molarMass() {
        Map<String, Object> lead = m("analyte_name", "Lead", "report_name", "Lead (Pb)", "analyte_class", "Chemical");
        assertTrue(refusal(() -> new Analyte(lead, m("molar_mass", 207.2)).check(NONE)).startsWith("Give the source of the molar mass"));
        assertNull(refusal(() -> new Analyte(lead, m("molar_mass", 207.2, "molar_mass_source", "IUPAC standard atomic weights 2021")).check(NONE)));
        assertEquals("A molar mass must be more than 0 g/mol.", refusal(() -> new Analyte(lead, m("molar_mass", 0, "molar_mass_source", "x")).check(NONE)));
        Map<String, Object> legacy = new HashMap<>(lead);
        legacy.put("molar_mass", new BigDecimal("207.200000"));
        assertNull(refusal(() -> new Analyte(legacy, m("molar_mass", "207.2", "report_name", "Lead")).check(NONE)));   // unchanged: not judged again
        assertNull(refusal(() -> new Analyte(null, m("analyte_name", "Sodium", "analyte_class", "Chemical", "cas_number", "7440-23-5",
            "molar_mass", 22.99, "molar_mass_source", "IUPAC standard atomic weights 2021")).check(NONE)));
    }

    @Test
    void labSite() {
        Facts f = new Facts();
        assertEquals("Unknown time zone \"Mars/Olympus\". Use a name like America/Los_Angeles or America/New_York",
            refusal(() -> new LabSite(null, m("site_code", "XX", "site_name", "Bad", "time_zone", "Mars/Olympus")).check(f)));
        assertNull(refusal(() -> new LabSite(null, m("site_code", "CFL", "site_name", "CFL", "time_zone", "America/Los_Angeles")).check(f)));
        assertTrue(refusal(() -> new LabSite(null, m("site_code", "cfl", "time_zone", "America/Los_Angeles")).check(f)).startsWith("A lab code is 2 to 6"));
        Map<String, Object> cfl = m("site_code", "CFL", "time_zone", "Mars/Olympus");   // a stored zone is not judged again
        assertNull(refusal(() -> new LabSite(cfl, m("site_name", "x")).check(f)));
        assertNotNull(refusal(() -> new LabSite(cfl, m("subcontract_discount_pct", 100)).check(f)));
        assertNull(refusal(() -> new LabSite(cfl, m("subcontract_markup_pct", "500")).check(f)));
        assertNotNull(refusal(() -> new LabSite(cfl, m("subcontract_markup_pct", -1)).check(f)));
        assertNotNull(refusal(() -> new LabSite(cfl, m("stability_pull_window_days", 91)).check(f)));
        assertNotNull(refusal(() -> new LabSite(cfl, m("stability_reserve_pct", 200.5)).check(f)));
    }

    @Test
    void matrixInUseKeepsItsName() {
        Facts f = new Facts();
        f.matricesInUse = Set.of("Capsule");
        Map<String, Object> capsule = m("matrix_name", "Capsule");
        assertEquals("Matrix \"Capsule\" is used on samples and cannot be renamed. Set it Inactive and add the new name instead.",
            refusal(() -> new Matrix(capsule, m("matrix_name", "Capsules")).check(f)));
        assertEquals("capsule", new Matrix(capsule, m("matrix_name", " capsule ")).check(f).get("matrix_name"));   // capitals only: allowed, trimmed
        assertNull(refusal(() -> new Matrix(m("matrix_name", "Tablet"), m("matrix_name", "Tablets")).check(f)));
        assertEquals("Matrix name cannot be blank.", refusal(() -> new Matrix(null, m("matrix_name", "  ")).check(f)));
        assertEquals("Category name cannot be blank.", refusal(() -> new Category(null, m("description", "x")).check(f)));
    }

    @Test
    void units() {
        Facts f = new Facts();
        f.unitsInUse = Set.of("L");
        f.unitsWithConversions = Set.of("u-g");
        assertEquals("Unit \"L\" is used on inventory and cannot be renamed. Set it Inactive and add the new one instead.",
            refusal(() -> new Unit(m("id", "u-L", "unit_code", "L", "unit_name", "litre"), m("unit_code", "litre")).check(f)));
        assertEquals("dram", new Unit(null, m("unit_code", " dram ", "unit_name", "dram (mass)", "dimension", "Mass")).check(f).get("unit_code"));
        assertEquals("Unit \"g\" has conversions; set them Inactive before changing what it measures",
            refusal(() -> new Unit(m("id", "u-g", "unit_code", "g", "unit_name", "gram", "dimension", "Mass"), m("dimension", "Volume")).check(f)));
        assertEquals("Unit name cannot be blank.", refusal(() -> new Unit(null, m("unit_code", "x", "dimension", "Mass")).check(f)));
    }

    @Test
    void conversions() {
        Facts f = new Facts();
        f.dims = Map.of("dram", "Mass", "mL", "Volume", "ppm", "Parts per", "ug/g", "Mass/Mass", "g", "Mass");
        assertEquals("A Mass unit cannot be converted to a Volume unit",
            refusal(() -> new UnitConversion(null, m("from_unit_id", "dram", "to_unit_id", "mL", "factor", 1)).check(f)));
        assertEquals("A ppm-type conversion must say whether it applies to liquids or to solids",
            refusal(() -> new UnitConversion(null, m("from_unit_id", "ppm", "to_unit_id", "ug/g", "factor", 1)).check(f)));
        assertNull(refusal(() -> new UnitConversion(null, m("from_unit_id", "ppm", "to_unit_id", "ug/g", "factor", 1, "applies_to", "Solid")).check(f)));
        assertEquals("Any", new UnitConversion(null, m("from_unit_id", "dram", "to_unit_id", "g", "factor", 1.77)).check(f).get("applies_to"));
        assertEquals("The factor must be more than 0.", refusal(() -> new UnitConversion(null, m("from_unit_id", "dram", "to_unit_id", "g", "factor", 0)).check(f)));
        assertEquals("A unit cannot be converted to itself.", refusal(() -> new UnitConversion(null, m("from_unit_id", "g", "to_unit_id", "g", "factor", 1)).check(f)));
        assertEquals("Applies to: pick Any, Liquid or Solid.",
            refusal(() -> new UnitConversion(null, m("from_unit_id", "dram", "to_unit_id", "g", "factor", 1, "applies_to", "Gas")).check(f)));
    }

    @Test
    void unitGraph() {
        List<UnitGraph.UnitOfMeasure> units = List.of(
            new UnitGraph.UnitOfMeasure("g", "g", "Mass", 11, true), new UnitGraph.UnitOfMeasure("mg", "mg", "Mass", 12, true),
            new UnitGraph.UnitOfMeasure("dram", "dram", "Mass", 17, true), new UnitGraph.UnitOfMeasure("L", "L", "Volume", 20, true),
            new UnitGraph.UnitOfMeasure("mL", "mL", "Volume", 21, true), new UnitGraph.UnitOfMeasure("gal", "gal", "Volume", 23, true),
            new UnitGraph.UnitOfMeasure("ppm", "ppm", "Parts per", 80, true), new UnitGraph.UnitOfMeasure("mg/L", "mg/L", "Mass/Volume", 51, true),
            new UnitGraph.UnitOfMeasure("old", "old", "Mass", 99, false));
        List<UnitGraph.Conversion> conv = List.of(
            new UnitGraph.Conversion("mg", "g", new BigDecimal("0.001"), "Any", true),
            new UnitGraph.Conversion("dram", "g", new BigDecimal("1.7718451953125"), "Any", true),
            new UnitGraph.Conversion("L", "mL", new BigDecimal("1000"), "Any", true),
            new UnitGraph.Conversion("gal", "mL", new BigDecimal("3785.411784"), "Any", true),
            new UnitGraph.Conversion("ppm", "mg/L", BigDecimal.ONE, "Liquid", true),
            new UnitGraph.Conversion("old", "g", BigDecimal.TEN, "Any", false));
        UnitGraph g = new UnitGraph(units, conv);
        assertEquals(new BigDecimal("1771.8451953125"), g.factor("dram", "mg", null));    // chained, through the reverse of mg -> g
        assertEquals(new BigDecimal("1000"), g.factor("L", "ML", null));
        assertEquals(BigDecimal.ONE, g.factor("g", "g", null));
        assertNull(g.factor("g", "mL", null));
        assertNull(g.factor("ppm", "mg/L", "Solid"));
        assertEquals(BigDecimal.ONE, g.factor("ppm", "mg/L", "Liquid"));
        assertNull(g.factor("old", "g", null));                                            // an inactive conversion is not followed
        assertEquals(List.of("L", "mL", "gal"), g.convertible("L", "Liquid"));
        assertEquals("mL", g.canonical(" ml ", List.of("Mass", "Volume", "Count"), "Unit"));
        assertNull(g.canonical(" ", List.of("Mass"), "Unit"));
        assertEquals("Unit \"mg/L\" is not on the Units list (Admin > Units) as a Mass, Volume, Count unit",
            refusal(() -> g.canonical("mg/L", List.of("Mass", "Volume", "Count"), "Unit")));
        assertThrows(RuleException.class, () -> g.canonical("old", List.of("Mass"), "Unit"));
    }
}
