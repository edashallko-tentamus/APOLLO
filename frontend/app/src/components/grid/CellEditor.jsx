// The box that opens over a cell while typing in it. Pick-list cells are smart dropdowns (the current app's combo.js):
// type to filter, Down arrow for the list, Enter or Tab picks. Enter moves down, Tab across, Escape cancels.
import { useEffect, useRef } from 'react';
import { Combo, rankOptions } from '../../../../public/js/combo.js';
import { optionsOf } from './gridModel.js';

function startText(col, row, initial) {
  if (initial !== undefined) return initial;
  if (col.type === 'select') return optionsOf(col, row).find((o) => o.value === row[col.field])?.label ?? '';
  const cur = col.editValue ? col.editValue(row) : row[col.field];
  return Array.isArray(cur) ? cur.join(', ') : (cur ?? '');
}

export default function CellEditor({ col, row, initial, onCommit, onCancel }) {
  const input = useRef(null);
  const combo = useRef(null);
  const finished = useRef(false);

  // one commit per edit (Enter, then the blur that follows, must not save twice)
  const finish = (raw, then) => {
    if (finished.current) return; finished.current = true;
    if (col.type === 'select' && typeof raw === 'string') {
      const best = raw.trim() ? rankOptions(optionsOf(col, row), raw)[0] : null; // the closest match to what was typed
      raw = best ? best.label : raw;
    }
    onCommit(raw, then);
  };

  useEffect(() => {
    const el = input.current;
    el.value = String(startText(col, row, initial));
    el.focus();
    if (initial === undefined) el.select();
    if (col.type === 'select') {
      combo.current = new Combo(el, { options: () => optionsOf(col, row), current: () => row[col.field], onPick: (o) => finish(o.label, [1, 0]) });
      combo.current.open(initial ?? '');
    }
    return () => combo.current?.close();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- opened once per edit

  function keyDown(e) {
    e.stopPropagation();
    const c = combo.current;
    if (c && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { c.key(e); return; }
    const picked = c && (e.key === 'Enter' || e.key === 'Tab') ? c.highlighted() : null;
    if (e.key === 'Enter') { e.preventDefault(); finish(picked ? picked.label : input.current.value, [1, 0]); }
    else if (e.key === 'Tab') { e.preventDefault(); finish(picked ? picked.label : input.current.value, [0, e.shiftKey ? -1 : 1]); }
    else if (e.key === 'Escape') { e.preventDefault(); finished.current = true; onCancel(); }
  }

  // leaving the box (a click elsewhere) keeps what was typed; read now, the box may be gone when the timer runs
  return <input ref={input} className="cellinput" onKeyDown={keyDown} onMouseDown={(e) => e.stopPropagation()}
    onBlur={(e) => { const v = e.target.value; setTimeout(() => finish(v), 0); }} />;
}
