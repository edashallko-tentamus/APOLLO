// 0.34.0 (migration 057): cancelling tests and samples, the thermometer at receipt. The Intake Tech cancels a test with
// its Cancel… button and a sample (with its tests) by right-click, each with a reason; a test in an open batch is
// refused, saying to take it out of the batch first. Receiving with a temperature asks for the thermometer (only those
// available and in calibration are offered); the receipt names it.
// Run on a freshly reset database.
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
  return async (p, body, method) => {
    const res = await fetch(BASE + '/api' + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-site-id': site }, body: body ? JSON.stringify(body) : undefined });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json().catch(() => ({})) : Buffer.from(await res.arrayBuffer());
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
  const intake = await as('intake'); const sup = await as('labsup');
  const acme = (await intake('/clients')).find((c) => c.client_code === 'CL-00005');
  const ordering = (await intake('/order-setup/' + acme.id)).contacts[0].id;
  const newOrder = async (po, n) => {
    const o = await intake('/orders', { row: { client_id: acme.id, ordering_contact_id: ordering, po_number: po } });
    await intake(`/orders/${o.id}/samples`, { rows: Array.from({ length: n }, (_, i) => ({ client_sample_id: `${po}-${i + 1}`, matrix: 'Powder', number_of_units: 1 })) });
    const od = await intake('/orders/' + o.id);
    await intake(`/orders/${o.id}/add-test`, { sample_ids: od.samples.map((s) => s.id), line_id: od.orderable[0].line_id });
    return o.id;
  };

  // ---- 1. cancelling a test (button) and a sample (right-click)
  const oid = await newOrder('E2E-CAN', 2);
  await signIn(page, BASE, 'Intake Tech (demo)', '#/orders/' + oid); await go('#/orders/' + oid);
  check('The order page has "Cancel ticked samples…"', (await page.locator('#cancelS').count()) === 1);
  const testRow = page.locator('.stests tbody tr').first();
  await testRow.locator('button', { hasText: 'Cancel…' }).click(); await page.waitForSelector('.modal');
  const conf = await page.locator('.modal').innerText();
  check('Cancel… on a test asks first, naming the test and saying it stays on the order', /E2E-CAN-1/.test(conf) && /stay on the order/.test(conf), conf.replace(/\s+/g, ' ').slice(0, 160));
  await page.click('.modal [data-ok]'); await sign(page, { reason: 'Client changed the request' }); await page.waitForTimeout(1500);
  let od = await intake('/orders/' + oid);
  const s1 = od.samples.find((s) => s.client_sample_id === 'E2E-CAN-1'); const s2 = od.samples.find((s) => s.client_sample_id === 'E2E-CAN-2');
  check('The test is cancelled (kept, greyed), its sample is not', od.tests.find((t) => t.sample_id === s1.id).status === 'Cancelled' && s1.status === 'Expected');
  await go('#/orders/' + oid);
  const row2 = page.locator('#sg > .gwrap > table > tbody > tr:not(.gdetail)', { hasText: 'E2E-CAN-2' }).first();
  await row2.locator('td').nth(3).click(); await row2.locator('td').nth(3).click({ button: 'right' }); await page.waitForSelector('.tbmenu button');
  const menu = await page.locator('.tbmenu').innerText();
  check('Right-click on a sample offers "Cancel … and their tests…"', /Cancel E2E-CAN-2 and their tests/.test(menu), menu);
  await page.click('.tbmenu button'); await page.waitForSelector('.modal'); await page.click('.modal [data-ok]');
  await sign(page, { reason: 'Sample not sent' }); await page.waitForTimeout(1500);
  check('Cancelled with its tests', /1 sample cancelled with their tests/.test(await toasts()), await toasts());
  od = await intake('/orders/' + oid);
  check('The sample and its test are Cancelled; the order keeps them', od.samples.find((s) => s.id === s2.id).status === 'Cancelled' && od.tests.filter((t) => t.sample_id === s2.id).every((t) => t.status === 'Cancelled'));
  await shot('k01_cancelled');
  let noReason = '';
  try { await intake(`/orders/${oid}/cancel`, { sample_ids: [s1.id] }); } catch (e) { noReason = e.message; }
  check('Cancelling always asks why', /Say why/.test(noReason), noReason);

  // a test in an open batch (the demo batch BAT-000001) is refused
  const bats = await sup('/testing/batches'); const bat = (bats.rows || bats).find((x) => x.batch_code === 'BAT-000001');
  const bd = await sup('/testing/batches/' + bat.id); const ent = (bd.entries || []).find((e) => e.requested_test_id && e.status === 'Active');
  const smp = (await intake('/samples/' + ent.sample_id)).sample;
  let inBatch = '';
  try { await intake(`/orders/${smp.lab_order_id}/cancel`, { test_ids: [ent.requested_test_id], reason: 'Test' }); } catch (e) { inBatch = e.message; }
  check('A test in an open batch is refused: take it out of the batch first', /is in batch BAT-000001: take it out of the batch first/.test(inBatch), inBatch);
  let sampInBatch = '';
  try { await intake(`/orders/${smp.lab_order_id}/cancel`, { sample_ids: [smp.id], reason: 'Test' }); } catch (e) { sampInBatch = e.message; }
  check('and so is its sample, saying which test', /cannot be cancelled: .*is in batch BAT-000001/.test(sampInBatch), sampInBatch);

  // ---- 2. the thermometer at receipt
  const oid2 = await newOrder('E2E-TH', 1);
  await intake('/orders/' + oid2, { row: { status: 'Submitted' } }, 'PUT');
  await signIn(page, BASE, 'Intake Tech (demo)', '#/orders/' + oid2); await go('#/orders/' + oid2);
  const cus = await intake(`/orders/${oid2}/custody`);
  check('Only thermometers available and in calibration are offered (the demo receiving thermometer first)', cus.thermometers.length >= 1 && /Receiving thermometer/.test(cus.thermometers[0].equipment_name));
  await page.click('#receive'); await page.waitForSelector('.modal #f_temperature');
  await page.fill('.modal #f_temperature', '4.5'); await page.click('.modal [data-ok]'); await page.waitForTimeout(500);
  check('A temperature without a thermometer is not accepted', /which thermometer/.test(await toasts()), await toasts());
  await page.click('#receive'); await page.waitForSelector('.modal #f_temperature');
  await page.fill('.modal #f_temperature', '4.5');
  await page.evaluate(() => { const s = document.querySelector('.modal #f_thermometer_id'); s.value = [...s.options].find((o) => /Receiving thermometer/.test(o.text)).value; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('.modal [data-ok]'); await sign(page); await page.waitForTimeout(2500);
  const ev = (await intake(`/orders/${oid2}/custody`)).events[0];
  check('The receipt names the thermometer (shown on the chain of custody card)', ev && ev.thermometer_code === cus.thermometers[0].equipment_code && (await page.locator('#ocus').innerText()).includes(ev.thermometer_code), JSON.stringify(ev && ev.thermometer_code));
  await shot('k02_receipt_thermometer');
  const pdf = await intake(`/orders/${oid2}/custody.pdf`);
  check('The chain of custody prints (PDF)', Buffer.isBuffer(pdf) && pdf.slice(0, 4).toString() === '%PDF');

  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('No native browser dialogs', native === 0);
  await b.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed} of ${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
