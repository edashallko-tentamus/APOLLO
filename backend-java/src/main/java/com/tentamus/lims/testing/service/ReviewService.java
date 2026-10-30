package com.tentamus.lims.testing.service;

import static com.tentamus.lims.testing.service.TestingValues.*;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.access.UserAccess;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.signature.SignatureService.Meaning;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.testing.domain.calc.QcVerdict;
import com.tentamus.lims.testing.domain.review.ReviewBatch;
import com.tentamus.lims.testing.domain.review.ReviewItem;
import com.tentamus.lims.testing.repo.ReviewStore;
import com.tentamus.lims.testing.repo.TestingRepository;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import org.springframework.stereotype.Service;

/**
 * QC Review use cases: the review page, choosing readings, accepting QC and loads, step approvals, timepoint releases,
 * approval, return and cancel. Each loads the batch as a {@link ReviewBatch}, asks it, and saves what it decides
 * (migration 068 moved these rules out of the database; the database functions stay for Node's verification run).
 */
@Service
public class ReviewService {
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final SignatureService signatures;
    private final TestingRepository testing;
    private final ReviewStore store;

    public ReviewService(Db db, UnitOfWork uow, AccessPolicy access, SignatureService signatures, TestingRepository testing, ReviewStore store) {
        this.db = db;
        this.uow = uow;
        this.access = access;
        this.signatures = signatures;
        this.testing = testing;
        this.store = store;
    }

    private Map<String, Object> batchOf(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Batch not found");
        Map<String, Object> b = testing.batch(id);
        if (b == null) throw new RuleException("Batch not found");
        access.checkSite(ctx, (String) b.get("site_id"));
        return b;
    }

    /** Loads the batch inside the transaction and checks the person may review it. */
    private ReviewBatch reviewer(Db d, RequestContext ctx, String batchId) {
        ReviewBatch rb = store.load(d, batchId);
        if (rb == null) throw RuleException.database("Batch not found");
        rb.assertCanReview(ctx.userId(), store.verificationRunning(d), () -> store.requirePermission(d, "testing.review", rb.siteId()));
        return rb;
    }

    private <T> T signed(RequestContext ctx, Map<String, Object> body, String meaning, String action, Function<Db, T> work) {
        return signatures.signed(ctx, body, new Meaning(meaning, action, "Testing"), work);
    }

    private List<String> problems(Db d, ReviewBatch rb) {
        boolean a = rb.awaiting();
        return rb.problems(a ? store.flagProblems(d, rb.id(), null) : List.of(), a ? store.aliquotProblems(d, rb.id()) : List.of());
    }

    private List<String> timepointProblems(Db d, ReviewBatch rb, String runId) {
        return rb.timepointProblems(runId, store.flagProblems(d, rb.id(), rb.stepsBefore(runId)));
    }

    // ---------------------------------------------------------------- the review page
    public Map<String, Object> review(RequestContext ctx, String id, Map<String, Object> who) {
        Map<String, Object> b = batchOf(ctx, id);
        ReviewBatch rb = store.load(db, id);
        Map<String, Object> out = new LinkedHashMap<>();
        boolean awaiting = rb.awaiting();
        Map<Object, List<Object>> found = new LinkedHashMap<>();
        for (Map<String, Object> x : db.rows("SELECT analyte_id, found_values FROM test_version_analyte WHERE test_version_id = ?::uuid", b.get("test_version_id")))
            found.put(x.get("analyte_id"), TestingRepository.pgList(x.get("found_values")));
        List<Map<String, Object>> items = new ArrayList<>();
        if (awaiting) for (ReviewItem i : rb.items(null)) items.add(withHit(i.toRow(), found, true));
        List<Map<String, Object>> stored = db.rows("SELECT * FROM test_result_view WHERE batch_id = ?::uuid AND status = 'Active' ORDER BY sample_code, analyte_name", id);
        for (Map<String, Object> x : stored) withHit(x, found, false);
        List<Map<String, Object>> timepoints = db.rows("SELECT t.*, u.full_name AS released_by_name FROM batch_timepoints(?::uuid) t LEFT JOIN app_user u ON u.id = t.released_by", id);
        Set<Object> releasedKeys = new LinkedHashSet<>();
        for (Map<String, Object> t : timepoints) {
            t.put("keys", TestingRepository.pgList(t.get("keys")));
            if (Boolean.TRUE.equals(t.get("released"))) releasedKeys.addAll((List<?>) t.get("keys"));
        }
        for (Map<String, Object> tp : timepoints) {
            List<Map<String, Object>> tpItems = new ArrayList<>();
            if (!Boolean.TRUE.equals(tp.get("released")) && Boolean.TRUE.equals(tp.get("ready")) && !List.of("Approved", "Cancelled").contains(b.get("status"))) {
                tp.put("problems", timepointProblems(db, rb, (String) tp.get("step_run_id")));
                for (Object k : (List<?>) tp.get("keys")) if (!releasedKeys.contains(k)) for (ReviewItem i : rb.items((String) k)) tpItems.add(withHit(i.toRow(), found, true));
            } else tp.put("problems", List.of());
            tp.put("items", tpItems);
            tp.put("stored", db.rows("SELECT * FROM test_result_view WHERE batch_id = ?::uuid AND released_step_run_id = ?::uuid AND status = 'Active' ORDER BY sample_code, analyte_name",
                id, tp.get("step_run_id")));
            tp.put("feeds", db.rows("""
                SELECT p.id FROM step_ancestors(?::uuid) a JOIN step_run p ON p.step_id = a.step_id AND p.batch_id = ?::uuid JOIN workflow_step w ON w.id = p.step_id
                 WHERE w.step_type <> 'QC Review'""", tp.get("step_id"), id).stream().map(x -> x.get("id")).toList());
        }
        List<Object> ids = new ArrayList<>();
        for (String k : List.of("reviewed_by", "returned_by", "cancelled_by")) if (b.get(k) != null) ids.add(b.get(k));
        Map<Object, Object> name = new LinkedHashMap<>();
        for (Map<String, Object> p : db.rows("SELECT id, full_name FROM app_user WHERE id = ANY(?::uuid[])", ids)) name.put(p.get("id"), p.get("full_name"));
        out.put("items", items);
        out.put("problems", awaiting ? problems(db, rb) : List.of());
        out.put("verdicts", rb.verdicts().stream().map(QcVerdict::toRow).toList());
        out.put("accepted", db.rows("SELECT q.*, u.full_name AS accepted_by FROM qc_acceptance q JOIN app_user u ON u.id = q.created_by WHERE q.batch_id = ?::uuid AND q.status = 'Active'", id));
        out.put("stored", stored);
        out.put("performer", testing.performer(id, ctx.userId()));
        out.put("timepoints", timepoints);
        out.put("used_runs", awaiting ? rb.usedRuns().stream().map(x -> (Object) (long) x).toList() : List.of(1L));
        out.put("loads", db.rows("""
            SELECT l.id, l.step_run_id, l.equipment_id, l.equipment_code, l.time_in, l.time_out, l.note, l.check_text, ws.step_name,
                  a.justification AS accepted_justification, a.check_text AS accepted_check, u.full_name AS accepted_by, a.created_at AS accepted_at
                FROM incubation_load_view l JOIN step_run r ON r.id = l.step_run_id JOIN workflow_step ws ON ws.id = r.step_id
                LEFT JOIN load_acceptance a ON a.load_id = l.id AND a.status = 'Active' LEFT JOIN app_user u ON u.id = a.created_by
               WHERE l.batch_id = ?::uuid AND l.status = 'Active' AND l.check_text IS NOT NULL ORDER BY l.time_in""", id));
        out.put("reviewed_by_name", name.get(b.get("reviewed_by")));
        out.put("returned_by_name", name.get(b.get("returned_by")));
        out.put("cancelled_by_name", name.get(b.get("cancelled_by")));
        out.putAll(who);
        return out;
    }

    private static final java.util.regex.Pattern NOT_FOUND = java.util.regex.Pattern.compile("^\\s*(<|nd\\b|n\\.d\\.)", java.util.regex.Pattern.CASE_INSENSITIVE);

    /** A "hit": a result above the LOQ, or a qualitative result that means found (the screen nests and shows these). */
    private static Map<String, Object> withHit(Map<String, Object> x, Map<Object, List<Object>> found, boolean needsChoice) {
        Object text = x.get("value_text"), reported = x.get("reported");
        boolean hit = text != null && !"".equals(text) ? found.getOrDefault(x.get("analyte_id"), List.of()).contains(text)
            : reported != null && !"".equals(reported) && !NOT_FOUND.matcher(com.tentamus.lims.core.excel.Js.string(reported)).find();
        x.put("hit", (!needsChoice || x.get("chosen_entry_id") != null) && hit);
        return x;
    }

    // ---------------------------------------------------------------- choices and acceptances
    public Map<String, Object> choose(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> b = batchOf(ctx, id);
        String batchId = (String) b.get("id");
        List<Map<String, Object>> rows = maps(body.get("rows"));
        return uow.run(withReason(ctx, body, "Reportable reading chosen"), d -> {
            for (Map<String, Object> x : rows) {
                ReviewBatch rb = store.load(d, batchId);   // again per row: each choice changes what the next one sees
                String rt = str(x.get("requested_test_id")), analyte = str(x.get("analyte_id")), why = truthy(x.get("justification")) ? str(x.get("justification")) : null;
                String key = truthy(x.get("result_key")) ? str(x.get("result_key")) : null;
                Runnable canReview = () -> rb.assertCanReview(ctx.userId(), store.verificationRunning(d), () -> store.requirePermission(d, "testing.review", rb.siteId()));
                ReviewItem.Choice c;
                if (x.get("readings") instanceof List<?> r && r.size() > 1) {   // the average of the readings ticked (WD-5)
                    List<ReviewItem.Reading> ticked = new ArrayList<>();
                    for (Map<String, Object> y : maps(r)) ticked.add(new ReviewItem.Reading(str(y.get("entry_id")), (int) com.tentamus.lims.core.excel.Js.toNumber(y.get("run_no"))));
                    c = rb.chooseAverage(rt, analyte, ticked, why, key, canReview);
                } else {
                    Object run = jsNumber(x, "run_no");
                    c = rb.choosePick(rt, analyte, str(x.get("entry_id")), run instanceof Long n ? n.intValue() : -1, why, key, canReview);
                }
                store.saveChoice(d, batchId, rt, analyte, key, c);
            }
            return Map.of("saved", rows.size());
        });
    }

    public Map<String, Object> acceptQc(RequestContext ctx, String id, Map<String, Object> x) {
        Map<String, Object> b = batchOf(ctx, id);
        return uow.run(withReason(ctx, x, "QC accepted by the reviewer"), d -> {
            ReviewBatch rb = reviewer(d, ctx, (String) b.get("id"));
            Object run = orOne(x.get("analytical_run"));
            String why = truthy(x.get("justification")) ? str(x.get("justification")) : "";
            QcVerdict v = rb.acceptQc(str(x.get("entry_id")), RequestContext.isUuid(x.get("analyte_id")) ? str(x.get("analyte_id")) : null, str(x.get("limit_type")),
                run instanceof Long n ? n.intValue() : 1, why);
            store.saveQcAcceptance(d, rb.id(), v, why);
            return ok();
        });
    }

    /** The reviewer accepts an incubator load outside its window or temperature, with a justification (WD-5.1). */
    public Map<String, Object> acceptLoad(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> b = batchOf(ctx, id);
        if (!RequestContext.isUuid(body.get("load_id"))) throw new RuleException("Load not found");
        return uow.run(withReason(ctx, body, "Incubator load accepted by the reviewer"), d -> {
            ReviewBatch rb = reviewer(d, ctx, (String) b.get("id"));
            String why = truthy(body.get("justification")) ? str(body.get("justification")) : "";
            store.saveLoadAcceptance(d, rb.id(), rb.acceptLoad(str(body.get("load_id")), why), why);
            return ok();
        });
    }

    /** The reviewer approves each step with a click (a recorded mark, not a signature), or undoes it (migration 020). */
    public Map<String, Object> reviewMark(RequestContext ctx, String id, String runId, Map<String, Object> body) {
        Map<String, Object> b = batchOf(ctx, id);
        if (!RequestContext.isUuid(runId)) throw new RuleException("Step not found");
        boolean undo = Boolean.TRUE.equals(body.get("undo"));
        return uow.run(withReason(ctx, body, undo ? "Step approval undone in QC Review" : "Step approved in QC Review"), d -> {
            ReviewBatch rb = store.load(d, (String) b.get("id"));
            ReviewBatch.Run r = rb.run(runId);
            if (r == null) throw new RuleException("Step not found in this batch");
            rb.assertCanReview(ctx.userId(), store.verificationRunning(d), () -> store.requirePermission(d, "testing.review", rb.siteId()));
            if (undo) {
                rb.unmarkStep(r);
                store.unmark(d, runId);
            } else if (rb.markStep(r)) store.mark(d, rb.id(), runId);
            return ok();
        });
    }

    // ---------------------------------------------------------------- approval, release, return, cancel
    public Map<String, Object> approve(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> b = batchOf(ctx, id);
        return signed(withReason(ctx, body, "Batch reviewed and approved"), body, "Reviewed by", "QC Review and approval of " + b.get("batch_code"), d -> {
            ReviewBatch rb = reviewer(d, ctx, (String) b.get("id"));
            List<String> problems = new ArrayList<>(problems(d, rb));
            if (problems.isEmpty()) problems.addAll(store.calculationProblems(d, rb.id(), rb.items(null)));
            List<String> keys = rb.approve(problems);
            store.internal(d, true);
            int n = 0;
            for (ReviewItem i : rb.items(null)) { store.storeResult(d, rb.id(), i, "Final", null); n++; }
            // timepoint results: a released (preliminary) one is carried into the final unchanged; the rest are stored now
            for (String k : keys) for (ReviewItem i : rb.items(k)) {
                if (!store.carryPreliminary(d, rb.id(), i)) store.storeResult(d, rb.id(), i, "Final", null);
                n++;
            }
            store.approved(d, rb.id());
            store.internal(d, false);
            store.refreshOrders(d, rb.id());
            return kv("results", n);
        });
    }

    /** Release a timepoint's results as preliminary (WD-5): signed "Reviewed by". */
    public Map<String, Object> release(RequestContext ctx, String id, String runId, Map<String, Object> body) {
        Map<String, Object> b = batchOf(ctx, id);
        if (!RequestContext.isUuid(runId)) throw new RuleException("Step not found");
        Map<String, Object> s = db.one("SELECT ws.step_name FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.id = ?::uuid AND r.batch_id = ?::uuid", runId, b.get("id"));
        if (s == null) throw new RuleException("Step not found in this batch");
        return signed(withReason(ctx, body, "Timepoint reviewed: preliminary results released"), body, "Reviewed by",
            s.get("step_name") + " of " + b.get("batch_code") + ": release preliminary results", d -> {
                ReviewBatch rb = reviewer(d, ctx, (String) b.get("id"));
                List<ReviewItem> items = rb.release(runId, timepointProblems(d, rb, runId));
                store.internal(d, true);
                for (ReviewItem i : items) store.storeResult(d, rb.id(), i, "Preliminary", runId);
                store.completeRun(d, runId);
                store.internal(d, false);
                store.refreshOrders(d, rb.id());
                return kv("results", items.size());
            });
    }

    public Map<String, Object> returnBatch(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> b = batchOf(ctx, id);
        if (!RequestContext.isUuid(body.get("step_run_id"))) throw new RuleException("Choose the step to reopen");
        if (str(body.get("reason")).trim().isEmpty()) throw new RuleException("Say what the analyst needs to fix");
        return signed(ctx, body, "Returned by", "Return " + b.get("batch_code") + " to the analyst", d -> {
            ReviewBatch rb = reviewer(d, ctx, (String) b.get("id"));
            List<String> reopen = rb.returnTo(str(body.get("step_run_id")));
            store.internal(d, true);
            store.returned(d, rb.id(), reopen);   // the reopened steps lose their approval marks (trigger z_review_marks)
            store.internal(d, false);
            return ok();
        });
    }

    public Map<String, Object> cancel(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> b = batchOf(ctx, id);
        if (str(body.get("reason")).trim().isEmpty()) throw new RuleException("Say why the batch is cancelled");
        return signed(ctx, body, "Cancelled by", "Cancel " + b.get("batch_code"), d -> {
            Map<String, Object> h = store.head(d, (String) b.get("id"));
            UserAccess a = access.load(ctx.userId());
            String site = (String) h.get("site_id");
            ReviewBatch rb = store.load(d, (String) b.get("id"));
            rb.cancel(a.can("testing.assign", site) || a.can("testing.review", site), store.hasPreliminary(d, rb.id()));
            store.internal(d, true);
            store.cancelled(d, rb.id());
            store.internal(d, false);
            store.refreshOrders(d, rb.id());
            return ok();
        });
    }
}
