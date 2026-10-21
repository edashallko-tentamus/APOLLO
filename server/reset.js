// npm run reset: deletes the local Sandbox database so the next start rebuilds it with fresh demo data.
'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'data', 'pgdata');
if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); console.log('Sandbox database removed. Run "npm start" to rebuild it with demo data.'); }
else console.log('No local database found; nothing to reset.');
