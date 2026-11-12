// Parts every inventory screen uses: formats, the tabs, the lookups, the colours of warning cells, a dialog holding a grid.
import { useEffect, useState } from 'react';
import { inventoryMeta, listAnalytes, listDepartments, listLocations, listSuppliers, wasteOptions } from '../../api/inventory.js';
import DataGrid from '../../components/grid/DataGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import { useHashRoute } from '../../router/useHashRoute.js';
import './inventory.css';
import { Button, Card, Nav } from 'react-bootstrap';
import { Dialog } from '../../components/Modal.jsx';

export const d8 = (v) => (v ? String(v).slice(0, 10) : '');
export const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '');
export const fmtN = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 6 }));
export const qty = (v, u) => (v === null || v === undefined ? '' : `${fmtN(v)} ${u || ''}`.trim());
export const today = () => { const t = new Date(); t.setMinutes(t.getMinutes() - t.getTimezoneOffset()); return t.toISOString().slice(0, 10); }; // local date
export const isMixture = (l) => (l.chemical_types || []).includes('In-house mixture');
export const closed = (r) => ['Disposed', 'Cancelled', 'Depleted'].includes(r.status);
export const opts = (list) => (list || []).map((x) => ({ value: x, label: x }));
export const withBlank = (o) => [{ value: '', label: '' }, ...o];

// warning cells: expiry, amount on hand, QA testing status (migration 040)
export const expCls = (r) => (r.expiry_status === 'Expired' || r.expiry_status === 'Retest due' ? 'cbad' : r.expiry_status === 'Expiring soon' ? 'cwarn' : '');
export const amtCls = (r) => (r.negative_stock ? 'cbad' : r.low_stock ? 'cwarn' : '');
export const qaCls = (st) => (!st || /^Released/.test(st) ? '' : /^Rejected/.test(st) ? 'cbad' : 'cwarn');
export const inactiveRow = (r) => (r.status === 'Inactive' ? 'mutedrow' : '');

export function LocLink({ id, code, path }) {
  if (!id) return null;
  return <><a href={'#/inventory/locations/' + id}>{code}</a>{path && <> <span className="help">{path}</span></>}</>;
}

// a definition list; empty values show a dash
export function Kv({ pairs }) {
  return <dl className="kv">{pairs.filter(Boolean).map(([k, v]) => <Pair key={k} k={k} v={v} />)}</dl>;
}
const Pair = ({ k, v }) => <><dt>{k}</dt><dd>{v === null || v === undefined || v === '' || v === false ? '—' : v}</dd></>;

const TABS = [['#/inventory', 'Inventory'], ['#/inventory/samples', 'Sample storage'], ['#/inventory/suppliers', 'Suppliers and manufacturers'],
  ['#/inventory/locations', 'Storage locations'], ['#/inventory/thresholds', 'Warning rules'], ['#/inventory/qa-testing', 'QA testing']];
export function InvTabs() {
  const cur = '#' + useHashRoute().path;
  return <Nav variant="pills" className="invtabs">{TABS.map(([h, l]) => <Nav.Link active={h === cur} key={h} href={h}>{l}</Nav.Link>)}</Nav>;
}

export const NEED_LAB = 'Choose your lab (top right) first. If none is listed, ask an administrator to assign you to a lab.';
export const NeedLab = () => <Card body className="err">{NEED_LAB}</Card>;
export const Loading = () => <div className="loading">Loading…</div>;
export const Failed = ({ error }) => <Card body className="err">{error.message}</Card>;

// Multi-value list cells (supported conditions, types): typed or pasted as "Ambient, Refrigerated"
export function listCol(field, title, allowed, width, extra = {}) {
  const canon = (v) => (v || []).map((x) => allowed.find((a) => a.toLowerCase() === String(x).toLowerCase()) || x);
  return { field, title, type: 'array', width, help: 'One or more of: ' + allowed.join(', ') + '. Separate with commas.',
    validate: (v) => { const bad = (v || []).filter((x) => !allowed.some((a) => a.toLowerCase() === String(x).toLowerCase())); return bad.length ? 'Not on the list: ' + bad.join(', ') : null; },
    canon, ...extra };
}
export function canonRows(rows, cols) {
  return rows.map((r) => { const o = { ...r }; cols.filter((c) => c.canon).forEach((c) => { if (c.field in o) o[c.field] = c.canon(o[c.field]); }); return o; });
}

// Options used by several screens (match: other spellings accepted when typing or pasting)
const locOpt = (l) => ({ value: l.id, label: `${l.location_code}: ${l.path}`, match: [l.location_code, l.location_name] });
const analyteOpt = (a) => ({ value: a.id, label: a.analyte_name + (a.cas_number ? ` (${a.cas_number})` : ''), match: [a.analyte_name, a.analyte_code, a.report_name, a.cas_number].filter(Boolean) });
export async function loadLookups() {
  const [suppliers, locations, analytes, departments, waste] = await Promise.all([listSuppliers(), listLocations(), listAnalytes(), listDepartments().catch(() => []), wasteOptions().catch(() => [])]);
  return {
    suppliers, locations, analytes,
    wasteOpts: waste.map((w) => ({ value: w.id, label: w.waste_name, match: [w.waste_code] })),
    supOpts: suppliers.filter((s) => s.status === 'Active' && s.supplier_type !== 'Manufacturer').map((s) => ({ value: s.id, label: s.supplier_name, match: [s.supplier_code] })),
    mfrOpts: suppliers.filter((s) => s.status === 'Active' && s.supplier_type !== 'Supplier').map((s) => ({ value: s.id, label: s.supplier_name, match: [s.supplier_code] })),
    locOpts: locations.filter((l) => l.status === 'Active').map(locOpt),
    deptOpts: departments.map((d) => ({ value: d.id, label: d.department_name, match: [d.department_code] })),
    sampleLocOpts: locations.filter((l) => l.status === 'Active' && l.holds_samples).map(locOpt),
    analyteOpts: analytes.filter((a) => a.status === 'Active').map(analyteOpt),
  };
}
export const loadMeta = inventoryMeta;

// The wide dialog (the kit's Modal has no extra-wide size): title, intro, content, an error line, Cancel and OK
export function XModal({ title, intro, children, error, okText = 'Save', cancelText = 'Cancel', busy = false, okDisabled = false, size = 'xwide', onOk, onClose }) {
  return (
    <Dialog label={title} wide={size === 'wide'} xwide={size === 'xwide'} onClose={() => onClose()}>
      <div className="modal-body">
        <h3>{title}</h3>
        {intro && <p className="intro">{intro}</p>}
        {children}
        <div className="merr" role="alert">{error}</div>
        <div className="mbtns">
          <Button type="button" variant="light" onClick={onClose}>{cancelText}</Button>
          {onOk && <Button type="button" variant="primary" disabled={busy || okDisabled} onClick={onOk}>{okText}</Button>}
        </div>
      </div>
    </Dialog>
  );
}

// A dialog holding an editable grid (usage, QA testing). Gives back { rows } (the rows with a required value), or null.
export function GridDialog({ title, intro, columns, rows = [], newRow = () => ({}), okText = 'Save', minRows = 5, onDone }) {
  const [start] = useState(() => (rows.length ? rows : Array.from({ length: minRows }, () => newRow())));
  const grid = useGrid({ rows: start, columns, allowAdd: true, newRow });
  const [error, setError] = useState('');
  function ok() {
    if (grid.errorCount) { setError('Fix the cells marked in red first.'); return; }
    const out = grid.state.rows.filter((r) => columns.some((c) => c.required && r[c.field] !== undefined && r[c.field] !== null && r[c.field] !== ''));
    onDone({ rows: out });
  }
  return (
    <XModal title={title} intro={intro} okText={okText} error={error} onOk={ok} onClose={() => onDone(null)}>
      <DataGrid grid={grid} />
    </XModal>
  );
}

// A read-only grid that follows its rows (they come again from the server after a change)
export function ReadGrid({ rows, columns, keyField = 'id', emptyText, onRowOpen, search, rowClass }) {
  const grid = useGrid({ rows, columns, keyField, readOnly: true });
  const { reset } = grid;
  useEffect(() => { reset(rows); }, [rows, reset]);
  return <DataGrid grid={grid} emptyText={emptyText} onRowOpen={onRowOpen} search={search} rowClass={rowClass} />;
}

// a labelled form field (the item and mixture pages)
export function Field({ label, req, help, className, children }) {
  return <div className={`field${className ? ' ' + className : ''}`}><label>{label}{req && <> <span className="req">*</span></>}</label>{children}{help && <div className="help">{help}</div>}</div>;
}
