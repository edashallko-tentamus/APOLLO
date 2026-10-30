package com.tentamus.lims.training.domain;

import com.tentamus.lims.core.web.RuleException;
import java.time.LocalDate;
import java.util.Objects;
import java.util.Set;

/**
 * A competency attempt (initial or continuing, by training samples or by record): started by a trainer, evaluated by a
 * trainer (signed), decided by QA (signed), or withdrawn. Replaces start_competency_attempt, evaluate_competency_attempt,
 * decide_competency_attempt, withdraw_competency_attempt and the triggers competency_attempt_rules and
 * competency_evidence_rules (migration 071). Messages are the database's.
 */
public final class CompetencyAttempt {
    private final String id, code, userId, testId, siteId, kind, route;
    private String status, evaluation, evaluationNote, evaluatedBy, decisionNote, withdrawnReason;

    public CompetencyAttempt(String id, String code, String userId, String testId, String siteId, String kind, String route, String status,
                             String evaluation, String evaluationNote, String evaluatedBy) {
        this.id = id; this.code = code; this.userId = userId; this.testId = testId; this.siteId = siteId; this.kind = kind; this.route = route;
        this.status = status; this.evaluation = evaluation; this.evaluationNote = evaluationNote; this.evaluatedBy = evaluatedBy;
    }

    /** Who starts what, and the facts the rules need (read before the attempt exists). */
    public record Start(String trainer, String trainee, String kind, String route, String testName, String testSite, boolean trainerMayTrain,
                        boolean traineeActive, boolean traineeWorksHere, TrainingRule rule, boolean qualified, boolean openAttempt,
                        String description, LocalDate trainedOn, LocalDate today, Integer samples, int knownValues, boolean effectiveVersion) {}

    /** The start rules, in the database's order; returns the description to store (trimmed, null when blank). */
    public static String checkStart(Start s) {
        if (s.testSite() == null) throw RuleException.database("Choose a test of this lab");
        if (!s.trainerMayTrain()) throw RuleException.database("You may not start training on " + s.testName() + " (training.record, or department trained where the rule lets you train)");
        if (Objects.equals(s.trainee(), s.trainer())) throw RuleException.database("A trainer does not start their own training: ask another trainer");
        if (!s.traineeActive()) throw RuleException.database("Choose the person being trained");
        if (!s.traineeWorksHere()) throw RuleException.database("The person being trained does not work at this lab");
        if ("Training samples".equals(s.route()) && !s.rule().allowTrainingSamples()) throw RuleException.database("This department's rule does not use training samples");
        if ("Record".equals(s.route()) && !s.rule().allowRecords()) throw RuleException.database("This department's rule does not accept training records");
        if ("Continuing".equals(s.kind())) {
            if (!s.qualified()) throw RuleException.database("Continuing competency keeps up a qualification: the person has none for " + s.testName() + " (start an initial competency)");
        } else if ("Initial".equals(s.kind())) {
            if (s.qualified()) throw RuleException.database("The person is already qualified for " + s.testName() + " (record continuing competency instead)");
        } else throw RuleException.database("Initial or Continuing");
        if (s.openAttempt()) throw RuleException.database("The person already has an open competency attempt for " + s.testName());
        String desc = blank(s.description()) ? null : s.description().strip();
        if ("Record".equals(s.route())) {
            if (desc == null) throw RuleException.database("Describe the training (what was read, observed and done)");
            if (s.trainedOn() == null || s.trainedOn().isAfter(s.today())) throw RuleException.database("Give the date of the training (not in the future)");
        } else if ("Training samples".equals(s.route())) {
            if (s.samples() == null || s.samples() < 1 || s.samples() > 10) throw RuleException.database("Training samples: 1 to 10");
            if (s.knownValues() == 0) throw RuleException.database("Give the known value of at least one analyte");
            if (!s.effectiveVersion()) throw RuleException.database(s.testName() + " has no approved (Effective) version");
        } else throw RuleException.database("Training samples or Record");
        return desc;
    }

    /** The trainer evaluates (signed): never the trainee; training samples need their final results, a record its evidence. */
    public void evaluate(String evaluator, boolean evaluatorMayTrain, String result, String note, int testsWaiting, boolean hasEvidence) {
        if (!"In progress".equals(status)) throw RuleException.database(code + " is " + status + ": it is evaluated once");
        if (Objects.equals(evaluator, userId)) throw RuleException.database("Nobody evaluates their own competency");
        if (!evaluatorMayTrain) throw RuleException.database("You may not evaluate training on this test (training.record, or department trained where the rule lets you train)");
        if (!Set.of("Pass", "Conditional pass", "Fail").contains(String.valueOf(result))) throw RuleException.database("Pass, Conditional pass or Fail");
        if (!"Pass".equals(result) && blank(note)) throw RuleException.database("Say why (a conditional pass says what it is conditional on)");
        if ("Training samples".equals(route)) {
            if (testsWaiting > 0) throw RuleException.database(testsWaiting + " training sample test(s) have no approved final result yet (QC Review)");
        } else if (!hasEvidence) throw RuleException.database("Attach the evidence of the training first");
        status = "Evaluated";
        evaluation = result;
        evaluationNote = blank(note) ? null : note.strip();
        evaluatedBy = evaluator;
    }

    /** What QA's decision does to the qualification. */
    public enum Outcome { GRANT, KEEP_UP, NOTHING }

    /** QA decides (signed): never the trainee or the evaluator; a rejection says why. */
    public Outcome decide(String decider, boolean mayApprove, String approveText, String decision, String note) {
        if (!"Evaluated".equals(status)) throw RuleException.database(code + " is " + status + ": QA decides once it is evaluated");
        if (!mayApprove) throw RuleException.database(approveText);
        if (Objects.equals(decider, userId) || Objects.equals(decider, evaluatedBy)) throw RuleException.database("QA's approval is by someone other than the trainee and the evaluator");
        if (!"Approved".equals(decision) && !"Rejected".equals(decision)) throw RuleException.database("Approved or Rejected");
        if ("Rejected".equals(decision) && blank(note)) throw RuleException.database("Say why the evaluation is rejected");
        status = decision;
        decisionNote = blank(note) ? null : note.strip();
        if (!"Approved".equals(decision) || !("Pass".equals(evaluation) || "Conditional pass".equals(evaluation))) return Outcome.NOTHING;
        return "Initial".equals(kind) ? Outcome.GRANT : Outcome.KEEP_UP;
    }

    /** The qualification's condition after an approval: the note of a conditional pass, else none. */
    public String conditions() { return "Conditional pass".equals(evaluation) ? evaluationNote : null; }

    /** A trainer or QA withdraws an open attempt, with the reason. */
    public void withdraw(boolean mayWithdraw, String reason) {
        if (!"In progress".equals(status) && !"Evaluated".equals(status)) throw RuleException.database("Only an open attempt is withdrawn");
        if (!mayWithdraw) throw RuleException.database("A trainer or QA withdraws an attempt");
        if (blank(reason)) throw RuleException.database("Give the reason");
        status = "Withdrawn";
        withdrawnReason = reason.strip();
    }

    /** Evidence is attached while the attempt is in progress, by the trainee or a trainer. */
    public void checkEvidence(String user, boolean userMayTrain) {
        if (!"In progress".equals(status)) throw RuleException.database("Evidence is attached while the attempt is in progress");
        if (!userMayTrain && !Objects.equals(user, userId)) throw RuleException.database("Only the trainee or a trainer attaches evidence");
    }

    static boolean blank(String s) { return s == null || s.strip().isEmpty(); }

    public String id() { return id; }
    public String code() { return code; }
    public String userId() { return userId; }
    public String testId() { return testId; }
    public String siteId() { return siteId; }
    public String kind() { return kind; }
    public String route() { return route; }
    public String status() { return status; }
    public String evaluation() { return evaluation; }
    public String evaluationNote() { return evaluationNote; }
    public String evaluatedBy() { return evaluatedBy; }
    public String decisionNote() { return decisionNote; }
    public String withdrawnReason() { return withdrawnReason; }
}
