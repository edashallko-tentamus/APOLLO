// Admin > Groups and permissions: each lab's groups and what they may do (migration 008).
// People are put into groups on Admin > People and groups.
import { useMemo } from 'react';
import { getGroups, saveGroupPermissions, saveGroups } from '../../api/permissions.js';
import EditableGrid from '../../components/EditableGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import NeedLab from './NeedLab.jsx';
import './permissions.css';
import { Button, Card } from 'react-bootstrap';

const AUDIT = { kind: 'groups' };
const newGroup = () => ({ status: 'Active' });
const rowClass = (r) => (r.status === 'Inactive' ? 'mutedrow' : '');
const savePermissions = (changes, reason, signature) => saveGroupPermissions(
  changes.flatMap((r) => Object.keys(r).filter((k) => k.startsWith('g_')).map((k) => ({ group_id: k.slice(2), permission_code: r.id, active: !!r[k] }))), reason, signature);

export default function GroupsPage() {
  return <NeedLab><Groups /></NeedLab>;
}

function Groups() {
  const { site, refreshUsers } = useSession();
  const { data: d, error, reload } = useApi(getGroups, []);
  const afterSave = async () => { await refreshUsers(); reload(); };

  const parts = useMemo(() => {
    if (!d) return null;
    const lab = d.groups.filter((g) => g.site_id);
    const all = d.groups.filter((g) => !g.site_id);
    const activeLab = lab.filter((g) => g.status === 'Active');
    const groupColumns = [
      { field: 'group_name', title: 'Group', required: true, width: 200 },
      { field: 'description', title: 'What it is for', width: 380 },
      { field: 'department_id', title: 'Department', type: 'select', width: 170,
        options: [{ value: '', label: '' }, ...(d.departments || []).map((x) => ({ value: x.id, label: `${x.department_code} ${x.department_name}`, match: [x.department_code, x.department_name] }))],
        help: 'Mark the group as one of the lab\'s departments (Equipment > Equipment types and departments). Its members are the people who do that department\'s workflow steps.' },
      { field: 'is_standard', title: 'Standard', type: 'readonly', width: 80, format: (v) => (v ? 'Yes' : '') },
      { field: 'member_count', title: 'People', type: 'link', width: 70, href: () => '#/admin/users' },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 90 },
    ];
    const cols = [...activeLab, ...all];
    const permRows = d.permissions.map((p) => ({ id: p.code, code: p.code, module: p.module, area: p.area, description: p.description, cross_lab: p.cross_lab,
      ...Object.fromEntries(cols.map((g) => ['g_' + g.id, (g.permissions || []).includes(p.code)])) }));
    const permColumns = [
      { field: 'module', title: 'Module', type: 'readonly', width: 110 },
      { field: 'area', title: 'Permission', type: 'readonly', width: 130 },
      ...activeLab.map((g) => ({ field: 'g_' + g.id, title: g.group_name, type: 'bool', width: 92, help: g.description || g.group_name, editable: () => d.canEdit })),
      ...all.map((g) => ({ field: 'g_' + g.id, title: g.group_name.replace(' (all labs, view only)', ' (all labs)'), type: 'bool', width: 100,
        help: `${g.description || ''} View permissions only; kept by system administrators.`, editable: (r) => d.canEditAllLabs && r.cross_lab })),
      { field: 'description', title: 'What it allows', type: 'readonly', width: 420 },
      { field: 'code', title: 'Code', type: 'readonly', width: 120 },
    ];
    return { lab, all, activeLab, groupColumns, permRows, permColumns };
  }, [d]);

  const code = site.site_code;
  const signGroups = useMemo(() => (rows) => ({ meaning: 'Approved by', action: `Groups in ${code}: ${rows.length} change(s)` }), [code]);
  const signPerms = useMemo(() => (changes) => ({ meaning: 'Approved by', action: `Group permissions in ${code}: ${changes.length} permission(s) changed` }), [code]);

  return <>
    <PageHeader title={`Groups and permissions: ${code}`} audit={AUDIT}
      subtitle={`Admin. ${site.site_name}'s groups are its "roles": each holds a set of permissions from the list below, and a person's permissions are everything their groups give them, added together. Build any group the lab needs (for example an HPTLC group next to Lab Supervisor). The standard groups are a starting point the lab may change. Whoever holds "admin.groups" here approves these changes with their signature; the lab decides who that is (QA in 21 CFR 211 labs). The all-labs Executive group is view only and kept by system administrators.`}
      actions={<><Button variant="outline-secondary" href="#/admin/users">People and groups</Button> <Button variant="outline-secondary" href="#/admin/permissions">Permission matrix</Button></>} />
    {error ? <Card body className="err">{error.message}</Card> : !d ? <div className="loading">Loading…</div> : <>
      {!d.canEdit && <div className="alert alert-warning">You can view the groups. Changing them needs the admin.groups permission in this lab.</div>}
      <Section title="Groups" help="Add a group, rename it, describe what it is for, or set it Inactive (its members then lose what it gave them; history is kept). A group marked with a Department stands for that department: its members do that department's workflow steps.">
        <EditableGrid rows={parts.lab} columns={parts.groupColumns} allowAdd={d.canEdit} readOnly={!d.canEdit} what="groups" newRow={newGroup} rowClass={rowClass}
          sign={signGroups} save={saveGroups} afterSave={afterSave} />
      </Section>
      <Section className="permgrid" title="What each group may do" help="Tick a permission for a group. Select a block and press Space, or Ctrl+D, to change many at once. Hover a group's title for what it is for; what each permission allows is at the end of its row.">
        <div className="permlegend"><span><b>{parts.activeLab.length}</b> active groups in {code}</span><span><b>{d.permissions.length}</b> permissions</span>{parts.all.length > 0 && <span>All-labs groups can only hold view permissions</span>}</div>
        <EditableGrid rows={parts.permRows} columns={parts.permColumns} readOnly={!d.canEdit && !d.canEditAllLabs} what="group permissions" search
          sign={signPerms} save={savePermissions} afterSave={afterSave} />
      </Section>
    </>}
  </>;
}
