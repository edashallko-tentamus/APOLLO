// The settings of each step type (renderConfig in methods.js), except Batching and Calculation (own files).
// Each editor puts readRef.current = () => the step's config (it may throw a message to show); small grids keep
// fill down and paste from Excel.
import { useMemo, useState } from 'react';
import DataGrid from '../../components/grid/DataGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import { Field, numOf, Pick, slug, str } from './shared.jsx';
import { Form } from 'react-bootstrap';

// a grid of settings (no save bar: it is saved with the step)
export function useCfgGrid(rows, columns, ed, newRow = () => ({})) {
  return useGrid({ rows, columns, readOnly: !ed, allowAdd: ed, newRow });
}
// the grid's rows that hold anything
export const filled = (g) => g.state.rows.filter((r) => Object.values(r).some((x) => x !== null && x !== undefined && x !== ''));
export const CfgGrid = ({ grid, id, emptyText }) => <div id={id}><DataGrid grid={grid} emptyText={emptyText} /></div>;

// a text or number box bound to a string state
export function Box({ id, value, set, ed, type = 'text', ...rest }) {
  return <Form.Control id={id} type={type} step={type === 'number' ? rest.step || 'any' : undefined} value={value} disabled={!ed} onChange={(e) => set(e.target.value)} {...rest} />;
}
const useText = (v) => useState(str(v));
const catOptions = (d) => (d.lists.categories || []).map((c) => ({ value: c.id, label: c.category_name }));
const sig = (x, n = 6) => +Number(x).toPrecision(n);

// ---------------------------------------------------------------- Weighing
const WEIGH_MODES = [{ value: 'None', label: 'No target (the analyst decides)' }, { value: 'Single', label: 'One target ± tolerance' }, { value: 'By product category', label: 'A range per product category' }];
export function WeighingConfig({ cfg, d, ed, readRef }) {
  const [mode, setMode] = useState(cfg.target_mode || (cfg.target !== undefined && cfg.target !== null ? 'Single' : 'None'));
  const [unit, setUnit] = useState(cfg.unit || 'g');
  const [rep, setRep] = useText(cfg.replicates || 1);
  const [target, setTarget] = useText(cfg.target);
  const [tol, setTol] = useText(cfg.tolerance);
  const [pctTol, setPctTol] = useState((cfg.tolerance_unit || '') === '%'); // the tolerance in % of the target, else in the weighing unit
  const [qcnw, setQcnw] = useState(!!cfg.qc_not_weighed);
  const cols = useMemo(() => [
    { field: 'category_id', title: 'Product category', type: 'select', options: catOptions(d), width: 200 },
    { field: 'min', title: 'Lowest', type: 'number', width: 90 }, { field: 'max', title: 'Highest', type: 'number', width: 90 },
    { field: 'not_weighed', title: 'Not weighed', type: 'bool', width: 95, help: 'Samples of this category are not weighed (e.g. a sponge or stick swab)' }], [d.lists]); // eslint-disable-line react-hooks/exhaustive-deps
  const cg = useCfgGrid((cfg.by_category || []).map((x) => ({ ...x })), cols, ed);
  const t = numOf(target); const tl = numOf(tol);
  const accepted = t !== null && tl !== null ? `Accepted: ${sig(t - (pctTol ? t * tl / 100 : tl))} to ${sig(t + (pctTol ? t * tl / 100 : tl))} ${unit}` : '';
  readRef.current = () => {
    const c2 = { target_mode: mode, unit };
    const r = Math.round(numOf(rep) || 1); if (r > 1) c2.replicates = r; // replicate weighings (033)
    if (mode === 'Single') { c2.target = t; c2.tolerance = tl; c2.tolerance_unit = pctTol ? '%' : unit; }
    if (mode === 'By product category') c2.by_category = filled(cg).filter((x) => x.category_id).map((x) => (x.not_weighed ? { category_id: x.category_id, not_weighed: true } : { category_id: x.category_id, min: x.min, max: x.max }));
    if (qcnw) c2.qc_not_weighed = true; // 039
    return c2;
  };
  return <>
    <div className="grid4">
      <Field label="Target"><Pick id="c_mode" value={mode} blank={false} options={WEIGH_MODES} disabled={!ed} onChange={setMode} /></Field>
      <Field label="Unit"><Pick id="c_u" value={unit} blank={false} options={['g', 'mg', 'kg', 'mL']} disabled={!ed} onChange={setUnit} /></Field>
      <Field label="Replicate weighings" help="How many weights per sample (1 to 10), e.g. 10 capsules weighed one by one: their average is the step's weight">
        <Box id="c_rep" type="number" min="1" max="10" step="1" value={rep} set={setRep} ed={ed} /></Field>
    </div>
    {mode === 'Single' && <div className="grid4" id="c_single">
      <Field label="Target weight"><Box id="c_t" type="number" value={target} set={setTarget} ed={ed} /></Field>
      <Field label="Tolerance (±)"><Box id="c_tol" type="number" value={tol} set={setTol} ed={ed} /></Field>
      <Field label="Tolerance in" help="Percent of the target, or the weighing unit">
        <Pick id="c_tu" value={pctTol ? '%' : unit} blank={false} options={[unit, '%']} disabled={!ed} onChange={(v) => setPctTol(v === '%')} /></Field>
      <div className="help" id="c_tolx">{accepted}</div>
    </div>}
    {mode === 'By product category' && <div id="c_catwrap"><Field label="Weight range per product category" help={'The sample\'s matrix gives its product category (Admin > Matrices). Each sample is checked against its own category\'s range at the bench (outside is flagged). Tick "Not weighed" for a category that is not weighed (e.g. swabs): the step does not wait for its samples.'}>
      <CfgGrid id="c_cat" grid={cg} /></Field></div>}
    <Field label="Controls" help="e.g. a positive control made from a strain: the step does not wait for a weight from it">
      <label className="cb"><Form.Check.Input type="checkbox" id="c_qcnw" checked={qcnw} disabled={!ed} onChange={(e) => setQcnw(e.target.checked)} /> Prep QC (controls) are not weighed</label></Field>
    <div className="help">Weighs client samples and Prep QC; the actual weight and the balance used are always recorded per entry at the bench.</div>
  </>;
}

// ---------------------------------------------------------------- Preparation
export function PreparationConfig({ cfg, ed, readRef, stepKey }) {
  const [ref, setRef] = useText(cfg.procedure_ref);
  const cols = useMemo(() => [
    { field: 'label', title: 'Label', width: 260, required: true }, { field: 'type', title: 'Type', type: 'select', options: ['Number', 'Text', 'Time', 'Date'], width: 100 },
    { field: 'key', title: 'In formulas', type: 'readonly', width: 260, compute: (r) => (r.type === 'Number' && r.label ? `{${stepKey || 'key'}.${slug(r.label)}}` : '') }], [stepKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const fg = useCfgGrid((cfg.fields || []).map((f) => ({ ...f })), cols, ed, () => ({ type: 'Number' }));
  readRef.current = () => ({ procedure_ref: ref.trim() || null, fields: filled(fg).map((r) => ({ label: r.label, type: r.type || 'Text' })) });
  return <>
    <Field label="Procedure reference" help="Shown to the analyst, e.g. SOP-CHEM-0233 section 7"><Box id="c_ref" value={ref} set={setRef} ed={ed} /></Field>
    <Field label="Fields filled once per batch" help="e.g. Digest final volume (mL), Program. Number fields can be used in formulas as {key.field}."><CfgGrid id="c_f" grid={fg} /></Field>
  </>;
}

// ---------------------------------------------------------------- Plating/Inoculation
export function PlatingConfig({ cfg, ed, readRef }) {
  const [media, setMedia] = useText(cfg.expected_media);
  const [pp, setPp] = useText(cfg.plates_per_entry ?? 1);
  const [ref, setRef] = useText(cfg.procedure_ref);
  readRef.current = () => ({ expected_media: media.trim() || null, plates_per_entry: numOf(pp), procedure_ref: ref.trim() || null });
  return <div className="grid3">
    <Field label="Expected media" help="Guidance; the media lot is recorded per batch"><Box id="c_media" value={media} set={setMedia} ed={ed} /></Field>
    <Field label="Plates per entry" help="e.g. 2 for duplicate plating"><Box id="c_pp" type="number" min="1" step="1" value={pp} set={setPp} ed={ed} /></Field>
    <Field label="Procedure reference"><Box id="c_ref" value={ref} set={setRef} ed={ed} /></Field>
  </div>;
}

// ---------------------------------------------------------------- Incubation
export function IncubationConfig({ cfg, d, ed, readRef }) {
  const [temp, setTemp] = useText(cfg.temp_c); const [ttol, setTtol] = useText(cfg.temp_tolerance);
  const [du, setDu] = useState(cfg.duration_unit || 'hours');
  const [dur, setDur] = useText(cfg.duration); const [wmin, setWmin] = useText(cfg.window_min); const [wmax, setWmax] = useText(cfg.window_max);
  const cols = useMemo(() => [
    { field: 'category_id', title: 'Product category', type: 'select', options: catOptions(d), width: 200 },
    { field: 'window_min', title: 'Shortest', type: 'number', width: 90 }, { field: 'window_max', title: 'Longest', type: 'number', width: 90 }], [d.lists]); // eslint-disable-line react-hooks/exhaustive-deps
  const wg = useCfgGrid((cfg.by_category || []).map((x) => ({ ...x })), cols, ed);
  readRef.current = () => {
    const c2 = { temp_c: numOf(temp), temp_tolerance: numOf(ttol), duration: numOf(dur), duration_unit: du, window_min: numOf(wmin), window_max: numOf(wmax) };
    const cats = filled(wg).filter((r) => r.category_id).map((r) => ({ category_id: r.category_id, window_min: r.window_min, window_max: r.window_max }));
    if (cats.length) c2.by_category = cats; // 039
    return c2;
  };
  return <>
    <div className="grid3">
      <Field label="Temperature (°C)"><Box id="c_temp" type="number" value={temp} set={setTemp} ed={ed} /></Field>
      <Field label="± (°C)"><Box id="c_ttol" type="number" value={ttol} set={setTtol} ed={ed} /></Field>
      <Field label="Duration unit"><Pick id="c_du" value={du} blank={false} options={['hours', 'days']} disabled={!ed} onChange={setDu} /></Field>
    </div>
    <div className="grid3">
      <Field label="Target duration"><Box id="c_dur" type="number" value={dur} set={setDur} ed={ed} /></Field>
      <Field label="Shortest acceptable"><Box id="c_wmin" type="number" value={wmin} set={setWmin} ed={ed} /></Field>
      <Field label="Longest acceptable"><Box id="c_wmax" type="number" value={wmax} set={setWmax} ed={ed} /></Field>
    </div>
    <Field label="Window per product category (optional)" help="e.g. Dry pet food 22 to 26 hours while the others keep the window above. The sample's matrix gives its category. A load holding several categories is judged against the window they all share.">
      <CfgGrid id="c_cat" grid={wg} /></Field>
    <div className="help">Outside the window the load is flagged for review. Time in and out are recorded per load at the bench.</div>
  </>;
}

// ---------------------------------------------------------------- Dilution
export function DilutionConfig({ cfg, d, ed, readRef }) {
  const [mode, setMode] = useState(cfg.mode || 'Single');
  const [fpe, setFpe] = useText(cfg.fields_per_entry ?? 3); const [dil, setDil] = useText(cfg.expected_diluent);
  const [a, setA] = useText(cfg.aliquot); const [dl, setDl] = useText(cfg.diluent);
  const [ia, setIa] = useText(cfg.initial_amount); const [idl, setIdl] = useText(cfg.initial_diluent);
  const [ta, setTa] = useText(cfg.transfer_aliquot); const [td, setTd] = useText(cfg.transfer_diluent); const [depth, setDepth] = useText(cfg.depth);
  const cols = useMemo(() => [
    { field: 'category_id', title: 'Product category', type: 'select', options: catOptions(d), width: 200 },
    { field: 'aliquot', title: 'Aliquot', type: 'number', width: 90 }, { field: 'diluent', title: 'Diluent (mL)', type: 'number', width: 100 }], [d.lists]); // eslint-disable-line react-hooks/exhaustive-deps
  const dg = useCfgGrid((cfg.by_category || []).map((x) => ({ ...x })), cols, ed);
  const serial = mode === 'Serial';
  let fact = null;
  if (!serial && numOf(a)) fact = `Factor = (${numOf(a)} + ${numOf(dl) ?? 0}) / ${numOf(a)} = ${((numOf(a) + (numOf(dl) ?? 0)) / numOf(a)).toPrecision(4).replace(/\.?0+$/, '')}×`;
  if (serial && numOf(ia) && numOf(ta)) {
    const f0 = (numOf(ia) + (numOf(idl) ?? 0)) / numOf(ia); const ft = (numOf(ta) + (numOf(td) ?? 0)) / numOf(ta);
    const lv = []; let f = f0; for (let i = 0; i < Math.min(numOf(depth) || 1, 8); i++) { lv.push(Math.round(Math.log10(f) * 100) / 100); f *= ft; }
    fact = <>Levels: {lv.map((x, i) => <span key={i}>{i > 0 && ', '}10<sup>-{x}</sup></span>)}</>;
  }
  readRef.current = () => {
    if (serial) return { mode: 'Serial', initial_amount: numOf(ia), initial_diluent: numOf(idl), transfer_aliquot: numOf(ta), transfer_diluent: numOf(td), depth: numOf(depth), fields_per_entry: numOf(fpe), expected_diluent: dil.trim() || null };
    const cats = filled(dg).filter((r) => r.category_id).map((r) => ({ category_id: r.category_id, aliquot: r.aliquot, diluent: r.diluent }));
    return { mode: 'Single', aliquot: numOf(a), diluent: numOf(dl), fields_per_entry: numOf(fpe), expected_diluent: dil.trim() || null, ...(cats.length ? { by_category: cats } : {}) };
  };
  return <>
    <div className="grid4">
      <Field label="Mode"><Pick id="c_mode" value={mode} blank={false} options={['Single', 'Serial']} disabled={!ed} onChange={setMode} /></Field>
      <Field label="Dilution fields per entry" help="Room for re-dilutions at the bench"><Box id="c_fpe" type="number" min="1" step="1" value={fpe} set={setFpe} ed={ed} /></Field>
      <Field label="Expected diluent" help="Guidance; the lot is recorded at the bench"><Box id="c_dil" value={dil} set={setDil} ed={ed} /></Field>
    </div>
    {!serial && <div id="c_single">
      <div className="grid4">
        <Field label="Default aliquot (g or mL)"><Box id="c_a" type="number" value={a} set={setA} ed={ed} /></Field>
        <Field label="Default diluent added (mL)"><Box id="c_d" type="number" value={dl} set={setDl} ed={ed} /></Field>
      </div>
      <Field label="Amounts per product category (optional)" help="e.g. Dietary Supplement 10 + 90, Cosmetic 1 + 9, Food 25 + 225. The sample's matrix gives its category; others use the default.">
        <CfgGrid id="c_cat" grid={dg} /></Field>
    </div>}
    {serial && <div id="c_serial">
      <div className="grid4">
        <Field label="Initial sample (g or mL)"><Box id="c_ia" type="number" value={ia} set={setIa} ed={ed} /></Field>
        <Field label="Initial diluent (mL)"><Box id="c_id" type="number" value={idl} set={setIdl} ed={ed} /></Field>
        <Field label="Transfer aliquot (mL)"><Box id="c_ta" type="number" value={ta} set={setTa} ed={ed} /></Field>
        <Field label="Transfer diluent (mL)"><Box id="c_td" type="number" value={td} set={setTd} ed={ed} /></Field>
      </div>
      <div className="grid4"><Field label="Standard depth (levels)"><Box id="c_depth" type="number" min="1" step="1" value={depth} set={setDepth} ed={ed} /></Field></div>
    </div>}
    <div className="help" id="c_fact">{fact}</div>
  </>;
}

// ---------------------------------------------------------------- Split off Test and Hold Point
const FINDINGS = [{ value: 'Present', label: 'Something found (a value that means found)' }, { value: 'Count above', label: 'A count above' }];
export function SplitHoldConfig({ type, cfg, d, step, anc, ed, readRef }) {
  const hold = type === 'Hold Point';
  const entries = d.steps.filter((s) => s.step_type === 'Data Entry' && (!step || anc.has(s.id)));
  const [test, setTest] = useState(cfg.test_id || '');
  const [trig, setTrig] = useState(cfg.trigger || 'On finding');
  const [consent, setConsent] = useState(step ? cfg.consent_required !== false : cfg.consent_required === true);
  const [alert, setAlert] = useState(!!cfg.notify_client);
  const [finding, setFinding] = useState(cfg.finding || 'Present');
  const [ca, setCa] = useText(cfg.count_above);
  const [fs, setFs] = useState(cfg.finding_steps || []);
  readRef.current = () => (hold ? { test_id: test || null }
    : { test_id: test || null, trigger: trig, finding, count_above: numOf(ca), consent_required: consent, notify_client: alert, finding_steps: fs });
  return <>
    <div className="grid2">
      <Field label={hold ? 'Waits for the test' : 'Test to split off'} req
        help={hold ? 'A test on the same sample (ordered with it, or split off). Its result can be used here as {key.result}.' : 'Created on the same sample, then batched like any test.'}>
        <Pick id="c_test" value={test} disabled={!ed} onChange={setTest} options={d.lists.tests.map((x) => ({ value: x.id, label: `${x.test_code} ${x.test_name}` }))} /></Field>
      {!hold && <Field label="When"><Pick id="c_trig" value={trig} blank={false} options={['On finding', 'Manual only']} disabled={!ed} onChange={setTrig} /></Field>}
    </div>
    {!hold && <>
      <Field label="Customer consent" help="Ticked: the request waits until the customer's consent is recorded, then the test is ordered. Not ticked: the test is ordered at once from the client's accepted quote.">
        <label className="cb"><Form.Check.Input type="checkbox" id="c_consent" checked={consent} disabled={!ed} onChange={(e) => setConsent(e.target.checked)} /> Customer consent required</label></Field>
      <Field label="Alert the client" help={'Completing this step on a finding emails the client\'s "Positive alerts" contacts (else Receives Report, else the ordering contact). The Outbox keeps who was told and when.'}>
        <label className="cb"><Form.Check.Input type="checkbox" id="c_alert" checked={alert} disabled={!ed} onChange={(e) => setAlert(e.target.checked)} /> Email the client at once when something is found (presumptive result)</label></Field>
      {trig === 'On finding' && <div id="c_find">
        <div className="grid4">
          <Field label="Finding"><Pick id="c_fd" value={finding} blank={false} options={FINDINGS} disabled={!ed} onChange={setFinding} /></Field>
          <Field label="Count above"><Box id="c_ca" type="number" value={ca} set={setCa} ed={ed} /></Field>
        </div>
        <Field label="Found at"><div className="wdchecks">{entries.length ? entries.map((s) => (
          <label key={s.id}><Form.Check.Input type="checkbox" data-fs={s.step_key} checked={fs.includes(s.step_key)} disabled={!ed}
            onChange={(e) => setFs((l) => (e.target.checked ? [...l, s.step_key] : l.filter((x) => x !== s.step_key)))} /> {s.step_name}</label>))
          : <span className="help">No Data Entry step comes before this one yet.</span>}</div></Field>
      </div>}
    </>}
  </>;
}

// ---------------------------------------------------------------- Data Entry
export function DataEntryConfig({ cfg, d, ed, readRef }) {
  const [lbl, setLbl] = useText(cfg.value_label);
  const [unit, setUnit] = useState(cfg.value_unit || '');
  const [att, setAtt] = useState(cfg.require_attachment !== false);
  const [ids, setIds] = useState(cfg.analyte_ids || []);
  readRef.current = () => { const c = { value_label: lbl.trim() || null, value_unit: unit || null, require_attachment: att }; if (ids.length) c.analyte_ids = ids; return c; };
  return <>
    <div className="grid3">
      <Field label="Value entered" req help="e.g. Concentration in solution"><Box id="c_lbl" value={lbl} set={setLbl} ed={ed} /></Field>
      <Field label="Unit of the value"><Pick id="c_u" value={unit} options={d.lists.units} disabled={!ed} onChange={setUnit} /></Field>
      <Field label="Raw data" help="Untick for a manual observation (e.g. reading plates); then no instrument is needed.">
        <label className="cb"><Form.Check.Input type="checkbox" id="c_att" checked={att} disabled={!ed} onChange={(e) => setAtt(e.target.checked)} /> Instrument export must be attached</label></Field>
    </div>
    <Field label="Analytes entered here" help="None ticked = all of the test's analytes.">
      <div className="wdchecks">{d.analytes.length ? d.analytes.map((a) => (
        <label key={a.analyte_id}><Form.Check.Input type="checkbox" data-an={a.analyte_id} checked={ids.includes(a.analyte_id)} disabled={!ed}
          onChange={(e) => setIds((l) => (e.target.checked ? [...l, a.analyte_id] : l.filter((x) => x !== a.analyte_id)))} /> {a.analyte_name}</label>))
        : <span className="help">Add the analytes on tab 2 first.</span>}</div></Field>
  </>;
}

// ---------------------------------------------------------------- QC Review
export function QcReviewConfig({ cfg, ed, readRef }) {
  const [scope, setScope] = useState(cfg.scope || 'Batch');
  readRef.current = () => ({ scope });
  return <>
    <div className="grid3"><Field label="Reviews" help="Timepoint: a review on its own branch (e.g. day 7 of a study) that never holds up the rest">
      <Pick id="c_scope" value={scope} blank={false} options={['Batch', 'Timepoint']} disabled={!ed} onChange={setScope} /></Field></div>
    <div className="help">The reviewer must not have done the reviewed steps; every step is opened and approved, every flag dispositioned, and the batch approved with one signature. These are fixed GMP rules, not settings.</div>
  </>;
}
