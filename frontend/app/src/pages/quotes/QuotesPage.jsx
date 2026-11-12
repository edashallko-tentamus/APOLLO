// Pricing > Quotes: My open quotes / All quotes, filters, Accept… and Reject… on each quoted row (migration 029, paged 0.35.0)
import { useCallback, useMemo, useRef, useState } from 'react';
import * as api from '../../api/quotes.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import PagedList from '../../components/PagedList.jsx';
import SmartSelect from '../../components/SmartSelect.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { decideQuote, newQuote } from './quoteDialogs.js';
import './quotes.css';
import { Button, Card, Nav } from 'react-bootstrap';

export const d8 = (v) => { if (!v) return ''; const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/); return (m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(v)).toLocaleDateString([], { dateStyle: 'medium' }); };
const quoteHref = (r) => (r.kind === 'Stability' ? '#/stability/quotes/' + r.project_id : '#/quote/' + r.version_id);
const ALL_FILTERS = [['open', 'Open'], ['waiting', 'Waiting for the client'], ['Accepted', 'Accepted'], ['Rejected', 'Rejected'], ['expired', 'Expired'], ['all', 'All']];
const NO_FILTERS = [];
const TYPES = [{ value: 'all', label: 'Quotes and projects' }, { value: 'Quote', label: 'Quotes only' }, { value: 'Project', label: 'Projects only' }, { value: 'Stability', label: 'Stability quotes only' }];
const view = { type: 'all', lab: '', owner: '' }; // kept while the page is reopened, as in the current app
const AUDIT = { kind: 'quotes' };

export default function QuotesPage({ query }) {
  const mine = new URLSearchParams(query).get('tab') !== 'all';
  const dialogs = useDialogs(); const toast = useToast();
  const [type, setType] = useState(view.type); const [lab, setLab] = useState(view.lab); const [owner, setOwner] = useState(view.owner);
  const { data: meta, error } = useApi(() => api.listQuotes({ page: 1, size: 1 }, mine ? {} : { tab: 'all' }), [mine]);
  const reloadRef = useRef(null);

  const extra = useMemo(() => ({ tab: mine ? '' : 'all', ty: type !== 'all' ? type : '', lab, own: !mine ? owner : '' }), [mine, type, lab, owner]);
  const load = useCallback((p, opts) => api.listQuotes({ ...p, f: mine ? 'open' : p.f }, extra, opts), [extra, mine]);

  const canEdit = !!meta?.can_edit;
  const columns = useMemo(() => {
    const canDecide = (r) => canEdit && r.status === 'Quoted' && !r.past_valid;
    const act = (r, decision) => { if (canDecide(r)) decideQuote(dialogs, toast, r, decision).then((ok) => { if (ok) reloadRef.current?.(); }); };
    return [
      { field: 'project_code', title: 'Quote', type: 'link', width: 100, compute: (r) => `${r.project_code}${r.version_no > 1 ? ' v' + r.version_no : ''}`, href: quoteHref },
      { field: 'client_name', title: 'Client', type: 'link', width: 150, href: (r) => '#/clients/' + r.client_id },
      { field: 'project_name', title: 'Reference', type: 'readonly', width: 200 },
      { field: 'total', title: 'Total', type: 'money', width: 95 },
      { field: 'status', title: 'Status', type: 'readonly', width: 120, compute: (r) => (r.past_valid ? 'Past valid date' : r.status === 'Submitted for Quote' ? 'Submitted' : r.status),
        cellClass: (r) => ({ Accepted: 'tbpass', Rejected: 'tbfail' }[r.status] || (r.past_valid ? 'tbfail' : r.status === 'Quoted' ? 'tbwait' : '')) },
      { field: 'acc', title: '', type: 'button', width: 76, label: (r) => (canDecide(r) ? 'Accept…' : ''), onClick: (r) => act(r, 'Accepted') },
      { field: 'rej', title: '', type: 'button', width: 72, label: (r) => (canDecide(r) ? 'Reject…' : ''), onClick: (r) => act(r, 'Rejected') },
      { field: 'owner_name', title: 'Prepared by', type: 'readonly', width: 150 },
      { field: 'quote_contact_name', title: 'For', type: 'readonly', width: 120, compute: (r) => r.quote_contact_name || r.sent_to_name || '' },
      { field: 'labs', title: 'Labs', type: 'readonly', width: 90 },
      { field: 'sent', title: 'Sent', type: 'readonly', width: 130, compute: (r) => (r.sent_at ? d8(r.sent_at) : r.quoted_at ? 'Issued, not sent' : '') },
      { field: 'valid_until', title: 'Valid until', type: 'readonly', width: 100, format: d8 },
      { field: 'decision', title: 'Decision', type: 'readonly', width: 220, compute: (r) => (r.status === 'Accepted' ? `By ${r.accepted_by_name || ''}${r.decided_via === 'Client link' ? ' (online)' : ''}`
        : r.status === 'Rejected' ? `${r.decided_via === 'Client link' ? 'Online' : ''}${r.rejected_reason ? (r.decided_via === 'Client link' ? ': ' : '') + r.rejected_reason : ''}` : '') },
      { field: 'kind', title: 'Type', type: 'readonly', width: 70 },
      { field: 'line_count', title: 'Tests', type: 'readonly', width: 55 },
    ];
  }, [canEdit, dialogs, toast]);

  const rowClass = useCallback((r) => (r.past_valid ? 'tbnc' : ['Rejected', 'Expired', 'Superseded'].includes(r.status) ? 'mutedrow' : ''), []);
  const pick = (set, key) => (v) => { view[key] = v; set(v); };

  return <>
    <PageHeader title="Quotes" audit={AUDIT}
      subtitle="Every quote and project quote, newest first, 50 at a time. A standalone quote is for one customer request; a project is a reusable package of tests for a product. Accept or reject a quote here when the client answers by phone or email; answers through the link in the quote email are recorded by themselves."
      actions={<>{canEdit && <Button type="button" variant="primary" onClick={() => newQuote(dialogs, toast)}>+ New quote</Button>} <Button variant="light" href="#/projects">Projects</Button></>} />
    <Nav variant="pills" className="tabs"><Nav.Link active={mine} href="#/quotes?tab=mine">My open quotes</Nav.Link><Nav.Link active={!(mine)} href="#/quotes?tab=all">All quotes</Nav.Link></Nav>
    {error && !meta ? <Card body className="err">{error.message}</Card> : !meta ? <div className="loading">Loading…</div> : <>
      <div className="qfil">
        <label>Type <SmartSelect value={type} options={TYPES} onChange={pick(setType, 'type')} /></label>
        <label>Lab <SmartSelect value={lab} options={[{ value: '', label: 'All labs' }, ...meta.labs.map((l) => ({ value: l.id, label: l.site_code }))]} onChange={pick(setLab, 'lab')} /></label>
        {!mine && <label>Prepared by <SmartSelect value={owner} options={[{ value: '', label: 'Anyone' }, ...(meta.owners || []).map((o) => ({ value: o.id, label: o.name || '' }))]} onChange={pick(setOwner, 'owner')} /></label>}
      </div>
      <Card body>
        <PagedList key={mine ? 'mine' : 'all'} load={load} query={query} filters={mine ? NO_FILTERS : ALL_FILTERS}
          placeholder="Search by quote, reference, client or person; type or scan a quote number and press Enter"
          open={(r) => { window.location.hash = quoteHref(r); }}>
          {(rows, data, reload) => { reloadRef.current = reload; return (
            <ReadGrid rows={rows} columns={columns} keyField="version_id" rowClass={rowClass}
              emptyText={mine ? 'You have no open quotes. "+ New quote" starts one.' : 'No quotes match.'} />
          ); }}
        </PagedList>
      </Card>
    </>}
  </>;
}
