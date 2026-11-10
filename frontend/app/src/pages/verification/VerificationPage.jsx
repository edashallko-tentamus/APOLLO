// #/verification/:id: workflow verification (WD-6, migration 024): the protocol and report of one verification, as one
// document. Prepared by the designer (written by the server from the version's design), approved by QA (signed), executed
// by an automated run (signed "Executed by"), the evidence captured (signed), and its report signed by QA. It prints as the
// validation document: purpose and scope, URS and FRS, samples and inputs, every check with expected and actual result,
// traceability, the run log, the deviations and QA's conclusion.
import { useEffect } from 'react';
import { approveProtocol, cancelVerification, captureEvidence, docxUrl, evidenceUrl, executeRun, getVerification, signReport } from '../../api/verification.js';
import Badge from '../../components/Badge.jsx';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { dt, OutcomeChip, resCls, text } from './shared.jsx';

const WHO = { executor: 'Executed by', analyst: 'Verification analyst', reviewer: 'Verification reviewer', witness: 'Verification witness' };
const evName = (n) => 'E-' + String(n).padStart(2, '0');
const analyteName = (w, id) => ((w.definition && w.definition.analytes) || []).find((a) => a.analyte_id === id)?.analyte_name || 'Analyte';

function Sig({ meaning, s, fallback }) {
  return <div><div className="m">{meaning}</div>{s ? <><div className="n">{s.full_name}</div><div className="d">{dt(s.signed_at)}</div><div className="d">{s.method}</div></> : <div className="d">{fallback}</div>}</div>;
}
function ReqTable({ rows, checksOf, frs }) {
  if (!rows.length) return <p>None.</p>;
  return <table className="vt"><thead><tr><th style={{ width: 62 }}>Code</th><th>Requirement</th>{frs && <th style={{ width: 90 }}>Serves</th>}<th style={{ width: 170 }}>Source</th><th style={{ width: 110 }}>Checks</th><th style={{ width: 80 }}>Result</th></tr></thead><tbody>
    {rows.map((r) => <tr key={r.req_code}><td><b>{r.req_code}</b></td><td>{r.statement}</td>{frs && <td>{(r.traces || []).join(', ')}</td>}<td>{r.source || ''}</td>
      <td>{checksOf(r.req_code).join(', ') || <i>none</i>}</td><td className={resCls(r.result)}>{r.result || ''}</td></tr>)}</tbody></table>;
}
function InputsOf({ c }) {
  const i = c.inputs || {};
  if (i.kind === 'calc' && i.formula) return <><br /><code>{i.formula}</code> with {Object.entries(i.tokens || {}).map(([k, v]) => `{${k}} = ${v}`).join(', ')}</>;
  if (i.kind === 'result' && i.readings) { const r = Object.entries(i.readings).map(([k, v]) => `${k}: ${v}`).join(', '); return r ? <><br /><span className="d">Readings: {r}</span></> : null; }
  return null;
}
function InputsTable({ w, plan, samples }) {
  const out = [];
  for (const s of ((w.definition && w.definition.steps) || [])) {
    const k = s.step_key;
    if (s.step_type === 'Weighing') out.push([s.step_name, samples.map((x) => `${x.key}: ${x.inputs.weigh[k]} ${s.config.unit || 'g'}`).join('; ') + ' (prep QC as S1)']);
    if (s.step_type === 'Dilution') out.push([s.step_name, samples.map((x) => `${x.key}: ${(x.inputs.dil[k] || []).map((f) => `${f.aliquot} + ${f.diluent}`).join(', ')}`).join('; ')]);
    if (s.step_type === 'Preparation') out.push([s.step_name, Object.entries((plan.batch.prep || {})[k] || {}).map(([f, v]) => `${f} = ${v}`).join(', ') || 'no fields']);
    if (s.step_type === 'Incubation') { const i = (plan.batch.inc || {})[k] || {}; out.push([s.step_name, `${i.duration} ${i.unit} at ${i.temperature ?? 'the target'} °C, one load for the batch`]); }
    if (s.step_type === 'Plating/Inoculation') out.push([s.step_name, samples.map((x) => `${x.key}: ${x.inputs.plates[k]} plate(s)`).join('; ') + '; a usable media lot']);
    if (s.step_type === 'Data Entry') out.push([s.step_name, samples.map((x) => `${x.key}: ${Object.entries(x.inputs.read[k] || {}).map(([a, v]) => `${analyteName(w, a)} ${v}`).join(', ')}`).join('; ') + '; QC readings set at run time to meet their criteria']);
  }
  if (!out.length) return null;
  return <table className="vt"><thead><tr><th style={{ width: 220 }}>Step</th><th>Values the run enters</th></tr></thead><tbody>{out.map(([a, b], i) => <tr key={i}><td><b>{a}</b></td><td>{b}</td></tr>)}</tbody></table>;
}

export default function VerificationPage({ params: [id] }) {
  const { site } = useSession();
  const dialogs = useDialogs(); const toast = useToast();
  const { data: d, error, reload } = useApi((o) => getVerification(id, o), [id]);
  // refresh while the server captures, as long as this page is open
  useEffect(() => { if (!d?.capturing) return undefined; const t = setTimeout(reload, 3000); return () => clearTimeout(t); }, [d, reload]);
  if (error && !d) return <><PageHeader title="Workflow verification" /><div className="card err">{error.message}</div></>;
  if (!d) return <><PageHeader title="Workflow verification" /><div className="loading">Loading…</div></>;

  const w = d.verification; const S = d.signatures;
  const urs = d.requirements.filter((r) => r.kind === 'URS'); const frs = d.requirements.filter((r) => r.kind === 'FRS');
  const plan = w.plan || {}; const samples = plan.samples || [];
  const codeOf = (key) => (d.samples.find((s) => s.client_sample_id === key) || {}).sample_code || '';
  const checksOf = (code) => d.checks.filter((c) => (c.requirement_codes || []).includes(code)).map((c) => c.check_code);
  const isQa = d.can_verify; const isDesigner = d.can_design;
  const hasEv = !!w.evidence_captured_at;
  const evOf = (code) => (d.evidence || []).filter((e) => (e.check_codes || []).includes(code));
  const evImg = (e) => evidenceUrl(w.id, e.seq, site?.id);
  const failed = d.checks.filter((c) => c.result === 'Fail'); const untested = d.checks.filter((c) => c.result === 'Not tested');
  const reqNt = d.requirements.filter((r) => r.result === 'Not tested'); const reqF = d.requirements.filter((r) => r.result === 'Fail');
  const scrollTo = (e, seq) => { e.preventDefault(); document.getElementById('vev-' + seq)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); };

  const signThen = (opts, ok) => dialogs.sign({ needReason: false, ...opts }).then((r) => { if (r) { ok(r); reload(); } });
  const approve = () => signThen({ what: `Verification protocol ${w.verification_code} (${w.test_name} version ${w.version_no})`, meaning: 'Approved by',
    submit: async ({ signature }) => { await approveProtocol(w.id, signature); } }, () => toast('Protocol approved. It can now be executed.'));
  const execute = () => signThen({ what: `Run ${w.verification_code}: automated samples through ${w.test_name} version ${w.version_no}`, meaning: 'Executed by',
    submit: ({ signature }) => executeRun(w.id, signature) }, (r) => toast(`Run finished: ${r.outcome}. The screenshots of its pages are being captured.`));
  const capture = () => signThen({ what: `Screenshots of the pages of ${w.verification_code} (about a minute)`, meaning: 'Evidence captured by',
    submit: ({ signature }) => captureEvidence(w.id, signature) }, (r) => toast(`${r.pages} screenshots captured.`));
  const cancel = () => signThen({ what: `Cancel ${w.verification_code}`, meaning: 'Cancelled by', needReason: true,
    submit: async ({ signature, reason }) => { await cancelVerification(w.id, reason, signature); } }, () => toast('Verification cancelled.'));
  async function sign() {
    const v = await dialogs.form({ title: `Sign the report of ${w.verification_code}`, okText: 'Continue to sign', wide: true,
      intro: <>Outcome: <b>{w.outcome}</b>. {reqF.length ? 'Failed requirements stop the version\'s approval whatever is written here.' : ''}{reqNt.length ? ' Write why each requirement not tested is acceptable.' : ''}</>,
      fields: [{ name: 'conclusion', label: 'Conclusion', type: 'textarea', required: true,
        value: w.outcome === 'Pass' ? 'Every requirement passed: the workflow runs as designed.' : w.outcome === 'Fail' ? 'The verification failed: the version is not fit for approval as designed.' : 'The workflow runs as designed, except the requirements not tested (justified below).' },
      ...reqNt.map((r) => ({ name: 'j_' + r.req_code, label: `${r.req_code} not tested: why it is acceptable`, type: 'textarea', required: true, help: r.statement + (r.result_note ? ' (' + r.result_note + ')' : '') }))] });
    if (!v) return;
    const justifications = Object.fromEntries(reqNt.map((r) => [r.req_code, v['j_' + r.req_code]]));
    signThen({ what: `Verification report ${w.verification_code}: ${w.outcome}`, meaning: 'Approved by',
      submit: async ({ signature }) => { await signReport(w.id, { signature, conclusion: v.conclusion, justifications }); } }, () => toast('Report signed.'));
  }

  const back = `#/methods/versions/${w.test_version_id}?tab=review`;
  const subtitle = <>Workflow verification <Badge status={w.status} /> <OutcomeChip o={w.outcome} /> · <a href={back}>{`${w.test_code} version ${w.version_no} (${w.version_status})`}</a> · {w.site_code}</>;
  return <>
    <PageHeader title={`${w.verification_code}: ${w.test_name} v${w.version_no}`} subtitle={subtitle} audit={{ kind: 'verification', id: w.id }}
      actions={<a className="btn ghost" href={back}>Back to the version</a>} />
    <div className="vacts noprint">
      {w.status === 'Protocol draft' && isQa && <button type="button" className="btn primary" id="vapprove" onClick={approve}>Approve the protocol (QA)</button>}
      {w.status === 'Protocol approved' && isDesigner && <button type="button" className="btn primary" id="vexec" onClick={execute}>Execute the run</button>}
      {w.status === 'Executed' && !hasEv && !d.capturing && (isQa || isDesigner) && <button type="button" className="btn primary" id="vcapture" onClick={capture}>Capture the evidence</button>}
      {w.status === 'Executed' && hasEv && isQa && <button type="button" className="btn primary" id="vsign" onClick={sign}>Sign the report (QA)</button>}
      {['Protocol draft', 'Protocol approved', 'Executed'].includes(w.status) && (isQa || isDesigner) && <button type="button" className="btn" id="vcancel" onClick={cancel}>Cancel</button>}
      <a className="btn ghost" id="vdocx" href={docxUrl(w.id, site?.id)}>Word document</a>
      <button type="button" className="btn ghost" id="vprint" onClick={() => window.print()}>Print</button>
    </div>
    {!w.current && !['Report signed', 'Cancelled'].includes(w.status) && <div className="vwarn"><b>The version changed after this protocol was written.</b> It can no longer be approved or executed: write a new protocol from the version&apos;s Review tab.</div>}
    {d.capturing && <div className="vnote"><b>Capturing the evidence:</b> the server is taking screenshots of the run&apos;s pages (about a minute). This page refreshes by itself.</div>}
    {w.status === 'Executed' && !hasEv && d.capture_error && <div className="vwarn"><b>The screenshots could not be captured:</b> {d.capture_error}</div>}
    {w.status === 'Executed' && !hasEv && !d.capturing && <div className="vwarn"><b>The evidence is not captured yet.</b> {isQa || isDesigner ? 'Capture the evidence (screenshots of the run\'s pages) before QA signs the report.' : 'The designer or QA captures it before QA signs the report.'}</div>}
    {w.status === 'Report signed' && !w.current && <div className="vwarn">The version changed after this verification: it no longer opens the gate for approval.</div>}
    <div className="vdoc">
      <div className="vhead"><div><div className="t">Workflow verification {w.verification_code}</div>
        <div className="s">{w.test_name}, version {w.version_no} · {w.site_code} {w.site_name || ''}</div></div>
        <div style={{ textAlign: 'right' }}><Badge status={w.status} /><div style={{ marginTop: 6 }}><OutcomeChip o={w.outcome} /></div></div></div>
      <div className="vkv">
        <b>Test</b><span><a href={'#/methods/versions/' + w.test_version_id}>{`${w.test_code} ${w.test_name}`}</a>, version {w.version_no} ({w.version_status})</span>
        <b>Method</b><span>{w.method_name || 'none'}{w.sop_code ? ` (${w.sop_code})` : ''}</span>
        <b>Design fingerprint</b><span><code>{w.config_hash}</code> {w.current ? '(matches the version now)' : <b>(the version has changed since)</b>}</span>
        <b>Protocol written by</b><span>{w.generator}</span>
        {d.order && <><b>Verification order</b><span>{d.order.order_code} ({d.order.status}), internal client; samples {d.samples.map((s) => s.sample_code).join(', ')}</span></>}
        {d.batches.length > 0 && <><b>Batches</b><span>{d.batches.map((b, i) => <span key={b.id}>{i > 0 && ', '}<a href={'#/testing/batches/' + b.id}>{b.batch_code}</a> ({b.status})</span>)}</span></>}
      </div>
      <div className="vsig"><Sig meaning="Prepared by" s={S.prepared} fallback={w.prepared_by_name || ''} /><Sig meaning="Protocol approved by (QA)" s={S.approved} fallback="Waiting for QA" />
        <Sig meaning="Executed by" s={S.executed} fallback="Not executed yet" /><Sig meaning="Evidence captured by" s={S.evidence} fallback="Not captured yet" /><Sig meaning="Report approved by (QA)" s={S.report} fallback="Not signed yet" /></div>

      <h2>1. Purpose and scope</h2>
      <p>This verification shows that version {w.version_no} of {w.test_name}, as designed in the Workflow Designer, runs as intended in LIMS3 before it is approved: automated samples go through every step of the workflow, the results the system calculates and stores are compared with a second, independent calculation, and the workflow&apos;s controls (missing data, signatures, review by someone else, QC, specifications) are challenged.</p>
      <p>It verifies the <b>configured workflow</b>. It is not a validation of the analytical method (method validation is separate), and not the validation of LIMS3 itself (computer system validation is separate).</p>
      <h2>2. Approach</h2>
      <p>The protocol (requirements, samples, every value the run enters, and the expected results) is written before the run, from the version&apos;s design, and approved by QA. The expected results come from an independent calculation in the server: its own formula reader, exact decimal arithmetic, rounding, LOQ and LOD reporting and specification comparison. Unrounded results agree when they match to 9 significant figures; reported results and conformance must match exactly.</p>
      <p>The run is done by three automated accounts (Verification analyst, witness and reviewer). They have no password, cannot sign in, and get bench or review rights only at this lab and only while the run goes on; their signatures say &quot;Automated verification run&quot;. They go through the same database rules as the bench and review screens. QC readings are set at run time so each QC meets its criteria (the recovery from the standard or spike recorded). The samples are on an internal order and their batches are verification batches, kept out of the lab&apos;s lists, the backlog and inventory stock.</p>
      <p>A check is <b>Pass</b> when the system matches the protocol, <b>Fail</b> when it does not, and <b>Not tested</b> when the run could not reach it (with the reason). A requirement passes when all its checks pass. One failed check fails the verification; requirements not tested must each be justified by QA when signing, and the outcome is then &quot;Pass with exceptions&quot;.</p>

      <h2>3. User requirements (URS)</h2>
      <ReqTable rows={urs} checksOf={checksOf} frs={false} />
      <h2>4. Functional requirements (FRS)</h2>
      <ReqTable rows={frs} checksOf={checksOf} frs />

      <h2>5. Samples and inputs (decided in the protocol)</h2>
      <table className="vt"><thead><tr><th>Sample</th><th>Code</th><th>Case</th><th>Specification put on it</th></tr></thead><tbody>
        {samples.map((s) => <tr key={s.key}><td><b>{s.key}</b></td><td>{codeOf(s.key)}</td><td>{s.case}</td><td>{(s.specs || []).map((sp) => `${analyteName(w, sp.analyte_id)}: ${sp.text ? sp.text
          : `${sp.min !== null ? '≥ ' + sp.min : ''}${sp.min !== null && sp.max !== null ? ' and ' : ''}${sp.max !== null ? '≤ ' + sp.max : ''}`}${sp.unit ? ' ' + sp.unit : ''}`).join('; ') || 'none'}</td></tr>)}
      </tbody></table>
      <InputsTable w={w} plan={plan} samples={samples} />

      <h2>6. Checks</h2>
      {['Process', 'QC', ...new Set(samples.map((s) => s.case))].map((cl) => {
        const rows = d.checks.filter((c) => c.case_label === cl); if (!rows.length) return null;
        return <div key={cl}><h3>{cl === 'Process' ? 'The workflow and its controls' : cl === 'QC' ? 'Quality control' : `Results: ${cl}`}</h3>
          <table className="vt"><thead><tr><th style={{ width: 52 }}>Check</th><th>What is checked, and how</th><th style={{ width: 96 }}>Requirements</th><th>Expected (protocol)</th><th>Actual (system)</th><th style={{ width: 70 }}>Result</th></tr></thead><tbody>
            {rows.map((c) => <tr key={c.check_code}><td><b>{c.check_code}</b></td><td><b>{c.title}</b><br /><span className="d">{c.procedure_text || ''}</span><InputsOf c={c} /></td>
              <td>{(c.requirement_codes || []).join(', ')}</td><td>{text(c.expected)}</td>
              <td>{text(c.actual)}{c.note && <><br /><i>{c.note}</i></>}
                {evOf(c.check_code).length > 0 && <><br />{evOf(c.check_code).map((e, i) => <span key={e.seq}>{i > 0 && ', '}<a href={`#vev-${e.seq}`} className="vevlink" onClick={(ev) => scrollTo(ev, e.seq)}>{evName(e.seq)}</a></span>)}</>}
                {c.evidence_ref && <> <a className="noprint d" href={c.evidence_ref}>(open the page)</a></>}</td>
              <td className={resCls(c.result)}>{c.result || ''}</td></tr>)}
          </tbody></table></div>;
      })}

      <h2>7. Traceability</h2>
      <table className="vt"><thead><tr><th>Requirement</th><th>Checks</th><th>Result</th></tr></thead><tbody>
        {d.requirements.map((r) => <tr key={r.req_code}><td><b>{r.req_code}</b>{r.traces && r.traces.length ? ' (' + r.traces.join(', ') + ')' : ''}</td><td>{checksOf(r.req_code).join(', ') || <i>none</i>}</td>
          <td className={resCls(r.result)}>{r.result || ''}{r.result_note && <> <span className="d">({r.result_note})</span></>}</td></tr>)}
      </tbody></table>

      <h2>8. Execution</h2>
      {w.executed_at ? <>
        <p>Executed {dt(w.executed_at)} by {S.executed ? S.executed.full_name : ''}; finished {dt(w.finished_at)}. {d.checks.filter((c) => c.result === 'Pass').length} of {d.checks.length} checks passed, {failed.length} failed, {untested.length} not tested.</p>
        <table className="vt vlog"><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>
          {(w.run_log || []).map((l, i) => <tr key={i}><td>{new Date(l.at).toLocaleTimeString()}</td><td>{WHO[l.who] || l.who}</td><td>{l.action}{l.detail && <><br /><span className="d">{l.detail}</span></>}</td></tr>)}
        </tbody></table></> : <p>Not executed yet.</p>}

      <h3>Objective evidence</h3>
      {hasEv ? <>
        <p>{d.evidence.length} screenshot{d.evidence.length === 1 ? '' : 's'} captured {dt(w.evidence_captured_at)} by {S.evidence ? S.evidence.full_name : ''}, in a headless browser signed in as that person. Each image is stored unchanged with its SHA-256; click one to open it full size.</p>
        {w.evidence_note && <div className="vwarn">{w.evidence_note}</div>}
        <div className="vev">{d.evidence.map((e) => <figure key={e.seq} id={`vev-${e.seq}`}><a href={evImg(e)} target="_blank" rel="noopener noreferrer"><img loading="lazy" src={evImg(e)} alt={evName(e.seq) + ' ' + e.title} /></a>
          <figcaption><b>{evName(e.seq)}</b> {e.title}<br /><span className="d">Checks {(e.check_codes || []).join(', ') || 'none'}</span><br /><code>{e.sha256}</code></figcaption></figure>)}</div>
      </> : <p>{d.capturing ? 'Being captured now.' : w.executed_at ? 'Not captured yet.' : 'Not executed yet.'}</p>}

      <h2>9. Deviations and requirements not tested</h2>
      {w.executed_at ? <>
        {failed.length || untested.length ? <table className="vt"><thead><tr><th>Check</th><th>Result</th><th>Why</th></tr></thead><tbody>
          {[...failed, ...untested].map((c) => <tr key={c.check_code}><td><b>{c.check_code}</b> {c.title}</td><td className={resCls(c.result)}>{c.result}</td><td>{c.note || text(c.actual)}</td></tr>)}</tbody></table>
          : <p>None: every check passed.</p>}
        {reqNt.length > 0 && <><h3>Requirements not tested, and QA&apos;s justification</h3><table className="vt"><thead><tr><th>Requirement</th><th>QA justification</th></tr></thead><tbody>
          {reqNt.map((r) => <tr key={r.req_code}><td><b>{r.req_code}</b> {r.statement}</td><td>{r.qa_justification || (w.status === 'Executed' ? 'Waiting for QA' : '')}</td></tr>)}</tbody></table></>}
      </> : <p>Not executed yet.</p>}

      <h2>10. Conclusion</h2>
      {w.status === 'Report signed' ? <><p><b>{w.outcome}.</b> {w.report_conclusion}</p><p className="d">Signed by {S.report ? S.report.full_name : ''} (QA), {dt(w.report_signed_at)}.</p></>
        : w.status === 'Cancelled' ? <p>Cancelled: {w.cancelled_reason || ''}</p> : <p>Waiting for the run and QA&apos;s signature.</p>}
      {reqF.length > 0 && w.status !== 'Cancelled' && <div className="vwarn">{reqF.length} requirement{reqF.length > 1 ? 's' : ''} failed: the version cannot be approved on this verification. Fix the design (or the system) and write a new protocol.</div>}
    </div>
  </>;
}
