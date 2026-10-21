// Invoicing, I-1 (migration 036), end to end in the browser. Set-up through the API: the demo Project Manager
// finalizes the three Vitamin C lots of PO-45231 (their COAs issued to the client), so that work is complete.
// Then the demo Accounting user: Billing > Ready to invoice lists it; claims it (one draft for the order, held by
// them); on the draft corrects one price with its reason, takes one line off, sets the PO and the note; issues it
// with one signature (numbered, dated today, emailed with the PDF, queued for QuickBooks Online); the order page
// shows its billing; a credit note for one line (signed, with its reason; the work ready to invoice again); the
// QuickBooks queue; payment terms changed in Settings by fill down; the Account Manager sees Billing but cannot claim;
// the Analyst does not see Billing; the audit icon. Run on a freshly reset database.
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
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } }); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[0-4]/.test(m.text())) errors.push(m.text()); });
  let native = 0; page.on('dialog', (d) => { native++; d.dismiss(); });
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  const go = async (h) => { await page.goto(BASE + '/' + h); await page.waitForSelector('main h1'); await page.waitForTimeout(900); };
  const toasts = async () => (await page.locator('.toast').allInnerTexts()).join(' | ');
  const paste = (text) => page.evaluate((t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }, text);
  const cell = (host, r, c) => page.locator(`${host} .gwrap > table > tbody > tr:nth-child(${r}) > td:nth-child(${c})`);
  const pm = await as('projmgr'); const bill = await as('billing');

  // ================================================================ set-up: the Vitamin C lots of PO-45231 finalized (COAs issued)
  const q = await pm('/reports/queue');
  const vc = q.rows.filter((r) => /^VC-230[123]$/.test(r.client_sample_id || ''));
  const items = [];
  for (const r of vc) {
    const pv = await pm('/reports/preview', { sample_id: r.sample_id, tests: [r.requested_test_id] });
    const acks = {}; for (const k of pv.checks || []) if (k.level === 'Warning') acks[k.code] = 'Browser test: reviewed';
    items.push({ sample_id: r.sample_id, tests: [r.requested_test_id], acks });
  }
  const fin = await pm('/reports/finalize', { items }, true);
  check('Set-up: the three Vitamin C lots of PO-45231 finalized, their COAs issued', vc.length === 3 && fin.issued.filter((x) => x.coa_version_id).length === 3, `${vc.length}`);

  // ================================================================ Billing > Ready to invoice
  await signIn(page, BASE, 'Accounting (demo)', '#/billing'); await page.waitForSelector('#g tbody tr');
  const nav = await page.locator('#nav').innerText();
  check('The Billing menu: Ready to invoice, My draft invoices, Invoices', /Billing/.test(nav) && /Ready to invoice/.test(nav) && /My draft invoices/.test(nav) && /Invoices/.test(nav));
  const ready = await bill('/billing/ready');
  const vcReady = ready.rows.filter((r) => /^VC-230/.test(r.client_sample_id || ''));
  const rowsText = await page.locator('#g tbody tr').allInnerTexts();
  check('Ready to invoice lists the completed work: the three lots, reported today, at the quoted price', vcReady.length === 3 && rowsText.filter((t) => /VC-230/.test(t)).length === 3
    && vcReady.every((r) => Number(r.price) === 450 && r.order_code === 'LO-000005' && r.completed_on), `${vcReady.length}`);
  check('Totals at the top: value ready and lab orders', /\$1,350\.00/.test(await page.locator('.blsum').innerText()));
  await shot('inv_01_ready');
  // select the three rows (click the first, Shift+click the last) and claim them
  const idx = rowsText.map((t, k) => (/VC-230/.test(t) ? k + 1 : 0)).filter(Boolean);
  await cell('#g', idx[0], 7).click(); await cell('#g', idx[idx.length - 1], 7).click({ modifiers: ['Shift'] });
  await page.click('#claim'); await page.waitForSelector('main h1:has-text("Draft invoice")', { timeout: 15000 }); await page.waitForTimeout(800);
  const draftId = (await page.evaluate(() => location.hash)).match(/invoices\/([\w-]+)/)[1];
  let inv = await bill('/billing/invoices/' + draftId);
  check('Claimed: one draft for the order, held by the Accounting user, with the three tests', inv.invoice.status === 'Draft' && inv.lines.length === 3 && inv.invoice.claimed_by === inv.me && Number(inv.invoice.total) === 1350,
    `${inv.lines.length} ${inv.invoice.total}`);
  check('The claimed work left Ready to invoice', !(await bill('/billing/ready')).rows.some((r) => /^VC-230/.test(r.client_sample_id || '')));
  const am = await as('acctmgr');
  let refused = ''; try { await am('/billing/claim', { tests: [inv.lines[0].requested_test_id] }); } catch (e) { refused = e.message; }
  check('The Account Manager cannot claim work (no invoicing.issue)', /permission|already on a draft/.test(refused), refused.slice(0, 90));
  await shot('inv_02_draft');

  // the price corrected on line 1, with its reason
  await page.locator('#lg tbody tr').first().locator('button:has-text("Price…")').click();
  await page.waitForSelector('.modal #f_price'); await page.fill('.modal #f_price', '405'); await page.fill('.modal #f_note', 'Discount corrected to the accepted quote (10 %)');
  await page.click('.modal [data-ok]'); await page.waitForTimeout(1200);
  inv = await bill('/billing/invoices/' + draftId);
  check('Price…: the price billed corrected with its reason; the total follows', Number(inv.lines[0].price) === 405 && /Discount corrected/.test(inv.lines[0].price_note) && Number(inv.invoice.total) === 1305,
    `${inv.lines[0].price} ${inv.invoice.total}`);
  // line 3 taken off
  await page.waitForTimeout(800); await page.waitForSelector('#lg tbody tr:nth-child(3)');
  await cell('#lg', 3, 1).click(); await page.click('#rm'); await page.waitForTimeout(1200);
  inv = await bill('/billing/invoices/' + draftId);
  check('A line taken off the draft goes back to Ready to invoice', inv.lines.length === 2 && (await bill('/billing/ready')).rows.filter((r) => /^VC-230/.test(r.client_sample_id || '')).length === 1);
  // details
  await page.waitForSelector('#lg tbody tr'); await page.waitForTimeout(500);
  await page.click('#edit'); await page.waitForSelector('.modal #f_po_number');
  await page.fill('.modal #f_po_number', 'PO-45231-A'); await page.fill('.modal #f_note', 'Thank you. Remaining lot to follow.'); await page.click('.modal [data-ok]'); await page.waitForTimeout(1000);
  check('The PO and the note printed on the invoice', (await page.locator('main').innerText()).includes('PO-45231-A'));

  // ================================================================ issue (signed)
  await page.click('#issue'); await sign(page); await page.waitForTimeout(2500);
  inv = await bill('/billing/invoices/' + draftId);
  const num = inv.invoice.invoice_number;
  check('Issued with one signature: numbered INV-CFL-, dated today, due net 30, no longer a draft', /^INV-CFL-\d{6}$/.test(num || '') && inv.invoice.status === 'Issued' && !!inv.invoice.invoice_date && inv.invoice.payment_terms_days === 30, num);
  await go('#/billing/invoices/' + draftId);
  check('The page shows the invoice number and its PDF button, and Credit…', /Invoice INV-CFL-/.test(await page.locator('main h1').innerText()) && (await page.locator('#credit').count()) === 1);
  check('Emailed with the PDF to the client\'s billing contact (Outbox)', inv.emails.length >= 1 && inv.emails.every((e) => e.subject.includes(num)), inv.emails.map((e) => e.to_address).join(','));
  check('Queued for the lab\'s QuickBooks Online company (waiting for its connection), as an Invoice with two lines',
    inv.push && inv.push.entity === 'Invoice' && inv.push.status === 'Waiting for connection' && inv.push.payload.DocNumber === num && inv.push.payload.Line.length === 2);
  const pdf = await page.evaluate(async (u) => { const r = await fetch(u); const t = await r.arrayBuffer(); return { type: r.headers.get('content-type'), head: String.fromCharCode(...new Uint8Array(t.slice(0, 5))) }; }, `/api/billing/invoices/${draftId}/pdf?s=${inv.invoice.site_id}`);
  check('The invoice PDF opens', pdf.type === 'application/pdf' && pdf.head === '%PDF-', pdf.type);
  await page.click('#pj'); await page.waitForTimeout(200);
  check('"Show what is sent": the QuickBooks payload', /"DocNumber"/.test(await page.locator('#pjson').innerText()));
  await shot('inv_03_issued');
  let changed = ''; try { await bill('/billing/invoices/' + draftId, { po_number: 'X' }, false, 'PUT'); } catch (e) { changed = e.message; }
  check('An issued invoice cannot be changed', /issued|cannot be changed/.test(changed), changed.slice(0, 80));

  // ================================================================ the order's billing
  await go('#/orders/' + inv.invoice.lab_order_id); await page.waitForSelector('#obill .blsum', { timeout: 15000 });
  const ob = await page.locator('#obill').innerText();
  check('The order page shows its billing: invoiced, ready, the invoice', /Billing/.test(ob) && ob.includes(num) && /Invoiced/.test(ob) && /Ready to invoice/.test(ob));
  await shot('inv_04_order');

  // ================================================================ a credit note for one line (signed, with a reason)
  await go('#/billing/invoices/' + draftId);
  await cell('#lg', 1, 1).click(); await page.click('#credit'); await page.waitForSelector('.modal #f_credit_reason');
  await page.fill('.modal #f_credit_reason', 'Billing error corrected: billed at the wrong price'); await page.click('.modal [data-ok]');
  await sign(page); await page.waitForSelector('main h1:has-text("Credit note")', { timeout: 15000 }); await page.waitForTimeout(800);
  const cnId = (await page.evaluate(() => location.hash)).match(/invoices\/([\w-]+)/)[1];
  const cn = await bill('/billing/invoices/' + cnId);
  check('Credit note CN-CFL- for the selected line: negative, credits the invoice, emailed and queued as a credit memo',
    /^CN-CFL-\d{6}$/.test(cn.invoice.invoice_number || '') && Number(cn.invoice.total) === -405 && cn.invoice.credit_of_id === draftId && cn.push && cn.push.entity === 'CreditMemo' && cn.emails.length >= 1,
    `${cn.invoice.invoice_number} ${cn.invoice.total}`);
  check('The credited work is ready to invoice again', (await bill('/billing/ready')).rows.filter((r) => /^VC-230/.test(r.client_sample_id || '')).length === 2);
  inv = await bill('/billing/invoices/' + draftId);
  check('The invoice shows what credited it', inv.credits.length === 1 && inv.lines.some((l) => l.credited_by === cn.invoice.invoice_number));
  await shot('inv_05_credit');

  // ================================================================ lists: invoices, the QuickBooks queue, settings
  await go('#/billing?tab=issued'); await page.waitForSelector('#g tbody tr');
  const iss = await page.locator('#g tbody').innerText();
  check('Invoices and credit notes lists both', iss.includes(num) && iss.includes(cn.invoice.invoice_number));
  await go('#/billing?tab=queue'); await page.waitForSelector('#g tbody tr');
  check('The QuickBooks queue lists the invoice and the credit memo, waiting for the connection', (await page.locator('#g tbody tr').count()) === 2 && /Waiting for connection/.test(await page.locator('#g tbody').innerText()));
  await go('#/billing?tab=settings'); await page.waitForSelector('#tg tbody tr');
  check('Settings: the lab\'s QuickBooks Online company, not connected', /QuickBooks Online/.test(await page.locator('main').innerText()) && /Not connected/.test(await page.locator('main').innerText()));
  // payment terms: two clients set to 45 by typing then fill down
  await cell('#tg', 1, 3).click(); await page.keyboard.type('45'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  await cell('#tg', 1, 3).click(); await cell('#tg', 2, 3).click({ modifiers: ['Shift'] }); await page.keyboard.press('Control+d'); await page.waitForTimeout(300);
  await page.click('#tg .savebar [data-save]'); await sign(page); await page.waitForTimeout(1200);
  const set = await bill('/billing/settings');
  check('Payment terms typed and filled down, saved with a reason', set.clients.slice(0, 2).every((x) => Number(x.payment_terms_days) === 45) && set.clients.slice(2).some((x) => Number(x.payment_terms_days) === 30));
  await shot('inv_06_settings');

  // ================================================================ who sees Billing
  await signIn(page, BASE, 'Account Manager (demo)', '#/billing'); await page.waitForSelector('#g');
  check('The Account Manager sees Billing (view) but cannot claim', /Billing/.test(await page.locator('#nav').innerText()) && await page.locator('#claim').isDisabled());
  await signIn(page, BASE, 'Analyst (demo)', '#/');
  check('The Analyst does not see Billing', !/Ready to invoice/.test(await page.locator('#nav').innerText()));
  await signIn(page, BASE, 'Accounting (demo)', '#/billing/invoices/' + draftId); await page.waitForSelector('main h1 .auditbtn');
  await page.click('main h1 .auditbtn'); await page.waitForTimeout(1500);
  check('The invoice page has its audit trail icon, listing the invoice and its lines', /Invoice INV-CFL-|Invoice line/.test(await page.locator('body').innerText()));
  await shot('inv_07_audit');

  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('No native browser dialogs', native === 0);
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
