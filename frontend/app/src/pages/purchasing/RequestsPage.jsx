// Purchasing > Requests: every purchase request of the lab, 50 at a time; approve, reject or order the ticked ones.
import { useCallback, useEffect, useRef } from 'react';
import { approveLines, listLines, purchasingMe, rejectLines } from '../../api/purchasing.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import DataGrid from '../../components/grid/DataGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import PageHeader from '../../components/PageHeader.jsx';
import PagedList from '../../components/PagedList.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { newRequest, placeOrder } from './dialogs.jsx';
import { closedRow, Failed, Loading, money, NeedLab, openRequest, PuTabs, QUEUE_COLS, signed } from './shared.jsx';
import { Button } from 'react-bootstrap';

const FILTERS = [['approve', 'To approve'], ['order', 'Approved, to order'], ['receive', 'Ordered, to receive'], ['mine', 'My requests'], ['all', 'All']];
const AUDIT = { kind: 'purchasing' };

// the page's grid; the buttons above it read its ticked rows through gridRef
function QueueGrid({ rows, gridRef }) {
  const start = useRef(null);
  if (start.current?.src !== rows) start.current = { src: rows, rows: rows.map((r) => ({ ...r, _pick: false })) };
  const grid = useGrid({ rows: start.current.rows, columns: QUEUE_COLS });
  const { reset } = grid;
  useEffect(() => { reset(start.current.rows); }, [rows, reset]);
  gridRef.current = grid;
  return <DataGrid grid={grid} emptyText="Nothing here." onRowOpen={openRequest} rowClass={closedRow} />;
}

export default function RequestsPage({ query }) {
  const { site } = useSession();
  const dialogs = useDialogs();
  const toast = useToast();
  const gridRef = useRef(null);
  const reloadRef = useRef(() => {});
  const { data, error } = useApi(() => (site ? Promise.all([listLines({ page: 1, size: 1 }, { fresh: true }), purchasingMe()]) : Promise.resolve(null)), [site?.id]);
  const load = useCallback((params, opts) => listLines(params, opts), []);
  if (!site) return <NeedLab />;
  if (error) return <Failed error={error} />;
  if (!data) return <Loading />;
  const [d0, me] = data;
  const over = d0.setting && d0.setting.second_approval_over !== null && d0.setting.second_approval_over !== undefined ? Number(d0.setting.second_approval_over) : null;
  const ui = { dialogs, toast };
  const picked = () => (gridRef.current ? gridRef.current.state.rows.filter((r) => r._pick) : []);
  const need = () => { const p = picked(); if (!p.length) toast('Tick the requests first.', 'err'); return p; };
  const reload = () => reloadRef.current();

  const approve = async () => {
    const p = need(); if (!p.length) return;
    const ok = await signed(dialogs, { what: `Approve ${p.map((x) => x.line_code).join(', ')}`, meaning: 'Approved by', needReason: false },
      (reason, signature) => approveLines(p.map((x) => x.id), signature));
    if (ok) { toast('Approved and signed.'); reload(); }
  };
  const reject = async () => {
    const p = need(); if (!p.length) return;
    const ok = await signed(dialogs, { what: `Reject ${p.map((x) => x.line_code).join(', ')}`, meaning: 'Rejected by', needReason: true },
      (reason, signature) => rejectLines(p.map((x) => x.id), reason, signature));
    if (ok) { toast('Rejected and signed.'); reload(); }
  };
  const order = async () => { const p = need(); if (!p.length) return; if (await placeOrder(ui, p)) reload(); };

  return <>
    <PageHeader title={`Purchasing: ${site.site_code}`} audit={AUDIT}
      subtitle={`Every purchase request in ${site.site_name}: inventory items (from Inventory), equipment, services and other items. Approve, then group approved requests of one supplier into an order with the finance PO number. ${over !== null ? `Requests above ${money(over)} also need a General Manager's approval (marked *).` : 'No second approval amount is set for this lab.'} Nobody approves their own request. Newest first, 50 at a time.`} />
    <PuTabs />
    <div className="pubar"><span className="sp" />
      {(me.can_approve || me.can_approve_over) && <>
        <Button type="button" variant="outline-secondary" onClick={approve}>Approve ticked</Button>
        <Button type="button" variant="outline-secondary" onClick={reject}>Reject ticked</Button></>}
      {me.can_order && <Button type="button" variant="outline-secondary" onClick={order}>Order ticked</Button>}
      {me.can_request && <Button type="button" variant="primary" onClick={() => newRequest(ui)}>+ New request</Button>}
    </div>
    <div className="help" style={{ marginBottom: 8 }}>Inventory items are requested from Inventory (+ New Inventory Item as a request, or Reorder on any item); they appear here too.</div>
    {/* one page at a time from the server (0.35.0) */}
    <PagedList load={load} query={query} filters={FILTERS} open={openRequest}
      placeholder="Search by request, item, supplier, catalog number or PO; scan or type a request or PO number and press Enter">
      {(rows, _d, rl) => { reloadRef.current = rl; return <QueueGrid rows={rows} gridRef={gridRef} />; }}
    </PagedList>
  </>;
}
