// Stability studies (migration 032, S-2 041): stability quotes and their design, studies, placement, pulls,
// cancellation, disposal, excursion assessments, issued reports, and the chambers setup.
import { get, post } from './client.js';

const ST = { invalidates: '/stability' };

// quotes
export const stabilityQuotes = () => get('/stability/quotes', { fresh: true });
export const createStabilityQuote = (body) => post('/stability/quotes', body, ST);
export const stabilityQuote = (pid) => get('/stability/quotes/' + pid, { fresh: true });
export const saveDesign = (vid, body) => post(`/stability/versions/${vid}/design`, body, ST);
export const newStabilityVersion = (pid, body = {}) => post(`/stability/quotes/${pid}/new-version`, body, ST);
export const allClients = () => get('/clients');
export const getClient = (id) => get('/clients/' + id, { fresh: true });

// studies
export const studiesOverview = () => get('/stability/studies', { fresh: true }); // { pulls, today, can_manage }
export function listStudies({ page, size, q, f }, { fresh = false } = {}) {
  const p = new URLSearchParams({ page: String(page), size: String(size) });
  if (q) p.set('q', q);
  if (f) p.set('show', f);
  return get(`/stability/studies?${p}`, { fresh });
}
export const getStudy = (id) => get('/stability/studies/' + id, { fresh: true });
export const studySummary = (id) => get(`/stability/studies/${id}/report`, { fresh: true });
export const placeStudy = (id, body) => post(`/stability/studies/${id}/place`, body, ST);
export const recordPull = (pullId, body) => post(`/stability/pulls/${pullId}/record`, body, ST);
export const cancelStudy = (id, body) => post(`/stability/studies/${id}/cancel`, body, ST);
export const disposeStorage = (storageId, body) => post(`/stability/storage/${storageId}/dispose`, body, ST);
export const assessExcursion = (id, entryId, body) => post(`/stability/studies/${id}/excursions/${entryId}/assess`, body, ST);
export const issueReport = (id, body) => post(`/stability/studies/${id}/reports`, body, ST);

// setup
export const stabilitySetup = () => get('/stability/setup', { fresh: true });
export const saveConditions = (body) => post('/stability/conditions', body, ST);
export const saveChambers = (body) => post('/stability/chambers', body, ST);
export const saveRacks = (body) => post('/stability/racks', body, ST);

// files opened in a new tab
export const quotePdfUrl = (vid) => `/api/quotes/versions/${vid}/pdf?fresh=1`;
export const summaryPdfUrl = (id) => `/api/stability/studies/${id}/report.pdf`;
export const previewPdfUrl = (id) => `/api/stability/studies/${id}/report-preview.pdf`;
export const reportPdfUrl = (reportId) => `/api/stability/reports/${reportId}/pdf`;
