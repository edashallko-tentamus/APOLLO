// Objective evidence for a workflow verification (WD-6.1, migration 025): after the run, the server opens every page the
// run's checks point to (the order, each step of each batch, the results and QC, each sample) in a headless browser, as
// the person who asked for the capture, and keeps a full-page screenshot of each. Each image is stamped with the
// verification, the evidence number, the page, the time and who captured it, and is stored unchanged with its SHA-256.
// Needs Playwright with Chromium on the machine running the server (it is what the browser tests use); without it the
// capture says so plainly and nothing is recorded.
'use strict';
const crypto = require('crypto');
const { captureSession, logEvent } = require('./auth');

function loadPlaywright() {
  const tries = ['playwright', process.env.PLAYWRIGHT_PATH].filter(Boolean);
  for (const t of tries) { try { return require(t); } catch (_) { /* next */ } }
  throw new Error('Screenshots need Playwright on the computer running LIMS3. In the LIMS3 folder run: npm install playwright --no-save, then npx playwright install chromium. Then capture the evidence again.');
}
const pngSize = (buf) => (buf.length > 24 && buf.readUInt32BE(12) === 0x49484452 ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) } : { width: null, height: null });

// The pages to capture, in report order, and the checks each one shows
async function evidencePages(db, w) {
  const checks = await db.rows('SELECT check_code, inputs, evidence_ref, batch_id FROM verification_check WHERE verification_id = $1 ORDER BY sort_order', [w.id]);
  const batches = await db.rows('SELECT id, batch_code FROM test_batch WHERE verification_id = $1 ORDER BY batch_code', [w.id]);
  const pages = []; const byRef = new Map();
  const add = (ref, title) => { if (!byRef.has(ref)) { const p = { ref, title, checks: [] }; byRef.set(ref, p); pages.push(p); } return byRef.get(ref); };
  if (w.lab_order_id) {
    const o = await db.one('SELECT order_code FROM lab_order WHERE id = $1', [w.lab_order_id]);
    add('#/orders/' + w.lab_order_id, `Order ${o.order_code}: the verification's samples and their tests`);
  }
  for (const b of batches) {
    const steps = await db.rows(`SELECT ws.step_key, ws.step_name, ws.step_type::text AS step_type FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id
      WHERE r.batch_id = $1 ORDER BY ws.sort_order, ws.step_key`, [b.id]);
    for (const s of steps) add(`#/testing/batches/${b.id}?step=${s.step_key}`, `${b.batch_code}: ${s.step_name} (${s.step_type})`);
    add(`#/testing/batches/${b.id}?step=results`, `${b.batch_code}: Results and QC`);
  }
  if (w.lab_order_id) {
    for (const s of await db.rows('SELECT id, sample_code FROM sample WHERE lab_order_id = $1 ORDER BY sample_code', [w.lab_order_id])) {
      add('#/samples/' + s.id, `Sample ${s.sample_code}: approved results`);
    }
  }
  for (const c of checks) {
    if (!c.evidence_ref) continue;
    // a check pointing at a batch as a whole is shown by the batch's first step
    const p = byRef.get(c.evidence_ref) || pages.find((x) => x.ref.startsWith(c.evidence_ref + '?step='));
    if (p) p.checks.push(c.check_code);
  }
  return pages;
}

// Browse and screenshot every page (no database transaction is held while browsing)
async function capture(db, { verification, userId, siteId, port }) {
  const pw = loadPlaywright();
  const pages = await evidencePages(db, verification);
  if (!pages.length) throw new Error('The run made no pages to capture');
  const user = await db.one('SELECT username, full_name FROM app_user WHERE id = $1', [userId]);
  const sess = captureSession(userId);
  await logEvent(db, userId, user.username, 'Logged in', `headless evidence capture for ${verification.verification_code}`);
  let browser;
  const out = []; const missed = [];
  try {
    browser = await pw.chromium.launch({ handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false }); // Ctrl+C still stops the server
    const base = `http://127.0.0.1:${port}`;
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addCookies([{ name: sess.name, value: sess.token, url: base }]);
    await ctx.addInitScript(([u, s]) => { try { localStorage.setItem('lims3.site.' + u, s); } catch (_) { /* ignore */ } }, [userId, siteId]);
    const page = await ctx.newPage();
    for (let i = 0; i < pages.length; i += 1) {
      const p = pages[i]; const seq = out.length + 1;
      try {
        // a fresh load for every page, so nothing of the page before is left (the app only changes the hash otherwise)
        await page.goto('about:blank');
        await page.goto(base + '/' + p.ref, { waitUntil: 'load' });
        await page.waitForSelector('main h1', { timeout: 15000 });
        await page.waitForFunction(() => !document.querySelector('main .loading'), null, { timeout: 15000 });
        await page.waitForTimeout(700);
        const at = new Date();
        const stamp = `LIMS3 objective evidence · ${verification.verification_code} E-${String(seq).padStart(2, '0')} · ${p.title} · ${p.ref} · captured ${at.toISOString()} by ${user.full_name}`;
        await page.evaluate((t) => {
          const d = document.createElement('div'); d.id = 'evidence-stamp'; d.textContent = t;
          d.style.cssText = 'background:#1f3a2c;color:#fff;font:600 13px/1.4 system-ui,sans-serif;padding:8px 14px;letter-spacing:.2px';
          document.body.prepend(d);
        }, stamp);
        const png = await page.screenshot({ fullPage: true, type: 'png' });
        out.push({ ...p, png, sha256: crypto.createHash('sha256').update(png).digest('hex'), captured_at: at.toISOString(), ...pngSize(png) });
      } catch (e) {
        missed.push(`${p.title}: ${String(e.message || e).split('\n')[0]}`);
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    sess.end();
    await logEvent(db, userId, user.username, 'Logged out', `headless evidence capture for ${verification.verification_code}`).catch(() => {});
  }
  if (!out.length) throw new Error('No page could be captured: ' + missed.slice(0, 3).join('; '));
  return { items: out, missed };
}

// Store the images and record them (in the transaction of a signed action)
async function record(t, verificationId, captured) {
  const items = [];
  for (const x of captured.items) {
    const d = await t.one(`INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ($1, 'image/png', $2, $3, decode($4, 'base64')) RETURNING id`,
      [`evidence-E${String(items.length + 1).padStart(2, '0')}.png`, x.png.length, x.sha256, x.png.toString('base64')]);
    items.push({ title: x.title, page_ref: x.ref, check_codes: x.checks, document_id: d.id, sha256: x.sha256, width: x.width, height: x.height, captured_at: x.captured_at });
  }
  const note = captured.missed.length ? `Not captured: ${captured.missed.join('; ')}` : null;
  return (await t.one('SELECT record_verification_evidence($1, $2::jsonb, $3) AS n', [verificationId, JSON.stringify(items), note])).n;
}

module.exports = { capture, record, evidencePages, loadPlaywright };
