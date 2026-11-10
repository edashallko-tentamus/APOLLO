// The inventory dialogs: reorder, record usage, send for QA testing, receive, upload and review a Supplier COA.
// Each takes ui = { dialogs, toast, siteId } and resolves when done. Every create and change is signed (the meaning is set
// by the action); routine usage is not.
import { useState } from 'react';
import { confirmCoa, lotAction, qualifyLot, qualifyOptions, recordMovements, reorderLot, uploadCoa, coaFileUrl } from '../../api/inventory.js';
import { d8, dt, GridDialog, loadLookups, qty, today, XModal } from './shared.jsx';

// fn(reason, signature) runs while the signature dialog is open: a wrong password or a refused change keeps it open
export const signed = (dialogs, o, fn) => dialogs.sign({ ...o, submit: ({ reason, signature }) => fn(reason, signature) });

// ---------------------------------------------------------------- reorder: a purchase request like this lot
export async function reorderDialog({ dialogs, toast }, l) {
  const v = await dialogs.form({ title: `Reorder ${l.material}`, okText: 'Create request', intro: 'Creates a purchase request like this lot (same item, analytes, vendor and catalog number). A Lab Supervisor approves it.',
    fields: [{ name: 'quantity', label: `Quantity (${l.unit || ''})`, type: 'number', value: l.quantity_received ?? l.requested_quantity, required: true }, { name: 'notes', label: 'Notes' }] });
  if (!v) return null;
  const r = await signed(dialogs, { what: `Reorder of ${l.lot_code} ${l.material}: ${v.quantity} ${l.unit || ''}`, meaning: 'Requested by', needReason: false },
    (reason, signature) => reorderLot(l.id, { quantity: Number(v.quantity), notes: v.notes, signature }));
  if (r) { toast('Purchase request created and signed.'); window.location.hash = '#/inventory/lots/' + r.id; }
  return r;
}

// ---------------------------------------------------------------- routine usage (no signature)
export async function usageDialog({ dialogs, toast }, usable) {
  if (!usable.length) { toast('No usable lots in this lab.', 'err'); return false; }
  const options = usable.map((r) => ({ value: r.lot_code, label: `${r.lot_code} ${r.material} (${qty(r.on_hand, r.unit)} left)` }));
  const columns = [
    { field: 'lot_code', title: 'Lot', type: 'select', options, width: 330, required: true },
    { field: 'quantity', title: 'Quantity used', type: 'number', min: 0, width: 110, required: true },
    { field: 'unit', title: 'Unit', type: 'readonly', width: 60, compute: (r) => usable.find((u) => u.lot_code === r.lot_code)?.unit || '' },
    { field: 'reference', title: 'Reference (batch, sample, WI)', width: 220 },
    { field: 'notes', title: 'Notes', width: 200 },
  ];
  const res = await dialogs.open((done) => <GridDialog title="Record usage" okText="Record" columns={columns} onDone={done}
    intro="Routine usage: no signature needed (it is recorded under your name). One line per lot used. Paste from Excel or fill down (Ctrl+D) a reference such as the batch or work instruction. Only usable lots can be picked: expired, retest-due, on-hold and not-yet-received lots are refused." />);
  if (!res || !res.rows.length) return false;
  try {
    await recordMovements({ rows: res.rows.map((r) => ({ ...r, txn_type: 'Usage' })) });
    toast(`Recorded ${res.rows.length} usage line${res.rows.length === 1 ? '' : 's'}.`);
    return true;
  } catch (e) { toast(e.message, 'err'); return false; }
}

// ---------------------------------------------------------------- QA testing before use (migration 040; media qualification since 023)
// What the lot is released for when it passes (every use, or a named test) and the QA test that decides it. One test
// sample with the lot's own ID is made and goes to the backlog; QA's approval of its batch releases the lot, or rejects it.
export async function qualifyDialog({ dialogs, toast }, l) {
  let o;
  try { o = await qualifyOptions(l.id); } catch (e) { toast(e.message, 'err'); return false; }
  const testOpts = o.tests.map((t) => ({ value: t.id, label: t.test_name, match: [t.test_code, t.department_code].filter(Boolean) }));
  const useOpts = [{ value: 'ALL', label: 'Every use' }, ...testOpts];
  const media = (l.chemical_types || []).includes('Media');
  const guess = o.tests.find((t) => (media ? /growth promotion|media qualification|media qc/i : /identity|qa test|incoming|release|qualif/i).test(t.test_name));
  const rejected = /^Rejected/.test(l.qa_status || '');
  const columns = [
    { field: 'use_test_id', title: 'Released for', type: 'select', options: useOpts, width: 330, required: true },
    { field: 'qualification_test_id', title: 'QA test', type: 'select', options: testOpts, width: 330, required: true },
  ];
  const intro = <>One row per release: <b>Released for</b> is <i>Every use</i>, or the one test the lot may then be used for (as media is qualified for a test's organisms); <b>QA test</b> is the test that decides it. A test sample with this lot's ID ({l.lot_code}) is made on the lab's internal order and goes to the backlog; it joins batches without counting toward their size or QC. When QA approves its review the lot is released; if a result does not conform, the lot is rejected for every use until a retest passes.{rejected && <> <b>This lot was rejected: this is its retest.</b></>}</>;
  const res = await dialogs.open((done) => <GridDialog title={`${rejected ? 'Retest' : 'Send for QA testing'}: ${l.lot_code} ${l.material}`} okText={rejected ? 'Send for retest' : 'Send for QA testing'}
    minRows={1} newRow={() => ({ use_test_id: media ? '' : 'ALL', qualification_test_id: guess ? guess.id : '' })} intro={intro} columns={columns} onDone={done} />);
  if (!res || !res.rows.length) return false;
  try {
    const r = await qualifyLot(l.id, res.rows.map((x) => ({ use_test_id: x.use_test_id === 'ALL' ? null : x.use_test_id, qualification_test_id: x.qualification_test_id })));
    toast(`Sent for QA testing: test sample ${r.sample_code} is in the backlog.`);
    return true;
  } catch (e) { toast(e.message, 'err'); return false; }
}

// ---------------------------------------------------------------- receive: completes the same lot
export async function receiveDialog({ dialogs, toast }, l) {
  const L = await loadLookups();
  const v = await dialogs.form({ title: `Receive ${l.lot_code}: ${l.material}`, okText: 'Receive',
    intro: l.receipt_status === 'In Transit' ? `Transferred from ${l.transferred_from_code || ''} (${l.transferred_from_site || ''}). Check what arrived and where it is stored.` : 'Fill in what arrived. This completes the same lot; it does not create a second one.',
    fields: [
      { name: 'quantity', label: `Quantity received (${l.unit || ''})`, type: 'number', value: l.quantity_received ?? l.requested_quantity, required: true },
      { name: 'manufacturer_lot', label: 'Lot #', value: l.manufacturer_lot || '' },
      { name: 'expiration_date', label: 'Expiration date', type: 'date', value: d8(l.expiration_date) },
      { name: 'retest_date', label: 'Retest date', type: 'date', value: d8(l.retest_date) },
      { name: 'storage_location_id', label: 'Storage location', type: 'select', options: L.locOpts, value: l.storage_location_id || '' },
      { name: 'received_date', label: 'Received on', type: 'date', value: today() },
    ] });
  if (!v) return false;
  const ok = await signed(dialogs, { what: `Receive ${l.lot_code} ${l.material}: ${v.quantity} ${l.unit || ''}`, meaning: 'Received by', needReason: false },
    (reason, signature) => lotAction(l.id, 'receive', { ...v, quantity: Number(v.quantity), signature }));
  if (ok) toast('Received and signed. The lot is now usable (if in date).');
  return !!ok;
}

// ---------------------------------------------------------------- Supplier COA: upload, then review beside the document
const MAX_COA = 3.5 * 1024 * 1024;
export async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer()); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function CoaUpload({ l, ai, dialogs, toast, onDone }) {
  const [file, setFile] = useState(null);
  const [useAi, setUseAi] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function upload() {
    if (!file) { setError('Choose the COA file.'); return; }
    if (file.size > MAX_COA) { setError('The file is larger than 3.5 MB. Save a smaller PDF and try again.'); return; }
    setBusy(true); setError('');
    const body = { file_name: file.name, mime_type: file.type || 'application/pdf', content_base64: await fileToBase64(file), use_ai: ai.enabled && useAi };
    const r = await signed(dialogs, { what: `Supplier COA ${file.name} for ${l.lot_code} ${l.material}`, meaning: 'Uploaded by', needReason: false },
      (reason, signature) => uploadCoa(l.id, { ...body, signature }));
    if (!r) { setBusy(false); return; }
    if (r.aiError) toast(r.aiError + ' Type the values instead.', 'err');
    onDone(r);
  }
  return (
    <XModal size="wide" title={`Upload Supplier COA: ${l.lot_code} ${l.material}`} intro="PDF or image, up to about 3.5 MB. The file is stored unchanged with its SHA-256 fingerprint."
      okText={busy ? (ai.enabled ? 'Uploading and reading…' : 'Uploading…') : 'Upload'} busy={busy} error={error} onOk={upload} onClose={() => onDone(null)}>
      {ai.enabled ? <>
        <div className="aiflag">AI reading is on ({ai.model}): the document is sent to Anthropic's API, which proposes the values. You check every value before anything is saved.</div>
        <label className="cb"><input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} /> Let AI propose the values</label>
      </> : <div className="aiflag">AI reading is off in this Sandbox (no API key set). You will type the values beside the document; nothing changes about the record keeping.</div>}
      <div className="field"><input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files[0] || null)} /></div>
    </XModal>
  );
}
export const coaUploadDialog = (ui, l, ai) => ui.dialogs.open((done) => <CoaUpload l={l} ai={ai} dialogs={ui.dialogs} toast={ui.toast} onDone={done} />);

// Side by side: the document, and the values to confirm (AI proposal or the lot's current values)
const COA_FIELDS = [['manufacturer_lot', 'Lot #', 'text'], ['expiration_date', 'Expiration date', 'date'], ['retest_date', 'Retest date', 'date'],
  ['purity_pct', 'Purity %', 'number'], ['concentration', 'Concentration', 'number'], ['concentration_unit', 'Concentration unit', 'text'], ['catalog_number', 'Catalog number', 'text']];
function CoaReview({ c, l, siteId, dialogs, toast, onDone }) {
  const p = c.ai_proposed || {}; const conf = c.values_confirmed;
  const curOf = (k) => (k.endsWith('_date') ? d8(l[k]) : l[k] ?? '');
  const [vals, setVals] = useState(() => Object.fromEntries(COA_FIELDS.map(([k]) => [k, String((conf ? conf[k] ?? '' : (p[k] !== null && p[k] !== undefined ? p[k] : curOf(k))) ?? '')])));
  const isImg = /^image\//.test(c.mime_type || '');
  const url = coaFileUrl(c.id, siteId);
  async function ok() {
    const values = Object.fromEntries(COA_FIELDS.map(([k, , t]) => { const v = vals[k].trim(); return [k, v === '' ? null : t === 'number' ? Number(v) : v]; }));
    const r = await signed(dialogs, { what: `Supplier COA values for ${l.lot_code} ${l.material}`, meaning: 'Verified by' },
      (reason, signature) => confirmCoa(c.id, { values, reason, signature }));
    if (r) { toast('Values confirmed, signed and saved to the lot.'); onDone(true); }
  }
  return (
    <XModal title={`Supplier COA: ${c.file_name}`} cancelText={conf ? 'Close' : 'Cancel'} okText="Confirm and save to the lot" onOk={conf ? null : ok} onClose={() => onDone(false)}>
      {c.ai_proposed && <div className="aiflag">Values proposed by AI ({c.ai_model || ''}). Check each against the document. Fields that differ from the lot are highlighted. {p.chemical_name && <>The COA names <b>{p.chemical_name}</b>{p.cas_number ? ` (CAS ${p.cas_number})` : ''}{p.manufacturer_name ? `, made by ${p.manufacturer_name}` : ''}: check it matches {l.material}.</>}</div>}
      <div className="coa-review">
        {isImg ? <img src={url} alt="Supplier COA" /> : <iframe src={url} title="Supplier COA" />}
        <div className="coa-fields">
          {COA_FIELDS.map(([k, label, t]) => {
            const cur = curOf(k); const differs = String(vals[k] ?? '') !== String(cur ?? '');
            return (
              <div key={k} className={`cf${differs ? ' diff' : ''}`}><label htmlFor={'cf_' + k}>{label}</label>
                <input id={'cf_' + k} type={t} step={t === 'number' ? 'any' : undefined} value={vals[k]} disabled={!!conf} onChange={(e) => setVals((s) => ({ ...s, [k]: e.target.value }))} />
                {p.evidence?.[k] && <div className="ev">On the COA: “{p.evidence[k]}”</div>}
                {differs && <div className="cur">On the lot now: {cur === '' ? 'empty' : cur}</div>}
              </div>
            );
          })}
          {conf ? <p className="help">Confirmed by {c.confirmed_by_name || ''} {dt(c.confirmed_at)}.</p> : <p className="help">Confirming asks for your reason and electronic signature (Verified by).</p>}
        </div>
      </div>
    </XModal>
  );
}
export const coaReviewDialog = (ui, c, l) => ui.dialogs.open((done) => <CoaReview c={c} l={l} siteId={ui.siteId} dialogs={ui.dialogs} toast={ui.toast} onDone={done} />);
