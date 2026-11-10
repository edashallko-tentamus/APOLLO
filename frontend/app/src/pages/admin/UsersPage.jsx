// Admin > People and groups: who is in which group of this lab, sign-in status, temporary passwords, COA signatures
import { useMemo } from 'react';
import { createUser, getAdminUsers, saveMemberships } from '../../api/admin.js';
import EditableGrid from '../../components/EditableGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import NeedPermission from './NeedPermission.jsx';
import { SignInHistoryDialog, signatureDialog, tempPassword } from './userDialogs.jsx';
import './admin.css';
import { Button, Card } from 'react-bootstrap';

const AUDIT = { kind: 'users' };
const signInState = (u) => (!u.is_active ? 'Inactive' : u.locked_at ? 'Locked' : !u.has_password ? 'No password yet' : u.must_change_password ? 'Temporary password' : 'Active');
const membershipRows = (changes) => changes.flatMap((r) => Object.keys(r).filter((k) => k.startsWith('g_')).map((k) => ({ user_id: r.id, group_id: k.slice(2), active: !!r[k] })));
const saveRows = (changes, reason, signature) => saveMemberships(membershipRows(changes), reason, signature);
const rowClass = (r) => (r.is_active ? '' : 'mutedrow');

export default function UsersPage() {
  const { can } = useSession();
  if (!can('admin.users')) return <NeedPermission code="admin.users" />;
  return <Users />;
}

function Users() {
  const { site, refreshUsers } = useSession();
  const dialogs = useDialogs();
  const toast = useToast();
  const { data: d, error, reload } = useApi(getAdminUsers, []);
  const lab = d?.site;

  const rows = useMemo(() => (d ? d.users.map((u) => ({ id: u.id, full_name: u.full_name, username: u.username, is_admin: u.is_admin, is_active: u.is_active,
    sign_in: signInState(u), last_login_at: u.last_login_at, title: u.title, has_signature: u.has_signature,
    ...Object.fromEntries(d.groups.map((g) => ['g_' + g.id, d.members.some((m) => m.user_id === u.id && m.group_id === g.id)])) })) : []), [d]);

  const columns = useMemo(() => {
    if (!d) return [];
    const labGroups = d.groups.filter((g) => g.site_id);
    const allLabGroups = d.groups.filter((g) => !g.site_id);
    return [
      { field: 'full_name', title: 'Name', type: 'readonly', width: 180 },
      { field: 'username', title: 'User ID', type: 'readonly', width: 100 },
      { field: 'is_admin', title: 'System admin', type: 'readonly', width: 95, format: (v) => (v ? 'Yes' : '') },
      { field: 'sign_in', title: 'Sign-in', type: 'readonly', width: 120, cellClass: (r) => (['Locked', 'No password yet'].includes(r.sign_in) ? 'cwarn' : '') },
      { field: 'last_login_at', title: 'Last sign-in', type: 'readonly', width: 125, format: (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '') },
      { field: 'pw', title: '', type: 'button', width: 170, label: (r) => (r.sign_in === 'Locked' ? 'Unlock: temporary password' : 'Set temporary password'),
        onClick: async (r) => { if (await tempPassword(dialogs, toast, r)) reload(); } },
      // migration 028: the handwritten signature (scan) and title printed on the COAs the person signs
      { field: 'sig', title: 'COA signature', type: 'button', width: 175, help: 'A scan of the person\'s handwritten signature and their title, printed on every COA they sign. Nobody can issue a COA without one.',
        label: (r) => (r.has_signature ? `✓ ${r.title || 'On file'}` : 'Add signature…'), onClick: async (r) => { if (await signatureDialog(dialogs, toast, r, d.site, site?.id)) reload(); } },
      ...labGroups.map((g) => ({ field: 'g_' + g.id, title: g.group_name, type: 'bool', width: Math.max(80, Math.min(140, g.group_name.length * 8 + 20)), help: g.description || g.group_name,
        editable: (r) => r.is_active })),
      ...allLabGroups.map((g) => ({ field: 'g_' + g.id, title: g.group_name.replace(' (all labs, view only)', ' (all labs)'), type: 'bool', width: 120, help: `${g.description || ''} All labs, view only.`,
        editable: (r) => r.is_active && d.isSystemAdmin })),
    ];
  }, [d, dialogs, toast, reload, site?.id]);
  const sign = useMemo(() => (changes) => ({ meaning: 'Approved by', action: `Group membership in ${lab ? lab.site_code : 'this lab'}: ${changes.length} person(s)` }), [lab]);

  async function newUser() {
    const v = await dialogs.form({ title: 'New user', okText: 'Create user', intro: 'Then set a temporary password for them and tick their groups in this lab.',
      fields: [{ name: 'full_name', label: 'Full name', required: true }, { name: 'username', label: 'User ID', required: true, help: '3 to 40 letters, numbers, dots, dashes or underscores, e.g. jsmith' }] });
    if (!v) return;
    try { const u = await createUser(v); toast('User created.'); await tempPassword(dialogs, toast, { id: u.id, full_name: v.full_name, username: v.username }); reload(); } catch (e) { toast(e.message, 'err'); }
  }

  const hasAllLabGroups = d?.groups.some((g) => !g.site_id);
  return <>
    <PageHeader title={`People and groups: ${lab ? lab.site_code : ''}`} audit={AUDIT}
      subtitle={`Admin. Tick the groups each person belongs to in ${lab ? lab.site_name : 'this lab'}. A person's permissions here are everything their groups give them, added together; being in any group here is what lets them open this lab. Groups at other labs are separate. Select a block of ticks and press Space, or Ctrl+D, to change many at once. Every change is signed and kept as history; nobody can add themselves to a group.`}
      actions={<>
        <Button variant="outline-secondary" href="#/admin/groups">Groups and permissions</Button> <Button variant="outline-secondary" href="#/admin/permissions">Permission matrix</Button>{' '}
        <Button type="button" variant="outline-secondary" onClick={() => dialogs.open((done) => <SignInHistoryDialog onDone={() => done()} />)}>Sign-in history</Button>{' '}
        <Button type="button" variant="primary" onClick={newUser}>+ New user</Button>
      </>} />
    {error ? <Card body className="err">{error.message}</Card> : !d ? <div className="loading">Loading…</div> : <>
      <EditableGrid rows={rows} columns={columns} search what="group membership" rowClass={rowClass} sign={sign} save={saveRows}
        afterSave={async () => { await refreshUsers(); reload(); }} />
      <p className="help">Everyone signs in with their own user ID and password. &quot;Set temporary password&quot; gives a person a one-time password (it also unlocks a locked account); they must choose their own at the next sign-in. Nobody, including administrators, can see a password. Lab administrators can reset passwords only for people in their lab. System administrators (the LIMS team) can do everything in every lab and appear as such in the permission matrix.
        {hasAllLabGroups && !d.isSystemAdmin ? ' The all-labs group (Executive, view only) is managed by system administrators.' : ''}</p>
    </>}
  </>;
}
