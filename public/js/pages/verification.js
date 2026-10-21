// Workflow verification (WD-6, migration 024): the protocol and report of one verification, as one document.
// Prepared by the designer (written by the server from the version's design), approved by QA (signed), executed by an
// automated run (signed "Executed by"), and its report signed by QA. It prints as the validation document: purpose and
// scope, requirements (URS and FRS), the samples and inputs decided in advance, every check with its expected and
// actual result, the traceability matrix, the run log, the deviations and QA's conclusion.
import { api, esc, pageHeader, toast, modal, badge, link, signDialog, state } from '../app.js';

const css = document.createElement('style');
css.textContent = `
.vdoc { background: #fff; max-width: 1180px; padding: 30px 38px; border: 1px solid var(--line); border-radius: 6px; }
.vdoc h2 { font-size: 17px; margin: 26px 0 8px; color: var(--green-900); border-bottom: 1px solid var(--line); padding-bottom: 4px; }
.vdoc h3 { font-size: 14.5px; margin: 16px 0 6px; }
.vdoc p { margin: 6px 0; line-height: 1.5; }
.vhead { display: flex; justify-content: space-between; gap: 20px; border-bottom: 3px solid var(--green-700); padding-bottom: 12px; margin-bottom: 14px; }
.vhead .t { font-size: 20px; font-weight: 700; color: var(--green-900); } .vhead .s { color: var(--muted); margin-top: 3px; }
.vout { font-size: 15px; font-weight: 700; padding: 4px 12px; border-radius: 8px; display: inline-block; }
.vout.Pass { background: var(--green-50); color: var(--green-700); border: 1px solid #BFE6D6; }
.vout.Fail { background: #FDECEC; color: var(--err-ink); border: 1px solid #F3C1C1; }
.vout.exc { background: #FFF8E6; color: var(--warn-ink); border: 1px solid #F0D9A0; }
table.vt { width: 100%; border-collapse: collapse; margin: 6px 0 14px; font-size: 12.8px; }
table.vt th { background: #F0F3F5; text-align: left; padding: 6px 7px; font-size: 12px; vertical-align: bottom; }
table.vt td { padding: 6px 7px; border-bottom: 1px solid #E8ECEF; vertical-align: top; }
table.vt td.r-Pass { color: var(--green-700); font-weight: 700; } table.vt td.r-Fail { color: var(--err-ink); font-weight: 700; }
table.vt td.r-Not { color: var(--warn-ink); font-weight: 700; }
table.vt code, .vdoc code { font-size: 12px; background: #F4F6F7; padding: 1px 4px; border-radius: 4px; word-break: break-all; }
.vsig { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin: 10px 0 4px; }
.vsig > div { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 12.8px; min-height: 74px; }
.vsig .m { font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: .4px; color: var(--muted); }
.vsig .n { font-weight: 600; margin-top: 4px; } .vsig .d { color: var(--muted); }
.vacts { display: flex; gap: 8px; flex-wrap: wrap; margin: 4px 0 14px; }
.vnote { background: #F4F6F7; border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; margin: 10px 0; font-size: 13.5px; }
.vwarn { background: #FFF8E6; border: 1px solid #F0D9A0; border-radius: 8px; padding: 8px 12px; margin: 10px 0; font-size: 13.5px; }
.vkv { display: grid; grid-template-columns: 190px 1fr; gap: 3px 14px; font-size: 13.5px; }
.vkv b { font-weight: 600; color: var(--muted); }
.vlog { font-size: 12.5px; } .vlog td:first-child { white-space: nowrap; color: var(--muted); }
.vjust textarea { width: 100%; }
.vev { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; margin: 8px 0 14px; }
.vev figure { margin: 0; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: #FAFBFC; }
.vev img { display: block; width: 100%; height: 170px; object-fit: cover; object-position: top; border-bottom: 1px solid var(--line); }
.vev figcaption { padding: 7px 9px; font-size: 12.3px; line-height: 1.4; }
.vev figcaption code { font-size: 10.5px; }
@media print { .vev { grid-template-columns: 1fr 1fr; } .vev img { height: auto; } }
.vdoc .d, .vt .d { color: var(--muted); }
@media print { .vdoc { border: 0; padding: 0; max-width: none; } .vacts, .noprint { display: none !important; } table.vt { font-size: 11px; } }
`;
document.head.appendChild(css);

const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
const resCls = (r) => (r === 'Not tested' ? 'r-Not' : r ? 'r-' + r : '');
const text = (x) => (x === null || x === undefined ? '' : typeof x === 'object' ? (x.text ?? JSON.stringify(x)) : String(x));
const outcomeChip = (o) => (o ? `<span class="vout ${o === 'Pass with exceptions' ? 'exc' : esc(o)}">${esc(o)}</span>` : '');

export async function page(main, id) {
  const d = await api('/verification/' + id);
  const w = d.verification; const S = d.signatures;
  const urs = d.requirements.filter((r) => r.kind === 'URS'); const frs = d.requirements.filter((r) => r.kind === 'FRS');
  const plan = w.plan || {}; const samples = plan.samples || [];
  const codeOf = (key) => (d.samples.find((s) => s.client_sample_id === key) || {}).sample_code || '';
  const checksOf = (code) => d.checks.filter((c) => (c.requirement_codes || []).includes(code)).map((c) => c.check_code);
  const sig = (meaning, s, fallback) => `<div><div class="m">${esc(meaning)}</div>${s ? `<div class="n">${esc(s.full_name)}</div><div class="d">${esc(dt(s.signed_at))}</div><div class="d">${esc(s.method)}</div>` : `<div class="d">${esc(fallback)}</div>`}</div>`;
  const isQa = d.can_verify; const isDesigner = d.can_design;
  const acts = [];
  if (w.status === 'Protocol draft' && isQa) acts.push('<button class="btn primary" id="vapprove">Approve the protocol (QA)</button>');
  if (w.status === 'Protocol approved' && isDesigner) acts.push('<button class="btn primary" id="vexec">Execute the run</button>');
  const hasEv = !!w.evidence_captured_at;
  if (w.status === 'Executed' && !hasEv && !d.capturing && (isQa || isDesigner)) acts.push('<button class="btn primary" id="vcapture">Capture the evidence</button>');
  if (w.status === 'Executed' && hasEv && isQa) acts.push('<button class="btn primary" id="vsign">Sign the report (QA)</button>');
  if (['Protocol draft', 'Protocol approved', 'Executed'].includes(w.status) && (isQa || isDesigner)) acts.push('<button class="btn" id="vcancel">Cancel</button>');
  const sq = '?s=' + encodeURIComponent(state.site || '');
  acts.push(`<a class="btn ghost" id="vdocx" href="/api/verification/${esc(w.id)}/report.docx${sq}">Word document</a>`);
  acts.push('<button class="btn ghost" id="vprint">Print</button>');
  const evName = (n) => 'E-' + String(n).padStart(2, '0');
  const evOf = (code) => (d.evidence || []).filter((e) => (e.check_codes || []).includes(code));
  const evImg = (e) => `/api/verification/${esc(w.id)}/evidence/${e.seq}${sq}`;
  const failed = d.checks.filter((c) => c.result === 'Fail'); const untested = d.checks.filter((c) => c.result === 'Not tested');
  const reqNt = d.requirements.filter((r) => r.result === 'Not tested'); const reqF = d.requirements.filter((r) => r.result === 'Fail');
  const stepRows = (plan.samples && plan.samples[0] && plan.samples[0].inputs) || {};
  main.innerHTML = pageHeader(`${w.verification_code}: ${w.test_name} v${w.version_no}`,
    `Workflow verification ${badge(w.status)} ${outcomeChip(w.outcome)} · ${link('#/methods/versions/' + w.test_version_id + '?tab=review', `${w.test_code} version ${w.version_no} (${w.version_status})`)} · ${esc(w.site_code)}`,
    `<a class="btn ghost" href="#/methods/versions/${w.test_version_id}?tab=review">Back to the version</a>`, { kind: 'verification', id: w.id })
    + `<div class="vacts noprint">${acts.join(' ')}</div>`
    + (!w.current && !['Report signed', 'Cancelled'].includes(w.status) ? `<div class="vwarn"><b>The version changed after this protocol was written.</b> It can no longer be approved or executed: write a new protocol from the version's Review tab.</div>` : '')
    + (d.capturing ? `<div class="vnote"><b>Capturing the evidence:</b> the server is taking screenshots of the run's pages (about a minute). This page refreshes by itself.</div>` : '')
    + (w.status === 'Executed' && !hasEv && d.capture_error ? `<div class="vwarn"><b>The screenshots could not be captured:</b> ${esc(d.capture_error)}</div>` : '')
    + (w.status === 'Executed' && !hasEv && !d.capturing ? `<div class="vwarn"><b>The evidence is not captured yet.</b> ${isQa || isDesigner ? 'Capture the evidence (screenshots of the run\'s pages) before QA signs the report.' : 'The designer or QA captures it before QA signs the report.'}</div>` : '')
    + (w.status === 'Report signed' && !w.current ? `<div class="vwarn">The version changed after this verification: it no longer opens the gate for approval.</div>` : '')
    + `<div class="vdoc">
      <div class="vhead"><div><div class="t">Workflow verification ${esc(w.verification_code)}</div>
        <div class="s">${esc(w.test_name)}, version ${esc(w.version_no)} · ${esc(w.site_code)} ${esc(w.site_name || '')}</div></div>
        <div style="text-align:right">${badge(w.status)}<div style="margin-top:6px">${outcomeChip(w.outcome)}</div></div></div>
      <div class="vkv">
        <b>Test</b><span>${link('#/methods/versions/' + w.test_version_id, `${w.test_code} ${w.test_name}`)}, version ${esc(w.version_no)} (${esc(w.version_status)})</span>
        <b>Method</b><span>${esc(w.method_name || 'none')}${w.sop_code ? ' (' + esc(w.sop_code) + ')' : ''}</span>
        <b>Design fingerprint</b><span><code>${esc(w.config_hash)}</code> ${w.current ? '(matches the version now)' : '<b>(the version has changed since)</b>'}</span>
        <b>Protocol written by</b><span>${esc(w.generator)}</span>
        ${d.order ? `<b>Verification order</b><span>${esc(d.order.order_code)} (${esc(d.order.status)}), internal client; samples ${d.samples.map((s) => esc(s.sample_code)).join(', ')}</span>` : ''}
        ${d.batches.length ? `<b>Batches</b><span>${d.batches.map((b) => `${link('#/testing/batches/' + b.id, b.batch_code)} (${esc(b.status)})`).join(', ')}</span>` : ''}
      </div>
      <div class="vsig">${sig('Prepared by', S.prepared, w.prepared_by_name || '')}${sig('Protocol approved by (QA)', S.approved, 'Waiting for QA')}${sig('Executed by', S.executed, 'Not executed yet')}${sig('Evidence captured by', S.evidence, 'Not captured yet')}${sig('Report approved by (QA)', S.report, 'Not signed yet')}</div>

      <h2>1. Purpose and scope</h2>
      <p>This verification shows that version ${esc(w.version_no)} of ${esc(w.test_name)}, as designed in the Workflow Designer, runs as intended in LIMS3 before it is approved: automated samples go through every step of the workflow, the results the system calculates and stores are compared with a second, independent calculation, and the workflow's controls (missing data, signatures, review by someone else, QC, specifications) are challenged.</p>
      <p>It verifies the <b>configured workflow</b>. It is not a validation of the analytical method (method validation is separate), and not the validation of LIMS3 itself (computer system validation is separate).</p>
      <h2>2. Approach</h2>
      <p>The protocol (requirements, samples, every value the run enters, and the expected results) is written before the run, from the version's design, and approved by QA. The expected results come from an independent calculation in the server: its own formula reader, exact decimal arithmetic, rounding, LOQ and LOD reporting and specification comparison. Unrounded results agree when they match to 9 significant figures; reported results and conformance must match exactly.</p>
      <p>The run is done by three automated accounts (Verification analyst, witness and reviewer). They have no password, cannot sign in, and get bench or review rights only at this lab and only while the run goes on; their signatures say "Automated verification run". They go through the same database rules as the bench and review screens. QC readings are set at run time so each QC meets its criteria (the recovery from the standard or spike recorded). The samples are on an internal order and their batches are verification batches, kept out of the lab's lists, the backlog and inventory stock.</p>
      <p>A check is <b>Pass</b> when the system matches the protocol, <b>Fail</b> when it does not, and <b>Not tested</b> when the run could not reach it (with the reason). A requirement passes when all its checks pass. One failed check fails the verification; requirements not tested must each be justified by QA when signing, and the outcome is then "Pass with exceptions".</p>

      <h2>3. User requirements (URS)</h2>
      ${reqTable(urs, checksOf, false)}
      <h2>4. Functional requirements (FRS)</h2>
      ${reqTable(frs, checksOf, true)}

      <h2>5. Samples and inputs (decided in the protocol)</h2>
      <table class="vt"><thead><tr><th>Sample</th><th>Code</th><th>Case</th><th>Specification put on it</th></tr></thead><tbody>
      ${samples.map((s) => `<tr><td><b>${esc(s.key)}</b></td><td>${esc(codeOf(s.key))}</td><td>${esc(s.case)}</td><td>${(s.specs || []).map((sp) => `${esc(analyteName(w, sp.analyte_id))}: ${sp.text ? esc(sp.text) : `${sp.min !== null ? '≥ ' + esc(sp.min) : ''}${sp.min !== null && sp.max !== null ? ' and ' : ''}${sp.max !== null ? '≤ ' + esc(sp.max) : ''}`}${sp.unit ? ' ' + esc(sp.unit) : ''}`).join('; ') || 'none'}</td></tr>`).join('')}
      </tbody></table>
      ${inputsTables(w, plan, samples)}

      <h2>6. Checks</h2>
      ${['Process', 'QC', ...[...new Set(samples.map((s) => s.case))]].map((cl) => {
        const rows = d.checks.filter((c) => c.case_label === cl); if (!rows.length) return '';
        return `<h3>${esc(cl === 'Process' ? 'The workflow and its controls' : cl === 'QC' ? 'Quality control' : `Results: ${cl}`)}</h3>
        <table class="vt"><thead><tr><th style="width:52px">Check</th><th>What is checked, and how</th><th style="width:96px">Requirements</th><th>Expected (protocol)</th><th>Actual (system)</th><th style="width:70px">Result</th></tr></thead><tbody>
        ${rows.map((c) => `<tr><td><b>${esc(c.check_code)}</b></td><td><b>${esc(c.title)}</b><br><span class="d">${esc(c.procedure_text || '')}</span>${inputsOf(c)}</td>
          <td>${(c.requirement_codes || []).map(esc).join(', ')}</td><td>${esc(text(c.expected))}</td>
          <td>${esc(text(c.actual))}${c.note ? `<br><i>${esc(c.note)}</i>` : ''}${evOf(c.check_code).length ? `<br>${evOf(c.check_code).map((e) => `<a href="#vev-${e.seq}" class="vevlink" data-seq="${e.seq}">${evName(e.seq)}</a>`).join(', ')}` : ''}${c.evidence_ref ? ` <a class="noprint d" href="${esc(c.evidence_ref)}">(open the page)</a>` : ''}</td>
          <td class="${resCls(c.result)}">${esc(c.result || '')}</td></tr>`).join('')}
        </tbody></table>`;
      }).join('')}

      <h2>7. Traceability</h2>
      <table class="vt"><thead><tr><th>Requirement</th><th>Checks</th><th>Result</th></tr></thead><tbody>
      ${d.requirements.map((r) => `<tr><td><b>${esc(r.req_code)}</b>${r.traces && r.traces.length ? ' (' + r.traces.map(esc).join(', ') + ')' : ''}</td><td>${checksOf(r.req_code).join(', ') || '<i>none</i>'}</td><td class="${resCls(r.result)}">${esc(r.result || '')}${r.result_note ? ` <span class="d">(${esc(r.result_note)})</span>` : ''}</td></tr>`).join('')}
      </tbody></table>

      <h2>8. Execution</h2>
      ${w.executed_at ? `<p>Executed ${esc(dt(w.executed_at))} by ${esc(S.executed ? S.executed.full_name : '')}; finished ${esc(dt(w.finished_at))}. ${d.checks.filter((c) => c.result === 'Pass').length} of ${d.checks.length} checks passed, ${failed.length} failed, ${untested.length} not tested.</p>
        <table class="vt vlog"><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>
        ${(w.run_log || []).map((l) => `<tr><td>${esc(new Date(l.at).toLocaleTimeString())}</td><td>${esc({ executor: 'Executed by', analyst: 'Verification analyst', reviewer: 'Verification reviewer', witness: 'Verification witness' }[l.who] || l.who)}</td><td>${esc(l.action)}${l.detail ? `<br><span class="d">${esc(l.detail)}</span>` : ''}</td></tr>`).join('')}
        </tbody></table>` : '<p>Not executed yet.</p>'}

      <h3>Objective evidence</h3>
      ${hasEv ? `<p>${d.evidence.length} screenshot${d.evidence.length === 1 ? '' : 's'} captured ${esc(dt(w.evidence_captured_at))} by ${esc(S.evidence ? S.evidence.full_name : '')}, in a headless browser signed in as that person. Each image is stored unchanged with its SHA-256; click one to open it full size.</p>
        ${w.evidence_note ? `<div class="vwarn">${esc(w.evidence_note)}</div>` : ''}
        <div class="vev">${d.evidence.map((e) => `<figure id="vev-${e.seq}"><a href="${evImg(e)}" target="_blank" rel="noopener"><img loading="lazy" src="${evImg(e)}" alt="${esc(evName(e.seq) + ' ' + e.title)}"></a>
          <figcaption><b>${esc(evName(e.seq))}</b> ${esc(e.title)}<br><span class="d">Checks ${esc((e.check_codes || []).join(', ') || 'none')}</span><br><code>${esc(e.sha256)}</code></figcaption></figure>`).join('')}</div>`
        : d.capturing ? '<p>Being captured now.</p>' : w.executed_at ? '<p>Not captured yet.</p>' : '<p>Not executed yet.</p>'}

      <h2>9. Deviations and requirements not tested</h2>
      ${w.executed_at ? (failed.length || untested.length ? `<table class="vt"><thead><tr><th>Check</th><th>Result</th><th>Why</th></tr></thead><tbody>
        ${[...failed, ...untested].map((c) => `<tr><td><b>${esc(c.check_code)}</b> ${esc(c.title)}</td><td class="${resCls(c.result)}">${esc(c.result)}</td><td>${esc(c.note || text(c.actual))}</td></tr>`).join('')}</tbody></table>` : '<p>None: every check passed.</p>')
        + (reqNt.length ? `<h3>Requirements not tested, and QA's justification</h3><table class="vt"><thead><tr><th>Requirement</th><th>QA justification</th></tr></thead><tbody>
          ${reqNt.map((r) => `<tr><td><b>${esc(r.req_code)}</b> ${esc(r.statement)}</td><td>${esc(r.qa_justification || (w.status === 'Executed' ? 'Waiting for QA' : ''))}</td></tr>`).join('')}</tbody></table>` : '')
        : '<p>Not executed yet.</p>'}

      <h2>10. Conclusion</h2>
      ${w.status === 'Report signed' ? `<p><b>${esc(w.outcome)}.</b> ${esc(w.report_conclusion)}</p><p class="d">Signed by ${esc(S.report ? S.report.full_name : '')} (QA), ${esc(dt(w.report_signed_at))}.</p>`
        : w.status === 'Cancelled' ? `<p>Cancelled: ${esc(w.cancelled_reason || '')}</p>` : '<p>Waiting for the run and QA\'s signature.</p>'}
      ${reqF.length && w.status !== 'Cancelled' ? `<div class="vwarn">${reqF.length} requirement${reqF.length > 1 ? 's' : ''} failed: the version cannot be approved on this verification. Fix the design (or the system) and write a new protocol.</div>` : ''}
    </div>`;

  const q = (s) => main.querySelector(s);
  const reload = () => page(main, id);
  if (d.capturing) { // refresh while the server captures, as long as this page is still open
    const here = location.hash;
    setTimeout(() => { if (location.hash === here && main.isConnected && main.querySelector('.vdoc')) reload().catch(() => {}); }, 3000);
  }
  if (q('#vprint')) q('#vprint').onclick = () => window.print();
  main.querySelectorAll('.vevlink').forEach((a) => { a.onclick = (e) => { e.preventDefault(); const f = q('#vev-' + a.dataset.seq); if (f) f.scrollIntoView({ behavior: 'smooth', block: 'center' }); }; });
  if (q('#vapprove')) q('#vapprove').onclick = () => signDialog({ what: `Verification protocol ${w.verification_code} (${w.test_name} version ${w.version_no})`, meaning: 'Approved by', needReason: false,
    submit: async ({ signature }) => { await api(`/verification/${w.id}/approve-protocol`, { method: 'POST', body: { signature } }); } })
    .then((ok) => { if (ok) { toast('Protocol approved. It can now be executed.'); reload(); } });
  if (q('#vexec')) q('#vexec').onclick = () => signDialog({ what: `Run ${w.verification_code}: automated samples through ${w.test_name} version ${w.version_no}`, meaning: 'Executed by', needReason: false,
    submit: async ({ signature }) => api(`/verification/${w.id}/execute`, { method: 'POST', body: { signature } }) })
    .then((r) => { if (r) { toast(`Run finished: ${r.outcome}. The screenshots of its pages are being captured.`); reload(); } });
  if (q('#vcapture')) q('#vcapture').onclick = () => signDialog({ what: `Screenshots of the pages of ${w.verification_code} (about a minute)`, meaning: 'Evidence captured by', needReason: false,
    submit: async ({ signature }) => api(`/verification/${w.id}/capture-evidence`, { method: 'POST', body: { signature } }) })
    .then((r) => { if (r) { toast(`${r.pages} screenshots captured.`); reload(); } });
  if (q('#vsign')) q('#vsign').onclick = async () => {
    const v = await modal({ title: `Sign the report of ${w.verification_code}`, okText: 'Continue to sign', wide: true,
      intro: `Outcome: <b>${esc(w.outcome)}</b>. ${reqF.length ? 'Failed requirements stop the version\'s approval whatever is written here.' : ''}${reqNt.length ? ' Write why each requirement not tested is acceptable.' : ''}`,
      fields: [{ name: 'conclusion', label: 'Conclusion', type: 'textarea', required: true,
        value: w.outcome === 'Pass' ? 'Every requirement passed: the workflow runs as designed.' : w.outcome === 'Fail' ? 'The verification failed: the version is not fit for approval as designed.' : 'The workflow runs as designed, except the requirements not tested (justified below).' },
      ...reqNt.map((r) => ({ name: 'j_' + r.req_code, label: `${r.req_code} not tested: why it is acceptable`, type: 'textarea', required: true, help: r.statement + (r.result_note ? ' (' + r.result_note + ')' : '') }))] });
    if (!v) return;
    const justifications = Object.fromEntries(reqNt.map((r) => [r.req_code, v['j_' + r.req_code]]));
    const ok = await signDialog({ what: `Verification report ${w.verification_code}: ${w.outcome}`, meaning: 'Approved by', needReason: false,
      submit: async ({ signature }) => { await api(`/verification/${w.id}/sign-report`, { method: 'POST', body: { signature, conclusion: v.conclusion, justifications } }); } });
    if (ok) { toast('Report signed.'); reload(); }
  };
  if (q('#vcancel')) q('#vcancel').onclick = () => signDialog({ what: `Cancel ${w.verification_code}`, meaning: 'Cancelled by', needReason: true,
    submit: async ({ signature, reason }) => { await api(`/verification/${w.id}/cancel`, { method: 'POST', body: { signature, reason } }); } })
    .then((ok) => { if (ok) { toast('Verification cancelled.'); reload(); } });
}

function analyteName(w, id) { return ((w.definition && w.definition.analytes) || []).find((a) => a.analyte_id === id)?.analyte_name || 'Analyte'; }
function reqTable(rows, checksOf, frs) {
  if (!rows.length) return '<p>None.</p>';
  return `<table class="vt"><thead><tr><th style="width:62px">Code</th><th>Requirement</th>${frs ? '<th style="width:90px">Serves</th>' : ''}<th style="width:170px">Source</th><th style="width:110px">Checks</th><th style="width:80px">Result</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td><b>${esc(r.req_code)}</b></td><td>${esc(r.statement)}</td>${frs ? `<td>${(r.traces || []).map(esc).join(', ')}</td>` : ''}<td>${esc(r.source || '')}</td>
      <td>${checksOf(r.req_code).join(', ') || '<i>none</i>'}</td><td class="${resCls(r.result)}">${esc(r.result || '')}</td></tr>`).join('')}</tbody></table>`;
}
function inputsOf(c) {
  const i = c.inputs || {};
  if (i.kind === 'calc' && i.formula) return `<br><code>${esc(i.formula)}</code> with ${Object.entries(i.tokens || {}).map(([k, v]) => `{${esc(k)}} = ${esc(v)}`).join(', ')}`;
  if (i.kind === 'result' && i.readings) { const r = Object.entries(i.readings).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(', '); return r ? `<br><span class="d">Readings: ${r}</span>` : ''; }
  return '';
}
function inputsTables(w, plan, samples) {
  const steps = ((w.definition && w.definition.steps) || []);
  const out = [];
  for (const s of steps) {
    const k = s.step_key;
    if (s.step_type === 'Weighing') out.push([s.step_name, samples.map((x) => `${x.key}: ${x.inputs.weigh[k]} ${s.config.unit || 'g'}`).join('; ') + ' (prep QC as S1)']);
    if (s.step_type === 'Dilution') out.push([s.step_name, samples.map((x) => `${x.key}: ${(x.inputs.dil[k] || []).map((f) => `${f.aliquot} + ${f.diluent}`).join(', ')}`).join('; ')]);
    if (s.step_type === 'Preparation') out.push([s.step_name, Object.entries((plan.batch.prep || {})[k] || {}).map(([f, v]) => `${f} = ${v}`).join(', ') || 'no fields']);
    if (s.step_type === 'Incubation') { const i = (plan.batch.inc || {})[k] || {}; out.push([s.step_name, `${i.duration} ${i.unit} at ${i.temperature ?? 'the target'} °C, one load for the batch`]); }
    if (s.step_type === 'Plating/Inoculation') out.push([s.step_name, samples.map((x) => `${x.key}: ${x.inputs.plates[k]} plate(s)`).join('; ') + '; a usable media lot']);
    if (s.step_type === 'Data Entry') out.push([s.step_name, samples.map((x) => `${x.key}: ${Object.entries(x.inputs.read[k] || {}).map(([a, v]) => `${analyteName(w, a)} ${v}`).join(', ')}`).join('; ') + '; QC readings set at run time to meet their criteria']);
  }
  if (!out.length) return '';
  return `<table class="vt"><thead><tr><th style="width:220px">Step</th><th>Values the run enters</th></tr></thead><tbody>${out.map(([a, b]) => `<tr><td><b>${esc(a)}</b></td><td>${esc(b)}</td></tr>`).join('')}</tbody></table>`;
}

// The card on a version's Review tab: the verifications of this version and the gate
export async function versionCard(host, versionId, versionStatus) {
  let d;
  try { d = await api('/verification/versions/' + versionId); } catch (e) { host.innerHTML = `<div class="err">${esc(e.message)}</div>`; return null; }
  const draft = versionStatus === 'Draft';
  host.innerHTML = `<p>${d.required ? `<b>${esc(d.version.site_code)} requires a passing workflow verification</b> of exactly this design before the version is approved.` : 'This lab does not require a workflow verification before approval (a lab setting); one can still be run.'}
      ${d.passing ? ' <b>A signed, passing verification covers the current design.</b>' : ''}</p>
    <p class="help">The protocol is written for you from the design: the requirements, automated samples (typical, below the LOQ, outside the specification), the values to enter and the expected results from an independent calculation. QA approves it, you execute it (an automated run through every step), and QA signs the report.</p>
    ${d.rows.length ? `<table class="vt"><thead><tr><th>Verification</th><th>Status</th><th>Outcome</th><th>Checks passed</th><th>Prepared</th><th>Design</th></tr></thead><tbody>
      ${d.rows.map((r) => `<tr><td>${link('#/verification/' + r.id, r.verification_code)}</td><td>${badge(r.status)}</td><td>${outcomeChip(r.outcome)}</td><td>${r.status === 'Report signed' || r.status === 'Executed' ? `${r.passed} of ${r.checks}` : `${r.checks} checks`}</td>
        <td>${esc(r.prepared_by_name)}, ${esc(dt(r.created_at))}</td><td>${r.current ? 'Current' : '<b>Changed since</b>'}</td></tr>`).join('')}</tbody></table>` : ''}
    ${draft && d.can_design ? '<button class="btn" id="vnew">Write the verification protocol</button>' : draft ? '<div class="help">Writing the protocol needs methods.design in this lab.</div>' : ''}`;
  const b = host.querySelector('#vnew');
  if (b) b.onclick = () => signDialog({ what: `Workflow verification protocol for this version (earlier unsigned ones are cancelled)`, meaning: 'Prepared by', needReason: false,
    submit: async ({ signature }) => api(`/verification/versions/${versionId}/protocol`, { method: 'POST', body: { signature } }) })
    .then((r) => { if (r && r.id) { toast('Protocol written. QA approves it next.'); location.hash = '#/verification/' + r.id; } });
  return d;
}
