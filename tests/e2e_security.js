// 0.32.0: the security slice. Security headers on pages and API answers; the sign-in page, the app and the public
// verification page run under the Content-Security-Policy with no errors; stored files are shown in the browser only
// when they are really a PDF or a picture (an HTML file, or HTML pretending to be a PDF, is downloaded with a safe
// type; a script inside an SVG does not run); too many wrong passwords from one computer are refused for a while,
// and so are too many requests to the public pages. Run on a freshly reset database.
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
  const fn = async (p, body) => {
    const res = await fetch(BASE + '/api' + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-site-id': site }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${who} ${p}: ${data.error}`);
    return data;
  };
  fn.raw = (p) => fetch(BASE + '/api' + p, { headers: { Cookie: cookie, 'x-site-id': site } });
  fn.cookie = cookie; fn.site = site;
  return fn;
}

(async () => {
  await prepareUsers(BASE);
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[0-4]/.test(m.text())) errors.push(m.text()); });
  let native = 0; page.on('dialog', (d) => { native++; d.dismiss(); });

  // ---- 1. headers
  const home = await fetch(BASE + '/');
  const csp = home.headers.get('content-security-policy') || '';
  check('A page carries a Content-Security-Policy without inline scripts', /script-src 'self'(;|$)/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp), csp.slice(0, 80));
  check('Nothing on a page is loaded from elsewhere', /default-src 'self'/.test(csp) && /object-src 'none'/.test(csp) && /base-uri 'none'/.test(csp));
  check('Pages: no type sniffing, same-origin framing and referrer', home.headers.get('x-content-type-options') === 'nosniff'
    && home.headers.get('x-frame-options') === 'SAMEORIGIN' && home.headers.get('referrer-policy') === 'same-origin');
  check('No HSTS when the app is not served over HTTPS', !home.headers.get('strict-transport-security'));
  const bad = await fetch(BASE + '/%E0%A4%A');
  check('A broken address is refused and the server keeps running', bad.status === 400 && (await fetch(BASE + '/')).status === 200, bad.status);
  check('Nothing outside the page folder is served', (await fetch(BASE + '/..%2Fpackage.json')).status === 403);
  const big = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(6e6) }).then((r) => r.status, () => 'closed');
  check('An upload over 5 MB is refused and the server keeps running', big !== 200 && (await fetch(BASE + '/')).status === 200, big);
  const st = await fetch(BASE + '/api/auth/state');
  check('API answers carry the same headers', st.headers.get('x-content-type-options') === 'nosniff' && st.headers.get('x-frame-options') === 'SAMEORIGIN');
  const lr = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'labsup', password: PASSWORD }) });
  const ck = lr.headers.get('set-cookie') || '';
  check('The session cookie is HttpOnly and SameSite=Strict (Secure only behind HTTPS)', /HttpOnly/.test(ck) && /SameSite=Strict/.test(ck) && !/Secure/.test(ck));

  // ---- 2. the app, the sign-in page and the public pages run under the policy
  await signIn(page, BASE, 'Lab Supervisor (demo)', '#/');
  await page.goto(BASE + '/#/orders'); await page.waitForSelector('main h1'); await page.waitForTimeout(800);
  await page.goto(BASE + '/#/inventory'); await page.waitForSelector('main h1'); await page.waitForTimeout(800);
  check('The app works under the policy (no blocked scripts or errors)', !errors.length, errors.slice(0, 2).join(' | '));
  await page.goto(BASE + '/verify.html?c=NOPE-NOPE-NOPE'); await page.waitForSelector('#out:not([hidden]) .res', { timeout: 8000 }).catch(() => {});
  check('The public verification page runs its script from a file', /No certificate has this verification code/.test(await page.textContent('#out').catch(() => '')));
  for (const p of ['quote-response.html', 'oos-response.html']) {
    const html = await (await fetch(BASE + '/' + p)).text();
    check(p + ' has no inline script', !/<script>/.test(html) && /<script src="\/js\/public\//.test(html));
  }
  await page.screenshot({ path: path.join(OUT, 'sec_verify.png') });

  // ---- 3. stored files
  const sup = await as('labsup');
  const orders = await sup('/orders');
  let sampleId = null;
  for (const o of orders.slice(0, 15)) { const d = await sup('/orders/' + o.id); const s = (d.samples || [])[0]; if (s) { sampleId = s.id; break; } }
  check('A CFL sample to attach files to', !!sampleId);
  const upload = async (file_name, mime_type, buf) => (await sup(`/samples/${sampleId}/attachments`, { file_name, mime_type, b64: buf.toString('base64'), kind: 'Other', reason: 'Security test' })).id;
  const html = Buffer.from('<html><body><script>document.title="pwned"</script>Hello</body></html>');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>document.title="pwned"</script><rect width="10" height="10"/></svg>');
  const ids = { html: await upload('page.html', 'text/html', html), fakePdf: await upload('report.pdf', 'application/pdf', html),
    png: await upload('photo.png', 'image/png', png), svg: await upload('logo.svg', 'image/svg+xml', svg), lyingPng: await upload('x.png', 'text/html', png) };
  const head = async (id) => { const r = await sup.raw(`/attachments/${id}/file`); return { type: r.headers.get('content-type'), disp: r.headers.get('content-disposition') || '', csp: r.headers.get('content-security-policy') || '', nosniff: r.headers.get('x-content-type-options') }; };
  let h = await head(ids.html);
  check('An uploaded HTML file is downloaded, never shown', h.type === 'application/octet-stream' && /^attachment/.test(h.disp) && /sandbox/.test(h.csp) && h.nosniff === 'nosniff', JSON.stringify(h));
  h = await head(ids.fakePdf);
  check('HTML pretending to be a PDF is downloaded, never shown', h.type === 'application/octet-stream' && /^attachment/.test(h.disp), JSON.stringify(h));
  h = await head(ids.png);
  check('A real picture is shown in the browser (sandboxed)', h.type === 'image/png' && /^inline/.test(h.disp) && /sandbox/.test(h.csp), JSON.stringify(h));
  h = await head(ids.lyingPng);
  check('A picture uploaded with the wrong type is shown as what it is', h.type === 'image/png', JSON.stringify(h));
  h = await head(ids.svg);
  check('An SVG is shown sandboxed', h.type === 'image/svg+xml' && /sandbox/.test(h.csp), JSON.stringify(h));
  await page.goto(BASE + `/api/attachments/${ids.svg}/file?s=${sup.site}`); await page.waitForTimeout(600);
  check('A script inside an SVG does not run', (await page.title()) !== 'pwned');
  const coaPdf = await sup.raw(`/attachments/${ids.png}/file`);
  check('Stored files are not cached by the browser', /no-store|private/.test(coaPdf.headers.get('cache-control') || ''));

  // ---- 3b. one lab's people do not read another lab's records
  const tps = await as('labsup', 'TPS'); const ana = await as('analyst');
  const tpsOrders = await tps('/orders'); let tpsOrder = tpsOrders[0] || null; let tpsTest = null;
  for (const o of tpsOrders.slice(0, 15)) { const d = await tps('/orders/' + o.id); const t = (d.tests || [])[0]; if (t) { tpsOrder = o; tpsTest = t; break; } }
  check('A TPS order to try', !!tpsOrder);
  const isRefused = async (p) => { try { await ana(p); return false; } catch (e) { return true; } };
  check("A CFL analyst cannot open a TPS order" + (tpsTest ? " or read its test's analytes" : ''), (await isRefused('/orders/' + tpsOrder.id)) && (!tpsTest || await isRefused(`/requested-tests/${tpsTest.id}/analytes`)));
  const tpsSite = (await (await fetch(BASE + '/api/users', { headers: { Cookie: tps.cookie } })).json()).find((u) => u.username === 'labsup').sites.find((x) => x.site_code === 'TPS').id;
  check("A CFL analyst cannot read TPS's holidays or images", (await isRefused(`/sites/${tpsSite}/holidays`)) && (await isRefused(`/sites/${tpsSite}/media`)));
  const anaAudit = await ana(`/audit?table=lab_order&record=${tpsOrder.id}`);
  const tpsAudit = await tps(`/audit?table=lab_order&record=${tpsOrder.id}`);
  check("The audit trail page shows a TPS order's entries to TPS, not to a CFL analyst", tpsAudit.length > 0 && anaAudit.length === 0, `${tpsAudit.length} / ${anaAudit.length}`);
  const tpsIds = new Set(tpsOrders.map((o) => o.id));
  const anaOrders = await ana('/audit?table=lab_order');
  check("The audit trail page leaves out every TPS order for a CFL analyst", tpsIds.size > 0 && !anaOrders.some((a) => tpsIds.has(a.record_id)), `${anaOrders.length} entries`);
  const execAudit = await (await as('exec'))(`/audit?table=lab_order&record=${tpsOrder.id}`);
  check('An all-labs group still sees every lab in the audit trail', execAudit.length === tpsAudit.length);

  // ---- 4. public pages: too many requests from one computer
  let tooMany = null;
  for (let i = 0; i < 130 && !tooMany; i++) { const r = await fetch(BASE + '/api/public/coa/RATE-TEST-' + i); if (r.status === 429) tooMany = (await r.json()).error; }
  check('Too many requests to the public pages are refused for a minute', /Too many requests from this computer/.test(tooMany || ''), tooMany || 'never refused');

  // ---- 5. wrong passwords from one computer
  let refused = null; let n = 0;
  for (; n < 25 && !refused; n++) {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'nobody' + n, password: 'wrong-password-1' }) });
    if (r.status === 429) refused = (await r.json()).error;
  }
  check('After 20 wrong passwords this computer is refused for a while', n === 21 && /Too many wrong passwords from this computer/.test(refused || ''), `after ${n}: ${refused}`);
  const okLogin = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'labsup', password: PASSWORD }) });
  check('Even the right password waits until the pause is over', okLogin.status === 429);
  const sig = await fetch(BASE + '/api/inventory/me', { headers: { Cookie: sup.cookie, 'x-site-id': sup.site } });
  check('People already signed in keep working', sig.ok);

  check('No native browser dialogs', native === 0);
  await b.close();
  const pass = results.filter(Boolean).length;
  console.log(`\n${pass} passed, ${results.length - pass} failed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
