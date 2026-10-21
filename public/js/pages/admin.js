// Admin: users, passwords and lab access, canned reasons, the controlled Matrix list (Sites and holidays live in intake.js)
import { api, pageHeader, state, currentUser, hooks, modal, toast, esc, confirmBox, can, signDialog } from '../app.js';
import { Grid } from '../grid.js';
import { editableGrid } from './common.js';

function adminOnly(main, code = 'admin.users') {
  if (can(code)) return true;
  main.innerHTML = `<div class="card err">You need the ${esc(code)} permission in this lab to open this page. Ask your lab administrator.</div>`;
  return false;
}

export async function users(main) {
  if (!adminOnly(main)) return;
  const d = await api('/admin/users');
  const lab = d.site;
  const inGroup = (u, g) => d.members.some((m) => m.user_id === u && m.group_id === g);
  const labGroups = d.groups.filter((g) => g.site_id);
  const allLabGroups = d.groups.filter((g) => !g.site_id);
  const signIn = (u) => (!u.is_active ? 'Inactive' : u.locked_at ? 'Locked' : !u.has_password ? 'No password yet' : u.must_change_password ? 'Temporary password' : 'Active');
  const rows = d.users.map((u) => ({ id: u.id, full_name: u.full_name, username: u.username, is_admin: u.is_admin, is_active: u.is_active,
    sign_in: signIn(u), last_login_at: u.last_login_at, title: u.title, has_signature: u.has_signature, ...Object.fromEntries(d.groups.map((g) => ['g_' + g.id, inGroup(u.id, g.id)])) }));
  main.innerHTML = pageHeader(`People and groups: ${lab ? lab.site_code : ''}`, `Admin. Tick the groups each person belongs to in ${esc(lab ? lab.site_name : 'this lab')}. A person's permissions here are everything their groups give them, added together; being in any group here is what lets them open this lab. Groups at other labs are separate. Select a block of ticks and press Space, or Ctrl+D, to change many at once. Every change is signed and kept as history; nobody can add themselves to a group.`,
    '<a class="btn" href="#/admin/groups">Groups and permissions</a> <a class="btn" href="#/admin/permissions">Permission matrix</a> <button class="btn" id="hist">Sign-in history</button> <button class="btn primary" id="newu">+ New user</button>', { kind: 'users' })
    + '<div id="g"></div><p class="help">Everyone signs in with their own user ID and password. "Set temporary password" gives a person a one-time password (it also unlocks a locked account); they must choose their own at the next sign-in. Nobody, including administrators, can see a password. Lab administrators can reset passwords only for people in their lab. System administrators (the LIMS team) can do everything in every lab and appear as such in the permission matrix.'
    + (allLabGroups.length && !d.isSystemAdmin ? ' The all-labs group (Executive, view only) is managed by system administrators.' : '') + '</p>';
  main.querySelector('#newu').onclick = async () => {
    const v = await modal({ title: 'New user', okText: 'Create user', intro: 'Then set a temporary password for them and tick their groups in this lab.',
      fields: [{ name: 'full_name', label: 'Full name', required: true }, { name: 'username', label: 'User ID', required: true, help: '3 to 40 letters, numbers, dots, dashes or underscores, e.g. jsmith' }] });
    if (!v) return;
    try { const u = await api('/admin/users', { method: 'POST', body: v }); toast('User created.'); await tempPassword({ id: u.id, full_name: v.full_name, username: v.username }); users(main); } catch (e) { toast(e.message, 'err'); }
  };
  main.querySelector('#hist').onclick = () => signInHistory();
  editableGrid({
    el: main.querySelector('#g'), rows, search: true, what: 'group membership',
    rowClass: (r) => (r.is_active ? '' : 'mutedrow'),
    sign: (changes) => ({ meaning: 'Approved by', action: `Group membership in ${lab ? lab.site_code : 'this lab'}: ${changes.length} person(s)` }),
    columns: [
      { field: 'full_name', title: 'Name', type: 'readonly', width: 180 },
      { field: 'username', title: 'User ID', type: 'readonly', width: 100 },
      { field: 'is_admin', title: 'System admin', type: 'readonly', width: 95, format: (v) => (v ? 'Yes' : '') },
      { field: 'sign_in', title: 'Sign-in', type: 'readonly', width: 120, cellClass: (r) => (['Locked', 'No password yet'].includes(r.sign_in) ? 'cwarn' : '') },
      { field: 'last_login_at', title: 'Last sign-in', type: 'readonly', width: 125, format: (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '') },
      { field: 'pw', title: '', type: 'button', width: 170, label: (r) => (r.sign_in === 'Locked' ? 'Unlock: temporary password' : 'Set temporary password'), onClick: async (r) => { if (await tempPassword(r)) users(main); } },
      // migration 028: the handwritten signature (scan) and title printed on the COAs the person signs
      { field: 'sig', title: 'COA signature', type: 'button', width: 175, help: 'A scan of the person\'s handwritten signature and their title, printed on every COA they sign. Nobody can issue a COA without one.',
        label: (r) => (r.has_signature ? `✓ ${r.title || 'On file'}` : 'Add signature…'), onClick: async (r) => { if (await signatureDialog(r, lab)) users(main); } },
      ...labGroups.map((g) => ({ field: 'g_' + g.id, title: g.group_name, type: 'bool', width: Math.max(80, Math.min(140, g.group_name.length * 8 + 20)), help: g.description || g.group_name,
        editable: (r) => r.is_active })),
      ...allLabGroups.map((g) => ({ field: 'g_' + g.id, title: g.group_name.replace(' (all labs, view only)', ' (all labs)'), type: 'bool', width: 120, help: `${g.description || ''} All labs, view only.`,
        editable: (r) => r.is_active && d.isSystemAdmin })),
    ],
    save: (changes, reason, signature) => api('/admin/memberships', { method: 'POST', body: { reason, signature,
      rows: changes.flatMap((r) => Object.keys(r).filter((k) => k.startsWith('g_')).map((k) => ({ user_id: r.id, group_id: k.slice(2), active: !!r[k] }))) } }),
    afterSave: async () => { await hooks.refreshUsers(); users(main); },
  });
}

// The handwritten signature (a PNG or JPEG scan, up to 1 MB) and title printed on the person's COAs; signed by the administrator
async function signatureDialog(u, lab) {
  const cur = u.has_signature ? `<p>On file:</p><img src="/api/admin/users/${u.id}/signature?s=${encodeURIComponent(state.site || '')}&t=${Date.now()}" alt="Signature on file" style="max-width:320px;max-height:110px;border:1px solid var(--line);background:#fff;padding:4px">` : '<p class="help">No signature on file yet: this person cannot issue COAs.</p>';
  const v = await modal({ title: `COA signature: ${u.full_name}`, okText: 'Next: sign',
    intro: 'Scan or photograph the person\'s handwritten signature on white paper and crop it closely. It is printed above their name, title and the date on every COA they finalize. An electronic signature without it is not enough.',
    html: `${cur}<div class="field"><label for="sigf">Signature image (PNG or JPEG, up to 1 MB)${u.has_signature ? ': leave empty to keep the one on file' : ''}</label><input type="file" id="sigf" accept="image/png,image/jpeg"></div><div id="sigp"></div>`,
    fields: [{ name: 'title', label: 'Title (printed under the name)', required: true, value: u.title || '', help: 'e.g. Project Manager, QA Manager' }],
    collect: (m) => ({ file: m.querySelector('#sigf').files[0] || null }) });
  if (!v) return false;
  if (!v.file && !u.has_signature) { toast('Choose the signature image.', 'err'); return false; }
  if (v.file && !/^image\/(png|jpeg)$/.test(v.file.type)) { toast('The signature must be a PNG or JPEG image.', 'err'); return false; }
  if (v.file && v.file.size > 1048576) { toast('The image is larger than 1 MB: crop or shrink it.', 'err'); return false; }
  const b64 = v.file ? await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = no; r.readAsDataURL(v.file); }) : '';
  const done = await signDialog({ what: `${u.full_name}: handwritten signature and title "${v.title}"${lab ? ' (' + lab.site_code + ')' : ''}`, meaning: 'Recorded by', needReason: !!u.has_signature,
    submit: ({ signature, reason }) => api(`/admin/users/${u.id}/signature`, { method: 'POST', body: { signature, reason, title: v.title, b64, mime_type: v.file ? v.file.type : '', file_name: v.file ? v.file.name : '' } }) });
  if (done) toast('Signature recorded.');
  return !!done;
}

// A one-time password made in the browser, shown once to the administrator to pass on; the person must change it at sign-in
function makeTempPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'; const num = '23456789'; const all = abc + num;
  const r = crypto.getRandomValues(new Uint32Array(12));
  const out = [...r].map((x) => all[x % all.length]);
  out[0] = abc[r[0] % abc.length]; out[5] = num[r[5] % num.length]; out[9] = num[r[9] % num.length];
  return out.join('');
}
async function tempPassword(u) {
  if (!(await confirmBox('Set temporary password', `Give ${esc(u.full_name)} (${esc(u.username)}) a new temporary password? Any password they have now stops working, they are signed out everywhere, and a locked account is unlocked.`, 'Set temporary password'))) return false;
  const pw = makeTempPassword();
  try { await api(`/admin/users/${u.id}/temp-password`, { method: 'POST', body: { password: pw } }); } catch (e) { toast(e.message, 'err'); return false; }
  await modal({ title: 'Temporary password set', okText: 'Done', intro: `Give this password to ${esc(u.full_name)} in person or by phone (not by email). It works once: they must choose their own password when they sign in. It is not shown again.`,
    html: `<div class="temppw"><span>User ID</span><b>${esc(u.username)}</b><span>Temporary password</span><b class="pwtext">${esc(pw)}</b></div>` });
  return true;
}
async function signInHistory() {
  let rows; try { rows = await api('/admin/auth-events'); } catch (e) { toast(e.message, 'err'); return; }
  const m = document.createElement('div'); m.className = 'modal-bg';
  m.innerHTML = `<div class="modal xwide"><h3>Sign-in history</h3><p class="intro">Every sign-in, failed attempt, lockout, sign-out, password change and failed signature, newest first (latest 300). Written by the system; it cannot be edited.</p>
    <div id="hg"></div><div class="mbtns"><button class="btn primary" data-x>Close</button></div></div>`;
  document.body.appendChild(m);
  const g = new Grid(m.querySelector('#hg'), { readOnly: true, search: true, rows, emptyText: 'Nothing recorded yet.', columns: [
    { field: 'at', title: 'When', type: 'readonly', width: 150, format: (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' }) : '') },
    { field: 'username', title: 'User ID', type: 'readonly', width: 120 }, { field: 'event', title: 'Event', type: 'readonly', width: 170 },
    { field: 'detail', title: 'Detail', type: 'readonly', width: 300 }, { field: 'by_name', title: 'Done by (administrator)', type: 'readonly', width: 170 }] });
  const close = () => { g.destroy(); m.remove(); };
  m.querySelector('[data-x]').onclick = close;
  m.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

// Canned reasons per module, offered in every Reason for Change dialog (Other, typed, is always available)
export async function reasons(main) {
  if (!can('master.reasons')) { main.innerHTML = '<div class="card err">You need the "Canned reasons" permission (master.reasons) in this lab to open this page.</div>'; return; }
  const rows = await api('/reasons/all');
  main.innerHTML = pageHeader('Canned reasons', 'Admin. The reasons offered in the Reason for Change dialog. Each belongs to a module (General reasons are offered everywhere). People pick one and may add a comment, or choose Other and type their own. A reason already used stays in the audit trail as written: set it Inactive rather than rewording it. Maintained by QA and administrators.',
    '', { kind: 'reasons' }) + '<div id="g"></div>';
  editableGrid({
    el: main.querySelector('#g'), rows, allowAdd: true, search: true, filter: state.query.get('find') || '', what: 'the canned reasons list',
    newRow: () => ({ status: 'Active', module: 'Inventory', sort_order: 100 }), rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''),
    columns: [
      { field: 'module', title: 'Module', type: 'select', options: ['General', 'Clients', 'Orders', 'Quotes', 'Catalog', 'Inventory', 'Equipment', 'Purchasing', 'Methods', 'Testing', 'Reports', 'COA comments', 'Logbooks', 'Invoicing', 'Stability', 'Trending', 'Admin'], width: 130, required: true },
      { field: 'reason_text', title: 'Reason', required: true, width: 420 },
      { field: 'sort_order', title: 'Order', type: 'int', width: 70 },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 90 },
    ],
    save: (r, reason) => api('/reasons/bulk', { method: 'POST', body: { rows: r, reason } }),
    afterSave: () => reasons(main),
  });
}

export async function matrices(main) {
  if (!adminOnly(main, 'master.matrices')) return;
  const [rows, cats] = await Promise.all([api('/matrices'), api('/product-categories')]);
  main.innerHTML = pageHeader('Matrices', 'Admin. The controlled list of sample matrices offered on the sample grid. A matrix used on samples cannot be renamed: set it Inactive and add the new name. Inactive matrices stay on the samples that already use them. Each matrix can belong to a product category, which workflow steps can use (e.g. a different sample weight for cosmetics and supplements).',
    '', { kind: 'matrices' }) + '<div class="card" id="g"></div><div class="card"><h2>Product categories</h2><p class="help">Used by workflow steps that set amounts per category (Tests and workflows). Shared by all labs.</p><div id="pc"></div></div><div class="card" id="cc"></div>';
  const catOpts = [{ value: '', label: '' }, ...cats.filter((c) => c.status === 'Active').map((c) => ({ value: c.id, label: c.category_name }))];
  editableGrid({
    el: main.querySelector('#g'), rows, allowAdd: true, search: true, filter: state.query.get('find') || '', what: 'the Matrix list',
    newRow: () => ({ status: 'Active' }), rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''),
    columns: [
      { field: 'matrix_name', title: 'Matrix', required: true, width: 220 },
      { field: 'description', title: 'Description', width: 360 },
      { field: 'product_category_id', title: 'Product category', type: 'select', options: catOpts, width: 170 },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 100 },
    ],
    save: (r, reason) => api('/matrices/bulk', { method: 'POST', body: { rows: r, reason } }),
    afterSave: () => matrices(main),
  });
  editableGrid({
    el: main.querySelector('#pc'), rows: cats, allowAdd: true, what: 'the product categories',
    newRow: () => ({ status: 'Active', sort_order: cats.length + 1 }), rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''),
    columns: [
      { field: 'category_name', title: 'Product category', required: true, width: 220 },
      { field: 'description', title: 'Description', width: 360 },
      { field: 'sort_order', title: 'Order', type: 'int', width: 70 },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 100 },
    ],
    save: (r, reason) => api('/product-categories/bulk', { method: 'POST', body: { rows: r, reason } }),
    afterSave: () => matrices(main),
  });
  (await import('./reports.js')).categories(main.querySelector('#cc'));
}
