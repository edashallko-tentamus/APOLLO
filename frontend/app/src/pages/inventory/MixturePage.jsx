// New in-house mixture: component lots and amounts; the quantity made defaults to their total and each analyte's
// concentration is calculated by the backend from the Units and Unit conversions tables. Signed "Prepared by".
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { allLots, convertibleUnits, inventoryMeta, mixturePreview, prepareMixture } from '../../api/inventory.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import DataGrid from '../../components/grid/DataGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import SmartSelect from '../../components/SmartSelect.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useUnsavedChanges } from '../../router/useHashRoute.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { signed } from './dialogs.jsx';
import { d8, Failed, Field, fmtN, isMixture, loadLookups, Loading, NeedLab, opts, qty, withBlank } from './shared.jsx';

const PREFER = { L: 'mL', kg: 'g' }; // how analysts usually measure
const PREVIEW_DELAY_MS = 250;

async function load() {
  const [M, L, rows] = await Promise.all([inventoryMeta(), loadLookups(), allLots()]);
  const usable = rows.filter((r) => r.use_eligible);
  // Amount used can be entered in any unit the Unit conversions table links to the lot's unit (e.g. mL of a solvent kept in L)
  const lotUnits = [...new Set(usable.map((r) => r.unit).filter(Boolean))];
  const conv = lotUnits.length ? await convertibleUnits(lotUnits) : {};
  return { M, L, usable, conv };
}

export default function MixturePage() {
  const { site } = useSession();
  const { data, error } = useApi(load, []);
  if (!site) return <NeedLab />;
  if (error && !data) return <Failed error={error} />;
  if (!data) return <Loading />;
  return <MixtureForm {...data} />;
}

function MixtureForm({ M, L, usable, conv }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const lotOf = (id) => usable.find((u) => u.id === id);
  const unitsFor = (r) => { const l = lotOf(r.lot_id); return l && l.unit ? [...new Set([l.unit, ...(conv[l.unit] || [])])] : []; };
  // A newly picked (or scanned) lot gets the unit analysts usually measure it in, if the tables can convert it
  const unitOf = (r) => { const ok = unitsFor(r); if (!r.lot_id) return null; if (r.unit && ok.includes(r.unit)) return r.unit; const kept = ok[0]; return ok.includes(PREFER[kept]) ? PREFER[kept] : kept; };

  const [f, setF] = useState({ name: '', form: 'Liquid', types: [], loc: '', cond: '', exp: '', retest: '', notes: '', qty: '', unit: 'mL' });
  const [qtyTouched, setQtyTouched] = useState(false);
  const set = (k) => (x) => setF((s) => ({ ...s, [k]: x }));
  const extraTypes = M.chemical_types.filter((t) => !['In-house mixture', 'Consumable'].includes(t));

  const compOpts = useMemo(() => usable.map((r) => ({ value: r.id, label: `${r.lot_code} · ${r.material}${isMixture(r) ? '' : r.manufacturer_lot ? ' · lot ' + r.manufacturer_lot : ''} (${qty(r.on_hand, r.unit)}, exp. ${d8(r.expiration_date) || 'none'})`,
    match: [r.lot_code, r.material] })), [usable]);
  const compCols = useMemo(() => [
    { field: 'lot_id', title: 'Lot', type: 'select', options: compOpts, width: 460 },
    { field: 'quantity', title: 'Amount used', type: 'number', min: 0, width: 110 },
    { field: 'unit', title: 'Unit', type: 'select', width: 70, options: (r) => unitsFor(r), format: (v, r) => unitOf(r) || '', help: 'Any unit the Unit conversions table links to the unit the lot is kept in; converted when the stock is drawn' },
    { field: 'kept', title: 'Lot kept in', type: 'readonly', width: 80, compute: (r) => lotOf(r.lot_id)?.unit || '' },
    { field: 'type', title: 'Type', type: 'readonly', width: 170, compute: (r) => lotOf(r.lot_id)?.chemical_types_text || '' },
    { field: 'an', title: 'Analytes', type: 'readonly', width: 220, compute: (r) => lotOf(r.lot_id)?.analytes_text || '' },
  ], [compOpts]); // eslint-disable-line react-hooks/exhaustive-deps -- usable and conv are fixed for the page
  const [startRows] = useState(() => [{}, {}, {}]);
  const comp = useGrid({ rows: startRows, columns: compCols, allowAdd: true, newRow: () => ({}) });
  const components = comp.state.rows.filter((r) => r.lot_id && Number(r.quantity) > 0).map((r) => ({ lot_id: r.lot_id, quantity: Number(r.quantity), unit: unitOf(r) || null }));

  // ---------------------------------------------------------------- calculated concentration
  const calcCols = useMemo(() => [
    { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 120 },
    { field: 'concentration', title: 'Prepared', type: 'readonly', width: 95, align: 'right', format: (v) => (v === null || v === undefined ? 'Not calculated' : fmtN(v)) },
    { field: 'concentration_unit', title: 'Unit', type: 'select', options: M.conc_units, width: 80 },
    { field: 'target', title: 'Target', type: 'number', min: 0, width: 75 },
    { field: 'tolerance_pct', title: '± %', type: 'number', min: 0, width: 55 },
    { field: 'result', title: 'Result', type: 'readonly', width: 95, compute: (r) => (r.target === null || r.target === undefined || r.target === '' ? '' : r.concentration === null || r.concentration === undefined ? 'Not calculated'
      : Math.abs(r.concentration - r.target) <= r.target * (Number(r.tolerance_pct) || 0) / 100 ? 'Conforms' : 'Alert') },
  ], [M]);
  const [calc, setCalc] = useState([]);
  const cg = useGrid({ rows: calc, columns: calcCols, keyField: 'analyte_id' });
  const { reset: resetCalc } = cg;
  // analyte id -> { unit, target, tolerance_pct }, as the person set them in the calculated grid
  const targets = useMemo(() => Object.fromEntries(cg.state.rows.map((r) => [r.analyte_id, { unit: r.concentration_unit, target: r.target ?? null, tolerance_pct: r.tolerance_pct ?? null }])), [cg.state.rows]);
  const [defaultQty, setDefaultQty] = useState(null);

  // ask the backend again a short pause after any input changes (one request at a time; an older answer is dropped)
  const outUnits = Object.fromEntries(Object.entries(targets).filter(([, t]) => t.unit).map(([k, t]) => [k, t.unit]));
  const body = JSON.stringify({ components, quantity: qtyTouched ? f.qty : null, unit: f.unit, form: f.form, out_units: outUnits });
  const seq = useRef(0);
  useEffect(() => {
    const my = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const p = await mixturePreview(JSON.parse(body));
        if (my !== seq.current) return;
        setDefaultQty(p.default_quantity || null);
        if (!qtyTouched) setF((s) => ({ ...s, qty: p.default_quantity ? Number(p.default_quantity).toFixed(6).replace(/\.?0+$/, '') : '' }));
        const next = p.analytes.map((a) => ({ ...a, target: targets[a.analyte_id]?.target ?? null, tolerance_pct: targets[a.analyte_id]?.tolerance_pct ?? null }));
        setCalc(next);
        if (!cg.state.editing) resetCalc(next);
      } catch (e) { toast(e.message, 'err'); }
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(t);
  }, [body]); // eslint-disable-line react-hooks/exhaustive-deps -- the request is everything it depends on

  useUnsavedChanges(components.length > 0);
  const [saving, setSaving] = useState(false);
  async function save() {
    if (saving) return;
    const name = f.name.trim();
    if (!name) { toast('Enter the mixture name.', 'err'); document.getElementById('m_name')?.focus(); return; }
    if (!components.length) { toast('Add at least one component lot with the amount used.', 'err'); return; }
    if (comp.errorCount || cg.errorCount) { toast('Fix the cells marked in red.', 'err'); return; }
    const t = cg.state.rows.map((r) => ({ analyte_id: r.analyte_id, unit: r.concentration_unit, target: r.target ?? null, tolerance_pct: r.tolerance_pct ?? null }));
    setSaving(true);
    try {
      const r = await signed(dialogs, { what: `In-house mixture ${name}: ${f.qty} ${f.unit} from ${components.length} component lot(s)`, meaning: 'Prepared by', needReason: false },
        (reason, signature) => prepareMixture({ signature, item_name: name, physical_form: f.form, chemical_types: f.types,
          quantity: Number(f.qty), unit: f.unit, expiration_date: f.exp || null, retest_date: f.retest || null,
          storage_location_id: f.loc || null, storage_condition: f.cond || null, notes: f.notes.trim() || null, components, targets: t }));
      if (r) { toast('Mixture prepared and signed.'); flushSync(() => comp.reset([])); window.location.hash = '#/inventory/lots/' + r.id; }
    } finally { setSaving(false); }
  }

  const setForm = (x) => { setF((s) => ({ ...s, form: x, unit: qtyTouched ? s.unit : (x === 'Solid' ? 'g' : 'mL') })); };
  return <>
    <PageHeader title="New in-house mixture"
      subtitle="Pick the component lots and how much of each was used. The quantity made defaults to the total of the components, and the concentration of each analyte is calculated from the components using the Units and Unit conversions tables. The mixture gets a Resource ID (its lab ID) and cannot expire after its earliest-expiring component."
      actions={<><a className="btn ghost" href="#/inventory">Cancel</a> <button type="button" className="btn primary" disabled={saving} onClick={save}>Prepare mixture</button></>} />
    <div className="itemform">
      <div className="cols">
        <div className="card"><h2>Identity</h2>
          <Field label="Name" req help={'e.g. "Sodium Working Solution 10 ppm"'}><input id="m_name" value={f.name} onChange={(e) => set('name')(e.target.value)} /></Field>
          <Field label="Solid or liquid" req help="Liquid: concentrations per volume (mg/L, ppm). Solid: per mass (mg/kg)."><div className="checks">
            {['Liquid', 'Solid'].map((x) => <label key={x}><input type="radio" name="mform" value={x} checked={f.form === x} onChange={() => setForm(x)} /> {x}</label>)}</div></Field>
          <Field label="Also a" help="It is always an In-house mixture; tick Reference Standard for a working standard."><div className="checks" id="m_types">
            {extraTypes.map((t) => <label key={t}><input type="checkbox" value={t} checked={f.types.includes(t)} onChange={(e) => set('types')(e.target.checked ? [...f.types, t] : f.types.filter((x) => x !== t))} /> {t}</label>)}</div></Field>
          <div className="grid2"><Field label="Storage location"><SmartSelect id="m_loc" value={f.loc} options={withBlank(L.locOpts)} onChange={set('loc')} /></Field>
            <Field label="Storage condition"><SmartSelect id="m_cond" value={f.cond} options={withBlank(opts(M.storage_conditions))} onChange={set('cond')} /></Field></div>
          <div className="grid2"><Field label="Expiration date" help="Empty: the earliest-expiring component"><input id="m_exp" type="date" value={f.exp} onChange={(e) => set('exp')(e.target.value)} /></Field>
            <Field label="Retest date"><input id="m_retest" type="date" value={f.retest} onChange={(e) => set('retest')(e.target.value)} /></Field></div>
          <Field label="Notes (work instruction)"><input id="m_notes" value={f.notes} onChange={(e) => set('notes')(e.target.value)} /></Field>
        </div>
        <div className="card"><h2>Quantitative</h2>
          <div className="grid2">
            <Field label="Quantity made" req help={defaultQty ? `Defaulted to the total of the components that can be expressed in ${f.unit}: ${fmtN(defaultQty)} ${f.unit}. Change it if you made it up to a different volume.` : ''}>
              <input id="m_qty" type="number" step="any" value={f.qty} onChange={(e) => { setQtyTouched(e.target.value.trim() !== ''); set('qty')(e.target.value); }} /></Field>
            <Field label="Unit" req><SmartSelect id="m_unit" value={f.unit} options={opts(M.units)} onChange={set('unit')} /></Field></div>
          <div className="field"><label>Calculated concentration</label>
            <div title={calc.map((a) => `${a.analyte_name}: ${a.calc_note}`).join('\n')}><DataGrid grid={cg} emptyText="Add component lots that carry analytes to see their concentration here." /></div>
            {calc.length > 0 && <div id="cgnotes" className="calcnote">{calc.map((a) => <div key={a.analyte_id}>{a.analyte_name}: {a.calc_note || ''}</div>)}</div>}
            <div className="help">Set the unit to report in, and a target ± tolerance to check the result.</div></div>
        </div>
      </div>
      <Section title="Component lots" help="Only usable lots of this lab are offered (received, in date, not on hold). Each component is drawn from stock when the mixture is prepared.">
        <DataGrid grid={comp} /></Section>
    </div>
  </>;
}
