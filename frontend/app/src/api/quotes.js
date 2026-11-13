// Standalone quotes (migration 029): the list, a new quote, sending, accept / reject, the quote-line test picker
import { get, post, put } from './client.js';

// One page: { rows, total, page, pages, size, filter, counts, q, exact, labs, owners, can_edit }
// extra: { tab, ty, lab, own } (the list's tab and filters)
export function listQuotes({ page, size, q, f }, extra = {}, { fresh = false } = {}) {
  const p = new URLSearchParams({ page: String(page), size: String(size) });
  if (q) p.set('q', q);
  if (f) p.set('f', f);
  Object.entries(extra).forEach(([k, v]) => { if (v) p.set(k, v); });
  return get(`/quotes?${p}`, { fresh });
}
export const createQuote = (body) => post('/quotes', body);
export const updateQuote = (projectId, body) => put(`/quotes/${projectId}`, body);
export const quotePeople = () => get('/quotes/people');
export const quoteCatalog = (vid) => get(`/quotes/catalog?v=${vid}`, { fresh: true });
export const sendQuoteVersion = (vid, body) => post(`/quotes/versions/${vid}/send`, body);
export const decideQuoteVersion = (vid, body) => post(`/quotes/versions/${vid}/decide`, body);
export const addQuoteLines = (vid, rows, prefill) => post(`/versions/${vid}/lines`, { rows, prefill });

export const allClients = () => get('/clients');
export const getClient = (id) => get(`/clients/${id}`, { fresh: true });
export const getProject = (id) => get(`/projects/${id}`, { fresh: true });
