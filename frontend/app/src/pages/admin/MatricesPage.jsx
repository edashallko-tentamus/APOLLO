// Admin > Matrices: the controlled Matrix list, product categories and compliance categories
import { useMemo } from 'react';
import { listComplianceCategories, listMatrices, listProductCategories, saveComplianceCategories, saveMatrices, saveProductCategories } from '../../api/admin.js';
import EditableGrid from '../../components/EditableGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import NeedPermission from './NeedPermission.jsx';
import { Card } from 'react-bootstrap';

const AUDIT = { kind: 'matrices' };
const STATUS = { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 100 };
const rowClass = (r) => (r.status === 'Inactive' ? 'mutedrow' : '');
const newMatrix = () => ({ status: 'Active' });
const CAT_COLUMNS = [
  { field: 'category_name', title: 'Product category', required: true, width: 220 },
  { field: 'description', title: 'Description', width: 360 },
  { field: 'sort_order', title: 'Order', type: 'int', width: 70 },
  STATUS,
];
const COMPLIANCE_COLUMNS = [
  { field: 'category_name', title: 'Category', required: true, width: 230 },
  { field: 'is_gmp', title: 'GMP', type: 'bool', width: 60 },
  { field: 'description', title: 'Description', width: 300 },
  { field: 'sort_order', title: 'Order', type: 'int', width: 70 },
  STATUS,
];

export default function MatricesPage({ query }) {
  const { can } = useSession();
  if (!can('master.matrices')) return <NeedPermission code="master.matrices" />;
  return <Matrices query={query} />;
}

function Matrices({ query }) {
  const { data: rows, error, reload } = useApi(listMatrices, []);
  const { data: cats, error: catError, reload: reloadCats } = useApi(listProductCategories, []);
  const columns = useMemo(() => [
    { field: 'matrix_name', title: 'Matrix', required: true, width: 220 },
    { field: 'description', title: 'Description', width: 360 },
    { field: 'product_category_id', title: 'Product category', type: 'select', width: 170,
      options: [{ value: '', label: '' }, ...(cats || []).filter((c) => c.status === 'Active').map((c) => ({ value: c.id, label: c.category_name }))] },
    STATUS,
  ], [cats]);
  const catCount = cats?.length || 0;
  const newCat = useMemo(() => () => ({ status: 'Active', sort_order: catCount + 1 }), [catCount]);
  const err = error || catError;

  return <>
    <PageHeader title="Matrices" audit={AUDIT} subtitle="Admin. The controlled list of sample matrices offered on the sample grid. A matrix used on samples cannot be renamed: set it Inactive and add the new name. Inactive matrices stay on the samples that already use them. Each matrix can belong to a product category, which workflow steps can use (e.g. a different sample weight for cosmetics and supplements)." />
    {err ? <Card body className="err">{err.message}</Card> : !rows || !cats ? <div className="loading">Loading…</div> : <>
      <Card body>
        <EditableGrid rows={rows} columns={columns} allowAdd search filter={new URLSearchParams(query).get('find') || ''} what="the Matrix list"
          newRow={newMatrix} rowClass={rowClass} save={saveMatrices} afterSave={reload} />
      </Card>
      <Card body>
        <h2>Product categories</h2>
        <p className="help">Used by workflow steps that set amounts per category (Tests and workflows). Shared by all labs.</p>
        <EditableGrid rows={cats} columns={CAT_COLUMNS} allowAdd what="the product categories" newRow={newCat} rowClass={rowClass}
          save={saveProductCategories} afterSave={() => { reloadCats(); reload(); }} />
      </Card>
      <ComplianceCategories />
    </>}
  </>;
}

// What the sample is, as declared on the sample submission form (the old reports.js categories card)
function ComplianceCategories() {
  const { data: d, error, reload } = useApi(listComplianceCategories, []);
  const count = d?.rows.length || 0;
  const newRow = useMemo(() => () => ({ status: 'Active', is_gmp: false, sort_order: (count + 1) * 10 }), [count]);
  return (
    <Card body>
      <h2>Compliance categories</h2>
      <p className="help">What the sample is, as declared on the sample submission form (the sample grid&apos;s Category column). GMP categories are finalized by the quality team (reports.finalize_gmp). Kept by QA and administrators (master.compliance).</p>
      {error ? <Card body className="err">{error.message}</Card> : !d ? <div className="loading">Loading…</div> : (
        <EditableGrid rows={d.rows} columns={COMPLIANCE_COLUMNS} allowAdd={d.can_edit} readOnly={!d.can_edit} what="the compliance categories"
          newRow={newRow} rowClass={rowClass} save={saveComplianceCategories} afterSave={reload} />
      )}
    </Card>
  );
}
