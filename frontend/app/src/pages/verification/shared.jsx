// Small parts shared by the verification document and the Review tab's card.
import './verification.css';

export const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
export const resCls = (r) => (r === 'Not tested' ? 'r-Not' : r ? 'r-' + r : '');
export const text = (x) => (x === null || x === undefined ? '' : typeof x === 'object' ? (x.text ?? JSON.stringify(x)) : String(x));
export const OutcomeChip = ({ o }) => (o ? <span className={`vout ${o === 'Pass with exceptions' ? 'exc' : o}`}>{o}</span> : null);
