// A grid with a Save bar: one Reason for Change (and, when the list is signed, one electronic signature) covers the whole
// save; leaving with unsaved edits asks first. save(rows, reason, signature) gets only new and changed rows (key plus
// changed fields). The backend checks everything again.
//   sign: { meaning, action } or (rows) => that or null: the save is signed (a reason only when existing rows change)
//   autosave: saves a short pause after each change (bench grids); a correction's reason is asked by save() itself
//   apiRef: gets { selectedRows(), flush(), grid } for the page (e.g. buttons acting on the selected rows)
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { plural } from '../lib/format.js';
import { useUnsavedChanges } from '../router/useHashRoute.js';
import { useDialogs } from './dialogs/DialogProvider.jsx';
import DataGrid from './grid/DataGrid.jsx';
import { useGrid } from './grid/useGrid.js';
import { useToast } from './Toasts.jsx';

const AUTOSAVE_MS = 900;

export default function EditableGrid({ rows, columns, keyField = 'id', allowAdd, newRow, readOnly, filter, search, emptyText, rowClass, onRowOpen,
  toolbar, detail, onContextMenu, maxHeight, what = 'these records', needReason = true, sign, autosave = false, save, afterSave, autosaved, onChange, apiRef }) {
  const grid = useGrid({ rows, columns, keyField, readOnly, allowAdd, newRow, filter });
  const { changes, errorCount, reset, act } = grid;
  const toast = useToast();
  const dialogs = useDialogs();
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(null); // autosave: { text, bad }

  useEffect(() => { reset(rows); }, [rows, reset]); // new rows from the server: start again from them
  // just saved: afterSave may move to another page before the grid has redrawn without the saved edits
  const justSaved = useRef(false);
  useEffect(() => { justSaved.current = false; }, [grid.state.rows]);
  const changeCount = useRef(0); changeCount.current = changes.length;
  useUnsavedChanges(useCallback(() => changeCount.current > 0 && !justSaved.current, []));
  useEffect(() => { onChange?.(grid); }, [grid.state]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- autosave
  const latest = useRef(null); latest.current = { changes, errorCount };
  const running = useRef(null);
  const runAutosave = useCallback(async () => {
    if (running.current) return running.current;
    const { changes: rs, errorCount: bad } = latest.current;
    if (bad) { setNote({ text: 'Not saved yet: fix the cells marked in red.', bad: true }); return null; }
    if (!rs.length) return null;
    running.current = (async () => {
      try {
        await save(rs, '');
        act.markSaved(rs.map((r) => r[keyField]), keyField);
        autosaved?.(rs);
        setNote({ text: `Saved automatically at ${new Date().toLocaleTimeString([], { timeStyle: 'short' })}` });
      } catch (e) { setNote({ text: `Not saved: ${e.message}`, bad: true }); toast(e.message, 'err'); }
    })();
    try { await running.current; } finally { running.current = null; }
    return null;
  }, [save, act, keyField, autosaved, toast]);
  useEffect(() => {
    if (!autosave || readOnly || !changes.length) return undefined;
    const t = setTimeout(runAutosave, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [autosave, readOnly, changes, runAutosave]);

  const flush = useCallback(async () => {
    if (!autosave) return latest.current.changes.length === 0;
    await runAutosave();
    return latest.current.changes.length === 0;
  }, [autosave, runAutosave]);
  useImperativeHandle(apiRef, () => ({ grid, selectedRows: grid.selectedRows, flush }), [grid, flush]);

  // ---------------------------------------------------------------- Save button
  async function onSave() {
    if (saving || !changes.length) return;
    if (errorCount) { toast('Fix the cells marked in red first (hover a red cell to see why).', 'err'); return; }
    if (autosave) { const n = changes.length; if (await flush()) { toast(`Saved ${plural(n, 'row')}.`); justSaved.current = true; await afterSave?.(); } return; }
    const rs = changes;
    const s = typeof sign === 'function' ? sign(rs) : sign;
    setSaving(true);
    try {
      if (s) {
        const done = await dialogs.sign({ what: s.action || what, meaning: s.meaning || 'Changed by', needReason: needReason && rs.some((r) => r[keyField]),
          submit: ({ reason, signature }) => save(rs, reason, signature) });
        if (!done) return;
        toast(`Saved and signed: ${plural(rs.length, 'row')}.`);
      } else {
        let reason = '';
        if (needReason) { reason = await dialogs.reason(what); if (reason === null) return; }
        try { await save(rs, reason); } catch (e) { toast(e.message, 'err'); return; }
        toast(`Saved ${plural(rs.length, 'row')}.`);
      }
      reset(rows); // nothing unsaved now, even before the list reloads
      justSaved.current = true;
      await afterSave?.();
    } finally { setSaving(false); }
  }

  return <>
    <div className={`savebar${changes.length || errorCount ? ' show' : ''}`}>
      <span className="pending">{plural(changes.length, 'row')} changed{errorCount > 0 && <> · <b className="bad">{plural(errorCount, 'cell')} need fixing (red)</b></>}</span>
      <button type="button" className="btn ghost" onClick={() => reset(rows)} disabled={saving}>Discard changes</button>
      <button type="button" className="btn primary" onClick={onSave} disabled={saving}>{autosave ? 'Save now' : 'Save changes'}</button>
    </div>
    {note && <div className={`autosaved${note.bad ? ' bad' : ''}`}>{note.text}</div>}
    <DataGrid grid={grid} search={search} emptyText={emptyText} rowClass={rowClass} onRowOpen={onRowOpen} toolbar={toolbar}
      detail={detail} onContextMenu={onContextMenu} maxHeight={maxHeight} />
  </>;
}
