// Login, sessions and electronic signatures (21 CFR Part 11).
// Passwords are kept only as salted scrypt hashes (Node's crypto; no npm package). A session is a random token in an
// HttpOnly cookie; it ends after LIMS_IDLE_MINUTES (default 30) without activity, or on sign out / server restart.
// Five wrong passwords (at login or when signing) lock the account until an administrator unlocks it.
// Every login, failure, lockout, password change and failed signature is written to the append-only auth_event log.
'use strict';
const crypto = require('crypto');

const IDLE_MS = Number(process.env.LIMS_IDLE_MINUTES || 30) * 60 * 1000;
const MAX_ATTEMPTS = 5;
const COOKIE = 'lims3_sid';
const sessions = new Map(); // token -> { userId, lastSeen }

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  if (!stored || typeof pw !== 'string') return false;
  const [kind, N, r, p, salt, hash] = stored.split('$');
  if (kind !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(expected, got);
}
// Password rule (Sandbox; QA to confirm for production): at least 10 characters, a letter and a number, not the user ID
function passwordProblem(pw, username) {
  if (typeof pw !== 'string' || pw.length < 10) return 'The password must be at least 10 characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'The password must contain at least one letter and one number.';
  if (username && pw.toLowerCase().includes(String(username).toLowerCase())) return 'The password must not contain your user ID.';
  return null;
}

function parseCookies(header) {
  const out = {}; for (const part of String(header || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
// The user behind a request (or null). Touches the session (idle timer); expired sessions are removed.
function sessionUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  const s = token && sessions.get(token);
  if (!s) return null;
  if (Date.now() - s.lastSeen > IDLE_MS) { sessions.delete(token); return { expired: true, userId: s.userId }; }
  s.lastSeen = Date.now();
  return { token, userId: s.userId };
}
const rate = require('./ratelimit');
// Behind HTTPS (LIMS_HTTPS=1) the session cookie is sent only over HTTPS
const SECURE = process.env.LIMS_HTTPS === '1' ? '; Secure' : '';
function newSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, { userId, lastSeen: Date.now() });
  return { 'Set-Cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/${SECURE}` };
}
// A short-lived session for the server's own headless browser (verification evidence, WD-6.1): the person who asked
// for the capture, ended as soon as the capture is done
function captureSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, { userId, lastSeen: Date.now() });
  return { name: COOKIE, token, end: () => sessions.delete(token) };
}
const clearCookie = { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${SECURE}` };
const logEvent = (db, userId, username, event, detail = null, by = null) =>
  db.query('INSERT INTO auth_event (user_id, username, event, detail, by_user) VALUES ($1, $2, $3, $4, $5)', [userId, username, event, detail, by]);

// A wrong password (login or signature): count it and lock the account at the limit
async function wrongPassword(db, u, event, ip) {
  if (ip) rate.noteFailure(ip);
  const n = (u.failed_attempts || 0) + 1;
  await db.query('UPDATE app_user SET failed_attempts = $2::int, locked_at = CASE WHEN $2::int >= $3::int THEN clock_timestamp() ELSE locked_at END WHERE id = $1', [u.id, n, MAX_ATTEMPTS]);
  await logEvent(db, u.id, u.username, event, `attempt ${n} of ${MAX_ATTEMPTS}`);
  if (n >= MAX_ATTEMPTS) { await logEvent(db, u.id, u.username, 'Account locked', `${MAX_ATTEMPTS} wrong passwords`); return true; }
  return false;
}
const LOCKED = 'This account is locked after too many wrong passwords. Ask an administrator to unlock it.';

// Electronic signature: the signer types their own user ID and password for this action
async function verifySignature(c) {
  const sig = c.body.signature || {};
  rate.checkFailures(c.ip);
  const u = await c.db.one('SELECT * FROM app_user WHERE id = $1', [c.userId]);
  if (!u) throw new Error('Sign in first');
  if (u.locked_at) throw new Error(LOCKED);
  if (!sig.username || !sig.password) throw new Error('An electronic signature is required: enter your user ID and password.');
  if (String(sig.username).trim().toLowerCase() !== u.username.toLowerCase()) {
    await logEvent(c.db, u.id, u.username, 'Signature failed', `signed with user ID "${String(sig.username).slice(0, 40)}"`);
    throw new Error('Sign with your own user ID (you are signed in as ' + u.username + ').');
  }
  if (!verifyPassword(sig.password, u.password_hash)) {
    const locked = await wrongPassword(c.db, u, 'Signature failed', c.ip);
    throw new Error(locked ? LOCKED : 'The user ID or password is not correct. The signature was not applied.');
  }
  if (u.failed_attempts) await c.db.query('UPDATE app_user SET failed_attempts = 0 WHERE id = $1', [u.id]);
  return u;
}
// A transaction whose changes are signed: verifies the password, records the signature, then runs fn
async function signedTx(c, { meaning, action, module = 'Inventory' }, fn) {
  await verifySignature(c);
  return c.db.tx({ userId: c.userId, reason: c.reason, siteId: c.siteId }, async (t) => {
    await t.one('SELECT sign_action($1, $2, $3, $4) AS id', [meaning, action, module, c.reason || null]);
    return fn(t);
  });
}

// Routes that work without a session (login, first-time setup, sign out, state)
function registerAuth({ route, requireAdmin }) {
  const setupNeeded = async (db) => !(await db.one("SELECT 1 AS x FROM app_user WHERE is_admin AND is_active AND password_hash IS NOT NULL"));
  route('GET', '/api/auth/state', async (c) => {
    const me = c.userId ? await c.db.one('SELECT id, username, full_name, is_admin, must_change_password FROM app_user WHERE id = $1', [c.userId]) : null;
    const needed = await setupNeeded(c.db);
    return { user: me, setupNeeded: needed, timedOut: !!c.sessionExpired, idleMinutes: IDLE_MS / 60000,
      setupUsers: needed ? await c.db.rows("SELECT username, full_name FROM app_user WHERE is_admin AND is_active AND username <> 'system' ORDER BY full_name") : [] };
  });
  // First run only: no administrator has a password yet; an administrator account sets its own
  route('POST', '/api/auth/setup', async (c) => {
    rate.checkFailures(c.ip);
    if (!(await setupNeeded(c.db))) throw new Error('Setup is already done. Sign in instead.');
    const u = await c.db.one("SELECT * FROM app_user WHERE lower(username) = lower($1) AND is_admin AND is_active", [String(c.body.username || '').trim()]);
    if (!u) throw new Error('Choose an administrator account.');
    const bad = passwordProblem(c.body.password, u.username); if (bad) throw new Error(bad);
    if (c.body.password !== c.body.confirm) throw new Error('The two passwords are not the same.');
    await c.db.query('UPDATE app_user SET password_hash = $2, password_changed_at = clock_timestamp(), must_change_password = false, failed_attempts = 0, locked_at = NULL, last_login_at = clock_timestamp() WHERE id = $1', [u.id, hashPassword(c.body.password)]);
    await logEvent(c.db, u.id, u.username, 'Password set', 'first-time setup');
    await logEvent(c.db, u.id, u.username, 'Logged in');
    return { __headers: newSession(u.id), ok: true };
  });
  route('POST', '/api/auth/login', async (c) => {
    rate.checkFailures(c.ip);
    const name = String(c.body.username || '').trim();
    const u = await c.db.one("SELECT * FROM app_user WHERE lower(username) = lower($1) AND username <> 'system'", [name]);
    if (!u || !u.is_active) { rate.noteFailure(c.ip); await logEvent(c.db, null, name.slice(0, 60), 'Login failed', 'unknown or inactive user ID'); throw new Error('The user ID or password is not correct.'); }
    if (u.is_automated) { await logEvent(c.db, u.id, u.username, 'Login failed', 'automated verification account'); throw new Error('This is an automated verification account: it works only inside a workflow verification run and cannot sign in.'); }
    if (u.locked_at) { await logEvent(c.db, u.id, u.username, 'Login failed', 'account locked'); throw new Error(LOCKED); }
    if (!u.password_hash) throw new Error('No password has been set for this account yet. Ask an administrator for a temporary password.');
    if (!verifyPassword(String(c.body.password || ''), u.password_hash)) {
      const locked = await wrongPassword(c.db, u, 'Login failed', c.ip);
      throw new Error(locked ? LOCKED : 'The user ID or password is not correct.');
    }
    await c.db.query('UPDATE app_user SET failed_attempts = 0, last_login_at = clock_timestamp() WHERE id = $1', [u.id]);
    await logEvent(c.db, u.id, u.username, 'Logged in');
    return { __headers: newSession(u.id), ok: true, mustChange: u.must_change_password };
  });
  route('POST', '/api/auth/logout', async (c) => {
    if (c.sessionToken) sessions.delete(c.sessionToken);
    if (c.userId) { const u = await c.db.one('SELECT username FROM app_user WHERE id = $1', [c.userId]); await logEvent(c.db, c.userId, u && u.username, 'Logged out'); }
    return { __headers: clearCookie, ok: true };
  });
  route('POST', '/api/auth/change-password', async (c) => {
    if (!c.userId) throw new Error('Sign in first');
    rate.checkFailures(c.ip);
    const u = await c.db.one('SELECT * FROM app_user WHERE id = $1', [c.userId]);
    if (!verifyPassword(String(c.body.current || ''), u.password_hash)) {
      const locked = await wrongPassword(c.db, u, 'Login failed', c.ip);
      throw new Error(locked ? LOCKED : 'Your current password is not correct.');
    }
    const bad = passwordProblem(c.body.password, u.username); if (bad) throw new Error(bad);
    if (c.body.password !== c.body.confirm) throw new Error('The two new passwords are not the same.');
    if (verifyPassword(c.body.password, u.password_hash)) throw new Error('Choose a new password, different from the current one.');
    await c.db.query('UPDATE app_user SET password_hash = $2, password_changed_at = clock_timestamp(), must_change_password = false, failed_attempts = 0 WHERE id = $1', [u.id, hashPassword(c.body.password)]);
    await logEvent(c.db, u.id, u.username, 'Password changed');
    return { ok: true };
  });
  // Administrators: create users, set a temporary password (also unlocks), see the login log
  route('POST', '/api/admin/users', async (c) => {
    await requireAdmin(c);
    const username = String(c.body.username || '').trim().toLowerCase(); const full = String(c.body.full_name || '').trim();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error('User ID: 3 to 40 letters, numbers, dots, dashes or underscores.');
    if (!full) throw new Error('Enter the person\'s full name.');
    const u = await c.db.one('INSERT INTO app_user (username, full_name) VALUES ($1, $2) RETURNING id', [username, full]);
    await logEvent(c.db, u.id, username, 'User created', 'no groups yet: add them to groups at a lab', c.userId);
    return u;
  });
  route('POST', '/api/admin/users/:id/temp-password', async (c) => {
    await requireAdmin(c);
    const u = await c.db.one('SELECT * FROM app_user WHERE id = $1', [c.params.id]);
    if (!u || u.username === 'system') throw new Error('User not found');
    // a lab administrator may reset passwords only for people in their lab (or not yet in any lab); system administrators for anyone
    const ok = await c.db.one(`SELECT (SELECT is_admin FROM app_user WHERE id = $1)
        OR EXISTS (SELECT 1 FROM group_member m JOIN lab_group g ON g.id = m.group_id WHERE m.user_id = $2 AND m.status = 'Active' AND g.site_id = NULLIF($3, '')::uuid)
        OR NOT EXISTS (SELECT 1 FROM group_member m WHERE m.user_id = $2 AND m.status = 'Active') AS ok`, [c.userId, u.id, c.siteId || '']);
    if (!ok.ok) throw new Error('This person works in another lab. Their own lab administrator (or a system administrator) must reset their password.');
    if (u.is_admin && !(await c.db.one('SELECT is_admin FROM app_user WHERE id = $1', [c.userId])).is_admin) throw new Error('Only a system administrator can reset a system administrator\'s password.');
    const bad = passwordProblem(c.body.password, u.username); if (bad) throw new Error(bad);
    await c.db.query('UPDATE app_user SET password_hash = $2, password_changed_at = clock_timestamp(), must_change_password = true, failed_attempts = 0, locked_at = NULL WHERE id = $1', [u.id, hashPassword(c.body.password)]);
    if (u.locked_at) await logEvent(c.db, u.id, u.username, 'Account unlocked', null, c.userId);
    await logEvent(c.db, u.id, u.username, 'Temporary password set', 'must be changed at next sign-in', c.userId);
    for (const [k, s] of sessions) if (s.userId === u.id) sessions.delete(k); // signed out everywhere
    return { ok: true };
  });
  route('GET', '/api/admin/auth-events', async (c) => {
    await requireAdmin(c);
    return c.db.rows(`SELECT e.*, b.full_name AS by_name FROM auth_event e LEFT JOIN app_user b ON b.id = e.by_user ORDER BY e.id DESC LIMIT 300`);
  });
}

module.exports = { sessionUser, registerAuth, verifySignature, signedTx, hashPassword, verifyPassword, captureSession, logEvent, IDLE_MS };
