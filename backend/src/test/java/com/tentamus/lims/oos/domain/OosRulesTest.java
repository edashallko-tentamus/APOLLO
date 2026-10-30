package com.tentamus.lims.oos.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The OOS investigation rules moved out of the database in migration 069 (they were checked by test_023). */
class OosRulesTest {
    static final String CA = "Check and Acknowledge";

    static String refusal(Runnable r) {
        try { r.run(); } catch (RuleException e) { return e.getMessage(); }
        return null;
    }

    static OosInvestigation oos(String procedure, String status, String conclusion, boolean notified) {
        return new OosInvestigation("X1", "OOS-000001", "CFL", "S1", "RT1", "A1", "B1", status, procedure, "ana", "sup", conclusion, notified, null);
    }

    static OosOpening.Result result(String conformance) {
        return new OosOpening.Result("R1", "B1", "12.0", new BigDecimal("12.0"), "ppm", conformance, null, null, new BigDecimal("10.0"), "ppm");
    }

    @Test
    void opening() {
        assertEquals("OOS-000001 is already open for this result", refusal(() -> OosOpening.check("OOS-000001", result("Does not conform"), null, null, null, null)));
        assertEquals("The approved result conforms to its specification: there is nothing to investigate",
            refusal(() -> OosOpening.check(null, result("Conforms"), null, null, null, null)));
        assertEquals("This result was already investigated (OOS-000002)", refusal(() -> OosOpening.check(null, result("Does not conform"), "OOS-000002", null, null, null)));
        assertEquals("Open the investigation from the batch's QC Review (the result is not approved yet)", refusal(() -> OosOpening.check(null, null, null, null, null, null)));
        assertEquals("That result is not in batch BAT-000001", refusal(() -> OosOpening.check(null, null, null, "B1", "BAT-000001", null)));
        assertEquals("The chosen reading conforms to its specification: there is nothing to investigate",
            refusal(() -> OosOpening.check(null, null, null, "B1", "BAT-000001", result("Conforms"))));
        OosOpening.Result r = OosOpening.check(null, null, null, "B9", "BAT-000009", result("Does not conform"));
        assertNull(r.resultId());
        assertEquals("B9", r.batchId());
        assertEquals("≤ 10.0 ppm", r.spec());
        assertEquals(OosInvestigation.PHASE_I, OosOpening.procedure(true, CA));
        assertEquals(CA, OosOpening.procedure(false, CA));
        assertEquals(30, OosOpening.closeWithin(null));
        assertEquals(10, OosOpening.closeWithin(10));
    }

    @Test
    void sectionsAndChecks() throws Exception {
        assertEquals("OOS-000001 follows Check and Acknowledge: one reviewer concludes it", refusal(() -> oos(CA, "Open", null, false).checkAnalystSection()));
        assertEquals("OOS-000001 is analyst signed: the analyst section is already signed", refusal(() -> oos(OosInvestigation.PHASE_I, "Analyst signed", null, false).checkAnalystSection()));
        assertEquals("OOS-000001 is open: the supervisor section follows the analyst's",
            refusal(() -> oos(OosInvestigation.PHASE_I, "Open", null, false).checkSupervisorSection("sup", false)));
        assertEquals("You signed the analyst section: a supervisor signs this one",
            refusal(() -> oos(OosInvestigation.PHASE_I, "Analyst signed", null, false).checkSupervisorSection("ana", false)));
        assertEquals("You performed or witnessed a step of the batch: a supervisor independent of the bench work signs this section",
            refusal(() -> oos(OosInvestigation.PHASE_I, "Analyst signed", null, false).checkSupervisorSection("sup", true)));
        assertEquals("OOS-000001 is closed: its checks are kept as they were", refusal(() -> oos(CA, "Closed", "OOS confirmed", false).checkChecksOpen()));
        ObjectMapper json = new ObjectMapper();
        List<Checklist.Item> items = List.of(new Checklist.Item("i1", "Correct sample"), new Checklist.Item("i2", "Balance checked"));
        assertEquals("Answer every item of the analyst section (Yes, No or N/A): \"Correct sample\"",
            refusal(() -> Checklist.check("Analyst", items, json.valueToTree(Map.of()))));
        assertEquals("Explain the \"No\" for: \"Balance checked\"",
            refusal(() -> Checklist.check("Analyst", items, json.valueToTree(Map.of("i1", Map.of("answer", "Yes"), "i2", Map.of("answer", "No"))))));
        assertNull(refusal(() -> Checklist.check("Analyst", items,
            json.valueToTree(Map.of("i1", Map.of("answer", "N/A"), "i2", Map.of("answer", "No", "comment", "Checked after"))))));
    }

    @Test
    void cancelling() {
        assertEquals("Only QA (oos.approve) or whoever opened OOS-000001 can cancel it", refusal(() -> oos(CA, "Open", null, false).checkCancel("ana", false, true, "x")));
        assertEquals("Say why OOS-000001 is cancelled", refusal(() -> oos(CA, "Open", null, false).checkCancel("sup", false, true, " ")));
        assertNull(refusal(() -> oos(CA, "Open", null, false).checkCancel("qa", true, false, "Opened in error")));
        assertEquals("OOS-000001 is already cancelled", refusal(() -> oos(CA, "Cancelled", null, false).checkCancel("qa", true, false, "x")));
    }

    @Test
    void retests() {
        OosInvestigation cause = oos(CA, "Closed", "Assignable cause found", false), confirmed = oos(OosInvestigation.PHASE_I, "Closed", "OOS confirmed", false);
        assertEquals("OOS-000001 is not concluded yet", refusal(() -> oos(CA, "Open", null, false).retest("Lab investigation", 1, false, "S1", false)));
        assertEquals("A retest is single, duplicate or triplicate", refusal(() -> cause.retest("Lab investigation", 4, false, "S1", false)));
        assertEquals("No retained sample is left for S1: a retest needs a new sample", refusal(() -> cause.retest("Lab investigation", 1, true, "S1", false)));
        assertEquals("A retest of this test is already ordered", refusal(() -> cause.retest("Lab investigation", 1, false, "S1", true)));
        assertEquals("A client retest follows a confirmed OOS", refusal(() -> cause.retest("Client", 1, false, "S1", false)));
        assertEquals("A lab investigation retest follows an assignable cause; OOS-000001 confirmed the OOS", refusal(() -> confirmed.retest("Lab investigation", 1, false, "S1", false)));
        assertEquals("The client has not been told of the OOS yet (it is told when the result is released on the COA)",
            refusal(() -> confirmed.retest("Client", 1, false, "S1", false)));
        assertEquals("Order a \"Lab investigation\" or a \"Client\" retest", refusal(() -> cause.retest("Other", 1, false, "S1", false)));
        OosInvestigation.Retest lab = cause.retest("Lab investigation", 2, false, "S1", false);
        assertEquals("Lab Investigation Retest", lab.source());
        assertEquals("Non-billable", lab.billingStatus());
        assertTrue(lab.invalidatesResults());
        assertEquals("Re-prep from the retained sample (OOS-000001), in duplicate", lab.instructions());
        OosInvestigation told = oos(OosInvestigation.PHASE_I, "Closed", "OOS confirmed", true);
        OosInvestigation.Retest client = told.retest("Client", null, false, "S1", false);
        assertEquals("Pending QA determination", client.billingStatus());
        assertEquals(1, client.replicates());
        assertTrue(told.recordsPhase2(client));
        assertFalse(told.recordsPhase2(lab));
    }

    @Test
    void determinationPhase2AndAnswers() {
        OosInvestigation x = oos(OosInvestigation.PHASE_I, "Closed", "OOS confirmed", true);
        assertEquals("No client retest was ordered for OOS-000001", refusal(() -> x.determine(false, false, null, "Lab error", "x")));
        assertEquals("The retest has no approved result yet: QA determines the cause after QC Review", refusal(() -> x.determine(true, false, null, "Lab error", "x")));
        assertEquals("The determination of OOS-000001 is already recorded", refusal(() -> x.determine(true, true, "Lab error", "Lab error", "x")));
        assertEquals("Determine Confirmed OOS, Lab error or Inconclusive", refusal(() -> x.determine(true, true, null, "Maybe", "x")));
        assertEquals("Give the evidence for the determination", refusal(() -> x.determine(true, true, null, "Lab error", "")));
        assertEquals("Non-billable", x.determine(true, true, null, "Lab error", "Pipette out of calibration"));
        assertEquals("Billable", x.determine(true, true, null, "Inconclusive", "No cause found"));
        assertEquals("OOS-000001 is not a confirmed OOS", refusal(() -> oos(CA, "Closed", "Assignable cause found", true).checkNoRetest("No retest", "x")));
        assertTrue(refusal(() -> oos(OosInvestigation.PHASE_I, "Closed", "OOS confirmed", false).checkNoRetest("No retest", "x")).startsWith("The client has not been told"));
        assertEquals("Say how the client decided (who, when, how)", refusal(() -> x.checkNoRetest("No retest", " ")));
        assertNull(refusal(() -> x.checkNoRetest("No retest", "Kim Diaz by phone")));
        assertTrue(x.noRetestNote().startsWith("Out of specification (OOS-000001)"));
        assertEquals("Already handled", refusal(() -> OosInvestigation.checkHandle(true)));
    }
}
