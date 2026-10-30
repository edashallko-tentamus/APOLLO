package com.tentamus.lims.testing.service;

import static com.tentamus.lims.testing.service.TestingValues.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.testing.domain.Batch;
import com.tentamus.lims.testing.domain.BatchEntry;
import com.tentamus.lims.testing.domain.BatchPlan;
import com.tentamus.lims.testing.repo.BenchRepository;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Making batches from the backlog, changing their samples before bench work starts, assigning them, and re-preps: the
 * use cases of the Batch, BatchPlan and BatchEntry domain objects (migration 067 moved their rules out of the database).
 */
@Service
public class BatchMakingService {
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final BenchRepository bench;
    private final ObjectMapper json;

    public BatchMakingService(UnitOfWork uow, AccessPolicy access, BenchRepository bench, ObjectMapper json) {
        this.uow = uow;
        this.access = access;
        this.bench = bench;
        this.json = json;
    }

    /** The Batching step's config, after checking the person may batch the test (testing.perform, its department). */
    private JsonNode mayBatch(Db d, Object site, Object version, String testName, String user) {
        bench.requirePermission(d, "testing.perform", site);
        Map<String, Object> bs = bench.batchingStep(d, version, user);
        if (bs == null) return null;
        BenchRepository.department(bs).assertCanBatch(testName);
        return bs.get("config") instanceof JsonNode n ? n : null;
    }

    /** A new batch: from the chosen backlog items, or (autobatch) the backlog in priority order up to the maximum. */
    public Map<String, Object> create(RequestContext ctx, String site, Object version, Object items) {
        return uow.run(ctx, d -> {
            Map<String, Object> v = d.one("SELECT v.id, t.id AS test_id, t.test_name, t.department_id FROM test_version v JOIN test t ON t.id = v.test_id WHERE v.id = ?::uuid", version);
            if (v == null) throw RuleException.database("Test version not found");
            JsonNode cfg = mayBatch(d, site, version, (String) v.get("test_name"), ctx.userId());
            List<BatchPlan.QcSpec> qc = BenchRepository.qcSpecs(cfg);
            BatchPlan plan = BatchPlan.make(bench.pool(d, site, version, items == null ? null : toJson(json, items)), BenchRepository.maxSamples(cfg), qc,
                type -> bench.daily(d, site, v.get("test_id"), type));
            Map<String, Object> b = d.one("""
                INSERT INTO test_batch (site_id, test_id, test_version_id, department_id, assigned_to) VALUES (?::uuid, ?::uuid, ?::uuid, ?::uuid, ?::uuid) RETURNING id, batch_code""",
                site, v.get("test_id"), version, v.get("department_id"), ctx.userId());
            bench.insertEntries(d, b.get("id"), plan.entries());
            bench.markBatched(d, plan.batchedRepreps(), b.get("id"));
            d.update("INSERT INTO step_run (batch_id, step_id) SELECT ?::uuid, id FROM workflow_step WHERE test_version_id = ?::uuid AND status = 'Active'", b.get("id"), version);
            return b;
        });
    }

    private Batch changeable(Db d, Batch b, String user) {
        mayBatch(d, b.siteId(), b.versionId(), b.testName(), user);
        b.assertSamplesChangeable(bench.started(d, b.id()));
        return b;
    }

    /** Backlog items join a batch that has not started (no signature: Alex). Returns how many items joined. */
    public Object add(RequestContext ctx, String batchId, List<Map<String, Object>> items) {
        return uow.run(ctx, d -> {
            Batch b = changeable(d, bench.batch(d, batchId), ctx.userId());
            String list = toJson(json, items);
            b.assertJoinable(bench.otherVersion(d, list, b));
            List<BatchPlan.QcSpec> qc = BenchRepository.qcSpecs(configOf(d, b, ctx.userId()));
            List<BatchPlan.PoolItem> pool = bench.pool(d, b.siteId(), b.versionId(), list);
            BatchPlan plan = BatchPlan.join(pool, BenchRepository.maxSamples(configOf(d, b, ctx.userId())), bench.clientSamples(d, b.id()), bench.lastPosition(d, b.id()), b.code());
            bench.insertEntries(d, b.id(), plan.entries());
            bench.markBatched(d, plan.batchedRepreps(), b.id());
            // a matrix spike with no client sample yet (a batch of media samples only) is made from the first one added
            d.update("""
                UPDATE batch_entry x SET parent_entry_id = (SELECT e.id FROM batch_entry e JOIN requested_test rt ON rt.id = e.requested_test_id
                                                             WHERE e.batch_id = ?::uuid AND e.entry_type = 'Sample' AND e.status = 'Active' AND rt.media_lot_id IS NULL ORDER BY e.position LIMIT 1)
                 WHERE x.batch_id = ?::uuid AND x.status = 'Active' AND x.qc_type IN ('Matrix Spike','Matrix Spike Duplicate')
                   AND (x.parent_entry_id IS NULL OR x.parent_entry_id IN (SELECT e.id FROM batch_entry e JOIN requested_test rt ON rt.id = e.requested_test_id WHERE rt.media_lot_id IS NOT NULL))
                   AND EXISTS (SELECT 1 FROM batch_entry e JOIN requested_test rt ON rt.id = e.requested_test_id WHERE e.batch_id = ?::uuid AND e.entry_type = 'Sample' AND e.status = 'Active' AND rt.media_lot_id IS NULL)""",
                b.id(), b.id(), b.id());
            bench.samplesChanged(d, b.id(), qc, ctx.userId());
            return pool.size();
        });
    }

    private JsonNode configOf(Db d, Batch b, String user) {
        Map<String, Object> bs = bench.batchingStep(d, b.versionId(), user);
        return bs != null && bs.get("config") instanceof JsonNode n ? n : null;
    }

    /** A sample (all its preparations here) leaves a batch that has not started and goes back to the backlog. */
    public Object remove(RequestContext ctx, String entryId) {
        return uow.run(ctx, d -> {
            BatchEntry e = bench.entry(d, entryId);
            if (e == null) throw RuleException.database("Entry not found");
            Batch b = changeable(d, bench.batch(d, e.batchId()), ctx.userId());
            boolean others = d.one("""
                SELECT 1 AS x FROM batch_entry x WHERE x.batch_id = ?::uuid AND x.entry_type = 'Sample' AND x.status = 'Active'
                   AND NOT (x.requested_test_id = ?::uuid AND x.reprep_request_id IS NOT DISTINCT FROM ?::uuid) LIMIT 1""", b.id(), e.requestedTestId(), e.reprepRequestId()) != null;
            e.assertRemovable(others);
            int n = d.update("""
                UPDATE batch_entry SET status = 'Superseded', superseded_reason = 'Removed from the batch', removed_at = clock_timestamp(), removed_by = ?::uuid
                 WHERE batch_id = ?::uuid AND entry_type = 'Sample' AND status = 'Active' AND requested_test_id = ?::uuid AND reprep_request_id IS NOT DISTINCT FROM ?::uuid""",
                ctx.userId(), b.id(), e.requestedTestId(), e.reprepRequestId());
            if (e.reprepRequestId() != null) d.update("UPDATE reprep_request SET status = 'Pooled', batch_id = NULL WHERE id = ?::uuid", e.reprepRequestId());
            // spikes made from it move to the first client sample left
            d.update("""
                UPDATE batch_entry x SET parent_entry_id = (SELECT y.id FROM batch_entry y JOIN requested_test rt ON rt.id = y.requested_test_id
                                                             WHERE y.batch_id = ?::uuid AND y.entry_type = 'Sample' AND y.status = 'Active' ORDER BY rt.media_lot_id IS NOT NULL, y.position LIMIT 1)
                 WHERE x.batch_id = ?::uuid AND x.status = 'Active' AND x.parent_entry_id IN (SELECT id FROM batch_entry WHERE removed_at IS NOT NULL AND batch_id = ?::uuid)""",
                b.id(), b.id(), b.id());
            bench.samplesChanged(d, b.id(), BenchRepository.qcSpecs(configOf(d, b, ctx.userId())), ctx.userId());
            return n;
        });
    }

    /** A Lab Supervisor gives the batch to someone who does bench work in its lab. */
    public void assign(RequestContext ctx, String batchId, Object user) {
        uow.run(ctx, d -> {
            Batch b = bench.batch(d, batchId);
            bench.requirePermission(d, "testing.assign", b.siteId());
            b.assertAssignable(access.load(user.toString()).can("testing.perform", b.siteId()));
            d.update("UPDATE test_batch SET assigned_to = ?::uuid WHERE id = ?::uuid", user, b.id());
            return null;
        });
    }

    /** Re-prep (inside the signed transaction): the samples go back to the top of the backlog; their entries here are superseded and keep their data. */
    public int reprep(Db d, RequestContext ctx, List<Object> entryIds, Object replicates) {
        Integer reps = replicates instanceof Long n && n >= Integer.MIN_VALUE && n <= Integer.MAX_VALUE ? Integer.valueOf(n.intValue()) : null;
        String reason = ctx.reason().strip();
        BatchEntry.assertReprepRequest(reps, !reason.isEmpty());
        int n = 0;
        for (Object id : entryIds) {
            BatchEntry e = bench.entry(d, id);
            if (e == null) throw RuleException.database("Entry not found");
            e.assertReprepable();
            Batch b = bench.batch(d, e.batchId());
            bench.requirePermission(d, "testing.perform", b.siteId());
            b.assertReprepAllowed();
            d.update("""
                INSERT INTO reprep_request (requested_test_id, origin_entry_id, replicates, reason, signature_id)
                VALUES (?::uuid, ?::uuid, ?, ?, NULLIF(current_setting('lims.signature_id', true), '')::uuid)""", e.requestedTestId(), e.id(), reps, reason);
            d.update("UPDATE batch_entry SET status = 'Superseded', superseded_reason = ? WHERE id = ?::uuid", BatchEntry.reprepReason(reason), e.id());
            n++;
        }
        return n;
    }
}
