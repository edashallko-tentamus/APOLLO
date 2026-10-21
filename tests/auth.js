// Shared sign-in helpers for the browser tests (slice 3.2: real login and electronic signatures).
// prepareUsers() runs once on a FRESH test database: first-time setup for the administrator, then a temporary password
// for each demo user, changed to the test password from test-credentials.json. It refuses to touch a database whose
// administrator already has a password unless that password is the test password (i.e. an earlier test run).
'use strict';
const PASSWORD = require('./test-credentials.json').password;
const ADMIN = 'akiddle';
const USERS = { 'Alex Kiddle': 'akiddle', 'Lab Supervisor (demo)': 'labsup', 'Analyst (demo)': 'analyst', 'QA Reviewer (demo)': 'qa.reviewer', 'Intake Tech (demo)': 'intake', 'Account Manager (demo)': 'acctmgr', 'Project Manager (demo)': 'projmgr', 'Accounting (demo)': 'billing', 'Executive (demo)': 'exec', 'General Manager (demo)': 'gm', 'Finance (demo)': 'finance', 'Corporate QA (demo)': 'corp.qa' };

async function call(base, path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  const set = res.headers.get('set-cookie');
  return { ok: res.ok, status: res.status, data, cookie: set ? set.split(';')[0] : cookie };
}
async function login(base, username, password) {
  const r = await call(base, '/auth/login', { method: 'POST', body: { username, password } });
  if (!r.ok) throw new Error(`login ${username}: ${r.data.error}`);
  return r.cookie;
}

async function prepareUsers(base) {
  const st = (await call(base, '/auth/state')).data;
  let admin;
  if (st.setupNeeded) {
    const r = await call(base, '/auth/setup', { method: 'POST', body: { username: ADMIN, password: PASSWORD, confirm: PASSWORD } });
    if (!r.ok) throw new Error('setup: ' + r.data.error);
    admin = r.cookie;
  } else {
    try { admin = await login(base, ADMIN, PASSWORD); } catch (e) {
      throw new Error('This database already has a real administrator password. Run the browser tests on a fresh test database only.');
    }
  }
  const list = (await call(base, '/admin/users', { cookie: admin })).data.users;
  for (const u of list) {
    if (u.username === ADMIN || !u.is_active) continue;
    try { await login(base, u.username, PASSWORD); continue; } catch (_) { /* not set yet */ }
    const temp = 'Temp' + Math.random().toString(36).slice(2, 10) + '9z';
    const t = await call(base, `/admin/users/${u.id}/temp-password`, { method: 'POST', cookie: admin, body: { password: temp } });
    if (!t.ok) throw new Error(`temp password ${u.username}: ${t.data.error}`);
    const c = await login(base, u.username, temp);
    const ch = await call(base, '/auth/change-password', { method: 'POST', cookie: c, body: { current: temp, password: PASSWORD, confirm: PASSWORD } });
    if (!ch.ok) throw new Error(`change password ${u.username}: ${ch.data.error}`);
  }
}

// Sign in through the screen (signs out first if someone else is signed in). who: full name or user ID.
async function signIn(page, base, who = 'Alex Kiddle', hash = '#/') {
  const username = USERS[who] || who;
  await page.goto(base + '/' + hash);
  await page.waitForSelector('#loginScreen, #whoName:not(:empty)');
  const current = await page.evaluate(() => document.querySelector('#whoName small')?.textContent || '');
  if (current.split(' ')[0] === username && !(await page.$('#loginScreen'))) return;
  if (!(await page.$('#loginScreen'))) {
    await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }));
    await page.goto(base + '/' + hash); await page.reload(); await page.waitForSelector('#loginScreen'); // a hash-only goto does not reload
  }
  await page.waitForTimeout(120); // let the sign-in screen settle (it focuses its first field)
  await page.fill('#lg_user', username); await page.fill('#lg_pass', PASSWORD);
  await page.click('#loginScreen button[type=submit]');
  try { await page.waitForSelector('#loginScreen', { state: 'detached', timeout: 10000 }); }
  catch (e) { throw new Error(`sign-in as ${username} failed: ${await page.locator('#loginScreen .merr').innerText().catch(() => '?')} [${await page.locator('#loginScreen h3').innerText().catch(() => '?')}]`); }
  await page.waitForSelector('main h1'); await page.waitForTimeout(300);
}

// Complete the electronic signature dialog: a canned reason (or typed Other text) if asked, then the password.
async function sign(page, { reason = null, password = PASSWORD, expectError = false } = {}) {
  await page.waitForSelector('.sigmodal');
  if (await page.$('.sigmodal #f_rpick')) {
    if (reason) { // typed: Other
      await page.evaluate(() => { const s = document.querySelector('#f_rpick'); s.value = '__other__'; s.dispatchEvent(new Event('change', { bubbles: true })); });
      await page.fill('.sigmodal #f_rtext', reason);
    } else {
      await page.evaluate(() => { const s = document.querySelector('#f_rpick'); s.selectedIndex = 1; s.dispatchEvent(new Event('change', { bubbles: true })); });
    }
  }
  if (await page.$('.sigmodal #f_spass')) await page.fill('.sigmodal #f_spass', password);
  await page.click('.sigmodal [data-ok]');
  if (expectError) { await page.waitForFunction(() => document.querySelector('.sigmodal .merr')?.textContent.trim()); return page.textContent('.sigmodal .merr'); }
  await page.waitForSelector('.sigmodal', { state: 'detached', timeout: 15000 });
  return null;
}

// Workflow verification (WD-6): CFL and TPS approve a version only with a signed, passing verification of it. The
// suites that approve versions run one through the API: the analyst writes the protocol, QA approves it, the analyst
// executes it, QA signs the report. Returns the outcome (Pass, Pass with exceptions or Fail).
async function verifyVersion(base, versionId, site = 'CFL') {
  const as = async (who) => {
    const cookie = await login(base, who, PASSWORD);
    const users = (await call(base, '/users', { cookie })).data;
    const siteId = users.find((u) => u.username === who).sites.find((x) => x.site_code === site).id;
    return async (p, body) => {
      const res = await fetch(base + '/api' + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-site-id': siteId },
        body: JSON.stringify({ ...body, signature: { username: who, password: PASSWORD } }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`verification ${p}: ${data.error}`);
      return data;
    };
  };
  const ana = await as('analyst'); const qa = await as('qa.reviewer');
  const w = await ana(`/verification/versions/${versionId}/protocol`, {});
  await qa(`/verification/${w.id}/approve-protocol`, {});
  const run = await ana(`/verification/${w.id}/execute`, {});
  // The screenshots are captured in the background right after the run; the report cannot be signed without them
  const cookieQa = await login(base, 'qa.reviewer', PASSWORD);
  for (let i = 0; ; i += 1) {
    const d = await (await fetch(base + `/api/verification/${w.id}`, { headers: { Cookie: cookieQa } })).json();
    if (d.verification.evidence_captured_at) break;
    if (!d.capturing) {   // the background capture may finish between the two checks: then it is already captured
      try { await ana(`/verification/${w.id}/capture-evidence`, {}); } catch (e) { if (!/already captured/.test(e.message)) throw e; }
      break;
    }
    if (i > 120) throw new Error('verification: the evidence capture did not finish');
    await new Promise((ok) => setTimeout(ok, 1000));
  }
  const just = {};
  if (run.outcome === 'Pass with exceptions') {
    const doc = await (await fetch(base + `/api/verification/${w.id}`, { headers: { Cookie: await login(base, 'qa.reviewer', PASSWORD) } })).json();
    for (const r of doc.requirements.filter((x) => x.result === 'Not tested')) just[r.req_code] = 'Browser test: accepted for the test data';
  }
  await qa(`/verification/${w.id}/sign-report`, { conclusion: 'Browser test run', justifications: just });
  return run.outcome;
}

module.exports = { prepareUsers, signIn, sign, call, login, verifyVersion, PASSWORD, USERS };
