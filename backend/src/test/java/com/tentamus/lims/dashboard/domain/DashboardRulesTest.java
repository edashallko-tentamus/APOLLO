package com.tentamus.lims.dashboard.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.web.RuleException;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The dashboard layout and finance figure rules moved out of the database in migration 070 (test_032). */
class DashboardRulesTest {
    private static String refusal(Runnable r) {
        try { r.run(); } catch (RuleException e) { return e.getMessage(); }
        return null;
    }

    @Test
    void layouts() {
        assertNull(refusal(() -> new DashboardLayout("me", List.of(Map.of("code", "tat", "w", 4, "h", 2))).check("me")));
        assertEquals("Each person arranges only their own dashboard", refusal(() -> new DashboardLayout("you", List.of()).check("me")));
        assertEquals("A widget is 2 to 12 columns wide and 1 to 6 rows high", refusal(() -> new DashboardLayout("me", List.of(Map.of("code", "tat", "w", 13, "h", 2))).check("me")));
        assertEquals("A widget is 2 to 12 columns wide and 1 to 6 rows high", refusal(() -> new DashboardLayout("me", List.of(Map.of("code", "tat", "w", 4, "h", 0))).check("me")));
    }

    @Test
    void financeFigures() {
        LocalDate today = LocalDate.of(2026, 10, 29);
        assertNull(refusal(() -> new FinanceFigure(today.plusDays(7), 10.0, 5.0).check(today)));
        assertEquals("A week cannot end more than a week from now", refusal(() -> new FinanceFigure(today.plusDays(8), null, 5.0).check(today)));
        assertEquals("Revenue and costs are not negative", refusal(() -> new FinanceFigure(today, null, -1.0).check(today)));
        assertEquals("Revenue and costs are not negative", refusal(() -> new FinanceFigure(null, -5.0, 1.0).check(today)));
    }
}
