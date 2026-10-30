package com.tentamus.lims.testing.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.List;
import java.util.Locale;

/**
 * A batch of one test version at one lab. Its status follows its steps (never set by hand), it keeps its lab and test,
 * and its samples change only while it is open and nothing is recorded at the bench. Replaces test_batch_rules,
 * assign_batch and the batch parts of assert_batch_editable, assert_can_perform and request_reprep (migration 067).
 */
public record Batch(String id, String code, String siteId, String testId, String versionId, String status, boolean verification, String testName, int versionNo) {

    public boolean closed() { return "Approved".equals(status) || "Cancelled".equals(status); }

    /** Bench work in an approved or cancelled batch is refused; a verification batch takes work only from its automated run. */
    public void assertWorkable() {
        if (verification) throw RuleException.database("Batch " + code + " belongs to a workflow verification: only its automated run records work in it");
        if (closed()) throw RuleException.database("Batch " + code + " is " + status);
    }

    /** Samples are added or removed only before bench work starts, and never in a verification batch. */
    public void assertSamplesChangeable(boolean started) {
        if (verification) throw RuleException.database("Batch " + code + " belongs to a workflow verification: its samples never change");
        if (!List.of("Open", "In Progress").contains(status))
            throw RuleException.database("Batch " + code + " is " + status.toLowerCase(Locale.ROOT) + ": its samples can no longer change");
        if (started)
            throw RuleException.database("Batch " + code + " has started (bench work is recorded), so samples can no longer be added or removed. Re-prep a sample, or cancel the batch.");
    }

    /** Only samples waiting for the same test version at the same lab join a batch. */
    public void assertJoinable(boolean someWaitForAnotherVersion) {
        if (someWaitForAnotherVersion)
            throw RuleException.database("Only samples waiting for the same test version (" + versionName() + ") at this lab can join batch " + code);
    }

    /** A batch goes only to someone who does bench work in its lab. */
    public void assertAssignable(boolean assigneeDoesBenchWork) {
        if (!assigneeDoesBenchWork) throw RuleException.database("That person cannot do bench work in this lab (testing.perform)");
    }

    /** Re-preps are asked for while the batch is at the bench or in review. */
    public void assertReprepAllowed() {
        if (closed()) throw RuleException.database("Batch " + code + " is " + status);
    }

    /** The analyst picks readings only while the batch is at the bench; after that the reviewer chooses. */
    public void assertPickAllowed() {
        if (!"In Progress".equals(status)) throw RuleException.database("Batch " + code + " is " + status + ": the reviewer chooses in QC Review");
    }

    /** Once every step before QC Review is completed the batch waits for review. */
    public static String statusAfterCompletion(boolean everyBenchStepCompleted) { return everyBenchStepCompleted ? "Awaiting Review" : "In Progress"; }

    /** A step reopened (or read again) brings a batch waiting for review back to the bench. */
    public String statusAfterReopen() { return "Awaiting Review".equals(status) ? "In Progress" : status; }

    /** "Test name vN", as the batch's test is named in refusals. */
    public String versionName() { return testName + " v" + versionNo; }
}
