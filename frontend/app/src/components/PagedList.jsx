// A long list one page at a time from the server (50 rows, newest first): filter tabs with their counts, page buttons
// and a search box. Typing searches the whole list on the server; Enter (or a barcode scanner, which types the ID and
// presses Enter) opens the record when the text is exactly its ID. The tab, search and page stay in the address.
//   <PagedList load={(params) => api.list(params)} query={query} filters={[['active', 'Active'], ...]} open={(row) => ...}>
//     {(rows, data, reload) => <EditableGrid rows={rows} ... />}
//   </PagedList>
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../hooks/useApi.js';
import { confirmLeave, replaceHash } from '../router/useHashRoute.js';
import { useToast } from './Toasts.jsx';
import { Button, Card, Nav, Form } from 'react-bootstrap';

const SEARCH_DELAY_MS = 350;

export default function PagedList({ load, query = '', filters = [], filterParam = 'show', size = 50, placeholder, open, children }) {
  const here = new URLSearchParams(query);
  const [page, setPage] = useState(() => Math.max(1, parseInt(here.get('p'), 10) || 1));
  const [filter, setFilter] = useState(() => here.get(filterParam) || filters[0]?.[0] || '');
  const [q, setQ] = useState(() => here.get('find') || '');
  const [typed, setTyped] = useState(q);
  const openNext = useRef(false); // set by Enter: open the record if the answer has an exact match
  const toast = useToast();

  const { data, error, loading, reload } = useApi(
    (opts) => load({ page, size, q, f: filter }, opts),
    [load, page, size, q, filter]);

  // another page, tab or search replaces the rows shown: unsaved edits on them are asked about first
  const go = useCallback(async (change) => { if (await confirmLeave()) change(); }, []);

  // the search box searches after a short pause in typing
  useEffect(() => {
    if (typed.trim() === q) return undefined;
    const t = setTimeout(() => go(() => { setQ(typed.trim()); setPage(1); }), SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [typed, q, go]);

  useEffect(() => {
    if (!data) return;
    if (openNext.current && data.exact && open) { openNext.current = false; open(data.exact); return; }
    openNext.current = false;
    const [path, qs] = window.location.hash.split('?');
    const u = new URLSearchParams(qs || '');
    const set = (k, v) => { if (v) u.set(k, v); else u.delete(k); };
    set(filterParam, data.filter || filter); set('find', q); set('p', data.page > 1 ? String(data.page) : '');
    replaceHash(path + (u.toString() ? '?' + u : ''));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps -- runs once per answer

  useEffect(() => { if (error && data) toast(error.message, 'err'); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  const searchNow = useCallback((e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault(); openNext.current = true;
    const v = typed.trim();
    go(() => { if (v === q && page === 1) reload(); else { setQ(v); setPage(1); } });
  }, [typed, q, page, reload, go]);

  const total = data?.total ?? 0;
  const from = total ? (data.page - 1) * data.size + 1 : 0;
  const info = !data ? '' : total ? `${from}–${from + data.rows.length - 1} of ${total.toLocaleString()}${q ? ` matching "${q}"` : ''}` : (q ? `Nothing matches "${q}"` : '');

  return (
    <div className="pglist">
      {filters.length > 0 && (
        <Nav variant="pills" className="tabs pgtabs">
          {filters.map(([k, label]) => (
            <Nav.Link as="button" active={(data?.filter || filter) === k} key={k} type="button" data-f={k} onClick={() => go(() => { setFilter(k); setPage(1); })}>
              {label} <small>{data?.counts?.[k] ?? ''}</small>
            </Nav.Link>
          ))}
        </Nav>
      )}
      <div className="pgbar">
        <Form.Control className="pgsearch" type="search" autoComplete="off" placeholder={placeholder || 'Search, or type or scan an ID and press Enter'}
          value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={searchNow} />
        <span className="pginfo">{info}</span><span className="sp" />
        <Button type="button" variant="light" className="pgprev" disabled={!data || data.page <= 1} onClick={() => go(() => setPage((p) => p - 1))}>‹ Previous</Button>
        <span className="pgof">{data ? `Page ${data.page} of ${data.pages}` : ''}</span>
        <Button type="button" variant="light" className="pgnext" disabled={!data || data.page >= data.pages} onClick={() => go(() => setPage((p) => p + 1))}>Next ›</Button>
      </div>
      <div className="pgbody">
        {error && !data ? <Card body className="err">{error.message}</Card>
          : !data ? <div className="loading">Loading…</div>
            : children(data.rows, data, reload)}
        {loading && data && <div className="help">Loading…</div>}
      </div>
    </div>
  );
}
