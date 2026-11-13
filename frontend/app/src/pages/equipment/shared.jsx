// Parts every equipment screen uses: formats, the tabs, the lab check, the colours of warning cells.
import './equipment.css';
import { Card, Nav } from 'react-bootstrap';

export const d8 = (v) => (v ? String(v).slice(0, 10) : '');
export const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '');
export const dLocal = (ts) => { if (!ts) return ''; const t = new Date(ts); t.setMinutes(t.getMinutes() - t.getTimezoneOffset()); return t.toISOString().slice(0, 10); }; // a moment, as a local date
export const today = () => dLocal(new Date());
export const calCls = (s) => (s === 'Deficient' ? 'cbad' : s === 'Alert' ? 'cwarn' : s === 'Conforms' ? 'cok' : '');
export const mntCls = (s) => (s === 'Overdue' || s === 'Due today' ? 'cbad' : s === 'Due soon' ? 'cwarn' : '');
export const availCls = (a) => 'a-' + String(a || '').split(' ')[0];
export const inactiveRow = (r) => (r.status === 'Inactive' ? 'mutedrow' : '');
export const signed = (dialogs, o, fn) => dialogs.sign({ ...o, submit: ({ reason, signature }) => fn(reason, signature) });

const TABS = [['#/equipment', 'Equipment'], ['#/equipment/due', 'Due and overdue'], ['#/equipment/lists', 'Equipment types and departments']];
// cur: the tab to mark; counts: { '#/equipment/due': 3 }
export function EqTabs({ cur, counts = {} }) {
  return <Nav variant="pills" className="eqtabs">{TABS.map(([h, l]) => <Nav.Link active={h === cur} key={h} href={h}>{l}{counts[h] ? <> <small>{counts[h]}</small></> : null}</Nav.Link>)}</Nav>;
}

export const NeedLab = () => <Card body className="err">Choose your lab (top right) first. If none is listed, ask an administrator to add you to a group at a lab.</Card>;
export const Loading = () => <div className="loading">Loading…</div>;
export const Failed = ({ error }) => <Card body className="err">{error.message}</Card>;

export function Field({ label, req, help, children }) {
  return <div className="field"><label>{label}{req && <> <span className="req">*</span></>}</label>{children}{help && <div className="help">{help}</div>}</div>;
}
