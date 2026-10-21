// 0.35.0: lists one page at a time, the search box at the top of every page, dashboards refreshed on request.
// 60 contacts are added by API so the Contacts list has two pages: 50 on page 1, Next, the search narrowing it on the
// server. On Inventory and Lab orders a typed or scanned ID (Enter) opens its record, a sample ID on the orders list
// opens the sample. The header search finds a batch by its ID (Enter opens it) and lists clients and contacts for a
// name (a click opens the client). Every other paged list opens with its tabs and page buttons.
// Run on a freshly reset database.
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, login, call } = require('./auth');
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
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${who} ${p}: ${data.error}`);
    return data;
  };
}

(async () => {
  await prepareUsers(BASE);
  const admin = await as('akiddle');
  // 60 contacts, so the Contacts list has a second page
  await admin('/contacts/bulk', { rows: Array.from({ length: 60 }, (_, i) => ({ first_name: 'Pager', last_name: `Person ${String(i + 1).padStart(2, '0')}`, email: `pager${i + 1}@example.test`, status: 'Active', portal_access: false })), reason: 'Paging test contacts' });
  const sample = (await admin('/orders?page=1&f=all')).rows.length ? (await admin('/orders/' + (await admin('/orders?page=1&f=all')).rows.find((o) => o.logged_count > 0).id)).samples.find((s) => s.sample_code) : null;

  const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[0-4]/.test(m.text())) errors.push(m.text()); });
  let native = 0; page.on('dialog', async (d) => { native++; await d.dismiss(); });
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  await signIn(page, BASE, 'Alex Kiddle');

  // ---------------------------------------------------------------- Contacts: two pages
  await page.goto(BASE + '/#/contacts'); await page.waitForSelector('.pgbar .pginfo:not(:empty)');
  const info1 = await page.locator('.pgbar .pginfo').innerText();
  const rows1 = await page.locator('.pgbody .grid tbody tr').count();
  check('Contacts: 50 on the first page, of more than 60', /^1–50 of (\d+)/.test(info1) && Number(info1.match(/of (\d+)/)[1]) >= 66, info1);
  check('Contacts: page 1 of 2', /Page 1 of 2/.test(await page.locator('.pgbar .pgof').innerText()));
  check('Contacts: the grid shows only that page', rows1 <= 52, `${rows1} rows`);
  await shot('pg01_contacts_page1');
  await page.click('.pgbar .pgnext'); await page.waitForFunction(() => /Page 2 of 2/.test(document.querySelector('.pgbar .pgof').textContent));
  check('Next shows page 2', /^51–/.test(await page.locator('.pgbar .pginfo').innerText()), await page.locator('.pgbar .pginfo').innerText());
  check('Previous is enabled and Next is not on the last page', !(await page.locator('.pgbar .pgprev').isDisabled()) && await page.locator('.pgbar .pgnext').isDisabled());
  await page.fill('.pgbar .pgsearch', 'Person 37'); await page.waitForFunction(() => /^1–1 of 1 /.test(document.querySelector('.pgbar .pginfo').textContent));
  check('The search narrows the whole list on the server to one contact', /Person 37/.test(await page.locator('.pgbody').innerText()));
  check('The page and search are kept in the address (Back returns to them)', /find=Person/.test(page.url()), page.url());

  // ---------------------------------------------------------------- Inventory: a scanned ID opens the item
  await page.goto(BASE + '/#/inventory'); await page.waitForSelector('.pgbar .pginfo:not(:empty)');
  check('Inventory: tabs with their counts', /Active\s*\d+/.test(await page.locator('.pgtabs').innerText()), await page.locator('.pgtabs').innerText());
  await page.fill('.pgbar .pgsearch', 'INV-000001'); await page.press('.pgbar .pgsearch', 'Enter');
  await page.waitForURL(/#\/inventory\/lots\/[0-9a-f-]{36}/, { timeout: 8000 }).catch(() => {});
  check('Inventory: a scanned lot ID (Enter) opens the item', /#\/inventory\/lots\/[0-9a-f-]{36}$/.test(page.url()), page.url());
  await page.waitForLoadState('networkidle');

  // ---------------------------------------------------------------- Lab orders: a sample ID opens the sample
  await page.goto(BASE + '/#/orders'); await page.waitForSelector('.pgbar .pginfo:not(:empty)');
  check('Lab orders: Current, Reported and All tabs', /Current/.test(await page.locator('.pgtabs').innerText()) && /Reported/.test(await page.locator('.pgtabs').innerText()));
  if (sample) {
    await page.fill('.pgbar .pgsearch', sample.sample_code.toLowerCase()); await page.press('.pgbar .pgsearch', 'Enter');
    await page.waitForURL(/#\/samples\//, { timeout: 8000 }).catch(() => {});
    check('Lab orders: a sample ID typed in any case (Enter) opens the sample', page.url().endsWith('#/samples/' + sample.id), page.url());
    await page.waitForLoadState('networkidle');
  } else check('Lab orders: a logged sample to scan exists', false);

  // ---------------------------------------------------------------- the search box at the top of every page
  check('The search box is at the top of the page', await page.locator('#gsInput').isVisible());
  await page.fill('#gsInput', 'BAT-000001'); await page.press('#gsInput', 'Enter');
  await page.waitForURL(/#\/testing\/batches\/[0-9a-f-]{36}/, { timeout: 8000 }).catch(() => {});
  check('Search: a batch ID (Enter) opens the batch', /#\/testing\/batches\/[0-9a-f-]{36}/.test(page.url()), page.url());
  await page.waitForLoadState('networkidle');
  await page.fill('#gsInput', 'acme'); await page.waitForSelector('#gsPop:not([hidden]) .gsrow');
  const found = await page.locator('#gsPop').innerText();
  check('Search: a name lists clients and contacts, grouped by kind', /Client/.test(found) && /Contact/.test(found), found.replace(/\s+/g, ' ').slice(0, 160));
  await shot('pg02_search');
  await page.locator('#gsPop .gsrow').first().click(); await page.waitForURL(/#\/clients\//, { timeout: 8000 }).catch(() => {});
  check('Search: a click on a result opens its page', /#\/clients\/[0-9a-f-]{36}/.test(page.url()), page.url());
  await page.keyboard.press('Control+k');
  check('Ctrl+K puts the cursor in the search box', await page.evaluate(() => document.activeElement && document.activeElement.id === 'gsInput'));
  await page.keyboard.press('Escape');

  // ---------------------------------------------------------------- the other paged lists open
  for (const [hash, label] of [['#/clients', 'Clients'], ['#/projects', 'Projects'], ['#/outbox', 'Outbox'], ['#/equipment', 'Equipment'], ['#/purchasing', 'Purchasing requests'],
    ['#/purchasing/orders', 'Purchase orders'], ['#/quotes?tab=all', 'Quotes'], ['#/testing/batches?show=all', 'All batches'], ['#/oos', 'OOS investigations'],
    ['#/stability/studies', 'Stability studies'], ['#/billing?tab=issued', 'Issued invoices'], ['#/reports/finalization?tab=issued', 'Issued COAs']]) {
    await page.goto(BASE + '/' + hash); await page.waitForLoadState('networkidle');
    const ok = await page.waitForSelector('.pgbar .pgof:not(:empty)', { timeout: 8000 }).then(() => true).catch(() => false);
    check(`${label}: one page at a time with page buttons`, ok && /Page 1 of/.test(await page.locator('.pgbar .pgof').innerText()));
  }

  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('No native browser dialogs', native === 0);
  await b.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed} of ${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
