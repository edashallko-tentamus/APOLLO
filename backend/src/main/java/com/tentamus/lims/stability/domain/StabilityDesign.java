package com.tentamus.lims.stability.domain;

import com.tentamus.lims.core.web.RuleException;

/**
 * A stability quote version's study design: the plan's lab, the storage conditions, the timepoints and the matrix of
 * tests x timepoints x conditions, and what an amendment of a running study may change. Replaces the database trigger
 * stability_design_rules and the checks on timepoints, cells and the plan (migration 070; quotes.edit stays in the
 * database).
 *
 * @param siteId  the lab the study is stored and tested in (the quote's lab)
 * @param studyId the running study this version amends, or null for a first quote
 */
public record StabilityDesign(String siteId, String studyId) {
    /** The plan stays with the quote's lab; its escalation and reserve are percentages in range. */
    public void checkPlan(String planSite, Double escalationPct, Double reservePct) {
        if (planSite != null && !planSite.equals(siteId)) throw RuleException.database("The study is stored and tested by the lab the quote was made in");
        if (escalationPct != null && (escalationPct < 0 || escalationPct > 50)) throw RuleException.withCode("Annual escalation: 0 to 50 %", "23514");
        if (reservePct != null && (reservePct < 0 || reservePct > 200)) throw RuleException.withCode("Reserve: 0 to 200 %", "23514");
    }

    /**
     * A condition added to the design (or kept on an update): active, of every lab or of the study's lab.
     *
     * @param exists        whether the condition exists
     * @param active        whether it is active (an update keeps an inactive one)
     * @param conditionSite its lab, or null for every lab
     */
    public void checkCondition(boolean exists, boolean active, boolean isNew, String conditionSite) {
        if (!exists || !(active || !isNew) || conditionSite != null && !conditionSite.equals(siteId)) throw RuleException.database("Choose an active condition of the study's lab");
    }

    /** A timepoint as typed: label, interval and its window. */
    public static void checkTimepointValues(String label, double interval, double early, double late) {
        if (label == null || label.strip().isEmpty()) throw RuleException.withCode("Give the timepoint a label", "23514");
        if (!(interval >= 0)) throw RuleException.withCode(label + ": the interval is 0 (T0) or more", "23514");
        if (!(early >= 0 && early <= 90) || !(late >= 0 && late <= 90)) throw RuleException.withCode(label + ": days early and late are 0 to 90", "23514");
    }

    /**
     * A timepoint of an amendment: T0 stays the baseline, a timepoint already ordered or pulled keeps its interval, and no
     * new baseline is added.
     *
     * @param oldInterval the stored interval (null for a new timepoint)
     * @param intervalChanged whether its interval or unit changes
     * @param carried     whether it was carried from the version the study runs
     * @param used        whether the carried timepoint was already ordered or pulled
     */
    public void checkTimepointAmendment(String label, Integer oldInterval, boolean intervalChanged, boolean carried, boolean used, double newInterval, boolean active) {
        if (studyId == null) return;
        if (oldInterval != null && carried && intervalChanged) {
            if (oldInterval == 0) throw RuleException.database("T0 was ordered when the study started: it stays the baseline");
            if (used) throw RuleException.database(label + " was already ordered or pulled: its interval stays (add a new timepoint instead)");
        }
        if (newInterval == 0 && active && (oldInterval == null || oldInterval != 0))
            throw RuleException.database("T0 was ordered when the study started: an amendment cannot add a baseline");
    }

    /**
     * A cell of the matrix (one test at one timepoint and condition) that is active.
     *
     * @param ofThisVersion  whether the test line and the timepoint belong to this version and are active
     * @param interval       the timepoint's interval (0 = T0)
     * @param conditionId    the storage condition, or null (T0)
     * @param conditionOnDesign whether that condition is one of the study's active conditions
     * @param testSite       the test's lab, or null for a shared test
     * @param becomesActive  whether the cell is new or was not active before (an amendment changes only new work)
     * @param carried        whether its timepoint was carried from the version the study runs
     * @param usedAtCondition whether that timepoint was already ordered or pulled at that condition
     */
    public void checkCell(boolean ofThisVersion, int interval, String conditionId, boolean conditionOnDesign, String testSite, String testName, String testSiteCode,
                          boolean becomesActive, boolean carried, boolean usedAtCondition, String timepointLabel, String conditionName, long units) {
        if (units <= 0) throw RuleException.withCode("Units per test: a number above 0", "23514");
        if (!ofThisVersion) throw RuleException.database("The test and the timepoint must belong to this version of the quote");
        if (interval == 0 && conditionId != null) throw RuleException.database("T0 is the baseline, tested at placement: it has no storage condition");
        if (interval > 0 && (conditionId == null || !conditionOnDesign)) throw RuleException.database("Each pull is for one of the study's conditions");
        if (testSite != null && !testSite.equals(siteId)) throw RuleException.database(testName + " belongs to " + testSiteCode + " and can only be tested there");
        if (studyId != null && becomesActive) {
            if (interval == 0) throw RuleException.database("T0 was ordered when the study started: its tests cannot change");
            if (carried && usedAtCondition)
                throw RuleException.database(timepointLabel + " at " + conditionName + " was already ordered or pulled: its tests cannot change (add a new timepoint instead)");
        }
    }
}
