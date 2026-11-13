// Dashboards (D-1, K-1): Home, GM and executive boards, their widgets and layouts, Admin > Dashboard widgets,
// the finance figures and the performance report.
import { download, get, post, put, saveBlob } from './client.js';

const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v) p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };

// a board: { labs, widgets, layout, hidden }. only: widget codes to work out; refresh: work them out again (not live ones)
export const getBoard = (key, { lab, only, refresh } = {}, opts = {}) =>
  get(`/dashboard/${key}${qs({ refresh: refresh ? '1' : '', only: only ? only.join(',') : '', lab })}`, { fresh: true, ...opts });
export const saveLayout = (key, layout, hidden) => put(`/dashboard/${key}/layout`, { layout, hidden }, { invalidates: '/dashboard' });
export const resetLayout = (key) => post(`/dashboard/${key}/reset`, {}, { invalidates: '/dashboard' });
export const getDetail = (key, k, lab) => get(`/dashboard/${key}/detail${qs({ k, lab })}`, { fresh: true });

export const getWidgetsAdmin = (opts) => get('/admin/dashboard-widgets', opts);
export const saveWidgetsAdmin = (rows, reason) => post('/admin/dashboard-widgets', { reason, rows }, { invalidates: '/admin/dashboard-widgets' });

export const getFinance = (year, opts) => get('/finance?year=' + year, opts);
export const saveFinanceWeeks = (rows, reason) => post('/finance/weeks', { reason, rows }, { invalidates: '/finance' });
export const saveFinancePlans = (rows, reason) => post('/finance/plans', { reason, rows }, { invalidates: '/finance' });
export const previewPlans = (file_name, content_base64) => post('/finance/plans/preview', { file_name, content_base64 });

// A file from the backend (Excel, PDF), saved by the browser (the lab goes with it from client.js; siteId is no longer needed)
export const downloadFile = (path, { method, body, name } = {}) => download(path, { method, body, name });
export { saveBlob };
