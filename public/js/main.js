// Router and layout
import { state, api, toast, esc, isDirty, setDirtyCheck, confirmBox, modal, currentUser, currentSite, hooks, canAny, myGroups } from './app.js';
import { enhanceAll } from './combo.js';
import { initSearch } from './search.js';
import * as master from './pages/master.js';
import * as clients from './pages/clients.js';
import * as catalog from './pages/catalog.js';
import * as projects from './pages/projects.js';
import * as orders from './pages/orders.js';
import * as intake from './pages/intake.js';
import * as admin from './pages/admin.js';
import * as inventory from './pages/inventory.js';
import * as permissions from './pages/permissions.js';
import * as equipment from './pages/equipment.js';
import * as purchasing from './pages/purchasing.js';
import * as methods from './pages/methods.js';
import * as testing from './pages/testing.js';
import * as verification from './pages/verification.js';
import * as reports from './pages/reports.js';
import * as oos from './pages/oos.js';
import * as quotes from './pages/quotes.js';
import * as labsetup from './pages/labsetup.js';
import * as stability from './pages/stability.js';
import * as logbooks from './pages/logbooks.js';
import * as billing from './pages/billing.js';
import * as dashboard from './pages/dashboard.js';
import * as trending from './pages/trending.js';
import * as sensors from './pages/sensors.js';
import * as waste from './pages/waste.js';
import * as training from './pages/training.js';
import { iconFor } from './icons.js';

// The menu, in sections (Alex, 2026-10-13). An item with permission codes shows only to people who hold one of them in
// the lab being worked in; a heading shows only when at least one of its items does.
const NAV = [
  { items: [['#/', 'Home'], ['#/dashboard/gm', 'GM dashboard', ['dashboard.gm']], ['#/dashboard/executive', 'Executive dashboard', ['dashboard.executive']],
    ['#/dashboard/finance', 'Finance figures', ['finance.enter']]] },
  { head: 'Intake', items: [['#/orders', 'Lab orders'], ['#/intake', 'Intake dashboard'], ['#/clients', 'Clients'], ['#/licenses', 'Client licenses'], ['#/contacts', 'Contacts'], ['#/outbox', 'Outbox']] },
  { head: 'Testing', items: [['#/testing', 'Backlog'], ['#/testing/batches?show=mine', 'My worklist'], ['#/testing/batches', 'Batches'], ['#/testing/batches?show=review', 'QC Review'], ['#/reports/finalization', 'Report Finalization', ['reports.finalize']],
    ['#/oos', 'OOS investigations', ['oos.open', 'oos.approve', 'testing.review', 'reports.finalize']], ['#/stability/studies', 'Stability studies'], ['#/logbooks', 'Logbooks'], ['#/trending', 'Trending', ['trending.view']], ['#/training', 'Training and competency']] },
  { head: 'Lab supplies', items: [['#/inventory', 'Inventory'], ['#/purchasing', 'Purchasing'], ['#/equipment', 'Equipment']] },
  { head: 'Pricing', items: [['#/quotes', 'Quotes'], ['#/stability/quotes', 'Stability quotes'], ['#/projects', 'Projects'], ['#/rush', 'Rush fee schedules']] },
  { head: 'Billing', items: [['#/billing', 'Ready to invoice', ['invoicing.view', 'invoicing.issue']], ['#/billing?tab=mine', 'My draft invoices', ['invoicing.issue']],
    ['#/billing?tab=issued', 'Invoices', ['invoicing.view', 'invoicing.issue']]] },
];
const ADMIN_NAV = [
  { head: 'Tests and workflows', items: [['#/methods', 'Tests and workflows'], ['#/catalog', 'Test catalogue'], ['#/analytes', 'Analytes'],
    ['#/admin/units', 'Units', ['master.units']], ['#/admin/conversions', 'Unit conversions', ['master.units']], ['#/admin/matrices', 'Matrices', ['master.matrices', 'master.compliance']]] },
  { head: 'QA', items: [['#/logbooks/review', 'Logbook review', ['logbook.review']], ['#/admin/reasons', 'Canned reasons', ['master.reasons']], ['#/oos/config', 'OOS checklists', ['oos.configure']], ['#/audit', 'Audit trail']] },
  { head: 'Personnel', items: [['#/admin/users', 'People and groups', ['admin.users']], ['#/admin/dashboard-widgets', 'Dashboard widgets', ['admin.groups']], ['#/admin/groups', 'Groups and permissions', ['admin.groups', 'admin.users', 'audit.view']],
    ['#/admin/permissions', 'Permission matrix', ['admin.groups', 'admin.users', 'audit.view']]] },
  { head: 'Lab setup', items: [['#/admin/sites', 'Sites and holidays', ['admin.lab']], ['#/admin/report-templates', 'Report templates', ['reports.templates', 'admin.lab']], ['#/admin/waste', 'Waste classifications', ['inventory.lists', 'admin.lab']], ['#/stability/setup', 'Stability chambers', ['stability.configure', 'admin.lab']], ['#/sensors', 'Sensors', ['sensors.configure', 'logbook.review', 'admin.lab']]] },
];
const ROUTES = [
  [/^#\/?$/, dashboard.home],
  [/^#\/dashboard\/gm$/, dashboard.gm],
  [/^#\/dashboard\/executive$/, dashboard.executive],
  [/^#\/dashboard\/finance$/, dashboard.finance],
  [/^#\/admin\/dashboard-widgets$/, dashboard.widgetsAdmin],
  [/^#\/start$/, master.dashboard],
  [/^#\/clients$/, clients.list],
  [/^#\/licenses/, clients.licenses],
  [/^#\/clients\/([\w-]+)$/, clients.detail],
  [/^#\/contacts$/, master.contacts],
  [/^#\/analytes$/, master.analytes],
  [/^#\/rush$/, master.rush],
  [/^#\/rush\/([\w-]+)$/, master.rush],
  [/^#\/catalog$/, catalog.list],
  [/^#\/catalog\/packages\/([\w-]+)$/, catalog.packageEditor],
  [/^#\/catalog\/([\w-]+)$/, catalog.editor],
  [/^#\/quotes$/, quotes.list],
  [/^#\/quotes\/([\w-]+)$/, quotes.open],
  [/^#\/projects$/, projects.list],
  [/^#\/projects\/([\w-]+)$/, projects.detail],
  [/^#\/quote\/([\w-]+)$/, projects.version],
  [/^#\/print\/([\w-]+)$/, projects.print],
  [/^#\/audit$/, master.audit],
  [/^#\/orders$/, orders.list],
  [/^#\/orders\/([\w-]+)$/, orders.detail],
  [/^#\/samples\/([\w-]+)$/, orders.sample],
  [/^#\/intake$/, intake.dashboard],
  [/^#\/outbox$/, intake.outbox],
  [/^#\/admin\/users$/, admin.users],
  [/^#\/admin\/matrices$/, admin.matrices],
  [/^#\/admin\/sites$/, intake.sites],
  [/^#\/admin\/sites\/([\w-]+)$/, intake.sites],
  [/^#\/sites$/, intake.sites], // old address
  [/^#\/inventory$/, inventory.lots],
  [/^#\/inventory\/lots\/([\w-]+)$/, inventory.lot],
  [/^#\/inventory\/lots\/([\w-]+)\/edit$/, inventory.itemPage],
  [/^#\/inventory\/new$/, inventory.itemPage],
  [/^#\/inventory\/mixture$/, inventory.mixturePage],
  [/^#\/inventory\/receive$/, inventory.receiveMany],
  [/^#\/inventory\/samples$/, inventory.samples],
  [/^#\/inventory\/suppliers$/, inventory.suppliers],
  [/^#\/inventory\/locations$/, inventory.locations],
  [/^#\/inventory\/locations\/([\w-]+)$/, inventory.locationPage],
  [/^#\/inventory\/thresholds$/, inventory.thresholds],
  [/^#\/inventory\/qa-testing$/, inventory.qaTesting],
  [/^#\/equipment$/, equipment.list],
  [/^#\/equipment\/due$/, equipment.due],
  [/^#\/equipment\/lists$/, equipment.lists],
  [/^#\/equipment\/new$/, equipment.form],
  [/^#\/equipment\/add$/, equipment.addMany],
  [/^#\/equipment\/([\w-]+)\/edit$/, equipment.form],
  [/^#\/equipment\/([\w-]+)$/, equipment.detail],
  [/^#\/purchasing$/, purchasing.requests],
  [/^#\/purchasing\/requests\/([\w-]+)$/, purchasing.request],
  [/^#\/purchasing\/receive$/, purchasing.receive],
  [/^#\/purchasing\/orders$/, purchasing.orders],
  [/^#\/purchasing\/orders\/([\w-]+)$/, purchasing.order],
  [/^#\/purchasing\/suppliers$/, purchasing.suppliers],
  [/^#\/purchasing\/vendors$/, purchasing.suppliers],
  [/^#\/purchasing\/suppliers\/([\w-]+)$/, purchasing.supplier],
  [/^#\/purchasing\/risk-classes$/, purchasing.riskClasses],
  [/^#\/purchasing\/settings$/, purchasing.settings],
  [/^#\/testing$/, testing.backlog],
  [/^#\/testing\/batches$/, testing.batches],
  [/^#\/testing\/batches\/([\w-]+)$/, testing.batchPage],
  [/^#\/methods$/, methods.list],
  [/^#\/methods\/sops$/, methods.sops],
  [/^#\/methods\/tests\/([\w-]+)$/, methods.testPage],
  [/^#\/methods\/versions\/([\w-]+)$/, methods.designer],
  [/^#\/verification\/([\w-]+)$/, verification.page],
  [/^#\/reports\/finalization$/, reports.queue],
  [/^#\/reports\/review$/, reports.review],
  [/^#\/oos$/, oos.list],
  [/^#\/oos\/config$/, oos.config],
  [/^#\/oos\/([\w-]+)$/, oos.page],
  [/^#\/admin\/roles$/, permissions.groups], // old address (Job roles were replaced by groups)
  [/^#\/admin\/groups$/, permissions.groups],
  [/^#\/admin\/permissions$/, permissions.matrix],
  [/^#\/admin\/units$/, inventory.units],
  [/^#\/admin\/conversions$/, inventory.conversions],
  [/^#\/admin\/reasons$/, admin.reasons],
  [/^#\/admin\/report-templates$/, labsetup.reportTemplates],
  [/^#\/admin\/waste$/, waste.wastePage],
  [/^#\/training$/, training.overview],
  [/^#\/training\/people\/([\w-]+)$/, training.person],
  [/^#\/training\/attempts\/([\w-]+)$/, training.attempt],
  [/^#\/stability\/quotes$/, stability.quotes],
  [/^#\/stability\/quotes\/([\w-]+)$/, stability.quote],
  [/^#\/stability\/?(?:studies)?$/, stability.studies],
  [/^#\/stability\/studies\/([\w-]+)$/, stability.study],
  [/^#\/stability\/setup$/, stability.setup],
  [/^#\/billing$/, billing.list],
  [/^#\/billing\/invoices\/([\w-]+)$/, billing.invoice],
  [/^#\/sensors$/, sensors.page],
  [/^#\/trending$/, trending.watch],
  [/^#\/trending\/build$/, trending.builder],
  [/^#\/trending\/charts$/, trending.charts],
  [/^#\/trending\/charts\/([\w-]+)$/, trending.chart],
  [/^#\/trending\/reports$/, trending.reports],
  [/^#\/logbooks$/, logbooks.list],
  [/^#\/logbooks\/review$/, logbooks.review],
  [/^#\/logbooks\/entries\/([\w-]+)$/, logbooks.entry],
  [/^#\/logbooks\/([\w-]+)$/, logbooks.page],
];

let lastHash = location.hash;
let asking = false;
async function route() {
  // In-page dialog, not the browser's confirm(): embedded browsers (e.g. the Claude desktop
  // browser pane) block native dialogs, which used to trap users on a page with unsaved edits.
  if (isDirty()) {
    if (asking) return;
    const target = location.hash;
    history.replaceState(null, '', lastHash);
    asking = true;
    const leave = await confirmBox('Unsaved changes', 'You have changes on this page that are not saved. Leave without saving them?', 'Leave without saving');
    asking = false;
    if (!leave) return;
    setDirtyCheck(null);
    history.replaceState(null, '', target);
  }
  setDirtyCheck(null);
  lastHash = location.hash;
  const full = location.hash || '#/';
  const [h, q = ''] = full.split('?');
  state.query = new URLSearchParams(q);
  document.body.classList.toggle('printing', h.startsWith('#/print/'));
  markNav();
  // each page draws into its own fresh container (0.35.0): a page still loading when the person moves on draws into
  // its old, detached container, never over the page they went to
  const main = document.createElement('div'); main.className = 'view';
  document.getElementById('main').replaceChildren(main);
  for (const [re, fn] of ROUTES) {
    const m = h.match(re);
    if (m) {
      main.innerHTML = '<div class="loading">Loading…</div>';
      try { await fn(main, ...m.slice(1)); } catch (e) { main.innerHTML = `<div class="card err">${esc(e.message)}</div>`; }
      window.scrollTo(0, 0);
      return;
    }
  }
  main.innerHTML = '<div class="card">Page not found.</div>';
}

// Each menu section has its own colour (UI refresh, 2026-10-14); a page wears the colour and icon of its menu item
const SEC = { Intake: 'intake', Testing: 'testing', 'Lab supplies': 'supplies', Pricing: 'pricing', Billing: 'pricing' };
function renderNav() {
  const u = currentUser();
  const shown = (sec) => sec.items.filter(([, , codes]) => !codes || (u && canAny(codes)));
  const section = (sec, cls, isAdmin) => {
    const it = shown(sec); const k = isAdmin ? 'admin' : SEC[sec.head] || 'home';
    return it.length ? `${sec.head ? `<div class="${cls}" data-sec="${k}">${esc(sec.head)}</div>` : ''}${it.map(([h, l]) => `<a href="${h}" data-sec="${k}"><span class="nico">${iconFor(h)}</span>${esc(l)}</a>`).join('')}` : '';
  };
  const admin = ADMIN_NAV.map((s) => section(s, 'navsub', true)).join('');
  document.getElementById('nav').innerHTML = NAV.map((s) => section(s, 'navsub')).join('') + (admin ? `<div class="navhead">Admin</div>${admin}` : '');
  markNav();
}
// The menu item for this page: the link that matches the address exactly, else the longest one it starts with
function markNav() {
  const full = location.hash || '#/'; const h = full.split('?')[0];
  const links = [...document.querySelectorAll('nav a')];
  const fits = (href) => href === full || (!href.includes('?') && (href === h || (href !== '#/' && h.startsWith(href + '/'))));
  const best = links.filter((a) => fits(a.getAttribute('href'))).sort((a, b) => (b.getAttribute('href') === full) - (a.getAttribute('href') === full) || b.getAttribute('href').length - a.getAttribute('href').length)[0];
  links.forEach((a) => a.classList.toggle('on', a === best));
  document.body.dataset.sec = best ? best.dataset.sec : 'home';
  pageIcon = best ? best.querySelector('.nico').innerHTML : '';
  document.querySelectorAll('main .phead').forEach(decorateHead);
}
// the page title wears its menu item's icon (beside the title, so the title's text is unchanged)
let pageIcon = '';
function decorateHead(ph) {
  const first = ph.firstElementChild; if (!first || !pageIcon || ph.closest('.modal')) return;
  let chip = first.querySelector(':scope > .pchip');
  if (!chip) { chip = document.createElement('span'); chip.className = 'pchip'; chip.setAttribute('aria-hidden', 'true'); first.prepend(chip); first.classList.add('haschip'); }
  chip.innerHTML = pageIcon.replace(/width="18" height="18"/, 'width="20" height="20"');
}

// Lab switcher: the icon shows the lab prefix; only the user's assigned labs are offered
function pickSite() {
  const u = currentUser(); const sites = u ? u.sites : [];
  let saved = null; try { saved = localStorage.getItem('lims3.site.' + state.user); } catch (_) { /* storage blocked */ }
  state.site = sites.some((s) => s.id === state.site) ? state.site : sites.some((s) => s.id === saved) ? saved : sites[0]?.id || null;
}
function renderLab() {
  const u = currentUser(); const sites = u ? u.sites : []; const cur = currentSite();
  const btn = document.getElementById('labBtn'); const menu = document.getElementById('labMenu');
  btn.textContent = cur ? cur.site_code : 'No lab';
  btn.title = cur ? `Working in ${cur.site_code} (${cur.site_name}). ${sites.length > 1 ? 'Click to switch lab.' : ''}` : 'You are not assigned to a lab. Ask an administrator.';
  btn.classList.toggle('none', !cur);
  menu.innerHTML = sites.map((s) => `<button data-site="${s.id}" class="${s.id === state.site ? 'on' : ''}"><b>${esc(s.site_code)}</b> ${esc(s.site_name)}</button>`).join('')
    || '<div class="help">No labs assigned.</div>';
}
function setSite(id) {
  state.site = id; try { localStorage.setItem('lims3.site.' + state.user, id); } catch (_) { /* ignore */ }
  renderLab(); renderNav(); renderWho(); renderLabLogo(); route();
}

// ---- Sign in (slice 3.2): user ID and password; first run lets the administrator set their own password ----
// The product name is one setting (migration 030), so a rename is one change: header, browser tab and sign-in page
let productName = 'LIMS3';
const initials = (n) => { const c = n.replace(/[^A-Za-z0-9]/g, ''); const caps = c.replace(/[^A-Z0-9]/g, ''); return (caps.length >= 2 ? caps[0] + caps[caps.length - 1] : c.slice(0, 2)).toUpperCase() || 'L'; };
const brandHtml = () => `<div class="brand"><span class="logo">${esc(initials(productName))}</span><div><b>${esc(productName)}</b><small>Sandbox · demo data · not for GxP use</small></div></div>`;
async function loadBrand() {
  try { const s = await api('/public/settings'); if (s.product_name) productName = s.product_name; } catch (_) { /* keep the default */ }
  document.title = `${productName} Sandbox`;
  document.querySelector('header.top .brand').outerHTML = brandHtml();
}
// the lab's small logo (Lab setup > Sites) replaces the initials in the header while working in that lab
async function renderLabLogo() {
  const el = document.querySelector('header.top .brand .logo'); if (!el) return;
  const cur = currentSite(); let id = null;
  if (cur) { try { id = (await api(`/sites/${cur.id}/media-current?kind=${encodeURIComponent('Small logo')}`)).id; } catch (_) { /* none */ } }
  if (id) { el.classList.add('img'); el.innerHTML = `<img src="/api/sites/media/${id}/file" alt="${esc(cur.site_code)} logo">`; } else { el.classList.remove('img'); el.textContent = initials(productName); }
}
let loginOpen = null; // one sign-in screen at a time
function loginScreen(kind, opts = {}) {
  if (loginOpen) return loginOpen;
  loginOpen = new Promise((resolve) => {
    const bg = document.createElement('div'); bg.className = 'login-bg'; bg.id = 'loginScreen';
    const f = (id, label, type = 'text', ac = '') => `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="${type}" autocomplete="${ac}"></div>`;
    const rule = '<div class="help">At least 10 characters, with a letter and a number, and not containing your user ID.</div>';
    let body;
    if (kind === 'setup') {
      body = `<h3>First-time setup</h3><p class="intro">No administrator has a password yet. Choose your administrator account and set your own password. Nobody else will see it; it is stored only as a one-way hash.</p>
        <div class="field"><label for="lg_user">Administrator account</label><select id="lg_user">${opts.setupUsers.map((u) => `<option value="${esc(u.username)}">${esc(u.full_name)} (${esc(u.username)})</option>`).join('')}</select></div>
        ${f('lg_pass', 'New password', 'password', 'new-password')}${f('lg_conf', 'Type it again', 'password', 'new-password')}${rule}`;
    } else if (kind === 'change') {
      body = `<h3>Choose a new password</h3><p class="intro">${esc(opts.message || 'Your password is temporary. Choose your own before continuing.')}</p>
        ${f('lg_cur', 'Current (temporary) password', 'password', 'current-password')}${f('lg_pass', 'New password', 'password', 'new-password')}${f('lg_conf', 'Type it again', 'password', 'new-password')}${rule}`;
    } else {
      body = `<h3>Sign in</h3>${opts.message ? `<p class="intro">${esc(opts.message)}</p>` : ''}${f('lg_user', 'User ID', 'text', 'username')}${f('lg_pass', 'Password', 'password', 'current-password')}
        <div class="help">Forgotten your password, or locked out? Ask an administrator for a temporary password.</div>`;
    }
    bg.innerHTML = `<form class="login" novalidate>${brandHtml()}${body}<div class="merr" role="alert"></div><button class="btn primary" type="submit">${kind === 'login' ? 'Sign in' : kind === 'setup' ? 'Set password and sign in' : 'Save new password'}</button></form>`;
    document.body.appendChild(bg);
    const $ = (s) => bg.querySelector(s);
    if (opts.username && $('#lg_user')) $('#lg_user').value = opts.username;
    // focus the first field, unless the person (or a test) has already started typing somewhere in the form
    setTimeout(() => { if (!bg.contains(document.activeElement)) (kind === 'login' && opts.username ? $('#lg_pass') : bg.querySelector('input:not(.combo-native), .combo-input'))?.focus(); }, 50);
    $('form').onsubmit = async (e) => {
      e.preventDefault(); $('.merr').textContent = '';
      const v = (id) => $(id) ? $(id).value : '';
      try {
        let res;
        if (kind === 'setup') res = await api('/auth/setup', { method: 'POST', body: { username: v('#lg_user'), password: v('#lg_pass'), confirm: v('#lg_conf') } });
        else if (kind === 'change') res = await api('/auth/change-password', { method: 'POST', body: { current: v('#lg_cur'), password: v('#lg_pass'), confirm: v('#lg_conf') } });
        else res = await api('/auth/login', { method: 'POST', body: { username: v('#lg_user').trim(), password: v('#lg_pass') } });
        bg.remove(); loginOpen = null; resolve(res);
      } catch (err) { $('.merr').textContent = err.message; const p = $('#lg_pass'); if (p) { p.value = ''; if (kind === 'login') p.focus(); } }
    };
  });
  return loginOpen;
}

// Signs in (as needed) until there is a usable session; returns the signed-in user
async function ensureSignedIn(message) {
  for (;;) {
    const s = await api('/auth/state');
    if (!s.user) {
      if (s.setupNeeded) await loginScreen('setup', { setupUsers: s.setupUsers });
      else await loginScreen('login', { message: message || (s.timedOut ? `Your session timed out after ${s.idleMinutes} minutes without activity. Sign in again.` : '') });
      message = ''; continue;
    }
    if (s.user.must_change_password) { await loginScreen('change'); continue; }
    return s.user;
  }
}

function renderWho() {
  const u = currentUser();
  const g = u ? (u.is_admin ? ['System administrator', ...myGroups()] : myGroups()) : [];
  const viewOnly = currentSite()?.view_only;
  document.getElementById('whoName').innerHTML = u ? `${esc(u.full_name)}<small title="${esc(g.join(', '))}">${esc(u.username)}${viewOnly ? ' · view only' : g.length ? ' · ' + esc(g.slice(0, 2).join(', ') + (g.length > 2 ? ` +${g.length - 2}` : '')) : ''}</small>` : '';
  document.getElementById('outBtn').hidden = !u; document.getElementById('pwBtn').hidden = !u;
  const gs = document.getElementById('gsearch'); if (gs) gs.hidden = !u;
}

async function init() {
  initSearch();   // 0.35.0: the search box at the top of every page
  // every pick list in the app is a smart dropdown (type to filter, Down arrow for the list)
  new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) enhanceAll(n); })
    .observe(document.body, { childList: true, subtree: true });
  new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) (n.matches('.phead') ? [n] : n.querySelectorAll('.phead')).forEach(decorateHead); })
    .observe(document.getElementById('main'), { childList: true, subtree: true });
  await loadBrand();
  let me;
  try { me = await ensureSignedIn(); } catch (e) { document.getElementById('main').innerHTML = `<div class="card err">Cannot reach the server: ${esc(e.message)}</div>`; return; }
  try {
    state.users = await api('/users');
    state.meta = await api('/meta');
  } catch (e) { document.getElementById('main').innerHTML = `<div class="card err">Cannot reach the server: ${esc(e.message)}</div>`; return; }
  state.user = me.id;
  pickSite(); renderNav(); renderLab(); renderWho(); renderLabLogo();
  hooks.refreshLabLogo = renderLabLogo; // after a lab image is uploaded or removed (labsetup.js)
  hooks.refreshUsers = async () => { state.users = await api('/users'); pickSite(); renderNav(); renderLab(); renderWho(); };
  // The session ended (timed out, signed out elsewhere, temporary password set): sign in again over the page.
  // The same person carries on where they were (their unsaved edits stay); anyone else gets a fresh start.
  hooks.signIn = async (data) => {
    if (loginOpen) return;
    const who = currentUser();
    if (data.changePassword) await loginScreen('change');
    else await loginScreen('login', { message: data.error, username: who?.username });
    const s = await api('/auth/state');
    if (!s.user || s.user.id !== state.user) { setDirtyCheck(null); location.reload(); return; }
    if (s.user.must_change_password) await hooks.signIn({ changePassword: true });
    toast('Signed in again. Repeat the last action if it did not complete.');
  };
  document.getElementById('outBtn').onclick = async () => {
    if (isDirty() && !(await confirmBox('Unsaved changes', 'You have changes on this page that are not saved. Sign out without saving them?', 'Sign out'))) return;
    setDirtyCheck(null);
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    location.hash = '#/'; location.reload();
  };
  document.getElementById('pwBtn').onclick = async () => {
    const v = await modal({ title: 'Change password', okText: 'Save new password', intro: 'At least 10 characters, with a letter and a number, and not containing your user ID.',
      fields: [{ name: 'current', label: 'Current password', type: 'password', required: true }, { name: 'password', label: 'New password', type: 'password', required: true }, { name: 'confirm', label: 'Type it again', type: 'password', required: true }] });
    if (!v) return;
    try { await api('/auth/change-password', { method: 'POST', body: v }); toast('Password changed.'); } catch (e) { toast(e.message, 'err'); }
  };
  const btn = document.getElementById('labBtn'); const menu = document.getElementById('labMenu');
  btn.onclick = (e) => { e.stopPropagation(); if ((currentUser()?.sites || []).length) menu.classList.toggle('show'); };
  menu.onclick = (e) => { const b = e.target.closest('[data-site]'); if (!b) return; menu.classList.remove('show'); if (b.dataset.site !== state.site) { setSite(b.dataset.site); toast('Now working in ' + currentSite().site_code); } };
  menu.onkeydown = (e) => {
    const items = [...menu.querySelectorAll('button')]; const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(items.length - 1, i + 1)]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[Math.max(0, i - 1)]?.focus(); }
    if (e.key === 'Escape') { menu.classList.remove('show'); btn.focus(); }
  };
  btn.onkeydown = (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); menu.classList.add('show'); menu.querySelector('button')?.focus(); } };
  document.addEventListener('click', () => menu.classList.remove('show'));
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });
  route();
}
init();
