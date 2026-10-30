package com.tentamus.lims.testing.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The bench rules moved out of the database in migration 067 (they were checked by test_015, 016, 017, 018, 020, 021, 028 and 042). */
class BenchRulesTest {
    private static final Batch OPEN = new Batch("b1", "BAT-000001", "CFL", "t1", "v1", "In Progress", false, "WD Metals", 3);
    private static final StepDepartment IN = new StepDepartment("d1", "Chemistry", true);

    private static String refusal(Runnable r) {
        try { r.run(); } catch (RuleException e) { return e.getMessage(); }
        return null;
    }

    private static BenchStep step(String type, String status, Batch b, StepDepartment dep, boolean ready) {
        return new BenchStep("r1", b, "s1", "Weigh", type, status, "None", dep, ready, null, null, 1);
    }

    private static BatchEntry sample(String id, String status) {
        return new BatchEntry(id, "b1", "CFL261012001", "Sample", null, null, status, "Re-prep: Digest incomplete", null, "rt1", null, false);
    }

    private static BatchEntry qc(String id, String type, String cls) {
        return new BatchEntry(id, "b1", type, "QC", type, cls, "Active", null, null, null, null, false);
    }

    @Test
    void batches() {
        assertEquals("Batch BAT-000001 is Approved", refusal(() -> new Batch("b1", "BAT-000001", "CFL", "t", "v", "Approved", false, "X", 1).assertWorkable()));
        assertEquals("Batch BAT-000001 belongs to a workflow verification: only its automated run records work in it",
            refusal(() -> new Batch("b1", "BAT-000001", "CFL", "t", "v", "In Progress", true, "X", 1).assertWorkable()));
        assertEquals("That person cannot do bench work in this lab (testing.perform)", refusal(() -> OPEN.assertAssignable(false)));
        assertNull(refusal(() -> OPEN.assertAssignable(true)));
        assertEquals("Awaiting Review", Batch.statusAfterCompletion(true));      // a batch's status follows its steps
        assertEquals("In Progress", Batch.statusAfterCompletion(false));
        assertEquals("In Progress", new Batch("b", "B", "S", "t", "v", "Awaiting Review", false, "X", 1).statusAfterReopen());
        assertEquals("Batch BAT-000001 is Cancelled", refusal(() -> new Batch("b1", "BAT-000001", "CFL", "t", "v", "Cancelled", false, "X", 1).assertReprepAllowed()));
    }

    @Test
    void batchEdits() {
        assertEquals("Batch BAT-000001 has started (bench work is recorded), so samples can no longer be added or removed. Re-prep a sample, or cancel the batch.",
            refusal(() -> OPEN.assertSamplesChangeable(true)));
        assertEquals("Batch BAT-000001 is awaiting review: its samples can no longer change",
            refusal(() -> new Batch("b1", "BAT-000001", "CFL", "t", "v", "Awaiting Review", false, "X", 1).assertSamplesChangeable(false)));
        assertEquals("Batch BAT-000001 belongs to a workflow verification: its samples never change",
            refusal(() -> new Batch("b1", "BAT-000001", "CFL", "t", "v", "Open", true, "X", 1).assertSamplesChangeable(false)));
        assertEquals("Only samples waiting for the same test version (WD Metals v3) at this lab can join batch BAT-000001", refusal(() -> OPEN.assertJoinable(true)));
        assertEquals("Only samples are removed; the QC entries follow the number of samples", refusal(() -> qc("q", "CCV", "Analytical").assertRemovable(true)));
        assertEquals("CFL261012001 is the batch's only sample: cancel the batch instead", refusal(() -> sample("e", "Active").assertRemovable(false)));
        assertNull(refusal(() -> sample("e", "Active").assertRemovable(true)));
        // joining: the maximum holds, nothing waiting is refused
        BatchPlan.PoolItem one = new BatchPlan.PoolItem("rt9", null, false, 1, "LOT-N1", false, 0);
        assertEquals("Batch BAT-000001 is full: up to 2 samples per batch for this test (it has 2)", refusal(() -> BatchPlan.join(List.of(one), 2, 2, 10, "BAT-000001")));
        assertEquals("Those samples are no longer waiting in the backlog (another batch may have taken them)", refusal(() -> BatchPlan.join(List.of(), 2, 1, 10, "BAT-000001")));
        assertEquals(11, BatchPlan.join(List.of(one), 3, 2, 10, "BAT-000001").entries().get(0).position());
        // the brackets follow the client samples: 3 samples every 2 = 3 CCVs; back to 2 samples = 2
        BatchPlan.QcSpec ccv = new BatchPlan.QcSpec("CCV", "Analytical", "Every N", null, 2);
        assertEquals(List.of("CCV-3"), BatchPlan.BracketChange.of(ccv, 3, 2).add());
        assertEquals(1, BatchPlan.BracketChange.of(ccv, 2, 3).remove());
    }

    @Test
    void autobatchAndRunOrder() {
        List<BatchPlan.PoolItem> pool = List.of(new BatchPlan.PoolItem("rt1", null, false, 1, "S1", false, 0),
            new BatchPlan.PoolItem("rt2", null, false, 1, "S2", false, 0), new BatchPlan.PoolItem("rt3", null, false, 1, "S3", false, 0));
        List<BatchPlan.QcSpec> qc = List.of(new BatchPlan.QcSpec("Method Blank", "Prep", "Once", 1, null),
            new BatchPlan.QcSpec("Laboratory Control Sample", "Prep", "Once", 1, null), new BatchPlan.QcSpec("Matrix Spike", "Prep", "Once", 1, null),
            new BatchPlan.QcSpec("Matrix Spike Duplicate", "Prep", "Once", 1, null), new BatchPlan.QcSpec("ICV", "Analytical", "Once", 1, null),
            new BatchPlan.QcSpec("CCV", "Analytical", "Every N", null, 2));
        BatchPlan p = BatchPlan.make(pool, 20, qc, t -> null);
        List<BatchPlan.PlannedEntry> e = new ArrayList<>(p.entries());
        e.sort((a, b) -> Integer.compare(a.position(), b.position()));
        assertEquals(List.of("ICV", "CCV-1", "Method Blank", "Laboratory Control Sample", "S1", "Matrix Spike", "Matrix Spike Duplicate", "S2", "CCV-2", "S3", "CCV-3"),
            e.stream().map(BatchPlan.PlannedEntry::label).toList());
        assertEquals(e.get(4).id(), e.get(5).parentEntryId());                  // the spike is made from the first sample
        assertEquals("Nothing in the pool for this test at this lab", refusal(() -> BatchPlan.make(List.of(), 20, qc, t -> null)));
        // re-preps take one entry per replicate, numbered on; the maximum stops client samples, not media samples
        BatchPlan r = BatchPlan.make(List.of(new BatchPlan.PoolItem("rt1", "rp1", true, 2, "S1", false, 0), new BatchPlan.PoolItem("rt2", null, false, 1, "S2", false, 0),
            new BatchPlan.PoolItem("rt3", null, false, 1, "INV-1", true, 0)), 2, List.of(), t -> null);
        assertEquals(List.of("RP1-S1", "RP2-S1", "INV-1"), r.entries().stream().map(BatchPlan.PlannedEntry::label).toList());
        assertEquals(List.of("rp1"), r.batchedRepreps());
        // the day's control is shared from the batch that holds it
        BatchPlan d = BatchPlan.make(List.of(pool.get(0)), 5, List.of(new BatchPlan.QcSpec("Positive Control", null, "Daily", null, null)),
            t -> new BatchPlan.DailyControl("x1", "Prep", "BAT-000007"));
        assertEquals("Positive Control (daily, from BAT-000007)", d.entries().get(1).label());
        assertEquals("x1", d.entries().get(1).dailyOfEntryId());
    }

    @Test
    void entries() {
        assertEquals("CFL261012001 was superseded (Re-prep: Digest incomplete) and takes no more data", refusal(() -> sample("e", "Superseded").assertTakesData()));
        assertEquals("Laboratory Control Sample is a QC sample; QC is made again with the new batch", refusal(() -> qc("q", "Laboratory Control Sample", "Prep").assertReprepable()));
        assertEquals("CFL261012001 is already superseded", refusal(() -> sample("e", "Superseded").assertReprepable()));
        assertEquals("Choose single, duplicate or triplicate", refusal(() -> BatchEntry.assertReprepRequest(0, true)));
        assertEquals("Say why the sample is re-prepared", refusal(() -> BatchEntry.assertReprepRequest(2, false)));
        BatchEntry spike = qc("m", "Matrix Spike", "Prep");
        assertEquals("Batching is completed; reopen it to change which sample is spiked", refusal(() -> spike.assertSpikeParent(sample("e", "Active"), true)));
        assertEquals("A spike is made from a sample of the same batch", refusal(() -> spike.assertSpikeParent(qc("q", "ICV", "Analytical"), false)));
        assertEquals("Only matrix spikes are made from a sample", refusal(() -> qc("q", "ICV", "Analytical").assertSpikeParent(sample("e", "Active"), false)));
        assertNull(refusal(() -> spike.assertSpikeParent(sample("e", "Active"), false)));
    }

    @Test
    void steps() {
        assertEquals("\"Weigh\" is done by the Chemistry department; you are not in a group for it (Admin > Groups)",
            refusal(() -> step("Weighing", "In progress", OPEN, new StepDepartment("d1", "Chemistry", false), true).assertCanWork()));
        assertEquals("Batch BAT-000001 is Approved",
            refusal(() -> step("Weighing", "In progress", new Batch("b1", "BAT-000001", "CFL", "t", "v", "Approved", false, "X", 1), IN, true).assertCanWork()));
        assertEquals("This step is completed (signed); reopen it (with a reason) to change its data", refusal(() -> step("Weighing", "Completed", OPEN, IN, true).assertWritable()));
        assertEquals("\"Weigh\" cannot start until the steps before it are completed", refusal(() -> step("Weighing", "Not started", OPEN, IN, false).assertCanStart()));
        assertEquals("Batch BAT-000001 belongs to a workflow verification: only its automated run records work in it",
            refusal(() -> step("Data Entry", "In progress", new Batch("b1", "BAT-000001", "CFL", "t", "v", "Approved", true, "X", 1), IN, true).assertCanWork()));
        // completing
        Instant now = Instant.now();
        assertEquals("\"Weigh\" is already completed", refusal(() -> step("Weighing", "Completed", OPEN, IN, true).assertCompletable(List.of(), null, "u", now)));
        assertEquals("\"Weigh\" cannot be completed yet (2 things to do), e.g.: A: no weight",
            refusal(() -> step("Weighing", "In progress", OPEN, IN, true).assertCompletable(List.of("B: no weight", "A: no weight"), null, "u", now)));
        BenchStep witnessed = new BenchStep("r", OPEN, "s", "Digest", "Preparation", "In progress", "Required", IN, true, null, null, 1);
        assertEquals("\"Digest\" needs a witness: tick Witnessed and have the witness sign", refusal(() -> witnessed.assertCompletable(List.of(), null, "u", now)));
        assertEquals("The witness must be able to do bench work in this lab (testing.perform)",
            refusal(() -> witnessed.assertCompletable(List.of(), new Witness("w", "w2", "Witnessed by", now, false), "u", now)));
        assertEquals("The witness signature is not valid for this step",
            refusal(() -> witnessed.assertCompletable(List.of(), new Witness("w", "w2", "Performed by", now, true), "u", now)));
        assertEquals("The witness signature is not valid for this step",
            refusal(() -> witnessed.assertCompletable(List.of(), new Witness("w", "w2", "Witnessed by", now.minus(Duration.ofMinutes(31)), true), "u", now)));
        assertNull(refusal(() -> witnessed.assertCompletable(List.of(), new Witness("w", "w2", "Witnessed by", now, true), "u", now)));
        assertEquals("The witness must be someone else", refusal(() -> Witness.assertSomeoneElse("u", "u")));
        // reopening
        assertEquals("\"Weigh\" is not completed", refusal(() -> step("Weighing", "In progress", OPEN, IN, true).assertReopenable(true)));
        assertEquals("Say why the step is reopened", refusal(() -> step("Weighing", "Completed", OPEN, IN, true).assertReopenable(false)));
        assertEquals("Reopen the steps after it first (Digest)",
            refusal(() -> new BenchStep("r", OPEN, "s", "Weigh", "Weighing", "Completed", "None", IN, true, "Digest", null, 1).assertReopenable(true)));
        assertTrue(refusal(() -> new BenchStep("r", OPEN, "s", "Calc 7", "Calculation", "Completed", "None", IN, true, null, "Day 7 review", 1).assertReopenable(true))
            .startsWith("This step fed results already released as preliminary (Day 7 review)"));
        assertEquals("A QC Review is not reopened at the bench", refusal(() -> step("QC Review", "Completed", OPEN, IN, true).assertReopenable(true)));
        assertEquals(1, BenchStep.weighingReplicates(null));
        assertEquals(10, BenchStep.weighingReplicates("12"));
    }

    @Test
    void values() {
        BenchStep weigh = step("Weighing", "In progress", OPEN, IN, true);
        BenchStep read = step("Data Entry", "In progress", OPEN, IN, true);
        BatchEntry e = sample("e", "Active");
        assertEquals("A weight must be above zero", refusal(() -> new BenchValue(weigh, e, null, 1, 0.0, null, true, 1, 1).check(false, false)));
        assertEquals("This weighing takes 1 weight: there is no weighing 2", refusal(() -> new BenchValue(weigh, e, null, 2, 0.5, null, true, 1, 1).check(false, false)));
        BatchEntry other = new BatchEntry("x", "b2", "X", "Sample", null, null, "Active", null, null, "rt", null, false);
        assertEquals("The entry is not in this batch", refusal(() -> new BenchValue(weigh, other, null, 1, 0.5, null, true, 1, 1).check(false, false)));
        assertEquals("Reading 2 does not exist for CFL261012001: ask for a re-analysis first", refusal(() -> new BenchValue(read, e, "a", 2, 21.0, null, true, 1, 1).check(false, false)));
        assertEquals("That analyte is not on this test", refusal(() -> new BenchValue(read, e, "a", 1, 1.0, null, false, 1, 1).check(false, false)));
        assertEquals("CFL261012001 was superseded (Re-prep: Digest incomplete) and takes no more data",
            refusal(() -> new BenchValue(read, sample("e", "Superseded"), "a", 1, 1.0, null, true, 1, 1).check(false, false)));
        assertEquals("Plates are counted in whole numbers", refusal(() -> new BenchValue(step("Plating/Inoculation", "In progress", OPEN, IN, true), e, null, 1, 1.5, null, true, 1, 1).check(false, false)));
        assertEquals("Analytical run 3 does not exist: a further dilution is recorded with the run that reads it",
            refusal(() -> new BenchValue(step("Dilution", "In progress", OPEN, IN, true), e, null, 3, null, null, true, 1, 2).check(false, false)));
        assertEquals("A Reason for Change is required to modify entry_value (SET lims.reason)", refusal(() -> new BenchValue(read, e, "a", 1, 32.0, null, true, 1, 1).check(true, false)));
        assertNull(refusal(() -> new BenchValue(read, e, "a", 1, 32.0, null, true, 1, 1).check(true, true)));
        assertNull(BenchValue.text("   "));
        assertEquals("D*", BenchValue.text(" D* "));
    }

    @Test
    void equipment() {
        BenchStep weigh = step("Weighing", "In progress", OPEN, IN, true);
        assertEquals("EQ-3 is a WD ICP-MS, which this step does not use",
            refusal(() -> new EquipmentUse("EQ-3", "CFL", "Available", null, "Not required", "icp", "WD ICP-MS", List.of("bal")).check(weigh)));
        assertEquals("EQ-2 is out of calibration and cannot be used",
            refusal(() -> new EquipmentUse("EQ-2", "CFL", "Available", null, "Deficient", "bal", "WD Balance", List.of("bal")).check(weigh)));
        assertEquals("EQ-2 is tagged out and cannot be used (Repair)",
            refusal(() -> new EquipmentUse("EQ-2", "CFL", "Tagged out", "Repair", "Current", "bal", "WD Balance", List.of()).check(weigh)));
        assertEquals("EQ-2 belongs to another lab", refusal(() -> new EquipmentUse("EQ-2", "TPS", "Available", null, "Current", "bal", "B", List.of()).check(weigh)));
        assertEquals("Analytical run 5 does not exist at this step", refusal(() -> EquipmentUse.assertRunExists(5, 2)));
        assertNull(refusal(() -> EquipmentUse.assertRunExists(2, 2)));
    }

    @Test
    void materials() {
        BenchStep weigh = step("Weighing", "In progress", OPEN, IN, true);
        LocalDate today = LocalDate.of(2026, 10, 29);
        java.util.function.Function<Object[], MaterialUse> use = a -> new MaterialUse(weigh, null, (String) a[0], (Double) a[1], (String) a[2], "INV-1", (String) a[3],
            "Received", "Available", (LocalDate) a[4], null, List.of("Reference Standard"), "mL", true, (Boolean) a[5]);
        assertEquals("Lot INV-1 expired on 2026-10-28 and cannot be used", refusal(() -> use.apply(new Object[] {"Spike", 0.5, "mL", "CFL", today.minusDays(1), true}).check(today)));
        assertEquals("Lot INV-1 belongs to another lab", refusal(() -> use.apply(new Object[] {"Spike", 0.5, "mL", "TPS", null, true}).check(today)));
        assertEquals("Enter the amount of INV-1 used (and its unit): it is taken off the lot's stock",
            refusal(() -> use.apply(new Object[] {"Spike", null, null, "CFL", null, true}).check(today)));
        assertEquals("Lot INV-1 is counted in mL; g cannot be converted to it", refusal(() -> use.apply(new Object[] {"Spike", 1.0, "g", "CFL", null, false}).check(today)));
        assertEquals("Lot INV-1 is not a Microbiological Strain", refusal(() -> use.apply(new Object[] {"Strain", 1.0, "mL", "CFL", null, true}).check(today)));
        assertNull(refusal(() -> use.apply(new Object[] {"Spike", 0.5, "mL", "CFL", today, true}).check(today)));
        assertEquals("Remove the material and add the right one", refusal(() -> MaterialUse.assertChange(false)));
    }

    @Test
    void analyticalRuns() {
        BenchStep read = step("Data Entry", "In progress", OPEN, IN, true);
        List<AnalyticalRun.Candidate> c = List.of(new AnalyticalRun.Candidate("icv", "ICV", true, true, 1), new AnalyticalRun.Candidate("s1", "S1", true, false, 1),
            new AnalyticalRun.Candidate("s2", "S2", true, false, 9));
        assertEquals("Choose single, duplicate or triplicate", refusal(() -> AnalyticalRun.plan(read, List.of("s1"), 4, true, c)));
        assertEquals("Analytical runs (re-analysis) are added at a reading (Data Entry) step", refusal(() -> AnalyticalRun.plan(step("Dilution", "In progress", OPEN, IN, true), List.of("s1"), 1, true, c)));
        assertEquals("Choose the samples to read again in the new run", refusal(() -> AnalyticalRun.plan(read, List.of(), 1, true, c)));
        assertEquals("Say why the samples are read again (re-analysis)", refusal(() -> AnalyticalRun.plan(read, List.of("s1"), 1, false, c)));
        assertEquals("An entry is not active in this batch", refusal(() -> AnalyticalRun.plan(read, List.of("zz"), 1, true, c)));
        assertEquals("At most 10 readings per entry (S2 has 9)", refusal(() -> AnalyticalRun.plan(read, List.of("s2"), 2, true, c)));
        // a duplicate re-analysis: the sample's readings 2 and 3, and one reading of the run's ICV
        assertEquals(List.of(new AnalyticalRun.Reading("icv", 1, 2), new AnalyticalRun.Reading("s1", 2, 2)), AnalyticalRun.plan(read, List.of("s1"), 2, true, c));
    }

    @Test
    void furtherDilution() throws Exception {
        assertEquals("A further dilution needs an aliquot above zero and a diluent of zero or more",
            refusal(() -> AnalyticalRun.assertDilutable(BigDecimal.ZERO, BigDecimal.valueOf(9), true, true)));
        assertEquals("This test has no Dilution step: add the run without a further dilution", refusal(() -> AnalyticalRun.assertDilutable(BigDecimal.ONE, BigDecimal.ONE, true, false)));
        assertEquals("A further dilution goes with a run of the batch's last reading step", refusal(() -> AnalyticalRun.assertDilutable(BigDecimal.ONE, BigDecimal.ONE, false, true)));
        JsonNode base = new ObjectMapper().readTree("{\"fields\": [{\"aliquot\": 1, \"diluent\": 9}]}");
        JsonNode run2 = AnalyticalRun.furtherDilution("S1", base, BigDecimal.ONE, BigDecimal.valueOf(9), 2);
        assertEquals(0, AnalyticalRun.factor(run2).compareTo(BigDecimal.valueOf(100)));   // 10 x 10
        assertEquals(2, run2.get("for_run").asInt());
        assertEquals("S1 has no dilution recorded to dilute further", refusal(() -> AnalyticalRun.furtherDilution("S1", null, BigDecimal.ONE, BigDecimal.ONE, 2)));
        assertEquals(0, AnalyticalRun.factor(new ObjectMapper().readTree("{\"fields\": [{\"aliquot\": 10, \"diluent\": 40}]}")).compareTo(BigDecimal.valueOf(5)));
    }

    @Test
    void pick() {
        BenchStep read = step("Data Entry", "In progress", OPEN, IN, true);
        BatchEntry e = sample("e", "Active");
        assertEquals("Say why this reading is the one reported (e.g. run 1 was over the calibration range)",
            refusal(() -> new AnalystPick(OPEN, e, read, 2, null, true, 2, null, " ").check()));
        assertEquals("Reading 3 does not exist for CFL261012001", refusal(() -> new AnalystPick(OPEN, e, read, 3, null, true, 2, null, "x").check()));
        assertEquals("\"Signal error\" is not a result and cannot be reported", refusal(() -> new AnalystPick(OPEN, e, read, 1, null, true, 2, "Signal error", "x").check()));
        assertEquals("Batch BAT-000001 is Awaiting Review: the reviewer chooses in QC Review",
            refusal(() -> new AnalystPick(new Batch("b1", "BAT-000001", "CFL", "t", "v", "Awaiting Review", false, "X", 1), e, read, 1, null, true, 2, null, "x").check()));
        assertEquals("ICV is QC: its readings are judged, not picked", refusal(() -> new AnalystPick(OPEN, qc("q", "ICV", "Analytical"), read, 1, null, true, 2, null, "x").check()));
        assertEquals("This test has no reading step", refusal(() -> new AnalystPick(OPEN, e, null, 1, null, true, 0, null, "x").check()));
        assertEquals("Run 2: within range", new AnalystPick(OPEN, e, read, 2, null, true, 2, null, " Run 2: within range ").check());
        assertEquals("Pick not found", refusal(() -> AnalystPick.assertClearable(false, OPEN, read)));
    }

    @Test
    void splits() {
        assertEquals("Note who declined and how (e.g. email from the client)", refusal(() -> new SplitRequest("s", "Awaiting consent").decide("Declined", " ")));
        assertEquals("Record Consent given or Declined", refusal(() -> new SplitRequest("s", "Awaiting consent").decide("Ordered", "x")));
        assertEquals("This request is already ordered", refusal(() -> new SplitRequest("s", "Ordered").decide("Consent given", "x")));
        assertEquals("Sam Nguyen agreed by email", new SplitRequest("s", "Awaiting consent").decide("Consent given", " Sam Nguyen agreed by email "));
    }

    @Test
    void loads() {
        BenchStep inc = new BenchStep("r", OPEN, "s", "Incubate", "Incubation", "In progress", "None", IN, true, null, null, 1);
        Instant now = Instant.parse("2026-10-29T12:00:00Z");
        IncubationLoad l = new IncubationLoad("eq", List.of(), now.minusSeconds(7200), now.minusSeconds(3600), 35.0, " ", "Active").normalized();
        assertNull(l.entryIds());
        assertNull(l.note());
        assertNull(refusal(() -> l.check(inc, null, true, null, false, now)));
        assertEquals("Incubator loads belong to an Incubation step", refusal(() -> l.check(step("Weighing", "In progress", OPEN, IN, true), null, true, null, false, now)));
        assertEquals("Time out must be after time in",
            refusal(() -> new IncubationLoad("eq", null, now, now.minusSeconds(1), null, null, "Active").check(inc, null, true, null, false, now)));
        assertEquals("A time cannot be in the future",
            refusal(() -> new IncubationLoad("eq", null, now.plusSeconds(3600), null, null, null, "Active").check(inc, null, true, null, false, now)));
        assertEquals("An entry of the load is not in this batch", refusal(() -> l.check(inc, null, false, null, false, now)));
        IncubationLoad moved = new IncubationLoad("eq", null, now.minusSeconds(7000), now.minusSeconds(3600), 35.0, null, "Active");
        assertEquals("Changing a recorded load is a correction: give the reason", refusal(() -> moved.check(inc, l, true, null, false, now)));
        assertNull(refusal(() -> moved.check(inc, l, true, null, true, now)));
        // filling in time out the first time is not a correction
        IncubationLoad open = new IncubationLoad("eq", null, now.minusSeconds(7200), null, null, null, "Active");
        assertNull(refusal(() -> l.check(inc, open, true, null, false, now)));
    }

    @Test
    void departments() {
        assertEquals("Batching WD Metals is done by the Chemistry department; you are not in a group for it",
            refusal(() -> new StepDepartment("d", "Chemistry", false).assertCanBatch("WD Metals")));
        assertEquals("\"Weigh\" is done by the test's department; you are not in a group for it (Admin > Groups)",
            refusal(() -> new StepDepartment(null, null, true).assertCanPerform("Weigh")));
        assertTrue(new StepDepartment("d", "Chemistry", true).canPerform());
    }
}
