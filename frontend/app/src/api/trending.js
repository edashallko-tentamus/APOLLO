// Trending and control charts (T-1, T-1.1): options, drawing, saved charts, signal reviews, packs, QC Review trends.
import { get, post } from './client.js';
import { downloadFile } from './dashboard.js';

export const getOptions = () => get('/trending/options');
export const buildChart = (def) => post('/trending/build', def);
export const getWatch = (opts) => get('/trending/watch', opts);
export const listCharts = (opts) => get('/trending/charts', opts);
export const getChart = (id, from = '', to = '', opts) => get(`/trending/charts/${id}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, opts);
export const saveChart = (body) => post('/trending/charts', body, { invalidates: '/trending' });
export const freezeLimits = (id, body) => post(`/trending/charts/${id}/freeze`, body, { invalidates: '/trending' });
export const unfreezeLimits = (id, reason) => post(`/trending/charts/${id}/unfreeze`, { reason }, { invalidates: '/trending' });
export const retireChart = (id, reason) => post(`/trending/charts/${id}/retire`, { reason }, { invalidates: '/trending' });
export const approveChart = (id, signature) => post(`/trending/charts/${id}/approve`, { signature }, { invalidates: '/trending' });
export const applyLimits = (id, body) => post(`/trending/charts/${id}/apply-limits`, body, { invalidates: '/trending' });
export const reviewSignal = (body) => post('/trending/signals/review', body, { invalidates: '/trending' });
export const getPack = (pk, from, to, test) => get(`/trending/packs/${pk}?from=${from}&to=${to}&test_id=${test}`);
export const getReviewTrends = (batchId) => get('/trending/review/' + batchId, { fresh: true });
// Excel and PDF are made by the backend from a chart's definition (or a saved chart, or a pack)
export const downloadTrend = (path, body, name, siteId) => downloadFile('/trending' + path, { method: 'POST', body, name, siteId });
