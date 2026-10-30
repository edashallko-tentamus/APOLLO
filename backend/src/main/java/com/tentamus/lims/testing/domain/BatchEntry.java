package com.tentamus.lims.testing.domain;

import com.tentamus.lims.core.web.RuleException;

/**
 * A sample or QC entry in a batch. A superseded entry (re-prepared or removed) keeps its data and takes no more; the
 * day's shared control is recorded in the batch that holds it; only matrix spikes are made from a sample of the same
 * batch. Replaces batch_entry_rules, request_reprep and the entry rules of remove_batch_entry and set_analyst_pick.
 *
 * @param dailyOfEntryId the entry holding the day's shared control this one links to, or null
 */
public record BatchEntry(String id, String batchId, String label, String entryType, String qcType, String qcClass, String status, String supersededReason,
                         String dailyOfEntryId, String requestedTestId, String reprepRequestId, boolean media) {

    public static final String MATRIX_SPIKE = "Matrix Spike", SPIKE_DUPLICATE = "Matrix Spike Duplicate";

    public boolean sample() { return "Sample".equals(entryType); }

    public boolean active() { return "Active".equals(status); }

    public boolean spike() { return MATRIX_SPIKE.equals(qcType) || SPIKE_DUPLICATE.equals(qcType); }

    /** The entry belongs to the batch of the step it is recorded at. */
    public void assertIn(String batch) {
        if (!batchId.equals(batch)) throw RuleException.database("The entry is not in this batch");
    }

    /** Data is recorded only on active entries, and a shared daily control only in its own batch. */
    public void assertTakesData() {
        if (!active()) throw RuleException.database(label + " was superseded (" + supersededReason + ") and takes no more data");
        if (dailyOfEntryId != null) throw RuleException.database(label + " is the day's shared control: its data is recorded in the batch that holds it");
    }

    /** Only a sample is re-prepared (QC is made again with the new batch), and only once. */
    public void assertReprepable() {
        if (!sample()) throw RuleException.database(label + " is a QC sample; QC is made again with the new batch");
        if (!active()) throw RuleException.database(label + " is already superseded");
    }

    /** A sample leaves the batch only while others stay (else the batch is cancelled). */
    public void assertRemovable(boolean otherSamplesStay) {
        if (!sample()) throw RuleException.database("Only samples are removed; the QC entries follow the number of samples");
        if (!active()) throw RuleException.database(label + " is not in the batch any more");
        if (!otherSamplesStay) throw RuleException.database(label + " is the batch's only sample: cancel the batch instead");
    }

    /**
     * Choosing the sample a spike is made from (null clears it): a sample of the same batch, only for matrix spikes,
     * only before Batching is completed.
     */
    public void assertSpikeParent(BatchEntry parent, boolean batchingCompleted) {
        if (parent != null && (!parent.batchId().equals(batchId) || !parent.sample())) throw RuleException.database("A spike is made from a sample of the same batch");
        if (!spike()) throw RuleException.database("Only matrix spikes are made from a sample");
        if (batchingCompleted) throw RuleException.database("Batching is completed; reopen it to change which sample is spiked");
    }

    /** Readings are picked for active samples; QC readings are judged, not picked. */
    public void assertPickable() {
        if (!active()) throw RuleException.database("Entry not found");
        if (!sample() || requestedTestId == null) throw RuleException.database(label + " is QC: its readings are judged, not picked");
    }

    /** A re-prep is single, duplicate or triplicate, with a reason. */
    public static void assertReprepRequest(Integer replicates, boolean reasonGiven) {
        AnalyticalRun.assertReplicates(replicates);
        if (!reasonGiven) throw RuleException.database("Say why the sample is re-prepared");
    }

    /** The reason a re-prepared entry is superseded with. */
    public static String reprepReason(String reason) { return "Re-prep: " + reason; }
}
