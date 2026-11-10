// Parts shared by the Workflow Designer screens (methods.js in the current app).
import { useCallback } from 'react';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import SmartSelect from '../../components/SmartSelect.jsx';
import './methods.css';

export const STEP_TYPES = ['Batching', 'Weighing', 'Preparation', 'Plating/Inoculation', 'Incubation', 'Dilution', 'Split off Test', 'Hold Point', 'Calculation', 'Data Entry', 'QC Review'];
export const TYPE_COLOR = { Batching: '#E3ECFB', Weighing: '#EAF4EE', Preparation: '#F3EEFA', 'Plating/Inoculation': '#FDEFE3', Incubation: '#FFF6D9', Dilution: '#E6F4F7',
  'Split off Test': '#FCE8EC', 'Hold Point': '#EFEFEF', Calculation: '#E8F0E0', 'Data Entry': '#E2F1FF', 'QC Review': '#DDF3E6' };
export const TYPE_HELP = {
  Batching: 'How samples are grouped: the maximum client samples per batch, and the QC each batch carries (with its acceptance criteria). Spiking and materials are added per batch when the work is done.',
  Weighing: 'Each entry is weighed on a balance of this type (the balance actually used is recorded at the bench and must be in calibration). Offers {key.weight} to formulas.',
  Preparation: 'Any preparation (digestion, extraction, titration...). Optional fields are filled once per batch; Number fields can be used in formulas.',
  'Plating/Inoculation': 'Sample onto or into growth media. The media lot is recorded per batch at the bench.',
  Incubation: 'Target temperature and duration with the acceptable window. Time in and out are recorded per load.',
  Dilution: 'Enter what is added (aliquot and diluent), never a factor: the factor is calculated. Offers {key.factor} and {key.final_volume}.',
  'Split off Test': 'Starts another test on the same sample when a finding needs it (e.g. identification when something grows), or when the analyst decides.',
  'Hold Point': 'Waits for a named test on the same sample (e.g. Loss on Drying for a dry-basis result). Offers {key.result}.',
  Calculation: 'A formula from the values of steps before it. One formula for every analyte, with exceptions for some. Offers {key.result}.',
  'Data Entry': 'The reading: entered by hand against the instrument export (attached by default), or a manual observation. Offers {key.reading}.',
  'QC Review': 'Review and approval of the batch (or of a timepoint, on a branch of its own). Reviewers must not have done the work; this is fixed GMP behaviour.',
};
export const ROUNDING = ['Significant figures', 'Decimal places'];
export const RESULT_TYPES = ['Numeric', 'Qualitative', 'Count', 'Text'];

export const d8 = (v) => (v ? String(v).slice(0, 10) : '');
export const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
export const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
export const stepKey = (name) => { let k = slug(name).slice(0, 30); if (!/^[a-z]/.test(k)) k = 's_' + k; return k.slice(0, 30); };
// a number input's text to a number (blank = null)
export const numOf = (s) => (s === '' || s === null || s === undefined ? null : Number(s));
export const str = (v) => (v === null || v === undefined ? '' : String(v));

// [value | {value,label}] → smart dropdown options, with a blank first unless blank is false
export const opts = (list, blank = true) => [...(blank ? [{ value: '', label: '' }] : []),
  ...list.map((o) => (typeof o === 'object' ? { value: o.value ?? '', label: String(o.label) } : { value: o, label: String(o) }))];

// A labelled field (fld() in the old screen)
export function Field({ label, help, req, children }) {
  return <div className="field"><label>{label}{req && <> <span className="req">*</span></>}</label>{children}{help && <div className="help">{help}</div>}</div>;
}
export const Card = ({ label, children }) => <div className="wdcard"><span>{label}</span><b>{children}</b></div>;

// A pick list in a form: a smart dropdown (disabled when the version is read only)
export function Pick({ value, options, onChange, disabled, blank = true, ...rest }) {
  return <SmartSelect value={value ?? ''} options={opts(options, blank)} onChange={onChange} disabled={disabled} {...rest} />;
}

const LIST_TABS = [['#/methods', 'Tests and workflows'], ['#/methods/sops', 'Methods (SOPs)']];
export const ListTabs = ({ cur }) => <div className="wdtabs">{LIST_TABS.map(([h, l]) => <a key={h} href={h} className={h === cur ? 'on' : ''}>{l}</a>)}</div>;

// Every creation and change of a test workflow is signed (migration 015): Created by needs no reason, Changed by does.
// fn(reason, signature) runs while the dialog is open, so a wrong password or a refused change keeps it open.
export function useSigned() {
  const dialogs = useDialogs();
  return useCallback((what, meaning, fn) => dialogs.sign({ what, meaning, needReason: meaning !== 'Created by',
    submit: ({ reason, signature }) => fn(reason, signature) }), [dialogs]);
}

export const NeedLab = () => <div className="card err">Choose your lab (top right) first.</div>;
export const Loading = () => <div className="loading">Loading…</div>;
