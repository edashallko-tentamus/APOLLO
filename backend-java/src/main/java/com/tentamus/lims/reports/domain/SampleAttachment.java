package com.tentamus.lims.reports.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.Objects;

/**
 * A file on a lab order or one of its samples (submission form, chain of custody, correspondence). Replaces the rule
 * parts of sample_attachment_rules (migration 069); its permission check stays in the database. An attachment keeps
 * its file because Java never changes it (a new one is added and the old set Inactive).
 */
public final class SampleAttachment {
    private SampleAttachment() {}

    /** @param sampleOrderId the order of the named sample (null for the whole order) */
    public static void checkNew(String orderId, String sampleId, String sampleOrderId) {
        if (sampleId != null && !Objects.equals(sampleOrderId, orderId)) throw RuleException.database("That sample is not on this order");
    }
}
