package com.tentamus.lims.verification.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.web.RuleException;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The verification sign-off rules moved out of the database in migration 071 (they were checked by test_021). */
class VerificationRulesTest {
    private static String refusal(Runnable r) {
        try { r.run(); } catch (RuleException e) { return e.getMessage(); }
        return null;
    }

    @Test
    void approvingTheProtocol() {
        WorkflowVerification w = new WorkflowVerification("VER-000001", "Protocol draft", "ana", null, true, false);
        assertEquals("needs methods.verify", refusal(() -> w.approveProtocol("sup", false, "needs methods.verify")));
        assertEquals("You wrote this protocol, so someone else (QA) must approve it", refusal(() -> w.approveProtocol("ana", true, "")));
        assertNull(refusal(() -> w.approveProtocol("qa", true, "")));
        WorkflowVerification old = new WorkflowVerification("VER-000001", "Protocol draft", "ana", null, false, false);
        assertEquals("The version changed after VER-000001 was written: write a new verification protocol", refusal(() -> old.approveProtocol("qa", true, "")));
        WorkflowVerification approved = new WorkflowVerification("VER-000001", "Protocol approved", "ana", null, true, false);
        assertEquals("VER-000001 is Protocol approved, not a protocol waiting for approval", refusal(() -> approved.approveProtocol("qa", true, "")));
    }

    @Test
    void signingTheReport() {
        WorkflowVerification noEvidence = new WorkflowVerification("VER-000001", "Executed", "ana", "ana", true, false);
        assertEquals("You executed this verification, so someone else (QA) must sign its report", refusal(() -> noEvidence.signReport("ana", true, "", "Fine", Map.of(), List.of())));
        assertTrue(refusal(() -> noEvidence.signReport("qa", true, "", "Fine", Map.of(), List.of())).startsWith("Capture the evidence"));
        WorkflowVerification w = new WorkflowVerification("VER-000001", "Executed", "ana", "ana", true, true);
        assertEquals("Write the report's conclusion", refusal(() -> w.signReport("qa", true, "", " ", Map.of(), List.of())));
        assertEquals("FRS-02 was not tested: write why that is acceptable", refusal(() -> w.signReport("qa", true, "", "Fine", Map.of(), List.of("FRS-02"))));
        assertEquals(Map.of("FRS-02", "Covered by the rule tests"), w.signReport("qa", true, "", "Fine", Map.of("FRS-02", " Covered by the rule tests "), List.of("FRS-02")));
    }

    @Test
    void cancelling() {
        WorkflowVerification signed = new WorkflowVerification("VER-000001", "Report signed", "ana", "ana", true, true);
        assertEquals("VER-000001 is Report signed and cannot be cancelled", refusal(() -> signed.cancel(true, "", "x")));
        WorkflowVerification draft = new WorkflowVerification("VER-000002", "Protocol draft", "ana", null, true, false);
        assertEquals("Say why the verification is cancelled", refusal(() -> draft.cancel(true, "", "")));
        assertEquals("no permission", refusal(() -> draft.cancel(false, "no permission", "x")));
        assertNull(refusal(() -> draft.cancel(true, "", "Superseded")));
    }
}
