// The chain of custody, receiving with a signature, and sample photos (0.29.0, migration 051)
//   <CustodyCard orderId custody={data from getCustody} onChange />
//   await openReceiveDialog(dialogs, toast, { order, samples, custody })  // the receive answer, or null
//   await openPhotoDialog(dialogs, sample)                                 // true when photos were added
//   <PhotosCard sample={{ id, sample_code, client_sample_id }} />
import { useState } from 'react';
import * as api from '../../api/custody.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import Modal from '../../components/Modal.jsx';
import Section from '../../components/Section.jsx';
import SmartSelect from '../../components/SmartSelect.jsx';
import { useToast } from '../../components/Toasts.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';

const dt = (v) => (v ? new Date(v).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const localNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const useSiteParam = () => encodeURIComponent(useSession().site?.id || '');

function readB64(file) {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).replace(/^data:[^,]*,/, '')); fr.onerror = rej; fr.readAsDataURL(file); });
}

// ---------------------------------------------------------------- the order's chain of custody
const EVENT_COLUMNS = (s) => [
  { field: 'event_no', title: '#', type: 'readonly', width: 40 },
  { field: 'kind', title: 'What', type: 'readonly', width: 100 },
  { field: 'event_at', title: 'When', type: 'readonly', width: 160, format: dt },
  { field: 'by_name', title: 'By', type: 'readonly', width: 160 },
  { field: 'sample_codes', title: 'Samples', type: 'readonly', width: 220 },
  { field: 'delivered_by', title: 'Delivered by', type: 'readonly', width: 140, format: (v, r) => [v, r.tracking_no].filter(Boolean).join(', ') },
  { field: 'temperature', title: 'Temp. °C', type: 'readonly', width: 80, format: (v) => (v === null || v === undefined ? '' : String(Number(v))) },
  { field: 'thermometer_code', title: 'Thermometer', type: 'readonly', width: 120, help: 'The thermometer that took the temperature (from the equipment register)' },
  { field: 'condition', title: 'Condition', type: 'readonly', width: 120, format: (v, r) => [v, r.seals ? `seals ${r.seals.toLowerCase()}` : ''].filter(Boolean).join(', ') },
  { field: 'document_id', title: 'Document', type: 'link', width: 150, href: (r) => (r.document_id ? `/api/custody/events/${r.id}/file?s=${s}` : null),
    format: (v, r) => (v ? (r.kind === 'Received' ? 'Signed copy (PDF)' : 'Scan') : '') },
  { field: 'note', title: 'Note', type: 'readonly', width: 200 },
];

export function CustodyCard({ orderId, custody: x, onChange }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const s = useSiteParam();
  const [cols] = useState(() => EVENT_COLUMNS(s));
  if (!x) return null;
  if (!x.document) {
    return <Section title="Chain of custody and sample manifest" help="Made when the order is submitted. Print it to travel with the samples.">
      <p className="help">Submit the order to make its chain of custody.</p>
    </Section>;
  }
  async function paper() {
    const done = await dialogs.form({ title: 'Attach the signed paper copy', okText: 'Attach',
      intro: 'The scan of the chain of custody the client (and any courier) signed. It is kept with the order, unchanged.',
      fields: [{ name: 'file', label: 'Scan (PDF, PNG or JPEG)', type: 'file', accept: 'application/pdf,image/png,image/jpeg', required: true }, { name: 'note', label: 'Note' }],
      submit: async (v) => api.attachPaperCopy(orderId, { file_name: v.file.name, mime_type: v.file.type, base64: await readB64(v.file), note: v.note }) });
    if (done) { toast('Paper copy attached.'); onChange?.(); }
  }
  return (
    <Section title={`Chain of custody ${x.document.coc_code}`}
      help={`The chain of custody is also the sample manifest. Print it to travel with the samples: the client and any courier sign "Relinquished by" on paper. Each receipt is signed here ("Receive and sign"), and the receiver's handwritten signature goes into its Received area.${x.required ? ' This lab logs samples only by "Receive and sign".' : ''}`}
      actions={<>
        <a className="btn" id="cocpdf" href={`/api/orders/${orderId}/custody.pdf?s=${s}`} target="_blank" rel="noopener noreferrer">Print chain of custody</a>
        {x.can_receive && <> <button type="button" className="btn" id="cocpaper" onClick={paper}>Attach signed paper copy…</button></>}
      </>}>
      {x.events.length ? <ReadGrid rows={x.events} columns={cols} /> : <p className="help">No receipt signed yet.</p>}
    </Section>
  );
}

// ---------------------------------------------------------------- Receive and sign
const CONDITIONS = ['Acceptable', 'Damaged', 'Temperature excursion', 'Short shipped', 'Leaking', 'Other (see note)'];
export async function openReceiveDialog(dialogs, toast, { order, samples, custody }) {
  if (!samples.length) { toast('Tick the samples being received (only samples still expected).', 'err'); return null; }
  if (custody && !custody.my_signature) {
    await dialogs.confirm('Your signature is not on file', 'Receiving samples signs the chain of custody and places your handwritten signature and title in its Received area. A lab administrator records them in Admin > People and groups (COA signature).', 'OK');
    return null;
  }
  const thermometers = (custody && custody.thermometers) || [];
  const v = await dialogs.form({ title: `Receive ${samples.length} sample${samples.length === 1 ? '' : 's'}`, okText: 'Next: sign',
    intro: `${samples.map((s) => s.client_sample_id || s.description || 'sample').join(', ')}. Receiving logs them (sample IDs, the turnaround clock starts) and signs the chain of custody.`,
    fields: [
      { name: 'received_at', label: 'Received', type: 'datetime-local', value: localNow(), required: true },
      { name: 'delivered_by', label: 'Delivered by', help: 'Courier (e.g. FedEx, UPS) or the client in person' },
      { name: 'tracking_no', label: 'Tracking number' },
      { name: 'temperature', label: 'Temperature on arrival (°C)', type: 'number' },
      // the thermometer (0.34.0, migration 057): from the register, available and in calibration; needed with a temperature
      { name: 'thermometer_id', label: 'Thermometer', type: 'select', blank: false, value: '', options: [{ value: '', label: 'None (no temperature taken)' },
        ...thermometers.map((t) => ({ value: t.id, label: `${t.equipment_code} ${t.equipment_name}` }))],
        help: thermometers.length ? 'Needed when a temperature is recorded. Only thermometers available and in calibration are listed.'
          : 'No thermometer of this lab is available and in calibration: add one to the equipment register to record a temperature.' },
      { name: 'condition', label: 'Condition', type: 'select', value: 'Acceptable', options: CONDITIONS },
      { name: 'seals', label: 'Custody seals', type: 'select', value: 'None', options: ['Intact', 'Broken', 'None'] },
      { name: 'note', label: 'Note', type: 'textarea' },
    ],
    // checked before signing, as the old screen did
    submit: async (x) => { if (x.temperature !== '' && !x.thermometer_id) throw new Error('Say which thermometer took the temperature.'); return x; } });
  if (!v) return null;
  const body = { ...v, temperature: v.temperature === '' ? null : v.temperature, thermometer_id: v.thermometer_id || null,
    received_at: v.received_at ? new Date(v.received_at).toISOString() : null, sample_ids: samples.map((s) => s.id) };
  const r = await dialogs.sign({ title: 'Sign the chain of custody', what: `receipt of ${samples.length} sample${samples.length === 1 ? '' : 's'} on ${order.order_code}`, meaning: 'Received by', needReason: false,
    submit: ({ signature }) => api.receiveSamples(order.id, { ...body, signature }) });
  if (!r) return null;
  toast(`${r.logged} sample${r.logged === 1 ? '' : 's'} received and logged; receipt ${r.receipt} signed on the chain of custody.`);
  return r;
}

// ---------------------------------------------------------------- photos
// Crop a picture to 4:3 (centred, landscape), at most 1600 x 1200, as JPEG
function crop43(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth; let h = img.naturalHeight; let sx = 0; let sy = 0;
      if (w * 3 > h * 4) { const nw = Math.round(h * 4 / 3); sx = Math.round((w - nw) / 2); w = nw; } else { const nh = Math.round(w * 3 / 4); sy = Math.round((h - nh) / 2); h = nh; }
      const W = Math.min(1600, w); const H = Math.round(W * 3 / 4);
      if (W < 400) { URL.revokeObjectURL(url); rej(new Error(`${file.name} is too small (at least 400 x 300 after cropping to 4:3)`)); return; }
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      cv.getContext('2d').drawImage(img, sx, sy, w, h, 0, 0, W, H); URL.revokeObjectURL(url);
      const data = cv.toDataURL('image/jpeg', 0.88);
      res({ name: file.name.replace(/\.[^.]+$/, '') + '.jpg', data, base64: data.replace(/^data:[^,]*,/, '') });
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error(`${file.name} is not a picture`)); };
    img.src = url;
  });
}

function PhotoFigure({ p, s, small, children }) {
  const src = `/api/photos/${p.id}/file?s=${s}`;
  return (
    <figure className={`phcard${small ? ' small' : ''}`}>
      <a href={src} target="_blank" rel="noopener noreferrer"><img src={src} alt={p.caption || 'Sample photo'} loading="lazy" /></a>
      <figcaption>{p.report_slot ? <><b className="phslotb">Report photo {p.report_slot}</b> </> : null}{p.caption || ''}
        <div className="help">{p.by_name || ''}, {dt(p.taken_at)}</div>{children}</figcaption>
    </figure>
  );
}

const SLOT_OPTS = (taken) => [{ value: '', label: 'Not on the report' },
  { value: '1', label: 'Report photo 1' + (taken(1) ? ' (instead of the one now marked)' : '') },
  { value: '2', label: 'Report photo 2' + (taken(2) ? ' (instead of the one now marked)' : '') }];

// Take or upload photos: each is cropped to 4:3 and previewed as it is chosen; one or two can be marked for the report
function PhotoDialog({ sample, onDone }) {
  const s = useSiteParam();
  const toast = useToast();
  // the photos already attached (Alex, 2026-10-20: "the photos that are already attached should show up")
  const { data: x } = useApi(() => api.samplePhotos(sample.id, { fresh: true }).catch(() => null), [sample.id]);
  const have = (x?.rows || []).filter((p) => p.status === 'Active');
  const slotTaken = (k) => have.find((p) => Number(p.report_slot) === k);
  const [shots, setShots] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function choose(e) {
    setError('');
    const files = [...e.target.files]; e.target.value = '';
    const added = [];
    for (const f of files) { try { added.push({ ...(await crop43(f)), caption: '', slot: '' }); } catch (err) { setError(err.message); } }
    setShots((cur) => [...cur, ...added]);
  }
  const change = (i, patch) => setShots((cur) => cur.map((o, j) => (j === i ? { ...o, ...patch } : patch.slot && o.slot === patch.slot ? { ...o, slot: '' } : o)));

  async function ok() {
    if (!shots.length) { setError('Take or choose a photo first.'); return; }
    setBusy(true);
    try {
      await api.addPhotos(sample.id, shots.map((p) => ({ file_name: p.name, base64: p.base64, caption: p.caption || null, report_slot: p.slot || null })));
      toast(`${shots.length} photo${shots.length === 1 ? '' : 's'} added.`); onDone(true);
    } catch (err) { setBusy(false); setError(err.message); }
  }

  return (
    <Modal title={`Photos of ${sample.sample_code || sample.client_sample_id || 'the sample'}`} okText="Add photos" wide busy={busy} error={error} onOk={ok} onClose={() => onDone(false)}
      intro="Take photos with the camera or choose files. Each is cropped to 4:3 (the centre is kept). Mark the ones printed on a photo report as Report photo 1 and 2.">
      <div id="phhave" className="phhave">{x && <div className="field"><label>Already attached ({have.length})</label>
        {have.length ? <>
          <div className="phgrid">{have.map((p) => <PhotoFigure key={p.id} p={p} s={s} small />)}</div>
          <div className="help">Captions, report places and retiring are changed on the sample page.</div>
        </> : <div className="help">None yet.</div>}</div>}</div>
      <div className="field"><label htmlFor="f_ph">New photos</label><input id="f_ph" type="file" accept="image/*" capture="environment" multiple onChange={choose} /></div>
      <div id="phprev" className="phprev">{shots.map((p, i) => (
        <div className="phitem" key={i}>
          <img src={p.data} alt={`Photo ${i + 1}`} />
          <input className="phcap" placeholder="Caption" value={p.caption} onChange={(e) => change(i, { caption: e.target.value })} />
          <SmartSelect className="phslot" value={p.slot} options={SLOT_OPTS(slotTaken)} onChange={(v) => change(i, { slot: v })} />
          <button type="button" className="btn ghost small phdel" title="Remove" onClick={() => setShots((cur) => cur.filter((_, j) => j !== i))}>Remove</button>
        </div>))}</div>
    </Modal>
  );
}
export const openPhotoDialog = (dialogs, sample) => dialogs.open((done) => <PhotoDialog sample={sample} onDone={done} />);

// A sample's photos: thumbnails, caption, place on the report, retire
export function PhotosCard({ sample }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const s = useSiteParam();
  const { data: x, error, reload } = useApi(() => api.samplePhotos(sample.id), [sample.id]);
  if (error) return null;
  if (!x) return <div className="card"><div className="loading">Loading…</div></div>;
  const live = x.rows.filter((r) => r.status === 'Active');
  async function add() { if (await openPhotoDialog(dialogs, sample)) reload(); }
  async function edit(p) {
    const v = await dialogs.form({ title: 'Change the photo', fields: [
      { name: 'caption', label: 'Caption', value: p.caption || '' },
      { name: 'report_slot', label: 'On the report', type: 'select', blank: false, value: p.report_slot ? String(p.report_slot) : '', options: [{ value: '', label: 'Not on the report' }, { value: '1', label: 'Report photo 1' }, { value: '2', label: 'Report photo 2' }] },
      { name: 'retire', label: 'Retire', type: 'checkbox', cbLabel: 'Retire this photo (it is kept, hidden, with the reason)' },
      { name: 'reason', label: 'Reason (needed to retire)' }] });
    if (!v) return;
    if (v.retire && !v.reason) { toast('Give the reason for retiring the photo.', 'err'); return; }
    if (v.retire && !(await dialogs.confirm('Retire the photo', 'The photo is kept in the record, hidden, and no longer printed.', 'Retire'))) return;
    try { await api.changePhoto(p.id, { caption: v.caption, report_slot: v.report_slot || null, retire: v.retire, reason: v.reason || null }); reload(); }
    catch (e) { toast(e.message, 'err'); }
  }
  return (
    <Section title={`Photos (${live.length})`} help="Photos of the sample at receipt, 4:3. A photo report layout prints the ones marked Report photo 1 and 2."
      actions={x.can_edit && <button type="button" className="btn" id="phadd" onClick={add}>Add photos…</button>}>
      {x.problem && <div className="notice">{x.problem}.</div>}
      {live.length ? <div className="phgrid">{live.map((p) => (
        <PhotoFigure key={p.id} p={p} s={s}>{x.can_edit && <button type="button" className="btn ghost small phedit" onClick={() => edit(p)}>Change…</button>}</PhotoFigure>
      ))}</div> : <p className="help">No photos yet.</p>}
    </Section>
  );
}
