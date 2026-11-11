// K-1 KPIs (0.37.0, migration 059), end to end in the browser. The GM dashboard: the Lab Score, the top 20 tests
// (orders, swing flag, revenue, top 3 clients), the top 20 clients (CM, PM, CY, PY), the lab's departments with
// their work, People with its This month / Last month tabs. The executive dashboard: the Lab Score of every lab, the
// top 10 departments across labs with % of lab and % of group, the clients' % of group, and no People. Home: the Lab
// Supervisor has People and My numbers, the Analyst My numbers only (and is refused People through its address).
// Run on a freshly reset database.
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, call, login } = require('./auth');
const PASSWORD = require('./test-credentials.json').password;
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (l, ok, x = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };

async function as(who) {
  const cookie = await login(BASE, who, PASSWORD);
  const users = (await call(BASE, '/users', { cookie })).data;
  const site = users.find((u) => u.username === who).sites.find((s) => s.site_code === 'CFL').id;
  return async (p) => {
    const res = await fetch(BASE + '/api' + p, { headers: { Cookie: cookie, 'x-site-id': site } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${who} ${p}: ${data.error}`);
    return data;
  };
}
const head = (w) => (w && w.data && (w.data.table || (w.data.tabbed && w.data.tabbed.tables.cm)) || { columns: [] }).columns.map((c) => c.t);

(async () => {
  await prepareUsers(BASE);
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1600, height: 1100 } }); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[0-4]/.test(m.text())) errors.push(m.text()); });
  let native = 0; page.on('dialog', (d) => { native++; d.dismiss(); });
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });

  // ================================================================ the GM dashboard
  const gm = await as('gm');
  const g = await gm('/dashboard/gm');
  const W = (d, code) => d.widgets.find((w) => w.code === code);
  check('The GM dashboard has the Lab Score, Top 20 tests, Top 20 clients, Departments and People', ['lab_score', 'top_tests', 'top_clients', 'departments', 'staff'].every((c) => W(g, c) && !W(g, c).error),
    g.widgets.filter((w) => w.error).map((w) => w.code + ': ' + w.error).join(' | '));
  check('The Lab Score comes first', g.widgets[0].code === 'lab_score');
  const ls = W(g, 'lab_score').data;
  const score = ls.kpis && ls.kpis[0];
  check('One lab: the score this month and last month as figures out of 100, and its parts in the table',
    score && /Lab Score this month/.test(score.label) && (score.value === null || (score.value >= 0 && score.value <= 100))
    && ['Samples on time', 'Revenue vs budget', 'Revenue vs forecast'].every((t) => head(W(g, 'lab_score')).includes(t)), JSON.stringify(ls.table.rows[0]));
  const row = ls.table.rows[0];
  const part = (i) => row[i].v;
  const parts = [[part(3), 60], [part(4), 10], [part(5), 30]].filter(([v]) => v !== null);
  const expect = parts.length ? Math.round(parts.reduce((a, [v, w]) => a + v * w, 0) / parts.reduce((a, [, w]) => a + w, 0)) : null;
  check('The score is 60 % on time, 10 % against budget, 30 % against forecast (parts with nothing to judge left out)', Math.abs((row[1].v ?? -1) - (expect ?? -1)) <= 1, `${row[1].v} vs ${expect}`);
  check('Revenue attainment counts up to 100 %', [part(4), part(5)].every((v) => v === null || v <= 100));

  const tt = W(g, 'top_tests').data.table;
  const orders = tt.rows.map((r) => r[1].v);
  check('Top tests: at most 20, ranked by orders in the last 12 months', tt.rows.length > 0 && tt.rows.length <= 20 && orders.every((v, i) => i === 0 || v <= orders[i - 1]), orders.join(','));
  check('...with this month, last month, the swing flag, revenue this month and this year, % of revenue and the top 3 clients',
    ['This month', 'Last month', 'Swing', 'Revenue this month', 'Revenue this year', '% of revenue', 'Top 3 clients (orders, 12 months)'].every((t) => head(W(g, 'top_tests')).includes(t)));
  check('...each test links to its catalogue entry and lists at most 3 clients, each a link', tt.rows.every((r) => /^#\/catalog\//.test(r[0].href) && r[8].links.length >= 1 && r[8].links.length <= 3 && r[8].links.every((l) => /^#\/clients\//.test(l.href))));
  check('...the swing column says high or low only when the month is flagged', tt.rows.every((r) => (r[4].text !== '') === (r[3].tone === 'flag')));

  const tc = W(g, 'top_clients').data.table;
  check('Top clients: CM, PM, CY, PY to date, PY and % of lab', ['CM', 'PM', 'CY', 'PY to date', 'PY', '% of lab'].every((t) => head(W(g, 'top_clients')).includes(t)) && tc.rows.length <= 20);
  const cys = tc.rows.map((r) => r[3].v);
  check('...ranked by this year\'s revenue', cys.every((v, i) => i === 0 || v <= cys[i - 1]), cys.join(','));

  const dp = W(g, 'departments').data.table;
  check('Departments (GM): every department of the lab, with revenue, % of lab and the work (reported, on time, backlog, median days, returned)',
    dp.rows.length >= 2 && ['% of lab', 'Tests reported (CM)', 'On time (CM)', 'Backlog now', 'Median lab days', 'Batches returned (CM)'].every((t) => head(W(g, 'departments')).includes(t)) && !head(W(g, 'departments')).includes('% of group'),
    dp.rows.map((r) => r[0].text).join(','));
  const year = W(g, 'revenue').data.kpis.find((k) => k.label === 'This year').value;
  const deptCy = dp.rows.reduce((a, r) => a + r[3].v, 0);
  check('...the departments\' revenue this year is no more than the lab\'s (charges have no department)', deptCy <= year + 0.01, `${deptCy} vs ${year}`);
  const backlog = dp.rows.reduce((a, r) => a + r[9].v, 0);
  check('...some work waits in the backlog (the demo)', backlog >= 1, String(backlog));

  const st = W(g, 'staff').data.tabbed;
  check('People: This month and Last month tabs, with batches, tests, on time, reviews, tests finalized and revenue (not steps signed or batches returned)',
    st && st.tabs.map((t) => t[1]).join('|') === 'This month|Last month'
    && ['Batches', 'Tests', 'On time', 'Batches reviewed', 'Tests finalized', 'Revenue CM', 'Revenue PM', 'Revenue YTD', '% of lab'].every((t) => head(W(g, 'staff')).includes(t))
    && !['Steps signed', 'Batches returned'].some((t) => head(W(g, 'staff')).includes(t)), head(W(g, 'staff')).join('|'));

  await signIn(page, BASE, 'General Manager (demo)', '#/dashboard/gm'); await page.waitForSelector('#dgrid .dw[data-code="lab_score"] .dk');
  check('In the browser: the Lab Score figure and its table', (await page.locator('.dw[data-code="lab_score"] table.kt tbody tr').count()) === 1);
  check('...Top 20 tests as a table with links', (await page.locator('.dw[data-code="top_tests"] table.kt tbody tr').count()) === tt.rows.length && (await page.locator('.dw[data-code="top_tests"] tbody a[href^="#/clients/"]').count()) >= 1);
  const pw = page.locator('.dw[data-code="staff"]');
  await pw.locator('[data-tab="pm"]').click(); await page.waitForTimeout(200);
  check('...People switches to Last month', (await pw.locator('[data-tab="pm"]').getAttribute('class')).includes('on'));
  await shot('kpi_01_gm');

  // ================================================================ the executive dashboard
  const ex = await as('exec');
  const e = await ex('/dashboard/executive');
  check('The executive dashboard has the Lab Score, Top 20 tests, Top 20 clients and Departments, and no People',
    ['lab_score', 'top_tests', 'top_clients', 'departments'].every((c) => W(e, c) && !W(e, c).error) && !W(e, 'staff'));
  const els = W(e, 'lab_score').data.table.rows.map((r) => r[0].text);
  check('Lab Score: every lab, best first', els.includes('CFL') && els.includes('TPS'), els.join(','));
  const ed = W(e, 'departments').data.table;
  check('Top 10 departments across all labs: Lab, Department, CM, PM, CY, PY to date, PY, % of lab, % of group',
    ed.rows.length <= 10 && ['Lab', 'Department', 'CM', 'PM', 'CY', 'PY to date', 'PY', '% of lab', '% of group'].every((t) => head(W(e, 'departments')).includes(t))
    && !head(W(e, 'departments')).includes('Backlog now'));
  check('...ranked by this year\'s revenue', ed.rows.every((r, i) => i === 0 || r[4].v <= ed.rows[i - 1][4].v));
  check('Top clients across labs show % of group', head(W(e, 'top_clients')).includes('% of group'));
  check('Top tests across labs show each test\'s lab', head(W(e, 'top_tests')).includes('Lab'));
  await signIn(page, BASE, 'Executive (demo)', '#/dashboard/executive'); await page.waitForSelector('#dgrid .dw[data-code="departments"]');
  check('In the browser: the executive Lab Score lists the labs', (await page.locator('.dw[data-code="lab_score"] table.kt tbody tr').count()) >= 2);
  await shot('kpi_02_executive');

  // ================================================================ Home
  const sup = await as('labsup');
  const sh = await sup('/dashboard/home');
  check('The Lab Supervisor\'s Home has People and My numbers', ['staff', 'my_numbers'].every((c) => sh.widgets.some((w) => w.code === c && !w.error)));
  check('...People on a Lab Supervisor\'s Home shows no revenue (no revenue permission)', !head(sh.widgets.find((w) => w.code === 'staff')).some((t) => /Revenue|% of lab/.test(t)));
  const ana = await as('analyst');
  const ah = await ana('/dashboard/home');
  check('The Analyst\'s Home has My numbers, not People', ah.widgets.some((w) => w.code === 'my_numbers') && !ah.widgets.some((w) => w.code === 'staff'));
  const mine = ah.widgets.find((w) => w.code === 'my_numbers').data.kpis;
  check('My numbers: the person\'s own figures this month, last month under each', mine.length === 7 && mine.every((k) => /last month/.test(k.sub)), mine.map((k) => k.label + '=' + k.value).join(', '));
  let refused = ''; try { await ana('/dashboard/gm'); } catch (x) { refused = x.message; }
  check('The Analyst cannot open the GM dashboard (and its People) through its address', /General Managers/.test(refused), refused.slice(0, 80));
  await signIn(page, BASE, 'Analyst (demo)', '#/'); await page.waitForSelector('#dgrid .dw[data-code="my_numbers"] .dk');
  check('In the browser: My numbers on the Analyst\'s Home', (await page.locator('.dw[data-code="my_numbers"] .dk > *').count()) === 7);
  await shot('kpi_03_home');

  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('No native browser dialogs', native === 0);
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
