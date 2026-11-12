// The batch page's actions and dialogs: equipment and materials used, raw data, aliquots, analytical runs, re-prep,
// reopening and completing a step (with a witness), adding and removing samples, picks and choices, step approvals.
// Each takes ctx = { d, opts, b, reload, dialogs, toast }.
import { useState } from 'react';
import * as api from '../../api/testing.js';
import Modal from '../../components/Modal.jsx';
import { active, COUNT_WORDS, day, dilutionSteps, dt, forWhat, isPast, kindOf, lastReadingStep, nfmt, readingDilution, rlabel } from './shared.jsx';
import { Form } from 'react-bootstrap';

const fail = (ctx) => (e) => ctx.toast(e.message, 'err');

export async function addEquipment(ctx, s, ids, run = 1) {
  const types = (s.equipment_types || []).map((t) => t.equipment_type_id);
  const list = ctx.opts.equipment.filter((e) => !types.length || types.includes(e.equipment_type_id));
  if (!list.length) { ctx.toast('This lab has no equipment of the type this step uses.', 'err'); return; }
  const r = await ctx.dialogs.form({ title: `Equipment used: ${s.step_name}${s.step_type === 'Data Entry' ? `, run ${run}` : ''}`, okText: 'Add', intro: `For ${forWhat(ctx.d, ids)}. Only available equipment in calibration can be used.`,
    fields: [{ name: 'equipment_id', label: 'Equipment', type: 'select', required: true,
      options: list.map((e) => ({ value: e.id, label: `${e.equipment_code} ${e.equipment_name} (${e.type_name})${e.availability !== 'Available' ? ' · ' + e.availability : ''}${e.calibration_status === 'Deficient' ? ' · out of calibration' : ''}` })) }] });
  if (!r) return;
  try { await api.addEquipmentUsed(s.id, { equipment_id: r.equipment_id, entry_ids: ids, analytical_run_no: run }); ctx.toast('Equipment recorded.'); ctx.reload(); } catch (e) { fail(ctx)(e); }
}

// A weighed aliquot (sample weights logbook): its barcode scanned at a Weighing step fills in the weight and the balance (L-2)
export async function scanAliquot(ctx, s) {
  const r = await ctx.dialogs.form({ title: `Scan aliquot: ${s.step_name}`, okText: 'Use it', intro: 'Scan (or type) the aliquot\'s barcode: its entry code in the sample weights logbook (LBE-...). Its weight and balance are recorded for its sample in this batch. Scan another aliquot to replace a weight; a typed weight cannot replace one from an aliquot.',
    fields: [{ name: 'code', label: 'Aliquot barcode', required: true }] });
  if (!r) return;
  try { const x = await api.scanAliquot(s.id, r.code); ctx.toast(`Weight recorded for ${x.label} from ${r.code.toUpperCase()}.`); ctx.reload(); } catch (e) { fail(ctx)(e); }
}

export async function addMaterial(ctx, s, ids) {
  const purpose = s.step_type === 'Weighing' ? 'Spike' : s.step_type === 'Data Entry' ? 'Standard' : s.step_type === 'Dilution' ? 'Diluent' : s.step_type === 'Plating/Inoculation' ? 'Media' : 'Reagent';
  let lb = [];
  try { lb = (await api.lotEntries(ctx.b.id)).rows; } catch { lb = []; }
  const r = await ctx.dialogs.form({ title: `Material used: ${s.step_name}`, okText: 'Add', wide: true,
    intro: <>For {forWhat(ctx.d, ids)}. The amount used is taken off the lot's stock <b>for each selected row</b>. For a spike it is the volume added: the amount spiked is calculated from the lot's concentrations. A check standard (ICV, CCV) is recorded as Standard.</>,
    fields: [
      // lots not released by QA testing are listed last, marked NOT RELEASED (0.22.0)
      { name: 'lot_id', label: 'Lot', type: 'select', required: true, options: [...ctx.opts.lots].sort((x, y) => (x.not_qualified ? 1 : 0) - (y.not_qualified ? 1 : 0)).map((l) => ({ value: l.id, label: `${l.lot_code} ${l.item_name || ''}${l.analytes ? ' (' + l.analytes + ')' : ''} · on hand ${nfmt(l.on_hand)} ${l.unit || ''}${l.expiration_date ? ' · exp. ' + day(l.expiration_date) : ''}${l.not_qualified ? ' · NOT RELEASED: ' + l.not_qualified : ''}` })) },
      { name: 'purpose', label: 'Used as', type: 'select', required: true, blank: false, value: purpose, options: ['Spike', 'Standard', 'Reagent', 'Diluent', 'Media', 'Strain', 'Other'] },
      { name: 'volume', label: 'Amount used (per row)', type: 'number', required: true, help: 'Taken off the lot\'s stock; in a unit that converts to the lot\'s unit' },
      { name: 'volume_unit', label: 'Unit', type: 'select', blank: false, value: 'mL', options: ['mL', 'µL', 'L', 'g', 'mg', 'kg', 'each'] },
      ...(lb.length ? [{ name: 'logbook_entry_id', label: 'Logbook entry (only when a lot has several usable ones)', type: 'select', options: lb.map((x) => ({ value: x.entry_id, label: `${x.lot_code}: ${x.entry_code} ${x.status}${x.valid_until ? ', usable until ' + dt(x.valid_until) : ''}` })),
        help: 'A lot with logbook values (an inoculum, a culture) carries its entry: the approved one inside its validity is used, else choose' }] : []),
    ] });
  if (!r) return;
  try { await api.addMaterialUsed(s.id, { ...r, entry_ids: ids }); ctx.toast('Material recorded.'); ctx.reload(); } catch (e) { fail(ctx)(e); }
}

export function attachFile(ctx, s, run = 1) {
  const inp = document.createElement('input'); inp.type = 'file';
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    if (f.size > 20 * 1024 * 1024) { ctx.toast('The file is too large (20 MB at most).', 'err'); return; }
    const rd = new FileReader();
    rd.onload = async () => {
      try {
        await api.attachRawData(s.id, { file_name: f.name, mime_type: f.type || 'application/octet-stream', content_base64: String(rd.result).split(',')[1] || '', label: run > 1 ? `Raw data, run ${run}` : 'Raw data', analytical_run_no: run });
        ctx.toast('Raw data attached.'); ctx.reload();
      } catch (e) { fail(ctx)(e); }
    };
    rd.readAsDataURL(f);
  };
  inp.click();
}

// Add an analytical run (WD-5): the ticked samples are read again in a new run with its own analytical QC
export async function reanalysis(ctx, s, ids) {
  const { d } = ctx;
  const cands = active(d).filter((e) => e.qc_class !== 'Analytical');
  const r = await ctx.dialogs.form({ title: `Add an analytical run: ${s.step_name}`, okText: 'Next: sign', wide: true,
    intro: 'Tick the samples (and prep QC) to read again from the same preparation. The new run gets its own ICV and CCVs, raw data file and instrument; every reading is kept and the reviewer chooses what is reported (or the average). New readings are labelled RA1-, RA2-...',
    fields: [{ name: 'runs', label: 'Readings of each in the new run', type: 'select', blank: false, value: '1', options: COUNT_WORDS },
      // 0.27.0: the ticked samples can be diluted further for this run
      ...(dilutionSteps(d).length && s.id === lastReadingStep(d)?.id ? [
        { name: 'aliquot', label: 'Further dilution for this run: aliquot (leave empty to read the same solution)', type: 'number' },
        { name: 'diluent', label: 'Further dilution: diluent', type: 'number', help: 'e.g. 1 + 9 = ×10 more; the factors multiply, and only this run\'s readings use it' }] : []),
      ...cands.map((e) => ({ name: 'e_' + e.id, type: 'checkbox', label: '', cbLabel: `${e.label} (${kindOf(e)})`, value: ids.includes(e.id) }))] });
  if (!r) return;
  const pick = cands.filter((e) => r['e_' + e.id]).map((e) => e.id);
  if (!pick.length) { ctx.toast('Tick the samples to read again.', 'err'); return; }
  const further = r.aliquot ? ` diluted further ${r.aliquot} + ${r.diluent || 0}` : '';
  const done = await ctx.dialogs.sign({ what: `New analytical run (${COUNT_WORDS[r.runs - 1].label.toLowerCase()}) of ${pick.length} entr${pick.length === 1 ? 'y' : 'ies'} in ${ctx.b.batch_code}${further}`, meaning: 'Requested by', needReason: true,
    submit: ({ reason, signature }) => api.addRun(s.id, { entry_ids: pick, replicates: Number(r.runs), aliquot: r.aliquot || null, diluent: r.diluent || null, reason, signature }) });
  if (done) { ctx.toast('Analytical run added: enter its readings, raw data and instrument.'); ctx.reload(); window.location.hash = `#/testing/batches/${ctx.b.id}?step=${s.step_key}&run=${done.run_no || ''}`; }
}

export async function reprep(ctx, ids) {
  const samples = ids.filter((i) => ctx.d.entries.find((e) => e.id === i)?.entry_type === 'Sample');
  if (!samples.length) { ctx.toast('Select the samples to re-prepare first (QC is made again with the new batch).', 'err'); return; }
  const r = await ctx.dialogs.form({ title: 'Re-prep', okText: 'Next: sign', intro: `Prepare ${forWhat(ctx.d, samples)} again in a new batch. They go to the top of the backlog; their entries here are superseded and keep their data.`,
    fields: [{ name: 'replicates', label: 'How many new preparations', type: 'select', blank: false, value: '1', options: COUNT_WORDS }] });
  if (!r) return;
  const done = await ctx.dialogs.sign({ what: `Re-prep (${COUNT_WORDS[r.replicates - 1].label.toLowerCase()}) from ${ctx.b.batch_code}`, meaning: 'Requested by', needReason: true,
    submit: ({ reason, signature }) => api.reprepBatch(ctx.b.id, { entry_ids: samples, replicates: Number(r.replicates), reason, signature }) });
  if (done) { ctx.toast('Re-prep asked for: the samples are back at the top of the backlog.'); ctx.reload(); }
}

export async function reopenStep(ctx, s) {
  const done = await ctx.dialogs.sign({ what: `Reopen ${s.step_name} of ${ctx.b.batch_code}`, meaning: 'Reopened by', needReason: true,
    submit: ({ reason, signature }) => api.reopenStep(s.id, reason, signature) });
  if (done) { ctx.toast('Step reopened.'); ctx.reload(); }
}

// ---------------------------------------------------------------- complete a step: "Performed by", and the witness in the same dialog
function CompleteDialog({ what, mode, username, submit, onDone }) {
  const [user, setUser] = useState(username || '');
  const [pass, setPass] = useState('');
  const [wit, setWit] = useState(mode === 'Required');
  const [wuser, setWuser] = useState('');
  const [wpass, setWpass] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function ok() {
    const signature = { username: user.trim(), password: pass };
    if (!signature.username) return setError('Enter your user ID.');
    if (!signature.password) return setError('Enter your password to sign.');
    let witness = null;
    if (wit) {
      witness = { username: wuser.trim(), password: wpass };
      if (!witness.username) return setError('The witness enters their user ID.');
      if (!witness.password) return setError('The witness enters their password.');
      if (witness.username.toLowerCase() === signature.username.toLowerCase()) return setError('The witness must be someone else.');
    }
    setBusy(true); setError('');
    try { await submit(signature, witness); onDone(witness ? 'witnessed' : 'signed'); }
    catch (e) { setBusy(false); setPass(''); setWpass(''); setError(e.message); }
  }
  return (
    <Modal title="Complete step" okText="Sign and complete" error={error} busy={busy} onOk={ok} onClose={() => onDone(null)}
      intro={<>You are signing: <b>{what}</b>.<br />Your signature means <b>Performed by</b> and covers every entry in the batch; it is stored with your name, the date and time.</>}>
      <div className="sigbox">
        <div className="field"><label htmlFor="c_user">User ID <span className="req">*</span></label><Form.Control id="c_user" autoComplete="username" value={user} onChange={(e) => setUser(e.target.value)} /></div>
        <div className="field"><label htmlFor="c_pass">Password <span className="req">*</span></label><Form.Control id="c_pass" type="password" autoComplete="current-password" autoFocus value={pass} onChange={(e) => setPass(e.target.value)} /></div>
      </div>
      {mode !== 'None' && <>
        <label className="cb" style={{ display: 'block', marginTop: 10 }}><Form.Check.Input type="checkbox" id="c_wit" checked={wit} disabled={mode === 'Required'} onChange={(e) => setWit(e.target.checked)} /> Witnessed{mode === 'Required' ? ' (this step requires a witness)' : ''}</label>
        {wit && <div className="witbox" id="c_wbox"><div className="help">The witness signs too (<b>Witnessed by</b>): another person who does bench work in this lab, with their own user ID and password.</div>
          <div className="two"><div className="field"><label htmlFor="c_wuser">Witness user ID <span className="req">*</span></label><Form.Control id="c_wuser" autoComplete="off" value={wuser} onChange={(e) => setWuser(e.target.value)} /></div>
            <div className="field"><label htmlFor="c_wpass">Witness password <span className="req">*</span></label><Form.Control id="c_wpass" type="password" autoComplete="off" value={wpass} onChange={(e) => setWpass(e.target.value)} /></div></div></div>}
      </>}
    </Modal>
  );
}
export async function completeStep(ctx, s, username) {
  const done = await ctx.dialogs.open((close) => <CompleteDialog what={`${s.step_name} of ${ctx.b.batch_code}`} mode={(s.config || {}).witness || 'None'} username={username}
    submit={(signature, witness) => api.completeStep(s.id, signature, witness)} onDone={close} />);
  if (done) { ctx.toast(done === 'witnessed' ? 'Step completed, signed and witnessed.' : 'Step completed and signed.'); ctx.reload(); }
}

// ---------------------------------------------------------------- the batch's samples before bench work starts (no signature: Alex)
function AddSamplesDialog({ b, rows, onDone }) {
  const key = (r) => r.requested_test_id + ':' + (r.reprep_request_id || '');
  const [picked, setPicked] = useState(() => new Set());
  const [error, setError] = useState('');
  const flip = (k) => setPicked((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <Modal title={`Add samples to ${b.batch_code}`} okText="Add to the batch" wide error={error}
      intro="Waiting in the backlog for this test version, in priority order. The batch's QC follows the number of samples; a completed Batching step opens again so the batch is confirmed. Lot QA testing samples do not count toward the batch size."
      onOk={() => (picked.size ? onDone(rows.filter((r) => picked.has(key(r)))) : setError('Tick the samples to add.'))} onClose={() => onDone(null)}>
      <div className="addlist">{rows.map((r) => (
        <label key={key(r)} className="cb"><Form.Check.Input type="checkbox" value={key(r)} checked={picked.has(key(r))} onChange={() => flip(key(r))} />
          {' '}<b>{r.sample_code || r.client_sample_id}</b> {r.client_name || ''}{r.matrix ? ' · ' + r.matrix : ''}{r.due_date ? ' · due ' + day(r.due_date) : ''}
          {r.priority !== 'Standard' && <> <span className="badge text-bg-secondary">{r.priority}</span></>}{r.is_media && <> <span className="badge text-bg-secondary">Lot QA testing</span></>}{r.kind === 'Re-prep' ? ` (re-prep ×${r.replicates})` : ''}</label>
      ))}</div>
    </Modal>
  );
}
export async function addSamples(ctx) {
  const { b } = ctx;
  let rows;
  try { rows = (await api.batchPool(b.id)).rows; } catch (e) { fail(ctx)(e); return; }
  if (!rows.length) { ctx.toast(`Nothing of ${b.test_name} is waiting in the backlog.`, 'err'); return; }
  const sel = await ctx.dialogs.open((done) => <AddSamplesDialog b={b} rows={rows} onDone={done} />);
  if (!sel) return;
  const items = sel.map((r) => ({ requested_test_id: r.requested_test_id, reprep_request_id: r.reprep_request_id || null }));
  try { const r = await api.addToBatch(b.id, items); ctx.toast(`${r.added} sample${Number(r.added) === 1 ? '' : 's'} added to ${b.batch_code}.`); ctx.reload(); } catch (e) { fail(ctx)(e); }
}
export async function removeSamples(ctx, selected) {
  const { b } = ctx;
  const pick = [...new Map(selected.filter((r) => r.entry_type === 'Sample' && r.status === 'Active').map((r) => [r.requested_test_id + ':' + (r.reprep_request_id || ''), r])).values()];
  if (!pick.length) { ctx.toast('Select the sample rows to remove first (click a row; Ctrl+click to add more).', 'err'); return; }
  if (!(await ctx.dialogs.confirm(`Remove from ${b.batch_code}`, `Remove ${pick.map((r) => r.label).join(', ')} from the batch? ${pick.length === 1 ? 'It goes' : 'They go'} back to the backlog; the batch's QC follows the number of samples.`, 'Remove'))) return;
  let n = 0; const failed = [];
  for (const r of pick) {
    try { await api.removeEntry(r.entry_id || r.id); n++; } catch (e) { failed.push(`${r.label}: ${e.message}`); }
  }
  if (n) ctx.toast(`${n} sample${n === 1 ? '' : 's'} removed: back in the backlog.`);
  if (failed.length) ctx.toast(failed.join(' | '), 'err');
  ctx.reload();
}

// ---------------------------------------------------------------- review and picks
// The reviewer approves a step (or undoes the approval): a recorded click, not a signature
export async function markStep(ctx, stepRunId, undo) {
  try { await api.reviewMark(ctx.b.id, stepRunId, undo); ctx.toast(undo ? 'Step approval undone.' : 'Step approved.'); ctx.reload(); } catch (e) { fail(ctx)(e); }
}

// the analyst picks the reading reported for the sample (all analytes, or one), with a note
export async function pickReading(ctx, s, row) {
  const { d } = ctx;
  if (!row) { ctx.toast('Select the reading to report first (click its row).', 'err'); return; }
  const e = d.entries.find((x) => x.id === row.entry_id);
  if (!e || e.entry_type !== 'Sample') { ctx.toast('Pick a sample\'s reading (QC readings are judged, not picked).', 'err'); return; }
  if (isPast(e)) { ctx.toast(`${e.label} was re-prepped: its readings are kept here but cannot be reported.`, 'err'); return; }
  const f = readingDilution(d, s, row);
  const m = await ctx.dialogs.form({ title: `Report ${rlabel(e.label, row.run_no)}`, okText: 'Pick it',
    intro: `Reading ${row.run_no} of ${e.label}${f ? `, made at ×${nfmt(+f.toPrecision(6))}` : ''}. QC Review reports it unless the reviewer chooses otherwise; your note goes with it.`,
    fields: [{ name: 'analyte_id', label: 'For', type: 'select', blank: false, value: '', options: [{ value: '', label: 'Every analyte of the sample' }, ...d.analytes.map((a) => ({ value: a.analyte_id, label: a.analyte_name }))] },
      { name: 'note', label: 'Why this reading (e.g. run 1 was over the calibration range)', type: 'textarea', required: true }] });
  if (!m) return;
  try { await api.pickReading(e.id, { run_no: row.run_no, analyte_id: m.analyte_id || null, note: m.note }); ctx.toast('Picked: QC Review will report this reading.'); ctx.reload(); } catch (err) { fail(ctx)(err); }
}

// Tick one reading (a justification when there are several) or several to report their average
export async function chooseReading(ctx, x, key = null) {
  const cur = (c) => (x.mode === 'Average' ? (x.readings || []).some((y) => y.entry_id === c.entry_id && Number(y.run_no) === Number(c.run_no))
    : c.entry_id === x.chosen_entry_id && Number(c.run_no) === Number(x.chosen_run_no));
  const m = await ctx.dialogs.form({ title: `Reportable result: ${x.sample_label} ${x.analyte_name}`, okText: 'Save', wide: true,
    intro: <>Tick <b>one</b> reading to report it, or <b>several</b> to report their average. Write why: a justification is required when one reading is picked from several, or when readings are left out of the average. It is kept with your name.</>,
    fields: [...x.candidates.map((c, i) => ({ name: 'c' + i, type: 'checkbox', label: '', value: !x.auto_chosen && cur(c),
      cbLabel: `${c.label} · run ${c.run || 1} · ${c.reported ?? c.value_text ?? nfmt(c.value)}` })),
      { name: 'justification', label: 'Justification', type: 'textarea', value: x.justification || '' }] });
  if (!m) return;
  const ticked = x.candidates.filter((c, i) => m['c' + i]);
  if (!ticked.length) { ctx.toast('Tick a reading (or several for their average).', 'err'); return; }
  const row = { requested_test_id: x.requested_test_id, analyte_id: x.analyte_id, result_key: key, justification: m.justification,
    entry_id: ticked[0].entry_id, run_no: Number(ticked[0].run_no), readings: ticked.length > 1 ? ticked.map((c) => ({ entry_id: c.entry_id, run_no: Number(c.run_no) })) : null };
  try { await api.chooseResult(ctx.b.id, [row]); ctx.toast(ticked.length > 1 ? 'The average will be reported.' : 'Reportable reading saved.'); ctx.reload(); } catch (e) { fail(ctx)(e); }
}

// The customer's decision on a split-off test (people who handle orders)
export async function decideSplit(dialogs, toast, r, decision, after) {
  const m = await dialogs.form({ title: `${decision}: ${r.test_name} on ${r.sample_code || r.client_sample_id}`, okText: 'Record',
    intro: `Finding: ${r.finding || ''}. Record who decided and how (e.g. "Sam Nguyen, email 13 Oct").`,
    fields: [{ name: 'note', label: 'Note', type: 'textarea', required: decision === 'Declined' }],
    submit: (v) => api.decideSplit(r.id, decision, v.note) });
  if (!m) return;
  toast(`${decision} recorded.`); after?.();
}
