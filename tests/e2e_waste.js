// 0.30.0 (migration 052): waste classifications. The Lab Supervisor opens Admin > Lab setup > Waste classifications
// (the shared starter list), adds CFL's own by paste (hazard classes from the list, the lab's default for Solvent), and
// a hazard class not on the list is marked red; the Analyst sees the list read only. A new solvent saved without a
// choice takes CFL's default; the lot page shows how to dispose of it; a reagent defaults to "classify from the SDS"
// and is listed under Inventory > Waste to classify until it is classified (edited, signed); disposal says what it is
// disposed of as. Run on a freshly reset database.
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, sign, login, call } = require('./auth');
const PASSWORD = require('./test-credentials.json').password;
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (l, ok, x = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };

async function as(who, lab = 'CFL') {
  const cookie = await login(BASE, who, PASSWORD);
  const users = (await call(BASE, '/users', { cookie })).data;
  const site = users.find((u) => u.username === who).sites.find((s) => s.site_code === lab).id;
  return async (p, body) => {
    const res = await fetch(BASE + '/api' + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-site-id': site }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${who} ${p}: ${data.error}`);
    return data;
  };
}

(async () => {
  await prepareUsers(BASE);
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[0-4]/.test(m.text())) errors.push(m.text()); });
  let native = 0; page.on('dialog', (d) => { native++; d.dismiss(); });
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  const go = async (h) => { await page.goto('about:blank'); await page.goto(BASE + '/' + h); await page.waitForSelector('main h1'); await page.waitForTimeout(900); };
  const cell = (r, c) => page.locator(`#wg .gwrap > table > tbody > tr:nth-child(${r}) > td:nth-child(${c})`);
  const paste = (text) => page.evaluate((t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }, text);
  const sup = await as('labsup');

  // ---- 1. the list
  await signIn(page, BASE, 'Lab Supervisor (demo)', '#/admin/waste'); await go('#/admin/waste');
  check('Admin > Lab setup has "Waste classifications" for the Lab Supervisor', (await page.locator('nav a[href="#/admin/waste"]').count()) === 1);
  const r0 = await page.locator('#wg tbody tr').allInnerTexts();
  check('The shared starter list: 12 classifications for every lab (biohazardous, solvents, acids ... non-hazardous)', r0.length === 12 && r0.every((t) => /Every lab/.test(t))
    && r0.some((t) => /Biohazardous: media, cultures and strains/.test(t) && /Media, Microbiological Strain/.test(t)) && r0.some((t) => /Non-hazardous solid waste/.test(t)), r0.length);
  // a hazard class not on the list is refused (marked red), then discarded
  await page.click('#wg [data-add="1"]'); await cell(13, 2).click();
  await paste('CFL bad\tCFL\tExplosive'); await page.waitForTimeout(300);
  check('A hazard class not on the list is marked red', (await cell(13, 4).getAttribute('class')).includes('err'));
  await page.click('#wg .savebar [data-undo]'); await page.waitForTimeout(300);
  await page.click('#wg [data-add="1"]'); await cell(13, 2).click();
  await paste('CFL acetonitrile waste (HPLC)\tCFL\tignitable, toxic\tD001, U003\tAcetonitrile (HPLC)\t5 gal HDPE carboy\tHPLC waste carboy under the instrument; hazardous waste pickup\tOxidizers, acids\tsolvent');
  await page.waitForTimeout(300);
  await page.click('#wg .savebar [data-save]'); await page.waitForTimeout(500);
  if (await page.$('.sigmodal, .modal')) await sign(page, { reason: 'CFL acetonitrile stream' }).catch(() => {});
  await page.waitForTimeout(1200);
  const list = await sup('/waste');
  const mine = list.rows.find((r) => r.waste_name === 'CFL acetonitrile waste (HPLC)');
  check('Saved by paste: CFL\'s own, its hazard classes as on the list, the lab\'s default for Solvent', mine && mine.site_id && mine.hazard_classes.join() === 'Ignitable,Toxic'
    && mine.default_for.join() === 'Solvent' && /^WC-\d{3}$/.test(mine.waste_code), JSON.stringify(mine && { h: mine.hazard_classes, d: mine.default_for }));
  await shot('w01_waste_list');

  // ---- 2. a new solvent takes CFL's default; a reagent is to classify
  await go('#/inventory/new'); await page.waitForSelector('#f_types');
  check('The new item form offers a waste classification (empty: the default for its type)', (await page.locator('#f_waste_classification_id option').count()) > 10);
  await page.fill('#f_item_name', 'Acetonitrile HPLC grade (waste demo)'); await page.locator('#f_types input[value="Solvent"]').check();
  await page.fill('#f_manufacturer_lot', 'ACN-W-01'); await page.fill('#f_quantity_received', '4');
  await page.evaluate(() => { const s = document.querySelector('#f_unit'); s.value = 'L'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#save'); await sign(page); await page.waitForSelector('#wastecard'); await page.waitForTimeout(400);
  const lotId = page.url().split('/').pop();
  const wc = await page.locator('#wastecard').innerText();
  check('Saved without a choice, the solvent takes CFL\'s default; the lot page shows how to dispose of it', /CFL acetonitrile waste \(HPLC\)/.test(wc) && /Ignitable, Toxic/.test(wc) && /D001, U003/.test(wc) && /HPLC waste carboy/.test(wc) && /Oxidizers, acids/.test(wc), wc.replace(/\s+/g, ' '));
  await go('#/inventory?show=waste');
  const toClassify = await page.locator('#g tbody tr').allInnerTexts();
  check('Inventory > Waste to classify lists the reagents, standards and mixtures still on "classify from the SDS"', toClassify.length > 0 && toClassify.every((t) => /To classify/.test(t)), toClassify.length);
  const reagentRow = page.locator('#g tbody tr').first(); const reagentCode = (await reagentRow.locator('td:nth-child(3)').innerText()).trim();
  await reagentRow.locator('td:nth-child(3) a').click(); await page.waitForSelector('#wastecard');
  check('Its lot page says to classify it from the SDS', /to classify: read the SDS/.test(await page.locator('#wastecard').innerText()));
  const rid = page.url().split('/').pop();
  await go(`#/inventory/lots/${rid}/edit`); await page.waitForSelector('#f_waste_classification_id');
  const acid = await page.evaluate(() => [...document.querySelector('#f_waste_classification_id').options].find((o) => o.text === 'Corrosive acids').value);
  await page.evaluate((v) => { const s = document.querySelector('#f_waste_classification_id'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, acid);
  await page.click('#save'); await sign(page, { reason: 'Classified from the SDS' }); await page.waitForSelector('#wastecard'); await page.waitForTimeout(400);
  check(`Edited (signed, with a reason), ${reagentCode} is Corrosive acids`, /Corrosive acids/.test(await page.locator('#wastecard').innerText()) && !/to classify/.test(await page.locator('#wastecard').innerText()));
  await go('#/inventory?show=waste');
  check('and leaves the Waste to classify list', !(await page.locator('#g').innerText()).includes(reagentCode));

  // ---- 3. disposal says what it is disposed of as
  await go('#/inventory/lots/' + lotId);
  await page.click('[data-act="dispose"]'); await page.waitForSelector('.sigmodal');
  const what = await page.locator('.sigmodal .intro').innerText();
  check('Disposing of the solvent says it goes as CFL acetonitrile waste (HPLC) (Acetonitrile (HPLC))', /as CFL acetonitrile waste \(HPLC\) \(Acetonitrile \(HPLC\)\)/.test(what), what);
  await sign(page, { reason: 'Expired' }); await page.waitForTimeout(1000);

  // ---- 4. the Analyst sees it read only; the audit trail
  await signIn(page, BASE, 'Analyst (demo)', '#/admin/waste'); await go('#/admin/waste');
  check('The Analyst sees the list but cannot add or change it', (await page.locator('#wg tbody tr').count()) === 13 && (await page.locator('#wg [data-add="1"]').count()) === 0);
  await page.click('main h1 .auditbtn'); await page.waitForTimeout(900);
  check('The page\'s audit trail lists the classifications', /Waste classification WC-/.test(await page.locator('.modal').innerText().catch(() => '')));

  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('No native browser dialogs', native === 0);
  await b.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed} of ${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
