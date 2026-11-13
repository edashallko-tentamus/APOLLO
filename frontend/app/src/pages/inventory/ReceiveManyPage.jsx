// Receive many: paste a packing list (one row per item), fill down the location and condition, sign once ("Received by")
import { useEffect, useMemo, useRef } from 'react';
import { inventoryMeta, saveLotsBulk } from '../../api/inventory.js';
import EditableGrid from '../../components/EditableGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { canonRows, Failed, listCol, loadLookups, Loading, NeedLab } from './shared.jsx';
import { Button } from 'react-bootstrap';

const NO_ROWS = [];
const newRow = () => ({}); // received date defaults to today when saved
const sign = (rows) => ({ meaning: 'Received by', action: `Receive many: ${rows.length} item(s)` });

function columnsFor(M, L) {
  const types = M.chemical_types.filter((t) => t !== 'In-house mixture');
  return [
    { field: 'item_name', title: 'Name', width: 200, required: true },
    listCol('chemical_types', 'Type', types, 150),
    { field: 'physical_form', title: 'Solid or liquid', type: 'select', options: ['Solid', 'Liquid'], width: 95 },
    { field: 'analyte_id', title: 'Analyte', type: 'select', options: L.analyteOpts, width: 150, help: 'For a standard or strain; one analyte per row here (use the item page for multi-element standards)' },
    { field: 'analyte_concentration', title: 'Analyte conc.', type: 'number', min: 0, width: 90 },
    { field: 'analyte_unit', title: 'Conc. unit', type: 'select', options: M.conc_units, width: 80 },
    { field: 'manufacturer_lot', title: 'Lot #', width: 110 },
    { field: 'quantity_received', title: 'Quantity', type: 'number', min: 0, width: 80 },
    { field: 'unit', title: 'Unit', type: 'select', options: M.units, width: 60 },
    { field: 'expiration_date', title: 'Expires', type: 'date', width: 95 },
    { field: 'storage_location_id', title: 'Location', type: 'select', width: 150, options: L.locOpts },
    { field: 'storage_condition', title: 'Storage condition', type: 'select', width: 150, options: M.storage_conditions },
    { field: 'supplier_id', title: 'Vendor', type: 'select', width: 150, options: L.supOpts },
    { field: 'manufacturer_id', title: 'Manufacturer', type: 'select', width: 150, options: L.mfrOpts },
    { field: 'catalog_number', title: 'Catalog #', width: 100 },
    { field: 'purity_pct', title: 'Purity %', type: 'number', min: 0, max: 100, width: 70 },
    { field: 'cas_number', title: 'CAS', width: 95 },
    { field: 'received_date', title: 'Received on', type: 'date', width: 95 },
  ];
}

function ReceiveGrid({ M, L }) {
  const cols = useMemo(() => columnsFor(M, L), [M, L]);
  const apiRef = useRef(null);
  useEffect(() => { apiRef.current?.grid.act.addRows(5); }, []);
  return <EditableGrid rows={NO_ROWS} columns={cols} allowAdd newRow={newRow} what="inventory received" apiRef={apiRef}
    emptyText="Add rows, or click a cell and paste lines from a packing list." sign={sign}
    save={(changes, reason, signature) => saveLotsBulk(canonRows(changes, cols), reason, signature)}
    afterSave={() => { setTimeout(() => { window.location.hash = '#/inventory'; }, 0); }} />; // after the grid has redrawn as saved
}

export default function ReceiveManyPage() {
  const { site } = useSession();
  const { data, error } = useApi(() => Promise.all([inventoryMeta(), loadLookups()]), []);
  if (!site) return <NeedLab />;
  return <>
    <PageHeader title="Receive many" audit={{ kind: 'inventory' }} actions={<Button variant="light" href="#/inventory">Inventory</Button>}
      subtitle="Paste a packing list from Excel (Name, Type, Solid or liquid, Analyte, Concentration, Unit, Lot #, Quantity, Unit, Expires, …) or add rows, then fill down (Ctrl+D) the location and storage condition. For one item at a time, use + New Inventory Item." />
    {error && !data ? <Failed error={error} /> : !data ? <Loading /> : <ReceiveGrid M={data[0]} L={data[1]} />}
  </>;
}
