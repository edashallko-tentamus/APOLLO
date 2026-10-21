// Migration 050 (0.28.0): V-1 vendor approvals, local and corporate. QA at CFL finds the Vendor approvals tab, approves
// a vendor for this lab only (two scopes, a questionnaire attached; the corporate level is not offered); the Analyst's
// calibration request is accepted and a request outside the scopes is refused; QA proposes the approval for corporate
// approval; Corporate QA sees it waiting, approves it for every lab with one scope (so TPS may use it for that only);
// Corporate QA suspends another vendor for every lab, and CFL's QA reads the notice; the supply scopes are Corporate
// QA's to change; QA approves no purchase requests. Run on a freshly reset database.
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, sign, login, call } = require('./auth');
const PASSWORD = require('./test-credentials.json').password;
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (l, ok, x = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const VENDOR = 'Budget Lab Supplies';

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
  const toasts = async () => (await page.locator('.toast').allInnerTexts()).join(' | ');
  const setSel = (sel, value) => page.evaluate(([s, v]) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, value]);
  const optionValue = (sel, text) => page.evaluate(([s, t]) => [...document.querySelector(s).options].find((o) => o.text.includes(t))?.value, [sel, text]);
  const tickScope = (name) => page.locator('.modal #scopebox label', { hasText: name }).first().locator('input').check();
  const qaApi = await as('qa.reviewer'); const tpsApi = await as('corp.qa', 'TPS');

  // ---- 1. QA at CFL: the Vendor approvals tab
  await signIn(page, BASE, 'QA Reviewer (demo)', '#/purchasing/suppliers');
  await go('#/purchasing/suppliers');
  const tabsText = await page.locator('main .putabs').innerText();
  check('Purchasing has a "Vendor approvals" tab (and "Risk classes and scopes")', /Vendor approvals/.test(tabsText) && /Risk classes and scopes/.test(tabsText));
  check('The page shows each vendor here, at this lab and corporately (the demo vendors are corporate approvals)',
    /Corporate/.test(await page.locator('#g').innerText()) && /Not qualified/.test(await page.locator('#g tbody tr', { hasText: VENDOR }).innerText()));
  await page.locator('#g tbody tr', { hasText: VENDOR }).locator('a').first().click(); await page.waitForSelector('#qual');
  const vendorUrl = page.url();
  await page.click('#qual'); await page.waitForSelector('.modal #f_level');
  const levels = await page.evaluate(() => [...document.querySelector('.modal #f_level').options].map((o) => o.text));
  check('QA approves for this lab only: the corporate level is not offered', levels.length === 1 && /This lab only/.test(levels[0]), levels.join(' | '));
  await setSel('.modal #f_risk_class_id', await optionValue('.modal #f_risk_class_id', 'Class II'));
  await page.fill('.modal #f_justification', 'Supplier questionnaire reviewed');
  await tickScope('Consumables'); await tickScope('Calibration services');
  await page.locator('.modal .docrow').first().locator('.df').setInputFiles({ name: 'questionnaire.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.locator('.modal .docrow').first().locator('.dtl').fill('Supplier questionnaire 2026');
  await page.locator('.modal [data-ok]').click(); await sign(page); await page.waitForTimeout(1200);
  check('Approved for CFL, decided by this lab, for its two scopes, with the questionnaire',
    /Approved for CFL/.test(await page.locator('main .sub').innerText()) && /decided by this lab/.test(await page.locator('main .sub').innerText())
    && /Consumables, Calibration services/.test(await page.locator('#qg').innerText()) && /Supplier questionnaire 2026/.test(await page.locator('#dg').innerText()));
  await shot('vendors_01_local');

  // ---- 2. Requests are checked against the scopes
  await signIn(page, BASE, 'Analyst (demo)', '#/purchasing');
  await go('#/purchasing');
  await page.click('#new'); await page.waitForSelector('.modal #f_scope_id');
  await setSel('.modal #f_line_type', 'Service'); await page.fill('.modal #f_description', 'Pipette calibration visit');
  await setSel('.modal #f_supplier_id', await optionValue('.modal #f_supplier_id', VENDOR));
  await setSel('.modal #f_scope_id', await optionValue('.modal #f_scope_id', 'Calibration services'));
  await page.locator('.modal [data-ok]').click(); await sign(page); await page.waitForTimeout(1200);
  check('A calibration request to the vendor is accepted, "For" Calibration services', /Calibration services/.test(await page.locator('main').innerText()) && /PR-\d{6}/.test(await page.locator('main').innerText()));
  await go('#/purchasing');
  await page.click('#new'); await page.waitForSelector('.modal #f_scope_id');
  await setSel('.modal #f_line_type', 'Service'); await page.fill('.modal #f_description', 'Consulting day');
  await setSel('.modal #f_supplier_id', await optionValue('.modal #f_supplier_id', VENDOR));
  await page.locator('.modal [data-ok]').click(); await page.waitForSelector('.sigmodal');
  await page.fill('.sigmodal #f_spass', PASSWORD); await page.click('.sigmodal [data-ok]'); await page.waitForTimeout(800);
  check('A service outside the vendor\'s scopes is refused, saying what it is not approved for', /not approved for other services/.test(await page.locator('.sigmodal').innerText()), await page.locator('.sigmodal .merr').innerText().catch(() => ''));
  await page.click('.sigmodal [data-x]'); await page.waitForTimeout(300);

  // ---- 3. QA proposes the approval for corporate approval
  await signIn(page, BASE, 'QA Reviewer (demo)', '#/purchasing/suppliers');
  await page.goto(vendorUrl); await page.waitForSelector('#propose');
  await page.click('#propose'); await page.waitForSelector('.modal #f_risk_class_id');
  await page.fill('.modal #f_note', 'Used at CFL without a complaint');
  await page.locator('.modal [data-ok]').click(); await sign(page); await page.waitForTimeout(1200);
  check('Proposed: the vendor page shows the proposal waiting for Corporate QA', /Proposed for corporate approval: VP-\d{5}/.test(await page.locator('#propcard').innerText()));
  const reqBtns = await (async () => { await go('#/purchasing'); return page.locator('#approve').count(); })();
  check('QA approves vendors, not purchase requests: no Approve button on the request queue', reqBtns === 0);

  // ---- 4. Corporate QA approves it for every lab, for consumables only
  await signIn(page, BASE, 'Corporate QA (demo)', '#/purchasing/suppliers');
  await go('#/purchasing/suppliers');
  check('Corporate QA sees the proposal waiting', /VP-\d{5}/.test(await page.locator('#waiting').innerText()) && new RegExp(VENDOR).test(await page.locator('#waiting').innerText()));
  await page.goto(vendorUrl); await page.waitForSelector('#okprop');
  check('Corporate QA approves vendors: no "Propose", but Approve or Reject the proposal', (await page.locator('#propose').count()) === 0 && (await page.locator('#rejprop').count()) === 1);
  await page.click('#okprop'); await page.waitForSelector('.modal #scopebox');
  await page.locator('.modal #scopebox label', { hasText: 'Calibration services' }).locator('input').uncheck();
  await page.locator('.modal [data-ok]').click(); await sign(page); await page.waitForTimeout(1200);
  check('The corporate record is made (for consumables), with the lab\'s questionnaire carried',
    /Corporate/.test(await page.locator('#qg').innerText()) && (await page.locator('#dg tbody tr', { hasText: 'Supplier questionnaire 2026' }).count()) === 2);
  const tps = (await tpsApi('/purchasing/vendors')).rows.find((r) => r.supplier_name === VENDOR);
  check('At TPS the vendor is now approved by Corporate QA, for consumables only', tps.approval_status === 'Approved' && tps.decided_at === 'Corporate' && tps.corporate_scopes === 'Consumables', JSON.stringify([tps.approval_status, tps.decided_at, tps.corporate_scopes]));
  await shot('vendors_02_corporate');

  // ---- 5. Corporate QA suspends another vendor for every lab; CFL's QA reads the notice
  await go('#/purchasing/suppliers');
  await page.locator('#g tbody tr', { hasText: 'Meridian Chemical' }).locator('a').first().click(); await page.waitForSelector('#qual');
  await page.click('#qual'); await page.waitForSelector('.modal #f_level');
  await setSel('.modal #f_level', 'corporate'); await setSel('.modal #f_approval_status', 'Suspended');
  await setSel('.modal #f_risk_class_id', await optionValue('.modal #f_risk_class_id', 'Class II'));
  await page.fill('.modal #f_justification', 'Recall under investigation');
  await page.locator('.modal [data-ok]').click(); await sign(page); await page.waitForTimeout(1200);
  check('Suspended by Corporate QA for every lab', /Suspended for CFL/.test(await page.locator('main .sub').innerText()) && /by Corporate QA/.test(await page.locator('main .sub').innerText()));
  await go('#/purchasing/risk-classes');
  check('Corporate QA keeps the supply scopes (the grid can add rows)', (await page.locator('#sg [data-add]').count()) > 0);
  await signIn(page, BASE, 'QA Reviewer (demo)', '#/purchasing/suppliers');
  await go('#/purchasing/suppliers');
  const nt = await page.locator('#notices').innerText();
  check('CFL\'s QA sees the notices: the approval and the suspension', /approved Budget Lab Supplies for every lab/.test(nt) && /suspended Meridian Chemical Co\. for every lab/.test(nt));
  await page.click('#ack'); await page.waitForTimeout(1000);
  check('Marked as read', (await page.locator('#notices').count()) === 0 && (await qaApi('/purchasing/vendors')).notices.every((n) => n.acknowledged_at));
  await go('#/purchasing/risk-classes');
  check('A lab\'s QA cannot change the supply scopes', (await page.locator('#sg [data-add]').count()) === 0);
  await page.goto(vendorUrl); await page.waitForSelector('main h1 .auditbtn'); await page.click('main h1 .auditbtn'); await page.waitForTimeout(900);
  const audit = await page.locator('.modal').innerText().catch(() => '');
  check('The vendor\'s audit trail has the proposal and its documents', /Proposal VP-/.test(audit) && /Vendor document/.test(audit));
  check('No page errors, no native dialogs', errors.length === 0 && native === 0, errors.join(' | '));
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
