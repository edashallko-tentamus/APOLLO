package com.tentamus.lims.clients.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * One person, linked to many clients (one record per email address, kept unique by the database's key). Replaces the
 * database checks on the names and the email address (migration 059 drops them).
 */
public final class Contact {
    private static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", Pattern.CASE_INSENSITIVE);

    private Contact() {}

    /** The values about to be written: first and last name required, the email address well formed. */
    public static void check(Map<String, Object> vals, boolean isNew) {
        required(vals, "first_name", "First name", isNew);
        required(vals, "last_name", "Last name", isNew);
        if (isNew || vals.containsKey("email")) {
            Object e = vals.get("email");
            if (e == null || !EMAIL.matcher(e.toString()).matches()) throw RuleException.withCode("Email address is not valid.", "23514");
        }
    }

    private static void required(Map<String, Object> vals, String col, String label, boolean isNew) {
        if ((isNew || vals.containsKey(col)) && (vals.get(col) == null || vals.get(col).toString().strip().isEmpty()))
            throw RuleException.withCode(label + " is required.", "23514");
    }
}
