// Slice 2.1 click-through (Alex's lab order feedback): tests under each sample, smart dropdowns, controlled
// Matrix list, TAT override, ID links, per-page audit trail, lab access and the lab switcher, Admin pages.
// Run after e2e_smoke.js and e2e_slice2.js on a freshly reset database.
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, sign } = require('./auth');
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
  const samples = '#sg > .gwrap > table > tbody > tr:not(.gdetail)';
  const panels = '#sg tr.gdetail';
  const testRows = `${panels} .gwrap > table > tbody > tr`;
  const h1 = () => page.locator('main h1').innerText();

  // ---- tests listed under each sample; show / hide
  await page.goto(BASE + '/#/orders'); await page.waitForSelector('#g a');
  await page.locator('#g a', { hasText: 'LO-000001' }).click(); await page.waitForSelector(testRows); await page.waitForTimeout(300);
  const orderUrl = page.url();
  check('Each sample has its tests listed under it', (await page.locator(panels).count()) === (await page.locator(samples).count()) && (await page.locator(samples).count()) === 3);
  check('The old separate "Tests on this order" box is gone', (await page.locator('h2', { hasText: 'Tests on this order' }).count()) === 0);
  await page.click('#toggleAll'); await page.waitForTimeout(150);
  check('"Hide all tests" hides every sample\'s tests', (await page.locator(panels).count()) === 0);
  await page.click('#toggleAll'); await page.waitForTimeout(150);
  await page.locator(`${samples} td:nth-child(1) button`).first().click(); await page.waitForTimeout(150);
  check('The ▾ button hides one sample\'s tests', (await page.locator(panels).count()) === 2);
  await page.locator(`${samples} td:nth-child(1) button`).first().click(); await page.waitForTimeout(150);

  // ---- TAT override (with reason) on a logged test moves the due date; price unchanged
  const row = page.locator(panels).first().locator('.gwrap > table > tbody > tr', { hasText: 'Total Aerobic' });
  const before = await row.innerText();
  await row.locator('td:nth-child(9)').click(); await page.keyboard.type('20'); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
  await page.click('#tsave'); await reason('Client agreed to a 20 day turnaround'); await page.waitForTimeout(900);
  const after = await page.locator(panels).first().locator('.gwrap > table > tbody > tr', { hasText: 'Total Aerobic' }).innerText();
  check('TAT override shows 20 days with the override mark', after.includes('20 cal. days ✎') || after.includes('20 bus. days ✎'), after.replace(/\s+/g, ' '));
  check('Due date moved and price stayed the same', after.split('\t').slice(9, 11).join() !== before.split('\t').slice(9, 11).join() && after.includes('$51.00'));
  await shot('30_tat_override');

  // ---- per-page audit trail icon
  await page.click('main h1 .auditbtn'); await page.waitForSelector('.modal #auditg tbody tr');
  const audit = await page.locator('.modal #auditg tbody tr').allInnerTexts();
  check('Audit icon shows this order\'s changes, including the TAT override reason', audit.some((t) => t.includes('Client agreed to a 20 day turnaround')));
  await shot('31_order_audit');
  await page.locator('.modal #auditg a[href^="#/samples/"]').first().click(); await page.waitForTimeout(600);
  check('Clicking a record in the audit trail opens it (sample page)', (await page.locator('.modal').count()) === 0 && (await h1()).startsWith('Sample CFL'));

  // ---- sample page and ID links
  await shot('32_sample_page');
  await page.locator('#tg a[href^="#/quote/"]').first().click(); await page.waitForTimeout(600);
  check('Quote ID on a test opens the exact quote version', /v\d+$/.test((await h1()).trim()) && page.url().includes('#/quote/'));
  await page.goto(orderUrl); await page.waitForSelector(testRows);
  await page.locator('main .sub a[href^="#/clients/"]').click(); await page.waitForTimeout(500);
  check('Client ID on the order opens the client', page.url().includes('#/clients/') && (await page.locator('h2', { hasText: 'Contacts and roles' }).count()) === 1);
  await page.locator('#cg a[href^="#/contacts?find="]').first().click(); await page.waitForTimeout(500);
  check('Contact code opens Contacts filtered to that contact', (await page.locator('#g tbody tr').count()) === 1);

  // ---- new order: smart dropdown in a form (type part of a name, Enter picks)
  await nav('#/orders'); await page.click('#new'); await page.waitForSelector('.modal .combo-input');
  check('New order form shows the lab you are working in', (await page.locator('.modal .intro').innerText()).includes('CFL'));
  await page.locator('.modal .combo-input').first().click(); await page.keyboard.type('irvine'); await page.waitForTimeout(100);
  check('Typing filters the client list to the closest match', (await page.locator('.combo-list .combo-item').first().innerText()).includes('Irvine'));
  await page.keyboard.press('Enter');
  check('Enter picks it', (await page.locator('.modal select').first().evaluate((s) => s.options[s.selectedIndex].text)).includes('Irvine'));
  await page.click('.modal [data-ok]'); await page.locator('.modal [data-ok]', { hasText: 'Create order' }).waitFor();
  await page.click('.modal [data-ok]'); await page.waitForSelector('#sg'); await page.waitForTimeout(400);
  check('New order created in the current lab', (await page.locator('main .sub').innerText()).includes('CFL'));

  // ---- samples: matrix from the controlled list
  await page.locator('#sg [data-add="1"]').click(); await page.locator('#sg [data-add="1"]').click();
  await page.locator(`${samples}:nth-child(1) td:nth-child(4)`).click(); await paste('NEW-01\tVanilla powder\nNEW-02\tFish oil');
  await page.locator(`${samples}:nth-child(1) td:nth-child(6)`).click(); await page.keyboard.type('pow'); await page.waitForTimeout(100); await page.keyboard.press('Enter');
  check('Matrix cell: typing "pow" + Enter picks Powder', (await page.locator(`${samples}:nth-child(1) td:nth-child(6)`).innerText()).trim() === 'Powder');
  await page.locator(`${samples}:nth-child(2) td:nth-child(6)`).click(); await paste('Moon dust');
  check('A matrix that is not on the list is marked red', (await page.locator(`${samples}:nth-child(2) td:nth-child(6)`).getAttribute('class')).includes('err'));
  await page.locator(`${samples}:nth-child(2) td:nth-child(6)`).click(); await page.keyboard.press('Enter'); await page.keyboard.press('Control+a'); await page.keyboard.type('caps');
  await page.waitForTimeout(100); await page.keyboard.press('Enter');
  check('Fixed by picking Capsule', (await page.locator(`${samples}:nth-child(2) td:nth-child(6)`).innerText()).trim() === 'Capsule');
  await page.locator('.savebar.show button', { hasText: 'Save samples' }).click(); await page.waitForTimeout(800);
  check('Samples saved with list matrices', (await page.locator(samples).allInnerTexts()).filter((t) => /Powder|Capsule/.test(t)).length === 2);

  // ---- smart dropdown with only the arrow keys: Add a test to ticked samples
  await page.click('#addT'); await page.waitForSelector('.modal .combo-input');
  await page.locator('.modal .combo-input').first().focus(); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(100);
  check('Down arrow opens the list', (await page.locator('.combo-list .combo-item').count()) > 1);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  const picked = await page.locator('.modal select').first().evaluate((s) => s.options[s.selectedIndex].text);
  await page.click('.modal [data-ok]'); await page.waitForTimeout(800);
  check('Arrow keys picked the second test and it was added under both samples', (await page.locator(testRows).count()) === 2, picked);
  await shot('33_new_order_tests_under_samples');

  // ---- lab access: the demo Intake Tech works in CFL only
  const tpsOrder = await page.evaluate(async () => {
    const alex = (await (await fetch('/api/users')).json()).find((u) => u.username === 'akiddle'); // signed in as Alex: the session says who is asking
    const r = await fetch('/api/orders', { headers: { 'x-site-id': alex.sites.find((s) => s.site_code === 'TPS').id } });
    return (await r.json())[0].id;
  });
  await signIn(page, BASE, 'Intake Tech (demo)');
  check('Lab icon shows CFL for the Intake Tech', (await page.locator('#labBtn').innerText()).trim() === 'CFL');
  check('Admin section is hidden for a non-administrator', (await page.locator('nav a[href="#/admin/users"]').count()) === 0);
  await page.click('#labBtn'); check('Lab menu offers only the assigned lab', (await page.locator('#labMenu button').count()) === 1); await page.click('main');
  await page.goto(BASE + '/#/orders/' + tpsOrder); await page.waitForTimeout(700);
  check('A TPS order link is refused for someone not assigned to TPS', (await page.locator('main .card.err').innerText()).includes('not assigned'));
  await signIn(page, BASE, 'Alex Kiddle');

  // ---- Admin: people and groups (migration 008). Lab access comes from groups: put the Intake Tech in TPS's Intake group
  await page.click('#labBtn'); await page.locator('#labMenu button', { hasText: 'TPS' }).click(); await page.waitForTimeout(700);
  await nav('#/admin/users'); await page.waitForSelector('#g tbody tr');
  const iRow = page.locator('#g tbody tr', { hasText: 'Intake Tech' });
  const intakeCol = (await page.locator('#g thead th').allInnerTexts()).findIndex((t) => t.trim() === 'Intake') + 1;
  await iRow.locator(`td:nth-child(${intakeCol}) .chk`).click();
  await page.click('.savebar [data-save]'); await sign(page, { reason: 'Covering TPS intake this week' }); await page.waitForTimeout(800);
  await shot('34_admin_users');
  await page.click('#labBtn'); await page.locator('#labMenu button', { hasText: 'CFL' }).click(); await page.waitForTimeout(500);
  await signIn(page, BASE, 'Intake Tech (demo)');
  await page.click('#labBtn');
  check('After an admin assigns TPS, the Intake Tech can switch to it', (await page.locator('#labMenu button').count()) === 2);
  await page.click('main'); await signIn(page, BASE, 'Alex Kiddle');

  // ---- Admin: matrices, and links into a filtered list
  await page.goto(BASE + '/#/admin/matrices?find=Powder'); await page.waitForSelector('#g tbody tr');
  check('Matrix link opens the Matrix list filtered to that matrix', (await page.locator('#g tbody tr').count()) === 1);
  await shot('35_admin_matrices');

  // ---- audit trail page links every entry to its record
  await nav('#/audit'); await page.waitForSelector('#g tbody tr');
  check('Audit trail entries link to their records', (await page.locator('#g tbody tr a[href^="#/"]').count()) > 10);
  // ---- audit icon on a list page
  await nav('#/clients'); await page.click('main h1 .auditbtn'); await page.waitForSelector('.modal #auditg');
  check('Audit icon on a list page shows changes to those records', (await page.locator('.modal #auditg tbody tr').count()) > 0);
  await page.click('.modal [data-x]');

  check('No native browser dialogs used', native === 0);
  check('No browser errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await b.close();
  const f = results.filter((x) => !x).length; console.log(`\nTOTAL: ${results.length - f} passed, ${f} failed`); process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
