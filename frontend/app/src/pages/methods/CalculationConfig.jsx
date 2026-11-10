// Calculation step settings: the formula (values from earlier steps picked by name, operators and functions as buttons,
// or typed; checked by the database), its unit, analyte exceptions, and "Try it" with the same engine as the results.
import { useMemo, useRef, useState } from 'react';
import { formulaTest } from '../../api/methods.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import { CfgGrid, filled, useCfgGrid } from './ConfigEditors.jsx';
import { Field, Pick } from './shared.jsx';

const WORDS = { weight: 'Sample weight', factor: 'Dilution factor', final_volume: 'Final volume', duration: 'Incubation time', reading: 'Reading', result: 'Result' };
const OPS = [['+', ' + '], ['−', ' - '], ['×', ' * '], ['÷', ' / '], ['^', '^'], ['(', '('], [')', ')'], ['log10', 'log10('], ['ln', 'ln('], ['exp', 'exp('], ['sqrt', 'sqrt('], ['abs', 'abs('], ['min', 'min('], ['max', 'max('], ['power', 'power(']];

export default function CalculationConfig({ cfg, d, step, anc, ed, readRef }) {
  const dialogs = useDialogs();
  const [formula, setFormula] = useState(cfg.formula || '');
  const [unit, setUnit] = useState(cfg.result_unit || '');
  const [note, setNote] = useState(cfg.note || '');
  const [tries, setTries] = useState({}); // token → typed example value
  const [out, setOut] = useState(null);
  const box = useRef(null);
  const cols = useMemo(() => [
    { field: 'analyte_id', title: 'Analyte', type: 'select', options: d.analytes.map((a) => ({ value: a.analyte_id, label: a.analyte_name })), width: 220 },
    { field: 'formula', title: 'Formula', width: 520 }], [d.analytes]);
  const ovG = useCfgGrid((cfg.overrides || []).map((o) => ({ ...o })), cols, ed);

  const tokens = [];
  d.steps.filter((s) => anc.has(s.id)).forEach((s) => (s.tokens || []).forEach((f) => tokens.push({ tok: `{${s.step_key}.${f}}`,
    label: `${s.step_type === 'Hold Point' ? `Result of ${d.lists.tests.find((x) => x.id === s.config?.test_id)?.test_name || 'the waited-for test'}` : WORDS[f] || f.replace(/_/g, ' ')} · ${s.step_name}` })));
  const used = [...new Set(formula.match(/\{[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\}/g) || [])].map((t) => t.slice(1, -1));

  // insert at the cursor of the formula box
  function insert(text) {
    const i = box.current; const p = i.selectionStart ?? formula.length; const e = i.selectionEnd ?? p;
    setFormula(formula.slice(0, p) + text + formula.slice(e));
    setTimeout(() => { i.focus(); i.selectionStart = i.selectionEnd = p + text.length; }, 0);
  }
  async function constant() {
    const v = await dialogs.form({ title: 'Insert a constant', okText: 'Insert', intro: 'A fixed number in the formula, e.g. 1000 to convert units. It is part of the approved formula.',
      fields: [{ name: 'value', label: 'Number', type: 'number', required: true }] });
    if (v && v.value !== '' && !Number.isNaN(Number(v.value))) insert(String(Number(v.value)));
  }
  async function calculate() {
    const values = Object.fromEntries(used.filter((t) => (tries[t] ?? '') !== '').map((t) => [t, Number(tries[t])]));
    try { const r = await formulaTest(formula, values); setOut(r.problem ? <span className="bad">{r.problem}</span> : <>= <b>{String(r.value)}</b> {unit}</>); }
    catch (x) { setOut(x.message); }
  }
  readRef.current = () => {
    const c = { formula: formula.trim() || null, result_unit: unit || null, note: note.trim() || null };
    const ov = filled(ovG).filter((o) => o.analyte_id); if (ov.length) c.overrides = ov.map((o) => ({ analyte_id: o.analyte_id, formula: o.formula }));
    return c;
  };

  return <>
    <Field label="Formula (every analyte)" req help="Numbers, + − × / ^ ( ), the functions log10 ln exp sqrt abs min max power, and values from steps before this one.">
      <input id="c_f" ref={box} type="text" className="wdmono" value={formula} disabled={!ed} onChange={(e) => setFormula(e.target.value)} /></Field>
    <div className="wdtokens"><span className="help">Values:</span> {tokens.length ? tokens.map((x) => (
      <button key={x.tok} type="button" className="mini wdtok" data-tok={x.tok} title={x.tok} disabled={!ed} onClick={() => insert(x.tok)}>{x.label}</button>))
      : <span className="help">{step ? 'No step before this one offers values yet (connect it after a Weighing, Dilution, Data Entry... step).' : 'Save the step after the steps it uses to see their values here.'}</span>}</div>
    <div className="wdtokens"><span className="help">Insert:</span> {OPS.map(([l, t]) => <button key={l} type="button" className="mini" data-tok={t} disabled={!ed} onClick={() => insert(t)}>{l}</button>)}
      {' '}<button type="button" className="mini" id="c_const" disabled={!ed} onClick={constant}>Constant…</button></div>
    <div className="grid3">
      <Field label="Result unit"><Pick id="c_u" value={unit} options={d.lists.units} disabled={!ed} onChange={setUnit} /></Field>
      <Field label="Note" help="e.g. what the formula does, in words"><input id="c_note" type="text" value={note} disabled={!ed} onChange={(e) => setNote(e.target.value)} /></Field>
    </div>
    <Field label="Analyte exceptions" help="A different formula for some analytes; the rest use the formula above."><CfgGrid id="c_ov" grid={ovG} /></Field>
    <div className="wdtry"><b>Try it</b> <span className="help">Enter example values and calculate with the same engine the results will use.</span>
      <div className="grid4" id="c_try">{used.map((t) => (
        <Field key={t} label={`{${t}}`}><input data-t={t} type="number" step="any" value={tries[t] ?? ''} onChange={(e) => setTries((m) => ({ ...m, [t]: e.target.value }))} /></Field>))}</div>
      <button type="button" className="btn" id="c_go" onClick={calculate}>Calculate</button> <span id="c_out">{out}</span>
    </div>
  </>;
}
