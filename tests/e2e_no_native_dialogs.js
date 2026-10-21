// Regression: embedded browsers (like the Claude desktop browser pane) may block native confirm() dialogs.
// Navigation away from a page with unsaved edits must still work using the in-page dialog.
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn } = require('./auth');
const BASE = process.argv[2] || 'http://localhost:3000';
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  let nativeDialogs = 0;
  p.on('dialog', (d) => { nativeDialogs++; d.dismiss(); }); // behave like a browser that blocks dialogs
  await prepareUsers(BASE); await signIn(p, BASE, 'Alex Kiddle');
  await p.goto(BASE + '/#/rush'); await p.waitForSelector('#g tbody tr');
  await p.locator('#g tbody tr:nth-child(1) td:nth-child(2)').click(); await p.keyboard.type('Same Day Express'); await p.keyboard.press('Enter');
  await p.click('nav a[href="#/clients"]');
  await p.waitForSelector('.modal', { timeout: 3000 }).catch(() => {});
  const asked = await p.locator('.modal').count();
  if (asked) await p.click('.modal [data-ok]');
  await p.waitForTimeout(600);
  const h1 = (await p.locator('main h1').innerText()).trim();
  const ok1 = nativeDialogs === 0 && asked === 1 && h1 === 'Clients';
  console.log((ok1 ? 'PASS' : 'FAIL') + ' Leaving a page with unsaved edits uses the in-page dialog and navigates', JSON.stringify({ nativeDialogs, asked, h1 }));
  // and every other page navigates freely
  let ok2 = true;
  for (const h of ['#/rush', '#/catalog', '#/projects', '#/analytes', '#/contacts', '#/audit', '#/']) {
    await p.click(`nav a[href="${h}"]`); await p.waitForTimeout(400);
    if (await p.locator('.modal').count()) { ok2 = false; console.log('Unexpected dialog on', h); await p.click('.modal [data-x]'); }
  }
  // detail pages too: open each kind and navigate away without touching anything
  for (const [list, sel] of [['#/catalog', '#g a'], ['#/clients', '#g a'], ['#/projects', '#g a']]) {
    await p.click(`nav a[href="${list}"]`); await p.waitForTimeout(400);
    await p.locator(sel).first().click(); await p.waitForTimeout(600);
    await p.click('nav a[href="#/"]'); await p.waitForTimeout(400);
    if (await p.locator('.modal').count()) { ok2 = false; console.log('Unexpected unsaved-changes prompt after opening', list, 'detail'); await p.click('.modal [data-ok]'); }
  }
  console.log((ok2 ? 'PASS' : 'FAIL') + ' Navigation between all pages (and detail pages) without edits never prompts');
  // Known issue 2: every catalogue test (each pricing mode) opens clean, and an edit that is undone is not a change
  let ok3 = true;
  await p.click('nav a[href="#/catalog"]'); await p.waitForTimeout(400);
  const n = await p.locator('#g tbody tr').count();
  for (let i = 1; i <= n; i++) {
    await p.click('nav a[href="#/catalog"]'); await p.waitForTimeout(400);
    await p.locator(`#g tbody tr:nth-child(${i}) a`).first().click(); await p.waitForSelector('[data-f=base_price]');
    const name = await p.locator('main h1').innerText();
    const base = p.locator('[data-f=base_price]'); const was = await base.inputValue();
    if (i === 1) { await base.fill(String(Number(was) + 1)); await base.fill(was); }
    await p.click('nav a[href="#/"]'); await p.waitForTimeout(400);
    if (await p.locator('.modal').count()) { ok3 = false; console.log('Unexpected unsaved-changes prompt on catalogue test', name); await p.click('.modal [data-ok]'); }
  }
  console.log((ok3 ? 'PASS' : 'FAIL') + ` All ${n} catalogue tests open without false unsaved changes (edit then undo included)`);
  await b.close(); process.exit(ok1 && ok2 && ok3 ? 0 : 1);
})();
