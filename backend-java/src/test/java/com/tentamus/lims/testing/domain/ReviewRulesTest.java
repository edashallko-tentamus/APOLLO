package com.tentamus.lims.testing.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.testing.domain.calc.AnalyteReporting;
import com.tentamus.lims.testing.domain.calc.Formula;
import com.tentamus.lims.testing.domain.calc.QcVerdict;
import com.tentamus.lims.testing.domain.calc.Rounding;
import com.tentamus.lims.testing.domain.calc.Serving;
import com.tentamus.lims.testing.domain.calc.Specification;
import com.tentamus.lims.testing.domain.calc.UnitConverter;
import com.tentamus.lims.testing.domain.review.ReviewBatch;
import com.tentamus.lims.testing.domain.review.ReviewItem;
import java.math.BigDecimal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** The QC Review rules and the calculation engine moved to Java in migration 068 (checked by test_011, 016, 018, 021a, 026, 034 and 042). */
class ReviewRulesTest {
    private static String refusal(Runnable r) {
        try { r.run(); } catch (RuleException e) { return e.getMessage(); }
        return null;
    }

    private static BigDecimal d(String s) { return new BigDecimal(s); }

    /** Mass, volume and per-mass units as the demo Units list converts them. */
    private static final UnitConverter UNITS = new UnitConverter() {
        final Map<String, BigDecimal> grams = Map.of("g", d("1"), "kg", d("1000"), "mg", d("0.001"), "µg", d("0.000001"));
        final Map<String, BigDecimal> ml = Map.of("mL", d("1"), "L", d("1000"));
        final Map<String, BigDecimal> conc = Map.of("mg/kg", d("1"), "µg/kg", d("0.001"));

        @Override
        public BigDecimal factor(String from, String to) {
            for (Map<String, BigDecimal> m : List.of(grams, ml, conc))
                if (m.containsKey(from) && m.containsKey(to)) return m.get(from).divide(m.get(to), Formula.MC);
            return null;
        }

        @Override
        public String dimension(String unit) { return grams.containsKey(unit) ? "Mass" : ml.containsKey(unit) ? "Volume" : null; }
    };

    @Test
    void formulaCheckAndEvaluation() {
        assertNull(Formula.of("max({a.b}, 2) * log10(100) / (1 + {c.d})").problem());
        assertTrue(Formula.of("{a.b} +").problem().contains("ends with an operator"));
        assertTrue(Formula.of("(2 * 3").problem().contains("not closed"));
        assertTrue(Formula.of("foo(2)").problem().contains("not a step token or a known function"));
        assertTrue(Formula.of("2 3").problem().contains("out of place"));
        assertTrue(Formula.of("1, 2").problem().contains("comma"));
        assertNotNull(Formula.of("").problem());
        assertEquals(Set.of("read.reading", "weigh.weight"), Formula.of("{read.reading} / {weigh.weight}").tokens());
        assertEquals(0, d("12.5").compareTo(Formula.of("{read.reading} * {dil.factor} * {digest.v} / 1000 / {weigh.weight}")
            .evaluate(Map.of("read.reading", d("25"), "dil.factor", d("5"), "digest.v", d("50"), "weigh.weight", d("0.5")))));
        assertEquals(0, d("16").compareTo(Formula.of("log10(1000) + max(2, {a.b}) - power(2, 3) * -1").evaluate(Map.of("a.b", d("5")))));
        assertEquals(0, d("4").compareTo(Formula.of("-2^2").evaluate(Map.of())));     // PostgreSQL: the sign binds first
        assertEquals(0, d("64").compareTo(Formula.of("2^3^2").evaluate(Map.of())));   // ^ is left associative
        assertEquals("No numeric value for {a.b}", refusal(() -> Formula.of("{a.b} * 2").evaluate(Map.of())));
        assertTrue(refusal(() -> Formula.of("1 / {a.b}").evaluate(Map.of("a.b", d("0")))).contains("divides by zero"));
        assertTrue(refusal(() -> Formula.of("1; DROP TABLE test").evaluate(Map.of())).contains("out of place"));
        assertTrue(refusal(() -> Formula.of("log10({c.reading})").evaluate(Map.of("c.reading", d("0")))).startsWith(Formula.LOG_OR_ROOT));
        assertTrue(Formula.agrees(d("10.000000000000000001"), d("10")));
        assertFalse(Formula.agrees(d("10.0001"), d("10")));
    }

    @Test
    void roundingAndReportedValues() {
        Rounding sig3 = new Rounding("Significant figures", 3), dp2 = new Rounding("Decimal places", 2), sig1 = new Rounding("Significant figures", 1);
        assertEquals("0.00123", sig3.round(d("0.0012345")).toPlainString());
        assertEquals("2.50", sig3.round(d("2.5")).toPlainString());
        assertEquals("1230", sig3.round(d("1234.5")).toPlainString());
        assertEquals("0.13", dp2.round(d("0.125")).toPlainString());
        assertEquals("0.002", sig1.round(d("0.0015")).toPlainString());
        assertEquals(0, d("0.0123").compareTo(Rounding.sig3(d("0.012345"))));
        assertEquals(0, d("1230").compareTo(Rounding.sig3(d("1234.5"))));
        AnalyteReporting lead = new AnalyteReporting(d("0.010"), d("0.005"), false, sig3);
        assertEquals("12.3", lead.report(d("12.3456")));
        assertEquals("< 0.010", lead.report(d("0.007")));
        assertEquals("ND", new AnalyteReporting(d("0.010"), d("0.005"), true, sig3).report(d("0.004")));
        assertEquals("1.235", new AnalyteReporting(null, null, false, new Rounding("Decimal places", 3)).report(d("1.23456")));
    }

    @Test
    void specificationAndServings() {
        Specification max05 = new Specification(null, d("0.5"), null, "mg/kg", Specification.AS_REPORTED);
        assertEquals("Conforms", max05.compare(d("0.5004"), null, "0.500", "mg/kg", null, null, UNITS).conformance());
        assertEquals("Conforms", max05.compare(d("0.004"), null, "< 0.010", "mg/kg", null, null, UNITS).conformance());
        assertEquals("Does not conform", max05.compare(d("0.51"), null, "0.510", "mg/kg", null, null, UNITS).conformance());
        assertEquals("Conforms", max05.compare(d("500"), null, "500", "µg/kg", null, null, UNITS).conformance());
        assertEquals("Does not conform", new Specification(d("1"), null, null, "mg/kg", Specification.AS_REPORTED).compare(null, null, "< 5", "mg/kg", null, null, UNITS).conformance());
        Specification text = new Specification(null, null, "Absent", null, Specification.AS_REPORTED);
        assertEquals("Does not conform", text.compare(null, "Present", "Present", null, List.of("Present"), null, UNITS).conformance());
        assertEquals("No specification", Specification.none().conformance());
        assertEquals(0, d("0.025").compareTo(Serving.perServing(d("10"), "mg/kg", d("2.5"), "g", UNITS).value()));
        assertEquals("mg per serving", Serving.perServing(d("10"), "mg/kg", d("2.5"), "g", UNITS).unit());
        assertEquals(0, d("5").compareTo(Serving.perServing(d("5"), "ppm", d("1"), "kg", UNITS).value()));
        assertEquals(0, d("0.06").compareTo(Serving.perServing(d("2"), "%", d("3"), "g", UNITS).value()));
        assertEquals("g per serving", Serving.perServing(d("2"), "%", d("3"), "g", UNITS).unit());
        assertNull(Serving.perServing(d("10"), "mg/kg", d("2"), "each", UNITS));
        assertNull(Serving.perServing(d("10"), "CFU", d("2"), "g", UNITS));
        // 15 mL at density 1.05 g/mL: 10 mg/kg is 0.1575 mg per serving; 2 mg/mL is 30 mg
        Serving liquid = new Serving(d("15"), "mL", d("1.05"), "g/mL", d("4"));
        assertEquals(0, d("0.1575").compareTo(liquid.of(d("10"), "mg/kg", UNITS).value()));
        assertEquals(0, d("30").compareTo(liquid.of(d("2"), "mg/mL", UNITS).value()));
        Specification perServing = new Specification(null, d("40"), null, "mg", "Per serving");
        assertEquals("mg per serving", perServing.compare(null, null, "2", "mg/mL", null, liquid, UNITS).specUnit());
        assertEquals("Conforms", perServing.compare(null, null, "2", "mg/mL", null, liquid, UNITS).conformance());
        assertEquals("Does not conform", new Specification(null, d("100"), null, "mg", "Per package").compare(null, null, "2", "mg/mL", null, liquid, UNITS).conformance());
        assertEquals("Not compared", perServing.compare(null, null, "2", "mg/mL", null, null, UNITS).conformance());
    }

    private static QcVerdict verdict(String limit, String verdict, Object measured) {
        Map<String, Object> r = new HashMap<>();
        r.put("entry_id", "E1"); r.put("label", "NC"); r.put("limit_type", limit); r.put("analyte_id", "A1"); r.put("analyte_name", "S. aureus");
        r.put("verdict", verdict); r.put("measured", measured); r.put("analytical_run", 1); r.put("run_no", 1);
        return new QcVerdict(r);
    }

    @Test
    void qcVerdicts() {
        assertTrue(QcVerdict.undefinedAtZero(Formula.LOG_OR_ROOT + " (x)", Map.of("count.reading", d("0"))));
        assertFalse(QcVerdict.undefinedAtZero(Formula.LOG_OR_ROOT, Map.of("count.reading", d("3"))));
        QcVerdict neg = verdict("Absence", "Waiting", null);
        neg.judgeOnZeroCount();
        assertEquals("Pass", neg.verdict());
        assertEquals(QcVerdict.ZERO_NOTE, neg.note());
        QcVerdict pos = verdict("Presence", "Waiting", null);
        pos.judgeOnZeroCount();
        assertEquals("Fail", pos.verdict());
        QcVerdict bad = verdict("Presence", "Pass", null);
        bad.invalidate("Signal error");
        assertTrue(bad.isInvalid());
        assertEquals("reading Signal error is not a result: read the control again in a new analytical run", bad.note());
        assertTrue(verdict("Recovery %", "Fail", d("60")).counts(Set.of(2), "Prep"));        // run 1 of a prep QC always counts
        assertFalse(verdict("Recovery %", "Fail", d("60")).counts(Set.of(2), "Analytical"));  // an unused run's CCV does not
        assertEquals("NC S. aureus Absence: fail, accept it with a justification or return the batch", verdict("Absence", "Fail", null).needsAcceptance());
    }

    private static ReviewItem item(List<ReviewItem.Candidate> c) {
        return new ReviewItem("RT", "A1", "Lead", "S1", "mg/kg", null, null, c, new AnalyteReporting(null, null, false, new Rounding("Significant figures", 3)), true);
    }

    @Test
    void choosingAndAveraging() {
        ReviewItem.Candidate r1 = new ReviewItem.Candidate("E1", 1, 1, d("15"), null), r2 = new ReviewItem.Candidate("E1", 2, 2, d("15.5"), null),
            r3 = new ReviewItem.Candidate("E1", 3, 2, d("16"), null);
        ReviewItem i = item(List.of(r1, r2, r3));
        assertEquals("That reading is not a result of this sample in this batch", refusal(() -> i.choosePick("E9", 1, null)));
        assertEquals("Write why this reading is the one reported (the sample has 3 readings)", refusal(() -> i.choosePick("E1", 2, " ")));
        assertEquals("Tick at least two readings to average", refusal(() -> i.chooseAverage(List.of(new ReviewItem.Reading("E1", 1)), null)));
        assertEquals("Write why 1 of the 3 readings are left out of the average",
            refusal(() -> i.chooseAverage(List.of(new ReviewItem.Reading("E1", 2), new ReviewItem.Reading("E1", 3)), null)));
        assertEquals("Only numeric readings of this sample in this batch can be averaged",
            refusal(() -> i.chooseAverage(List.of(new ReviewItem.Reading("E1", 2), new ReviewItem.Reading("E9", 3)), "x")));
        ReviewItem.Choice avg = i.chooseAverage(List.of(new ReviewItem.Reading("E1", 3), new ReviewItem.Reading("E1", 2)), "run 1 drifted");
        i.decide(avg, null, null, x -> Specification.none());
        assertEquals("15.8", i.reported());                // (15.5 + 16) / 2 = 15.75, rounded as the test says
        assertEquals("Average", i.basis());
        assertEquals(List.of(2, 2), i.runsUsed());   // both averaged readings are in run 2 (the batch keeps distinct runs)
        ReviewItem all = item(List.of(new ReviewItem.Candidate("E1", 1, 1, d("12"), null), new ReviewItem.Candidate("E1", 2, 1, d("12.4"), null),
            new ReviewItem.Candidate("E1", 3, 1, d("12.8"), null)));
        all.decide(all.chooseAverage(List.of(new ReviewItem.Reading("E1", 1), new ReviewItem.Reading("E1", 2), new ReviewItem.Reading("E1", 3)), null), null, null,
            x -> Specification.none());
        assertEquals(0, d("12.4").compareTo(all.value()));
        ReviewItem single = item(List.of(r1));
        single.decide(null, null, null, x -> Specification.none());
        assertTrue(single.chosen());
        assertEquals("Single", single.basis());
        ReviewItem picked = item(List.of(r1, r2));
        picked.decide(null, new ReviewItem.Choice("Pick", "E1", 2, "drift", null), "Ann Analyst", x -> Specification.none());
        assertEquals("Picked by the analyst (Ann Analyst): drift", picked.justification());
        assertEquals("S1 Lead: choose the reportable reading", item(List.of(r1, r2)).unresolved());
    }

    /** weigh -> calc7 -> rv7 (timepoint) -> calc14 (final) -> review; the batch waiting for review. */
    private static ReviewBatch batch(String status, String rv7Status, Set<String> marked) {
        List<ReviewBatch.Step> steps = List.of(
            new ReviewBatch.Step("s1", "weigh", "Weigh", "Weighing", 1, true, false, Set.of()),
            new ReviewBatch.Step("s2", "calc_7", "Day 7", "Calculation", 2, true, false, Set.of("s1")),
            new ReviewBatch.Step("s3", "rv_7", "Day 7 review", "QC Review", 3, true, true, Set.of("s1", "s2")),
            new ReviewBatch.Step("s4", "calc_14", "Day 14", "Calculation", 4, true, false, Set.of("s1", "s2", "s3")),
            new ReviewBatch.Step("s5", "review", "QC Review", "QC Review", 5, true, false, Set.of("s1", "s2", "s3", "s4")));
        List<ReviewBatch.Run> runs = List.of(new ReviewBatch.Run("r1", "s1", "Completed", "ann", null), new ReviewBatch.Run("r2", "s2", "Completed", "ann", "wit"),
            new ReviewBatch.Run("r3", "s3", rv7Status, null, null), new ReviewBatch.Run("r4", "s4", "Completed", "ann", null), new ReviewBatch.Run("r5", "s5", "Not started", null, null));
        return new ReviewBatch("B1", "BAT-000001", "CFL", status, false, steps, runs, marked, List.of(new ReviewBatch.Load("L1", "s1", "INC-1", "Weigh", "25 h, window 20 to 24 h", null)),
            List.of(), List.of(), Map.of(), List.of(), Map.of());
    }

    @Test
    void reviewersStepsTimepointsAndApproval() {
        ReviewBatch b = batch(ReviewBatch.AWAITING, "Not started", Set.of());
        assertEquals("You performed or witnessed a step of BAT-000001; someone else must review it", refusal(() -> b.assertCanReview("wit", false, () -> {})));
        assertNull(refusal(() -> b.assertCanReview("qa", false, () -> {})));
        assertEquals("calc_14", b.finalKey());
        assertEquals(1, b.timepoints().size());
        assertEquals(List.of("calc_7"), b.timepoints().get(0).keys());
        assertEquals("The QC Review is approved with the batch (Approve batch)", refusal(() -> b.markStep(b.run("r5"))));
        assertTrue(b.markStep(b.run("r1")));
        assertFalse(batch(ReviewBatch.AWAITING, "Not started", Set.of("r1")).markStep(b.run("r1")));   // approving twice changes nothing
        List<String> problems = b.problems(List.of(), List.of());
        assertTrue(problems.contains("Step \"Weigh\": not approved yet (open it and click Approve step)"));
        assertTrue(problems.contains("Incubator load in INC-1 (Weigh): 25 h, window 20 to 24 h; the reviewer accepts it with a justification"));
        assertTrue(refusal(() -> b.approve(problems)).startsWith("BAT-000001 cannot be approved yet (" + problems.size() + " things to resolve), e.g.: "));
        assertEquals("Write why the load is acceptable", refusal(() -> b.acceptLoad("L1", " ")));
        assertEquals("That load is not in this batch", refusal(() -> b.acceptLoad("L9", "ok")));
        assertEquals("Only a timepoint review (a QC Review set to Timepoint, before the final result) releases preliminary results", refusal(() -> b.release("r5", List.of())));
        assertEquals(List.of("r2", "r4"), b.returnTo("r2"));   // the step and the completed steps after it reopen
        // released: the steps that fed it keep their approval and cannot be reopened; the batch cannot be cancelled
        ReviewBatch released = batch(ReviewBatch.AWAITING, "Completed", Set.of("r1"));
        assertEquals("This step fed released preliminary results; its approval stands", refusal(() -> released.unmarkStep(released.run("r1"))));
        assertTrue(refusal(() -> released.returnTo("r2")).startsWith("This step fed results already released as preliminary (Day 7 review)"));
        assertEquals("\"Day 7 review\" is already released", refusal(() -> released.release("r3", List.of())));
        assertEquals("That timepoint's results are already released", refusal(() -> released.assertCanChoose("calc_7")));
        assertEquals("Batch BAT-000001 has released preliminary results and cannot be cancelled (the OOS and retest slice will handle this)",
            refusal(() -> released.cancel(true, true)));
        assertEquals("Cancelling a batch needs testing.assign or testing.review in this lab", refusal(() -> b.cancel(false, false)));
        assertEquals("Batch BAT-000001 is already approved", refusal(() -> batch("Approved", "Completed", Set.of()).cancel(true, false)));
        assertEquals("Batch BAT-000001 is In Progress, not waiting for review", refusal(() -> batch(ReviewBatch.IN_PROGRESS, "Not started", Set.of()).assertCanChoose(null)));
        // the timepoint is ready (steps before it completed): its steps can be approved while the batch is In Progress
        ReviewBatch inProgress = batch(ReviewBatch.IN_PROGRESS, "Not started", Set.of());
        assertTrue(inProgress.markStep(inProgress.run("r1")));
        assertTrue(refusal(() -> inProgress.markStep(inProgress.run("r4"))).contains("steps are approved once every bench step is completed"));
        assertEquals(List.of("Step \"Weigh\": not approved yet (open it and click Approve step)", "Step \"Day 7\": not approved yet (open it and click Approve step)",
            "Incubator load in INC-1 (Weigh): 25 h, window 20 to 24 h; the reviewer accepts it with a justification"), inProgress.timepointProblems("r3", List.of()));
        assertEquals("Not a timepoint review", inProgress.timepointProblems("r5", List.of()).get(0));
    }
}
