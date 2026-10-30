package com.tentamus.lims.trending.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.List;
import java.util.Objects;

/**
 * A saved trend chart: what it charts, its frozen limits and QA's approval of the chart and its limits. Replaces the
 * rule parts of the database triggers trend_rules and trend_chart_qa_rules and the functions approve_trend_chart and
 * record_trend_limits_applied (migration 070). Who froze the limits and who approved them are stamped by the repository
 * when {@link #frozenNow()} or {@link #approvedNow()} says so.
 */
public final class TrendChart {
    public static final List<String> SOURCES = List.of("results", "qc", "logbook", "stability", "counts", "pareto");
    public static final List<String> RULES = List.of("R1", "R2", "R3", "R4", "R5", "LIM");

    public String id, code, siteId, name, description, source, status = "Active";
    /** What it charts (a JSON value compared as JSON, so the key order does not count). */
    public Object params;
    public List<String> rules = RULES;
    public boolean watch = true, showInReview, qaReview;
    public String qaStatus = "Not required", qaApprovedBy, qaSignatureId, appliedVersionId, appliedBy;
    public Double frozenCl, frozenSigma;
    public Integer frozenN;
    public String frozenFrom, frozenTo, frozenBy, createdBy, modifiedBy;
    private boolean frozenNow, approvedNow, appliedNow;

    /** A copy to change (the stored chart stays as it was, for the comparison). */
    public TrendChart copy() {
        TrendChart c = new TrendChart();
        c.id = id; c.code = code; c.siteId = siteId; c.name = name; c.description = description; c.source = source; c.params = params; c.status = status;
        c.rules = rules; c.watch = watch; c.showInReview = showInReview; c.qaReview = qaReview; c.qaStatus = qaStatus; c.qaApprovedBy = qaApprovedBy;
        c.qaSignatureId = qaSignatureId; c.appliedVersionId = appliedVersionId; c.appliedBy = appliedBy; c.frozenCl = frozenCl; c.frozenSigma = frozenSigma;
        c.frozenN = frozenN; c.frozenFrom = frozenFrom; c.frozenTo = frozenTo; c.frozenBy = frozenBy; c.createdBy = createdBy; c.modifiedBy = modifiedBy;
        return c;
    }

    public boolean frozenNow() { return frozenNow; }

    public boolean approvedNow() { return approvedNow; }

    public boolean appliedNow() { return appliedNow; }

    /**
     * Checks the chart about to be saved and works out what follows from it (QA review, QA status, the frozen baseline).
     *
     * @param before the chart as stored, or null for a new one
     * @param user   the person saving it
     * @return true when the change takes the chart off QA review (that needs trending.approve)
     */
    public boolean checkSave(TrendChart before, String user) {
        name = name == null ? null : name.strip();
        if (name == null || name.isEmpty()) throw RuleException.withCode("Give the chart a name", "23514");
        if (!SOURCES.contains(source)) throw RuleException.withCode("Unknown chart source: " + source, "23514");
        for (String r : rules) if (!RULES.contains(r)) throw RuleException.withCode("Unknown rule: " + r, "23514");
        if (before != null && !Objects.equals(siteId, before.siteId)) throw RuleException.database("A chart stays with its lab");
        if (before != null && (!Objects.equals(source, before.source) || !Objects.equals(params, before.params)) && before.frozenCl != null && Objects.equals(frozenCl, before.frozenCl))
            throw RuleException.database("The chart's limits are frozen for what it charts: unfreeze them before charting something else");
        if (frozenCl != null && (before == null || !Objects.equals(frozenCl, before.frozenCl) || !Objects.equals(frozenSigma, before.frozenSigma))) {
            if (frozenSigma == null || frozenSigma < 0 || frozenN == null || frozenN < 2)
                throw RuleException.database("Frozen limits need a centre line, a sigma and the baseline they came from (at least 2 points)");
            frozenBy = user;
            frozenNow = true;
        }
        if (frozenCl == null) { frozenSigma = null; frozenFrom = null; frozenTo = null; frozenN = null; frozenBy = null; }
        if (showInReview && !"qc".equals(source)) throw RuleException.database("Only QC charts are shown in QC Review");
        // a chart in QC Review is always QA reviewed
        if (showInReview && !qaReview) {
            if (before != null && before.qaReview && before.showInReview)
                throw RuleException.database("A chart shown in QC Review is always QA reviewed: take it out of QC Review first");
            qaReview = true;
        }
        if (before == null) {
            qaStatus = qaReview ? "Awaiting QA" : "Not required";
            qaApprovedBy = null; qaSignatureId = null; appliedVersionId = null; appliedBy = null;
            return false;
        }
        boolean offReview = before.qaReview && !qaReview;
        boolean changed = !Objects.equals(source, before.source) || !Objects.equals(params, before.params) || !Objects.equals(rules, before.rules)
            || !Objects.equals(frozenCl, before.frozenCl) || !Objects.equals(frozenSigma, before.frozenSigma);
        if (!qaReview) {
            qaStatus = "Not required"; qaApprovedBy = null; qaSignatureId = null;
        } else if (changed || !before.qaReview || "Inactive".equals(status) && !"Inactive".equals(before.status)) {
            qaStatus = "Inactive".equals(status) ? before.qaStatus : "Awaiting QA";
            if (!"Inactive".equals(status)) { qaApprovedBy = null; qaSignatureId = null; }
        }
        return offReview;
    }

    /** QA approves the chart and its limits: not a retired chart, only once, never by whoever made, changed or froze it. */
    public void approve(String user) {
        if (!"Active".equals(status)) throw RuleException.database("A retired chart is not approved");
        if (!qaReview) throw RuleException.database(code + " is not set for QA review");
        if ("Approved".equals(qaStatus)) throw RuleException.database(code + " is already approved");
        if (user.equals(createdBy) || user.equals(modifiedBy) || user.equals(frozenBy))
            throw RuleException.database("You made or changed " + code + " (or froze its limits): someone else approves it");
        qaStatus = "Approved";
        qaApprovedBy = user;
        approvedNow = true;
    }

    /** The chart's limits were carried into a test version: only a Draft version of the chart's test. */
    public void limitsApplied(String versionId, boolean draftOfTheChartsTest, String user) {
        if (!draftOfTheChartsTest) throw RuleException.database("The limits go into a Draft version of the chart's test");
        appliedVersionId = versionId;
        appliedBy = user;
        appliedNow = true;
    }
}
