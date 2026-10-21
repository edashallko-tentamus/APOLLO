// Training and competency (0.31.0, migration 053): the lab's people and their qualifications, competency attempts
// (initial and continuing; training samples or a record), the rules per department, legacy qualifications, the
// training report per person.
import { api, esc, pageHeader, toast, modal, state, signDialog, link, badge } from '../app.js';
import { Grid } from '../grid.js';
import { section, editableGrid } from './common.js';

const d8 = (v) => (v ? new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '');
const site = () => encodeURIComponent(state.site || '');
const stateCls = (s) => (s === 'Lapsed' ? 'cbad' : s === 'Due soon' ? 'cwarn' : s === 'Withdrawn' ? 'mutedcell' : '');
const readB64 = (file) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).replace(/^data:[^,]*,/, '')); fr.onerror = rej; fr.readAsDataURL(file); });

// ---------------------------------------------------------------- the lab's overview
export async function overview(main) {
  const d = await api('/training');
  if (!d.can.view && !d.can.record) { location.hash = '#/training/people/' + d.me; return; }
  const tab = ['people', 'competency', 'rules'].includes(state.query.get('tab')) ? state.query.get('tab') : 'people';
  const toEval = d.attempts.filter((a) => a.status === 'In progress').length; const toApprove = d.attempts.filter((a) => a.status === 'Evaluated').length;
  main.innerHTML = pageHeader('Training and competency', `Who is qualified for which tests at ${esc(d.lab.site_code)}, their initial and continuing competency, and the lab's rules. ${d.lab.require_training
    ? '<b>This lab requires training:</b> bench steps are signed only by people with a current qualification for the test (or department trained, where the rule allows).'
    : 'This lab does not require training at the bench yet (a system administrator switches it on: Sites and holidays, "Training gate"). Grant the legacy qualifications first.'}`,
    `${d.can.approve ? '<button class="btn" id="legacy">Grant legacy qualifications…</button>' : ''} <a class="btn" href="#/training/people/${d.me}">My training</a>`, { kind: 'training' })
    + `<div class="tabs">${[['people', `People (${d.people.length})`], ['competency', `Competency (${toEval} to evaluate, ${toApprove} to approve)`], ['rules', 'Rules']]
      .map(([k, l]) => `<a class="tab ${k === tab ? 'on' : ''}" href="#/training?tab=${k}" style="text-decoration:none">${esc(l)}</a>`).join('')}</div><div class="card" id="tc"></div>`;
  const el = main.querySelector('#tc');
  if (tab === 'people') {
    el.innerHTML = section('People', 'Everyone in a group at this lab. Open a person for their qualifications, competency, the work they did and their training report.') + '<div id="pg"></div>';
    new Grid(el.querySelector('#pg'), { readOnly: true, rows: d.people, search: true, columns: [
      { field: 'full_name', title: 'Person', type: 'link', width: 220, href: (r) => '#/training/people/' + r.id },
      { field: 'current', title: 'Qualified tests', type: 'readonly', width: 110 },
      { field: 'due_soon', title: 'Competency due soon', type: 'readonly', width: 140, cellClass: (r) => (r.due_soon ? 'cwarn' : '') },
      { field: 'lapsed', title: 'Lapsed', type: 'readonly', width: 80, cellClass: (r) => (r.lapsed ? 'cbad' : '') },
      { field: 'open_attempts', title: 'Open competency', type: 'readonly', width: 120 },
      { field: 'departments_trained', title: 'Department trained', type: 'readonly', width: 220 },
      { field: 'last_competency', title: 'Last competency', type: 'readonly', width: 130, format: d8 },
    ] });
  } else if (tab === 'competency') {
    el.innerHTML = section('Competency', 'Open attempts (to evaluate by a trainer, then to approve by QA) and those decided in the last 60 days. Open one to evaluate or approve it.') + '<div id="ag"></div>';
    new Grid(el.querySelector('#ag'), { readOnly: true, rows: d.attempts, search: true, columns: attemptCols(true) });
  } else {
    const deptOpts = d.departments.map((x) => ({ value: x.id, label: x.department_name }));
    const rows = d.rules.map((r) => ({ ...r, dept: r.department_id || '' }));
    // each department sets its own rule (Alex, 2026-10-20; migration 055); a new department starts from the lab's
    el.innerHTML = section('Rules', 'Each department sets its own rule. Department trained: after this many different tests of the department with a current qualification; what it allows. Continuing competency: a competency sample every N months (Due soon N days before); optionally at least N runs in M months, or the qualification lapses. "Tests with no department" covers tests not assigned to a department, and is where a new department\'s rule starts from.') + '<div id="rg"></div>';
    editableGrid({ el: el.querySelector('#rg'), rows, allowAdd: false, readOnly: !d.can.configure, what: 'the training rules',
      newRow: () => ({ dept: '', dept_trained_after: 4, unlock_any_test: true, unlock_can_train: true, continuing_months: 12, due_soon_days: 30, allow_training_samples: true, allow_records: true }),
      columns: [
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
      ],
      save: (changed, reason) => api('/training/rules', { method: 'POST', body: { reason, rows: changed.map((r) => { const o = { ...r }; if (!r.id) o.department_id = r.dept || null; delete o.dept; return o; }) } }),
      afterSave: () => overview(main) });
  }
  const leg = main.querySelector('#legacy');
  if (leg) leg.onclick = async () => {
    const r = await signDialog({ title: 'Grant legacy qualifications', what: `legacy qualifications at ${d.lab.site_code}: everyone who signed a bench step of a test here in the last 12 months, for that test`, meaning: 'Approved by', needReason: false,
      submit: ({ signature }) => api('/training/legacy', { method: 'POST', body: { signature } }) });
    if (r) { toast(`${r.granted} legacy qualification${Number(r.granted) === 1 ? '' : 's'} granted.`); overview(main); }
  };
}

function attemptCols(withPerson) {
  return [
    { field: 'attempt_code', title: 'Attempt', type: 'link', width: 100, href: (r) => '#/training/attempts/' + r.id },
    ...(withPerson ? [{ field: 'full_name', title: 'Person', type: 'link', width: 170, href: (r) => '#/training/people/' + r.user_id }] : []),
    { field: 'test_name', title: 'Test', type: 'readonly', width: 220 },
    { field: 'kind', title: 'Kind', type: 'readonly', width: 95 },
    { field: 'route', title: 'How', type: 'readonly', width: 125 },
    { field: 'status', title: 'Status', type: 'readonly', width: 110, cellClass: (r) => (r.status === 'Evaluated' ? 'cwarn' : '') },
    { field: 'evaluation', title: 'Evaluation', type: 'readonly', width: 120 },
    { field: 'evaluated_by_name', title: 'Evaluated by', type: 'readonly', width: 140 },
    { field: 'decided_by_name', title: 'QA', type: 'readonly', width: 140 },
    { field: 'created_at', title: 'Started', type: 'readonly', width: 110, format: d8 },
  ];
}

// ---------------------------------------------------------------- one person
export async function person(main, id) {
  const d = await api('/training/people/' + id);
  const p = d.person;
  main.innerHTML = pageHeader(`Training: ${p.full_name}`, `${esc(p.title || '')} Qualifications, competency (initial and continuing), departments and the work done. The training report prints all of it.`,
    `<a class="btn" href="/api/training/people/${p.id}/report.pdf?s=${site()}" target="_blank" rel="noopener" id="report">Training report (PDF)</a>
     ${d.can.record || d.tests.length ? '<button class="btn primary" id="start">Start competency…</button>' : ''}`, { kind: 'training_person', id })
    + `<div class="card">${section('Departments', 'Department trained: enough tests of the department with a current qualification (the department\'s rule says how many and what it allows).')}<div id="dg"></div></div>
    <div class="card">${section('Qualifications', 'A qualification lets the person sign the test\'s bench steps where the lab requires training. Lapsed: continuing competency overdue (or too few runs, where the rule asks for them).')}<div id="qg"></div></div>
    <div class="card">${section('Competency', 'Initial competency grants a qualification; continuing competency keeps it up.')}<div id="ag"></div></div>
    <div class="card">${section('Work done', 'The rolling counter: batches in which the person signed a bench step of each test (QC Review not counted).')}<div id="wg"></div></div>`;
  new Grid(main.querySelector('#dg'), { readOnly: true, rows: d.departments, columns: [
    { field: 'department_name', title: 'Department', type: 'readonly', width: 200 },
    { field: 'current_tests', title: 'Current qualifications', type: 'readonly', width: 150, format: (v, r) => `${v}${r.needed ? ' of ' + r.needed : ''}` },
    { field: 'trained', title: 'Department trained', type: 'readonly', width: 330, format: (v, r) => (v ? `Yes${r.unlock_any_test ? ': any test of the department' : ''}${r.unlock_can_train ? (r.unlock_any_test ? '; ' : ': ') + 'may train others' : ''}` : 'No') },
  ] });
  new Grid(main.querySelector('#qg'), { readOnly: true, rows: d.qualifications, emptyText: 'No qualifications yet.', rowClass: (r) => (r.status !== 'Active' ? 'mutedrow' : ''), columns: [
    { field: 'qualification_code', title: 'Qualification', type: 'readonly', width: 100 },
    { field: 'test_name', title: 'Test', type: 'readonly', width: 220 },
    { field: 'department_name', title: 'Department', type: 'readonly', width: 130 },
    { field: 'source', title: 'How', type: 'link', width: 170, format: (v, r) => `${v}${r.attempt_code ? ' ' + r.attempt_code : ''}`, href: (r) => (r.attempt_id ? '#/training/attempts/' + r.attempt_id : null) },
    { field: 'granted_at', title: 'Granted', type: 'readonly', width: 105, format: d8 },
    { field: 'last_competency_at', title: 'Last competency', type: 'readonly', width: 120, format: d8 },
    { field: 'due_on', title: 'Next due', type: 'readonly', width: 105, format: d8 },
    { field: 'runs_12m', title: 'Runs (12 mo / all)', type: 'readonly', width: 120, format: (v, r) => `${v} / ${r.runs_total}` },
    { field: 'state', title: 'State', type: 'readonly', width: 230, format: (v, r) => `${v}${r.why ? ': ' + r.why : ''}${r.conditions ? ' (conditional: ' + r.conditions + ')' : ''}`, cellClass: (r) => stateCls(r.state) },
    ...(d.can.approve ? [{ field: '_wd', title: '', type: 'button', width: 90, label: (r) => (r.status === 'Active' ? 'Withdraw…' : ''), onClick: (r) => withdrawQual(r, () => person(main, id)) }] : []),
  ] });
  new Grid(main.querySelector('#ag'), { readOnly: true, rows: d.attempts, emptyText: 'No competency recorded yet.', columns: attemptCols(false) });
  new Grid(main.querySelector('#wg'), { readOnly: true, rows: d.activity, emptyText: 'No bench work recorded.', columns: [
    { field: 'test_name', title: 'Test', type: 'readonly', width: 240 }, { field: 'department_name', title: 'Department', type: 'readonly', width: 140 },
    { field: 'runs_12m', title: 'Runs, last 12 months', type: 'readonly', width: 140 }, { field: 'runs_total', title: 'Runs, all', type: 'readonly', width: 90 },
    { field: 'last_at', title: 'Last run', type: 'readonly', width: 110, format: d8 },
  ] });
  const st = main.querySelector('#start');
  if (st) st.onclick = () => startDialog(d, (newId) => { location.hash = '#/training/attempts/' + newId; });
}

async function withdrawQual(q, done) {
  const v = await signDialog({ title: 'Withdraw the qualification', what: `${q.qualification_code}: ${q.full_name}, ${q.test_name}`, meaning: 'Withdrawn by', needReason: true,
    submit: ({ reason, signature }) => api(`/training/qualifications/${q.id}/withdraw`, { method: 'POST', body: { reason, signature } }) });
  if (v) { toast('Qualification withdrawn.'); done(); }
}

// Start a competency attempt: initial or continuing; a record (with evidence) or training samples (with known values)
function startDialog(d, done) {
  const qualified = new Set(d.qualifications.filter((q) => q.status === 'Active').map((q) => q.test_id));
  const m = document.createElement('div'); m.className = 'modal-bg';
  m.innerHTML = `<div class="modal wide"><h3>Start competency for ${esc(d.person.full_name)}</h3>
    <p class="intro">A trainer starts it; the trainer evaluates it; QA approves it. Initial competency grants a qualification; continuing competency keeps one up.</p>
    <div class="fields">
      <div class="field"><label for="f_test">Test <span class="req">*</span></label><select id="f_test"><option value=""></option>${d.tests.map((t) => `<option value="${t.id}">${esc(t.test_name)}${t.department_name ? ' (' + esc(t.department_name) + ')' : ''}${qualified.has(t.id) ? ': qualified' : ''}</option>`).join('')}</select></div>
      <div class="field"><label for="f_kind">Kind</label><select id="f_kind"><option>Initial</option><option>Continuing</option></select><div class="help" id="kindhelp"></div></div>
      <div class="field"><label for="f_route">How</label><select id="f_route"><option value="Record">Training record (done outside the LIMS, with evidence)</option><option value="Training samples">Training samples (run through the workflow, compared with known values)</option></select></div>
    </div>
    <div id="recbox"><div class="fields"><div class="field"><label for="f_desc">What was done <span class="req">*</span></label><textarea id="f_desc" rows="3" placeholder="SOP read, runs observed, supervised runs, results reviewed"></textarea></div>
      <div class="field"><label for="f_date">Date of the training <span class="req">*</span></label><input id="f_date" type="date"></div>
      <div class="field"><label for="f_ev">Evidence (signed form, certificate)</label><input id="f_ev" type="file" multiple></div></div></div>
    <div id="smpbox" style="display:none"><div class="fields"><div class="field"><label for="f_n">Training samples</label><input id="f_n" type="number" min="1" max="10" value="3"></div></div>
      <div class="help">Known values: the result each training sample should give, and how far from it is acceptable (±%). They become the samples' specification, so QC Review says whether each result is within it.</div><div id="kv"></div></div>
    <div class="merr" role="alert"></div>
    <div class="mbtns"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>Start</button></div></div>`;
  document.body.appendChild(m);
  const $ = (s) => m.querySelector(s); const err = (t) => { $('.merr').textContent = t; };
  let kvGrid = null;
  const sync = () => {
    const t = d.tests.find((x) => x.id === $('#f_test').value);
    $('#f_kind').value = t && qualified.has(t.id) ? 'Continuing' : 'Initial';
    $('#kindhelp').textContent = t ? (qualified.has(t.id) ? 'Qualified already: this keeps the qualification up.' : 'Not qualified yet: this is the initial competency.') : '';
    const smp = $('#f_route').value === 'Training samples';
    $('#recbox').style.display = smp ? 'none' : ''; $('#smpbox').style.display = smp ? '' : 'none';
    if (smp && t) {
      if (!t.version_id) { $('#kv').innerHTML = '<p class="bad">This test has no approved version: training samples need one.</p>'; kvGrid = null; return; }
      kvGrid = new Grid($('#kv'), { rows: (t.analytes || []).map((a) => ({ analyte_id: a.analyte_id, analyte: a.analyte, unit: a.unit || '', value: null, tolerance_pct: 10 })), columns: [
        { field: 'analyte', title: 'Analyte', type: 'readonly', width: 220 }, { field: 'unit', title: 'Unit', type: 'readonly', width: 80 },
        { field: 'value', title: 'Known value', type: 'number', width: 110 }, { field: 'tolerance_pct', title: '± %', type: 'number', min: 0, width: 80 }] });
    }
  };
  $('#f_test').onchange = sync; $('#f_route').onchange = sync; sync();
  $('[data-x]').onclick = () => m.remove();
  $('[data-ok]').onclick = async () => {
    const test = $('#f_test').value; if (!test) { err('Choose the test.'); return; }
    const route = $('#f_route').value;
    const body = { user_id: d.person.id, test_id: test, kind: $('#f_kind').value, route };
    if (route === 'Record') { body.description = $('#f_desc').value.trim(); body.trained_on = $('#f_date').value; if (!body.description || !body.trained_on) { err('Say what was done and when.'); return; } }
    else {
      if (!kvGrid) { err('Choose a test with an approved version.'); return; }
      body.samples = Number($('#f_n').value) || 1;
      body.known_values = kvGrid.rows.filter((r) => r.value !== null && r.value !== '' && r.value !== undefined).map((r) => ({ analyte_id: r.analyte_id, value: r.value, tolerance_pct: r.tolerance_pct }));
      if (!body.known_values.length) { err('Give the known value of at least one analyte.'); return; }
    }
    const ok = $('[data-ok]'); ok.disabled = true;
    try {
      const r = await api('/training/attempts', { method: 'POST', body });
      const files = route === 'Record' ? [...$('#f_ev').files] : [];
      if (files.length) {
        const documents = []; for (const f of files) documents.push({ file_name: f.name, mime_type: f.type || 'application/octet-stream', base64: await readB64(f), title: f.name });
        await api(`/training/attempts/${r.id}/evidence`, { method: 'POST', body: { documents } });
      }
      m.remove(); toast('Competency started.'); done(r.id);
    } catch (e) { ok.disabled = false; err(e.message); }
  };
}

// ---------------------------------------------------------------- one attempt
export async function attempt(main, id) {
  const d = await api('/training/attempts/' + id);
  const a = d.attempt;
  const open = a.status === 'In progress';
  main.innerHTML = pageHeader(`Competency ${a.attempt_code}`, `${link('#/training/people/' + a.user_id, a.full_name)}: ${esc(a.kind)} competency on ${esc(a.test_name)} ${badge(a.status)}`,
    `${open && d.can.evaluate ? '<button class="btn primary" id="eval">Evaluate…</button>' : ''}
     ${a.status === 'Evaluated' && d.can.approve && d.me !== a.user_id && d.me !== a.evaluated_by ? '<button class="btn primary" id="ok">Approve…</button> <button class="btn" id="rej">Reject…</button>' : ''}
     ${['In progress', 'Evaluated'].includes(a.status) && (d.can.evaluate || d.can.approve) ? '<button class="btn ghost" id="wd">Withdraw…</button>' : ''}`, { kind: 'competency', id })
    + `<div class="card meta3 wide"><div><span>How</span><b>${esc(a.route)}</b></div><div><span>Started by</span><b>${esc(a.started_by_name)}, ${esc(d8(a.created_at))}</b></div>
      <div><span>Evaluation</span><b>${esc(a.evaluation || 'Not yet')}${a.evaluated_by_name ? ` (${esc(a.evaluated_by_name)})` : ''}</b></div><div><span>QA</span><b>${esc(a.decided_by_name ? `${a.status} by ${a.decided_by_name}` : 'Not yet')}</b></div>
      ${a.evaluation_note ? `<div><span>Evaluator's note</span><b>${esc(a.evaluation_note)}</b></div>` : ''}${a.decision_note ? `<div><span>QA's note</span><b>${esc(a.decision_note)}</b></div>` : ''}
      ${a.withdrawn_reason ? `<div><span>Withdrawn</span><b>${esc(a.withdrawn_reason)}</b></div>` : ''}</div>
    ${a.route === 'Record' ? `<div class="card">${section('The training', `${esc(a.description || '')} (${esc(d8(a.trained_on))})`, open ? '<button class="btn" id="addev">Attach evidence…</button>' : '')}<div id="evg"></div></div>`
      : `<div class="card">${section('Training samples', `Run them like any sample (Testing > Backlog, ${a.sample_tests_done} of ${a.sample_tests} with final results). Each result is compared with the known value (its specification) in QC Review. The trainer evaluates once all have final results.`)}<div id="sg"></div><div id="rg" style="margin-top:10px"></div></div>`}`;
  if (a.route === 'Record') {
    new Grid(main.querySelector('#evg'), { readOnly: true, rows: d.evidence, emptyText: 'No evidence attached yet.', columns: [
      { field: 'title', title: 'Evidence', type: 'link', width: 260, onClick: (r) => window.open(`/api/training/evidence/${r.id}/file?s=${site()}`, '_blank') },
      { field: 'by_name', title: 'Attached by', type: 'readonly', width: 160 }, { field: 'created_at', title: 'When', type: 'readonly', width: 120, format: d8 }] });
    const add = main.querySelector('#addev');
    if (add) add.onclick = async () => {
      const v = await modal({ title: 'Attach evidence', html: '<div class="field"><label for="f_files">Files</label><input id="f_files" type="file" multiple></div>', fields: [], okText: 'Attach', collect: (mm) => ({ files: [...mm.querySelector('#f_files').files] }) });
      if (!v || !v.files.length) return;
      const documents = []; for (const f of v.files) documents.push({ file_name: f.name, mime_type: f.type || 'application/octet-stream', base64: await readB64(f), title: f.name });
      try { await api(`/training/attempts/${id}/evidence`, { method: 'POST', body: { documents } }); attempt(main, id); } catch (e) { toast(e.message, 'err'); }
    };
  } else {
    new Grid(main.querySelector('#sg'), { readOnly: true, rows: d.samples, columns: [
      { field: 'sample_code', title: 'Training sample', type: 'link', width: 160, href: (r) => '#/samples/' + r.id }, { field: 'status', title: 'Test', type: 'readonly', width: 110 }] });
    new Grid(main.querySelector('#rg'), { readOnly: true, rows: d.results, emptyText: 'No results yet.', columns: [
      { field: 'sample_code', title: 'Sample', type: 'readonly', width: 150 }, { field: 'analyte', title: 'Analyte', type: 'readonly', width: 180 },
      { field: 'reported', title: 'Result', type: 'readonly', width: 100, format: (v, r) => (r.final ? `${v} ${r.unit || ''}` : 'Waiting') },
      { field: 'spec', title: 'Known value range', type: 'readonly', width: 150 },
      { field: 'conformance', title: 'Within it', type: 'readonly', width: 120, cellClass: (r) => (r.final && r.conformance && r.conformance !== 'Conforms' ? 'cbad' : '') }] });
  }
  const ev = main.querySelector('#eval');
  if (ev) ev.onclick = async () => {
    const v = await modal({ title: 'Evaluate the competency', okText: 'Next: sign', intro: `${esc(a.full_name)} on ${esc(a.test_name)}. A conditional pass says what it is conditional on; a fail says why.`,
      fields: [{ name: 'evaluation', label: 'Evaluation', type: 'select', blank: false, value: 'Pass', options: ['Pass', 'Conditional pass', 'Fail'] }, { name: 'note', label: 'Note', type: 'textarea' }] });
    if (!v) return;
    const r = await signDialog({ title: 'Sign the evaluation', what: `${v.evaluation}: ${a.attempt_code}, ${a.full_name} on ${a.test_name}`, meaning: 'Evaluated by', needReason: false,
      submit: ({ signature }) => api(`/training/attempts/${id}/evaluate`, { method: 'POST', body: { ...v, signature } }) });
    if (r) { toast('Evaluated and signed: QA approves it next.'); attempt(main, id); }
  };
  const decide = (decision) => async () => {
    const v = await modal({ title: decision === 'Approved' ? 'Approve the competency' : 'Reject the evaluation', okText: 'Next: sign',
      intro: decision === 'Approved' ? `${esc(a.evaluation)} by ${esc(a.evaluated_by_name)}. ${a.kind === 'Initial' && a.evaluation !== 'Fail' ? 'Approving grants the qualification.' : a.evaluation !== 'Fail' ? 'Approving keeps the qualification up.' : 'Approving records the failure.'}` : 'Say why the evaluation is rejected.',
      fields: [{ name: 'note', label: 'Note', type: 'textarea', required: decision === 'Rejected' }] });
    if (!v) return;
    const r = await signDialog({ title: 'Sign QA\'s decision', what: `${decision}: ${a.attempt_code}, ${a.full_name} on ${a.test_name}`, meaning: decision === 'Approved' ? 'Approved by' : 'Rejected by', needReason: false,
      submit: ({ signature }) => api(`/training/attempts/${id}/decide`, { method: 'POST', body: { decision, note: v.note, signature } }) });
    if (r) { toast(decision === 'Approved' ? 'Approved and signed.' : 'Rejected and signed.'); attempt(main, id); }
  };
  if (main.querySelector('#ok')) main.querySelector('#ok').onclick = decide('Approved');
  if (main.querySelector('#rej')) main.querySelector('#rej').onclick = decide('Rejected');
  const wd = main.querySelector('#wd');
  if (wd) wd.onclick = async () => {
    const v = await modal({ title: 'Withdraw the attempt', fields: [{ name: 'reason', label: 'Reason', type: 'textarea', required: true }], okText: 'Withdraw' });
    if (!v) return;
    try { await api(`/training/attempts/${id}/withdraw`, { method: 'POST', body: v }); attempt(main, id); } catch (e) { toast(e.message, 'err'); }
  };
}
