// Permissions (migration 008): each lab's groups and what they may do, and the permission matrix with its history.
// People are put into groups on Admin > People and groups (admin.js).
import { api, esc, pageHeader, toast, state, currentSite, hooks, can, canAny } from '../app.js';
import { Grid } from '../grid.js';
import { editableGrid, section } from './common.js';

const css = document.createElement('style');
css.textContent = `
.permgrid .grid th { white-space: normal; line-height: 1.2; vertical-align: bottom; }
.permlegend { display: flex; gap: 14px; flex-wrap: wrap; margin: 4px 0 10px; font-size: 12.5px; color: var(--muted); }
.permlegend b { color: var(--ink); }
.pm-yes { color: var(--green-700); font-weight: 700; }
.pm-sys { color: #2F5BA8; font-weight: 700; }
`;
document.head.appendChild(css);

const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '');
function needLab(main, codes) {
  if (!currentSite()) { main.innerHTML = '<div class="card err">Choose your lab (top right) first.</div>'; return false; }
  if (!canAny(codes)) { main.innerHTML = `<div class="card err">You need one of these permissions in this lab to open this page: ${esc(codes.join(', '))}.</div>`; return false; }
  return true;
}

// ================================================================ GROUPS AND PERMISSIONS
export async function groups(main) {
  if (!needLab(main, ['admin.groups', 'admin.users', 'audit.view'])) return;
  const d = await api('/groups');
  const site = currentSite();
  const lab = d.groups.filter((g) => g.site_id);
  const all = d.groups.filter((g) => !g.site_id);
  const activeLab = lab.filter((g) => g.status === 'Active');
  main.innerHTML = pageHeader(`Groups and permissions: ${site.site_code}`,
    `Admin. ${esc(site.site_name)}'s groups are its "roles": each holds a set of permissions from the list below, and a person's permissions are everything their groups give them, added together. Build any group the lab needs (for example an HPTLC group next to Lab Supervisor). The standard groups are a starting point the lab may change. Whoever holds "admin.groups" here approves these changes with their signature; the lab decides who that is (QA in 21 CFR 211 labs). The all-labs Executive group is view only and kept by system administrators.`,
    '<a class="btn" href="#/admin/users">People and groups</a> <a class="btn" href="#/admin/permissions">Permission matrix</a>', { kind: 'groups' })
    + `${d.canEdit ? '' : '<div class="notice">You can view the groups. Changing them needs the admin.groups permission in this lab.</div>'}
    <div class="card">${section('Groups', 'Add a group, rename it, describe what it is for, or set it Inactive (its members then lose what it gave them; history is kept). A group marked with a Department stands for that department: its members do that department\'s workflow steps.')}<div id="gg"></div></div>
    <div class="card permgrid">${section('What each group may do', 'Tick a permission for a group. Select a block and press Space, or Ctrl+D, to change many at once. Hover a group\'s title for what it is for; what each permission allows is at the end of its row.')}
      <div class="permlegend"><span><b>${activeLab.length}</b> active groups in ${esc(site.site_code)}</span><span><b>${d.permissions.length}</b> permissions</span>${all.length ? '<span>All-labs groups can only hold view permissions</span>' : ''}</div>
      <div id="pg"></div></div>`;

  editableGrid({
    el: main.querySelector('#gg'), rows: lab, allowAdd: d.canEdit, readOnly: !d.canEdit, what: 'groups',
    newRow: () => ({ status: 'Active' }), rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''),
    sign: (rows) => ({ meaning: 'Approved by', action: `Groups in ${site.site_code}: ${rows.length} change(s)` }),
    columns: [
      { field: 'group_name', title: 'Group', required: true, width: 200 },
      { field: 'description', title: 'What it is for', width: 380 },
      { field: 'department_id', title: 'Department', type: 'select', width: 170, options: [{ value: '', label: '' }, ...(d.departments || []).map((x) => ({ value: x.id, label: `${x.department_code} ${x.department_name}`, match: [x.department_code, x.department_name] }))],
        help: 'Mark the group as one of the lab\'s departments (Equipment > Equipment types and departments). Its members are the people who do that department\'s workflow steps.' },
      { field: 'is_standard', title: 'Standard', type: 'readonly', width: 80, format: (v) => (v ? 'Yes' : '') },
      { field: 'member_count', title: 'People', type: 'link', width: 70, href: () => '#/admin/users' },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 90 },
    ],
    save: (rows, reason, signature) => api('/groups', { method: 'POST', body: { rows, reason, signature } }),
    afterSave: async () => { await hooks.refreshUsers(); groups(main); },
  });

  const cols = [...activeLab, ...all];
  const rows = d.permissions.map((p) => ({ id: p.code, code: p.code, module: p.module, area: p.area, description: p.description, cross_lab: p.cross_lab,
    ...Object.fromEntries(cols.map((g) => ['g_' + g.id, (g.permissions || []).includes(p.code)])) }));
  editableGrid({
    el: main.querySelector('#pg'), rows, readOnly: !d.canEdit && !d.canEditAllLabs, what: 'group permissions', search: true,
    sign: (changes) => ({ meaning: 'Approved by', action: `Group permissions in ${site.site_code}: ${changes.length} permission(s) changed` }),
    columns: [
      { field: 'module', title: 'Module', type: 'readonly', width: 110 },
      { field: 'area', title: 'Permission', type: 'readonly', width: 130 },
      ...activeLab.map((g) => ({ field: 'g_' + g.id, title: g.group_name, type: 'bool', width: 92, help: g.description || g.group_name, editable: () => d.canEdit })),
      ...all.map((g) => ({ field: 'g_' + g.id, title: g.group_name.replace(' (all labs, view only)', ' (all labs)'), type: 'bool', width: 100,
        help: `${g.description || ''} View permissions only; kept by system administrators.`, editable: (r) => d.canEditAllLabs && r.cross_lab })),
      { field: 'description', title: 'What it allows', type: 'readonly', width: 420 },
      { field: 'code', title: 'Code', type: 'readonly', width: 120 },
    ],
    save: (changes, reason, signature) => api('/groups/permissions', { method: 'POST', body: { reason, signature,
      rows: changes.flatMap((r) => Object.keys(r).filter((k) => k.startsWith('g_')).map((k) => ({ group_id: k.slice(2), permission_code: r.id, active: !!r[k] }))) } }),
    afterSave: async () => { await hooks.refreshUsers(); groups(main); },
  });
}

// ================================================================ PERMISSION MATRIX (on demand) AND HISTORY
export async function matrix(main) {
  if (!needLab(main, ['admin.groups', 'admin.users', 'audit.view'])) return;
  const [m, hist] = await Promise.all([api('/permission-matrix'), api('/permission-history')]);
  const site = currentSite();
  const xl = (what = '') => `/api/permission-matrix.xlsx?s=${encodeURIComponent(state.site)}${what ? '&what=' + what : ''}`;
  main.innerHTML = pageHeader(`Permission matrix: ${site.site_code}`,
    `Who can do what in ${esc(site.site_name)}, as of ${dt(m.generatedAt)}: one row per person, one column per permission. A tick shows the groups it comes through. For GMP and ISO 17025 audits, download it, or the full history of every change with who signed it and why.`,
    `<a class="btn" href="${xl()}" download>Download matrix (Excel)</a> <a class="btn" href="${xl('history')}" download>Download change history (Excel)</a> <button class="btn ghost" id="prt">Print</button>`, { kind: 'groups' })
    + `<div class="card permgrid">${section('Who holds which permission')}<div id="mg"></div></div>
       <div class="card">${section('Change history', 'Every change to this lab\'s groups, their permissions and their members (and the all-labs groups), newest first, with the signature behind it. Written by the database; it cannot be edited.')}<div id="hg"></div></div>`;
  main.querySelector('#prt').onclick = () => window.print();
  new Grid(main.querySelector('#mg'), { readOnly: true, search: true, rows: m.rows, emptyText: 'Nobody holds a permission in this lab yet.',
    columns: [
      { field: 'full_name', title: 'Name', type: 'readonly', width: 170 },
      { field: 'username', title: 'User ID', type: 'readonly', width: 100 },
      { field: 'groups', title: 'Groups', type: 'readonly', width: 200, format: (v, r) => (r.is_admin ? 'System administrator' + (v ? `, ${v}` : '') : v || '') },
      ...m.permissions.map((p) => ({ field: p.code, title: `${p.area}`, type: 'readonly', width: 82, help: `${p.module} > ${p.area}: ${p.description} (${p.code})`,
        format: (v) => (v ? '✓' : ''), cellClass: (r) => (r[p.code] === 'System administrator' ? 'pm-sys' : r[p.code] ? 'pm-yes' : '') })),
    ] });
  new Grid(main.querySelector('#hg'), { readOnly: true, search: true, rows: hist, emptyText: 'No changes yet.',
    columns: [
      { field: 'changed_at', title: 'When', type: 'readonly', width: 140, format: dt },
      { field: 'what', title: 'Change', type: 'readonly', width: 230, compute: (r) => {
        if (r.table_name === 'group_member') return `${r.member_name || ''} ${r.status === 'Active' ? 'added to' : 'removed from'} ${r.group_name || ''}`;
        if (r.table_name === 'group_permission') return `${r.permission_code} ${r.status === 'Active' ? 'given to' : 'taken from'} ${r.group_name || ''}`;
        return `Group ${r.group_name || ''} ${r.action === 'CREATE' ? 'created' : 'changed'}`; } },
      { field: 'changed_by', title: 'Changed by', type: 'readonly', width: 140 },
      { field: 'signed_by', title: 'Signed', type: 'readonly', width: 210, format: (v, r) => (v ? `${v} (${r.signature_meaning}${r.signature_method === 'Data load script' ? ', data load script' : ''})` : 'Not signed (system or legacy)') },
      { field: 'reason', title: 'Reason', type: 'readonly', width: 240 },
    ] });
  void toast;
}
