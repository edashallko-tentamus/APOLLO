// Parts the OOS screens share: formats, states, and opening an investigation (QC Review and the sample page).
import { openOosRecord } from '../../api/oos.js';
import './oos.css';

export const PHASE1 = 'Full Phase I (21 CFR 211)';
export const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
export const d8 = (v) => (v ? new Date(String(v).slice(0, 10) + 'T12:00:00').toLocaleDateString([], { dateStyle: 'medium' }) : '');
export const Loading = () => <div className="loading">Loading…</div>;
export const Failed = ({ error }) => <div className="card err">{error.message}</div>;

// Open an OOS investigation. Exported for the testing area (QC Review) and the sample page:
//   const id = await openOos(dialogs, toast, { requested_test_id, analyte_id, batch_id, label });
// Asks why (optional), then the signature ("Opened by"); opens the new investigation and gives its id, or null.
export async function openOos(dialogs, toast, ctx) {
  const v = await dialogs.form({ title: 'Open an OOS investigation', okText: 'Next: sign',
    intro: <><b>{ctx.label || 'This result'}</b> does not conform to its specification. Check the sample details and the specification first: if they were wrong, correct them instead (no investigation is needed). Opening starts the investigation, its automatic data checks and its target date.</>,
    fields: [{ name: 'reason', label: 'Why it is opened (optional)', type: 'textarea', help: 'For example what has already been checked, or what the client said.' }] });
  if (!v) return null;
  const out = await dialogs.sign({ what: `Open an OOS investigation: ${ctx.label || ''}`, meaning: 'Opened by', needReason: false,
    submit: ({ signature }) => openOosRecord({ requested_test_id: ctx.requested_test_id, analyte_id: ctx.analyte_id, batch_id: ctx.batch_id || null, reason: v.reason, signature }) });
  if (!out) return null;
  toast('OOS investigation opened.');
  window.location.hash = '#/oos/' + out.id;
  return out.id;
}
