// Search everything: the box at the top of every page. Type any ID, name or number, or scan a barcode (a scanner types
// the ID and presses Enter): an exact ID opens its record at once; anything else lists what matches, grouped by kind,
// and a click (or arrows and Enter) opens it. Ctrl+K or "/" jumps to the box.
import { useEffect, useRef, useState } from 'react';
import { searchAll } from '../api/search.js';

const DELAY_MS = 300;

export default function HeaderSearch() {
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState(null); // { q, results }
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(-1);
  const box = useRef(null);
  const input = useRef(null);
  const seq = useRef(0);
  const items = answer?.results || [];

  const go = (href) => { setOpen(false); setText(''); setAnswer(null); input.current?.blur(); window.location.hash = href; };

  async function run(q, openExact) {
    if (q.length < 2) { setOpen(false); return; }
    const my = ++seq.current;
    let d;
    try { d = await searchAll(q); } catch { return; }
    if (my !== seq.current) return; // a newer search is on its way
    if (openExact && d.exact) { go(d.exact.href); return; }
    setAnswer(d); setPick(-1); setOpen(true);
  }

  useEffect(() => { // search after a short pause in typing
    const q = text.trim();
    if (q.length < 2) { setOpen(false); return undefined; }
    const t = setTimeout(() => run(q, false), DELAY_MS);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const outside = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const jump = (e) => {
      const a = document.activeElement;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(a?.tagName) || a?.isContentEditable;
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) { e.preventDefault(); input.current?.focus(); input.current?.select(); }
    };
    const closeIt = () => setOpen(false);
    document.addEventListener('click', outside); document.addEventListener('keydown', jump); window.addEventListener('hashchange', closeIt);
    return () => { document.removeEventListener('click', outside); document.removeEventListener('keydown', jump); window.removeEventListener('hashchange', closeIt); };
  }, []);

  function keyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); if (pick >= 0 && items[pick]) go(items[pick].href); else run(text.trim(), true); }
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && open && items.length) {
      e.preventDefault(); setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
    } else if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
  }

  let kind = '';
  return (
    <div className="gsearch" id="gsearch" ref={box}>
      <input id="gsInput" ref={input} type="search" autoComplete="off" spellCheck="false" placeholder="Search any ID, name or number (or scan)" aria-label="Search the LIMS"
        value={text} onChange={(e) => setText(e.target.value)} onKeyDown={keyDown} onFocus={() => { if (items.length && text.trim().length >= 2) setOpen(true); }} />
      {open && answer && (
        <div id="gsPop" className="gspop">
          {!items.length ? <div className="gsnone">Nothing matches &quot;{answer.q}&quot; in this lab.</div> : items.map((r, i) => {
            const head = r.kind !== kind ? (kind = r.kind) : null;
            return <div key={i}>
              {head && <div className="gskind">{head}</div>}
              <a className={`gsrow${i === pick ? ' on' : ''}`} href={r.href} ref={i === pick ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                onClick={(e) => { e.preventDefault(); go(r.href); }}><b>{r.code || ''}</b><span>{r.title || ''}</span><small>{r.sub || ''}</small></a>
            </div>;
          })}
        </div>
      )}
    </div>
  );
}
