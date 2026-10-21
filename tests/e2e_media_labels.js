// Migration 023 (Alex's notes of 2026-10-13): the "+ In-house mixture" button beside "+ New Inventory Item"; a new item
// saved with its Supplier COA and web link; media qualification end to end (Qualify media on two new media lots, their
// test samples with the lots' IDs in the backlog, a batch made, a sample added by right-click, removed and added back on
// the Batching tab without a signature, the readings, QA's approval releasing one lot and failing the other); barcode
// labels (Code 128 decoded back from the preview) for a lot, a sample, equipment and a batch; Purchasing: a web link,
// an "Other" purchase received into inventory with its actual price. Run on a freshly reset database (after the others).
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, sign } = require('./auth');
const PASSWORD = require('./test-credentials.json').password;
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (l, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

// Code 128 read back from the bars of a preview barcode (independent of the page's encoder, except the symbol table)
const P = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 '
  + '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 '
  + '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 '
  + '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 '
  + '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 '
  + '114131 311141 411131 211412 211214 211232').split(' ');
function decode128(rects) {   // rects: [[x, width], ...] of the bars, in modules
  rects.sort((a, b) => a[0] - b[0]);
  const runs = []; for (let i = 0; i < rects.length; i++) { runs.push(rects[i][1]); if (i < rects.length - 1) runs.push(rects[i + 1][0] - rects[i][0] - rects[i][1]); }
  const vals = []; let i = 0;
  while (i + 6 <= runs.length) { const p = runs.slice(i, i + 6).join(''); if (runs.length - i === 7) break; const v = P.indexOf(p); if (v < 0) return { error: 'bad symbol ' + p }; vals.push(v); i += 6; }
  if (runs.slice(i).join('') !== '2331112') return { error: 'no stop' };
  let sum = vals[0]; for (let k = 1; k < vals.length - 1; k++) sum += vals[k] * k;
  if (sum % 103 !== vals[vals.length - 1]) return { error: 'checksum' };
  let set = vals[0] === 105 ? 'C' : 'B'; let out = '';
  for (const v of vals.slice(1, -1)) {
    if (set === 'B') { if (v === 99) set = 'C'; else out += String.fromCharCode(v + 32); } else if (v === 100) set = 'B'; else out += String(v).padStart(2, '0');
  }
  return { text: out };
}

(async () => {
  await prepareUsers(BASE);
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[0-3]/.test(m.text())) errors.push(m.text()); });
  let native = 0; page.on('dialog', (d) => { native++; d.dismiss(); });
  page.on('popup', (p) => p.close().catch(() => {}));
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  const go = async (h) => { await page.goto(BASE + '/' + h); await page.waitForSelector('main h1'); await page.waitForTimeout(700); };
  const toasts = async () => (await page.locator('.toast').allInnerTexts()).join(' | ');
  const pasteAt = async (loc, text) => {
    await loc.click();
    await page.evaluate((t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }, text);
    await page.waitForTimeout(300);
  };
  const apiAs = async (who, p, method = 'GET', body) => {
    const lr = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: who, password: PASSWORD }) });
    const cookie = lr.headers.get('set-cookie').split(';')[0];
    const users = await (await fetch(BASE + '/api/users', { headers: { Cookie: cookie } })).json();
    const site = users.find((u) => u.username === who).sites.find((s) => s.site_code === 'CFL').id;
    const res = await fetch(BASE + '/api' + p, { method, headers: { Cookie: cookie, 'x-site-id': site, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json(); if (!res.ok) throw new Error(`${p}: ${data.error}`); return data;
  };
  const complete = async () => {
    await page.click('[data-a="complete"]'); await page.waitForSelector('.sigmodal #c_pass'); await page.fill('.sigmodal #c_pass', PASSWORD);
    await page.click('.sigmodal [data-ok]'); await page.waitForSelector('.sigmodal', { state: 'detached', timeout: 15000 }); await page.waitForTimeout(900);
  };
  const approveAll = async (sel) => {
    for (let i = 0; i < 20; i++) {
      const btn = page.locator(sel + ' button', { hasText: 'Approve step' }); const n = await btn.count(); if (!n) break;
      await Promise.all([page.waitForResponse((res) => res.url().includes('/review-mark')), btn.first().click()]);
      await page.waitForFunction(([s, m]) => document.querySelectorAll(s + ' button').length && [...document.querySelectorAll(s + ' button')].filter((x) => x.textContent === 'Approve step').length < m, [sel, n], { timeout: 15000 });   // (the panel is empty while it reloads: as in e2e_testing and e2e_wd5)
      await page.waitForTimeout(300);
    }
  };
  const barcodes = async () => page.evaluate(() => [...document.querySelectorAll('.lblprev svg.bc')].map((s) => ({ code: s.dataset.code,
    rects: [...s.querySelectorAll('rect')].map((r) => [Number(r.getAttribute('x')), Number(r.getAttribute('width'))]) })));
  const closeModal = async () => { await page.locator('.modal [data-x]').last().click(); await page.waitForTimeout(300); };

  // ---- Inventory: the two "+" buttons together; a new media item saved with its COA and web link
  await signIn(page, BASE, 'Analyst (demo)', '#/inventory'); await page.waitForSelector('#g tbody tr');
  const btns = await page.evaluate(() => { const n = document.querySelector('#newitem'); const m = document.querySelector('#mix'); return { same: n.parentElement === m.parentElement && n.nextElementSibling === m, cls: n.className === m.className }; });
  check('"+ In-house mixture" sits beside "+ New Inventory Item", in the same colour', btns.same && btns.cls);
  await go('#/inventory/new'); await page.waitForSelector('#f_coa');
  check('The New Inventory Item form has a web link and a Supplier COA section (reading switched off: says why)',
    (await page.locator('#f_item_url').count()) === 1 && /switched off in this Sandbox until IT and QA approve it/.test(await page.locator('.coanew').innerText()));
  await page.fill('#f_item_name', 'Tryptic soy agar plates (second supplier)');
  await page.locator('#f_types label', { hasText: 'Media' }).locator('input').check();
  await page.fill('#f_manufacturer_lot', 'BD-TSA-77'); await page.fill('#f_quantity_received', '20'); await page.locator('#f_unit').selectOption('each');
  await page.fill('#f_container_count', '2'); await page.fill('#f_expiration_date', new Date(Date.now() + 50 * 864e5).toISOString().slice(0, 10));
  await page.fill('#f_item_url', 'https://example.com/bd-tsa');
  await page.setInputFiles('#f_coa', { name: 'COA-BD-TSA-77.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.waitForFunction(() => /will be attached/.test(document.querySelector('#coamsg').textContent));
  await page.click('#save'); await sign(page); await page.waitForSelector('main .statcards'); await page.waitForTimeout(600);
  const newLotUrl = page.url(); const newLot = (await page.locator('.eyebrow').innerText()).match(/INV-\d{6}/)[0];
  const lotText = await page.locator('main').innerText();
  check('Saved with its COA (on the item, values confirmed from the form) and web link; as new media it awaits qualification',
    /COA-BD-TSA-77\.pdf/.test(await page.locator('#coag').innerText()) && /BD-TSA-77/.test(await page.locator('#coag').innerText())
    && /example\.com\/bd-tsa/.test(lotText) && /QA testing: Awaiting QA testing/.test(lotText));

  // ---- Qualify both new media lots (the demo plates and this one) for USP <62>, by growth promotion
  const lots = await apiAs('analyst', '/inventory/lots');
  const demoLot = lots.find((x) => x.manufacturer_lot === 'HAR-TSA-2610');
  const qualify = async (url) => {
    await page.goto(url); await page.waitForSelector('[data-act="qualify"]'); await page.click('[data-act="qualify"]'); await page.waitForSelector('.modal #dg tbody tr');
    await pasteAt(page.locator('.modal #dg tbody tr:nth-child(1) td').nth(0), 'USP <62> Specified Microorganisms\tMedia Growth Promotion (USP <61>/<62>)');
    await page.locator('.modal [data-ok]').last().click(); await page.waitForTimeout(1200);
  };
  await qualify(BASE + '/#/inventory/lots/' + demoLot.id);
  check('Qualify media: started; the lot\'s test sample (its own ID) is in the backlog; the lot shows Being qualified',
    new RegExp(`Sent for QA testing: test sample ${demoLot.lot_code}`).test(await toasts()) && /QA testing: In QA testing/.test(await page.locator('main').innerText()), await toasts());
  await shot('120_media_being_qualified');
  await qualify(newLotUrl);

  // ---- The backlog: both test samples, marked Media qualification; a batch of one; the other added by right-click
  await go('#/testing'); await page.waitForSelector('.tbgroup');
  const grp = page.locator('.tbgroup', { hasText: 'Media Growth Promotion' });
  const gtext = await grp.innerText();
  check('Backlog: two media qualification samples with the lots\' IDs (Kind: Media qualification)',
    (await grp.locator('tbody tr').count()) === 2 && gtext.includes(demoLot.lot_code) && gtext.includes(newLot) && (gtext.match(/Lot QA testing/g) || []).length >= 2);
  await grp.locator('tbody tr', { hasText: demoLot.lot_code }).locator('td').nth(2).click();
  await grp.locator('[data-sel]').click();
  await page.waitForSelector('#g tr.tbmade', { timeout: 15000 });
  const batchCode = (await page.locator('#g tr.tbmade').innerText()).match(/BAT-\d{6}/)[0];
  await go('#/testing'); await page.waitForSelector('.tbgroup');
  const row2 = page.locator('.tbgroup', { hasText: 'Media Growth Promotion' }).locator('tbody tr', { hasText: newLot });
  await row2.locator('td').nth(2).click(); await row2.locator('td').nth(2).click({ button: 'right' });
  await page.waitForSelector('.tbmenu'); await page.locator('.tbmenu button', { hasText: 'to a batch' }).click();
  await page.waitForSelector('.modal #f_batch_id'); await page.locator('.modal [data-ok]').last().click(); await page.waitForTimeout(1200);
  check('Right-click "Add to a batch…": added to the open batch, no signature asked', new RegExp(`Added to ${batchCode}`).test(await toasts()) && native === 0, await toasts());

  // ---- In the batch: remove one on the Batching tab, then add it back (no signature)
  const bl = await apiAs('analyst', '/testing/batches?show=open');
  const batch = bl.rows.find((x) => x.batch_code === batchCode);
  await go(`#/testing/batches/${batch.id}?step=batch`); await page.waitForSelector('#body tbody tr');
  check('The Batching tab lists both media samples and offers Add samples / Remove selected samples',
    (await page.locator('#body tbody tr').count()) === 2 && (await page.locator('[data-a="addsamples"]').count()) === 1 && /Lot QA testing/.test(await page.locator('#body').innerText()));
  await page.locator('#body tbody tr', { hasText: newLot }).locator('td').nth(2).click();
  await page.click('[data-a="rmsamples"]'); await page.waitForSelector('.modal [data-ok]'); await page.locator('.modal [data-ok]').last().click(); await page.waitForTimeout(1200);
  check('Removed: the batch has one sample; the other is back in the backlog (Add samples shows 1 waiting)',
    (await page.locator('#body tbody tr').count()) === 1 && /1 waiting/.test(await page.locator('[data-a="addsamples"]').innerText()));
  await page.click('[data-a="addsamples"]'); await page.waitForSelector('.modal .addlist input');
  await page.locator('.modal .addlist input').first().check(); await page.locator('.modal [data-ok]').last().click(); await page.waitForTimeout(1200);
  check('Added back from the Batching tab: two samples again', (await page.locator('#body tbody tr').count()) === 2 && /added to/.test(await toasts()));
  await shot('121_batching_add_remove');

  // ---- Bench: Batching completed; readings (the demo lot grows; the new lot fails one organism); read completed
  await complete();
  const bd = await apiAs('analyst', '/testing/batches/' + batch.id);
  const readRun = bd.steps.find((s) => s.step_key === 'read').id;
  const rows = [];
  for (const e of bd.entries.filter((x) => x.entry_type === 'Sample')) {
    for (const a of bd.analytes) rows.push({ entry_id: e.id, analyte_id: a.analyte_id, run_no: 1, value_text: e.label === newLot && a.analyte_name === 'Candida albicans' ? 'No growth' : 'Growth' });
  }
  await apiAs('analyst', `/testing/step-runs/${readRun}/values`, 'POST', { rows });
  await go(`#/testing/batches/${batch.id}?step=read`); await page.waitForSelector('[data-a="complete"]');
  await complete();
  check('The readings recorded and the step completed: the batch waits for QC Review', /Awaiting Review/.test(await page.locator('main .sub').innerText()));

  // ---- QA's review: each step approved, then the batch (signed): the lots are decided
  await signIn(page, BASE, 'Lab Supervisor (demo)', `#/testing/batches/${batch.id}?step=review`); await page.waitForSelector('#rv_steps'); await page.waitForTimeout(800);
  await approveAll('#rv_steps');
  await page.click('#rv_ok'); await sign(page); await page.waitForTimeout(1500);
  await page.goto(BASE + '/#/inventory/lots/' + demoLot.id); await page.waitForSelector('.mqbox'); await page.waitForTimeout(500);
  const q1 = await page.locator('.mqbox').innerText();
  check('Approved: the demo plates are Qualified, released for USP <62> only (Passed, with the batch)', /QA testing: Released for named tests/.test(q1) && /USP <62> Specified Microorganisms/.test(q1) && /Passed/.test(q1) && q1.includes(batchCode));
  await shot('122_media_qualified');
  await page.goto(newLotUrl); await page.waitForSelector('.mqbox'); await page.waitForTimeout(500);
  const q2 = await page.locator('.mqbox').innerText();
  check('The lot that did not grow C. albicans failed: not released, with the reason', /QA testing: Rejected/.test(q2) && /Candida albicans No growth did not conform/.test(q2));

  // ---- Labels: lot (one per container), sample (tests and due dates), equipment (calibration expiry), batch (one per entry)
  await page.goto(BASE + '/#/inventory/lots/' + demoLot.id); await page.waitForSelector('[data-act="labels"]'); await page.click('[data-act="labels"]');
  await page.waitForSelector('.lblprev .lbl'); await page.waitForTimeout(300);
  const lb = await barcodes(); const dec = decode128(lb[0].rects);
  check('Lot label: one per container (4), 1 x 2 1/8 in., the Code 128 barcode reads back the lot ID, with name and expiry',
    lb.length === 4 && dec.text === demoLot.lot_code && /4 labels/.test(await page.locator('#lb_count').innerText()) && /Exp \d{4}-\d{2}-\d{2}/.test(await page.locator('.lblprev .lbl').first().innerText())
    && (await page.locator('.lblprev .lbl.small').count()) === 4, JSON.stringify(dec));
  await shot('123_lot_label'); await closeModal();
  const sampleId = bd.entries.find((x) => x.label === demoLot.lot_code).sample_id;
  await go('#/samples/' + sampleId); await page.click('#labels'); await page.waitForSelector('.lblprev .lbl.big'); await page.waitForTimeout(300);
  const sb = await barcodes(); const sl = await page.locator('.lblprev .lbl.big').first().innerText();
  check('Sample label: 2 1/8 x 4 in., barcode reads back the sample ID, lists its test and due date',
    decode128(sb[0].rects).text === demoLot.lot_code && /Media Growth Promotion/.test(sl) && /Due \d{4}-\d{2}-\d{2}/.test(sl));
  await shot('124_sample_label'); await closeModal();
  await go('#/equipment'); await page.waitForSelector('#g tbody tr'); await page.locator('#g tbody tr a', { hasText: /^EQ-/ }).first().click(); await page.waitForSelector('#eqlabel');
  await page.click('#eqlabel'); await page.waitForSelector('.lblprev .lbl.small');
  const eb = await barcodes();
  check('Equipment label: ID barcode, name, calibration expiry', /^EQ-/.test(decode128(eb[0].rects).text || '') && /Cal exp|No calibration/.test(await page.locator('.lblprev .lbl').first().innerText()));
  await closeModal();
  await go(`#/testing/batches/${batch.id}`); await page.click('#labelsb'); await page.waitForSelector('.lblprev .lbl');
  const nb = await page.locator('.lblprev .lbl').count();
  await page.locator('.modal #lb_mode').selectOption('batch'); await page.waitForTimeout(300);
  check('Batch labels: one per entry by default (2), or one for the batch', nb === 2 && (await page.locator('.lblprev .lbl').count()) === 1 && decode128((await barcodes())[0].rects).text === batchCode);
  await closeModal();

  // ---- Purchasing: a web link on a request; an "Other" purchase received into inventory, with its actual price
  await signIn(page, BASE, 'Analyst (demo)', '#/purchasing'); await page.click('#new'); await page.waitForSelector('.modal #f_item_url');
  await page.locator('.modal #f_line_type').selectOption('Other'); await page.fill('.modal #f_description', 'Sterile sampling spoons (box of 100)');
  await page.locator('.modal #f_supplier_id').selectOption({ label: 'Northbridge Scientific Supply' }); await page.fill('.modal #f_item_url', 'https://example.com/spoons');
  await page.fill('.modal #f_quantity', '2'); await page.fill('.modal #f_unit', 'box'); await page.fill('.modal #f_unit_price', '40');
  await page.locator('.modal [data-ok]').last().click(); await sign(page); await page.waitForSelector('main .statcards'); await page.waitForTimeout(400);
  const reqUrl = page.url();
  check('A request keeps its web link', /example\.com\/spoons/.test(await page.locator('main').innerText()));
  await signIn(page, BASE, 'Lab Supervisor (demo)'); await page.goto(reqUrl); await page.waitForSelector('[data-act="approve"]');
  await page.click('[data-act="approve"]'); await sign(page); await page.waitForTimeout(900);
  await page.click('[data-act="order"]'); await page.waitForSelector('.modal #f_external_po_number'); await page.fill('.modal #f_external_po_number', 'FIN-2026-0123');
  await page.locator('.modal [data-ok]').last().click(); await sign(page); await page.waitForTimeout(900);
  await signIn(page, BASE, 'Analyst (demo)'); await page.goto(reqUrl); await page.waitForSelector('[data-act="receive"]');
  await page.click('[data-act="receive"]'); await page.waitForSelector('.modal #f_into_inventory');
  check('Receiving an "Other" purchase offers to put it into inventory (ticked) and asks the actual price',
    await page.locator('.modal #f_into_inventory').isChecked() && (await page.locator('.modal #f_actual_price').count()) === 1);
  await page.fill('.modal #f_actual_price', '37.5');
  await page.locator('.modal [data-ok]').last().click(); await sign(page);
  await page.waitForURL(/inventory\/lots\/[\w-]+\/edit/, { timeout: 15000 }); await page.waitForSelector('#f_item_name'); await page.waitForTimeout(500);
  check('Received into inventory: the new item opens to be filled out (name, web link, 2 boxes)',
    (await page.inputValue('#f_item_name')) === 'Sterile sampling spoons (box of 100)' && (await page.inputValue('#f_item_url')) === 'https://example.com/spoons' && /INV-\d{6}/.test(await toasts()));
  await page.goto(reqUrl); await page.waitForSelector('#rg tbody tr'); await page.waitForTimeout(400);
  check('The receipt keeps the actual price; the request shows what was actually paid ($75.00)', /\$37\.50/.test(await page.locator('#rg').innerText()) && /\$75\.00/.test(await page.locator('.statcards').innerText()));
  await shot('125_purchasing_actual_price');

  check('No native browser dialogs were used', native === 0);
  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
