// Sensors (0.25.0, migration 045): Admin > Lab setup > Sensors. The lab's connection to iMonnit (the pretend service in
// the Sandbox), the sensors iMonnit lists, which sensor feeds which logbook field for which equipment (linked by
// sensors.configure, approved by QA, both signed), each read, and "Read now". The feed records one logbook entry per
// hour, one per spell outside the limits and one per silence; people give the reason for the last two.
import { api, esc, pageHeader, toast, modal, signDialog, link } from '../app.js';
import { Grid } from '../grid.js';
import { section } from './common.js';

const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
const num = (v) => (v === null || v === undefined || v === '' ? '' : String(Number(Number(v).toPrecision(6))));
const UNIT = { temperature: '°C', humidity: '% RH' };

export async function page(main) {
  const d = await api('/sensors');
  const c = d.connection || {};
  const on = !!c.enabled;
  const last = d.syncs[0];
  const acts = [];
  if (d.can_configure && on) acts.push('<button class="btn" id="readnow">Read now</button>');
  if (d.can_configure) acts.push('<button class="btn primary" id="link">+ Link a sensor</button>');
  main.innerHTML = pageHeader('Sensors', 'Temperature and humidity sensors (Monnit, through iMonnit) feeding the logbooks: one entry per hour, one per spell outside the limits and one per silence, recorded by the automated sensor feed. A person gives the reason for an excursion or a silence; QA approves the entries as usual. Each link is approved by QA before it feeds.',
    acts.join(''), { kind: 'sensors' })
    + `<div class="card">${section('Connection', 'Set by a system administrator. The iMonnit key is kept on the server, never in the LIMS.', d.is_admin ? '<button class="btn" id="conn">Change…</button>' : '')}
        <div class="lb-facts" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px 18px">
          <div><b style="display:block;font-size:11px;color:var(--muted)">Status</b>${on ? '<span class="tbpass" style="padding:1px 6px;border-radius:4px">On</span>' : '<span class="tbwait" style="padding:1px 6px;border-radius:4px">Off</span>'}</div>
          <div><b style="display:block;font-size:11px;color:var(--muted)">Connects to</b>${esc(c.mode || '')}${c.mode === 'Pretend (sandbox)' ? ' <span class="lb-note">(made-up readings, for trying it out)</span>' : c.base_url ? '<br>' + esc(c.base_url) : ''}</div>
          ${c.mode && c.mode !== 'Pretend (sandbox)' ? `<div><b style="display:block;font-size:11px;color:var(--muted)">Key on the server</b>${d.key_set ? 'Set' : '<span class="short">Not set (LIMS_IMONNIT_KEY)</span>'}</div>` : ''}
          <div><b style="display:block;font-size:11px;color:var(--muted)">Reads</b>every ${esc(c.read_every_minutes)} minutes, taking the last ${esc(c.lookback_hours)} hours again (late readings)</div>
          <div><b style="display:block;font-size:11px;color:var(--muted)">Last read</b>${last ? `${dt(last.finished_at)}: ${last.ok ? esc(last.message || 'OK') : '<span class="short">' + esc(last.message || 'failed') + '</span>'}` : 'Not yet'}</div>
        </div></div>
      ${on ? `<div class="card">${section('Sensors iMonnit lists', d.sensors_error ? '' : 'Battery and signal as iMonnit reports them. A battery under 20 % needs changing.')}${d.sensors_error ? `<div class="lb-failbox">iMonnit could not be read: ${esc(d.sensors_error)}</div>` : '<div id="sens"></div>'}</div>` : ''}
      <div class="card">${section('Linked sensors', 'Which sensor feeds which logbook field, for which piece of equipment. A link feeds from QA\'s approval on; to change one, retire it and link the sensor again. Entries are judged against the limits in force when they are recorded: if the limits were wrong, "Re-judge…" judges them again against the corrected ones.')}<div id="links"></div>
        ${d.blocked && d.blocked.length ? `<details class="lb-note" id="blocked" style="margin-top:10px"><summary style="cursor:pointer"><b>Equipment logbooks a sensor cannot feed yet (${d.blocked.length})</b>, and why</summary><ul style="margin:4px 0 0 18px;padding:0">${d.blocked.map((x) => `<li>${esc(x.equipment_code)} ${esc(x.equipment_name)} in ${esc(x.logbook_code)} ${esc(x.logbook_name)}: ${esc(x.problem)}</li>`).join('')}</ul></details>` : ''}</div>
      <div class="card">${section('Reads', 'Each read of the lab\'s sensors: readings received and entries recorded, changed or voided.')}<div id="syncs"></div></div>`;

  if (on && !d.sensors_error) {
    new Grid(main.querySelector('#sens'), { readOnly: true, rows: d.sensors.map((x) => ({ ...x, key: x.id })), keyField: 'key', emptyText: 'iMonnit lists no sensors.',
      columns: [
        { field: 'id', title: 'Sensor ID', type: 'readonly', width: 100 },
        { field: 'name', title: 'Name in iMonnit', type: 'readonly', width: 220 },
        { field: 'battery', title: 'Battery', type: 'readonly', width: 80, align: 'right', format: (v) => (v === null ? '' : v + ' %'), cellClass: (x) => (x.battery !== null && x.battery < 20 ? 'tbfail' : '') },
        { field: 'signal', title: 'Signal', type: 'readonly', width: 70, align: 'right', format: (v) => (v === null ? '' : v + ' %') },
        { field: 'last', title: 'Last message', type: 'readonly', width: 170, format: (v) => dt(v) },
        { field: 'linked', title: 'Linked to', type: 'readonly', width: 360, compute: (x) => d.links.filter((l) => l.external_id === x.id && l.status !== 'Retired').map((l) => `${l.measures}: ${l.equipment_code} in ${l.logbook_code}${l.status === 'Awaiting QA' ? ' (awaiting QA)' : ''}`).join('; ') || 'Not linked' },
      ] });
  }
  // the action buttons go first, so they stay in view however wide the table gets
  const firstLast = (cols) => [...cols.slice(-2), ...cols.slice(0, -2)];
  new Grid(main.querySelector('#links'), { readOnly: true, rows: d.links, emptyText: 'No sensor is linked yet.', rowClass: (x) => (x.status === 'Retired' ? 'mutedrow' : ''),
    columns: firstLast([
      { field: 'external_id', title: 'Sensor', type: 'readonly', width: 205, compute: (x) => `${x.external_id}${x.sensor_name ? ' ' + x.sensor_name : ''} (${x.measures})` },
      { field: 'equipment_code', title: 'Equipment', type: 'link', width: 175, href: (x) => '#/equipment/' + x.equipment_id, compute: (x) => `${x.equipment_code} ${x.equipment_name}` },
      { field: 'logbook_code', title: 'Logbook field', type: 'link', width: 135, href: (x) => '#/logbooks/' + x.logbook_id + (x.equipment_id ? '?tab=entries&equipment=' + x.equipment_id : ''), compute: (x) => `${x.logbook_code} · ${x.field_key}` },
      { field: 'gap_minutes', title: 'Silence after', type: 'readonly', width: 80, format: (v) => v + ' min' },
      { field: 'last', title: 'Last reading', type: 'readonly', width: 125, compute: (x) => (x.last ? `${num(x.last.value)} ${UNIT[x.measures]} at ${new Date(x.last.at).toLocaleTimeString([], { timeStyle: 'short' })}` : '') },
      { field: 'reasons_needed', title: 'Reasons needed', type: 'readonly', width: 70, align: 'right', format: (v) => v || '', cellClass: (x) => (x.reasons_needed ? 'tbfail' : '') },
      { field: 'status', title: 'Status', type: 'readonly', width: 190, cellClass: (x) => (x.status === 'Awaiting QA' ? 'tbwait' : x.status === 'Active' ? 'tbpass' : ''),
        compute: (x) => (x.status === 'Active' ? `Feeding · QA: ${x.approved_by_name}` : x.status === 'Awaiting QA' ? `Awaiting QA (linked by ${x.created_by_name})` : `Retired: ${x.retired_reason || ''}`) },
      { field: 'act', title: '', type: 'button', width: 95, label: (x) => (x.status === 'Awaiting QA' && d.can_approve && x.created_by !== d.me ? 'Approve…' : x.status !== 'Retired' && d.can_configure ? 'Retire…' : ''),
        onClick: async (x) => {
          if (x.status === 'Awaiting QA' && d.can_approve && x.created_by !== d.me) {
            const m = await modal({ title: `Approve sensor ${x.external_id} feeding ${x.logbook_code}`, okText: 'Continue',
              intro: `${esc(x.equipment_code)} ${esc(x.equipment_name)} · ${esc(x.field_key)}. The feed records from now on, or fills in the sensor's recent readings first.`,
              fields: [{ name: 'hours_back', label: 'Feed the logbook from', type: 'select', blank: false, value: '0',
                options: [{ value: '0', label: 'Now' }, { value: '24', label: '1 day back' }, { value: '48', label: '2 days back' }, { value: '168', label: '7 days back' }] }] });
            if (!m) return;
            const r = await signDialog({ what: `Sensor ${x.external_id} (${x.measures}) feeding ${x.logbook_code} for ${x.equipment_code}`, meaning: 'Approved by', needReason: false,
              submit: ({ signature }) => api(`/sensors/links/${x.id}/approve`, { method: 'POST', body: { hours_back: m.hours_back, signature } }) });
            if (r) { toast('Approved: the sensor feeds the logbook from now on.'); page(main); }
          } else if (x.status !== 'Retired' && d.can_configure) {
            const m = await modal({ title: `Retire the link of sensor ${x.external_id}`, okText: 'Continue', intro: 'The sensor stops feeding the logbook; its entries and readings stay.', fields: [{ name: 'why', label: 'Why (moved, replaced, equipment retired)', type: 'textarea', required: true }] });
            if (!m) return;
            const r = await signDialog({ what: `Retire sensor ${x.external_id} (${x.measures})`, meaning: 'Changed by', needReason: true, defaultReason: m.why,
              submit: ({ signature, reason }) => api(`/sensors/links/${x.id}/retire`, { method: 'POST', body: { why: m.why, reason, signature } }) });
            if (r) { toast('Link retired.'); page(main); }
          }
        } },
      { field: 'rejudge', title: '', type: 'button', width: 100, label: (x) => (x.status === 'Active' && d.can_configure ? 'Re-judge…' : ''),
        onClick: async (x) => {
          if (x.status !== 'Active' || !d.can_configure) return;
          const m = await modal({ title: `Judge again the entries of sensor ${x.external_id}`, okText: 'Continue',
            intro: `For when ${esc(x.logbook_code)}'s limits for ${esc(x.equipment_code)} were wrong. The sensor's entries are judged again against the limits as they are now: excursions that no longer are one are voided, hours judged again (approved ones go back to QA). Your reason is kept on each change.`,
            fields: [
              { name: 'hours_back', label: 'Entries from', type: 'select', blank: false, value: 'all', options: [{ value: 'all', label: 'The start of the feed' }, { value: '24', label: 'The last day' }, { value: '72', label: 'The last 3 days' }, { value: '168', label: 'The last 7 days' }] },
              { name: 'why', label: 'Why (e.g. the limits were typed as 10 to 30 instead of 33 to 37)', type: 'textarea', required: true },
            ] });
          if (!m) return;
          const r = await signDialog({ what: `Judge again the entries of sensor ${x.external_id} (${x.measures})`, meaning: 'Changed by', needReason: false,
            submit: ({ signature }) => api(`/sensors/links/${x.id}/rejudge`, { method: 'POST', body: { hours_back: m.hours_back, why: m.why, signature } }) });
          if (r) { toast(r.errors && r.errors.length ? `Asked, but the read had problems: ${r.errors.join('; ')}` : `Judged again: ${r.entries} entries changed.`, r.errors && r.errors.length ? 'err' : undefined); page(main); }
        } },
    ]) });
  new Grid(main.querySelector('#syncs'), { readOnly: true, rows: d.syncs, emptyText: 'No read yet.', rowClass: (x) => (x.ok ? '' : 'lb-fail'),
    columns: [
      { field: 'finished_at', title: 'When', type: 'readonly', width: 170, format: (v) => dt(v) },
      { field: 'ok', title: 'Result', type: 'readonly', width: 80, format: (v) => (v ? 'OK' : 'Failed'), cellClass: (x) => (x.ok ? 'tbpass' : 'tbfail') },
      { field: 'readings', title: 'Readings', type: 'readonly', width: 85, align: 'right' },
      { field: 'entries', title: 'Entries', type: 'readonly', width: 75, align: 'right' },
      { field: 'message', title: 'Message', type: 'readonly', width: 420 },
      { field: 'run_by_name', title: 'Read by', type: 'readonly', width: 150, format: (v) => v || 'The hourly job' },
    ] });

  const $ = (s) => main.querySelector(s);
  if ($('#readnow')) $('#readnow').onclick = async () => {
    $('#readnow').disabled = true;
    try { const r = await api('/sensors/read-now', { method: 'POST', body: {} }); toast(r.errors.length ? `Read with problems: ${r.errors.join('; ')}` : `Read: ${r.readings} new readings, ${r.entries} entries recorded or updated.`, r.errors.length ? 'err' : undefined); page(main); }
    catch (e) { toast(e.message, 'err'); $('#readnow').disabled = false; }
  };
  if ($('#conn')) $('#conn').onclick = async () => {
    const m = await modal({ title: 'Sensor connection', okText: 'Continue', intro: 'The Sandbox uses the pretend service (made-up readings). On a production server: iMonnit\'s cloud or our own iMonnit Enterprise, with the key set on the server as LIMS_IMONNIT_KEY.',
      fields: [
        { name: 'enabled', label: 'Read the sensors', type: 'checkbox', cbLabel: 'On', value: on },
        { name: 'mode', label: 'Connects to', type: 'select', blank: false, value: c.mode, options: ['Pretend (sandbox)', 'iMonnit cloud', 'iMonnit Enterprise'] },
        { name: 'base_url', label: 'iMonnit\'s address (not for the pretend service)', value: c.base_url || '', help: 'e.g. https://www.imonnit.com' },
        { name: 'read_every_minutes', label: 'Read every (minutes)', type: 'number', value: c.read_every_minutes },
        { name: 'lookback_hours', label: 'Take this many hours again each read', type: 'number', value: c.lookback_hours },
      ] });
    if (!m) return;
    const r = await signDialog({ what: 'The lab\'s sensor connection', meaning: 'Changed by', needReason: true, sign: false,
      submit: ({ reason }) => api('/sensors/connection', { method: 'POST', body: { ...m, reason } }) });
    if (r) { toast('Connection saved.'); page(main); }
  };
  if ($('#link')) $('#link').onclick = async () => {
    if (!d.targets.length) { toast('No logbook can take a sensor yet: an approved Equipment logbook with a number field (e.g. Temperature), covering the equipment. See "Cannot be linked yet" on this page.', 'err'); return; }
    const linked = new Set(d.links.filter((l) => l.status !== 'Retired').map((l) => `${l.logbook_id}|${l.equipment_id}|${l.field_key}`));
    const m = await modal({ title: 'Link a sensor', okText: 'Continue', wide: true,
      intro: `The sensor then feeds this logbook field for this piece of equipment, judged against its limits there. QA approves the link before it feeds.${d.blocked && d.blocked.length ? ` Not offered: ${d.blocked.map((x) => esc(`${x.equipment_code} in ${x.logbook_code} (${x.problem})`)).join('; ')}.` : ''}`,
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
    const r = await signDialog({ what: `Sensor ${m.external_id} (${m.measures}) linked to a logbook`, meaning: 'Created by', needReason: false,
      submit: ({ signature }) => api('/sensors/links', { method: 'POST', body: { ...body, signature } }) });
    if (r) { toast('Linked: QA approves the link before it feeds.'); page(main); }
  };
}

// The equipment page: its sensors, the last reading and the last 24 hours
export async function equipmentCard(host, equipmentId) {
  let d; try { d = await api('/sensors/equipment/' + equipmentId); } catch (_) { return; }
  if (!d.rows.length) { host.innerHTML = ''; return; }
  host.innerHTML = `<div class="card">${section('Sensors', 'Readings from Monnit sensors feeding its logbook (Admin > Lab setup > Sensors).')}
    <div class="lb-due">${d.rows.map((x) => `<span class="${x.status === 'Active' ? 'ok' : ''}">${esc(x.external_id)}${x.sensor_name ? ' ' + esc(x.sensor_name) : ''} (${esc(x.measures)}): ${x.last ? `${esc(num(x.last.value))} ${esc(x.unit || UNIT[x.measures])} at ${esc(new Date(x.last.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }))}${x.day && x.day.n ? `; last 24 h ${esc(num(x.day.lo))} to ${esc(num(x.day.hi))}` : ''}${x.last.battery !== null && x.last.battery < 20 ? `; battery ${esc(x.last.battery)} %` : ''}` : 'no reading yet'}${x.status === 'Awaiting QA' ? ' (awaiting QA)' : ''} · ${link('#/logbooks/' + x.logbook_id, x.logbook_code)}</span>`).join('')}</div></div>`;
}
