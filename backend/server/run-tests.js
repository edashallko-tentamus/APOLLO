// npm test: builds a fresh, empty database, applies every migration, then runs the
// rule tests in db/tests (each prints PASS/FAIL lines). Exit code 1 on any failure.
'use strict';
const fs = require('fs');
const path = require('path');
const { Database, migrate } = require('./db');
const { PgWireClient } = require('./pgwire');

(async () => {
  let db;
  if (process.env.DATABASE_URL) {
    const admin = new PgWireClient(process.env.DATABASE_URL); await admin.connect();
    await admin.exec('DROP DATABASE IF EXISTS lims3_test'); await admin.exec('CREATE DATABASE lims3_test'); admin.close();
    const u = new URL(process.env.DATABASE_URL); u.pathname = '/lims3_test';
    db = await new Database().open({ url: u.toString() });
  } else {
    db = await new Database().open({ memory: true }); // PGlite in memory
  }
  await migrate(db, { seed: false });
  const dir = path.join(__dirname, '..', 'db', 'tests');
  let pass = 0; let fail = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    console.log('\n== ' + f);
    const results = await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const r of results) {
      for (const row of r.rows || []) {
        if (row.result) { console.log('  ' + row.result); if (/\bPASS\b/.test(row.result)) pass++; else fail++; }
      }
    }
  }
  console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
  db.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('Test run failed:', e.message); process.exit(1); });
