// Parts every purchasing screen uses: formats, the tabs, the request columns, the colours of status cells.
import { useHashRoute } from '../../router/useHashRoute.js';
import './purchasing.css';
import { Card, Nav } from 'react-bootstrap';

export const d8 = (v) => (v ? String(v).slice(0, 10) : '');
export const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '');
export const money = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
export const num = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 6 }));
export const today = () => { const t = new Date(); t.setMinutes(t.getMinutes() - t.getTimezoneOffset()); return t.toISOString().slice(0, 10); };
export const supCls = (s) => (s === 'Approved' ? 'cok' : s ? 'cbad' : '');
export const statCls = (s) => (['Awaiting second approval', 'Requested'].includes(s) ? 'cwarn' : s === 'Rejected' ? 'cbad' : ['Received'].includes(s) ? 'cok' : '');
export const expCls = (v) => { if (!v) return ''; const d = (new Date(v) - Date.now()) / 864e5; return d < 0 ? 'cbad' : d <= 60 ? 'cwarn' : ''; };
export const levelText = (r) => (r.decided_at === 'Corporate' ? 'Corporate' : r.decided_at === 'This lab' ? 'This lab' : '');
export const decisionText = (status, scopes) => (status ? status + (status === 'Approved' && scopes ? ` (${scopes})` : '') : '');
export const mutedInactive = (r) => (r.status === 'Inactive' ? 'mutedrow' : '');
export const DISCREPANCIES = ['None', 'Damaged', 'Temperature excursion', 'Short shipped', 'Wrong item', 'Other'];
export const DOC_KINDS = ['Questionnaire', 'Certificate', 'Audit report', 'Quality agreement', 'Other'];

// the old screens' signDialog wrapper: fn(reason, signature) runs while the dialog is open
export const signed = (dialogs, o, fn) => dialogs.sign({ ...o, submit: ({ reason, signature }) => fn(reason, signature) });

export async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer()); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// a definition list; empty values show a dash
export function Kv({ pairs }) {
  return <dl className="kv">{pairs.filter(Boolean).map(([k, v]) => <Pair key={k} k={k} v={v} />)}</dl>;
}
const Pair = ({ k, v }) => <><dt>{k}</dt><dd>{v === null || v === undefined || v === '' ? '—' : v}</dd></>;

const TABS = [['#/purchasing', 'Requests'], ['#/purchasing/receive', 'Receive'], ['#/purchasing/orders', 'Purchase orders'],
  ['#/purchasing/suppliers', 'Vendor approvals'], ['#/purchasing/risk-classes', 'Risk classes and scopes'], ['#/purchasing/settings', 'Settings']];
export function PuTabs() {
  let cur = '#' + useHashRoute().path;
  if (cur === '#/purchasing/vendors') cur = '#/purchasing/suppliers';
  return <Nav variant="pills" className="putabs">{TABS.map(([h, l]) => <Nav.Link active={h === cur} key={h} href={h}>{l}</Nav.Link>)}</Nav>;
}

export const NeedLab = () => <Card body className="err">Choose your lab (top right) first.</Card>;
export const Loading = () => <div className="loading">Loading…</div>;
export const Failed = ({ error }) => <Card body className="err">{error.message}</Card>;
export const openRequest = (r) => { window.location.hash = '#/purchasing/requests/' + r.id; };
export const closedRow = (r) => (['Cancelled', 'Rejected', 'Received'].includes(r.status) ? 'mutedrow' : '');

// the request columns, shared by the queue, Receive, an order and a vendor page
const PICK = { field: '_pick', title: '☐', type: 'bool', width: 40, help: 'Tick requests to approve, reject or order together' };
export const LINE_COLS = [
  { field: 'line_code', title: 'Request', type: 'link', width: 95, href: (r) => '#/purchasing/requests/' + r.id },
  { field: 'status', title: 'Status', type: 'readonly', width: 150, cellClass: (r) => statCls(r.status) },
  { field: 'line_type', title: 'Kind', type: 'readonly', width: 105 },
  { field: 'description', title: 'What', type: 'readonly', width: 220 },
  { field: 'supplier_name', title: 'Supplier', type: 'readonly', width: 170, format: (v, r) => (v ? v + (r.supplier_status !== 'Approved' ? ` (${r.supplier_status})` : '') : 'No supplier yet'), cellClass: (r) => (r.supplier_id && r.supplier_status !== 'Approved' ? 'cbad' : '') },
  { field: 'qty', title: 'Quantity', type: 'readonly', width: 90, compute: (r) => `${num(r.quantity)} ${r.unit || ''}`.trim() },
  { field: 'amount', title: 'Amount', type: 'readonly', width: 95, align: 'right', format: (v, r) => (v === null ? 'No price' : money(v) + (r.needs_second ? ' *' : '')) },
  { field: 'requested_by_name', title: 'Requested by', type: 'readonly', width: 140 },
  { field: 'requested_at', title: 'Requested', type: 'readonly', width: 95, format: d8 },
  { field: 'po_code', title: 'Order', type: 'link', width: 110, href: (r) => (r.purchase_order_id ? '#/purchasing/orders/' + r.purchase_order_id : null), format: (v, r) => (v ? v + (r.external_po_number ? ' / ' + r.external_po_number : '') : '') },
  { field: 'scope_text', title: 'For', type: 'readonly', width: 170, help: 'What the request is for (its supply scope): the vendor must be approved for it' },
];
export const QUEUE_COLS = [PICK, ...LINE_COLS];
export const lineColsWithout = (...fields) => LINE_COLS.filter((c) => !fields.includes(c.field));
