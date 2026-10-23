// The chain of custody, receiving with a signature, and sample photos (0.29.0, migration 051)
import { api, esc, toast, modal, state, signDialog, confirmBox } from '../app.js';
import { Grid } from '../grid.js';
import { section } from './common.js';

const dt = (v) => (v ? new Date(v).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const site = () => encodeURIComponent(state.site || '');
const localNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

// The order's chain of custody: print it, receive and sign, the receipts and paper copies
export async function custodyCard(el, orderId, { onChange, data } = {}) {
  const x = data || await api(`/orders/${orderId}/custody`);
  if (!x.document) { el.innerHTML = section('Chain of custody and sample manifest', 'Made when the order is submitted. Print it to travel with the samples.') + '<p class="help">Submit the order to make its chain of custody.</p>'; return x; }
  el.innerHTML = section(`Chain of custody ${esc(x.document.coc_code)}`, `The chain of custody is also the sample manifest. Print it to travel with the samples: the client and any courier sign "Relinquished by" on paper. Each receipt is signed here ("Receive and sign"), and the receiver's handwritten signature goes into its Received area.${x.required ? ' This lab logs samples only by "Receive and sign".' : ''}`,
    `<a class="btn" id="cocpdf" href="/api/orders/${orderId}/custody.pdf?s=${site()}" target="_blank" rel="noopener">Print chain of custody</a>
     ${x.can_receive ? '<button class="btn" id="cocpaper">Attach signed paper copy…</button>' : ''}`) + '<div id="cocg"></div>';
  if (x.events.length) {
    new Grid(el.querySelector('#cocg'), { readOnly: true, rows: x.events, columns: [
      { field: 'event_no', title: '#', type: 'readonly', width: 40 },
      { field: 'kind', title: 'What', type: 'readonly', width: 100 },
      { field: 'event_at', title: 'When', type: 'readonly', width: 160, format: dt },
      { field: 'by_name', title: 'By', type: 'readonly', width: 160 },
      { field: 'sample_codes', title: 'Samples', type: 'readonly', width: 220 },
      { field: 'delivered_by', title: 'Delivered by', type: 'readonly', width: 140, format: (v, r) => [v, r.tracking_no].filter(Boolean).join(', ') },
      { field: 'temperature', title: 'Temp. °C', type: 'readonly', width: 80, format: (v) => (v === null || v === undefined ? '' : String(Number(v))) },
      { field: 'thermometer_code', title: 'Thermometer', type: 'readonly', width: 120, help: 'The thermometer that took the temperature (from the equipment register)' },
      { field: 'condition', title: 'Condition', type: 'readonly', width: 120, format: (v, r) => [v, r.seals ? `seals ${r.seals.toLowerCase()}` : ''].filter(Boolean).join(', ') },
      { field: 'document_id', title: 'Document', type: 'link', width: 150, label: (r) => (r.kind === 'Received' ? 'Signed copy (PDF)' : 'Scan'),
        format: (v, r) => (v ? (r.kind === 'Received' ? 'Signed copy (PDF)' : 'Scan') : ''), onClick: (r) => { if (r.document_id) window.open(`/api/custody/events/${r.id}/file?s=${site()}`, '_blank'); } },
      { field: 'note', title: 'Note', type: 'readonly', width: 200 },
    ] });
  } else el.querySelector('#cocg').innerHTML = '<p class="help">No receipt signed yet.</p>';
  const paper = el.querySelector('#cocpaper');
  if (paper) paper.onclick = async () => {
    const v = await modal({ title: 'Attach the signed paper copy', intro: 'The scan of the chain of custody the client (and any courier) signed. It is kept with the order, unchanged.',
      html: '<div class="field"><label for="f_file">Scan (PDF, PNG or JPEG) <span class="req">*</span></label><input id="f_file" type="file" accept="application/pdf,image/png,image/jpeg"></div>',
      fields: [{ name: 'note', label: 'Note' }], okText: 'Attach',
      collect: (m) => ({ file: m.querySelector('#f_file').files[0] || null }) });
    if (!v) return;
    if (!v.file) { toast('Choose the scanned file.', 'err'); return; }
    const base64 = await readB64(v.file);
    try { await api(`/orders/${orderId}/custody/paper`, { method: 'POST', body: { file_name: v.file.name, mime_type: v.file.type, base64, note: v.note } }); toast('Paper copy attached.'); if (onChange) onChange(); }
    catch (e) { toast(e.message, 'err'); }
  };
  return x;
}

// Receive and sign: the details of the delivery, then the receiver's signature ("Received by")
export async function receiveDialog(order, samples, custody, onDone) {
  if (!samples.length) { toast('Tick the samples being received (only samples still expected).', 'err'); return; }
  if (custody && !custody.my_signature) {
    await modal({ title: 'Your signature is not on file', okText: 'OK', intro: 'Receiving samples signs the chain of custody and places your handwritten signature and title in its Received area. A lab administrator records them in Admin > People and groups (COA signature).' });
    return;
  }
  const v = await modal({ title: `Receive ${samples.length} sample${samples.length === 1 ? '' : 's'}`, okText: 'Next: sign',
    intro: `${esc(samples.map((s) => s.client_sample_id || s.description || 'sample').join(', '))}. Receiving logs them (sample IDs, the turnaround clock starts) and signs the chain of custody.`,
    fields: [
      { name: 'received_at', label: 'Received', type: 'datetime-local', value: localNow(), required: true },
      { name: 'delivered_by', label: 'Delivered by', help: 'Courier (e.g. FedEx, UPS) or the client in person' },
      { name: 'tracking_no', label: 'Tracking number' },
      { name: 'temperature', label: 'Temperature on arrival (°C)', type: 'number' },
      // the thermometer (0.34.0, migration 057): from the register, available and in calibration; needed with a temperature
      { name: 'thermometer_id', label: 'Thermometer', type: 'select', blank: false, value: '', options: [{ value: '', label: 'None (no temperature taken)' },
        ...((custody && custody.thermometers) || []).map((t) => ({ value: t.id, label: `${t.equipment_code} ${t.equipment_name}` }))],
        help: (custody && custody.thermometers && custody.thermometers.length) ? 'Needed when a temperature is recorded. Only thermometers available and in calibration are listed.'
          : 'No thermometer of this lab is available and in calibration: add one to the equipment register to record a temperature.' },
      { name: 'condition', label: 'Condition', type: 'select', value: 'Acceptable', options: ['Acceptable', 'Damaged', 'Temperature excursion', 'Short shipped', 'Leaking', 'Other (see note)'] },
      { name: 'seals', label: 'Custody seals', type: 'select', value: 'None', options: ['Intact', 'Broken', 'None'] },
      { name: 'note', label: 'Note', type: 'textarea' },
    ] });
  if (!v) return;
  if (v.temperature !== '' && v.temperature !== null && v.temperature !== undefined && !v.thermometer_id) { toast('Say which thermometer took the temperature.', 'err'); return; }
  const body = { ...v, thermometer_id: v.thermometer_id || null, received_at: v.received_at ? new Date(v.received_at).toISOString() : null, sample_ids: samples.map((s) => s.id) };
  const r = await signDialog({ title: 'Sign the chain of custody', what: `receipt of ${samples.length} sample${samples.length === 1 ? '' : 's'} on ${order.order_code}`, meaning: 'Received by', needReason: false,
    submit: ({ signature }) => api(`/orders/${order.id}/receive`, { method: 'POST', body: { ...body, signature } }) });
  if (!r) return;
  toast(`${r.logged} sample${r.logged === 1 ? '' : 's'} received and logged; receipt ${r.receipt} signed on the chain of custody.`);
  if (onDone) onDone(r);
}

function readB64(file) {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).replace(/^data:[^,]*,/, '')); fr.onerror = rej; fr.readAsDataURL(file); });
}
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

// Take or upload photos: each is cropped to 4:3 and previewed as it is chosen; one or two can be marked for the report
export function openPhotoDialog(sample, onDone) {
  const m = document.createElement('div'); m.className = 'modal-bg';
  m.innerHTML = `<div class="modal wide"><h3>Photos of ${esc(sample.sample_code || sample.client_sample_id || 'the sample')}</h3>
    <p class="intro">Take photos with the camera or choose files. Each is cropped to 4:3 (the centre is kept). Mark the ones printed on a photo report as Report photo 1 and 2.</p>
    <div id="phhave" class="phhave"></div>
    <div class="field"><label for="f_ph">New photos</label><input id="f_ph" type="file" accept="image/*" capture="environment" multiple></div>
    <div id="phprev" class="phprev"></div><div class="merr" role="alert"></div>
    <div class="mbtns"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>Add photos</button></div></div>`;
  document.body.appendChild(m);
  const shots = []; const prev = m.querySelector('#phprev'); const err = (t) => { m.querySelector('.merr').textContent = t; };
  // the photos already attached (Alex, 2026-10-20: "the photos that are already attached should show up"); changed on the sample page
  let have = [];
  const slotTaken = (k) => have.find((p) => Number(p.report_slot) === k);
  api(`/samples/${sample.id}/photos`).then((x) => {
    have = (x.rows || []).filter((p) => p.status === 'Active');
    m.querySelector('#phhave').innerHTML = `<div class="field"><label>Already attached (${have.length})</label>${have.length
      ? `<div class="phgrid">${have.map((p) => `<figure class="phcard small"><a href="/api/photos/${p.id}/file?s=${site()}" target="_blank" rel="noopener"><img src="/api/photos/${p.id}/file?s=${site()}" alt="${esc(p.caption || 'Sample photo')}" loading="lazy"></a>
        <figcaption>${p.report_slot ? `<b class="phslotb">Report photo ${p.report_slot}</b> ` : ''}${esc(p.caption || '')}<div class="help">${esc(p.by_name || '')}, ${esc(dt(p.taken_at))}</div></figcaption></figure>`).join('')}</div>
        <div class="help">Captions, report places and retiring are changed on the sample page.</div>` : '<div class="help">None yet.</div>'}</div>`;
    draw();
  }).catch(() => {});
  const draw = () => {
    prev.innerHTML = shots.map((s, i) => `<div class="phitem" data-i="${i}"><img src="${s.data}" alt="Photo ${i + 1}"><input class="phcap" placeholder="Caption" value="${esc(s.caption || '')}">
      <select class="phslot"><option value="">Not on the report</option><option value="1" ${s.slot === '1' ? 'selected' : ''}>Report photo 1${slotTaken(1) ? ' (instead of the one now marked)' : ''}</option><option value="2" ${s.slot === '2' ? 'selected' : ''}>Report photo 2${slotTaken(2) ? ' (instead of the one now marked)' : ''}</option></select>
      <button class="btn ghost small phdel" title="Remove">Remove</button></div>`).join('');
    prev.querySelectorAll('.phitem').forEach((it) => { const s = shots[Number(it.dataset.i)];
      it.querySelector('.phcap').oninput = (e) => { s.caption = e.target.value; };
      it.querySelector('.phslot').onchange = (e) => { s.slot = e.target.value; if (s.slot) shots.forEach((o) => { if (o !== s && o.slot === s.slot) o.slot = ''; }); draw(); };
      it.querySelector('.phdel').onclick = () => { shots.splice(Number(it.dataset.i), 1); draw(); }; });
  };
  m.querySelector('#f_ph').onchange = async (e) => {
    err('');
    for (const f of [...e.target.files]) {
      try { const c = await crop43(f); shots.push({ ...c, caption: '', slot: '' }); } catch (x) { err(x.message); }
    }
    e.target.value = ''; draw();
  };
  const close = () => m.remove();
  m.querySelector('[data-x]').onclick = close;
  m.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  m.querySelector('[data-ok]').onclick = async () => {
    if (!shots.length) { err('Take or choose a photo first.'); return; }
    const ok = m.querySelector('[data-ok]'); ok.disabled = true;
    try {
      await api(`/samples/${sample.id}/photos`, { method: 'POST', body: { photos: shots.map((s) => ({ file_name: s.name, base64: s.base64, caption: s.caption || null, report_slot: s.slot || null })) } });
      close(); toast(`${shots.length} photo${shots.length === 1 ? '' : 's'} added.`); if (onDone) onDone();
    } catch (x) { ok.disabled = false; err(x.message); }
  };
}

// A sample's photos: thumbnails, caption, place on the report, retire
export async function photosCard(el, sample) {
  const x = await api(`/samples/${sample.id}/photos`);
  const live = x.rows.filter((r) => r.status === 'Active');
  el.innerHTML = section(`Photos (${live.length})`, 'Photos of the sample at receipt, 4:3. A photo report layout prints the ones marked Report photo 1 and 2.',
    x.can_edit ? '<button class="btn" id="phadd">Add photos…</button>' : '') +
    (x.problem ? `<div class="notice">${esc(x.problem)}.</div>` : '') +
    (live.length ? `<div class="phgrid">${live.map((p) => `<figure class="phcard" data-id="${p.id}"><a href="/api/photos/${p.id}/file?s=${site()}" target="_blank" rel="noopener"><img src="/api/photos/${p.id}/file?s=${site()}" alt="${esc(p.caption || 'Sample photo')}" loading="lazy"></a>
      <figcaption>${p.report_slot ? `<b class="phslotb">Report photo ${p.report_slot}</b> ` : ''}${esc(p.caption || '')}<div class="help">${esc(p.by_name)}, ${esc(dt(p.taken_at))}</div>
      ${x.can_edit ? '<button class="btn ghost small phedit">Change…</button>' : ''}</figcaption></figure>`).join('')}</div>` : '<p class="help">No photos yet.</p>');
  const add = el.querySelector('#phadd'); if (add) add.onclick = () => openPhotoDialog(sample, () => photosCard(el, sample));
  el.querySelectorAll('.phedit').forEach((b) => { b.onclick = async () => {
    const p = live.find((r) => r.id === b.closest('.phcard').dataset.id);
    const v = await modal({ title: 'Change the photo', fields: [
      { name: 'caption', label: 'Caption', value: p.caption || '' },
      { name: 'report_slot', label: 'On the report', type: 'select', blank: false, value: p.report_slot ? String(p.report_slot) : '', options: [{ value: '', label: 'Not on the report' }, { value: '1', label: 'Report photo 1' }, { value: '2', label: 'Report photo 2' }] },
      { name: 'retire', label: 'Retire', type: 'checkbox', cbLabel: 'Retire this photo (it is kept, hidden, with the reason)' },
      { name: 'reason', label: 'Reason (needed to retire)' }] });
    if (!v) return;
    if (v.retire && !v.reason) { toast('Give the reason for retiring the photo.', 'err'); return; }
    if (v.retire && !(await confirmBox('Retire the photo', 'The photo is kept in the record, hidden, and no longer printed.', 'Retire'))) return;
    try { await api(`/photos/${p.id}`, { method: 'PUT', body: { caption: v.caption, report_slot: v.report_slot || null, retire: v.retire, reason: v.reason || null } }); photosCard(el, sample); }
    catch (e) { toast(e.message, 'err'); }
  }; });
  return x;
}
