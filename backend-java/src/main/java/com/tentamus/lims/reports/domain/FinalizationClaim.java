package com.tentamus.lims.reports.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.List;
import java.util.Objects;

/**
 * A claim on finalization work (FB-000001): who is checking which sample tests, so nobody else finalizes them until
 * they are finished or released. No signature. Replaces claim_finalization, release_finalization_claim and the guard
 * finalization_claim_rules (migration 069). Finalizing closes the claim in the database (result_finalization_claims),
 * because finalizing stays in the Node backend.
 */
public record FinalizationClaim(String id, String code, String siteId, String claimedBy, String claimedByName, String status) {

    /** A sample test offered for claiming: whether it waits for finalization and who holds it now (null = nobody). */
    public record Candidate(String testName, String sampleCode, boolean awaitsFinalization, String holderName) {}

    /** Something to claim, all of one lab. Checked before the permission. */
    public static void checkChoice(int tests, int labs) {
        if (tests == 0) throw RuleException.database("Choose the sample tests to claim");
        if (labs != 1) throw RuleException.database("Claim sample tests of one lab at a time");
    }

    /** Each test waits for finalization and nobody holds it. Checked after the permission. */
    public static void checkCandidates(List<Candidate> tests) {
        for (Candidate c : tests) {
            if (!c.awaitsFinalization()) throw RuleException.database(c.testName() + " on " + c.sampleCode() + ": nothing waits for finalization");
            if (c.holderName() != null) throw RuleException.database(c.testName() + " on " + c.sampleCode() + " is already claimed by " + c.holderName());
        }
    }

    /** The note kept on the claim (blank = none). */
    public static String note(String note) {
        return note == null || note.strip().isEmpty() ? null : note.strip();
    }

    /**
     * Its claimer releases it; anyone else must be a lab administrator and say why (reason other than the default).
     *
     * @return true when the claimer releases it
     */
    public boolean checkRelease(String me, boolean labAdmin, String reason) {
        if (!"Active".equals(status)) throw RuleException.database(code + " is " + status.toLowerCase() + " already");
        if (Objects.equals(claimedBy, me)) return true;
        if (!labAdmin) throw RuleException.database(code + " is claimed by " + claimedByName + ": only they, or a lab administrator, can release it");
        if (reason == null || reason.isEmpty() || "Finalization released".equals(reason)) throw RuleException.database("Say why you release someone else's claim");
        return false;
    }

    /** What the claim becomes once none of its tests is still held: Done if any was finalized, else Released. */
    public static String closedStatus(boolean anyFinalized) { return anyFinalized ? "Done" : "Released"; }
}
