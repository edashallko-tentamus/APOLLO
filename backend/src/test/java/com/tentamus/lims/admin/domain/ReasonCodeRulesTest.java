package com.tentamus.lims.admin.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.web.RuleException;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The canned reason rules moved out of the database in migration 060 (they were checked by test_007). */
class ReasonCodeRulesTest {

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
    void reasonsBelongToAKnownModule() {
        assertNull(refusal(() -> new ReasonCode(null, m("module", "Inventory", "reason_text", "Spill or breakage")).check(null)));
        assertTrue(refusal(() -> new ReasonCode(null, m("module", "Kitchen", "reason_text", "x")).check(null)).startsWith("Reasons belong to a known module"));
        assertEquals("The reason cannot be blank.", refusal(() -> new ReasonCode(null, m("module", "General", "reason_text", " ")).check(null)));
        assertNull(refusal(() -> new ReasonCode(m("module", "Kitchen", "reason_text", "old"), m("sort_order", 3)).check(null)));   // module untouched
    }
}
