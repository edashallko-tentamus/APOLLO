// Analyte selection for one analyte-priced quote line, with a live preview of the new price.
//   const changed = await dialogs.open((done) => <AnalyteDialog line={line} editable={ed} onDone={done} />);
import { useEffect, useMemo, useState } from 'react';
import { lineAnalytes, saveLineAnalytes } from '../../api/projects.js';
import DataGrid from '../../components/grid/DataGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { money } from '../../lib/format.js';
import { Button, Card } from 'react-bootstrap';
import { Dialog } from '../../components/Modal.jsx';

const COLUMNS = [
  { field: 'included', title: 'Included', type: 'bool', width: 80 },
  { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 200 },
  { field: 'report_name', title: 'Report name', type: 'readonly', width: 180 },
  { field: 'analyte_price', title: 'Price', type: 'money', width: 90 },
];
const NONE = [];

export default function AnalyteDialog({ line, editable, onDone }) {
  const { data, error } = useApi(() => lineAnalytes(line.line_id), [line.line_id]);
  const rows = data || NONE;
  const grid = useGrid({ rows, columns: COLUMNS, readOnly: !editable });
  const { reset, state, changes } = grid;
  useEffect(() => { reset(rows); }, [rows, reset]);
  const toast = useToast();
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  const basePrep = useMemo(() => line.list_price - rows.filter((r) => r.included).reduce((s, r) => s + r.analyte_price, 0), [rows, line.list_price]);
  const inc = state.rows.filter((r) => r.included);
  const newList = basePrep + inc.reduce((s, r) => s + r.analyte_price, 0);
  const noFinal = line.final_price === null || line.final_price === undefined;
  const newFinal = noFinal ? null : (line.list_price ? newList * line.final_price / line.list_price : line.final_price);

  async function apply() {
    if (!changes.length) return onDone(false);
    if (!inc.length) return toast('At least one analyte must stay included.', 'err');
    setBusy(true); setErr('');
    try { await saveLineAnalytes(line.line_id, changes); toast('Analytes updated; price recalculated.'); onDone(true); } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <Dialog label={`Analytes on ${line.test_name}`} wide onClose={() => onDone(false)}>
      <div className="modal-body">
        <h3>Analytes on {line.test_name}</h3>
        <p className="intro">Untick analytes the client does not need. The list price recalculates and the negotiated discount ({line.discount_pct ?? 0}%) is kept. Select a block of cells and press Space to tick or untick them all, or use Ctrl+D.</p>
        {error ? <Card body className="err">{error.message}</Card> : !data ? <div className="loading">Loading…</div> : <>
          <DataGrid grid={grid} emptyText="No analytes." />
          <div className="preview">
            <span>{inc.length} of {state.rows.length} analytes</span><span>List {money(line.list_price)} → <b>{money(newList)}</b></span>
            <span>Final {noFinal ? 'not set' : <>{money(line.final_price)} → <b>{money(newFinal)}</b></>}</span>
            <span>Difference <b>{noFinal ? money(newList - line.list_price) : money(newFinal - line.final_price)}</b> per sample</span>
          </div>
        </>}
        <div className="merr" role="alert">{err}</div>
        <div className="mbtns">
          <Button type="button" variant="light" onClick={() => onDone(false)}>Cancel</Button>
          {editable && <Button type="button" variant="primary" onClick={apply} disabled={busy || !data}>Apply</Button>}
        </div>
      </div>
    </Dialog>
  );
}
