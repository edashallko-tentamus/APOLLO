// Micro at the bench, WD-4 (migration 019): the demo Analyst batches the two USP <62> supplements (the day's positive
// and negative controls are added), weighs by product category, makes the enrichment, puts it in an incubator as a
// load and takes it out (outside its window, so a note explains it), plates the S. aureus branch on mannitol salt agar
// (media lot, strain on the positive control), incubates, reads ND / D* / D, and the controls are judged.
// Run on a freshly reset database.
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn } = require('./auth');
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
  const cell = (r, c, host = '#body') => `${host} tbody tr:nth-child(${r}) td:nth-child(${c})`;
  const pasteAt = async (sel, text) => {
    await page.locator(sel).click();
    await page.evaluate((t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }, text);
    await page.waitForTimeout(250);
  };
  const step = async (key) => { await page.goto(`${BASE}/#/testing/batches/${bid}?step=${key}`); await page.waitForSelector('#panel .card'); await page.waitForTimeout(700); };
  const complete = async () => {
    await page.click('[data-a="complete"]'); await page.waitForSelector('.sigmodal #c_pass');
    await page.fill('.sigmodal #c_pass', PASSWORD); await page.click('.sigmodal [data-ok]');
    await page.waitForSelector('.sigmodal', { state: 'detached', timeout: 15000 }); await page.waitForTimeout(900);
  };
  const done = async (key) => (await page.locator(`.tbtabs a[href$="step=${key}"]`).innerText()).includes('✓');
  const modalPick = async (sel, re) => {
    const v = await page.evaluate(([s, src]) => { const o = [...document.querySelectorAll(s + ' option')].find((x) => new RegExp(src).test(x.textContent)); return o ? o.value : null; }, [sel, re.source]);
    await page.locator(sel).selectOption(v);
  };
  const material = async (lotRe, purpose, amount) => {
    await page.click('[data-a="mat"]'); await page.waitForSelector('.modal #f_lot_id');
    await modalPick('.modal #f_lot_id', lotRe); await page.locator('.modal #f_purpose').selectOption(purpose);
    await page.fill('.modal #f_volume', String(amount)); await page.locator('.modal #f_volume_unit').selectOption('each');
    await page.click('.modal [data-ok]'); await page.waitForTimeout(1000);
  };
  const incubate = async () => {
    await page.click('[data-inc="new"]'); await page.waitForSelector('.modal #f_equipment_id');
    await modalPick('.modal #f_equipment_id', /Incubator/); await page.click('.modal [data-ok]'); await page.waitForTimeout(1000);
    await page.locator('#inc_l button', { hasText: 'Take out' }).click(); await page.waitForTimeout(1000);
  };
  let bid;

  // ---- the micro backlog, autobatch with the day's controls
  await signIn(page, BASE, 'Analyst (demo)', '#/testing'); await page.waitForSelector('.tbgroup');
  check('The Microbiology backlog lists USP <62> (version 2) for two supplements', /MICRO Microbiology[\s\S]*USP <62> Specified Microorganisms \(v2\)[\s\S]*2 waiting/.test(await page.locator('main').innerText()));
  await page.locator('.tbgroup', { hasText: 'USP <62>' }).locator('[data-auto]').click(); await page.waitForSelector('.modal [data-ok]'); await page.click('.modal [data-ok]');
  // making a batch lands on the Batches list with the new batch highlighted; open it from there
  await page.waitForSelector('#g tr.tbmade', { timeout: 15000 }); await page.locator('#g tr.tbmade a').first().click(); await page.waitForSelector('#panel .card'); await page.waitForTimeout(700);
  bid = page.url().match(/batches\/([\w-]+)/)[1];
  const ents = await page.locator('#body tbody').innerText();
  check('Autobatch adds the day\'s positive and negative controls (daily, shared by the day\'s batches)', /Positive Control \(daily\)/.test(ents) && /Negative Control \(daily\)/.test(ents));
  await complete();

  // ---- weighing by product category, the balance; the enrichment
  await step('weigh');
  check('Weighing shows the product-category ranges', /product category/.test(await page.locator('#panel .tbnote').first().innerText()));
  await pasteAt(cell(1, 5), '10.2\n10.4\n10.1\n10.3'); await page.click('#body .savebar [data-save]'); await page.waitForTimeout(1200);
  await page.click('[data-a="eq"]'); await page.waitForSelector('.modal #f_equipment_id'); await modalPick('.modal #f_equipment_id', /Top-loading/); await page.click('.modal [data-ok]'); await page.waitForTimeout(900);
  await complete();
  await step('tsb'); await page.click('#dl_std'); await page.click('#body .savebar [data-save]'); await page.waitForTimeout(1200); await complete();
  check('Weighing and the enrichment are completed', (await done('weigh')) && (await done('tsb')));

  // ---- incubation as a load: in, out (outside the window), a note explains it
  await step('inc_tsb');
  await incubate();
  check('A load is put in the incubator and taken out; outside its window it must be explained', /explain it in the load's note/.test(await page.locator('.tbtodo').innerText()) && /outside 18 to 24 hours/.test(await page.locator('#inc_l').innerText()));
  await pasteAt(cell(1, 8, '#inc_l'), 'Demo run: taken out at once to show the window check'); await page.click('#inc_l .savebar [data-save]'); await page.waitForTimeout(1200);
  await shot('91_micro_incubation');
  await complete();
  check('Incubation completed once the load is explained', await done('inc_tsb'));

  // ---- plating on mannitol salt agar: plates, media lot, the strain on the positive control
  await step('msa');
  await page.click('#pl_std'); await page.click('#body .savebar [data-save]'); await page.waitForTimeout(1200);
  check('Plates recorded; the media lot is still to record', /record the media lot/.test(await page.locator('.tbtodo').innerText()));
  await material(/Mannitol salt/, 'Media', 1);
  const pc = (await page.locator('#body tbody tr').allInnerTexts()).findIndex((t) => /Positive Control/.test(t)) + 1;
  await page.locator(cell(pc, 3)).click();
  await material(/Staphylococcus aureus ATCC 6538/, 'Strain', 1);
  check('The media plates and the strain are recorded (plates and vial taken off stock)', /MB-SA|INV-/.test(await page.locator(cell(pc, 7)).innerText()) && !(await page.locator('.tbtodo').count()));
  await complete();
  await step('inc_msa'); await incubate();
  await pasteAt(cell(1, 8, '#inc_l'), 'Demo run'); await page.click('#inc_l .savebar [data-save]'); await page.waitForTimeout(1200); await complete();

  // ---- reading: ND / D* / D, the controls judged
  await step('read_sa');
  const rr = await page.locator('#body tbody tr').allInnerTexts();
  const val = (t) => (/Positive Control/.test(t) ? 'D' : /Negative Control/.test(t) ? 'ND' : null);
  let sIdx = 0;
  const vals = rr.map((t) => val(t) || (sIdx++ === 0 ? 'ND' : 'D*'));
  await pasteAt(cell(1, 5), vals.join('\n')); await page.click('#body .savebar [data-save]'); await page.waitForTimeout(1200);
  await shot('92_micro_reading');
  await complete();
  check('Readings are the test\'s own values (ND, D*, D); the reading step is completed', await done('read_sa'));
  await step('results');
  const qc = await page.locator('#qc tbody').innerText();
  check('Controls judged for S. aureus: the positive control grows (Presence: Pass), the negative does not (Absence: Pass)',
    /Positive Control \(daily\)\s+1\s+Presence\s+Staphylococcus aureus[^\n]*Pass/.test(qc) && /Negative Control \(daily\)\s+1\s+Absence\s+Staphylococcus aureus[^\n]*Pass/.test(qc));
  check('The sample read D* shows D* as its result', /D\*/.test(await page.locator('#res tbody').innerText()));
  await shot('93_micro_results');
  // WD-5.1: the QC Review lists the load outside its window, with the analyst's note, for the reviewer to accept
  await step('review'); await page.waitForSelector('#rv_loads tbody tr', { timeout: 15000 });
  const lt = await page.locator('#rv_loads').innerText();
  check('QC Review lists the incubator load outside its window with the analyst\'s note, not yet accepted by a reviewer',
    /outside/.test(lt) && /Not accepted yet/.test(lt) && (await page.locator('#rv_loads tbody tr').count()) >= 1);

  check('No native browser dialogs were used', native === 0);
  check('No page errors', errors.length === 0, errors.join(' | '));
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
