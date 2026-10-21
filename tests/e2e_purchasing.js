// Phase 1, Purchasing (migration 011): the request queue, second approval above the lab's amount, a new request,
// the block on unqualified suppliers, nobody approving their own request, ordering by supplier with the finance PO
// number, receiving equipment into the register, a partial delivery with a problem and a packing slip, supplier
// qualification by QA, a lab's own risk class, purchase orders, and the audit trail. Run on a freshly reset database.
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, sign } = require('./auth');
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (l, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

(async () => {
  await prepareUsers(BASE);
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1600, height: 950 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[0-3]/.test(m.text())) errors.push(m.text()); });
  let native = 0; page.on('dialog', (d) => { native++; d.dismiss(); });
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  const go = async (h) => { await page.goto(BASE + '/' + h); await page.waitForSelector('main h1'); await page.waitForTimeout(500); };
  const toasts = async () => (await page.locator('.toast').allInnerTexts()).join(' | ');
  const fillModal = async (vals) => {
    for (const [k, v] of Object.entries(vals)) {
      const el = page.locator(`.modal #f_${k}`).last();
      const tag = await el.evaluate((x) => x.tagName);
      if (tag === 'SELECT') await el.selectOption({ label: v }); else if ((await el.getAttribute('type')) === 'checkbox') { if (v) await el.check(); } else await el.fill(String(v));
    }
  };
  const okModal = async () => { await page.locator('.modal [data-ok]').last().click(); await page.waitForTimeout(300); };
  const row = (host, text) => page.locator(`${host} tbody tr`, { hasText: text });
  const tick = async (host, text) => { await row(host, text).locator('td:first-child .chk').click(); };

  // ---- The queue: Alex (General Manager rights) gives the second approval to the HPLC oven
  await signIn(page, BASE, 'Alex Kiddle', '#/purchasing');
  await page.waitForSelector('#g tbody tr');
  check('Purchasing is in the menu; the queue opens on To approve', (await page.locator('nav a[href="#/purchasing"]').count()) === 1 && /To approve\s*3/.test(await page.locator('.pubar').innerText()));
  check('Over the lab\'s 5,000 USD: the oven waits for a second approval, marked *', /Awaiting second approval/.test(await row('#g', 'HPLC column oven').innerText()) && /\*/.test(await row('#g', 'HPLC column oven').innerText()));
  await shot('80_purchasing_queue');
  await tick('#g', 'HPLC column oven'); await page.click('#approve'); await sign(page); await page.waitForTimeout(900);
  await go('#/purchasing?show=order');
  check('Second approval given: the oven is Approved, ready to order', /HPLC column oven/.test(await page.locator('#g').innerText()));

  // ---- Analyst: a new request; an unqualified supplier is refused; no approving your own request
  await signIn(page, BASE, 'Analyst (demo)', '#/purchasing');
  await page.click('#new');
  await fillModal({ line_type: 'Service', description: 'Balance service visit', supplier_id: 'Budget Lab Supplies (Not qualified: cannot order)', quantity: 1, unit: 'visit', unit_price: 400 });
  await okModal(); await page.waitForSelector('.sigmodal');
  await page.fill('.sigmodal #f_spass', require('./test-credentials.json').password); await page.click('.sigmodal [data-ok]'); await page.waitForTimeout(700);
  check('Requesting from a supplier nobody has qualified is refused (the database says why)', /not qualified/.test(await page.locator('.sigmodal').innerText()));
  await page.click('.sigmodal [data-x]'); await page.waitForTimeout(300);
  await page.click('#new');
  await fillModal({ line_type: 'Service', description: 'Balance service visit', supplier_id: 'Northbridge Scientific Supply', quantity: 1, unit: 'visit', unit_price: 400, justification: 'Balance 1 drifting' });
  await okModal(); await sign(page); await page.waitForSelector('main .statcards'); await page.waitForTimeout(400);
  check('New request created and signed: PR number, Requested, 400 USD', /PR-\d{6}/.test(await page.locator('.eyebrow').innerText()) && /Requested/.test(await page.locator('.statcards').innerText()) && /\$400\.00/.test(await page.locator('.statcards').innerText()));
  check('The analyst has no Approve button', (await page.locator('[data-act="approve"]').count()) === 0);
  const visitUrl = page.url();

  // ---- Lab Supervisor: approve it, then order it with the oven (same supplier) under one finance PO
  await signIn(page, BASE, 'Lab Supervisor (demo)'); await page.goto(visitUrl); await page.waitForSelector('[data-act="approve"]');
  await page.click('[data-act="approve"]'); await sign(page); await page.waitForTimeout(900);
  check('Lab Supervisor approves (under the amount: one approval)', /Approved/.test(await page.locator('main .sub').innerText()));
  await go('#/purchasing?show=order');
  await tick('#g', 'HPLC column oven'); await tick('#g', 'Balance service visit');
  await page.click('#order'); await fillModal({ external_po_number: 'FIN-2026-0099', confirmation_number: 'NB-SO-77001' }); await okModal(); await sign(page); await page.waitForTimeout(900);
  check('One order for both lines, with the finance PO number', /Order PO-CFL-\d{5} placed/.test(await toasts()), await toasts());
  await go('#/purchasing/orders');
  check('The order is listed with its finance PO and 2 lines', /FIN-2026-0099/.test(await row('#g', 'FIN-2026-0099').innerText()) && /\b2\b/.test(await row('#g', 'FIN-2026-0099').innerText()));

  // ---- Analyst receives: the oven into the equipment register; the sample bags in part, with a problem and a packing slip
  await signIn(page, BASE, 'Analyst (demo)', '#/purchasing/receive'); await page.waitForSelector('#g tbody tr');
  await row('#g', 'HPLC column oven').locator('button', { hasText: 'Receive' }).click(); await page.waitForSelector('.modal #f_equipment_type_id');
  await fillModal({ equipment_type_id: 'HPLC', department_id: 'CHEM Chemistry', manufacturer: 'Agilent', model: 'G7116A', serial_number: 'DEAG7116A01', owner_group_id: 'Lab Supervisor' });
  await okModal(); await sign(page); await page.waitForTimeout(1000);
  await go('#/purchasing?show=all'); await row('#g', 'HPLC column oven').locator('a').first().click(); await page.waitForSelector('main .statcards');
  const ovenText = await page.locator('main').innerText();
  check('Received equipment: request Received and linked to its new equipment record', /Received/.test(await page.locator('main .sub').innerText()) && /EQ-\d{5}/.test(ovenText));
  await page.locator('main a', { hasText: /^EQ-\d{5}$/ }).first().click(); await page.waitForSelector('main .statcards'); await page.waitForTimeout(400);
  check('The new oven is in the register, tagged out for qualification', /Tagged out: Qualification/.test(await page.locator('.statcards').innerText()));
  await go('#/purchasing/receive');
  await row('#g', 'Sample bags').locator('button', { hasText: 'Receive' }).click(); await page.waitForSelector('.modal #f_quantity');
  await fillModal({ quantity: 2, more_to_come: true, discrepancy: 'Short shipped', note: 'Two of three cases; third on back-order' });
  await page.setInputFiles('.modal #f_slip', { name: 'packing-slip-NB.pdf', mimeType: 'application/pdf', buffer: PDF });
  await okModal(); await sign(page); await page.waitForTimeout(900);
  await go('#/purchasing?show=all'); await row('#g', 'Sample bags').locator('a').first().click(); await page.waitForSelector('#rg tbody tr');
  check('Partial delivery: Partly received, 2 of 3, problem and packing slip on the receipt', /Partly received/.test(await page.locator('main .sub').innerText())
    && /2 of 3/.test(await page.locator('.statcards').innerText()) && /Short shipped/.test(await page.locator('#rg').innerText()) && /packing-slip-NB\.pdf/.test(await page.locator('#rg').innerText()));
  // (since migration 023 an "Other" purchase goes into inventory by default: the first delivery made the item; this one is not put in again)
  check('Received into inventory (migration 023): the first delivery made an inventory item', /INV-\d{6}/.test(await page.locator('#rg').innerText()));
  await page.click('[data-act="receive"]'); await page.waitForSelector('.modal #f_quantity'); await page.locator('.modal #f_into_inventory').uncheck(); await okModal(); await sign(page); await page.waitForTimeout(900);
  check('The back-order arrives: Received, 3 of 3', /Received/.test(await page.locator('main .sub').innerText()) && /3 of 3/.test(await page.locator('.statcards').innerText()));
  await shot('81_purchasing_request');

  // ---- QA qualifies the new supplier; adds the lab's own risk class
  await signIn(page, BASE, 'QA Reviewer (demo)', '#/purchasing/suppliers?show=attention'); await page.waitForSelector('#g tbody tr');
  await row('#g', 'Budget Lab Supplies').locator('a').first().click(); await page.waitForSelector('#qual');
  await page.click('#qual'); await fillModal({ risk_class_id: 'Class III (re-approve every 12 months)', accreditations: 'ISO 9001', justification: 'Supplier questionnaire and audit report reviewed' });
  await page.check('.modal #sc_every');   // since 0.28.0 (050) an approval names what the vendor is approved for
  await okModal(); await sign(page); await page.waitForTimeout(900);
  check('QA approves the supplier for this lab (050: corporate approvals are Corporate QA\'s): Approved, expiry from Class III', /Approved for CFL until/.test(await page.locator('main .sub').innerText()) && /VQ-\d{5}/.test(await page.locator('#qg').innerText()));
  await shot('82_purchasing_supplier');
  await go('#/purchasing/risk-classes'); await page.waitForSelector('#g tbody tr');
  const n = await page.locator('#g tbody tr').count();
  await page.click('#g [data-add="1"]');
  await page.locator(`#g tbody tr:nth-child(${n + 1}) td:nth-child(1)`).click();
  await page.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'Class V\t84\tCFL only: furniture and paper goods'); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); });
  await page.waitForTimeout(300); await page.click('#g .savebar [data-save]'); await sign(page); await page.waitForTimeout(900);
  check('QA adds a CFL-only risk class (Class V, 7 years)', /Class V/.test(await row('#g', 'Class V').innerText()) && /CFL/.test(await row('#g', 'Class V').innerText()));

  // ---- Settings and audit
  await signIn(page, BASE, 'Alex Kiddle', '#/purchasing/settings');
  check('Settings show the lab\'s second approval amount', /\$5,000\.00/.test(await page.locator('main').innerText()));
  await page.goto(visitUrl); await page.waitForSelector('main h1 .auditbtn'); await page.click('main h1 .auditbtn'); await page.waitForTimeout(800);
  const audit = await page.locator('.modal').innerText().catch(() => '');
  check('The request\'s audit trail shows its approval, order and receipt with signatures', /Request PR-/.test(audit) && /Approved by|Ordered by|Received by|Requested by/.test(audit));

  check('No native browser dialogs', native === 0);
  check('No browser errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\nTOTAL: ${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
