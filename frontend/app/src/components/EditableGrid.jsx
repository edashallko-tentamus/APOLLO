// A grid with a Save bar: one Reason for Change covers the whole save; leaving with unsaved edits asks first.
// save(rows, reason) gets only the new and changed rows (key plus changed fields). The backend checks everything again.
// shortcut: signed saves and autosave (bench grids) are not here yet; add them when a screen that needs them moves.
import { useEffect, useState } from 'react';
import { useUnsavedChanges } from '../router/useHashRoute.js';
import DataGrid from './grid/DataGrid.jsx';
import { useGrid } from './grid/useGrid.js';
import ReasonDialog from './ReasonDialog.jsx';
import { useToast } from './Toasts.jsx';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function EditableGrid({ rows, columns, keyField, allowAdd, newRow, readOnly, search, emptyText, rowClass, onRowOpen, toolbar,
  what = 'these records', module = 'General', needReason = true, save, afterSave }) {
  const grid = useGrid({ rows, columns, keyField, readOnly, allowAdd, newRow });
  const { changes, errorCount, reset } = grid;
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { reset(rows); }, [rows, reset]); // new rows from the server: start again from them
  useUnsavedChanges(changes.length > 0);

  async function doSave(reason) {
    setSaving(true);
    try {
      await save(changes, reason);
      toast(`Saved ${plural(changes.length, 'row')}.`);
      setAsking(false);
      reset(rows); // nothing unsaved now, even before the list reloads
      await afterSave?.();
    } finally { setSaving(false); }
  }
  function onSave() {
    if (saving || !changes.length) return;
    if (errorCount) { toast('Fix the cells marked in red first (hover a red cell to see why).', 'err'); return; }
    if (needReason) setAsking(true);
    else doSave('').catch((e) => toast(e.message, 'err'));
  }

  return <>
    <div className={`savebar${changes.length || errorCount ? ' show' : ''}`}>
      <span className="pending">{plural(changes.length, 'row')} changed{errorCount > 0 && <> · <b className="bad">{plural(errorCount, 'cell')} need fixing (red)</b></>}</span>
      <button type="button" className="btn ghost" onClick={() => reset(rows)} disabled={saving}>Discard changes</button>
      <button type="button" className="btn primary" onClick={onSave} disabled={saving}>Save changes</button>
    </div>
    <DataGrid grid={grid} search={search} emptyText={emptyText} rowClass={rowClass} onRowOpen={onRowOpen} toolbar={toolbar} />
    {asking && <ReasonDialog what={what} module={module} onSubmit={doSave} onClose={() => setAsking(false)} />}
  </>;
}
