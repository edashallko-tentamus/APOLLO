// Smart dropdowns (every pick list in the system):
//  - type to filter: exact and starts-with matches first, then word starts, then anywhere, then letters in order
//  - Down arrow opens the list; Up/Down move; Enter or Tab picks; Escape closes; mouse click picks
//  - enhanceSelect() turns a native <select> into one, keeping the <select> as the value holder so
//    existing code (onchange, .value, [data-f]) keeps working

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export function rankOptions(options, text) {
  const q = String(text || '').trim().toLowerCase();
  if (!q) return options.slice();
  const inOrder = (l) => { let i = 0; for (const ch of l) if (ch === q[i]) i++; return i === q.length; };
  const scored = [];
  options.forEach((o, i) => {
    const l = String(o.label).toLowerCase();
    let s = -1;
    if (l === q) s = 0;
    else if (l.startsWith(q)) s = 1;
    else if (l.split(/[\s:(),/·-]+/).some((w) => w.startsWith(q))) s = 2;
    else if (l.includes(q)) s = 3;
    else if (inOrder(l)) s = 4;
    if (s >= 0) scored.push([s, i, o]);
  });
  return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]);
}

export class Combo {
  // opts: { options: () => [{value,label}], current: () => value, onPick: (option) => void }
  constructor(input, opts) {
    this.input = input; this.o = opts; this.list = null; this.items = []; this.hi = -1;
    input.setAttribute('autocomplete', 'off'); input.setAttribute('role', 'combobox'); input.setAttribute('aria-expanded', 'false');
    input.addEventListener('input', () => this.open(input.value));
    input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) this.close(); }, 120));
    this._onScroll = (e) => { if (this.list && !this.list.contains(e.target)) this.place(); };
  }
  get isOpen() { return !!this.list; }
  open(text = '') {
    const all = this.o.options();
    this.items = rankOptions(all, text);
    if (!this.list) {
      this.list = document.createElement('div'); this.list.className = 'combo-list'; this.list.setAttribute('role', 'listbox');
      document.body.appendChild(this.list);
      this.list.addEventListener('mousedown', (e) => {
        e.preventDefault(); // keep focus in the input
        const it = e.target.closest('[data-i]'); if (it) this.pick(Number(it.dataset.i));
      });
      window.addEventListener('scroll', this._onScroll, true);
      this.input.setAttribute('aria-expanded', 'true');
    }
    const cur = this.o.current ? this.o.current() : undefined;
    this.hi = String(text).trim() ? (this.items.length ? 0 : -1) : this.items.findIndex((x) => String(x.value) === String(cur ?? ''));
    if (this.hi < 0 && !String(text).trim() && this.items.length) this.hi = 0;
    this.list.innerHTML = this.items.length
      ? this.items.map((x, i) => `<div class="combo-item${i === this.hi ? ' hi' : ''}${String(x.value) === String(cur ?? '') ? ' cur' : ''}" data-i="${i}" role="option">${esc(x.label) || '&nbsp;'}</div>`).join('')
      : '<div class="combo-none">No match. Keep typing or press Escape.</div>';
    this.place(); this._scrollHi();
  }
  place() {
    if (!this.list) return;
    const r = this.input.getBoundingClientRect();
    if (!r.width && !r.height) { this.close(); return; }
    const below = window.innerHeight - r.bottom; const h = Math.min(this.list.scrollHeight, 280);
    this.list.style.minWidth = Math.max(r.width, 180) + 'px';
    this.list.style.left = Math.max(4, Math.min(r.left, window.innerWidth - Math.max(r.width, 180) - 8)) + 'px';
    if (below < h + 8 && r.top > below) { this.list.style.top = ''; this.list.style.bottom = (window.innerHeight - r.top + 2) + 'px'; }
    else { this.list.style.bottom = ''; this.list.style.top = (r.bottom + 2) + 'px'; }
  }
  close() {
    if (!this.list) return;
    this.list.remove(); this.list = null; this.hi = -1;
    window.removeEventListener('scroll', this._onScroll, true);
    this.input.setAttribute('aria-expanded', 'false');
  }
  highlighted() { return this.list && this.hi >= 0 ? this.items[this.hi] : null; }
  move(d) {
    if (!this.list) { this.open(''); return; }
    if (!this.items.length) return;
    this.hi = Math.max(0, Math.min(this.items.length - 1, this.hi + d));
    this.list.querySelectorAll('.combo-item').forEach((el, i) => el.classList.toggle('hi', i === this.hi));
    this._scrollHi();
  }
  _scrollHi() { const el = this.list && this.list.querySelector('.combo-item.hi'); if (el) el.scrollIntoView({ block: 'nearest' }); }
  pick(i) { const o = this.items[i]; this.close(); if (o) this.o.onPick(o); }
  // Returns true when the key was used by the dropdown (the caller should then stop it going further)
  key(e) {
    if (e.key === 'ArrowDown' || (e.key === 'Down')) { e.preventDefault(); this.move(1); return true; }
    if (e.key === 'ArrowUp') { if (!this.list) return false; e.preventDefault(); this.move(-1); return true; }
    if (e.key === 'Enter' && this.highlighted()) { e.preventDefault(); this.pick(this.hi); return true; }
    if (e.key === 'Escape' && this.list) { e.preventDefault(); this.close(); return true; }
    return false;
  }
}

// Replace a native <select> with a smart dropdown. The <select> stays (visually hidden) and holds the value.
export function enhanceSelect(sel) {
  if (sel.dataset.combo || sel.multiple || sel.classList.contains('nocombo') || sel.classList.contains('cellinput')) return;
  sel.dataset.combo = '1';
  const wrap = document.createElement('span'); wrap.className = 'combo' + (sel.dataset.comboClass ? ' ' + sel.dataset.comboClass : '');
  const input = document.createElement('input'); input.type = 'text'; input.className = 'combo-input';
  if (sel.title) input.title = sel.title;
  if (sel.getAttribute('aria-label')) input.setAttribute('aria-label', sel.getAttribute('aria-label'));
  const hadFocus = document.activeElement === sel;
  sel.parentNode.insertBefore(wrap, sel); wrap.appendChild(input); wrap.appendChild(sel);
  sel.classList.add('combo-native'); sel.tabIndex = -1;
  const label = sel.id && sel.ownerDocument.querySelector(`label[for="${CSS.escape(sel.id)}"]`);
  if (label) label.addEventListener('click', (e) => { e.preventDefault(); input.focus(); });
  const opts = () => [...sel.options].map((o) => ({ value: o.value, label: o.textContent }));
  const show = () => { input.value = sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].textContent : ''; input.disabled = sel.disabled; };
  const choose = (o) => {
    if (o && sel.value !== o.value) {
      sel.value = o.value;
      sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    show();
  };
  const combo = new Combo(input, { options: opts, current: () => sel.value, onPick: choose });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && combo.highlighted() && input.value !== (sel.options[sel.selectedIndex]?.textContent ?? '')) { choose(combo.highlighted()); combo.close(); return; }
    if (combo.key(e)) e.stopPropagation();
  });
  input.addEventListener('focus', () => input.select());
  input.addEventListener('mouseup', (e) => { e.preventDefault(); if (!combo.isOpen) combo.open(''); });
  input.addEventListener('blur', () => setTimeout(() => {
    if (document.activeElement === input) return;
    const typed = input.value.trim(); const cur = sel.options[sel.selectedIndex]?.textContent ?? '';
    if (typed === cur.trim()) return;
    if (!typed) { const blank = opts().find((o) => o.value === ''); if (blank) { choose(blank); return; } }
    const best = rankOptions(opts(), typed)[0];
    if (best && typed) choose(best); else show();
  }, 150));
  sel.addEventListener('change', show);
  new MutationObserver(show).observe(sel, { attributes: true, attributeFilter: ['disabled'], childList: true });
  show();
  if (hadFocus) input.focus();
}

export function enhanceAll(root) {
  if (root.tagName === 'SELECT') { enhanceSelect(root); return; }
  if (root.querySelectorAll) root.querySelectorAll('select:not([data-combo])').forEach(enhanceSelect);
}
