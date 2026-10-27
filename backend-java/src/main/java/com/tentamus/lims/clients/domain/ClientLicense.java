package com.tentamus.lims.clients.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * A client's license (cannabis, DEA…): added over time, never deleted; a renewal is a new license and an old one is
 * retired with a reason. Replaces the database trigger client_license_rules.
 */
public final class ClientLicense {
    /** The columns a person types for a license. */
    public static final List<String> FIELDS = List.of("license_type", "license_number", "issuing_authority", "issued_on", "expires_on", "note");

    private ClientLicense() {}

    /**
     * Applies the rules to a license about to be saved and returns the values to write (type and number trimmed;
     * the retirement reason cleared on an active license).
     *
     * @param before the license as stored, or null for a new one
     * @param after  the license as it will be (stored values with the changes applied)
     * @param changes the columns being written
     */
    public static Map<String, Object> checked(Map<String, Object> before, Map<String, Object> after, Map<String, Object> changes) {
        Map<String, Object> out = new LinkedHashMap<>(changes);
        if (changes.containsKey("license_type")) out.put("license_type", trim(changes.get("license_type")));
        if (changes.containsKey("license_number")) out.put("license_number", trim(changes.get("license_number")));
        String status = str(after.get("status"), "Active");
        if (before != null && !Objects.equals(str(before.get("client_id"), null), str(after.get("client_id"), null)))
            throw RuleException.database("A license stays with its client");
        if (before != null && "Retired".equals(str(before.get("status"), null)) && "Retired".equals(status)
            && (changed(before, after, "license_number", true) || changed(before, after, "expires_on", false)
                || changed(before, after, "issued_on", false) || changed(before, after, "license_type", true)))
            throw RuleException.database("A retired license is kept as it was");
        if ("Retired".equals(status) && str(after.get("retired_reason"), "").trim().isEmpty())
            throw RuleException.database("Say why the license is retired (e.g. replaced by a renewal, entered in error)");
        if ("Active".equals(status) && before != null && before.get("retired_reason") != null) out.put("retired_reason", null);
        return out;
    }

    private static boolean changed(Map<String, Object> before, Map<String, Object> after, String col, boolean trimmed) {
        Object a = before.get(col); Object b = after.get(col);
        if (trimmed) { a = trim(a); b = trim(b); }
        return !Objects.equals(a == null ? null : a.toString(), b == null ? null : b.toString());
    }

    private static Object trim(Object v) { return v == null ? null : v.toString().strip(); }

    private static String str(Object v, String d) { return v == null ? d : v.toString(); }
}
