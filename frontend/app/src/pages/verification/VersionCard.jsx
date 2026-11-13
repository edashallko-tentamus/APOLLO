// The card on a version's Review tab (designer tab 4): the verifications of this version and the gate.
// onData(d) gets the answer (the Review tab uses d.required and d.passing to warn before approving).
import { useEffect } from 'react';
import { versionVerifications, writeProtocol } from '../../api/verification.js';
import Badge from '../../components/Badge.jsx';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { dt, OutcomeChip } from './shared.jsx';
import { Button } from 'react-bootstrap';

export default function VersionCard({ versionId, versionStatus, onData }) {
  const dialogs = useDialogs(); const toast = useToast();
  const { data: d, error } = useApi((o) => versionVerifications(versionId, o), [versionId]);
  useEffect(() => { if (d) onData?.(d); }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <div className="err">{error.message}</div>;
  if (!d) return <div className="loading">Loading…</div>;
  const draft = versionStatus === 'Draft';

  async function write() {
    const r = await dialogs.sign({ what: 'Workflow verification protocol for this version (earlier unsigned ones are cancelled)', meaning: 'Prepared by', needReason: false,
      submit: ({ signature }) => writeProtocol(versionId, signature) });
    if (r && r.id) { toast('Protocol written. QA approves it next.'); location.hash = '#/verification/' + r.id; }
  }

  return <>
    <p>{d.required ? <><b>{d.version.site_code} requires a passing workflow verification</b> of exactly this design before the version is approved.</> : 'This lab does not require a workflow verification before approval (a lab setting); one can still be run.'}
      {d.passing && <> <b>A signed, passing verification covers the current design.</b></>}</p>
    <p className="help">The protocol is written for you from the design: the requirements, automated samples (typical, below the LOQ, outside the specification), the values to enter and the expected results from an independent calculation. QA approves it, you execute it (an automated run through every step), and QA signs the report.</p>
    {d.rows.length > 0 && <table className="vt"><thead><tr><th>Verification</th><th>Status</th><th>Outcome</th><th>Checks passed</th><th>Prepared</th><th>Design</th></tr></thead><tbody>
      {d.rows.map((r) => <tr key={r.id}><td><a href={'#/verification/' + r.id}>{r.verification_code}</a></td><td><Badge status={r.status} /></td><td><OutcomeChip o={r.outcome} /></td>
        <td>{r.status === 'Report signed' || r.status === 'Executed' ? `${r.passed} of ${r.checks}` : `${r.checks} checks`}</td>
        <td>{r.prepared_by_name}, {dt(r.created_at)}</td><td>{r.current ? 'Current' : <b>Changed since</b>}</td></tr>)}</tbody></table>}
    {draft && (d.can_design ? <Button type="button" variant="outline-secondary" id="vnew" onClick={write}>Write the verification protocol</Button>
      : <div className="help">Writing the protocol needs methods.design in this lab.</div>)}
  </>;
}
