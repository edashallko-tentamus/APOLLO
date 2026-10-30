package com.tentamus.lims.testing.domain;

import com.tentamus.lims.core.web.RuleException;

/**
 * The analyst's pick of the reading reported for a sample (all its analytes, or one), with a note, while the batch is at
 * the bench (QC Review uses it unless the reviewer chooses otherwise). Replaces set_analyst_pick and clear_analyst_pick
 * (migration 067).
 *
 * @param readingStep the batch's last reading step, or null when the test has none
 * @param readings    the entry's readings at that step
 * @param invalid     the reading's text when it is not a result (e.g. "Signal error"), or null
 */
public record AnalystPick(Batch batch, BatchEntry entry, BenchStep readingStep, Integer runNo, String analyteId, boolean analyteOnTest,
                          int readings, String invalid, String note) {

    /** Refuses a pick the rules do not allow; returns the note to store. */
    public String check() {
        entry.assertPickable();
        batch.assertPickAllowed();
        assertReadingStep(readingStep);
        if (runNo == null || runNo < 1 || runNo > readings) throw RuleException.database("Reading " + runNo + " does not exist for " + entry.label());
        if (analyteId != null && !analyteOnTest) throw RuleException.database("That analyte is not on this test");
        if (invalid != null) throw RuleException.database("\"" + invalid + "\" is not a result and cannot be reported");
        String n = BenchValue.text(note);
        if (n == null) throw RuleException.database("Say why this reading is the one reported (e.g. run 1 was over the calibration range)");
        return n;
    }

    /** Taking a pick off: an active pick, while the batch is at the bench, by someone who may do the reading step. */
    public static void assertClearable(boolean active, Batch batch, BenchStep readingStep) {
        if (!active) throw RuleException.database("Pick not found");
        batch.assertPickAllowed();
        if (readingStep != null) readingStep.assertCanWork();
    }

    private static void assertReadingStep(BenchStep readingStep) {
        if (readingStep == null) throw RuleException.database("This test has no reading step");
        readingStep.assertCanWork();
    }
}
