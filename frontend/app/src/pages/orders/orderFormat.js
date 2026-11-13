// Small display helpers shared by the order and sample pages
export const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '');
export const d8 = (v) => (v ? new Date(String(v).slice(0, 10) + 'T12:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : '');
export const unit = (u) => (u === 'Business Days' ? 'bus.' : 'cal.');
export const hasVal = (v) => v !== null && v !== undefined;
export const quoteText = (r) => (r.project_code ? `${r.project_code} v${r.project_version_no}` : r.media_lot_id ? 'Lot QA testing' : r.serving_order ? 'Catalogue price' : r.catalogue_order ? 'List price' : '');
export const quoteHref = (r) => (r.project_version_id ? '#/quote/' + r.project_version_id : r.media_lot_id ? '#/inventory/lots/' + r.media_lot_id : null);
export const sampleName = (s) => s.sample_code || s.client_sample_id || 'sample';
