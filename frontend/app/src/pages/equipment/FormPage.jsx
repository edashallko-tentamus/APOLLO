// New, duplicate (?from=<id>) and edit equipment. Saving is signed; at least one group or person is responsible for it.
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createEquipment, equipmentLists, getEquipment, updateEquipment } from '../../api/equipment.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import SmartSelect from '../../components/SmartSelect.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useUnsavedChanges } from '../../router/useHashRoute.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { d8, Failed, Field, Loading, NeedLab, signed } from './shared.jsx';
import { Button, Card, Form } from 'react-bootstrap';

const withBlank = (o) => [{ value: '', label: '' }, ...o];
const str = (v) => (v === null || v === undefined ? '' : String(v));

export default function FormPage({ params = [], query }) {
  const editId = params[0] || null;
  const fromId = new URLSearchParams(query).get('from');
  const { site } = useSession();
  const { data, error } = useApi(() => Promise.all([equipmentLists(), editId || fromId ? getEquipment(editId || fromId) : null]), [editId, fromId]);
  if (!site) return <NeedLab />;
  if (error && !data) return <Failed error={error} />;
  if (!data) return <Loading />;
  return <EquipmentForm key={(editId || '') + (fromId || '')} L={data[0]} src={data[1]} editId={editId} fromId={fromId} site={site} />;
}

function EquipmentForm({ L, src, editId, fromId, site }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const e = src ? src.eq : { calibration_alert_days: 30 };
  // Duplicate copies type, department, maker, model, calibration settings and owners; clears ID, serial and asset tag
  const [v, setV] = useState(() => {
    const s = editId ? e : { ...e, serial_number: '', asset_tag: '', equipment_name: fromId ? e.equipment_name + ' (copy)' : '', in_service_date: '' };
    return {
      equipment_name: str(s.equipment_name), equipment_type_id: str(s.equipment_type_id), department_id: str(s.department_id),
      manufacturer: str(s.manufacturer), model: str(s.model), serial_number: str(s.serial_number), asset_tag: str(s.asset_tag),
      in_service_date: d8(s.in_service_date), location_id: str(s.location_id), location_note: str(s.location_note), notes: str(s.notes),
      calibration_required: !!s.calibration_required, qualification_required: !!s.qualification_required,
      calibration_interval_months: str(s.calibration_interval_months), calibration_alert_days: str(s.calibration_alert_days ?? 30),
    };
  });
  const ownersNow = src ? src.owners : [];
  const [groups, setGroups] = useState(() => new Set(ownersNow.filter((o) => o.group_id).map((o) => o.group_id)));
  const [people, setPeople] = useState(() => new Set(ownersNow.filter((o) => o.user_id).map((o) => o.user_id)));
  const [touched, setTouched] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useUnsavedChanges(touched);

  const types = L.types.filter((t) => t.status === 'Active' || t.id === e.equipment_type_id).map((t) => ({ value: t.id, label: t.type_name }));
  const depts = L.departments.filter((d) => d.status === 'Active' || d.id === e.department_id).map((d) => ({ value: d.id, label: `${d.department_code} ${d.department_name}` }));
  const locs = L.locations.map((l) => ({ value: l.id, label: `${l.location_code}: ${l.path}` }));
  const set = (k) => (x) => { setTouched(true); setV((s) => ({ ...s, [k]: x })); };
  const inp = (k, type = 'text', extra = {}) => <Form.Control type={type} value={v[k]} onChange={(ev) => set(k)(type === 'checkbox' ? ev.target.checked : ev.target.value)} {...extra} />;
  const sel = (k, options) => <SmartSelect value={v[k]} options={withBlank(options)} onChange={set(k)} />;
  const toggle = (setter, id) => (ev) => { setTouched(true); const on = ev.target.checked; setter((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; }); };

  async function save() {
    if (busy) return;
    const t = (k) => v[k].trim();
    const row = {
      equipment_name: t('equipment_name'), equipment_type_id: v.equipment_type_id || null, department_id: v.department_id || null, manufacturer: t('manufacturer') || null,
      model: t('model') || null, serial_number: t('serial_number') || null, asset_tag: t('asset_tag') || null, location_id: v.location_id || null,
      location_note: t('location_note') || null, in_service_date: v.in_service_date || null, notes: t('notes') || null,
      calibration_required: v.calibration_required, qualification_required: v.qualification_required,
      calibration_interval_months: t('calibration_interval_months') === '' ? null : Number(t('calibration_interval_months')),
      calibration_alert_days: t('calibration_alert_days') === '' ? 30 : Number(t('calibration_alert_days')),
    };
    const owners = [...groups].map((id) => ({ group_id: id })).concat([...people].map((id) => ({ user_id: id })));
    if (!row.equipment_name) return setErr('Give it a name.');
    if (!row.equipment_type_id) return setErr('Pick its type.');
    if (!row.department_id) return setErr('Pick the department it belongs to.');
    if (!owners.length) return setErr('Tick at least one group or person responsible for it.');
    setErr(''); setBusy(true);
    try {
      const r = await signed(dialogs, { what: editId ? `Changes to ${e.equipment_code} ${row.equipment_name}` : `New equipment: ${row.equipment_name}`, meaning: editId ? 'Changed by' : 'Created by', needReason: !!editId },
        (reason, signature) => (editId ? updateEquipment(editId, { row, owners, reason, signature }) : createEquipment({ row, owners, reason, signature })));
      if (!r) return;
      flushSync(() => setTouched(false));
      toast(editId ? 'Saved and signed.' : `Created ${r.equipment_code} and signed.`);
      window.location.hash = '#/equipment/' + (editId || r.id);
    } finally { setBusy(false); }
  }

  return <>
    <div className="eyebrow">{editId ? e.equipment_code : fromId ? 'Duplicate of ' + e.equipment_code : 'New'} · {site.site_code}</div>
    <PageHeader title={editId ? `Edit ${e.equipment_name}` : 'New equipment'}
      subtitle="Saving asks for your electronic signature. At least one group or person must be responsible for it: they get its calibration and maintenance warnings."
      actions={<Button variant="light" href={editId ? '#/equipment/' + editId : '#/equipment'}>Cancel</Button>} />
    {!types.length && <div className="alert alert-warning">This lab has no equipment types yet: add them on the Equipment types and departments tab first.</div>}
    <Card body className="eqform">
      <div className="grid2">
        <Field label="Name" req help={'What people call it, e.g. "HPLC 2 (pesticides)" or "Pipette P200 #4"'}>{inp('equipment_name')}</Field>
        <Field label="Type" req help="From this lab's Equipment types list">{sel('equipment_type_id', types)}</Field>
      </div>
      <div className="grid3">
        <Field label="Manufacturer">{inp('manufacturer')}</Field><Field label="Model">{inp('model')}</Field>
        <Field label="Department" req help="Every piece of equipment belongs to a department">{sel('department_id', depts)}</Field>
      </div>
      <div className="grid3">
        <Field label="Serial number" help="Unique for the manufacturer">{inp('serial_number')}</Field>
        <Field label="Asset tag">{inp('asset_tag')}</Field>
        <Field label="In service since">{inp('in_service_date', 'date')}</Field>
      </div>
      <div className="grid2">
        <Field label="Location" help="From Inventory > Storage locations (optional)">{sel('location_id', locs)}</Field>
        <Field label="Location note" help={'e.g. "Bench 3, left"'}>{inp('location_note')}</Field>
      </div>
      <div className="grid3">
        <Field label="Calibration"><label className="cb"><Form.Check.Input type="checkbox" checked={v.calibration_required} onChange={(ev) => set('calibration_required')(ev.target.checked)} /> Needs calibration</label></Field>
        <Field label="Calibration interval (months)" help="Sets the default expiry of each calibration">{inp('calibration_interval_months', 'number', { min: 1, step: 1 })}</Field>
        <Field label="Warn this many days before expiry" help="Default 30 (not yet confirmed with the labs)">{inp('calibration_alert_days', 'number', { min: 0, step: 1 })}</Field>
      </div>
      <Field label="Qualification"><label className="cb"><Form.Check.Input type="checkbox" checked={v.qualification_required} onChange={(ev) => set('qualification_required')(ev.target.checked)} /> Needs IQ/OQ/PQ</label></Field>
      <Field label="Responsible: groups" req help="Everyone in a ticked group is responsible (for example HPLC Team or Lab Supervisor)">
        <div className="ownerpick">{L.groups.map((g) => <label key={g.id} title={g.description || ''}><Form.Check.Input type="checkbox" data-og={g.id} checked={groups.has(g.id)} onChange={toggle(setGroups, g.id)} /> {g.group_name}</label>)}</div>
      </Field>
      <Field label="Responsible: named people" help="Optional, for example a General Manager">
        <div className="ownerpick">{L.people.map((u) => <label key={u.id}><Form.Check.Input type="checkbox" data-ou={u.id} checked={people.has(u.id)} onChange={toggle(setPeople, u.id)} /> {u.full_name}</label>)}</div>
      </Field>
      <Field label="Notes"><Form.Control as="textarea" rows={2} value={v.notes} onChange={(ev) => set('notes')(ev.target.value)} /></Field>
      <div className="merr" role="alert">{err}</div>
      <div className="actbar"><Button type="button" variant="primary" disabled={busy} onClick={save}>{editId ? 'Save changes' : 'Create equipment'}</Button></div>
    </Card>
  </>;
}
