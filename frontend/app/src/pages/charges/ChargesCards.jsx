// 0.36.0 (migration 058): miscellaneous charges on a lab order and on a quote, and a client's service lines. A charge has
// no workflow and never reaches a COA; on an order it is ready to invoice at once (shipping is billed before the kit goes
// out). The client's price comes from their accepted quote, else the catalogue price; a Discount is taken off.
//   <OrderChargesCard orderId samples={[{ id, sample_code, client_sample_id }]} onChange />
//   <QuoteChargesCard versionId onChange />
//   <ClientServiceLinesCard clientId canEdit />
import { useMemo } from 'react';
import * as api from '../../api/charges.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import EditableGrid from '../../components/EditableGrid.jsx';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { money, plural } from '../../lib/format.js';
import PickList from './PickList.jsx';
import { Button } from 'react-bootstrap';

const d8 = (v) => { if (!v) return ''; const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString([], { dateStyle: 'medium' }) : ''; };
const itemLabel = (c) => `${c.charge_name} (${c.kind}, ${money(c.client_price ?? c.price)}${c.client_price !== null && c.client_price !== undefined ? ' from ' + c.project_code : ''})`;
const isOpen = (r) => r.status === 'Active' && !r.invoice_id && !r.credited;
const mutedCancelled = (r) => (r.status === 'Cancelled' ? 'mutedrow' : '');

// ---------------------------------------------------------------- a lab order's charges
export function OrderChargesCard({ orderId, samples = [], onChange }) {
  const { data: d, reload } = useApi(() => api.orderCharges(orderId), [orderId]);
  const dialogs = useDialogs();
  const toast = useToast();
  const done = (msg) => { toast(msg); reload(); onChange?.(); };

  const columns = useMemo(() => {
    if (!d) return [];
    const change = async (r) => {
      if (!isOpen(r)) return;
      const v = await dialogs.form({ title: `Change ${r.charge_no}`, okText: 'Continue', fields: [
        { name: 'quantity', label: 'Quantity', type: 'number', value: r.quantity },
        { name: 'unit_price', label: 'Price each', type: 'number', value: Math.abs(Number(r.unit_price)) },
        { name: 'note', label: 'Note', value: r.note || '' }] });
      if (!v) return;
      const reason = await dialogs.reason(`charge ${r.charge_no}`); if (reason === null) return;
      try { await api.changeOrderCharge(r.id, { ...v, reason }); done('Charge changed.'); } catch (e) { toast(e.message, 'err'); }
    };
    const cancel = async (r) => {
      if (!isOpen(r)) return;
      const reason = await dialogs.reason(`cancelling charge ${r.charge_no} (${r.charge_name})`); if (reason === null) return;
      try { await api.changeOrderCharge(r.id, { cancel: true, reason }); done('Charge cancelled (kept, greyed).'); } catch (e) { toast(e.message, 'err'); }
    };
    return [
      { field: 'charge_no', title: 'Charge', type: 'readonly', width: 95 },
      { field: 'charge_name', title: 'What', type: 'readonly', width: 200 },
      { field: 'kind', title: 'Kind', type: 'readonly', width: 90 },
      { field: 'sample_code', title: 'Sample', type: 'link', width: 125, href: (r) => (r.sample_id ? '#/samples/' + r.sample_id : null) },
      { field: 'quantity', title: 'Qty', type: 'readonly', width: 50 },
      { field: 'unit_price', title: 'Each', type: 'money', width: 85 },
      { field: 'amount', title: 'Amount', type: 'money', width: 90 },
      { field: 'price_from', title: 'Price', type: 'readonly', width: 120, compute: (r) => (r.project_code ? 'Quote ' + r.project_code : Math.abs(Number(r.unit_price)) !== Math.abs(Number(r.list_price)) ? 'Agreed' : 'Catalogue') },
      { field: 'invoice_code', title: 'Invoice', type: 'link', width: 135, href: (r) => (r.invoice_id ? '#/billing/invoices/' + r.invoice_id : null), format: (v, r) => v || (r.credited ? 'Credited' : r.status === 'Active' ? 'Not invoiced' : '') },
      { field: 'note', title: 'Note', type: 'readonly', width: 200 },
      { field: 'status', title: 'Status', type: 'readonly', width: 85 },
      { field: 'created_at', title: 'Added', type: 'readonly', width: 105, format: d8 },
      ...(d.can_edit ? [{ field: '_ch', title: '', type: 'button', width: 80, label: (r) => (isOpen(r) ? 'Change…' : ''), onClick: change },
        { field: '_cx', title: '', type: 'button', width: 80, label: (r) => (isOpen(r) ? 'Cancel…' : ''), onClick: cancel }] : []),
    ];
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!d) return null; // loading, or not allowed: the card is left out, as before
  const active = d.rows.filter((r) => r.status === 'Active');

  async function add() {
    if (!d.items.length) { toast('No charges are in the catalogue for this lab yet (Test catalogue > Charges).', 'err'); return; }
    const v = await dialogs.form({ title: 'Add a charge', okText: 'Add', intro: 'The client\'s price comes from their accepted quote, else the catalogue price. Type another price only when agreed with the client (a reason is asked).', fields: [
      { name: 'charge_item_id', label: 'Charge', type: 'select', blank: false, required: true, value: d.items[0].id, options: d.items.map((c) => ({ value: c.id, label: itemLabel(c) })) },
      { name: 'quantity', label: 'Quantity', type: 'number', value: 1 },
      { name: 'unit_price', label: 'Price each (empty: the client\'s price)', type: 'number', value: '' },
      { name: 'sample_id', label: 'For a sample (optional)', type: 'select', options: samples.filter((x) => x.id).map((x) => ({ value: x.id, label: x.sample_code || x.client_sample_id || 'Sample' })) },
      { name: 'note', label: 'Printed under the invoice line', value: '' }] });
    if (!v) return;
    const it = d.items.find((c) => c.id === v.charge_item_id) || {};
    const std = it.client_price ?? it.price;
    let reason = '';
    const typed = v.unit_price !== '' && Math.abs(Number(v.unit_price)) !== Math.abs(Number(std)); // the client's own price typed again counts as not typed
    if (typed) { reason = await dialogs.reason(`a charge at ${money(v.unit_price)} instead of ${money(std)}`); if (reason === null) return; }
    try { const r = await api.addOrderCharge(orderId, { ...v, unit_price: typed ? v.unit_price : null, reason }); done(`${r.charge_no} added: ready to invoice.`); } catch (e) { toast(e.message, 'err'); }
  }

  return (
    <Section title="Charges" help="Kits, shipping, report fees, surcharges and discounts on this order. Ready to invoice as soon as they are added; never printed on a COA."
      actions={d.can_edit && <Button type="button" variant="outline-secondary" onClick={add}>+ Add a charge…</Button>}>
      <div className="blsum"><div><b>{money(active.reduce((s, r) => s + Number(r.amount || 0), 0))}</b><span>{plural(active.length, 'charge')}</span></div></div>
      <EditableGrid readOnly rows={d.rows} columns={columns} emptyText="No charges on this order." rowClass={mutedCancelled} />
    </Section>
  );
}

// ---------------------------------------------------------------- a quote's charges
export function QuoteChargesCard({ versionId, onChange }) {
  const { data: d, reload } = useApi(() => api.quoteCharges(versionId), [versionId]);
  const dialogs = useDialogs();
  const toast = useToast();
  const done = (msg) => { toast(msg); reload(); onChange?.(); };

  const columns = useMemo(() => {
    if (!d) return [];
    const edit = async (r) => {
      const v = await dialogs.form({ title: `Change ${r.charge_name}`, okText: 'Save', fields: [
        { name: 'quantity', label: 'Quantity', type: 'number', value: r.quantity },
        { name: 'unit_price', label: 'Client price each', type: 'number', value: r.unit_price },
        { name: 'note', label: 'Note', value: r.note || '' }] });
      if (!v) return;
      try { await api.changeQuotedCharge(r.id, v); done('Saved.'); } catch (e) { toast(e.message, 'err'); }
    };
    const remove = async (r) => {
      try { await api.changeQuotedCharge(r.id, { remove: true }); done('Charge taken off the quote.'); } catch (e) { toast(e.message, 'err'); }
    };
    return [
      { field: 'charge_code', title: 'Code', type: 'readonly', width: 80 },
      { field: 'charge_name', title: 'Charge', type: 'readonly', width: 200 },
      { field: 'kind', title: 'Kind', type: 'readonly', width: 90 },
      { field: 'quantity', title: 'Qty', type: 'readonly', width: 50 },
      { field: 'list_price', title: 'List', type: 'money', width: 80 },
      { field: 'unit_price', title: 'Client price', type: 'money', width: 95 },
      { field: 'line_total', title: 'Total', type: 'money', width: 90 },
      { field: 'note', title: 'Note', type: 'readonly', width: 200 },
      ...(d.editable ? [{ field: '_e', title: '', type: 'button', width: 75, label: 'Change…', onClick: edit },
        { field: '_r', title: '', type: 'button', width: 40, label: '🗑', help: 'Take this charge off the quote', onClick: remove }] : []),
    ];
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!d || (!d.rows.length && !d.editable)) return null;

  async function add() {
    if (!d.items.length) { toast('No charges are in the catalogue yet (Test catalogue > Charges).', 'err'); return; }
    const v = await dialogs.form({ title: 'Add a charge to the quote', okText: 'Add', fields: [
      { name: 'charge_item_id', label: 'Charge', type: 'select', blank: false, required: true, value: d.items[0].id, options: d.items.map((c) => ({ value: c.id, label: `${c.charge_name} (${c.kind}, ${money(c.price)})` })) },
      { name: 'quantity', label: 'Quantity', type: 'number', value: 1 },
      { name: 'unit_price', label: 'Client price each (empty: the catalogue price)', type: 'number', value: '' },
      { name: 'note', label: 'Note', value: '' }] });
    if (!v) return;
    try { await api.addQuoteCharge(versionId, v); done('Charge added.'); } catch (e) { toast(e.message, 'err'); }
  }

  return (
    <Section title="Charges on this quote"
      help={d.editable ? 'Kits, shipping, fees and discounts at this client\'s price. Once accepted, they are used whenever the charge goes on one of the client\'s orders.' : 'Locked with the quote: create a new version to change them.'}
      actions={d.editable && <Button type="button" variant="outline-secondary" onClick={add}>+ Add a charge…</Button>}>
      <EditableGrid readOnly rows={d.rows} columns={columns} emptyText="No charges on this quote." />
      <p className="help">{d.rows.length ? `Charges total: ${money(d.rows.reduce((s, r) => s + Number(r.line_total || 0), 0))}` : ''}</p>
    </Section>
  );
}

// ---------------------------------------------------------------- a client's service lines (client page)
export function ClientServiceLinesCard({ clientId, canEdit }) {
  const { data: rows, reload } = useApi(() => api.clientServiceLines(clientId), [clientId]);
  const dialogs = useDialogs();
  const toast = useToast();
  if (!rows) return null;
  const chosen = rows.filter((x) => x.chosen);

  async function change() {
    const picked = new Set(chosen.map((x) => x.id));
    const v = await dialogs.form({ title: 'Client service lines', okText: 'Continue',
      after: <PickList items={rows.map((x) => ({ value: x.id, label: x.line_name }))} picked={picked} /> });
    if (!v) return;
    const reason = await dialogs.reason('the client\'s service lines'); if (reason === null) return;
    try { await api.saveClientServiceLines(clientId, [...picked], reason); toast('Saved.'); reload(); } catch (e) { toast(e.message, 'err'); }
  }

  return (
    <Section title="Service lines" help="What this client buys from us. The test picker on their orders opens on these first."
      actions={canEdit && <Button type="button" variant="outline-secondary" onClick={change}>Change…</Button>}>
      <p>{chosen.length ? chosen.map((x, i) => <span key={x.id}>{i > 0 && ' '}<span className="badge text-bg-secondary">{x.line_name}</span></span>) : <span className="help">None chosen yet.</span>}</p>
    </Section>
  );
}
