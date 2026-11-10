// Specifications of a quoted test or a requested test: one row per analyte of the test version. Empty = unspecified
// (the client gets the result as it is). The lab's suggested limits are offered, never applied by themselves.
//   const saved = await openSpecDialog(dialogs, { quoted_line: id } | { requested_test: id });   // true when saved
import { useEffect, useMemo, useState } from 'react';
import { getSpecs, saveSpecs } from '../api/specs.js';
import { useApi } from '../hooks/useApi.js';
import DataGrid from './grid/DataGrid.jsx';
import { useGrid } from './grid/useGrid.js';
import { useDialogs } from './dialogs/DialogProvider.jsx';
import { useToast } from './Toasts.jsx';
import { Button, Card } from 'react-bootstrap';
import { Dialog } from './Modal.jsx';

const COLUMNS = [
  { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 210 },
  { field: 'result_type', title: 'Result', type: 'readonly', width: 95 },
  { field: 'min_value', title: 'Minimum', type: 'number', width: 95 },
  { field: 'max_value', title: 'Maximum', type: 'number', width: 95 },
  { field: 'text_value', title: 'Text limit', width: 140, help: 'For qualitative results, e.g. Absent in 10 g' },
  { field: 'unit', title: 'Unit', width: 80 },
  { field: 'basis', title: 'Limit is', type: 'select', options: ['As reported', 'Per serving', 'Per package'], width: 115,
    help: 'As reported: against the result. Per serving: the result times the serving weight (unit e.g. mg). Per package: per serving times the servings per package. The sample needs its serving on the order.' },
  { field: 'source', title: 'Set by', type: 'select', options: ['Client', 'Lab', 'Client portal'], width: 110, help: 'Client: the client\'s own limit (the lab reports against it). Lab: the lab proposed it.' },
  { field: 'suggested', title: 'Lab\'s suggested limit', type: 'readonly', width: 230 },
];
const has = (v) => v !== null && v !== undefined;
const suggestedText = (a) => [has(a.default_spec_min) ? `min ${a.default_spec_min}` : '', has(a.default_spec_max) ? `max ${a.default_spec_max}` : '', a.default_spec_text || ''].filter(Boolean).join(', ');
const isEmpty = (r) => (r.min_value === null || r.min_value === '') && (r.max_value === null || r.max_value === '') && !String(r.text_value || '').trim();

function toRows(d) {
  return d.analytes.map((a) => {
    const s = d.specs.find((x) => x.analyte_id === a.analyte_id) || {};
    return { key: a.analyte_id, analyte_id: a.analyte_id, analyte_name: a.analyte_name, result_type: a.result_type, suggested: suggestedText(a), a,
      spec_id: s.id || null, min_value: s.min_value ?? null, max_value: s.max_value ?? null, text_value: s.text_value ?? null,
      unit: s.unit || (s.id ? null : a.reporting_unit), source: s.source || 'Client', basis: s.basis || 'As reported' };
  });
}

function SpecDialog({ owner, onDone }) {
  const { data, error } = useApi(() => getSpecs(owner), [owner.quoted_line, owner.requested_test]);
  const rows = useMemo(() => (data ? toRows(data) : []), [data]);
  const o = data?.owner; const ed = !!o?.editable;
  const grid = useGrid({ rows, columns: COLUMNS, keyField: 'key', readOnly: !ed });
  const { reset, act, state, changes, errorCount } = grid;
  const dialogs = useDialogs(); const toast = useToast();
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { reset(rows); }, [rows, reset]);

  // the lab's suggested limits go into rows that have none (as Lab limits), shown as changes before saving
  function fillSuggested() {
    state.rows.forEach((r, vr) => {
      if (!isEmpty(r) || !r.suggested) return;
      const a = r.a;
      [['min_value', a.default_spec_min ?? null], ['max_value', a.default_spec_max ?? null], ['text_value', a.default_spec_text || null],
        ['unit', a.reporting_unit || null], ['source', 'Lab']].forEach(([f, v]) => act.setCell(vr, COLUMNS.findIndex((c) => c.field === f), null, { value: v }));
    });
  }

  async function save() {
    if (errorCount) return setErr('Fix the cells marked in red first.');
    const changed = new Set(changes.map((x) => x.key));
    const out = [];
    for (const r of state.rows.filter((x) => changed.has(x.key))) {
      const limit = { min_value: r.min_value, max_value: r.max_value, text_value: r.text_value, unit: r.unit, source: r.source, basis: r.basis };
      if (r.spec_id && isEmpty(r)) out.push({ id: r.spec_id, status: 'Inactive' });
      else if (r.spec_id) out.push({ id: r.spec_id, ...limit });
      else if (!isEmpty(r)) out.push({ analyte_id: r.analyte_id, ...limit });
    }
    if (!out.length) return onDone(false);
    let reason = '';
    if (o.kind === 'requested_test' && out.some((x) => x.id)) { reason = await dialogs.reason('the specifications of ' + o.test_code); if (reason === null) return; }
    setBusy(true); setErr('');
    try { await saveSpecs(owner, out, reason); toast('Specifications saved.'); onDone(true); } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <Dialog label="Specifications" xwide onClose={() => onDone(false)}>
      <div className="modal-body">
        {error ? <><h3>Specifications</h3><Card body className="err">{error.message}</Card></> : !data ? <div className="loading">Loading…</div> : <>
          <h3>Specifications: {o.test_code} {o.test_name}{o.sample_code ? ' on ' + o.sample_code : ''}</h3>
          <p className="intro">Limits for each analyte. Leave a row empty for <b>unspecified</b>: the client then receives the result as it is, without a pass or fail.{' '}
            {o.kind === 'quoted_line' ? 'Limits set on the quote are copied to every test ordered from it.' : 'Limits set here apply to this ordered test only.'}
            {!ed && <><br /><b>Read only</b> ({o.kind === 'quoted_line' ? 'the quote is issued, or you cannot change quotes' : 'you cannot change this order\'s tests'}).</>}</p>
          {!data.analytes.length && <div className="alert alert-warning">This test has no analytes in its effective version yet, so no limits can be set.</div>}
          {ed && <div className="actbar"><Button type="button" variant="outline-secondary" onClick={fillSuggested}>Use the lab&apos;s suggested limits for empty rows</Button></div>}
          <DataGrid grid={grid} emptyText="No analytes." />
        </>}
        <div className="merr" role="alert">{err}</div>
        <div className="mbtns">
          <Button type="button" variant="light" onClick={() => onDone(false)}>{ed ? 'Cancel' : 'Close'}</Button>
          {ed && <Button type="button" variant="primary" onClick={save} disabled={busy}>Save</Button>}
        </div>
      </div>
    </Dialog>
  );
}

export const openSpecDialog = (dialogs, owner) => dialogs.open((done) => <SpecDialog owner={owner} onDone={done} />);
