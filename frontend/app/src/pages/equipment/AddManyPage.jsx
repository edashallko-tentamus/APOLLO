// Add many: paste rows from Excel and fill down; one signature covers them all.
import { useMemo } from 'react';
import { addManyEquipment, equipmentLists } from '../../api/equipment.js';
import EditableGrid from '../../components/EditableGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useApi } from '../../hooks/useApi.js';
import { plural } from '../../lib/format.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { EqTabs, Failed, Loading, NeedLab } from './shared.jsx';

const DEFAULTS = { calibration_required: true, calibration_alert_days: 30 };
const newRow = () => ({ ...DEFAULTS });
const START = Array.from({ length: 8 }, newRow);
const sign = (rows) => ({ meaning: 'Created by', action: `New equipment: ${plural(rows.filter((r) => r.equipment_name).length, 'item')}` });
// the starting rows count as unchanged, so their defaults are added back here
const save = (rows, reason, signature) => addManyEquipment({ rows: rows.filter((r) => r.equipment_name).map((r) => ({ ...DEFAULTS, ...r })), reason, signature });
// after the grid has redrawn without its saved edits, so leaving does not ask about them
const done = () => { setTimeout(() => { window.location.hash = '#/equipment'; }, 0); };

export default function AddManyPage() {
  const { site } = useSession();
  const { data: L, error } = useApi(() => equipmentLists(), []);
  const columns = useMemo(() => {
    if (!L) return null;
    const types = L.types.filter((t) => t.status === 'Active').map((t) => ({ value: t.id, label: t.type_name }));
    const depts = L.departments.filter((d) => d.status === 'Active').map((d) => ({ value: d.id, label: d.department_code, match: [d.department_name] }));
    const groups = L.groups.map((g) => ({ value: g.id, label: g.group_name }));
    return [
      { field: 'equipment_name', title: 'Name', required: true, width: 190 },
      { field: 'equipment_type_id', title: 'Type', type: 'select', options: types, required: true, width: 140 },
      { field: 'department_id', title: 'Dept', type: 'select', options: depts, required: true, width: 80 },
      { field: 'manufacturer', title: 'Manufacturer', width: 120 }, { field: 'model', title: 'Model', width: 140 },
      { field: 'serial_number', title: 'Serial', width: 110 }, { field: 'asset_tag', title: 'Asset tag', width: 90 },
      { field: 'calibration_required', title: 'Needs calibration', type: 'bool', width: 85 },
      { field: 'calibration_interval_months', title: 'Interval (months)', type: 'int', min: 1, width: 85 },
      { field: 'calibration_alert_days', title: 'Warn (days)', type: 'int', min: 0, width: 75 },
      { field: 'owner_group_id', title: 'Responsible group', type: 'select', options: groups, required: true, width: 150 },
    ];
  }, [L]);
  if (!site) return <NeedLab />;
  return <>
    <PageHeader title={`Add many: ${site.site_code}`}
      subtitle="For pipettes, thermometers, balances and other items you add in batches. Paste rows from Excel (Ctrl+V) and fill down (Ctrl+D) the type, maker and responsible group. One signature covers them all. To add owners beyond one group, edit each item afterwards, or use Upload XLSX on the list."
      actions={<a className="btn ghost" href="#/equipment">Back to the list</a>} />
    <EqTabs cur="#/equipment" />
    {error && !L ? <Failed error={error} /> : !L ? <Loading /> : (
      <div className="card">
        <EditableGrid rows={START} columns={columns} allowAdd newRow={newRow} what="new equipment" needReason={false} sign={sign} save={save} afterSave={done} />
      </div>)}
  </>;
}
