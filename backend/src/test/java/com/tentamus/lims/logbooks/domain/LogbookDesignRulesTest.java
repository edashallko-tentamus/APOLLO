package com.tentamus.lims.logbooks.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.web.RuleException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The logbook design rules moved out of the database in migration 070 (they were checked by test_029 and test_030). */
class LogbookDesignRulesTest {
    private static String refusal(Runnable r) {
        try { r.run(); } catch (RuleException e) { return e.getMessage(); }
        return null;
    }

    private static Map<String, Object> m(Object... kv) {
        Map<String, Object> out = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) out.put((String) kv[i], kv[i + 1]);
        return out;
    }

    private static Map<String, Object> logbook(Map<String, Object> before, Map<String, Object> changes, boolean entries) {
        Map<String, Object> after = before == null ? new HashMap<>() : new HashMap<>(before);
        after.putAll(changes);
        return Logbook.checked(before, after, changes, entries, u -> u == null ? null : u.toUpperCase());
    }

    @Test
    void logbookSettings() {
        assertEquals("Rule check", logbook(null, m("logbook_name", " Rule check ", "subject", "Equipment"), false).get("logbook_name"));
        assertEquals("Name the logbook", refusal(() -> logbook(null, m("logbook_name", " "), false)));
        assertTrue(refusal(() -> logbook(null, m("logbook_name", "x", "subject", "None", "creates_lot", true), false)).contains("about lots"));
        assertTrue(refusal(() -> logbook(null, m("logbook_name", "x", "subject", "Lot", "creates_lot", true, "signing", "Recorded"), false)).contains("signs its entries"));
        assertEquals("CFU", logbook(null, m("logbook_name", "x", "subject", "Lot", "creates_lot", true, "lot_unit", "cfu"), false).get("lot_unit"));
        Map<String, Object> weights = m("id", "l", "site_id", "cfl", "logbook_code", "LB-0001", "logbook_name", "w", "kind", "Sample weights", "subject", "Sample", "review_route", "Batch");
        assertTrue(refusal(() -> logbook(weights, m("review_route", "Logbook"), false)).contains("reviewed in the batch that uses them"));
        assertTrue(refusal(() -> logbook(null, m("logbook_name", "x", "subject", "Lot", "review_route", "Batch"), false)).contains("Only entries used once"));
        Map<String, Object> eq = m("id", "l", "site_id", "cfl", "logbook_code", "LB-0002", "logbook_name", "t", "subject", "Equipment");
        assertEquals("The logbook has entries: what it is about (Equipment) cannot change", refusal(() -> logbook(eq, m("subject", "None"), true)));
        assertEquals("A logbook stays with its lab", refusal(() -> logbook(eq, m("site_id", "tps"), false)));
        assertNotNull(refusal(() -> logbook(null, m("logbook_name", "x", "validity_hours", 0), false)));
    }

    private static Map<String, Object> field(Map<String, Object> changes, String subject) {
        return LogbookField.checked(null, changes, changes, subject);
    }

    @Test
    void fields() {
        assertTrue(refusal(() -> field(m("field_key", "9x", "label", "Bad", "field_type", "Number"), "Equipment")).contains("lower-case"));
        assertEquals("check_weight_id", field(m("label", " Check weight ID ", "field_type", "Text"), "Equipment").get("field_key"));
        assertTrue(refusal(() -> field(m("field_key", "this", "label", "This", "field_type", "Number"), "Equipment")).contains("kept for formulas"));
        assertTrue(refusal(() -> field(m("label", "Grade", "field_type", "Choice"), "Equipment")).contains("lists its choices"));
        assertTrue(refusal(() -> field(m("label", "Reading", "field_type", "Number", "publish", true), "Equipment")).contains("publishes values"));
        assertEquals("Reading: the lower limit (5) is above the upper limit (1.5)",
            refusal(() -> field(m("label", "Reading", "field_type", "Number", "limit_min", 5, "limit_max", 1.50), "Equipment")));
        assertTrue(refusal(() -> field(m("field_key", "weight", "label", "Weight", "field_type", "Number", "publish", true), "Lot")).contains("bench formulas use"));
        assertTrue(refusal(() -> field(m("label", "T", "field_type", "Number", "equipment_limits", true), "Lot")).contains("need a logbook about equipment"));
        Map<String, Object> text = field(m("label", "Note", "field_type", "Text", "limit_max", 3, "formula", "1+1", "unit", " "), "Equipment");
        assertNull(text.get("limit_max")); assertNull(text.get("formula")); assertNull(text.get("unit"));   // only numbers have limits, only calculations formulas
        assertEquals("Give the field a label", refusal(() -> field(m("label", " ", "field_type", "Number"), "Equipment")));
        assertEquals(List.of("a"), field(m("label", "G", "field_type", "Choice", "choices", List.of("a")), "Equipment").get("choices"));
    }

    @Test
    void coveredEquipment() throws Exception {
        ObjectMapper j = new ObjectMapper();
        var inverted = j.readTree("{\"temperature\": {\"min\": 9, \"max\": 2}}");
        var array = j.readTree("[1]");
        var fine = j.readTree("{\"error_pct\": {\"max\": 0.05}}");
        assertEquals("LB-0001 is not a logbook about equipment", refusal(() -> new CoveredEquipment("LB-0001", "Lot", "cfl", "EQ-1", "cfl", false, null).check(true)));
        assertEquals("EQ-1 belongs to another lab", refusal(() -> new CoveredEquipment("LB-0001", "Equipment", "cfl", "EQ-1", "tps", false, null).check(true)));
        assertEquals("EQ-1 is retired", refusal(() -> new CoveredEquipment("LB-0001", "Equipment", "cfl", "EQ-1", "cfl", true, null).check(true)));
        assertEquals("EQ-1 (temperature): the lower limit is above the upper limit",
            refusal(() -> new CoveredEquipment("LB-0001", "Equipment", "cfl", "EQ-1", "cfl", false, inverted).check(false)));
        assertNotNull(refusal(() -> new CoveredEquipment("LB-0001", "Equipment", "cfl", "EQ-1", "cfl", false, array).check(false)));
        assertNull(refusal(() -> new CoveredEquipment("LB-0001", "Equipment", "cfl", "EQ-1", "cfl", false, fine).check(true)));
    }
}
