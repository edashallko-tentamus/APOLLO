// One storage location: what it is, what is inside it, the lots and samples stored there
import { getLocation } from '../../api/inventory.js';
import Badge from '../../components/Badge.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useApi } from '../../hooks/useApi.js';
import { amtCls, d8, expCls, Failed, Kv, Loading, qty, ReadGrid } from './shared.jsx';

const CHILD_COLS = [
  { field: 'location_code', title: 'Code', type: 'link', width: 110, href: (r) => '#/inventory/locations/' + r.id },
  { field: 'location_name', title: 'Name', type: 'readonly', width: 180 }, { field: 'lot_count', title: 'Lots', type: 'readonly', width: 50 }, { field: 'sample_count', title: 'Samples', type: 'readonly', width: 65 }];
const LOT_COLS = [
  { field: 'lot_code', title: 'ID', type: 'link', width: 100, href: (r) => '#/inventory/lots/' + r.id }, { field: 'material', title: 'Name', type: 'readonly', width: 240 },
  { field: 'storage_condition', title: 'Condition', type: 'readonly', width: 160 },
  { field: 'amount', title: 'Amount', type: 'readonly', width: 90, compute: (r) => (r.receipt_status === 'Received' ? qty(r.on_hand, r.unit) : r.receipt_status), cellClass: amtCls },
  { field: 'expiration_date', title: 'Exp date', type: 'readonly', width: 95, format: d8, cellClass: expCls }];
const SAMPLE_COLS = [
  { field: 'sample_code', title: 'Sample ID', type: 'link', width: 125, href: (r) => '#/samples/' + r.id }, { field: 'client_name', title: 'Client', type: 'readonly', width: 180 },
  { field: 'retained_quantity', title: 'Retained', type: 'readonly', width: 90, format: (v, r) => qty(v, r.retained_unit) }];

export default function LocationPage({ params: [id] }) {
  const { data: d, error } = useApi(() => getLocation(id), [id]);
  if (error && !d) return <Failed error={error} />;
  if (!d) return <Loading />;
  const l = d.location;
  return <>
    <div className="eyebrow">{l.site_code} · {l.path || ''}</div>
    <PageHeader title={`${l.location_code}: ${l.location_name}`} audit={{ kind: 'location', id }} actions={<a className="btn ghost" href="#/inventory/locations">All locations</a>}
      subtitle={<>{l.location_type} <Badge status={l.status} />{l.holds_samples && <> <span className="badge w-info">Holds samples</span></>}</>} />
    <div className="cols">
      <div className="card"><h2>Location</h2><Kv pairs={[
        ['Code', l.location_code], ['Inside', l.parent_location_id ? <a href={'#/inventory/locations/' + l.parent_location_id}>{l.parent_code}</a> : 'Top level'],
        ['Full path', l.path], ['Conditions it provides', (l.supported_conditions || []).join(', ') || 'Not checked (none listed)'],
        ['Holds samples', l.holds_samples ? 'Yes' : 'No']]} /></div>
      <div className="card"><h2>Inside this location</h2><ReadGrid rows={d.children} columns={CHILD_COLS} emptyText="Nothing inside." /></div>
    </div>
    <Section title={`Inventory stored here (${d.lots.length})`}><ReadGrid rows={d.lots} columns={LOT_COLS} emptyText="No open lots here." /></Section>
    {(d.samples.length > 0 || l.holds_samples) && <Section title={`Samples stored here (${d.samples.length})`}><ReadGrid rows={d.samples} columns={SAMPLE_COLS} emptyText="No samples here." /></Section>}
  </>;
}
