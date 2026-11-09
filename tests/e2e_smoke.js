// Browser click-through of every screen, including fill down, paste and a full quote lifecycle.
// Run: node tests/e2e_smoke.js [baseUrl] [screenshotDir]   (needs Playwright)
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn } = require('./auth');
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens');
const fs = require('fs'); fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (label, ok, extra = '') => { results.push([label, ok]); console.log((ok ? 'PASS ' : 'FAIL ') + label + (extra ? '  ' + extra : '')); };

(async () => {
  const browser = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? undefined : undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 400/.test(m.text())) errors.push(m.text()); }); // 400s are the deliberate rule violations
  page.on('dialog', (d) => d.accept());
  await prepareUsers(BASE); await signIn(page, BASE, 'Alex Kiddle');
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  const go = async (hash) => {
    await page.goto(BASE + '/' + hash); await page.waitForTimeout(250);
    // Known issue (see CLAUDE.md): the test editor can report unsaved changes when there are none
    if (await page.locator('.modal [data-ok]', { hasText: 'Leave without saving' }).count()) await page.click('.modal [data-ok]');
    await page.waitForSelector('main h1'); await page.waitForTimeout(250);
  };
  const cell = (host, row, col) => page.locator(`${host} tbody tr:nth-child(${row}) td:nth-child(${col})`);
  const paste = (text) => page.evaluate((t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }, text);
  const reason = async (text) => { await page.waitForSelector('.modal textarea'); await page.fill('.modal textarea', text); await page.click('.modal [data-ok]'); };
  // Reads again until the condition holds (or 10 s pass), then the check judges what was read: a check waits for what it
  // checks, not a fixed time (a save's redraw can take longer than a fixed pause, e.g. on a just-started server)
  const until = async (read, ok, ms = 10000) => { const end = Date.now() + ms; for (;;) { const v = await read(); if (ok(v) || Date.now() > end) return v; await page.waitForTimeout(100); } };

  // Home
  await go('#/'); await shot('01_home');
  await page.waitForSelector('.dw'); check('Home is the dashboard: the widgets of the administrator\'s groups', await page.locator('.dw').count() >= 4);

  // Analytes: add rows by pasting from "Excel", fill down, bad CAS rejected
  await go('#/analytes');
  const before = await page.locator('#g tbody tr').count();
  await page.click('#g [data-add="1"]');
  const newRow = before + 1;
  await cell('#g', newRow, 2).click();
  await paste('Nickel Chloride\tNickel(II) chloride\tChemical\t7718-54-9\tNiCl2\tActive\nBoron\tBoron (B)\tChemical\t7440-42-8\tB\tActive\nIron\tIron (Fe)\tChemical\t7439-89-6\tFe\tActive');
  await page.waitForTimeout(200);
  check('Paste from Excel adds rows', (await page.locator('#g tbody tr').count()) === before + 3);
  // fill down: set status Retired on first new row then fill down over 3 rows
  await cell('#g', newRow, 7).click(); await page.keyboard.press('Enter');
  await page.keyboard.type('Ret'); await page.keyboard.press('Enter'); // smart dropdown: type part of the value, Enter picks the closest
  await cell('#g', newRow, 7).click(); await cell('#g', newRow + 2, 7).click({ modifiers: ['Shift'] });
  await page.keyboard.press('Control+d'); await page.waitForTimeout(150);
  const statuses = await page.locator(`#g tbody tr:nth-child(n+${newRow}) td:nth-child(7)`).allInnerTexts();
  check('Ctrl+D fills down 3 rows', statuses.slice(0, 3).every((s) => s.trim() === 'Retired'), JSON.stringify(statuses.slice(0, 3)));
  // set them back to Active via paste of one value into the range (fills the selection)
  await paste('Active'); await page.waitForTimeout(100);
  await shot('02_analytes_pasted');
  await page.click('.savebar [data-save]'); await reason('Added elements for ICP panel expansion');
  const savedToasts = await until(() => page.locator('.toast').allInnerTexts(), (t) => t.some((x) => x.includes('Saved 3')));
  check('Analytes saved', savedToasts.some((t) => t.includes('Saved 3')), savedToasts.join(' | '));
  // bad CAS
  await go('#/analytes');
  const nrows = await page.locator('#g tbody tr').count();
  await page.click('#g [data-add="1"]'); await cell('#g', nrows + 1, 2).click();
  await paste('Fakeium\t\tChemical\t1234-56-7'); await page.click('.savebar [data-save]'); await reason('test');
  const toasts = await until(async () => (await page.locator('.toast.err').allInnerTexts()).join(' '), (t) => /CAS Number is not valid/.test(t));
  check('Invalid CAS rejected by database', /CAS Number is not valid/.test(toasts), toasts);
  await shot('03_analytes_bad_cas');
  await page.click('.savebar [data-undo]');

  // Clients list and On Hold behaviour
  await go('#/clients'); await shot('04_clients');
  await page.locator('#g a', { hasText: 'CL-00003' }).click(); await page.waitForSelector('.rulechips');
  const chips = await page.locator('.rulechips .chip').allInnerTexts();
  check('On Hold client: can order, cannot release', chips[0].includes('✓') && chips[1].includes('✕'), JSON.stringify(chips));
  await shot('05_client_on_hold');
  // Acme Irvine: contact roles grid, try a second Primary
  await go('#/clients');
  await page.locator('#g a', { hasText: 'CL-00005' }).click(); await page.waitForSelector('#cg tbody tr');
  await shot('06_client_acme_irvine');
  const rowsC = await page.locator('#cg tbody tr').count();
  // find Maria's row and tick Primary (col 4: Code, Contact, Email, Primary)
  const names = await page.locator('#cg tbody tr td:nth-child(2)').allInnerTexts();
  const mi = names.findIndex((n) => n.includes('Maria')) + 1;
  await cell('#cg', mi, 4).locator('.chk').click();
  await page.click('#cg .savebar [data-save]'); await reason('Testing primary rule');
  const t2 = await until(async () => (await page.locator('.toast.err').allInnerTexts()).join(' '), (t) => /already has an active PRIMARY|both Primary and Secondary/.test(t));
  check('Second Primary contact rejected (Maria is already Secondary here)', /already has an active PRIMARY|both Primary and Secondary/.test(t2), t2.slice(-90));
  await page.click('#cg .savebar [data-undo]');
  check('Orderable tests listed for Acme Irvine', (await until(() => page.locator('#og tbody tr').count(), (n) => n >= 3)) >= 3);
  void rowsC;

  // Catalogue and designer step 1
  await go('#/catalog'); await shot('07_catalog');
  await page.locator('#g a', { hasText: 'T-00001' }).click(); await page.waitForSelector('#lp');
  const lp0 = await page.locator('#lp').innerText();
  check('Heavy metals list price shown ($275 + new analytes none)', lp0.includes('$275.00'), lp0);
  // set all analyte prices to 25 with fill down
  await cell('#ag', 1, 3).click(); await page.keyboard.type('25'); await page.keyboard.press('Enter');
  const an = await page.locator('#ag tbody tr').count();
  await cell('#ag', 1, 3).click(); await cell('#ag', an, 3).click({ modifiers: ['Shift'] }); await page.keyboard.press('Control+d');
  const lp1 = await until(() => page.locator('#lp').innerText(), (t) => t.includes('$325.00'));
  check('Fill down analyte prices updates list price live ($325)', lp1.includes('$325.00'), lp1);
  await shot('08_designer_step1');
  await page.click('#save'); await reason('Annual price update for ICP-MS');
  const savedToast = await until(() => page.locator('.toast').allInnerTexts(), (t) => t.some((x) => /saved/i.test(x)));
  check('Catalogue saved', savedToast.some((x) => /saved/i.test(x)) && (await page.locator('#lp').innerText()).includes('$325.00'), savedToast.join(' | '));

  // Projects: open Acme quote, start new version, trim analytes, check discount kept
  await go('#/projects'); await shot('09_projects');
  await page.locator('#g a', { hasText: 'PRJ-00001' }).click(); await page.waitForSelector('#nv');
  await page.click('#nv'); await page.waitForSelector('#lg tbody tr');
  await page.waitForTimeout(300);
  await shot('10_quote_v2_draft');
  const metalsRow = (await page.locator('#lg tbody tr td:nth-child(2)').allInnerTexts()).findIndex((t) => t.includes('Heavy Metals')) + 1;
  const pctBefore = (await cell('#lg', metalsRow, 9).innerText()).trim();
  await cell('#lg', metalsRow, 4).locator('button').click(); await page.waitForSelector('.modal #ag tbody tr');
  // untick first two included analytes via Space on a 2-row selection
  const inclBefore = (await page.locator('.modal #ag tbody .chk.on').count());
  // select the Included cells of rows 2-3 (Arsenic, Cadmium) (click the cell edge, not the box) and press Space to toggle both
  await page.locator('.modal #ag tbody tr:nth-child(2) td:nth-child(1)').click({ position: { x: 60, y: 10 } });
  await page.locator('.modal #ag tbody tr:nth-child(3) td:nth-child(1)').click({ position: { x: 60, y: 10 }, modifiers: ['Shift'] });
  await page.keyboard.press(' ');
  const inclAfter = (await page.locator('.modal #ag tbody .chk.on').count());
  check('Space toggles a block of checkboxes', Math.abs(inclBefore - inclAfter) === 2, `${inclBefore} -> ${inclAfter}`);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, '11_analyte_trim.png') });
  await page.click('.modal [data-ok]');
  const btnAfter = (await until(() => cell('#lg', metalsRow, 4).innerText(), (t) => t.trim() !== '7 of 10')).trim();
  const pctAfter = (await cell('#lg', metalsRow, 9).innerText()).trim();
  check('Analyte trim keeps discount % and changes the analyte count', pctBefore === pctAfter && btnAfter !== '7 of 10', `${pctBefore} -> ${pctAfter}, ${btnAfter}`);
  // type a final price above list to see the check flag live
  const mo = (await page.locator('#lg tbody tr td:nth-child(2)').allInnerTexts()).findIndex((t) => t.includes('Moisture')) + 1;
  await cell('#lg', mo, 7).click(); await page.keyboard.type('99'); await page.keyboard.press('Enter');
  const flag = (await until(() => cell('#lg', mo, 13).innerText(), (t) => t.trim() === 'Above list price')).trim();
  check('Live check flags price above list', flag === 'Above list price', flag);
  await shot('12_quote_flag');
  await page.click('#lundo'); await page.waitForTimeout(400);
  // issue and accept
  const badge = () => page.locator('.phead .badge').first().innerText();
  await page.click('[data-act="Quoted"]'); await page.waitForSelector('.modal'); await page.click('.modal [data-ok]');
  check('Quote issued', (await until(badge, (t) => t.includes('Quoted'))).includes('Quoted'));
  await page.click('[data-act="Accepted"]'); await page.waitForSelector('.modal select');
  await page.selectOption('.modal select', { index: 1 }); await page.click('.modal [data-ok]');
  check('Quote accepted', (await until(badge, (t) => t.includes('Accepted'))).includes('Accepted'));
  await shot('13_quote_accepted');
  const vid = page.url().split('/').pop();
  await go('#/print/' + vid); await page.waitForSelector('.quote'); await shot('14_quote_print');
  check('Printable quote lists rush options', (await page.locator('.quote h2').allInnerTexts()).some((t) => t.includes('Rush')));

  // Rush schedules and audit trail
  await go('#/rush'); await shot('15_rush');
  await go('#/audit'); await shot('16_audit');
  const auditText = await until(() => page.locator('#g tbody').innerText(), (t) => t.includes('Annual price update for ICP-MS'));
  check('Audit trail shows reasons', auditText.includes('Annual price update for ICP-MS'));

  check('No browser errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r[1]).length;
  console.log(`\nTOTAL: ${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
