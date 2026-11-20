// Lab setup: each lab's images, the product name, report templates
import { get, post, put } from './client.js';

export const listSiteMedia = (siteId, opts) => get(`/sites/${siteId}/media`, opts);
export const uploadSiteMedia = (siteId, body) => post(`/sites/${siteId}/media`, body);
export const retireSiteMedia = (mediaId, reason) => post(`/sites/media/${mediaId}/retire`, { reason });
export const siteMediaUrl = (mediaId) => `/api/sites/media/${mediaId}/file`;

export const getPublicSettings = (opts) => get('/public/settings', opts);
export const saveSettings = (body) => post('/settings', body);

// report templates (migration 074): designs in versions; shared ones ticked per lab by system administrators
export const listReportTemplates = (opts) => get('/report-templates', opts);
export const getReportTemplate = (id, opts) => get(`/report-templates/${id}`, opts);
export const createReportTemplate = (body) => post('/report-templates', body);
export const renameReportTemplate = (id, body) => put(`/report-templates/${id}`, body);
export const copyReportTemplate = (id, body) => post(`/report-templates/${id}/copy`, body);
export const newTemplateDraft = (id) => post(`/report-templates/${id}/draft`, {});
export const setTemplateLabs = (id, rows, reason) => post(`/report-templates/${id}/labs`, { rows, reason });
export const acceptTemplateVersion = (id, reason, signature) => post(`/report-templates/${id}/accept`, { reason, signature });
export const makeTemplateDefault = (id, reason) => post(`/report-templates/${id}/default`, { reason });
export const retireReportTemplate = (id, reason) => post(`/report-templates/${id}/retire`, { reason });
export const saveTemplateDraft = (vid, design, changeNote) => put(`/report-templates/versions/${vid}`, { design, change_note: changeNote });
export const approveTemplateVersion = (vid, reason, signature) => post(`/report-templates/versions/${vid}/approve`, { reason, signature });
export const templatePreviewUrl = (vid, siteId) => `/api/report-templates/versions/${vid}/preview.pdf?s=${encodeURIComponent(siteId || "")}&t=${Date.now()}`;
