// A lab order: the samples grid with each sample's tests in a panel under it (analytes, rush, TAT override, specs,
// packages, cancelling), projects, packages and tests added to ticked samples, receiving and logging, and the order's
// chain of custody, charges, billing, COAs, attachments and emails.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCustody } from '../../api/custody.js';
import * as api from '../../api/orders.js';
import Badge from '../../components/Badge.jsx';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import DataGrid from '../../components/grid/DataGrid.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import { usePrintLabels } from '../../components/labels/usePrintLabels.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { openSpecDialog } from '../../components/SpecDialog.jsx';
import { useToast } from '../../components/Toasts.jsx';

import { useApi } from '../../hooks/useApi.js';
import { money, plural } from '../../lib/format.js';
import { useUnsavedChanges } from '../../router/useHashRoute.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { OrderChargesCard } from '../charges/ChargesCards.jsx';
import OrderBillingCard from '../billing/OrderBillingCard.jsx';
import { CustodyCard, openPhotoDialog, openReceiveDialog } from '../custody/Custody.jsx';
import { showEmail } from '../intake/EmailDialog.jsx';
import { openTestPicker } from '../picker/TestPicker.jsx';
import { openAnalyteDialog } from './AnalyteDialog.jsx';
import { d8, dt, hasVal, quoteHref, quoteText, sampleName, unit } from './orderFormat.js';

const CONDITIONS = ['Acceptable', 'Damaged', 'Temperature excursion', 'Short shipped', 'Leaking', 'Other'];
const SAMPLE_SKIP = ['_pick', '_open', 'id'];
const NEW_DEFAULTS = [...SAMPLE_SKIP, 'status', 'number_of_units'];
const hiddenTests = new Map(); // order id -> sample ids whose tests are hidden (tests show by default), kept while the app is open
const licText = (l) => (!l ? '—' : `${l.license_type} ${l.license_number}${l.expires_on ? `, expires ${d8(l.expires_on)}` : ''}${l.state === 'Expired' ? ' (EXPIRED)' : l.state === 'Expiring soon' ? ' (expiring soon)' : l.state === 'Retired' ? ' (retired)' : ''}`);
const stop = (e) => e.stopPropagation();
const blank = (v) => v === undefined || v === null || v === '';

export default function OrderPage({ params }) {
  const id = params[0];
  const order = useApi((o) => api.getOrder(id, o), [id]);
  const custody = useApi((o) => getCustody(id, o).catch(() => null), [id]);
  const coas = useApi((o) => api.orderCoas(id, o).catch(() => ({ rows: [] })), [id]);
  const { reload: r1 } = order; const { reload: r2 } = custody; const { reload: r3 } = coas;
  const reload = useCallback(() => { r1(); r2(); r3(); }, [r1, r2, r3]);
  if (order.error && !order.data) return <div className="card err">{order.error.message}</div>;
  if (!order.data) return <div className="loading">Loading…</div>;
  return <OrderView id={id} d={order.data} cus={custody.data} coas={coas.data?.rows || []} reload={reload} reloadCustody={r2} />;
}

// One sample's tests: their own grid; edits are reported to the order so one Save covers every sample
function TestPanel({ sample, tests, columns, rowClass, projects, hasPackages, onState, onMenu, onAddTests, onApplyProject, onAddPackage }) {
  const grid = useGrid({ rows: tests, columns });
  const { reset, changes, errorCount } = grid;
  useEffect(() => { reset(tests); }, [tests, reset]);
  useEffect(() => { onState(sample.id, { changes, errorCount, grid }); }, [changes, errorCount]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onState(sample.id, null), [sample.id, onState]);
  // the panel sits inside the samples grid: its mouse and keys stay with its own grid
  return (
    <div onMouseDown={stop} onMouseOver={stop} onDoubleClick={stop} onKeyDown={stop} onContextMenu={stop} onClick={stop}>
      <div className="dtool"><span className="dtitle">Tests on {sample.sample_code || sample.client_sample_id || 'this sample'}</span>
        <button type="button" className="mini" data-addt onClick={() => onAddTests([sample.id])}>+ Add tests</button>{' '}
        <button type="button" className="mini" data-applyp disabled={!projects.length} onClick={() => onApplyProject([sample.id])}>+ Apply a project</button>
        {hasPackages && <> <button type="button" className="mini" data-addpk onClick={() => onAddPackage([sample.id])}>+ Add a package</button></>}
      </div>
      <div className="stests">
        <DataGrid grid={grid} rowClass={rowClass} emptyText="No tests yet: add a test or apply a project." onContextMenu={onMenu} />
      </div>
    </div>
  );
}
const testRowClass = (r) => (r.status === 'Cancelled' ? 'mutedrow' : r.rush_status === 'Pending Approval' ? 'warnrow' : '');
const sampleRowClass = (r) => (r.status === 'Cancelled' ? 'mutedrow' : '');

function OrderView({ id, d, cus, coas, reload, reloadCustody }) {
  const o = d.order;
  const dialogs = useDialogs();
  const toast = useToast();
  const printLabels = usePrintLabels();
  const { site } = useSession();
  const s = encodeURIComponent(site?.id || '');
  const curLic = (d.licenses || []).find((l) => l.id === o.client_license_id);
  const projects = useMemo(() => [...new Map(d.orderable.map((l) => [l.project_id, l])).values()], [d]);
  const expected = d.samples.filter((x) => x.status === 'Expected');
  const hasPackages = (d.packages || []).length > 0;

  const [hidden, setHiddenState] = useState(() => hiddenTests.get(id) || new Set());
  const setHidden = (h) => { hiddenTests.set(id, h); setHiddenState(h); };

  // ---- each sample's tests: grids report their edits here
  const testState = useRef(new Map());
  const [, setTick] = useState(0);
  const onTestState = useCallback((sid, st) => { if (st) testState.current.set(sid, st); else testState.current.delete(sid); setTick((t) => t + 1); }, []);
  const testList = [...testState.current.values()];
  const testChanges = testList.reduce((n, x) => n + x.changes.length, 0);
  const testErrors = testList.reduce((n, x) => n + x.errorCount, 0);

  // handlers the memoized columns call (always the latest)
  const h = useRef({});

  const testsBySample = useMemo(() => {
    const m = new Map();
    d.tests.forEach((t) => { if (!m.has(t.sample_id)) m.set(t.sample_id, []); m.get(t.sample_id).push({ ...t, _origOverride: t.tat_override }); });
    return m;
  }, [d]);

  const testColumns = useMemo(() => {
    const tierLabel = (t) => `${t.tier_name} (${t.rush_tat} ${unit(t.tat_unit)} days)`;
    const tierOpts = (r) => [{ value: null, label: 'Standard' }, ...d.tiers.filter((t) => r && t.schedule_id === r.test_rush_schedule_id).map((t) => ({ value: t.id, label: tierLabel(t) }))];
    return [
      { field: 'test_name', title: 'Test', type: 'link', width: 200, href: (r) => '#/catalog/' + r.test_id },
      { field: 'quote', title: 'Quote', type: 'link', width: 100, compute: quoteText, href: quoteHref, help: 'The accepted quote version this test is priced from; List price: not on the client\'s quote (0.36.0)' },
      { field: 'analytes', title: 'Analytes', type: 'button', width: 85, label: (r) => (r.pricing_mode === 'Analyte Selection' ? `${r.analytes_included} of ${r.analytes_total}` : '—'),
        onClick: (r) => { if (r.pricing_mode === 'Analyte Selection') h.current.analytes(r); } },
      { field: 'list_price', title: 'List', type: 'money', width: 85, editable: false },
      { field: 'price', title: 'Price', type: 'money', width: 85, editable: false },
      { field: 'rush_tier_id', title: 'Rush tier', type: 'select', width: 190, editable: (r) => r.status !== 'Cancelled' && !!r.test_rush_schedule_id, options: tierOpts,
        help: 'Pick a rush tier: type to search, or press Enter and use the arrow keys. Rush status, fee, TAT and due date follow from it.',
        format: (v, r) => { if (!r.test_rush_schedule_id) return 'No rush for this test'; const t = tierOpts(r).find((x) => x.value === (v ?? null)); return t ? t.label : ''; } },
      { field: 'rush_status', title: 'Rush status', type: 'readonly', width: 125, help: 'Set automatically from the rush tier: Auto-accepted, or Pending Approval until intake approves or declines it',
        format: (v) => (v === 'None' ? '' : v), cellClass: (r) => (r.rush_status === 'Pending Approval' ? 'flag' : '') },
      { field: 'rush_fee', title: 'Rush fee', type: 'money', width: 80, editable: false },
      { field: 'tat_override', title: 'TAT', type: 'int', min: 0, width: 125, editable: (r) => r.status !== 'Cancelled', editValue: (r) => r.tat_override ?? r.tat_days,
        help: 'Calculated from the standard or rush turnaround. Type a number of days to override it (needs a Reason for Change; the price does not change). Press Delete to go back to the calculated TAT.',
        format: (v, r) => (hasVal(v) ? `${v} ${unit(r.tat_unit)} days ✎` : hasVal(r._origOverride) ? 'Calculated (on save)' : hasVal(r.tat_days) ? `${r.tat_days} ${unit(r.tat_unit)} days` : ''),
        cellClass: (r) => (hasVal(r.tat_override) ? 'override' : '') },
      { field: 'day0', title: 'Day 0', type: 'readonly', width: 100, format: d8 },
      { field: 'due_date', title: 'Due', type: 'readonly', width: 100, format: d8 },
      { field: 'status', title: 'Status', type: 'select', width: 95, options: ['Ordered', 'In Pool', 'Cancelled'], editable: (r) => r.status !== 'Cancelled',
        validate: (v, r) => (v !== 'Cancelled' && v !== (d.tests.find((x) => x.id === r.id) || {}).status ? 'You can only change a test to Cancelled' : null) },
      { field: 'special_instructions', title: 'Instructions', width: 150 },
      { field: 'specs', title: 'Specs', type: 'button', width: 95, label: (r) => (Number(r.spec_count) ? `${r.spec_count} limit${Number(r.spec_count) === 1 ? '' : 's'}` : 'Unspecified'),
        help: 'Specification limits for this test (copied from the quote; can be set here). Unspecified: results are reported as they are.', onClick: (r) => h.current.specs(r) },
      // packages (P-1, migration 047): the test's price is its share of the package price
      { field: 'package', title: 'Package', type: 'readonly', width: 200, compute: (r) => (r.ordered_package_id ? `${r.package_code} ${r.package_name}${r.package_status && r.package_status !== 'Intact' ? ' (' + r.package_status.toLowerCase() + ')' : ''}` : ''),
        help: 'The package this test was ordered in. Its price is its share of the package price; cancelling it takes off only that share.' },
      // cancelling (0.34.0, migration 057): kept, greyed, with a reason; refused once the test has results or is in a batch
      { field: '_cancel', title: '', type: 'button', width: 80, label: (r) => (r.id && r.status !== 'Cancelled' ? 'Cancel…' : ''),
        help: 'Cancel this test (it stays on the order, greyed). Not possible once it has results or is in a batch.', onClick: (r) => { if (r.id && r.status !== 'Cancelled') h.current.cancel({ tests: [r] }); } },
    ];
  }, [d]);

  // ---- samples
  const sRows = useMemo(() => d.samples.map((x) => ({ ...x, _pick: x.status === 'Expected' })), [d]);
  const sampleColumns = useMemo(() => {
    const matrixOpts = () => d.matrices.map((m) => ({ value: m, label: m }));
    // older samples may hold a matrix typed before the list existed, or one since set Inactive
    const matrixText = (v) => (!v ? '' : d.matrices.find((m) => m.toLowerCase() === String(v).toLowerCase()) || v + ' (not on the list)');
    // pick lists from the Units list (migration 031): by what they measure, or the serving units
    const unitOpts = (dims, serving = false) => (d.units || []).filter((u) => (serving ? u.is_serving_unit : dims.includes(u.dimension)))
      .map((u) => ({ value: u.unit_code, label: u.unit_code === u.unit_name ? u.unit_code : `${u.unit_code} (${u.unit_name})` }));
    return [
      { field: '_open', title: 'Tests', type: 'button', width: 62, help: 'Show or hide this sample\'s tests',
        label: (r) => (r.id ? `${hidden.has(r.id) ? '▸' : '▾'} ${r.test_count ?? 0}` : ''), onClick: (r) => { if (r.id) h.current.toggle(r.id); } },
      { field: '_pick', title: '✓', type: 'bool', width: 36, help: 'Tick samples to apply a project, add a test or log them' },
      { field: 'sample_code', title: 'Sample ID', type: 'link', width: 125, href: (r) => (r.id ? '#/samples/' + r.id : null), format: (v) => v || 'Not logged' },
      { field: 'client_sample_id', title: 'Client sample ID', width: 130 },
      { field: 'description', title: 'Description', width: 190 },
      { field: 'matrix', title: 'Matrix', type: 'select', width: 130, options: matrixOpts, format: matrixText, help: 'From the controlled Matrix list (Admin > Matrices). Type to search.' },
      { field: 'compliance_category', title: 'Category', type: 'select', width: 150, options: () => (d.categories || []).map((m) => ({ value: m, label: m })), help: 'What the sample is, from the sample submission form (Admin > Matrices, Compliance categories). Type to search.' },
      { field: 'product', title: 'Product', width: 150 },
      { field: 'lot', title: 'Lot', width: 85 },
      { field: 'batch', title: 'Batch', width: 80 },
      { field: 'number_of_units', title: 'Containers', type: 'int', min: 1, width: 90, help: 'How many bottles, bags or boxes make up this one sample (also the number of labels printed)' },
      { field: 'condition', title: 'Condition', type: 'select', options: CONDITIONS, width: 150 },
      { field: 'receipt_temperature', title: 'Temp °C', type: 'number', width: 75 },
      { field: 'preservation', title: 'Preservation', width: 110 },
      { field: 'quantity_received', title: 'Amount received', type: 'number', min: 0, width: 120, help: 'The total amount received, e.g. 500 (g): the retain is taken from it' },
      { field: 'quantity_unit', title: 'Amount unit', type: 'select', width: 100, options: () => unitOpts(['Mass', 'Volume', 'Count']), help: 'From the Units list (Admin > Units). Type to search.' },
      { field: 'serving_count', title: 'Serving', type: 'number', min: 0, width: 75, help: 'The serving as the label states it, e.g. 2 (capsules)' },
      { field: 'serving_count_unit', title: 'Serving unit', type: 'select', width: 105, options: () => unitOpts(null, true), help: 'A serving unit from the Units list: capsule, tablet, scoop, packet...' },
      { field: 'serving_size', title: 'Serving weight/vol', type: 'number', min: 0, width: 125, help: 'What one serving weighs or measures, e.g. 1.2 (g) for 2 capsules: results per serving and limits per serving use it' },
      { field: 'serving_unit', title: 'Weight/vol unit', type: 'select', width: 105, options: () => unitOpts(['Mass', 'Volume']), help: 'g, mg or mL...' },
      { field: 'servings_per_package', title: 'Servings / package', type: 'number', min: 0, width: 125, help: 'From the label: for limits per package (e.g. 10 mg per package)' },
      // serving size, Part B (033): ticking orders the Serving weight test (or the Density test for a serving by volume)
      { field: 'report_per_serving', title: 'Per serving', type: 'bool', width: 90,
        help: 'Results per serving: orders the Serving weight test (Density for a serving by volume) at its quoted or catalogue price; nothing per serving is released until it is measured and approved' },
      { field: 'due_date', title: 'Due', type: 'readonly', width: 100, format: d8 },
      { field: 'sample_value', title: 'Value', type: 'money', width: 90, editable: false },
      { field: 'status', title: 'Status', type: 'select', options: ['Expected', 'Logged', 'Cancelled'], width: 95, editable: (r, isNew) => !isNew && r.status === 'Expected' },
      // receipt photos (0.29.0), 4:3; a photo report layout prints the ones marked Report photo 1 and 2
      { field: 'photo_count', title: 'Photos', type: 'button', width: 90, label: (r) => (r.id ? (Number(r.photo_count) ? `${r.photo_count} photo${Number(r.photo_count) === 1 ? '' : 's'}` : 'Add…') : ''),
        help: 'Photos of the sample at receipt, cropped to 4:3. Open the sample page to mark which ones a photo report prints.', onClick: (r) => { if (r.id) h.current.photos(r); } },
      // cannabis samples (0.32.0, migration 055): the METRC package tag; optional, printed on the COA and the chain of custody
      { field: 'metrc_id', title: 'METRC ID', width: 230, help: 'Cannabis samples: the METRC package tag (24 letters and digits, starting 1A). Printed on the COA and the chain of custody.',
        validate: (v) => { const x = String(v ?? '').replace(/\s/g, '').toUpperCase(); return x && !/^1A[0-9A-Z]{22}$/.test(x) ? 'A METRC tag is 24 letters and digits, starting 1A' : null; } },
      { field: '_cancel', title: '', type: 'button', width: 80, label: (r) => (r.id && r.status !== 'Cancelled' ? 'Cancel…' : ''),
        help: 'Cancel this sample and its tests (kept, greyed). Not possible once a test has results or is in a batch.', onClick: (r) => { if (r.id && r.status !== 'Cancelled') h.current.cancel({ samples: [r] }); } },
    ];
  }, [d, hidden]);

  const sg = useGrid({ rows: sRows, columns: sampleColumns, allowAdd: true, newRow: () => ({ status: 'Expected', number_of_units: 1, _pick: true }) });
  const { reset: resetSamples } = sg;
  useEffect(() => { resetSamples(sRows); }, [sRows, resetSamples]);
  // a sample change is anything but the tick box; a new row counts once something is typed in it
  const sampleChanges = sg.changes.filter((r) => Object.keys(r).some((k) => !(r.id ? SAMPLE_SKIP : NEW_DEFAULTS).includes(k) && (r.id || !blank(r[k]))));
  const sampleErrors = sg.errorCount;
  useUnsavedChanges(testChanges > 0 || sampleChanges.length > 0);

  // ---- actions
  const [busy, setBusy] = useState(false);
  const run = async (fn) => { if (busy) return; setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const picked = () => sg.state.rows.filter((r) => r._pick && r.id);
  const testsUnsaved = () => { if (testChanges) { toast('Save or discard the test changes first.', 'err'); return true; } return false; };
  const ready = () => { if (sampleChanges.length) { toast('Save the samples first.', 'err'); return false; } return !testsUnsaved(); };
  const after = (msg) => { if (msg) toast(msg); reload(); };

  async function saveSampleRows() {
    if (sampleErrors) { toast('Fix the cells marked in red first.', 'err'); return; }
    if (testsUnsaved()) return;
    const rows = sampleChanges.map((r) => { const x = { ...r }; ['_pick', '_open', 'sample_code', 'test_count', 'due_date', 'sample_value'].forEach((k) => delete x[k]); return x; })
      .filter((r) => Object.keys(r).some((k) => k !== 'id'));
    const touchesLogged = rows.some((r) => r.id && d.samples.find((x) => x.id === r.id)?.logged_at);
    let reason = '';
    if (touchesLogged) { reason = await dialogs.reason('logged samples on ' + o.order_code); if (!reason) return; }
    try { await api.saveSamples(id, rows, reason); after('Samples saved.'); } catch (e) { toast(e.message, 'err'); }
  }

  async function saveTestRows() {
    if (testErrors) { toast('Fix the cells marked in red first (hover for the reason).', 'err'); return; }
    const rows = testList.flatMap((x) => x.changes); if (!rows.length) return;
    const needReason = rows.some((r) => 'tat_override' in r || d.tests.find((x) => x.id === r.id)?.clock_start);
    // a test of a package: show what cancelling it takes off before saving (option B, Alex 2026-10-19)
    const pkCancels = rows.filter((r) => r.status === 'Cancelled' && (d.tests.find((x) => x.id === r.id) || {}).ordered_package_id);
    if (pkCancels.length) {
      try {
        const pv = (await Promise.all(pkCancels.map((r) => api.packageCancelPreview(r.id)))).filter(Boolean);
        if (pv.length && !(await dialogs.confirm('Cancel tests in a package', <ul>{pv.map((x, i) => <li key={i}>{x.sample_code} {x.test_name}: {money(x.share)} comes off package {x.package_code} {x.package_name} ({money(x.package_price)} per sample). {x.remaining_tests ? `The ${x.remaining_tests} test${x.remaining_tests === 1 ? '' : 's'} left keep their shares: ${money(x.still_charged)}.` : 'Nothing is left of the package.'}</li>)}</ul>, 'Continue'))) return;
      } catch (e) { toast(e.message, 'err'); return; }
    }
    let reason = '';
    if (needReason) { reason = await dialogs.reason(rows.some((r) => 'tat_override' in r) ? 'the turnaround (TAT) of tests on ' + o.order_code : 'tests on logged samples'); if (!reason) return; }
    try { await api.saveTests(id, rows, reason); after('Tests saved. Rush requests needing approval are now on the intake dashboard.'); } catch (e) { toast(e.message, 'err'); }
  }
  const discardTests = () => testList.forEach((x) => x.grid.reset(x.grid.state.orig));

  async function applyProject(ids) {
    if (!ready()) return;
    if (!ids.length) { toast('Tick one or more samples first.', 'err'); return; }
    const v = await dialogs.form({ title: `Apply a project to ${ids.length} sample${ids.length === 1 ? '' : 's'}`, okText: 'Apply', intro: 'All of the project\'s quoted tests are added. Cancel any that are not needed afterwards.',
      fields: [{ name: 'project_id', label: 'Project (accepted quote)', type: 'select', required: true, blank: false,
        options: projects.map((p) => ({ value: p.project_id, label: `${p.project_code} · ${p.project_name}${p.via_parent ? ' (shared from parent)' : ''}` })) }],
      submit: (x) => api.applyProject(id, ids, x.project_id) });
    if (!v) return;
    showTests(ids); after(`${v.added} test${v.added === 1 ? '' : 's'} added.`);
  }
  // 0.36.0: the drill-down picker (service line > type > department, or search); any test of this lab, the client's
  // quoted price when there is one, else the list price
  async function addTest(ids) {
    if (!ready()) return;
    if (!ids.length) { toast('Tick one or more samples first.', 'err'); return; }
    const names = ids.map((x) => sampleName(d.samples.find((y) => y.id === x) || {}));
    const r = await openTestPicker(dialogs, { orderId: id, sampleIds: ids, sampleLabel: ids.length === 1 ? names[0] : `${ids.length} samples`, tiers: d.tiers });
    if (!r) return;
    showTests(ids);
    after(`${r.added} test${r.added === 1 ? '' : 's'} added${r.skipped ? ` (${r.skipped} already on the sample${r.skipped === 1 ? '' : 's'})` : ''}.`);
  }
  async function addPackage(ids) {
    if (!ready()) return;
    if (!ids.length) { toast('Tick one or more samples first.', 'err'); return; }
    const v = await dialogs.form({ title: `Add a package to ${ids.length} sample${ids.length === 1 ? '' : 's'}`, okText: 'Add', intro: 'Packages on this client\'s accepted quotes. All of the package\'s tests are ordered, each at its share of the package price.',
      fields: [{ name: 'qp', label: 'Package', type: 'select', required: true, blank: false,
        options: d.packages.map((p) => ({ value: p.quoted_package_id, label: `${p.package_code} ${p.package_name} · ${money(p.package_price)} (${p.project_code}; ${p.tests})` })) }],
      submit: (x) => api.addPackage(id, ids, x.qp) });
    if (!v) return;
    showTests(ids); after(`Package added to ${v.added} sample${v.added === 1 ? '' : 's'}.`);
  }
  // Cancel samples or tests (0.34.0): nothing is deleted; they stay on the order, greyed, with the reason.
  // The database refuses a test with results or in a batch.
  async function cancelItems({ samples = [], tests = [] }) {
    if (!ready()) return;
    if (!samples.length && !tests.length) { toast('Tick or select the samples or tests to cancel.', 'err'); return; }
    const name = (x) => x.sample_code || x.client_sample_id || 'a sample';
    const nameOf = (sid) => name(d.samples.find((x) => x.id === sid) || {});
    const ok = await dialogs.confirm(`Cancel ${samples.length ? samples.length + ' sample' + (samples.length === 1 ? '' : 's') : tests.length + ' test' + (tests.length === 1 ? '' : 's')}`, <>
      <ul>{samples.map((x) => <li key={x.id}>Sample {name(x)} and its {Number(x.test_count) || 0} test{Number(x.test_count) === 1 ? '' : 's'}</li>)}
        {tests.map((t) => <li key={t.id}>{t.test_name} on {nameOf(t.sample_id)}{t.ordered_package_id ? ' (part of a package: only its share comes off)' : ''}</li>)}</ul>
      <p>They stay on the order, greyed out, and can be ordered again later. A test that has results or is in a batch cannot be cancelled: take it out of the batch first.</p></>, 'Next: reason');
    if (!ok) return;
    const reason = await dialogs.reason('cancelling on ' + o.order_code); if (!reason) return;
    try {
      const r = await api.cancelItems(id, samples.map((x) => x.id), tests.map((t) => t.id), reason);
      after(r.samples ? `${r.samples} sample${r.samples === 1 ? '' : 's'} cancelled with their tests.` : `${r.tests} test${r.tests === 1 ? '' : 's'} cancelled.`);
    } catch (e) { toast(e.message, 'err'); }
  }
  async function rushAll() {
    if (testsUnsaved()) return;
    const used = [...new Set(d.tests.filter((t) => t.status !== 'Cancelled' && t.test_rush_schedule_id).map((t) => t.test_rush_schedule_id))];
    if (!used.length) { toast('No tests on this order have a rush schedule.', 'err'); return; }
    const fields = used.map((sid) => {
      const tiers = d.tiers.filter((t) => t.schedule_id === sid);
      return { name: sid, label: tiers[0]?.schedule_name || 'Rush', type: 'select', blank: false, value: '',
        options: [{ value: '', label: 'Standard turnaround' }, ...tiers.map((t) => ({ value: t.id, label: `${t.tier_name} (${t.rush_tat} ${t.tat_unit === 'Business Days' ? 'business' : 'calendar'} days)` }))] };
    });
    const v = await dialogs.form({ title: 'Rush the whole order', okText: 'Apply', intro: 'Choose a tier for each rush schedule on this order. Tiers that need approval go to the intake dashboard; the rest are accepted straight away.', fields });
    if (!v) return;
    let reason = ''; if (d.tests.some((t) => t.clock_start)) { reason = await dialogs.reason('rush on this order'); if (!reason) return; }
    try { const r = await api.rushOrder(id, v, reason); after(`${r.changed} test${r.changed === 1 ? '' : 's'} updated.`); } catch (e) { toast(e.message, 'err'); }
  }
  async function receive() {
    if (!ready()) return;
    const r = await openReceiveDialog(dialogs, toast, { order: o, samples: picked().filter((x) => x.status === 'Expected'), custody: cus });
    if (r) reload();
  }
  async function logNow() {
    if (!ready()) return;
    const ids = picked().filter((r) => r.status === 'Expected').map((r) => r.id);
    if (!ids.length) { toast('Tick the samples to log.', 'err'); return; }
    if (!(await dialogs.confirm('Log samples', `Log ${ids.length} sample${ids.length === 1 ? '' : 's'} now? Each gets its sample ID (${o.site_code}yymmdd###) and the turnaround clock starts (Day 0 = today, or the next working day if after a test's cutoff time).`, 'Log samples'))) return;
    try { const r = await api.logSamples(id, ids); after(`${r.logged} sample${r.logged === 1 ? '' : 's'} logged.`); } catch (e) { toast(e.message, 'err'); }
  }
  async function submitOrder() { try { await api.updateOrder(id, { status: 'Submitted' }); reload(); } catch (e) { toast(e.message, 'err'); } }
  async function editOrder() {
    const v = await dialogs.form({ title: 'Edit order', fields: [
      { name: 'ordering_contact_id', label: 'Ordering contact', type: 'select', blank: false, value: o.ordering_contact_id, options: d.contacts.map((c) => ({ value: c.id, label: c.name })) },
      { name: 'po_number', label: 'PO number', value: o.po_number },
      // the client's license the order is for (0.32.0): printed on the COA; an expired one is marked
      { name: 'client_license_id', label: 'Client license', type: 'select', value: o.client_license_id || '', options: (d.licenses || []).filter((l) => l.status_text === 'Active' || l.id === o.client_license_id).map((l) => ({ value: l.id, label: licText(l) })),
        help: (d.licenses || []).length ? 'Printed on the COA. Licenses are added on the client\'s page.' : 'This client has no licenses yet: add them on the client\'s page.' },
      { name: 'notes', label: 'Notes', type: 'textarea', value: o.notes }],
    submit: (x) => api.updateOrder(id, { ...x, client_license_id: x.client_license_id || null }) });
    if (v) reload();
  }
  function showTests(ids) { if (ids.some((x) => hidden.has(x))) { const n = new Set(hidden); ids.forEach((x) => n.delete(x)); setHidden(n); } }

  h.current = {
    cancel: cancelItems,
    analytes: async (r) => { if (await openAnalyteDialog(dialogs, r)) reload(); },
    specs: async (r) => { if (await openSpecDialog(dialogs, { requested_test: r.id })) reload(); },
    photos: async (r) => { if (await openPhotoDialog(dialogs, r)) reload(); },
    toggle: (sid) => { const n = new Set(hidden); if (n.has(sid)) n.delete(sid); else n.add(sid); setHidden(n); },
  };

  // right-click a selection of tests or samples: cancel them
  const testMenu = useCallback((e, sel) => {
    const rows = sel.filter((r) => r.id && r.status !== 'Cancelled'); if (!rows.length) return;
    dialogs.menu(e, [{ label: `Cancel ${rows.length === 1 ? rows[0].test_name : rows.length + ' selected tests'}…`, onClick: () => h.current.cancel({ tests: rows }) }]);
  }, [dialogs]);
  const sampleMenu = (e, sel) => {
    const rows = sel.filter((r) => r.id && r.status !== 'Cancelled'); if (!rows.length) return;
    dialogs.menu(e, [{ label: `Cancel ${rows.length === 1 ? (rows[0].sample_code || rows[0].client_sample_id || 'sample') : rows.length + ' selected samples'} and their tests…`, onClick: () => h.current.cancel({ samples: rows }) }]);
  };

  const panelHandlers = useRef({}); panelHandlers.current = { addTest, applyProject, addPackage };
  const detail = useMemo(() => ({
    open: (r) => !!r.id && !hidden.has(r.id), key: (r) => r.id,
    render: (r) => <TestPanel sample={r} tests={testsBySample.get(r.id) || NO_ROWS} columns={testColumns} rowClass={testRowClass} projects={projects} hasPackages={hasPackages}
      onState={onTestState} onMenu={testMenu} onAddTests={(ids) => panelHandlers.current.addTest(ids)} onApplyProject={(ids) => panelHandlers.current.applyProject(ids)}
      onAddPackage={(ids) => panelHandlers.current.addPackage(ids)} />,
  }), [hidden, testsBySample, testColumns, projects, hasPackages, onTestState, testMenu]);

  const anyShown = d.samples.some((x) => !hidden.has(x.id));
  const toggleAll = () => setHidden(anyShown ? new Set(d.samples.map((x) => x.id)) : new Set());

  const coaColumns = useMemo(() => [
    { field: 'report_id', title: 'Report', type: 'link', width: 170, href: () => '#', onClick: (v) => window.open(`/api/reports/coa/${v.id}/pdf?s=${s}`, '_blank') },
    { field: 'version_no', title: 'Version', type: 'readonly', width: 70 },
    { field: 'is_final', title: 'Final', type: 'readonly', width: 60, format: (v) => (v ? 'Yes' : '') },
    { field: 'latest', title: 'Current', type: 'readonly', width: 70, format: (v) => (v ? 'Yes' : 'Replaced') },
    { field: 'sample_code', title: 'Sample', type: 'link', width: 125, href: (v) => '#/samples/' + v.sample_id },
    { field: 'client_sample_id', title: 'Client sample ID', type: 'readonly', width: 130 },
    { field: 'issued_at', title: 'Issued', type: 'readonly', width: 150, format: dt },
    { field: 'issued_by_name', title: 'Finalized by', type: 'readonly', width: 150 },
    { field: 'verify_code', title: 'Verification code', type: 'link', width: 150, href: () => '#', onClick: (v) => window.open(`/verify.html?c=${v.verify_code}`, '_blank') }], [s]);
  const openEmail = useCallback((e) => showEmail(dialogs, e, site?.id), [dialogs, site]);
  const emailColumns = useMemo(() => [{ field: 'created_at', title: 'When', type: 'readonly', width: 150, format: dt }, { field: 'template', title: 'Type', type: 'readonly', width: 150 },
    { field: 'to_address', title: 'To', type: 'readonly', width: 230 }, { field: 'subject', title: 'Subject', type: 'link', href: () => '#', onClick: openEmail }], [openEmail]);

  return <>
    <PageHeader title={`Lab order ${o.order_code}`} audit={{ kind: 'order', id }}
      subtitle={<><a href={'#/clients/' + o.client_id}>{o.client_code} {o.client_name}</a> · {o.site_code} · {o.submission_channel} <Badge status={o.status} /> {o.is_gmp_client && <Badge status="GMP" />}</>}
      actions={<>
        <a className="btn ghost" href="#/orders">All orders</a>{' '}
        {o.status === 'Draft' && <><button type="button" className="btn" id="submit" onClick={() => run(submitOrder)} disabled={busy}>Submit order</button>{' '}</>}
        <button type="button" className="btn" id="edit" onClick={editOrder}>Edit order</button>{' '}
        <button type="button" className="btn" id="labels" disabled={!d.samples.some((x) => x.sample_code)} title={d.samples.some((x) => x.sample_code) ? undefined : 'Labels print once samples are logged (they need their sample ID)'}
          onClick={() => printLabels('sample', d.samples.filter((x) => x.sample_code && x.status !== 'Cancelled').map((x) => x.id))}>Print labels</button>{' '}
        <button type="button" className="btn primary" id="receive" disabled={!expected.length} title="Log the ticked samples and sign the chain of custody (Received by)" onClick={receive}>Receive and sign ({expected.length})</button>
        {!(cus && cus.required) && <> <button type="button" className="btn ghost" id="log" disabled={!expected.length || busy} title="Log without a signed receipt on the chain of custody" onClick={() => run(logNow)}>Log samples without signing ({expected.length})</button></>}
      </>} />
    {o.account_status === 'On Hold' && <div className="notice"><b>Client is On Hold.</b> Samples can be logged and tested, but reports cannot be released until the hold is lifted.</div>}
    <div className="card meta3 wide">
      <div><span>Ordering contact</span><b><a href={'#/contacts?find=' + encodeURIComponent(o.ordering_contact_code)}>{o.ordering_contact}</a></b></div><div><span>PO</span><b>{o.po_number || '—'}</b></div>
      <div><span>Client license</span><b className={curLic && curLic.state === 'Expired' ? 'bad' : undefined}>{licText(curLic)}</b></div>
      <div><span>Samples logged</span><b>{o.logged_count} of {o.sample_count}</b></div><div><span>Order due</span><b>{d8(o.due_date) || '—'}</b></div>
      <div><span>Order value</span><b>{money(o.order_value)}</b></div><div><span>Rush</span><b>{o.rush_pending ? o.rush_pending + ' awaiting approval' : o.rush_active ? o.rush_active + ' active' : 'None'}</b></div>
    </div>
    <Section title="Samples and tests" help="Add rows, paste from Excel, fill down with Ctrl+D. Several bottles or bags can be one sample (Containers). Each sample's tests are listed under it (▾ shows or hides them). Logging assigns the sample ID and starts the clock (Day 0)."
      actions={<>
        <button type="button" className="btn" id="applyP" disabled={!projects.length} onClick={() => applyProject(picked().map((r) => r.id))}>Apply project to ticked samples</button>{' '}
        <button type="button" className="btn" id="addT" onClick={() => addTest(picked().map((r) => r.id))}>Add tests to ticked samples…</button>{' '}
        {hasPackages && <><button type="button" className="btn" id="addPk" onClick={() => addPackage(picked().map((r) => r.id))}>Add a package to ticked samples</button>{' '}</>}
        <button type="button" className="btn" id="rushAll" onClick={rushAll}>Rush the whole order</button>{' '}
        <button type="button" className="btn ghost" id="cancelS" title="Cancel the ticked samples and their tests (kept, greyed; a reason is asked)" onClick={() => cancelItems({ samples: picked().filter((r) => r.status !== 'Cancelled') })}>Cancel ticked samples…</button>{' '}
        <button type="button" className="btn ghost" id="toggleAll" disabled={!d.samples.length} onClick={toggleAll}>{anyShown ? 'Hide all tests' : 'Show all tests'}</button>
      </>}>
      {(d.elsewhere || []).length > 0 && <p className="help" id="subc">Quoted tests that belong to another lab are subcontracted from {o.site_code} and cannot be ordered here yet: {d.elsewhere.map((x) => `${x.test_name} (${x.site_code})`).join(', ')}. Order them at that lab.</p>}
      <div className={`savebar${testChanges || testErrors ? ' show' : ''}`} id="tsb"><span className="pending">{plural(testChanges, 'test')} changed{testErrors > 0 && <> · <b className="bad">fix red cells</b></>}</span>
        <button type="button" className="btn ghost" id="tundo" onClick={discardTests}>Discard test changes</button><button type="button" className="btn primary" id="tsave" onClick={() => run(saveTestRows)} disabled={busy}>Save tests</button></div>
      <div className={`savebar${sampleChanges.length || sampleErrors ? ' show' : ''}`}><span className="pending">{plural(sampleChanges.length, 'sample')} changed{sampleErrors > 0 && <> · <b className="bad">fix red cells</b></>}</span>
        <button type="button" className="btn ghost" onClick={() => resetSamples(sRows)}>Discard</button><button type="button" className="btn primary" onClick={() => run(saveSampleRows)} disabled={busy}>Save samples</button></div>
      <div id="sg"><DataGrid grid={sg} rowClass={sampleRowClass} detail={detail} onContextMenu={sampleMenu} emptyText="No samples yet: add rows or paste from Excel." /></div>
    </Section>
    {d.attachments && d.attachments.length > 0 && <Section title="Attachments" help="Submission forms, chains of custody and other files (added from a sample's page).">
      <ul>{d.attachments.map((a) => <li key={a.id}><a href={`/api/attachments/${a.id}/file?s=${s}`} target="_blank" rel="noopener noreferrer">{a.label || a.file_name}</a> <span className="help">{a.kind}{a.sample_id ? '' : ', whole order'}</span></li>)}</ul>
    </Section>}
    {/* miscellaneous charges (0.36.0): kits, shipping, fees, discounts; billed at once */}
    <div id="ochg"><OrderChargesCard orderId={id} samples={d.samples} /></div>
    <div id="ocus"><CustodyCard orderId={id} custody={cus} onChange={reloadCustody} /></div>
    <OrderBillingCard orderId={id} />
    {coas.length > 0 && <Section title="Certificates of Analysis" help="Every COA issued for this order's samples, newest version first (the report ID is the sample ID followed by R and the version).">
      <ReadGrid rows={coas} columns={coaColumns} rowClass={(v) => (v.latest ? '' : 'mutedrow')} />
    </Section>}
    {d.emails.length > 0 && <Section title="Emails sent for this order" help="Sandbox: stored in the Outbox, not actually sent.">
      <ReadGrid rows={d.emails} columns={emailColumns} onRowOpen={openEmail} />
    </Section>}
  </>;
}
const NO_ROWS = [];
