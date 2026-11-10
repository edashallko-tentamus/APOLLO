// Sample page: everything about one sample, with links to its order, client, tests and quotes; its results, OOS
// Phase II decisions, serving, photos and COA
import { Fragment, useCallback, useMemo } from 'react';
import * as api from '../../api/orders.js';
import Badge from '../../components/Badge.jsx';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import { usePrintLabels } from '../../components/labels/usePrintLabels.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { money } from '../../lib/format.js';
import { PhotosCard } from '../custody/Custody.jsx';
import { openOos } from '../oos/shared.jsx';
import SampleCoaCard from '../reports/SampleCoaCard.jsx';
import { d8, dt, hasVal, quoteHref, quoteText, unit } from './orderFormat.js';

const pad2 = (n) => String(n).padStart(2, '0');
const loc = (v) => { if (!v) return ''; const x = new Date(v); return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())} ${pad2(x.getHours())}:${pad2(x.getMinutes())}`; };
const alertText = (a) => { const xs = Array.isArray(a) ? a : []; return xs.length ? `${xs.map((x) => x.to_name || x.to_address).join(', ')}, ${loc(xs[0].queued_at)} (${xs[0].by})` : ''; };
const muted = (r) => (r.status === 'Cancelled' ? 'mutedrow' : '');

const TEST_COLUMNS = [
  { field: 'test_name', title: 'Test', type: 'link', width: 200, href: (r) => '#/catalog/' + r.test_id },
  { field: 'quote', title: 'Quote', type: 'link', width: 100, compute: quoteText, href: quoteHref },
  { field: 'analytes', title: 'Analytes', type: 'readonly', width: 80, compute: (r) => (r.pricing_mode === 'Analyte Selection' ? `${r.analytes_included} of ${r.analytes_total}` : '—') },
  { field: 'price', title: 'Price', type: 'money', width: 85 },
  { field: 'rush_tier_name', title: 'Rush tier', type: 'readonly', width: 120, format: (v) => v || 'Standard' },
  { field: 'rush_status', title: 'Rush status', type: 'readonly', width: 120, format: (v) => (v === 'None' ? '' : v) },
  { field: 'rush_fee', title: 'Rush fee', type: 'money', width: 80 },
  { field: 'tat_days', title: 'TAT', type: 'readonly', width: 125, format: (v, r) => (hasVal(v) ? `${v} ${unit(r.tat_unit)} days${hasVal(r.tat_override) ? ' ✎' : ''}` : '') },
  { field: 'day0', title: 'Day 0', type: 'readonly', width: 100, format: d8 },
  { field: 'due_date', title: 'Due', type: 'readonly', width: 100, format: d8 },
  { field: 'status', title: 'Status', type: 'readonly', width: 90 },
];

function Kv({ pairs }) {
  return <dl className="kv">{pairs.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v === null || v === undefined || v === '' ? '—' : v}</dd></Fragment>)}</dl>;
}

export default function SamplePage({ params }) {
  const id = params[0];
  const { data: d, error, reload } = useApi((o) => api.getSample(id, o), [id]);
  if (error && !d) return <div className="card err">{error.message}</div>;
  if (!d) return <div className="loading">Loading…</div>;
  return <SampleView id={id} d={d} reload={reload} />;
}

function SampleView({ id, d, reload }) {
  const s = d.sample; const o = d.order;
  const printLabels = usePrintLabels();
  const nz = (v) => (v === null || v === undefined ? '' : v);
  return <>
    <PageHeader title={`Sample ${s.sample_code || s.client_sample_id || '(not logged)'}`} audit={{ kind: 'sample', id }}
      subtitle={<><a href={'#/orders/' + o.id}>{o.order_code}</a> · <a href={'#/clients/' + o.client_id}>{o.client_code} {o.client_name}</a> · {o.site_code} <Badge status={s.status} /></>}
      actions={<>{s.sample_code && <><button type="button" className="btn" id="labels" onClick={() => printLabels('sample', [s.id])}>Print labels</button>{' '}</>}
        <a className="btn" href={'#/orders/' + o.id}>Edit on the order</a></>} />
    <div className="cols">
      <div className="card"><h2>Sample</h2><Kv pairs={[['Sample ID', s.sample_code || 'Not logged yet'], ['Client sample ID', s.client_sample_id], ['Description', s.description],
        ['Matrix', s.matrix], ['Product', s.product], ['Lot', s.lot], ['Batch', s.batch], ['METRC ID', s.metrc_id || ''], ['Category', s.compliance_category],
        ['Serving', [s.serving_count ? `${Number(s.serving_count)} ${s.serving_count_unit || ''}` : '', s.serving_size ? `${Number(s.serving_size)} ${s.serving_unit || ''}` : ''].filter(Boolean).join(', ') + (s.servings_per_package ? `; ${Number(s.servings_per_package)} per package` : '')]]} /></div>
      <div className="card"><h2>Receipt and turnaround</h2><Kv pairs={[['Amount received', s.quantity_received === null ? '' : `${s.quantity_received} ${s.quantity_unit || ''}`], ['Containers', nz(s.number_of_units)],
        ['Condition', s.condition], ['Temperature', s.receipt_temperature === null ? '' : s.receipt_temperature + ' °C'], ['Preservation', s.preservation],
        ['Logged', s.logged_at ? `${dt(s.logged_at)} by ${s.logged_by_name || ''}` : 'Not logged yet'], ['Due', d8(s.due_date)], ['Value', money(s.sample_value)]]} /></div>
    </div>
    <Section title="Tests" help="Change tests, rush or TAT on the order page.">
      <ReadGrid rows={d.tests} columns={TEST_COLUMNS} rowClass={muted} emptyText="No tests ordered." />
    </Section>
    <Results id={id} s={s} />
    <ServingCard s={s} d={d} reload={reload} />
    <div id="phcard"><PhotosCard sample={{ id, sample_code: s.sample_code, client_sample_id: s.client_sample_id }} /></div>
    <SampleCoaCard sampleId={id} />
  </>;
}

// WD-3: approved results and the batches (links); R-2: the OOS of a nonconforming final result; split-off requests
function Results({ id, s }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const res = useApi((o) => api.sampleResults(id, o), [id]);
  const oos = useApi((o) => api.sampleOos(id, o).catch(() => ({ rows: [], can_open: false })), [id]);
  const r = res.data; const oosFor = oos.data;
  const { reload: rr } = res; const { reload: ro } = oos;
  const reloadAll = useCallback(() => { rr(); ro(); }, [rr, ro]);

  const columns = useMemo(() => {
    if (!oosFor) return [];
    const oosOf = (x) => oosFor.rows.find((y) => y.requested_test_id === x.requested_test_id && y.analyte_id === x.analyte_id);
    const mayOpen = (x) => x.conformance === 'Does not conform' && !x.result_key && x.stage === 'Final' && oosFor.can_open;
    return [
      { field: 'test_name', title: 'Test', type: 'readonly', width: 230 },
      { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 150 },
      // WD-5: a timepoint's result (e.g. day 7) and its stage; a preliminary result is released before the final one
      { field: 'result_name', title: 'Result of', type: 'readonly', width: 140, compute: (x) => x.result_name || 'Final result' },
      { field: 'stage', title: 'Stage', type: 'readonly', width: 190, compute: (x) => (x.stage === 'Preliminary' ? 'Preliminary: not a final result' : 'Final'), cellClass: (x) => (x.stage === 'Preliminary' ? 'flag' : '') },
      { field: 'reported', title: 'Result', type: 'readonly', width: 100, align: 'right' },
      { field: 'unit', title: 'Unit', type: 'readonly', width: 70 },
      { field: 'spec', title: 'Specification', type: 'readonly', width: 150, compute: (x) => (x.spec_text || [hasVal(x.spec_min) ? '≥ ' + x.spec_min : '', hasVal(x.spec_max) ? '≤ ' + x.spec_max : ''].filter(Boolean).join(' and ')) + (x.spec_unit && !x.spec_text ? ' ' + x.spec_unit : '') },
      { field: 'conformance', title: 'Conformance', type: 'readonly', width: 140, cellClass: (x) => (x.conformance === 'Does not conform' ? 'flag' : '') },
      { field: 'oos', title: 'OOS', type: 'button', width: 130, label: (x) => { const y = oosOf(x); return y ? y.oos_code + (y.status === 'Closed' ? ' (closed)' : '') : mayOpen(x) ? 'Open OOS…' : ''; },
        onClick: (x) => {
          const y = oosOf(x); if (y) { window.location.hash = '#/oos/' + y.id; return; }
          if (mayOpen(x)) {
            openOos(dialogs, toast, { requested_test_id: x.requested_test_id, analyte_id: x.analyte_id, batch_id: x.batch_id,
              label: `${x.analyte_name} ${x.reported}${x.unit ? ' ' + x.unit : ''} in ${s.sample_code}` }).catch((e) => toast(e.message, 'err'));
          }
        } },
      { field: 'batch_code', title: 'Batch', type: 'link', width: 105, href: (x) => '#/testing/batches/' + x.batch_id },
      { field: 'approved_by_name', title: 'Approved by', type: 'readonly', width: 150 },
      { field: 'approved_at', title: 'Approved', type: 'readonly', width: 140, format: dt },
    ];
  }, [oosFor, dialogs, toast, s.sample_code]); // eslint-disable-line react-hooks/exhaustive-deps -- mayOpen follows oosFor

  const splitColumns = useMemo(() => {
    const decide = async (x, decision) => {
      const m = await dialogs.form({ title: `${decision}: ${x.test_name} on ${x.sample_code || x.client_sample_id}`, okText: 'Record',
        intro: `Finding: ${x.finding || ''}. Record who decided and how (e.g. "Sam Nguyen, email 13 Oct").`,
        fields: [{ name: 'note', label: 'Note', type: 'textarea', required: decision === 'Declined' }],
        submit: (v) => api.decideSplit(x.id, decision, v.note) });
      if (m) { toast(`${decision} recorded.`); reloadAll(); }
    };
    const can = !!r?.can_decide;
    return [
      { field: 'origin_test_name', title: 'From', type: 'readonly', width: 200 },
      { field: 'batch_code', title: 'Batch', type: 'link', width: 105, href: (x) => '#/testing/batches/' + x.batch_id },
      { field: 'finding', title: 'Finding', type: 'readonly', width: 180 },
      { field: 'test_name', title: 'Test to order', type: 'readonly', width: 200 },
      { field: 'status', title: 'Status', type: 'readonly', width: 130, cellClass: (x) => (['Awaiting consent', 'To order'].includes(x.status) ? 'flag' : '') },
      { field: 'decision_note', title: 'Note', type: 'readonly', width: 220 },
      { field: 'alerts', title: 'Client alerted', type: 'readonly', width: 280, help: 'Presumptive result email: who was told, when, and whose step sent it (the Outbox keeps the email)', compute: (x) => alertText(x.alerts) },
      { field: 'yes', title: '', type: 'button', width: 120, label: (x) => (can && x.status === 'Awaiting consent' ? 'Consent given…' : ''), onClick: (x) => { if (can && x.status === 'Awaiting consent') decide(x, 'Consent given'); } },
      { field: 'no', title: '', type: 'button', width: 90, label: (x) => (can && x.status === 'Awaiting consent' ? 'Declined…' : ''), onClick: (x) => { if (can && x.status === 'Awaiting consent') decide(x, 'Declined'); } },
    ];
  }, [r, dialogs, toast, reloadAll]);

  return <>
    <Section title="Results" help="Approved results (QC Review) with the specification they were compared with, and the batches the sample was tested in. A preliminary result (a timepoint released before the final review) is marked as not final.">
      {res.error && !r ? <div className="help">Results are not available.</div> : !r || !oosFor ? <div className="loading">Loading…</div> : <>
        <ReadGrid rows={r.results} columns={columns} rowClass={(x) => (x.conformance === 'Does not conform' ? 'tbnc' : '')} emptyText="No approved results yet." />
        <div id="rbat" className="help" style={{ marginTop: 8 }}>{r.batches.length > 0 && <>Batches: {r.batches.map((x, i) => <span key={x.id}>{i > 0 && ' · '}<a href={'#/testing/batches/' + x.id}>{x.batch_code}</a> ({x.test_name}, {x.status}{x.entry_status === 'Superseded' ? ', re-prepped' : ''})</span>)}</>}</div>
        {r.splits.length > 0 && <><h3 style={{ margin: '14px 0 6px' }}>Split-off requests</h3><ReadGrid rows={r.splits} columns={splitColumns} /></>}
      </>}
    </Section>
    {oosFor && <Phase2Card s={s} oosFor={oosFor} reload={reloadAll} />}
  </>;
}

// Serving size, Part B (migration 033): what the sample's serving is based on, what still holds results per serving,
// and the request for the serving test when nobody ordered it
function ServingCard({ s, d, reload }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const held = d.serving_held || []; const ordered = d.serving_tests || [];
  if (!held.length && !s.report_per_serving && !s.unit_weight_result_id && !s.density_result_id && !ordered.length) return null;
  const n = (v) => (v === null || v === undefined ? '' : String(Number(v)));
  const has = (role) => ordered.some((x) => x.serving_role === role);
  const needs = (re) => held.some((x) => re.test(x.problem || ''));
  // the unplanned case (033): ask the client for the serving test; their consent (Split-off requests) orders it
  async function request(role) {
    const v = await dialogs.form({ title: `Request the ${role.toLowerCase()} test`, okText: 'Raise the request',
      intro: `The results per serving need the ${role.toLowerCase()} measured. The request waits for the client's consent (it costs extra); record their answer under Split-off requests on this page, and consent orders the test.`,
      fields: [{ name: 'note', label: 'Note (e.g. how the client is being asked)', type: 'textarea' }],
      submit: (x) => api.servingRequest(s.id, role, x.note) });
    if (v) { toast('Request raised: it waits for the client\'s consent.'); reload(); }
  }
  const btnW = !has('Serving weight') && needs(/serving weight/); const btnD = !has('Density') && needs(/density/);
  return (
    <Section title="Serving for results per serving" help="The serving weight and the density come only from their approved tests (Serving weight: the average of the units weighed; Density). Nothing per serving is released before they are measured, approved and used.">
      <div id="servcard">
        <dl className="kv">
          <dt>Results per serving</dt><dd>{s.report_per_serving ? 'Asked for on the order' : 'Not asked for on the order'}</dd>
          <dt>Unit weight</dt><dd>{s.unit_weight_result_id ? `${n(s.unit_weight)} ${s.unit_weight_unit || ''} (measured)` : 'Not measured'}</dd>
          <dt>Density</dt><dd>{s.density_result_id ? `${n(s.density)} ${s.density_unit || ''} (measured)` : 'Not measured'}</dd>
          <dt>Serving tests</dt><dd>{ordered.length ? ordered.map((x) => `${x.test_name} (${x.status})`).join(', ') : 'None ordered'}</dd>
        </dl>
        {held.length > 0 && <div className="notice" id="servheld"><b>Held:</b> {held.map((x) => `${x.test_name}: ${x.problem}`).join('; ')}.</div>}
        {(btnW || btnD) && <p>
          {btnW && <button type="button" className="btn" data-sreq="Serving weight" onClick={() => request('Serving weight')}>Request the serving weight test…</button>}{' '}
          {btnD && <button type="button" className="btn" data-sreq="Density" onClick={() => request('Density')}>Request the density test…</button>}
        </p>}
      </div>
    </Section>
  );
}

// OOS Phase II (migration 028): after a confirmed OOS is released (the OOS email goes out with the COA), the client decides:
// a Phase II retest (ordered here or from the OOS page) or no retest. Either closes the loop; the final COA is then issued.
function Phase2Card({ s, oosFor, reload }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const { rows, columns, isOpen } = useMemo(() => {
    const confirmed = oosFor.rows.filter((x) => x.conclusion === 'OOS confirmed');
    const open = new Set(confirmed.filter((x) => x.client_notified_at && !x.phase2_decision));
    const isOpenRow = (x) => open.has(x);
    const may = (x) => oosFor.can_phase2 && isOpenRow(x);
    async function retest(x) {
      const v = await dialogs.form({ title: `Phase II retest of ${s.sample_code}`, okText: 'Next: sign',
        intro: "A re-prep from the retained sample, billed by QA's determination once its result is approved. The original result stays on the issued COA; the retest makes a new COA version.",
        fields: [{ name: 'replicates', label: 'Replicates', type: 'select', blank: false, value: '1', options: [{ value: '1', label: 'Single' }, { value: '2', label: 'Duplicate' }, { value: '3', label: 'Triplicate' }] }] });
      if (!v) return;
      const done = await dialogs.sign({ what: `${x.oos_code}: order the Phase II retest`, meaning: 'Ordered by', needReason: false,
        submit: ({ signature }) => api.oosRetest(x.id, { kind: 'Client', replicates: v.replicates, response_id: null, signature }) });
      if (done) { toast('Phase II retest ordered: it is in the backlog.'); reload(); }
    }
    async function noRetest(x) {
      const v = await dialogs.form({ title: `${x.oos_code}: no retest`, okText: 'Next: sign',
        intro: 'The client does not want a Phase II retest. This closes the loop: the COA can then be issued as the final report (Report Finalization, "Final COA due").',
        fields: [{ name: 'note', label: 'How the client told us (e.g. email of 14 Oct from J. Smith)', type: 'textarea', required: true }] });
      if (!v) return;
      const done = await dialogs.sign({ what: `${x.oos_code}: client's Phase II decision, no retest`, meaning: 'Recorded by', needReason: false,
        submit: ({ signature }) => api.oosPhase2(x.id, { note: v.note, signature }) });
      if (done) { toast('Recorded: no retest. Issue the final COA from Report Finalization.'); reload(); }
    }
    return { rows: confirmed, isOpen: isOpenRow, columns: [
      { field: 'oos_code', title: 'OOS', type: 'link', width: 110, href: (x) => '#/oos/' + x.id },
      { field: 'test_name', title: 'Test', type: 'readonly', width: 200 },
      { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 140 },
      { field: 'reported', title: 'Result', type: 'readonly', width: 100, compute: (x) => `${x.reported || ''}${x.unit ? ' ' + x.unit : ''}` },
      { field: 'client_notified_at', title: 'Client emailed', type: 'readonly', width: 140, format: (v) => (v ? dt(v) : 'Not yet (sent when the COA is issued)') },
      { field: 'phase2_decision', title: 'Phase II', type: 'readonly', width: 200, compute: (x) => (x.phase2_decision ? `${x.phase2_decision}${x.phase2_by_name ? ', ' + x.phase2_by_name : ''}` : x.client_notified_at ? 'Waiting for the client' : '') },
      { field: 'phase2_note', title: 'Note', type: 'readonly', width: 200 },
      { field: 'retest', title: '', type: 'button', width: 175, label: (x) => (may(x) ? 'Order Phase II retest…' : ''), onClick: (x) => { if (may(x)) retest(x); } },
      { field: 'none', title: '', type: 'button', width: 150, label: (x) => (may(x) ? 'No retest: close…' : ''), onClick: (x) => { if (may(x)) noRetest(x); } },
    ] };
  }, [oosFor, s, dialogs, toast, reload]);
  if (!rows.length) return null;
  return (
    <Section title="OOS: the client's Phase II decision" help="A confirmed OOS result is released on the COA and the client is emailed then (not when the OOS is found). The client then asks for a Phase II retest or no retest. Record it here; until then the COA is not marked final.">
      <div id="p2card"><ReadGrid rows={rows} columns={columns} rowClass={(x) => (isOpen(x) ? 'warnrow' : '')} /></div>
    </Section>
  );
}
