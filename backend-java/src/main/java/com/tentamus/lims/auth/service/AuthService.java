package com.tentamus.lims.auth.service;

import static com.tentamus.lims.core.web.Answers.map;
import static com.tentamus.lims.core.web.Answers.ok;

import com.tentamus.lims.auth.domain.Account;
import com.tentamus.lims.auth.domain.PasswordRule;
import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.session.SessionStore;
import com.tentamus.lims.core.signature.AuthEvents;
import com.tentamus.lims.core.signature.FailureLimiter;
import com.tentamus.lims.core.signature.PasswordHash;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Sign in, first-time setup, sign out, password changes and the administrators' account tools (the Node backend's
 * auth.js). Every login, failure, lockout and password change is written to the append-only auth_event log.
 */
@Service
public class AuthService {
    private static final String WRONG = "The user ID or password is not correct.";
    private final Db db;
    private final SessionStore sessions;
    private final AuthEvents events;
    private final FailureLimiter limiter;
    private final AccessPolicy access;

    public AuthService(Db db, SessionStore sessions, AuthEvents events, FailureLimiter limiter, AccessPolicy access) {
        this.db = db;
        this.sessions = sessions;
        this.events = events;
        this.limiter = limiter;
        this.access = access;
    }

    /** An answer that also starts or ends the session (the Set-Cookie header value). */
    public record WithCookie(String cookie, Map<String, Object> body) {}

    private boolean setupNeeded() {
        return db.one("SELECT 1 AS x FROM app_user WHERE is_admin AND is_active AND password_hash IS NOT NULL") == null;
    }

    private Account account(Object id) { return Account.of(db.one("SELECT * FROM app_user WHERE id = ?", id)); }

    public Map<String, Object> state(RequestContext ctx, boolean expired) {
        Object me = ctx.userId() == null ? null : db.one("SELECT id, username, full_name, is_admin, must_change_password FROM app_user WHERE id = ?", ctx.userId());
        boolean needed = setupNeeded();
        return map("user", me, "setupNeeded", needed, "timedOut", expired, "idleMinutes", sessions.idleMinutes(),
            "setupUsers", needed ? db.rows("SELECT username, full_name FROM app_user WHERE is_admin AND is_active AND username <> 'system' ORDER BY full_name") : List.of());
    }

    /** First run only: no administrator has a password yet; an administrator account sets its own. */
    public WithCookie setup(RequestContext ctx, Map<String, Object> b) {
        limiter.check(ctx.ip());
        if (!setupNeeded()) throw new RuleException("Setup is already done. Sign in instead.");
        Account u = Account.of(db.one("SELECT * FROM app_user WHERE lower(username) = lower(?) AND is_admin AND is_active", Js.string(Js.orBlank(b.get("username"))).trim()));
        if (u == null) throw new RuleException("Choose an administrator account.");
        String bad = u.newPasswordProblem(b.get("password"), b.get("confirm"), "The two passwords are not the same.");
        if (bad != null) throw new RuleException(bad);
        db.update("UPDATE app_user SET password_hash = ?, password_changed_at = clock_timestamp(), must_change_password = false, failed_attempts = 0, locked_at = NULL, last_login_at = clock_timestamp() WHERE id = ?::uuid",
            PasswordHash.create((String) b.get("password")).stored(), u.id());
        events.log(u.id(), u.username(), "Password set", "first-time setup", null);
        events.log(u.id(), u.username(), "Logged in", null, null);
        return new WithCookie(sessions.start(u.id()), ok());
    }

    public WithCookie login(RequestContext ctx, Map<String, Object> b) {
        limiter.check(ctx.ip());
        String name = Js.string(Js.orBlank(b.get("username"))).trim();
        Account u = Account.of(db.one("SELECT * FROM app_user WHERE lower(username) = lower(?) AND username <> 'system'", name));
        if (u == null || !u.active()) {
            limiter.note(ctx.ip());
            events.log(null, name.length() > 60 ? name.substring(0, 60) : name, "Login failed", "unknown or inactive user ID", null);
            throw new RuleException(WRONG);
        }
        if (u.automated()) {
            events.log(u.id(), u.username(), "Login failed", "automated verification account", null);
            throw new RuleException("This is an automated verification account: it works only inside a workflow verification run and cannot sign in.");
        }
        if (u.locked()) {
            events.log(u.id(), u.username(), "Login failed", "account locked", null);
            throw new RuleException(AuthEvents.LOCKED);
        }
        if (!u.hasPassword()) throw new RuleException("No password has been set for this account yet. Ask an administrator for a temporary password.");
        if (!u.passwordIs(Js.string(Js.orBlank(b.get("password"))))) {
            throw new RuleException(events.wrongPassword(u.row(), "Login failed", ctx.ip()) ? AuthEvents.LOCKED : WRONG);
        }
        db.update("UPDATE app_user SET failed_attempts = 0, last_login_at = clock_timestamp() WHERE id = ?::uuid", u.id());
        events.log(u.id(), u.username(), "Logged in", null, null);
        return new WithCookie(sessions.start(u.id()), map("ok", true, "mustChange", u.row().get("must_change_password")));
    }

    public WithCookie logout(RequestContext ctx, String token) {
        sessions.end(token);
        if (ctx.userId() != null) {
            Map<String, Object> u = db.one("SELECT username FROM app_user WHERE id = ?", ctx.userId());
            events.log(ctx.userId(), u == null ? null : u.get("username"), "Logged out", null, null);
        }
        return new WithCookie(sessions.clearCookie(), ok());
    }

    public Map<String, Object> changePassword(RequestContext ctx, Map<String, Object> b) {
        if (ctx.userId() == null) throw new RuleException("Sign in first");
        limiter.check(ctx.ip());
        Account u = account(ctx.userId());
        if (!u.passwordIs(Js.string(Js.orBlank(b.get("current"))))) {
            throw new RuleException(events.wrongPassword(u.row(), "Login failed", ctx.ip()) ? AuthEvents.LOCKED : "Your current password is not correct.");
        }
        String bad = u.newPasswordProblem(b.get("password"), b.get("confirm"), "The two new passwords are not the same.");
        if (bad != null) throw new RuleException(bad);
        if (u.passwordIs(b.get("password"))) throw new RuleException("Choose a new password, different from the current one.");
        db.update("UPDATE app_user SET password_hash = ?, password_changed_at = clock_timestamp(), must_change_password = false, failed_attempts = 0 WHERE id = ?::uuid",
            PasswordHash.create((String) b.get("password")).stored(), u.id());
        events.log(u.id(), u.username(), "Password changed", null, null);
        return ok();
    }

    // ---------------------------------------------------------------- administrators: create users, temporary passwords, the log
    private void requireAdmin(RequestContext ctx) { access.require(ctx, "admin.users", "open this page"); }

    public Map<String, Object> createUser(RequestContext ctx, Map<String, Object> b) {
        requireAdmin(ctx);
        String username = Js.string(Js.orBlank(b.get("username"))).trim().toLowerCase(Locale.ROOT);
        String full = Js.string(Js.orBlank(b.get("full_name"))).trim();
        if (!Account.validUserId(username)) throw new RuleException("User ID: 3 to 40 letters, numbers, dots, dashes or underscores.");
        if (full.isEmpty()) throw new RuleException("Enter the person's full name.");
        Map<String, Object> u = db.one("INSERT INTO app_user (username, full_name) VALUES (?, ?) RETURNING id", username, full);
        events.log(u.get("id"), username, "User created", "no groups yet: add them to groups at a lab", ctx.userId());
        return u;
    }

    public Map<String, Object> tempPassword(RequestContext ctx, String id, Map<String, Object> b) {
        requireAdmin(ctx);
        Account u = account(id);
        if (u == null || "system".equals(u.username())) throw new RuleException("User not found");
        // a lab administrator may reset passwords only for people in their lab (or not yet in any lab); system administrators for anyone
        Map<String, Object> allowed = db.one("""
            SELECT (SELECT is_admin FROM app_user WHERE id = ?)
                OR EXISTS (SELECT 1 FROM group_member m JOIN lab_group g ON g.id = m.group_id WHERE m.user_id = ?::uuid AND m.status = 'Active' AND g.site_id = NULLIF(?, '')::uuid)
                OR NOT EXISTS (SELECT 1 FROM group_member m WHERE m.user_id = ?::uuid AND m.status = 'Active') AS ok""",
            ctx.userId(), u.id(), ctx.rawSite(), u.id());
        if (!Boolean.TRUE.equals(allowed.get("ok"))) throw new RuleException("This person works in another lab. Their own lab administrator (or a system administrator) must reset their password.");
        if (u.systemAdmin() && !Boolean.TRUE.equals(db.one("SELECT is_admin FROM app_user WHERE id = ?", ctx.userId()).get("is_admin")))
            throw new RuleException("Only a system administrator can reset a system administrator's password.");
        String bad = PasswordRule.problem(b.get("password"), u.username());
        if (bad != null) throw new RuleException(bad);
        db.update("UPDATE app_user SET password_hash = ?, password_changed_at = clock_timestamp(), must_change_password = true, failed_attempts = 0, locked_at = NULL WHERE id = ?::uuid",
            PasswordHash.create((String) b.get("password")).stored(), u.id());
        if (u.locked()) events.log(u.id(), u.username(), "Account unlocked", null, ctx.userId());
        events.log(u.id(), u.username(), "Temporary password set", "must be changed at next sign-in", ctx.userId());
        sessions.endAll(u.id());
        return ok();
    }

    public List<Map<String, Object>> authEvents(RequestContext ctx) {
        requireAdmin(ctx);
        return db.rows("SELECT e.*, b.full_name AS by_name FROM auth_event e LEFT JOIN app_user b ON b.id = e.by_user ORDER BY e.id DESC LIMIT 300");
    }
}
