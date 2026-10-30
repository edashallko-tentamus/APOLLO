package com.tentamus.lims.inventory.domain;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * Where a sample is kept and how much of it is retained. Java's own copy of the database trigger sample_storage_check,
 * which stays because intake changes the quantity received on the same table.
 */
public final class SampleRetain {
    private SampleRetain() {}

    /**
     * Checks a sample's storage about to be written and returns the values to write (the retained unit defaults to the
     * unit received).
     *
     * @param after the sample as it will be; location its storage location (or null); site the sample's lab
     */
    public static Map<String, Object> checked(Map<String, Object> after, Map<String, Object> changes, StorageLocation location, String site) {
        Map<String, Object> out = new LinkedHashMap<>(changes);
        BigDecimal retained = Values.dec(after.get("retained_quantity"));
        if (location == null && retained == null) return out;
        if (location != null) {
            location.assertHoldsSamples();
            Object code = after.get("sample_code") != null ? after.get("sample_code") : after.get("client_sample_id");
            location.assertAccepts(site, Values.str(after.get("storage_condition")), "Sample " + (code == null ? "" : code));
        }
        if (retained != null) {
            if (retained.signum() < 0) throw RuleException.withCode("The retained quantity cannot be negative.", "23514");
            String unit = Values.trimmed(after.get("retained_unit"));
            String received = Values.str(after.get("quantity_unit"));
            if (unit == null) { unit = received; if (changes.containsKey("retained_quantity") || changes.containsKey("retained_unit")) out.put("retained_unit", unit); }
            BigDecimal got = Values.dec(after.get("quantity_received"));
            if (got != null && Objects.equals(unit, received) && retained.compareTo(got) > 0)
                throw RuleException.database("Retained quantity (" + Values.fmt(retained) + " " + unit + ") cannot be more than was received (" + Values.fmt(got) + " " + received + ")");
        }
        return out;
    }
}
