// Compliance categories (Admin > Matrices card). Exported for the admin area: <ComplianceCategories />
import { useCallback } from 'react';
import { complianceCategories, saveComplianceCategories } from '../../api/reports.js';
import EditableGrid from '../../components/EditableGrid.jsx';
import { useApi } from '../../hooks/useApi.js';
import { Failed, Loading } from './shared.jsx';
import { Card } from 'react-bootstrap';

const COLUMNS = [
  { field: 'category_name', title: 'Category', required: true, width: 230 },
  { field: 'is_gmp', title: 'GMP', type: 'bool', width: 60 },
  { field: 'description', title: 'Description', width: 300 },
  { field: 'sort_order', title: 'Order', type: 'int', width: 70 },
  { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 100 },
];
const inactiveRow = (r) => (r.status === 'Inactive' ? 'mutedrow' : '');

export default function ComplianceCategories() {
  const { data: d, error, reload } = useApi(() => complianceCategories(), []);
  const count = d?.rows.length || 0;
  const newRow = useCallback(() => ({ status: 'Active', is_gmp: false, sort_order: (count + 1) * 10 }), [count]);
  return <Card body>
    <h2>Compliance categories</h2>
    <p className="help">What the sample is, as declared on the sample submission form (the sample grid&apos;s Category column). GMP categories are finalized by the quality team (reports.finalize_gmp). Kept by QA and administrators (master.compliance).</p>
    {error && !d ? <Failed error={error} /> : !d ? <Loading />
      : <EditableGrid rows={d.rows} columns={COLUMNS} allowAdd={d.can_edit} readOnly={!d.can_edit} what="the compliance categories"
        newRow={newRow} rowClass={inactiveRow} save={saveComplianceCategories} afterSave={reload} />}
  </Card>;
}
