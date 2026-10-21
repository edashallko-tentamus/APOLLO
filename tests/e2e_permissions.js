// Phase 1, Permissions (migration 008): a lab's groups and what they may do, people in several groups (permissions add
// up), signed changes, the permission matrix with its Excel download and change history, the view-only Executive group,
// and the Admin menu following the person's permissions. Run on a freshly reset database.
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, sign } = require('./auth');
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (l, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };

(async () => {
  await prepareUsers(BASE);
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1600, height: 950 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[0-3]/.test(m.text())) errors.push(m.text()); });
  let native = 0; page.on('dialog', (d) => { native++; d.dismiss(); });
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  const go = async (h) => { await page.goto(BASE + '/' + h); await page.waitForSelector('main h1'); await page.waitForTimeout(500); };
  const h1 = async () => (await page.locator('main h1').innerText()).trim();
  const head = async (host) => (await page.locator(`${host} thead th`).allInnerTexts()).map((t) => t.trim());
  const col = async (host, title) => (await head(host)).indexOf(title) + 1;
  const toasts = async () => (await page.locator('.toast').allInnerTexts()).join(' | ');

  // ---- Groups and permissions (Alex, CFL)
  await signIn(page, BASE, 'Alex Kiddle', '#/admin/groups');
  await page.waitForSelector('#pg tbody tr');
  check('Groups page lists the standard groups plus the lab-defined HPTLC group',
    await (async () => { const t = await page.locator('#gg').innerText(); return ['Administrator', 'QA', 'Lab Supervisor', 'General Manager', 'Analyst', 'Intake', 'Account Manager', 'HPTLC'].every((n) => t.includes(n)); })());
  const permHead = await head('#pg');
  check('Permission grid has a column per group, and the all-labs Executive column', permHead.includes('HPTLC') && permHead.includes('Executive (all labs)'));
  await shot('60_groups_permissions');

  // new group "Micro bench" (signed; the seeded Microbiology group is a department group since WD-1)
  const n0 = await page.locator('#gg tbody tr').count();
  await page.click('#gg [data-add="1"]');
  await page.locator(`#gg tbody tr:nth-child(${n0 + 1}) td:nth-child(1)`).click(); await page.keyboard.type('Micro bench'); await page.keyboard.press('Tab');
  await page.locator(`#gg tbody tr:nth-child(${n0 + 1}) td:nth-child(2)`).click(); await page.keyboard.type('Micro bench: plating, counts and media'); await page.keyboard.press('Enter');
  await page.click('#gg .savebar [data-save]'); await sign(page); await page.waitForTimeout(900);
  check('New group created with a signature', /Micro bench/.test(await page.locator('#gg').innerText()) && /Saved and signed/.test(await toasts()));

  // give Micro bench two permissions with fill down (orders.edit then inventory.use rows are not adjacent: tick both)
  const micro = await col('#pg', 'Micro bench');
  const rowOf = async (code) => { const c = await col('#pg', 'Code'); return (await page.locator(`#pg tbody tr td:nth-child(${c})`).allInnerTexts()).findIndex((t) => t.trim() === code) + 1; };
  for (const code of ['orders.edit', 'inventory.use', 'inventory.edit']) {
    await page.locator(`#pg tbody tr:nth-child(${await rowOf(code)}) td:nth-child(${micro}) .chk`).click();
  }
  await page.click('#pg .savebar [data-save]'); await sign(page, { reason: 'New micro bench group' }); await page.waitForTimeout(900);
  const microRow = async (code) => page.locator(`#pg tbody tr:nth-child(${await rowOf(code)}) td:nth-child(${micro}) .chk.on`).count();
  check('Micro bench now holds orders.edit, inventory.use and inventory.edit', (await microRow('orders.edit')) === 1 && (await microRow('inventory.use')) === 1 && (await microRow('inventory.edit')) === 1);
  check('The Executive (all labs) column cannot be given a change permission', await (async () => {
    const ex = await col('#pg', 'Executive (all labs)'); const cell = page.locator(`#pg tbody tr:nth-child(${await rowOf('orders.edit')}) td:nth-child(${ex})`);
    return /\bro\b/.test(await cell.getAttribute('class'));
  })());

  // ---- People and groups: QA Reviewer also joins Micro bench (permissions add up)
  await go('#/admin/users'); await page.waitForSelector('#g tbody tr');
  const qaRow = page.locator('#g tbody tr', { hasText: 'QA Reviewer' });
  await qaRow.locator(`td:nth-child(${await col('#g', 'Micro bench')}) .chk`).click();
  await page.click('.savebar [data-save]'); await sign(page, { reason: 'Covering the micro bench' }); await page.waitForTimeout(900);
  check('QA Reviewer is in QA and Micro bench at CFL', (await qaRow.locator(`td:nth-child(${await col('#g', 'QA')}) .chk.on`).count()) === 1
    && (await qaRow.locator(`td:nth-child(${await col('#g', 'Micro bench')}) .chk.on`).count()) === 1);
  await shot('61_people_groups');

  // ---- Permission matrix and history
  await go('#/admin/permissions'); await page.waitForSelector('#mg tbody tr');
  const mRow = page.locator('#mg tbody tr', { hasText: 'QA Reviewer' });
  const ordersCol = (await page.locator('#mg thead th').evaluateAll((ths) => ths.map((t) => t.title))).findIndex((t) => /\(orders\.edit\)/.test(t)) + 1;
  check('Matrix: QA Reviewer now holds orders.edit (through Micro bench)', (await mRow.locator(`td:nth-child(${ordersCol})`).innerText()).includes('✓')
    && /QA, Micro bench|Micro bench, QA/.test(await mRow.innerText()));
  check('Matrix shows system administrators as such', /System administrator/.test(await page.locator('#mg tbody tr', { hasText: 'Alex Kiddle' }).innerText()));
  const hist = await page.locator('#hg').innerText();
  check('Change history shows the membership, who signed and why', /QA Reviewer \(demo\) added to Micro bench/.test(hist) && /Covering the micro bench/.test(hist) && /Alex Kiddle \(Approved by\)/.test(hist));
  const dl = await page.evaluate(async (u) => { const r = await fetch(u); return { status: r.status, type: r.headers.get('content-type'), size: (await r.arrayBuffer()).byteLength }; },
    await page.locator('a', { hasText: 'Download matrix' }).getAttribute('href'));
  check('Matrix downloads as an Excel file', dl.status === 200 && /spreadsheetml/.test(dl.type) && dl.size > 1000, JSON.stringify(dl));
  const dh = await page.evaluate(async (u) => (await fetch(u)).status, await page.locator('a', { hasText: 'Download change history' }).getAttribute('href'));
  check('Change history downloads as an Excel file', dh === 200);
  await shot('62_permission_matrix');

  // ---- QA Reviewer signed in: their groups show; the Admin menu follows their permissions
  await signIn(page, BASE, 'QA Reviewer (demo)');
  check('Header shows the groups held in this lab', /QA/.test(await page.locator('#whoName small').getAttribute('title')) && /Micro bench/.test(await page.locator('#whoName small').getAttribute('title')));
  check('QA sees Units and Canned reasons but not People and groups', (await page.locator('nav a[href="#/admin/units"]').count()) === 1 && (await page.locator('nav a[href="#/admin/users"]').count()) === 0);
  check('QA (audit.view) can open the permission matrix', (await page.locator('nav a[href="#/admin/permissions"]').count()) === 1);
  await go('#/admin/groups');
  check('QA sees the groups read-only', /You can view the groups/.test(await page.locator('main').innerText()));

  // ---- Executive: every lab, view only
  await signIn(page, BASE, 'exec');
  await page.click('#labBtn');
  check('Executive can open every lab', (await page.locator('#labMenu button').count()) >= 2); await page.click('main');
  check('Header says view only', /view only/.test(await page.locator('#whoName small').innerText()));
  await go('#/orders');
  check('Executive sees the lab\'s orders', (await page.locator('#g tbody tr').count()) >= 1);
  const refused = await page.evaluate(async () => {
    const me = (await (await fetch('/api/users')).json()).find((u) => u.username === 'exec');
    const site = me.sites.find((s) => s.site_code === 'CFL').id;
    const setup = await (await fetch('/api/clients', { headers: { 'x-site-id': site } })).json();
    const r = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-site-id': site }, body: JSON.stringify({ row: { client_id: setup[0].id } }) });
    return { status: r.status, error: (await r.json()).error };
  });
  check('Executive cannot create an order (refused by the database)', refused.status === 400 && /permission/i.test(refused.error), refused.error);
  check('Executive\'s Admin menu has only the view pages (no People and groups, no lists)', (await page.locator('nav a[href="#/admin/users"]').count()) === 0
    && (await page.locator('nav a[href="#/admin/units"]').count()) === 0 && (await page.locator('nav a[href="#/admin/permissions"]').count()) === 1);
  await shot('63_executive');

  check('No native browser dialogs', native === 0);
  check('No browser errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\nTOTAL: ${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
