// A client's page: account, what the status allows, service lines, licenses, contacts and roles, projects, quoted prices
import { useMemo } from 'react';
import * as api from '../../api/clients.js';
import Badge from '../../components/Badge.jsx';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import EditableGrid from '../../components/EditableGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useMeta } from '../../hooks/useMeta.js';
import { ClientServiceLinesCard } from '../charges/ChargesCards.jsx';
import { openNewProject } from '../projects/newProject.js';
import { openNewOrder } from '../orders/newOrder.jsx';
import { useSession } from '../../session/SessionProvider.jsx';
import { clientForm, day, licenseStateCls } from './clientForm.jsx';

const LICENSE_TYPES = ['Cannabis distributor', 'Cannabis manufacturer', 'Cannabis cultivator', 'Cannabis retailer', 'FDA registration', 'State manufacturer', 'State food processor', 'Business license'];
const retiredMuted = (r) => (r.status_text === 'Retired' ? 'mutedrow' : '');

const PROJECT_COLUMNS = [
  { field: 'project_code', title: 'Code', type: 'link', width: 100, href: (r) => '#/projects/' + r.id },
  { field: 'project_name', title: 'Project', type: 'readonly' },
  { field: 'is_list_price_acceptance', title: 'List price acceptance', type: 'readonly', width: 150, format: (v) => (v ? 'Yes' : '') },
  { field: 'latest_version', title: 'Latest version', type: 'readonly', width: 110 },
  { field: 'latest_status', title: 'Status', type: 'readonly', width: 140 },
];
const openProject = (r) => { window.location.hash = '#/projects/' + r.id; };
const ORDERABLE_COLUMNS = [
  { field: 'project_code', title: 'Quote', type: 'link', width: 110, compute: (r) => `${r.project_code} v${r.version_no}`, href: (r) => '#/quote/' + r.project_version_id },
  { field: 'project_name', title: 'Project name', type: 'link', href: (r) => '#/projects/' + r.project_id },
  { field: 'test_name', title: 'Test', type: 'link', href: (r) => '#/catalog/' + r.test_id },
  { field: 'final_price', title: 'Price per sample', type: 'money', width: 130 },
  { field: 'via_parent', title: 'Shared from parent', type: 'readonly', width: 140, format: (v) => (v ? 'Yes' : '') },
];

async function fileB64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer()); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { file_name: file.name, mime_type: file.type, data: btoa(bin) };
}

async function licenseDialog(dialogs, l) {
  const picked = { file: null };
  const v = await dialogs.form({ title: l ? `Correct license ${l.license_code}` : 'Add a license', okText: l ? 'Next: reason' : 'Add',
    intro: l ? 'Correct what was entered. For a renewal, add a new license instead and retire this one.' : 'A new license is added to the client\'s history; nothing is replaced.',
    fields: [
      { name: 'license_type', label: 'License type', required: true, value: l ? l.license_type : '', list: LICENSE_TYPES, help: 'e.g. Cannabis distributor, FDA registration (type to write your own)' },
      { name: 'license_number', label: 'License number', required: true, value: l ? l.license_number : '' },
      { name: 'issuing_authority', label: 'Issuing authority', value: l ? l.issuing_authority || '' : '', help: 'e.g. California DCC, FDA' },
      { name: 'issued_on', label: 'Issued on', type: 'date', value: l ? day(l.issued_on) : '' },
      { name: 'expires_on', label: 'Expires on', type: 'date', value: l ? day(l.expires_on) : '', help: 'Leave empty if it does not expire' },
      { name: 'note', label: 'Note', value: l ? l.note || '' : '' }],
    after: (
      <div className="field">
        <label htmlFor="f_licfile">{l && l.document_id ? 'Replace the scanned copy' : 'Scanned copy'} (optional, PDF or image)</label>
        <input type="file" id="f_licfile" accept="application/pdf,image/png,image/jpeg" onChange={(e) => { picked.file = e.target.files[0] || null; }} />
      </div>
    ) });
  if (!v) return null;
  if (picked.file) v.document = await fileB64(picked.file);
  return v;
}

function LicenseWarning({ rows }) {
  const bad = (rows || []).filter((l) => l.status_text === 'Active' && (l.state === 'Expired' || l.state === 'Expiring soon'));
  if (!bad.length) return null;
  return (
    <div className="notice"><b>Licenses to renew:</b>{' '}
      {bad.map((l) => `${l.license_type} ${l.license_number} ${l.state === 'Expired' ? `expired ${day(l.expires_on)}` : `expires ${day(l.expires_on)} (${l.days_left} days)`}`).join(' · ')}
    </div>
  );
}

export default function ClientPage({ params }) {
  const [id] = params;
  const { data, error, reload } = useApi(async (opts) => {
    const [d, all] = await Promise.all([api.getClient(id, opts), api.allClients()]);
    return { d, all };
  }, [id]);
  const meta = useMeta();
  const { site } = useSession();
  const dialogs = useDialogs();
  const toast = useToast();
  const d = data?.d;
  const roles = meta?.contactRoles;

  const licenseColumns = useMemo(() => {
    if (!d) return [];
    const can = (r) => d.can_edit && r.status_text === 'Active';
    return [
      { field: 'license_code', title: 'Code', type: 'readonly', width: 90 },
      { field: 'license_type', title: 'Type', type: 'readonly', width: 180 },
      { field: 'license_number', title: 'Number', type: 'readonly', width: 160 },
      { field: 'issuing_authority', title: 'Issued by', type: 'readonly', width: 140 },
      { field: 'issued_on', title: 'Issued', type: 'readonly', width: 95, format: day },
      { field: 'expires_on', title: 'Expires', type: 'readonly', width: 95, format: (v) => day(v) || 'Does not expire' },
      { field: 'state', title: 'State', type: 'readonly', width: 120, cellClass: (r) => licenseStateCls(r.state), format: (v, r) => (v === 'Expiring soon' ? `Expiring soon (${r.days_left} d)` : v === 'Retired' ? `Retired: ${r.retired_reason || ''}` : v) },
      { field: 'document_name', title: 'Copy', type: 'link', width: 140, href: (r) => (r.document_id ? api.licenseFileUrl(r.id) : null) },
      { field: 'note', title: 'Note', type: 'readonly', width: 180 },
      { field: '_edit', title: '', type: 'button', width: 80, label: (r) => (can(r) ? 'Correct…' : ''), onClick: async (r) => {
        if (!can(r)) return;
        const v = await licenseDialog(dialogs, r); if (!v) return;
        const reason = await dialogs.reason('license ' + r.license_code); if (!reason) return;
        try { await api.updateLicense(r.id, { ...v, reason }); toast('License corrected.'); reload(); } catch (e) { toast(e.message, 'err'); } } },
      { field: '_retire', title: '', type: 'button', width: 80, label: (r) => (can(r) ? 'Retire…' : ''), onClick: async (r) => {
        if (!can(r)) return;
        const v = await dialogs.form({ title: `Retire license ${r.license_code}`, okText: 'Retire', intro: 'It stays in the client\'s history and on the orders that named it, but new orders can no longer choose it.',
          fields: [{ name: 'retired_reason', label: 'Why', type: 'select', blank: false, value: 'Replaced by a renewal', options: ['Replaced by a renewal', 'Expired, not renewed', 'Entered in error', 'Surrendered or revoked'] }] });
        if (!v) return;
        const reason = await dialogs.reason('license ' + r.license_code); if (!reason) return;
        try { await api.updateLicense(r.id, { retire: true, retired_reason: v.retired_reason, reason }); toast('License retired.'); reload(); } catch (e) { toast(e.message, 'err'); } } },
    ];
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps

  // contacts with one tick box per role
  const linkRows = useMemo(() => (d && roles ? d.contacts.map((l) => ({ ...l, ...Object.fromEntries(roles.map((r) => ['r_' + r.role_code, (l.roles || []).includes(r.role_code)])) })) : []), [d, roles]);
  const contactColumns = useMemo(() => (roles ? [
    { field: 'contact_code', title: 'Code', type: 'link', width: 85, href: (r) => '#/contacts?find=' + encodeURIComponent(r.contact_code) },
    { field: 'contact_name', title: 'Contact', type: 'readonly', width: 150 },
    { field: 'email', title: 'Email', type: 'readonly', width: 220 },
    ...roles.map((r) => ({ field: 'r_' + r.role_code, title: r.role_name.replace(' Contact', ''), type: 'bool', width: 85, help: r.description })),
    { field: 'portal_visible', title: 'Sees in portal', type: 'bool', width: 100 },
    { field: 'status', title: 'Link status', type: 'select', options: ['Active', 'Inactive'], width: 95 },
  ] : []), [roles]);
  const saveContacts = (rows, reason) => api.saveClientContacts(rows.map((r) => {
    const merged = { ...linkRows.find((x) => x.id === r.id), ...r };
    const out = { id: r.id, roles: roles.filter((x) => merged['r_' + x.role_code]).map((x) => x.role_code) };
    if ('portal_visible' in r) out.portal_visible = r.portal_visible;
    if ('status' in r) out.status = r.status;
    return out;
  }), reason);

  if (error && !d) return <div className="card err">{error.message}</div>;
  if (!d || !roles) return <div className="loading">Loading…</div>;
  const c = d.client;
  const shown = c.display_name || c.legal_name;
  const roleOptions = roles.map((r) => ({ value: r.role_code, label: r.role_name }));

  async function edit() {
    const v = await clientForm(dialogs, meta, c, data.all); if (!v) return;
    const reason = await dialogs.reason('client ' + c.client_code); if (!reason) return;
    try { await api.updateClient(id, v, reason); toast('Client updated.'); reload(); } catch (e) { toast(e.message, 'err'); }
  }
  async function addLicense() {
    const v = await licenseDialog(dialogs, null); if (!v) return;
    try { const r = await api.addLicense(id, v); toast(`${r.license_code} added.`); reload(); } catch (e) { toast(e.message, 'err'); }
  }
  async function linkContact() {
    let contacts;
    try { contacts = await api.allContacts(); } catch (e) { toast(e.message, 'err'); return; }
    const linked = new Set(d.contacts.map((x) => x.contact_id));
    const v = await dialogs.form({ title: 'Link a contact to ' + shown, okText: 'Link', fields: [
      { name: 'contact_id', label: 'Contact', type: 'select', required: true, options: contacts.filter((x) => !linked.has(x.id)).map((x) => ({ value: x.id, label: `${x.first_name} ${x.last_name} (${x.email})` })) },
      { name: 'role', label: 'First role', type: 'select', blank: false, value: 'REPORT', options: roleOptions, help: 'Add more roles in the grid afterwards.' }] });
    if (!v) return;
    try { await api.saveClientContacts([{ client_id: id, contact_id: v.contact_id, roles: [v.role] }]); reload(); } catch (e) { toast(e.message, 'err'); }
  }
  async function newContact() {
    const v = await dialogs.form({ title: 'New contact for ' + shown, okText: 'Create and link', fields: [
      { name: 'first_name', label: 'First name', required: true }, { name: 'last_name', label: 'Last name', required: true },
      { name: 'email', label: 'Email', required: true, type: 'email' }, { name: 'phone', label: 'Phone' }, { name: 'job_title', label: 'Job title' },
      { name: 'role', label: 'First role', type: 'select', blank: false, value: 'REPORT', options: roleOptions }] });
    if (!v) return;
    try {
      const [ct] = await api.createContacts([{ first_name: v.first_name, last_name: v.last_name, email: v.email, phone: v.phone, job_title: v.job_title }]);
      await api.saveClientContacts([{ client_id: id, contact_id: ct.id, roles: [v.role] }]);
      reload();
    } catch (e) { toast(e.message, 'err'); }
  }
  const newOrder = () => openNewOrder(dialogs, toast, { site, meta, clientId: id });
  const newProject = () => openNewProject(dialogs, toast, { clientId: id });

  return <>
    <PageHeader title={c.legal_name} audit={{ kind: 'client', id }}
      subtitle={<><a href={'#/clients/' + c.id}>{c.client_code}</a> <Badge status={c.account_status} /> {c.is_gmp_client && <Badge status="GMP" />}</>}
      actions={<>
        <a className="btn ghost" href="#/clients">All clients</a>{' '}
        <button type="button" className="btn" onClick={edit}>Edit client</button>{' '}
        <button type="button" className="btn primary" onClick={newOrder}>+ New lab order</button>
      </>} />
    <div className="cols">
      <div className="card"><h2>Account</h2>
        <dl className="kv">
          <dt>Display name</dt><dd>{c.display_name || ''}</dd>
          <dt>Parent client</dt><dd>{c.parent_client_id ? <a href={'#/clients/' + c.parent_client_id}>{c.parent_name}</a> : '—'}</dd>
          <dt>Child clients</dt><dd>{d.children.length ? d.children.map((x, i) => <span key={x.id}>{i > 0 && <br />}<a href={'#/clients/' + x.id}>{x.legal_name}</a> <Badge status={x.account_status} /></span>) : '—'}</dd>
          <dt>Billing address</dt><dd>{c.billing_address || ''}</dd>
          <dt>Site address</dt><dd>{c.site_address || ''}</dd>
          <dt>Report delivery</dt><dd>{c.default_report_delivery || ''}</dd>
        </dl></div>
      <div className="card"><h2>What this status allows</h2>
        <div className="rulechips">
          <div className={`chip ${c.can_order ? 'yes' : 'no'}`}>{c.can_order ? '✓' : '✕'} New orders, sample login and testing</div>
          <div className={`chip ${c.can_release ? 'yes' : 'no'}`}>{c.can_release ? '✓' : '✕'} Release and send reports</div>
        </div>
        <p className="help">Active: everything allowed. On Hold: testing continues, reports are held. Inactive: no new orders; reports for work already in the lab can still go out. Holds never cascade to child clients.</p></div>
    </div>
    <LicenseWarning rows={d.licenses} />
    <ClientServiceLinesCard clientId={id} canEdit={d.can_edit} />
    <Section title="Licenses" help="Added over time and never deleted: when a license is renewed, add the new one; retire the old one (it stays in the history). A lab order names the license it is for, and the COA prints it."
      actions={d.can_edit && <button type="button" className="btn" onClick={addLicense}>+ Add license</button>}>
      <EditableGrid readOnly rows={d.licenses} columns={licenseColumns} rowClass={retiredMuted}
        emptyText={'No licenses yet.' + (d.can_edit ? ' "+ Add license" records one.' : '')} />
    </Section>
    <Section title="Contacts and roles" help="Roles are per client: the same person can be Ordering here and Report-only elsewhere. One Primary per client; any number of Secondary."
      actions={<><button type="button" className="btn" onClick={linkContact}>+ Link existing contact</button>{' '}<button type="button" className="btn" onClick={newContact}>+ New contact</button></>}>
      <EditableGrid rows={linkRows} columns={contactColumns} what={`contact roles for ${c.client_code}`} emptyText="No contacts linked yet."
        save={saveContacts} afterSave={reload} />
    </Section>
    <Section title="Projects" help="Reusable quoted test packages for this client." actions={<button type="button" className="btn" onClick={newProject}>+ New project</button>}>
      <EditableGrid readOnly rows={d.projects} columns={PROJECT_COLUMNS} emptyText="No projects yet." onRowOpen={openProject} />
    </Section>
    <Section title="Quoted prices" help="Tests on accepted, unexpired quotes (including parent-client projects shared with child sites) are ordered at these prices; any other test of the lab is ordered at its list price.">
      <EditableGrid readOnly rows={d.orderable} columns={ORDERABLE_COLUMNS} emptyText="No accepted quote: every test is ordered at its list price." />
    </Section>
  </>;
}
