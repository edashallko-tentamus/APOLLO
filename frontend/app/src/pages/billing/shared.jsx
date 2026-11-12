// Parts the billing screens share: formats, states, issuing drafts with one signature.
import { invoicePdfUrl, issueInvoices } from '../../api/billing.js';
import { money } from '../../lib/format.js';
import './billing.css';
import { Card } from 'react-bootstrap';

export const d8 = (v) => { if (!v) return ''; const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString([], { dateStyle: 'medium' }) : ''; };
export const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
export const pdfOf = (id, siteId) => window.open(invoicePdfUrl(id, siteId), '_blank');
export const Loading = () => <div className="loading">Loading…</div>;
export const Failed = ({ error }) => <Card body className="err">{error.message}</Card>;

// Issue draft invoices with one signature ("Invoiced by"); gives the answer ({ issued: [...] }) or null
export async function issueDrafts(dialogs, toast, rows) {
  if (!rows.length) { toast('Select the draft invoices to issue.', 'err'); return null; }
  const total = rows.reduce((s, r) => s + Number(r.total || 0), 0);
  const ok = await dialogs.sign({ title: 'Issue invoices', meaning: 'Invoiced by', needReason: false, okText: 'Sign and issue',
    what: `${rows.length} invoice${rows.length === 1 ? '' : 's'} (${rows.map((r) => r.code).join(', ')}), ${money(total)} in all. Each is numbered and dated today, emailed with its PDF to the client's billing contacts and queued for QuickBooks`,
    submit: ({ signature }) => issueInvoices(rows.map((r) => r.id), signature) });
  if (!ok) return null;
  toast(`Issued and sent: ${(ok.issued || []).map((x) => x.invoice_number).join(', ')}.`);
  return ok;
}
