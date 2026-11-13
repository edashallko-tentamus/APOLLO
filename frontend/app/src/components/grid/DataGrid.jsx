// The spreadsheet grid for every list and every data entry (Grid Data Entry Standard), drawn from useGrid's state:
//  - click, drag or Shift+click to select; arrows move (Shift extends); Ctrl+click adds or removes a cell, Ctrl+Shift+click a block
//  - Ctrl+D fill down; Ctrl+C / Ctrl+V copy and paste with Excel; Ctrl+A selects all
//  - type, Enter or F2 to edit; Delete clears; Space ticks; Alt+Down opens a pick list
//  - typed, pasted and filled values are checked alike: bad cells turn red (hover for why); changed cells are highlighted
//  - columns with href(row) show real links; links(row) puts several in one cell; header click sorts
//  - only the rows on screen are drawn, so long lists stay quick (all rows when rows have panels under them)
//  - detail: { open(row), key(row), render(row) } shows a panel under a row (e.g. a sample's tests)
//  - onContextMenu(event, selectedRows): a right-click menu; a right-click inside the selection keeps it
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import CellEditor from './CellEditor.jsx';
import { NUMERIC, display, inRanges, isEditable, plain, ranges, selRows } from './gridModel.js';
import { Button } from 'react-bootstrap';

const OVERSCAN = 8;
const KEY_MOVES = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
const numeric = (c) => NUMERIC.includes(c.type) || c.align === 'right';

function CellContent({ col, ci, row, hasError }) {
  const t = col.type || 'text';
  if (t === 'bool') return <span className={`chk${row[col.field] ? ' on' : ''}`}>{row[col.field] ? '✓' : ''}</span>;
  if (t === 'button') {
    const label = typeof col.label === 'function' ? col.label(row) : col.label;
    return label ? <Button type="button" variant="outline-secondary" size="sm" className="mini" data-btn={ci}>{label}</Button> : null;
  }
  if (col.links) {
    const ls = col.links(row) || [];
    if (!ls.length) return display(col, row, hasError);
    return ls.map((l, i) => <span key={i}>{i > 0 && ', '}{l.href ? <a href={l.href} data-link={ci}>{l.text}</a> : l.text}{l.after ? ' ' + l.after : ''}</span>);
  }
  const href = (t === 'link' || col.href) && !hasError && col.href ? col.href(row) : null;
  const text = display(col, row, hasError);
  return href ? <a href={href} data-link={ci}>{text}</a> : text;
}

// One row. Redrawn only when its data, its errors or its part of the selection change.
const GridRow = memo(function GridRow({ row, orig, isNew, rowErrors, vr, columns, readOnly, selCis, anchorCi, editingCi, editing, rowClass, onCommit, onCancel }) {
  const sel = selCis ? new Set(selCis.split(',').map(Number)) : null;
  return (
    <tr className={[rowClass ? rowClass(row) : '', isNew ? 'new' : ''].join(' ').trim() || undefined}>
      {columns.map((c, ci) => {
        const err = rowErrors?.[c.field];
        const dirty = c.field && !isNew && !c.compute && JSON.stringify(row[c.field] ?? null) !== JSON.stringify(orig?.[c.field] ?? null);
        const cls = [numeric(c) ? 'num' : '', isEditable(c, row, isNew, readOnly) ? 'ed' : 'ro', dirty ? 'dirty' : '', err ? 'err' : '',
          sel?.has(ci) ? 'sel' : '', anchorCi === ci ? 'anchor' : '', c.cellClass ? c.cellClass(row) : ''].filter(Boolean).join(' ');
        return (
          <td key={ci} data-vr={vr} data-ci={ci} className={cls} title={err || undefined}>
            {editingCi === ci
              ? <CellEditor col={c} row={row} initial={editing.initial} onCommit={onCommit} onCancel={onCancel} />
              : <CellContent col={c} ci={ci} row={row} hasError={!!err} />}
          </td>
        );
      })}
    </tr>
  );
});

export default function DataGrid({ grid, search = false, emptyText = 'No rows yet.', rowClass, onRowOpen, toolbar, maxHeight, detail, onContextMenu }) {
  const { state: st, view, columns, readOnly, allowAdd, act } = grid;
  const wrap = useRef(null);
  const dragging = useRef(false);
  const [box, setBox] = useState({ top: 0, height: 600, rowH: 32, headH: 33 });

  // keep the latest state for the document-wide copy and paste listeners
  const live = useRef(null);
  live.current = { st, view, columns, readOnly };

  // ---------------------------------------------------------------- only the rows on screen
  useLayoutEffect(() => {
    const el = wrap.current; if (!el) return undefined;
    const measure = () => {
      const tr = el.querySelector('tbody > tr:not([aria-hidden])'); // a drawn row, not a spacer
      const th = el.querySelector('thead');
      setBox((b) => ({ ...b, height: el.clientHeight, rowH: tr?.offsetHeight || b.rowH, headH: th?.offsetHeight || b.headH }));
    };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const onScroll = useCallback((e) => { const top = e.currentTarget.scrollTop; setBox((b) => (b.top === top ? b : { ...b, top })); }, []);
  // rows with panels under them differ in height, so then every row is drawn (such lists are short)
  const first = detail ? 0 : Math.max(0, Math.floor(box.top / box.rowH) - OVERSCAN);
  const last = detail ? view.length : Math.min(view.length, Math.ceil((box.top + box.height) / box.rowH) + OVERSCAN);

  // the active cell stays in sight as the arrows move it (it may not be drawn yet: scroll by arithmetic first)
  useLayoutEffect(() => {
    const el = wrap.current; const target = st.sel && (st.sel.r2 !== st.anchor?.r || st.sel.c2 !== st.anchor?.c) ? { r: st.sel.r2, c: st.sel.c2 } : st.anchor;
    if (!el || !target) return;
    const top = target.r * box.rowH; const visible = el.clientHeight - box.headH;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + box.rowH > el.scrollTop + visible) el.scrollTop = top + box.rowH - visible;
    el.querySelector(`td[data-vr="${target.r}"][data-ci="${target.c}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [st.anchor, st.sel]); // eslint-disable-line react-hooks/exhaustive-deps -- follows the selection only

  // ---------------------------------------------------------------- copy and paste with Excel
  useEffect(() => {
    const mine = () => wrap.current && document.activeElement === wrap.current && live.current.st.sel;
    const onCopy = (e) => {
      if (!mine()) return;
      const { st: s, view: v, columns: cols } = live.current; const rs = ranges(s);
      const cis = [...new Set(rs.flatMap((g) => Array.from({ length: g.c2 - g.c1 + 1 }, (_, k) => g.c1 + k)))].sort((a, b) => a - b);
      const lines = selRows(s).map((vr) => cis.map((ci) => (inRanges(rs, vr, ci) ? plain(cols[ci], s.rows[v[vr]]) : '')).join('\t'));
      e.clipboardData.setData('text/plain', lines.join('\r\n')); e.preventDefault();
    };
    const onPaste = (e) => {
      if (!mine() || live.current.readOnly) return;
      e.preventDefault(); act.paste(e.clipboardData.getData('text/plain'));
    };
    const stopDrag = () => { dragging.current = false; };
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    document.addEventListener('mouseup', stopDrag);
    return () => { document.removeEventListener('copy', onCopy); document.removeEventListener('paste', onPaste); document.removeEventListener('mouseup', stopDrag); };
  }, [act]);

  // ---------------------------------------------------------------- mouse
  // a cell of this grid (a grid inside a row's panel has its own cells: those belong to it, not to this one)
  const cellOf = (e) => { const td = e.target.closest('td[data-vr]'); return td && td.closest('.gwrap') === wrap.current ? [Number(td.dataset.vr), Number(td.dataset.ci)] : null; };
  const rowAt = (vr) => st.rows[view[vr]];

  function mouseDown(e) {
    const at = cellOf(e); if (!at) return;
    const [vr, ci] = at; const col = columns[ci];
    if (e.button === 2 && inRanges(ranges(st), vr, ci)) return; // right-click inside the selection keeps it (for context menus)
    if (e.target.closest('[data-btn]')) { e.preventDefault(); col.onClick?.(rowAt(vr)); return; }
    const lk = e.target.closest('[data-link]');
    if (lk && lk.getAttribute('href') !== '#') return; // a real link: the browser follows it
    if (lk) { e.preventDefault(); col.onClick?.(rowAt(vr)); return; }
    if (st.editing) document.activeElement?.blur?.(); // the open editor keeps what was typed
    const ri = view[vr];
    if (e.target.closest('.chk') && !e.shiftKey && isEditable(col, st.rows[ri], st.isNew[ri], readOnly)) {
      act.setCell(vr, ci, null, { value: !st.rows[ri][col.field] });
    }
    act.press(vr, ci, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
    dragging.current = true;
    wrap.current.focus({ preventScroll: true }); e.preventDefault();
  }
  function mouseOver(e) { if (dragging.current) { const at = cellOf(e); if (at) act.dragTo(at[0], at[1]); } }
  function dblClick(e) {
    if (e.target.closest('a[href]')) return;
    const at = cellOf(e); if (!at) return;
    const [vr, ci] = at; const ri = view[vr];
    if (onRowOpen && !isEditable(columns[ci], st.rows[ri], st.isNew[ri], readOnly)) { onRowOpen(st.rows[ri]); return; }
    act.startEdit(vr, ci);
  }

  // ---------------------------------------------------------------- keyboard
  function keyDown(e) {
    if (e.target !== wrap.current || st.editing || !st.sel) return;
    const k = e.key; const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (k === 'd' || k === 'D')) { e.preventDefault(); act.fillDown(); return; }
    if (ctrl && (k === 'a' || k === 'A')) { e.preventDefault(); act.selectAll(); return; }
    if (ctrl) return; // Ctrl+C / Ctrl+V reach the copy and paste listeners
    if (e.altKey && k === 'ArrowDown') { e.preventDefault(); act.startEdit(st.anchor.r, st.anchor.c); return; }
    if (KEY_MOVES[k]) { e.preventDefault(); act.move(...KEY_MOVES[k], e.shiftKey); return; }
    if (k === 'Tab') { e.preventDefault(); act.move(0, e.shiftKey ? -1 : 1, false); return; }
    if (k === 'Enter' || k === 'F2') { e.preventDefault(); act.startEdit(st.anchor.r, st.anchor.c); return; }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); act.clear(); return; }
    if (k === ' ' && columns[st.anchor.c].type === 'bool') { e.preventDefault(); act.toggle(); return; }
    if (k.length === 1 && !e.altKey) { e.preventDefault(); act.startEdit(st.anchor.r, st.anchor.c, k); }
  }

  const onCommit = useCallback((raw, then) => { act.commitEdit(raw, then); wrap.current?.focus({ preventScroll: true }); }, [act]);
  const onCancel = useCallback(() => { act.cancelEdit(); wrap.current?.focus({ preventScroll: true }); }, [act]);

  // each drawn row's part of the selection, as a short string so unchanged rows are not redrawn
  const rs = useMemo(() => ranges(st), [st.sel, st.extra]); // eslint-disable-line react-hooks/exhaustive-deps
  const selFor = (vr) => {
    let out = '';
    for (const g of rs) if (vr >= g.r1 && vr <= g.r2) for (let ci = g.c1; ci <= g.c2; ci++) out += (out ? ',' : '') + ci;
    return out;
  };

  const drawn = [];
  for (let vr = first; vr < last; vr++) {
    const ri = view[vr];
    const row = st.rows[ri];
    drawn.push(<GridRow key={ri} row={row} orig={st.orig[ri]} isNew={st.isNew[ri]} rowErrors={st.errors[ri]} vr={vr}
      columns={columns} readOnly={readOnly} selCis={selFor(vr)} anchorCi={st.anchor?.r === vr ? st.anchor.c : -1}
      editingCi={st.editing?.vr === vr ? st.editing.ci : -1} editing={st.editing?.vr === vr ? st.editing : null}
      rowClass={rowClass} onCommit={onCommit} onCancel={onCancel} />);
    if (detail?.open(row)) {
      drawn.push(<tr key={'d' + detail.key(row)} className="gdetail"><td colSpan={columns.length}><div className="gdetail-in">{detail.render(row)}</div></td></tr>);
    }
  }
  const spacer = (h) => (h > 0 ? <tr aria-hidden="true" style={{ height: h }}><td colSpan={columns.length} style={{ padding: 0, border: 0 }} /></tr> : null);

  return <>
    {(search || (allowAdd && !readOnly) || toolbar) && (
      <div className="gtool">
        {search && <input className="gsearch" placeholder="Search…" value={st.filter} onChange={(e) => act.setFilter(e.target.value)} />}
        {allowAdd && !readOnly && <><Button type="button" variant="outline-secondary" size="sm" className="mini" onClick={() => act.addRows(1)}>+ Add row</Button>
          <Button type="button" variant="outline-secondary" size="sm" className="mini" onClick={() => act.addRows(10)}>+10 rows</Button></>}
        <span className="ghint">{readOnly ? '' : 'Ctrl+D fill down · Ctrl+C / Ctrl+V copy and paste (Excel) · Enter or type to edit'}</span>
        {toolbar}
      </div>
    )}
    <div ref={wrap} className="gwrap" tabIndex={0} style={maxHeight ? { maxHeight } : undefined} onScroll={onScroll}
      onMouseDown={mouseDown} onMouseOver={mouseOver} onDoubleClick={dblClick} onKeyDown={keyDown}
      onContextMenu={onContextMenu ? (e) => { if (cellOf(e)) onContextMenu(e, grid.selectedRows()); } : undefined}
      onClick={(e) => { if (e.target.closest('[data-link]')?.getAttribute('href') === '#') e.preventDefault(); }}>
      <table className="grid">
        <thead><tr>
          {columns.map((c, ci) => (
            <th key={ci} style={c.width ? { width: c.width } : undefined} className={numeric(c) ? 'num' : undefined} title={c.help || undefined}
              onClick={() => act.toggleSort(ci)}>
              {c.title}{st.sort?.ci === ci ? (st.sort.dir > 0 ? ' ▲' : ' ▼') : ''}
            </th>
          ))}
        </tr></thead>
        <tbody>
          {spacer(first * box.rowH)}
          {drawn}
          {spacer((view.length - last) * box.rowH)}
        </tbody>
      </table>
      {!view.length && <div className="gempty">{emptyText}</div>}
    </div>
  </>;
}
