package com.tentamus.lims.core.signature;

import com.tentamus.lims.core.db.Db;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * The append-only sign-in log (auth_event) and the account lock: five wrong passwords, at sign-in or when signing, lock
 * the account until an administrator sets a temporary password. Each write stands on its own (outside any action's
 * transaction), so a refused attempt is still counted and logged.
 */
@Component
public class AuthEvents {
    public static final int MAX_ATTEMPTS = 5;
    public static final String LOCKED = "This account is locked after too many wrong passwords. Ask an administrator to unlock it.";
    private final Db db;
    private final FailureLimiter limiter;

    public AuthEvents(Db db, FailureLimiter limiter) {
        this.db = db;
        this.limiter = limiter;
    }

    public void log(Object userId, Object username, String event, String detail, Object by) {
        db.update("INSERT INTO auth_event (user_id, username, event, detail, by_user) VALUES (?::uuid, ?, ?, ?, ?::uuid)", userId, username, event, detail, by);
    }

    /** Counts a wrong password for the account u (a row of app_user) and the computer; true when the account is now locked. */
    public boolean wrongPassword(Map<String, Object> u, String event, String ip) {
        limiter.note(ip);
        int n = nextAttempt(u.get("failed_attempts"));
        db.update("UPDATE app_user SET failed_attempts = ?::int, locked_at = CASE WHEN ?::int >= ?::int THEN clock_timestamp() ELSE locked_at END WHERE id = ?::uuid",
            n, n, MAX_ATTEMPTS, u.get("id"));
        log(u.get("id"), u.get("username"), event, "attempt " + n + " of " + MAX_ATTEMPTS, null);
        if (!locks(n)) return false;
        log(u.get("id"), u.get("username"), "Account locked", MAX_ATTEMPTS + " wrong passwords", null);
        return true;
    }

    /** The attempt number after one more wrong password (failed_attempts may be null). */
    static int nextAttempt(Object failed) { return (failed == null ? 0 : ((Number) failed).intValue()) + 1; }

    static boolean locks(int attempt) { return attempt >= MAX_ATTEMPTS; }
}
