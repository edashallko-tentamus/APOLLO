// Admin: Units and Unit conversions, the controlled tables every quantity and concentration uses (QA and administrators)
import { useMemo, useState } from 'react';
import { convertUnits, inventoryMeta, listConversions, listUnits, saveConversions, saveUnits } from '../../api/inventory.js';
import BulkButtons from '../../components/bulk/BulkButtons.jsx';
import EditableGrid from '../../components/EditableGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import SmartSelect from '../../components/SmartSelect.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { Failed, fmtN, inactiveRow, Loading, opts } from './shared.jsx';
import { Button, Card } from 'react-bootstrap';

const UnitsNote = () => <div className="alert alert-warning">You can view this list. People with the Units permission (QA and administrators by default) maintain it.</div>;
const findOf = (query) => new URLSearchParams(query).get('find') || '';

// ---------------------------------------------------------------- Units
const newUnit = () => ({ status: 'Active', sort_order: 200 });
const signUnits = (rows) => ({ meaning: 'Changed by', action: `Units list: ${rows.length} row(s)` });

export function UnitsPage({ query }) {
  const { can } = useSession();
  const canUnits = can('master.units');
  const { data, error, reload } = useApi(() => Promise.all([inventoryMeta(), listUnits()]), []);
  const cols = useMemo(() => (!data ? null : [
    { field: 'unit_code', title: 'Code', required: true, width: 100, editable: (r, isNew) => isNew || !Number(r.used_count) },
    { field: 'unit_name', title: 'Name', required: true, width: 260 },
    { field: 'dimension', title: 'Measures', type: 'select', options: data[0].dimensions, width: 140, required: true },
    { field: 'sort_order', title: 'Order', type: 'int', width: 70 },
    { field: 'is_serving_unit', title: 'Serving unit', type: 'bool', width: 95, help: 'Offered when a sample\'s serving is entered (e.g. 2 capsules, 1 scoop)' },
    { field: 'conversion_count', title: 'Conversions', type: 'readonly', width: 95 },
    { field: 'used_count', title: 'Used on lots', type: 'readonly', width: 95 },
    { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 85 },
  ]), [data?.[0]]); // eslint-disable-line react-hooks/exhaustive-deps
  return <>
    <PageHeader title="Units" audit={{ kind: 'units' }}
      subtitle="Admin. The controlled list of units used for quantities and concentrations everywhere in the system. Maintained by QA and administrators; every change is audited. A unit already used on inventory keeps its code: set it Inactive and add a new one instead." />
    {!canUnits && <UnitsNote />}
    <div className="invbar"><Button variant="light" href="#/admin/conversions">Unit conversions</Button><span className="sp" /><BulkButtons kind="units" onDone={reload} /></div>
    {error && !data ? <Failed error={error} /> : !data ? <Loading /> : (
      <EditableGrid rows={data[1]} columns={cols} allowAdd={canUnits} readOnly={!canUnits} search filter={findOf(query)} what="the Units list"
        newRow={newUnit} rowClass={inactiveRow} sign={signUnits} save={saveUnits} afterSave={reload} />)}
  </>;
}

// ---------------------------------------------------------------- Unit conversions
const newConversion = () => ({ status: 'Active', applies_to: 'Any' });
const signConversions = (rows) => ({ meaning: 'Changed by', action: `Unit conversions: ${rows.length} row(s)` });
const FORMS = [{ value: '', label: 'Any' }, { value: 'Liquid', label: 'Liquid' }, { value: 'Solid', label: 'Solid' }];

function TryConversion({ units }) {
  const toast = useToast();
  const codes = useMemo(() => opts(units.map((u) => u.unit_code)), [units]);
  const [t, setT] = useState({ v: '1', from: units[0]?.unit_code || '', to: units[0]?.unit_code || '', form: '' });
  const [out, setOut] = useState('');
  async function go() {
    try {
      const r = await convertUnits(t.from, t.to, t.form);
      const v = Number(t.v);
      setOut(r.factor === null || r.factor === undefined ? 'Cannot convert with the current table' : `${fmtN(v)} ${t.from} = ${fmtN(v * r.factor)} ${t.to}`);
    } catch (e) { toast(e.message, 'err'); }
  }
  const set = (k) => (x) => setT((s) => ({ ...s, [k]: x }));
  return (
    <Card body><h2>Try a conversion</h2><div className="invbar">
      <input id="c_v" type="number" step="any" value={t.v} onChange={(e) => set('v')(e.target.value)} style={{ width: 90 }} className="gsearch" />
      <SmartSelect id="c_f" value={t.from} options={codes} onChange={set('from')} /> to <SmartSelect id="c_t" value={t.to} options={codes} onChange={set('to')} />
      <SmartSelect id="c_form" value={t.form} options={FORMS} onChange={set('form')} /><Button type="button" variant="outline-secondary" onClick={go}>Convert</Button><b id="c_out">{out}</b>
    </div></Card>
  );
}

export function ConversionsPage() {
  const { can } = useSession();
  const canUnits = can('master.units');
  const { data, error, reload } = useApi(() => Promise.all([listConversions(), listUnits()]), []);
  const cols = useMemo(() => {
    if (!data) return null;
    const uOpts = data[1].filter((u) => u.status === 'Active').map((u) => ({ value: u.id, label: u.unit_code, match: [u.unit_name] }));
    return [
      { field: 'from_unit_id', title: 'From', type: 'select', options: uOpts, width: 100, required: true },
      { field: 'factor', title: 'Factor', type: 'number', min: 0, width: 140, required: true },
      { field: 'to_unit_id', title: 'To', type: 'select', options: uOpts, width: 100, required: true },
      { field: 'applies_to', title: 'Applies to', type: 'select', options: ['Any', 'Liquid', 'Solid'], width: 90 },
      { field: 'assumption', title: 'Assumption', width: 320 },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 85 },
    ];
  }, [data?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return <>
    <PageHeader title="Unit conversions" audit={{ kind: 'conversions' }}
      subtitle="Admin. How units convert: 1 [From] = Factor × [To]. Conversions work in both directions and can be chained (for example µg/mL → mg/L → g/L), so only one conversion per pair is needed. ppm-type conversions apply to liquids or to solids only. Maintained by QA and administrators; every change is audited." />
    {!canUnits && <UnitsNote />}
    <div className="invbar"><Button variant="light" href="#/admin/units">Units</Button><span className="sp" /><BulkButtons kind="conversions" onDone={reload} /></div>
    {error && !data ? <Failed error={error} /> : !data ? <Loading /> : <>
      <TryConversion units={data[1]} />
      <EditableGrid rows={data[0]} columns={cols} allowAdd={canUnits} readOnly={!canUnits} search what="unit conversions"
        newRow={newConversion} rowClass={inactiveRow} sign={signConversions} save={saveConversions} afterSave={reload} />
    </>}
  </>;
}
