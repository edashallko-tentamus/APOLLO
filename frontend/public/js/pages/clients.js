// Clients list and client page (details, contacts with roles, projects, what the client may order)
import { api, esc, pageHeader, toast, modal, state, badge, askReason, money } from '../app.js';
import { Grid } from '../grid.js';
import { editableGrid, section, pagedList } from './common.js';
import { newProject } from './projects.js';
import { newOrder } from './orders.js';
import { clientServiceLinesCard } from './charges.js';

export async function list(main) {
  main.innerHTML = pageHeader('Clients', 'Hold and status apply to each client only. Nothing cascades from a parent client. Newest first, 50 at a time; search finds any client.',
    '<button class="btn primary" id="new">+ New client</button>', { kind: 'clients' }) + '<div id="g"></div>';
  // one page at a time from the server (0.35.0)
  pagedList({ el: main.querySelector('#g'), url: '/clients', q: state.query.get('find') || '', filter: state.query.get('show') || 'current',
    filters: [['current', 'Current'], ['active', 'Active'], ['hold', 'On Hold'], ['inactive', 'Inactive'], ['all', 'All']],
    placeholder: 'Search by code, name or parent client; type a client code and press Enter to open it',
    open: (r) => { location.hash = '#/clients/' + r.id; },
    render: (body, rows) => new Grid(body, {
    readOnly: true, rows, emptyText: 'No clients here.', onRowOpen: (r) => { location.hash = '#/clients/' + r.id; },
    rowClass: (r) => (r.account_status === 'On Hold' ? 'warnrow' : r.account_status === 'Inactive' ? 'mutedrow' : ''),
    columns: [
      { field: 'client_code', title: 'Code', type: 'link', width: 95, href: (r) => '#/clients/' + r.id },
      { field: 'legal_name', title: 'Legal name', type: 'link', width: 240, href: (r) => '#/clients/' + r.id },
      { field: 'display_name', title: 'Display name', type: 'readonly' },
      { field: 'parent_name', title: 'Parent client', type: 'link', href: (r) => (r.parent_client_id ? '#/clients/' + r.parent_client_id : null) },
      { field: 'account_status', title: 'Status', type: 'readonly', width: 90 },
      { field: 'is_gmp_client', title: 'GMP', type: 'readonly', width: 55, format: (v) => (v ? 'Yes' : '') },
      { field: 'can_order', title: 'Can order', type: 'readonly', width: 85, format: (v) => (v ? 'Yes' : 'No') },
      { field: 'can_release', title: 'Reports release', type: 'readonly', width: 115, format: (v) => (v ? 'Yes' : 'Blocked') },
      { field: 'contact_count', title: 'Contacts', type: 'readonly', width: 75 },
      { field: 'project_count', title: 'Projects', type: 'readonly', width: 75 },
    ],
  }) });
  main.querySelector('#new').onclick = async () => {
    const v = await clientForm({}, await api('/clients'));
    if (!v) return;
    try { const r = await api('/clients', { method: 'POST', body: { row: v } }); location.hash = '#/clients/' + r.id; } catch (e) { toast(e.message, 'err'); }
  };
}

function clientForm(c, allClients) {
  const en = state.meta.enums;
  return modal({
    title: c.id ? 'Edit client' : 'New client', okText: c.id ? 'Continue' : 'Create',
    fields: [
      { name: 'legal_name', label: 'Legal name', required: true, value: c.legal_name },
      { name: 'display_name', label: 'Display name', value: c.display_name },
      { name: 'parent_client_id', label: 'Parent client', type: 'select', value: c.parent_client_id,
        options: allClients.filter((x) => x.id !== c.id).map((x) => ({ value: x.id, label: x.legal_name })) },
      { name: 'account_status', label: 'Account status', type: 'select', blank: false, value: c.account_status || 'Active', options: en.account_status,
        help: 'On Hold: samples can be logged and tested, reports cannot be released. Inactive: no new orders.' },
      { name: 'is_gmp_client', label: 'Regulated (GMP) client', type: 'checkbox', value: c.is_gmp_client, cbLabel: 'GMP client (strict OOS procedure, e-signed chain of custody)' },
      { name: 'allow_partial_reports', label: 'Partial reports', type: 'checkbox', value: c.allow_partial_reports !== false, cbLabel: 'Send a COA version as each test is finalized (otherwise one COA when the last test is finalized)' },
      { name: 'billing_address', label: 'Billing address', value: c.billing_address },
      { name: 'site_address', label: 'Site address', value: c.site_address },
      { name: 'default_report_delivery', label: 'Default report delivery', type: 'select', value: c.default_report_delivery, options: en.report_delivery },
    ],
  });
}

export async function detail(main, id) {
  const [d, all] = await Promise.all([api('/clients/' + id), api('/clients')]);
  const c = d.client;
  const roles = state.meta.contactRoles;
  main.innerHTML = pageHeader(`${c.legal_name}`, `<a href="#/clients/${c.id}">${esc(c.client_code)}</a> ${badge(c.account_status)} ${c.is_gmp_client ? badge('GMP') : ''}`,
    '<a class="btn ghost" href="#/clients">All clients</a> <button class="btn" id="edit">Edit client</button> <button class="btn primary" id="neworder">+ New lab order</button>', { kind: 'client', id }) + `
  <div class="cols">
    <div class="card"><h2>Account</h2>
      <dl class="kv">
        <dt>Display name</dt><dd>${esc(c.display_name || '')}</dd>
        <dt>Parent client</dt><dd>${c.parent_client_id ? `<a href="#/clients/${c.parent_client_id}">${esc(c.parent_name)}</a>` : '—'}</dd>
        <dt>Child clients</dt><dd>${d.children.map((x) => `<a href="#/clients/${x.id}">${esc(x.legal_name)}</a> ${badge(x.account_status)}`).join('<br>') || '—'}</dd>
        <dt>Billing address</dt><dd>${esc(c.billing_address || '')}</dd>
        <dt>Site address</dt><dd>${esc(c.site_address || '')}</dd>
        <dt>Report delivery</dt><dd>${esc(c.default_report_delivery || '')}</dd>
      </dl></div>
    <div class="card"><h2>What this status allows</h2>
      <div class="rulechips">
        <div class="chip ${c.can_order ? 'yes' : 'no'}">${c.can_order ? '✓' : '✕'} New orders, sample login and testing</div>
        <div class="chip ${c.can_release ? 'yes' : 'no'}">${c.can_release ? '✓' : '✕'} Release and send reports</div>
      </div>
      <p class="help">Active: everything allowed. On Hold: testing continues, reports are held. Inactive: no new orders; reports for work already in the lab can still go out. Holds never cascade to child clients.</p></div>
  </div>
  ${licWarn(d.licenses)}
  <div class="card" id="csl" style="display:none"></div>
  <div class="card">${section('Licenses', 'Added over time and never deleted: when a license is renewed, add the new one; retire the old one (it stays in the history). A lab order names the license it is for, and the COA prints it.',
    d.can_edit ? '<button class="btn" id="addlic">+ Add license</button>' : '')}<div id="lg"></div></div>
  <div class="card">${section('Contacts and roles', 'Roles are per client: the same person can be Ordering here and Report-only elsewhere. One Primary per client; any number of Secondary.',
    '<button class="btn" id="link">+ Link existing contact</button> <button class="btn" id="newc">+ New contact</button>')}<div id="cg"></div></div>
  <div class="card">${section('Projects', 'Reusable quoted test packages for this client.', '<button class="btn" id="newp">+ New project</button>')}<div id="pg"></div></div>
  <div class="card">${section('Quoted prices', 'Tests on accepted, unexpired quotes (including parent-client projects shared with child sites) are ordered at these prices; any other test of the lab is ordered at its list price.')}<div id="og"></div></div>`;
  clientServiceLinesCard(main.querySelector('#csl'), id, d.can_edit).catch(() => {});

  main.querySelector('#edit').onclick = async () => {
    const v = await clientForm(c, all); if (!v) return;
    const reason = await askReason('client ' + c.client_code); if (!reason) return;
    try { await api('/clients/' + id, { method: 'PUT', body: { row: v, reason } }); toast('Client updated.'); detail(main, id); } catch (e) { toast(e.message, 'err'); }
  };

  licensesGrid(main, d, id, () => detail(main, id));

  const linkRows = d.contacts.map((l) => ({ ...l, ...Object.fromEntries(roles.map((r) => ['r_' + r.role_code, (l.roles || []).includes(r.role_code)])) }));
  editableGrid({
    el: main.querySelector('#cg'), rows: linkRows, what: `contact roles for ${c.client_code}`, emptyText: 'No contacts linked yet.',
    columns: [
      { field: 'contact_code', title: 'Code', type: 'link', width: 85, href: (r) => '#/contacts?find=' + encodeURIComponent(r.contact_code) },
      { field: 'contact_name', title: 'Contact', type: 'readonly', width: 150 },
      { field: 'email', title: 'Email', type: 'readonly', width: 220 },
      ...roles.map((r) => ({ field: 'r_' + r.role_code, title: r.role_name.replace(' Contact', ''), type: 'bool', width: 85, help: r.description })),
      { field: 'portal_visible', title: 'Sees in portal', type: 'bool', width: 100 },
      { field: 'status', title: 'Link status', type: 'select', options: ['Active', 'Inactive'], width: 95 },
    ],
    save: (rows, reason) => api('/client-contacts/bulk', { method: 'POST', body: { reason, rows: rows.map((r) => {
      const full = linkRows.find((x) => x.id === r.id); const merged = { ...full, ...r };
      const out = { id: r.id, roles: roles.filter((x) => merged['r_' + x.role_code]).map((x) => x.role_code) };
      if ('portal_visible' in r) out.portal_visible = r.portal_visible; if ('status' in r) out.status = r.status;
      return out; }) } }),
    afterSave: () => detail(main, id),
  });

  main.querySelector('#link').onclick = async () => {
    const contacts = await api('/contacts');
    const linked = new Set(d.contacts.map((x) => x.contact_id));
    const v = await modal({ title: 'Link a contact to ' + (c.display_name || c.legal_name), okText: 'Link', fields: [
      { name: 'contact_id', label: 'Contact', type: 'select', required: true, options: contacts.filter((x) => !linked.has(x.id)).map((x) => ({ value: x.id, label: `${x.first_name} ${x.last_name} (${x.email})` })) },
      { name: 'role', label: 'First role', type: 'select', blank: false, value: 'REPORT', options: roles.map((r) => ({ value: r.role_code, label: r.role_name })), help: 'Add more roles in the grid afterwards.' }] });
    if (!v) return;
    try { await api('/client-contacts/bulk', { method: 'POST', body: { rows: [{ client_id: id, contact_id: v.contact_id, roles: [v.role] }] } }); detail(main, id); } catch (e) { toast(e.message, 'err'); }
  };
  main.querySelector('#newc').onclick = async () => {
    const v = await modal({ title: 'New contact for ' + (c.display_name || c.legal_name), okText: 'Create and link', fields: [
      { name: 'first_name', label: 'First name', required: true }, { name: 'last_name', label: 'Last name', required: true },
      { name: 'email', label: 'Email', required: true, type: 'email' }, { name: 'phone', label: 'Phone' }, { name: 'job_title', label: 'Job title' },
      { name: 'role', label: 'First role', type: 'select', blank: false, value: 'REPORT', options: roles.map((r) => ({ value: r.role_code, label: r.role_name })) }] });
    if (!v) return;
    try {
      const [ct] = await api('/contacts/bulk', { method: 'POST', body: { rows: [{ first_name: v.first_name, last_name: v.last_name, email: v.email, phone: v.phone, job_title: v.job_title }] } });
      await api('/client-contacts/bulk', { method: 'POST', body: { rows: [{ client_id: id, contact_id: ct.id, roles: [v.role] }] } });
      detail(main, id);
    } catch (e) { toast(e.message, 'err'); }
  };

  new Grid(main.querySelector('#pg'), {
    readOnly: true, rows: d.projects, emptyText: 'No projects yet.', onRowOpen: (r) => { location.hash = '#/projects/' + r.id; },
    columns: [
      { field: 'project_code', title: 'Code', type: 'link', width: 100, href: (r) => '#/projects/' + r.id },
      { field: 'project_name', title: 'Project', type: 'readonly' },
      { field: 'is_list_price_acceptance', title: 'List price acceptance', type: 'readonly', width: 150, format: (v) => (v ? 'Yes' : '') },
      { field: 'latest_version', title: 'Latest version', type: 'readonly', width: 110 },
      { field: 'latest_status', title: 'Status', type: 'readonly', width: 140 },
    ],
  });
  main.querySelector('#newp').onclick = () => newProject(id);
  main.querySelector('#neworder').onclick = () => newOrder(id);

  new Grid(main.querySelector('#og'), {
    readOnly: true, rows: d.orderable, emptyText: 'No accepted quote: every test is ordered at its list price.',
    columns: [
      { field: 'project_code', title: 'Quote', type: 'link', width: 110, compute: (r) => `${r.project_code} v${r.version_no}`, href: (r) => '#/quote/' + r.project_version_id },
      { field: 'project_name', title: 'Project name', type: 'link', href: (r) => '#/projects/' + r.project_id },
      { field: 'test_name', title: 'Test', type: 'link', href: (r) => '#/catalog/' + r.test_id },
      { field: 'final_price', title: 'Price per sample', type: 'money', width: 130 },
      { field: 'via_parent', title: 'Shared from parent', type: 'readonly', width: 140, format: (v) => (v ? 'Yes' : '') },
    ],
  });
}

// ---------------------------------------------------------------- client licenses (0.32.0, migration 055)
const LICENSE_TYPES = ['Cannabis distributor', 'Cannabis manufacturer', 'Cannabis cultivator', 'Cannabis retailer', 'FDA registration', 'State manufacturer', 'State food processor', 'Business license'];
const stateCls = (s) => (s === 'Expired' ? 'tbfail' : s === 'Expiring soon' ? 'flag' : '');
const day = (v) => (v ? String(v).slice(0, 10) : '');
function licWarn(rows) {
  const bad = (rows || []).filter((l) => l.status_text === 'Active' && (l.state === 'Expired' || l.state === 'Expiring soon'));
  return bad.length ? `<div class="notice"><b>Licenses to renew:</b> ${bad.map((l) => `${esc(l.license_type)} ${esc(l.license_number)} ${l.state === 'Expired' ? `expired ${esc(day(l.expires_on))}` : `expires ${esc(day(l.expires_on))} (${l.days_left} days)`}`).join(' · ')}</div>` : '';
}
async function fileB64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer()); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { file_name: file.name, mime_type: file.type, data: btoa(bin) };
}
async function licenseDialog(l) {
  let file = null;
  const v = await modal({ title: l ? `Correct license ${l.license_code}` : 'Add a license', okText: l ? 'Next: reason' : 'Add',
    intro: l ? 'Correct what was entered. For a renewal, add a new license instead and retire this one.' : 'A new license is added to the client\'s history; nothing is replaced.',
    fields: [
      { name: 'license_type', label: 'License type', required: true, value: l ? l.license_type : '', list: LICENSE_TYPES, help: 'e.g. Cannabis distributor, FDA registration (type to write your own)' },
      { name: 'license_number', label: 'License number', required: true, value: l ? l.license_number : '' },
      { name: 'issuing_authority', label: 'Issuing authority', value: l ? l.issuing_authority || '' : '', help: 'e.g. California DCC, FDA' },
      { name: 'issued_on', label: 'Issued on', type: 'date', value: l ? day(l.issued_on) : '' },
      { name: 'expires_on', label: 'Expires on', type: 'date', value: l ? day(l.expires_on) : '', help: 'Leave empty if it does not expire' },
      { name: 'note', label: 'Note', value: l ? l.note || '' : '' }],
    after: `<div class="field"><label for="f_licfile">${l && l.document_id ? 'Replace the scanned copy' : 'Scanned copy'} (optional, PDF or image)</label><input type="file" id="f_licfile" accept="application/pdf,image/png,image/jpeg"></div>`,
    collect: (m) => { file = m.querySelector('#f_licfile')?.files[0] || null; return {}; } });
  if (!v) return null;
  if (file) v.document = await fileB64(file);
  return v;
}
function licensesGrid(main, d, clientId, reload) {
  const el = main.querySelector('#lg'); if (!el) return;
  new Grid(el, {
    readOnly: true, rows: d.licenses, emptyText: 'No licenses yet.' + (d.can_edit ? ' "+ Add license" records one.' : ''),
    rowClass: (r) => (r.status_text === 'Retired' ? 'mutedrow' : ''),
    columns: [
      { field: 'license_code', title: 'Code', type: 'readonly', width: 90 },
      { field: 'license_type', title: 'Type', type: 'readonly', width: 180 },
      { field: 'license_number', title: 'Number', type: 'readonly', width: 160 },
      { field: 'issuing_authority', title: 'Issued by', type: 'readonly', width: 140 },
      { field: 'issued_on', title: 'Issued', type: 'readonly', width: 95, format: day },
      { field: 'expires_on', title: 'Expires', type: 'readonly', width: 95, format: (v) => day(v) || 'Does not expire' },
      { field: 'state', title: 'State', type: 'readonly', width: 120, cellClass: (r) => stateCls(r.state), format: (v, r) => (v === 'Expiring soon' ? `Expiring soon (${r.days_left} d)` : v === 'Retired' ? `Retired: ${r.retired_reason || ''}` : v) },
      { field: 'document_name', title: 'Copy', type: 'link', width: 140, href: (r) => (r.document_id ? `/api/licenses/${r.id}/file` : null) },
      { field: 'note', title: 'Note', type: 'readonly', width: 180 },
      { field: '_edit', title: '', type: 'button', width: 80, label: (r) => (d.can_edit && r.status_text === 'Active' ? 'Correct…' : ''), onClick: async (r) => {
        if (!d.can_edit || r.status_text !== 'Active') return;
        const v = await licenseDialog(r); if (!v) return;
        const reason = await askReason('license ' + r.license_code); if (!reason) return;
        try { await api('/licenses/' + r.id, { method: 'PUT', body: { ...v, reason } }); toast('License corrected.'); reload(); } catch (e) { toast(e.message, 'err'); } } },
      { field: '_retire', title: '', type: 'button', width: 80, label: (r) => (d.can_edit && r.status_text === 'Active' ? 'Retire…' : ''), onClick: async (r) => {
        if (!d.can_edit || r.status_text !== 'Active') return;
        const v = await modal({ title: `Retire license ${r.license_code}`, okText: 'Retire', intro: 'It stays in the client\'s history and on the orders that named it, but new orders can no longer choose it.',
          fields: [{ name: 'retired_reason', label: 'Why', type: 'select', blank: false, value: 'Replaced by a renewal', options: ['Replaced by a renewal', 'Expired, not renewed', 'Entered in error', 'Surrendered or revoked'] }] });
        if (!v) return;
        const reason = await askReason('license ' + r.license_code); if (!reason) return;
        try { await api('/licenses/' + r.id, { method: 'PUT', body: { retire: true, retired_reason: v.retired_reason, reason } }); toast('License retired.'); reload(); } catch (e) { toast(e.message, 'err'); } } },
    ],
  });
  const add = main.querySelector('#addlic');
  if (add) add.onclick = async () => {
    const v = await licenseDialog(null); if (!v) return;
    try { const r = await api(`/clients/${clientId}/licenses`, { method: 'POST', body: v }); toast(`${r.license_code} added.`); reload(); } catch (e) { toast(e.message, 'err'); }
  };
}

// Intake > Client licenses: every client's licenses, those expired or expiring within 30 days first
export async function licenses(main) {
  const d = await api('/licenses');
  const show = ['due', 'all'].includes(state.query.get('show')) ? state.query.get('show') : 'due';
  const rows = show === 'due' ? d.rows.filter((r) => r.state !== 'Current') : d.rows;
  main.innerHTML = pageHeader('Client licenses', 'Every client\'s current licenses. Expired ones, then those expiring within 30 days, come first. Licenses are added and retired on each client\'s page.', '', { kind: 'licenses' })
    + `<div class="tabs"><a class="tab ${show === 'due' ? 'on' : ''}" href="#/licenses?show=due">Expired or expiring (${d.rows.filter((r) => r.state !== 'Current').length})</a><a class="tab ${show === 'all' ? 'on' : ''}" href="#/licenses?show=all">All current (${d.rows.length})</a></div><div id="g"></div>`;
  new Grid(main.querySelector('#g'), {
    readOnly: true, search: true, rows, emptyText: show === 'due' ? 'No license is expired or expiring within 30 days.' : 'No licenses recorded yet.',
    onRowOpen: (r) => { location.hash = '#/clients/' + r.client_id; },
    columns: [
      { field: 'client_name', title: 'Client', type: 'link', width: 220, href: (r) => '#/clients/' + r.client_id },
      { field: 'license_type', title: 'Type', type: 'readonly', width: 180 },
      { field: 'license_number', title: 'Number', type: 'readonly', width: 160 },
      { field: 'issuing_authority', title: 'Issued by', type: 'readonly', width: 140 },
      { field: 'expires_on', title: 'Expires', type: 'readonly', width: 100, format: (v) => day(v) || 'Does not expire' },
      { field: 'state', title: 'State', type: 'readonly', width: 140, cellClass: (r) => stateCls(r.state), format: (v, r) => (v === 'Expiring soon' ? `Expiring soon (${r.days_left} d)` : v === 'Expired' ? `Expired ${-r.days_left} d ago` : v) },
      { field: 'account_status', title: 'Client status', type: 'readonly', width: 110 },
    ],
  });
}
