// npm test: empties the test database (LIMS_TEST_DATABASE_URL, an existing database kept for tests only), applies
// every migration, then runs the rule tests in db/tests (each prints PASS/FAIL lines). Exit code 1 on any failure.
'use strict';
const fs = require('fs');
const path = require('path');
const { Database, migrate, wipe } = require('./db');

(async () => {
  const url = process.env.LIMS_TEST_DATABASE_URL;
  if (!url) throw new Error('LIMS_TEST_DATABASE_URL is not set: name a database kept for tests only (see .env.example).');
  // the run empties it first, so never the app's own database
  if (url === process.env.DATABASE_URL) throw new Error('LIMS_TEST_DATABASE_URL must not be the app database (DATABASE_URL).');
  const db = await new Database().open({ url });
  await wipe(db);
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
