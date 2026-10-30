package com.tentamus.lims.dashboard.domain;

import com.tentamus.lims.core.web.RuleException;
import java.time.LocalDate;

/**
 * A lab's typed finance figure: a week's costs (and the books' revenue) or a month's forecast. Replaces the rule part of
 * the database trigger finance_rules (migration 070; who may type them, finance.enter, stays in the database).
 */
public record FinanceFigure(LocalDate weekEnding, Double revenue, Double costs) {
    /** A week ends at most a week from now (UTC, as the database counted), and no figure is negative. */
    public void check(LocalDate todayUtc) {
        if (weekEnding != null && weekEnding.isAfter(todayUtc.plusDays(7))) throw RuleException.database("A week cannot end more than a week from now");
        if (revenue != null && revenue < 0 || costs != null && costs < 0) throw RuleException.database("Revenue and costs are not negative");
    }
}
