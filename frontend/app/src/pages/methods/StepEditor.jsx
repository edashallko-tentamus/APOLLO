// The step editor: the common fields (type, name, key, department, connections, equipment types, witness, instructions),
// then the settings of its type. Adding is signed "Created by"; a change or a removal "Changed by" with a reason.
import { useRef, useState } from 'react';
import { removeStep, saveStep } from '../../api/methods.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import BatchingConfig from './BatchingConfig.jsx';
import CalculationConfig from './CalculationConfig.jsx';
import { DataEntryConfig, DilutionConfig, IncubationConfig, PlatingConfig, PreparationConfig, QcReviewConfig, SplitHoldConfig, WeighingConfig } from './ConfigEditors.jsx';
import { Field, Pick, stepKey, STEP_TYPES, TYPE_HELP, useSigned } from './shared.jsx';
import { Button, Form } from 'react-bootstrap';

const EDITORS = { Batching: BatchingConfig, Weighing: WeighingConfig, Preparation: PreparationConfig, 'Plating/Inoculation': PlatingConfig, Incubation: IncubationConfig,
  Dilution: DilutionConfig, 'Split off Test': SplitHoldConfig, 'Hold Point': SplitHoldConfig, Calculation: CalculationConfig, 'Data Entry': DataEntryConfig, 'QC Review': QcReviewConfig };
const NoSettings = ({ readRef }) => { readRef.current = () => ({}); return <div className="help">No settings for this type.</div>; };
const WITNESS = [{ value: 'None', label: 'None' }, { value: 'Optional', label: 'Optional (the analyst may ask for one)' }, { value: 'Required', label: 'Required' }];

export function ancestorsOf(d, id) {
  const out = new Set(); const stack = [id];
  while (stack.length) { const c = stack.pop(); d.deps.filter((x) => x.step_id === c).forEach((x) => { if (!out.has(x.depends_on_step_id)) { out.add(x.depends_on_step_id); stack.push(x.depends_on_step_id); } }); }
  return out;
}

export default function StepEditor({ d, step, afterId = null, onClose, onSaved, onRemoved }) {
  const ed = d.editable; const L = d.lists; const dis = !ed;
  const toast = useToast(); const dialogs = useDialogs(); const signed = useSigned();
  const s = step || { step_type: 'Preparation', config: {}, step_name: '', step_key: '' };
  const others = d.steps.filter((x) => !step || x.id !== step.id);
  const anc = step ? ancestorsOf(d, step.id) : new Set();
  const testDept = L.departments.find((x) => x.id === d.test.department_id);
  const [type, setType] = useState(s.step_type);
  const [name, setName] = useState(s.step_name);
  const [key, setKey] = useState(s.step_key);
  const [keyTouched, setKeyTouched] = useState(!!step);
  const [dept, setDept] = useState(s.department_id || '');
  const [deps, setDeps] = useState(() => { // step id → 'Sequential' | 'Parallel'
    const my = step ? d.deps.filter((x) => x.step_id === step.id) : (afterId ? [{ depends_on_step_id: afterId, dependency_type: 'Sequential' }] : []);
    return Object.fromEntries(my.map((x) => [x.depends_on_step_id, x.dependency_type]));
  });
  const [par, setPar] = useState(() => Object.fromEntries(Object.entries(deps).map(([k, v]) => [k, v === 'Parallel'])));
  const [eq, setEq] = useState(() => (step ? d.equipment.filter((e) => e.step_id === step.id).map((e) => e.equipment_type_id) : []));
  const [mainEq, setMainEq] = useState(() => (step ? d.equipment.find((e) => e.step_id === step.id && e.is_main)?.equipment_type_id : null) || null);
  const [witness, setWitness] = useState(s.config?.witness || 'None');
  const [instr, setInstr] = useState(s.instructions || '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const readRef = useRef(() => ({}));
  const Editor = EDITORS[type] || NoSettings;
  // the saved settings belong to the step's own type; another type starts empty
  const cfg = type === s.step_type ? JSON.parse(JSON.stringify(s.config || {})) : {};

  async function remove() {
    if (!(await dialogs.confirm('Remove step', `Remove "${s.step_name}" from this draft? Its connections go too; steps after it will need reconnecting.`, 'Remove'))) return;
    const ok = await signed(`Remove step "${s.step_name}" from ${d.test.test_code}, version ${d.version.version_no}`, 'Changed by',
      (reason, signature) => removeStep(d.version.id, step.id, reason, signature));
    if (ok) { toast('Step removed (signed).'); onRemoved(); }
  }
  async function save() {
    let config;
    try { config = readRef.current(); } catch (e) { setErr(e.message); return; }
    if (witness && witness !== 'None') config.witness = witness; else delete config.witness; // WD-2: a witness per step
    const depList = Object.keys(deps).filter((id) => deps[id] && others.some((o) => o.id === id))
      .map((id) => ({ depends_on_step_id: id, dependency_type: par[id] ? 'Parallel' : 'Sequential' }));
    const equipment = eq.map((id, i) => ({ equipment_type_id: id, is_main: mainEq ? id === mainEq : i === 0 && eq.length === 1 }));
    const body = { step: { id: step?.id, step_type: type, step_name: name.trim(), step_key: key.trim(), department_id: dept || null, instructions: instr.trim() || null, config }, deps: depList, equipment };
    if (!body.step.step_name) { setErr('Name the step.'); return; }
    setErr(''); setBusy(true);
    try {
      const x = await signed(`${step ? 'Change step' : 'Add step'} "${body.step.step_name}": ${d.test.test_code}, version ${d.version.version_no}`, step ? 'Changed by' : 'Created by',
        (reason, signature) => saveStep(d.version.id, { ...body, reason, signature }));
      if (!x) return;
      toast(step ? 'Step saved and signed.' : 'Step added and signed.');
      onSaved(x.id);
    } finally { setBusy(false); }
  }

  return (
    <Section className="wdform" title={step ? `Step: ${s.step_name}` : 'New step'} help={TYPE_HELP[s.step_type] || ''}>
      <div id="se">
        <div className="grid4">
          <Field label="Type" req><Pick id="s_type" value={type} blank={false} options={STEP_TYPES} disabled={dis} onChange={setType} /></Field>
          <Field label="Name" req help="e.g. Microwave digestion">
            <Form.Control id="s_name" type="text" value={name} disabled={dis} onChange={(e) => { setName(e.target.value); if (!keyTouched) setKey(stepKey(e.target.value)); }} /></Field>
          <Field label="Key" req help="Short lower-case word used in formulas">
            <Form.Control id="s_key" type="text" className="wdmono" maxLength={30} value={key} disabled={dis} onChange={(e) => { setKeyTouched(true); setKey(e.target.value); }} /></Field>
          <Field label="Done by"><Pick id="s_dept" value={dept} blank={false} disabled={dis} onChange={setDept}
            options={[{ value: '', label: `The test's department${testDept ? ' (' + testDept.department_code + ')' : ''}` }, ...L.departments.map((x) => ({ value: x.id, label: `${x.department_code} ${x.department_name}` }))]} /></Field>
        </div>
        <div className="grid2">
          <Field label="Comes after" help="Tick the step(s) this one follows. Tick parallel for a branch that never holds up the rest (e.g. a timepoint's QC Review).">
            <div className="wdchecks" id="s_deps">{others.length ? others.map((o) => (
              <span key={o.id} className="wddep">
                <label><Form.Check.Input type="checkbox" data-dep={o.id} checked={!!deps[o.id]} disabled={dis} onChange={(e) => setDeps((m) => ({ ...m, [o.id]: e.target.checked ? 'Sequential' : undefined }))} /> {o.step_name}</label>
                <label className="wdpar" title="A parallel branch never holds up the rest"><Form.Check.Input type="checkbox" data-par={o.id} checked={!!par[o.id]} disabled={dis} onChange={(e) => setPar((m) => ({ ...m, [o.id]: e.target.checked }))} /> parallel</label>
              </span>)) : <span className="help">This is the first step.</span>}</div>
          </Field>
          <Field label="Equipment types" help="Weighing, Incubation and Data Entry (with an attached export) need one; mark the main instrument, the others are alternatives. The actual unit is chosen at the bench and must be in calibration.">
            <div className="wdchecks" id="s_eq">{L.types.map((tp) => (
              <label key={tp.id}><Form.Check.Input type="checkbox" data-eq={tp.id} checked={eq.includes(tp.id)} disabled={dis}
                onChange={(e) => setEq((l) => (e.target.checked ? [...l, tp.id] : l.filter((x) => x !== tp.id)))} /> {tp.type_name}{' '}
                <Form.Check.Input type="radio" name="s_main" data-main={tp.id} checked={mainEq === tp.id} disabled={dis} title="Main instrument" onChange={() => setMainEq(tp.id)} /> <small>main</small></label>))}</div>
          </Field>
        </div>
        <div className="grid4">
          <Field label="Witness" help="A witness signs with the analyst when the step is completed: another person who does bench work in this lab">
            <Pick id="s_wit" value={witness} blank={false} options={WITNESS} disabled={dis} onChange={setWitness} /></Field>
        </div>
        <Field label="Instructions for the analyst"><Form.Control as="textarea" id="s_instr" rows={2} value={instr} disabled={dis} onChange={(e) => setInstr(e.target.value)} /></Field>
        <h3>{type} settings</h3>
        <div id="s_cfg"><Editor key={type} type={type} cfg={cfg} d={d} step={step} anc={anc} ed={ed} readRef={readRef} stepKey={key} /></div>
        <div className="merr" id="s_err">{err}</div>
        {ed && <div className="wdbar">
          <Button type="button" variant="light" id="s_cancel" onClick={onClose}>Close</Button>
          {step && <Button type="button" variant="outline-secondary" id="s_remove" onClick={remove}>Remove step</Button>}
          <span className="sp" />
          <Button type="button" variant="primary" id="s_save" disabled={busy} onClick={save}>{step ? 'Save step' : 'Add step'}</Button>
        </div>}
      </div>
    </Section>
  );
}
