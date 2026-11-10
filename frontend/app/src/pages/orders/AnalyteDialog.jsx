// A test's analytes on an order (Analyte Selection pricing): untick what is not needed; the price keeps the quoted discount %.
//   const saved = await openAnalyteDialog(dialogs, test)
import { useEffect, useState } from 'react';
import { saveTestAnalytes, testAnalytes } from '../../api/orders.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import DataGrid from '../../components/grid/DataGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { money } from '../../lib/format.js';

const COLUMNS = [{ field: 'included', title: 'Included', type: 'bool', width: 80 }, { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 200 },
  { field: 'report_name', title: 'Report name', type: 'readonly', width: 180 }, { field: 'analyte_price', title: 'Price', type: 'money', width: 90, editable: false }];
const NONE = [];

function AnalyteDialog({ test, onDone }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const { data: rows, error: loadErr } = useApi(() => testAnalytes(test.id), [test.id]);
  const grid = useGrid({ rows: rows || NONE, columns: COLUMNS, readOnly: test.status === 'Cancelled' });
  const { reset } = grid;
  useEffect(() => { if (rows) reset(rows); }, [rows, reset]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const cur = grid.state.rows;
  const basePrep = test.list_price - (rows || NONE).filter((r) => r.included).reduce((s, r) => s + r.analyte_price, 0);
  const inc = cur.filter((r) => r.included); const nl = basePrep + inc.reduce((s, r) => s + r.analyte_price, 0);
  const np = test.list_price ? nl * test.price / test.list_price : test.price;

  async function ok() {
    const changes = grid.changes; if (!changes.length) { onDone(false); return; }
    let reason = '';
    if (test.clock_start) { reason = await dialogs.reason('analytes on a logged sample'); if (!reason) return; }
    setBusy(true);
    try { await saveTestAnalytes(test.id, changes, reason); toast('Analytes updated; price recalculated.'); onDone(true); }
    catch (e) { setBusy(false); setError(e.message); }
  }

  return (
    <Modal title={`Analytes: ${test.test_name} on ${test.sample_code || test.client_sample_id || 'sample'}`} okText="Apply" wide busy={busy || !rows} error={error || loadErr?.message}
      intro="Only analytes on the client's quote are listed. Untick what is not needed; the price keeps the quoted discount %. Analytes removed on the quote cannot be added here."
      onOk={ok} onClose={() => onDone(false)}>
      <DataGrid grid={grid} />
      {rows && <div className="preview" id="pv"><span>{inc.length} of {cur.length} analytes</span><span>List {money(test.list_price)} → <b>{money(nl)}</b></span>
        <span>Price {money(test.price)} → <b>{money(np)}</b></span><span>Difference <b>{money(np - test.price)}</b></span></div>}
    </Modal>
  );
}

export const openAnalyteDialog = (dialogs, test) => dialogs.open((done) => <AnalyteDialog test={test} onDone={done} />);
