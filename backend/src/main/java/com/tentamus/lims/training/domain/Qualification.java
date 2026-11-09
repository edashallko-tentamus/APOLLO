package com.tentamus.lims.training.domain;

import com.tentamus.lims.core.web.RuleException;

/**
 * An analyst's qualification for a test: granted by QA's approval of a competency (or as legacy when the lab starts)
 * and withdrawn only by QA with a reason. Replaces withdraw_qualification and the trigger analyst_qualification_rules
 * (migration 071).
 */
public final class Qualification {
    private final String id, siteId;
    private String status, withdrawnReason;

    public Qualification(String id, String siteId, String status) {
        this.id = id;
        this.siteId = siteId;
        this.status = status;
    }

    /** QA withdraws it (signed), with the reason. */
    public void withdraw(boolean mayApprove, String approveText, String reason) {
        if (!"Active".equals(status)) throw RuleException.database("Qualification not found");
        if (!mayApprove) throw RuleException.database(approveText);
        if (CompetencyAttempt.blank(reason)) throw RuleException.database("Give the reason");
        status = "Inactive";
        withdrawnReason = reason.strip();
    }

    public String id() { return id; }
    public String siteId() { return siteId; }
    public String status() { return status; }
    public String withdrawnReason() { return withdrawnReason; }
}
