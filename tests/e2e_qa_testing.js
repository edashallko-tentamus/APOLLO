// Migration 040 (0.22.0): QA testing of inventory before use, for any item. QA ticks Reagent on Inventory > QA testing
// (a reason asked); the analyst's new reagent arrives with "Send for QA testing" ticked and locked; the lot waits (list
// filter, lot page); Send for QA testing (released for every use); its test sample with the lot's ID in the backlog, the
// bench marking an unreleased lot NOT RELEASED; QA's approval releases it for every use; QA waives the testing of another
// lot (signed, with a reason); a third lot fails, is Rejected, and goes for a Retest. Run on a freshly reset database.
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, sign, login, call } = require('./auth');
const PASSWORD = require('./test-credentials.json').password;
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (l, ok, x = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };
const GP = 'Media Growth Promotion (USP <61>/<62>)';

async function as(who) {
  const cookie = await login(BASE, who, PASSWORD);
  const users = (await call(BASE, '/users', { cookie })).data;
  const site = users.find((u) => u.username === who).sites.find((s) => s.site_code === 'CFL').id;
  return async (p, body, signed, method) => {
    const res = await fetch(BASE + '/api' + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-site-id': site },
      body: body ? JSON.stringify({ ...body, ...(signed ? { signature: { username: who, password: PASSWORD } } : {}) }) : undefined });
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
  const pasteAt = async (loc, text) => {
    await loc.click();
    await page.evaluate((t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }, text);
    await page.waitForTimeout(300);
  };
  const colIndex = (sel, title) => page.evaluate(([s, t]) => [...document.querySelectorAll(s + ' thead th')].findIndex((th) => th.textContent.trim().startsWith(t)), [sel, title]);
  const qa = await as('qa.reviewer'); const ana = await as('analyst');

  // ---- 1. QA: Inventory > QA testing, Reagent ticked (a reason asked)
  await signIn(page, BASE, 'QA Reviewer (demo)', '#/inventory/qa-testing'); await page.waitForSelector('#g tbody tr'); await page.waitForTimeout(500);
  const d0 = await qa('/inventory/qa-defaults');
  check('Inventory > QA testing: every item type listed; Media is tested before use, the others are not; QA may change them',
    d0.rows.length === 7 && d0.rows.every((r) => r.required === (r.chemical_type === 'Media')) && d0.can_edit && (await page.locator('.invtabs a.on').innerText()) === 'QA testing');
  const ci = await colIndex('#g', 'Tested before use');
  await pasteAt(page.locator('#g tbody tr', { hasText: 'Reagent' }).locator('td').nth(ci), 'Yes\tIncoming reagents: identity before use (QA SOP)');
  await page.click('#g [data-save]'); await sign(page, { reason: 'Reagents are tested before use (QA decision)' }); await page.waitForTimeout(900);
  const d1 = await qa('/inventory/qa-defaults');
  const audit = (await call(BASE, '/audit/scope?kind=qa_testing', { cookie: await login(BASE, 'qa.reviewer', PASSWORD) })).data;
  check('Saved with a reason: Reagent is now tested before use at CFL, and the change is in the audit trail',
    d1.rows.find((r) => r.chemical_type === 'Reagent').required && /Saved 1 row/.test(await toasts())
    && Array.isArray(audit) && audit.some((a) => /Reagents are tested before use/.test(a.reason || '')), await toasts());
  await shot('300_qa_testing_defaults');

  // ---- 2. The analyst receives a reagent: the box is ticked and locked; the lot waits
  await signIn(page, BASE, 'Analyst (demo)', '#/inventory/new'); await page.waitForSelector('#f_types');
  await page.fill('#f_item_name', 'Sodium chloride ACS (QA demo)');
  await page.locator('#f_types input[value="Reagent"]').check(); await page.waitForTimeout(200);
  check('New item: ticking Reagent ticks "Send for QA testing before use" and locks it (only QA receives it without testing)',
    await page.locator('#f_qa').isChecked() && await page.locator('#f_qa').isDisabled() && /Only QA can receive it without testing/.test(await page.locator('#qahelp').innerText()));
  await page.locator('#f_types input[value="Reagent"]').uncheck(); await page.locator('#f_types input[value="Solvent"]').check(); await page.waitForTimeout(200);
  check('As a Solvent it is not required (and can be ticked by hand)', !(await page.locator('#f_qa').isChecked()) && !(await page.locator('#f_qa').isDisabled()));
  await page.locator('#f_types input[value="Solvent"]').uncheck(); await page.locator('#f_types input[value="Reagent"]').check();
  await page.fill('#f_manufacturer_lot', 'NACL-QA-01'); await page.fill('#f_quantity_received', '1');
  await page.evaluate(() => { const s = document.querySelector('#f_unit'); s.value = 'kg'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#save'); await sign(page); await page.waitForSelector('.mqbox'); await page.waitForTimeout(500);
  const lotUrl = page.url(); const lotId = lotUrl.split('/').pop();
  check('Saved: the lot page says QA testing: Awaiting QA testing, with Send for QA testing (no waiver for an analyst)',
    /QA testing: Awaiting QA testing/.test(await page.locator('.mqbox').innerText()) && /Your lab tests this type of item before use/.test(await page.locator('.mqbox').innerText())
    && (await page.locator('[data-act="qualify"]').innerText()) === 'Send for QA testing…' && (await page.locator('[data-act="waiveqa"]').count()) === 0);
  await shot('301_lot_awaiting_qa');
  // a solvent ticked for QA testing at receipt, and another reagent (through the API)
  const solvent = await ana('/inventory/items', { row: { item_name: 'Methanol HPLC (QA demo)', chemical_types: ['Solvent'], manufacturer_lot: 'MEOH-QA-01', quantity_received: 4, unit: 'L' }, qa_testing: '1' }, true);
  const reagent2 = await ana('/inventory/items', { row: { item_name: 'Sodium chloride ACS (QA demo, second lot)', chemical_types: ['Reagent'], manufacturer_lot: 'NACL-QA-02', quantity_received: 1, unit: 'kg' } }, true);
  await go('#/inventory?show=qa'); await page.waitForSelector('#g tbody tr');
  const listTxt = await page.locator('#g').innerText();
  check('The inventory list\'s "QA testing" filter shows the three new lots waiting (and the demo media lot), with a QA testing column',
    /NACL-QA-01/.test(listTxt) && /MEOH-QA-01/.test(listTxt) && /NACL-QA-02/.test(listTxt) && (listTxt.match(/Awaiting QA testing/g) || []).length >= 3 && !/NACL-QA-02[^\n]*Released/.test(listTxt), listTxt.slice(0, 300).replace(/\s+/g, ' '));

  // ---- 3. Send for QA testing, released for every use
  await go('#/inventory/lots/' + lotId); await page.click('[data-act="qualify"]'); await page.waitForSelector('.modal #dg tbody tr');
  await pasteAt(page.locator('.modal #dg tbody tr:nth-child(1) td').nth(0), `Every use\t${GP}`);
  await page.locator('.modal [data-ok]').last().click(); await page.waitForTimeout(1500);
  const lot1 = (await ana('/inventory/lots/' + lotId)).lot;
  check('Sent for QA testing: its test sample (the lot\'s ID) is in the backlog; the lot is In QA testing',
    /Sent for QA testing: test sample INV-/.test(await toasts()) && lot1.qa_status === 'In QA testing' && /In QA testing/.test(await page.locator('.mqbox').innerText()), await toasts());
  await ana(`/inventory/lots/${reagent2.id}/qualify`, { items: [{ use_test_id: null, qualification_test_id: (await ana(`/inventory/lots/${reagent2.id}/qualify-options`)).tests.find((t) => t.test_name === GP).id }] });
  await go('#/testing'); await page.waitForSelector('.tbgroup');
  const grp = page.locator('.tbgroup', { hasText: GP }); const gtext = await grp.innerText();
  check('The backlog lists both lot samples under the QA test, marked "Lot QA testing"', gtext.includes(lot1.lot_code) && (gtext.match(/Lot QA testing/g) || []).length >= 2);

  // ---- 4. The QA batch (through the API): the first lot grows, the second fails one organism
  const bl = await ana('/testing/backlog');
  const items = bl.rows.filter((x) => x.test_name === GP && x.is_media);
  const batch = await ana('/testing/batches', { test_version_id: items[0].test_version_id, items: items.map((x) => ({ requested_test_id: x.requested_test_id })) });
  let bd = await ana('/testing/batches/' + batch.id);
  const run = (k) => bd.steps.find((s) => s.step_key === k).id;
  const opts = await ana(`/testing/batches/${batch.id}/options`);
  const sol = opts.lots.find((l) => l.id === solvent.id);
  check('At the bench, a lot still waiting for QA testing (the solvent) is marked NOT RELEASED; the batch\'s own lots are not',
    sol && /waiting for QA testing/.test(sol.not_qualified || '') && !opts.lots.find((l) => l.id === lotId).not_qualified, JSON.stringify(sol && sol.not_qualified));
  await ana(`/testing/step-runs/${run('batch')}/complete`, {}, true); bd = await ana('/testing/batches/' + batch.id);
  const rows = [];
  for (const e of bd.entries.filter((x) => x.entry_type === 'Sample')) {
    for (const a of bd.analytes) rows.push({ entry_id: e.id, analyte_id: a.analyte_id, run_no: 1, value_text: e.label === (await ana('/inventory/lots/' + reagent2.id)).lot.lot_code && a.analyte_name === 'Candida albicans' ? 'No growth' : 'Growth' });
  }
  await ana(`/testing/step-runs/${run('read')}/values`, { rows });
  await ana(`/testing/step-runs/${run('read')}/complete`, {}, true); bd = await ana('/testing/batches/' + batch.id);
  for (const m of bd.review_marks.filter((x) => !x.mark_id)) await qa(`/testing/batches/${batch.id}/steps/${m.step_run_id}/review-mark`, {});
  await qa(`/testing/batches/${batch.id}/approve`, {}, true);
  await signIn(page, BASE, 'Analyst (demo)', '#/inventory/lots/' + lotId); await page.waitForSelector('.mqbox'); await page.waitForTimeout(500);
  const box1 = await page.locator('.mqbox').innerText();
  check('QA\'s approval releases the first lot for every use (the record: Every use, the QA test, Passed, the batch)',
    /QA testing: Released for every use/.test(box1) && /Every use/.test(box1) && /Passed/.test(box1) && box1.includes(bd.batch.batch_code), box1.slice(0, 300));
  await shot('302_lot_released');

  // ---- 5. Rejected, then a retest
  await go('#/inventory/lots/' + reagent2.id); await page.waitForSelector('.mqbox');
  const box2 = await page.locator('.mqbox').innerText();
  check('The second lot is Rejected for every use, with the reason; its page offers a Retest (and Dispose)',
    /QA testing: Rejected/.test(box2) && /Candida albicans No growth did not conform/.test(box2) && (await page.locator('[data-act="qualify"]').innerText()) === 'Retest…'
    && (await page.locator('[data-act="dispose"]').count()) === 1);
  await page.click('[data-act="qualify"]'); await page.waitForSelector('.modal #dg tbody tr');
  check('The dialog says it is the retest', /Retest: INV-/.test(await page.locator('.modal h3').innerText()));
  await pasteAt(page.locator('.modal #dg tbody tr:nth-child(1) td').nth(0), `Every use\t${GP}`);
  await page.locator('.modal [data-ok]').last().click(); await page.waitForTimeout(1500);
  check('Sent for its retest: the lot stays rejected while the retest runs', /Rejected, retest under way/.test(await page.locator('.mqbox').innerText()));
  await shot('303_lot_retest');

  // ---- 6. QA waives the testing of the solvent (signed, with a reason)
  await signIn(page, BASE, 'QA Reviewer (demo)', '#/inventory/lots/' + solvent.id); await page.waitForSelector('[data-act="waiveqa"]');
  await page.click('[data-act="waiveqa"]'); await sign(page, { reason: 'Supplier COA reviewed: meets the specification' }); await page.waitForTimeout(1200);
  const s2 = (await qa('/inventory/lots/' + solvent.id)).lot;
  check('QA waived it: the lot needs no QA testing now (no QA testing box)', s2.qa_status === null && (await page.locator('.mqbox').count()) === 0);

  // ---- 7. The QA testing page lists what waits; audit icon; no errors
  await go('#/inventory/qa-testing'); await page.waitForSelector('#lg tbody tr');
  const lgt = await page.locator('#lg').innerText();
  check('Inventory > QA testing lists the lot whose retest is under way, not the released or waived ones',
    /NACL-QA-02/.test(lgt) && /retest under way/.test(lgt) && !/NACL-QA-01/.test(lgt) && !/MEOH-QA-01/.test(lgt));
  check('The page has its audit-trail icon', (await page.locator('main h1 .auditbtn').count()) === 1);
  check('No page errors, no native dialogs', errors.length === 0 && native === 0, errors.join(' | '));
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
