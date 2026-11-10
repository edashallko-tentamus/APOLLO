// Report Finalization and the COA (R-1, migration 026; claims 028): the queue, claims, the review of each COA, notes,
// signing, issued COAs, the sample's COA card, attachments, email templates (Outbox) and compliance categories.
import { get, post } from './client.js';

const R = { invalidates: '/reports' };
const pageParams = ({ page, size, q, f }) => {
  const p = new URLSearchParams({ page: String(page), size: String(size) });
  if (q) p.set('q', q);
  if (f) p.set('f', f);
  return p;
};

// { rows, claims, final_due, can_finalize, can_take_over }
export const finalizationQueue = () => get('/reports/queue', { fresh: true });
export const claimTests = (tests) => post('/reports/claim', { tests }, R);
export const releaseClaim = (claimId, body) => post(`/reports/claims/${claimId}/release`, body, R); // { tests } or { reason }
export const listIssued = (params, { fresh = false } = {}) => get(`/reports/issued?${pageParams(params)}`, { fresh });
export const stabilityReportsDue = () => get('/stability/reports-due', { fresh: true });

// the review: { content, context, checks, token, can_notes, canned }
export const previewCoa = (sampleId, tests) => post('/reports/preview', { sample_id: sampleId, tests });
export const addNote = (body) => post('/reports/notes', body, R);
export const removeNote = (id, reason) => post(`/reports/notes/${id}/remove`, { reason }, R);
export const finalize = (body) => post('/reports/finalize', body, R);

// the sample page's card: { versions, notes, attachments, can_attach }
export const sampleCoa = (sampleId) => get(`/reports/samples/${sampleId}/coa`, { fresh: true });
export const addSampleAttachment = (sampleId, body) => post(`/samples/${sampleId}/attachments`, body, R);

export const emailTemplates = () => get('/outbox/templates', { fresh: true });
export const saveEmailTemplates = (rows, reason) => post('/outbox/templates', { rows, reason }, { invalidates: '/outbox' });
export const complianceCategories = () => get('/compliance-categories', { fresh: true });
export const saveComplianceCategories = (rows, reason) => post('/compliance-categories', { rows, reason }, { invalidates: '/compliance-categories' });

const sq = (siteId) => '?s=' + encodeURIComponent(siteId || '');
export const coaPdfUrl = (versionId, siteId) => `/api/reports/coa/${versionId}/pdf${sq(siteId)}`;
export const previewPdfUrl = (token) => `/api/reports/preview/${token}`;
export const attachmentUrl = (id, siteId) => `/api/attachments/${id}/file${sq(siteId)}`;
export const verifyUrl = (code) => `/verify.html?c=${code}`;
