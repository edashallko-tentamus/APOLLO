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
    private final Db db;
    private final UnitOfWork uow;
    private final FailureLimiter limiter;
    private final AuthEvents events;

    public SignatureService(Db db, UnitOfWork uow, FailureLimiter limiter, AuthEvents events) {
        this.db = db;
        this.uow = uow;
        this.limiter = limiter;
        this.events = events;
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
        if (u.get("locked_at") != null) throw new RuleException(AuthEvents.LOCKED);
        Object name = sig.get("username"), pw = sig.get("password");
        if (blank(name) || blank(pw)) throw new RuleException("An electronic signature is required: enter your user ID and password.");
        String username = (String) u.get("username");
        if (!name.toString().trim().equalsIgnoreCase(username)) {
            events.log(u.get("id"), username, "Signature failed", "signed with user ID \"" + left(name.toString(), 40) + "\"", null);
            throw new RuleException("Sign with your own user ID (you are signed in as " + username + ").");
        }
        if (!new PasswordHash((String) u.get("password_hash")).matches(pw.toString())) {
            throw new RuleException(events.wrongPassword(u, "Signature failed", ctx.ip()) ? AuthEvents.LOCKED : "The user ID or password is not correct. The signature was not applied.");
        }
        if (((Number) u.getOrDefault("failed_attempts", 0)).intValue() != 0) db.update("UPDATE app_user SET failed_attempts = 0 WHERE id = ?::uuid", u.get("id"));
    }

    private static boolean blank(Object v) { return v == null || v.toString().isEmpty() || Boolean.FALSE.equals(v); }

    private static String left(String s, int n) { return s.length() <= n ? s : s.substring(0, n); }
}
