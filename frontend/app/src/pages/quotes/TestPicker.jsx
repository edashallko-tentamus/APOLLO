// The quote-line test picker with lab tabs (quote and project pages; not the order's picker):
//   <TestPicker versionId={vid} have={new Set(test codes already on the quote)} onAdded={() => reload()} prefill={bool} />
// Each test at the client's price on this quote (031); another lab's test is subcontracted (the 20-30 rule).
import { useEffect, useMemo, useRef, useState } from 'react';
import { addQuoteLines, quoteCatalog } from '../../api/quotes.js';
import DataGrid from '../../components/grid/DataGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import './quotes.css';
import { Button, Card } from 'react-bootstrap';

const pick = { lab: null, find: '', qty: 1 }; // kept between quote pages, as in the current app

export default function TestPicker({ versionId, have, onAdded, prefill = false }) {
  const { data: cat, error } = useApi(() => quoteCatalog(versionId), [versionId]);
  const { site } = useSession();
  const toast = useToast();
  const labs = useMemo(() => (cat ? [...new Map(cat.filter((t) => t.site_id).map((t) => [t.site_id, t.site_code])).entries()].sort((a, b) => a[1].localeCompare(b[1])) : []), [cat]);
  const [lab, setLab] = useState(pick.lab);
  const [find, setFind] = useState(pick.find);
  const [qty, setQty] = useState(pick.qty);
  const [busy, setBusy] = useState(false);
  const curLab = lab ?? (site && labs.some(([id]) => id === site.id) ? site.id : labs[0]?.[0] || 'all');

  const rows = useMemo(() => (cat || []).filter((t) => !have.has(t.test_code) && (curLab === 'all' || t.site_id === curLab)
    && (!find || (t.test_name + ' ' + t.test_code).toLowerCase().includes(find.toLowerCase()))), [cat, have, curLab, find]);

  const columns = useMemo(() => [
    { field: 'add', title: '', type: 'button', width: 70, label: () => '+ Add', onClick: (t) => addRef.current([t]) },
    { field: 'site_code', title: 'Lab', type: 'readonly', width: 150, compute: (t) => (t.subcontracted ? `${t.site_code} (subcontracted)` : t.site_code || ''), cellClass: (t) => (t.subcontracted ? 'flag' : '') },
    { field: 'test_code', title: 'Code', type: 'readonly', width: 75 },
    { field: 'test_name', title: 'Test', type: 'readonly', width: 300 },
    { field: 'pricing_mode', title: 'Pricing', type: 'readonly', width: 140 },
    { field: 'list_price', title: 'List price', type: 'money', width: 95, help: 'The client\'s list price on this quote (a subcontracted test\'s includes the 20-30 rule)' },
    { field: 'catalogue_price', title: 'Catalogue', type: 'money', width: 90, help: 'The performing lab\'s catalogue price' },
    { field: 'tat', title: 'Std TAT', type: 'readonly', width: 100, compute: (t) => `${t.standard_tat} ${t.tat_unit === 'Business Days' ? 'bus.' : 'cal.'} days` },
    { field: 'rush_schedule', title: 'Rush schedule', type: 'readonly', width: 120 },
    { field: 'orderable', title: 'Note', type: 'readonly', width: 170, compute: (t) => (t.orderable ? '' : 'No approved workflow yet') },
  ], []);

  const grid = useGrid({ rows, columns, keyField: 'test_id', readOnly: true });
  const { reset } = grid;
  useEffect(() => { reset(rows); }, [rows, reset]);

  const addRef = useRef(null);
  addRef.current = add;
  async function add(tests) {
    if (busy) return;
    setBusy(true);
    try {
      await addQuoteLines(versionId, tests.map((t) => ({ test_id: t.test_id, quantity: pick.qty })), prefill);
      toast(`${tests.length} test${tests.length === 1 ? '' : 's'} added.`); onAdded();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  }
  function addSelected() {
    const sel = grid.selectedRows();
    if (!sel.length) { toast('Select the tests to add first.', 'err'); return; }
    add(sel);
  }

  if (error) return <Card body className="err">{error.message}</Card>;
  if (!cat) return <div className="loading">Loading…</div>;
  const chooseLab = (id) => { pick.lab = id; setLab(id); };
  return (
    <div className="qpick">
      <div className="tabs">
        {labs.map(([id, code]) => <button type="button" key={id} className={`tab${curLab === id ? ' on' : ''}`} onClick={() => chooseLab(id)}>{code} <small>{cat.filter((t) => t.site_id === id).length}</small></button>)}
        <button type="button" className={`tab${curLab === 'all' ? ' on' : ''}`} onClick={() => chooseLab('all')}>All labs</button>
      </div>
      <div className="lrow">
        <input type="search" placeholder="Find a test (name or code)" value={find} onChange={(e) => { pick.find = e.target.value; setFind(e.target.value); }} />
        <label>Quantity <input type="number" min="1" value={qty} onChange={(e) => { const n = Math.max(1, Number(e.target.value) || 1); pick.qty = n; setQty(n); }} /></label>
        <Button type="button" variant="primary" onClick={addSelected} disabled={busy}>Add selected</Button>
      </div>
      <div className="help" style={{ marginBottom: 6 }}>Each lab&apos;s own tests. Another lab&apos;s test is <b>subcontracted</b>: its price less the in-network discount, plus your lab&apos;s markup (the 20-30 rule, lab settings). Click &quot;+ Add&quot;, or select several rows (Shift or Ctrl+click) and &quot;Add selected&quot;.{prefill ? ' New lines start at the list price: type over the final price to give a discount.' : ''}</div>
      <DataGrid grid={grid} emptyText="No more tests in this lab's catalogue." />
    </div>
  );
}
