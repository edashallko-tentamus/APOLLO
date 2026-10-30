package com.tentamus.lims.reports.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.web.RuleException;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The Report Finalization rules moved out of the database in migration 069 (they were checked by test_021a and test_022). */
class ReportsRulesTest {
    static String refusal(Runnable r) {
        try { r.run(); } catch (RuleException e) { return e.getMessage(); }
        return null;
    }

    static FinalizationClaim claim(String status) { return new FinalizationClaim("C1", "FB-000001", "CFL", "pm", "RF Project Manager", status); }

    @Test
    void claiming() {
        assertEquals("Choose the sample tests to claim", refusal(() -> FinalizationClaim.checkChoice(0, 0)));
        assertEquals("Claim sample tests of one lab at a time", refusal(() -> FinalizationClaim.checkChoice(1, 0)));
        assertEquals("Claim sample tests of one lab at a time", refusal(() -> FinalizationClaim.checkChoice(2, 2)));
        assertNull(refusal(() -> FinalizationClaim.checkChoice(2, 1)));
        assertEquals("WD Stability on S1: nothing waits for finalization",
            refusal(() -> FinalizationClaim.checkCandidates(List.of(new FinalizationClaim.Candidate("WD Stability", "S1", false, null)))));
        assertEquals("WD Stability on S1 is already claimed by RF Project Manager",
            refusal(() -> FinalizationClaim.checkCandidates(List.of(new FinalizationClaim.Candidate("WD Stability", "S1", true, "RF Project Manager")))));
        assertNull(refusal(() -> FinalizationClaim.checkCandidates(List.of(new FinalizationClaim.Candidate("WD Stability", "S1", true, null)))));
        assertNull(FinalizationClaim.note("  "));
        assertEquals("Checking a lot", FinalizationClaim.note(" Checking a lot "));
    }

    @Test
    void releasing() {
        assertTrue(claim("Active").checkRelease("pm", false, "Finalization released"));
        assertEquals("FB-000001 is claimed by RF Project Manager: only they, or a lab administrator, can release it",
            refusal(() -> claim("Active").checkRelease("other", false, "x")));
        assertEquals("Say why you release someone else's claim", refusal(() -> claim("Active").checkRelease("admin", true, "Finalization released")));
        assertEquals("Say why you release someone else's claim", refusal(() -> claim("Active").checkRelease("admin", true, "")));
        assertFalse(claim("Active").checkRelease("admin", true, "RF Project Manager is away today"));
        assertEquals("FB-000001 is released already", refusal(() -> claim("Released").checkRelease("pm", false, "x")));
        assertEquals("Done", FinalizationClaim.closedStatus(true));
        assertEquals("Released", FinalizationClaim.closedStatus(false));
    }

    @Test
    void notesAndAttachments() {
        assertEquals("Canned notes come from the COA comments list (Canned reasons)",
            refusal(() -> CoaNote.checkNew("S1", null, null, null, "R1", "Testing", "x")));
        assertEquals("That test is not on this sample", refusal(() -> CoaNote.checkNew("S1", "T1", "S2", null, null, null, "x")));
        assertNotNull(refusal(() -> CoaNote.checkNew("S1", null, null, "A1", null, null, "x")));
        assertNotNull(refusal(() -> CoaNote.checkNew("S1", null, null, null, null, null, " ")));
        assertNull(refusal(() -> CoaNote.checkNew("S1", "T1", "S1", "A1", "R1", "COA comments", "Result estimated")));
        assertEquals("That sample is not on this order", refusal(() -> SampleAttachment.checkNew("O1", "S1", "O2")));
        assertNull(refusal(() -> SampleAttachment.checkNew("O1", null, null)));
    }
}
