// LIMS3 backend: the JSON API (/api/...) only. The screens are served by frontend/server.js, which forwards /api here.
// Start both: npm start (then open http://localhost:3000). The backend alone: npm run start:backend (LIMS_API_PORT, 3001).
'use strict';
const http = require('http');
const path = require('path');
const { Database, migrate } = require('./db');
const routes = require('./routes');
const { sessionUser } = require('./auth');
const rate = require('./ratelimit');

// PORT stays the address people open (the front end): links in emails and PDFs and the evidence screenshots use it
const API_PORT = Number(process.env.LIMS_API_PORT || 3001);

// Security headers (0.32.0). Pages: scripts only from this server (no inline scripts), nothing from elsewhere,
// framed only by this app. HSTS only when the app is served over HTTPS (LIMS_HTTPS=1).
const PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
  + "object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'";
// Stored files and downloads: nothing in them may run (a file is shown, never executed as part of the app)
const FILE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; sandbox";
const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN',
  ...(process.env.LIMS_HTTPS === '1' ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}) };

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  const csp = /^text\/html/.test(type) ? PAGE_CSP : null;
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...BASE_HEADERS, ...(csp ? { 'Content-Security-Policy': csp } : {}), ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

// What a stored file really is, from its first bytes (the type a browser was told on upload is not trusted)
function sniff(b) {
  if (!Buffer.isBuffer(b) || b.length < 4) return null;
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04) return 'zip';
  return null;
}
const INLINE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const ZIP_TYPES = /^application\/(zip|vnd\.openxmlformats-officedocument\.[\w.]+|vnd\.ms-excel\.sheet\.macroenabled\.12|vnd\.oasis\.opendocument\.[\w.]+)$/;
const ACTIVE_TYPES = /(html|xml|javascript|ecmascript|svg|x-sh|x-msdownload|wasm)/;
// Decide how a file or download goes out: shown in the browser only when it is really a PDF or a picture
// (an SVG is shown sandboxed: only used as a lab logo); everything else is a download with a safe type.
function safeRaw(out) {
  const headers = { ...(out.headers || {}) };
  const claimed = String(out.type || 'application/octet-stream').toLowerCase();
  const base = claimed.split(';')[0].trim();
  const found = sniff(out.body);
  const disp = String(headers['Content-Disposition'] || '');
  const name = ((disp.match(/filename="([^"]*)"/) || [])[1] || 'file').replace(/[^\w.\- ()#,+]/g, '_').slice(0, 150) || 'file';
  let type; let inline = false;
  if (found && INLINE_TYPES.has(found)) { type = found; inline = true; }
  else if (found === 'zip') type = ZIP_TYPES.test(base) ? base : 'application/zip';
  else if (base === 'image/svg+xml' && /<svg[\s>]/i.test(String(out.body).slice(0, 4096))) { type = base; inline = true; }
  else if (INLINE_TYPES.has(base) || ACTIVE_TYPES.test(base) || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(base)) type = 'application/octet-stream';
  else type = claimed;   // our own CSV and text downloads, and other plain types: always downloaded
  delete headers['Content-Disposition']; delete headers['Content-Type'];
  return { type, headers: { ...headers, 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"`,
    ...(type === 'application/pdf' ? {} : { 'Content-Security-Policy': FILE_CSP }) } };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''; let big = false;
    // over 5 MB: the rest is read and thrown away (never kept in memory), and the answer says why
    req.on('data', (c) => { if (big) return; data += c; if (data.length > 5e6) { big = true; data = ''; reject(new Error('Request too large')); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error('Invalid JSON')); } });
  });
}

// Reachable without being signed in (sign in, first-time setup, sign out, change password, state)
const OPEN_ROUTES = new Set(['/api/auth/state', '/api/auth/login', '/api/auth/setup', '/api/auth/logout', '/api/auth/change-password']);

async function start() {
  // 0.32.0: on a GxP server the migrations run as the owner account (LIMS_MIGRATE_URL) and the app connects
  // as the app account (DATABASE_URL), which may only read, add and change rows. See db/roles_setup.sql.
  let applied;
  if (process.env.LIMS_MIGRATE_URL) {
    if (!process.env.DATABASE_URL) throw new Error('LIMS_MIGRATE_URL is set: set DATABASE_URL to the app account too.');
    const appRole = decodeURIComponent(new URL(process.env.DATABASE_URL).username || '');
    const owner = await new Database().open({ url: process.env.LIMS_MIGRATE_URL });
    try { applied = await migrate(owner, { grantTo: appRole }); } finally { owner.close(); }
  }
  const db = await new Database().open({ dataDir: path.join(__dirname, '..', 'data', 'pgdata') });
  if (!applied) applied = await migrate(db);
  if (applied.length) console.log('Applied:', applied.join(', '));
  try {
    const p = await db.one('SELECT database_account_problems() AS p');
    const list = p && p.p ? (Array.isArray(p.p) ? p.p : String(p.p).replace(/^\{|\}$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''))) : [];
    if (list.length && db.engine.kind === 'postgres') console.log('Database account: ' + list.join('; ') + '.\n  Fine for the Sandbox; not for GxP data (see db/roles_setup.sql).');
  } catch (_) { /* older database */ }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const match = routes.match(req.method, url.pathname);
    if (!match) return send(res, 404, { error: 'Not found' });
    const ip = rate.clientIp(req);
    try {
      if (url.pathname.startsWith('/api/public/')) rate.checkPublic(ip);
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      // Who is asking comes only from the signed-in session (never from the request itself)
      const s = sessionUser(req);
      const live = s && !s.expired ? s : null;
      if (!live && !OPEN_ROUTES.has(url.pathname) && !url.pathname.startsWith('/api/public/')) {
        return send(res, 401, { error: s && s.expired ? 'Your session timed out. Sign in again.' : 'Sign in first.', signIn: true });
      }
      const ctx = { db, params: match.params, query: Object.fromEntries(url.searchParams), body,
        userId: live ? live.userId : '', sessionToken: live ? live.token : null, sessionExpired: !!(s && s.expired),
        siteId: req.headers['x-site-id'] || '', reason: body.reason || '', ip };
      if (live && !OPEN_ROUTES.has(url.pathname)) {
        const u = await db.one('SELECT must_change_password, is_active, locked_at FROM app_user WHERE id = $1', [live.userId]);
        if (!u || !u.is_active || u.locked_at) return send(res, 401, { error: 'This account cannot be used. Ask an administrator.', signIn: true });
        if (u.must_change_password) return send(res, 401, { error: 'Change your temporary password first.', changePassword: true });
      }
      const out = await match.handler(ctx);
      if (out && out.__raw) { const f = safeRaw(out); return send(res, 200, out.body, f.type, f.headers); }
      if (out && out.__headers) { const { __headers, ...rest } = out; return send(res, 200, rest, undefined, __headers); }
      send(res, 200, out === undefined ? { ok: true } : out);
    } catch (e) {
      // Database rule violations come back as readable messages for the screen
      send(res, e.status === 429 ? 429 : 400, { error: friendly(e), code: e.code || null });
      if (!e.code) console.error(e);
    }
  });
  if (routes.startJobs) routes.startJobs(db);
  server.listen(API_PORT, '127.0.0.1', () => {
    console.log(`LIMS3 backend (API) running: http://127.0.0.1:${API_PORT}/api (engine: ${db.engine.kind})`);
  });
}

function friendly(e) {
  const m = e.message || String(e);
  if (/duplicate key value/.test(m)) return 'That value already exists (must be unique). ' + (e.detail || '');
  if (/violates check constraint "?(\w+)/.test(m)) {
    const c = m.match(/check constraint "?([\w]+)/)[1];
    const map = {
      analyte_cas_number_check: 'CAS Number is not valid (format or check digit).',
      cas_only_for_chemicals: 'Only Chemical analytes can have a CAS Number.',
      base_only_has_no_prep_fee: 'Base Price Only tests cannot have a preparation fee. Choose "Base + Preparation Fee".',
      portal_projects_name_requester: 'Portal-built projects must name the requesting contact.',
      contact_email_check: 'Email address is not valid.',
      requested_test_tat_override_check: 'A TAT override cannot be negative.',
      matrix_matrix_name_check: 'Matrix name cannot be blank.',
    };
    return map[c] || m;
  }
  if (/violates not-null constraint/.test(m)) return 'A required field is empty: ' + (m.match(/column "(\w+)"/) || [, ''])[1].replace(/_/g, ' ');
  if (/invalid input syntax/.test(m)) return 'A value is in the wrong format: ' + m.replace(/^.*?: /, '');
  if (/No user context/.test(m)) return 'Select who you are (top right) before making changes.';
  if (/Reason for Change is required/.test(m)) return m.replace(/ \(SET lims\.reason\)/, '');
  return m;
}

if (require.main === module) start().catch((e) => { console.error('\nCould not start:', e.message, '\n'); process.exit(1); });
module.exports = { start, safeRaw, sniff };
