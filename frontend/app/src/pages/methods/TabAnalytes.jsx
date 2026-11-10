// Designer tab 2: Analytes. One grid; each save signed (Created by for new rows, Changed by with a reason for changes).
import { useMemo } from 'react';
import { saveAnalytes } from '../../api/methods.js';
import EditableGrid from '../../components/EditableGrid.jsx';
import Section from '../../components/Section.jsx';
import { RESULT_TYPES, ROUNDING } from './shared.jsx';

const list = (v) => (Array.isArray(v) ? v.join(', ') : v ?? '');

function columnsFor(L) {
  const aOpts = L.analytes.map((a) => ({ value: a.id, label: a.analyte_name, match: [a.analyte_code] }));
  return [
    { field: 'sort_order', title: '#', type: 'int', width: 45 },
    { field: 'analyte_id', title: 'Analyte', type: 'select', width: 230, required: true, options: aOpts, editable: (r, isNew) => isNew, format: (v, r) => r.analyte_name || (aOpts.find((o) => o.value === v)?.label ?? '') },
    { field: 'result_type', title: 'Result', type: 'select', options: RESULT_TYPES, width: 105, help: 'Numeric, Qualitative (Absent/Present), Count, or Text (e.g. an identification)' },
    { field: 'reporting_unit', title: 'Unit', type: 'select', options: L.units, width: 90, help: 'Reporting unit, from Admin > Units. Numeric and Count results need one.' },
    { field: 'loq', title: 'LOQ', type: 'number', width: 80 },
    { field: 'hide_loq', title: 'Hide LOQ', type: 'bool', width: 70, editable: (r) => !r.hide_on_report, help: 'The LOQ is not printed on the report (the "< LOQ" result still is)' },
    { field: 'lod', title: 'LOD', type: 'number', width: 80 },
    { field: 'hide_lod', title: 'Hide LOD', type: 'bool', width: 70, editable: (r) => !r.hide_on_report, help: 'The LOD is not printed on the report' },
    { field: 'uncertainty', title: 'Uncertainty ±', type: 'number', width: 95, help: 'Measurement uncertainty: a value in the result\'s unit, or a % of the result (next column)' },
    { field: 'uncertainty_kind', title: '± as', type: 'select', options: [{ value: 'Unit', label: 'unit' }, { value: '%', label: '% of result' }], width: 90 },
    { field: 'report_uncertainty', title: 'Report ±', type: 'bool', width: 70, help: 'Print it on the COA beside the result (e.g. 0.52 ± 0.04 mg/kg). Untick to keep it on file only.' },
    { field: 'rounding_mode', title: 'Own rounding', type: 'select', options: ['', ...ROUNDING], width: 150, help: 'Leave empty to use the version\'s rounding (tab 1)' },
    { field: 'rounding_digits', title: 'Digits', type: 'int', min: 0, max: 10, width: 60 },
    { field: 'result_values', title: 'Result values', type: 'array', width: 170, format: list,
      help: 'Qualitative results only: the values the analyst can enter, in order, separated by commas (e.g. ND, ND*, D*, D). Default Absent, Present.' },
    { field: 'found_values', title: 'Means found', type: 'array', width: 110, format: list,
      help: 'Which of the result values mean something was found (e.g. D*, D). A split-off on a finding reacts to these.' },
    { field: 'invalid_values', title: 'Not a result', type: 'array', width: 150, format: list,
      help: 'Result values that are not results (e.g. Indeterminate, Signal error). They can never be reported: the sample, or control, is read again in a new analytical run before the batch can be approved.' },
    { field: 'hide_on_report', title: 'Hide analyte', type: 'bool', width: 75, help: 'Still analysed and kept, just not on the report (e.g. a 100-analyte method reporting 5 for one client). Its own LOQ / LOD boxes then do not apply.' },
    { field: 'default_spec_min', title: 'Suggested min', type: 'number', width: 100 },
    { field: 'default_spec_max', title: 'Suggested max', type: 'number', width: 100 },
    { field: 'default_spec_text', title: 'Suggested text limit', width: 200 },
    { field: 'status', title: 'On test', type: 'select', options: ['Active', 'Inactive'], width: 80, help: 'Set Inactive to remove the analyte from this draft' },
  ];
}

export default function TabAnalytes({ d, reload }) {
  const ed = d.editable; const t = d.test; const v = d.version;
  const columns = useMemo(() => columnsFor(d.lists), [d.lists]);
  const n = d.analytes.length;
  const newRow = useMemo(() => () => ({ result_type: 'Numeric', status: 'Active', sort_order: n + 1, result_values: ['Absent', 'Present'], found_values: ['Present'] }), [n]);
  const sign = useMemo(() => (rows) => ({ meaning: rows.some((r) => r.id) ? 'Changed by' : 'Created by', action: `Analytes: ${t.test_code} ${t.test_name}, version ${v.version_no}` }), [t, v]);
  return (
    <Section title="Analytes" help="What the test reports. Type to pick an analyte, paste rows from Excel, fill down with Ctrl+D. The suggested limit is offered when a client or quote has none; it is never applied by itself (no limit = unspecified).">
      <EditableGrid rows={d.analytes} columns={columns} allowAdd={ed} readOnly={!ed} what="analytes" sign={sign} newRow={newRow}
        save={(rows, reason, signature) => saveAnalytes(v.id, rows, reason, signature)} afterSave={reload} />
    </Section>
  );
}
