// #/methods/sops: the lab's methods (SOPs). Each save is signed: Created by for new rows, Changed by (with a reason) for changes.
import { listSops, saveSops } from '../../api/methods.js';
import EditableGrid from '../../components/EditableGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { ListTabs, Loading, NeedLab } from './shared.jsx';

const COLUMNS = [
  { field: 'method_code', title: 'Code', type: 'readonly', width: 95 },
  { field: 'method_name', title: 'Method name', required: true, width: 330 },
  { field: 'sop_code', title: 'SOP code', width: 140 },
  { field: 'sop_link', title: 'Link to the SOP (QMS)', width: 260 },
  { field: 'description', title: 'Notes', width: 260 },
  { field: 'test_count', title: 'Tests', type: 'readonly', width: 60 },
  { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 90 },
];
const newRow = () => ({ status: 'Active' });
const rowClass = (r) => (r.status === 'Inactive' ? 'mutedrow' : '');
const sign = (rows) => ({ meaning: rows.some((r) => r.id) ? 'Changed by' : 'Created by', action: `Methods (SOPs): ${rows.length} row(s)` });
const AUDIT = { kind: 'sops' };
const SUB = 'The lab\'s own methods: the method name (it may name a standard, e.g. USP <233>) and the SOP code of the controlled document in the QMS. One method can back several tests. Paste rows from Excel, or fill down with Ctrl+D.';

export default function SopsPage({ query }) {
  const { site } = useSession();
  const { data: d, error, reload } = useApi((o) => (site ? listSops(o) : Promise.resolve(null)), [site?.id]);
  const header = <PageHeader title="Methods (SOPs)" subtitle={SUB} audit={AUDIT} />;
  if (!site) return <NeedLab />;
  if (error && !d) return <>{header}<div className="card err">{error.message}</div></>;
  if (!d) return <>{header}<Loading /></>;
  return <>
    {header}
    <ListTabs cur="#/methods/sops" />
    {!d.can_design && <div className="notice">You can view the methods. Changing them needs methods.design in this lab.</div>}
    <div className="card">
      <EditableGrid rows={d.rows} columns={COLUMNS} allowAdd={d.can_design} readOnly={!d.can_design} search filter={new URLSearchParams(query).get('find') || ''}
        what="methods" newRow={newRow} rowClass={rowClass} sign={sign} save={saveSops} afterSave={reload} />
    </div>
  </>;
}
