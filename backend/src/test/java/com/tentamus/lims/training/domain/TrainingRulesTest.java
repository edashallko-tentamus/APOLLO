package com.tentamus.lims.training.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The training and competency rules moved out of the database in migration 071 (they were checked by test_046). */
class TrainingRulesTest {
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 29);
    private static final TrainingRule RULE = new TrainingRule(4, true, true, 12, 30, null, null, true, true);

    private static String refusal(Runnable r) {
        try { r.run(); } catch (RuleException e) { return e.getMessage(); }
        return null;
    }

    private static Map<String, Object> rule(Object... kv) {
        Map<String, Object> m = new HashMap<>(Map.of("site_id", "S", "department_id", "D", "due_soon_days", 30));
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    @Test
    void theRules() {
        assertNull(refusal(() -> TrainingRule.checked(null, rule("dept_trained_after", "1", "continuing_months", 6), "S")));
        assertTrue(refusal(() -> TrainingRule.checked(null, rule("min_runs", 3), "S")).contains("training_rule_runs"));   // runs and months go together
        assertNull(refusal(() -> TrainingRule.checked(null, rule("min_runs", 3, "min_runs_months", 12), "S")));
        assertTrue(refusal(() -> TrainingRule.checked(null, rule("allow_training_samples", false, "allow_records", false), "S")).contains("training_rule_routes"));
        assertTrue(refusal(() -> TrainingRule.checked(null, rule("dept_trained_after", 51), "S")).contains("dept_trained_after_check"));
        assertTrue(refusal(() -> TrainingRule.checked(null, rule("due_soon_days", 181), "S")).contains("due_soon_days_check"));
        assertEquals("The department belongs to another lab", refusal(() -> TrainingRule.checked(null, rule(), "OTHER")));
        assertEquals("A training rule stays with its lab and department", refusal(() -> TrainingRule.checked(rule(), rule("department_id", "D2"), "S")));
    }

    @Test
    void whoMayTrain() {
        assertTrue(TrainingRule.letsTrain(true, false, null, false));
        assertTrue(TrainingRule.letsTrain(false, true, RULE, true));   // department trained, the rule lets them train
        assertFalse(TrainingRule.letsTrain(false, true, new TrainingRule(4, true, false, 12, 30, null, null, true, true), true));   // turned off in the rule
        assertFalse(TrainingRule.letsTrain(false, true, RULE, false));
    }

    private static CompetencyAttempt.Start start(String trainer, String kind, String route, boolean mayTrain, boolean qualified, boolean open, String desc, Integer samples, int known) {
        return new CompetencyAttempt.Start(trainer, "ana", kind, route, "Metals", "S", mayTrain, true, true, RULE, qualified, open, desc, TODAY.minusDays(2), TODAY, samples, known, true);
    }

    @Test
    void startingAnAttempt() {
        assertTrue(refusal(() -> CompetencyAttempt.checkStart(start("ana", "Initial", "Record", false, false, false, "SOP", null, 0))).contains("may not start training"));
        assertEquals("A trainer does not start their own training: ask another trainer", refusal(() -> CompetencyAttempt.checkStart(start("ana", "Initial", "Record", true, false, false, "SOP", null, 0))));
        assertTrue(refusal(() -> CompetencyAttempt.checkStart(start("sup", "Initial", "Record", true, false, false, " ", null, 0))).startsWith("Describe the training"));
        assertTrue(refusal(() -> CompetencyAttempt.checkStart(start("sup", "Continuing", "Record", true, false, false, "Yearly", null, 0))).contains("has none"));
        assertTrue(refusal(() -> CompetencyAttempt.checkStart(start("sup", "Initial", "Record", true, true, false, "x", null, 0))).contains("already qualified"));
        assertTrue(refusal(() -> CompetencyAttempt.checkStart(start("sup", "Initial", "Record", true, false, true, "Again", null, 0))).contains("already has an open"));
        assertTrue(refusal(() -> CompetencyAttempt.checkStart(start("sup", "Initial", "Training samples", true, false, false, null, 2, 0))).contains("known value"));
        assertEquals("Training samples: 1 to 10", refusal(() -> CompetencyAttempt.checkStart(start("sup", "Initial", "Training samples", true, false, false, null, 11, 1))));
        assertEquals("Read the SOP", CompetencyAttempt.checkStart(start("sup", "Initial", "Record", true, false, false, " Read the SOP ", null, 0)));
        CompetencyAttempt.Start future = new CompetencyAttempt.Start("sup", "ana", "Initial", "Record", "Metals", "S", true, true, true, RULE, false, false, "x", TODAY.plusDays(1), TODAY, null, 0, true);
        assertEquals("Give the date of the training (not in the future)", refusal(() -> CompetencyAttempt.checkStart(future)));
        TrainingRule noRecords = new TrainingRule(4, true, true, 12, 30, null, null, true, false);
        CompetencyAttempt.Start rec = new CompetencyAttempt.Start("sup", "ana", "Initial", "Record", "Metals", "S", true, true, true, noRecords, false, false, "x", TODAY, TODAY, null, 0, true);
        assertEquals("This department's rule does not accept training records", refusal(() -> CompetencyAttempt.checkStart(rec)));
    }

    private static CompetencyAttempt attempt(String kind, String route) {
        return new CompetencyAttempt("A", "TA-00001", "ana", "T", "S", kind, route, "In progress", null, null, null);
    }

    @Test
    void initialCompetencyByRecord() {
        CompetencyAttempt a = attempt("Initial", "Record");
        assertTrue(refusal(() -> a.evaluate("sup", true, "Pass", null, 0, false)).contains("evidence"));
        assertEquals("Nobody evaluates their own competency", refusal(() -> a.evaluate("ana", true, "Pass", null, 0, true)));
        assertTrue(refusal(() -> a.evaluate("sup", true, "Fail", "", 0, true)).startsWith("Say why"));
        assertTrue(refusal(() -> a.evaluate("sup", true, "Conditional pass", null, 0, true)).contains("conditional on"));
        a.evaluate("sup", true, "Pass", null, 0, true);
        assertEquals("Evaluated", a.status());
        assertEquals("TA-00001 is Evaluated: it is evaluated once", refusal(() -> a.evaluate("sup", true, "Pass", null, 0, true)));
        assertEquals("No training.approve", refusal(() -> a.decide("qa", false, "No training.approve", "Approved", null)));
        assertEquals("QA's approval is by someone other than the trainee and the evaluator", refusal(() -> a.decide("sup", true, "", "Approved", null)));
        assertEquals("Say why the evaluation is rejected", refusal(() -> a.decide("qa", true, "", "Rejected", null)));
        assertEquals(CompetencyAttempt.Outcome.GRANT, a.decide("qa", true, "", "Approved", null));
        assertEquals("Approved", a.status());
    }

    @Test
    void continuingAndFailing() {
        CompetencyAttempt c = attempt("Continuing", "Record");
        c.evaluate("sup", true, "Conditional pass", " Repeat the digestion ", 0, true);
        assertEquals(CompetencyAttempt.Outcome.KEEP_UP, c.decide("qa", true, "", "Approved", null));
        assertEquals("Repeat the digestion", c.conditions());
        CompetencyAttempt f = attempt("Initial", "Record");
        f.evaluate("sup", true, "Fail", "Wrong dilutions", 0, true);
        assertEquals(CompetencyAttempt.Outcome.NOTHING, f.decide("qa", true, "", "Approved", null));   // approving a fail grants nothing
    }

    @Test
    void trainingSamples() {
        CompetencyAttempt t = attempt("Initial", "Training samples");
        assertEquals("2 training sample test(s) have no approved final result yet (QC Review)", refusal(() -> t.evaluate("sup", true, "Pass", null, 2, false)));
        KnownValue k = KnownValue.of(Map.of("analyte_id", "X", "value", 50, "tolerance_pct", 10));
        assertEquals(0, k.min().compareTo(new BigDecimal("45")));
        assertEquals(0, k.max().compareTo(new BigDecimal("55")));
        KnownValue given = KnownValue.of(Map.of("analyte_id", "X", "value", 50, "tolerance_pct", 10, "min", 40));
        assertEquals(0, given.min().compareTo(new BigDecimal("40")));
        assertEquals("A trainer or QA withdraws an attempt", refusal(() -> t.withdraw(false, "x")));
        assertEquals("Give the reason", refusal(() -> t.withdraw(true, " ")));
        t.withdraw(true, "Trainee moved to another bench");
        assertEquals("Withdrawn", t.status());
        assertEquals("Only an open attempt is withdrawn", refusal(() -> t.withdraw(true, "again")));
    }

    @Test
    void evidenceAndQualifications() {
        CompetencyAttempt a = attempt("Initial", "Record");
        assertNull(refusal(() -> a.checkEvidence("ana", false)));   // the trainee
        assertEquals("Only the trainee or a trainer attaches evidence", refusal(() -> a.checkEvidence("other", false)));
        a.withdraw(true, "x");
        assertEquals("Evidence is attached while the attempt is in progress", refusal(() -> a.checkEvidence("sup", true)));
        Qualification q = new Qualification("Q", "S", "Active");
        assertEquals("No training.approve", refusal(() -> q.withdraw(false, "No training.approve", "x")));
        assertEquals("Give the reason", refusal(() -> q.withdraw(true, "", "")));
        q.withdraw(true, "", " Left the chemistry bench ");
        assertEquals("Left the chemistry bench", q.withdrawnReason());
        assertEquals("Qualification not found", refusal(() -> q.withdraw(true, "", "again")));
    }
}
