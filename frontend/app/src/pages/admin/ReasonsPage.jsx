// Admin > Canned reasons: the reasons offered in every Reason for Change dialog, per module (Other, typed, is always available)
import { listAllReasons, saveReasons } from '../../api/admin.js';
import EditableGrid from '../../components/EditableGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import NeedPermission from './NeedPermission.jsx';
import { Card } from 'react-bootstrap';

const AUDIT = { kind: 'reasons' };
const MODULES = ['General', 'Clients', 'Orders', 'Quotes', 'Catalog', 'Inventory', 'Equipment', 'Purchasing', 'Methods', 'Testing', 'Reports', 'COA comments', 'Logbooks', 'Invoicing', 'Stability', 'Trending', 'Admin'];
const COLUMNS = [
  { field: 'module', title: 'Module', type: 'select', options: MODULES, width: 130, required: true },
  { field: 'reason_text', title: 'Reason', required: true, width: 420 },
  { field: 'sort_order', title: 'Order', type: 'int', width: 70 },
  { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 90 },
];
const newRow = () => ({ status: 'Active', module: 'Inventory', sort_order: 100 });
const rowClass = (r) => (r.status === 'Inactive' ? 'mutedrow' : '');

export default function ReasonsPage({ query }) {
  const { can } = useSession();
  if (!can('master.reasons')) return <NeedPermission text='You need the "Canned reasons" permission (master.reasons) in this lab to open this page.' />;
  return <Reasons query={query} />;
}

function Reasons({ query }) {
  const { data, error, reload } = useApi(listAllReasons, []);
  return <>
    <PageHeader title="Canned reasons" audit={AUDIT} subtitle="Admin. The reasons offered in the Reason for Change dialog. Each belongs to a module (General reasons are offered everywhere). People pick one and may add a comment, or choose Other and type their own. A reason already used stays in the audit trail as written: set it Inactive rather than rewording it. Maintained by QA and administrators." />
    {error ? <Card body className="err">{error.message}</Card> : !data ? <div className="loading">Loading…</div> : (
      <EditableGrid rows={data} columns={COLUMNS} allowAdd search filter={new URLSearchParams(query).get('find') || ''} what="the canned reasons list"
        newRow={newRow} rowClass={rowClass} save={saveReasons} afterSave={reload} />
    )}
  </>;
}
