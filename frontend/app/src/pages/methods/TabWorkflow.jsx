// Designer tab 3: Workflow: the diagram, the step editor under it and the steps as a list.
import { useMemo, useRef, useState } from 'react';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import Section from '../../components/Section.jsx';
import { replaceHash } from '../../router/useHashRoute.js';
import { STEP_TYPES, TYPE_COLOR } from './shared.jsx';
import StepEditor from './StepEditor.jsx';
import WorkflowDiagram from './WorkflowDiagram.jsx';
import { Button } from 'react-bootstrap';

const STEP_COLUMNS = [
  { field: 'step_name', title: 'Step', type: 'readonly', width: 200 }, { field: 'step_type', title: 'Type', type: 'readonly', width: 140 },
  { field: 'step_key', title: 'Key', type: 'readonly', width: 90 }, { field: 'after', title: 'Comes after', type: 'readonly', width: 230 },
  { field: 'dept', title: 'Dept.', type: 'readonly', width: 70 }, { field: 'equipment', title: 'Equipment types', type: 'readonly', width: 200 },
  { field: 'tokens_text', title: 'Offers to formulas', type: 'readonly', width: 240 },
];

export default function TabWorkflow({ d, reload, query }) {
  const ed = d.editable;
  // the editor: an existing step ({ id }) or a new one ({ after }), or closed (null)
  const [open, setOpen] = useState(() => (query.get('step') ? { id: query.get('step') } : null));
  const [newNo, setNewNo] = useState(0); // a fresh editor for each "+ Add step"
  const editorRef = useRef(null);
  const badKeys = useMemo(() => new Set(d.problems.filter((p) => p.severity === 'Error' && p.step_key).map((p) => p.step_key)), [d.problems]);
  const rows = useMemo(() => {
    const name = (id) => d.steps.find((s) => s.id === id)?.step_name || '';
    return d.steps.map((s) => ({ ...s, after: d.deps.filter((x) => x.step_id === s.id).map((x) => name(x.depends_on_step_id) + (x.dependency_type === 'Parallel' ? ' (parallel)' : '')).join(', '),
      equipment: d.equipment.filter((e) => e.step_id === s.id).map((e) => e.type_name + (e.is_main ? ' (main)' : '')).join(', '),
      dept: s.department_code || '(test\'s)', tokens_text: (s.tokens || []).map((x) => `{${s.step_key}.${x}}`).join(' ') }));
  }, [d.steps, d.deps, d.equipment]);
  const selId = open?.id || null;
  const step = selId ? d.steps.find((s) => s.id === selId) : null;
  const scroll = () => setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth' }), 0);
  const openStep = (id) => setOpen({ id });
  const addStep = () => { setNewNo((n) => n + 1); setOpen({ after: selId }); scroll(); };
  const saved = (id) => { replaceHash(`#/methods/versions/${d.version.id}?tab=workflow&step=${id}`); setOpen({ id }); reload(); };

  return <>
    <Section title="Workflow" help="Steps run top to bottom; a step starts when the steps before it are done. Branches run in parallel (dashed green: a branch that never holds up the rest, e.g. a timepoint's QC Review). Every branch ends in a QC Review. Click a step to see or change it."
      actions={ed && <Button type="button" variant="primary" id="add" onClick={addStep}>+ Add step</Button>}>
      <div className="wddiag" id="diag">
        {d.steps.length ? <WorkflowDiagram steps={d.steps} deps={d.deps} selId={selId} badKeys={badKeys} onOpen={openStep} />
          : <div className="help" style={{ padding: 20 }}>No steps yet.{ed && ' Add the first one (usually Batching).'}</div>}
      </div>
      <div className="wdlegend">{STEP_TYPES.map((x) => <span key={x}><i style={{ background: TYPE_COLOR[x] }} />{x}</span>)}<span><i style={{ borderColor: 'var(--err-ink)' }} />Has a problem to fix</span></div>
    </Section>
    <div id="editor" ref={editorRef}>
      {step && <StepEditor key={step.id} d={d} step={step} onClose={() => setOpen(null)} onSaved={saved} onRemoved={() => { setOpen(null); reload(); }} />}
      {open && !open.id && <StepEditor key={'new' + newNo} d={d} step={null} afterId={open.after} onClose={() => setOpen(null)} onSaved={saved} />}
    </div>
    <Section title="Steps" help="The same steps as a list (copy to Excel with Ctrl+C).">
      <ReadGrid rows={rows} columns={STEP_COLUMNS} onRowOpen={(r) => { openStep(r.id); scroll(); }} />
    </Section>
  </>;
}
