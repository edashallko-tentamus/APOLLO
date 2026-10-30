package com.tentamus.lims.trending.domain;

import com.tentamus.lims.core.web.RuleException;

/**
 * A person's review of a chart's signal (outcome and comment). Replaces the comment check on trend_signal_review
 * (migration 070; the outcome and rule lists stay in the database as the column's allowed values).
 */
public record SignalReview(String pointKey, String rule, String outcome, String comment) {
    /** Refuses a review without a comment; returns the comment to store (trimmed). */
    public String checkedComment() {
        String c = comment == null ? "" : comment.strip();
        if (c.isEmpty()) throw RuleException.withCode("Say what was found (a comment)", "23514");
        if (rule == null || !TrendChart.RULES.contains(rule)) throw RuleException.withCode("Unknown rule: " + rule, "23514");
        return c;
    }
}
