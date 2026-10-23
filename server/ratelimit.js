// Per-computer (IP address) limits, kept in memory (0.32.0).
// - Wrong passwords (sign in, change password, electronic signatures): 20 in 15 minutes from one address,
//   then that address is refused for 15 minutes. The 5-try account lock still applies on top.
// - Pages and links that need no sign-in (/api/public/...): 120 requests a minute from one address.
// The address is the connection's, or the last X-Forwarded-For entry when LIMS_TRUST_PROXY=1 (behind one proxy).
'use strict';
const FAIL_LIMIT = Number(process.env.LIMS_FAIL_LIMIT || 20);
const FAIL_WINDOW = 15 * 60 * 1000;
const PUBLIC_LIMIT = Number(process.env.LIMS_PUBLIC_LIMIT || 120);
const PUBLIC_WINDOW = 60 * 1000;
const fails = new Map();   // ip -> [times]
const hits = new Map();

function clientIp(req) {
  if (process.env.LIMS_TRUST_PROXY === '1') {
    // the last entry is the one our proxy added; earlier entries come from the client and can be faked
    const f = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
    if (f) return f;
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}
function recent(map, ip, windowMs) {
  const now = Date.now(); const list = (map.get(ip) || []).filter((t) => now - t < windowMs);
  if (list.length) map.set(ip, list); else map.delete(ip);
  return list;
}
class TooMany extends Error { constructor(m) { super(m); this.status = 429; } }

function checkFailures(ip) {
  const list = recent(fails, ip, FAIL_WINDOW);
  if (list.length >= FAIL_LIMIT) {
    const wait = Math.ceil((FAIL_WINDOW - (Date.now() - list[0])) / 60000);
    throw new TooMany(`Too many wrong passwords from this computer. Wait ${wait} minute${wait === 1 ? '' : 's'} and try again.`);
  }
}
function noteFailure(ip) { const list = recent(fails, ip, FAIL_WINDOW); list.push(Date.now()); fails.set(ip, list); }
function checkPublic(ip) {
  const list = recent(hits, ip, PUBLIC_WINDOW);
  if (list.length >= PUBLIC_LIMIT) throw new TooMany('Too many requests from this computer. Wait a minute and try again.');
  list.push(Date.now()); hits.set(ip, list);
}
// Forget old entries now and then so the maps do not grow
setInterval(() => { for (const ip of [...fails.keys()]) recent(fails, ip, FAIL_WINDOW); for (const ip of [...hits.keys()]) recent(hits, ip, PUBLIC_WINDOW); }, 5 * 60 * 1000).unref();

module.exports = { clientIp, checkFailures, noteFailure, checkPublic, TooMany, _reset: () => { fails.clear(); hits.clear(); } };
