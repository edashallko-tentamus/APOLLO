import { Grid } from '../grid.js';
import { toast, askReason, signDialog, setDirtyCheck, esc, api } from '../app.js';

// An editable grid with a Save bar: one Reason for Change covers the whole save.
// opts: { el, columns, rows, allowAdd, newRow, search, needReason (default true), what, sign ({meaning, action} or fn(rows)),
//   save(rows, reason, signature), afterSave(), onChange }
export function editableGrid(opts) {
  const el = opts.el;
  el.innerHTML = `<div class="savebar"><span class="pending"></span><button class="btn ghost" data-undo>Discard changes</button><button class="btn primary" data-save>Save changes</button></div><div class="gridhost"></div>`;
  const bar = el.querySelector('.savebar');
  const grid = new Grid(el.querySelector('.gridhost'), {
    columns: opts.columns, rows: opts.rows, allowAdd: opts.allowAdd, newRow: opts.newRow, search: opts.search, filter: opts.filter, rowClass: opts.rowClass,
    readOnly: opts.readOnly, onRowOpen: opts.onRowOpen, toolbar: opts.toolbar, emptyText: opts.emptyText,
    onChange: (g) => { update(); if (opts.onChange) opts.onChange(g); },
  });
  function update() {
    const n = grid.changeCount(); const e = grid.errors.size;
    bar.classList.toggle('show', n > 0 || e > 0);
    bar.querySelector('.pending').innerHTML = `${n} row${n === 1 ? '' : 's'} changed${e ? ` · <b class="bad">${e} cell${e === 1 ? '' : 's'} need fixing (red)</b>` : ''}`;
  }
  setDirtyCheck(() => grid.changeCount() > 0);
  bar.querySelector('[data-undo]').onclick = () => { grid.setRows(opts.rows); update(); };
  bar.querySelector('[data-save]').onclick = async () => {
    if (grid.hasErrors()) { toast('Fix the cells marked in red first (hover a red cell to see why).', 'err'); return; }
    const rows = grid.getChanges(); if (!rows.length) return;
    const s = typeof opts.sign === 'function' ? opts.sign(rows) : opts.sign; // null: this save needs no signature
    if (s) {
      // Signed save: one signature (and a reason when existing rows change) covers the whole save
      const done = await signDialog({ what: s.action || opts.what, meaning: s.meaning || 'Changed by', needReason: opts.needReason !== false && rows.some((r) => r.id),
        submit: ({ reason, signature }) => opts.save(rows, reason, signature) });
      if (!done) return;
      toast(`Saved and signed: ${rows.length} row${rows.length === 1 ? '' : 's'}.`);
      setDirtyCheck(null);
      if (opts.afterSave) await opts.afterSave();
      return;
    }
    let reason = '';
    if (opts.needReason !== false) { reason = await askReason(opts.what || 'these records'); if (reason === null) return; }
    try {
      await opts.save(rows, reason);
      toast(`Saved ${rows.length} row${rows.length === 1 ? '' : 's'}.`);
      setDirtyCheck(null);
      if (opts.afterSave) await opts.afterSave();
    } catch (e) { toast(e.message, 'err'); }
  };
  update();
  // Autosave (0.27.0, Alex: "make the weights automatically saved with any entry"): a short pause after a change
  // (a typed cell, a paste, a fill down) saves it; opts.save asks for a reason when it is a correction. Saved rows
  // become the grid's new starting point, so the page is not redrawn under the person typing. opts.autosaved(rows)
  // lets the caller note what is now recorded. grid.flush() saves anything still waiting (before completing a step).
  if (opts.autosave && !opts.readOnly) {
    const keyField = () => grid.o.keyField || 'id';
    let timer = null; let running = null; let again = false;
    const note = (t, bad) => { let n = el.querySelector('.autosaved'); if (!n) { n = document.createElement('div'); n.className = 'autosaved'; el.insertBefore(n, el.querySelector('.gridhost')); } n.textContent = t; n.classList.toggle('bad', !!bad); };
    bar.querySelector('[data-save]').textContent = 'Save now';
    const run = async () => {
      timer = null;
      if (running) { again = true; return running; }
      if (grid.hasErrors()) { note('Not saved yet: fix the cells marked in red.', true); return null; }
      const rows = grid.getChanges(); if (!rows.length) return null;
      running = (async () => {
        try {
          await opts.save(rows, '');
          const k = keyField(); const saved = new Set(rows.map((r) => r[k]));
          grid.rows.forEach((r, ri) => { if (saved.has(r[k])) grid.orig[ri] = { ...r }; });
          if (opts.autosaved) opts.autosaved(rows);
          note(`Saved automatically at ${new Date().toLocaleTimeString([], { timeStyle: 'short' })}`);
          setDirtyCheck(() => grid.changeCount() > 0);
          grid.render(); update();
        } catch (e) { note(`Not saved: ${e.message}`, true); toast(e.message, 'err'); }
      })();
      try { await running; } finally { running = null; }
      if (again) { again = false; return run(); }
      return null;
    };
    const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(run, opts.autosaveDelay || 900); };
    const prev = grid.o.onChange;
    grid.o.onChange = (g) => { if (prev) prev(g); if (g.changeCount() > 0) schedule(); };
    grid.flush = async () => { if (timer) { clearTimeout(timer); timer = null; } await run(); if (running) await running; return grid.changeCount() === 0; };
    // "Save now": the same save (never twice), then the page as after any save
    bar.querySelector('[data-save]').onclick = async () => {
      if (grid.hasErrors()) { toast('Fix the cells marked in red first (hover a red cell to see why).', 'err'); return; }
      const n = grid.changeCount(); if (!n) return;
      if (await grid.flush()) { toast(`Saved ${n} row${n === 1 ? '' : 's'}.`); setDirtyCheck(null); if (opts.afterSave) await opts.afterSave(); }
    };
  } else {
    grid.flush = async () => grid.changeCount() === 0;
  }
  return grid;
}

export function section(title, help = '', actions = '') {
  return `<div class="shead"><div><h2>${esc(title)}</h2>${help ? `<div class="help">${help}</div>` : ''}</div><div>${actions}</div></div>`;
}

// Specifications of a quoted test or a requested test (migration 012): one row per analyte of the test version.
// Empty = unspecified (the client gets the result as it is). The lab's suggested limits are offered, never applied by themselves.
// owner: { quoted_line } or { requested_test }
export async function specDialog(owner, done) {
  const q = owner.quoted_line ? 'quoted_line=' + owner.quoted_line : 'requested_test=' + owner.requested_test;
  let d; try { d = await api('/specs?' + q); } catch (e) { toast(e.message, 'err'); return; }
  const o = d.owner; const ed = !!o.editable;
  const fmtS = (a) => [a.default_spec_min !== null && a.default_spec_min !== undefined ? `min ${a.default_spec_min}` : '', a.default_spec_max !== null && a.default_spec_max !== undefined ? `max ${a.default_spec_max}` : '', a.default_spec_text || ''].filter(Boolean).join(', ');
  const rows = d.analytes.map((a) => { const s = d.specs.find((x) => x.analyte_id === a.analyte_id) || {};
    return { key: a.analyte_id, analyte_id: a.analyte_id, analyte_name: a.analyte_name, result_type: a.result_type, suggested: fmtS(a), a,
      spec_id: s.id || null, min_value: s.min_value ?? null, max_value: s.max_value ?? null, text_value: s.text_value ?? null, unit: s.unit || (s.id ? null : a.reporting_unit), source: s.source || 'Client', basis: s.basis || 'As reported' }; });
  const m = document.createElement('div'); m.className = 'modal-bg';
  m.innerHTML = `<div class="modal xwide"><h3>Specifications: ${esc(o.test_code)} ${esc(o.test_name)}${o.sample_code ? ' on ' + esc(o.sample_code) : ''}</h3>
    <p class="intro">Limits for each analyte. Leave a row empty for <b>unspecified</b>: the client then receives the result as it is, without a pass or fail.
    ${o.kind === 'quoted_line' ? 'Limits set on the quote are copied to every test ordered from it.' : 'Limits set here apply to this ordered test only.'}
    ${ed ? '' : '<br><b>Read only</b> (' + (o.kind === 'quoted_line' ? 'the quote is issued, or you cannot change quotes' : 'you cannot change this order\'s tests') + ').'}</p>
    ${d.analytes.length ? '' : '<div class="notice">This test has no analytes in its effective version yet, so no limits can be set.</div>'}
    <div class="actbar">${ed ? '<button class="btn" id="sp_sugg">Use the lab\'s suggested limits for empty rows</button>' : ''}</div>
    <div id="sp_g"></div><div class="merr"></div>
    <div class="mbtns"><button class="btn ghost" data-x>${ed ? 'Cancel' : 'Close'}</button>${ed ? '<button class="btn primary" data-ok>Save</button>' : ''}</div></div>`;
  document.body.appendChild(m);
  const { Grid } = await import('../grid.js');
  const g = new Grid(m.querySelector('#sp_g'), { rows, keyField: 'key', readOnly: !ed, emptyText: 'No analytes.', columns: [
    { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 210 },
    { field: 'result_type', title: 'Result', type: 'readonly', width: 95 },
    { field: 'min_value', title: 'Minimum', type: 'number', width: 95 },
    { field: 'max_value', title: 'Maximum', type: 'number', width: 95 },
    { field: 'text_value', title: 'Text limit', width: 140, help: 'For qualitative results, e.g. Absent in 10 g' },
    { field: 'unit', title: 'Unit', width: 80 },
    // migration 031: a limit per serving (e.g. 1 mg per serving) or per package (10 mg per package), from the sample's serving
    { field: 'basis', title: 'Limit is', type: 'select', options: ['As reported', 'Per serving', 'Per package'], width: 115,
      help: 'As reported: against the result. Per serving: the result times the serving weight (unit e.g. mg). Per package: per serving times the servings per package. The sample needs its serving on the order.' },
    { field: 'source', title: 'Set by', type: 'select', options: ['Client', 'Lab', 'Client portal'], width: 110, help: 'Client: the client\'s own limit (the lab reports against it). Lab: the lab proposed it.' },
    { field: 'suggested', title: 'Lab\'s suggested limit', type: 'readonly', width: 230 },
  ] });
  const close = (v) => { g.destroy(); m.remove(); if (v && done) done(); };
  m.querySelector('[data-x]').onclick = () => close(false);
  const sugg = m.querySelector('#sp_sugg');
  if (sugg) sugg.onclick = () => {
    g.rows.forEach((r, i) => { if (r.min_value === null && r.max_value === null && !r.text_value && r.suggested) {
      Object.assign(g.rows[i], { min_value: r.a.default_spec_min ?? null, max_value: r.a.default_spec_max ?? null, text_value: r.a.default_spec_text || null, unit: r.a.reporting_unit || null, source: 'Lab' }); } });
    g.render(); g.o.onChange?.(g);
  };
  const ok = m.querySelector('[data-ok]');
  if (ok) ok.onclick = async () => {
    if (g.hasErrors()) { m.querySelector('.merr').textContent = 'Fix the cells marked in red first.'; return; }
    const changed = new Set(g.getChanges().map((x) => x.key));
    const out = [];
    for (const r of g.rows.filter((x) => changed.has(x.key))) {
      const empty = (r.min_value === null || r.min_value === '') && (r.max_value === null || r.max_value === '') && !String(r.text_value || '').trim();
      if (r.spec_id && empty) out.push({ id: r.spec_id, status: 'Inactive' });
      else if (r.spec_id) out.push({ id: r.spec_id, min_value: r.min_value, max_value: r.max_value, text_value: r.text_value, unit: r.unit, source: r.source, basis: r.basis });
      else if (!empty) out.push({ analyte_id: r.analyte_id, min_value: r.min_value, max_value: r.max_value, text_value: r.text_value, unit: r.unit, source: r.source, basis: r.basis });
    }
    if (!out.length) { close(false); return; }
    let reason = '';
    if (o.kind === 'requested_test' && out.some((x) => x.id)) { reason = await askReason('the specifications of ' + o.test_code); if (reason === null) return; }
    try { await api('/specs', { method: 'POST', body: { ...owner, rows: out, reason } }); toast('Specifications saved.'); close(true); }
    catch (e) { m.querySelector('.merr').textContent = e.message; }
  };
}
