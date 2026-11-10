// LIMS3 front end: serves the screens in ./public and forwards every /api/... request to the backend unchanged,
// so the browser sees one address (same origin: the session cookie and the security policy work as before).
// Start the backend first (npm run start:backend), then this: npm start (PORT, 3000; backend at LIMS_API_URL, http://127.0.0.1:3001).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

// the backend's settings file (backend/.env), so both agree on PORT and the backend's address (LIMS_API_URL)
try { process.loadEnvFile(path.join(__dirname, '..', 'backend', '.env')); } catch { /* no .env: use the environment as it is */ }

const PORT = Number(process.env.PORT || 3000);
const API = new URL(process.env.LIMS_API_URL || 'http://127.0.0.1:3001');
const PUBLIC = path.join(__dirname, 'public');
const APP = path.join(__dirname, 'app', 'dist'); // the React screens (npm run build:app), at /app/ while they move over
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

// Security headers (0.32.0). Pages: scripts only from this server (no inline scripts), nothing from elsewhere,
// framed only by this app. HSTS only when the app is served over HTTPS (LIMS_HTTPS=1).
const PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
  + "object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'";
const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN',
  ...(process.env.LIMS_HTTPS === '1' ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}) };

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  const csp = /^text\/html/.test(type) ? PAGE_CSP : null;
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...BASE_HEADERS, ...(csp ? { 'Content-Security-Policy': csp } : {}), ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function serveStatic(req, res, urlPath, root = PUBLIC) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch (_) { return send(res, 400, { error: 'Bad address' }); } // a broken %-code used to stop the server
  let p = path.normalize(path.join(root, decoded));
  if (p !== root && !p.startsWith(root + path.sep)) return send(res, 403, { error: 'Forbidden' });
  if (urlPath === '/' || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(root, 'index.html');
  // the React build's assets/ have the content's fingerprint in their names, so the browser may keep them
  const cache = root === APP && p.startsWith(path.join(APP, 'assets') + path.sep) ? 'public, max-age=31536000, immutable'
    : /\.(js|css|png|svg|ico)$/.test(p) ? 'no-cache' : null;
  send(res, 200, fs.readFileSync(p), MIME[path.extname(p)] || 'application/octet-stream', cache ? { 'Cache-Control': cache } : {});
}

// The person's computer, as the backend's rate limits need it (it trusts this header: LIMS_TRUST_PROXY=1).
// Behind another proxy (LIMS_TRUST_PROXY=1 here too) that proxy's last entry is the person; otherwise the connection.
function clientIp(req) {
  if (process.env.LIMS_TRUST_PROXY === '1') {
    const f = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
    if (f) return f;
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function forward(req, res) {
  const headers = { ...req.headers, host: API.host, 'x-forwarded-for': clientIp(req) };
  // Answered before the upload was all sent (e.g. refused as too large): the rest of it would never be read, and the
  // browser's next request on the same connection hung behind it. So that connection is closed once answered.
  const closeIfUnread = () => { if (!req.complete) { res.setHeader('Connection', 'close'); res.on('finish', () => { req.destroy(); up.destroy(); }); } };
  // agent: false = one backend connection per request, never shared with a request still being sent
  const up = http.request({ hostname: API.hostname, port: API.port, method: req.method, path: req.url, headers, agent: false }, (r) => {
    closeIfUnread();
    const { connection, 'keep-alive': _ka, ...h } = r.headers; // the backend link's own; the browser's is decided here
    res.writeHead(r.statusCode, h);
    r.pipe(res);
  });
  up.on('error', () => {
    if (res.headersSent) return res.destroy();
    closeIfUnread();
    send(res, 502, { error: 'The LIMS backend is not running. Start it (npm run start:backend) and try again.' });
  });
  req.pipe(up);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) return forward(req, res);
  if (url.pathname === '/app') { res.writeHead(301, { Location: '/app/', ...BASE_HEADERS }); return res.end(); }
  if (url.pathname.startsWith('/app/') && !fs.existsSync(path.join(APP, 'index.html'))) {
    return send(res, 503, 'The new screens have not been built yet. Run: npm run build:app', 'text/plain; charset=utf-8');
  }
  try { if (url.pathname.startsWith('/app/')) serveStatic(req, res, url.pathname.slice(4), APP); else serveStatic(req, res, url.pathname); } catch (e) { console.error(e); if (!res.headersSent) send(res, 500, { error: 'Could not read that file' }); }
});
if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => console.log(`LIMS3 front end running: http://localhost:${PORT} (API at ${API.origin})`));
}
module.exports = { server };
