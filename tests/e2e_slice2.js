// Slice 2 click-through: intake approvals, logging, rush per test, decline email, new walk-in order by paste.
// Updated for slice 2.1: tests are listed under each sample, sample IDs are SITEyymmdd###, orders are per lab.
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn } = require('./auth');
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (l, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };
(async () => {
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 400/.test(m.text())) errors.push(m.text()); });
  let native = 0; page.on('dialog', (d) => { native++; d.dismiss(); });
  await prepareUsers(BASE); await signIn(page, BASE, 'Alex Kiddle');
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  const nav = async (h) => { await page.click(`nav a[href="${h}"]`); await page.waitForTimeout(500); };
  const reason = async (t) => { await page.waitForSelector('.modal textarea'); await page.fill('.modal textarea', t); await page.click('.modal [data-ok]'); };
  const paste = (text) => page.evaluate((t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }, text);
  const samples = '#sg > .gwrap > table > tbody > tr:not(.gdetail)';          // sample rows (not the test rows nested under them)
  const testRows = '#sg tr.gdetail .gwrap > table > tbody > tr';             // every test row under every sample
  const switchLab = async (code) => { await page.click('#labBtn'); await page.locator('#labMenu button', { hasText: code }).click(); await page.waitForTimeout(600); };
  // Reads again until the condition holds (or 10 s pass), then the check judges what was read: a check waits for what it
  // checks, not a fixed time (a save's redraw can take longer than a fixed pause, e.g. on a just-started server)
  const until = async (read, ok, ms = 10000) => { const end = Date.now() + ms; for (;;) { const v = await read(); if (ok(v) || Date.now() > end) return v; await page.waitForTimeout(100); } };

  await page.goto(BASE + '/#/intake'); await page.waitForSelector('#pg');
  const pendingRows = () => page.locator('#pg tbody tr').count();
  const pending0 = await until(pendingRows, (n) => n >= 1);
  await shot('20_intake');
  check('Intake shows the pending Same Day rush', pending0 === 1, pending0 + ' rows');
  await page.locator('#pg button', { hasText: 'Approve' }).click(); await page.click('.modal [data-ok]');
  check('Approving clears the pending list', (await until(pendingRows, (n) => n === 0)) === 0);

  await nav('#/orders'); await page.locator('#g a', { hasText: 'LO-000001' }).click(); await page.waitForSelector(testRows); await page.waitForTimeout(300);
  await shot('21_order_before_log');
  await page.click('#log'); await page.click('.modal [data-ok]');
  // the lab's next number of the day (other demo orders log samples at CFL too, e.g. the WD-2 Heavy Metals order)
  const seqsOf = (codes) => codes.map((c) => c.trim()).filter((c) => /^CFL\d{9}$/.test(c)).map((c) => Number(c.slice(-3)));
  const codes = await until(() => page.locator(`${samples} td:nth-child(3)`).allInnerTexts(), (c) => seqsOf(c).length === 3);
  const seqs = seqsOf(codes);
  await page.waitForLoadState('networkidle').catch(() => {});   // the order has finished redrawing: the next edit is not lost to a late redraw
  check('Logging the third sample assigns the lab\'s next sample number (CFLyymmddNNN)', seqs.length === 3 && seqs[2] > Math.max(seqs[0], seqs[1]), JSON.stringify(codes));
  // rush Moisture on the first sample to 48 Hour: type in the Rush tier cell and press Enter
  const first = page.locator('#sg tr.gdetail').first().locator('.gwrap > table > tbody > tr', { hasText: 'Moisture' });
  await first.locator('td:nth-child(6)').dblclick(); await page.keyboard.type('48'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  await page.click('#tsave'); await reason('Client called to rush moisture');
  const rushed = (rows) => rows.some((t) => t.includes('Moisture') && t.includes('48 Hour') && t.includes('Auto-accepted'));
  const rs = await until(() => page.locator(testRows).allInnerTexts(), rushed);
  check('Moisture 48 Hour rush auto-accepted after save', rs.some((t) => t.includes('Moisture') && t.includes('48 Hour') && t.includes('Auto-accepted')));
  await shot('22_order_after_log');

  await nav('#/intake');
  const metals48 = (rows) => rows.some((t) => t.includes('Heavy Metals') && t.includes('48 Hour'));
  const inc = await until(() => page.locator('#ig tbody tr').allInnerTexts(), metals48);
  const mi = inc.findIndex((t) => t.includes('Heavy Metals') && t.includes('48 Hour')) + 1;
  await page.locator(`#ig tbody tr:nth-child(${mi}) button`, { hasText: 'Not accepted' }).click();
  await page.waitForSelector('.modal textarea'); await page.fill('.modal textarea', 'ICP-MS is down for calibration today');
  await page.click('.modal [data-ok]');
  await until(() => page.locator('#ig tbody tr').allInnerTexts(), (rows) => !metals48(rows));   // the decision is recorded
  await nav('#/outbox');
  const mails = await until(() => page.locator('#g tbody tr').count(), (n) => n >= 1);
  await shot('23_outbox');
  check('Decline email in the Outbox', mails >= 1, mails + ' rows');
  await page.locator('#g td:nth-child(5) a').first().click(); await page.waitForSelector('.email pre');
  const body = await page.locator('.email pre').innerText();
  check('Email names staff, reason and standard turnaround', body.includes('Processed by') && body.includes('calibration') && body.includes('standard turnaround'));
  await shot('24_email'); await page.click('.modal [data-ok]');

  // Walk-in order for Beta Foods at TPS: switch lab, paste samples, apply list-price project, log
  await switchLab('TPS');
  await nav('#/orders'); await page.locator('#g a', { hasText: 'LO-000002' }).click(); await page.waitForSelector('#sg'); await page.waitForTimeout(300);
  await page.locator('#sg [data-add="1"]').click();
  await page.locator(`${samples}:nth-child(1) td:nth-child(4)`).click();
  await paste('BF-101\tGranola bar\tBar\nBF-102\tGranola bar\tBar\nBF-103\tTrail mix\tSnack');
  // Containers (column 11 since 0.16.1): 3, filled down
  await page.locator(`${samples}:nth-child(1) td:nth-child(11)`).click(); await page.keyboard.type('3'); await page.keyboard.press('Enter');
  await page.locator(`${samples}:nth-child(1) td:nth-child(11)`).click(); await page.locator(`${samples}:nth-child(3) td:nth-child(11)`).click({ modifiers: ['Shift'] });
  await page.keyboard.press('Control+d'); await page.waitForTimeout(200);
  await shot('25_walkin_paste');
  await page.locator('.savebar.show button', { hasText: 'Save samples' }).click();
  await until(() => page.locator('.savebar.show').count(), (n) => n === 0);
  check('Three pasted samples saved', (await until(() => page.locator(samples).count(), (n) => n === 3)) === 3);
  // 0.16.1 (Alex): the shared tests got a home lab (CFL), so Beta Foods' list-price tests are subcontracted from TPS:
  // not orderable at TPS yet, and the order page says so (this walk-in used to apply them and log the samples)
  check('At TPS, the CFL tests of the client\'s quote are listed as subcontracted, and "Apply project" has nothing to apply',
    /subcontracted from TPS/.test(await page.locator('#subc').innerText().catch(() => '')) && await page.locator('#applyP').isDisabled());
  check('Active client order shows no hold notice', (await page.locator('.notice').count()) === 0);
  await shot('26_walkin_logged');
  await switchLab('CFL');

  await nav('#/admin/sites'); await shot('27_sites');
  check('Sites page (Admin) lists CFL and TPS', (await until(() => page.locator('#sg tbody tr').count(), (n) => n === 2)) === 2);
  check('No native browser dialogs used', native === 0);
  check('No browser errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await b.close();
  const f = results.filter((x) => !x).length; console.log(`\nTOTAL: ${results.length - f} passed, ${f} failed`); process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
