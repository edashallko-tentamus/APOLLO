// WD-5 (migration 021): preliminary results and order statuses, on the demo "Vitamin C stability (demo)" batch (seed_017,
// day 0 and day 7 done). The Lab Supervisor approves the steps before day 7 and releases day 7 as preliminary results
// (signed "Reviewed by"); the sample page marks them "Preliminary: not a final result"; the analyst cannot reopen a step
// that fed them; day 14 is read, the order moves to In Review, the final review carries day 0 and day 7 into the final
// results unchanged and the order is Approved. Also: the Split off step's "Customer consent required" setting in the
// designer. Run after the other suites (it needs only the demo data), on a freshly reset database.
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, sign } = require('./auth');
const PASSWORD = require('./test-credentials.json').password;
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (l, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };

(async () => {
  await prepareUsers(BASE);
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[0-3]/.test(m.text())) errors.push(m.text()); });
  let native = 0; page.on('dialog', (d) => { native++; d.dismiss(); });
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  const go = async (h) => { await page.goto(BASE + '/' + h); await page.waitForSelector('main h1'); await page.waitForTimeout(800); };
  const api = async (who, p) => {
    const lr = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: who, password: PASSWORD }) });
    const cookie = lr.headers.get('set-cookie').split(';')[0];
    const users = await (await fetch(BASE + '/api/users', { headers: { Cookie: cookie } })).json();
    const site = users.find((u) => u.username === who).sites.find((s) => s.site_code === 'CFL').id;
    return (await fetch(BASE + '/api' + p, { headers: { Cookie: cookie, 'x-site-id': site } })).json();
  };
  const status = async () => (await page.locator('main .sub .badge').first().innerText()).trim();
  const orderStatus = async () => { const o = await api('akiddle', '/orders'); return (o.rows || o).find((x) => x.po_number === 'PO-45180')?.status; };
  const complete = async () => {
    await page.click('[data-a="complete"]'); await page.waitForSelector('.sigmodal #c_pass'); await page.fill('.sigmodal #c_pass', PASSWORD);
    await page.click('.sigmodal [data-ok]'); await page.waitForSelector('.sigmodal', { state: 'detached', timeout: 15000 }); await page.waitForTimeout(900);
  };
  const approveAll = async (sel) => {
    for (let i = 0; i < 20; i++) {
      const btn = page.locator(sel + ' button', { hasText: 'Approve step' }); const n = await btn.count(); if (!n) break;
      await Promise.all([page.waitForResponse((res) => res.url().includes('/review-mark')), btn.first().click()]);
      await page.waitForFunction(([s, m]) => document.querySelectorAll(s + ' button').length && [...document.querySelectorAll(s + ' button')].filter((x) => x.textContent === 'Approve step').length < m, [sel, n], { timeout: 15000 });
      await page.waitForTimeout(300);
    }
  };

  // ---- the Lab Supervisor finds the batch and opens its day 7 review
  const list = await api('labsup', '/testing/batches?show=open');
  const vb = list.rows.find((x) => /Vitamin C stability/.test(x.test_name));
  check('The demo stability batch is in progress (day 0 and day 7 done, day 14 ahead)', vb && vb.status === 'In Progress');
  await signIn(page, BASE, 'Lab Supervisor (demo)', `#/testing/batches/${vb.id}?step=rv_7`); await page.waitForSelector('#tp_steps'); await page.waitForTimeout(800);
  const p1 = await page.locator('#panel').innerText();
  check('Day 7 review: the steps before it are listed to approve, and its two results are ready (day 0 assay 498 mg/g, day 7 at 98.2 % of initial)',
    /To resolve before release/.test(p1) && /not approved yet/.test(p1) && (await page.locator('#tp_steps tbody tr').count()) === 5
    && /Day 0: result[\s\S]*498[\s\S]*mg\/g/.test(p1) && /Day 7: % of initial[\s\S]*98\.2/.test(p1) && await page.locator('#tp_rel').isDisabled());
  await shot('wd5_01_day7_review');
  await approveAll('#tp_steps');
  check('Every step before day 7 approved: ready to release', /Ready to release/.test(await page.locator('#panel').innerText()) && !(await page.locator('#tp_rel').isDisabled()));
  await page.click('#tp_rel'); await sign(page); await page.waitForTimeout(1200);
  const p2 = await page.locator('#panel').innerText();
  check('Released (signed "Reviewed by"): the two results are stored as Preliminary; the day 7 review step is done',
    /Released[\s\S]*Lab Supervisor \(demo\)/.test(p2) && (p2.match(/Preliminary: not a final result/g) || []).length === 2
    && /✓/.test(await page.locator('.tbtabs a', { hasText: 'Day 7: QC Review' }).innerText()));
  await shot('wd5_02_released');
  const bd = await api('labsup', '/testing/batches/' + vb.id);
  const sampleId = bd.entries.find((e) => e.entry_type === 'Sample').sample_id;
  await go('#/samples/' + sampleId); await page.waitForSelector('#rg tbody tr');
  const sp = await page.locator('#rg').innerText();
  check('The sample page shows the day 0 and day 7 results marked "Preliminary: not a final result"',
    (sp.match(/Preliminary: not a final result/g) || []).length === 2 && /Day 7: % of initial/.test(sp));
  check('A preliminary result does not finish the order (still In Testing)', (await orderStatus()) === 'In Testing');

  // ---- the analyst: what fed day 7 is locked; day 14 is read
  await signIn(page, BASE, 'Analyst (demo)', `#/testing/batches/${vb.id}?step=read_7`); await page.waitForSelector('#panel .card'); await page.waitForTimeout(600);
  await page.click('[data-a="reopen"]');
  const err = await sign(page, { reason: 'Transcription check', expectError: true });
  check('A step that fed released results cannot be reopened (the message says why)', /already released as preliminary/.test(err));
  await page.click('.sigmodal [data-x]'); await page.waitForTimeout(300);
  await go(`#/testing/batches/${vb.id}?step=read_14`); await page.waitForSelector('#body tbody tr');
  check('A reading step shows its analytical runs (Run 1) and + Add analytical run', /Run 1/.test(await page.locator('.tbruns').innerText()) && /Add analytical run/.test(await page.locator('.tbruns').innerText()));
  await page.locator('#body tbody tr:nth-child(1) td:nth-child(5)').click();
  await page.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', '478'); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); });
  await page.waitForTimeout(250); await page.click('#body .savebar [data-save]'); await page.waitForTimeout(1200);
  await complete();
  await go(`#/testing/batches/${vb.id}?step=calc_14`); await page.waitForSelector('#panel .card');
  await complete();
  check('Day 14 done: the batch waits for its final review and the order is In Review', (await status()) === 'Awaiting Review' && (await orderStatus()) === 'In Review');

  // ---- the final review: day 14 approved; day 0 and day 7 carried over unchanged
  await signIn(page, BASE, 'Lab Supervisor (demo)', `#/testing/batches/${vb.id}?step=review`); await page.waitForSelector('#rv_steps'); await page.waitForTimeout(800);
  check('The final review lists the timepoint as released and only the day 14 steps to approve',
    /Day 7: QC Review: released by Lab Supervisor \(demo\)/.test(await page.locator('#panel').innerText()) && (await page.locator('#rv_steps button', { hasText: 'Approve step' }).count()) === 2);
  await approveAll('#rv_steps');
  await page.click('#rv_ok'); await sign(page); await page.waitForTimeout(1500);
  check('Approved (signed "Reviewed by")', (await status()) === 'Approved');
  await go('#/samples/' + sampleId); await page.waitForSelector('#rg tbody tr');
  const sf = await page.locator('#rg').innerText();
  check('The sample page now shows final results only: day 0 and day 7 carried over unchanged, and day 14 (96.0 % of initial)',
    !/Preliminary/.test(sf) && /Day 0: result[\s\S]*498/.test(sf) && /Day 7: % of initial[\s\S]*98\.2/.test(sf) && /Final result[\s\S]*96\.0/.test(sf));
  check('Order status: Approved once every test has final results', (await orderStatus()) === 'Approved');
  await shot('wd5_03_final');

  // ---- the designer: "Customer consent required" on a Split off step (a step designed before the setting keeps consent)
  await go('#/methods'); await page.waitForSelector('#g tbody tr');
  await page.locator('#g tbody tr', { hasText: 'USP <62> Specified Microorganisms' }).locator('a', { hasText: /^v\d+$/ }).last().click(); await page.waitForSelector('.wdtabs');
  const ver = page.url().match(/versions\/([\w-]+)/)[1];
  await go(`#/methods/versions/${ver}?tab=workflow`); await page.locator('#diag .node', { hasText: 'Identify suspect colonies' }).click(); await page.waitForSelector('#c_consent');
  check('The Split off step has a "Customer consent required" setting (ticked on steps designed before it existed)',
    await page.locator('#c_consent').isChecked() && /Customer consent required/.test(await page.locator('#se').innerText()));

  // ---- the menu
  check('QC Review is in the Testing menu', (await page.locator('nav a[href="#/testing/batches?show=review"]').count()) === 1);
  check('No native browser dialogs were used', native === 0);
  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
