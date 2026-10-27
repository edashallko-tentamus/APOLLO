package com.tentamus.lims.core.signature;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import java.util.Map;
import java.util.function.Function;
import org.springframework.stereotype.Service;

/**
 * Electronic signatures (21 CFR Part 11): the signer re-enters their own user ID and password for the action. A wrong
 * password counts toward the account lock and is recorded at once, outside the action's transaction (kept when it fails).
 */
@Service
public class SignatureService {
    public static final int MAX_ATTEMPTS = 5;
    static final String LOCKED = "This account is locked after too many wrong passwords. Ask an administrator to unlock it.";
    private final Db db;
    private final UnitOfWork uow;
    private final FailureLimiter limiter;

    public SignatureService(Db db, UnitOfWork uow, FailureLimiter limiter) {
        this.db = db;
        this.uow = uow;
        this.limiter = limiter;
    }

    /** What is signed: the meaning ("Changed by"), the action, the module (for the signature record). */
    public record Meaning(String meaning, String action, String module) {}

    /** Checks the signature in the request body ({signature: {username, password}}), then runs the work signed. */
    public <T> T signed(RequestContext ctx, Map<String, Object> body, Meaning m, Function<Db, T> work) {
        verify(ctx, body);
        return uow.run(ctx, d -> {
            d.one("SELECT sign_action(?, ?, ?, ?) AS id", m.meaning(), m.action(), m.module(), ctx.reason().isEmpty() ? null : ctx.reason());
            return work.apply(d);
        });
    }

    public void verify(RequestContext ctx, Map<String, Object> body) {
        Object raw = body == null ? null : body.get("signature");
        Map<?, ?> sig = raw instanceof Map<?, ?> m ? m : Map.of();
        limiter.check(ctx.ip());
        Map<String, Object> u = db.one("SELECT id, username, password_hash, locked_at, failed_attempts FROM app_user WHERE id = ?", ctx.userId());
        if (u == null) throw new RuleException("Sign in first");
        if (u.get("locked_at") != null) throw new RuleException(LOCKED);
        Object name = sig.get("username"), pw = sig.get("password");
        if (blank(name) || blank(pw)) throw new RuleException("An electronic signature is required: enter your user ID and password.");
        String username = (String) u.get("username");
        if (!name.toString().trim().equalsIgnoreCase(username)) {
            log(u, "Signature failed", "signed with user ID \"" + left(name.toString(), 40) + "\"");
            throw new RuleException("Sign with your own user ID (you are signed in as " + username + ").");
        }
        if (!new PasswordHash((String) u.get("password_hash")).matches(pw.toString())) {
            throw new RuleException(wrongPassword(u, ctx.ip()) ? LOCKED : "The user ID or password is not correct. The signature was not applied.");
        }
        if (((Number) u.getOrDefault("failed_attempts", 0)).intValue() != 0) db.update("UPDATE app_user SET failed_attempts = 0 WHERE id = ?::uuid", u.get("id"));
    }

    /** Counts a wrong password; true when the account is now locked. */
    private boolean wrongPassword(Map<String, Object> u, String ip) {
        limiter.note(ip);
        Object f = u.get("failed_attempts");
        int n = (f == null ? 0 : ((Number) f).intValue()) + 1;
        db.update("UPDATE app_user SET failed_attempts = ?::int, locked_at = CASE WHEN ?::int >= ?::int THEN clock_timestamp() ELSE locked_at END WHERE id = ?::uuid",
            n, n, MAX_ATTEMPTS, u.get("id"));
        log(u, "Signature failed", "attempt " + n + " of " + MAX_ATTEMPTS);
        if (n < MAX_ATTEMPTS) return false;
        log(u, "Account locked", MAX_ATTEMPTS + " wrong passwords");
        return true;
    }

    private void log(Map<String, Object> u, String event, String detail) {
        db.update("INSERT INTO auth_event (user_id, username, event, detail) VALUES (?::uuid, ?, ?, ?)", u.get("id"), u.get("username"), event, detail);
    }

    private static boolean blank(Object v) { return v == null || v.toString().isEmpty() || Boolean.FALSE.equals(v); }

    private static String left(String s, int n) { return s.length() <= n ? s : s.substring(0, n); }
}
