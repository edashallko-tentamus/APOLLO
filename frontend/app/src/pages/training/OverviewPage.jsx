// Training and competency (0.31.0, migration 053): the lab's people and their qualifications, competency attempts,
// the rules per department, legacy qualifications. People who may neither view nor record see their own page.
import { useEffect, useMemo } from 'react';
import { getOverview, grantLegacy, saveRules } from '../../api/training.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import EditableGrid from '../../components/EditableGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import { ATTEMPT_COLS_PERSON, d8 } from './shared.js';

const AUDIT = { kind: 'training' };
const PEOPLE_COLS = [
  { field: 'full_name', title: 'Person', type: 'link', width: 220, href: (r) => '#/training/people/' + r.id },
  { field: 'current', title: 'Qualified tests', type: 'readonly', width: 110 },
  { field: 'due_soon', title: 'Competency due soon', type: 'readonly', width: 140, cellClass: (r) => (r.due_soon ? 'cwarn' : '') },
  { field: 'lapsed', title: 'Lapsed', type: 'readonly', width: 80, cellClass: (r) => (r.lapsed ? 'cbad' : '') },
  { field: 'open_attempts', title: 'Open competency', type: 'readonly', width: 120 },
  { field: 'departments_trained', title: 'Department trained', type: 'readonly', width: 220 },
  { field: 'last_competency', title: 'Last competency', type: 'readonly', width: 130, format: d8 },
];
const RULES_HELP = 'Each department sets its own rule. Department trained: after this many different tests of the department with a current qualification; what it allows. Continuing competency: a competency sample every N months (Due soon N days before); optionally at least N runs in M months, or the qualification lapses. "Tests with no department" covers tests not assigned to a department, and is where a new department\'s rule starts from.';
// each department sets its own rule (Alex, 2026-10-20; migration 055); a new department starts from the lab's
const ruleCols = (deptOpts) => [
  { field: 'dept', title: 'Department', type: 'select', width: 200, options: [{ value: '', label: 'Tests with no department' }, ...deptOpts], editable: () => false,
    format: (v, r) => (v ? r.department_name || (deptOpts.find((o) => o.value === v) || {}).label || '' : 'Tests with no department') },
  { field: 'dept_trained_after', title: 'Department trained after (tests)', type: 'int', min: 1, width: 150 },
  { field: 'unlock_any_test', title: 'May do any test of it', type: 'bool', width: 120 },
  { field: 'unlock_can_train', title: 'May train others', type: 'bool', width: 110 },
  { field: 'continuing_months', title: 'Continuing competency every (months)', type: 'int', min: 1, width: 160 },
  { field: 'due_soon_days', title: 'Due soon (days before)', type: 'int', min: 0, width: 120 },
  { field: 'min_runs', title: 'At least (runs)', type: 'int', min: 1, width: 100 },
  { field: 'min_runs_months', title: 'in (months)', type: 'int', min: 1, width: 90 },
  { field: 'allow_training_samples', title: 'Training samples', type: 'bool', width: 110 },
  { field: 'allow_records', title: 'Training records', type: 'bool', width: 110 },
];
const saveRuleRows = (changed, reason) => saveRules(changed.map((r) => { const o = { ...r }; if (!r.id) o.department_id = r.dept || null; delete o.dept; return o; }), reason);

export default function OverviewPage({ query }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const { data: d, error, reload } = useApi((o) => getOverview(o), []);
  const tabQ = new URLSearchParams(query).get('tab');
  const tab = ['people', 'competency', 'rules'].includes(tabQ) ? tabQ : 'people';
  const redirect = d && !d.can.view && !d.can.record;
  useEffect(() => { if (redirect) window.location.hash = '#/training/people/' + d.me; }, [redirect, d]);
  const deptOpts = useMemo(() => (d ? d.departments.map((x) => ({ value: x.id, label: x.department_name })) : []), [d]);
  const rcols = useMemo(() => ruleCols(deptOpts), [deptOpts]);
  const rules = useMemo(() => (d ? d.rules.map((r) => ({ ...r, dept: r.department_id || '' })) : []), [d]);

  if (error && !d) return <><PageHeader title="Training and competency" audit={AUDIT} /><div className="card err">{error.message}</div></>;
  if (!d || redirect) return <><PageHeader title="Training and competency" audit={AUDIT} /><div className="loading">Loading…</div></>;

  async function legacy() {
    const r = await dialogs.sign({ title: 'Grant legacy qualifications', what: `legacy qualifications at ${d.lab.site_code}: everyone who signed a bench step of a test here in the last 12 months, for that test`, meaning: 'Approved by', needReason: false,
      submit: ({ signature }) => grantLegacy(signature) });
    if (r) { toast(`${r.granted} legacy qualification${Number(r.granted) === 1 ? '' : 's'} granted.`); reload(); }
  }
  const toEval = d.attempts.filter((a) => a.status === 'In progress').length; const toApprove = d.attempts.filter((a) => a.status === 'Evaluated').length;
  const subtitle = <>Who is qualified for which tests at {d.lab.site_code}, their initial and continuing competency, and the lab&apos;s rules. {d.lab.require_training
    ? <><b>This lab requires training:</b> bench steps are signed only by people with a current qualification for the test (or department trained, where the rule allows).</>
    : 'This lab does not require training at the bench yet (a system administrator switches it on: Sites and holidays, "Training gate"). Grant the legacy qualifications first.'}</>;
  const actions = <>{d.can.approve && <button type="button" className="btn" id="legacy" onClick={legacy}>Grant legacy qualifications…</button>} <a className="btn" href={`#/training/people/${d.me}`}>My training</a></>;
  const tabs = [['people', `People (${d.people.length})`], ['competency', `Competency (${toEval} to evaluate, ${toApprove} to approve)`], ['rules', 'Rules']];
  return <>
    <PageHeader title="Training and competency" subtitle={subtitle} actions={actions} audit={AUDIT} />
    <div className="tabs">{tabs.map(([k, l]) => <a key={k} className={`tab ${k === tab ? 'on' : ''}`} href={`#/training?tab=${k}`} style={{ textDecoration: 'none' }}>{l}</a>)}</div>
    {tab === 'people' && <Section title="People" help="Everyone in a group at this lab. Open a person for their qualifications, competency, the work they did and their training report.">
      <ReadGrid rows={d.people} columns={PEOPLE_COLS} search /></Section>}
    {tab === 'competency' && <Section title="Competency" help="Open attempts (to evaluate by a trainer, then to approve by QA) and those decided in the last 60 days. Open one to evaluate or approve it.">
      <ReadGrid rows={d.attempts} columns={ATTEMPT_COLS_PERSON} search /></Section>}
    {tab === 'rules' && <Section title="Rules" help={RULES_HELP}>
      <EditableGrid rows={rules} columns={rcols} readOnly={!d.can.configure} what="the training rules" save={saveRuleRows} afterSave={reload} /></Section>}
  </>;
}
