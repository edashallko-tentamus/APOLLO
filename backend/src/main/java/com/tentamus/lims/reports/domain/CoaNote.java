package com.tentamus.lims.reports.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.Objects;

/**
 * A note on a sample, a test or one result: Internal (never printed) or printed on the COA, typed or canned. Replaces
 * the rule parts of coa_note_rules and the coa_note CHECKs (migration 069); the reports.notes permission check stays
 * in the database.
 */
public final class CoaNote {
    private CoaNote() {}

    /**
     * @param testSampleId the sample of the named test (null when no test is named or it does not exist)
     * @param cannedModule the module of the canned reason (null when none is named or it does not exist)
     */
    public static void checkNew(String sampleId, String testId, String testSampleId, String analyteId, String reasonId, String cannedModule, String text) {
        if (analyteId != null && testId == null) throw RuleException.withCode("A note on a result names its test", "23514");
        if (testId != null && !Objects.equals(testSampleId, sampleId)) throw RuleException.database("That test is not on this sample");
        if (reasonId != null && !"COA comments".equals(cannedModule)) throw RuleException.database("Canned notes come from the COA comments list (Canned reasons)");
        if (text == null || text.strip().isEmpty()) throw RuleException.withCode("Type the note, or choose a canned one", "23514");
    }
}
