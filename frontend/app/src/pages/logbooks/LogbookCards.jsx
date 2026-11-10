// Logbook cards other pages show. Each draws nothing when it has nothing to show (or its request fails), as before.
//   <EquipmentLogbooksCard equipmentId />              equipment page: its logbooks, recent entries, open failures
//   <LotLogbookCard lotId />                            inventory lot page: entries about the lot
//   <StudyExcursionsCard studyId />                     stability study page: chamber excursions
//   <EquipmentFlagsCard batchId can stepRunIds onAccepted />  QC Review: equipment flagged by its logbook
//   <AliquotsCard batchId />                            QC Review: weighed aliquots of the batch's samples
import { useMemo } from 'react';
import { acceptEquipmentFlag, batchAliquots, batchEquipmentFlags, logbooksForEquipment, logbooksForLot, studyExcursions } from '../../api/logbooks.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { dt, fmtN, loc, resultClass } from './calc.js';
import './logbooks.css';

const quiet = (p) => p.catch(() => null);
const keyed = (rows) => (rows || []).map((x, i) => ({ ...x, key: i }));
const failRow = (x) => (x.result === 'Fail' ? 'lb-fail' : '');

// ---------------------------------------------------------------- the equipment page
const EQ_COLS = [
  { field: 'entry_code', title: 'Entry', type: 'link', width: 105, href: (x) => '#/logbooks/entries/' + x.id },
  { field: 'logbook_code', title: 'Logbook', type: 'link', width: 85, href: (x) => '#/logbooks/' + x.logbook_id },
  { field: 'entry_local', title: 'When', type: 'readonly', width: 125, format: (v) => loc(v) },
  { field: 'summary', title: 'Values', type: 'readonly', width: 380 },
  { field: 'result', title: 'Result', type: 'readonly', width: 65, cellClass: resultClass },
  { field: 'failure_reason', title: 'Reason', type: 'readonly', width: 240 },
  { field: 'status', title: 'Status', type: 'readonly', width: 90 },
];
export function EquipmentLogbooksCard({ equipmentId }) {
  const { data: d } = useApi((o) => quiet(logbooksForEquipment(equipmentId, o)), [equipmentId]);
  if (!d || (!d.logbooks.length && !d.entries.length)) return null;
  return (
    <Section title="Logbooks" help="Checks and readings of this equipment (Testing > Logbooks).">
      {d.open_failures.length > 0 && <div className="lb-failbox"><b>Failing:</b> {d.open_failures.map((f, i) => (
        <span key={i}>{i > 0 && <br />}<a href={'#/logbooks/entries/' + f.logbook_entry_id}>{f.entry_code}</a> ({f.logbook_name}, {dt(f.entry_at)}): {(f.problems || []).join('; ')}; reason: {f.failure_reason || ''}</span>
      ))}<div className="lb-note">No passing entry since: batch steps using it are flagged in QC Review.</div></div>}
      <div className="lb-due">{d.logbooks.map((x) => (
        <span key={x.id} className={x.due ? '' : 'ok'}><a href={`#/logbooks/${x.id}?tab=record`}>{x.logbook_code}</a> {x.logbook_name}: {x.last_result ? 'last ' + x.last_result : 'no entry yet'}{x.due ? ', due now' : ''}</span>
      ))}</div>
      <ReadGrid rows={d.entries} columns={EQ_COLS} emptyText="No entries yet." rowClass={failRow} />
    </Section>
  );
}

// ---------------------------------------------------------------- the lot page
const LOT_COLS = [
  { field: 'entry_code', title: 'Entry', type: 'link', width: 105, href: (x) => '#/logbooks/entries/' + x.id },
  { field: 'logbook_code', title: 'Logbook', type: 'link', width: 85, href: (x) => '#/logbooks/' + x.logbook_id },
  { field: 'entry_local', title: 'When', type: 'readonly', width: 125, format: (v) => loc(v) },
  { field: 'summary', title: 'Values', type: 'readonly', width: 420 },
  { field: 'result', title: 'Result', type: 'readonly', width: 65, cellClass: resultClass },
  { field: 'valid_until', title: 'Usable until', type: 'readonly', width: 160, format: (v, x) => (v ? dt(v) + (x.expired ? ' (expired)' : '') : '') },
  { field: 'status', title: 'Status', type: 'readonly', width: 160, compute: (x) => (x.status === 'Approved' ? `Approved by ${x.approved_by_name || ''}` : x.status) },
];
export function LotLogbookCard({ lotId }) {
  const { data: d } = useApi((o) => quiet(logbooksForLot(lotId, o)), [lotId]);
  if (!d || !d.entries.length) return null;
  return (
    <Section title="Logbook entries" help="Entries about this lot. A value published by an approved entry inside its validity can be used by a formula at the bench when the lot is scanned.">
      <ReadGrid rows={d.entries} columns={LOT_COLS} />
    </Section>
  );
}

// ---------------------------------------------------------------- the stability study page
const EXC_COLS = [
  { field: 'entry_code', title: 'Entry', type: 'link', width: 105, href: (x) => '#/logbooks/entries/' + x.logbook_entry_id },
  { field: 'equipment_code', title: 'Chamber', type: 'link', width: 250, href: (x) => '#/equipment/' + x.equipment_id, compute: (x) => `${x.equipment_code} ${x.equipment_name}` },
  { field: 'storage_code', title: 'Material', type: 'readonly', width: 120 },
  { field: 'entry_at', title: 'When', type: 'readonly', width: 160, format: (v) => dt(v) },
  { field: 'problems', title: 'Reading', type: 'readonly', width: 260, compute: (x) => (x.problems || []).join('; ') },
  { field: 'failure_reason', title: 'Reason', type: 'readonly', width: 320 },
  { field: 'window_end', title: 'Back in range', type: 'readonly', width: 160, format: (v) => (v ? dt(v) : 'not yet') },
];
const allFail = () => 'lb-fail';
export function StudyExcursionsCard({ studyId }) {
  const { data: d } = useApi((o) => quiet(studyExcursions(studyId, o)), [studyId]);
  const rows = useMemo(() => keyed(d?.rows), [d]);
  if (!rows.length) return null;
  return (
    <Section title="Chamber excursions" help="Temperature or humidity readings outside the chamber's condition while this study's material was stored in it (from the Temperature log). Assess each for the study.">
      <ReadGrid rows={rows} columns={EXC_COLS} keyField="key" rowClass={allFail} />
    </Section>
  );
}

// ---------------------------------------------------------------- QC Review: equipment flagged by its logbook
// can: the reviewer may accept flags; stepRunIds: only these steps (a timepoint review), else all;
// onAccepted(): after a flag is accepted (the batch page reloads itself)
const unaccepted = (x) => (x.accepted ? '' : 'tbrerun');
export function EquipmentFlagsCard({ batchId, can, stepRunIds = null, onAccepted }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const { data: d, reload } = useApi((o) => quiet(batchEquipmentFlags(batchId, o)), [batchId]);
  const ids = stepRunIds ? stepRunIds.join(',') : null;
  const rows = useMemo(() => keyed((d?.rows || []).filter((x) => !ids || ids.split(',').includes(String(x.step_run_id)))), [d, ids]);
  const columns = useMemo(() => [
    { field: 'equipment_code', title: 'Equipment', type: 'link', width: 95, href: (x) => '#/equipment/' + x.equipment_id },
    { field: 'step_name', title: 'Step', type: 'readonly', width: 170 },
    { field: 'entry_code', title: 'Logbook entry', type: 'link', width: 115, href: (x) => '#/logbooks/entries/' + x.logbook_entry_id },
    { field: 'what', title: 'What failed', type: 'readonly', width: 440, cellClass: () => 'tbfail' },
    { field: 'acc', title: 'Accepted', type: 'readonly', width: 280, compute: (x) => (x.accepted ? `${x.accepted_by_name}: ${x.justification}` : 'Not accepted yet'), cellClass: (x) => (x.accepted ? 'tbpass' : 'tbwait') },
    { field: 'act', title: '', type: 'button', width: 90, label: (x) => (can && !x.accepted ? 'Accept…' : ''), onClick: async (x) => {
      if (!can || x.accepted) return;
      const m = await dialogs.form({ title: `Accept the flag on ${x.equipment_code}`, okText: 'Accept', intro: `${x.what}. Write why the results can still be reported (it is kept with your name).`,
        fields: [{ name: 'justification', label: 'Justification', type: 'textarea', required: true }],
        submit: (v) => acceptEquipmentFlag(batchId, { logbook_entry_id: x.logbook_entry_id, justification: v.justification }) });
      if (!m) return;
      toast('Flag accepted with your justification.');
      reload(); onAccepted?.();
    } },
  ], [can, batchId, dialogs, toast, reload, onAccepted]);
  if (!rows.length) return null;
  return <>
    <h3 style={{ margin: '14px 0 6px' }}>Equipment flagged by its logbook</h3>
    <div className="lb-note" style={{ marginBottom: 6 }}>A check or reading of this equipment failed while the batch used it (from the last passing entry before the failure to the next passing one). Accept each with a justification, or return the batch.</div>
    <ReadGrid rows={rows} columns={columns} keyField="key" rowClass={unaccepted} />
  </>;
}

// ---------------------------------------------------------------- QC Review: weighed aliquots (L-2)
const ALIQ_COLS = [
  { field: 'entry_code', title: 'Aliquot', type: 'link', width: 110, href: (x) => '#/logbooks/entries/' + x.logbook_entry_id },
  { field: 'sample_code', title: 'Sample', type: 'link', width: 125, href: (x) => '#/samples/' + x.sample_id },
  { field: 'weight', title: 'Weight', type: 'readonly', width: 90, align: 'right', format: (v, x) => (v === null ? '' : fmtN(v) + (x.unit ? ' ' + x.unit : '')) },
  { field: 'used', title: 'In this batch', type: 'readonly', width: 190, compute: (x) => (x.used ? `Used for ${x.entry_label}${x.corrected ? ` (scanned at ${fmtN(x.used_weight)}: corrected since)` : ''}` : 'Not used'), cellClass: (x) => (x.corrected ? 'tbfail' : '') },
  { field: 'balance_code', title: 'Balance', type: 'link', width: 200, href: (x) => (x.balance_id ? '#/equipment/' + x.balance_id : null), compute: (x) => (x.balance_code ? `${x.balance_code} ${x.balance_name}` : '') },
  { field: 'calibration', title: 'Calibration then', type: 'readonly', width: 240, cellClass: (x) => (/^Out|failed|No calibration/.test(x.calibration || '') ? 'tbfail' : '') },
  { field: 'weighed_by_name', title: 'Weighed by', type: 'readonly', width: 150 },
  { field: 'weighed_at', title: 'When', type: 'readonly', width: 160, format: (v) => dt(v) },
  { field: 'entry_status', title: 'Status', type: 'readonly', width: 100 },
];
const aliqRow = (x) => (x.corrected || x.entry_status === 'Voided' ? 'tbrerun' : !x.used ? 'mutedrow' : '');
export function AliquotsCard({ batchId }) {
  const { data: d } = useApi((o) => quiet(batchAliquots(batchId, o)), [batchId]);
  const rows = useMemo(() => keyed(d?.rows), [d]);
  if (!rows.length) return null;
  return <>
    <h3 style={{ margin: '14px 0 6px' }}>Weighed aliquots (sample weights logbook)</h3>
    <div className="lb-note" style={{ marginBottom: 6 }}>Reviewed here, not by QA in the logbook: check each weight's source. Repeat weighings and aliquots not used are listed too. Approving the batch reviews the aliquots it used; the reviewer may not be the person who weighed them.</div>
    <ReadGrid rows={rows} columns={ALIQ_COLS} keyField="key" rowClass={aliqRow} />
  </>;
}
