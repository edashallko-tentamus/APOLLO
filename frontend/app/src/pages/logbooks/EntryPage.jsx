// A logbook entry (#/logbooks/entries/:id): its values against their limits, the failure and the batches and stability
// studies it flags, the results that used it; give the reason (sensor entries), approve, return, correct, void.
import { useMemo } from 'react';
import { approveEntries, correctEntry, getEntry, getLogbook, giveEntryReason, resolveFlag, returnEntry, voidEntry } from '../../api/logbooks.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { dt, fmtN, limText, loc, needsReason, sensorWhen, showVal, tloc } from './calc.js';
import './logbooks.css';

const keyed = (rows) => (rows || []).map((x, i) => ({ ...x, key: i }));
const FLAG_COLS = [
  { field: 'batch_code', title: 'Batch', type: 'link', width: 120, href: (x) => `#/testing/batches/${x.batch_id}?step=review` },
  { field: 'batch_status', title: 'Batch status', type: 'readonly', width: 130 },
  { field: 'step_name', title: 'Step', type: 'readonly', width: 200 },
  { field: 'used_at', title: 'Used', type: 'readonly', width: 160, format: (v) => dt(v) },
  { field: 'acc', title: 'Accepted', type: 'readonly', width: 360, compute: (x) => (x.accepted ? `${x.accepted_by_name}: ${x.justification}` : 'Not accepted yet'), cellClass: (x) => (x.accepted ? 'tbpass' : 'tbwait') },
];
const EXC_COLS = [
  { field: 'study_code', title: 'Study', type: 'link', width: 120, href: (x) => '#/stability/studies/' + x.study_id },
  { field: 'storage_code', title: 'Material', type: 'readonly', width: 140 },
  { field: 'rack_code', title: 'Rack', type: 'readonly', width: 80 },
  { field: 'condition_name', title: 'Condition', type: 'readonly', width: 180 },
];

// a sensor entry (0.25.0): what it covers and the readings behind it
function SensorBox({ e }) {
  const s = e.sensor; const m = s.summary || {};
  const head = s.kind === 'Hour' ? `Hourly summary of ${m.label || ''}: ${m.n} readings, lowest ${fmtN(m.min)}, highest ${fmtN(m.max)}, average ${fmtN(m.mean)}${(m.excursions || []).length ? '. Part of excursion ' + m.excursions.join(', ') : ''}`
    : s.kind === 'Excursion' ? `Readings outside the limits from ${tloc(s.start)} ${s.end ? 'to ' + tloc(s.end) + ' (the first reading back inside)' : '(still outside)'}: ${m.n} readings, peak ${fmtN(m.peak)}`
      : `No reading from the sensor from ${tloc(s.start)} ${s.end ? 'to ' + tloc(s.end) + ` (${m.minutes} minutes)` : '(still silent)'}`;
  const lim = m.lo !== undefined || m.hi !== undefined ? ` Judged against ${m.lo !== undefined && m.hi !== undefined ? `${fmtN(m.lo)} to ${fmtN(m.hi)}` : m.lo !== undefined ? 'at least ' + fmtN(m.lo) : 'at most ' + fmtN(m.hi)}, the limits when it was recorded.` : '';
  return (
    <Section title="From the sensor" help={`Sensor ${s.sensor || ''}, recorded by the automated sensor feed. The readings cannot be changed by hand.`}>
      <div>{head}.{lim}</div>
      {s.kind === 'Excursion' && Array.isArray(m.readings) && <table className="lb-vals" style={{ marginTop: 8, maxWidth: 420 }}><tbody>
        <tr><th>Reading at</th><th>Value</th></tr>
        {m.readings.map((x, i) => <tr key={i}><td>{tloc(x.at)}</td><td className="out">{fmtN(x.value)}</td></tr>)}
      </tbody></table>}
    </Section>
  );
}

export default function EntryPage({ params: [id] }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const { data: d, error, reload } = useApi((o) => getEntry(id, o), [id]);
  const flags = useMemo(() => keyed(d?.flags), [d]);
  const excursions = useMemo(() => keyed(d?.excursions), [d]);
  const uses = useMemo(() => keyed(d?.uses), [d]);
  const useCols = useMemo(() => [
    { field: 'sample_code', title: 'Sample', type: 'link', width: 130, href: (x) => '#/samples/' + x.sample_id },
    { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 180 },
    { field: 'reported', title: 'Result', type: 'readonly', width: 100 },
    { field: 'batch_code', title: 'Batch', type: 'link', width: 120, href: (x) => '#/testing/batches/' + x.batch_id },
    { field: 'flag', title: 'After a correction', type: 'readonly', width: 360, compute: (x) => (x.flag_status === 'Open' ? 'Flagged: the entry was corrected after the result used it' : x.flag_status === 'Resolved' ? `Reviewed: ${x.flag_note || ''}` : ''), cellClass: (x) => (x.flag_status === 'Open' ? 'tbfail' : '') },
    { field: 'act', title: '', type: 'button', width: 95, label: (x) => (d?.can_resolve && x.flag_status === 'Open' ? 'Resolve…' : ''), onClick: async (x) => {
      if (!d?.can_resolve || x.flag_status !== 'Open') return;
      const m = await dialogs.form({ title: `Review ${x.analyte_name} of ${x.sample_code}`, okText: 'Resolve', intro: `${d.entry.entry_code} was corrected after this result used it. Say what the correction means for the result: it stands (and why), or what was done (re-tested, a new COA version). Someone who did not correct the entry resolves it.`,
        fields: [{ name: 'note', label: 'Review', type: 'textarea', required: true }], submit: (v) => resolveFlag(x.flag_id, v.note) });
      if (m) { toast('Flag resolved.'); reload(); }
    } },
  ], [d, dialogs, toast, reload]);

  if (error && !d) return <><PageHeader title="Logbook entry" /><div className="card err">{error.message}</div></>;
  if (!d) return <><PageHeader title="Logbook entry" /><div className="loading">Loading…</div></>;
  const e = d.entry;
  const own = e.created_by === d.me;

  async function approve() {
    const r = await dialogs.sign({ what: `QA approval of ${e.entry_code}`, meaning: 'Approved by', needReason: false, submit: ({ signature }) => approveEntries([e.id], signature) });
    if (r) { toast(`${e.entry_code} approved.`); reload(); }
  }
  async function ret() {
    const m = await dialogs.form({ title: `Return ${e.entry_code}`, okText: 'Return it', intro: 'The person who recorded it corrects it (with a reason); it then comes back to QA.',
      fields: [{ name: 'note', label: 'What needs correcting', type: 'textarea', required: true }], submit: (v) => returnEntry(e.id, v.note) });
    if (m) { toast('Returned for correction.'); reload(); }
  }
  async function voidIt() {
    const m = await dialogs.form({ title: `Void ${e.entry_code}`, okText: 'Continue', intro: 'Only for an entry made in error (wrong logbook, wrong unit). It stays in the logbook, marked Voided. An entry used by a result cannot be voided: correct it instead.',
      fields: [{ name: 'why', label: 'Why it is voided', type: 'textarea', required: true }] });
    if (!m) return;
    const go = (signature, reason) => voidEntry(e.id, { void_reason: m.why, reason: reason || 'Recorded in error', signature });
    if (e.signing === 'Signature') {
      const r = await dialogs.sign({ what: `Void ${e.entry_code}`, meaning: 'Changed by', needReason: true, defaultReason: m.why, submit: ({ signature, reason }) => go(signature, reason) });
      if (r) { toast('Entry voided.'); reload(); }
    } else { try { await go(null, m.why); toast('Entry voided.'); reload(); } catch (err) { toast(err.message, 'err'); } }
  }
  async function giveReason() {
    const m = await dialogs.form({ title: `Reason for ${e.entry_code}`, okText: 'Continue', intro: `${(e.problems || []).join('; ')}. Say what happened and what was done about it (the readings stay as the sensor sent them).`,
      fields: [{ name: 'why', label: 'Reason', type: 'textarea', required: true }] });
    if (!m) return;
    const r = await dialogs.sign({ what: `Reason for ${e.entry_code}`, meaning: 'Changed by', needReason: false, sign: e.signing === 'Signature',
      submit: ({ signature, reason }) => giveEntryReason(e.id, { failure_reason: m.why, reason: reason || 'Reason given for a sensor excursion', signature }) });
    if (r) { toast('Reason recorded.'); reload(); }
  }
  async function correct() {
    const inputs = d.fields.filter((f) => f.field_type !== 'Calculated');
    let lots = []; let eqs = [];
    if (inputs.some((f) => ['Lot', 'Equipment'].includes(f.field_type))) {
      const lb = await getLogbook(e.logbook_id).catch(() => null);
      if (lb) { lots = lb.opts.lots; eqs = lb.opts.equipment; }
    }
    const fields = [
      { name: '__at', label: 'When (YYYY-MM-DD HH:MM)', value: loc(e.entry_local) },
      ...inputs.map((f) => {
        const v = (e.entry_values || {})[f.field_key];
        if (f.field_type === 'Choice') return { name: f.field_key, label: f.label, type: 'select', options: f.choices || [], value: v ?? '' };
        if (f.field_type === 'Pass/Fail') return { name: f.field_key, label: f.label, type: 'select', options: ['Pass', 'Fail'], value: v ?? '' };
        if (f.field_type === 'Lot') return { name: f.field_key, label: f.label, type: 'select', options: lots.map((x) => ({ value: x.id, label: `${x.lot_code} ${x.item_name}` })), value: v ?? '' };
        if (f.field_type === 'Equipment') return { name: f.field_key, label: f.label, type: 'select', options: eqs.map((x) => ({ value: x.id, label: `${x.equipment_code} ${x.equipment_name}` })), value: v ?? '' };
        return { name: f.field_key, label: f.label + (f.unit ? ` (${f.unit})` : ''), value: v ?? '' };
      }),
      { name: '__reason_fail', label: 'Reason (when it fails)', type: 'textarea', value: e.failure_reason || '' },
    ];
    const m = await dialogs.form({ title: `Correct ${e.entry_code}`, okText: 'Continue', wide: true,
      intro: `The old values stay in the audit trail. ${e.status === 'Approved' ? 'It is approved: the correction sends it back to QA.' : ''} Calculated values and the result are worked out again.`, fields });
    if (!m) return;
    const values = {}; for (const f of inputs) if (m[f.field_key] !== '') values[f.field_key] = m[f.field_key];
    const r = await dialogs.sign({ what: `Correct ${e.entry_code}`, meaning: 'Changed by', needReason: true, sign: e.signing === 'Signature',
      submit: ({ signature, reason }) => correctEntry(e.id, { values, entry_at: m.__at, failure_reason: m.__reason_fail, reason, signature }) });
    if (r) { toast('Entry corrected.'); reload(); }
  }

  const actions = <>
    {e.sensor && d.can_record && needsReason(e) && e.sensor.kind !== 'Hour' && <button type="button" className="btn primary" onClick={giveReason}>Give the reason…</button>}
    {d.can_review && e.status === 'Recorded' && e.review_route === 'Logbook' && !own && !needsReason(e) && <button type="button" className="btn primary" onClick={approve}>Approve (QA)</button>}
    {d.can_review && ['Recorded', 'Approved'].includes(e.status) && e.review_route === 'Logbook' && !own && <button type="button" className="btn" onClick={ret}>Return for correction</button>}
    {d.can_record && e.status !== 'Voided' && !e.sensor && <button type="button" className="btn" onClick={correct}>Correct…</button>}
    {(d.can_record || d.can_review) && e.status !== 'Voided' && <button type="button" className="btn ghost" onClick={voidIt}>Void…</button>}
  </>;
  const subj = e.equipment_id ? <a href={'#/equipment/' + e.equipment_id}>{e.equipment_code} {e.equipment_name}</a>
    : e.lot_id ? <a href={'#/inventory/lots/' + e.lot_id}>{e.lot_code} {e.lot_name || ''}</a>
      : e.sample_id ? <a href={'#/samples/' + e.sample_id}>{e.sample_code}</a> : '-';
  const statusText = e.status === 'Approved' ? (e.approved_in_batch_code ? `Reviewed in ${e.approved_in_batch_code}` : `Approved by ${e.approved_by_name || ''} ${dt(e.approved_at)}`)
    : e.status === 'Recorded' ? (e.review_route === 'Batch' ? 'Recorded: reviewed in the batch that uses it' : `Recorded: QA approves it by ${e.review_due}${e.overdue ? ' (overdue)' : ''}`)
      : e.status === 'Returned' ? `Returned by QA: ${e.returned_note || ''}` : `Voided: ${e.void_reason || ''}`;

  return <>
    <PageHeader title={e.entry_code} subtitle={`Entry in ${e.logbook_code} ${e.logbook_name} (design v${e.version_no})`} actions={actions} audit={{ kind: 'logbook_entry', id: e.id }} />
    <div className="card"><div className="lb-facts">
      <div><b>Logbook</b><a href={'#/logbooks/' + e.logbook_id}>{e.logbook_code} {e.logbook_name}</a></div>
      <div><b>When</b>{e.sensor ? sensorWhen(e) : loc(e.entry_local)}</div>
      <div><b>About</b>{subj}</div>
      <div><b>Result</b>{e.result ? <span className={e.result === 'Fail' ? 'short' : ''}>{e.result}</span> : 'No limits'}</div>
      <div><b>Recorded by</b>{e.recorded_by_name}{e.recorded_signature_id ? ' (signed)' : ''}</div>
      <div><b>Status</b>{statusText}</div>
      {e.valid_until && <div><b>Usable until</b>{dt(e.valid_until)}{e.expired ? ' (expired)' : ''}</div>}
      {e.created_lot_id && <div><b>Lot made</b><a href={'#/inventory/lots/' + e.created_lot_id}>{e.created_lot_code}</a></div>}
      {d.review && <div><b>QA review</b>{d.review.by_name} {dt(d.review.created_at)}{d.review.comment ? ': ' + d.review.comment : ''}</div>}
    </div></div>
    {e.sensor && <SensorBox e={e} />}
    {e.result === 'Fail' && <div className="lb-failbox">
      <b>Outside its limit:</b> {(e.problems || []).join('; ')}<br />
      <b>Reason:</b> {e.failure_reason || (needsReason(e) ? 'not given yet: someone who records in this logbook gives it' : '')}
      {d.failure && e.sensor && <div className="lb-note" style={{ marginTop: 6 }}>Any batch step that used {e.equipment_code} from {dt(d.failure.window_start)} {d.failure.window_end ? 'to ' + dt(d.failure.window_end) : 'until the sensor is back inside its limits'} (this period, from the sensor's readings) is flagged in QC Review.</div>}
      {d.failure && !e.sensor && <div className="lb-note" style={{ marginTop: 6 }}>{e.equipment_id ? `Any batch step that used ${e.equipment_code} from ${dt(d.failure.window_start)} (the last passing entry before it) ${d.failure.window_end ? 'to ' + dt(d.failure.window_end) + ' (the next passing entry)' : 'until the next passing entry (none yet)'} is flagged in QC Review.` : ''}</div>}
    </div>}
    <Section title="Values">
      <table className="lb-vals"><tbody>
        <tr><th>Field</th><th>Value</th><th>Limit</th></tr>
        {d.fields.map((f) => {
          const v = (e.display || {})[f.field_key]; const lim = d.limits[f.field_key] || {}; const lt = limText({ lo: lim.lo ?? null, hi: lim.hi ?? null });
          const n = Number(v); const out = lt && v !== undefined && ((lim.lo !== null && lim.lo !== undefined && n < Number(lim.lo)) || (lim.hi !== null && lim.hi !== undefined && n > Number(lim.hi)));
          const cls = lt ? (out || (f.field_type === 'Pass/Fail' && v === 'Fail') ? 'out' : 'in') : f.field_type === 'Pass/Fail' ? (v === 'Fail' ? 'out' : 'in') : '';
          return <tr key={f.field_key}>
            <td>{f.label}{f.field_type === 'Calculated' && <> <span className="lb-note">= {f.formula || ''}</span></>}{f.publish && <> <span className="lb-note">(published on the lot)</span></>}</td>
            <td className={cls}>{showVal(f, v)}</td><td>{lt}</td>
          </tr>;
        })}
      </tbody></table>
    </Section>
    {flags.length > 0 && <Section title="Batches flagged" help="Batch steps that used the equipment while this entry was failing. The reviewer accepts each flag with a justification in QC Review.">
      <ReadGrid rows={flags} columns={FLAG_COLS} keyField="key" /></Section>}
    {excursions.length > 0 && <Section title="Stability studies in this chamber" help="Study material stored in the chamber at the time of the excursion.">
      <ReadGrid rows={excursions} columns={EXC_COLS} keyField="key" /></Section>}
    {uses.length > 0 && <Section title="Used by results" help="Results whose calculation used a value of this entry (its lot was scanned at the bench), or that weighed this aliquot. A correction flags them for review.">
      <ReadGrid rows={uses} columns={useCols} keyField="key" /></Section>}
  </>;
}
