// 0.32.0 (migration 055): client licenses, the METRC ID, the photos already attached. The Intake Tech adds a license
// with its scanned copy on Acme's page, two more by API (one expiring within 30 days, one expired): the client page
// warns, Intake > Client licenses lists them first; the expired one is retired (a reason is required) and is no longer
// offered. A lab order names a license (Edit order); a METRC ID is checked and stored in capitals; the COA preview of
// a sample waiting in Report Finalization prints its order's license and its METRC ID. Opening "Add photos" on a
// sample that has a photo shows it, and marking a new photo for its report place says it replaces the one marked.
// Run on a freshly reset database.
const path = require('path'); const fs = require('fs'); const zlib = require('zlib');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, sign, login, call } = require('./auth');
const PASSWORD = require('./test-credentials.json').password;
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (l, ok, x = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };   // the local date, as the lab sees it
const METRC = '1A4060300001234000012345';

// a plain 4:3 PNG
function png(w, h, rgb) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xFFFFFFFF; for (const x of b) c = crcT[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; } }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

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
  const intake = await as('intake'); const pm = await as('projmgr'); const ana = await as('analyst');
  const acme = (await intake('/clients')).find((c) => c.client_code === 'CL-00005');

  // ---- 1. a license added on the client's page, with its scanned copy
  await signIn(page, BASE, 'Intake Tech (demo)', '#/clients/' + acme.id); await go('#/clients/' + acme.id);
  check('The client page has a Licenses card with "+ Add license"', /Licenses/.test(await page.locator('main').innerText()) && (await page.locator('#addlic').count()) === 1);
  await page.click('#addlic'); await page.waitForSelector('.modal #f_license_type');
  check('The license type offers the usual types and can be typed', (await page.locator('.modal datalist option').count()) >= 5);
  await page.fill('.modal #f_license_type', 'Cannabis distributor'); await page.fill('.modal #f_license_number', 'C11-0000123-LIC');
  await page.fill('.modal #f_issuing_authority', 'California DCC'); await page.fill('.modal #f_issued_on', day(-200)); await page.fill('.modal #f_expires_on', day(165));
  await page.setInputFiles('.modal #f_licfile', { name: 'dcc-license.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.click('.modal [data-ok]'); await page.waitForTimeout(1500);
  check('Adding it gives a LIC- code', /LIC-\d{5} added/.test(await toasts()), await toasts());
  let lg = await page.locator('#lg').innerText();
  check('The Licenses grid lists it: type, number, issuer, Current, its copy', /Cannabis distributor/.test(lg) && /C11-0000123-LIC/.test(lg) && /California DCC/.test(lg) && /Current/.test(lg) && /dcc-license\.pdf/.test(lg), lg.replace(/\s+/g, ' ').slice(0, 300));
  let cd = await intake('/clients/' + acme.id);
  const dist = cd.licenses.find((l) => l.license_number === 'C11-0000123-LIC');
  const copy = await intake(`/licenses/${dist.id}/file`);
  check('The scanned copy is kept and opens (a PDF)', Buffer.isBuffer(copy) && copy.slice(0, 4).toString() === '%PDF');

  // ---- 2. additive: two more, expiring and expired; warnings
  const soon = await intake(`/clients/${acme.id}/licenses`, { license_type: 'Cannabis manufacturer', license_number: 'CDPH-10077', issuing_authority: 'California DCC', expires_on: day(12) });
  const old = await intake(`/clients/${acme.id}/licenses`, { license_type: 'Cannabis microbusiness', license_number: 'C12-0000999', expires_on: day(-4) });
  await go('#/clients/' + acme.id);
  const warn = await page.locator('main .notice').first().innerText().catch(() => '');
  check('The client page warns about the licenses to renew: the one expiring in 12 days and the expired one', /Licenses to renew/.test(warn) && /CDPH-10077/.test(warn) && /12 days/.test(warn) && /C12-0000999/.test(warn) && /expired/.test(warn) && !/C11-0000123-LIC/.test(warn), warn);
  lg = await page.locator('#lg').innerText();
  check('Licenses are added, never replaced: all three are listed', ['C11-0000123-LIC', 'CDPH-10077', 'C12-0000999'].every((n) => lg.includes(n)));
  await shot('l01_client_licenses');
  await go('#/licenses');
  check('Intake > Client licenses is in the menu', (await page.locator('nav a[href="#/licenses"]').count()) === 1);
  const due = await page.locator('#g tbody tr').allInnerTexts();
  check('Intake > Client licenses lists the expired one first, then the one expiring, and not the current one', due.length >= 2 && /C12-0000999/.test(due[0]) && due.some((t) => /CDPH-10077/.test(t)) && !due.some((t) => /C11-0000123-LIC/.test(t)), due.map((t) => t.replace(/\s+/g, ' ').slice(0, 80)).join(' | '));
  await go('#/licenses?show=all');
  check('"All current" lists every active license', /C11-0000123-LIC/.test(await page.locator('#g').innerText()));

  // ---- 3. retiring needs a reason; a retired license is not offered
  let noWhy = '';
  try { await intake(`/licenses/${old.id}`, { retire: true, reason: 'Retire test' }, 'PUT'); } catch (e) { noWhy = e.message; }
  check('Retiring without saying why is refused', /Say why/.test(noWhy), noWhy);
  await go('#/clients/' + acme.id);
  const retRow = page.locator('#lg tbody tr', { hasText: 'C12-0000999' });
  await retRow.locator('button', { hasText: 'Retire…' }).click(); await page.waitForSelector('.modal #f_retired_reason');
  check('Retiring asks why, from a short list', (await page.locator('.modal #f_retired_reason option').allInnerTexts()).join() === 'Replaced by a renewal,Expired, not renewed,Entered in error,Surrendered or revoked');
  await page.click('.modal [data-ok]');
  await sign(page, { reason: 'License renewed' }); await page.waitForTimeout(1200);
  cd = await intake('/clients/' + acme.id);
  const ret = cd.licenses.find((l) => l.id === old.id);
  check('Retired from the grid (why, then the Reason for Change): kept, shown as Retired', ret.status_text === 'Retired' && ret.retired_reason === 'Replaced by a renewal' && /Retired/.test(await page.locator('#lg').innerText()));
  let analystErr = '';
  try { await ana(`/clients/${acme.id}/licenses`, { license_type: 'Business license', license_number: 'BL-1' }); } catch (e) { analystErr = e.message; }
  check('The Analyst (no master.clients) cannot add a license', /master\.clients/.test(analystErr), analystErr);

  // ---- 4. the lab order names a license; the METRC ID
  const ordering = (await intake('/order-setup/' + acme.id)).contacts[0].id;
  const ord = await intake('/orders', { row: { client_id: acme.id, ordering_contact_id: ordering, po_number: 'E2E-LIC' } });
  await intake(`/orders/${ord.id}/samples`, { rows: [{ client_sample_id: 'LIC-A', matrix: 'Powder' }] });
  await go('#/orders/' + ord.id);
  check('The order shows "Client license" (none yet)', /Client license\s*—/.test(await page.locator('main').innerText()));
  await page.click('#edit'); await page.waitForSelector('.modal #f_client_license_id');
  const opts = await page.locator('.modal #f_client_license_id option').allInnerTexts();
  check('Edit order offers the client\'s current licenses (expiring marked), not the retired one', opts.some((t) => /C11-0000123-LIC/.test(t)) && opts.some((t) => /CDPH-10077.*expiring soon/.test(t)) && !opts.some((t) => /C12-0000999/.test(t)), opts.join(' | '));
  await page.evaluate((v) => { const s = document.querySelector('.modal #f_client_license_id'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, dist.id);
  await page.click('.modal [data-ok]'); await page.waitForTimeout(400);
  if (await page.$('.sigmodal')) await sign(page, { reason: 'License for the order' });
  await page.waitForTimeout(1200);
  check('The order now names the distributor license', /Client license\s*Cannabis distributor C11-0000123-LIC/.test(await page.locator('main').innerText()));
  check('The samples grid has a METRC ID column', (await page.locator('#sg th', { hasText: 'METRC ID' }).count()) >= 1);
  let od = await intake('/orders/' + ord.id);
  const sId = od.samples[0].id;
  let bad = '';
  try { await intake(`/orders/${ord.id}/samples`, { rows: [{ id: sId, metrc_id: '1A40603' }] }); } catch (e) { bad = e.message; }
  check('A METRC ID that is not a METRC tag is refused', /not a METRC tag/.test(bad), bad);
  await intake(`/orders/${ord.id}/samples`, { rows: [{ id: sId, metrc_id: '1a40 6030 0001 2340 0001 2345' }] });
  od = await intake('/orders/' + ord.id);
  check('A METRC ID is stored in capitals without spaces', od.samples[0].metrc_id === METRC, od.samples[0].metrc_id);
  await go('#/samples/' + sId);
  check('The sample page shows the METRC ID', (await page.locator('main').innerText()).includes(METRC));

  // ---- 5. the COA prints the order's license and the METRC ID
  const q = await pm('/reports/queue'); const qrows = q.rows || q;
  const vc = qrows.filter((r) => r.client_sample_id === 'VC-2302');
  const vs = (await intake('/samples/' + vc[0].sample_id)).sample;
  const vo = await intake('/orders/' + vs.lab_order_id);
  const vlic = await intake(`/clients/${vo.order.client_id}/licenses`, { license_type: 'State manufacturer', license_number: 'SM-55501', issuing_authority: 'CDPH', expires_on: day(300) });
  await intake('/orders/' + vs.lab_order_id, { row: { client_license_id: vlic.id }, reason: 'License for the COA test' }, 'PUT');
  await intake(`/orders/${vs.lab_order_id}/samples`, { rows: [{ id: vs.id, metrc_id: METRC }], reason: 'METRC tag for the COA test' });
  const pv = await pm('/reports/preview', { sample_id: vc[0].sample_id, tests: vc.map((r) => r.requested_test_id || r.id) });
  check('The COA content carries the order\'s license (type, number, issuer) and the METRC ID', pv.content.order.license === 'State manufacturer SM-55501 (CDPH)' && pv.content.sample.metrc_id === METRC, JSON.stringify({ l: pv.content.order.license, m: pv.content.sample.metrc_id }));
  check('The preview PDF is made and every checked cell reads back', !!pv.token && !pv.checks.some((x) => x.code === 'pdf' && x.level === 'Block'));
  const pdf = await pm('/reports/preview/' + pv.token);
  check('The preview is a PDF', Buffer.isBuffer(pdf) && pdf.slice(0, 4).toString() === '%PDF');

  // ---- 6. "Add photos" shows the photos already attached
  await intake(`/samples/${sId}/photos`, { photos: [{ base64: png(800, 600, [200, 190, 160]).toString('base64'), caption: 'Jar as received', report_slot: 1 }] });
  await go('#/samples/' + sId);
  await page.click('#phadd'); await page.waitForSelector('.modal #phhave .phcard');
  const have = await page.locator('.modal #phhave').innerText();
  check('Opening "Add photos" shows the photo already attached, its report place and caption', /Already attached \(1\)/.test(have) && /Report photo 1/.test(have) && /Jar as received/.test(have), have.replace(/\s+/g, ' '));
  await page.setInputFiles('.modal #f_ph', [{ name: 'lid.png', mimeType: 'image/png', buffer: png(800, 600, [150, 170, 200]) }]);
  await page.waitForSelector('.modal .phitem');
  const slotText = await page.locator('.modal .phitem .phslot option[value="1"]').innerText();
  check('Marking a new photo Report photo 1 says it takes the place of the one marked now', /instead of the one now marked/.test(slotText), slotText);
  await shot('l02_photos_dialog');
  await page.click('.modal [data-x]');

  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('No native browser dialogs', native === 0);
  await b.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed} of ${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
