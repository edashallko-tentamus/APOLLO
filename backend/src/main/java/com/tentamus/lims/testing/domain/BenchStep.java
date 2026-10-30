package com.tentamus.lims.testing.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.List;

/**
 * One workflow step of a batch (a step run): who may work on it, whether its data may still change, when it may start,
 * and its signed completion and reopening. Replaces assert_can_perform, assert_step_open, step_run_rules and the rules of
 * complete_step and reopen_step for Java's writes (migration 067); complete_step stays in the database for the demo data
 * load and Node's automated verification run.
 *
 * @param witnessMode       the step's witness setting: None, Optional or Required
 * @param prerequisitesDone whether every step it depends on is completed
 * @param laterCompleted    the completed steps that depend on it (comma-separated), or null
 * @param releasedTimepoint the released timepoint review it fed, or null
 * @param replicates        a Weighing step's weighings per entry (1 to 10)
 */
public record BenchStep(String runId, Batch batch, String stepId, String stepName, String stepType, String status, String witnessMode,
                        StepDepartment department, boolean prerequisitesDone, String laterCompleted, String releasedTimepoint, int replicates) {

    public boolean completed() { return "Completed".equals(status); }

    /** Who may record work here: not in a verification batch, the step's department, not in a closed batch. */
    public void assertCanWork() {
        if (batch.verification()) batch.assertWorkable();
        department.assertCanPerform(stepName);
        batch.assertWorkable();
    }

    /** Data of a completed (signed) step changes only after it is reopened. */
    public void assertOpen() {
        if (completed()) throw RuleException.database("This step is completed (signed); reopen it (with a reason) to change its data");
    }

    /** Recording anything at the step: someone who may work on it, while it is open. */
    public void assertWritable() {
        assertCanWork();
        assertOpen();
    }

    /** A step starts once the steps before it are completed. */
    public void assertCanStart() {
        if ("Not started".equals(status) && !prerequisitesDone)
            throw RuleException.database("\"" + stepName + "\" cannot start until the steps before it are completed");
    }

    /** A step that fed released preliminary results never changes. */
    public void assertNotReleased() {
        if (releasedTimepoint != null)
            throw RuleException.database("This step fed results already released as preliminary (" + releasedTimepoint
                + "), so it cannot change. Corrections to released results come with the OOS and retest slice");
    }

    /**
     * Refuses completing the step: already done, someone who may not work on it, data still missing, or a witness
     * missing or not valid.
     *
     * @param missing   what is still to do (step_run_missing), in the order the database lists it
     * @param witness   the witness's signature, or null
     * @param performer who signs as performer
     */
    public void assertCompletable(List<String> missing, Witness witness, String performer, java.time.Instant now) {
        if (completed()) throw RuleException.database("\"" + stepName + "\" is already completed");
        assertCanWork();
        if (!missing.isEmpty()) {
            String first = missing.stream().min(String::compareTo).get();   // min(problem), as the database chose it
            int n = missing.size();
            throw RuleException.database("\"" + stepName + "\" cannot be completed yet (" + n + " thing" + (n > 1 ? "s" : "") + " to do), e.g.: " + first);
        }
        if (witness != null) witness.assertValid(performer, now);
        else if ("Required".equals(witnessMode)) throw RuleException.database("\"" + stepName + "\" needs a witness: tick Witnessed and have the witness sign");
    }

    /** Refuses reopening: only a completed bench step, by someone who may work on it, with a reason, nothing after it completed. */
    public void assertReopenable(boolean reasonGiven) {
        if (!completed()) throw RuleException.database("\"" + stepName + "\" is not completed");
        if ("QC Review".equals(stepType)) throw RuleException.database("A QC Review is not reopened at the bench");
        assertCanWork();
        if (!reasonGiven) throw RuleException.database("Say why the step is reopened");
        assertNotReleased();
        if (laterCompleted != null) throw RuleException.database("Reopen the steps after it first (" + laterCompleted + ")");
    }

    /** A Weighing step's number of weighings from its config value (1 when absent, at most 10). */
    public static int weighingReplicates(Object configured) {
        if (configured == null || "".equals(configured.toString())) return 1;
        return Math.max(1, Math.min(10, Integer.parseInt(configured.toString())));
    }
}
