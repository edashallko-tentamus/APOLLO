// The backend (this folder), with backend/.env loaded (see backend/.env.example). It needs a PostgreSQL server.
//   npm run start:backend   node backend/start.js      the API on 127.0.0.1:LIMS_API_PORT (3001); npm start then runs the screens
//   npm test                node backend/start.js test empties LIMS_TEST_DATABASE_URL, applies the migrations, runs the rule tests
//   npm run reset           node backend/start.js reset empties DATABASE_URL so the next start rebuilds it with demo data
'use strict';
const { spawn } = require('child_process');
const path = require('path');

try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* no .env: use the environment as it is */ }
const cmd = process.argv[2] || '';
if (cmd && cmd !== 'test' && cmd !== 'reset') { console.error(`Unknown command "${cmd}": use test, reset or nothing.`); process.exit(1); }
if (cmd !== 'test' && !process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy backend/.env.example to backend/.env and fill it in (the Java backend needs PostgreSQL).');
  process.exit(1);
}
// The backend is reached only through the front end, which passes the person's computer in X-Forwarded-For (rate limits)
const env = { ...process.env, LIMS_TRUST_PROXY: '1' };
const args = ['-q', 'spring-boot:run', ...(cmd ? [`-Dspring-boot.run.arguments=${cmd}`] : [])];
const ch = spawn('mvn', args, { cwd: __dirname, stdio: 'inherit', env, shell: process.platform === 'win32' });
ch.on('exit', (code) => { process.exitCode = code || 0; });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => ch.exitCode === null && ch.kill());
