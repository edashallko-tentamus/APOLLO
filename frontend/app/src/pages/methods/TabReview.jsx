// Designer tab 4: Review and approve: what the database checks, QC acceptance per analyte, the workflow verification
// (the gate, WD-6) and the signed approval ("Approved by", by someone with methods.approve who did not work on it).
import { useState } from 'react';
import { approveVersion } from '../../api/methods.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import VersionCard from '../verification/VersionCard.jsx';
import { Card, dt } from './shared.jsx';

const lim = (r) => (!r.applies ? 'Not judged' : r.shape === 'Qualitative' ? r.limit_type
  : r.shape === 'Max' ? `≤ ${r.limit_ref || (r.max_value ?? '?')}` : `${r.min_value ?? '?'} to ${r.max_value ?? '?'}`);
const QC_COLUMNS = [
  { field: 'qc_type', title: 'QC', type: 'readonly', width: 200 }, { field: 'limit_type', title: 'Criterion', type: 'readonly', width: 140 },
  { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 200 },
  { field: 'lim', title: 'Limit', type: 'readonly', width: 130, compute: lim, cellClass: (r) => (r.applies ? '' : 'mutedrow') },
  { field: 'source', title: 'Set as', type: 'readonly', width: 160, compute: (r) => ({ Analyte: 'For this analyte', Default: 'Default (all analytes)', Exception: 'Exception' }[r.source] || r.source) },
];

export default function TabReview({ d, reload }) {
  const v = d.version;
  const dialogs = useDialogs(); const toast = useToast();
  const [gate, setGate] = useState(null);
  const errors = d.problems.filter((p) => p.severity === 'Error'); const warns = d.problems.filter((p) => p.severity === 'Warning');
  const stepOf = (k) => d.steps.find((s) => s.step_key === k);
  const canApprove = v.status === 'Draft' && d.can_approve && !errors.length && !d.i_worked_on_it;
  const li = (p, i) => { const s = p.step_key ? stepOf(p.step_key) : null;
    return <li key={i} className={p.severity}>{s && <a href={`#/methods/versions/${v.id}?tab=workflow&step=${s.id}`}>{s.step_name}</a>}{p.problem}</li>; };

  async function approve() {
    const ok = await dialogs.sign({ what: `${d.test.test_code} ${d.test.test_name}, version ${v.version_no}`, meaning: 'Approved by', needReason: false,
      submit: async ({ signature }) => { await approveVersion(v.id, signature); } });
    if (ok) { toast(`Version ${v.version_no} is Effective.`); reload(); }
  }

  return <>
    <Section title="What the database checks" help="Errors stop approval. Warnings are worth a look but do not stop it.">
      {d.problems.length ? <ul className="wdprob">{[...errors, ...warns].map(li)}</ul> : <div className="wdok">No problems found: this version is complete.</div>}
    </Section>
    <div className="wdcards">
      <Card label="Analytes">{d.analytes.length}</Card><Card label="Steps">{d.steps.length}</Card>
      <Card label="QC types in the batch">{(d.steps.find((s) => s.step_type === 'Batching')?.config?.qc || []).length}</Card>
      <Card label="Formulas">{d.steps.filter((s) => s.step_type === 'Calculation').length}</Card>
    </div>
    {(d.qcCriteria || []).length > 0 && <Section title="QC acceptance per analyte" help="What each QC will judge for each analyte at the bench: one verdict per analyte against its own limit (set in the Batching step).">
      <div id="qcx"><ReadGrid rows={d.qcCriteria} columns={QC_COLUMNS} search /></div></Section>}
    <Section title="Workflow verification" help="An automated sample runs through the whole workflow and the results are checked against an independent calculation: the protocol, run and report are signed (WD-6).">
      <div id="verif"><VersionCard versionId={v.id} versionStatus={v.status} onData={setGate} /></div>
    </Section>
    <Section title="Approval" help="Approving makes this version Effective: new orders use it, and the previous effective version is superseded (tests already ordered keep theirs). The approver signs, holds methods.approve, and did not work on the version.">
      {v.status === 'Draft' ? <>
        <p>Worked on this version: <b>{d.authors.join(', ') || '—'}</b>{d.authors.length > 0 && ' (they cannot approve it).'}</p>
        {canApprove ? <>
          <button type="button" className="btn primary" id="approve" onClick={approve}>Approve version {v.version_no}</button>
          {/* the gate (WD-6): with the lab's setting on, approval waits for a signed, passing verification of this design */}
          {gate && gate.required && !gate.passing && <div className="notice" style={{ marginTop: 8 }}>This lab requires a passing workflow verification first (above): approving now will be refused.</div>}
        </> : <div className="notice">{!d.can_approve ? 'Approving needs methods.approve in this lab.' : d.i_worked_on_it ? 'You worked on this version, so someone else must approve it.' : `Fix the ${errors.length} problem${errors.length === 1 ? '' : 's'} above first.`}</div>}
      </> : <p>{v.status}{v.approved_by_name && <>: approved by <b>{v.approved_by_name}</b> on {dt(v.approved_at)} (electronic signature)</>}{v.effective_from && `, effective from ${dt(v.effective_from)}`}.</p>}
    </Section>
  </>;
}
