// The spreadsheet grid's rules, with no React in them (Grid Data Entry Standard; same behaviour as public/js/grid.js):
// how typed, pasted and filled values are read and checked, how the selection grows and moves, what fill down and paste
// do, and which rows changed. Every change returns a new state; nothing is changed in place.
//
// State: { rows, orig, isNew, errors (per row index: { field: message }), filter, sort {ci, dir}, sel {r1,c1,r2,c2},
//          extra (more ranges added with Ctrl+click), anchor {r, c}, editing {vr, ci, initial} }.
// Selection coordinates are display rows (after filter and sort): vr. Row indexes into state.rows are ri.

export const TRUE_WORDS = ['true', 'yes', 'y', '1', 'x', 'on', 'checked'];
export const NUMERIC = ['number', 'int', 'money', 'pct'];
const READ_ONLY_TYPES = ['readonly', 'button', 'link'];

export const fmt = {
  money: (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' })),
  pct: (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toFixed(2) + '%'),
};

export function initState(rows, filter = '') {
  return { rows: rows.map((r) => ({ ...r })), orig: rows, isNew: rows.map(() => false), errors: {},
    filter, sort: null, sel: null, extra: [], anchor: null, editing: null };
}

// ------------------------------------------------------------------ values
export const optionsOf = (col, row) => (typeof col.options === 'function' ? col.options(row) : (col.options || []))
  .map((x) => (typeof x === 'object' ? x : { value: x, label: x }));

export const valueOf = (col, row) => (col.compute ? col.compute(row) : row[col.field]);

export function parse(col, raw, row) {
  const t = col.type || 'text';
  if (raw === null || raw === undefined) raw = '';
  if (typeof raw !== 'string') return { value: raw };
  const s = raw.trim();
  if (t === 'bool') return { value: TRUE_WORDS.includes(s.toLowerCase()) };
  if (s === '') return col.required ? { value: null, error: 'Required' } : { value: null };
  if (NUMERIC.includes(t)) {
    const n = Number(s.replace(/[$,%\s]/g, ''));
    if (Number.isNaN(n)) return { value: s, error: 'Not a number' };
    if (t === 'int' && !Number.isInteger(n)) return { value: s, error: 'Whole number required' };
    if (col.min !== undefined && n < col.min) return { value: n, error: `Must be at least ${col.min}` };
    if (col.max !== undefined && n > col.max) return { value: n, error: `Must be at most ${col.max}` };
    return { value: n };
  }
  if (t === 'select') {
    const low = s.toLowerCase();
    const hit = optionsOf(col, row).find((o) => String(o.value).toLowerCase() === low || String(o.label).toLowerCase() === low
      || (o.match || []).some((m) => String(m).toLowerCase() === low)); // o.match: other accepted spellings
    return hit ? { value: hit.value } : { value: s, error: 'Not one of the allowed values' };
  }
  if (t === 'array') return { value: s.split(/[;,]/).map((x) => x.trim()).filter(Boolean) };
  if (t === 'time') {
    const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
    if (!m) return { value: s, error: 'Use HH:MM' };
    let h = Number(m[1]); if (m[3]) h = h % 12 + (m[3].toLowerCase() === 'pm' ? 12 : 0);
    return { value: String(h).padStart(2, '0') + ':' + m[2] };
  }
  if (t === 'date') {
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if (m) return { value: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` };
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return { value: `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` };
    return { value: s, error: 'Use YYYY-MM-DD' };
  }
  return { value: s };
}

// What the cell shows
export function display(col, row, hasError) {
  const v = valueOf(col, row);
  if (col.format) return col.format(v, row);
  const t = col.type || 'text';
  if (hasError) return v ?? '';
  if (t === 'money') return fmt.money(v);
  if (t === 'pct') return fmt.pct(v);
  if (t === 'bool') return v ? 'Yes' : 'No';
  if (t === 'array') return (v || []).join(', ');
  if (t === 'select') { const o = optionsOf(col, row).find((x) => x.value === v); return o ? o.label : (v ?? ''); }
  return v ?? '';
}

// What Ctrl+C copies: text that pastes back in unchanged
export function plain(col, row) {
  const v = valueOf(col, row);
  if (v === null || v === undefined) return '';
  if (col.type === 'bool') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.join(', ');
  if (col.type === 'select') return String(display(col, row, false));
  return String(v);
}

export function isEditable(col, row, isNewRow, readOnly) {
  if (readOnly || !col || READ_ONLY_TYPES.includes(col.type || 'text') || (col.compute && !col.assign)) return false;
  if (typeof col.editable === 'function') return !!col.editable(row, isNewRow);
  return col.editable !== false;
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export function isDirty(st, ri, field) {
  const v = st.rows[ri][field];
  if (st.isNew[ri]) return v !== undefined && v !== null && v !== '';
  return !same(v, st.orig[ri][field]);
}

// The rows to save: new rows whole, changed rows as their key plus the changed fields
export function getChanges(st, columns, keyField = 'id') {
  const out = [];
  st.rows.forEach((r, ri) => {
    const changed = columns.filter((c) => c.field && !c.compute && isDirty(st, ri, c.field));
    if (!changed.length) return;
    const row = st.isNew[ri] ? { ...r } : { [keyField]: r[keyField] };
    changed.forEach((c) => { row[c.field] = r[c.field]; });
    out.push(row);
  });
  return out;
}
export const errorCount = (st) => Object.values(st.errors).reduce((n, e) => n + Object.keys(e).length, 0);

// ------------------------------------------------------------------ the view (search filter, then sort)
export function viewOf(st, columns) {
  let idx = st.rows.map((_, i) => i);
  if (st.filter) {
    const f = st.filter.toLowerCase();
    idx = idx.filter((i) => columns.some((c) => String(display(c, st.rows[i], false) ?? '').toLowerCase().includes(f)));
  }
  if (st.sort) {
    const c = columns[st.sort.ci]; const dir = st.sort.dir;
    idx.sort((a, b) => {
      const va = valueOf(c, st.rows[a]); const vb = valueOf(c, st.rows[b]);
      if (va === vb) return 0; if (va === null || va === undefined) return 1; if (vb === null || vb === undefined) return -1;
      return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))) * dir;
    });
  }
  return idx;
}

// ------------------------------------------------------------------ selection
export const norm = (s) => ({ r1: Math.min(s.r1, s.r2), r2: Math.max(s.r1, s.r2), c1: Math.min(s.c1, s.c2), c2: Math.max(s.c1, s.c2) });
export const ranges = (st) => [...st.extra.map(norm), ...(st.sel ? [norm(st.sel)] : [])];
export const inRanges = (rs, vr, ci) => rs.some((g) => vr >= g.r1 && vr <= g.r2 && ci >= g.c1 && ci <= g.c2);
export function selRows(st) {
  const set = new Set();
  ranges(st).forEach((g) => { for (let vr = g.r1; vr <= g.r2; vr++) set.add(vr); });
  return [...set].sort((a, b) => a - b);
}
// every selected cell once: fn(vr, ci)
function eachSel(st, fn) {
  const seen = new Set();
  ranges(st).forEach((g) => { for (let vr = g.r1; vr <= g.r2; vr++) for (let ci = g.c1; ci <= g.c2; ci++) {
    const k = vr + ':' + ci; if (!seen.has(k)) { seen.add(k); fn(vr, ci); } } });
}

// ------------------------------------------------------------------ changes (batched: rows and errors copied once per action)
function draft(st) {
  const rows = st.rows.slice(); const errors = { ...st.errors }; const copied = new Set(); const errCopied = new Set();
  return {
    rows, errors,
    row(ri) { if (!copied.has(ri)) { rows[ri] = { ...rows[ri] }; copied.add(ri); } return rows[ri]; },
    setError(ri, field, msg) {
      if (!errCopied.has(ri) || !errors[ri]) { errors[ri] = { ...(errors[ri] || {}) }; errCopied.add(ri); }
      if (msg) errors[ri][field] = msg; else delete errors[ri][field];
      if (!Object.keys(errors[ri]).length) delete errors[ri];
    },
  };
}

// Write one cell (typed, pasted or filled), checked like a typed value. Returns false when the cell cannot be changed.
function writeCell(d, st, ctx, ri, ci, raw, parsed) {
  const col = ctx.columns[ci];
  if (!isEditable(col, d.rows[ri], st.isNew[ri], ctx.readOnly)) return false;
  const res = parsed || parse(col, raw, d.rows[ri]);
  let err = res.error;
  if (!err && col.validate) err = col.validate(res.value, d.rows[ri]) || null;
  const row = d.row(ri);
  // a computed column with assign(row, value) sets the fields it is computed from
  if (col.assign) { if (!err && res.value !== null && res.value !== undefined && res.value !== '') col.assign(row, res.value); }
  else row[col.field] = res.value;
  d.setError(ri, col.field, err || null);
  return true;
}
const done = (st, d, extra = {}) => ({ ...st, rows: d.rows, errors: d.errors, ...extra });
const copyVal = (v) => (Array.isArray(v) ? [...v] : v);

// Ctrl+D. One block: the top row's values go down the block (a single row takes the row above).
// Several blocks (Ctrl+click): each column's first selected value goes into its other selected cells.
export function fillDown(st, ctx) {
  if (ctx.readOnly || !st.sel) return st;
  const v = ctx.view; const d = draft(st);
  const fromRow = (sRi, ci, ri) => {
    const col = ctx.columns[ci]; if (!col.field) return;
    writeCell(d, st, ctx, ri, ci, null, { value: copyVal(d.rows[sRi][col.field]), error: st.errors[sRi]?.[col.field] });
  };
  if (st.extra.length) {
    const byCol = new Map(); eachSel(st, (vr, ci) => { if (!byCol.has(ci)) byCol.set(ci, []); byCol.get(ci).push(vr); });
    byCol.forEach((vrs, ci) => { vrs.sort((a, b) => a - b); vrs.slice(1).forEach((vr) => fromRow(v[vrs[0]], ci, v[vr])); });
    return done(st, d);
  }
  let { r1, r2, c1, c2 } = norm(st.sel);
  let src = r1;
  if (r1 === r2) { if (r1 === 0) return st; src = r1 - 1; } else r1 += 1;
  for (let ci = c1; ci <= c2; ci++) for (let vr = r1; vr <= r2; vr++) fromRow(v[src], ci, v[vr]);
  return done(st, d);
}

// Ctrl+V of text copied from Excel (tabs between cells, new lines between rows). One value fills the whole selection;
// a block starts at the selection's top-left (adding rows when allowed); several blocks take the selected rows in order.
export function paste(st, ctx, text) {
  if (!text || ctx.readOnly || !st.sel) return st;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const data = lines.map((l) => l.split('\t'));
  const nCols = ctx.columns.length;
  if (data.length === 1 && data[0].length === 1) {
    const d = draft(st); eachSel(st, (vr, ci) => writeCell(d, st, ctx, ctx.view[vr], ci, data[0][0]));
    return done(st, d);
  }
  if (st.extra.length) {
    const d = draft(st); const rowsSel = selRows(st); const c0 = Math.min(...ranges(st).map((g) => g.c1));
    data.forEach((cells, i) => { const vr = rowsSel[i]; if (vr === undefined) return;
      cells.forEach((val, j) => { if (c0 + j < nCols) writeCell(d, st, ctx, ctx.view[vr], c0 + j, val); }); });
    return done(st, d);
  }
  const { r1, c1 } = norm(st.sel);
  let base = st; let view = ctx.view;
  const need = r1 + data.length - view.length;
  if (need > 0 && ctx.allowAdd && !st.filter && !st.sort) { base = addRows(st, ctx, need); view = base.rows.map((_, i) => i); }
  const d = draft(base);
  data.forEach((cells, i) => { const vr = r1 + i; if (vr >= view.length) return;
    cells.forEach((val, j) => { if (c1 + j < nCols) writeCell(d, base, ctx, view[vr], c1 + j, val); }); });
  const sel = { r1, c1, r2: Math.min(view.length - 1, r1 + data.length - 1), c2: Math.min(nCols - 1, c1 + data[0].length - 1) };
  return done(base, d, { sel, extra: [] });
}

// After an autosave: the saved rows become the new starting point (no longer changed), without redrawing the grid afresh
export function markSaved(st, ctx, keys, keyField = 'id') {
  const saved = new Set(keys);
  let orig = st.orig; let isNew = st.isNew;
  st.rows.forEach((r, ri) => {
    if (!saved.has(r[keyField])) return;
    if (orig === st.orig) { orig = orig.slice(); isNew = isNew.slice(); }
    orig[ri] = { ...r }; isNew[ri] = false;
  });
  return orig === st.orig ? st : { ...st, orig, isNew };
}

// n empty rows (from newRow), or the given rows (e.g. tests picked in a dialog), as new rows
export function addRows(st, ctx, n = 1) {
  if (ctx.readOnly || !ctx.allowAdd) return st;
  const base = () => ({ ...(ctx.newRow ? ctx.newRow() : {}) });
  const added = Array.isArray(n) ? n.map((r) => ({ ...base(), ...r })) : Array.from({ length: n }, base);
  return { ...st, rows: [...st.rows, ...added], orig: [...st.orig, ...added.map((r) => ({ ...r }))], isNew: [...st.isNew, ...added.map(() => true)] };
}

export function setCell(st, ctx, vr, ci, raw, parsed) {
  const d = draft(st);
  return writeCell(d, st, ctx, ctx.view[vr], ci, raw, parsed) ? done(st, d) : st;
}

// Delete / Backspace: clears every selected cell (tick boxes become unticked)
export function clearSel(st, ctx) {
  const d = draft(st);
  eachSel(st, (vr, ci) => writeCell(d, st, ctx, ctx.view[vr], ci, ctx.columns[ci].type === 'bool' ? 'no' : ''));
  return done(st, d);
}

// Space on a tick box: every selected tick box takes the opposite of the anchor's
export function toggleSel(st, ctx) {
  const a = st.anchor; const col = ctx.columns[a.c]; if (col.type !== 'bool') return st;
  const val = !st.rows[ctx.view[a.r]][col.field]; const d = draft(st);
  eachSel(st, (vr, ci) => { if (ctx.columns[ci].type === 'bool') writeCell(d, st, ctx, ctx.view[vr], ci, null, { value: val }); });
  return done(st, d);
}

// Arrow keys and Tab: move the anchor (or, with Shift, the far corner of the block), staying inside the grid
export function move(st, ctx, dr, dc, extend) {
  if (!st.anchor) return st;
  const maxR = ctx.view.length - 1; const maxC = ctx.columns.length - 1;
  const clamp = (x, max) => Math.max(0, Math.min(max, x));
  if (extend) return { ...st, extra: [], sel: { ...st.sel, r2: clamp(st.sel.r2 + dr, maxR), c2: clamp(st.sel.c2 + dc, maxC) } };
  const r = clamp(st.anchor.r + dr, maxR); const c = clamp(st.anchor.c + dc, maxC);
  return { ...st, extra: [], anchor: { r, c }, sel: { r1: r, c1: c, r2: r, c2: c } };
}

// A mouse press on a cell: a plain click selects it; Shift extends; Ctrl adds (or takes out a selected cell); Ctrl+Shift adds a block
export function pressCell(st, vr, ci, { shift, ctrl }) {
  const one = { r1: vr, c1: ci, r2: vr, c2: ci };
  if (ctrl && !shift && st.sel && inRanges(ranges(st), vr, ci)) {
    const rs = ranges(st).filter((g) => !(vr >= g.r1 && vr <= g.r2 && ci >= g.c1 && ci <= g.c2));
    if (!rs.length) return { ...st, sel: null, extra: [], anchor: null };
    const sel = rs.pop(); return { ...st, sel, extra: rs, anchor: { r: sel.r1, c: sel.c1 } };
  }
  if (ctrl && st.sel) {
    if (shift && st.anchor) return { ...st, sel: { r1: st.anchor.r, c1: st.anchor.c, r2: vr, c2: ci } };
    return { ...st, extra: [...st.extra, st.sel], anchor: { r: vr, c: ci }, sel: one };
  }
  if (shift && st.anchor) return { ...st, sel: { r1: st.anchor.r, c1: st.anchor.c, r2: vr, c2: ci } };
  return { ...st, extra: [], anchor: { r: vr, c: ci }, sel: one };
}
