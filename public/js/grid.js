// Spreadsheet-style grid (Grid Data Entry Standard):
//  - click / drag / Shift+click to select ranges, arrows to move (Shift extends)
//  - Ctrl+click adds a cell (or removes it if already selected); Ctrl+Shift+click adds a block: a scattered selection.
//    Copy, paste, fill down, Delete, Space and selectedRows() follow every selected cell (fill down copies the first
//    selected row's value into the other selected rows; paste fills the selected rows top to bottom)
//  - Ctrl+D fills down, Ctrl+C / Ctrl+V copy and paste (works with Excel)
//  - type to edit, Enter or F2 to edit, Delete clears, Space toggles checkboxes
//  - pasted and filled values are validated like typed values; bad cells turn red
//  - edited cells are highlighted until saved
//  - pick-list cells are smart dropdowns: type to filter, Down arrow for the list (see combo.js)
//  - link columns with href() are real links (copy, open in a new tab, share); links(row) -> [{text, href, after}] puts
//    several links in one cell (copy still gives the column's plain text)
//  - optional detail rows (opts.detail) show a panel under a row, e.g. a sample's tests
import { Combo, rankOptions } from './combo.js';
const TRUE_WORDS = ['true', 'yes', 'y', '1', 'x', 'on', 'checked'];
const NUMERIC = ['number', 'int', 'money', 'pct'];

export const fmt = {
  money: (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' })),
  pct: (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toFixed(2) + '%'),
  num: (v) => (v === null || v === undefined || v === '' ? '' : String(v)),
};

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export class Grid {
  constructor(el, opts) {
    this.el = el;
    this.o = Object.assign({ allowAdd: false, readOnly: false, search: false, newRow: () => ({}), keyField: 'id', emptyText: 'No rows yet.' }, opts);
    this.cols = this.o.columns;
    this.filter = this.o.filter || '';
    this.sort = null;
    this._details = new Map(); // detail panels, kept between renders so their contents survive
    this.setRows(this.o.rows || []);
    this._bindDocument();
  }

  // ---------------------------------------------------------------- data
  setRows(rows) {
    this.rows = rows.map((r) => ({ ...r }));
    this.orig = this.rows.map((r) => ({ ...r }));
    this.isNew = this.rows.map(() => false);
    this.errors = new Map();
    this.sel = null; this.anchor = null; this.editing = null; this.extra = [];   // extra: more ranges added with Ctrl+click
    this._view(); this.render();
  }
  addRows(n = 1) {
    for (let i = 0; i < n; i++) {
      const r = { ...this.o.newRow() };
      this.rows.push(r); this.orig.push({ ...r }); this.isNew.push(true);
    }
    this._view(); this.render(); this._changed();
  }
  editable(ri, ci) {
    const c = this.cols[ci];
    if (this.o.readOnly || !c || ['readonly', 'button', 'link'].includes(c.type || 'text') || c.compute) return false;
    if (typeof c.editable === 'function') return !!c.editable(this.rows[ri], this.isNew[ri]);
    return c.editable !== false;
  }
  isDirty(ri, f) {
    if (this.isNew[ri]) return this.rows[ri][f] !== undefined && this.rows[ri][f] !== null && this.rows[ri][f] !== '';
    return JSON.stringify(this.rows[ri][f] ?? null) !== JSON.stringify(this.orig[ri][f] ?? null);
  }
  getChanges() {
    const out = [];
    this.rows.forEach((r, ri) => {
      const changed = this.cols.filter((c) => c.field && !c.compute && this.isDirty(ri, c.field));
      if (!this.isNew[ri] && !changed.length) return;
      if (this.isNew[ri] && !changed.length) return;
      const row = this.isNew[ri] ? { ...r } : { [this.o.keyField]: r[this.o.keyField] };
      changed.forEach((c) => { row[c.field] = r[c.field]; });
      out.push(row);
    });
    return out;
  }
  hasErrors() { return this.errors.size > 0; }
  // The rows the selection covers (whole rows, in display order); empty when nothing is selected
  selectedRows() {
    if (!this.sel) return [];
    return this._selRows().map((vr) => this.rows[this.v[vr]]);
  }
  // every selected range (the active one last), normalized
  _ranges() {
    const n = (s) => ({ r1: Math.min(s.r1, s.r2), r2: Math.max(s.r1, s.r2), c1: Math.min(s.c1, s.c2), c2: Math.max(s.c1, s.c2) });
    return [...this.extra.map(n), ...(this.sel ? [n(this.sel)] : [])];
  }
  _scattered() { return this.extra.length > 0; }
  // the selected display rows, top to bottom, each once
  _selRows() { const set = new Set(); this._ranges().forEach((g) => { for (let vr = g.r1; vr <= g.r2; vr++) set.add(vr); }); return [...set].sort((a, b) => a - b); }
  _clearExtra() { this.extra = []; }
  changeCount() { return this.getChanges().length; }

  parse(col, raw, row) {
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
      const opts = this._options(col, row);
      const hit = opts.find((o) => String(o.value).toLowerCase() === s.toLowerCase() || String(o.label).toLowerCase() === s.toLowerCase()
        || (o.match || []).some((m) => String(m).toLowerCase() === s.toLowerCase())); // o.match: other accepted spellings (e.g. a code or a name without its CAS)
      return hit ? { value: hit.value } : { value: s, error: 'Not one of the allowed values' };
    }
    if (t === 'array') return { value: s.split(/[;,]/).map((x) => x.trim()).filter(Boolean) };
    if (t === 'time') {
      const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
      if (!m) return { value: s, error: 'Use HH:MM' };
      let h = Number(m[1]); if (m[3]) { h = h % 12 + (m[3].toLowerCase() === 'pm' ? 12 : 0); }
      return { value: String(h).padStart(2, '0') + ':' + m[2] };
    }
    if (t === 'date') {
      let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if (m) return { value: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` };
      m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return { value: `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` };
      return { value: s, error: 'Use YYYY-MM-DD' };
    }
    return { value: s };
  }
  setCell(ri, ci, raw, { parsed } = {}) {
    if (!this.editable(ri, ci)) return false;
    const col = this.cols[ci];
    const res = parsed || this.parse(col, raw, this.rows[ri]);
    let err = res.error;
    if (!err && col.validate) err = col.validate(res.value, this.rows[ri]) || null;
    this.rows[ri][col.field] = res.value;
    const key = ri + ':' + col.field;
    if (err) this.errors.set(key, err); else this.errors.delete(key);
    return true;
  }

  // ---------------------------------------------------------------- view (filter + sort)
  _view() {
    let idx = this.rows.map((_, i) => i);
    if (this.filter) {
      const f = this.filter.toLowerCase();
      idx = idx.filter((i) => this.cols.some((c) => String(this._display(i, c) ?? '').toLowerCase().includes(f)));
    }
    if (this.sort) {
      const c = this.cols[this.sort.ci]; const dir = this.sort.dir;
      idx.sort((a, b) => {
        const va = c.compute ? c.compute(this.rows[a]) : this.rows[a][c.field];
        const vb = c.compute ? c.compute(this.rows[b]) : this.rows[b][c.field];
        if (va === vb) return 0; if (va === null || va === undefined) return 1; if (vb === null || vb === undefined) return -1;
        return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))) * dir;
      });
    }
    this.v = idx;
  }
  _options(col, row) {
    const o = typeof col.options === 'function' ? col.options(row) : (col.options || []);
    return o.map((x) => (typeof x === 'object' ? x : { value: x, label: x }));
  }
  _display(ri, col) {
    const row = this.rows[ri];
    const v = col.compute ? col.compute(row) : row[col.field];
    if (col.format) return col.format(v, row);
    const t = col.type || 'text';
    if (this.errors.has(ri + ':' + col.field)) return v;
    if (t === 'money') return fmt.money(v);
    if (t === 'pct') return fmt.pct(v);
    if (t === 'bool') return v ? 'Yes' : 'No';
    if (t === 'array') return (v || []).join(', ');
    if (t === 'select') { const o = this._options(col, row).find((x) => x.value === v); return o ? o.label : (v ?? ''); }
    return v ?? '';
  }
  _plain(ri, col) { // value used for copy (re-pastable)
    const v = col.compute ? col.compute(this.rows[ri]) : this.rows[ri][col.field];
    if (v === null || v === undefined) return '';
    if ((col.type || '') === 'bool') return v ? 'Yes' : 'No';
    if (Array.isArray(v)) return v.join(', ');
    if ((col.type || '') === 'select') return this._display(ri, col);
    return String(v);
  }

  // ---------------------------------------------------------------- render
  render() {
    const head = this.cols.map((c, ci) => `<th data-ci="${ci}" style="${c.width ? 'width:' + c.width + 'px' : ''}" class="${NUMERIC.includes(c.type) || c.align === 'right' ? 'num' : ''}" title="${esc(c.help || '')}">${esc(c.title)}${this.sort && this.sort.ci === ci ? (this.sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
    const body = this.v.map((ri, vr) => {
      const row = this.rows[ri];
      const rc = (this.o.rowClass ? this.o.rowClass(row) : '') + (this.isNew[ri] ? ' new' : '');
      const tds = this.cols.map((c, ci) => {
        const t = c.type || 'text';
        const cls = [NUMERIC.includes(t) || c.align === 'right' ? 'num' : '', this.editable(ri, ci) ? 'ed' : 'ro',
          c.field && this.isDirty(ri, c.field) && !this.isNew[ri] ? 'dirty' : '',
          this.errors.has(ri + ':' + c.field) ? 'err' : '', this._inSel(vr, ci) ? 'sel' : '',
          this.anchor && this.anchor.r === vr && this.anchor.c === ci ? 'anchor' : '', c.cellClass ? c.cellClass(row) : ''].join(' ');
        let inner;
        if (t === 'bool') inner = `<span class="chk ${row[c.field] ? 'on' : ''}">${row[c.field] ? '✓' : ''}</span>`;
        else if (t === 'button') { const bl = typeof c.label === 'function' ? c.label(row) : c.label; inner = bl ? `<button class="mini" data-btn="${ci}">${esc(bl)}</button>` : ''; }
        else if (c.links) {
          // several records in one cell, each a link (e.g. the equipment or lots used), with optional text after each
          const ls = c.links(row) || [];
          inner = ls.length ? ls.map((l) => (l.href ? `<a href="${esc(l.href)}" data-link="${ci}">${esc(l.text)}</a>` : esc(l.text)) + (l.after ? ' ' + esc(l.after) : '')).join(', ')
            : esc(this._display(ri, c));
        } else if (t === 'link') {
          const href = c.href ? c.href(row) : '#';
          inner = href ? `<a href="${esc(href)}" data-link="${ci}">${esc(this._display(ri, c))}</a>` : esc(this._display(ri, c));
        } else {
          // any column can show its value as a link to a record (still editable from the keyboard)
          const href = c.href && !this.errors.has(ri + ':' + c.field) ? c.href(row) : null;
          inner = href ? `<a href="${esc(href)}" data-link="${ci}">${esc(this._display(ri, c))}</a>` : esc(this._display(ri, c));
        }
        const tip = this.errors.get(ri + ':' + c.field);
        return `<td data-vr="${vr}" data-ci="${ci}" class="${cls}"${tip ? ` title="${esc(tip)}"` : ''}>${inner}</td>`;
      }).join('');
      const d = this.o.detail;
      const open = d && d.open(row) ? `<tr class="gdetail"><td colspan="${this.cols.length}" data-dkey="${esc(d.key(row))}"></td></tr>` : '';
      return `<tr class="${rc}">${tds}</tr>${open}`;
    }).join('');
    const top = this.o.search || this.o.allowAdd || this.o.toolbar ? `<div class="gtool">
      ${this.o.search ? `<input class="gsearch" placeholder="Search…" value="${esc(this.filter)}">` : ''}
      ${this.o.allowAdd && !this.o.readOnly ? '<button class="mini" data-add="1">+ Add row</button><button class="mini" data-add="10">+10 rows</button>' : ''}
      <span class="ghint">${this.o.readOnly ? '' : 'Ctrl+D fill down · Ctrl+C / Ctrl+V copy and paste (Excel) · Enter or type to edit'}</span>
      ${this.o.toolbar || ''}</div>` : '';
    const empty = !this.v.length ? `<div class="gempty">${esc(this.o.emptyText)}</div>` : '';
    const oldWrap = this.el.querySelector('.gwrap');
    const scroll = oldWrap?.scrollTop || 0;
    const hadFocus = !!oldWrap && (document.activeElement === oldWrap || oldWrap.contains(document.activeElement));
    this.el.innerHTML = `${top}<div class="gwrap" tabindex="0"><table class="grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${empty}</div>`;
    this.wrap = this.el.querySelector('.gwrap'); this.wrap.scrollTop = scroll;
    this._mountDetails();
    this._bindLocal();
    if (hadFocus) this.wrap.focus({ preventScroll: true });
  }
  _mountDetails() {
    const d = this.o.detail; if (!d) return;
    const width = Math.max(320, this.wrap.clientWidth - 2);
    this.wrap.querySelectorAll(':scope > table.grid > tbody > tr.gdetail > td').forEach((td) => {
      const key = td.dataset.dkey; let node = this._details.get(key);
      if (!node) {
        const row = this.rows.find((r) => String(d.key(r)) === key); if (!row) return;
        node = document.createElement('div'); node.className = 'gdetail-in';
        this._details.set(key, node); d.render(row, node);
      }
      node.style.width = width + 'px';
      td.appendChild(node);
    });
  }
  dropDetail(key) { this._details.delete(String(key)); }
  detailNodes() { return [...this._details.values()]; }
  _tds() { return this.wrap.querySelectorAll(':scope > table.grid > tbody > tr > td[data-vr]'); }
  _td(vr, ci) { return this.wrap.querySelector(`:scope > table.grid > tbody > tr > td[data-vr="${vr}"][data-ci="${ci}"]`); }
  _own(e) { const w = e.target.closest('.gwrap'); return w === this.wrap; } // ignore events from grids nested in detail rows
  _inSel(vr, ci) {
    if (!this.sel) return false;
    return this._ranges().some((g) => vr >= g.r1 && vr <= g.r2 && ci >= g.c1 && ci <= g.c2);
  }
  _norm() {
    const s = this.sel;
    return { r1: Math.min(s.r1, s.r2), r2: Math.max(s.r1, s.r2), c1: Math.min(s.c1, s.c2), c2: Math.max(s.c1, s.c2) };
  }

  // ---------------------------------------------------------------- events
  _bindLocal() {
    const w = this.wrap; let dragging = false;
    const s = this.el.querySelector('.gsearch');
    if (s) s.addEventListener('input', () => { this.filter = s.value; this._view(); this.render(); const n = this.el.querySelector('.gsearch'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
    this.el.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => this.addRows(Number(b.dataset.add))));
    this.el.querySelectorAll('th').forEach((th) => th.addEventListener('click', () => {
      const ci = Number(th.dataset.ci);
      this.sort = this.sort && this.sort.ci === ci ? (this.sort.dir > 0 ? { ci, dir: -1 } : null) : { ci, dir: 1 };
      this._view(); this.render();
    }));
    w.addEventListener('mousedown', (e) => {
      if (!this._own(e)) return;
      const td = e.target.closest('td'); if (!td || td.dataset.vr === undefined) return;
      if (e.target.closest('input,select')) return;
      const vr = Number(td.dataset.vr); const ci = Number(td.dataset.ci);
      if (e.button === 2 && this._inSel(vr, ci)) return; // right-click inside the selection keeps it (for a page's context menu)
      if (e.target.closest('[data-btn]')) { e.preventDefault(); const c = this.cols[ci]; c.onClick && c.onClick(this.rows[this.v[vr]]); return; }
      const lk = e.target.closest('[data-link]');
      if (lk && lk.getAttribute('href') !== '#') return; // a real link: let the browser follow it
      if (lk) { e.preventDefault(); const c = this.cols[ci]; c.onClick && c.onClick(this.rows[this.v[vr]]); return; }
      this._commitEdit();
      if (e.target.closest('.chk') && this.editable(this.v[vr], ci) && !e.shiftKey) {
        const ri = this.v[vr]; this.setCell(ri, ci, null, { parsed: { value: !this.rows[ri][this.cols[ci].field] } });
        this._clearExtra(); this.anchor = { r: vr, c: ci }; this.sel = { r1: vr, c1: ci, r2: vr, c2: ci }; this.render(); this._changed(); this.wrap.focus(); return;
      }
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && !e.shiftKey && this.sel && this._inSel(vr, ci)) {   // Ctrl+click on a selected cell: take it out
        const rs = this._ranges().filter((g) => !(vr >= g.r1 && vr <= g.r2 && ci >= g.c1 && ci <= g.c2));
        if (rs.length) { this.sel = rs.pop(); this.extra = rs; this.anchor = { r: this.sel.r1, c: this.sel.c1 }; } else { this.sel = null; this.extra = []; this.anchor = null; }
        this._paintSel(); w.focus(); e.preventDefault(); return;
      }
      if (ctrl && this.sel) {   // Ctrl+click (or Ctrl+Shift+click): keep what is selected and add to it
        if (e.shiftKey && this.anchor) this.sel = { r1: this.anchor.r, c1: this.anchor.c, r2: vr, c2: ci };
        else { this.extra.push(this.sel); this.anchor = { r: vr, c: ci }; this.sel = { r1: vr, c1: ci, r2: vr, c2: ci }; }
      } else if (e.shiftKey && this.anchor) this.sel = { r1: this.anchor.r, c1: this.anchor.c, r2: vr, c2: ci };
      else { this._clearExtra(); this.anchor = { r: vr, c: ci }; this.sel = { r1: vr, c1: ci, r2: vr, c2: ci }; }
      dragging = true; this._paintSel(); w.focus(); e.preventDefault();
    });
    w.addEventListener('mouseover', (e) => {
      if (!dragging || !this._own(e)) return; const td = e.target.closest('td'); if (!td || td.dataset.vr === undefined) return;
      this.sel.r2 = Number(td.dataset.vr); this.sel.c2 = Number(td.dataset.ci); this._paintSel();
    });
    w.addEventListener('click', (e) => { if (this._own(e) && e.target.closest('[data-link]')?.getAttribute('href') === '#') e.preventDefault(); });
    w.addEventListener('mouseup', () => { dragging = false; });
    w.addEventListener('mouseleave', () => { dragging = false; });
    w.addEventListener('dblclick', (e) => {
      if (!this._own(e) || e.target.closest('a[href]')) return;
      const td = e.target.closest('td'); if (!td || td.dataset.vr === undefined) return;
      const vr = Number(td.dataset.vr); const ci = Number(td.dataset.ci);
      if (this.o.onRowOpen && (this.o.readOnly || !this.editable(this.v[vr], ci))) { this.o.onRowOpen(this.rows[this.v[vr]]); return; }
      this._startEdit(vr, ci);
    });
    w.addEventListener('keydown', (e) => { if (e.target === w) this._key(e); });
  }
  _bindDocument() {
    this._onCopy = (e) => {
      if (!this.wrap || document.activeElement !== this.wrap || !this.sel) return;
      const lines = [];
      const cols = [...new Set(this._ranges().flatMap((g) => Array.from({ length: g.c2 - g.c1 + 1 }, (_, k) => g.c1 + k)))].sort((a, b) => a - b);
      for (const vr of this._selRows()) lines.push(cols.map((ci) => (this._inSel(vr, ci) ? this._plain(this.v[vr], this.cols[ci]) : '')).join('\t'));
      e.clipboardData.setData('text/plain', lines.join('\r\n')); e.preventDefault();
    };
    this._onPaste = (e) => {
      if (!this.wrap || document.activeElement !== this.wrap || !this.sel || this.o.readOnly) return;
      e.preventDefault(); this.paste(e.clipboardData.getData('text/plain'));
    };
    document.addEventListener('copy', this._onCopy);
    document.addEventListener('paste', this._onPaste);
  }
  destroy() { document.removeEventListener('copy', this._onCopy); document.removeEventListener('paste', this._onPaste); }

  _paintSel() {
    this._tds().forEach((td) => {
      const vr = Number(td.dataset.vr); const ci = Number(td.dataset.ci);
      td.classList.toggle('sel', this._inSel(vr, ci));
      td.classList.toggle('anchor', !!this.anchor && this.anchor.r === vr && this.anchor.c === ci);
    });
  }
  _move(dr, dc, extend) {
    if (!this.anchor) return;
    const maxR = this.v.length - 1; const maxC = this.cols.length - 1;
    if (extend) {
      this.sel.r2 = Math.max(0, Math.min(maxR, this.sel.r2 + dr)); this.sel.c2 = Math.max(0, Math.min(maxC, this.sel.c2 + dc));
    } else {
      const r = Math.max(0, Math.min(maxR, this.anchor.r + dr)); const c = Math.max(0, Math.min(maxC, this.anchor.c + dc));
      this.anchor = { r, c }; this.sel = { r1: r, c1: c, r2: r, c2: c };
    }
    this._clearExtra(); this._paintSel();
    const td = this._td(extend ? this.sel.r2 : this.anchor.r, extend ? this.sel.c2 : this.anchor.c);
    if (td) td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  _key(e) {
    if (this.editing) return; // editor handles its own keys
    if (!this.sel) return;
    const k = e.key; const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (k === 'd' || k === 'D')) { e.preventDefault(); this.fillDown(); return; }
    if (ctrl && (k === 'a' || k === 'A')) { e.preventDefault(); this._clearExtra(); this.sel = { r1: 0, c1: 0, r2: this.v.length - 1, c2: this.cols.length - 1 }; this._paintSel(); return; }
    if (ctrl) return; // let copy/paste events fire
    if (e.altKey && k === 'ArrowDown') { e.preventDefault(); this._startEdit(this.anchor.r, this.anchor.c); return; } // open a pick list
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[k]) { e.preventDefault(); this._move(...moves[k], e.shiftKey); return; }
    if (k === 'Tab') { e.preventDefault(); this._move(0, e.shiftKey ? -1 : 1, false); return; }
    if (k === 'Enter' || k === 'F2') { e.preventDefault(); this._startEdit(this.anchor.r, this.anchor.c); return; }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); this._eachSel((ri, ci) => this.setCell(ri, ci, (this.cols[ci].type === 'bool') ? 'no' : '')); this.render(); this._changed(); return; }
    if (k === ' ' && this.cols[this.anchor.c].type === 'bool') {
      e.preventDefault(); const ri0 = this.v[this.anchor.r]; const val = !this.rows[ri0][this.cols[this.anchor.c].field];
      this._eachSel((ri, ci) => { if (this.cols[ci].type === 'bool') this.setCell(ri, ci, null, { parsed: { value: val } }); });
      this.render(); this._changed(); return;
    }
    if (k.length === 1 && !e.altKey) { e.preventDefault(); this._startEdit(this.anchor.r, this.anchor.c, k); }
  }
  _eachSel(fn) {
    const seen = new Set();
    this._ranges().forEach((g) => { for (let vr = g.r1; vr <= g.r2; vr++) for (let ci = g.c1; ci <= g.c2; ci++) {
      const k = vr + ':' + ci; if (seen.has(k)) continue; seen.add(k); fn(this.v[vr], ci, vr); } });
  }

  fillDown() {
    if (this.o.readOnly || !this.sel) return;
    if (this._scattered()) {
      const byCol = new Map(); this._eachSel((ri, ci, vr) => { if (!byCol.has(ci)) byCol.set(ci, []); byCol.get(ci).push(vr); });
      byCol.forEach((vrs, ci) => {
        vrs.sort((a, b) => a - b); const col = this.cols[ci]; if (!col.field || vrs.length < 2) return;
        const sRi = this.v[vrs[0]]; const val = this.rows[sRi][col.field];
        vrs.slice(1).forEach((vr) => this.setCell(this.v[vr], ci, null, { parsed: { value: Array.isArray(val) ? [...val] : val, error: this.errors.get(sRi + ':' + col.field) } }));
      });
      this.render(); this._changed(); return;
    }
    let { r1, r2, c1, c2 } = this._norm();
    let src = r1;
    if (r1 === r2) { if (r1 === 0) return; src = r1 - 1; } else r1 += 1;
    const sRi = this.v[src];
    for (let ci = c1; ci <= c2; ci++) {
      const col = this.cols[ci]; if (!col.field) continue;
      const val = this.rows[sRi][col.field];
      for (let vr = r1; vr <= r2; vr++) {
        const ri = this.v[vr];
        this.setCell(ri, ci, null, { parsed: { value: Array.isArray(val) ? [...val] : val, error: this.errors.get(sRi + ':' + col.field) } });
      }
    }
    this.render(); this._changed();
  }
  paste(text) {
    if (!text) return;
    let lines = text.replace(/\r\n/g, '\n').split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    const data = lines.map((l) => l.split('\t'));
    const { r1, r2, c1, c2 } = this._norm();
    if (data.length === 1 && data[0].length === 1) { // one value into a range: fill it
      this._eachSel((ri, ci) => this.setCell(ri, ci, data[0][0]));
    } else if (this._scattered()) {
      const rowsSel = this._selRows(); const c0 = Math.min(...this._ranges().map((g) => g.c1));
      data.forEach((cells, i) => { const vr = rowsSel[i]; if (vr === undefined) return;
        cells.forEach((val, j) => { const ci = c0 + j; if (ci < this.cols.length) this.setCell(this.v[vr], ci, val); }); });
    } else {
      const need = r1 + data.length - this.v.length;
      if (need > 0 && this.o.allowAdd) {
        for (let i = 0; i < need; i++) { const r = { ...this.o.newRow() }; this.rows.push(r); this.orig.push({ ...r }); this.isNew.push(true); }
        this.filter = ''; this.sort = null; this._view();
      }
      data.forEach((cells, i) => {
        const vr = r1 + i; if (vr >= this.v.length) return;
        cells.forEach((val, j) => { const ci = c1 + j; if (ci < this.cols.length) this.setCell(this.v[vr], ci, val); });
      });
      this.sel = { r1, c1, r2: Math.min(this.v.length - 1, r1 + data.length - 1), c2: Math.min(this.cols.length - 1, c1 + data[0].length - 1) };
    }
    this.render(); this._changed();
  }

  _startEdit(vr, ci, initial) {
    const ri = this.v[vr]; if (ri === undefined || !this.editable(ri, ci)) return;
    const col = this.cols[ci]; const td = this._td(vr, ci); if (!td) return;
    if (col.type === 'bool') { this.setCell(ri, ci, null, { parsed: { value: !this.rows[ri][col.field] } }); this.render(); this._changed(); return; }
    const row = this.rows[ri];
    const input = document.createElement('input');
    let combo = null;
    if (col.type === 'select') {
      const opts = this._options(col, row);
      const cur = opts.find((o) => o.value === row[col.field]);
      input.value = initial !== undefined ? initial : (cur ? cur.label : '');
    } else {
      const cur = col.editValue ? col.editValue(row) : row[col.field];
      input.value = initial !== undefined ? initial : (Array.isArray(cur) ? cur.join(', ') : (cur ?? ''));
    }
    input.className = 'cellinput'; td.innerHTML = ''; td.appendChild(input); input.focus();
    if (initial === undefined) input.select();
    this.editing = { vr, ci, input, picked: undefined };
    if (col.type === 'select') {
      combo = new Combo(input, { options: () => this._options(col, row), current: () => row[col.field],
        onPick: (o) => { if (this.editing) this.editing.picked = o; this._commitEdit(); this._move(1, 0, false); this.wrap.focus(); } });
      this.editing.combo = combo;
      combo.open(initial !== undefined ? initial : '');
    }
    input.addEventListener('keydown', (e) => {
      if (combo && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { combo.key(e); e.stopPropagation(); return; }
      if (combo && (e.key === 'Enter' || e.key === 'Tab') && combo.highlighted() && this.editing) this.editing.picked = combo.highlighted();
      if (e.key === 'Enter') { e.preventDefault(); this._commitEdit(); this._move(1, 0, false); this.wrap.focus(); }
      else if (e.key === 'Tab') { e.preventDefault(); this._commitEdit(); this._move(0, e.shiftKey ? -1 : 1, false); this.wrap.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); if (combo) combo.close(); this.editing = null; this.render(); this.wrap.focus(); }
      e.stopPropagation();
    });
    input.addEventListener('blur', () => setTimeout(() => this._commitEdit(), 0));
  }
  _commitEdit() {
    if (!this.editing) return;
    const { vr, ci, input, picked, combo } = this.editing; this.editing = null;
    if (combo) combo.close();
    const col = this.cols[ci]; const ri = this.v[vr];
    let raw = input.value;
    if (col.type === 'select') {
      // an explicit pick wins; otherwise the closest match to what was typed (blank clears the cell)
      const best = picked || (raw.trim() ? rankOptions(this._options(col, this.rows[ri]), raw)[0] : null);
      raw = best ? best.label : raw;
    }
    this.setCell(ri, ci, raw);
    this.render(); this._changed();
  }
  _changed() { if (this.o.onChange) this.o.onChange(this); }
}
