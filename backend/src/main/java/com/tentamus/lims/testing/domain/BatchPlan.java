package com.tentamus.lims.testing.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;

/**
 * What a new batch holds: the backlog items in priority order up to the Batching step's maximum (re-preps one entry per
 * replicate, labelled RP1-, RP2-...; media qualification samples outside the maximum and the brackets), then its QC:
 * "once" QC (matrix spikes made from the first client sample), "every N" brackets (ceil(n / N) + 1 for n client
 * samples) and the day's shared controls. Java's copy of create_batch() (kept in the database for the demo data load
 * and Node's automated verification run) and of batch_samples_changed().
 */
public final class BatchPlan {
    /** A backlog item (test_pool_view row), in priority order. earlierRepreps: entries of re-preps of this test already made. */
    public record PoolItem(String requestedTestId, String reprepRequestId, boolean reprep, int replicates, String sampleLabel, boolean media, int earlierRepreps) {}

    /** One QC line of the Batching step's config. */
    public record QcSpec(String qcType, String qcClass, String frequency, Integer count, Integer everyN) {
        int times() { return count == null ? 1 : count; }

        int every() { return Math.max(everyN == null ? 10 : everyN, 1); }

        boolean bracket() { return "Every N".equals(frequency); }
    }

    /** The day's shared control already held by an earlier batch of the test. */
    public record DailyControl(String entryId, String qcClass, String batchCode) {}

    /** An entry to insert. parentEntryId: the sample a matrix spike is made from. */
    public record PlannedEntry(String id, String entryType, String requestedTestId, String reprepRequestId, String label, int replicateNo,
                               String qcType, String qcClass, String parentEntryId, String dailyOfEntryId, int position) {
        public RunOrder.Slot slot() { return new RunOrder.Slot(id, entryType, qcClass, qcType, label, parentEntryId, true, position); }
    }

    private final List<PlannedEntry> entries = new ArrayList<>();
    private final List<String> batchedRepreps = new ArrayList<>();
    private int clientSamples;

    private BatchPlan() {}

    public List<PlannedEntry> entries() { return entries; }

    /** The re-prep requests the batch takes (they become Batched). */
    public List<String> batchedRepreps() { return batchedRepreps; }

    /**
     * Plans a new batch.
     *
     * @param pool  the backlog items to take, in priority order
     * @param daily the day's control already held for a QC type, or null
     */
    public static BatchPlan make(List<PoolItem> pool, int maxSamples, List<QcSpec> qc, Function<String, DailyControl> daily) {
        BatchPlan p = new BatchPlan();
        boolean full = false;
        String firstClient = null, firstMedia = null;
        Map<String, Integer> repreps = new HashMap<>();
        for (PoolItem it : pool) {
            // client samples stop at the first that does not fit; media samples still join
            if (!it.media()) {
                if (full || p.clientSamples + it.replicates() > maxSamples) { full = true; continue; }
            }
            for (PlannedEntry e : p.samplesOf(it, repreps, 0)) {
                if (!it.media() && firstClient == null) firstClient = e.id();
                if (it.media() && firstMedia == null) firstMedia = e.id();
            }
        }
        if (p.entries.isEmpty()) throw RuleException.database("Nothing in the pool for this test at this lab");
        String spikeFrom = firstClient != null ? firstClient : firstMedia;
        for (QcSpec q : qc) {
            if ("Once".equals(q.frequency())) {
                for (int i = 1; i <= q.times(); i++)
                    p.add("QC", null, null, q.qcType() + (q.times() > 1 ? " " + i : ""), 1, q.qcType(), q.qcClass(),
                        BatchEntry.MATRIX_SPIKE.equals(q.qcType()) || BatchEntry.SPIKE_DUPLICATE.equals(q.qcType()) ? spikeFrom : null, null);
            } else if (q.bracket()) {
                for (int i = 1; i <= brackets(p.clientSamples, q.every()); i++) p.add("QC", null, null, q.qcType() + "-" + i, 1, q.qcType(), q.qcClass(), null, null);
            } else if ("Daily".equals(q.frequency())) {
                DailyControl d = daily.apply(q.qcType());
                if (d == null) p.add("QC", null, null, q.qcType() + " (daily)", 1, q.qcType(), q.qcClass() == null ? "Prep" : q.qcClass(), null, null);
                else p.add("QC", null, null, q.qcType() + " (daily, from " + d.batchCode() + ")", 1, q.qcType(), d.qcClass(), null, d.entryId());
            }
        }
        p.reorder(qc);
        return p;
    }

    /**
     * Samples joining a batch that has not started (add_batch_items): the batch's maximum still holds.
     *
     * @param clientSamples the client samples already in it
     * @param lastPosition  the batch's highest position
     */
    public static BatchPlan join(List<PoolItem> pool, int maxSamples, int clientSamples, int lastPosition, String batchCode) {
        BatchPlan p = new BatchPlan();
        p.clientSamples = clientSamples;
        Map<String, Integer> repreps = new HashMap<>();
        for (PoolItem it : pool) {
            if (!it.media() && p.clientSamples + it.replicates() > maxSamples)
                throw RuleException.database("Batch " + batchCode + " is full: up to " + maxSamples + " samples per batch for this test (it has " + p.clientSamples + ")");
            p.samplesOf(it, repreps, lastPosition);
        }
        if (pool.isEmpty()) throw RuleException.database("Those samples are no longer waiting in the backlog (another batch may have taken them)");
        return p;
    }

    private List<PlannedEntry> samplesOf(PoolItem it, Map<String, Integer> repreps, int offset) {
        List<PlannedEntry> made = new ArrayList<>();
        for (int i = 1; i <= it.replicates(); i++) {
            if (!it.media()) clientSamples++;
            String prefix = "";
            if (it.reprep()) {
                // RP1-, RP2-...: re-preps of the same test are numbered on, never reused
                int n = repreps.merge(it.requestedTestId(), 1, Integer::sum) + it.earlierRepreps();
                prefix = "RP" + n + "-";
            }
            made.add(add("Sample", it.requestedTestId(), it.reprepRequestId(), prefix + it.sampleLabel(), i, null, null, null, null, offset));
        }
        if (it.reprepRequestId() != null) batchedRepreps.add(it.reprepRequestId());
        return made;
    }

    private PlannedEntry add(String type, String rt, String reprep, String label, int rep, String qcType, String qcClass, String parent, String dailyOf) {
        return add(type, rt, reprep, label, rep, qcType, qcClass, parent, dailyOf, 0);
    }

    private PlannedEntry add(String type, String rt, String reprep, String label, int rep, String qcType, String qcClass, String parent, String dailyOf, int offset) {
        PlannedEntry e = new PlannedEntry(UUID.randomUUID().toString(), type, rt, reprep, label, rep, qcType, qcClass, parent, dailyOf, offset + entries.size() + 1);
        entries.add(e);
        return e;
    }

    private void reorder(List<QcSpec> qc) {
        Map<String, Integer> pos = RunOrder.positions(entries.stream().map(PlannedEntry::slot).toList(), smallestEveryN(qc));
        entries.replaceAll(e -> pos.containsKey(e.id()) ? new PlannedEntry(e.id(), e.entryType(), e.requestedTestId(), e.reprepRequestId(), e.label(), e.replicateNo(),
            e.qcType(), e.qcClass(), e.parentEntryId(), e.dailyOfEntryId(), pos.get(e.id())) : e);
    }

    /** How many brackets n client samples take with a bracket every N samples (an opening one plus one per N). */
    public static int brackets(int clientSamples, int every) { return (int) Math.ceil((double) clientSamples / every) + 1; }

    /** The smallest "every N" of the Batching step's brackets (the run order places brackets by it), or null. */
    public static Integer smallestEveryN(List<QcSpec> qc) { return qc.stream().filter(QcSpec::bracket).map(QcSpec::every).min(Integer::compare).orElse(null); }

    /**
     * The brackets' change when the number of client samples changes (batch_samples_changed): the labels to add
     * ("CCV-3"), or how many of the highest-numbered to take out.
     *
     * @param current the active brackets of that QC type now
     */
    public record BracketChange(List<String> add, int remove) {
        public static BracketChange of(QcSpec q, int clientSamples, int current) {
            int k = brackets(clientSamples, q.every());
            List<String> add = new ArrayList<>();
            for (int i = current + 1; i <= k; i++) add.add(q.qcType() + "-" + i);
            return new BracketChange(add, Math.max(current - k, 0));
        }
    }
}
