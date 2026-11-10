// Sample storage: where each logged sample is kept and how much retained sample is left (fill down to shelve many)
import { useMemo } from 'react';
import { inventoryMeta, sampleStorage, saveSampleStorage } from '../../api/inventory.js';
import BulkButtons from '../../components/bulk/BulkButtons.jsx';
import EditableGrid from '../../components/EditableGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { Failed, InvTabs, loadLookups, Loading, NeedLab, qty } from './shared.jsx';

const sign = (rows) => ({ meaning: 'Changed by', action: `Sample storage: ${rows.length} sample(s)` });
const usedUp = (r) => (r.retain_used_up ? 'mutedrow' : '');

function columnsFor(M, L) {
  return [
    { field: 'sample_code', title: 'Sample ID', type: 'link', width: 125, href: (r) => '#/samples/' + r.id },
    { field: 'client_sample_id', title: 'Client sample ID', type: 'readonly', width: 120 },
    { field: 'description', title: 'Description', type: 'readonly', width: 180 },
    { field: 'client_name', title: 'Client', type: 'readonly', width: 160 },
    { field: 'order_code', title: 'Order', type: 'link', width: 95, href: (r) => '#/orders/' + r.lab_order_id },
    { field: 'received', title: 'Received', type: 'readonly', width: 85, compute: (r) => qty(r.quantity_received, r.quantity_unit) },
    { field: 'loc', title: 'Code', type: 'link', width: 90, compute: (r) => r.location_code || '', href: (r) => (r.storage_location_id ? '#/inventory/locations/' + r.storage_location_id : null), help: 'Opens the storage location' },
    { field: 'storage_location_id', title: 'Location', type: 'select', width: 210, options: L.sampleLocOpts },
    { field: 'storage_condition', title: 'Storage condition', type: 'select', width: 160, options: M.storage_conditions },
    { field: 'retained_quantity', title: 'Retained', type: 'number', min: 0, width: 80 },
    { field: 'retained_unit', title: 'Unit', width: 55, help: 'Defaults to the unit the sample was received in' },
    { field: 'flag', title: 'Retain', type: 'readonly', width: 110, compute: (r) => (r.retain_used_up ? 'Used up' : r.retain_low ? 'Low' : r.retained_quantity === null || r.retained_quantity === undefined ? '' : 'OK') },
  ];
}

export default function SampleStoragePage({ query }) {
  const { site } = useSession();
  const { data, error, reload } = useApi(() => Promise.all([inventoryMeta(), loadLookups(), sampleStorage()]), []);
  const cols = useMemo(() => (data ? columnsFor(data[0], data[1]) : null), [data?.[0], data?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!site) return <NeedLab />;
  return <>
    <PageHeader title={`Sample storage: ${site.site_code}`} audit={{ kind: 'samplestorage' }}
      subtitle="Where each logged sample is kept and how much retained sample is left. A client retest needs retained sample, so low retains are flagged (never blocked). Select a block and press Ctrl+D to shelve many samples at once." />
    <InvTabs />
    <div className="invbar"><span className="sp" /><BulkButtons kind="samplestorage" onDone={reload} /></div>
    {error && !data ? <Failed error={error} /> : !data ? <Loading /> : (
      <EditableGrid rows={data[2]} columns={cols} search filter={new URLSearchParams(query).get('find') || ''} what="sample storage and retained quantity"
        emptyText="No logged samples in this lab yet." rowClass={usedUp} sign={sign} save={saveSampleStorage} afterSave={reload} />)}
  </>;
}
