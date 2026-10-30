package com.tentamus.lims.orders.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.inventory.domain.Units;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** The order, sample, requested test, rush and email rules moved out of the database in migration 063 (test_003, 004, 022, 026, 028, 048, 050, 021a). */
class OrderRulesTest {
    private static final Units UNITS = new Units(List.of(
        new Units.Unit("1", "g", "Mass", true), new Units.Unit("2", "mL", "Volume", true), new Units.Unit("3", "each", "Count", true),
        new Units.Unit("4", "mg/kg", "Mass/Mass", true)), List.of());
    private static final SampleLists LISTS = new SampleLists(List.of("Powder", "Capsule"), List.of("Dietary supplement", "cGMP"), UNITS, List.of("capsule", "scoop"));

    private static String refusal(Runnable r) {
        try { r.run(); } catch (RuleException e) { return e.getMessage(); }
        return null;
    }

    private static Map<String, Object> m(Object... kv) {
        Map<String, Object> out = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) out.put((String) kv[i], kv[i + 1]);
        return out;
    }

    // ---------------------------------------------------------------- orders (test_003, test_048)
    @Test
    void whoMayOrder() {
        LabOrder.State neu = new LabOrder.State(null, "C", "Draft", "K", null, false);
        assertEquals("This client is Inactive and cannot place new orders",
            refusal(() -> LabOrder.change(null, neu).check(new LabOrder.Party("Inactive", true), null)));
        assertEquals("The ordering contact must be an active contact of this client with the Ordering role",
            refusal(() -> LabOrder.change(null, neu).check(new LabOrder.Party("Active", false), null)));
        assertNull(refusal(() -> LabOrder.change(null, neu).check(new LabOrder.Party("On Hold", true), null)));   // On Hold still orders
        LabOrder.State stored = new LabOrder.State("O", "C", "Draft", "K", null, true);
        assertFalse(LabOrder.change(stored, LabOrder.apply(stored, m("po_number", "PO-1"))).partyChosen());   // a PO change does not re-check who orders
        assertEquals("The client cannot be changed once samples are on the order",
            refusal(() -> LabOrder.change(stored, LabOrder.apply(stored, m("client_id", "D"))).check(new LabOrder.Party("Active", true), null)));
    }

    @Test
    void licenseOnTheOrder() {
        LabOrder.State stored = new LabOrder.State("O", "C", "Draft", "K", null, false);
        assertEquals("License LIC-00002 belongs to another client",
            refusal(() -> LabOrder.change(stored, LabOrder.apply(stored, m("client_license_id", "L2"))).check(null, new LabOrder.License("LIC-00002", "X", "Active"))));
        assertEquals("License LIC-00003 is retired: choose a current one",
            refusal(() -> LabOrder.change(stored, LabOrder.apply(stored, m("client_license_id", "L3"))).check(null, new LabOrder.License("LIC-00003", "C", "Retired"))));
        LabOrder.State named = new LabOrder.State("O", "C", "Draft", "K", "L3", false);
        assertFalse(LabOrder.change(named, LabOrder.apply(named, m("po_number", "x"))).licenseChecked());   // an order keeps a license retired later
    }

    @Test
    void orderStatusFollowsLogging() {
        assertEquals("Submitted", LabOrder.statusAfterLogging("Draft", true));   // a sample still expected
        assertEquals("Received", LabOrder.statusAfterLogging("Draft", false));
        assertEquals("Received", LabOrder.statusAfterLogging("Submitted", false));
        assertEquals("In Testing", LabOrder.statusAfterLogging("In Testing", false));
        assertTrue(LabOrder.stampsSubmitted("Submitted", null));
        assertFalse(LabOrder.stampsSubmitted("Submitted", "2026-10-05"));
    }

    // ---------------------------------------------------------------- samples
    @Test
    void matrixAndCategoryComeFromTheirLists() {
        Sample neu = Sample.of(null);
        assertEquals("Matrix \"Moon dust\" is not on the Matrix list. Pick one from the list, or ask an administrator to add it.",
            refusal(() -> neu.accept(m("matrix", "Moon dust"), LISTS, false)));
        assertEquals("Capsule", neu.accept(m("matrix", " capsule"), LISTS, false).get("matrix"));   // stored with the list's spelling
        assertNull(neu.accept(m("matrix", "  "), LISTS, false).get("matrix"));
        Sample old = Sample.of(m("matrix", "Retired matrix"));
        assertNull(refusal(() -> old.accept(m("matrix", "Retired matrix", "description", "x"), LISTS, false)));   // an Inactive matrix stays on an existing sample
        assertTrue(refusal(() -> neu.accept(m("compliance_category", "Cosmetics"), LISTS, false)).startsWith("Compliance category \"Cosmetics\" is not on the list"));
        assertEquals("cGMP", neu.accept(m("compliance_category", "CGMP"), LISTS, false).get("compliance_category"));
    }

    @Test
    void metrcId() {
        assertEquals("1A4060300001234000012345", MetrcId.normalize("1a40 6030 0001 2340 0001 2345"));
        assertTrue(refusal(() -> MetrcId.normalize("1A40603000012")).contains("not a METRC tag"));
        assertTrue(refusal(() -> MetrcId.normalize("2B4060300001234000012340")).contains("not a METRC tag"));
        assertNull(MetrcId.normalize("  "));
        assertEquals("1A4060300001234000012345", Sample.of(null).accept(m("metrc_id", "1a4060300001234000012345"), LISTS, false).get("metrc_id"));
    }

    @Test
    void loggedSampleNeedsAReasonAndKeepsItsId() {
        Sample logged = Sample.of(m("logged_at", "2026-10-05T17:00:00.000Z", "sample_code", "CFL261005001", "description", "Vanilla", "lab_order_id", "O",
            "quantity_received", new BigDecimal("500.000")));
        assertEquals("A Reason for Change is required to edit a logged sample", refusal(() -> logged.accept(m("description", "Chocolate"), LISTS, false)));
        assertNull(refusal(() -> logged.accept(m("description", "Chocolate"), LISTS, true)));
        assertNull(refusal(() -> logged.accept(m("quantity_received", 500), LISTS, false)));   // 500 = 500.000: nothing changed
        assertEquals("Sample code, logging time and order cannot be changed once a sample is logged",
            refusal(() -> logged.accept(m("lab_order_id", "P"), LISTS, true)));
        // a logged sample is cancelled only with a reason (test_050)
        assertEquals("A Reason for Change is required to edit a logged sample", refusal(() -> logged.accept(m("status", "Cancelled"), LISTS, false)));
    }

    @Test
    void quantitiesAreNotNegative() {
        assertTrue(refusal(() -> Sample.of(null).accept(m("quantity_received", -1), LISTS, false)).contains("sample_quantity_received_check"));
        assertTrue(refusal(() -> Sample.of(null).accept(m("number_of_units", 0), LISTS, false)).contains("sample_number_of_units_check"));
    }

    @Test
    void servingRules() {
        Sample s = Sample.of(m("id", "S"));
        assertTrue(refusal(() -> s.accept(m("serving_count", 2, "serving_count_unit", "scbox"), LISTS, false)).startsWith("The serving unit must be one of the serving units"));
        assertEquals("Say what the serving is counted in (e.g. 2 capsules)", refusal(() -> s.accept(m("serving_count", 2), LISTS, false)));
        assertTrue(refusal(() -> s.accept(m("serving_size", 2, "serving_unit", "each"), LISTS, false)).startsWith("Serving weight or volume unit \"each\" is not on the Units list"));
        assertTrue(refusal(() -> s.accept(m("quantity_unit", "blobs"), LISTS, false)).startsWith("Quantity unit \"blobs\""));
        assertEquals("Give the serving's weight or volume a unit (e.g. g or mL)", refusal(() -> s.accept(m("serving_size", 2), LISTS, false)));
        Map<String, Object> ok = s.accept(m("serving_size", 1.2, "serving_unit", "G", "serving_count", 2, "serving_count_unit", "Capsule"), LISTS, false);
        assertEquals("g", ok.get("serving_unit"));
        assertEquals("capsule", ok.get("serving_count_unit"));
        Sample logged = Sample.of(m("logged_at", "2026-10-05T17:00:00.000Z", "serving_size", 1.2, "serving_unit", "g"));
        assertEquals("A Reason for Change is required to change the serving of a logged sample", refusal(() -> logged.accept(m("serving_size", 1.5), LISTS, false)));
    }

    @Test
    void measuredValuesAreNeverTyped() {
        assertEquals("The measured unit weight and density come from their approved test results (Serving weight and Density tests)",
            refusal(() -> Sample.of(m("unit_weight", null)).accept(m("unit_weight", 0.6), LISTS, true)));
        assertNull(refusal(() -> Sample.of(m("unit_weight", new BigDecimal("0.6"))).accept(m("unit_weight", 0.6), LISTS, true)));
    }

    @Test
    void resultsPerServingOrderTheServingTest() {
        assertEquals("Serving weight", Sample.of(m("report_per_serving", false, "serving_unit", "g")).servingTestToOrder(m("report_per_serving", true), "Mass"));
        assertEquals("Density", Sample.of(null).servingTestToOrder(m("report_per_serving", true, "serving_unit", "mL"), "Volume"));
        assertNull(Sample.of(m("report_per_serving", true, "serving_unit", "g")).servingTestToOrder(m("description", "x"), "Mass"));   // already ticked
        assertEquals("Density", Sample.of(m("report_per_serving", true, "serving_unit", "g")).servingTestToOrder(m("serving_unit", "mL"), "Volume"));
        assertNull(Sample.of(m("report_per_serving", false)).servingTestToOrder(m("report_per_serving", false), null));
        assertEquals(ServingTestOrder.Way.ALREADY_ORDERED, new ServingTestOrder("Serving weight", "RT", null, "T", "CFL").way());   // ticked again: ordered once
        assertEquals(ServingTestOrder.Way.FROM_QUOTE, new ServingTestOrder("Density", null, "L", "T", "CFL").way());
        assertEquals(ServingTestOrder.Way.AT_CATALOGUE_PRICE, new ServingTestOrder("Density", null, null, "T", "CFL").way());
        assertEquals("No Density test with an approved workflow at CFL: mark one in the Test catalogue (\"Serving test\")",
            refusal(() -> new ServingTestOrder("Density", null, null, null, "CFL").way()));
    }

    @Test
    void cancellingAndLogging() {
        assertEquals("Sample CFL261005001 cannot be cancelled: Moisture on CFL261005001 has results (BAT-000003): it cannot be cancelled",
            refusal(() -> Sample.of(m("sample_code", "CFL261005001")).assertCancellable(List.of(RequestedTest.cancelProblem("Moisture on CFL261005001", "BAT-000003", null)))));
        assertNull(refusal(() -> Sample.of(m("sample_code", "X")).assertCancellable(List.of())));
        assertEquals("This lab logs samples only when they are received and the chain of custody is signed (\"Receive and sign\")",
            refusal(() -> Sample.assertLoggable(true)));
        assertEquals("Sample \"LOT-A1\" has no tests ordered; apply a project or add a test before logging it",
            refusal(() -> Sample.of(m("client_sample_id", "LOT-A1")).assertHasTests(0)));
    }

    @Test
    void sampleIds() {
        assertEquals("CFL261012001", SampleCode.of("CFL", LocalDate.of(2026, 10, 12), 1).value());
        assertEquals("CFL261012999", SampleCode.of("CFL", LocalDate.of(2026, 10, 12), 999).value());
        assertEquals("CFL2610121000", SampleCode.of("CFL", LocalDate.of(2026, 10, 12), 1000).value());
    }

    // ---------------------------------------------------------------- the TAT clock (test_003's worked examples)
    private static String due(TatClock c, String local, String zone, int n, String unit) {
        Instant at = java.time.LocalDateTime.parse(local).atZone(ZoneId.of(zone)).toInstant();
        LocalDate d0 = c.day0(at, LocalTime.of(14, 0), unit);
        return d0 + " -> " + c.due(d0, n, unit);
    }

    @Test
    void tatClock() {
        TatClock cfl = new TatClock(ZoneId.of("America/Los_Angeles"), Set.of(LocalDate.of(2026, 11, 26)));
        TatClock tps = new TatClock(ZoneId.of("America/New_York"), Set.of());
        String la = "America/Los_Angeles", b = TatClock.BUSINESS;
        assertEquals("2026-10-05 -> 2026-10-08", due(cfl, "2026-10-05T10:00", la, 3, b));
        assertEquals("2026-10-06 -> 2026-10-09", due(cfl, "2026-10-05T15:00", la, 3, b));   // after the cutoff
        assertEquals("2026-10-12 -> 2026-10-15", due(cfl, "2026-10-09T15:00", la, 3, b));
        assertEquals("2026-10-12 -> 2026-10-15", due(cfl, "2026-10-10T09:00", la, 3, b));   // Saturday, business days
        assertEquals("2026-10-10 -> 2026-10-15", due(cfl, "2026-10-10T09:00", la, 5, TatClock.CALENDAR));
        assertEquals("2026-11-25 -> 2026-12-01", due(cfl, "2026-11-25T10:00", la, 3, b));   // Thanksgiving skipped
        assertEquals("2026-10-05 -> 2026-10-08", due(cfl, "2026-10-05T16:30", "America/New_York", 3, b));
        assertEquals("2026-10-06 -> 2026-10-09", due(tps, "2026-10-05T16:30", "America/New_York", 3, b));
        assertEquals("2026-10-05 17:00:01.5+00", TatClock.clockStart("2026-10-05 17:00:00.25+00", "2026-10-05 17:00:01.5+00"));
        assertEquals("2026-10-05 17:00:00.25+00", TatClock.clockStart("2026-10-05 17:00:00.25+00", "2026-10-05 16:00:00+00"));
        assertEquals("In Pool", RequestedTest.statusWhenClockStarts("Ordered"));
    }

    // ---------------------------------------------------------------- requested tests (test_004, test_050)
    @Test
    void requestedTestChanges() {
        RequestedTest cancelled = new RequestedTest("T", null, "Cancelled", null, null, null, false);
        assertEquals("A cancelled test cannot be reinstated; order it again", refusal(() -> cancelled.checkChange(m("status", "Ordered"), true, null)));
        RequestedTest logged = new RequestedTest("T", null, "In Pool", null, null, null, true);
        assertEquals("A Reason for Change is required to change a test on a logged sample", refusal(() -> logged.checkChange(m("status", "Cancelled"), false, null)));
        assertEquals("A Reason for Change is required to override the turnaround (TAT)", refusal(() -> logged.checkChange(m("tat_override", 10), false, null)));
        assertTrue(refusal(() -> logged.checkChange(m("tat_override", -1), true, null)).contains("requested_test_tat_override_check"));
        assertNull(refusal(() -> logged.checkChange(m("tat_override", 10), true, null)));
        assertEquals("Moisture on CFL1 is in batch BAT-000001: take it out of the batch first (possible until bench work starts), or cancel the batch",
            refusal(() -> logged.checkChange(m("status", "Cancelled"), true, RequestedTest.cancelProblem("Moisture on CFL1", null, "BAT-000001"))));
    }

    @Test
    void orderingAQuotedTest() {
        assertEquals("V", new TestOrdering("Expected", true, "Active", "V").check());
        assertEquals("The sample is cancelled", refusal(() -> new TestOrdering("Cancelled", true, "Active", "V").check()));
        assertEquals("This test is not on an accepted quote for this client. Quote it, or record list price acceptance, first",
            refusal(() -> new TestOrdering("Expected", false, "Active", "V").check()));
        assertEquals("This client is Inactive and cannot order", refusal(() -> new TestOrdering("Expected", true, "Inactive", "V").check()));
        assertEquals("This test has no Effective version yet, so it cannot be ordered", refusal(() -> new TestOrdering("Expected", true, "Active", null).check()));
        assertEquals("That project has no accepted, orderable tests for this client", refusal(() -> TestOrdering.assertProjectOrderable(0, 0)));
        assertNull(refusal(() -> TestOrdering.assertProjectOrderable(0, 2)));   // its tests were already ordered
    }

    @Test
    void analyteTrimming() {
        assertEquals("That analyte is not on the client's quote; re-quote or accept list price to add it", refusal(() -> AnalyteTrim.assertQuoted(false)));
        Map<String, Object> stored = m("analyte_id", "A", "analyte_price", new BigDecimal("20.00"), "included", true);
        assertTrue(new AnalyteTrim("Ordered", false).checkChange(stored, m("included", false), false));
        assertEquals("A Reason for Change is required to change analytes on a logged sample",
            refusal(() -> new AnalyteTrim("In Pool", true).checkChange(stored, m("included", false), false)));
        assertEquals("The test is cancelled", refusal(() -> new AnalyteTrim("Cancelled", false).checkChange(stored, m("included", false), true)));
        assertEquals("Analyte and price are fixed on a requested analyte", refusal(() -> new AnalyteTrim("Ordered", false).checkChange(stored, m("analyte_price", 10), true)));
        assertEquals("At least one analyte must stay on the test (cancel the test instead)", refusal(() -> AnalyteTrim.assertOneLeft(0)));
    }

    // ---------------------------------------------------------------- rush decisions and the email (test_003)
    private static final RushDecision.Tier SAME_DAY = new RushDecision.Tier("SD", "Same Day", "S", 0);
    private static final RushDecision.Tier H48 = new RushDecision.Tier("48", "48 Hour", "S", 2);
    private static final RushDecision.Tier D5 = new RushDecision.Tier("D5", "5 Day", "S", 5);

    @Test
    void rushDecisions() {
        assertTrue(refusal(() -> new RushDecision("Not Accepted", H48, null, " ").check(new RushDecision.Rush("48", "Auto-accepted"))).contains("decline_needs_reason"));
        assertEquals("There is no open rush request for that tier on this test",
            refusal(() -> new RushDecision("Approved", SAME_DAY, null, null).check(new RushDecision.Rush("48", "Pending Approval"))));
        assertEquals("This rush does not need approval", refusal(() -> new RushDecision("Approved", H48, null, null).check(new RushDecision.Rush("48", "Auto-accepted"))));
        assertEquals("The replacement must be a slower tier on the same rush schedule, or standard turnaround",
            refusal(() -> new RushDecision("Not Accepted", H48, SAME_DAY, "x").check(new RushDecision.Rush("48", "Auto-accepted"))));
        RushDecision declined = new RushDecision("Not Accepted", H48, D5, "ICP-MS down for maintenance today");
        assertNull(refusal(() -> declined.check(new RushDecision.Rush("48", "Auto-accepted"))));
        assertEquals("Approved", declined.newStatus());   // replaced by a slower tier
        assertEquals("Not Accepted", new RushDecision("Not Accepted", H48, null, "x").newStatus());   // standard turnaround
    }

    @Test
    void rushNotAcceptedEmail() {
        RushDecision declined = new RushDecision("Not Accepted", H48, D5, "ICP-MS down for maintenance today");
        Map<String, Object> v = declined.emailValues("Maria", "Heavy Metals (ICP-MS)", "CFL261005002", "LOT-A2", "LO-000001", new BigDecimal("62"), BigDecimal.ZERO,
            LocalDate.of(2026, 10, 12), "Alex Kiddle", "CFL");
        assertEquals("5 Day rush", v.get("new_tier"));
        assertEquals("October 12, 2026", v.get("due_date"));
        assertEquals("62.00", v.get("old_fee"));
        assertEquals("0.00", v.get("new_fee"));
        EmailTemplate t = new EmailTemplate("Rush Not Accepted", "Rush request not accepted: {{test_name}} on {{sample}}",
            "Changed to: {{new_tier}}. Reason: {{reason}}. Processed by {{staff_name}}, {{site_name}}. {{unknown}}", true);
        EmailTemplate.Email e = t.email("maria@consult.com", "Maria Lopez", v);
        assertEquals("Rush request not accepted: Heavy Metals (ICP-MS) on CFL261005002", e.subject());
        assertEquals("Changed to: 5 Day rush. Reason: ICP-MS down for maintenance today. Processed by Alex Kiddle, CFL. {{unknown}}", e.body());
        assertEquals("set when the sample is logged", declined.emailValues("M", "T", null, null, "O", null, null, null, "A", "S").get("due_date"));
        assertEquals("(not yet logged)", declined.emailValues("M", "T", null, null, "O", null, null, null, "A", "S").get("sample_logged"));
        assertNull(new EmailTemplate("X", "s", "b", false).email("a", "b", v));   // a template switched off sends nothing
    }

    @Test
    void emailTemplates() {
        assertEquals("The system's templates are added by migrations; change the wording of an existing one instead", refusal(EmailTemplate::refuseNew));
        assertEquals("A template's code is what the system sends it for: it cannot change",
            refusal(() -> EmailTemplate.checkChange("COA Issued", m("template_code", "Other"))));
        assertNull(refusal(() -> EmailTemplate.checkChange("COA Issued", m("subject", "New wording"))));
        assertEquals("No email template \"Nope\"", refusal(() -> EmailTemplate.required(null, "Nope")));
    }
}
