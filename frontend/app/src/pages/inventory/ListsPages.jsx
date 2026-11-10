// The inventory lists: Suppliers and manufacturers (shared by every lab), Storage locations (per lab), Warning rules.
// Each is one signed grid with Excel export and upload.
import { useMemo } from 'react';
import { inventoryMe, inventoryMeta, inventorySites, listLocations, listSuppliers, listThresholds, saveLocations, saveSuppliers, saveThresholds } from '../../api/inventory.js';
import BulkButtons from '../../components/bulk/BulkButtons.jsx';
import EditableGrid from '../../components/EditableGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { canonRows, Failed, inactiveRow, InvTabs, listCol, Loading, NeedLab } from './shared.jsx';

const ReadOnlyNote = ({ who }) => (who.can_maintain ? null : <div className="notice">You can view this list. Lab Supervisors, QA, General Managers and administrators maintain it.</div>);
const findOf = (query) => new URLSearchParams(query).get('find') || '';

// ---------------------------------------------------------------- Suppliers and manufacturers
const newSupplier = () => ({ status: 'Active', supplier_type: 'Supplier and Manufacturer' });
const signSuppliers = (rows) => ({ meaning: 'Changed by', action: `Supplier list: ${rows.length} row(s)` });

export function SuppliersPage({ query }) {
  const { can } = useSession();
  const canEdit = can('purchasing.suppliers'); // QA and General Managers by default (migration 011)
  const { data, error, reload } = useApi(() => Promise.all([inventoryMeta(), listSuppliers({ fresh: true })]), []);
  const cols = useMemo(() => (!data ? null : [
    { field: 'supplier_code', title: 'Code', type: 'link', width: 85, href: (r) => (r.id ? '#/purchasing/suppliers/' + r.id : null) },
    { field: 'supplier_name', title: 'Name', required: true, width: 230 },
    { field: 'supplier_type', title: 'Type', type: 'select', options: data[0].supplier_types, width: 190 },
    { field: 'account_number', title: 'Our account #', width: 110 }, { field: 'contact_name', title: 'Contact', width: 130 },
    { field: 'website', title: 'Website', width: 170 }, { field: 'email', title: 'Email', width: 200 }, { field: 'phone', title: 'Phone', width: 110 },
    { field: 'address', title: 'Address', width: 200 }, { field: 'notes', title: 'Notes', width: 160 }, { field: 'lot_count', title: 'Lots', type: 'readonly', width: 50 },
    { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 85 },
  ]), [data?.[0]]); // eslint-disable-line react-hooks/exhaustive-deps
  return <>
    <PageHeader title="Suppliers and manufacturers" audit={{ kind: 'suppliers' }}
      subtitle="Shared by every lab. Whether each supplier is approved for your lab, and its qualification history, is on Purchasing > Suppliers (click a code)." />
    <InvTabs />
    {!canEdit && <div className="notice">You can view this list. Changing it needs the purchasing.suppliers permission (QA and General Managers by default).</div>}
    <div className="invbar"><span className="sp" /><BulkButtons kind="suppliers" onDone={reload} /></div>
    {error && !data ? <Failed error={error} /> : !data ? <Loading /> : (
      <EditableGrid rows={data[1]} columns={cols} allowAdd={canEdit} readOnly={!canEdit} search filter={findOf(query)} what="the Supplier list"
        newRow={newSupplier} rowClass={inactiveRow} sign={signSuppliers} save={saveSuppliers} afterSave={reload} />)}
  </>;
}

// ---------------------------------------------------------------- Storage locations (this lab)
const newLocation = () => ({ status: 'Active', location_type: 'Shelf', supported_conditions: [], holds_samples: false });
const signLocations = (rows) => ({ meaning: 'Changed by', action: `Storage locations: ${rows.length} row(s)` });

export function LocationsPage({ query }) {
  const { site } = useSession();
  const { data, error, reload } = useApi(() => Promise.all([inventoryMeta(), listLocations({ fresh: true }), inventoryMe()]), []);
  const cols = useMemo(() => {
    if (!data) return null;
    const [M, rows] = data;
    const parentOpts = (r) => rows.filter((x) => x.id && x.id !== r.id).map((x) => ({ value: x.id, label: `${x.location_code}: ${x.path}`, match: [x.location_code] }));
    return [
      { field: 'location_code', title: 'Code', required: true, width: 110, editable: (r, isNew) => isNew, href: (r) => (r.id ? '#/inventory/locations/' + r.id : null) },
      { field: 'location_name', title: 'Name', required: true, width: 180 },
      { field: 'location_type', title: 'Type', type: 'select', options: M.location_types, width: 110 },
      { field: 'parent_location_id', title: 'Inside', type: 'select', options: parentOpts, width: 220 },
      listCol('supported_conditions', 'Conditions it provides', M.storage_conditions, 260),
      { field: 'holds_samples', title: 'Holds samples', type: 'bool', width: 95 },
      { field: 'path', title: 'Full path', type: 'readonly', width: 240 },
      { field: 'lot_count', title: 'Lots', type: 'readonly', width: 50 }, { field: 'sample_count', title: 'Samples', type: 'readonly', width: 65 },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 85 },
    ];
  }, [data]);
  if (!site) return <NeedLab />;
  const who = data?.[2];
  return <>
    <PageHeader title={`Storage locations: ${site.site_code}`} audit={{ kind: 'locations' }}
      subtitle={'Nested locations (building, room, fridge, shelf) with the storage conditions each provides. A lot or sample is refused in a location that does not provide the condition it needs. Tick "Holds samples" for retain shelves and fridges. Click a code to see what is stored there.'} />
    <InvTabs />
    {who && <ReadOnlyNote who={who} />}
    <div className="invbar"><span className="sp" /><BulkButtons kind="locations" onDone={reload} /></div>
    {error && !data ? <Failed error={error} /> : !data ? <Loading /> : (
      <EditableGrid rows={data[1]} columns={cols} allowAdd={who.can_maintain} readOnly={!who.can_maintain} search filter={findOf(query)} what="storage locations"
        newRow={newLocation} rowClass={inactiveRow} sign={signLocations}
        save={(r, reason, signature) => saveLocations(canonRows(r, cols), reason, signature)} afterSave={reload} />)}
  </>;
}

// ---------------------------------------------------------------- Warning rules
const newRule = () => ({ status: 'Active' });
const signRules = (rows) => ({ meaning: 'Changed by', action: `Warning rules: ${rows.length} row(s)` });

export function ThresholdsPage() {
  const { data, error, reload } = useApi(() => Promise.all([inventoryMeta(), listThresholds(), inventoryMe(), inventorySites()]), []);
  const cols = useMemo(() => {
    if (!data) return null;
    const [M, , , sites] = data;
    return [
      { field: 'rule_name', title: 'Rule', required: true, width: 300 },
      { field: 'subject', title: 'Watches', type: 'select', options: M.threshold_subjects, width: 120, required: true },
      { field: 'rule_type', title: 'Type', type: 'select', width: 160, required: true,
        options: (r) => (r && r.subject === 'Lot Expiry' ? ['Days Until/Since'] : r && r.subject ? ['Percentage of Base', 'Absolute Max-Min'] : M.threshold_types) },
      { field: 'value', title: 'Value', type: 'number', min: 0, width: 80, required: true },
      { field: 'site_id', title: 'Lab', type: 'select', options: sites.map((s) => ({ value: s.id, label: s.site_code })), width: 80 },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 85 },
    ];
  }, [data]);
  const who = data?.[2];
  return <>
    <PageHeader title="Warning rules" audit={{ kind: 'thresholds' }} subtitle="When to warn about low stock, expiry and low retained sample. Warnings never block work. Leave Lab empty for every lab." />
    <InvTabs />
    {who && <ReadOnlyNote who={who} />}
    <div className="invbar"><span className="sp" /><BulkButtons kind="thresholds" onDone={reload} /></div>
    {error && !data ? <Failed error={error} /> : !data ? <Loading /> : (
      <EditableGrid rows={data[1]} columns={cols} allowAdd={who.can_maintain} readOnly={!who.can_maintain} what="warning rules"
        newRow={newRule} rowClass={inactiveRow} sign={signRules} save={saveThresholds} afterSave={reload} />)}
    <p className="help">Lot Quantity and Sample Retain: Percentage of Base (below this % of the amount received) or Absolute Max-Min (below this amount). Lot Expiry: Days Until/Since (warn this many days before expiry). On a lot page each rule shows Conforms, Alert or Deficient (out of stock or expired).</p>
  </>;
}
