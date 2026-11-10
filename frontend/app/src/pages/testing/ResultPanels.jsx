// Live results: a Calculation (or Hold Point) step's results, and the Results and QC tab (final results and QC verdicts)
import { useMemo, useRef } from 'react';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import Section from '../../components/Section.jsx';
import { reprep } from './actions.jsx';
import { humanWaiting, kindOf, lastReadingStep, nfmt, rlabel, runOfReading, sampleHref, SelGrid, verdictClass } from './shared.jsx';

const notAnalytical = (d) => (x) => d.entries.find((e) => e.id === x.entry_id)?.qc_class !== 'Analytical';
const rerunRow = (r) => (r.run_no > 1 ? 'tbrerun' : '');

function ResultTable({ d, res, show, apiRef }) {
  const rows = useMemo(() => {
    const out = []; const by = new Map(); const ls = lastReadingStep(d);
    for (const x of res) {
      const k = `${x.entry_id}:${x.run_no}`;
      if (!by.has(k)) { const e = d.entries.find((y) => y.id === x.entry_id);
        const r = { key: k, entry_id: x.entry_id, run_no: x.run_no, ...e, label: rlabel(e.label, x.run_no), run: ls ? runOfReading(d, ls.id, x.entry_id, x.run_no) : 1, kind: kindOf(e), waiting: new Set() }; by.set(k, r); out.push(r); }
      const r = by.get(k);
      r['a_' + x.analyte_id] = show === 'reported' && x.is_final ? (x.reported ?? '') : nfmt(x.value);
      if (x.waiting) r.waiting.add(humanWaiting(d, x.waiting));
    }
    out.sort((a, b) => a.position - b.position || a.run_no - b.run_no);
    out.forEach((r) => { r.waiting = [...r.waiting].join('; '); });
    return out;
  }, [d, res, show]);
  const columns = useMemo(() => {
    const units = Object.fromEntries(d.analytes.map((a) => [a.analyte_id, a.reporting_unit]));
    return [
      { field: 'position', title: '#', type: 'readonly', width: 40 },
      { field: 'label', title: 'Entry', type: 'link', width: 170, href: sampleHref },
      { field: 'kind', title: 'Type', type: 'readonly', width: 150 },
      { field: 'run', title: 'Run', type: 'readonly', width: 50, help: 'The analytical run the reading came from' },
      ...d.analytes.map((a) => ({ field: 'a_' + a.analyte_id, title: `${a.analyte_name}${units[a.analyte_id] ? ` (${units[a.analyte_id]})` : ''}`, type: 'readonly', width: 115, align: 'right' })),
      { field: 'waiting', title: 'Waiting for', type: 'readonly', width: 260, cellClass: () => 'tbwait' },
    ];
  }, [d]);
  return <SelGrid rows={rows} columns={columns} keyField="key" apiRef={apiRef} emptyText="No results yet." rowClass={rerunRow} />;
}

// Calculated results of a Calculation (or Hold Point) step: the value, rounded and reported as the test says, live
export function CalcGrid({ ctx, s, apiRef }) {
  const { d } = ctx;
  const res = useMemo(() => {
    const key = s.step_type === 'Calculation' ? s.step_key : null;
    return d.results.filter((x) => (key ? x.step_key === key : x.is_final) && notAnalytical(d)(x));
  }, [d, s]);
  return <ResultTable d={d} res={res} apiRef={apiRef} show={s.step_type === 'Calculation' && !res.some((x) => x.is_final) ? 'value' : 'reported'} />;
}

const QC_COLUMNS = [
  { field: 'label', title: 'QC entry', type: 'readonly', width: 180 },
  { field: 'analytical_run', title: 'Run', type: 'readonly', width: 50 },
  { field: 'limit_type', title: 'Check', type: 'readonly', width: 130 },
  { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 120 },
  { field: 'measured', title: 'Measured', type: 'readonly', width: 90, align: 'right', format: (v, r) => (v === null || v === undefined ? '' : nfmt(v) + (['Recovery %', 'RPD'].includes(r.limit_type) ? ' %' : '')) },
  { field: 'limit_text', title: 'Limit', type: 'readonly', width: 120 },
  { field: 'verdict', title: 'Verdict', type: 'readonly', width: 95, cellClass: (r) => verdictClass(r.verdict) },
  { field: 'note', title: 'How', type: 'readonly', width: 380 },
];

export function ResultsPanel({ ctx }) {
  const { d, b, editable } = ctx;
  const gridRef = useRef(null);
  // check standards (ICV, CCV) have no sample result: they are judged on their reading under QC verdicts
  const res = useMemo(() => d.results.filter((x) => x.is_final && notAnalytical(d)(x)), [d]);
  const verdicts = useMemo(() => d.verdicts.map((v, i) => ({ ...v, key: i })), [d]);
  return <>
    {b.status === 'Awaiting Review' && <div className="tbnote">Every bench step is completed: this batch is <b>waiting for QC Review</b> (WD-3).</div>}
    <Section title="Results" help="Final results, calculated live from the bench data and reported as the test says (rounding, LOQ and LOD). Readings 2 and up (RA1-, RA2-...) are re-analyses in added analytical runs; the reviewer chooses what is reported, or the average."
      actions={editable && <button type="button" className="btn" id="rp" onClick={() => reprep(ctx, [...new Set((gridRef.current?.selectedRows() || []).map((r) => r.entry_id))])}>Re-prep selected samples</button>}>
      <ResultTable d={d} res={res} show="reported" apiRef={gridRef} />
    </Section>
    <Section title="QC verdicts" help="Each QC entry judged per analyte against the test's acceptance criteria: recoveries (check standards against the standard used, spikes against the amount spiked), RPD of the spike duplicate, blanks. Waiting means data is still missing.">
      <ReadGrid rows={verdicts} columns={QC_COLUMNS} keyField="key" emptyText="This test has no QC criteria." />
    </Section>
  </>;
}
