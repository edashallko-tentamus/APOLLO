// The Test Workflow Designer, step 1: a test's catalogue terms (pricing, TAT, cutoff and rush). Pricing lives here,
// outside the validated test version.
import { useMemo, useRef, useState } from 'react';
import * as api from '../../api/catalog.js';
import Badge from '../../components/Badge.jsx';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import DataGrid from '../../components/grid/DataGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import SmartSelect from '../../components/SmartSelect.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useMeta } from '../../hooks/useMeta.js';
import { money } from '../../lib/format.js';
import { useUnsavedChanges } from '../../router/useHashRoute.js';
import PickList from '../charges/PickList.jsx';
import { useRowQueue } from './rowQueue.js';

const MODE_HELP = { 'Base Price Only': 'One price for the whole test.', 'Base + Preparation Fee': 'Base price plus a preparation fee.', 'Analyte Selection': 'Each analyte has a price and can be switched on or off. Base and prep fee are added if filled in.' };
const SERVING_ROLES = [{ value: '', label: 'No: an ordinary test' }, { value: 'Serving weight', label: 'Serving weight (its result is the average unit weight)' }, { value: 'Density', label: 'Density (g/mL)' }];
const STATUSES = [{ value: 'Active', label: 'Active' }, { value: 'Retired', label: 'Retired' }];
const str = (v) => (v === null || v === undefined ? '' : String(v));
const isSet = (v) => v !== null && v !== undefined;

const TIER_COLUMNS = [
  { field: 'tier_name', title: 'Tier', type: 'readonly', width: 170 },
  { field: 'rush_tat', title: 'Rush TAT', type: 'readonly', width: 130, format: (v, r) => `${v} ${r.tat_unit === 'Business Days' ? 'business' : 'calendar'} days` },
  { field: 'surcharge_value', title: 'Surcharge', type: 'readonly', width: 100, format: (v, r) => (r.surcharge_type === 'Flat' ? money(v) : v + '%') },
  { field: 'schedule_default', title: 'Schedule default', type: 'readonly', width: 140, format: (v) => (v ? 'Needs approval' : 'No approval') },
  { field: 'override', title: 'This test', type: 'select', width: 190,
    options: [{ value: true, label: 'Needs approval' }, { value: false, label: 'No approval needed' }],
    format: (v) => (!isSet(v) ? 'Use schedule default' : v ? 'Needs approval' : 'No approval needed') },
  { field: 'effective', title: 'Result', type: 'readonly', width: 130, compute: (r) => (!isSet(r.override) ? r.schedule_default : r.override), format: (v) => (v ? 'Intake approves' : 'Auto-accepted') },
];

function Editor({ testId, d, schedules, analytes, reload }) {
  const meta = useMeta();
  const dialogs = useDialogs();
  const toast = useToast();
  const e = d.entry;
  const [orig] = useState(() => ({
    test_name: str(d.test.test_name), status: d.test.status, serving_role: d.test.serving_role || '', service_line_type_id: d.test.service_line_type_id || '', description: e.description || '', pricing_mode: e.pricing_mode,
    base_price: str(e.base_price), prep_fee: str(e.prep_fee), standard_tat: str(e.standard_tat), tat_unit: e.tat_unit,
    cutoff_time: (e.cutoff_time || '').slice(0, 5), rush_schedule_id: e.rush_schedule_id || '', show_in_public_catalogue: !!e.show_in_public_catalogue,
  }));
  const [form, setForm] = useState(orig);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const [saving, setSaving] = useState(false);

  const analyteCols = useMemo(() => {
    const of = (r) => analytes.find((a) => a.id === r.analyte_id) || {};
    return [
      { field: 'analyte_id', title: 'Analyte', type: 'select', width: 230, required: true, editable: (r, isNew) => isNew,
        options: () => analytes.filter((a) => a.status === 'Active').map((a) => ({ value: a.id, label: a.analyte_name })) },
      { field: 'analyte_class', title: 'Class', type: 'readonly', width: 140, compute: (r) => of(r).analyte_class || '' },
      { field: 'price', title: 'Price', type: 'money', min: 0, width: 110, required: true },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 100 },
      { field: 'analyte_code', title: 'Analyte code', type: 'link', width: 105, compute: (r) => r.analyte_code || of(r).analyte_code || '',
        href: (r) => { const c = r.analyte_code || of(r).analyte_code; return c ? '#/analytes?find=' + encodeURIComponent(c) : null; } },
    ];
  }, [analytes]);
  const queue = useRowQueue(() => ({ status: 'Active', price: null }));
  const ag = useGrid({ rows: d.analytes, columns: analyteCols, allowAdd: true, newRow: queue.newRow });
  queue.useClear(ag);
  const tierRows = useMemo(() => (d.tiers || []).map((t) => ({ ...t })), [d]);
  const rg = useGrid({ rows: tierRows, columns: TIER_COLUMNS });

  const dirty = JSON.stringify(form) !== JSON.stringify(orig) || ag.changes.length > 0 || rg.changes.length > 0;
  useUnsavedChanges(dirty);

  const m = form.pricing_mode;
  const base = Number(form.base_price) || 0; const prep = Number(form.prep_fee) || 0;
  const an = ag.state.rows.filter((r) => r.status !== 'Inactive' && typeof r.price === 'number');
  const sum = an.reduce((s, r) => s + r.price, 0);
  const lp = base + (m === 'Base Price Only' ? 0 : prep) + (m === 'Analyte Selection' ? sum : 0);
  const lpd = m === 'Base Price Only' ? 'base' : m === 'Base + Preparation Fee' ? `${money(base)} base + ${money(prep)} prep`
    : `${money(base)} base + ${money(prep)} prep + ${an.length} analytes (${money(sum)})`;

  const en = meta?.enums || {};
  const tatUnits = (en.tat_unit || []).map((u) => ({ value: u, label: u }));
  const scheduleOptions = [{ value: '', label: 'No rush available' }, ...schedules.map((s) => ({ value: s.id, label: s.schedule_name }))];
  const lineTypeOptions = [{ value: '', label: '' }, ...(d.service_line_types || []).map((t) => ({ value: t.id, label: t.label }))];

  async function addAnalytes() {
    const have = new Set(ag.state.rows.map((r) => r.analyte_id));
    const avail = analytes.filter((a) => a.status === 'Active' && !have.has(a.id));
    const picked = new Set();
    const v = await dialogs.form({ title: 'Add analytes', okText: 'Add', wide: true,
      before: <PickList items={avail.map((a) => ({ value: a.id, label: a.analyte_name, small: a.analyte_class }))} picked={picked} empty="All analytes are already on this test." />,
      fields: [{ name: 'price', label: 'Starting price for each (change afterwards with fill down)', value: '0' }] });
    if (!v || !picked.size) return;
    queue.add(ag, [...picked].map((id) => ({ analyte_id: id, price: Number(v.price) || 0, status: 'Active' })));
  }

  async function save() {
    if (saving) return;
    if (ag.errorCount || rg.errorCount) { toast('Fix the cells marked in red first.', 'err'); return; }
    if (!dirty) { toast('Nothing to save.'); return; }
    const reason = await dialogs.reason(`catalogue terms for ${d.test.test_code}`); if (!reason) return;
    const body = {
      reason,
      test: { test_name: form.test_name, status: form.status, serving_role: form.serving_role || null, service_line_type_id: form.service_line_type_id || null },
      entry: { description: form.description, pricing_mode: m, base_price: base,
        prep_fee: m === 'Base Price Only' ? 0 : prep, standard_tat: Number(form.standard_tat),
        tat_unit: form.tat_unit, cutoff_time: form.cutoff_time, rush_schedule_id: form.rush_schedule_id || null,
        show_in_public_catalogue: form.show_in_public_catalogue },
      analytes: ag.changes,
      approvals: rg.changes.map((r) => ({ tier_id: r.id, override: r.override })),
    };
    setSaving(true);
    try {
      await api.saveCatalogTest(testId, body);
      ag.reset(d.analytes); rg.reset(tierRows); setForm(orig); // nothing unsaved while the page reloads
      toast('Saved.'); reload();
    } catch (err) { toast(err.message, 'err'); } finally { setSaving(false); }
  }

  const inp = (k, extra = {}) => <input value={form[k]} onChange={(ev) => set(k)(ev.target.value)} {...extra} />;
  return <>
    <PageHeader title={d.test.test_name} audit={{ kind: 'test', id: testId }}
      subtitle={<><a href={'#/catalog/' + testId}>{d.test.test_code}</a> <Badge status={d.test.status} /> · Test Workflow Designer · Step 1 of 5: Pricing and turnaround</>}
      actions={<><a className="btn ghost" href="#/catalog">Catalogue</a>{' '}<button type="button" className="btn primary" onClick={save} disabled={saving}>Save</button></>} />
    <div className="steps"><span className="on">1 Pricing and TAT</span><span>2 Method and analytes</span><span>3 Workflow steps</span><span>4 Calculations and limits</span><span>5 Review and approve</span></div>
    <div className="cols">
      <div className="card">
        <h2>Pricing</h2>
        <div className="frm">
          <label>Test name{inp('test_name')}</label>
          <label>Description{inp('description')}</label>
          <label>Serving test<SmartSelect id="f_serving_role" value={form.serving_role} options={SERVING_ROLES} onChange={set('serving_role')} />
            <small>Its approved result is fed back to the sample for results per serving (ordered by the "Per serving" tick on an order).</small></label>
          <label>Service line &gt; type<SmartSelect value={form.service_line_type_id} options={lineTypeOptions} onChange={set('service_line_type_id')} />
            <small>Where the order's test picker lists this test (Test catalogue &gt; Service lines).</small></label>
          <div className="radios">{(en.pricing_mode || []).map((pm) => (
            <label key={pm} className="radio"><input type="radio" name="pm" value={pm} checked={pm === m}
              onChange={() => setForm((f) => ({ ...f, pricing_mode: pm, ...(pm === 'Base Price Only' ? { prep_fee: '0' } : {}) }))} />
              <b>{pm}</b><small>{MODE_HELP[pm]}</small></label>))}</div>
          <div className="row3">
            <label>Base price{inp('base_price', { inputMode: 'decimal' })}</label>
            <label className="pf" style={{ opacity: m === 'Base Price Only' ? 0.4 : 1 }}>Preparation fee{inp('prep_fee', { inputMode: 'decimal', disabled: m === 'Base Price Only' })}</label>
            <div className="listprice"><span>List price</span><b>{money(lp)}</b><small>{lpd}</small></div>
          </div>
        </div>
      </div>
      <div className="card">
        <h2>Turnaround and rush</h2>
        <div className="frm">
          <div className="row3">
            <label>Standard TAT (maximum){inp('standard_tat', { inputMode: 'numeric' })}</label>
            <label>Unit<SmartSelect value={form.tat_unit} options={tatUnits} onChange={set('tat_unit')} /></label>
            <label>Cutoff time{inp('cutoff_time', { type: 'time' })}</label>
          </div>
          <p className="help">Day 0 is the day the test is logged. Logged after the cutoff (site local time), Day 0 moves to the next working day. The test still goes straight into the testing pool.</p>
          <label>Rush fee schedule<SmartSelect value={form.rush_schedule_id} options={scheduleOptions} onChange={set('rush_schedule_id')} /></label>
          <label className="cb"><input type="checkbox" checked={form.show_in_public_catalogue} onChange={(ev) => set('show_in_public_catalogue')(ev.target.checked)} /> Show in public catalogue</label>
          <label>Test status<SmartSelect value={form.status} options={STATUSES} onChange={set('status')} /></label>
        </div>
      </div>
    </div>
    {m === 'Analyte Selection' && (
      <Section title="Analyte prices" help="Used when the pricing mode is Analyte Selection. Paste analyte names and prices straight from Excel, or set one price and fill down."
        actions={<button type="button" className="btn" onClick={addAnalytes}>+ Add analytes</button>}>
        <DataGrid grid={ag} />
      </Section>
    )}
    <Section title="Rush tiers for this test" help="Each tier uses the schedule's approval default unless you override it for this test. Changing the schedule takes effect after saving.">
      <DataGrid grid={rg} emptyText="No rush schedule assigned." />
    </Section>
    <div className="card"><h2>Test versions</h2><p className="help">Scientific content (method, analytes, workflow, formulas) is versioned in the Workflow Designer. Price changes never create a new version.</p>
      {d.versions.map((v, i) => <span key={v.version_no}>{i > 0 && ' · '}Version {v.version_no} <Badge status={v.status} /></span>)}
      {!d.versions.some((v) => v.status === 'Effective') && <div className="notice" style={{ marginTop: 10 }}>This test has no Effective version, so it cannot be ordered yet. Its version is built and approved in the Workflow Designer.</div>}
      <div style={{ marginTop: 10 }}><a className="btn" href={`#/methods/tests/${testId}`}>Open in the Workflow Designer</a></div></div>
  </>;
}

export default function CatalogEditorPage({ params }) {
  const [testId] = params;
  const { data, error, reload } = useApi(async () => {
    const [d, schedules, analytes] = await Promise.all([api.getCatalogTest(testId), api.listRushSchedules(), api.listAnalytes()]);
    return { d, schedules, analytes };
  }, [testId]);
  // a new answer starts the editor again from it (the form keeps no edits across a save)
  const gen = useRef({ data: null, n: 0 });
  if (data && data !== gen.current.data) gen.current = { data, n: gen.current.n + 1 };
  if (error && !data) return <div className="card err">{error.message}</div>;
  if (!data) return <div className="loading">Loading…</div>;
  return <Editor key={gen.current.n} testId={testId} {...data} reload={reload} />;
}
