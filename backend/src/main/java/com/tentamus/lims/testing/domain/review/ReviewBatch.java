package com.tentamus.lims.testing.domain.review;

import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.testing.domain.calc.QcVerdict;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;

/**
 * A batch in QC Review: its steps and the reviewer's approval of each, the results to report (final and per timepoint),
 * the QC checks, incubator loads and what the reviewer accepted. Java's own copy of the review rules of migrations
 * 018 to 022, 034, 035, 039 and 048 (assert_can_review, assert_can_choose, batch_review_problems and its wrappers,
 * timepoint_problems, batch_timepoints, step_feeds_release, batch_used_runs, qc_verdict_counts, approve_review_step,
 * withdraw_review_step, accept_qc, accept_load, release_timepoint, approve_batch, return_batch, cancel_batch). The
 * database keeps those functions because the workflow verification run (Node) and the demo data load still call them.
 */
public final class ReviewBatch {
    public static final String AWAITING = "Awaiting Review";
    public static final String IN_PROGRESS = "In Progress";

    /** A step of the test version, with the steps before it (step_ancestors). */
    public record Step(String id, String key, String name, String type, int sortOrder, boolean active, boolean timepointScope, Set<String> ancestors) {}

    /** A step's run in this batch. */
    public record Run(String id, String stepId, String status, String performedBy, String witnessId) {
        boolean completed() { return "Completed".equals(status); }
    }

    /** An incubator load and the check text the reviewer accepted, if any. */
    public record Load(String id, String stepId, String equipmentCode, String stepName, String checkText, String acceptedCheck) {
        boolean open() { return checkText != null && !Objects.equals(checkText, acceptedCheck); }

        String problem() { return "Incubator load in " + equipmentCode + " (" + stepName + "): " + checkText + "; the reviewer accepts it with a justification"; }
    }

    /** QC accepted by the reviewer. */
    public record Acceptance(String entryId, String analyteId, String limitType, int run) {}

    /** A reading that is not a result. */
    public record InvalidReading(String entryId, String entryType, String sampleLabel, String analyteId, String analyteName, int runNo, String valueText) {}

    /** A timepoint review (a QC Review set to Timepoint before the final result) and the Calculation keys it releases. */
    public record Timepoint(Run run, Step step, List<String> keys, boolean released, boolean ready) {}

    private final String id, code, siteId, status;
    private final boolean verification;
    private final List<Step> steps;
    private final Map<String, Run> runsByStep = new LinkedHashMap<>();
    private final Set<String> marked;
    private final List<Load> loads;
    private final List<QcVerdict> verdicts;
    private final List<Acceptance> accepted;
    private final Map<String, String> qcClass;
    private final List<InvalidReading> invalid;
    private final Map<String, List<ReviewItem>> items;   // by result key ("" = the final result)

    public ReviewBatch(String id, String code, String siteId, String status, boolean verification, List<Step> steps, Collection<Run> runs, Set<String> marked,
                       List<Load> loads, List<QcVerdict> verdicts, List<Acceptance> accepted, Map<String, String> qcClass, List<InvalidReading> invalid,
                       Map<String, List<ReviewItem>> items) {
        this.id = id;
        this.code = code;
        this.siteId = siteId;
        this.status = status;
        this.verification = verification;
        this.steps = steps;
        for (Run r : runs) runsByStep.put(r.stepId(), r);
        this.marked = marked;
        this.loads = loads;
        this.verdicts = verdicts;
        this.accepted = accepted;
        this.qcClass = qcClass;
        this.invalid = invalid;
        this.items = items;
    }

    public String id() { return id; }
    public String code() { return code; }
    public String siteId() { return siteId; }
    public String status() { return status; }
    public boolean awaiting() { return AWAITING.equals(status); }
    public List<QcVerdict> verdicts() { return verdicts; }

    // ------------------------------------------------------------ the version's shape: final result and timepoints
    private Step step(String stepId) { return steps.stream().filter(s -> s.id().equals(stepId)).findFirst().orElse(null); }

    /** The test's final result: its last Calculation step (final_calc_key). */
    public String finalKey() {
        return steps.stream().filter(s -> s.active() && "Calculation".equals(s.type()))
            .max(Comparator.comparingInt((Step s) -> s.ancestors().size()).thenComparingInt(Step::sortOrder)).map(Step::key).orElse(null);
    }

    /** The Calculation steps a timepoint review releases (timepoint_keys). */
    List<String> timepointKeys(Step s) {
        String fin = finalKey();
        return steps.stream().filter(x -> s.ancestors().contains(x.id()) && x.active() && "Calculation".equals(x.type()) && !Objects.equals(x.key(), fin))
            .sorted(Comparator.comparingInt(Step::sortOrder)).map(Step::key).toList();
    }

    /** The batch's timepoint reviews (batch_timepoints). */
    public List<Timepoint> timepoints() {
        String fin = finalKey();
        List<Timepoint> out = new ArrayList<>();
        steps.stream().filter(s -> "QC Review".equals(s.type()) && s.timepointScope() && runsByStep.containsKey(s.id()))
            .filter(s -> s.ancestors().stream().map(this::step).noneMatch(a -> a != null && Objects.equals(a.key(), fin)))
            .sorted(Comparator.comparingInt(Step::sortOrder).thenComparing(Step::name))
            .forEach(s -> {
                List<String> keys = timepointKeys(s);
                if (keys.isEmpty()) return;
                Run r = runsByStep.get(s.id());
                boolean ready = s.ancestors().stream().map(runsByStep::get).filter(Objects::nonNull).allMatch(Run::completed);
                out.add(new Timepoint(r, s, keys, r.completed(), ready));
            });
        return out;
    }

    private Set<String> releasedKeys() {
        Set<String> done = new LinkedHashSet<>();
        for (Timepoint t : timepoints()) if (t.released()) done.addAll(t.keys());
        return done;
    }

    private Timepoint timepointOf(String runId) { return timepoints().stream().filter(t -> t.run().id().equals(runId)).findFirst().orElse(null); }

    /** The released timepoint a step fed, or null (step_feeds_release): such a step can no longer change. */
    public String feedsRelease(Run r) {
        for (Timepoint t : timepoints())
            if (t.released() && (t.step().ancestors().contains(r.stepId()) || r.id().equals(t.run().id()))) return t.step().name();
        return null;
    }

    private boolean feedsReadyTimepoint(String stepId) {
        return timepoints().stream().anyMatch(t -> t.ready() && !t.released() && t.step().ancestors().contains(stepId));
    }

    public Run run(String runId) { return runsByStep.values().stream().filter(r -> r.id().equals(runId)).findFirst().orElse(null); }

    // ------------------------------------------------------------ who may review
    /**
     * Who may review (assert_can_review): only its automated run reviews a verification batch; testing.review at the
     * lab (the caller's check, run in between so its message is the database's); never someone who did bench work.
     */
    public void assertCanReview(String user, boolean verificationRunning, Runnable requireReviewPermission) {
        if (verification && !verificationRunning) throw RuleException.database("Batch " + code + " belongs to a workflow verification: only its automated run reviews it");
        requireReviewPermission.run();
        for (Run r : runsByStep.values()) {
            Step s = step(r.stepId());
            if (s != null && !"QC Review".equals(s.type()) && (Objects.equals(user, r.performedBy()) || Objects.equals(user, r.witnessId())))
                throw RuleException.database("You performed or witnessed a step of " + code + "; someone else must review it");
        }
    }

    /** What a reviewer may choose now (assert_can_choose): the final result while waiting for review; a ready timepoint's. */
    public void assertCanChoose(String key) {
        if (key == null) {
            if (!awaiting()) throw RuleException.database("Batch " + code + " is " + status + ", not waiting for review");
            return;
        }
        if (!AWAITING.equals(status) && !IN_PROGRESS.equals(status)) throw RuleException.database("Batch " + code + " is " + status);
        if (timepoints().stream().anyMatch(t -> t.released() && t.keys().contains(key))) throw RuleException.database("That timepoint's results are already released");
        if (timepoints().stream().noneMatch(t -> t.ready() && !t.released() && t.keys().contains(key)))
            throw RuleException.database("That timepoint is not ready for review (the steps before it are not completed)");
    }

    // ------------------------------------------------------------ choosing
    public ReviewItem item(String requestedTest, String analyte, String key) {
        return items.getOrDefault(key == null ? "" : key, List.of()).stream()
            .filter(i -> i.requestedTestId().equals(requestedTest) && i.analyteId().equals(analyte)).findFirst().orElse(null);
    }

    public List<ReviewItem> items(String key) { return items.getOrDefault(key == null ? "" : key, List.of()); }

    /** A reading that is not a result is refused first (039), then the pick is checked (choose_result). */
    public ReviewItem.Choice choosePick(String requestedTest, String analyte, String entry, int run, String why, String key, Runnable assertReviewer) {
        invalid.stream().filter(x -> x.entryId().equals(entry) && x.analyteId().equals(analyte) && x.runNo() == run).findFirst().ifPresent(x -> {
            throw RuleException.database("\"" + x.valueText() + "\" is not a result and cannot be reported: read the sample again in a new analytical run");
        });
        assertReviewer.run();
        assertCanChoose(key);
        ReviewItem i = item(requestedTest, analyte, key);
        if (i == null) throw RuleException.database("That reading is not a result of this sample in this batch");
        return i.choosePick(entry, run, why);
    }

    public ReviewItem.Choice chooseAverage(String requestedTest, String analyte, List<ReviewItem.Reading> readings, String why, String key, Runnable assertReviewer) {
        assertReviewer.run();
        assertCanChoose(key);
        ReviewItem i = item(requestedTest, analyte, key);
        if (i == null) throw RuleException.database("That sample and analyte are not in this batch");
        return i.chooseAverage(readings, why);
    }

    // ------------------------------------------------------------ QC and loads
    /** The analytical runs that hold a reported reading (batch_used_runs); run 1 when none. */
    public Set<Integer> usedRuns() {
        Set<Integer> out = new TreeSet<>();
        for (ReviewItem i : items(null)) out.addAll(i.runsUsed());
        if (out.isEmpty()) out.add(1);
        return out;
    }

    private boolean isAccepted(QcVerdict v) {
        return accepted.stream().anyMatch(a -> Objects.equals(a.entryId(), v.entryId()) && Objects.equals(a.analyteId(), v.analyteId())
            && Objects.equals(a.limitType(), v.limitType()) && a.run() == v.analyticalRun());
    }

    /** accept_qc: a failed or waiting check, while the batch waits for review, with a justification. */
    public QcVerdict acceptQc(String entry, String analyte, String limitType, int run, String why) {
        if (!awaiting()) throw RuleException.database("Batch " + code + " is " + status + ", not waiting for review");
        if (ReviewItem.blank(why)) throw RuleException.database("Write why the QC result is acceptable");
        QcVerdict v = verdicts.stream().filter(x -> Objects.equals(x.entryId(), entry) && Objects.equals(x.analyteId(), analyte)
            && Objects.equals(x.limitType(), limitType) && x.analyticalRun() == run).findFirst().orElse(null);
        if (v == null || v.verdict() == null) throw RuleException.database("That QC check is not in this batch");
        if (!v.failedOrWaiting()) throw RuleException.database("Only a failed or waiting QC check needs accepting (this one is " + v.verdict() + ")");
        return v;
    }

    /** accept_load: a load of this batch outside its target, in QC Review (or feeding a ready timepoint), with a justification. */
    public Load acceptLoad(String loadId, String why) {
        Load l = loads.stream().filter(x -> x.id().equals(loadId)).findFirst().orElse(null);
        if (l == null) throw RuleException.database("That load is not in this batch");
        if (l.checkText() == null) throw RuleException.database("That load is within its window and temperature: nothing to accept");
        if (!awaiting() && !(IN_PROGRESS.equals(status) && feedsReadyTimepoint(l.stepId())))
            throw RuleException.database("Batch " + code + " is " + status + ": loads are accepted in QC Review");
        if (ReviewItem.blank(why)) throw RuleException.database("Write why the load is acceptable");
        return l;
    }

    // ------------------------------------------------------------ step approvals
    /** approve_review_step: a completed bench step, once waiting for review (or feeding a ready timepoint). False: already approved. */
    public boolean markStep(Run r) {
        Step s = step(r.stepId());
        if (s != null && "QC Review".equals(s.type())) throw RuleException.database("The QC Review is approved with the batch (Approve batch)");
        if (!awaiting() && !(IN_PROGRESS.equals(status) && feedsReadyTimepoint(r.stepId())))
            throw RuleException.database("Batch " + code + " is " + status + ": steps are approved once every bench step is completed (or, for a timepoint review, the steps before it)");
        if (!r.completed()) throw RuleException.database("Only a completed step can be approved");
        return !marked.contains(r.id());
    }

    /** withdraw_review_step: not once the step fed released preliminary results. */
    public void unmarkStep(Run r) {
        if (!awaiting() && !IN_PROGRESS.equals(status)) throw RuleException.database("Batch " + code + " is " + status + ", not waiting for review");
        if (feedsRelease(r) != null) throw RuleException.database("This step fed released preliminary results; its approval stands");
    }

    // ------------------------------------------------------------ what stops approval
    /** batch_review_problems with its wrappers (loads, equipment flags, aliquots, readings that are not results). */
    public List<String> problems(List<String> flagProblems, List<String> aliquotProblems) {
        if (!awaiting()) return List.of("The batch is " + status + ", not waiting for review");
        List<String> out = new ArrayList<>();
        steps.stream().filter(s -> !"QC Review".equals(s.type()) && runsByStep.containsKey(s.id())).sorted(Comparator.comparingInt(Step::sortOrder).thenComparing(Step::name))
            .filter(s -> !marked.contains(runsByStep.get(s.id()).id())).forEach(s -> out.add(notApproved(s)));
        for (ReviewItem i : items(null)) if (!i.chosen()) out.add(explained(i.unresolved()));
        Set<String> done = releasedKeys();
        for (Timepoint t : timepoints()) {
            if (t.released()) continue;
            for (String k : t.keys()) {
                if (!done.add(k)) continue;
                for (ReviewItem i : items(k)) if (!i.chosen()) out.add(t.step().name() + ": " + i.unresolved());
            }
        }
        for (Load l : loads) if (l.open()) out.add(l.problem());
        Set<Integer> used = usedRuns();
        for (QcVerdict v : verdicts) if (v.failedOrWaiting() && v.counts(used, qcClass.get(v.entryId())) && !isAccepted(v)) out.add(v.needsAcceptance());
        out.addAll(flagProblems);
        out.addAll(aliquotProblems);
        // a control read as "not a result" in a run that counts, never read again validly; its later reading then decides
        for (QcVerdict v : verdicts)
            if (v.isInvalid() && v.counts(used, qcClass.get(v.entryId())) && verdicts.stream().noneMatch(w -> w.sameCheck(v) && w.readLaterThan(v) && !w.isInvalid()))
                out.add(v.name() + ": " + v.note());
        for (QcVerdict w : verdicts)
            if (w.failedOrWaiting() && !w.counts(used, qcClass.get(w.entryId()))
                && verdicts.stream().anyMatch(v -> v.sameCheck(w) && w.readLaterThan(v) && v.isInvalid() && v.counts(used, qcClass.get(v.entryId())))
                && verdicts.stream().noneMatch(w2 -> w2.sameCheck(w) && w2.readLaterThan(w) && !w2.isInvalid()) && !isAccepted(w))
                out.add(w.label() + " " + (w.analyteName() == null ? "" : w.analyteName()) + " " + w.limitType() + " (run " + w.analyticalRun() + ", read again): "
                    + w.verdict().toLowerCase() + ", accept it with a justification or return the batch");
        return out;
    }

    private static String notApproved(Step s) { return "Step \"" + s.name() + "\": not approved yet (open it and click Approve step)"; }

    /** "no result" explained when the sample's only readings are not results (039). */
    private String explained(String problem) {
        Map<String, Set<String>> texts = new LinkedHashMap<>();
        for (InvalidReading x : invalid)
            if ("Sample".equals(x.entryType()) && problem.equals(x.sampleLabel() + " " + x.analyteName() + ": no result"))
                texts.computeIfAbsent(x.sampleLabel() + " " + x.analyteName(), k -> new TreeSet<>()).add("\"" + x.valueText() + "\"");
        if (texts.isEmpty()) return problem;
        Map.Entry<String, Set<String>> e = texts.entrySet().iterator().next();
        return e.getKey() + ": " + String.join(", ", e.getValue()) + " is not a result: read it again in a new analytical run (the reading step, right-click)";
    }

    /** What stops a timepoint's release (timepoint_problems and its wrapper), given the equipment flags of the steps before it. */
    public List<String> timepointProblems(String runId, List<String> flagProblems) {
        Timepoint t = timepointOf(runId);
        if (t == null) return List.of("Not a timepoint review");
        if (t.released()) return List.of("Already released");
        if (!t.ready()) return List.of("The steps before it are not completed yet");
        List<String> out = new ArrayList<>();
        steps.stream().filter(s -> t.step().ancestors().contains(s.id()) && !"QC Review".equals(s.type()) && runsByStep.containsKey(s.id())
                && !marked.contains(runsByStep.get(s.id()).id()))
            .sorted(Comparator.comparingInt(Step::sortOrder)).forEach(s -> out.add(notApproved(s)));
        for (Load l : loads) if (l.open() && t.step().ancestors().contains(l.stepId())) out.add(l.problem());
        Set<String> done = releasedKeys();
        for (String k : t.keys()) if (!done.contains(k)) for (ReviewItem i : items(k)) if (!i.chosen()) out.add(i.unresolved());
        out.addAll(flagProblems);
        return out;
    }

    /** The steps before a timepoint review (for its equipment flags). */
    public List<String> stepsBefore(String runId) {
        Timepoint t = timepointOf(runId);
        return t == null ? List.of() : new ArrayList<>(t.step().ancestors());
    }

    // ------------------------------------------------------------ release, approval, return, cancel
    /**
     * release_timepoint: the results of a ready timepoint's keys not released before, as Preliminary.
     *
     * @return the items to store
     */
    public List<ReviewItem> release(String runId, List<String> problems) {
        Run r = run(runId);
        if (r == null) throw RuleException.database("Step not found");
        if ("Approved".equals(status) || "Cancelled".equals(status)) throw RuleException.database("Batch " + code + " is " + status);
        Timepoint t = timepointOf(runId);
        if (t == null) throw RuleException.database("Only a timepoint review (a QC Review set to Timepoint, before the final result) releases preliminary results");
        if (t.released()) throw RuleException.database("\"" + t.step().name() + "\" is already released");
        if (!problems.isEmpty()) throw RuleException.database(cannot("\"" + t.step().name() + "\" cannot be released yet", problems));
        Set<String> done = releasedKeys();
        List<ReviewItem> out = new ArrayList<>();
        for (String k : t.keys()) if (!done.contains(k)) out.addAll(items(k));
        return out;
    }

    private static String cannot(String what, List<String> problems) {
        int n = problems.size();
        return what + " (" + n + " thing" + (n > 1 ? "s" : "") + " to resolve), e.g.: " + problems.stream().min(Comparator.naturalOrder()).orElseThrow();
    }

    /** approve_batch: nothing left to resolve. Returns the timepoint keys whose results are stored with the final ones. */
    public List<String> approve(List<String> problems) {
        if (!problems.isEmpty()) throw RuleException.database(cannot(code + " cannot be approved yet", problems));
        Set<String> keys = new LinkedHashSet<>();
        for (Timepoint t : timepoints()) keys.addAll(t.keys());
        return new ArrayList<>(keys);
    }

    /** return_batch: the step and every step after it reopen (never one that fed released results). */
    public List<String> returnTo(String runId) {
        if (!awaiting()) throw RuleException.database("Batch " + code + " is " + status + ", not waiting for review");
        Run r = run(runId);
        if (r == null) throw RuleException.database("Choose a step of this batch");
        String t = feedsRelease(r);
        if (t != null)
            throw RuleException.database("This step fed results already released as preliminary (" + t + "), so it cannot change. Corrections to released results come with the OOS and retest slice");
        List<String> out = new ArrayList<>();
        for (Run x : runsByStep.values()) {
            Step s = step(x.stepId());
            if (x.completed() && (x.id().equals(r.id()) || (s != null && s.ancestors().contains(r.stepId())))) out.add(x.id());
        }
        return out;
    }

    /** cancel_batch: testing.assign or testing.review; not once approved, cancelled or with released preliminary results. */
    public void cancel(boolean mayCancel, boolean hasPreliminary) {
        if (!mayCancel) throw RuleException.database("Cancelling a batch needs testing.assign or testing.review in this lab");
        if ("Approved".equals(status) || "Cancelled".equals(status)) throw RuleException.database("Batch " + code + " is already " + status.toLowerCase());
        if (hasPreliminary)
            throw RuleException.database("Batch " + code + " has released preliminary results and cannot be cancelled (the OOS and retest slice will handle this)");
    }
}
