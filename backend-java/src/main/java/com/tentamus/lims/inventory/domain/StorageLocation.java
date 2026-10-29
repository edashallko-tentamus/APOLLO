package com.tentamus.lims.inventory.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * A place in a lab where material or samples are kept (nested: building > room > fridge > shelf), with the storage
 * conditions it provides. Replaces the database trigger storage_location_rules and the non-blank checks on the code and
 * name (migration 062 drops them); assert_storage_ok stays in the database for the lot and sample triggers that still use it.
 */
public record StorageLocation(String id, String siteId, String code, String name, String parentId, List<String> conditions, boolean holdsSamples, String status) {

    public static StorageLocation of(Map<String, Object> row) {
        if (row == null) return null;
        return new StorageLocation(Values.str(row.get("id")), Values.str(row.get("site_id")), Values.str(row.get("location_code")),
            Values.str(row.get("location_name")), Values.str(row.get("parent_location_id")), Values.list(row.get("supported_conditions")),
            Values.bool(row.get("holds_samples")), row.get("status") == null ? "Active" : row.get("status").toString());
    }

    /**
     * Checks a location about to be saved and returns the values to write (the code trimmed and in capitals).
     *
     * @param before the location as stored, or null for a new one
     * @param after  the location as it will be
     * @param changes the columns being written
     * @param parent the parent location, or null
     * @param aboveParent the ids of the parent and every location above it
     */
    public static Map<String, Object> checked(StorageLocation before, Map<String, Object> after, Map<String, Object> changes,
                                              StorageLocation parent, List<String> aboveParent) {
        Map<String, Object> out = new LinkedHashMap<>(changes);
        if (changes.containsKey("location_code") && changes.get("location_code") != null)
            out.put("location_code", changes.get("location_code").toString().strip().toUpperCase(java.util.Locale.ROOT));
        if (Values.blank(after.get("location_code"))) throw RuleException.withCode("Give the location a code.", "23514");
        if (Values.blank(after.get("location_name"))) throw RuleException.withCode("Give the location a name.", "23514");
        String site = Values.str(after.get("site_id"));
        if (before != null && !Objects.equals(before.siteId(), site)) throw RuleException.database("A storage location cannot move to another lab");
        if (parent != null) {
            if (!Objects.equals(parent.siteId(), site)) throw RuleException.database("A storage location must be inside a location in the same lab");
            String self = before == null ? Values.str(after.get("id")) : before.id();
            if (self != null && aboveParent.contains(self)) throw RuleException.database("A storage location cannot be inside itself");
        }
        return out;
    }

    /** A stored item's condition must be one the location provides (a location with no conditions listed is not checked). */
    public void assertAccepts(String site, String condition, String what) {
        if (!Objects.equals(siteId, site)) throw RuleException.database("Storage location " + code + " is in another lab");
        if (!"Active".equals(status)) throw RuleException.database("Storage location " + code + " is Inactive");
        if (condition != null && !conditions.isEmpty() && !conditions.contains(condition))
            throw RuleException.database(what + " needs \"" + condition + "\" but " + name + " (" + code + ") provides only: " + String.join(", ", conditions));
    }

    public void assertHoldsSamples() {
        if (!holdsSamples) throw RuleException.database("That storage location is not set up to hold samples");
    }
}
