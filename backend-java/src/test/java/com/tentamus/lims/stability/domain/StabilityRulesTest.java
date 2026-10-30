package com.tentamus.lims.stability.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.web.RuleException;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The stability setup, design and excursion rules moved out of the database in migration 070 (test_027 and test_036). */
class StabilityRulesTest {
    private static String refusal(Runnable r) {
        try { r.run(); } catch (RuleException e) { return e.getMessage(); }
        return null;
    }

    private static Map<String, Object> m(Object... kv) {
        Map<String, Object> out = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) out.put((String) kv[i], kv[i + 1]);
        return out;
    }

    @Test
    void setup() {
        assertEquals("EQ-9 is retired and cannot be a stability chamber",
            refusal(() -> StabilitySetup.checkChamber(null, m("equipment_id", "e"), "EQ-9", "cfl", true, null, false)));
        assertEquals("That condition belongs to another lab", refusal(() -> StabilitySetup.checkChamber(null, m("equipment_id", "e"), "EQ-1", "cfl", false, "tps", false)));
        Map<String, Object> ch = m("equipment_id", "e", "condition_id", "c1", "status", "Active");
        assertEquals("A chamber stays the same piece of equipment", refusal(() -> StabilitySetup.checkChamber(ch, m("equipment_id", "f", "condition_id", "c1", "status", "Active"), "EQ-1", "cfl", false, null, false)));
        assertTrue(refusal(() -> StabilitySetup.checkChamber(ch, m("equipment_id", "e", "condition_id", "c2", "status", "Active"), "EQ-1", "cfl", false, null, true)).contains("stored in this chamber"));
        assertNull(refusal(() -> StabilitySetup.checkChamber(ch, m("equipment_id", "e", "condition_id", "c2", "status", "Active"), "EQ-1", "cfl", false, null, false)));
        Map<String, Object> cond = m("id", "c1", "site_id", null, "condition_name", "25/60", "temperature_c", 25, "humidity_pct", 60, "condition_type", "Long term");
        assertTrue(refusal(() -> StabilitySetup.checkCondition(cond, m("site_id", null, "condition_name", "25/60", "temperature_c", 26, "humidity_pct", 60, "condition_type", "Long term"), true)).contains("fixed"));
        assertNull(refusal(() -> StabilitySetup.checkCondition(cond, m("site_id", null, "condition_name", "25/60", "temperature_c", 25.0, "humidity_pct", 60, "condition_type", "Long term", "description", "x"), true)));
        assertEquals("A condition stays with its lab", refusal(() -> StabilitySetup.checkCondition(cond, m("site_id", "cfl", "condition_name", "25/60"), false)));
        assertNotNull(refusal(() -> StabilitySetup.checkCondition(null, m("condition_name", " "), false)));
        assertNotNull(refusal(() -> StabilitySetup.checkCondition(null, m("condition_name", "x", "humidity_pct", 101), false)));
        Map<String, Object> rack = m("chamber_id", "ch1", "rack_code", "R1", "status", "Active");
        assertEquals("Study material is stored in this rack: it stays in its chamber", refusal(() -> StabilitySetup.checkRack(rack, m("chamber_id", "ch2", "rack_code", "R1", "status", "Active"), true)));
        assertEquals("Study material is stored in this rack: move it before retiring the rack", refusal(() -> StabilitySetup.checkRack(rack, m("chamber_id", "ch1", "rack_code", "R1", "status", "Inactive"), true)));
        assertNotNull(refusal(() -> StabilitySetup.checkRack(null, m("rack_code", "R1", "positions", 0), false)));
    }

    @Test
    void quoteDesign() {
        StabilityDesign quote = new StabilityDesign("cfl", null);
        assertEquals("The study is stored and tested by the lab the quote was made in", refusal(() -> quote.checkPlan("tps", null, null)));
        assertNotNull(refusal(() -> quote.checkPlan(null, 51.0, null)));
        assertEquals("Choose an active condition of the study's lab", refusal(() -> quote.checkCondition(true, true, true, "tps")));
        assertEquals("Choose an active condition of the study's lab", refusal(() -> quote.checkCondition(true, false, true, null)));
        assertNull(refusal(() -> quote.checkCondition(true, false, false, null)));     // an update keeps an inactive one
        assertEquals("T0 is the baseline, tested at placement: it has no storage condition",
            refusal(() -> quote.checkCell(true, 0, "c1", true, null, "Moisture", null, true, false, false, "T0", "25/60", 1)));
        assertEquals("Each pull is for one of the study's conditions", refusal(() -> quote.checkCell(true, 1, "c5", false, null, "Moisture", null, true, false, false, "1 M", "5 C", 1)));
        assertEquals("The test and the timepoint must belong to this version of the quote", refusal(() -> quote.checkCell(false, 1, "c1", true, null, "M", null, true, false, false, "1 M", "x", 1)));
        assertEquals("Assay belongs to TPS and can only be tested there", refusal(() -> quote.checkCell(true, 1, "c1", true, "tps", "Assay", "TPS", true, false, false, "1 M", "x", 1)));
        assertNotNull(refusal(() -> quote.checkCell(true, 1, "c1", true, null, "M", null, true, false, false, "1 M", "x", 0)));
        assertNotNull(refusal(() -> StabilityDesign.checkTimepointValues(" ", 1, 7, 7)));
        assertNotNull(refusal(() -> StabilityDesign.checkTimepointValues("1 M", -1, 7, 7)));
        assertNotNull(refusal(() -> StabilityDesign.checkTimepointValues("1 M", 1, 91, 7)));
        assertNull(refusal(() -> quote.checkTimepointAmendment("T0", null, false, false, false, 0, true)));   // a first quote adds T0
    }

    @Test
    void amendments() {
        StabilityDesign amend = new StabilityDesign("cfl", "study");
        assertEquals("3 M was already ordered or pulled: its interval stays (add a new timepoint instead)",
            refusal(() -> amend.checkTimepointAmendment("3 M", 3, true, true, true, 4, true)));
        assertEquals("T0 was ordered when the study started: it stays the baseline", refusal(() -> amend.checkTimepointAmendment("T0", 0, true, true, false, 1, true)));
        assertEquals("T0 was ordered when the study started: an amendment cannot add a baseline", refusal(() -> amend.checkTimepointAmendment("T0b", null, false, false, false, 0, true)));
        assertNull(refusal(() -> amend.checkTimepointAmendment("24 M", null, false, false, false, 24, true)));
        assertEquals("1 M at 25/60 was already ordered or pulled: its tests cannot change (add a new timepoint instead)",
            refusal(() -> amend.checkCell(true, 1, "c1", true, null, "M", null, true, true, true, "1 M", "25/60", 1)));
        assertEquals("T0 was ordered when the study started: its tests cannot change", refusal(() -> amend.checkCell(true, 0, null, false, null, "M", null, true, true, false, "T0", null, 1)));
        assertNull(refusal(() -> amend.checkCell(true, 1, "c1", true, null, "M", null, false, true, true, "1 M", "25/60", 2)));   // an existing cell's units may change
    }

    @Test
    void excursionAssessment() {
        assertEquals("That reading is not an excursion of study STB-00001", refusal(() -> new ExcursionAssessment("STB-00001", false, "No impact", "Fine").check()));
        assertEquals("Choose No impact, Impact (results flagged) or Client to decide", refusal(() -> new ExcursionAssessment("STB-00001", true, "Ignore", "Fine").check()));
        assertEquals("Justify the assessment", refusal(() -> new ExcursionAssessment("STB-00001", true, "No impact", "  ").check()));
        assertEquals("44 C", new ExcursionAssessment("STB-00001", true, "Impact: results flagged", " 44 C ").check());
    }
}
