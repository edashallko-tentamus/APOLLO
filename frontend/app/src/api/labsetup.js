// Lab setup: each lab's images, the product name, report templates
import { get, post } from './client.js';

export const listSiteMedia = (siteId, opts) => get(`/sites/${siteId}/media`, opts);
export const uploadSiteMedia = (siteId, body) => post(`/sites/${siteId}/media`, body);
export const retireSiteMedia = (mediaId, reason) => post(`/sites/media/${mediaId}/retire`, { reason });
export const siteMediaUrl = (mediaId) => `/api/sites/media/${mediaId}/file`;

export const getPublicSettings = (opts) => get('/public/settings', opts);
export const saveSettings = (body) => post('/settings', body);

export const listReportTemplates = (opts) => get('/report-templates', opts);
export const saveReportTemplates = (rows, reason) => post('/report-templates', { rows, reason });
