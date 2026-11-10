// OOS investigations (R-2, migration 027): the list, one investigation and its signed steps, QA's checklists.
import { get, post } from './client.js';

const O = { invalidates: '/oos' };

export function listOos({ page, size, q, f }, { fresh = false } = {}) {
  const p = new URLSearchParams({ page: String(page), size: String(size) });
  if (q) p.set('q', q);
  if (f) p.set('f', f);
  return get(`/oos?${p}`, { fresh });
}
// { oos, can, me, items, retests, responses }
export const getOos = (id) => get('/oos/' + id, { fresh: true });
export const openOosRecord = (body) => post('/oos/open', body, O);
export const rerunChecks = (id) => post(`/oos/${id}/checks`, {}, O);
export const signSection = (id, path, body) => post(`/oos/${id}/${path}`, body, O); // analyst | supervisor
export const concludeOos = (id, body) => post(`/oos/${id}/conclude`, body, O);
export const cancelOos = (id, body) => post(`/oos/${id}/cancel`, body, O);
export const orderRetest = (id, body) => post(`/oos/${id}/retest`, body, O);
export const recordDetermination = (id, body) => post(`/oos/${id}/determination`, body, O);
export const responseHandled = (responseId, note) => post(`/oos/responses/${responseId}/handled`, { note }, O);

export const oosConfig = () => get('/oos/config', { fresh: true });
export const saveOosSettings = (rows, reason) => post('/oos/config/settings', { rows, reason }, O);
export const saveOosItems = (rows, reason) => post('/oos/config/items', { rows, reason }, O);

export const oosReportUrl = (id, siteId) => `/api/oos/${id}/report.pdf?s=${encodeURIComponent(siteId || '')}`;
