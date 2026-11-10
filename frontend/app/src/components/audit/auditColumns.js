// Audit trail summaries, shared by the Audit trail page and the audit icon on every page
const SKIP = ['id', 'search', 'recalc_at'];

export function fmtAuditValue(v) {
  if (v === null || v === undefined) return '∅';
  if (Array.isArray(v)) return '[' + v.join(', ') + ']';
  const s = String(v); return s.length > 40 ? s.slice(0, 37) + '…' : s;
}
export function summarizeChange(cf) {
  return Object.entries(cf || {}).filter(([k]) => !SKIP.includes(k)).slice(0, 6)
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${fmtAuditValue(v.old)} → ${fmtAuditValue(v.new)}`).join('; ');
}

export const auditColumns = (withRecord = true) => [
  { field: 'changed_at', title: 'When', type: 'readonly', width: 150, format: (v) => new Date(v).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' }) },
  { field: 'changed_by', title: 'Who', type: 'readonly', width: 130 },
  ...(withRecord ? [{ field: 'record', title: 'Record', type: 'link', width: 220, compute: (r) => r.ref?.label || r.table_name, href: (r) => r.ref?.link || null }] : []),
  { field: 'action', title: 'Action', type: 'readonly', width: 70 },
  { field: 'record_version', title: 'Ver.', type: 'readonly', width: 45 },
  { field: 'reason', title: 'Reason', type: 'readonly', width: 180 },
  { field: 'signature', title: 'Signature', type: 'readonly', width: 170, help: 'Electronic signature: who signed and what the signature meant' },
  { field: 'summary', title: 'What changed (old → new)', type: 'readonly', compute: (r) => summarizeChange(r.changed_fields) },
];
