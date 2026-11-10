// Training and competency (C-1): the lab's overview, a person, a competency attempt, rules, legacy qualifications.
import { get, post } from './client.js';

const inv = { invalidates: '/training' };
export const getOverview = (opts) => get('/training', opts);
export const getPerson = (id, opts) => get('/training/people/' + id, opts);
export const getAttempt = (id, opts) => get('/training/attempts/' + id, opts);
export const saveRules = (rows, reason) => post('/training/rules', { reason, rows }, inv);
export const grantLegacy = (signature) => post('/training/legacy', { signature }, inv);
export const startAttempt = (body) => post('/training/attempts', body, inv);
export const addEvidence = (id, documents) => post(`/training/attempts/${id}/evidence`, { documents }, inv);
export const evaluateAttempt = (id, body) => post(`/training/attempts/${id}/evaluate`, body, inv);
export const decideAttempt = (id, body) => post(`/training/attempts/${id}/decide`, body, inv);
export const withdrawAttempt = (id, reason) => post(`/training/attempts/${id}/withdraw`, { reason }, inv);
export const withdrawQualification = (id, body) => post(`/training/qualifications/${id}/withdraw`, body, inv);
// files opened in a new tab (the lab goes in ?s= because a link cannot send the header)
export const reportUrl = (personId, siteId) => `/api/training/people/${personId}/report.pdf?s=${encodeURIComponent(siteId || '')}`;
export const evidenceUrl = (id, siteId) => `/api/training/evidence/${id}/file?s=${encodeURIComponent(siteId || '')}`;
