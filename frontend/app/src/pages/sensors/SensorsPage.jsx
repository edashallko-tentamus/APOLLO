// Sensors (0.25.0, migration 045): Admin > Lab setup > Sensors. The lab's connection to iMonnit (the pretend service in
// the Sandbox), the sensors iMonnit lists, which sensor feeds which logbook field for which equipment (linked by
// sensors.configure, approved by QA, both signed), each read, and "Read now".
import { useEffect, useMemo, useState } from 'react';
import { approveSensorLink, getSensors, linkSensor, readSensorsNow, rejudgeSensorLink, retireSensorLink, saveSensorConnection } from '../../api/sensors.js';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import DataGrid from '../../components/grid/DataGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import './sensors.css';

const AUDIT = { kind: 'sensors' };
const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
const num = (v) => (v === null || v === undefined || v === '' ? '' : String(Number(Number(v).toPrecision(6))));
const UNIT = { temperature: '°C', humidity: '% RH' };
const PRETEND = 'Pretend (sandbox)';
const SYNC_COLUMNS = [
  { field: 'finished_at', title: 'When', type: 'readonly', width: 170, format: (v) => dt(v) },
  { field: 'ok', title: 'Result', type: 'readonly', width: 80, format: (v) => (v ? 'OK' : 'Failed'), cellClass: (x) => (x.ok ? 'tbpass' : 'tbfail') },
  { field: 'readings', title: 'Readings', type: 'readonly', width: 85, align: 'right' },
  { field: 'entries', title: 'Entries', type: 'readonly', width: 75, align: 'right' },
  { field: 'message', title: 'Message', type: 'readonly', width: 420 },
  { field: 'run_by_name', title: 'Read by', type: 'readonly', width: 150, format: (v) => v || 'The hourly job' },
];
const syncRowClass = (x) => (x.ok ? '' : 'lb-fail');
const linkRowClass = (x) => (x.status === 'Retired' ? 'mutedrow' : '');

function ReadGrid({ rows, columns, keyField, emptyText, rowClass }) {
  const grid = useGrid({ rows, columns, keyField, readOnly: true });
  const { reset } = grid;
  useEffect(() => { reset(rows); }, [rows, reset]);
  return <DataGrid grid={grid} emptyText={emptyText} rowClass={rowClass} />;
}

export default function SensorsPage() {
  const dialogs = useDialogs();
  const toast = useToast();
  const { data: d, error, reload } = useApi(getSensors, []);
  const [reading, setReading] = useState(false);

  const sensorRows = useMemo(() => (d?.sensors || []).map((x) => ({ ...x, key: x.id })), [d]);
  const sensorColumns = useMemo(() => (d ? [
    { field: 'id', title: 'Sensor ID', type: 'readonly', width: 100 },
    { field: 'name', title: 'Name in iMonnit', type: 'readonly', width: 220 },
    { field: 'battery', title: 'Battery', type: 'readonly', width: 80, align: 'right', format: (v) => (v === null ? '' : v + ' %'), cellClass: (x) => (x.battery !== null && x.battery < 20 ? 'tbfail' : '') },
    { field: 'signal', title: 'Signal', type: 'readonly', width: 70, align: 'right', format: (v) => (v === null ? '' : v + ' %') },
    { field: 'last', title: 'Last message', type: 'readonly', width: 170, format: (v) => dt(v) },
    { field: 'linked', title: 'Linked to', type: 'readonly', width: 360, compute: (x) => d.links.filter((l) => l.external_id === x.id && l.status !== 'Retired').map((l) => `${l.measures}: ${l.equipment_code} in ${l.logbook_code}${l.status === 'Awaiting QA' ? ' (awaiting QA)' : ''}`).join('; ') || 'Not linked' },
  ] : []), [d]);

  const linkColumns = useMemo(() => {
    if (!d) return [];
    const mayApprove = (x) => x.status === 'Awaiting QA' && d.can_approve && x.created_by !== d.me;
    async function act(x) {
      if (mayApprove(x)) {
        const m = await dialogs.form({ title: `Approve sensor ${x.external_id} feeding ${x.logbook_code}`, okText: 'Continue',
          intro: `${x.equipment_code} ${x.equipment_name} · ${x.field_key}. The feed records from now on, or fills in the sensor's recent readings first.`,
          fields: [{ name: 'hours_back', label: 'Feed the logbook from', type: 'select', blank: false, value: '0',
            options: [{ value: '0', label: 'Now' }, { value: '24', label: '1 day back' }, { value: '48', label: '2 days back' }, { value: '168', label: '7 days back' }] }] });
        if (!m) return;
        const r = await dialogs.sign({ what: `Sensor ${x.external_id} (${x.measures}) feeding ${x.logbook_code} for ${x.equipment_code}`, meaning: 'Approved by', needReason: false,
          submit: ({ signature }) => approveSensorLink(x.id, { hours_back: m.hours_back, signature }) });
        if (r) { toast('Approved: the sensor feeds the logbook from now on.'); reload(); }
      } else if (x.status !== 'Retired' && d.can_configure) {
        const m = await dialogs.form({ title: `Retire the link of sensor ${x.external_id}`, okText: 'Continue', intro: 'The sensor stops feeding the logbook; its entries and readings stay.',
          fields: [{ name: 'why', label: 'Why (moved, replaced, equipment retired)', type: 'textarea', required: true }] });
        if (!m) return;
        const r = await dialogs.sign({ what: `Retire sensor ${x.external_id} (${x.measures})`, meaning: 'Changed by', needReason: true, defaultReason: m.why,
          submit: ({ signature, reason }) => retireSensorLink(x.id, { why: m.why, reason, signature }) });
        if (r) { toast('Link retired.'); reload(); }
      }
    }
    async function rejudge(x) {
      if (x.status !== 'Active' || !d.can_configure) return;
      const m = await dialogs.form({ title: `Judge again the entries of sensor ${x.external_id}`, okText: 'Continue',
        intro: `For when ${x.logbook_code}'s limits for ${x.equipment_code} were wrong. The sensor's entries are judged again against the limits as they are now: excursions that no longer are one are voided, hours judged again (approved ones go back to QA). Your reason is kept on each change.`,
        fields: [
          { name: 'hours_back', label: 'Entries from', type: 'select', blank: false, value: 'all', options: [{ value: 'all', label: 'The start of the feed' }, { value: '24', label: 'The last day' }, { value: '72', label: 'The last 3 days' }, { value: '168', label: 'The last 7 days' }] },
          { name: 'why', label: 'Why (e.g. the limits were typed as 10 to 30 instead of 33 to 37)', type: 'textarea', required: true },
        ] });
      if (!m) return;
      const r = await dialogs.sign({ what: `Judge again the entries of sensor ${x.external_id} (${x.measures})`, meaning: 'Changed by', needReason: false,
        submit: ({ signature }) => rejudgeSensorLink(x.id, { hours_back: m.hours_back, why: m.why, signature }) });
      if (r) { const bad = r.errors && r.errors.length; toast(bad ? `Asked, but the read had problems: ${r.errors.join('; ')}` : `Judged again: ${r.entries} entries changed.`, bad ? 'err' : undefined); reload(); }
    }
    const cols = [
      { field: 'external_id', title: 'Sensor', type: 'readonly', width: 205, compute: (x) => `${x.external_id}${x.sensor_name ? ' ' + x.sensor_name : ''} (${x.measures})` },
      { field: 'equipment_code', title: 'Equipment', type: 'link', width: 175, href: (x) => '#/equipment/' + x.equipment_id, compute: (x) => `${x.equipment_code} ${x.equipment_name}` },
      { field: 'logbook_code', title: 'Logbook field', type: 'link', width: 135, href: (x) => '#/logbooks/' + x.logbook_id + (x.equipment_id ? '?tab=entries&equipment=' + x.equipment_id : ''), compute: (x) => `${x.logbook_code} · ${x.field_key}` },
      { field: 'gap_minutes', title: 'Silence after', type: 'readonly', width: 80, format: (v) => v + ' min' },
      { field: 'last', title: 'Last reading', type: 'readonly', width: 125, compute: (x) => (x.last ? `${num(x.last.value)} ${UNIT[x.measures]} at ${new Date(x.last.at).toLocaleTimeString([], { timeStyle: 'short' })}` : '') },
      { field: 'reasons_needed', title: 'Reasons needed', type: 'readonly', width: 70, align: 'right', format: (v) => v || '', cellClass: (x) => (x.reasons_needed ? 'tbfail' : '') },
      { field: 'status', title: 'Status', type: 'readonly', width: 190, cellClass: (x) => (x.status === 'Awaiting QA' ? 'tbwait' : x.status === 'Active' ? 'tbpass' : ''),
        compute: (x) => (x.status === 'Active' ? `Feeding · QA: ${x.approved_by_name}` : x.status === 'Awaiting QA' ? `Awaiting QA (linked by ${x.created_by_name})` : `Retired: ${x.retired_reason || ''}`) },
      { field: 'act', title: '', type: 'button', width: 95, label: (x) => (mayApprove(x) ? 'Approve…' : x.status !== 'Retired' && d.can_configure ? 'Retire…' : ''), onClick: act },
      { field: 'rejudge', title: '', type: 'button', width: 100, label: (x) => (x.status === 'Active' && d.can_configure ? 'Re-judge…' : ''), onClick: rejudge },
    ];
    return [...cols.slice(-2), ...cols.slice(0, -2)]; // the action buttons first, so they stay in view however wide the table gets
  }, [d, dialogs, toast, reload]);

  if (error) return <><PageHeader title="Sensors" audit={AUDIT} /><div className="card err">{error.message}</div></>;
  if (!d) return <><PageHeader title="Sensors" audit={AUDIT} /><div className="loading">Loading…</div></>;
  const c = d.connection || {};
  const on = !!c.enabled;
  const last = d.syncs[0];

  async function readNow() {
    setReading(true);
    try {
      const r = await readSensorsNow();
      toast(r.errors.length ? `Read with problems: ${r.errors.join('; ')}` : `Read: ${r.readings} new readings, ${r.entries} entries recorded or updated.`, r.errors.length ? 'err' : undefined);
      reload();
    } catch (e) { toast(e.message, 'err'); } finally { setReading(false); }
  }
  async function connection() {
    const m = await dialogs.form({ title: 'Sensor connection', okText: 'Continue', intro: 'The Sandbox uses the pretend service (made-up readings). On a production server: iMonnit\'s cloud or our own iMonnit Enterprise, with the key set on the server as LIMS_IMONNIT_KEY.',
      fields: [
        { name: 'enabled', label: 'Read the sensors', type: 'checkbox', cbLabel: 'On', value: on },
        { name: 'mode', label: 'Connects to', type: 'select', blank: false, value: c.mode, options: [PRETEND, 'iMonnit cloud', 'iMonnit Enterprise'] },
        { name: 'base_url', label: 'iMonnit\'s address (not for the pretend service)', value: c.base_url || '', help: 'e.g. https://www.imonnit.com' },
        { name: 'read_every_minutes', label: 'Read every (minutes)', type: 'number', value: c.read_every_minutes },
        { name: 'lookback_hours', label: 'Take this many hours again each read', type: 'number', value: c.lookback_hours },
      ] });
    if (!m) return;
    const r = await dialogs.sign({ what: 'The lab\'s sensor connection', meaning: 'Changed by', needReason: true, sign: false,
      submit: ({ reason }) => saveSensorConnection({ ...m, reason }) });
    if (r) { toast('Connection saved.'); reload(); }
  }
  async function newLink() {
    if (!d.targets.length) { toast('No logbook can take a sensor yet: an approved Equipment logbook with a number field (e.g. Temperature), covering the equipment. See "Cannot be linked yet" on this page.', 'err'); return; }
    const linked = new Set(d.links.filter((l) => l.status !== 'Retired').map((l) => `${l.logbook_id}|${l.equipment_id}|${l.field_key}`));
    const m = await dialogs.form({ title: 'Link a sensor', okText: 'Continue', wide: true,
      intro: `The sensor then feeds this logbook field for this piece of equipment, judged against its limits there. QA approves the link before it feeds.${d.blocked && d.blocked.length ? ` Not offered: ${d.blocked.map((x) => `${x.equipment_code} in ${x.logbook_code} (${x.problem})`).join('; ')}.` : ''}`,
      fields: [
        d.sensors.length ? { name: 'external_id', label: 'Sensor', type: 'select', required: true, options: d.sensors.map((s) => ({ value: s.id, label: `${s.id} ${s.name || ''}` })) }
          : { name: 'external_id', label: 'Sensor ID (iMonnit)', required: true },
        { name: 'measures', label: 'Value', type: 'select', blank: false, value: 'temperature', options: [{ value: 'temperature', label: 'Temperature (°C)' }, { value: 'humidity', label: 'Humidity (% RH)' }] },
        { name: 'target', label: 'Feeds', type: 'select', required: true, options: d.targets.filter((t) => !linked.has(`${t.logbook_id}|${t.equipment_id}|${t.field_key}`))
          .map((t) => ({ value: `${t.logbook_id}|${t.equipment_id}|${t.field_key}`, label: `${t.equipment_code} ${t.equipment_name} · ${t.logbook_code} ${t.logbook_name} · ${t.label}${t.unit ? ' (' + t.unit + ')' : ''}` })) },
        { name: 'gap_minutes', label: 'A silence longer than (minutes) is recorded', type: 'number', value: 30 },
      ] });
    if (!m) return;
    const [logbook_id, equipment_id, field_key] = m.target.split('|');
    const s = d.sensors.find((x) => x.id === m.external_id);
    const body = { external_id: m.external_id, sensor_name: s ? s.name : null, measures: m.measures, logbook_id, equipment_id, field_key, gap_minutes: m.gap_minutes };
    const r = await dialogs.sign({ what: `Sensor ${m.external_id} (${m.measures}) linked to a logbook`, meaning: 'Created by', needReason: false,
      submit: ({ signature }) => linkSensor({ ...body, signature }) });
    if (r) { toast('Linked: QA approves the link before it feeds.'); reload(); }
  }

  return <>
    <PageHeader title="Sensors" audit={AUDIT}
      subtitle="Temperature and humidity sensors (Monnit, through iMonnit) feeding the logbooks: one entry per hour, one per spell outside the limits and one per silence, recorded by the automated sensor feed. A person gives the reason for an excursion or a silence; QA approves the entries as usual. Each link is approved by QA before it feeds."
      actions={<>
        {d.can_configure && on && <button type="button" className="btn" onClick={readNow} disabled={reading}>Read now</button>}{' '}
        {d.can_configure && <button type="button" className="btn primary" onClick={newLink}>+ Link a sensor</button>}
      </>} />
    <Section title="Connection" help="Set by a system administrator. The iMonnit key is kept on the server, never in the LIMS."
      actions={d.is_admin && <button type="button" className="btn" onClick={connection}>Change…</button>}>
      <div className="lb-facts sensor-facts">
        <div><b>Status</b>{on ? <span className="pill tbpass">On</span> : <span className="pill tbwait">Off</span>}</div>
        <div><b>Connects to</b>{c.mode || ''}{c.mode === PRETEND ? <> <span className="lb-note">(made-up readings, for trying it out)</span></> : c.base_url ? <><br />{c.base_url}</> : ''}</div>
        {c.mode && c.mode !== PRETEND && <div><b>Key on the server</b>{d.key_set ? 'Set' : <span className="short">Not set (LIMS_IMONNIT_KEY)</span>}</div>}
        <div><b>Reads</b>every {c.read_every_minutes} minutes, taking the last {c.lookback_hours} hours again (late readings)</div>
        <div><b>Last read</b>{last ? <>{dt(last.finished_at)}: {last.ok ? (last.message || 'OK') : <span className="short">{last.message || 'failed'}</span>}</> : 'Not yet'}</div>
      </div>
    </Section>
    {on && (
      <Section title="Sensors iMonnit lists" help={d.sensors_error ? '' : 'Battery and signal as iMonnit reports them. A battery under 20 % needs changing.'}>
        {d.sensors_error ? <div className="lb-failbox">iMonnit could not be read: {d.sensors_error}</div>
          : <ReadGrid rows={sensorRows} columns={sensorColumns} keyField="key" emptyText="iMonnit lists no sensors." />}
      </Section>
    )}
    <Section title="Linked sensors" help={'Which sensor feeds which logbook field, for which piece of equipment. A link feeds from QA\'s approval on; to change one, retire it and link the sensor again. Entries are judged against the limits in force when they are recorded: if the limits were wrong, "Re-judge…" judges them again against the corrected ones.'}>
      <ReadGrid rows={d.links} columns={linkColumns} emptyText="No sensor is linked yet." rowClass={linkRowClass} />
      {d.blocked && d.blocked.length > 0 && (
        <details className="lb-note" id="blocked" style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer' }}><b>Equipment logbooks a sensor cannot feed yet ({d.blocked.length})</b>, and why</summary>
          <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>{d.blocked.map((x, i) => <li key={i}>{x.equipment_code} {x.equipment_name} in {x.logbook_code} {x.logbook_name}: {x.problem}</li>)}</ul>
        </details>
      )}
    </Section>
    <Section title="Reads" help={'Each read of the lab\'s sensors: readings received and entries recorded, changed or voided.'}>
      <ReadGrid rows={d.syncs} columns={SYNC_COLUMNS} emptyText="No read yet." rowClass={syncRowClass} />
    </Section>
  </>;
}
