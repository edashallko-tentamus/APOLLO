package com.tentamus.lims.waste.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.inventory.domain.ChemicalTypes;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The waste classification rules moved out of the database in migration 062 (checked before by test_045). */
class WasteRulesTest {
    private static final WasteClassification ACN = new WasteClassification("W1", "CFL", "CFL acetonitrile waste", true, List.of("Solvent"));
    private static final WasteClassification SHARED_SOLVENT = new WasteClassification("W0", null, "Non-halogenated flammable solvents", true, List.of("Solvent"));
    private static final WasteClassification SHARED_MEDIA = new WasteClassification("W8", null, "Biohazardous", true, List.of("Media", "Microbiological Strain"));

    private static String refusal(Runnable r) {
        try { r.run(); } catch (RuleException e) { return e.getMessage(); }
        return null;
    }

    private static Map<String, Object> m(Object... kv) {
        Map<String, Object> out = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) out.put((String) kv[i], kv[i + 1]);
        return out;
    }

    private static Map<String, Object> check(Map<String, Object> after) {
        return WasteClassification.checked(null, after, after, List.of(ACN), ChemicalTypes.ORDER);
    }

    @Test
    void classificationRules() {
        assertEquals("CFL acetonitrile waste is already the default for Solvent (one default per item type)",
            refusal(() -> check(m("site_id", "CFL", "waste_name", "CFL methanol waste", "hazard_classes", List.of("Ignitable"), "default_for", List.of("Solvent")))));
        assertTrue(refusal(() -> check(m("site_id", "CFL", "waste_name", "CFL odd waste", "hazard_classes", List.of("Explosive")))).startsWith("Unknown hazard class: Explosive"));
        assertEquals("A waste is Non-hazardous or has hazard classes, not both",
            refusal(() -> check(m("site_id", "CFL", "waste_name", "CFL mixed", "hazard_classes", "{Non-hazardous,Toxic}"))));
        assertEquals("Give the hazard classes of CFL unknown, Non-hazardous, or mark it Needs review", refusal(() -> check(m("site_id", "CFL", "waste_name", "CFL unknown"))));
        assertNull(refusal(() -> check(m("site_id", "CFL", "waste_name", "CFL to classify", "needs_review", true))));
        assertEquals("A waste classification stays with its lab", refusal(() -> WasteClassification.checked(ACN,
            m("site_id", "TPS", "waste_name", "x", "hazard_classes", List.of("Toxic")), m("site_id", "TPS"), List.of(), ChemicalTypes.ORDER)));
        Map<String, Object> ok = check(m("site_id", "CFL", "waste_name", "CFL acids", "hazard_classes", List.of(" Toxic", "Corrosive", "Toxic"),
            "default_for", List.of("Reagent", "Consumable", "Reagent")));
        assertEquals(List.of("Corrosive", "Toxic"), ok.get("hazard_classes"));          // trimmed, without duplicates, sorted
        assertEquals(List.of("Consumable", "Reagent"), ok.get("default_for"));          // in the item types' own order
        assertNull(refusal(() -> WasteClassification.checked(ACN, m("site_id", "CFL", "waste_name", "CFL acetonitrile waste", "hazard_classes", List.of("Toxic"),
            "default_for", List.of("Solvent")), m("container", "x"), List.of(ACN), ChemicalTypes.ORDER)));   // its own default is not a clash
    }

    @Test
    void choosingForAnItem() {
        assertEquals(ACN, WasteClassification.defaultFor("CFL", List.of("Solvent"), List.of(SHARED_SOLVENT, ACN, SHARED_MEDIA)));   // the lab's own first
        assertEquals(SHARED_SOLVENT, WasteClassification.defaultFor("TPS", List.of("Solvent"), List.of(SHARED_SOLVENT, ACN, SHARED_MEDIA)));
        assertEquals(SHARED_MEDIA, WasteClassification.defaultFor("CFL", List.of("Media"), List.of(SHARED_SOLVENT, ACN, SHARED_MEDIA)));
        assertNull(WasteClassification.defaultFor("CFL", List.of("Reagent"), List.of(ACN)));
        assertEquals("Waste classification CFL acetonitrile waste belongs to another lab", refusal(() -> ACN.assertChoosableAt("TPS")));
        assertEquals("Waste classification Oxidizers is retired", refusal(() -> new WasteClassification("W7", null, "Oxidizers", false, List.of()).assertChoosableAt("CFL")));
    }
}
