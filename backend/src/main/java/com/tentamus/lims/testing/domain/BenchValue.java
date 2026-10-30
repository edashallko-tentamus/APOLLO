package com.tentamus.lims.testing.domain;

import com.tentamus.lims.core.web.RuleException;

/**
 * A value recorded at a step for an entry (a weight, a dilution, a plate count, a reading per analyte and reading number).
 * New values are recorded under the person's name; a change is a correction and needs a Reason for Change. Replaces
 * entry_value_rules, entry_value_replicates_rule and entry_value_dilution_run (migration 067); a weight taken from a
 * scanned aliquot is the logbooks' rule and stays in the database.
 *
 * @param step          the step it is recorded at
 * @param entry         the entry it is for
 * @param analyteOnTest whether its analyte (if any) is an active analyte of the batch's test version
 * @param readings      the readings the entry has at a Data Entry step (1 plus every re-analysis)
 * @param analyticalRuns the analytical runs of the batch's reading step (a further dilution belongs to one)
 */
public record BenchValue(BenchStep step, BatchEntry entry, String analyteId, int runNo, Double valueNum, String valueText,
                         boolean analyteOnTest, int readings, int analyticalRuns) {

    /** Text is stored trimmed, an empty one as nothing. */
    public static String text(String v) {
        if (v == null) return null;
        String t = v.strip();
        return t.isEmpty() ? null : t;
    }

    /**
     * Refuses a value the bench rules do not allow.
     *
     * @param correction  whether it changes a value already recorded
     * @param reasonGiven whether a Reason for Change was given
     */
    public void check(boolean correction, boolean reasonGiven) {
        entry.assertIn(step.batch().id());
        step.assertWritable();
        entry.assertTakesData();
        if ("Plating/Inoculation".equals(step.stepType()) && valueNum != null && (valueNum < 0 || valueNum != Math.floor(valueNum)))
            throw RuleException.database("Plates are counted in whole numbers");
        step.assertCanStart();
        if (analyteId != null && !analyteOnTest) throw RuleException.database("That analyte is not on this test");
        if ("Data Entry".equals(step.stepType()) && runNo > readings)
            throw RuleException.database("Reading " + runNo + " does not exist for " + entry.label() + ": ask for a re-analysis first");
        if ("Weighing".equals(step.stepType())) {
            if (valueNum != null && valueNum <= 0) throw RuleException.database("A weight must be above zero");
            int n = step.replicates();
            if (runNo > n) throw RuleException.database("This weighing takes " + n + " weight" + (n > 1 ? "s" : "") + ": there is no weighing " + runNo);
        }
        if ("Dilution".equals(step.stepType()) && runNo > 1 && analyteId == null && runNo > analyticalRuns)
            throw RuleException.database("Analytical run " + runNo + " does not exist: a further dilution is recorded with the run that reads it");
        if (correction && !reasonGiven) throw RuleException.database("A Reason for Change is required to modify entry_value (SET lims.reason)");
    }
}
