// Slice 3 / 3.1 click-through: Inventory. The cut-down inventory list (filters, warning colours), the New Inventory Item
// page (analytes from the Analytes list, no Chemical list), duplicate and edit, the in-house mixture page with the
// calculated concentration, storage location pages, Excel export and upload (preview, errors, save), Receive many
// (paste, fill down, storage check), usage, reorder -> approve -> order -> receive, Supplier COA, transfer to another
// lab, sample storage, list pages, Units and Unit conversions, job roles.
// Slice 3.2: everyone signs in; every inventory create and change is signed (user ID + password, canned or typed reason);
// routine usage is not; Excel upload to the inventory list is QA/admin only; Amount used in a mixture can be in mL for a lot kept in L.
// Run on a freshly reset database (after the other browser tests, or on its own).
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { readTable, writeXlsx } = require('../backend/server/xlsx');
const { prepareUsers, signIn, sign } = require('./auth');
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (l, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };

(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ acceptDownloads: true, viewport: { width: 1600, height: 950 } }); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[01]/.test(m.text())) errors.push(m.text()); }); // 401: expected right after signing out (the sign-in screen follows)
  let native = 0; page.on('dialog', (d) => { native++; d.dismiss(); });
  page.on('popup', (p) => p.close().catch(() => {}));
  await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  const go = async (h) => { await page.goto(BASE + '/' + h); await page.waitForSelector('main h1'); await page.waitForTimeout(450); };
  const leave = async () => { if (await page.locator('.modal [data-ok]', { hasText: 'Leave without saving' }).count()) await page.click('.modal [data-ok]'); };
  const reason = async (t) => { await page.waitForSelector('.modal textarea'); await page.fill('.modal textarea', t); await page.click('.modal [data-ok]'); };
  const paste = (text) => page.evaluate((t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }, text);
  const rows = (host) => page.locator(`${host} > .gwrap > table > tbody > tr, ${host} .gridhost > .gwrap > table > tbody > tr, ${host} .pgbody > .gwrap > table > tbody > tr`);
  const cell = (host, r, c) => page.locator(`${host} .gwrap > table > tbody > tr:nth-child(${r}) > td:nth-child(${c})`);
  const toasts = async () => (await page.locator('.toast').allInnerTexts()).join(' | ');
  const asUser = async (label) => { await signIn(page, BASE, label); };
  const h1 = async () => (await page.locator('main h1').innerText()).trim();
  const combo = async (sel, text) => { await page.locator(sel).locator('xpath=..').locator('.combo-input').click(); await page.keyboard.type(text); await page.waitForTimeout(120); await page.keyboard.press('Enter'); };
  const typeCell = async (host, r, c, text) => { await cell(host, r, c).click(); await page.keyboard.type(text); await page.waitForTimeout(100); await page.keyboard.press('Enter'); await page.waitForTimeout(80); };

  await prepareUsers(BASE); await signIn(page, BASE, 'Alex Kiddle');

  // ---- inventory list as in the mock-up: columns, warning colours, filters
  await go('#/inventory');
  const head = await page.locator('#g thead').innerText();
  check('Inventory list has the mock-up columns', ['ID', 'Name', 'Lot#', 'Conc.', 'Date made', 'CAS', 'Vendor', 'Exp date', 'Amount', 'Purchase status'].every((h) => head.includes(h)), head.replace(/\s+/g, ' '));
  check('Each row has Duplicate and Reorder buttons', (await page.locator('#g tbody button', { hasText: 'Duplicate' }).count()) >= 10);
  check('The Chemicals tab is gone', (await page.locator('.invtabs a', { hasText: 'Chemicals' }).count()) === 0);
  const acn = page.locator('#g tbody tr', { hasText: 'Acetonitrile' }).first();
  check('Negative stock is shown red; low stock amber', (await acn.locator('td.cbad').count()) >= 1 && (await page.locator('#g tbody tr', { hasText: 'INV-000005' }).locator('td.cwarn').count()) >= 1);
  check('Lots from TPS are not listed in CFL', !(await page.locator('#g').innerText()).includes('In Transit'));
  await shot('40_inventory_list');
  await go('#/inventory?show=expired'); const ex = await page.locator('#g').innerText();
  check('"Show expired" lists the expired arsenic only', /Arsenic/.test(ex) && !/Methanol/.test(ex));
  await go('#/inventory?show=negative'); check('"Show negative" lists the acetonitrile', /Acetonitrile/.test(await page.locator('#g').innerText()) && (await rows('#g').count()) === 1);
  await go('#/inventory');
  await page.click('#print'); await page.waitForTimeout(300);
  check('Print opens the print view of the list', await page.evaluate(() => window.__printed === 1));

  // ---- New Inventory Item: a reference standard named by its analyte; CAS filled in from the analyte
  await page.click('#newitem'); await page.waitForSelector('#f_item_name');
  check('"+ New Inventory Item" opens a page to fill in', (await h1()) === 'New inventory item');
  await page.fill('#f_item_name', 'Sodium Standard 500 ppm');
  await page.locator('#f_types label', { hasText: 'Reference Standard' }).locator('input').check();
  await page.locator('#f_form label', { hasText: 'Liquid' }).locator('input').check();
  await typeCell('#ag', 1, 1, 'sodi'); await typeCell('#ag', 1, 2, '500'); await typeCell('#ag', 1, 3, 'ppm');
  check('CAS is filled in from the analyte', (await page.inputValue('#f_cas_number')) === '7440-23-5');
  await page.fill('#f_manufacturer_lot', 'NA-500-1'); await page.fill('#f_quantity_received', '0.5'); await combo('#f_unit', 'L');
  await page.fill('#f_expiration_date', '2027-09-30'); await combo('#f_storage_location_id', 'CHEM-FR-01'); await combo('#f_storage_condition', 'Refrig');
  await combo('#f_supplier_id', 'Apex');
  await shot('41_new_item');
  await page.click('#save');
  check('Saving a new item asks for an electronic signature meaning Created by', /Created by/.test(await page.locator('.sigmodal').innerText()) && (await page.locator('.sigmodal #f_rpick').count()) === 0);
  const wrong = await sign(page, { password: 'not-my-password-1', expectError: true });
  check('A wrong password keeps the dialog open and nothing is saved', /not correct/.test(wrong) && (await page.locator('.sigmodal').count()) === 1, wrong);
  await sign(page); await page.waitForSelector('.statcards'); await page.waitForTimeout(400);
  const lotText = await page.locator('main').innerText();
  check('Item saved: lot page shows the name, Analyte-eligible and the analyte', (await h1()) === 'Sodium Standard 500 ppm' && /Analyte-eligible/.test(lotText) && /Sodium 500 ppm|500 ppm/.test(lotText));
  const newLotUrl = page.url();
  await page.locator('main a[href^="#/inventory/locations/"]').first().click(); await page.waitForTimeout(500);
  check('Storage location code is a link to the location page, which lists the new item', /CHEM-FR-01/.test(await h1()) && /Sodium Standard 500 ppm/.test(await page.locator('#lg').innerText()));
  await shot('42_location_page');

  // ---- a Reference Standard without an analyte is refused
  await go('#/inventory/new'); await page.fill('#f_item_name', 'Mystery standard');
  await page.locator('#f_types label', { hasText: 'Reference Standard' }).locator('input').check();
  await page.fill('#f_manufacturer_lot', 'X-1'); await page.fill('#f_quantity_received', '1'); await combo('#f_unit', 'mL');
  await page.click('#save'); const refused = await sign(page, { expectError: true });
  check('A Reference Standard without an analyte is refused', /must be linked to at least one analyte/.test(refused), refused.slice(-140));
  await page.click('.sigmodal [data-x]');
  await page.goto(newLotUrl); await leave(); await page.waitForSelector('.statcards');

  // ---- duplicate and edit
  await page.locator('.pactions a', { hasText: 'Duplicate' }).click(); await page.waitForSelector('#f_item_name'); await page.waitForTimeout(300);
  check('Duplicate opens a pre-filled item (same name and analyte, new lot number to enter)', (await page.inputValue('#f_item_name')) === 'Sodium Standard 500 ppm'
    && (await page.inputValue('#f_manufacturer_lot')) === '' && /Sodium/.test(await page.locator('#ag').innerText()));
  await page.goto(newLotUrl); await leave(); await page.waitForSelector('.statcards');
  await page.locator('.pactions a', { hasText: 'Edit' }).click(); await page.waitForSelector('#f_notes');
  check('Edit: received quantity and unit are locked', await page.locator('#f_quantity_received').isDisabled());
  await page.fill('#f_notes', 'Opened for ICP-OES calibration'); await page.click('#save'); await page.waitForSelector('.sigmodal #f_rpick');
  const canned = await page.locator('.sigmodal #f_rpick option').allInnerTexts();
  check('The reason dialog offers canned Inventory reasons, General ones and Other', canned.length >= 8 && canned.some((x) => /Other/.test(x)) && canned.some((x) => /count/i.test(x)), canned.slice(0, 5).join(' / '));
  await sign(page, { reason: 'Added a note' }); await page.waitForSelector('.statcards'); await page.waitForTimeout(300);
  check('Edit saved with a reason and signature', /Opened for ICP-OES calibration/.test(await page.locator('main').innerText()));

  // ---- in-house mixture: quantity defaults to the components, concentration calculated, target checked
  await go('#/inventory'); await page.click('#mix'); await page.waitForSelector('#m_name');
  await page.fill('#m_name', 'Sodium Working Solution 5 ppm');
  await page.locator('#m_types label', { hasText: 'Reference Standard' }).locator('input').check();
  await typeCell('#pg', 1, 1, 'INV-000015'); await typeCell('#pg', 2, 1, 'INV-000016'); await page.waitForTimeout(300);
  const unitsShown = await page.locator('#pg tbody tr:nth-child(1) td:nth-child(3)').innerText() + '/' + await page.locator('#pg tbody tr:nth-child(1) td:nth-child(4)').innerText();
  check('A component kept in L defaults to mL for the amount used (selectable from the conversions table)', /mL\/L/.test(unitsShown.replace(/\s/g, '')), unitsShown);
  await typeCell('#pg', 1, 2, '2.5'); await typeCell('#pg', 2, 2, '497.5');
  await page.waitForTimeout(900);
  check('Quantity made defaults to the total of the liquid components (500 mL)', (await page.inputValue('#m_qty')) === '500', await page.inputValue('#m_qty'));
  const calc = await page.locator('#cg').innerText();
  check('Concentration calculated: 2.5 mL of 1000 ppm in 500 mL = 5 ppm', /Sodium/.test(calc) && /\b5\b/.test(calc) && /ppm/.test(calc), calc.replace(/\s+/g, ' '));
  check('The ppm assumption is shown with the calculation', /density 1 g\/mL/.test(await page.locator('#cgnotes').innerText()));
  await typeCell('#cg', 1, 4, '5'); await typeCell('#cg', 1, 5, '5'); await page.waitForTimeout(800);
  check('Target 5 ppm ± 5% conforms', /Conforms/.test(await page.locator('#cg').innerText()));
  await shot('43_mixture_page');
  await page.click('#save'); await sign(page); await page.waitForSelector('.statcards'); await page.waitForTimeout(400);
  const mix = await page.locator('main').innerText();
  check('Mixture saved: Resource ID, components, calculated 5 ppm, target conforms', /system-generated/.test(mix) && (await rows('#cg').count()) === 2 && /Conforms/.test(await page.locator('#ang').innerText())
    && /5 ppm/.test(await page.locator('#ang').innerText()));
  check('The lot page shows each component as entered (2.5 mL) and as drawn from stock (0.0025 L)', /2\.5 mL \(= 0\.0025 L\)/.test(await page.locator('#cg').innerText()), (await page.locator('#cg').innerText()).replace(/\s+/g, ' ').slice(0, 160));
  check('Reorder is not offered for a mixture', await page.locator('.pactions [data-act="reorder"]').isDisabled());
  await shot('44_mixture_lot');

  // ---- Excel export, then upload an edited file: one change, one new row; an error is refused
  await go('#/inventory');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-export="lots"]')]);
  const file = path.join(OUT, 'export_inventory.xlsx'); await dl.saveAs(file);
  const t = readTable(fs.readFileSync(file), 'x.xlsx');
  check('Export XLSX downloads an Excel file of the lab\'s inventory', /\.xlsx$/.test(dl.suggestedFilename()) && t.headers.includes('Name') && t.headers.includes('Analytes') && t.rows.length >= 15, `${dl.suggestedFilename()} ${t.rows.length} rows`);
  const headers = t.headers; const toRow = (o) => headers.map((h) => (o[h] === undefined ? null : o[h]));
  const edited = t.rows.map((r) => (r.ID === 'INV-000009' ? { ...r, Notes: 'Count checked by upload' } : r));
  edited.push({ Name: 'Nitrile gloves, size M', Types: 'Consumable', 'Quantity received': 10, Unit: 'box', Vendor: 'Northbridge Scientific Supply' });
  const up = path.join(OUT, 'upload_inventory.xlsx'); fs.writeFileSync(up, writeXlsx({ sheetName: 'Inventory', headers, rows: edited.map(toRow) }));
  await page.click('[data-upload="lots"]'); await page.setInputFiles('#bulkf', up); await page.waitForSelector('.bulksum'); await page.waitForTimeout(300);
  const sum = await page.locator('.bulksum').innerText();
  check('Upload preview: 1 to create, 1 to update, no errors', /1\s*to create/.test(sum) && /1\s*to update/.test(sum) && /0\s*with errors/.test(sum), sum.replace(/\s+/g, ' '));
  await shot('45_upload_preview');
  await page.click('.modal [data-ok]'); await sign(page, { reason: 'Monthly stock count' }); await page.waitForTimeout(900);
  check('Upload saved with a reason and signature', /Upload saved and signed: 1 created, 1 updated/.test(await toasts()), await toasts());
  check('The uploaded row is in the list', /Nitrile gloves, size M/.test(await page.locator('#g').innerText()));
  const bad = path.join(OUT, 'upload_bad.xlsx');
  fs.writeFileSync(bad, writeXlsx({ headers: ['ID', 'Name', 'Vendor'], rows: [['INV-000009', 'Pipette tips, 1000 µL, filtered', 'No Such Supplier Inc']] }));
  await page.click('[data-upload="lots"]'); await page.setInputFiles('#bulkf', bad); await page.waitForSelector('.bulksum'); await page.waitForTimeout(300);
  check('An unknown vendor is shown as an error and nothing can be saved', /1\s*with errors/.test(await page.locator('.bulksum').innerText()) && await page.locator('.modal [data-ok]').isDisabled()
    && /No Such Supplier Inc" was not found/.test(await page.locator('#bulkg').innerText()));
  await page.click('.modal [data-x]');

  // ---- Receive many: paste a packing list, fill down; storage condition is checked
  await page.click('#many'); await page.waitForSelector('#g');
  await cell('#g', 1, 1).click();
  await paste('Nitric acid 69%\tReagent\tLiquid\t\t\t\tMC-NEW-1\t2.5\tL\t2027-06-30\nHydrogen peroxide 30%\tReagent\tLiquid\t\t\t\tHP-77\t1\tL\t2027-01-31\nLead Standard 1000 ppm\tReference Standard\tLiquid\tLead\t1000\tppm\tPB-2610\t100\tmL\t2027-03-31');
  await page.waitForTimeout(150);
  await typeCell('#g', 1, 11, 'CHEM-CORR'); await typeCell('#g', 1, 12, 'Corrosives');
  await cell('#g', 1, 11).click(); await cell('#g', 2, 12).click({ modifiers: ['Shift'] }); await page.keyboard.press('Control+d'); await page.waitForTimeout(150);
  await typeCell('#g', 3, 11, 'CHEM-FR-01'); await typeCell('#g', 3, 12, 'Refrig');
  check('Ctrl+D fills location and condition down the new rows', /CHEM-CORR/.test(await rows('#g').nth(1).innerText()) && /Corrosives cabinet/.test(await rows('#g').nth(1).innerText()));
  await shot('46_receive_many');
  await page.click('.savebar [data-save]'); await sign(page); await page.waitForTimeout(900);
  check('Three items received by paste (one with its analyte), signed Received by', /Saved and signed: 3/.test(await toasts()), await toasts());
  await go('#/inventory/receive'); await cell('#g', 1, 1).click(); await paste('Methanol HPLC\tSolvent\tLiquid\t\t\t\tMEOH-X\t4\tL');
  await typeCell('#g', 1, 11, 'CHEM-FR-01'); await typeCell('#g', 1, 12, 'Flammables');
  await page.click('.savebar [data-save]'); const fridge = await sign(page, { expectError: true });
  check('Methanol in the standards fridge is refused (needs a flammables cabinet)', /needs "Flammables cabinet" but Standards fridge 1/.test(fridge), fridge.slice(-160));
  await page.click('.sigmodal [data-x]');
  await page.click('.savebar [data-undo]');

  // ---- usage, reorder -> approve -> order -> receive
  await go('#/inventory'); await page.click('#use'); await page.waitForSelector('.modal #dg');
  await page.locator('.modal #dg tbody tr:nth-child(1) td:nth-child(1)').click();
  await paste('INV-000001\t0.25\t\tICP digestion batch B-1042\nINV-000007\t25\t\tTSA plates, micro batch M-77'); await page.waitForTimeout(150);
  await page.click('.modal [data-ok]'); await page.waitForTimeout(700);
  check('Usage recorded for two lots in one go, without a signature (routine)', /Recorded 2 usage lines/.test(await toasts()) && (await page.locator('.sigmodal').count()) === 0, await toasts());
  await go('#/inventory');
  await page.locator('#g tbody tr', { hasText: 'INV-000005' }).locator('button', { hasText: 'Reorder' }).click(); await page.waitForSelector('.modal'); await page.click('.modal [data-ok]'); await sign(page); await page.waitForTimeout(800);
  check('Reorder from the list opens the new purchase request', /Requested/.test(await page.locator('main .sub').innerText()) && (await h1()) === 'Methanol');
  const reqUrl = page.url();
  await asUser('Analyst (demo)'); await page.goto(reqUrl); await page.waitForSelector('.actbar');
  check('An analyst sees no Approve button and is told a Lab Supervisor approves', (await page.locator('[data-act="approve"]').count()) === 0 && /Waiting for a Lab Supervisor/.test(await page.locator('main').innerText()));
  await asUser('Lab Supervisor (demo)'); await page.goto(reqUrl); await page.waitForSelector('.actbar');
  await page.click('[data-act="approve"]'); check('Approving asks for a signature meaning Approved by', /Approved by/.test(await page.locator('.sigmodal').innerText())); await sign(page); await page.waitForTimeout(700);
  check('Lab Supervisor approves; approval is recorded', /approved by Lab Supervisor \(demo\)/.test(await page.locator('main').innerText()));
  await page.click('[data-act="ordered"]'); await sign(page); await page.waitForTimeout(700);
  await page.click('[data-act="receive"]'); await page.waitForSelector('.modal #f_manufacturer_lot');
  await page.fill('.modal #f_manufacturer_lot', 'MC2610777'); await page.fill('.modal #f_expiration_date', '2028-03-31');
  await page.click('.modal [data-ok]'); await sign(page); await page.waitForTimeout(900);
  const recv = await page.locator('main').innerText();
  check('Receive completes the same lot: received, stock added, one receipt movement', /Purchase status\s*\n?\s*Received/.test(recv) && /Quantity on hand\s*\n?\s*4 L/.test(recv) && (await rows('#mg').count()) === 1);
  await asUser('Alex Kiddle');

  // ---- Supplier COA: upload (manual here, AI off), review side by side, confirm
  await go('#/inventory'); await page.locator('#g a', { hasText: 'INV-000003' }).click(); await page.waitForSelector('.actbar');
  await page.click('[data-act="coa"]'); await page.waitForSelector('.modal input[type=file]');
  check('Without an API key the upload says AI reading is off', /AI reading is off/.test(await page.locator('.modal').innerText()));
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
  await page.setInputFiles('.modal input[type=file]', { name: 'apex-cd-coa.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.click('.modal [data-ok]'); await sign(page); await page.waitForSelector('.coa-review'); await page.waitForTimeout(500);
  await page.fill('#cf_purity_pct', '99.998');
  await page.click('.modal [data-ok]'); await sign(page, { reason: 'Values confirmed from the Supplier COA' }); await page.waitForTimeout(900);
  check('COA stored with its fingerprint; confirmed values saved to the lot', /apex-cd-coa\.pdf/.test(await page.locator('#coag').innerText()) && /99\.998%/.test(await page.locator('main').innerText()));
  await page.click('main h1 .auditbtn'); await page.waitForSelector('.modal #auditg tbody tr');
  check('Lot audit trail shows the COA confirmation with its reason', /Values confirmed from the Supplier COA/.test(await page.locator('.modal').innerText()));
  check('Lot audit trail shows who signed and what it meant (Verified by, Uploaded by)', /Alex Kiddle \(Verified by\)/.test(await page.locator('.modal').innerText()) && /Alex Kiddle \(Uploaded by\)/.test(await page.locator('.modal').innerText()));
  await page.click('.modal [data-x]');

  // ---- transfer lead standard to TPS; receive it at TPS
  await go('#/inventory'); await page.locator('#g a', { hasText: 'INV-000002' }).click(); await page.waitForSelector('.actbar');
  await page.click('[data-act="transfer"]'); await page.waitForSelector('.modal #f_to_site_id');
  await page.selectOption('.modal #f_to_site_id', { index: 1 }); await page.fill('.modal #f_quantity', '5'); await page.click('.modal [data-ok]'); await sign(page); await page.waitForTimeout(900);
  check('Transfer writes the quantity off at CFL', /Transfer Out/.test(await page.locator('#mg').innerText()));
  await page.click('#labBtn'); await page.locator('#labMenu button', { hasText: 'TPS' }).click(); await page.waitForTimeout(700);
  await go('#/inventory?show=order');
  check('At TPS the lead standard is In Transit', /Lead/.test(await page.locator('#g').innerText()) && /In Transit/.test(await page.locator('#g').innerText()));
  await page.locator('#g tbody tr', { hasText: 'Lead' }).last().locator('a').first().click(); await page.waitForSelector('.actbar');
  await page.click('[data-act="receive"]'); await page.waitForSelector('.modal'); await page.click('.modal [data-ok]'); await sign(page); await page.waitForTimeout(900);
  const tpsLot = await page.locator('main').innerText();
  check('TPS receives it like a new lot, linked back to the CFL lot, with its analyte', /Came from\s*INV-000002 \(CFL\)/.test(tpsLot) && /Analyte-eligible/.test(tpsLot));
  await page.click('#labBtn'); await page.locator('#labMenu button', { hasText: 'CFL' }).click(); await page.waitForTimeout(700);

  // ---- sample storage and list pages, export buttons, location links
  await go('#/inventory/samples');
  check('Sample storage lists logged samples with retain flags and Excel buttons', (await rows('#g').count()) >= 2 && /Low/.test(await page.locator('#g').innerText()) && (await page.locator('[data-export="samplestorage"]').count()) === 1);
  for (const [h, tt, kind] of [['#/inventory/suppliers', 'Suppliers and manufacturers', 'suppliers'], ['#/inventory/locations', 'Storage locations: CFL', 'locations'], ['#/inventory/thresholds', 'Warning rules', 'thresholds']]) {
    await go(h); check(`${tt} page opens with Export and Upload`, (await h1()).startsWith(tt) && (await rows('#g').count()) > 0 && (await page.locator(`[data-upload="${kind}"]`).count()) === 1);
  }
  await go('#/inventory/locations'); await page.locator('#g a', { hasText: 'CHEM-FLAM' }).click(); await page.waitForTimeout(500);
  check('A location code in the Storage locations list opens its page', /CHEM-FLAM/.test(await h1()) && /Methanol|Acetonitrile/.test(await page.locator('#lg').innerText()));
  await asUser('Analyst (demo)'); await go('#/inventory/suppliers');
  check('Analyst sees the Supplier list read-only with a note', /You can view this list/.test(await page.locator('main').innerText()) && (await page.locator('#g [data-add]').count()) === 0);
  check('Analyst does not see the Units admin pages', (await page.locator('nav a[href="#/admin/units"]').count()) === 0);
  await go('#/inventory'); check('Analyst can export the inventory list but not upload it (QA and administrators only)', (await page.locator('[data-export="lots"]').count()) === 1 && (await page.locator('[data-upload="lots"]').count()) === 0);
  await go('#/analytes'); check('Analytes show molar masses; an analyst is told QA and Lab Supervisors maintain them', /207\.2/.test(await page.locator('#g').innerText()) && /QA and Lab Supervisors maintain it/.test(await page.locator('main .sub').innerText()));
  await asUser('QA Reviewer (demo)');
  check('QA sees Units, Unit conversions and Canned reasons under Admin (and not the other Admin pages)', (await page.locator('nav a[href="#/admin/units"]').count()) === 1 && (await page.locator('nav a[href="#/admin/reasons"]').count()) === 1 && (await page.locator('nav a[href="#/admin/users"]').count()) === 0);
  await go('#/inventory'); check('QA can upload to the inventory list', (await page.locator('[data-upload="lots"]').count()) === 1);
  await go('#/admin/reasons'); check('Canned reasons page lists reasons per module', (await rows('#g').count()) >= 20 && /Inventory/.test(await page.locator('#g').innerText()));
  await shot('49_canned_reasons');
  await asUser('Alex Kiddle');

  // ---- Admin: Units and Unit conversions
  await go('#/admin/units');
  check('Units list is comprehensive (mass, volume, count, concentration, activity)', (await rows('#g').count()) >= 50 && /CFU\/mL/.test(await page.locator('#g').innerText()));
  await shot('47_units');
  await go('#/admin/conversions');
  await page.fill('#c_v', '2.5'); await page.selectOption('#c_f', 'L'); await page.selectOption('#c_t', 'mL'); await page.click('#c_go'); await page.waitForTimeout(400);
  check('Try a conversion: 2.5 L = 2,500 mL', /2\.5 L = 2,500 mL/.test(await page.locator('#c_out').innerText()), await page.locator('#c_out').innerText());
  await page.selectOption('#c_f', 'ppm'); await page.selectOption('#c_t', 'µg/mL'); await page.selectOption('#c_form', 'Solid'); await page.click('#c_go'); await page.waitForTimeout(400);
  check('ppm does not convert to µg/mL for a solid', /Cannot convert/.test(await page.locator('#c_out').innerText()));
  await shot('48_conversions');
  await go('#/admin/roles'); // old address: Job roles were replaced by groups (migration 008)
  check('The old Job roles address opens Groups and permissions', /Groups and permissions/.test(await h1()) && /Lab Supervisor/.test(await page.locator('#gg').innerText()));

  // ---- Admin: sign-in status and history
  await go('#/admin/users');
  check('Users page shows each person\'s sign-in status and last sign-in', /Active/.test(await rows('#g').filter({ hasText: 'Analyst (demo)' }).innerText()) && (await page.locator('#g button', { hasText: 'temporary password' }).count()) >= 5);
  await page.click('#hist'); await page.waitForSelector('.modal #hg tbody tr');
  const hist = await page.locator('.modal #hg').innerText();
  check('Sign-in history records sign-ins, password changes and the failed signature', /Logged in/.test(hist) && /Password changed/.test(hist) && /Signature failed/.test(hist));
  await shot('50_signin_history'); await page.click('.modal [data-x]');
  await page.click('#outBtn'); await page.waitForSelector('#loginScreen');
  check('Sign out returns to the sign-in screen', (await page.locator('#loginScreen h3').innerText()) === 'Sign in');

  check('No native browser dialogs', native === 0);
  check('No browser errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\nTOTAL: ${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
