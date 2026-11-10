// Admin > Lab setup > Stability chambers: conditions, chambers, racks, and the upcoming pulls by chamber.
import { useMemo } from 'react';
import { saveChambers, saveConditions, saveRacks, stabilitySetup } from '../../api/stability.js';
import EditableGrid from '../../components/EditableGrid.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useApi } from '../../hooks/useApi.js';
import { d8, Failed, Loading } from './shared.jsx';

const TYPES = ['Long term', 'Intermediate', 'Accelerated', 'Refrigerated', 'Frozen', 'Photostability', 'Other'];
const inactiveRow = (r) => (r.status === 'Inactive' ? 'mutedrow' : '');
const newActive = () => ({ status: 'Active' });
const UPCOMING_COLS = [
  { field: 'equipment_name', title: 'Chamber', type: 'readonly', width: 230 }, { field: 'scheduled_date', title: 'Pull on', type: 'readonly', width: 105, format: d8 },
  { field: 'study_code', title: 'Study', type: 'link', width: 95, href: (r) => '#/stability/studies/' + r.study_id }, { field: 'client_name', title: 'Client', type: 'readonly', width: 160 },
  { field: 'timepoint_label', title: 'Timepoint', type: 'readonly', width: 85 }, { field: 'where', title: 'Rack / position', type: 'readonly', width: 150, compute: (r) => `${r.rack_code}${r.position ? ' · ' + r.position : ''}` },
  { field: 'units_required', title: 'Units', type: 'readonly', width: 60 }, { field: 'status', title: 'Status', type: 'readonly', width: 90 },
];
const overdueRow = (r) => (r.overdue ? 'tbnc' : '');

const saveConds = (rows, reason) => saveConditions({ reason, rows: rows.map((r) => {
  const o = { id: r.id, condition_name: r.condition_name, condition_type: r.condition_type, temperature_c: r.temperature_c, temperature_tol: r.temperature_tol, humidity_pct: r.humidity_pct,
    humidity_tol: r.humidity_tol, description: r.description, status: r.status };
  if (!r.id) o.site_id = r.scope === 'Every lab' ? 'all' : undefined;
  return o;
}) });
const saveChamberRows = (rows, reason) => saveChambers({ reason, rows: rows.map((r) => ({ id: r.id, equipment_id: r.id ? undefined : r.equipment_id, condition_id: r.condition_id, notes: r.notes, status: r.status })) });
const saveRackRows = (rows, reason) => saveRacks({ reason, rows: rows.map((r) => ({ id: r.id, chamber_id: r.id ? undefined : r.chamber_id, rack_code: r.rack_code, description: r.description, positions: r.positions, status: r.status })) });

export default function SetupPage() {
  const { data: d, error, reload } = useApi(() => stabilitySetup(), []);
  const g = useMemo(() => {
    if (!d) return null;
    const can = d.can; const sys = d.sysadmin;
    const ed = (r, isNew) => isNew || (r.site_id ? can : sys);
    const condOpts = d.conditions.filter((x) => x.status === 'Active').map((x) => ({ value: x.id, label: x.condition_name }));
    return {
      condRows: d.conditions.map((x) => ({ ...x, scope: x.site_id ? x.site_code : 'Every lab' })),
      newCond: () => ({ status: 'Active', condition_type: 'Other', scope: d.lab.site_code, sort_order: 100 }),
      condCols: [
        { field: 'condition_name', title: 'Condition', width: 170, required: true, editable: ed },
        { field: 'scope', title: 'Lab', type: sys ? 'select' : 'readonly', options: ['Every lab', d.lab.site_code], width: 90, editable: (r, isNew) => isNew && sys },
        { field: 'condition_type', title: 'Type', type: 'select', options: TYPES, width: 120, editable: ed },
        { field: 'temperature_c', title: 'Temp °C', type: 'number', width: 80, editable: ed },
        { field: 'temperature_tol', title: '± °C', type: 'number', width: 60, editable: ed },
        { field: 'humidity_pct', title: 'RH %', type: 'number', width: 70, editable: ed },
        { field: 'humidity_tol', title: '± RH', type: 'number', width: 60, editable: ed },
        { field: 'description', title: 'Description', width: 230, editable: ed },
        { field: 'chambers', title: 'Chambers here', type: 'readonly', width: 100 },
        { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 85, editable: ed },
      ],
      chamberCols: [
        { field: 'equipment_id', title: 'Equipment', type: 'select', width: 300, required: true, options: d.equipment.map((e) => ({ value: e.id, label: `${e.equipment_name} (${e.equipment_code}, ${e.type_name})` })), editable: (r, isNew) => isNew },
        { field: 'condition_id', title: 'Set to', type: 'select', width: 160, required: true, options: condOpts },
        { field: 'availability', title: 'Equipment status', type: 'readonly', width: 130 },
        { field: 'racks', title: 'Racks', type: 'readonly', width: 60 }, { field: 'stored', title: 'Studies stored', type: 'readonly', width: 105 },
        { field: 'notes', title: 'Notes', width: 220 },
        { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 85 },
      ],
      rackCols: [
        { field: 'chamber_id', title: 'Chamber', type: 'select', width: 280, required: true, options: d.chambers.map((c) => ({ value: c.id, label: `${c.equipment_name} (${c.condition_name})` })), editable: (r, isNew) => isNew },
        { field: 'rack_code', title: 'Rack', width: 80, required: true }, { field: 'description', title: 'Description', width: 200 },
        { field: 'positions', title: 'Positions', type: 'int', width: 80 }, { field: 'holds', title: 'Holds', type: 'readonly', width: 260 },
        { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 85 },
      ],
    };
  }, [d]);
  if (error && !d) return <Failed error={error} />;
  if (!d) return <Loading />;
  const can = d.can;
  return <>
    <PageHeader title="Stability chambers" audit={{ kind: 'stability_setup' }}
      subtitle={`The storage conditions, the chambers (equipment) set to each, and their racks, where each study's material is placed and identified. The pull window new timepoints start with is a lab setting: ± ${d.lab.stability_pull_window_days} days at ${d.lab.site_code} (Sites and holidays).`} />
    <Section title="Conditions" help={d.sysadmin ? 'ICH conditions (every lab) are kept by system administrators; add your lab\'s own below them.' : 'The ICH set is kept for every lab; add your lab\'s own conditions (stability.configure).'}>
      <EditableGrid rows={g.condRows} columns={g.condCols} allowAdd={can || d.sysadmin} readOnly={!(can || d.sysadmin)} what="the stability conditions"
        newRow={g.newCond} rowClass={inactiveRow} save={saveConds} afterSave={reload} />
    </Section>
    <Section title="Chambers" help={'A chamber is a piece of equipment (Equipment > register, type "Stability chamber") set to one condition. Its calibration and tags come from Equipment.'}>
      <EditableGrid rows={d.chambers} columns={g.chamberCols} allowAdd={can} readOnly={!can} what="the stability chambers" newRow={newActive} rowClass={inactiveRow} save={saveChamberRows} afterSave={reload} />
    </Section>
    <Section title="Racks" help="Racks in each chamber. The study material is placed in a rack at a position (shelf / slot), which is printed on the pull.">
      <EditableGrid rows={d.racks} columns={g.rackCols} allowAdd={can} readOnly={!can} what="the stability racks" newRow={newActive} rowClass={inactiveRow} save={saveRackRows} afterSave={reload} />
    </Section>
    <Section title="Upcoming pulls by chamber (next 120 days)" help="Read only. Pulls that are overdue are red.">
      <ReadGrid rows={d.upcoming} columns={UPCOMING_COLS} search emptyText="No pulls in the next 120 days." rowClass={overdueRow} />
    </Section>
  </>;
}
