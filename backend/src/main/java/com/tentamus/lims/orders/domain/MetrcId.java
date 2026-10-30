package com.tentamus.lims.orders.domain;

import com.tentamus.lims.core.web.RuleException;

/** A METRC package tag: 24 letters and digits starting with 1A, stored in capitals without spaces (was the trigger sample_metrc_rule). */
public final class MetrcId {
    private MetrcId() {}

    /** The tag as stored, or null for none; refuses anything that is not a METRC tag. */
    public static String normalize(Object raw) {
        if (raw == null) return null;
        String v = raw.toString().replaceAll("\\s", "").toUpperCase();
        if (v.isEmpty()) return null;
        if (!v.matches("^1A[0-9A-Z]{22}$")) throw RuleException.database("METRC ID " + v + " is not a METRC tag: 24 letters and digits, starting with 1A");
        return v;
    }
}
