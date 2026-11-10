// Parts every stability screen uses: date formats, loading and error states, the stylesheet.
import './stability.css';

// a date as "Oct 14, 2026" (a date-only value is read as a local date, not UTC)
export const d8 = (v) => { if (!v) return ''; const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return (m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(v)).toLocaleDateString([], { dateStyle: 'medium' }); };
export const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
export const iso = (v) => { const m = String(v || '').match(/^\d{4}-\d{2}-\d{2}/); return m ? m[0] : ''; };
let keySeq = 0;
export const newKey = () => 'k' + (++keySeq);

export const Loading = () => <div className="loading">Loading…</div>;
export const Failed = ({ error }) => <div className="card err">{error.message}</div>;
export const ext = { target: '_blank', rel: 'noopener noreferrer' };
