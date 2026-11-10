// The Audit trail page: every create and update, written by the database (latest 300), filtered by record type
import { useEffect, useMemo, useState } from 'react';
import { auditEntries, auditTables } from '../../api/master.js';
import PageHeader from '../../components/PageHeader.jsx';
import SmartSelect from '../../components/SmartSelect.jsx';
import { auditColumns } from '../../components/audit/auditColumns.js';
import DataGrid from '../../components/grid/DataGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import { useApi } from '../../hooks/useApi.js';
import { Card } from 'react-bootstrap';

const COLUMNS = (() => {
  const cols = auditColumns();
  cols.splice(2, 0, { field: 'table_name', title: 'Record type', type: 'readonly', width: 150, format: (v) => String(v || '').replace(/_/g, ' ') });
  return cols;
})();
const NO_ROWS = [];
let lastTable = ''; // the record type shown last, as the old screen remembered it

export default function AuditPage() {
  const [table, setTable] = useState(lastTable);
  const { data: tables } = useApi(auditTables, []);
  const { data, error, loading } = useApi((opts) => auditEntries(table, opts), [table]);
  const rows = data || NO_ROWS;
  const grid = useGrid({ rows, columns: COLUMNS, readOnly: true });
  const { reset } = grid;
  useEffect(() => { reset(rows); }, [rows, reset]);
  const options = useMemo(() => [{ value: '', label: 'All' },
    ...(tables || []).map((t) => ({ value: t.table_name, label: `${t.table_name.replace(/_/g, ' ')} (${t.n})` }))], [tables]);

  return <>
    <PageHeader title="Audit trail" subtitle="Written by the database for every create and update. It cannot be edited or deleted, and records cannot be hard-deleted." />
    <div className="filters">
      <label>Record type <SmartSelect value={table} options={options} onChange={(v) => { lastTable = v; setTable(v); }} /></label>
      <span className="help">Latest 300 entries</span>
    </div>
    {error ? <Card body className="err">{error.message}</Card> : loading && !data ? <div className="loading">Loading…</div>
      : <DataGrid grid={grid} search />}
  </>;
}
