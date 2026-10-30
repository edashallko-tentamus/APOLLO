package com.tentamus.lims.oos.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.Objects;

/**
 * An OOS investigation (OOS-000001) and its signed steps: the automatic checks, the analyst and supervisor sections of
 * Full Phase I, cancelling, the retests, QA's retest determination and the client's Phase II decision. Replaces
 * record_oos_checks, sign_oos_analyst, sign_oos_supervisor, cancel_oos, order_oos_retest, record_retest_determination,
 * record_oos_phase2 and the guard oos_tables_rules (migration 069). The conclusion (with its report PDF) and the
 * client's answer through the link stay in the database for the Node backend (conclude_oos, record_oos_client_response).
 */
public record OosInvestigation(String id, String code, String siteId, String sampleId, String requestedTestId, String analyteId, String batchId,
                               String status, String procedure, String analystBy, String openedBy, String conclusion, boolean clientNotified,
                               String phase2Decision) {
    public static final String PHASE_I = "Full Phase I (21 CFR 211)";

    private String statusWord() { return status.toLowerCase(); }

    private void phaseIOnly() {
        if (!PHASE_I.equals(procedure)) throw RuleException.database(code + " follows Check and Acknowledge: one reviewer concludes it");
    }

    /** The automatic checks are kept as they were once the investigation is closed or cancelled. */
    public void checkChecksOpen() {
        if ("Closed".equals(status) || "Cancelled".equals(status)) throw RuleException.database(code + " is " + statusWord() + ": its checks are kept as they were");
    }

    /** Before the analyst section's permission and answers. */
    public void checkAnalystSection() {
        phaseIOnly();
        if (!"Open".equals(status)) throw RuleException.database(code + " is " + statusWord() + ": the analyst section is already signed");
    }

    /**
     * Before the supervisor section's permission and answers: after the analyst's, by someone else, independent of the
     * batch's bench work.
     */
    public void checkSupervisorSection(String me, boolean didBenchWork) {
        phaseIOnly();
        if (!"Analyst signed".equals(status)) throw RuleException.database(code + " is " + statusWord() + ": the supervisor section follows the analyst's");
        if (Objects.equals(analystBy, me)) throw RuleException.database("You signed the analyst section: a supervisor signs this one");
        if (didBenchWork) throw RuleException.database("You performed or witnessed a step of the batch: a supervisor independent of the bench work signs this section");
    }

    /** QA, or whoever opened it with oos.open, cancels it with a reason. */
    public void checkCancel(String me, boolean canApprove, boolean canOpen, String reason) {
        if ("Closed".equals(status) || "Cancelled".equals(status)) throw RuleException.database(code + " is already " + statusWord());
        if (!(canApprove || (Objects.equals(openedBy, me) && canOpen))) throw RuleException.database("Only QA (oos.approve) or whoever opened " + code + " can cancel it");
        if (reason == null || reason.strip().isEmpty()) throw RuleException.database("Say why " + code + " is cancelled");
    }

    /** What a retest is ordered as. */
    public record Retest(String source, String billingStatus, int replicates, String instructions, boolean invalidatesResults, String reason) {}

    /**
     * A lab investigation retest follows an assignable cause (not billed; the original results become invalid); a client
     * retest follows a confirmed OOS the client has been told of (billed by QA's later determination). Checked after
     * the orders.edit permission and the signature.
     *
     * @param retainedGone the sample records a retained quantity of zero or less
     * @param replaced     a retest of the test is already ordered
     */
    public Retest retest(String kind, Integer replicates, boolean retainedGone, String sampleCode, boolean replaced) {
        int reps = replicates == null ? 1 : replicates;
        if (!"Closed".equals(status)) throw RuleException.database(code + " is not concluded yet");
        if (reps < 1 || reps > 3) throw RuleException.database("A retest is single, duplicate or triplicate");
        if (retainedGone) throw RuleException.database("No retained sample is left for " + sampleCode + ": a retest needs a new sample");
        if (replaced) throw RuleException.database("A retest of this test is already ordered");
        boolean client;
        if ("Lab investigation".equals(kind)) {
            if (!"Assignable cause found".equals(conclusion)) throw RuleException.database("A lab investigation retest follows an assignable cause; " + code + " confirmed the OOS");
            client = false;
        } else if ("Client".equals(kind)) {
            if (!"OOS confirmed".equals(conclusion)) throw RuleException.database("A client retest follows a confirmed OOS");
            if (!clientNotified) throw RuleException.database("The client has not been told of the OOS yet (it is told when the result is released on the COA)");
            client = true;
        } else throw RuleException.database("Order a \"Lab investigation\" or a \"Client\" retest");
        String how = reps == 1 ? "single" : reps == 2 ? "in duplicate" : "in triplicate";
        return new Retest(client ? "Client OOS Retest" : "Lab Investigation Retest", client ? "Pending QA determination" : "Non-billable", reps,
            "Re-prep from the retained sample (" + code + "), " + how, !client, client ? "Client OOS retest ordered" : "Lab investigation retest ordered");
    }

    /** Ordering the client retest records the Phase II decision, unless one is recorded already. */
    public boolean recordsPhase2(Retest r) { return "Client OOS Retest".equals(r.source()) && phase2Decision == null; }

    /**
     * QA's determination after the client retest's result is approved; returns the retest's billing. Checked after the
     * oos.approve permission and the signature.
     */
    public String determine(boolean retestOrdered, boolean retestApproved, String already, String determination, String reason) {
        if (!retestOrdered) throw RuleException.database("No client retest was ordered for " + code);
        if (!retestApproved) throw RuleException.database("The retest has no approved result yet: QA determines the cause after QC Review");
        if (already != null) throw RuleException.database("The determination of " + code + " is already recorded");
        if (!java.util.List.of("Confirmed OOS", "Lab error", "Inconclusive").contains(determination))
            throw RuleException.database("Determine Confirmed OOS, Lab error or Inconclusive");
        if (reason == null || reason.strip().isEmpty()) throw RuleException.database("Give the evidence for the determination");
        return "Lab error".equals(determination) ? "Non-billable" : "Billable";
    }

    /** The client asked for no Phase II re-test: recorded once, after the confirmed OOS was released to them. */
    public void checkNoRetest(String decision, String note) {
        if (!"Closed".equals(status) || !"OOS confirmed".equals(conclusion)) throw RuleException.database(code + " is not a confirmed OOS");
        if (!clientNotified)
            throw RuleException.database("The client has not been told of " + code + " yet: it is emailed when the result is released on the COA (Report Finalization)");
        if (phase2Decision != null) throw RuleException.database("The Phase II decision of " + code + " is already recorded (" + phase2Decision + ")");
        if (!"No retest".equals(decision)) throw RuleException.database("Order the Phase II re-test with \"Order the client retest\" (it records the decision itself)");
        if (note == null || note.strip().isEmpty()) throw RuleException.database("Say how the client decided (who, when, how)");
    }

    /** The note the system prints on the final COA when the client asked for no re-test. */
    public String noRetestNote() {
        return "Out of specification (" + code + "): the laboratory investigation found no laboratory error; the client requested no Phase II re-test. The reported result stands.";
    }

    /** The client's answer is handled once. */
    public static void checkHandle(boolean handled) {
        if (handled) throw RuleException.database("Already handled");
    }

    /** Blank text kept as no text. */
    public static String text(String v) { return v == null || v.strip().isEmpty() ? null : v.strip(); }
}
