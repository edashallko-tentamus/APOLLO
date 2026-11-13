// An invoice or credit note (#/billing/invoices/:id): details with the payment status, lines (Price…, Rush…, Add a
// charge…, take lines off), totals, corrections, QuickBooks, emails; Issue…, Credit…, Record payment…, Correct PO….
import { useMemo, useRef, useState } from 'react';
import {
  addInvoiceCharge, correctionPdfUrl, correctPo, creditInvoice, getInvoice, recordPayment, releaseInvoice, removeLines, setLinePrice, setLineRush, updateInvoice,
} from '../../api/billing.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import Modal from '../../components/Modal.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { money } from '../../lib/format.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { SelectGrid } from '../reports/shared.jsx';
import { d8, dt, Failed, issueDrafts, Loading, pdfOf } from './shared.jsx';
import { Button, Form } from 'react-bootstrap';

const late = (l) => Number(l.late_days) > 0 && l.rush_ordered;
const lineRow = (l) => (late(l) ? 'bllate' : l.retest_of_id ? 'blretest' : l.is_charge ? 'blcharge' : '');
const LINE_COLS = [
  { field: 'line_no', title: '#', type: 'readonly', width: 35 },
  { field: 'sample_code', title: 'Sample', type: 'link', width: 125, href: (l) => (l.sample_id ? '#/samples/' + l.sample_id : null), format: (v, l) => v || (l.is_charge ? 'Order' : '') },
  { field: 'client_sample_id', title: 'Client sample ID', type: 'readonly', width: 110 },
  { field: 'test_name', title: 'Test or charge', type: 'readonly', width: 210, format: (v, l) => (l.retest_of_id ? 'Retest: ' : l.is_charge ? 'Charge: ' : '') + v },
  { field: 'completed_on', title: 'Date', type: 'readonly', width: 105, format: d8 },
  { field: 'list_price', title: 'List', type: 'money', width: 75 },
  { field: 'quoted_price', title: 'Ordered at', type: 'money', width: 85 },
  { field: 'price', title: 'Billed', type: 'money', width: 80, cellClass: (l) => (Number(l.price) !== Number(l.quoted_price) ? 'bllate' : '') },
  { field: 'rush', title: 'Rush', type: 'readonly', width: 170, compute: (l) => (l.rush_ordered ? (l.rush_billed === l.rush_ordered ? l.rush_ordered : `${l.rush_ordered} ordered; ${l.rush_billed ? l.rush_billed + ' billed' : 'no rush fee'}`) : '') },
  { field: 'rush_fee', title: 'Rush fee', type: 'money', width: 80 },
  { field: 'late_days', title: 'Late', type: 'readonly', width: 75, format: (v) => (Number(v) > 0 ? `${v} day${Number(v) === 1 ? '' : 's'}` : ''), cellClass: (l) => (late(l) ? 'bllate' : '') },
  { field: 'amount', title: 'Amount', type: 'money', width: 90, cellClass: (l) => (Number(l.amount) < 0 ? 'blneg' : '') },
  { field: 'notes', title: 'Notes', type: 'readonly', width: 280, compute: (l) => [l.charge_no, l.line_note, l.price_note ? 'Price: ' + l.price_note : '', l.rush_note ? 'Rush: ' + l.rush_note : '', l.credited_by ? 'Credited by ' + l.credited_by : ''].filter(Boolean).join(' · ') },
];
const None = () => <span className="help">none</span>;
const Cell = ({ label, children }) => <div><span>{label}</span><b>{children || <None />}</b></div>;

export default function InvoicePage({ params: [id] }) {
  const { site } = useSession();
  const siteId = site?.id;
  const dialogs = useDialogs();
  const toast = useToast();
  const { data: d, error, reload } = useApi(() => getInvoice(id), [id]);
  const g = useRef(null);
  const [showJson, setShowJson] = useState(false);
  const [busy, setBusy] = useState(false);
  const mine = !!d && d.invoice.status === 'Draft' && d.invoice.claimed_by === d.me && d.can_issue;
  const columns = useMemo(() => (!mine ? LINE_COLS : [...LINE_COLS,
    { field: 'p', title: '', type: 'button', width: 70, label: (l) => (l.is_charge ? '' : 'Price…'), onClick: (l) => { if (!l.is_charge) priceDialog(dialogs, toast, l).then((ok) => ok && reload()); } },
    { field: 'r', title: '', type: 'button', width: 70, label: (l) => (l.rush_options && l.rush_options.length > 1 ? 'Rush…' : ''),
      onClick: (l) => { if (l.rush_options && l.rush_options.length > 1) dialogs.open((done) => <RushDialog l={l} onDone={done} />).then((ok) => { if (ok) { toast('Rush saved.'); reload(); } }); } },
  ]), [mine, dialogs, toast, reload]);
  if (error && !d) return <Failed error={error} />;
  if (!d) return <Loading />;

  const i = d.invoice;
  const draft = i.status === 'Draft';
  const credit = i.kind === 'Credit note';
  const issuedInvoice = !draft && !credit && i.status === 'Issued';
  const title = draft ? `Draft invoice ${i.draft_code}` : `${i.kind} ${i.invoice_number}`;
  const sub = draft ? `${i.client_name}, order ${i.order_code}. Being checked by ${i.claimed_by === d.me ? 'you' : i.claimed_by_name}.`
    : `${i.client_name}, order ${i.order_code}. Issued ${dt(i.issued_at)} by ${i.issued_by_name || 'the system'}.`;

  async function run(fn) { setBusy(true); try { await fn(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } }
  async function issue() {
    const r = await issueDrafts(dialogs, toast, [{ id: i.id, code: i.draft_code, total: i.total }]);
    if (!r) return;
    const x = (r.issued || [])[0];
    if (x && x.id !== i.id) window.location.hash = '#/billing/invoices/' + x.id; else reload();
  }
  const release = () => run(async () => { await releaseInvoice(i.id); toast(`${i.draft_code} released: its work is ready to invoice again.`); window.location.hash = '#/billing?tab=ready'; });
  async function takeOff() {
    const sl = g.current.selectedRows(); if (!sl.length) { toast('Select the lines to take off.', 'err'); return; }
    await run(async () => {
      await removeLines(sl.map((l) => l.id)); toast('Taken off: that work is ready to invoice again.');
      if (sl.length >= d.lines.length) window.location.hash = '#/billing?tab=mine'; else reload();
    });
  }
  async function editDetails() {
    const v = await dialogs.form({ title: 'Invoice details', okText: 'Save', fields: [
      { name: 'po_number', label: 'Client PO number', value: i.po_number || '' },
      { name: 'note', label: 'Note printed on the invoice', type: 'textarea', value: i.note || '' },
      { name: 'internal_note', label: 'Internal note (not printed)', type: 'textarea', value: i.internal_note || '' }],
      submit: (x) => updateInvoice(i.id, x) });
    if (v) { toast('Saved.'); reload(); }
  }
  async function payment() {
    const v = await dialogs.form({ title: `Payment of ${i.invoice_number}`, okText: 'Continue',
      intro: `Total ${money(i.total)}. Record the date the client paid (leave it empty to clear a payment recorded by mistake). Recorded by hand until QuickBooks reports payments.`,
      fields: [{ name: 'paid_on', label: 'Paid on', type: 'date', value: i.paid_on ? String(i.paid_on).slice(0, 10) : '' },
        { name: 'paid_note', label: 'Note (cheque number, transfer reference)', value: i.paid_note || '' }] });
    if (!v) return;
    const reason = await dialogs.reason(v.paid_on ? `the payment of ${i.invoice_number}` : `clearing the payment of ${i.invoice_number}`); if (reason === null) return;
    await run(async () => { await recordPayment(i.id, { ...v, reason }); toast(v.paid_on ? 'Payment recorded.' : 'Payment record cleared.'); reload(); });
  }
  async function fixPo() {
    const v = await dialogs.form({ title: `Correct the PO number of ${i.invoice_number}`, okText: 'Continue to sign',
      intro: 'Only the PO number changes; the amounts never do (use a credit note for those). The client is sent a corrected copy of the PDF; the original is kept.',
      fields: [{ name: 'po_number', label: 'Correct PO number', value: i.po_number || '', required: true }] });
    if (!v) return;
    const ok = await dialogs.sign({ title: 'Correct the PO number', meaning: 'Corrected by', needReason: true, okText: 'Sign and correct',
      what: `${i.invoice_number}: PO ${i.po_number || 'none'} → ${v.po_number}`,
      submit: ({ signature, reason }) => correctPo(i.id, { po_number: v.po_number, signature, reason }) });
    if (!ok) return;
    toast(`PO corrected; the corrected copy was sent to ${ok.emails} contact${ok.emails === 1 ? '' : 's'}.`);
    reload();
  }
  async function addCharge() {
    const items = d.charge_items || [];
    if (!items.length) { toast('No charges are in the catalogue for this lab yet (Test catalogue > Charges).', 'err'); return; }
    const v = await dialogs.form({ title: `Add a charge to ${i.draft_code}`, okText: 'Add',
      intro: 'A discount is taken off the invoice. The price defaults to the catalogue price; type another if agreed with the client.', fields: [
        { name: 'charge_item_id', label: 'Charge', type: 'select', blank: false, required: true, value: items[0].id,
          options: items.map((c) => ({ value: c.id, label: `${c.charge_name} (${c.kind}, ${money(c.price)})` })) },
        { name: 'quantity', label: 'Quantity', type: 'number', value: 1 },
        { name: 'price', label: 'Price each (empty: the catalogue price)', type: 'number', value: '' },
        { name: 'sample_id', label: 'For a sample (optional)', type: 'select', options: (d.samples || []).map((x) => ({ value: x.id, label: x.sample_code + (x.client_sample_id ? ' (' + x.client_sample_id + ')' : '') })) },
        { name: 'note', label: 'Printed under the line', value: '' }] });
    if (!v) return;
    const reason = await dialogs.reason('a charge added at invoicing'); if (reason === null) return;
    await run(async () => { await addInvoiceCharge(i.id, { ...v, reason }); toast('Charge added.'); reload(); });
  }
  async function creditIt() {
    const open = d.lines.filter((l) => l.kind === 'Charge' && !l.credited_by);
    const sel = g.current.selectedRows().filter((l) => open.some((o) => o.id === l.id));
    const lines = sel.length ? sel : open;
    if (!lines.length) { toast('Every line of this invoice is credited already.', 'err'); return; }
    const amount = lines.reduce((x, l) => x + Number(l.amount), 0);
    const v = await dialogs.form({ title: `Credit ${i.invoice_number}`, okText: 'Continue to sign',
      intro: `${sel.length ? 'The selected lines' : 'Every line not yet credited'}: ${lines.length} line${lines.length === 1 ? '' : 's'}, ${money(amount)}. Select lines on the invoice first to credit only some. The credit note is emailed to the client and queued for QuickBooks.`,
      fields: [{ name: 'credit_reason', label: 'Reason (printed on the credit note)', type: 'textarea', required: true },
        { name: 'rebill', label: 'Invoice the work again', type: 'checkbox', value: true, cbLabel: 'The work goes back to Ready to invoice (to be invoiced correctly). Untick for a credit that is final.' }] });
    if (!v) return;
    const ok = await dialogs.sign({ title: 'Issue a credit note', meaning: 'Credited by', needReason: false, okText: 'Sign and issue',
      what: `a credit note of ${money(amount)} against ${i.invoice_number}`,
      submit: ({ signature }) => creditInvoice(i.id, { lines: sel.length ? sel.map((l) => l.id) : null, rebill: v.rebill, credit_reason: v.credit_reason, signature }) });
    if (!ok) return;
    toast(`Credit note ${ok.credit_note.invoice_number} issued and sent.`);
    window.location.hash = '#/billing/invoices/' + ok.credit_note.id;
  }

  const pay = i.payment_status && <span className={`blpay ${i.payment_status}`}>{i.payment_status}</span>;
  return <>
    <PageHeader title={title} subtitle={sub} audit={{ kind: 'invoice', id: i.id }} actions={<>
      <Button type="button" variant="outline-secondary" onClick={() => pdfOf(i.id, siteId)}>{draft ? 'Preview PDF' : 'PDF'}</Button>{' '}
      {mine && <><Button type="button" variant="primary" onClick={issue}>Issue…</Button>{' '}<Button type="button" variant="outline-secondary" disabled={busy} onClick={release}>Release draft</Button></>}{' '}
      {issuedInvoice && d.can_issue && Number(i.total) !== 0 && <Button type="button" variant="outline-secondary" onClick={creditIt}>Credit…</Button>}</>} />
    {i.catchup && <div className="blbanner">Catch-up invoice: work completed before invoicing moved into LIMS3, dated the Friday of the week its COA was issued. It was not emailed or queued for QuickBooks.</div>}
    {credit && <div className="blbanner cn">Credits invoice <a href={'#/billing/invoices/' + i.credit_of_id}>{i.credits_number}</a>. Reason: {i.reason || ''}</div>}
    {d.credits.length > 0 && <div className="blbanner cn">Credited by {d.credits.map((x, k) => <span key={x.id}>{k > 0 && '; '}<a href={'#/billing/invoices/' + x.id}>{x.code}</a> ({money(-Number(x.total))}, {x.reason || ''})</span>)}.</div>}
    <Section title={credit ? 'Credit note details' : 'Invoice details'} actions={<>
      {mine && <Button type="button" variant="outline-secondary" onClick={editDetails}>Change…</Button>}{' '}
      {issuedInvoice && d.can_issue && <Button type="button" variant="outline-secondary" onClick={payment}>{i.paid_on ? 'Change payment…' : 'Record payment…'}</Button>}{' '}
      {issuedInvoice && d.can_issue && !i.catchup && <Button type="button" variant="outline-secondary" onClick={fixPo}>Correct PO…</Button>}</>}>
      <div className="bldet">
        <Cell label="Client"><a href={'#/clients/' + i.client_id}>{i.client_name}</a></Cell>
        <Cell label="Order"><a href={'#/orders/' + i.lab_order_id}>{i.order_code}</a></Cell>
        <Cell label="Client PO">{i.po_number}</Cell>
        {draft ? <Cell label="Invoice date">when issued</Cell> : <Cell label={credit ? 'Date' : 'Invoice date'}>{d8(i.invoice_date)}</Cell>}
        {!credit && <Cell label="Due">{draft ? `net ${i.payment_terms_days ?? ''} days from issue` : <>{d8(i.due_date)} <span className="help">(net {i.payment_terms_days})</span></>}</Cell>}
        {issuedInvoice && <Cell label="Payment">{pay}{i.paid_on && <> <span className="help">{d8(i.paid_on)}{i.paid_note ? ', ' + i.paid_note : ''}</span></>}</Cell>}
        {!draft && <Cell label="Bill to">{i.bill_to_name || ''}{i.bill_to_address && <><br /><span className="help">{i.bill_to_address}</span></>}</Cell>}
        <Cell label="Note on the invoice">{i.note}</Cell><Cell label="Internal note">{i.internal_note}</Cell>
      </div>
      {i.paid_recorded_at && <p className="help">Payment recorded by {i.paid_recorded_by_name || ''} {dt(i.paid_recorded_at)}. Recorded by hand until QuickBooks is connected.</p>}
    </Section>
    <div className="blinv"><div>
      <Section title="Lines" help={draft ? (mine ? 'Check each line against the quote. Price… corrects the price billed (with a reason, printed under the line); Rush… bills a late rush at the tier whose turnaround was met, or standard. Take off what should not be invoiced yet. Add a charge… puts a kit, shipping, a fee or a discount on this invoice (it is recorded on the order too).' : 'Only the person checking this draft changes it.') : ''}>
        {mine && <div className="blfil"><Button type="button" variant="outline-secondary" onClick={addCharge}>Add a charge…</Button> <Button type="button" variant="outline-secondary" disabled={busy} onClick={takeOff}>Take selected lines off</Button></div>}
        <SelectGrid gridRef={g} rows={d.lines} columns={columns} rowClass={lineRow} />
      </Section>
      {(d.corrections || []).length > 0 && <Section title="Corrections" help="Each correction changed the PO number only, was signed with a reason, and sent the client a corrected copy. The original PDF is kept unchanged.">
        <ul>{d.corrections.map((k) => <li key={k.id}>{dt(k.created_at)}: PO {k.old_value || 'none'} → {k.new_value || 'none'} by {k.by_name} ({k.reason}).{' '}
          {k.document_id && <a href={correctionPdfUrl(k.id, siteId)} target="_blank" rel="noopener noreferrer">Corrected copy</a>} <span className="help">QuickBooks: {k.push_status}</span></li>)}</ul>
      </Section>}
      {d.push && <Section title="QuickBooks Online" help={`Queued ${dt(d.push.created_at)} as ${d.push.entity}: ${d.push.status}${d.push.last_error ? ' (' + d.push.last_error + ')' : ''}.`}
        actions={<Button type="button" variant="light" onClick={() => setShowJson((x) => !x)}>Show what is sent</Button>}>
        {showJson && <pre className="bljson">{JSON.stringify(d.push.payload, null, 2)}</pre>}
      </Section>}
      {d.emails.length > 0 && <Section title="Emailed" help="Sandbox: stored in the Outbox, not actually sent.">
        <ul>{d.emails.map((e, k) => <li key={k}>{e.to_address}: {e.subject} <span className="help">{dt(e.created_at)}</span></li>)}</ul>
      </Section>}
    </div><div>
      <Section title={credit ? 'Credit' : 'Totals'} className="bltot">
        <div><span>List value</span><span>{money(i.list_total)}</span></div><div><span>Discounts</span><span>{money(-Number(i.discount_total))}</span></div>
        <div><span>Rush fees</span><span>{money(i.rush_total)}</span></div><div className="big"><span>{credit ? 'Credited' : 'Total'}</span><span>{money(i.total)}</span></div>
      </Section>
    </div></div>
  </>;
}

async function priceDialog(dialogs, toast, l) {
  const v = await dialogs.form({ title: `Price billed: ${l.sample_code} ${l.test_name}`, okText: 'Save',
    intro: `List price ${money(l.list_price)}; ordered at ${money(l.quoted_price)} (from the quote). The reason is printed under the line.`, fields: [
      { name: 'price', label: 'Price billed', type: 'number', value: l.price, required: true },
      { name: 'note', label: 'Why it differs from the order', type: 'textarea', value: l.price_note || '' }],
    submit: (x) => setLinePrice(l.id, x) });
  if (v) toast('Price saved.');
  return !!v;
}

// The rush billed for a line: ordered, a tier whose turnaround was met, or standard (never dearer)
function RushDialog({ l, onDone }) {
  const opts = l.rush_options || [];
  const closest = opts.filter((o) => o.met && o.tier_id).sort((a, b) => a.tat_days - b.tat_days)[0];
  const startTier = opts.some((o) => (o.tier_id || null) === (l.rush_tier_id || null) && (o.is_ordered || o.met)) ? (l.rush_tier_id || '') : undefined;
  const [tier, setTier] = useState(startTier);
  const [note, setNote] = useState(l.rush_note || (Number(l.late_days) > 0 ? `Reported ${l.late_days} working days late: billed at the tier met.` : ''));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function ok() {
    if (tier === undefined) { setError('Choose the tier to bill.'); return; }
    setBusy(true); setError('');
    try { await setLineRush(l.id, { tier_id: tier || null, note: note.trim() }); onDone(true); } catch (e) { setBusy(false); setError(e.message); }
  }
  return <Modal title={`Rush billed: ${l.sample_code} ${l.test_name}`} okText="Save" wide error={error} busy={busy} onOk={ok} onClose={() => onDone(null)}>
    <p className="intro">{Number(l.late_days) > 0 ? <>Reported {d8(l.completed_on)}, <b>{l.late_days} working day{Number(l.late_days) === 1 ? '' : 's'} after</b> the rush due date ({d8(l.due_date)}).</> : 'Reported on time.'}
      {closest ? <> The closest tier whose turnaround was met: <b>{closest.tier_name}</b>.</> : ' No rush tier\'s turnaround was met.'}</p>
    <table className="blopts"><thead><tr><th /><th>Tier</th><th>Would be due</th><th>Met?</th><th>Fee</th></tr></thead><tbody>
      {opts.map((o, k) => { const allowed = o.is_ordered || o.met; const v = o.tier_id || '';
        return <tr key={k} className={o.met ? 'met' : 'missed'}><td>{allowed && <Form.Check.Input type="radio" name="tier" id={'rt' + k} value={v} checked={tier === v} onChange={() => setTier(v)} />}</td>
          <td><label htmlFor={'rt' + k}>{o.tier_name}{o.is_ordered && o.tier_id ? ' (ordered)' : ''}</label></td><td>{d8(o.due_date)}</td><td>{o.met ? 'Met' : 'Missed'}</td><td>{money(o.fee)}</td></tr>; })}
    </tbody></table>
    <div className="field"><label htmlFor="f_rnote">Why (printed under the line)</label><Form.Control as="textarea" id="f_rnote" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></div>
  </Modal>;
}
