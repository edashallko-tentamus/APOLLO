// App shell: navigation, current user and lab, API calls, dialogs, notices and the per-page audit trail.
import { fmt, Grid } from './grid.js';
export { fmt };

export const state = { user: null, users: [], meta: null, site: null, query: new URLSearchParams() };
export const currentUser = () => state.users.find((u) => u.id === state.user) || null;
export const currentSite = () => (currentUser()?.sites || []).find((s) => s.id === state.site) || null;
// Permissions (migration 008) in the lab being worked in: from the person's groups there; system administrators hold all.
// The database enforces the same rules; screens use can() only to show or hide what a person may do.
export const can = (code) => { const u = currentUser(); if (!u) return false; if (u.is_admin) return true; return !!u.access?.[state.site]?.perms?.includes(code); };
export const canAny = (codes) => codes.some((c) => can(c));
export const myGroups = () => currentUser()?.access?.[state.site]?.groups || [];
// set by main.js: reload users, labs and the header; show the sign-in screen when the session has ended
export const hooks = { refreshUsers: async () => {}, signIn: () => {} };

export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Who is asking comes from the signed-in session (a cookie the browser sends); the lab comes in a header
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method, headers: { 'Content-Type': 'application/json', 'x-site-id': state.site || '' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && (data.signIn || data.changePassword)) hooks.signIn(data);
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export function toast(message, kind = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = message;
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, kind === 'err' ? 7000 : 3500);
}

// Generic modal. fields: [{name,label,type,options,required,value,help}] ; returns values or null
export function modal({ title, intro = '', fields = [], okText = 'Save', html = '', after = '', wide = false, collect = null }) {
  return new Promise((resolve) => {
    const m = document.createElement('div'); m.className = 'modal-bg';
    const inputs = fields.map((f) => {
      const id = 'f_' + f.name; const req = f.required ? ' <span class="req">*</span>' : '';
      let ctrl;
      if (f.type === 'select') ctrl = `<select id="${id}">${f.blank === false ? '' : '<option value=""></option>'}${(f.options || []).map((o) => {
        const v = typeof o === 'object' ? o.value : o; const l = typeof o === 'object' ? o.label : o;
        return `<option value="${esc(v)}" ${String(v) === String(f.value ?? '') ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
      else if (f.type === 'textarea') ctrl = `<textarea id="${id}" rows="3">${esc(f.value ?? '')}</textarea>`;
      else if (f.type === 'checkbox') ctrl = `<label class="cb"><input type="checkbox" id="${id}" ${f.value ? 'checked' : ''}> ${esc(f.cbLabel || '')}</label>`;
      // f.list: suggestions while typing (any other text is still allowed)
      else ctrl = `<input id="${id}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}"${f.list ? ` list="${id}_dl"` : ''}>${f.list ? `<datalist id="${id}_dl">${f.list.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>` : ''}`;
      return `<div class="field"><label for="${id}">${esc(f.label)}${req}</label>${ctrl}${f.help ? `<div class="help">${esc(f.help)}</div>` : ''}</div>`;
    }).join('');
    m.innerHTML = `<div class="modal ${wide ? 'wide' : ''}"><h3>${esc(title)}</h3>${intro ? `<p class="intro">${intro}</p>` : ''}${html}
      <div class="fields">${inputs}</div>${after}<div class="merr"></div>
      <div class="mbtns"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>${esc(okText)}</button></div></div>`;
    document.body.appendChild(m);
    const first = m.querySelector('input,select,textarea'); if (first) first.focus();
    const close = (v) => { m.remove(); resolve(v); };
    m.querySelector('[data-x]').onclick = () => close(null);
    m.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(null); if (e.key === 'Enter' && e.target.tagName === 'INPUT') m.querySelector('[data-ok]').click(); });
    m.querySelector('[data-ok]').onclick = () => {
      const out = {};
      for (const f of fields) {
        const el = m.querySelector('#f_' + f.name);
        out[f.name] = f.type === 'checkbox' ? el.checked : el.value.trim();
        if (f.required && (out[f.name] === '' || out[f.name] === null)) {
          m.querySelector('.merr').textContent = `${f.label} is required.`; el.focus(); return;
        }
      }
      if (collect) Object.assign(out, collect(m));
      close(out);
    };
  });
}

// Canned reasons are kept per module (Admin > Canned reasons); the module comes from the page address
export function moduleForPage() {
  const h = (location.hash || '#/').split('?')[0];
  if (/^#\/(orders|samples|intake|outbox)/.test(h)) return 'Orders';
  if (/^#\/(clients|contacts)/.test(h)) return 'Clients';
  if (/^#\/(projects|quote|print)/.test(h)) return 'Quotes';
  if (/^#\/(catalog|rush|analytes)/.test(h)) return 'Catalog';
  if (/^#\/inventory/.test(h)) return 'Inventory';
  if (/^#\/equipment/.test(h)) return 'Equipment';
  if (/^#\/purchasing/.test(h)) return 'Purchasing';
  if (/^#\/(methods|verification)/.test(h)) return 'Methods';
  if (/^#\/(logbooks|sensors)/.test(h)) return 'Logbooks';
  if (/^#\/billing/.test(h)) return 'Invoicing';
  if (/^#\/stability/.test(h)) return 'Stability';
  if (/^#\/trending/.test(h)) return 'Trending';
  if (/^#\/dashboard/.test(h)) return 'General';
  if (/^#\/testing/.test(h)) return 'Testing';
  if (/^#\/reports/.test(h)) return 'Reports';
  if (/^#\/training/.test(h)) return 'Training';
  if (/^#\/admin/.test(h)) return 'Admin';
  return 'General';
}
const reasonCache = {};
async function cannedReasons(mod) {
  if (!reasonCache[mod]) { try { reasonCache[mod] = await api('/reasons?module=' + encodeURIComponent(mod)); } catch (_) { return []; } setTimeout(() => delete reasonCache[mod], 60000); }
  return reasonCache[mod];
}
const OTHER = '__other__';

// Reason for Change and/or electronic signature in one dialog.
// Reason: pick a canned reason (optional comment) or "Other" (typing required).
// Signature: the signer's own user ID and password; the meaning (e.g. "Approved by") is set by the action.
// submit({reason, signature}) runs while the dialog is open: if it fails, the message shows and the dialog stays open.
export async function signDialog({ title, what = '', meaning = '', needReason = true, sign = true, defaultReason = '', submit = null, okText }) {
  const list = needReason ? await cannedReasons(moduleForPage()) : [];
  return new Promise((resolve) => {
    const m = document.createElement('div'); m.className = 'modal-bg';
    const u = currentUser();
    const intro = sign
      ? `${what ? `You are signing: <b>${esc(what)}</b>.<br>` : ''}Your signature means <b>${esc(meaning || 'Changed by')}</b> and is stored with your name, the date and time${needReason ? ' and the reason' : ''}.`
      : `You are changing ${esc(what || 'these records')}. The reason is stored in the audit trail with your name and the time.`;
    m.innerHTML = `<div class="modal sigmodal"><h3>${esc(title || (sign ? 'Electronic signature' : 'Reason for Change'))}</h3><p class="intro">${intro}</p>
      <div class="fields">
        ${needReason ? `<div class="field"><label for="f_rpick">Reason for change <span class="req">*</span></label>
          <select id="f_rpick"><option value=""></option>${list.map((r) => `<option value="${esc(r.reason_text)}">${esc(r.reason_text)}</option>`).join('')}<option value="${OTHER}">Other (type the reason below)</option></select></div>
          <div class="field"><label for="f_rtext">Comment <span class="rreq">(optional)</span></label><textarea id="f_rtext" rows="2">${esc(defaultReason)}</textarea>
          <div class="help">Pick a reason from the list, or choose Other and type it.</div></div>` : ''}
        ${sign ? `<div class="sigbox"><div class="field"><label for="f_suser">User ID <span class="req">*</span></label><input id="f_suser" autocomplete="username" value="${esc(u?.username || '')}"></div>
          <div class="field"><label for="f_spass">Password <span class="req">*</span></label><input id="f_spass" type="password" autocomplete="current-password"></div></div>` : ''}
      </div><div class="merr" role="alert"></div>
      <div class="mbtns"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>${esc(okText || (sign ? 'Sign' : 'Confirm'))}</button></div></div>`;
    document.body.appendChild(m);
    const $ = (s) => m.querySelector(s); const err = (t, el) => { $('.merr').textContent = t; if (el) el.focus(); };
    const pick = $('#f_rpick'); const text = $('#f_rtext');
    const syncReq = () => { if (pick) $('.rreq').innerHTML = pick.value === OTHER || (!pick.value && text.value.trim()) ? '<span class="req">*</span>' : '(optional)'; };
    if (pick) { pick.addEventListener('change', syncReq); text.addEventListener('input', syncReq); if (defaultReason) pick.value = OTHER; syncReq(); }
    (pick || $('#f_spass'))?.focus();
    const close = (v) => { m.remove(); resolve(v); };
    $('[data-x]').onclick = () => close(null);
    m.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(null); if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !e.target.closest('.combo')) $('[data-ok]').click(); });
    $('[data-ok]').onclick = async () => {
      let reason = '';
      if (pick) {
        const p = pick.value; const t = text.value.trim();
        if (p && p !== OTHER) reason = t ? `${p}: ${t}` : p;
        else if (t) reason = t;
        else return err(p === OTHER ? 'Type the reason (Other was chosen).' : 'Pick a reason, or choose Other and type it.', p === OTHER ? text : pick);
      }
      let signature = null;
      if (sign) {
        signature = { username: $('#f_suser').value.trim(), password: $('#f_spass').value };
        if (!signature.username) return err('Enter your user ID.', $('#f_suser'));
        if (!signature.password) return err('Enter your password to sign.', $('#f_spass'));
      }
      if (!submit) return close({ reason, signature });
      const ok = $('[data-ok]'); ok.disabled = true; err('');
      try { close(await submit({ reason, signature }) ?? true); }
      catch (e) { ok.disabled = false; if (sign) $('#f_spass').value = ''; err(e.message, sign ? $('#f_spass') : null); }
    };
  });
}

// Reason for Change only (regulated records outside Inventory; 21 CFR Part 11 audit trail)
export async function askReason(what) {
  const r = await signDialog({ what, sign: false, needReason: true });
  return r ? r.reason : null;
}

export function confirmBox(title, text, okText = 'Continue') { return modal({ title, intro: text, okText }).then((r) => r !== null); }

export function badge(status) {
  const k = String(status || '').toLowerCase().replace(/[^a-z]+/g, '-');
  return `<span class="badge b-${k}">${esc(status)}</span>`;
}

export function money(v) { return fmt.money(v); }

// Warn before leaving a page with unsaved grid edits
let dirtyCheck = null;
export function setDirtyCheck(fn) { dirtyCheck = fn; }
export function isDirty() { return dirtyCheck ? dirtyCheck() : false; }

// audit: { kind, id } for a record page, or { kind } for a list page (see /api/audit/scope)
export function pageHeader(title, subtitle = '', actions = '', audit = null) {
  const icon = audit ? ` <button class="auditbtn" data-audit="${esc(JSON.stringify(audit))}" title="Audit trail: what changed on this page, who changed it and why" aria-label="Audit trail for this page">${AUDIT_ICON}</button>` : '';
  return `<div class="phead"><div><h1>${esc(title)}${icon}</h1>${subtitle ? `<div class="sub">${subtitle}</div>` : ''}</div><div class="pactions">${actions}</div></div>`;
}
const AUDIT_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2"/></svg>';

// A link to a record (IDs are always links so records can be opened and shared)
export function link(href, text) { return href ? `<a href="${esc(href)}">${esc(text)}</a>` : esc(text); }

// Audit trail summaries, shared by the Audit trail page and the per-page audit icon
export function fmtAuditValue(v) { if (v === null || v === undefined) return '∅'; if (Array.isArray(v)) return '[' + v.join(', ') + ']'; const s = String(v); return s.length > 40 ? s.slice(0, 37) + '…' : s; }
export function summarizeChange(cf) {
  return Object.entries(cf || {}).filter(([k]) => !['id', 'search', 'recalc_at'].includes(k)).slice(0, 6)
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${fmtAuditValue(v.old)} → ${fmtAuditValue(v.new)}`).join('; ');
}
export const auditColumns = (withRecord = true) => [
  { field: 'changed_at', title: 'When', type: 'readonly', width: 150, format: (v) => new Date(v).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' }) },
  { field: 'changed_by', title: 'Who', type: 'readonly', width: 130 },
  ...(withRecord ? [{ field: 'record', title: 'Record', type: 'link', width: 220, compute: (r) => r.ref?.label || r.table_name, href: (r) => r.ref?.link || null }] : []),
  { field: 'action', title: 'Action', type: 'readonly', width: 70 },
  { field: 'record_version', title: 'Ver.', type: 'readonly', width: 45 },
  { field: 'reason', title: 'Reason', type: 'readonly', width: 180 },
  { field: 'signature', title: 'Signature', type: 'readonly', width: 170, help: 'Electronic signature: who signed and what the signature meant' },
  { field: 'summary', title: 'What changed (old → new)', type: 'readonly', compute: (r) => summarizeChange(r.changed_fields) },
];

async function openAudit(scope) {
  let rows;
  try { rows = await api(`/audit/scope?kind=${encodeURIComponent(scope.kind)}${scope.id ? '&id=' + encodeURIComponent(scope.id) : ''}`); } catch (e) { toast(e.message, 'err'); return; }
  const m = document.createElement('div'); m.className = 'modal-bg';
  const title = document.querySelector('main h1')?.textContent?.trim() || 'this page';
  m.innerHTML = `<div class="modal xwide"><h3>Audit trail: ${esc(title)}</h3>
    <p class="intro">${scope.id ? 'Every change to this record and its parts' : 'Every change to the records on this page'}, newest first (latest 500). Written by the database; it cannot be edited. Click a record to open it.</p>
    <div id="auditg"></div><div class="mbtns"><button class="btn primary" data-x>Close</button></div></div>`;
  document.body.appendChild(m);
  const g = new Grid(m.querySelector('#auditg'), { readOnly: true, search: true, rows, emptyText: 'No changes recorded yet.', columns: auditColumns() });
  const close = () => { g.destroy(); m.remove(); window.removeEventListener('hashchange', close); };
  m.querySelector('[data-x]').onclick = close;
  m.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  window.addEventListener('hashchange', close);
  m.querySelector('[data-x]').focus();
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-audit]'); if (b) { e.preventDefault(); openAudit(JSON.parse(b.dataset.audit)); } });
