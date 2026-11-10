// A logbook's Design tab: settings (not versioned, saved with a reason), the fields of the Draft or Effective version
// (versioned, approved by QA with a signature) and the versions.
import { useMemo, useState } from 'react';
import { approveLogbookDesign, newLogbookVersion, saveLogbookFields, saveLogbookSettings } from '../../api/logbooks.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import EditableGrid from '../../components/EditableGrid.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import Section from '../../components/Section.jsx';
import SmartSelect from '../../components/SmartSelect.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { dt, KINDS } from './calc.js';

const TYPES = ['Number', 'Text', 'Choice', 'Pass/Fail', 'Date/time', 'Equipment', 'Lot', 'Calculated'];
const SETTING_KEYS = ['logbook_name', 'kind', 'subject', 'entry_frequency', 'review_frequency', 'review_route', 'signing', 'validity_hours', 'creates_lot', 'lot_name', 'lot_unit', 'status', 'description'];
const o = (list) => list.map((x) => (typeof x === 'object' ? x : { value: x, label: x }));
const SELECTS = {
  kind: o(KINDS),
  subject: o([{ value: 'Equipment', label: 'A piece of equipment' }, { value: 'Lot', label: 'An inventory lot' }, { value: 'Sample', label: 'A sample' }, { value: 'None', label: 'Nothing in particular' }]),
  entry_frequency: o(['Daily', 'Weekly', 'Monthly', 'As needed']),
  review_frequency: o(['Daily', 'Weekly']),
  review_route: o([{ value: 'Logbook', label: 'In the logbook (QA)' }, { value: 'Batch', label: 'In the batch that uses it' }]),
  signing: o([{ value: 'Signature', label: 'Signed' }, { value: 'Recorded', label: 'Recorded (no signature)' }]),
  creates_lot: o([{ value: 'false', label: 'No' }, { value: 'true', label: 'Yes (e.g. an inoculum)' }]),
  status: o(['Active', 'Inactive']),
};
const FIELD_COLS = [
  { field: 'sort_order', title: 'Order', type: 'int', width: 60 },
  { field: 'label', title: 'Label', type: 'text', width: 200, required: true },
  { field: 'field_key', title: 'Key (formulas)', type: 'text', width: 140, help: 'Made from the label when left empty' },
  { field: 'field_type', title: 'Type', type: 'select', width: 110, options: TYPES, required: true },
  { field: 'unit', title: 'Unit', type: 'text', width: 70 },
  { field: 'limit_min', title: 'Lower limit', type: 'number', width: 90 },
  { field: 'limit_max', title: 'Upper limit', type: 'number', width: 90 },
  { field: 'equipment_limits', title: 'Per equipment', type: 'bool', width: 95 },
  { field: 'required', title: 'Required', type: 'bool', width: 80 },
  { field: 'choices', title: 'Choices (a; b)', type: 'array', width: 160 },
  { field: 'formula', title: 'Formula', type: 'text', width: 280 },
  { field: 'publish', title: 'Published (lot value)', type: 'bool', width: 130 },
  { field: 'help', title: 'Help', type: 'text', width: 200 },
  { field: 'status', title: 'Status', type: 'select', width: 85, options: ['Active', 'Inactive'] },
];
const FIELD_COLS_RO = FIELD_COLS.map((c) => ({ ...c, type: c.type === 'bool' ? 'bool' : c.type === 'array' ? 'array' : 'readonly' }));
const VERSION_COLS = [
  { field: 'version_no', title: 'Version', type: 'readonly', width: 70 },
  { field: 'status', title: 'Status', type: 'readonly', width: 100 },
  { field: 'change_summary', title: 'Change', type: 'readonly', width: 300 },
  { field: 'created_by_name', title: 'Started by', type: 'readonly', width: 160 },
  { field: 'approved_by_name', title: 'Approved by (QA)', type: 'readonly', width: 160 },
  { field: 'approved_at', title: 'Approved', type: 'readonly', width: 170, format: (v) => dt(v) },
];

export default function DesignTab({ d, l, eff, draftF, reload }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const draft = d.versions.find((v) => v.status === 'Draft');
  const effV = d.versions.find((v) => v.status === 'Effective');
  const editable = !!draft && d.can_design;
  const errors = d.problems.filter((p) => p.severity === 'Error');
  const ro = !d.can_design;
  const [s, setS] = useState(() => Object.fromEntries(SETTING_KEYS.map((k) => [k, k === 'creates_lot' ? String(!!l[k]) : k === 'lot_unit' ? l[k] || 'mL' : l[k] ?? ''])));
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setS((x) => ({ ...x, [k]: v }));
  const rows = useMemo(() => (draft ? draftF : eff).map((f) => ({ ...f, choices: f.choices || [] })), [draft, draftF, eff]);
  const newField = () => ({ field_type: 'Number', required: true, equipment_limits: false, publish: false, status: 'Active', sort_order: (rows.length + 1) * 10, choices: [] });

  async function saveSettings() {
    if (busy) return;
    const reason = await dialogs.reason(`the settings of ${l.logbook_code}`); if (reason === null) return;
    setBusy(true);
    try { await saveLogbookSettings(l.id, { ...s, reason }); toast('Settings saved.'); reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  }
  async function newVersion() {
    const m = await dialogs.form({ title: `New version of ${l.logbook_code}`, okText: 'Start it', intro: 'The fields are copied from the Effective version into a Draft. Entries keep using the Effective version until QA approves the new one.',
      fields: [{ name: 'summary', label: 'What changes', required: true }],
      submit: (v) => newLogbookVersion(l.id, { summary: v.summary, reason: 'New version: ' + v.summary }) });
    if (m) { toast('Draft started.'); reload(); }
  }
  async function approve() {
    const r = await dialogs.sign({ what: `Design version ${draft.version_no} of ${l.logbook_code} ${l.logbook_name}`, meaning: 'Approved by', needReason: false,
      submit: ({ signature }) => approveLogbookDesign(l.id, signature) });
    if (r) { toast('Design approved: entries now use it.'); reload(); }
  }

  const input = (k, type = 'text') => <input type={type} value={s[k]} disabled={ro} onChange={(e) => set(k)(e.target.value)} />;
  const pick = (k) => <SmartSelect value={String(s[k])} options={SELECTS[k]} onChange={set(k)} disabled={ro} />;
  const fld = (label, control) => <div className="field"><label>{label}</label>{control}</div>;

  return <>
    <Section title="Settings" help="Who it is for and how it is reviewed. Not versioned: a change is kept in the audit trail with its reason."
      actions={d.can_design && <button type="button" className="btn" onClick={saveSettings} disabled={busy}>Save settings</button>}>
      <div className="lb-set">
        {fld('Name', input('logbook_name'))}
        {fld('Kind', pick('kind'))}
        {fld('Each entry is about', pick('subject'))}
        {fld('Entries due', pick('entry_frequency'))}
        {fld('QA approves entries', pick('review_frequency'))}
        {fld('Reviewed', pick('review_route'))}
        {fld('Entries are', pick('signing'))}
        {fld('Usable for (hours)', input('validity_hours', 'number'))}
        {fld('Each entry makes a lot', pick('creates_lot'))}
        {fld('Name of the lots it makes', input('lot_name'))}
        {fld('Unit of those lots', input('lot_unit'))}
        {fld('Status', pick('status'))}
        <div className="field" style={{ gridColumn: '1 / -1' }}><label>What it is for</label>
          <textarea rows={2} value={s.description} disabled={ro} onChange={(e) => set('description')(e.target.value)} /></div>
      </div>
    </Section>
    <Section title={draft ? `Design version ${draft.version_no} (Draft)` : effV ? `Design version ${effV.version_no} (Effective)` : 'Design'}
      help={draft ? 'Fields in the order they are entered. A Calculated field uses the fields before it ({nominal_g}) or a value published on a Lot field\'s lot ({culture_lot.passage}). Limits make an entry Pass or Fail; per equipment when the limits differ by unit (Equipment covered).'
        : 'Approved and locked: entries use it. Start a new version to change it; QA approves it before it replaces this one.'}
      actions={<>
        {!draft && d.can_design && <button type="button" className="btn" onClick={newVersion}>New version</button>}
        {draft && d.can_review && <button type="button" className="btn primary" onClick={approve} disabled={errors.length > 0} title={errors.length ? 'Fix the errors listed first' : undefined}>Approve design (QA)</button>}
      </>}>
      {draft && <ul className="lb-probs">{d.problems.length
        ? d.problems.map((p, i) => <li key={i} className={p.severity}>{p.severity}: {p.problem}</li>)
        : <li className="ok">No problems found: ready for QA to approve.</li>}</ul>}
      <div style={{ marginTop: 8 }}>
        {editable
          ? <EditableGrid rows={rows} columns={FIELD_COLS} allowAdd newRow={newField} what={`the design of ${l.logbook_code}`}
            save={(changed, reason) => saveLogbookFields(l.id, changed, reason)} afterSave={reload} />
          : <ReadGrid rows={rows} columns={FIELD_COLS_RO} emptyText="No fields yet." />}
      </div>
    </Section>
    <Section title="Versions"><ReadGrid rows={d.versions} columns={VERSION_COLS} /></Section>
  </>;
}
