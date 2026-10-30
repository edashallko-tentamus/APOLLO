// npm run start:java: runs the Java backend (backend-java, port LIMS_JAVA_PORT, 3002) on its own, separately from npm start.
// It reads .env (see .env.example): the Java backend needs a PostgreSQL server (DATABASE_URL); it cannot use the embedded database.
'use strict';
const { spawn } = require('child_process');
const path = require('path');

try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* no .env: use the environment as it is */ }
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in (the Java backend needs PostgreSQL).');
  process.exit(1);
}
const ch = spawn('mvn', ['-q', 'spring-boot:run'], { cwd: path.join(__dirname, 'backend-java'), stdio: 'inherit', shell: process.platform === 'win32' });
ch.on('exit', (code) => { process.exitCode = code || 0; });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => ch.exitCode === null && ch.kill());
