// Workflow verification (WD-6): one verification's protocol and report, and the verifications of a test version.
import { get, post } from './client.js';

const INV = '/verification';

export const getVerification = (id, opts) => get('/verification/' + id, opts);
export const approveProtocol = (id, signature) => post(`/verification/${id}/approve-protocol`, { signature }, { invalidates: INV });
export const executeRun = (id, signature) => post(`/verification/${id}/execute`, { signature }, { invalidates: INV });
export const captureEvidence = (id, signature) => post(`/verification/${id}/capture-evidence`, { signature }, { invalidates: INV });
export const signReport = (id, body) => post(`/verification/${id}/sign-report`, body, { invalidates: INV });
export const cancelVerification = (id, reason, signature) => post(`/verification/${id}/cancel`, { reason, signature }, { invalidates: INV });
export const versionVerifications = (vid, opts) => get('/verification/versions/' + vid, opts);
export const writeProtocol = (vid, signature) => post(`/verification/versions/${vid}/protocol`, { signature }, { invalidates: INV });

// Files served to the browser directly (links and images); ?s= names the lab, as the old screen did
export const docxUrl = (id, siteId) => `/api/verification/${id}/report.docx?s=${encodeURIComponent(siteId || '')}`;
export const evidenceUrl = (id, seq, siteId) => `/api/verification/${id}/evidence/${seq}?s=${encodeURIComponent(siteId || '')}`;
