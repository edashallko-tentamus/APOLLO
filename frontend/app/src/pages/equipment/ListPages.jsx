// Equipment: the register (one page at a time, Excel export and upload, print), Due and overdue, and each lab's
// Equipment types and Departments lists.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { equipmentDue, equipmentLists, equipmentMe, listEquipment, saveDepartments, saveTypes } from '../../api/equipment.js';
import BulkButtons from '../../components/bulk/BulkButtons.jsx';
import { printTable } from '../../components/bulk/printTable.js';
import EditableGrid from '../../components/EditableGrid.jsx';
import DataGrid from '../../components/grid/DataGrid.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import PageHeader from '../../components/PageHeader.jsx';
import PagedList from '../../components/PagedList.jsx';
import Section from '../../components/Section.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { calCls, d8, EqTabs, Failed, inactiveRow, Loading, mntCls, NeedLab } from './shared.jsx';
import { Button, Nav } from 'react-bootstrap';

// ================================================================ THE REGISTER
const FILTERS = [['active', 'In use'], ['tagged', 'Tagged out'], ['caldue', 'Calibration due'], ['mine', 'Mine'], ['retired', 'Retired']];
const FILTER_NAME = Object.fromEntries(FILTERS);
const PRINT_COLS = [
  { title: 'ID', get: (r) => r.equipment_code }, { title: 'Name', get: (r) => r.equipment_name }, { title: 'Type', get: (r) => r.type_name },
  { title: 'Manufacturer / model', get: (r) => [r.manufacturer, r.model].filter(Boolean).join(' ') }, { title: 'Serial', get: (r) => r.serial_number },
  { title: 'Calibration expires', get: (r) => d8(r.cal_expires) }, { title: 'Calibration', get: (r) => r.calibration_status },
  { title: 'Availability', get: (r) => r.availability + (r.tagged_for ? ` (${r.tagged_for})` : '') }, { title: 'Owners', get: (r) => r.owners },
];
const eqHref = (r) => '#/equipment/' + r.id;
const openEq = (r) => { window.location.hash = eqHref(r); };
const retiredRow = (r) => (r.admin_status === 'Retired' ? 'mutedrow' : '');
const REGISTER_COLS = [
  { field: 'equipment_code', title: 'ID', type: 'link', width: 82, href: eqHref },
  { field: 'equipment_name', title: 'Name', type: 'readonly', width: 190 },
  { field: 'type_name', title: 'Type', type: 'readonly', width: 115 },
  { field: 'department_code', title: 'Dept', type: 'readonly', width: 58 },
  { field: 'mfr', title: 'Manufacturer / model', type: 'readonly', width: 165, compute: (r) => [r.manufacturer, r.model].filter(Boolean).join(' ') },
  { field: 'serial_number', title: 'Serial', type: 'readonly', width: 100 },
  { field: 'cal_expires', title: 'Calibration expires', type: 'readonly', width: 100, format: (v, r) => (r.calibration_required ? d8(v) || 'None' : 'Not required'), cellClass: (r) => calCls(r.calibration_status) },
  { field: 'maintenance_due', title: 'Next maintenance', type: 'readonly', width: 100, format: (v) => d8(v) || '–', cellClass: (r) => mntCls(r.maintenance_status) },
  { field: 'availability', title: 'Availability', type: 'readonly', width: 150, format: (v, r) => v + (r.tagged_for ? `: ${r.tagged_for}` : ''), cellClass: (r) => (r.availability === 'Tagged out' ? 'cbad' : r.availability === 'Available' ? 'cok' : '') },
  { field: 'owners', title: 'Owners', type: 'readonly', width: 150, format: (v) => v || 'Nobody (fix this)' },
  { field: '_pick', title: '☐', type: 'bool', width: 40, help: 'Tick rows to export or print only those' },
];
const DUP_COL = { field: '_dup', title: '', type: 'button', width: 82, label: 'Duplicate', onClick: (r) => { window.location.hash = '#/equipment/new?from=' + r.id; } };

// the register's grid; the buttons above it read its ticked rows through gridRef
function RegisterGrid({ rows, columns, gridRef }) {
  const start = useRef(null);
  if (start.current?.src !== rows) start.current = { src: rows, rows: rows.map((r) => ({ ...r, _pick: false })) };
  const grid = useGrid({ rows: start.current.rows, columns });
  const { reset } = grid;
  useEffect(() => { reset(start.current.rows); }, [rows, reset]);
  gridRef.current = grid;
  return <DataGrid grid={grid} emptyText="No equipment here yet." onRowOpen={openEq} rowClass={retiredRow} />;
}

export function RegisterPage({ query }) {
  const { site } = useSession();
  const { data: me, error } = useApi(() => equipmentMe(), []);
  const gridRef = useRef(null);
  const filterRef = useRef('active');
  const reloadRef = useRef(() => {});
  const columns = useMemo(() => (me?.can_edit ? [DUP_COL, ...REGISTER_COLS] : REGISTER_COLS), [me?.can_edit]);
  const load = useCallback((params, opts) => listEquipment(params, opts), []);
  if (!site) return <NeedLab />;
  if (error && !me) return <Failed error={error} />;
  if (!me) return <Loading />;
  const g = () => gridRef.current;
  const picked = () => (g() ? g().state.rows.filter((r) => r._pick) : []);
  const shown = () => (g() ? g().view.map((i) => g().state.rows[i]) : []);
  return <>
    <PageHeader title={`Equipment: ${site.site_code}`} audit={{ kind: 'equipmentlist' }}
      subtitle={`Every instrument and small item in ${site.site_name}, from the HPLC to each pipette. Availability and calibration status are worked out from tags and calibration records; nobody types them. Newest first, 50 at a time; scan or type an ID or serial number and press Enter to open it.`} />
    <EqTabs cur="#/equipment" />
    <div className="eqbar">
      <span className="sp" /><BulkButtons kind="equipment" selected={() => picked().map((r) => r.id)} onDone={() => reloadRef.current()} />
      <Button type="button" variant="outline-secondary" onClick={() => { const p = picked(); printTable(`Equipment: ${site.site_code} (${FILTER_NAME[filterRef.current] || 'In use'})`, PRINT_COLS, p.length ? p : shown()); }}>Print</Button>
      {me.can_edit && <><Button variant="outline-secondary" href="#/equipment/add">Add many (paste)</Button><Button variant="primary" href="#/equipment/new">+ New equipment</Button></>}
    </div>
    <PagedList load={load} query={query} filters={FILTERS} open={openEq}
      placeholder="Search by ID, name, type, maker, model, serial or owner; scan or type an ID and press Enter">
      {(rows, data, reload) => { reloadRef.current = reload; filterRef.current = data.filter; return <RegisterGrid rows={rows} columns={columns} gridRef={gridRef} />; }}
    </PagedList>
  </>;
}

// ================================================================ DUE AND OVERDUE (what each owner must do)
const DUE_COLS = [
  { field: 'urgency', title: 'Urgency', type: 'readonly', width: 90, cellClass: (r) => (r.urgency === 'Due soon' ? 'cwarn' : 'cbad') },
  { field: 'kind', title: 'What', type: 'readonly', width: 100 },
  { field: 'equipment_code', title: 'ID', type: 'link', width: 90, href: (r) => '#/equipment/' + r.equipment_id },
  { field: 'equipment_name', title: 'Name', type: 'readonly', width: 210 },
  { field: 'type_name', title: 'Type', type: 'readonly', width: 120 },
  { field: 'what', title: 'Detail', type: 'readonly', width: 340 },
  { field: 'due_date', title: 'Due / since', type: 'readonly', width: 100, format: d8 },
  { field: 'owners', title: 'Responsible', type: 'readonly', width: 190, format: (v) => v || 'Nobody' },
  { field: 'mine', title: 'Mine', type: 'readonly', width: 55, format: (v) => (v ? 'Yes' : '') },
];
const openDue = (r) => { window.location.hash = '#/equipment/' + r.equipment_id; };

export function DuePage({ query }) {
  const { site } = useSession();
  const { data: rows, error } = useApi(() => equipmentDue(), []);
  const mineOnly = new URLSearchParams(query).get('mine') === '1';
  const shown = useMemo(() => (rows && mineOnly ? rows.filter((r) => r.mine) : rows), [rows, mineOnly]);
  if (!site) return <NeedLab />;
  return <>
    <PageHeader title={`Equipment due and overdue: ${site.site_code}`} audit={{ kind: 'equipmentlist' }}
      subtitle={'Calibrations expiring or expired, maintenance due, equipment tagged out (waiting for work or release), and equipment nobody is responsible for. Expired calibrations and maintenance marked "tag out when due" are tagged out automatically.'} />
    <EqTabs cur="#/equipment/due" counts={{ '#/equipment/due': rows?.length || '' }} />
    {error && !rows ? <Failed error={error} /> : !rows ? <Loading /> : <>
      <Nav variant="pills" className="eqbar">
        <Nav.Link active={!mineOnly} href="#/equipment/due">Everything <small>{rows.length}</small></Nav.Link>
        <Nav.Link active={mineOnly} href="#/equipment/due?mine=1">Only equipment I am responsible for <small>{rows.filter((r) => r.mine).length}</small></Nav.Link>
      </Nav>
      <ReadGrid rows={shown} columns={DUE_COLS} search emptyText="Nothing due. Everything is calibrated, maintained and available." onRowOpen={openDue} />
    </>}
  </>;
}

// ================================================================ EACH LAB'S LISTS: EQUIPMENT TYPES, DEPARTMENTS
const TYPE_COLS = [{ field: 'type_name', title: 'Type', required: true, width: 170 }, { field: 'description', title: 'Description', width: 240 },
  { field: 'equipment_count', title: 'In use', type: 'readonly', width: 60 }, { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 80 }];
const DEPT_COLS = [{ field: 'department_code', title: 'Code', required: true, width: 80 }, { field: 'department_name', title: 'Department', required: true, width: 180 },
  { field: 'equipment_count', title: 'In use', type: 'readonly', width: 60 }, { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 80 }];
const newActive = () => ({ status: 'Active' });

export function TypesDeptsPage() {
  const { site } = useSession();
  const { data, error, reload } = useApi(() => Promise.all([equipmentLists(), equipmentMe()]), []);
  const code = site?.site_code;
  const signTypes = useCallback((rows) => ({ meaning: 'Changed by', action: `Equipment types (${code}): ${rows.length} change(s)` }), [code]);
  const signDepts = useCallback((rows) => ({ meaning: 'Changed by', action: `Departments (${code}): ${rows.length} change(s)` }), [code]);
  if (!site) return <NeedLab />;
  const [L, me] = data || [];
  return <>
    <PageHeader title={`Equipment types and departments: ${site.site_code}`} audit={{ kind: 'equipmentlists' }}
      subtitle={`${site.site_name}'s own lists, picked on each piece of equipment. A type or department in use cannot be removed: set it Inactive.`} />
    <EqTabs cur="#/equipment/lists" />
    {error && !data ? <Failed error={error} /> : !data ? <Loading /> : <>
      {!me.can_lists && <div className="alert alert-warning">You can view these lists. Changing them needs the equipment.lists permission in this lab.</div>}
      <div className="cols">
        <Section title="Equipment types">
          <EditableGrid rows={L.types} columns={TYPE_COLS} allowAdd={me.can_lists} readOnly={!me.can_lists} what="equipment types" search
            newRow={newActive} rowClass={inactiveRow} sign={signTypes} save={saveTypes} afterSave={reload} />
        </Section>
        <Section title="Departments">
          <EditableGrid rows={L.departments} columns={DEPT_COLS} allowAdd={me.can_lists} readOnly={!me.can_lists} what="departments"
            newRow={newActive} rowClass={inactiveRow} sign={signDepts} save={saveDepartments} afterSave={reload} />
        </Section>
      </div>
    </>}
  </>;
}
