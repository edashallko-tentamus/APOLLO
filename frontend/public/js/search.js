// Search everything (0.35.0, Alex): the box at the top of every page. Type any ID, name or number, or scan a barcode
// (a scanner types the ID and presses Enter): an exact ID opens its record at once; anything else lists what matches,
// grouped by kind, and a click (or arrow keys and Enter) opens the record's page. Ctrl+K or "/" jumps to the box.
import { api, esc } from './app.js';

export function initSearch() {
  const box = document.getElementById('gsearch');
  const input = document.getElementById('gsInput');
  const pop = document.getElementById('gsPop');
  if (!box || !input || !pop) return;
  // main.js calls this on every page change: set the box up once, or every page adds another set of listeners
  if (box.dataset.ready) return;
  box.dataset.ready = '1';
  let seq = 0; let timer = null; let items = []; let pick = -1;
  const close = () => { pop.hidden = true; pick = -1; };
  const go = (href) => { close(); input.value = ''; input.blur(); location.hash = href; };
  function draw(d) {
    items = d.results || [];
    if (!items.length) { pop.innerHTML = `<div class="gsnone">Nothing matches "${esc(d.q)}" in this lab.</div>`; pop.hidden = false; return; }
    let html = ''; let kind = '';
    items.forEach((r, i) => {
      if (r.kind !== kind) { kind = r.kind; html += `<div class="gskind">${esc(kind)}</div>`; }
      html += `<a class="gsrow${i === pick ? ' on' : ''}" data-i="${i}" href="${esc(r.href)}"><b>${esc(r.code || '')}</b><span>${esc(r.title || '')}</span><small>${esc(r.sub || '')}</small></a>`;
    });
    pop.innerHTML = html; pop.hidden = false;
    pop.querySelectorAll('.gsrow').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); go(items[Number(a.dataset.i)].href); }));
  }
  async function run(open) {
    const q = input.value.trim();
    if (q.length < 2) { close(); return; }
    const my = ++seq;
    let d;
    try { d = await api('/search?q=' + encodeURIComponent(q)); } catch (_) { return; }
    if (my !== seq) return;
    if (open && d.exact) { go(d.exact.href); return; }
    pick = -1; draw(d);
  }
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => run(false), 300); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault(); clearTimeout(timer);
      if (pick >= 0 && items[pick]) go(items[pick].href); else run(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (pop.hidden || !items.length) return;
      e.preventDefault(); pick = (pick + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      pop.querySelectorAll('.gsrow').forEach((a) => a.classList.toggle('on', Number(a.dataset.i) === pick));
      const on = pop.querySelector('.gsrow.on'); if (on) on.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Escape') { close(); input.blur(); }
  });
  input.addEventListener('focus', () => { if (items.length && input.value.trim().length >= 2) pop.hidden = false; });
  document.addEventListener('click', (e) => { if (!box.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName) || (document.activeElement && document.activeElement.isContentEditable);
    if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) { if (box.hidden) return; e.preventDefault(); input.focus(); input.select(); }
  });
  window.addEventListener('hashchange', close);
}
