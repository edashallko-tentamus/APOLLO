// Admin > Permission matrix: who holds which permission in this lab and through which groups, plus the change history
// with signatures; both download as Excel for GMP and ISO 17025 audits.
import { useEffect, useMemo } from 'react';
import { getPermissionHistory, getPermissionMatrix, permissionMatrixXlsx } from '../../api/permissions.js';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import DataGrid from '../../components/grid/DataGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import NeedLab from './NeedLab.jsx';
import './permissions.css';
import { Button, Card } from 'react-bootstrap';

const AUDIT = { kind: 'groups' };
const NO_ROWS = [];
const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '');
const HISTORY_COLUMNS = [
  { field: 'changed_at', title: 'When', type: 'readonly', width: 140, format: dt },
  { field: 'what', title: 'Change', type: 'readonly', width: 230, compute: (r) => {
    if (r.table_name === 'group_member') return `${r.member_name || ''} ${r.status === 'Active' ? 'added to' : 'removed from'} ${r.group_name || ''}`;
    if (r.table_name === 'group_permission') return `${r.permission_code} ${r.status === 'Active' ? 'given to' : 'taken from'} ${r.group_name || ''}`;
    return `Group ${r.group_name || ''} ${r.action === 'CREATE' ? 'created' : 'changed'}`; } },
  { field: 'changed_by', title: 'Changed by', type: 'readonly', width: 140 },
  { field: 'signed_by', title: 'Signed', type: 'readonly', width: 210, format: (v, r) => (v ? `${v} (${r.signature_meaning}${r.signature_method === 'Data load script' ? ', data load script' : ''})` : 'Not signed (system or legacy)') },
  { field: 'reason', title: 'Reason', type: 'readonly', width: 240 },
];

// A read-only grid whose rows arrive later
function ReadGrid({ rows, columns, emptyText }) {
  const grid = useGrid({ rows, columns, readOnly: true });
  const { reset } = grid;
  useEffect(() => { reset(rows); }, [rows, reset]);
  return <DataGrid grid={grid} search emptyText={emptyText} />;
}

export default function MatrixPage() {
  return <NeedLab><Matrix /></NeedLab>;
}

function Matrix() {
  const { site } = useSession();
  const { data: m, error } = useApi(getPermissionMatrix, []);
  const { data: hist, error: histError } = useApi(getPermissionHistory, []);
  const columns = useMemo(() => (m ? [
    { field: 'full_name', title: 'Name', type: 'readonly', width: 170 },
    { field: 'username', title: 'User ID', type: 'readonly', width: 100 },
    { field: 'groups', title: 'Groups', type: 'readonly', width: 200, format: (v, r) => (r.is_admin ? 'System administrator' + (v ? `, ${v}` : '') : v || '') },
    ...m.permissions.map((p) => ({ field: p.code, title: `${p.area}`, type: 'readonly', width: 82, help: `${p.module} > ${p.area}: ${p.description} (${p.code})`,
      format: (v) => (v ? '✓' : ''), cellClass: (r) => (r[p.code] === 'System administrator' ? 'pm-sys' : r[p.code] ? 'pm-yes' : '') })),
  ] : []), [m]);
  const err = error || histError;

  return <>
    <PageHeader title={`Permission matrix: ${site.site_code}`} audit={AUDIT}
      subtitle={`Who can do what in ${site.site_name}, as of ${dt(m?.generatedAt)}: one row per person, one column per permission. A tick shows the groups it comes through. For GMP and ISO 17025 audits, download it, or the full history of every change with who signed it and why.`}
      actions={<>
        <Button variant="outline-secondary" href={permissionMatrixXlsx(site.id)} download>Download matrix (Excel)</Button>{' '}
        <Button variant="outline-secondary" href={permissionMatrixXlsx(site.id, 'history')} download>Download change history (Excel)</Button>{' '}
        <Button type="button" variant="light" onClick={() => window.print()}>Print</Button>
      </>} />
    {err ? <Card body className="err">{err.message}</Card> : !m || !hist ? <div className="loading">Loading…</div> : <>
      <Section className="permgrid" title="Who holds which permission">
        <ReadGrid rows={m.rows || NO_ROWS} columns={columns} emptyText="Nobody holds a permission in this lab yet." />
      </Section>
      <Section title="Change history" help="Every change to this lab's groups, their permissions and their members (and the all-labs groups), newest first, with the signature behind it. Written by the database; it cannot be edited.">
        <ReadGrid rows={hist} columns={HISTORY_COLUMNS} emptyText="No changes yet." />
      </Section>
    </>}
  </>;
}
