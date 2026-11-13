// One person's training (#/training/people/:id): departments, qualifications (QA may withdraw), competency, the work
// done, the training report, and starting a competency attempt.
import { useMemo, useRef, useState } from 'react';
import { addEvidence, getPerson, reportUrl, startAttempt, withdrawQualification } from '../../api/training.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import DataGrid from '../../components/grid/DataGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import Modal from '../../components/Modal.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import SmartSelect from '../../components/SmartSelect.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import { ATTEMPT_COLS, d8, documentsOf, stateCls } from './shared.js';
import { Button, Card } from 'react-bootstrap';

const DEPT_COLS = [
  { field: 'department_name', title: 'Department', type: 'readonly', width: 200 },
  { field: 'current_tests', title: 'Current qualifications', type: 'readonly', width: 150, format: (v, r) => `${v}${r.needed ? ' of ' + r.needed : ''}` },
  { field: 'trained', title: 'Department trained', type: 'readonly', width: 330, format: (v, r) => (v ? `Yes${r.unlock_any_test ? ': any test of the department' : ''}${r.unlock_can_train ? (r.unlock_any_test ? '; ' : ': ') + 'may train others' : ''}` : 'No') },
];
const qualCols = (withdraw) => [
  { field: 'qualification_code', title: 'Qualification', type: 'readonly', width: 100 },
  { field: 'test_name', title: 'Test', type: 'readonly', width: 220 },
  { field: 'department_name', title: 'Department', type: 'readonly', width: 130 },
  { field: 'source', title: 'How', type: 'link', width: 170, format: (v, r) => `${v}${r.attempt_code ? ' ' + r.attempt_code : ''}`, href: (r) => (r.attempt_id ? '#/training/attempts/' + r.attempt_id : null) },
  { field: 'granted_at', title: 'Granted', type: 'readonly', width: 105, format: d8 },
  { field: 'last_competency_at', title: 'Last competency', type: 'readonly', width: 120, format: d8 },
  { field: 'due_on', title: 'Next due', type: 'readonly', width: 105, format: d8 },
  { field: 'runs_12m', title: 'Runs (12 mo / all)', type: 'readonly', width: 120, format: (v, r) => `${v} / ${r.runs_total}` },
  { field: 'state', title: 'State', type: 'readonly', width: 230, format: (v, r) => `${v}${r.why ? ': ' + r.why : ''}${r.conditions ? ' (conditional: ' + r.conditions + ')' : ''}`, cellClass: (r) => stateCls(r.state) },
  ...(withdraw ? [{ field: '_wd', title: '', type: 'button', width: 90, label: (r) => (r.status === 'Active' ? 'Withdraw…' : ''), onClick: withdraw }] : []),
];
const WORK_COLS = [
  { field: 'test_name', title: 'Test', type: 'readonly', width: 240 }, { field: 'department_name', title: 'Department', type: 'readonly', width: 140 },
  { field: 'runs_12m', title: 'Runs, last 12 months', type: 'readonly', width: 140 }, { field: 'runs_total', title: 'Runs, all', type: 'readonly', width: 90 },
  { field: 'last_at', title: 'Last run', type: 'readonly', width: 110, format: d8 },
];
const KV_COLS = [
  { field: 'analyte', title: 'Analyte', type: 'readonly', width: 220 }, { field: 'unit', title: 'Unit', type: 'readonly', width: 80 },
  { field: 'value', title: 'Known value', type: 'number', width: 110 }, { field: 'tolerance_pct', title: '± %', type: 'number', min: 0, width: 80 }];
const ROUTES = [{ value: 'Record', label: 'Training record (done outside the LIMS, with evidence)' }, { value: 'Training samples', label: 'Training samples (run through the workflow, compared with known values)' }];
const KINDS = [{ value: 'Initial', label: 'Initial' }, { value: 'Continuing', label: 'Continuing' }];

// the known values of a test's analytes (an editable grid inside the dialog: paste and fill down work)
function KnownValues({ test, gridRef }) {
  const rows = useMemo(() => (test.analytes || []).map((a) => ({ id: a.analyte_id, analyte_id: a.analyte_id, analyte: a.analyte, unit: a.unit || '', value: null, tolerance_pct: 10 })), [test]);
  const grid = useGrid({ rows, columns: KV_COLS });
  gridRef.current = grid;
  return <DataGrid grid={grid} />;
}

// Start a competency attempt: initial or continuing; a record (with evidence) or training samples (with known values)
function StartDialog({ d, onDone }) {
  const qualified = useMemo(() => new Set(d.qualifications.filter((q) => q.status === 'Active').map((q) => q.test_id)), [d]);
  const [testId, setTestId] = useState('');
  const [kind, setKind] = useState('Initial');
  const [route, setRoute] = useState('Record');
  const [desc, setDesc] = useState(''); const [date, setDate] = useState(''); const [files, setFiles] = useState([]);
  const [n, setN] = useState('3');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const kvGrid = useRef(null);
  const t = d.tests.find((x) => x.id === testId);
  const pickTest = (id) => { setTestId(id); setKind(qualified.has(id) ? 'Continuing' : 'Initial'); };
  const testOptions = [{ value: '', label: '' }, ...d.tests.map((x) => ({ value: x.id, label: `${x.test_name}${x.department_name ? ' (' + x.department_name + ')' : ''}${qualified.has(x.id) ? ': qualified' : ''}` }))];
  const smp = route === 'Training samples';

  async function ok() {
    if (!testId) return setError('Choose the test.');
    const body = { user_id: d.person.id, test_id: testId, kind, route };
    if (!smp) { body.description = desc.trim(); body.trained_on = date; if (!body.description || !body.trained_on) return setError('Say what was done and when.'); }
    else {
      const g = kvGrid.current;
      if (!t?.version_id || !g) return setError('Choose a test with an approved version.');
      body.samples = Number(n) || 1;
      body.known_values = g.state.rows.filter((r) => r.value !== null && r.value !== '' && r.value !== undefined).map((r) => ({ analyte_id: r.analyte_id, value: r.value, tolerance_pct: r.tolerance_pct }));
      if (!body.known_values.length) return setError('Give the known value of at least one analyte.');
    }
    setBusy(true); setError('');
    try {
      const r = await startAttempt(body);
      if (!smp && files.length) await addEvidence(r.id, await documentsOf(files));
      onDone(r.id);
    } catch (e) { setBusy(false); setError(e.message); }
  }
  return (
    <Modal title={`Start competency for ${d.person.full_name}`} okText="Start" wide busy={busy} error={error} onOk={ok} onClose={() => onDone(null)}
      intro="A trainer starts it; the trainer evaluates it; QA approves it. Initial competency grants a qualification; continuing competency keeps one up.">
      <div className="field"><label htmlFor="f_test">Test <span className="req">*</span></label><SmartSelect id="f_test" value={testId} options={testOptions} onChange={pickTest} /></div>
      <div className="field"><label htmlFor="f_kind">Kind</label><SmartSelect id="f_kind" value={kind} options={KINDS} onChange={setKind} />
        <div className="help">{t ? (qualified.has(t.id) ? 'Qualified already: this keeps the qualification up.' : 'Not qualified yet: this is the initial competency.') : ''}</div></div>
      <div className="field"><label htmlFor="f_route">How</label><SmartSelect id="f_route" value={route} options={ROUTES} onChange={setRoute} /></div>
      {!smp ? <>
        <div className="field"><label htmlFor="f_desc">What was done <span className="req">*</span></label><textarea id="f_desc" rows={3} placeholder="SOP read, runs observed, supervised runs, results reviewed" value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
        <div className="field"><label htmlFor="f_date">Date of the training <span className="req">*</span></label><input id="f_date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label htmlFor="f_ev">Evidence (signed form, certificate)</label><input id="f_ev" type="file" multiple onChange={(e) => setFiles([...e.target.files])} /></div>
      </> : <>
        <div className="field"><label htmlFor="f_n">Training samples</label><input id="f_n" type="number" min="1" max="10" value={n} onChange={(e) => setN(e.target.value)} /></div>
        <div className="help">Known values: the result each training sample should give, and how far from it is acceptable (±%). They become the samples&apos; specification, so QC Review says whether each result is within it.</div>
        {t && (t.version_id ? <KnownValues key={t.id} test={t} gridRef={kvGrid} /> : <p className="bad">This test has no approved version: training samples need one.</p>)}
      </>}
    </Modal>
  );
}

export default function PersonPage({ params: [id] }) {
  const { site } = useSession();
  const dialogs = useDialogs();
  const toast = useToast();
  const { data: d, error, reload } = useApi((o) => getPerson(id, o), [id]);
  const qcols = useMemo(() => {
    if (!d?.can.approve) return qualCols(null);
    return qualCols(async (q) => {
      const v = await dialogs.sign({ title: 'Withdraw the qualification', what: `${q.qualification_code}: ${q.full_name}, ${q.test_name}`, meaning: 'Withdrawn by', needReason: true,
        submit: ({ reason, signature }) => withdrawQualification(q.id, { reason, signature }) });
      if (v) { toast('Qualification withdrawn.'); reload(); }
    });
  }, [d, dialogs, toast, reload]);
  if (error && !d) return <><PageHeader title="Training" /><Card body className="err">{error.message}</Card></>;
  if (!d) return <><PageHeader title="Training" /><div className="loading">Loading…</div></>;
  const p = d.person;

  async function start() {
    const newId = await dialogs.open((done) => <StartDialog d={d} onDone={done} />);
    if (newId) { toast('Competency started.'); window.location.hash = '#/training/attempts/' + newId; }
  }
  const actions = <>
    <Button variant="outline-secondary" href={reportUrl(p.id, site?.id)} target="_blank" rel="noopener noreferrer" id="report">Training report (PDF)</Button>
    {(d.can.record || d.tests.length > 0) && <> <Button type="button" variant="primary" id="start" onClick={start}>Start competency…</Button></>}
  </>;
  return <>
    <PageHeader title={`Training: ${p.full_name}`} subtitle={`${p.title || ''} Qualifications, competency (initial and continuing), departments and the work done. The training report prints all of it.`}
      actions={actions} audit={{ kind: 'training_person', id }} />
    <Section title="Departments" help="Department trained: enough tests of the department with a current qualification (the department's rule says how many and what it allows)."><ReadGrid rows={d.departments} columns={DEPT_COLS} /></Section>
    <Section title="Qualifications" help="A qualification lets the person sign the test's bench steps where the lab requires training. Lapsed: continuing competency overdue (or too few runs, where the rule asks for them).">
      <ReadGrid rows={d.qualifications} columns={qcols} emptyText="No qualifications yet." rowClass={(r) => (r.status !== 'Active' ? 'mutedrow' : '')} /></Section>
    <Section title="Competency" help="Initial competency grants a qualification; continuing competency keeps it up."><ReadGrid rows={d.attempts} columns={ATTEMPT_COLS} emptyText="No competency recorded yet." /></Section>
    <Section title="Work done" help="The rolling counter: batches in which the person signed a bench step of each test (QC Review not counted)."><ReadGrid rows={d.activity} columns={WORK_COLS} emptyText="No bench work recorded." /></Section>
  </>;
}
