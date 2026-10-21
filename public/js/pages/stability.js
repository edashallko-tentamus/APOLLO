// Stability studies (migration 032). Pricing > Stability quotes (the list and the quote page with the study design:
// conditions, timepoints, tests, the matrix, the price by year), Testing > Stability studies (the studies, pulls
// due, a study: place in chambers, record pulls, the summary report) and Admin > Lab setup > Stability chambers
// (conditions, chambers, racks, upcoming pulls by chamber). Sending, accepting and rejecting use the quote
// screens (quotes.js), because a stability quote is a quote of kind "Stability".
import { api, esc, pageHeader, toast, modal, askReason, state, money, badge, can, link, setDirtyCheck, signDialog } from '../app.js';
import { Grid } from '../grid.js';
import { editableGrid, section, pagedList } from './common.js';
import { decide, sendQuote } from './quotes.js';

const css = document.createElement('style');
css.textContent = `
.stb-facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px 18px; }
.stb-facts .field { margin: 0; } .stb-facts input, .stb-facts select { width: 100%; }
.stb-conds { display: flex; flex-wrap: wrap; gap: 8px; }
.stb-conds label { display: inline-flex; gap: 6px; align-items: center; border: 1px solid var(--line); border-radius: 999px; padding: 5px 12px; cursor: pointer; background: #fff; font-size: 13px; }
.stb-conds label.on { background: var(--sec-soft, #E5F4EC); border-color: var(--sec, #1F8A5B); color: var(--sec, #1F8A5B); font-weight: 600; }
.stb-conds small { color: var(--muted); font-weight: 400; }
.stb-probs { margin: 0; padding-left: 18px; } .stb-probs li.Error { color: var(--err-ink); } .stb-probs li.Warning { color: var(--warn-ink); }
.stb-sum { display: flex; gap: 18px; align-items: baseline; flex-wrap: wrap; } .stb-sum .big { font-size: 22px; font-weight: 700; color: var(--sec, #1F8A5B); }
.stb-years { border-collapse: collapse; } .stb-years td, .stb-years th { padding: 3px 12px 3px 0; text-align: right; font-size: 13px; } .stb-years th { color: var(--muted); font-weight: 600; }
.stb-bar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
.stb-rep h3 { margin: 14px 0 4px; } .stb-rep table { border-collapse: collapse; width: 100%; margin-bottom: 8px; }
.stb-rep th, .stb-rep td { border-bottom: 1px solid #EEF1F3; padding: 4px 8px; font-size: 13px; text-align: center; } .stb-rep th { background: #F0F3F5; }
.stb-rep td.l, .stb-rep th.l { text-align: left; } .stb-rep .pend { color: var(--muted); font-style: italic; } .stb-rep .oos { color: var(--err-ink); font-weight: 700; }
.short { color: var(--err-ink); font-weight: 700; }
.stb-amd { border-left: 4px solid var(--warn-ink, #8a5a00); }
.stb-done { border-left: 4px solid var(--err-ink); }
.stb-rep sup.ex { color: var(--err-ink); font-weight: 700; }
.stb-probs li.Block { color: var(--err-ink); } .stb-probs li.Info { color: var(--muted); }
.stb-disp td { vertical-align: middle; }
`;
document.head.appendChild(css);

const d8 = (v) => { if (!v) return ''; const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return (m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(v)).toLocaleDateString([], { dateStyle: 'medium' }); };
const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
const iso = (v) => { const m = String(v || '').match(/^\d{4}-\d{2}-\d{2}/); return m ? m[0] : ''; };
let keySeq = 0; const newKey = () => 'k' + (++keySeq);

// ================================================================ Pricing > Stability quotes
export async function quotes(main) {
  const d = await api('/stability/quotes');
  main.innerHTML = pageHeader('Stability quotes', 'A stability study starts as a quote: the conditions, the timepoints and the tests at each one, priced per test. Sent and accepted like any quote (Pricing > Quotes lists them too); once accepted it becomes a study, and its T0 sample waits to be logged in.',
    d.can_edit ? '<button class="btn primary" id="new">+ New stability quote</button>' : '', { kind: 'stability_quotes' })
    + '<div class="card"><div id="g"></div></div>';
  new Grid(main.querySelector('#g'), { readOnly: true, search: true, rows: d.rows, keyField: 'version_id', filter: state.query.get('find') || '',
    emptyText: d.can_edit ? 'No stability quotes yet. "+ New stability quote" starts one.' : 'No stability quotes yet.',
    rowClass: (r) => (['Rejected', 'Expired', 'Superseded'].includes(r.status) ? 'mutedrow' : ''),
    columns: [
      { field: 'project_code', title: 'Quote', type: 'link', width: 95, compute: (r) => `${r.project_code}${r.version_no > 1 ? ' v' + r.version_no : ''}`, href: (r) => '#/stability/quotes/' + r.project_id },
      { field: 'client_name', title: 'Client', type: 'link', width: 170, href: (r) => '#/clients/' + r.client_id },
      { field: 'project_name', title: 'Reference', type: 'readonly', width: 230 },
      { field: 'product', title: 'Product', type: 'readonly', width: 190 },
      { field: 'site_code', title: 'Lab', type: 'readonly', width: 55 },
      { field: 'status', title: 'Status', type: 'readonly', width: 110, compute: (r) => (r.past_valid ? 'Past valid date' : r.status === 'Submitted for Quote' ? 'Submitted' : r.status),
        cellClass: (r) => ({ Accepted: 'tbpass', Rejected: 'tbfail' }[r.status] || (r.status === 'Quoted' ? 'tbwait' : '')) },
      { field: 'total', title: 'Study total', type: 'money', width: 100 },
      { field: 'study_code', title: 'Study', type: 'link', width: 95, href: (r) => (r.study_id ? '#/stability/studies/' + r.study_id : null) },
      { field: 'owner_name', title: 'Prepared by', type: 'readonly', width: 150 },
      { field: 'sent', title: 'Sent', type: 'readonly', width: 110, compute: (r) => (r.sent_at ? d8(r.sent_at) : r.quoted_at ? 'Issued, not sent' : '') },
      { field: 'valid_until', title: 'Valid until', type: 'readonly', width: 100, format: d8 },
    ] });
  const nb = main.querySelector('#new'); if (nb) nb.onclick = () => newStabilityQuote(d.labs);
}

async function newStabilityQuote(labs) {
  const clients = await api('/clients');
  const v = await modal({ title: 'New stability quote', okText: 'Next', intro: 'The study is designed on the quote: storage conditions, timepoints, and the tests at each timepoint. It starts with the usual ICH set (25 °C / 60% RH and 40 °C / 75% RH; T0 to 24 months), which you then change.',
    fields: [{ name: 'client_id', label: 'Client', type: 'select', required: true, options: clients.filter((c) => c.status !== 'Inactive').map((c) => ({ value: c.id, label: c.legal_name })) },
      { name: 'site_id', label: 'Lab (stores and tests the material)', type: 'select', required: true, value: state.site || '', options: labs.map((l) => ({ value: l.id, label: l.site_code })) },
      { name: 'project_name', label: 'Reference', help: 'What the client asked for, e.g. "Fish oil softgels, 24 months real time".' },
      { name: 'product', label: 'Product' }, { name: 'lot', label: 'Lot (optional)' },
      { name: 'unit_name', label: 'Material counted in', value: 'units', help: 'bottles, blisters, sachets, jars...' }] });
  if (!v) return;
  const cl = await api('/clients/' + v.client_id);
  const people = cl.contacts.filter((x) => x.status === 'Active' && x.contact_status === 'Active');
  let contact = '';
  if (people.length) {
    const w = await modal({ title: 'Who is the quote for?', okText: 'Create quote', fields: [{ name: 'quote_contact_id', label: 'Contact', type: 'select', value: people[0].contact_id,
      options: people.map((x) => ({ value: x.contact_id, label: `${x.contact_name}${x.email ? ' <' + x.email + '>' : ''}` })) }] });
    if (!w) return; contact = w.quote_contact_id;
  }
  try { const r = await api('/stability/quotes', { method: 'POST', body: { ...v, quote_contact_id: contact } }); toast(`${r.project_code} started: add the tests and tick the matrix.`); location.hash = '#/stability/quotes/' + r.id; } catch (e) { toast(e.message, 'err'); }
}

// ================================================================ a stability quote
export async function quote(main, pid) {
  const d = await api('/stability/quotes/' + pid);
  const v = d.version; const p = d.project; const g = d.design; const ed = d.editable && d.can_edit;
  // the page's state: what the Save button sends
  const st = {
    plan: { ...(g.plan || {}) },
    conds: g.conditions.map((c) => c.condition_id),
    tps: g.timepoints.map((t) => ({ _k: t.id, id: t.id, label: t.label, interval_value: t.interval_value, interval_unit: t.interval_unit, days_early: t.days_early, days_late: t.days_late, planned: t.planned_date })),
    lines: g.lines.map((l) => ({ _k: l.id, test_id: l.test_id, final_price: l.final_price, units: l.units || 1, t0: g.cells.some((c) => c.line_id === l.id && c.condition_id === null) })),
    ticks: new Set(),   // `${test_id}|${condition_id}|${tp _k}`
  };
  for (const c of g.cells) if (c.condition_id) { const l = g.lines.find((x) => x.id === c.line_id); if (l) st.ticks.add(`${l.test_id}|${c.condition_id}|${c.timepoint_id}`); }
  let dirty = false; const touch = () => { dirty = true; const b = main.querySelector('#save'); if (b) b.disabled = false; };
  setDirtyCheck(() => dirty);
  const pw = (d.labs.find((l) => l.id === st.plan.site_id) || {}).stability_pull_window_days ?? 7;
  const cat = new Map(d.catalog.map((x) => [x.test_id, x]));
  const total = d.years.reduce((s, y) => s + y.total, 0);
  const statusText = v.status === 'Submitted for Quote' ? 'Submitted' : v.status;
  const acts = [
    `<a class="btn ghost" target="_blank" href="/api/quotes/versions/${v.id}/pdf?fresh=1">Quotation PDF</a>`,
    ed ? '<button class="btn primary" id="save" disabled>Save design</button>' : '',
    d.can_edit && ['Draft', 'Submitted for Quote', 'Quoted'].includes(v.status) ? `<button class="btn" id="send">${v.status === 'Quoted' ? 'Send again…' : 'Issue and send to client…'}</button>` : '',
    d.can_edit && v.status === 'Quoted' ? '<button class="btn" id="acc">Accept…</button><button class="btn ghost" id="rej">Reject…</button>' : '',
    d.can_edit && !d.study && ['Quoted', 'Rejected', 'Expired'].includes(v.status) ? '<button class="btn ghost" id="newv">New version</button>' : '',
    d.can_edit && d.study && d.study.status !== 'Cancelled' && ['Accepted', 'Rejected', 'Expired'].includes(v.status) ? '<button class="btn ghost" id="newv">Amend the study…</button>' : '',
  ].join(' ');
  main.innerHTML = pageHeader(`${p.project_code}${v.version_no > 1 ? ' v' + v.version_no : ''}: ${p.project_name}`,
    `Stability quote for ${link('#/clients/' + p.client_id, p.client_name)}${p.quote_contact_name ? ', attn. ' + esc(p.quote_contact_name) : ''} · prepared by ${esc(p.owner_name || '')} · ${badge(statusText)}
     ${v.sent_at ? ` · sent ${esc(d8(v.sent_at))}${v.sent_to_name ? ' to ' + esc(v.sent_to_name) : ''}` : ''}${v.status === 'Accepted' ? ` · accepted by ${esc(v.accepted_by_name || '')}` : ''}`,
    acts, { kind: 'stability_quote', id: p.id })
    + (d.study && v.id !== d.study.project_version_id && ['Draft', 'Submitted for Quote', 'Quoted'].includes(v.status)
      ? `<div class="notice stb-amd"><b>Amendment of study ${link('#/stability/studies/' + d.study.id, d.study.study_code)}</b> (it runs to an earlier version until this one is accepted).
         Change what the client asked for: add timepoints, tests or conditions, or untick what stops. Pulls already ordered or taken do not change, and T0 cannot change.
         When the client accepts, scheduled pulls follow the new design and new ones are scheduled; a new condition is placed in a chamber from the study page.</div>`
      : d.study ? `<div class="notice">Accepted: this quote is study ${link('#/stability/studies/' + d.study.id, d.study.study_code)} (${esc(d.study.status)}${d.study.amendment_no ? `, amendment ${d.study.amendment_no}` : ''}).</div>` : '')
    + (d.link && v.status === 'Quoted' ? `<div class="qsent">The client can accept or decline online: <input readonly value="${esc(d.link)}"></div>` : '')
    + (!ed && !d.study ? `<div class="notice">${v.status === 'Draft' ? 'You can view this quote; quotes.edit is needed to change it.' : 'This version is issued: its design is locked. "New version" starts a changed one.'}</div>` : '')
    + `<div class="card">${section('The study', 'Which lab stores and tests it, the product, and how prices move over the years. A planned placement date puts real dates on the quotation (weekends and holidays moved inside each window).')}
       <div class="stb-facts" id="facts"></div></div>
       <div class="card">${section('Storage conditions', 'The chambers the material is stored in. The ICH set is preset for every lab; your lab adds its own (Admin > Lab setup > Stability chambers).')}<div class="stb-conds" id="conds"></div></div>
       <div class="card">${section('Timepoints', `T0 is the baseline, tested when the material is placed. Each later timepoint is a pull, with its window in days early and late (the lab's default is ± ${pw} days; a QA decision). Fill down and paste work as in Excel; tick Remove to drop a row.`)}<div id="tps"></div></div>
       <div class="card">${section('Tests', 'Each test is priced once; the study total counts it at every timepoint where it is ticked. Material per test is what one test uses at one timepoint.')}<div id="lines"></div></div>
       <div class="card">${section('Matrix', 'Tick the timepoints each test is pulled at, per condition (tests often differ by timepoint: e.g. accelerated stops at 6 months).')}<div id="mx"></div></div>
       <div class="cols"><div class="card">${section('Price')}<div id="price"></div></div><div class="card">${section('Before it can be issued')}<div id="probs"></div></div></div>`;
  const $ = (s) => main.querySelector(s);

  // --- the study facts
  const fld = (k, label, input) => `<div class="field"><label for="pf_${k}">${label}</label>${input}</div>`;
  const inp = (k, type = 'text', extra = '') => `<input id="pf_${k}" type="${type}" ${extra} value="${esc(st.plan[k] ?? '')}" ${ed ? '' : 'disabled'}>`;
  $('#facts').innerHTML = [
    fld('site_id', 'Lab', `<select id="pf_site_id" disabled title="The quote's lab: set when the quote is made">${d.labs.map((l) => `<option value="${l.id}" ${l.id === st.plan.site_id ? 'selected' : ''}>${esc(l.site_code)}</option>`).join('')}</select>`),
    fld('product', 'Product', inp('product')), fld('lot', 'Lot', inp('lot')), fld('protocol_ref', 'Client protocol', inp('protocol_ref')),
    fld('unit_name', 'Material counted in', inp('unit_name')), fld('planned_placement', 'Planned placement', inp('planned_placement', 'date')),
    fld('escalation_pct', 'Yearly price increase %', inp('escalation_pct', 'number', 'step="0.5" min="0"')),
    fld('reserve_pct', 'Material reserve % (blank: the lab\'s)', inp('reserve_pct', 'number', 'step="1" min="0"')),
  ].join('');
  if (st.plan.planned_placement) $('#pf_planned_placement').value = iso(st.plan.planned_placement);
  main.querySelectorAll('#facts input, #facts select').forEach((el) => { el.oninput = () => { st.plan[el.id.slice(3)] = el.value; touch(); }; });

  // --- conditions
  const drawConds = () => {
    $('#conds').innerHTML = d.conditions.map((c) => `<label class="${st.conds.includes(c.id) ? 'on' : ''}"><input type="checkbox" data-c="${c.id}" ${st.conds.includes(c.id) ? 'checked' : ''} ${ed ? '' : 'disabled'}>
      ${esc(c.condition_name)} <small>${esc(c.condition_type)}${c.site_id ? '' : ' · ICH'}</small></label>`).join('');
    main.querySelectorAll('#conds input').forEach((el) => { el.onchange = () => {
      st.conds = d.conditions.map((c) => c.id).filter((id) => (id === el.dataset.c ? el.checked : st.conds.includes(id))); touch(); drawConds(); drawMatrix(); }; });
  };

  // --- timepoints
  const tpGrid = new Grid($('#tps'), { rows: st.tps, readOnly: !ed, allowAdd: ed, keyField: '_k',
    newRow: () => ({ _k: newKey(), label: '', interval_value: '', interval_unit: 'Months', days_early: pw, days_late: pw }),
    columns: [
      { field: 'label', title: 'Timepoint', width: 110 },
      { field: 'interval_value', title: 'After', type: 'int', width: 70 },
      { field: 'interval_unit', title: 'Unit', type: 'select', options: ['Months', 'Weeks', 'Days'], width: 90 },
      { field: 'days_early', title: 'Days early', type: 'int', width: 90 },
      { field: 'days_late', title: 'Days late', type: 'int', width: 90 },
      { field: 'planned', title: 'Planned date', type: 'readonly', width: 120, format: d8 },
      { field: 'remove', title: 'Remove', type: 'bool', width: 75 },
    ],
    onChange: (gr) => { st.tps = gr.rows.map((r) => ({ ...r, _k: r._k || newKey() })); gr.rows.forEach((r, i) => { r._k = st.tps[i]._k; }); touch(); drawMatrix(); } });
  void tpGrid;

  // --- tests
  const testOpts = d.catalog.map((x) => ({ value: x.test_id, label: `${x.test_name} (${x.test_code})${x.has_effective ? '' : ' · no approved workflow'}` }));
  const lineCount = (tid) => st.tps.filter((t) => !t.remove && Number(t.interval_value) > 0).reduce((n, t) => n + st.conds.filter((c) => st.ticks.has(`${tid}|${c}|${t._k}`)).length, 0)
    + (st.lines.find((l) => l.test_id === tid)?.t0 ? 1 : 0);
  const lineGrid = new Grid($('#lines'), { rows: st.lines, readOnly: !ed, allowAdd: ed, keyField: '_k',
    newRow: () => ({ _k: newKey(), test_id: '', final_price: '', units: 1, t0: true }),
    columns: [
      { field: 'test_id', title: 'Test', type: 'select', options: testOpts, width: 330, editable: (r, isNew) => isNew || !r.test_id },
      { field: 'list', title: 'List price', type: 'readonly', width: 90, compute: (r) => money(cat.get(r.test_id)?.list_price) },
      { field: 'final_price', title: 'Your price', type: 'money', width: 95, help: 'Blank: the list price' },
      { field: 'units', title: 'Material per test', type: 'int', width: 115 },
      { field: 't0', title: 'At T0', type: 'bool', width: 65 },
      { field: 'times', title: 'Times', type: 'readonly', width: 60, compute: (r) => (r.test_id ? lineCount(r.test_id) : '') },
      { field: 'remove', title: 'Remove', type: 'bool', width: 75 },
    ],
    onChange: (gr) => { st.lines = gr.rows.map((r) => ({ ...r, _k: r._k || newKey() })); touch(); drawMatrix(); } });
  void lineGrid;

  // --- the matrix: a row per test and condition, a column per pull timepoint
  let mxGrid = null;
  function drawMatrix() {
    const pulls = st.tps.filter((t) => !t.remove && Number(t.interval_value) > 0 && String(t.label || '').trim());
    const lines = st.lines.filter((l) => l.test_id && !l.remove);
    const conds = d.conditions.filter((c) => st.conds.includes(c.id));
    const rows = [];
    for (const l of lines) for (const c of conds) {
      const r = { _k: `${l.test_id}|${c.id}`, test_id: l.test_id, condition_id: c.id, test: cat.get(l.test_id)?.test_name || '', condition: c.condition_name };
      pulls.forEach((t, i) => { r['p' + i] = st.ticks.has(`${l.test_id}|${c.id}|${t._k}`); });
      rows.push(r);
    }
    const cols = [{ field: 'test', title: 'Test', type: 'readonly', width: 230 }, { field: 'condition', title: 'Condition', type: 'readonly', width: 140 },
      ...pulls.map((t, i) => ({ field: 'p' + i, title: t.label, type: 'bool', width: 70 }))];
    if (mxGrid && mxGrid.el.isConnected) { mxGrid.cols = cols; mxGrid.o.columns = cols; mxGrid.setRows(rows); }
    else {
      mxGrid = new Grid($('#mx'), { rows, columns: cols, readOnly: !ed, keyField: '_k', emptyText: 'Add tests and conditions first.',
        onChange: (gr) => {
          const ps = st.tps.filter((t) => !t.remove && Number(t.interval_value) > 0 && String(t.label || '').trim());
          for (const r of gr.rows) ps.forEach((t, i) => { const k = `${r.test_id}|${r.condition_id}|${t._k}`; if (r['p' + i] === true || r['p' + i] === 'true') st.ticks.add(k); else st.ticks.delete(k); });
          touch(); lineGrid.render();
        } });
    }
    lineGrid.render();
  }

  // --- price and problems (as saved)
  $('#price').innerHTML = `<div class="stb-sum"><span class="big">${money(total)}</span><span class="help">study total${Number(st.plan.escalation_pct) ? `, ${Number(st.plan.escalation_pct)}% more each year` : ''} · as saved</span></div>
    ${d.years.length ? `<table class="stb-years"><tr><th>Study year</th><th>Tests</th><th>Amount</th></tr>${d.years.map((y) => `<tr><td>Year ${y.year}</td><td>${y.tests}</td><td>${money(y.total)}</td></tr>`).join('')}</table>` : ''}`;
  $('#probs').innerHTML = d.problems.length ? `<ul class="stb-probs">${d.problems.map((x) => `<li class="${esc(x.severity)}">${esc(x.problem)}</li>`).join('')}</ul>` : '<div class="help">Nothing: it can be issued.</div>';

  drawConds(); drawMatrix();

  // --- actions
  const sv = $('#save');
  if (sv) sv.onclick = async () => {
    const tps = st.tps.filter((t) => !t.remove && String(t.label || '').trim());
    const lines = st.lines.filter((l) => l.test_id && !l.remove);
    const body = {
      plan: { ...st.plan }, condition_ids: st.conds,
      timepoints: tps.map((t) => ({ id: t.id, label: String(t.label).trim(), interval_value: t.interval_value, interval_unit: t.interval_unit, days_early: t.days_early, days_late: t.days_late })),
      lines: lines.map((l) => ({ test_id: l.test_id, final_price: l.final_price, units: l.units, t0: l.t0 === true || l.t0 === 'true' })),
      matrix: [],
    };
    for (const l of lines) for (const c of st.conds) {
      const labels = tps.filter((t) => Number(t.interval_value) > 0 && st.ticks.has(`${l.test_id}|${c}|${t._k}`)).map((t) => String(t.label).trim());
      if (labels.length) body.matrix.push({ test_id: l.test_id, condition_id: c, labels });
    }
    try { await api(`/stability/versions/${v.id}/design`, { method: 'POST', body }); dirty = false; setDirtyCheck(null); toast('Design saved.'); quote(main, pid); } catch (e) { toast(e.message, 'err'); }
  };
  const contacts = d.contacts.map((x) => ({ id: x.id, name: x.name, email: x.email }));
  const vv = { id: v.id, status: v.status, project_code: p.project_code, sent_to_contact_id: v.sent_to_contact_id, quote_contact_id: p.quote_contact_id };
  const sb = $('#send'); if (sb) sb.onclick = () => { if (dirty) { toast('Save the design first.', 'err'); return; } sendQuote(vv, contacts, () => quote(main, pid)); };
  const row = { version_id: v.id, client_id: p.client_id, quote_contact_id: p.quote_contact_id, sent_to_contact_id: v.sent_to_contact_id, project_code: p.project_code };
  const ab = $('#acc'); if (ab) ab.onclick = () => decide(row, 'Accepted', () => quote(main, pid));
  const rb = $('#rej'); if (rb) rb.onclick = () => decide(row, 'Rejected', () => quote(main, pid));
  const nv = $('#newv'); if (nv) nv.onclick = async () => {
    if (d.study) {
      const ok = await modal({ title: `Amend study ${d.study.study_code}`, okText: 'Start the amendment',
        intro: 'An amendment is a new version of this quote: change the design, issue it and send it to the client. Nothing changes in the study until the client accepts it. Pulls already ordered or taken stay as they are.', fields: [] });
      if (!ok) return;
    }
    try { await api(`/stability/quotes/${p.id}/new-version`, { method: 'POST', body: {} }); toast(d.study ? 'Amendment started: change the design, then issue and send it.' : 'New version started: change the design, then issue it.'); quote(main, pid); } catch (e) { toast(e.message, 'err'); }
  };
}

// ================================================================ Testing > Stability studies
export async function studies(main) {
  const d = await api('/stability/studies');
  const tab = state.query.get('tab') === 'pulls' ? 'pulls' : 'studies';
  main.innerHTML = pageHeader('Stability studies', 'Each accepted stability quote is a study. Place the material in the chambers when it arrives (the T0 sample is logged in then, if intake has not); each pull gets its lab order on its date, then "Record pull" takes the units out of storage and logs the sample.',
    `<a class="btn ghost" href="#/stability/quotes">Stability quotes</a>`, { kind: 'stability_studies' })
    + `<div class="tabs"><a class="tab ${tab === 'studies' ? 'on' : ''}" href="#/stability/studies">Studies</a><a class="tab ${tab === 'pulls' ? 'on' : ''}" href="#/stability/studies?tab=pulls" id="tpulls">Pulls due (${d.pulls.filter((p) => iso(p.scheduled_date) <= iso(d.today)).length})</a></div>
    <div class="card"><div id="g"></div></div>`;
  const g = main.querySelector('#g');
  if (tab === 'studies') {
    // one page at a time from the server (0.35.0), newest first
    pagedList({ el: g, url: '/stability/studies', q: state.query.get('find') || '', filter: state.query.get('show') || 'current',
      filters: [['current', 'Current'], ['finished', 'Finished'], ['all', 'All']],
      placeholder: 'Search by study, client, product, quote or condition; type a study code and press Enter to open it',
      open: (r) => { location.hash = '#/stability/studies/' + r.id; },
      render: (el, rows) => new Grid(el, { readOnly: true, rows, emptyText: 'No studies here: a stability quote becomes a study when the client accepts it.',
      rowClass: (r) => (r.status === 'Awaiting material' ? 'tbwait' : r.status === 'Cancelled' ? 'mutedrow' : ''),
      columns: [
        { field: 'study_code', title: 'Study', type: 'link', width: 95, href: (r) => '#/stability/studies/' + r.id },
        { field: 'client_name', title: 'Client', type: 'link', width: 170, href: (r) => '#/clients/' + r.client_id },
        { field: 'product', title: 'Product', type: 'readonly', width: 200 },
        { field: 'status', title: 'Status', type: 'readonly', width: 125 },
        { field: 'conditions', title: 'Conditions', type: 'readonly', width: 220 },
        { field: 'placement_date', title: 'Placed', type: 'readonly', width: 100, format: d8 },
        { field: 'pulls', title: 'Pulls done', type: 'readonly', width: 85, compute: (r) => `${r.pulls_done} of ${r.pulls_total}` },
        { field: 'pulls_to_take', title: 'To take now', type: 'readonly', width: 90 },
        { field: 'next_pull', title: 'Next pull', type: 'readonly', width: 100, format: d8 },
        { field: 'shortfall', title: 'Material short', type: 'readonly', width: 100, cellClass: (r) => (Number(r.shortfall) ? 'tbfail' : '') },
        { field: 'excursions_open', title: 'Excursions to assess', type: 'readonly', width: 140, compute: (r) => (Number(r.excursions_open) || ''), cellClass: (r) => (Number(r.excursions_open) ? 'tbfail' : '') },
        { field: 'last_report_code', title: 'Last report', type: 'readonly', width: 130 },
        { field: 'project_code', title: 'Quote', type: 'link', width: 90, href: (r) => '#/stability/quotes/' + r.project_id },
      ] }) });
  } else {
    pullsGrid(g, d.pulls, d.can_manage, () => studies(main), true);
  }
}

function pullsGrid(el, rows, canManage, reload, withStudy) {
  new Grid(el, { readOnly: true, search: true, rows, emptyText: 'No pulls in the next 60 days.',
    rowClass: (r) => (r.overdue ? 'tbnc' : r.status === 'Pulled' ? 'mutedrow' : ''),
    columns: [
      ...(withStudy ? [{ field: 'study_code', title: 'Study', type: 'link', width: 95, href: (r) => '#/stability/studies/' + r.study_id }, { field: 'client_name', title: 'Client', type: 'readonly', width: 150 }] : []),
      { field: 'timepoint_label', title: 'Timepoint', type: 'readonly', width: 85 },
      { field: 'condition_name', title: 'Condition', type: 'readonly', width: 130 },
      { field: 'scheduled_date', title: 'Pull on', type: 'readonly', width: 105, format: d8 },
      { field: 'window', title: 'Window', type: 'readonly', width: 150, compute: (r) => `${d8(r.window_start)} to ${d8(r.window_end)}` },
      { field: 'status', title: 'Status', type: 'readonly', width: 95, compute: (r) => (r.overdue ? 'Overdue' : r.status), cellClass: (r) => (r.overdue ? 'tbfail' : r.status === 'Ordered' ? 'tbwait' : r.status === 'Pulled' ? 'tbpass' : '') },
      { field: 'rec', title: '', type: 'button', width: 100, label: (r) => (canManage && r.status === 'Ordered' ? 'Record pull…' : ''), onClick: (r) => canManage && r.status === 'Ordered' && recordPull(r, reload) },
      { field: 'where', title: 'Where', type: 'readonly', width: 230, compute: (r) => `${r.equipment_name} · rack ${r.rack_code}${r.position ? ' · ' + r.position : ''}` },
      { field: 'units_required', title: 'Units', type: 'readonly', width: 60 },
      { field: 'order_code', title: 'Order', type: 'link', width: 95, href: (r) => (r.lab_order_id ? '#/orders/' + r.lab_order_id : null) },
      { field: 'sample', title: 'Sample', type: 'link', width: 140, compute: (r) => r.sample_code || r.client_sample_id || '', href: (r) => (r.sample_id ? '#/samples/' + r.sample_id : null) },
      { field: 'pulled_at', title: 'Pulled', type: 'readonly', width: 150, format: dt },
      { field: 'units_pulled', title: 'Units out', type: 'readonly', width: 75 },
      { field: 'within_window', title: 'In window', type: 'readonly', width: 80, compute: (r) => (r.within_window === true ? 'Yes' : r.within_window === false ? 'No' : '') },
      { field: 'pull_note', title: 'Note', type: 'readonly', width: 200 },
    ] });
}

async function recordPull(r, reload) {
  const now = new Date(); const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const v = await modal({ title: `Record pull: ${r.study_code} ${r.timepoint_label}, ${r.condition_name}`, okText: 'Record pull',
    intro: `Take the units out of ${esc(r.equipment_name)}, rack ${esc(r.rack_code)}${r.position ? ', ' + esc(r.position) : ''} (${esc(r.storage_code)}). The pull sample is then logged in and its tests go to the backlog; turnaround counts from the scheduled date, ${esc(d8(r.scheduled_date))}. Window: ${esc(d8(r.window_start))} to ${esc(d8(r.window_end))}.`,
    fields: [{ name: 'pulled_at', label: 'Pulled at', type: 'datetime-local', value: local, required: true }, { name: 'units', label: 'Units taken out', type: 'number', value: r.units_required, required: true },
      { name: 'note', label: 'Note (required outside the window)', type: 'textarea' }] });
  if (!v) return;
  try { const out = await api(`/stability/pulls/${r.id}/record`, { method: 'POST', body: { ...v, pulled_at: new Date(v.pulled_at).toISOString() } }); toast(`Pulled: ${out.left} units left in storage. The sample is logged in.`); reload(); } catch (e) { toast(e.message, 'err'); }
}

// ================================================================ a study
const FATES = [{ value: 'Destroyed', label: 'Destroyed' }, { value: 'Returned', label: 'Returned to the client' }, { value: 'Retained', label: 'Kept as retain' }];
const fateText = (v) => ({ Destroyed: 'Destroyed', Returned: 'Returned to the client', Retained: 'Kept as retain' }[v] || v);
export async function study(main, id) {
  const d = await api('/stability/studies/' + id);
  const s = d.study;
  const reload = () => study(main, id);
  const running = ['Awaiting material', 'Active'].includes(s.status);
  const acts = [
    `<a class="btn ghost" target="_blank" href="/api/stability/studies/${s.id}/report.pdf">Summary so far (PDF)</a>`,
    d.can_amend && s.status !== 'Cancelled' && !s.amendment_pending_version ? '<button class="btn ghost" id="amend">Amend the study…</button>' : '',
    d.can_cancel && running ? '<button class="btn ghost" id="cancel">Cancel the study…</button>' : '',
  ].join(' ');
  main.innerHTML = pageHeader(`${s.study_code}: ${s.product || 'stability study'}`,
    `${link('#/clients/' + s.client_id, s.client_name)} · lot ${esc(s.lot || '-')} · ${esc(s.site_code)} · ${badge(s.status)} · from quote ${link('#/stability/quotes/' + s.project_id, s.project_code + (s.version_no > 1 ? ' v' + s.version_no : ''))}${s.amendment_no ? ` (amendment ${s.amendment_no})` : ''}
     · T0 order ${link('#/orders/' + s.t0_order_id, s.t0_order_code)}${s.t0_sample_code ? ', sample ' + link('#/samples/' + s.t0_sample_id, s.t0_sample_code) : ' (sample expected)'}`,
    acts, { kind: 'stability_study', id: s.id })
    + (s.status === 'Cancelled' ? `<div class="notice stb-done"><b>Cancelled</b> ${esc(dt(s.cancelled_at))} by ${esc(s.cancelled_by_name || '')}: ${esc(s.cancel_reason || '')}. Pulls already taken stay in testing and are reported and billed.</div>` : '')
    + (s.amendment_pending_version ? `<div class="notice stb-amd">Amendment in progress: quote version ${s.amendment_pending_version} (${link('#/stability/quotes/' + s.project_id, 'open it')}). The study runs to version ${s.version_no} until the client accepts it.</div>` : '')
    + (d.need.length && (s.status === 'Awaiting material' || s.status === 'Active' || s.status === 'Completed') ? `<div class="card" id="place"></div>` : '')
    + `<div class="card">${section('Stored material', 'One labelled lot of material per condition, in its chamber, rack and position. Required = every pull of the design plus the reserve. Material no longer needed (the study completed, or an amendment dropped its condition) is destroyed, returned or kept as a retain, which frees the rack.')}<div id="stor"></div></div>
       <div class="card">${section('Pulls', 'Each pull gets its lab order on its scheduled date (weekends and holidays moved inside the window).')}<div id="pulls"></div></div>
       <div id="excur"></div>
       <div class="card stb-rep" id="reports"></div>
       <div id="amds"></div>
       <div class="card">${section('T0 baseline tests')}<div id="t0"></div></div>
       <div class="card stb-rep">${section('Summary of results so far', 'One table per test: analytes down, timepoints across, against the specification. Preliminary results are marked P; E marks results of material exposed to an excursion assessed as having an impact. The issued reports above show finalized results only.')}<div id="rep" class="help">Loading…</div></div>`;
  const $ = (q) => main.querySelector(q);
  if ($('#place')) placeCard($('#place'), d, reload);

  // stored material, with what happened to it
  new Grid($('#stor'), { readOnly: true, rows: d.storage, emptyText: 'Nothing placed yet.', rowClass: (r) => (r.status !== 'Stored' && r.status !== 'Used up' ? 'mutedrow' : ''), columns: [
    { field: 'storage_code', title: 'Label', type: 'readonly', width: 115 }, { field: 'condition_name', title: 'Condition', type: 'readonly', width: 130 },
    { field: 'equipment_name', title: 'Chamber', type: 'link', width: 200, href: (r) => '#/equipment/' + r.equipment_id },
    { field: 'rack_code', title: 'Rack', type: 'readonly', width: 60 }, { field: 'position', title: 'Position', type: 'readonly', width: 100 },
    { field: 'placed_on', title: 'Placed', type: 'readonly', width: 100, format: d8 },
    { field: 'units_received', title: 'Units placed', type: 'readonly', width: 90 }, { field: 'units_required', title: 'Required', type: 'readonly', width: 75 },
    { field: 'units_left', title: 'Left', type: 'readonly', width: 55 }, { field: 'units_still_needed', title: 'Still needed', type: 'readonly', width: 90 },
    { field: 'shortfall', title: 'Short at placement', type: 'readonly', width: 120, cellClass: (r) => (Number(r.shortfall) ? 'tbfail' : '') },
    { field: 'status', title: 'Status', type: 'readonly', width: 150, compute: (r) => fateText(r.status) },
    { field: 'disp', title: '', type: 'button', width: 110, label: (r) => (d.can_manage && r.status === 'Stored' && Number(r.units_still_needed) === 0 && s.status !== 'Awaiting material' ? 'Dispose…' : ''),
      onClick: (r) => d.can_manage && r.status === 'Stored' && Number(r.units_still_needed) === 0 && dispose(r, reload) },
    { field: 'disposed', title: 'Disposed', type: 'readonly', width: 230, compute: (r) => (r.disposed_at ? `${d8(r.disposed_at)}, ${r.disposed_by_name || ''}${r.disposition_note ? ': ' + r.disposition_note : ''}` : '') },
  ] });
  pullsGrid($('#pulls'), d.pulls, d.can_manage && running, reload, false);
  excursionCard($('#excur'), d, reload);
  reportsCard($('#reports'), d, reload);
  if (d.amendments.length) {
    $('#amds').innerHTML = `<div class="card">${section('Amendments', 'Each accepted amendment: the quote version the study switched to and what it did to the pulls. Pulls already ordered or taken never change.')}<div class="g"></div></div>`;
    new Grid($('#amds .g'), { readOnly: true, rows: d.amendments, keyField: 'id', columns: [
      { field: 'amendment_no', title: 'Amendment', type: 'readonly', width: 95 },
      { field: 'versions', title: 'Quote version', type: 'link', width: 140, compute: (r) => `v${r.from_version} to v${r.to_version}`, href: () => '#/stability/quotes/' + s.project_id },
      { field: 'applied_at', title: 'Accepted', type: 'readonly', width: 160, format: dt },
      { field: 'pulls_added', title: 'Pulls added', type: 'readonly', width: 95 }, { field: 'pulls_cancelled', title: 'Cancelled', type: 'readonly', width: 85 },
      { field: 'pulls_changed', title: 'Moved', type: 'readonly', width: 70 }, { field: 'applied_by_name', title: 'Recorded as', type: 'readonly', width: 170 }] });
  }
  $('#t0').innerHTML = d.t0tests.length ? d.t0tests.map((t) => `${esc(t.test_name)} <span class="help">(${esc(t.status)}${t.due_date ? ', due ' + esc(d8(t.due_date)) : ''})</span>`).join(' · ') : '<span class="help">None</span>';
  api(`/stability/studies/${id}/report`).then((r) => {
    $('#rep').innerHTML = r.sections.map((sec) => `<h3>${esc(sec.condition.condition_name)}${sec.condition.dropped ? ' <span class="help">(no longer in the study)</span>' : ''}</h3>${sec.tests.map((t) => `<div><b>${esc(t.test_name)}</b></div>
      <table><tr><th class="l">Analyte</th><th class="l">Specification</th>${sec.timepoints.map((tp) => `<th>${esc(tp.label)}</th>`).join('')}</tr>
      ${t.analytes.length ? t.analytes.map((a) => `<tr><td class="l">${esc(a.analyte_name)}${a.unit ? ` <span class="help">${esc(a.unit)}</span>` : ''}</td><td class="l">${esc(a.spec)}</td>
        ${a.values.map((x) => (x === null ? '<td class="help">–</td>' : x.pending ? '<td class="pend">pending</td>' : `<td class="${x.conformance === 'Does not conform' ? 'oos' : ''}">${esc(x.text)}${x.stage === 'Preliminary' ? '<sup>P</sup>' : ''}${x.flagged ? '<sup class="ex">E</sup>' : ''}</td>`)).join('')}</tr>`).join('')
        : `<tr><td class="l pend" colspan="${2 + sec.timepoints.length}">No results yet</td></tr>`}</table>`).join('')}`).join('') || '<span class="help">No results yet.</span>';
  }).catch((e) => { $('#rep').textContent = e.message; });

  const ab = $('#amend'); if (ab) ab.onclick = async () => {
    const ok = await modal({ title: `Amend study ${s.study_code}`, okText: 'Start the amendment',
      intro: 'An amendment is a new version of the stability quote: change the design (add timepoints, tests or conditions, or untick what stops), issue it and send it to the client. Nothing changes in the study until the client accepts it. Pulls already ordered or taken stay as they are; T0 cannot change.', fields: [] });
    if (!ok) return;
    try { await api(`/stability/quotes/${s.project_id}/new-version`, { method: 'POST', body: { reason: `Amendment of ${s.study_code}` } }); toast('Amendment started: change the design, then issue and send it.'); location.hash = '#/stability/quotes/' + s.project_id; } catch (e) { toast(e.message, 'err'); }
  };
  const cb = $('#cancel'); if (cb) cb.onclick = () => cancelStudy(d, reload);
}

// Cancel: the fate of each condition's stored material, the reason, the signature
async function cancelStudy(d, reload) {
  const s = d.study;
  const stored = d.storage.filter((r) => r.status === 'Stored');
  const toCancel = d.pulls.filter((p) => ['Scheduled', 'Ordered'].includes(p.status)).length;
  const v = await modal({ title: `Cancel study ${s.study_code}`, okText: 'Next: sign',
    intro: `${toCancel} pull(s) still to come are cancelled (open pull orders with their samples and tests too${s.status === 'Awaiting material' ? ', and the T0 order' : ''}). Pulls already taken stay in testing and are reported and billed. ${stored.length ? 'Say what happens to the material in each chamber:' : ''}`,
    fields: stored.map((r) => ({ name: 'f_' + r.id, label: `${r.storage_code}: ${r.condition_name}, ${r.units_left} left (${r.equipment_name}, rack ${r.rack_code})`, type: 'select', required: true, options: FATES }))
      .concat(stored.map((r) => ({ name: 'n_' + r.id, label: `${r.storage_code}: note (optional, e.g. the courier or where the retain is kept)` }))) });
  if (!v) return;
  const dispositions = stored.map((r) => ({ storage_id: r.id, disposition: v['f_' + r.id], note: v['n_' + r.id] || '' }));
  const done = await signDialog({ what: `Cancel stability study ${s.study_code}`, meaning: 'Cancelled by', okText: 'Cancel the study',
    submit: ({ reason, signature }) => api(`/stability/studies/${s.id}/cancel`, { method: 'POST', body: { reason, dispositions, signature } }) });
  if (done) { toast(`${s.study_code} cancelled: ${done.pulls} pull(s) cancelled.`); reload(); }
}

async function dispose(r, reload) {
  const v = await modal({ title: `Dispose of ${r.storage_code}`, okText: 'Next: sign',
    intro: `${r.units_left} ${r.units_left === 1 ? 'unit' : 'units'} of ${esc(r.condition_name)} material in ${esc(r.equipment_name)}, rack ${esc(r.rack_code)}${r.position ? ', ' + esc(r.position) : ''}. No pull needs it any more. Recording its fate frees the rack.`,
    fields: [{ name: 'disposition', label: 'What happens to it', type: 'select', required: true, options: FATES }, { name: 'note', label: 'Note (optional)' }] });
  if (!v) return;
  const done = await signDialog({ what: `${r.storage_code}: ${fateText(v.disposition)}`, meaning: 'Disposed by',
    submit: ({ reason, signature }) => api(`/stability/storage/${r.id}/dispose`, { method: 'POST', body: { reason, disposition: v.disposition, note: v.note, signature } }) });
  if (done) { toast(`${r.storage_code}: ${fateText(v.disposition).toLowerCase()}.`); reload(); }
}

// Chamber excursions while this study's material was in the chamber (Temperature log), and QA's assessment of each
function excursionCard(host, d, reload) {
  if (!d.excursions.length) { host.innerHTML = ''; return; }
  const open = d.excursions.filter((x) => !x.assessment_id).length;
  host.innerHTML = `<div class="card">${section('Chamber excursions', `Readings outside the chamber's condition while this study's material was in it (from the Temperature log). QA assesses each for this study: No impact, Impact (the results of the exposed material are flagged E on the reports) or Client to decide. ${open ? `<b>${open} not assessed yet</b>: no report can be issued until they are.` : 'All assessed.'}`)}<div class="g"></div></div>`;
  new Grid(host.querySelector('.g'), { readOnly: true, rows: d.excursions.map((x, i) => ({ ...x, key: i })), keyField: 'key', rowClass: (x) => (x.assessment_id ? '' : 'tbnc'), columns: [
    { field: 'entry_code', title: 'Entry', type: 'link', width: 105, href: (x) => '#/logbooks/entries/' + x.logbook_entry_id },
    { field: 'equipment_code', title: 'Chamber', type: 'link', width: 210, href: (x) => '#/equipment/' + x.equipment_id, compute: (x) => `${x.equipment_code} ${x.equipment_name}` },
    { field: 'storage_code', title: 'Material', type: 'readonly', width: 110 },
    { field: 'entry_at', title: 'When', type: 'readonly', width: 150, format: dt },
    { field: 'problems', title: 'Reading', type: 'readonly', width: 220, compute: (x) => [...(x.problems || []), x.failure_reason ? `(${x.failure_reason})` : ''].filter(Boolean).join(' ') },
    { field: 'window_end', title: 'Back in range', type: 'readonly', width: 150, format: (v) => (v ? dt(v) : 'not yet') },
    { field: 'decision', title: 'Assessment', type: 'readonly', width: 170, compute: (x) => x.decision || 'Not assessed', cellClass: (x) => (!x.decision ? 'tbfail' : x.decision === 'No impact' ? 'tbpass' : 'tbwait') },
    { field: 'assess', title: '', type: 'button', width: 100, label: () => (d.can_assess ? (open ? 'Assess…' : 'Reassess…') : ''), onClick: (x) => d.can_assess && assess(d.study, x, reload) },
    { field: 'justification', title: 'Justification', type: 'readonly', width: 260 },
    { field: 'assessed_by_name', title: 'Assessed by', type: 'readonly', width: 170, compute: (x) => (x.assessed_by_name ? `${x.assessed_by_name}, ${d8(x.assessed_at)}` : '') },
    { field: 'affected_pulls', title: 'Pulls of the exposed material', type: 'readonly', width: 240 },
  ] });
}
async function assess(st, x, reload) {
  const v = await modal({ title: `Assess ${x.entry_code} for ${st.study_code}`, okText: 'Next: sign',
    intro: `${esc(x.equipment_code)} ${esc(x.equipment_name)}, ${esc(dt(x.entry_at))}: ${esc((x.problems || []).join('; '))}${x.failure_reason ? ' (' + esc(x.failure_reason) + ')' : ''}. Material ${esc(x.storage_code)} (${esc(x.condition_name)}). Back in range: ${x.window_end ? esc(dt(x.window_end)) : 'not yet'}.`,
    fields: [{ name: 'decision', label: 'Impact on this study', type: 'select', required: true, value: x.decision || '',
      options: [{ value: 'No impact', label: 'No impact' }, { value: 'Impact: results flagged', label: 'Impact: flag the results of the exposed material' }, { value: 'Client to decide', label: 'Client to decide' }] },
      { name: 'justification', label: 'Justification', type: 'textarea', required: true, value: x.justification || '', help: 'e.g. how long and how far out of range, the product\'s sensitivity, the pulls concerned.' }] });
  if (!v) return;
  const done = await signDialog({ what: `Excursion ${x.entry_code} for ${st.study_code}: ${v.decision}`, meaning: 'Assessed by', needReason: false,
    submit: ({ signature }) => api(`/stability/studies/${st.id}/excursions/${x.logbook_entry_id}/assess`, { method: 'POST', body: { decision: v.decision, justification: v.justification, signature } }) });
  if (done) { toast('Assessment recorded.'); reload(); }
}

// The issued cumulative reports: after each pull's results are finalized; Final once every pull is done
function reportsCard(host, d, reload) {
  const s = d.study;
  const blocks = d.report_problems.filter((x) => x.severity === 'Block');
  host.innerHTML = `${section('Issued reports', 'The cumulative report the client is sent: finalized results only, timepoint by timepoint, with the excursions and their assessment and the amendments. Issue one after each pull\'s results are finalized (Report Finalization); the one issued when every pull is done and finalized is marked Final. Signed like a COA (your handwritten signature and title on file) and emailed to the client\'s report contacts.')}
    <div class="stb-bar">${s.status !== 'Awaiting material' ? `<a class="btn ghost" target="_blank" href="/api/stability/studies/${s.id}/report-preview.pdf">Preview the next report</a>` : ''}
      ${d.can_report ? `<button class="btn primary" id="issue" ${blocks.length ? 'disabled' : ''}>Issue report…</button>` : '<span class="help">reports.finalize is needed to issue reports.</span>'}</div>
    <ul class="stb-probs">${d.report_problems.map((x) => `<li class="${esc(x.severity)}">${esc(x.problem)}</li>`).join('')}</ul><div class="g"></div>`;
  new Grid(host.querySelector('.g'), { readOnly: true, rows: d.reports, emptyText: 'No report issued yet.', columns: [
    { field: 'report_code', title: 'Report (PDF)', type: 'link', width: 150, href: () => '#', onClick: (r) => window.open(`/api/stability/reports/${r.id}/pdf`, '_blank') },
    { field: 'kind', title: 'Kind', type: 'readonly', width: 120, compute: (r) => (r.is_final ? 'Final' : `Interim (v${r.version_no})`), cellClass: (r) => (r.is_final ? 'tbpass' : '') },
    { field: 'issued_at', title: 'Issued', type: 'readonly', width: 160, format: dt },
    { field: 'issued_by_name', title: 'Signed by', type: 'readonly', width: 180 }] });
  const ib = host.querySelector('#issue');
  if (ib) ib.onclick = async () => {
    const info = d.report_problems.filter((x) => x.severity !== 'Block').map((x) => x.problem).join(' ');
    const done = await signDialog({ what: `Stability report for ${s.study_code}. ${info}`, meaning: 'Issued by', okText: 'Issue and send',
      submit: ({ reason, signature }) => api(`/stability/studies/${s.id}/reports`, { method: 'POST', body: { reason, signature } }) });
    if (done) { toast(`${done.report_code} issued${done.is_final ? ' (Final)' : ''} and sent to the client (Outbox).`); reload(); }
  };
}

function placeCard(host, d, reload) {
  const s = d.study;
  const adding = s.status !== 'Awaiting material';
  const today = iso(d.today);
  const rackOpts = (cid) => d.racks.filter((r) => r.condition_id === cid && r.admin_status === 'In Service').map((r) => ({ value: r.id, label: `${r.equipment_name} · rack ${r.rack_code}` }));
  const rows = d.need.map((n) => ({ condition_id: n.condition_id, condition: n.condition_name, need: n.with_reserve, rack_id: (rackOpts(n.condition_id)[0] || {}).value || '', position: '', units: n.with_reserve }));
  host.innerHTML = adding
    ? `${section('Place the new condition\'s material', `An amendment added ${d.need.map((n) => esc(n.condition_name)).join(', ')}. Put its material in a rack of a chamber set to that condition: its pulls are scheduled from this date (no T0: the baseline was tested when the study started).`)}
      <div class="stb-bar"><label>Placement date <input type="date" id="pl_date" value="${today}" max="${today}" min="${iso(s.placement_date)}"></label>
        ${d.can_manage ? '<button class="btn primary" id="pl_go">Place in chambers</button>' : '<span class="help">stability.manage is needed to place material.</span>'}</div><div id="pl_g"></div>`
    : `${section('Place the material in the chambers', `When the client's material arrives: put each condition's share in a rack of a chamber set to that condition. This logs in the T0 sample (if intake has not), checks the material is enough (every pull plus the ${Number(s.reserve_pct)}% reserve) and schedules the pulls from the placement date.`)}
      <div class="stb-bar"><label>Placement date <input type="date" id="pl_date" value="${today}" max="${today}"></label>
        <label>Units for T0 testing <input type="number" id="pl_t0" value="${d.t0units || 1}" min="1" style="width:80px"></label>
        ${d.can_manage ? '<button class="btn primary" id="pl_go">Place in chambers</button>' : '<span class="help">stability.manage is needed to place material.</span>'}</div><div id="pl_g"></div>`;
  const grid = new Grid(host.querySelector('#pl_g'), { rows, readOnly: !d.can_manage, keyField: 'condition_id', columns: [
    { field: 'condition', title: 'Condition', type: 'readonly', width: 150 },
    { field: 'need', title: 'Needed (with reserve)', type: 'readonly', width: 150 },
    { field: 'rack_id', title: 'Chamber and rack', type: 'select', width: 300, options: (r) => rackOpts(r.condition_id) },
    { field: 'position', title: 'Position (shelf / slot)', width: 170 },
    { field: 'units', title: 'Units placed', type: 'int', width: 100 }] });
  const go = host.querySelector('#pl_go');
  if (go) go.onclick = async () => {
    if (grid.hasErrors()) { toast('Fix the cells marked in red first.', 'err'); return; }
    const short = grid.rows.filter((r) => Number(r.units) < Number(r.need));
    const reason = await askReason(`placing ${s.study_code} in the chambers${short.length ? ` (${short.map((r) => r.condition).join(', ')} short of material)` : ''}`); if (reason === null) return;
    try {
      const t0 = host.querySelector('#pl_t0');
      const out = await api(`/stability/studies/${s.id}/place`, { method: 'POST', body: { reason, placement_date: host.querySelector('#pl_date').value, t0_units: t0 ? t0.value : '',
        rows: grid.rows.map((r) => ({ condition_id: r.condition_id, rack_id: r.rack_id, position: r.position, units: Number(r.units) })) } });
      toast(adding ? `Placed: ${out.pulls} pull(s) scheduled.` : `Placed: ${out.pulls} pulls scheduled; the T0 sample is logged in.`); reload();
    } catch (e) { toast(e.message, 'err'); }
  };
}

// ================================================================ Admin > Lab setup > Stability chambers
export async function setup(main) {
  const d = await api('/stability/setup');
  const reload = () => setup(main);
  main.innerHTML = pageHeader('Stability chambers', `The storage conditions, the chambers (equipment) set to each, and their racks, where each study's material is placed and identified. The pull window new timepoints start with is a lab setting: ± ${d.lab.stability_pull_window_days} days at ${esc(d.lab.site_code)} (Sites and holidays).`, '', { kind: 'stability_setup' })
    + `<div class="card">${section('Conditions', d.sysadmin ? 'ICH conditions (every lab) are kept by system administrators; add your lab\'s own below them.' : 'The ICH set is kept for every lab; add your lab\'s own conditions (stability.configure).')}<div id="cg"></div></div>
       <div class="card">${section('Chambers', 'A chamber is a piece of equipment (Equipment > register, type "Stability chamber") set to one condition. Its calibration and tags come from Equipment.')}<div id="chg"></div></div>
       <div class="card">${section('Racks', 'Racks in each chamber. The study material is placed in a rack at a position (shelf / slot), which is printed on the pull.')}<div id="rg"></div></div>
       <div class="card">${section('Upcoming pulls by chamber (next 120 days)', 'Read only. Pulls that are overdue are red.')}<div id="ug"></div></div>`;
  const $ = (q) => main.querySelector(q);
  const can = d.can; const types = ['Long term', 'Intermediate', 'Accelerated', 'Refrigerated', 'Frozen', 'Photostability', 'Other'];
  editableGrid({ el: $('#cg'), rows: d.conditions.map((x) => ({ ...x, scope: x.site_id ? x.site_code : 'Every lab' })), allowAdd: can || d.sysadmin, readOnly: !(can || d.sysadmin), what: 'the stability conditions',
    newRow: () => ({ status: 'Active', condition_type: 'Other', scope: d.lab.site_code, sort_order: 100 }),
    rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''),
    columns: [
      { field: 'condition_name', title: 'Condition', width: 170, required: true, editable: (r, isNew) => isNew || (r.site_id ? can : d.sysadmin) },
      { field: 'scope', title: 'Lab', type: d.sysadmin ? 'select' : 'readonly', options: ['Every lab', d.lab.site_code], width: 90, editable: (r, isNew) => isNew && d.sysadmin },
      { field: 'condition_type', title: 'Type', type: 'select', options: types, width: 120, editable: (r, isNew) => isNew || (r.site_id ? can : d.sysadmin) },
      { field: 'temperature_c', title: 'Temp °C', type: 'number', width: 80, editable: (r, isNew) => isNew || (r.site_id ? can : d.sysadmin) },
      { field: 'temperature_tol', title: '± °C', type: 'number', width: 60, editable: (r, isNew) => isNew || (r.site_id ? can : d.sysadmin) },
      { field: 'humidity_pct', title: 'RH %', type: 'number', width: 70, editable: (r, isNew) => isNew || (r.site_id ? can : d.sysadmin) },
      { field: 'humidity_tol', title: '± RH', type: 'number', width: 60, editable: (r, isNew) => isNew || (r.site_id ? can : d.sysadmin) },
      { field: 'description', title: 'Description', width: 230, editable: (r, isNew) => isNew || (r.site_id ? can : d.sysadmin) },
      { field: 'chambers', title: 'Chambers here', type: 'readonly', width: 100 },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 85, editable: (r, isNew) => isNew || (r.site_id ? can : d.sysadmin) },
    ],
    save: (rows, reason) => api('/stability/conditions', { method: 'POST', body: { reason, rows: rows.map((r) => {
      const o = { id: r.id, condition_name: r.condition_name, condition_type: r.condition_type, temperature_c: r.temperature_c, temperature_tol: r.temperature_tol, humidity_pct: r.humidity_pct,
        humidity_tol: r.humidity_tol, description: r.description, status: r.status };
      if (!r.id) o.site_id = r.scope === 'Every lab' ? 'all' : undefined;
      return o; }) } }), afterSave: reload });
  const condOpts = d.conditions.filter((x) => x.status === 'Active').map((x) => ({ value: x.id, label: x.condition_name }));
  editableGrid({ el: $('#chg'), rows: d.chambers, allowAdd: can, readOnly: !can, what: 'the stability chambers', newRow: () => ({ status: 'Active' }),
    rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''),
    columns: [
      { field: 'equipment_id', title: 'Equipment', type: 'select', width: 300, required: true, options: d.equipment.map((e) => ({ value: e.id, label: `${e.equipment_name} (${e.equipment_code}, ${e.type_name})` })), editable: (r, isNew) => isNew },
      { field: 'condition_id', title: 'Set to', type: 'select', width: 160, required: true, options: condOpts },
      { field: 'availability', title: 'Equipment status', type: 'readonly', width: 130 },
      { field: 'racks', title: 'Racks', type: 'readonly', width: 60 }, { field: 'stored', title: 'Studies stored', type: 'readonly', width: 105 },
      { field: 'notes', title: 'Notes', width: 220 },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 85 },
    ],
    save: (rows, reason) => api('/stability/chambers', { method: 'POST', body: { reason, rows: rows.map((r) => ({ id: r.id, equipment_id: r.id ? undefined : r.equipment_id, condition_id: r.condition_id, notes: r.notes, status: r.status })) } }),
    afterSave: reload });
  editableGrid({ el: $('#rg'), rows: d.racks, allowAdd: can, readOnly: !can, what: 'the stability racks', newRow: () => ({ status: 'Active' }),
    rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''),
    columns: [
      { field: 'chamber_id', title: 'Chamber', type: 'select', width: 280, required: true, options: d.chambers.map((c) => ({ value: c.id, label: `${c.equipment_name} (${c.condition_name})` })), editable: (r, isNew) => isNew },
      { field: 'rack_code', title: 'Rack', width: 80, required: true }, { field: 'description', title: 'Description', width: 200 },
      { field: 'positions', title: 'Positions', type: 'int', width: 80 }, { field: 'holds', title: 'Holds', type: 'readonly', width: 260 },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 85 },
    ],
    save: (rows, reason) => api('/stability/racks', { method: 'POST', body: { reason, rows: rows.map((r) => ({ id: r.id, chamber_id: r.id ? undefined : r.chamber_id, rack_code: r.rack_code, description: r.description, positions: r.positions, status: r.status })) } }),
    afterSave: reload });
  new Grid($('#ug'), { readOnly: true, search: true, rows: d.upcoming, emptyText: 'No pulls in the next 120 days.', rowClass: (r) => (r.overdue ? 'tbnc' : ''), columns: [
    { field: 'equipment_name', title: 'Chamber', type: 'readonly', width: 230 }, { field: 'scheduled_date', title: 'Pull on', type: 'readonly', width: 105, format: d8 },
    { field: 'study_code', title: 'Study', type: 'link', width: 95, href: (r) => '#/stability/studies/' + r.study_id }, { field: 'client_name', title: 'Client', type: 'readonly', width: 160 },
    { field: 'timepoint_label', title: 'Timepoint', type: 'readonly', width: 85 }, { field: 'where', title: 'Rack / position', type: 'readonly', width: 150, compute: (r) => `${r.rack_code}${r.position ? ' · ' + r.position : ''}` },
    { field: 'units_required', title: 'Units', type: 'readonly', width: 60 }, { field: 'status', title: 'Status', type: 'readonly', width: 90 }] });
}

export const _canStability = () => can('stability.manage');
