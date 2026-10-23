// npm start: runs the backend (API, port 3001) and the front end (screens, port 3000) together.
// Open http://localhost:3000. Ctrl+C stops both; if either one stops, the other is stopped too.
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const parts = [
  // the backend trusts the front end's X-Forwarded-For (the person's computer, for the rate limits); it listens on 127.0.0.1 only
  ['backend', path.join(__dirname, 'backend', 'server', 'server.js'), { LIMS_TRUST_PROXY: '1' }],
  ['frontend', path.join(__dirname, 'frontend', 'server.js'), {}],
];
const children = parts.map(([name, file, env]) => {
  const ch = spawn(process.execPath, [file], { stdio: 'inherit', env: { ...process.env, ...env } });
  ch.on('exit', (code) => {
    for (const other of children) if (other !== ch && other.exitCode === null) other.kill();
    if (code) console.error(`The ${name} stopped (exit code ${code}).`);
    process.exitCode = code || 0;
  });
  return ch;
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => children.forEach((c) => c.exitCode === null && c.kill()));
