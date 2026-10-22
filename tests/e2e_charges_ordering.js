// 0.36.0 (migration 058), end to end in the browser: Cecilia's requests of 2026-10-21 and Alex's choices.
//  - The quote page: a discount typed as a % sets the final price; "Apply a discount % to every line…".
//  - Test catalogue > Charges (kits, shipping, fees, discounts) and > Service lines (each test's type, by fill down).
//  - The client's service lines; the order's test picker (service line > type > department, or search): a test that is
//    not on the client's quote is ordered at its list price, without a warning ("List price" on the line).
//  - A charge on a lab order is ready to invoice at once; Billing claims it with tests; on the draft a discount is
//    added; issued with one signature; the details panel at the top; Record payment…; Correct PO… (signed, with a
//    reason): the corrected copy is emailed and kept beside the original.
// Run on a freshly reset database.
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, sign, call, login } = require('./auth');
const PASSWORD = require('./test-credentials.json').password;
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (l, ok, x = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };

async function as(who) {
  const cookie = await login(BASE, who, PASSWORD);
  const users = (await call(BASE, '/users', { cookie })).data;
  const site = users.find((u) => u.username === who).sites.find((s) => s.site_code === 'CFL').id;
  return async (p, body, method) => {
    const res = await fetch(BASE + '/api' + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-site-id': site },
      body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${who} ${p}: ${data.error}`);
    return data;
  };
}

(async () => {
  await prepareUsers(BASE);
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } }); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[0-4]/.test(m.text())) errors.push(m.text()); });
  let native = 0; page.on('dialog', (d) => { native++; d.dismiss(); });
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  const go = async (h) => { await page.goto(BASE + '/' + h); await page.waitForSelector('main h1'); await page.waitForTimeout(900); };
  const toasts = async () => (await page.locator('.toast').allInnerTexts()).join(' | ');
  const paste = (text) => page.evaluate((t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }, text);
  const gm = await as('gm'); const intake = await as('intake'); const bill = await as('billing');

  // ================================================================ a quote: discount % per line and for every line
  const projects = await gm('/projects');
  // a client with an ordering contact (Acme's Irvine site in the demo data)
  let acme = null; let setup = null;
  for (const c of (await gm('/clients')).filter((x) => /Acme/.test(x.legal_name)).concat(await gm('/clients'))) {
    const st = await gm('/order-setup/' + c.id); if (st.contacts.length) { acme = c; setup = st; break; }
  }
  const np = await gm('/projects', { row: { client_id: acme.id, project_name: 'Charges test project' } });
  const cat = await gm('/catalog');
  const cfl = cat.filter((t) => t.site_code === 'CFL' && t.test_status === 'Active' && Number(t.list_price) > 0 && t.pricing_mode !== 'Analyte Selection').slice(0, 2);
  await gm(`/versions/${np.version_id}/lines`, { rows: cfl.map((t) => ({ test_id: t.test_id, quantity: 1 })), prefill: true });
  await signIn(page, BASE, 'General Manager (demo)', '#/quote/' + np.version_id); await page.waitForSelector('#lg tbody tr'); await page.waitForTimeout(600);
  const pctCol = (await page.locator('#lg thead th').allInnerTexts()).findIndex((t) => /Discount %/.test(t)) + 1;
  const finCol = (await page.locator('#lg thead th').allInnerTexts()).findIndex((t) => /Final price/.test(t)) + 1;
  await page.locator(`#lg tbody tr:nth-child(1) td:nth-child(${pctCol})`).click(); await paste('10');
  await page.waitForTimeout(300);
  const list1 = Number(cfl[0].list_price);
  const fin1 = await page.locator(`#lg tbody tr:nth-child(1) td:nth-child(${finCol})`).innerText();
  check('Typing 10 into Discount % sets the final price to the list price less 10 %', fin1.replace(/[$,]/g, '').trim() === (Math.round(list1 * 90) / 100).toFixed(2), `${fin1} from ${list1}`);
  await page.click('#pctall'); await page.waitForSelector('.modal #f_pct'); await page.fill('.modal #f_pct', '15'); await page.click('.modal [data-ok]'); await page.waitForTimeout(400);
  const fins = await page.locator(`#lg tbody tr td:nth-child(${finCol})`).allInnerTexts();
  check('"Apply a discount % to every line…" sets every final price (not saved until Save lines)', fins.every((f, k) => Number(f.replace(/[$,]/g, '')) === Math.round(Number(cfl[k].list_price) * 85) / 100) && await page.locator('#lsb.show').count() === 1, fins.join(' '));
  await page.click('#lsave'); await page.waitForTimeout(1200);
  const v1 = await gm('/versions/' + np.version_id);
  check('Saved: each line 15 % off its list price', v1.lines.every((l) => Number(l.final_price) === Math.round(Number(l.list_price) * 85) / 100), v1.lines.map((l) => l.final_price).join(' '));
  await shot('chg_01_quote_pct');

  // ================================================================ Test catalogue > Charges, by paste
  await go('#/catalog?tab=charges'); await page.waitForSelector('#g .gwrap');
  await page.click('#g [data-add="1"]'); await page.locator('#g tbody tr:last-child td:nth-child(2)').click();
  await paste('Sampling kit\tKit\t40\tBags, labels and a cooler\nGround shipping\tShipping\t25\tUPS ground\nLoyalty discount\tDiscount\t10\tFor repeat clients');
  await page.waitForTimeout(400);
  await page.locator('#g .savebar.show [data-save]').click(); await sign(page, { reason: 'Browser test: charges' }); await page.waitForTimeout(1200);
  const ci = await gm('/charge-items');
  check('Charges added by paste on Test catalogue > Charges, numbered CHG-, for this lab', ['Sampling kit', 'Ground shipping', 'Loyalty discount'].every((n) => ci.rows.some((r) => r.charge_name === n && /^CHG-/.test(r.charge_code) && r.site_code === 'CFL'))
    && ci.rows.find((r) => r.charge_name === 'Loyalty discount').kind === 'Discount', ci.rows.map((r) => r.charge_name).join(', '));
  await shot('chg_02_charges');

  // ================================================================ Service lines: the tests' type by fill down
  await go('#/catalog?tab=lines'); await page.waitForSelector('#xg tbody tr');
  const sl = await gm('/service-lines');
  check('Service lines and their types are seeded (Cannabis, Dietary supplements, Food, Environmental, Pharmaceutical)', ['Cannabis', 'Dietary supplements', 'Food', 'Environmental', 'Pharmaceutical'].every((n) => sl.lines.some((l) => l.line_name === n)) && sl.types.length >= 10);
  const xcol = (await page.locator('#xg thead th').allInnerTexts()).findIndex((t) => /Service line > type/.test(t)) + 1;
  await page.locator(`#xg tbody tr:nth-child(1) td:nth-child(${xcol})`).click(); await paste('Dietary supplements > Release testing');
  await page.locator(`#xg tbody tr:nth-child(1) td:nth-child(${xcol})`).click(); await page.locator(`#xg tbody tr:nth-child(3) td:nth-child(${xcol})`).click({ modifiers: ['Shift'] });
  await page.keyboard.press('Control+d'); await page.waitForTimeout(300);
  await page.locator('#xg .savebar.show [data-save]').click(); await sign(page, { reason: 'Browser test: service lines' }); await page.waitForTimeout(1200);
  const xt = await gm('/service-lines/tests');
  check('Three tests put under Dietary supplements > Release testing (paste, then fill down)', xt.slice(0, 3).every((t) => t.line_name === 'Dietary supplements' && t.type_name === 'Release testing'), xt.slice(0, 3).map((t) => t.type_name).join(','));
  await shot('chg_03_service_lines');

  // ================================================================ the client's service lines
  await go('#/clients/' + acme.id); await page.waitForSelector('#csl #cslch');
  await page.click('#cslch'); await page.waitForSelector('.modal .picklist');
  await page.locator('.modal .picklist label', { hasText: 'Dietary supplements' }).locator('input').check();
  await page.click('.modal [data-ok]'); await sign(page, { reason: 'Browser test: client service lines' }); await page.waitForTimeout(1000);
  check('The client page shows the client\'s service lines', /Dietary supplements/.test(await page.locator('#csl').innerText()));

  // ================================================================ the test picker on a lab order
  const ord = await intake('/orders', { row: { client_id: acme.id, ordering_contact_id: setup.contacts[0].id, po_number: 'PO-CHG-1' } });
  await intake(`/orders/${ord.id}/samples`, { rows: [{ client_sample_id: 'CHG-S1', matrix: 'Powder', number_of_units: 1, status: 'Expected' }] });
  const pk = await intake(`/orders/${ord.id}/picker`);
  const unquoted = pk.tests.find((t) => (t.quote_price === null || t.quote_price === undefined) && !t.problem && t.line_name === 'Dietary supplements' && Number(t.list_price) > 0);
  await signIn(page, BASE, 'Intake Tech (demo)', '#/orders/' + ord.id); await page.waitForSelector('[data-addt]');
  await page.locator('[data-addt]').first().click(); await page.waitForSelector('.modal.tpk [data-c="line"] button');
  const lines = await page.locator('.modal.tpk [data-c="line"] button').allInnerTexts();
  check('The picker opens on the client\'s quoted tests; the client\'s service line is marked first', /On this client's quotes/.test(lines[0]) && /Dietary supplements ★/.test(lines[1]), lines.slice(0, 3).join(' | '));
  await page.locator('.modal.tpk [data-c="line"] button', { hasText: 'Dietary supplements' }).click(); await page.waitForTimeout(200);
  await page.locator('.modal.tpk [data-c="type"] button', { hasText: 'Release testing' }).click(); await page.waitForTimeout(200);
  const listed = await page.locator('.modal.tpk [data-c="tests"]').innerText();
  check('Service line > type narrows the tests (with list prices shown for unquoted ones)', !!unquoted && listed.includes(unquoted.test_name) && /list price/.test(listed), unquoted ? unquoted.test_name : 'no unquoted test');
  await page.fill('.modal.tpk .tpkq', unquoted.test_code); await page.waitForTimeout(200);
  check('The search finds a test by its code across every line', (await page.locator('.modal.tpk [data-t]').count()) === 1);
  await page.locator(`.modal.tpk [data-t="${unquoted.id}"]`).check();
  await shot('chg_04_picker');
  await page.click('.modal.tpk [data-ok]'); await page.waitForTimeout(1500);
  const od = await intake('/orders/' + ord.id);
  const lt = od.tests.find((t) => t.test_id === unquoted.id);
  check('Ordered at its list price, without a warning; the line says "List price"', lt && lt.catalogue_order && Number(lt.price) === Number(unquoted.list_price) && /List price/.test(await page.locator('.stests').first().innerText()),
    lt ? `${lt.price} vs ${unquoted.list_price}` : 'not ordered');

  // ================================================================ a charge on the order
  await page.waitForSelector('#ochg #ocadd');
  await page.click('#ocadd'); await page.waitForSelector('.modal #f_charge_item_id');
  await page.selectOption('.modal #f_charge_item_id', { label: (await page.locator('.modal #f_charge_item_id option', { hasText: 'Ground shipping' }).innerText()).trim() });
  await page.click('.modal [data-ok]'); await page.waitForTimeout(1200);
  const oc = await intake(`/orders/${ord.id}/charges`);
  check('A shipping charge on the order, at the catalogue price, ready to invoice', oc.rows.length === 1 && Number(oc.rows[0].unit_price) === 25 && /OC-/.test(oc.rows[0].charge_no)
    && /Not invoiced/.test(await page.locator('#ochg').innerText()));
  await shot('chg_05_order_charge');

  // ================================================================ Billing: claim the charge, add a discount, issue
  await signIn(page, BASE, 'Accounting (demo)', '#/billing'); await page.waitForSelector('#g2 tbody tr');
  const g2 = await page.locator('#g2 tbody tr').allInnerTexts();
  const k = g2.findIndex((t) => /Ground shipping/.test(t)) + 1;
  check('Ready to invoice lists the charge with the tests (no COA needed)', k > 0, g2.join(' | ').slice(0, 120));
  await page.locator(`#g2 tbody tr:nth-child(${k}) td:nth-child(6)`).click();
  await page.click('#claim'); await page.waitForSelector('main h1:has-text("Draft invoice")', { timeout: 15000 }); await page.waitForTimeout(800);
  const invId = (await page.evaluate(() => location.hash)).match(/invoices\/([\w-]+)/)[1];
  await page.click('#addc'); await page.waitForSelector('.modal #f_charge_item_id');
  await page.selectOption('.modal #f_charge_item_id', { label: (await page.locator('.modal #f_charge_item_id option', { hasText: 'Loyalty discount' }).innerText()).trim() });
  await page.fill('.modal #f_note', 'Thank you for your business');
  await page.click('.modal [data-ok]'); await sign(page, { reason: 'Browser test: discount' }); await page.waitForTimeout(1200);
  let inv = await bill('/billing/invoices/' + invId);
  check('The draft holds the shipping charge and the discount: $25 less $10', inv.lines.length === 2 && Number(inv.invoice.total) === 15 && inv.lines.every((l) => l.is_charge), `${inv.invoice.total}`);
  check('The details panel is at the top of the invoice page', await page.locator('main .bldet').count() === 1 && (await page.locator('main .card').first().innerText()).includes('Invoice details'));
  await page.click('#issue'); await sign(page, {}); await page.waitForTimeout(2500);
  inv = await bill('/billing/invoices/' + invId);
  check('Issued with one signature: numbered and Unpaid', inv.invoice.status === 'Issued' && /^INV-CFL-/.test(inv.invoice.invoice_number) && inv.invoice.payment_status === 'Unpaid', inv.invoice.invoice_number);
  await go('#/billing/invoices/' + invId);

  // ================================================================ payment and the PO correction
  await page.click('#paid'); await page.waitForSelector('.modal #f_paid_on');
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  await page.fill('.modal #f_paid_on', today); await page.fill('.modal #f_paid_note', 'Cheque 1042');
  await page.click('.modal [data-ok]'); await sign(page, {}); await page.waitForTimeout(1200);
  inv = await bill('/billing/invoices/' + invId);
  check('Record payment: Paid, with the note and who recorded it', inv.invoice.payment_status === 'Paid' && inv.invoice.paid_note === 'Cheque 1042' && !!inv.invoice.paid_recorded_by_name
    && /Paid/.test(await page.locator('.bldet').innerText()));
  await page.click('#cpo'); await page.waitForSelector('.modal #f_po_number');
  await page.fill('.modal #f_po_number', 'PO-CHG-2'); await page.click('.modal [data-ok]');
  const bad = await sign(page, { reason: 'Client sent the right PO', password: 'wrong-password-1', expectError: true });
  check('A wrong password is refused', /password|signature/i.test(bad || ''), bad);
  await page.fill('.sigmodal #f_spass', PASSWORD); await page.click('.sigmodal [data-ok]'); await page.waitForTimeout(3000);
  inv = await bill('/billing/invoices/' + invId);
  check('Correct PO: the PO changes on the issued invoice; the correction keeps the old and new PO, the reason and a corrected copy',
    inv.invoice.po_number === 'PO-CHG-2' && inv.corrections.length === 1 && inv.corrections[0].old_value === 'PO-CHG-1' && !!inv.corrections[0].document_id && /right PO/.test(inv.corrections[0].reason), JSON.stringify(inv.corrections[0] || {}).slice(0, 160));
  const r = await fetch(`${BASE}/api/billing/corrections/${inv.corrections[0].id}/pdf`, { headers: { Cookie: await login(BASE, 'billing', PASSWORD) } });
  check('The corrected copy is a PDF', r.ok && (r.headers.get('content-type') || '').includes('pdf'));
  const box = await page.locator('main').innerText();
  check('The Corrections card lists it with the corrected copy', /Corrections/.test(box) && /PO-CHG-1 → PO-CHG-2/.test(box) && /Corrected copy/.test(box));
  const out = (await bill('/outbox')).rows || (await bill('/outbox'));
  check('The client is emailed the corrected copy ("Corrected invoice")', JSON.stringify(out).includes('Corrected invoice ' + inv.invoice.invoice_number));
  let refused = ''; try { await bill(`/billing/invoices/${invId}/correct-po`, { po_number: 'PO-X', reason: 'x' }); } catch (e) { refused = e.message; }
  check('A correction is always signed', /sign|password/i.test(refused), refused.slice(0, 80));
  await shot('chg_06_invoice_corrected');

  // ================================================================ the issued list: payment column and filters
  await go('#/billing?tab=issued'); await page.waitForSelector('.pgtabs .tab[data-f="paid"]');
  await page.click('.pgtabs .tab[data-f="paid"]'); await page.waitForTimeout(800);
  check('Invoices list: a Paid tab with the paid invoice', (await page.locator('.pgbody').innerText()).includes(inv.invoice.invoice_number));

  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('No native browser dialogs', native === 0);
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
