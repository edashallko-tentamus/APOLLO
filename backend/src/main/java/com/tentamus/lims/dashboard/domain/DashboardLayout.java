package com.tentamus.lims.dashboard.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.List;
import java.util.Map;

/**
 * A person's own arrangement of a dashboard: widgets with their size. Replaces the database trigger
 * user_dashboard_layout_rules (migration 070).
 */
public record DashboardLayout(String owner, List<Map<String, Object>> widgets) {
    /** Each person arranges only their own dashboard; a widget is 2 to 12 columns wide and 1 to 6 rows high. */
    public void check(String user) {
        if (owner == null || !owner.equals(user)) throw RuleException.database("Each person arranges only their own dashboard");
        for (Map<String, Object> w : widgets) {
            int x = ((Number) w.get("w")).intValue(), y = ((Number) w.get("h")).intValue();
            if (x < 2 || x > 12 || y < 1 || y > 6) throw RuleException.database("A widget is 2 to 12 columns wide and 1 to 6 rows high");
        }
    }
}
