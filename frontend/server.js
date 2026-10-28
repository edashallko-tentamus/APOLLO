// LIMS3 front end: serves the screens in ./public and forwards every /api/... request to the backend unchanged,
// so the browser sees one address (same origin: the session cookie and the security policy work as before).
// Start both: npm start. This alone: npm run start:frontend (PORT, 3000; backend at LIMS_API_URL, http://127.0.0.1:3001).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const API = new URL(process.env.LIMS_API_URL || 'http://127.0.0.1:3001');
// The Java backend (backend-java), feature by feature: when LIMS_JAVA_URL is set, the routes it has taken over go there.
const JAVA = process.env.LIMS_JAVA_URL ? new URL(process.env.LIMS_JAVA_URL) : null;
const JAVA_ROUTES = [/^\/api\/clients(\/[^/]+)?$/, /^\/api\/clients\/[^/]+\/licenses$/, /^\/api\/contacts(\/bulk)?$/,
  /^\/api\/client-contacts\/bulk$/, /^\/api\/licenses(\/[^/]+(\/file)?)?$/,
  // master data (sites and holidays, matrices, categories, analytes, units); lab images (/api/sites/.../media) stay in Node
  /^\/api\/sites(\/bulk)?$/, /^\/api\/sites\/[^/]+\/holidays(\/bulk)?$/, /^\/api\/timezones$/, /^\/api\/compliance-categories$/,
  /^\/api\/(analytes|matrices|product-categories|units|unit-conversions)(\/bulk)?$/, /^\/api\/units\/(convertible|convert)$/,
  // catalogue, rush schedules, projects and quotes; sending a quote, its PDF and the client's quote page stay in Node
  // (documents), as do a version's charges, packages and serving line (their own features)
  /^\/api\/rush-schedules(\/bulk|\/[^/]+\/tiers\/bulk)?$/, /^\/api\/catalog(\.csv|\/[^/]+)?$/,
  /^\/api\/projects(\/[^/]+(\/versions)?)?$/, /^\/api\/versions\/[^/]+(\/(status|lines|rush-terms))?$/, /^\/api\/lines\/[^/]+\/analytes$/,
  /^\/api\/quotes(\/[^/]+)?$/, /^\/api\/quotes\/versions\/[^/]+\/decide$/,
  // lab orders, samples, intake, rush decisions, the Outbox; an order's custody, charges, billing, COAs, picker and
  // packages, and a sample's photos and attachments, stay in Node (their own features)
  /^\/api\/orders(\/[^/]+)?$/, /^\/api\/orders\/[^/]+\/(samples|apply-project|add-test|tests|rush|log|cancel)$/,
  /^\/api\/samples\/[^/]+(\/serving-request)?$/, /^\/api\/order-setup\/[^/]+$/, /^\/api\/requested-tests\/[^/]+\/analytes$/,
  /^\/api\/(intake|rush-decisions)$/, /^\/api\/outbox(\/templates)?$/,
  // inventory and equipment, and Excel export / upload of their lists and the Units lists
  /^\/api\/inventory(\/.*)?$/, /^\/api\/equipment(\/.*)?$/,
  // purchasing and vendor approvals
  /^\/api\/purchasing(\/.*)?$/,
  // the Workflow Designer and specifications
  /^\/api\/methods(\/.*)?$/, /^\/api\/specs$/,
  // testing (backlog, batches, the bench, QC Review); a batch's logbook flags, lot entries and aliquots stay with logbooks in Node
  /^\/api\/testing\/(?!.*\/(equipment-flags|accept-flag|lot-entries|aliquots|scan-aliquot)$).+$/,
  /^\/api\/bulk\/(lots|samplestorage|suppliers|locations|thresholds|units|conversions|equipment)\/(export|preview|apply)$/];
const backendFor = (pathname) => (JAVA && JAVA_ROUTES.some((r) => r.test(pathname)) ? JAVA : API);
const PUBLIC = path.join(__dirname, 'public');
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

function serveStatic(req, res, urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch (_) { return send(res, 400, { error: 'Bad address' }); } // a broken %-code used to stop the server
  let p = path.normalize(path.join(PUBLIC, decoded));
  if (p !== PUBLIC && !p.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: 'Forbidden' });
  if (urlPath === '/' || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(PUBLIC, 'index.html');
  send(res, 200, fs.readFileSync(p), MIME[path.extname(p)] || 'application/octet-stream',
    /\.(js|css|png|svg|ico)$/.test(p) ? { 'Cache-Control': 'no-cache' } : {});
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

function forward(req, res, API) {
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
    send(res, 502, { error: 'The LIMS backend is not running. Start it (npm start) and try again.' });
  });
  req.pipe(up);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) return forward(req, res, backendFor(url.pathname));
  try { serveStatic(req, res, url.pathname); } catch (e) { console.error(e); if (!res.headersSent) send(res, 500, { error: 'Could not read that file' }); }
});
if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => console.log(`LIMS3 front end running: http://localhost:${PORT} (API at ${API.origin})`));
}
module.exports = { server };
