// Minimal PostgreSQL wire-protocol client (no dependencies).
// Used when DATABASE_URL is set (e.g. a real PostgreSQL server). Supports trust, cleartext, MD5 and SCRAM-SHA-256
// authentication (0.32.0; SCRAM is PostgreSQL's default since 14 and what managed services require), TLS (0.32.0:
// sslmode disable / require / verify-ca / verify-full, from the URL's ?sslmode= or PGSSLMODE; the CA from ?sslrootcert=
// or PGSSLROOTCERT), simple queries (multi-statement) and parameterized queries via the extended protocol.
// One connection; callers serialize access through db.js.
'use strict';
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const crypto = require('crypto');

class PgError extends Error {
  constructor(fields) {
    super(fields.M || 'Database error');
    this.code = fields.C;
    this.detail = fields.D;
    this.hint = fields.H;
    this.where = fields.W;
  }
}

function cstr(s) { return Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])]); }
function msg(type, body) {
  const len = Buffer.alloc(4); len.writeInt32BE(body.length + 4);
  return Buffer.concat([type ? Buffer.from(type) : Buffer.alloc(0), len, body]);
}

class PgWireClient {
  constructor(url) {
    const u = new URL(url);
    this.host = u.hostname || 'localhost';
    this.port = Number(u.port || 5432);
    this.user = decodeURIComponent(u.username || 'postgres');
    this.password = decodeURIComponent(u.password || '');
    this.database = decodeURIComponent((u.pathname || '/postgres').slice(1) || 'postgres');
    this.sslmode = u.searchParams.get('sslmode') || process.env.PGSSLMODE || 'disable';
    if (!['disable', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(this.sslmode)) throw new Error('sslmode must be disable, prefer, require, verify-ca or verify-full');
    this.sslrootcert = u.searchParams.get('sslrootcert') || process.env.PGSSLROOTCERT || null;
    this.buf = Buffer.alloc(0);
    this.waiter = null;
    this.tls = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const raw = net.createConnection({ host: this.host, port: this.port });
      raw.once('error', reject);
      const start = (sock) => {
        this.sock = sock;
        sock.removeAllListeners('error');
        sock.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this._drain(); });
        sock.on('error', (e) => { if (this.waiter) this.waiter.reject(e); else reject(e); });
        sock.on('close', () => { if (this.waiter) { const w = this.waiter; this.waiter = null; w.reject(new Error('The database connection closed')); } });
        this.authing = true;
        const params = Buffer.concat([cstr('user'), cstr(this.user), cstr('database'), cstr(this.database), Buffer.from([0])]);
        const ver = Buffer.alloc(4); ver.writeInt32BE(196608);
        sock.write(msg(null, Buffer.concat([ver, params])));
        this._collect().then(resolve, reject);
      };
      raw.on('connect', () => {
        if (this.sslmode === 'disable') return start(raw);
        // SSLRequest: the server answers one byte, S (go ahead) or N (no TLS here)
        const req = Buffer.alloc(8); req.writeInt32BE(8, 0); req.writeInt32BE(80877103, 4);
        raw.once('data', (d) => {
          if (d[0] !== 0x53) {
            if (this.sslmode === 'prefer') return start(raw);
            raw.destroy(); return reject(new Error('The database server does not accept TLS connections (sslmode=' + this.sslmode + ')'));
          }
          const verify = this.sslmode === 'verify-ca' || this.sslmode === 'verify-full';
          const opts = { socket: raw, rejectUnauthorized: verify, servername: net.isIP(this.host) ? undefined : this.host };
          if (this.sslrootcert) opts.ca = fs.readFileSync(this.sslrootcert);
          if (this.sslmode === 'verify-ca') opts.checkServerIdentity = () => undefined;   // the CA, not the host name
          const t = tls.connect(opts, () => { this.tls = true; start(t); });
          t.once('error', reject);
        });
        raw.write(req);
      });
    });
  }

  // SCRAM-SHA-256 (RFC 5802 / 7677), as PostgreSQL uses it (no channel binding)
  _scramStart(mechanisms) {
    if (!mechanisms.includes('SCRAM-SHA-256')) throw new Error('The server offers no SCRAM-SHA-256 authentication');
    this.scram = { nonce: crypto.randomBytes(18).toString('base64') };
    this.scram.firstBare = 'n=,r=' + this.scram.nonce;
    const first = Buffer.from('n,,' + this.scram.firstBare);
    const len = Buffer.alloc(4); len.writeInt32BE(first.length);
    this.sock.write(msg('p', Buffer.concat([cstr('SCRAM-SHA-256'), len, first])));
  }
  _scramContinue(serverFirst) {
    const a = Object.fromEntries(serverFirst.split(',').map((x) => [x[0], x.slice(2)]));
    if (!a.r || !a.r.startsWith(this.scram.nonce)) throw new Error('SCRAM: the server nonce does not match');
    const salted = crypto.pbkdf2Sync(this.password, Buffer.from(a.s, 'base64'), Number(a.i), 32, 'sha256');
    const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
    const clientKey = hmac(salted, 'Client Key');
    const storedKey = crypto.createHash('sha256').update(clientKey).digest();
    const finalNoProof = 'c=biws,r=' + a.r;
    const authMessage = this.scram.firstBare + ',' + serverFirst + ',' + finalNoProof;
    const sig = hmac(storedKey, authMessage);
    const proof = Buffer.from(clientKey.map((b, i) => b ^ sig[i]));
    this.scram.serverSig = hmac(hmac(salted, 'Server Key'), authMessage).toString('base64');
    this.sock.write(msg('p', Buffer.from(finalNoProof + ',p=' + proof.toString('base64'))));
  }
  _scramFinal(serverFinal) {
    const v = (serverFinal.split(',').find((x) => x.startsWith('v=')) || '').slice(2);
    if (v !== this.scram.serverSig) throw new Error('SCRAM: the server signature does not match (wrong server?)');
    this.scram = null;
  }

  // Read messages until ReadyForQuery; returns result sets
  _collect() {
    return new Promise((resolve, reject) => {
      const results = []; let cur = null; let error = null;
      this.waiter = {
        reject,
        onMessage: (type, body) => {
          switch (type) {
            case 'R': {
              const code = body.readInt32BE(0);
              if (code === 3) this.sock.write(msg('p', cstr(this.password)));
              else if (code === 5) {
                const salt = body.subarray(4, 8);
                const inner = crypto.createHash('md5').update(this.password + this.user).digest('hex');
                const outer = 'md5' + crypto.createHash('md5').update(Buffer.concat([Buffer.from(inner), salt])).digest('hex');
                this.sock.write(msg('p', cstr(outer)));
              } else if (code === 10) {
                try { this._scramStart(body.toString('utf8', 4).split('\0').filter(Boolean)); } catch (e) { error = e; }
              } else if (code === 11) {
                try { this._scramContinue(body.toString('utf8', 4)); } catch (e) { error = e; }
              } else if (code === 12) {
                try { this._scramFinal(body.toString('utf8', 4)); } catch (e) { error = e; }
              } else if (code !== 0) error = new Error('Unsupported PostgreSQL authentication method (code ' + code + '). Use trust, password, md5 or scram-sha-256.');
              if (error) { this.waiter = null; this.sock.destroy(); reject(error); }
              break;
            }
            case 'T': {
              const n = body.readInt16BE(0); let off = 2; const fields = [];
              for (let i = 0; i < n; i++) {
                const end = body.indexOf(0, off); const name = body.toString('utf8', off, end); off = end + 1;
                const typeId = body.readInt32BE(off + 6); off += 18;
                fields.push({ name, dataTypeID: typeId });
              }
              cur = { fields, rows: [] }; break;
            }
            case 'D': {
              const n = body.readInt16BE(0); let off = 2; const row = {};
              for (let i = 0; i < n; i++) {
                const len = body.readInt32BE(off); off += 4;
                const f = cur.fields[i];
                if (len === -1) row[f.name] = null;
                else { row[f.name] = parseText(body.toString('utf8', off, off + len), f.dataTypeID); off += len; }
              }
              cur.rows.push(row); break;
            }
            case 'C': results.push(cur || { fields: [], rows: [] }); cur = null; break;
            case 'I': results.push({ fields: [], rows: [] }); break;
            case 'E':
              error = new PgError(parseFields(body));
              if (this.authing) { this.waiter = null; this.sock.destroy(); reject(error); }
              break;
            case 'Z': this.authing = false; this.waiter = null; if (error) reject(error); else resolve(results); break;
            default: break; // S, K, N, 1, 2, n, s, t ...
          }
        },
      };
      this._drain();
    });
  }

  _drain() {
    while (this.buf.length >= 5 && this.waiter) {
      const type = String.fromCharCode(this.buf[0]);
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < len + 1) return;
      const body = this.buf.subarray(5, len + 1);
      this.buf = this.buf.subarray(len + 1);
      this.waiter.onMessage(type, body);
    }
  }

  // Multi-statement script, no parameters
  async exec(sql) {
    this.sock.write(msg('Q', cstr(sql)));
    return this._collect();
  }

  // Single statement with $1..$n parameters
  async query(sql, params = []) {
    const parts = [msg('P', Buffer.concat([cstr(''), cstr(sql), Buffer.from([0, 0])]))];
    const vals = params.map(toText);
    const head = Buffer.alloc(4); head.writeInt16BE(0, 0); head.writeInt16BE(vals.length, 2);
    const chunks = [cstr(''), cstr(''), head];
    for (const v of vals) {
      const l = Buffer.alloc(4);
      if (v === null) { l.writeInt32BE(-1); chunks.push(l); }
      else { const b = Buffer.from(v, 'utf8'); l.writeInt32BE(b.length); chunks.push(l, b); }
    }
    chunks.push(Buffer.from([0, 0]));
    parts.push(msg('B', Buffer.concat(chunks)));
    parts.push(msg('D', Buffer.concat([Buffer.from('P'), cstr('')])));
    const ex = Buffer.alloc(4); ex.writeInt32BE(0);
    parts.push(msg('E', Buffer.concat([cstr(''), ex])));
    parts.push(msg('S', Buffer.alloc(0)));
    this.sock.write(Buffer.concat(parts));
    const res = await this._collect();
    return res[res.length - 1] || { fields: [], rows: [] };
  }

  close() { try { this.sock.write(msg('X', Buffer.alloc(0))); this.sock.end(); } catch (_) { /* ignore */ } }
}

function parseFields(body) {
  const f = {}; let off = 0;
  while (off < body.length && body[off] !== 0) {
    const code = String.fromCharCode(body[off]); const end = body.indexOf(0, off + 1);
    f[code] = body.toString('utf8', off + 1, end); off = end + 1;
  }
  return f;
}

function toText(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return '{' + v.map((x) => (x === null ? 'NULL' : '"' + String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"')).join(',') + '}';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const INT = new Set([20, 21, 23, 26]); const FLOAT = new Set([700, 701, 1700]);
function parseText(s, oid) {
  if (INT.has(oid) || FLOAT.has(oid)) return Number(s);
  if (oid === 16) return s === 't';
  if (oid === 114 || oid === 3802) return JSON.parse(s);
  if (oid === 1009 || oid === 1015 || oid === 2951) return parseArray(s);
  if (oid === 1184 || oid === 1114) return new Date(s.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')).toISOString();
  return s;
}
function parseArray(s) {
  if (s === '{}') return [];
  const out = []; let i = 1; let cur = ''; let q = false;
  while (i < s.length - 1) {
    const ch = s[i];
    if (q) { if (ch === '\\') { cur += s[++i]; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur === 'NULL' ? null : cur); cur = ''; }
    else cur += ch;
    i++;
  }
  out.push(cur === 'NULL' ? null : cur);
  return out;
}

module.exports = { PgWireClient, PgError };
