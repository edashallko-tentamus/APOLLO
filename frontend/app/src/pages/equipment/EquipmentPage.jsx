// The equipment page: status, tag-out and tag-in / release, recording work, calibrations, qualifications, maintenance
// schedules, the maintenance log, documents, out of service / retire, and transfer to another lab. Every action is signed.
import { useMemo, useState } from 'react';
import {
  equipmentAction, equipmentDocUrl, equipmentMe, getEquipment, saveCalibration, saveDocuments, saveQualification, saveSchedules,
  serviceSuppliers, tagIn, transferOptions,
} from '../../api/equipment.js';
import Badge from '../../components/Badge.jsx';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import EditableGrid from '../../components/EditableGrid.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import { usePrintLabels } from '../../components/labels/usePrintLabels.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { plural } from '../../lib/format.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { EquipmentLogbooksCard } from '../logbooks/LogbookCards.jsx';
import SensorEquipmentCard from '../sensors/SensorEquipmentCard.jsx';
import { availCls, d8, dLocal, dt, Failed, inactiveRow, Loading, signed, today } from './shared.jsx';
import { Button, Card } from 'react-bootstrap';

const REASONS = ['Maintenance', 'Repair', 'Calibration', 'Qualification'];
const EVENT_TYPES = ['Maintenance', 'Repair', 'Service visit', 'Check', 'Note'];
const QUAL_TYPES = ['IQ', 'OQ', 'PQ', 'IQ/OQ', 'IQ/OQ/PQ', 'Requalification'];
const DOC_TYPES = ['Calibration certificate', 'Service report', 'Qualification report', 'Manual', 'Photo', 'Error log', 'Invoice', 'Checklist', 'Other'];
const MAX_FILE = 3.5 * 1024 * 1024;
const fileField = (label = 'Certificate or report (optional)') => ({ name: 'file', label, type: 'file', accept: 'application/pdf,image/png,image/jpeg',
  help: 'PDF or image, up to 3.5 MB. Stored unchanged with its SHA-256 fingerprint.' });

async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer()); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function filePayload(file) {
  if (!file) return null;
  if (file.size > MAX_FILE) throw new Error('The file is larger than 3.5 MB. Save a smaller PDF and try again.');
  return { file_name: file.name, mime_type: file.type || 'application/pdf', content_base64: await fileToBase64(file) };
}
async function vendorOptions() {
  try { return (await serviceSuppliers()).filter((x) => x.supplier_record_status === 'Active' && x.supplier_type !== 'Manufacturer').map((x) => x.supplier_name); } catch (_) { return []; }
}
const withoutFile = ({ file, ...rest }) => rest; // eslint-disable-line no-unused-vars

function StatCard({ label, text, cls }) { return <div className={`statcard ${cls || ''}`}><span>{label}</span><b>{text}</b></div>; }
function Kv({ pairs }) {
  return <dl className="kv">{pairs.filter(Boolean).map(([k, v]) => <Pair key={k} k={k} v={v} />)}</dl>;
}
const Pair = ({ k, v }) => <><dt>{k}</dt><dd>{v === null || v === undefined || v === '' ? '—' : v}</dd></>;

const LOG_COLS = [
  { field: 'date', title: 'Date', type: 'readonly', width: 95 }, { field: 'what', title: 'What', type: 'readonly', width: 170 },
  { field: 'ref', title: 'Record', type: 'readonly', width: 100 }, { field: 'detail', title: 'Detail', type: 'readonly', width: 430 },
  { field: 'who', title: 'By', type: 'readonly', width: 230 }];
const TRANSFER_COLS = [
  { field: 'created_at', title: 'When', type: 'readonly', width: 140, format: dt }, { field: 'from_code', title: 'From', type: 'readonly', width: 70 },
  { field: 'to_code', title: 'To', type: 'readonly', width: 70 }, { field: 'by_name', title: 'By', type: 'readonly', width: 150 }, { field: 'notes', title: 'Notes', type: 'readonly', width: 300 }];
const SCHEDULE_COLS = [
  { field: 'task_name', title: 'Task', required: true, width: 230 },
  { field: 'interval_count', title: 'Every', type: 'int', min: 1, required: true, width: 60 },
  { field: 'interval_unit', title: 'Unit', type: 'select', options: ['days', 'weeks', 'months', 'years'], required: true, width: 80 },
  { field: 'next_due_date', title: 'Next due', type: 'date', required: true, width: 100, format: d8, cellClass: (r) => (r.days_left === undefined || r.days_left === null ? '' : r.days_left <= 0 ? 'cbad' : r.days_left <= r.alert_days ? 'cwarn' : '') },
  { field: 'alert_days', title: 'Warn (days)', type: 'int', min: 0, width: 75 },
  { field: 'tag_out_when_due', title: 'Tag out when due', type: 'bool', width: 90 },
  { field: 'instructions', title: 'Instructions / SOP', width: 220 },
  { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 80 },
];
const QUAL_COLS = [
  { field: 'qualification_code', title: 'Record', type: 'readonly', width: 90 }, { field: 'qualification_type', title: 'Type', type: 'readonly', width: 110 },
  { field: 'performed_date', title: 'Done', type: 'date', width: 100, format: d8 }, { field: 'result', title: 'Result', type: 'select', options: ['Pass', 'Fail'], width: 70 },
  { field: 'performed_by', title: 'Done by', type: 'readonly', width: 170 }, { field: 'protocol_reference', title: 'Protocol', width: 130 },
  { field: 'tag_code', title: 'Under tag', type: 'readonly', width: 95 }, { field: 'notes', title: 'Notes', width: 200 },
  { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 80 }];
const newSchedule = () => ({ interval_unit: 'months', interval_count: 1, alert_days: 7, tag_out_when_due: true, status: 'Active' });

// The maintenance log: tags, work records, calibrations and qualifications on one timeline
function buildLog(d) {
  return [
    ...d.tags.map((t) => ({ when: t.tagged_out_at, date: dLocal(t.tagged_out_at), what: `Tagged out (${t.reason})`, ref: t.tag_code, detail: t.description || '', who: t.tagged_out_name + (t.source !== 'Manual' ? ' (automatic)' : '') })),
    ...d.tags.filter((t) => t.tagged_in_at).map((t) => ({ when: t.tagged_in_at, date: dLocal(t.tagged_in_at), what: t.tag_in_meaning === 'Released by' ? 'Released to service' : 'Tagged back in', ref: t.tag_code, detail: `${t.reason}`, who: t.tagged_in_name })),
    ...d.events.map((v) => ({ when: v.created_at, date: d8(v.performed_date), what: v.event_type, ref: v.event_code, detail: v.summary + (v.task_name ? ` [schedule: ${v.task_name}]` : '') + (v.tag_code ? ` [${v.tag_code}]` : ''), who: v.performed_by + (v.recorded_by !== v.performed_by ? ` (recorded by ${v.recorded_by})` : ''), inactive: v.status === 'Inactive' })),
    ...d.calibrations.map((k) => ({ when: k.created_at, date: d8(k.performed_date), what: `Calibration: ${k.result}`, ref: k.calibration_code, detail: `Expires ${d8(k.expiration_date)}${k.certificate_number ? ', certificate ' + k.certificate_number : ''}`, who: k.performed_by, inactive: k.status === 'Inactive' })),
    ...d.qualifications.map((q) => ({ when: q.created_at, date: d8(q.performed_date), what: `${q.qualification_type}: ${q.result}`, ref: q.qualification_code, detail: q.protocol_reference || '', who: q.performed_by, inactive: q.status === 'Inactive' })),
    ...d.transfers.map((x) => ({ when: x.created_at, date: dLocal(x.created_at), what: 'Transferred', ref: '', detail: `${x.from_code} to ${x.to_code}${x.notes ? ': ' + x.notes : ''}`, who: x.by_name })),
  ].sort((a, b) => String(b.when).localeCompare(String(a.when)));
}
const logRow = (r) => (r.inactive ? 'mutedrow' : '');

export default function EquipmentPage({ params: [id] }) {
  const { site } = useSession();
  const dialogs = useDialogs();
  const toast = useToast();
  const printLabels = usePrintLabels();
  const { data, error, reload } = useApi(() => Promise.all([getEquipment(id), equipmentMe()]), [id]);
  const [busy, setBusy] = useState(false);
  const [d, me] = data || [];
  const e = d?.eq;
  const siteId = site?.id;
  const openDoc = (docId) => window.open(equipmentDocUrl(docId, siteId), '_blank');

  const calCols = useMemo(() => (!me ? null : [
    { field: 'calibration_code', title: 'Record', type: 'readonly', width: 95 },
    { field: 'performed_date', title: 'Calibrated', type: 'date', width: 100, editable: () => me.can_release, format: d8 },
    { field: 'expiration_date', title: 'Expires', type: 'date', width: 100, editable: () => me.can_release, format: d8 },
    { field: 'result', title: 'Result', type: 'select', options: ['Pass', 'Fail'], width: 70, editable: () => me.can_release, cellClass: (r) => (r.result === 'Fail' ? 'cbad' : '') },
    { field: 'performed_by', title: 'Done by', type: 'readonly', width: 170 },
    { field: 'certificate_number', title: 'Certificate #', width: 120, editable: () => me.can_calibrate },
    { field: 'docs', title: 'Certificate', type: 'link', width: 140, format: (v) => (v && v.length ? v[0].title : ''), href: (r) => (r.docs && r.docs.length ? '#' : null), onClick: (r) => openDoc(r.docs[0].id) },
    { field: 'tag_code', title: 'Under tag', type: 'readonly', width: 95 },
    { field: 'recorded_by', title: 'Recorded by', type: 'readonly', width: 130 },
    { field: 'notes', title: 'Notes', width: 200, editable: () => me.can_calibrate },
    { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 80, editable: () => me.can_release, help: 'Inactive = withdrawn (entered in error); needs the release permission' },
  ]), [me, siteId]); // eslint-disable-line react-hooks/exhaustive-deps -- openDoc follows siteId
  const docCols = useMemo(() => [
    { field: 'file_name', title: 'File', type: 'link', width: 200, href: () => '#', onClick: (r) => openDoc(r.id) },
    { field: 'title', title: 'Title', width: 220 }, { field: 'doc_type', title: 'Type', type: 'select', options: DOC_TYPES, width: 160 },
    { field: 'linked', title: 'For', type: 'readonly', width: 110, compute: (r) => r.calibration_code || r.qualification_code || r.event_code || r.tag_code || '' },
    { field: 'uploaded_by', title: 'Uploaded', type: 'readonly', width: 190, format: (v, r) => `${v} ${dt(r.created_at)}` },
    { field: 'sha256', title: 'SHA-256', type: 'readonly', width: 110, format: (v) => (v ? v.slice(0, 12) + '…' : '') },
    { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 80 }], [siteId]); // eslint-disable-line react-hooks/exhaustive-deps
  const log = useMemo(() => (d ? buildLog(d) : []), [d]);
  const code = e?.equipment_code;
  const signCal = useMemo(() => (rows) => ({ meaning: 'Changed by', action: `Calibration records of ${code}: ${rows.length} change(s)` }), [code]);
  const signSched = useMemo(() => (rows) => ({ meaning: 'Changed by', action: `Maintenance schedules of ${code}: ${rows.length} change(s)` }), [code]);
  const signQual = useMemo(() => (rows) => ({ meaning: 'Changed by', action: `Qualification records of ${code}: ${rows.length} change(s)` }), [code]);
  const signDocs = useMemo(() => (rows) => ({ meaning: 'Changed by', action: `Documents of ${code}: ${rows.length} change(s)` }), [code]);

  if (error && !data) return <Failed error={error} />;
  if (!data) return <Loading />;

  const retired = e.admin_status === 'Retired';
  const openTags = d.tags.filter((t) => !t.tagged_in_at);
  const calText = !e.calibration_required ? 'Not required' : !e.cal_id ? 'Deficient: no calibration on record'
    : e.cal_result === 'Fail' ? 'Deficient: last calibration failed' : e.cal_days_left < 0 ? `Deficient: expired ${d8(e.cal_expires)}`
      : `${e.calibration_status}: expires ${d8(e.cal_expires)} (${plural(e.cal_days_left, 'day')})`;
  const calClass = { Deficient: 'deficient', Alert: 'calert', Conforms: 'conforms' }[e.calibration_status] || '';
  const avText = e.availability === 'Tagged out' ? `Tagged out: ${e.tagged_for}` : e.availability;
  const mText = e.maintenance_due ? `${e.maintenance_status}: ${e.maintenance_task} (${d8(e.maintenance_due)})` : 'No schedule';
  const name = `${e.equipment_code} ${e.equipment_name}`;
  const send = (action, body) => (reason, signature) => equipmentAction(id, action, { ...body, reason: reason || body.reason, signature });
  const tagOpts = (reason) => openTags.filter((t) => !reason || t.reason === reason).map((t) => ({ value: t.id, label: `${t.tag_code} (${t.reason})` }));

  async function recordWork(tagId) {
    const tag = d.tags.find((t) => t.id === tagId);
    const v = await dialogs.form({ title: `Record ${tag ? tag.reason.toLowerCase() : 'maintenance or a check'}: ${e.equipment_code}`, okText: 'Next: sign',
      intro: 'What was done, when and by whom. Leave "Done by a company" empty if you did it yourself. Scheduled work moves that schedule\'s next due date on.',
      fields: [
        { name: 'event_type', label: 'Kind', type: 'select', options: EVENT_TYPES, value: tag ? (tag.reason === 'Repair' ? 'Repair' : 'Maintenance') : 'Maintenance', blank: false },
        { name: 'performed_date', label: 'Date done', type: 'date', value: today(), required: true },
        { name: 'summary', label: 'What was done', type: 'textarea', required: true },
        { name: 'performed_by_vendor', label: 'Done by a company (from the supplier list; empty if you did it)', type: 'select', options: await vendorOptions() },
        { name: 'tag_id', label: 'Under tag', type: 'select', options: tagOpts(), value: tagId || '' },
        { name: 'schedule_id', label: 'For scheduled task', type: 'select', options: d.schedules.filter((s) => s.status === 'Active').map((s) => ({ value: s.id, label: `${s.task_name} (due ${d8(s.next_due_date)})` })), value: tag && tag.schedule_id ? tag.schedule_id : '' },
      ] });
    if (!v) return false;
    return signed(dialogs, { what: `${v.event_type} on ${name}: ${v.summary}`, meaning: 'Performed by', needReason: false }, send('events', { row: v }));
  }
  async function recordCalibration(tagId) {
    const calTag = tagId || (tagOpts('Calibration')[0] || {}).value || '';
    const v = await dialogs.form({ title: `Record calibration: ${e.equipment_code}`, okText: 'Next: sign', wide: true,
      intro: `${e.calibration_interval_months ? `Leave the expiry empty to use the interval (${plural(e.calibration_interval_months, 'month')}).` : 'This equipment has no interval: give the expiry date.'} Leave "Done by a company" empty if you did it yourself.`,
      fields: [
        { name: 'performed_date', label: 'Calibrated on', type: 'date', value: today(), required: true },
        { name: 'result', label: 'Result', type: 'select', options: ['Pass', 'Fail'], value: 'Pass', blank: false },
        { name: 'expiration_date', label: 'Expires', type: 'date' },
        { name: 'performed_by_vendor', label: 'Done by a company (from the supplier list; empty if you did it)', type: 'select', options: await vendorOptions() },
        { name: 'certificate_number', label: 'Certificate number' },
        { name: 'tag_id', label: 'Under tag', type: 'select', options: tagOpts(), value: calTag },
        { name: 'notes', label: 'Notes' },
        fileField('Calibration certificate (optional)'),
      ] });
    if (!v) return false;
    const file = await filePayload(v.file);
    return signed(dialogs, { what: `Calibration of ${name} on ${v.performed_date}: ${v.result}`, meaning: 'Recorded by', needReason: false },
      (reason, signature) => equipmentAction(id, 'calibrations', { row: withoutFile(v), file, signature }));
  }
  async function recordQualification(tagId) {
    const v = await dialogs.form({ title: `Record qualification: ${e.equipment_code}`, okText: 'Next: sign', wide: true,
      fields: [
        { name: 'qualification_type', label: 'Qualification', type: 'select', options: QUAL_TYPES, value: 'IQ/OQ/PQ', blank: false },
        { name: 'performed_date', label: 'Done on', type: 'date', value: today(), required: true },
        { name: 'result', label: 'Result', type: 'select', options: ['Pass', 'Fail'], value: 'Pass', blank: false },
        { name: 'performed_by_vendor', label: 'Done by a company (from the supplier list; empty if you did it)', type: 'select', options: await vendorOptions() },
        { name: 'protocol_reference', label: 'Protocol / report reference' },
        { name: 'tag_id', label: 'Under tag', type: 'select', options: tagOpts(), value: tagId || (tagOpts('Qualification')[0] || {}).value || '' },
        { name: 'notes', label: 'Notes' },
        fileField('Qualification report (optional)'),
      ] });
    if (!v) return false;
    const file = await filePayload(v.file);
    return signed(dialogs, { what: `${v.qualification_type} of ${name} on ${v.performed_date}: ${v.result}`, meaning: 'Recorded by', needReason: false },
      (reason, signature) => equipmentAction(id, 'qualifications', { row: withoutFile(v), file, signature }));
  }

  async function act(key) {
    if (busy) return;
    setBusy(true);
    try {
      let done = null;
      if (key === 'tagout') {
        const v = await dialogs.form({ title: `Tag out ${e.equipment_code} ${e.equipment_name}`, okText: 'Next: sign',
          intro: 'It becomes unavailable until it is tagged back in. After repair, calibration or qualification, someone with the release permission who did not tag it out or do the work must release it.',
          fields: [{ name: 'reason_code', label: 'Reason', type: 'select', options: REASONS, required: true }, { name: 'description', label: 'What is wrong / why', type: 'textarea' }] });
        if (!v) return;
        done = await signed(dialogs, { what: `Tag out ${name} for ${v.reason_code.toLowerCase()}${v.description ? ': ' + v.description : ''}`, meaning: 'Tagged out by', needReason: false }, send('tag-out', v));
        if (done) toast('Tagged out and signed.');
      }
      if (key === 'work') { done = await recordWork(null); if (done) toast('Recorded and signed.'); }
      if (key === 'calib') { done = await recordCalibration(null); if (done) toast('Calibration recorded and signed.'); }
      if (key === 'qual') { done = await recordQualification(null); if (done) toast('Qualification recorded and signed.'); }
      if (key === 'doc') {
        const v = await dialogs.form({ title: `Upload a document: ${e.equipment_code}`, okText: 'Next: sign',
          fields: [{ name: 'doc_type', label: 'Kind', type: 'select', options: DOC_TYPES, value: 'Service report', blank: false }, { name: 'title', label: 'Title' },
            { name: 'tag_id', label: 'For tag', type: 'select', options: tagOpts() }, fileField('File')] });
        if (!v) return;
        if (!v.file) { toast('Choose the file to upload.', 'err'); return; }
        const payload = { ...(await filePayload(v.file)), ...withoutFile(v) };
        done = await signed(dialogs, { what: `Document ${v.file.name} for ${name}`, meaning: 'Uploaded by', needReason: false }, send('documents', { file: payload }));
        if (done) toast('Uploaded and signed.');
      }
      if (key === 'oos' || key === 'ins' || key === 'retire') {
        const to = { oos: 'Out of Service', ins: 'In Service', retire: 'Retired' }[key];
        done = await signed(dialogs, { what: `${name}: ${to}${key === 'retire' ? ' (it keeps its history; it can no longer be tagged or calibrated)' : ''}`, meaning: 'Changed by' }, send('status', { admin_status: to }));
        if (done) toast(`${to}: saved and signed.`);
      }
      if (key === 'transfer') {
        const labs = await transferOptions();
        if (!labs.length) { toast('There is no other lab to transfer to.', 'err'); return; }
        const v = await dialogs.form({ title: `Transfer ${e.equipment_code} to another lab`, okText: 'Next: sign',
          intro: 'Its whole history goes with it. It arrives tagged out for Qualification, and the receiving lab releases it after qualifying it. Your lab\'s owners, department and location are cleared; name the receiving lab\'s department and responsible group.',
          fields: [{ name: 'to_site_id', label: 'To lab', type: 'select', options: labs.map((s) => ({ value: s.id, label: `${s.site_code} ${s.site_name}` })), required: true },
            { name: 'department_id', label: 'Department at the receiving lab', type: 'select', options: labs.flatMap((s) => s.departments.map((x) => ({ value: x.id, label: `${s.site_code}: ${x.department_code} ${x.department_name}` }))), required: true },
            { name: 'owner_group_id', label: 'Responsible group at the receiving lab', type: 'select', options: labs.flatMap((s) => s.groups.map((g) => ({ value: g.id, label: `${s.site_code}: ${g.group_name}` }))), required: true },
            { name: 'notes', label: 'Notes' }] });
        if (!v) return;
        const lab = labs.find((s) => s.id === v.to_site_id);
        done = await signed(dialogs, { what: `Transfer ${name} to ${lab.site_code}`, meaning: 'Transferred by', needReason: false }, send('transfer', v));
        if (done) { toast(`Transferred to ${lab.site_code}. It is now in their register, tagged out for qualification.`); window.location.hash = '#/equipment'; return; }
      }
      if (key.startsWith('work:')) { done = await recordWork(key.slice(5)); if (done) toast('Recorded and signed.'); }
      if (key.startsWith('calib:')) { done = await recordCalibration(key.slice(6)); if (done) toast('Calibration recorded and signed.'); }
      if (key.startsWith('qual:')) { done = await recordQualification(key.slice(5)); if (done) toast('Qualification recorded and signed.'); }
      if (key.startsWith('in:')) {
        const t = d.tags.find((x) => x.id === key.slice(3));
        const release = t.reason !== 'Maintenance';
        let body = {};
        if (!release && !Number(t.work_count)) {
          const v = await dialogs.form({ title: `Tag ${e.equipment_code} back in`, okText: 'Next: sign', intro: 'Say what was done (it goes in the maintenance log).',
            fields: [{ name: 'summary', label: 'What was done', type: 'textarea', required: true }, { name: 'performed_date', label: 'Date done', type: 'date', value: today(), required: true }] });
          if (!v) return; body = v;
        }
        done = await signed(dialogs, { what: `${release ? 'Release to service' : 'Tag back in'}: ${name} (${t.tag_code}, ${t.reason})`, meaning: release ? 'Released by' : 'Returned to service by', needReason: false },
          (reason, signature) => tagIn(t.id, { ...body, reason: reason || body.reason, signature }));
        if (done) toast(release ? 'Released to service and signed.' : 'Tagged back in and signed.');
      }
      if (done) reload();
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  }

  const Btn = ({ k, label, show, primary }) => (show ? <Button type="button" variant={primary ? 'primary' : 'outline-secondary'} disabled={busy} onClick={() => act(k)}>{label}</Button> : null);

  function TagCard({ t }) {
    const release = t.reason !== 'Maintenance';
    const workDone = Number(t.work_count) > 0;
    const needCal = t.reason === 'Calibration' && !Number(t.passing_calibrations);
    const needQual = t.reason === 'Qualification' && !Number(t.passing_qualifications);
    const canIn = release ? me.can_release && !t.i_worked_on_it && workDone && !needCal && !needQual : me.can_tag;
    const hint = release
      ? (!workDone || needCal || needQual ? `Next: record the ${needCal ? 'passing calibration' : needQual ? 'passing qualification' : 'work done'}, then someone with the release permission who did not tag it out or do the work releases it.`
        : t.i_worked_on_it ? 'You tagged it out or did or recorded the work, so someone else must release it.' : me.can_release ? 'Work recorded: ready for your release.' : 'Work recorded: waiting for release by QA (equipment.release).')
      : 'Record what was done and tag it back in (the summary can be typed when tagging in).';
    return (
      <div className="tagcard">
        <h3>{t.tag_code}: tagged out for {t.reason.toLowerCase()}{t.source !== 'Manual' ? ` (automatic: ${t.source.toLowerCase()})` : ''}</h3>
        <div>{t.description || t.task_name || ''}</div>
        <div className="help">Tagged out {dt(t.tagged_out_at)} by {t.tagged_out_name} · Work records: {Number(t.work_count)}</div>
        <div className="lrow">
          <Btn k={'work:' + t.id} label="Record work" show={me.can_tag && !release} />
          <Btn k={'calib:' + t.id} label="Record calibration" show={release && t.reason === 'Calibration' && me.can_calibrate} />
          <Btn k={'qual:' + t.id} label="Record qualification" show={release && t.reason === 'Qualification' && me.can_calibrate} />
          <Btn k={'work:' + t.id} label="Record repair" show={release && t.reason === 'Repair' && me.can_tag} />
          <Btn k={'in:' + t.id} label={release ? 'Release to service' : 'Tag back in'} show={canIn} primary />
          <span className="help">{hint}</span>
        </div>
      </div>
    );
  }

  const canDocs = me.can_edit || me.can_tag || me.can_calibrate;
  return <>
    <div className="eyebrow">{e.equipment_code} · {e.site_code} · {e.type_name}</div>
    <PageHeader title={e.equipment_name} audit={{ kind: 'equipment', id }}
      subtitle={<><Badge status={e.admin_status} /> <span className={availCls(e.availability)}>{avText}</span></>}
      actions={<>
        <Button variant="light" href="#/equipment">All equipment</Button>{' '}
        <Button type="button" variant="outline-secondary" title="Barcode label with the name and calibration expiry (Dymo, 1 x 2 1/8 in.)" onClick={() => printLabels('equipment', [e.id])}>Print label</Button>
        {me.can_edit && <>{' '}<Button variant="outline-secondary" href={`#/equipment/new?from=${e.id}`}>Duplicate</Button> <Button variant="primary" href={`#/equipment/${e.id}/edit`}>Edit</Button></>}
      </>} />
    <div className="actbar">
      <Btn k="tagout" label="Tag out" show={me.can_tag && !retired} primary />
      <Btn k="work" label="Record maintenance or a check" show={me.can_tag && !retired} />
      <Btn k="calib" label="Record calibration" show={me.can_calibrate && !retired} />
      <Btn k="qual" label="Record qualification" show={me.can_calibrate && !retired} />
      <Btn k="doc" label="Upload document" show={canDocs && !retired} />
      <Btn k="oos" label="Take out of service" show={me.can_edit && e.admin_status === 'In Service'} />
      <Btn k="ins" label="Put back in service" show={me.can_edit && e.admin_status !== 'In Service'} />
      <Btn k="retire" label="Retire" show={me.can_edit && !retired} />
      <Btn k="transfer" label="Transfer to another lab" show={me.can_edit && !retired} />
    </div>
    {!Number(e.owner_count) && <div className="alert alert-warning">Nobody is responsible for this equipment (a group was set Inactive or a person left). Edit it and tick a group or person.</div>}
    <div className="statcards">
      <StatCard label="Availability" text={avText} cls={e.availability === 'Tagged out' ? 'deficient' : e.availability === 'Available' ? 'conforms' : ''} />
      <StatCard label="Calibration" text={calText} cls={calClass} />
      <StatCard label="Next maintenance" text={mText} cls={e.maintenance_status === 'Overdue' || e.maintenance_status === 'Due today' ? 'deficient' : e.maintenance_status === 'Due soon' ? 'calert' : ''} />
    </div>
    {openTags.map((t) => <TagCard key={t.id} t={t} />)}
    <div className="cols">
      <Card body><h2>Identity</h2><Kv pairs={[
        ['Equipment ID', <>{e.equipment_code} <span className="help">(given by the system)</span></>], ['Type', e.type_name], ['Department', [e.department_code, e.department_name].filter(Boolean).join(' ')],
        ['Manufacturer', e.manufacturer], ['Model', e.model], ['Serial number', e.serial_number], ['Asset tag', e.asset_tag],
        ['Location', e.location_id ? <><a href={'#/inventory/locations/' + e.location_id}>{e.location_code}</a> <span className="help">{e.location_path || ''}</span></> : ''], ['Location note', e.location_note],
        ['In service since', d8(e.in_service_date)], ['Notes', e.notes]]} /></Card>
      <Card body><h2>Responsible and settings</h2><Kv pairs={[
        ['Responsible', d.owners.length ? <span className="ownerchips">{d.owners.map((o, i) => <span key={i} className={o.user_id ? 'person' : ''}>{o.group_name || o.full_name}</span>)}</span> : <b className="bad">Nobody</b>],
        ['Calibration', e.calibration_required ? `Required${e.calibration_interval_months ? `, every ${plural(e.calibration_interval_months, 'month')}` : ''}; warn ${plural(e.calibration_alert_days, 'day')} before expiry` : 'Not required'],
        ['IQ/OQ/PQ', e.qualification_required ? 'Required' : 'Not required'],
        ['Current calibration', e.cal_id ? `${e.cal_code}: ${d8(e.cal_date)} to ${d8(e.cal_expires)} (${e.cal_result})` : ''],
        ['Status', e.admin_status]]} /></Card>
    </div>
    <SensorEquipmentCard equipmentId={e.id} />
    <EquipmentLogbooksCard equipmentId={e.id} />
    <Section title="Calibration history" help="One record per calibration, newest first; the newest active one is current. Changing an expiry, date or result needs the release permission and someone other than whoever did or recorded it.">
      <EditableGrid rows={d.calibrations} columns={calCols} readOnly={!(me.can_release || me.can_calibrate)} what="calibration records" emptyText="No calibrations recorded."
        rowClass={inactiveRow} sign={signCal} afterSave={reload}
        save={async (rows, reason, signature) => { for (const r of rows) await saveCalibration(r.id, { row: r, reason, signature }); }} />
    </Section>
    <Section title="Maintenance schedules" help={'When each task is next due. "Tag out when due" tags the equipment out automatically on that day. Recording the work moves the next due date on.'}>
      <EditableGrid rows={d.schedules} columns={SCHEDULE_COLS} allowAdd={me.can_edit && !retired} readOnly={!me.can_edit || retired} what="maintenance schedules"
        emptyText="No maintenance scheduled." newRow={newSchedule} rowClass={inactiveRow} sign={signSched} afterSave={reload}
        save={(rows, reason, signature) => saveSchedules(id, { rows, reason, signature })} />
    </Section>
    <Section title="Maintenance log" help="Every tag-out, tag-in, repair, maintenance, check and service visit, newest first. Append-only.">
      <ReadGrid rows={log} columns={LOG_COLS} search emptyText="Nothing recorded yet." rowClass={logRow} />
    </Section>
    <Section title="Qualifications (IQ/OQ/PQ)">
      <EditableGrid rows={d.qualifications} columns={QUAL_COLS} readOnly={!me.can_release} what="qualification records" emptyText="No qualifications recorded."
        rowClass={inactiveRow} sign={signQual} afterSave={reload}
        save={async (rows, reason, signature) => { for (const r of rows) await saveQualification(r.id, { row: r, reason, signature }); }} />
    </Section>
    <Section title="Documents" help="Certificates, service reports, manuals, photos. Kept exactly as uploaded with their SHA-256 fingerprint; set one Inactive instead of deleting it.">
      <EditableGrid rows={d.documents} columns={docCols} readOnly={!canDocs} what="equipment documents" emptyText="No documents uploaded."
        rowClass={inactiveRow} sign={signDocs} afterSave={reload}
        save={(rows, reason, signature) => saveDocuments({ rows, reason, signature })} />
    </Section>
    {d.transfers.length > 0 && <Section title="Transfers between labs"><ReadGrid rows={d.transfers} columns={TRANSFER_COLS} /></Section>}
    <div className="eqfoot">Created {dt(e.created_at)} by {e.created_by_name} · Last changed {dt(e.modified_at)} by {e.modified_by_name} · Audit trail: the clock icon next to the name</div>
  </>;
}
