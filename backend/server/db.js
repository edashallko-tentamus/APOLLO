// Database access. Two interchangeable engines:
//  - PGlite (default): real PostgreSQL embedded in Node, stored in ./data/pgdata.
//    No database server or admin rights needed. Requires: npm install
//  - PostgreSQL server: set DATABASE_URL=postgres://user:pass@host:port/db
// All access is serialized (single connection), and every write runs in a
// transaction that sets the user and Reason for Change the audit trail needs.
'use strict';
const fs = require('fs');
const path = require('path');
const { PgWireClient } = require('./pgwire');

const NUMERIC_OIDS = new Set([20, 21, 23, 700, 701, 1700]);

class Database {
  constructor() { this.engine = null; this.queue = Promise.resolve(); }

  async open({ dataDir, url, memory } = {}) {
    url = url || process.env.DATABASE_URL;
    if (url) {
      const c = new PgWireClient(url);
      await c.connect();
      this.engine = { kind: 'postgres', exec: (s) => c.exec(s), query: (s, p) => c.query(s, p), close: () => c.close() };
    } else {
      let PGlite;
      try { ({ PGlite } = await import('@electric-sql/pglite')); }
      catch (e) { throw new Error('The embedded database is not installed. Run "npm install" in this folder first.'); }
      let pg;
      if (memory) pg = new PGlite();
      else { fs.mkdirSync(dataDir, { recursive: true }); pg = new PGlite(dataDir); }
      await pg.waitReady;
      this.engine = {
        kind: 'pglite',
        exec: async (s) => normalizeAll(await pg.exec(s)),
        query: async (s, p) => normalize(await pg.query(s, p)),
        close: () => pg.close(),
      };
    }
    await this.engine.exec('SET search_path = lims, public');
    return this;
  }

  // Serialize every operation on the single connection
  _run(fn) {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }

  exec(sql) { return this._run(() => this.engine.exec(sql)); }
  query(sql, params = []) { return this._run(() => this.engine.query(sql, params)); }
  async rows(sql, params = []) { return (await this.query(sql, params)).rows; }
  async one(sql, params = []) { return (await this.query(sql, params)).rows[0] || null; }

  // Transaction with user attribution and optional Reason for Change
  tx(ctx, fn) {
    return this._run(async () => {
      const e = this.engine;
      await e.exec('BEGIN');
      try {
        await e.query("SELECT set_config('lims.user_id', $1, true), set_config('lims.reason', $2, true), set_config('lims.site_id', $3, true)",
          [ctx.userId || '', ctx.reason || '', /^[0-9a-f-]{36}$/i.test(ctx.siteId || '') ? ctx.siteId : '']);
        const t = {
          query: (s, p = []) => e.query(s, p),
          rows: async (s, p = []) => (await e.query(s, p)).rows,
          one: async (s, p = []) => (await e.query(s, p)).rows[0] || null,
        };
        const out = await fn(t);
        await e.exec('COMMIT');
        return out;
      } catch (err) {
        try { await e.exec('ROLLBACK'); } catch (_) { /* ignore */ }
        throw err;
      }
    });
  }

  close() { if (this.engine) this.engine.close(); }
}

// PGlite returns typed JS values; align them with the wire client (numbers, ISO strings)
function normalize(res) {
  const numericFields = new Set((res.fields || []).filter((f) => NUMERIC_OIDS.has(f.dataTypeID)).map((f) => f.name));
  const dateFields = new Set((res.fields || []).filter((f) => f.dataTypeID === 1082).map((f) => f.name)); // plain dates
  const rows = (res.rows || []).map((r) => {
    const o = {};
    for (const [k, v] of Object.entries(r)) {
      if (v instanceof Date) o[k] = dateFields.has(k) ? v.toISOString().slice(0, 10) : v.toISOString();
      else if (numericFields.has(k) && v !== null && typeof v !== 'number') o[k] = Number(v);
      else if (typeof v === 'bigint') o[k] = Number(v);
      else o[k] = v;
    }
    return o;
  });
  return { fields: res.fields || [], rows };
}
function normalizeAll(results) { return (results || []).map(normalize); }

// Apply migrations (and the demo seed) that have not run yet
async function migrate(db, { seed = true, root = path.join(__dirname, '..', 'db'), grantTo = null } = {}) {
  await db.exec('CREATE TABLE IF NOT EXISTS public.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await db.rows('SELECT name FROM public.schema_migrations')).map((r) => r.name));
  const files = fs.readdirSync(path.join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  const applied = [];
  for (const f of files) {
    if (done.has(f)) continue;
    await db.exec(fs.readFileSync(path.join(root, 'migrations', f), 'utf8'));
    await db.query('INSERT INTO public.schema_migrations (name) VALUES ($1)', [f]);
    applied.push(f);
  }
  if (seed) { // demo data files: db/seed.sql, then db/seed_*.sql, each applied once
    const seeds = fs.readdirSync(root).filter((f) => /^seed.*\.sql$/.test(f)).sort();
    // demo media lots count as already qualified (migration 023); a seed can switch this off for a lot it wants unqualified
    if (seeds.some((f) => !done.has(f))) await db.exec("SELECT set_config('lims.media_preapproved', '1', false)");
    try {
      for (const f of seeds) {
        if (done.has(f)) continue;
        await db.exec(fs.readFileSync(path.join(root, f), 'utf8'));
        await db.query('INSERT INTO public.schema_migrations (name) VALUES ($1)', [f]);
        applied.push(f);
      }
    } finally { await db.exec("SELECT set_config('lims.media_preapproved', '', false)"); }
  }
  await db.exec('SET search_path = lims, public');
  // 0.32.0: run as the owner account, give the app account its rights (new tables included)
  if (grantTo) await db.one('SELECT grant_app_role($1) AS msg', [grantTo]);
  return applied;
}

module.exports = { Database, migrate };
