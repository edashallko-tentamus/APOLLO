package com.tentamus.lims.auth.domain;

import com.tentamus.lims.core.signature.PasswordHash;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;

/** A person's sign-in account (a row of app_user): who they are and the state of their password. */
public record Account(Map<String, Object> row) {
    private static final Pattern USER_ID = Pattern.compile("^[a-z0-9._-]{3,40}$");

    public static Account of(Map<String, Object> row) { return row == null ? null : new Account(row); }

    public String id() { return (String) row.get("id"); }

    public String username() { return (String) row.get("username"); }

    public boolean active() { return Boolean.TRUE.equals(row.get("is_active")); }

    public boolean automated() { return Boolean.TRUE.equals(row.get("is_automated")); }

    public boolean systemAdmin() { return Boolean.TRUE.equals(row.get("is_admin")); }

    public boolean locked() { return row.get("locked_at") != null; }

    public boolean hasPassword() { return row.get("password_hash") != null; }

    public boolean mustChangePassword() { return Boolean.TRUE.equals(row.get("must_change_password")); }

    public boolean hasFailedAttempts() { Object f = row.get("failed_attempts"); return f != null && ((Number) f).intValue() != 0; }

    /** Whether a typed password (any JSON value; only text can match) is this account's password. */
    public boolean passwordIs(Object typed) {
        return typed instanceof String s && new PasswordHash((String) row.get("password_hash")).matches(s);
    }

    /** The checks on a new password: the rule, then typed twice the same. */
    public String newPasswordProblem(Object password, Object confirm, String notSameMessage) {
        String bad = PasswordRule.problem(password, username());
        if (bad != null) return bad;
        if (!Objects.equals(password, confirm)) return notSameMessage;
        return null;
    }

    /** A new account's user ID: 3 to 40 lowercase letters, numbers, dots, dashes or underscores. */
    public static boolean validUserId(String username) { return USER_ID.matcher(username).matches(); }
}
