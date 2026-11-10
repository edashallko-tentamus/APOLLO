// The grid's state for one list: rows as loaded, the person's edits, errors, selection and editing.
// const grid = useGrid({ rows, columns, keyField, readOnly, allowAdd, newRow, filter }); then <DataGrid grid={grid} />.
// grid.changes (rows to save), grid.errorCount, grid.selectedRows(), grid.reset(rows).
import { useCallback, useMemo, useReducer, useRef } from 'react';
import * as M from './gridModel.js';

function reducer(st, a) {
  if (a.type === 'reset') return M.initState(a.rows, st.filter);
  const ctx = { ...a.ctx, view: M.viewOf(st, a.ctx.columns) }; // the view as it is now, not as it was drawn
  return a.fn(st, ctx, ...a.args);
}

// Editing a cell: tick boxes toggle at once; other cells open the editor
function startEdit(st, ctx, vr, ci, initial) {
  const ri = ctx.view[vr]; const col = ctx.columns[ci];
  if (ri === undefined || !M.isEditable(col, st.rows[ri], st.isNew[ri], ctx.readOnly)) return st;
  if (col.type === 'bool') return M.setCell(st, ctx, vr, ci, null, { value: !st.rows[ri][col.field] });
  return { ...st, editing: { vr, ci, initial } };
}
function commitEdit(st, ctx, raw, then) {
  if (!st.editing) return st;
  const { vr, ci } = st.editing;
  const next = M.setCell({ ...st, editing: null }, ctx, vr, ci, raw);
  return then ? M.move(next, ctx, then[0], then[1], false) : next;
}
const cancelEdit = (st) => ({ ...st, editing: null });
const setFilter = (st, ctx, filter) => ({ ...st, filter, sel: null, extra: [], anchor: null, editing: null });
const toggleSort = (st, ctx, ci) => ({ ...st, sel: null, extra: [], anchor: null, editing: null,
  sort: st.sort && st.sort.ci === ci ? (st.sort.dir > 0 ? { ci, dir: -1 } : null) : { ci, dir: 1 } });
const selectAll = (st, ctx) => (ctx.view.length ? { ...st, extra: [], sel: { r1: 0, c1: 0, r2: ctx.view.length - 1, c2: ctx.columns.length - 1 } } : st);
const dragTo = (st, ctx, vr, ci) => (st.sel ? { ...st, sel: { ...st.sel, r2: vr, c2: ci } } : st);

export function useGrid({ rows, columns, keyField = 'id', readOnly = false, allowAdd = false, newRow, filter = '' }) {
  const [state, dispatch] = useReducer(reducer, rows, (r) => M.initState(r, filter));
  const ctxRef = useRef(null);
  ctxRef.current = { columns, readOnly, allowAdd, newRow };

  const act = useMemo(() => {
    const run = (fn) => (...args) => dispatch({ fn, args, ctx: ctxRef.current });
    return {
      press: run((st, ctx, vr, ci, keys) => M.pressCell(st, vr, ci, keys)),
      dragTo: run(dragTo), move: run(M.move), selectAll: run(selectAll),
      fillDown: run(M.fillDown), paste: run(M.paste), clear: run(M.clearSel), toggle: run(M.toggleSel),
      startEdit: run(startEdit), commitEdit: run(commitEdit), cancelEdit: run(cancelEdit),
      setCell: run(M.setCell), addRows: run(M.addRows), markSaved: run(M.markSaved), setFilter: run(setFilter), toggleSort: run(toggleSort),
    };
  }, []);

  const view = useMemo(() => M.viewOf(state, columns), [state.rows, state.filter, state.sort, columns]); // eslint-disable-line react-hooks/exhaustive-deps
  const changes = useMemo(() => M.getChanges(state, columns, keyField), [state.rows, columns, keyField]); // eslint-disable-line react-hooks/exhaustive-deps
  const errorCount = useMemo(() => M.errorCount(state), [state.errors]); // eslint-disable-line react-hooks/exhaustive-deps

  const stateRef = useRef(state); stateRef.current = state;
  const viewRef = useRef(view); viewRef.current = view;
  const selectedRows = useCallback(() => M.selRows(stateRef.current).map((vr) => stateRef.current.rows[viewRef.current[vr]]), []);
  const reset = useCallback((r) => dispatch({ type: 'reset', rows: r }), []);

  return { state, view, columns, keyField, readOnly, allowAdd, act, changes, errorCount, selectedRows, reset };
}
