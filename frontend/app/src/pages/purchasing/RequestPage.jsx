// One purchase request: approvals, the order, its receipts; approve, reject, order, receive, change or cancel it.
import { useMemo, useState } from 'react';
import { approveLines, getLine, purchasingMe, rejectLines, slipUrl, updateLine } from '../../api/purchasing.js';
import Badge from '../../components/Badge.jsx';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { editRequest, placeOrder, receiveDialog } from './dialogs.jsx';
import { d8, dt, Failed, Kv, Loading, money, num, signed } from './shared.jsx';

function receiptColumns(unit, siteId) {
  return [
    { field: 'receipt_code', title: 'Receipt', type: 'readonly', width: 95 }, { field: 'received_at', title: 'When', type: 'readonly', width: 140, format: dt },
    { field: 'quantity', title: 'Quantity', type: 'readonly', width: 80, format: (v) => `${num(v)} ${unit || ''}` },
    { field: 'actual_unit_price', title: 'Actual price / unit', type: 'readonly', width: 120, format: (v) => (v === null || v === undefined ? '' : money(v)) },
    { field: 'discrepancy', title: 'Problem', type: 'readonly', width: 150, cellClass: (r) => (r.discrepancy !== 'None' ? 'cwarn' : '') },
    { field: 'note', title: 'Note', type: 'readonly', width: 260 },
    { field: 'lot_code', title: 'Item', type: 'link', width: 100, href: (r) => (r.lot_id ? '#/inventory/lots/' + r.lot_id : r.equipment_id ? '#/equipment/' + r.equipment_id : null), format: (v, r) => v || r.equipment_code || '' },
    // the file opens in a new tab
    { field: 'slip_name', title: 'Packing slip', type: 'link', width: 150, href: (r) => (r.packing_slip_id ? '#' : null), onClick: (r) => window.open(slipUrl(r.id, siteId), '_blank', 'noopener') },
    { field: 'received_by', title: 'Received by', type: 'readonly', width: 140 }];
}

export default function RequestPage({ params }) {
  const id = params[0];
  const { site } = useSession();
  const dialogs = useDialogs();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = useApi(() => Promise.all([getLine(id), purchasingMe()]), [id]);
  const unit = data?.[0]?.line?.unit;
  const rcols = useMemo(() => receiptColumns(unit, site?.id), [unit, site?.id]);
  if (error && !data) return <Failed error={error} />;
  if (!data) return <Loading />;
  const [d, me] = data;
  const l = d.line;
  const open = ['Requested', 'Awaiting second approval'].includes(l.status);
  const left = Number(l.quantity) - Number(l.received_quantity);
  const ui = { dialogs, toast };

  const act = async (key) => {
    setBusy(true);
    try {
      let done = null;
      if (key === 'approve') done = await signed(dialogs, { what: `${l.status === 'Awaiting second approval' ? 'Second approval' : 'Approve'} ${l.line_code} ${l.description}${l.amount !== null ? ' (' + money(l.amount) + ')' : ''}`, meaning: 'Approved by', needReason: false }, (reason, signature) => approveLines([l.id], signature));
      if (key === 'reject') done = await signed(dialogs, { what: `Reject ${l.line_code} ${l.description}`, meaning: 'Rejected by', needReason: true }, (reason, signature) => rejectLines([l.id], reason, signature));
      if (key === 'order') done = await placeOrder(ui, [l]);
      if (key === 'receive') done = await receiveDialog(ui, l, left);
      if (key === 'cancel') done = await signed(dialogs, { what: `Cancel ${l.line_code} ${l.description}`, meaning: 'Cancelled by', needReason: true },
        (reason, signature) => updateLine(l.id, { status: 'Cancelled' }, reason, signature));
      if (key === 'edit') done = await editRequest(ui, l);
      if (done) { toast('Saved and signed.'); reload(); }
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const Btn = ({ k, label, show, primary }) => (show ? <button type="button" className={`btn${primary ? ' primary' : ''}`} disabled={busy} onClick={() => act(k)}>{label}</button> : null);
  const supOk = l.supplier_status === 'Approved';

  return <>
    <div className="eyebrow">{l.line_code} · {l.site_code} · {l.line_type}</div>
    <PageHeader title={l.description} subtitle={<Badge status={l.status} />} audit={{ kind: 'purchaseline', id }}
      actions={<a className="btn ghost" href="#/purchasing">All requests</a>} />
    <div className="actbar">
      <Btn k="approve" label={l.status === 'Awaiting second approval' ? 'Give second approval' : 'Approve'} show={open && (l.status === 'Requested' ? me.can_approve : me.can_approve_over)} primary />
      <Btn k="reject" label="Reject" show={open && me.can_approve} />
      <Btn k="order" label="Order" show={l.status === 'Approved' && me.can_order} primary />
      <Btn k="receive" label="Receive" show={['Ordered', 'Partly received'].includes(l.status) && me.can_receive} primary />
      <Btn k="edit" label="Change" show={open && l.line_type !== 'Inventory item'} />
      <Btn k="cancel" label="Cancel request" show={['Requested', 'Awaiting second approval', 'Approved'].includes(l.status)} />
    </div>
    {l.supplier_id && !supOk && !['Received', 'Cancelled', 'Rejected'].includes(l.status) && <div className="notice">{l.supplier_name} is {String(l.supplier_status).toLowerCase()} for this lab: this request cannot be approved or ordered until QA qualifies the supplier.</div>}
    {l.status === 'Rejected' && <div className="notice">Rejected: {l.rejected_reason || ''}</div>}
    <div className="statcards">
      <div className={`statcard ${open ? 'alert' : l.status === 'Rejected' ? 'deficient' : 'conforms'}`}><span>Status</span><b>{l.status}</b></div>
      <div className={`statcard ${l.needs_second ? 'alert' : ''}`}><span>Amount</span><b>{l.amount === null ? 'No price given' : money(l.amount)}{l.needs_second ? ' (second approval)' : ''}</b></div>
      <div className="statcard"><span>Received</span><b>{num(l.received_quantity)} of {num(l.quantity)} {l.unit || ''}</b></div>
      {l.actual_amount !== null && l.actual_amount !== undefined && <div className="statcard"><span>Actually paid (received so far)</span><b>{money(l.actual_amount)}</b></div>}
    </div>
    <div className="cols">
      <div className="card"><h2>Request</h2><Kv pairs={[
        ['Kind', l.line_type], ['What', l.description], ['For', l.scope_text || ''],
        ['Supplier', l.supplier_id ? <><a href={'#/purchasing/suppliers/' + l.supplier_id}>{l.supplier_name}</a> <span className={supOk ? 'okc' : 'bad'}>({l.supplier_status})</span></> : ''],
        ['Catalog / quote #', l.catalog_number],
        ['Web link', l.item_url ? <a href={l.item_url} target="_blank" rel="noopener noreferrer">{l.item_url.replace(/^https?:\/\//, '').slice(0, 60)}</a> : ''],
        ['Quantity', `${num(l.quantity)} ${l.unit || ''}`], ['Estimated price per unit', money(l.unit_price)],
        ['Needed by', d8(l.needed_by)], ['Why', l.justification],
        ['Inventory item', l.lot_code ? (d.lots || []).map((x, i) => <span key={x.id}>{i > 0 && ', '}<a href={'#/inventory/lots/' + x.id}>{x.lot_code}</a> ({x.receipt_status})</span>) : ''],
        ['Equipment', l.equipment_id ? <a href={'#/equipment/' + l.equipment_id}>{l.equipment_code}</a> : '']]} /></div>
      <div className="card"><h2>Approvals and order</h2><Kv pairs={[
        ['Requested', `${l.requested_by_name || ''} ${dt(l.requested_at)}`], ['Approved', l.approved_by ? `${l.approved_by_name} ${dt(l.approved_at)}` : ''],
        ['Second approval', l.approved2_by ? `${l.approved2_by_name} ${dt(l.approved2_at)}` : l.needs_second ? 'Needed (General Manager)' : 'Not needed'],
        ['Order', l.purchase_order_id ? <><a href={'#/purchasing/orders/' + l.purchase_order_id}>{l.po_code}</a>{l.external_po_number ? ` (finance PO ${l.external_po_number})` : ''}</> : '']]} /></div>
    </div>
    <Section title="Receipts" help="Each delivery against this request: how much, any problem, and the packing slip. What is not yet received stays open as a back-order.">
      <ReadGrid rows={d.receipts} columns={rcols} emptyText="Nothing received yet." />
    </Section>
  </>;
}
