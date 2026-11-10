// A logbook's Equipment covered tab: the units entries are recorded for, with limits per unit for "Per equipment" fields.
import { useMemo, useRef } from 'react';
import { saveLogbookEquipment } from '../../api/logbooks.js';
import EditableGrid from '../../components/EditableGrid.jsx';
import Section from '../../components/Section.jsx';
import { fmtN } from './calc.js';

const newRow = () => ({ status: 'Active' });
const has = (v) => v !== null && v !== undefined && v !== '';

export default function EquipmentTab({ d, l, fields, reload }) {
  const apiRef = useRef(null);
  const limF = useMemo(() => fields.filter((f) => f.equipment_limits && ['Number', 'Calculated'].includes(f.field_type)), [fields]);
  const rows = useMemo(() => d.equipment.map((e) => {
    const r = { ...e };
    for (const f of limF) { const x = (e.limits || {})[f.field_key] || {}; r['lo_' + f.field_key] = x.min ?? null; r['hi_' + f.field_key] = x.max ?? null; }
    return r;
  }), [d, limF]);
  const columns = useMemo(() => {
    const opts = d.opts.equipment.map((e) => ({ value: e.id, label: `${e.equipment_code} ${e.equipment_name} (${e.type_name})`, match: [e.equipment_code, e.equipment_name] }));
    return [
      { field: 'equipment_id', title: 'Equipment', type: 'select', width: 300, options: opts, required: true, editable: (r, isNew) => isNew },
      { field: 'cond', title: 'Stability condition', type: 'readonly', width: 210, compute: (r) => (r.condition_name ? `${r.condition_name}${r.temperature_tol ? ` (± ${fmtN(r.temperature_tol)} °C${r.humidity_tol ? `, ± ${fmtN(r.humidity_tol)} % RH` : ''})` : ''}` : '') },
      ...limF.flatMap((f) => [{ field: 'lo_' + f.field_key, title: `${f.label} min`, type: 'number', width: 110 }, { field: 'hi_' + f.field_key, title: `${f.label} max`, type: 'number', width: 110 }]),
      { field: 'notes', title: 'Notes', type: 'text', width: 220 },
      { field: 'status', title: 'Status', type: 'select', width: 90, options: ['Active', 'Inactive'] },
    ];
  }, [d, limF]);

  // changes carry only their changed fields: the limits are rebuilt from the whole row
  const save = (changed, reason) => {
    const all = apiRef.current?.grid.state.rows || [];
    const out = changed.map((c) => {
      const full = c.id ? { ...all.find((x) => x.id === c.id), ...c } : c;
      const limits = {};
      for (const f of limF) {
        const lo = full['lo_' + f.field_key]; const hi = full['hi_' + f.field_key];
        if (has(lo) || has(hi)) limits[f.field_key] = { ...(has(lo) ? { min: Number(lo) } : {}), ...(has(hi) ? { max: Number(hi) } : {}) };
      }
      return { id: c.id, equipment_id: full.equipment_id, limits, notes: full.notes, status: full.status };
    });
    return saveLogbookEquipment(l.id, out, reason);
  };

  return (
    <Section title="Equipment covered" help={`Entries are recorded for these units only. ${limF.length ? 'Limits per unit for the fields marked "Per equipment"; empty uses the field\'s own limit, and a stability chamber\'s temperature and humidity come from its condition.' : 'No field has limits per equipment.'}`}>
      <EditableGrid rows={rows} columns={columns} allowAdd={d.can_design} readOnly={!d.can_design} newRow={newRow}
        what={`the equipment covered by ${l.logbook_code}`} save={save} afterSave={reload} apiRef={apiRef} />
    </Section>
  );
}
