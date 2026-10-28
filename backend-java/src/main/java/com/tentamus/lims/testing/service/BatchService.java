package com.tentamus.lims.testing.service;

import static com.tentamus.lims.testing.service.TestingValues.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.access.UserAccess;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.paging.PagedList;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.signature.SignatureService.Meaning;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.testing.repo.TestingRepository;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.springframework.stereotype.Service;

/**
 * Testing, batch by batch: the backlog, batches and the worklist, one batch's page, adding and removing samples before
 * a batch starts, assignment, re-prep, and QC Review (choosing readings, accepting QC and loads, step approvals,
 * approval, timepoint releases, return and cancel). The rules are the database's.
 */
@Service
public class BatchService {
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final SignatureService signatures;
    private final TestingRepository repo;
    private final ObjectMapper json;

    public BatchService(Db db, UnitOfWork uow, AccessPolicy access, SignatureService signatures, TestingRepository repo, ObjectMapper json) {
        this.db = db;
        this.uow = uow;
        this.access = access;
        this.signatures = signatures;
        this.repo = repo;
        this.json = json;
    }

    <T> T signed(RequestContext ctx, Map<String, Object> body, String meaning, String action, Function<Db, T> work) {
        return signatures.signed(ctx, body, new Meaning(meaning, action, "Testing"), work);
    }

    Map<String, Object> batchOf(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Batch not found");
        Map<String, Object> b = repo.batch(id);
        if (b == null) throw new RuleException("Batch not found");
        access.checkSite(ctx, (String) b.get("site_id"));
        return b;
    }

    Map<String, Object> me(RequestContext ctx) {
        UserAccess a = access.load(ctx.userId());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("can_perform", a.can("testing.perform", ctx.siteId()));
        out.put("can_assign", a.can("testing.assign", ctx.siteId()));
        out.put("can_review", a.can("testing.review", ctx.siteId()));
        out.put("user_id", ctx.userId());
        return out;
    }

    // ---------------------------------------------------------------- backlog, batches, worklist
    public Map<String, Object> backlog(RequestContext ctx) {
        String site = access.currentSite(ctx);
        List<Map<String, Object>> rows = repo.backlog(site);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("rows", rows);
        out.put("max_samples", repo.maxSamples(new ArrayList<>(new LinkedHashSet<>(rows.stream().map(x -> x.get("test_version_id")).toList()))));
        out.putAll(me(ctx));
        return out;
    }

    public Map<String, Object> create(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        Object version = body.get("test_version_id");
        if (!RequestContext.isUuid(version)) throw new RuleException("Choose the test");
        Object items = body.get("items") instanceof List<?> l && !l.isEmpty() ? toJson(json, l) : null;
        return uow.run(withReason(ctx, body, "Batch created"), d -> {
            Object id = d.one("SELECT create_batch(?::uuid, ?::uuid, ?::jsonb) AS id", site, version, items).get("id");
            return d.one("SELECT id, batch_code FROM test_batch WHERE id = ?::uuid", id);
        });
    }

    public Map<String, Object> batches(RequestContext ctx, Map<String, String> query) {
        String site = access.currentSite(ctx);
        String show = query.get("show") == null || query.get("show").isEmpty() ? "open" : query.get("show");
        String where = switch (show) {
            case "mine" -> "AND b.assigned_to = ?::uuid AND b.status IN ('Open','In Progress')";
            case "review" -> "AND b.status = 'Awaiting Review'";
            case "all" -> "";
            default -> "AND b.status IN ('Open','In Progress','Awaiting Review')";
        };
        // verification batches (WD-6) are the automated runs' own: never in the lab's lists; every batch ever made: one page at a time
        Map<String, Object> paged = "all".equals(show) && PagedList.wanted(query)
            ? PagedList.of("SELECT b.* FROM test_batch_view b WHERE b.site_id = ?::uuid AND NOT b.is_verification", site)
                .filter("all", "true").filter("approved", "status::text = 'Approved'").filter("cancelled", "status::text = 'Cancelled'")
                .search("batch_code", "test_code", "test_name", "assigned_name", "department_code").ids("batch_code")
                .order("ORDER BY created_at DESC, batch_code DESC").run(db, query)
            : null;
        String sql = "SELECT b.* FROM test_batch_view b WHERE b.site_id = ?::uuid AND NOT b.is_verification " + where + " ORDER BY b.earliest_due NULLS LAST, b.batch_code LIMIT 1000";
        Object rows = paged != null ? paged.get("rows") : "mine".equals(show) ? db.rows(sql, site, ctx.userId()) : db.rows(sql, site);
        Map<String, Object> counts = db.one("""
            SELECT count(*) FILTER (WHERE status IN ('Open','In Progress','Awaiting Review')) AS open,
                count(*) FILTER (WHERE assigned_to = ?::uuid AND status IN ('Open','In Progress')) AS mine, count(*) FILTER (WHERE status = 'Awaiting Review') AS review,
                count(*) AS all FROM test_batch WHERE site_id = ?::uuid AND NOT is_verification""", ctx.userId(), site);
        Map<String, Object> out = new LinkedHashMap<>();
        if (paged != null) out.putAll(paged);
        out.put("rows", rows);
        out.put("counts", paged != null ? paged.get("counts") : counts);
        out.put("people", repo.people(site));   // who batches can be assigned to
        out.putAll(me(ctx));
        return out;
    }

    // ---------------------------------------------------------------- one batch
    public Map<String, Object> batch(RequestContext ctx, String id) {
        Map<String, Object> b = batchOf(ctx, id);
        Map<String, Object> out = repo.batchPage(b, ctx.userId());
        boolean started = repo.started(b.get("id"));   // samples can be added or removed until bench work is recorded (migration 023)
        long waiting = repo.waiting(b.get("site_id"), b.get("test_version_id"));
        Map<String, Object> who = me(ctx);
        out.putAll(who);
        out.put("can_pick", "In Progress".equals(b.get("status")) && access.load(ctx.userId()).can("testing.pick_run", (String) b.get("site_id")));
        out.put("can_edit_samples", Boolean.TRUE.equals(who.get("can_perform")) && !started && List.of("Open", "In Progress").contains(b.get("status")));
        out.put("backlog_waiting", waiting);
        return out;
    }

    public Map<String, Object> options(RequestContext ctx, String id) { return repo.options(batchOf(ctx, id)); }

    // ---------------------------------------------------------------- adding and removing samples before a batch starts (no signature: Alex)
    public Map<String, Object> pool(RequestContext ctx, String id) { return Map.of("rows", repo.pool(batchOf(ctx, id))); }

    public Map<String, Object> add(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> b = batchOf(ctx, id);
        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, Object> x : maps(body.get("items"))) {
            if (!RequestContext.isUuid(x.get("requested_test_id"))) continue;
            Map<String, Object> i = new LinkedHashMap<>();
            i.put("requested_test_id", x.get("requested_test_id"));
            i.put("reprep_request_id", RequestContext.isUuid(x.get("reprep_request_id")) ? x.get("reprep_request_id") : null);
            items.add(i);
        }
        if (items.isEmpty()) throw new RuleException("Choose the samples to add");
        return uow.run(withReason(ctx, body, "Sample added to the batch"), d -> {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("added", d.one("SELECT add_batch_items(?::uuid, ?::jsonb) AS n", b.get("id"), toJson(json, items)).get("n"));
            out.put("batch_code", b.get("batch_code"));
            return out;
        });
    }

    public Map<String, Object> remove(RequestContext ctx, String entryId, Map<String, Object> body) {
        if (!RequestContext.isUuid(entryId)) throw new RuleException("Entry not found");
        Map<String, Object> e = db.one("SELECT batch_id, label FROM batch_entry WHERE id = ?::uuid", entryId);
        if (e == null) throw new RuleException("Entry not found");
        batchOf(ctx, (String) e.get("batch_id"));
        return uow.run(withReason(ctx, body, "Sample removed from the batch"), d -> {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("removed", d.one("SELECT remove_batch_entry(?::uuid) AS n", entryId).get("n"));
            out.put("label", e.get("label"));
            return out;
        });
    }

    /** Open batches a backlog item could join (same lab and version, nothing recorded yet). */
    public Map<String, Object> openBatches(RequestContext ctx, String version) {
        String site = access.currentSite(ctx);
        return Map.of("rows", RequestContext.isUuid(version) ? repo.openBatches(site, version) : List.of());
    }

    public Map<String, Object> assign(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> b = batchOf(ctx, id);
        if (!RequestContext.isUuid(body.get("user_id"))) throw new RuleException("Choose who does the batch");
        return uow.run(withReason(ctx, body, "Batch assigned"), d -> { d.one("SELECT assign_batch(?::uuid, ?::uuid)", b.get("id"), body.get("user_id")); return ok(); });
    }

    public Map<String, Object> reprep(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> b = batchOf(ctx, id);
        List<Object> ids = uuids(body.get("entry_ids"));
        if (ids.isEmpty()) throw new RuleException("Select the samples to re-prepare");
        Object reps = jsNumber(body, "replicates");
        return signed(ctx, body, "Requested by", "Re-prep (" + replicateWord(reps) + ") of " + ids.size() + " sample" + (ids.size() == 1 ? "" : "s") + " from " + b.get("batch_code"),
            d -> kv("n", d.one("SELECT request_reprep(?::uuid[], ?) AS n", ids, reps).get("n")));
    }

    // ---------------------------------------------------------------- QC Review (WD-3)
    public Map<String, Object> review(RequestContext ctx, String id) {
        Map<String, Object> out = repo.review(batchOf(ctx, id), ctx.userId());
        out.putAll(me(ctx));
        return out;
    }

    public Map<String, Object> choose(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> b = batchOf(ctx, id);
        List<Map<String, Object>> rows = maps(body.get("rows"));
        return uow.run(withReason(ctx, body, "Reportable reading chosen"), d -> {
            for (Map<String, Object> x : rows) {
                if (x.get("readings") instanceof List<?> r && r.size() > 1)   // the average of the readings ticked (WD-5)
                    d.one("SELECT average_results(?::uuid, ?::uuid, ?::uuid, ?::jsonb, ?, ?)", b.get("id"), x.get("requested_test_id"), x.get("analyte_id"), toJson(json, r),
                        or(x.get("justification")), or(x.get("result_key")));
                else d.one("SELECT choose_result(?::uuid, ?::uuid, ?::uuid, ?::uuid, ?, ?, ?)", b.get("id"), x.get("requested_test_id"), x.get("analyte_id"), x.get("entry_id"),
                    jsNumber(x, "run_no"), or(x.get("justification")), or(x.get("result_key")));
            }
            return Map.of("saved", rows.size());
        });
    }

    public Map<String, Object> acceptQc(RequestContext ctx, String id, Map<String, Object> x) {
        Map<String, Object> b = batchOf(ctx, id);
        return uow.run(withReason(ctx, x, "QC accepted by the reviewer"), d -> {
            d.one("SELECT accept_qc(?::uuid, ?::uuid, ?::uuid, ?, ?, ?)", b.get("id"), x.get("entry_id"), RequestContext.isUuid(x.get("analyte_id")) ? x.get("analyte_id") : null,
                x.get("limit_type"), truthy(x.get("justification")) ? x.get("justification") : "", orOne(x.get("analytical_run")));
            return ok();
        });
    }

    /** The reviewer accepts an incubator load outside its window or temperature, with a justification (WD-5.1). */
    public Map<String, Object> acceptLoad(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> b = batchOf(ctx, id);
        if (!RequestContext.isUuid(body.get("load_id"))) throw new RuleException("Load not found");
        return uow.run(withReason(ctx, body, "Incubator load accepted by the reviewer"), d -> {
            d.one("SELECT accept_load(?::uuid, ?::uuid, ?)", b.get("id"), body.get("load_id"), truthy(body.get("justification")) ? body.get("justification") : "");
            return ok();
        });
    }

    /** The reviewer approves each step with a click (a recorded mark, not a signature), or undoes it (migration 020). */
    public Map<String, Object> reviewMark(RequestContext ctx, String id, String runId, Map<String, Object> body) {
        Map<String, Object> b = batchOf(ctx, id);
        if (!RequestContext.isUuid(runId)) throw new RuleException("Step not found");
        boolean undo = Boolean.TRUE.equals(body.get("undo"));
        return uow.run(withReason(ctx, body, undo ? "Step approval undone in QC Review" : "Step approved in QC Review"), d -> {
            Map<String, Object> r = d.one("SELECT id FROM step_run WHERE id = ?::uuid AND batch_id = ?::uuid", runId, b.get("id"));
            if (r == null) throw new RuleException("Step not found in this batch");
            d.one(undo ? "SELECT withdraw_review_step(?::uuid)" : "SELECT approve_review_step(?::uuid)", r.get("id"));
            return ok();
        });
    }

    public Map<String, Object> approve(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> b = batchOf(ctx, id);
        return signed(withReason(ctx, body, "Batch reviewed and approved"), body, "Reviewed by", "QC Review and approval of " + b.get("batch_code"),
            d -> kv("results", d.one("SELECT approve_batch(?::uuid) AS n", b.get("id")).get("n")));
    }

    /** Release a timepoint's results as preliminary (WD-5): signed "Reviewed by". */
    public Map<String, Object> release(RequestContext ctx, String id, String runId, Map<String, Object> body) {
        Map<String, Object> b = batchOf(ctx, id);
        if (!RequestContext.isUuid(runId)) throw new RuleException("Step not found");
        Map<String, Object> s = db.one("SELECT ws.step_name FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.id = ?::uuid AND r.batch_id = ?::uuid", runId, b.get("id"));
        if (s == null) throw new RuleException("Step not found in this batch");
        return signed(withReason(ctx, body, "Timepoint reviewed: preliminary results released"), body, "Reviewed by",
            s.get("step_name") + " of " + b.get("batch_code") + ": release preliminary results",
            d -> kv("results", d.one("SELECT release_timepoint(?::uuid) AS n", runId).get("n")));
    }

    public Map<String, Object> returnBatch(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> b = batchOf(ctx, id);
        if (!RequestContext.isUuid(body.get("step_run_id"))) throw new RuleException("Choose the step to reopen");
        if (str(body.get("reason")).trim().isEmpty()) throw new RuleException("Say what the analyst needs to fix");
        return signed(ctx, body, "Returned by", "Return " + b.get("batch_code") + " to the analyst",
            d -> { d.one("SELECT return_batch(?::uuid, ?::uuid)", b.get("id"), body.get("step_run_id")); return ok(); });
    }

    public Map<String, Object> cancel(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> b = batchOf(ctx, id);
        if (str(body.get("reason")).trim().isEmpty()) throw new RuleException("Say why the batch is cancelled");
        return signed(ctx, body, "Cancelled by", "Cancel " + b.get("batch_code"), d -> { d.one("SELECT cancel_batch(?::uuid)", b.get("id")); return ok(); });
    }

    /** Approved results of a sample (the sample page). */
    public Map<String, Object> sampleResults(RequestContext ctx, String sampleId) {
        if (!RequestContext.isUuid(sampleId)) throw new RuleException("Sample not found");
        Map<String, Object> s = db.one("SELECT o.site_id FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = ?::uuid", sampleId);
        if (s == null) throw new RuleException("Sample not found");
        access.checkSite(ctx, (String) s.get("site_id"));
        Map<String, Object> out = repo.sampleResults(sampleId);
        out.put("can_decide", access.has(ctx, "orders.edit"));
        return out;
    }
}
