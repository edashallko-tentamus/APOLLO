// Excel export and bulk upload of a list (backend: bulk module; the lists are its KINDS: lots, equipment, suppliers, ...)
import { API_BASE, SITE_HEADER } from '../config.js';
import { ApiError, post } from './client.js';

// The .xlsx file of the list (only the given ids, if any; template: just the headers): { blob, name }.
// shortcut: client.js has no file download and keeps the lab private, so the lab comes from the caller; move into client.js when it gets one.
export async function exportFile(kind, { ids = [], template = false, siteId = '' } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}/bulk/${kind}/export`, { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', [SITE_HEADER]: siteId || '' }, body: JSON.stringify({ ids, template }) });
  } catch { throw new ApiError('Cannot reach the LIMS. Check your connection and try again.', 0, null); }
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new ApiError(d.error || 'Export failed', res.status, d); }
  const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || `${kind}.xlsx`;
  return { blob: await res.blob(), name };
}

// What an uploaded file would change, row by row: { total, rows: [{ row, key, action, changes, errors }], unknownHeaders }
export const previewUpload = (kind, file) => post(`/bulk/${kind}/preview`, file, { invalidates: '/bulk' });
// Saves it (all or nothing), signed with one reason: { created, updated }
export const applyUpload = (kind, file, reason, signature) => post(`/bulk/${kind}/apply`, { ...file, reason, signature });
