// npm run reset: empties the app database (DATABASE_URL; the database itself stays) so the next start rebuilds it
// with fresh demo data. Every record in it is lost: only for databases holding demo data.
'use strict';
const { Database, wipe } = require('./db');

(async () => {
  const db = await new Database().open();
  await wipe(db);
  db.close();
  console.log('Database emptied. Run "npm start" to rebuild it with demo data.');
})().catch((e) => { console.error('Reset failed:', e.message); process.exit(1); });
