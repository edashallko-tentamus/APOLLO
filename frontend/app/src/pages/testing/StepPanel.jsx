// One step of a batch: its buttons, what was used (equipment, materials, raw data), what is still to do, the analytical
// run tabs of a reading step, the reviewer's step approval, and the step type's own grid or form. The same actions are on
// the grid's right-click menu for the selected rows.
import { useRef } from 'react';
import * as api from '../../api/testing.js';
import Badge from '../../components/Badge.jsx';
import { useSession } from '../../session/SessionProvider.jsx';
import * as A from './actions.jsx';
import { BatchingGrid, DilutionGrid, PlatingGrid, ReadingGrid, WeighingGrid } from './BenchGrids.jsx';
import { IncubationPanel, PreparationForm, SplitPanel } from './MicroPanels.jsx';
import ReviewPanel from './QcReview.jsx';
import { CalcGrid } from './ResultPanels.jsx';
import { BENCH_TYPES, dt, isPast, nfmt, runsAt } from './shared.jsx';
import { Button, Card } from 'react-bootstrap';

const REPREP_TYPES = ['Data Entry', 'Calculation', 'Weighing', 'Preparation', 'Dilution'];
const AUTOSAVE_TYPES = ['Weighing', 'Dilution', 'Data Entry', 'Plating/Inoculation']; // bench grids flushed before Complete step

// In QC Review the reviewer opens each step as the analyst recorded it and approves it here (a recorded click; migration 020)
function ReviewBar({ ctx, s }) {
  const { d, b } = ctx;
  if (s.step_type === 'QC Review' || !(b.status === 'Awaiting Review' || (b.status === 'In Progress' && (d.markable || []).includes(s.id)))) return null;
  const m = (d.review_marks || []).find((x) => x.step_run_id === s.id);
  if (!m) return null;
  const can = d.can_review && !d.performer;
  return (
    <div className={`rvbar ${m.mark_id ? 'ok' : ''}`}>
      <span>{m.mark_id ? <>✓ Approved in QC Review by <b>{m.marked_by_name || ''}</b> {dt(m.marked_at)}</>
        : can ? <><b>QC Review:</b> check this step as recorded, then approve it.</> : 'Waiting for the reviewer to approve this step.'}</span>
      {can && <Button type="button" variant={m.mark_id ? 'outline-secondary' : 'primary'} data-mark={m.mark_id ? 'undo' : 'approve'} onClick={() => A.markStep(ctx, s.id, !!m.mark_id)}>{m.mark_id ? 'Undo' : 'Approve step'}</Button>}
    </div>
  );
}

function Hint({ s, d }) {
  const c = s.config || {};
  if (s.step_type === 'Weighing') {
    if ((c.target_mode === 'Single' || (!c.target_mode && c.target !== undefined && c.target !== null)) && c.target !== null && c.target !== undefined) {
      const pct = c.tolerance_unit === '%'; const lo = c.target - (pct ? c.target * c.tolerance / 100 : c.tolerance || 0); const hi = c.target + (pct ? c.target * c.tolerance / 100 : c.tolerance || 0);
      return <div className="tbnote">Target {nfmt(c.target)} {c.unit || 'g'} ± {nfmt(c.tolerance)} {pct ? '%' : c.unit || 'g'}: accepted {nfmt(lo)} to {nfmt(hi)} {c.unit || 'g'}. Weigh client samples and Prep QC; record the balance used.</div>;
    }
    if (c.target_mode === 'By product category') {
      const cats = (c.by_category || []).map((x) => { const nm = (d.categories || {})[x.category_id] || 'a category'; return x.not_weighed ? `${nm}: not weighed` : `${nm}: ${nfmt(x.min)} to ${nfmt(x.max)} ${c.unit || 'g'}`; });
      return <div className="tbnote">Each sample is checked against the range of its matrix's product category{cats.length ? ' (' + cats.join('; ') + ')' : ''}.{c.qc_not_weighed ? ' Controls are not weighed.' : ''} Record the balance used.</div>;
    }
    return <div className="tbnote">No target weight: weigh as your training and the SOP say. Record the balance used.</div>;
  }
  if (s.step_type === 'Dilution') {
    if (c.mode === 'Serial') return <div className="tbnote">Serial dilution{c.expected_diluent ? ' in ' + c.expected_diluent : ''}. Record each aliquot and diluent; the factor multiplies.</div>;
    return <div className="tbnote">Standard dilution {c.aliquot ? `${nfmt(c.aliquot)} + ${nfmt(c.diluent || 0)} (factor ${nfmt((Number(c.aliquot) + Number(c.diluent || 0)) / Number(c.aliquot))})` : ''}{c.expected_diluent ? ' in ' + c.expected_diluent : ''}. A re-dilution goes in the next pair of columns; the factors multiply.</div>;
  }
  if (s.step_type === 'Data Entry') return <div className="tbnote">Enter {c.value_label || 'the reading'}{c.value_unit && <> in <b>{c.value_unit}</b></>} for each entry. Paste straight from the instrument's Excel export (Ctrl+V). {c.require_attachment === false ? '' : 'Attach the export as raw data. '}Record the check standard used on each ICV and CCV.</div>;
  if (s.step_type === 'Calculation') return <div className="tbnote">Calculated live: <code>{c.formula || ''}</code>{(c.overrides || []).length ? ' (some analytes have their own formula)' : ''}. Completing it confirms the results are complete.</div>;
  if (s.step_type === 'Preparation' && c.procedure_ref) return <div className="tbnote">Procedure: {c.procedure_ref}</div>;
  if (s.step_type === 'Plating/Inoculation') return <div className="tbnote">Record the plates for each entry ({nfmt(c.plates_per_entry || 1)} per entry; 0 = not plated) and the levels plated. Record the media lot used{c.expected_media ? ` (expected: ${c.expected_media})` : ''}; a positive control made from strains also needs its strain lot.</div>;
  if (s.step_type === 'Incubation') return <div className="tbnote">Target {nfmt(c.temp_c)} ± {nfmt(c.temp_tolerance || 0)} °C for {nfmt(c.duration)} {c.duration_unit || 'hours'} (accepted {nfmt(c.window_min)} to {nfmt(c.window_max)} {c.duration_unit || 'hours'}). Put the plates in an incubator as loads: select rows, then <b>Put in an incubator</b>; take each load out when done. A load outside the window or temperature needs a note.</div>;
  if (s.step_type === 'Split off Test') {
    const name = (d.splits.find((x) => x.step_run_id === s.id) || {}).test_name;
    return <div className="tbnote">Completing this step raises a request to order <b>{name || 'the split-off test'}</b> for every sample with a finding{c.trigger === 'Always' ? ' (this step splits off every sample)' : ''}. {c.consent_required === false ? 'No customer consent is needed (step setting): the test is ordered at once from the client\'s accepted quote, or waits as To order when it is not quoted.' : 'The customer\'s consent is recorded on the sample page or the backlog; ordering the test closes the request.'}</div>;
  }
  return null;
}

export default function StepPanel({ ctx, s, run }) {
  const { d, b, editable, toast, dialogs } = ctx;
  const { user, site } = useSession();
  const gridRef = useRef(null); // the step's grid: selectedRows(), flush()
  const before = d.deps.filter((x) => x.step_id === s.step_id).map((x) => d.steps.find((y) => y.step_id === x.depends_on_step_id)).filter(Boolean);
  const waitingFor = before.filter((x) => x.status !== 'Completed');
  const open = s.status !== 'Completed';
  const bench = BENCH_TYPES.includes(s.step_type);
  const canWork = editable && open && !waitingFor.length && bench;
  const cfg = s.config || {};
  const witness = cfg.witness || 'None';
  const T = s.step_type;
  const isEq = ['Weighing', 'Preparation', 'Data Entry', 'Dilution'].includes(T);
  const isMat = ['Weighing', 'Preparation', 'Dilution', 'Data Entry', 'Plating/Inoculation', 'Incubation'].includes(T);
  // a reading step's analytical runs (WD-5): one tab each; equipment and raw data belong to the run shown
  const isRead = T === 'Data Entry';
  const kmax = isRead ? runsAt(d, s.id) : 1;
  const curRun = isRead ? Math.min(Math.max(Number(run) || kmax, 1), kmax) : 1;
  const inRun = (x) => !isRead || Number(x.analytical_run_no || 1) === curRun;

  const rowsSel = () => gridRef.current?.selectedRows() || [];
  // re-prepped entries (shown read only since 0.28.1) take no more work
  const selected = () => [...new Set(rowsSel().filter((r) => !isPast(r)).map((r) => r.entry_id).filter(Boolean))];
  // only re-prepped rows selected: say so (an empty selection would otherwise mean the whole batch)
  const onlyPast = () => { const rs = rowsSel(); if (rs.length && rs.every(isPast)) { toast('The selected samples were re-prepped: they take no more work in this batch.', 'err'); return true; } return false; };
  const H = {
    eq: () => onlyPast() || A.addEquipment(ctx, s, selected(), curRun),
    mat: () => onlyPast() || A.addMaterial(ctx, s, selected()),
    file: () => A.attachFile(ctx, s, curRun),
    rean: () => onlyPast() || A.reanalysis(ctx, s, selected()),
    pick: () => A.pickReading(ctx, s, rowsSel()[0] || null),
    reprep: () => onlyPast() || A.reprep(ctx, selected()),
    complete: async () => {
      // anything typed and not yet autosaved is saved first (0.27.0)
      if (AUTOSAVE_TYPES.includes(T) && gridRef.current && !(await gridRef.current.flush())) { toast('Some values are not saved yet (see the note above the grid): save them before completing the step.', 'err'); return; }
      A.completeStep(ctx, s, user?.username);
    },
    reopen: () => A.reopenStep(ctx, s),
    addsamples: () => A.addSamples(ctx),
    rmsamples: () => A.removeSamples(ctx, rowsSel()),
    aliquot: () => A.scanAliquot(ctx, s),
  };
  const btn = (a, label, primary, title) => <Button key={a} type="button" variant={primary ? 'primary' : 'outline-secondary'} data-a={a} title={title} onClick={H[a]}>{label}</Button>;
  const acts = [];
  if (canWork && isEq) acts.push(btn('eq', 'Add equipment'));
  if (canWork && isMat) acts.push(btn('mat', 'Add material'));
  if (canWork && T === 'Weighing') acts.push(btn('aliquot', 'Scan aliquot'));
  if (canWork && T === 'Data Entry') acts.push(btn('file', 'Attach raw data'));
  if (editable && T === 'Data Entry') acts.push(btn('rean', 'Add analytical run'));
  if (d.can_pick && T === 'Data Entry' && canWork) acts.push(btn('pick', 'Pick reported reading…', false, 'Pick the selected reading as the one reported (with a note)'));
  if (editable && REPREP_TYPES.includes(T)) acts.push(btn('reprep', 'Re-prep'));
  // before bench work starts, the batch's samples can change (no signature: Alex, 2026-10-13)
  if (T === 'Batching' && d.can_edit_samples) acts.push(btn('addsamples', `Add samples${d.backlog_waiting ? ` (${d.backlog_waiting} waiting)` : ''}`), btn('rmsamples', 'Remove selected samples'));
  if (canWork) acts.push(btn('complete', 'Complete step', true));
  if (editable && !open && bench) acts.push(btn('reopen', 'Reopen'));

  const remove = async (kind, id) => { try { await api.removeUsed(kind, id); toast('Removed.'); ctx.reload(); } catch (e) { toast(e.message, 'err'); } };
  const rm = (kind, id) => (canWork ? <> <button type="button" data-rm={`${kind}:${id}`} title="Remove" onClick={() => remove(kind, id)}>×</button></> : null);
  const label = (eid) => (eid ? d.entries.find((e) => e.id === eid)?.label || '' : 'whole batch');
  const sid = encodeURIComponent(site?.id || '');
  const chips = [
    ...d.equipment_used.filter((x) => x.step_run_id === s.id && inRun(x)).map((x) => <span key={'e' + x.id} className="tbchip">Equipment <b><a href={'#/equipment/' + x.equipment_id}>{x.equipment_code}</a></b> {x.equipment_name} · {label(x.entry_id)}{rm('equipment', x.id)}</span>),
    ...d.materials.filter((x) => x.step_run_id === s.id).map((x) => <span key={'m' + x.id} className="tbchip">{x.purpose} <b><a href={'#/inventory/lots/' + x.lot_id}>{x.lot_code}</a></b> {x.item_name || ''}{x.volume ? ` · ${nfmt(x.volume)} ${x.volume_unit || ''}` : ''}
      {x.logbook_entry_id && <> · <a href={'#/logbooks/entries/' + x.logbook_entry_id}>{x.logbook_entry_code || 'logbook entry'}</a></>} · {label(x.entry_id)}{rm('material', x.id)}</span>),
    ...d.attachments.filter((x) => x.step_run_id === s.id && inRun(x)).map((x) => <span key={'f' + x.id} className="tbchip">Raw data <b><a href={`/api/testing/attachments/${x.id}/file?s=${sid}`}>{x.file_name}</a></b> {x.uploaded_by}{rm('file', x.id)}</span>),
  ];
  const types = (s.equipment_types || []).map((t) => t.type_name + (t.is_main ? ' (main)' : '')).join(', ');

  // right-click on the grid: the same actions for the selected rows
  const onMenu = (canWork || editable) ? (e) => {
    const items = [];
    if (T === 'Batching' && d.can_edit_samples) items.push({ label: 'Remove the selected samples from the batch', onClick: H.rmsamples }, { label: 'Add samples from the backlog…', onClick: H.addsamples });
    if (canWork && isEq) items.push({ label: 'Add equipment to the selected rows', onClick: H.eq });
    if (canWork && isMat) items.push({ label: 'Add material to the selected rows', onClick: H.mat });
    if (editable && T === 'Data Entry') items.push({ label: 'Read the selected rows again in a new analytical run', onClick: H.rean });
    if (d.can_pick && canWork && T === 'Data Entry') items.push({ label: 'Pick this reading as the one reported…', onClick: H.pick });
    if (editable && REPREP_TYPES.includes(T)) items.push({ label: 'Re-prep the selected samples', onClick: H.reprep });
    if (items.length) dialogs.menu(e, items);
  } : undefined;

  const p = { ctx, s, canWork, apiRef: gridRef, onMenu };
  let body;
  if (T === 'Batching') body = <BatchingGrid {...p} />;
  else if (T === 'Weighing') body = <WeighingGrid {...p} />;
  else if (T === 'Preparation') body = <PreparationForm {...p} />;
  else if (T === 'Dilution') body = <DilutionGrid {...p} />;
  else if (T === 'Data Entry') body = <ReadingGrid {...p} curRun={curRun} />;
  else if (T === 'Calculation' || T === 'Hold Point') body = <CalcGrid {...p} />;
  else if (T === 'Plating/Inoculation') body = <PlatingGrid {...p} />;
  else if (T === 'Incubation') body = <IncubationPanel {...p} />;
  else if (T === 'Split off Test') body = <SplitPanel {...p} />;
  else if (T === 'QC Review') body = <ReviewPanel ctx={ctx} s={s} />;
  else body = <div className="tbnote">{T} steps are done at the bench from WD-4 (micro).</div>;

  const curRunInfo = d.runs.find((x) => x.step_run_id === s.id && Number(x.run_no) === curRun);
  return (
    <Card body>
      <div className="tbhead"><div><div className="t">{s.step_name} <Badge status={s.status} /></div>
        <div className="m">{T}{types ? ' · equipment: ' + types : ''}{witness !== 'None' ? ` · witness ${witness.toLowerCase()}` : ''}
          {s.status === 'Completed' && <> · performed by <b>{s.performed_name || ''}</b> {dt(s.completed_at)}{s.witness_name && <>, witnessed by <b>{s.witness_name}</b></>}</>}</div></div>
        <div className="tbacts">{acts}</div></div>
      {s.instructions && <div className="tbnote">{s.instructions}</div>}
      <Hint s={s} d={d} />
      {waitingFor.length > 0 && <div className="tbnote">Starts when {waitingFor.map((x, i) => <span key={x.id}>{i > 0 && ', '}<b>{x.step_name}</b></span>)} {waitingFor.length > 1 ? 'are' : 'is'} completed.</div>}
      {open && !waitingFor.length && bench && s.missing.length > 0 && <div className="tbtodo"><b>Still to do before it can be completed</b><ul>
        {s.missing.slice(0, 8).map((m, i) => <li key={i}>{m}</li>)}{s.missing.length > 8 && <li>and {s.missing.length - 8} more</li>}</ul></div>}
      {isRead && (kmax > 1 || editable) && <>
        <div className="tbtabs tbruns"><span className="lbl">Analytical runs:</span>
          {Array.from({ length: kmax }, (_, i) => i + 1).map((k) => {
            const ar = d.runs.find((x) => x.step_run_id === s.id && Number(x.run_no) === k);
            return <a key={k} href={`#/testing/batches/${b.id}?step=${s.step_key}&run=${k}`} className={k === curRun ? 'on' : ''} title={ar ? `${ar.reason} (${ar.requested_by}, ${dt(ar.created_at)})` : 'The first run'}>Run {k}</a>;
          })}
          {editable && <a href="#" data-a="rean" title="Read chosen samples again in a new run, with the run's own ICV and CCVs" onClick={(e) => { e.preventDefault(); H.rean(); }}>+ Add analytical run</a>}
        </div>
        {kmax > 1 && <div className="help" style={{ margin: '-4px 0 8px' }}>Run {curRun}{curRun > 1 ? `: ${curRunInfo?.reason || ''}` : ''}. Each run has its own readings, raw data file, instrument and analytical QC; the reviewer chooses what is reported.</div>}
      </>}
      {chips.length > 0 && <div className="tbused">{chips}</div>}
      <ReviewBar ctx={ctx} s={s} />
      <div id="body">{body}</div>
    </Card>
  );
}

