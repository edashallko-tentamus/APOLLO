// Billing (#/billing): tabs Ready to invoice, My draft invoices, All drafts, Invoices and credit notes, QuickBooks queue,
// Settings. The reviewer claims completed work into drafts (one per lab order), checks them, then issues with one signature.
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  billingInvoices, billingReady, billingSettings, claimWork, listIssuedInvoices, releaseInvoice, saveConnection, savePaymentTerms,
} from '../../api/billing.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import EditableGrid from '../../components/EditableGrid.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import PagedList from '../../components/PagedList.jsx';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { money } from '../../lib/format.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { SelectGrid } from '../reports/shared.jsx';
import { d8, dt, Failed, issueDrafts, Loading, pdfOf } from './shared.jsx';
import { Button, Card, Nav } from 'react-bootstrap';

const TABS = [['ready', 'Ready to invoice'], ['mine', 'My draft invoices'], ['drafts', 'All drafts'], ['issued', 'Invoices and credit notes'], ['queue', 'QuickBooks queue'], ['settings', 'Settings']];
const INTRO = {
  ready: 'Work whose COA has been issued to the client and is not invoiced yet. Select the work to invoice and claim it: each lab order\'s work goes onto your own draft invoice, which nobody else can change or issue. Orange rows are rushes reported late.',
  mine: 'Your draft invoices. Open each one to check the prices and discounts against the quote and any late rush, then select the drafts and issue them with one signature: each is numbered, dated today, emailed to the client\'s billing contacts and queued for QuickBooks.',
  drafts: 'Every draft invoice at this lab and who is checking it. Only the holder changes or issues a draft; a lab administrator can take one back with a reason.',
  issued: 'Invoices and credit notes issued at this lab, newest first. The amounts of an issued invoice never change: correct them with a credit note from its page. Payments are recorded by hand on the invoice until QuickBooks is connected.',
  queue: 'What was queued for this lab\'s QuickBooks Online company, as its API takes it. Nothing is sent until a system administrator connects the lab (Settings).',
  settings: 'Clients\' payment terms, and this lab\'s accounting company (each lab is its own QuickBooks Online company).',
};
const s = (n) => (n === 1 ? '' : 's');

export default function BillingPage({ query }) {
  const { can } = useSession();
  const t = new URLSearchParams(query).get('tab');
  const tab = TABS.some(([k]) => k === t) ? t : 'ready';
  return <>
    <PageHeader title="Billing" subtitle={INTRO[tab]} audit={{ kind: 'billing' }} />
    <Nav variant="pills" className="bltabs">{TABS.map(([k, l]) => <Nav.Link active={k === tab} key={k} href={`#/billing?tab=${k}`}>{l}</Nav.Link>)}</Nav>
    {!can('invoicing.issue') && <div className="alert alert-warning">You can see invoicing here. Claiming, checking and issuing invoices needs the invoicing.issue permission (Accounting and General Managers).</div>}
    {tab === 'ready' ? <ReadyTab /> : tab === 'settings' ? <SettingsTab /> : tab === 'queue' ? <QueueTab />
      : tab === 'issued' ? <IssuedTab query={query} /> : <DraftsTab key={tab} tab={tab} />}
  </>;
}

// ---------------------------------------------------------------- ready to invoice
const lateRush = (r) => Number(r.late_days) > 0 && Number(r.rush_fee) > 0;
const FILTERS = { all: ['All', () => true], late: ['Late rush', lateRush], rush: ['Rush', (r) => Number(r.rush_fee) > 0], retest: ['Retests', (r) => r.is_retest || r.was_retested],
  discount: ['Discounted', (r) => Number(r.discount) > 0], stability: ['Stability pulls', (r) => r.stability] };
let lastFilter = 'all'; // stays while the person moves around, as in the current app
const READY_COLS = [
  { field: 'completed_on', title: 'Reported', type: 'readonly', width: 110, format: d8 },
  { field: 'order_code', title: 'Order', type: 'link', width: 95, href: (r) => '#/orders/' + r.lab_order_id },
  { field: 'po_number', title: 'PO', type: 'readonly', width: 90 },
  { field: 'client_name', title: 'Client', type: 'link', width: 170, href: (r) => '#/clients/' + r.client_id },
  { field: 'sample_code', title: 'Sample', type: 'link', width: 125, href: (r) => '#/samples/' + r.sample_id },
  { field: 'client_sample_id', title: 'Client sample ID', type: 'readonly', width: 115 },
  { field: 'test_name', title: 'Test', type: 'readonly', width: 200 },
  { field: 'list_price', title: 'List', type: 'money', width: 80 },
  { field: 'discount', title: 'Discount', type: 'money', width: 80 },
  { field: 'price', title: 'Price', type: 'money', width: 80 },
  { field: 'rush_fee', title: 'Rush fee', type: 'money', width: 80 },
  { field: 'late_days', title: 'Late', type: 'readonly', width: 95, format: (v, r) => (Number(v) > 0 ? `${v} day${s(Number(v))}${Number(r.rush_fee) > 0 ? ' (rush)' : ''}` : ''), cellClass: (r) => (lateRush(r) ? 'bllate' : '') },
  { field: 'amount', title: 'Amount', type: 'money', width: 90 },
  { field: 'notes', title: 'Notes', type: 'readonly', width: 300, compute: (r) => [r.rush_tier_name && Number(r.rush_fee) > 0 ? 'Rush: ' + r.rush_tier_name : '', r.is_retest ? `Retest of ${r.retest_of}${r.oos_code ? ' (' + r.oos_code + ')' : ''}${r.billing_status === 'Non-billable' ? ', not charged' : ''}` : '',
    r.was_retested ? 'Retested' : '', r.stability ? 'Stability pull' : ''].filter(Boolean).join(' · ') },
];
const CHARGE_COLS = [
  { field: 'created_at', title: 'Added', type: 'readonly', width: 110, format: d8 },
  { field: 'order_code', title: 'Order', type: 'link', width: 95, href: (r) => '#/orders/' + r.lab_order_id },
  { field: 'po_number', title: 'PO', type: 'readonly', width: 90 },
  { field: 'client_name', title: 'Client', type: 'link', width: 170, href: (r) => '#/clients/' + r.client_id },
  { field: 'charge_no', title: 'Charge', type: 'readonly', width: 95 },
  { field: 'charge_name', title: 'What', type: 'readonly', width: 200 },
  { field: 'kind', title: 'Kind', type: 'readonly', width: 90 },
  { field: 'sample_code', title: 'Sample', type: 'link', width: 125, href: (r) => (r.sample_id ? '#/samples/' + r.sample_id : null) },
  { field: 'quantity', title: 'Qty', type: 'readonly', width: 50 },
  { field: 'unit_price', title: 'Each', type: 'money', width: 80 },
  { field: 'amount', title: 'Amount', type: 'money', width: 90, cellClass: (r) => (Number(r.amount) < 0 ? 'blneg' : '') },
  { field: 'note', title: 'Note', type: 'readonly', width: 220, compute: (r) => [r.note, r.project_code ? 'Price from ' + r.project_code : ''].filter(Boolean).join(' · ') },
];
const readyRow = (r) => (lateRush(r) ? 'bllate' : r.is_retest ? 'blretest' : '');
const NONE = [];

function ReadyTab() {
  const toast = useToast();
  const { data: d, error } = useApi(() => billingReady(), []);
  const [filter, setFilterState] = useState(() => (FILTERS[lastFilter] ? lastFilter : 'all'));
  const setFilter = (k) => { lastFilter = k; setFilterState(k); };
  const [busy, setBusy] = useState(false);
  const g = useRef(null); const g2 = useRef(null);
  const rows = useMemo(() => (d ? d.rows.filter(FILTERS[filter][1]) : NONE), [d, filter]);
  if (error && !d) return <Failed error={error} />;
  if (!d) return <Loading />;
  const charges = d.charges || NONE;
  const sum = (a) => a.reduce((x, r) => x + Number(r.amount || 0), 0);

  async function claim() {
    const sel = g.current.selectedRows(); const sc = g2.current.selectedRows();
    if (!sel.length && !sc.length) { toast('Select the work to invoice (Ctrl+click or Shift+click for several; Ctrl+A for everything shown).', 'err'); return; }
    setBusy(true);
    try {
      const x = await claimWork([...new Set(sel.map((r) => r.requested_test_id))], [...new Set(sc.map((r) => r.order_charge_id))]);
      const what = [sel.length ? `${sel.length} test${s(sel.length)}` : '', sc.length ? `${sc.length} charge${s(sc.length)}` : ''].filter(Boolean).join(' and ');
      toast(`${what} claimed onto ${x.invoices.length} draft invoice${s(x.invoices.length)} (one per lab order).`);
      window.location.hash = x.invoices.length === 1 ? '#/billing/invoices/' + x.invoices[0] : '#/billing?tab=mine';
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  }
  return <>
    <Section title="Completed work not yet invoiced" actions={<Button type="button" variant="primary" disabled={!d.can_issue || busy} onClick={claim}>Claim selected into my drafts</Button>}>
      <div className="blsum"><div><b>{money(sum(d.rows))}</b><span>{d.rows.length} test{s(d.rows.length)} ready</span></div>
        <div><b>{new Set(d.rows.map((r) => r.order_code)).size}</b><span>lab orders</span></div>
        <div><b>{d.rows.filter(lateRush).length}</b><span>late rushes to check</span></div>
        <div><b>{money(sum(charges))}</b><span>{charges.length} charge{s(charges.length)} ready</span></div></div>
      <div className="blfil">Show: {Object.entries(FILTERS).map(([k, [l, fn]]) => (
        <button key={k} type="button" data-f={k} className={k === filter ? 'on' : ''} onClick={() => setFilter(k)}>{l} <small>{d.rows.filter(fn).length}</small></button>))}</div>
      <SelectGrid gridRef={g} rows={rows} columns={READY_COLS} search rowClass={readyRow} emptyText="Nothing is waiting to be invoiced: completed work appears here once its COA is issued." />
    </Section>
    <Section title="Charges not yet invoiced" help="Kits, shipping, report fees, surcharges and discounts added to lab orders. They are ready at once (no testing, no COA). Select them here as well as tests: one Claim puts both on the order's draft.">
      <SelectGrid gridRef={g2} rows={charges} columns={CHARGE_COLS} search emptyText="No charges waiting: add kits, shipping and fees on the lab order (Charges card)." />
    </Section>
  </>;
}

// ---------------------------------------------------------------- drafts and issued invoices
const negCell = (r) => (Number(r.total) < 0 ? 'blneg' : '');
function invoiceCols(tab, me, siteId) {
  return [
    { field: 'code', title: tab === 'issued' ? 'Number' : 'Draft', type: 'link', width: 135, href: (r) => '#/billing/invoices/' + r.id },
    ...(tab === 'issued' ? [{ field: 'kind', title: 'Kind', type: 'readonly', width: 90 }, { field: 'invoice_date', title: 'Date', type: 'readonly', width: 105, format: d8 },
      { field: 'due_date', title: 'Due', type: 'readonly', width: 105, format: (v, r) => (r.kind === 'Invoice' ? d8(v) : '') }] : []),
    { field: 'client_name', title: 'Client', type: 'link', width: 180, href: (r) => '#/clients/' + r.client_id },
    { field: 'order_code', title: 'Order', type: 'link', width: 95, href: (r) => '#/orders/' + r.lab_order_id },
    { field: 'po_number', title: 'PO', type: 'readonly', width: 90 },
    { field: 'line_count', title: 'Tests', type: 'readonly', width: 55 },
    { field: 'sample_count', title: 'Samples', type: 'readonly', width: 65 },
    { field: 'total', title: 'Total', type: 'money', width: 95, cellClass: negCell },
    ...(tab === 'issued' ? [
      { field: 'payment_status', title: 'Payment', type: 'readonly', width: 95, format: (v) => v || '', cellClass: (r) => (r.payment_status === 'Overdue' ? 'bllate' : '') },
      { field: 'paid_on', title: 'Paid', type: 'readonly', width: 100, format: d8 },
      { field: 'credited', title: 'Credited', type: 'readonly', width: 85, format: (v) => (Number(v) ? money(v) : '') },
      { field: 'credits_number', title: 'Credits', type: 'readonly', width: 120 },
      { field: 'catchup', title: 'Catch-up', type: 'readonly', width: 75, format: (v) => (v ? 'Yes' : '') },
      { field: 'push_status', title: 'QuickBooks', type: 'readonly', width: 150, format: (v, r) => (r.catchup ? 'Not sent (catch-up)' : v || '') },
      { field: 'issued_by_name', title: 'Issued by', type: 'readonly', width: 140 },
      { field: 'pdf', title: '', type: 'button', width: 60, label: 'PDF', onClick: (r) => pdfOf(r.id, siteId) }]
      : [{ field: 'late_rush_count', title: 'Late rushes', type: 'readonly', width: 85, format: (v) => (Number(v) ? v : '') },
        { field: 'claimed_by_name', title: 'Held by', type: 'readonly', width: 150, format: (v, r) => (r.claimed_by === me ? 'You' : v) },
        { field: 'created_at', title: 'Claimed', type: 'readonly', width: 140, format: dt },
        { field: 'internal_note', title: 'Internal note', type: 'readonly', width: 160 }]),
  ];
}

const ISSUED_FILTERS = [['all', 'All'], ['invoices', 'Invoices'], ['unpaid', 'Unpaid'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['credits', 'Credit notes']];
const openInvoice = (r) => { window.location.hash = '#/billing/invoices/' + r.id; };
function IssuedTab({ query }) {
  const { site } = useSession();
  const siteId = site?.id;
  const columns = useMemo(() => invoiceCols('issued', null, siteId), [siteId]);
  const load = useCallback((params, opts) => listIssuedInvoices(params, opts), []);
  // one page at a time from the server (0.35.0), newest first; the totals cover every invoice matching the tab and search
  return <Card body>
    <PagedList load={load} query={query} filters={ISSUED_FILTERS} filterParam="f" open={openInvoice}
      placeholder="Search by number, client, order, PO or who issued it; type or scan an invoice number and press Enter to open it">
      {(rows, x) => { const a = x.agg || {}; return <>
        <div className="blsum"><div><b>{money(a.invoiced || 0)}</b><span>invoiced</span></div><div><b>{money(a.credited || 0)}</b><span>credited</span></div><div><b>{a.invoices || 0}</b><span>invoices</span></div></div>
        <ReadGrid rows={rows} columns={columns} emptyText="Nothing issued here." />
      </>; }}
    </PagedList>
  </Card>;
}

function DraftsTab({ tab }) {
  const toast = useToast();
  const dialogs = useDialogs();
  const { data: d, error, reload } = useApi(() => billingInvoices(tab), [tab]);
  const g = useRef(null);
  const [busy, setBusy] = useState(false);
  const columns = useMemo(() => {
    if (!d) return null;
    const cols = invoiceCols(tab, d.me, null);
    if (tab !== 'drafts') return cols;
    return [...cols, { field: 'take', title: '', type: 'button', width: 110, label: (r) => (r.claimed_by !== d.me && d.can_release_any ? 'Take back…' : ''), onClick: async (r) => {
      if (r.claimed_by === d.me || !d.can_release_any) return;
      const reason = await dialogs.reason(`taking ${r.code} back from ${r.claimed_by_name}`); if (reason === null) return;
      try { await releaseInvoice(r.id, { reason }); toast(`${r.code} released: its work is ready to invoice again.`); reload(); } catch (e) { toast(e.message, 'err'); }
    } }];
  }, [d, tab, dialogs, toast, reload]);
  if (error && !d) return <Failed error={error} />;
  if (!d) return <Loading />;
  const mine = tab === 'mine';

  async function issue() {
    const sel = g.current.selectedRows();
    if (await issueDrafts(dialogs, toast, sel.length ? sel : d.rows)) window.location.hash = '#/billing?tab=issued';
  }
  async function release() {
    const sel = g.current.selectedRows(); if (!sel.length) { toast('Select the drafts to release.', 'err'); return; }
    setBusy(true);
    try { for (const r of sel) await releaseInvoice(r.id); toast('Released: the work is ready to invoice again.'); reload(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  }
  return <Section title={mine ? 'My drafts' : 'All drafts at this lab'} actions={mine && <>
    <Button type="button" variant="primary" disabled={!d.rows.length || !d.can_issue} onClick={issue}>Issue selected…</Button>{' '}
    <Button type="button" variant="outline-secondary" disabled={!d.rows.length || busy} onClick={release}>Release selected</Button></>}>
    <div className="blsum"><div><b>{money(d.rows.reduce((x, r) => x + Number(r.total), 0))}</b><span>{d.rows.length} draft{s(d.rows.length)}</span></div></div>
    <SelectGrid gridRef={g} rows={d.rows} columns={columns} search
      emptyText={mine ? 'You hold no draft invoices. Claim completed work on the Ready to invoice tab.' : 'No draft invoices at this lab.'} />
  </Section>;
}

const QUEUE_COLS = [
  { field: 'code', title: 'Number', type: 'link', width: 140, href: (r) => '#/billing/invoices/' + r.id },
  { field: 'entity', title: 'Sent as', type: 'readonly', width: 95 },
  { field: 'client_name', title: 'Client', type: 'readonly', width: 180 },
  { field: 'order_code', title: 'Order', type: 'readonly', width: 95 },
  { field: 'invoice_date', title: 'Date', type: 'readonly', width: 105, format: d8 },
  { field: 'total', title: 'Total', type: 'money', width: 95 },
  { field: 'provider', title: 'Accounting', type: 'readonly', width: 140 },
  { field: 'push_status', title: 'Status', type: 'readonly', width: 160 },
  { field: 'queued_at', title: 'Queued', type: 'readonly', width: 145, format: dt },
  { field: 'last_error', title: 'Last error', type: 'readonly', width: 200 },
];
function QueueTab() {
  const { data: d, error } = useApi(() => billingInvoices('queue'), []);
  return <Card body>{error && !d ? <Failed error={error} /> : !d ? <Loading />
    : <ReadGrid rows={d.rows} columns={QUEUE_COLS} search emptyText="Nothing queued yet: issued invoices and credit notes are queued here (catch-up invoices are not)." />}</Card>;
}

const TERMS_COLS = [
  { field: 'client_code', title: 'Code', type: 'link', width: 90, href: (r) => '#/clients/' + r.id },
  { field: 'client_name', title: 'Client', type: 'readonly', width: 240 },
  { field: 'payment_terms_days', title: 'Payment terms (days)', type: 'int', width: 150 },
  { field: 'billing_emails', title: 'Billing contacts', type: 'readonly', width: 300, format: (v) => v || 'none (the order\'s contact is used)' },
];
function SettingsTab() {
  const toast = useToast();
  const dialogs = useDialogs();
  const { data: d, error, reload } = useApi(() => billingSettings(), []);
  if (error && !d) return <Failed error={error} />;
  if (!d) return <Loading />;
  const c = d.connection || {};
  async function edit() {
    const v = await dialogs.form({ title: `${d.lab.site_code}: accounting company`, okText: 'Save', fields: [
      { name: 'provider', label: 'Accounting system', type: 'select', blank: false, value: c.provider, options: ['QuickBooks Online', 'QuickBooks Desktop', 'SAP'] },
      { name: 'company_name', label: 'Company name', value: c.company_name || '' },
      { name: 'company_id', label: 'Company ID (QuickBooks Online realm ID)', value: c.company_id || '' },
      { name: 'environment', label: 'Environment', type: 'select', blank: false, value: c.environment, options: ['Sandbox', 'Production'] },
      { name: 'item_name', label: 'Product/service the lines are booked to', value: c.item_name || '' },
      { name: 'invoice_remit_to', label: 'Payment details printed on invoices', type: 'textarea', value: d.lab.invoice_remit_to || '' }] });
    if (!v) return;
    const reason = await dialogs.reason('the lab\'s accounting settings'); if (reason === null) return;
    try { await saveConnection({ ...v, reason }); toast('Saved.'); reload(); } catch (e) { toast(e.message, 'err'); }
  }
  return <>
    <Section title={`${d.lab.site_code}: accounting company`} actions={d.is_admin && <Button type="button" variant="outline-secondary" onClick={edit}>Change…</Button>}
      help="Each lab is its own QuickBooks Online company. Invoices are queued for it when issued and sent once a system administrator connects it (the connection itself is built with IT when the company and its access are ready).">
      <dl className="kv"><dt>Accounting system</dt><dd>{c.provider || 'QuickBooks Online'}</dd><dt>Status</dt><dd><b>{c.status || 'Not connected'}</b></dd>
        <dt>Company</dt><dd>{c.company_name || 'not set'}{c.company_id ? ` (company ID ${c.company_id})` : ''}</dd><dt>Environment</dt><dd>{c.environment || ''}</dd>
        <dt>Lines booked to</dt><dd>{c.item_name || ''}</dd><dt>Payment details on invoices</dt><dd>{d.lab.invoice_remit_to || 'not set (placeholder text is printed)'}</dd></dl>
    </Section>
    <Section title="Clients' payment terms" help={`Days after the invoice date (30 = net 30; 0 = due on receipt). ${d.can_issue ? 'Type or paste, fill down with Ctrl+D, then save.' : 'Changed by people who issue invoices.'} Invoices go to each client's Billing contacts (else the order's contact).`}>
      <EditableGrid rows={d.clients} columns={TERMS_COLS} search readOnly={!d.can_issue} what="payment terms" save={savePaymentTerms} afterSave={reload} />
    </Section>
  </>;
}
