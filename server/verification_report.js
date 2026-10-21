// The workflow verification protocol and report as a Word document (WD-6.1): the same content as the page
// (#/verification/<id>), with the evidence screenshots in an appendix. Built on request, nothing stored.
'use strict';
const { docx } = require('./docx');

const dt = (v) => (v ? new Date(v).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const txt = (x) => (x === null || x === undefined ? '' : typeof x === 'object' ? (x.text ?? JSON.stringify(x)) : String(x));
const COLOR = { Pass: '1E7A4A', Fail: 'B42318', 'Not tested': '9A6700' };
const res = (r) => ({ text: r || '', bold: true, color: COLOR[r] || undefined });

function build(d, evidence) {
  const w = d.verification; const S = d.signatures; const plan = w.plan || {}; const samples = plan.samples || [];
  const an = (id) => ((w.definition && w.definition.analytes) || []).find((a) => a.analyte_id === id)?.analyte_name || 'Analyte';
  const checksOf = (code) => d.checks.filter((c) => (c.requirement_codes || []).includes(code)).map((c) => c.check_code).join(', ');
  const evOf = (code) => evidence.filter((e) => (e.check_codes || []).includes(code)).map((e) => 'E-' + String(e.seq).padStart(2, '0')).join(', ');
  const codeOf = (key) => (d.samples.find((s) => s.client_sample_id === key) || {}).sample_code || '';
  const D = docx();

  D.title(`Workflow verification ${w.verification_code}`, `${w.test_code} ${w.test_name}, version ${w.version_no} · ${w.site_code} ${w.site_name || ''} · Protocol and report`);
  D.table([
    ['Item', 'Value'],
    ['Status', `${w.status}${w.outcome ? ' · Outcome: ' + w.outcome : ''}`],
    ['Test', `${w.test_code} ${w.test_name}, version ${w.version_no} (${w.version_status})`],
    ['Method', `${w.method_name || 'none'}${w.sop_code ? ' (' + w.sop_code + ')' : ''}`],
    ['Design fingerprint', [{ text: w.config_hash, mono: true }, { text: w.current ? '  (matches the version)' : '  (the version has changed since)' }]],
    ['Protocol written by', w.generator],
    ['Verification order', d.order ? `${d.order.order_code} (${d.order.status}), internal; samples ${d.samples.map((s) => s.sample_code).join(', ')}` : 'Not executed yet'],
    ['Batches', d.batches.map((b) => `${b.batch_code} (${b.status})`).join(', ') || 'None yet'],
    ['Evidence', w.evidence_captured_at ? `${evidence.length} screenshots captured ${dt(w.evidence_captured_at)}${w.evidence_note ? '; ' + w.evidence_note : ''}` : 'Not captured yet'],
  ], { widths: [0.2, 0.8], size: 9 });
  const sig = (s) => (s ? `${s.full_name}\n${dt(s.signed_at)}\n${s.method}` : '');
  D.table([
    ['Prepared by', 'Protocol approved by (QA)', 'Executed by', 'Evidence captured by', 'Report approved by (QA)'],
    [sig(S.prepared) || w.prepared_by_name || '', sig(S.approved) || 'Waiting for QA', sig(S.executed) || 'Not executed', sig(S.evidence) || 'Not captured', sig(S.report) || 'Not signed'],
  ], { size: 9 });

  D.h1('1. Purpose and scope');
  D.p(`This verification shows that version ${w.version_no} of ${w.test_name}, as designed in the Workflow Designer, runs as intended in LIMS3 before it is approved: automated samples go through every step of the workflow, the results the system calculates and stores are compared with a second, independent calculation, and the workflow's controls (missing data, signatures, review by someone else, QC, specifications) are challenged.`);
  D.p('It verifies the configured workflow. It is not a validation of the analytical method (method validation is separate), and not the validation of LIMS3 itself (computer system validation is separate).');
  D.h1('2. Approach');
  D.p('The protocol (requirements, samples, every value the run enters, and the expected results) is written before the run, from the version\'s design, and approved by QA. The expected results come from an independent calculation in the server: its own formula reader, exact decimal arithmetic, rounding, LOQ and LOD reporting and specification comparison. Unrounded results agree when they match to 9 significant figures; reported results and conformance must match exactly.');
  D.p('The run is done by three automated accounts (Verification analyst, witness and reviewer). They have no password, cannot sign in, and get bench or review rights only at this lab and only while the run goes on; their signatures say "Automated verification run". They go through the same database rules as the bench and review screens. QC readings are set at run time so each QC meets its criteria. The samples are on an internal order and their batches are verification batches, kept out of the lab\'s lists, the backlog and inventory stock.');
  D.p('After the run, the server opens every page the checks point to in a headless browser, as the person who captured the evidence, and keeps a full-page screenshot of each, stamped with the verification, the evidence number, the page, the time and the person, stored unchanged with its SHA-256 (Appendix A).');
  D.p('A check is Pass when the system matches the protocol, Fail when it does not, and Not tested when the run could not reach it (with the reason). A requirement passes when all its checks pass. One failed check fails the verification; requirements not tested must each be justified by QA, and the outcome is then "Pass with exceptions".');

  const reqRows = (kind) => [['Code', 'Requirement', ...(kind === 'FRS' ? ['Serves'] : []), 'Source', 'Checks', 'Result'],
    ...d.requirements.filter((r) => r.kind === kind).map((r) => [{ text: r.req_code, bold: true }, r.statement, ...(kind === 'FRS' ? [(r.traces || []).join(', ')] : []), r.source || '', checksOf(r.req_code) || 'none', res(r.result)])];
  D.h1('3. User requirements (URS)');
  D.table(reqRows('URS'), { widths: [0.06, 0.56, 0.18, 0.12, 0.08] });
  D.h1('4. Functional requirements (FRS)');
  D.table(reqRows('FRS'), { widths: [0.06, 0.5, 0.08, 0.16, 0.12, 0.08] });

  D.h1('5. Samples and inputs (decided in the protocol)');
  D.table([['Sample', 'Code', 'Case', 'Specification put on it'],
    ...samples.map((s) => [{ text: s.key, bold: true }, codeOf(s.key), s.case, (s.specs || []).map((sp) => `${an(sp.analyte_id)}: ${sp.text ? sp.text : `${sp.min !== null ? '>= ' + sp.min : ''}${sp.min !== null && sp.max !== null ? ' and ' : ''}${sp.max !== null ? '<= ' + sp.max : ''}`}${sp.unit ? ' ' + sp.unit : ''}`).join('; ') || 'none'])],
  { widths: [0.08, 0.14, 0.18, 0.6] });
  const inRows = [['Step', 'Values the run enters']];
  for (const s of (w.definition && w.definition.steps) || []) {
    const k = s.step_key; const c = s.config || {};
    if (s.step_type === 'Weighing') inRows.push([s.step_name, samples.map((x) => `${x.key}: ${x.inputs.weigh[k]} ${c.unit || 'g'}`).join('; ') + ' (prep QC as S1)']);
    if (s.step_type === 'Dilution') inRows.push([s.step_name, samples.map((x) => `${x.key}: ${(x.inputs.dil[k] || []).map((f) => `${f.aliquot} + ${f.diluent}`).join(', ')}`).join('; ')]);
    if (s.step_type === 'Preparation') inRows.push([s.step_name, Object.entries(((plan.batch || {}).prep || {})[k] || {}).map(([f, v]) => `${f} = ${v}`).join(', ') || 'no fields']);
    if (s.step_type === 'Incubation') { const i = ((plan.batch || {}).inc || {})[k] || {}; inRows.push([s.step_name, `${i.duration} ${i.unit} at ${i.temperature ?? 'the target'} °C, one load for the batch`]); }
    if (s.step_type === 'Plating/Inoculation') inRows.push([s.step_name, samples.map((x) => `${x.key}: ${x.inputs.plates[k]} plate(s)`).join('; ') + '; a usable media lot']);
    if (s.step_type === 'Data Entry') inRows.push([s.step_name, samples.map((x) => `${x.key}: ${Object.entries(x.inputs.read[k] || {}).map(([a, v]) => `${an(a)} ${v}`).join(', ')}`).join('; ') + '; QC readings set at run time to meet their criteria']);
  }
  if (inRows.length > 1) D.table(inRows, { widths: [0.2, 0.8] });

  D.h1('6. Checks');
  const cases = ['Process', 'QC', ...new Set(samples.map((s) => s.case))];
  for (const cl of cases) {
    const rows = d.checks.filter((c) => c.case_label === cl); if (!rows.length) continue;
    D.h2(cl === 'Process' ? 'The workflow and its controls' : cl === 'QC' ? 'Quality control' : `Results: ${cl}`);
    D.table([['Check', 'What is checked, and how', 'Requirements', 'Expected (protocol)', 'Actual (system)', 'Evidence', 'Result'],
      ...rows.map((c) => [{ text: c.check_code, bold: true }, [{ text: c.title, bold: true }, { text: '\n' + (c.procedure_text || '') }], (c.requirement_codes || []).join(', '),
        txt(c.expected), [{ text: txt(c.actual) }, ...(c.note ? [{ text: '\n' + c.note, italic: true }] : [])], evOf(c.check_code), res(c.result)])],
    { widths: [0.05, 0.27, 0.08, 0.2, 0.26, 0.07, 0.07], size: 7.5 });
  }

  D.h1('7. Traceability');
  D.table([['Requirement', 'Checks', 'Evidence', 'Result'],
    ...d.requirements.map((r) => [{ text: r.req_code + (r.traces && r.traces.length ? ` (${r.traces.join(', ')})` : ''), bold: true }, checksOf(r.req_code) || 'none',
      [...new Set(d.checks.filter((c) => (c.requirement_codes || []).includes(r.req_code)).flatMap((c) => evOf(c.check_code).split(', ').filter(Boolean)))].join(', '),
      [res(r.result), { text: r.result_note ? ` (${r.result_note})` : '' }]])],
  { widths: [0.14, 0.4, 0.3, 0.16] });

  D.h1('8. Execution');
  if (w.executed_at) {
    const n = (r) => d.checks.filter((c) => c.result === r).length;
    D.p(`Executed ${dt(w.executed_at)} by ${S.executed ? S.executed.full_name : ''}; finished ${dt(w.finished_at)}. ${n('Pass')} of ${d.checks.length} checks passed, ${n('Fail')} failed, ${n('Not tested')} not tested.`);
    const who = { executor: 'Executed by', analyst: 'Verification analyst', reviewer: 'Verification reviewer', witness: 'Verification witness' };
    D.table([['When', 'Who', 'What'], ...(w.run_log || []).map((l) => [new Date(l.at).toLocaleTimeString('en-US'), who[l.who] || l.who, l.action + (l.detail ? '\n' + l.detail : '')])],
      { widths: [0.1, 0.15, 0.75], size: 7.5 });
  } else D.p('Not executed yet.');

  D.h1('9. Deviations and requirements not tested');
  const bad = d.checks.filter((c) => c.result === 'Fail' || c.result === 'Not tested');
  if (!w.executed_at) D.p('Not executed yet.');
  else if (!bad.length) D.p('None: every check passed.');
  else D.table([['Check', 'Result', 'Why'], ...bad.map((c) => [`${c.check_code} ${c.title}`, res(c.result), c.note || txt(c.actual)])], { widths: [0.4, 0.1, 0.5] });
  const nt = d.requirements.filter((r) => r.result === 'Not tested');
  if (nt.length) D.table([['Requirement not tested', 'QA justification'], ...nt.map((r) => [`${r.req_code} ${r.statement}`, r.qa_justification || 'Waiting for QA'])], { widths: [0.55, 0.45] });

  D.h1('10. Conclusion');
  if (w.status === 'Report signed') D.p([{ text: `${w.outcome}. `, bold: true }, { text: w.report_conclusion || '' }]).p(`Signed by ${S.report ? S.report.full_name : ''} (QA), ${dt(w.report_signed_at)}.`);
  else if (w.status === 'Cancelled') D.p(`Cancelled: ${w.cancelled_reason || ''}`);
  else D.p('Waiting for the run, the evidence and QA\'s signature.');

  if (evidence.length) {
    D.h1('Appendix A. Objective evidence (screenshots)', { newPage: true });
    D.p(`Captured ${dt(w.evidence_captured_at)} by ${S.evidence ? S.evidence.full_name : ''}, in a headless browser signed in as that person. Each image is stored unchanged; its SHA-256 is printed under it.`);
    for (const e of evidence) {
      D.h2(`E-${String(e.seq).padStart(2, '0')}. ${e.title}`, { newPage: e !== evidence[0] });
      D.p([{ text: `Page ${e.page_ref} · captured ${dt(e.captured_at)} · checks ${(e.check_codes || []).join(', ') || 'none'}`, size: 8, color: '5C6773' }], { spaceAfter: 40 });
      D.image(e.png, { width: e.width_px, height: e.height_px, maxH: 5.7 });
      D.p([{ text: 'SHA-256 ', size: 7.5, color: '5C6773' }, { text: e.sha256, size: 7.5, mono: true, color: '5C6773' }], { align: 'center' });
    }
  }
  return D.build({ footer: `${w.verification_code} · ${w.test_code} ${w.test_name} v${w.version_no} · Workflow verification protocol and report · Sandbox (not validated)`, author: 'LIMS3' });
}

module.exports = { build };
