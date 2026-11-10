// Test catalogue tabs other than Tests: Packages, Price changes, Charges, Service lines
import { useMemo, useRef } from 'react';
import * as api from '../../api/catalog.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import EditableGrid from '../../components/EditableGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { money } from '../../lib/format.js';
import { Button, Card } from 'react-bootstrap';

export const TABS = [['tests', 'Tests'], ['packages', 'Packages'], ['prices', 'Price changes'], ['charges', 'Charges'], ['lines', 'Service lines']];
export function TabBar({ tab }) {
  return <div className="tabs">{TABS.map(([k, l]) => <a key={k} className={`tab${k === tab ? ' on' : ''}`} href={'#/catalog' + (k === 'tests' ? '' : '?tab=' + k)}>{l}</a>)}</div>;
}

const inactiveMuted = (r) => (r.status === 'Inactive' ? 'mutedrow' : '');
const retiredMuted = (r) => (r.status === 'Retired' ? 'mutedrow' : '');

function Body({ error, data, children }) {
  if (error && !data) return <Card body className="err">{error.message}</Card>;
  if (!data) return <div className="loading">Loading…</div>;
  return children();
}

// ---------------------------------------------------------------- packages
const pkgHref = (r) => '#/catalog/packages/' + r.id;
const openPkg = (r) => { window.location.hash = pkgHref(r); };
const PACKAGE_COLUMNS = [
  { field: 'package_code', title: 'Code', type: 'link', width: 90, href: pkgHref },
  { field: 'package_name', title: 'Package', type: 'link', width: 230, href: pkgHref },
  { field: 'site_code', title: 'Lab', type: 'readonly', width: 60 },
  { field: 'tests', title: 'Tests', type: 'readonly', width: 320 },
  { field: 'list_value', title: 'Tests at list', type: 'money', width: 100 },
  { field: 'package_price', title: 'Package price', type: 'money', width: 110 },
  { field: 'discount_pct', title: 'Discount', type: 'readonly', width: 120, align: 'right', format: (v, r) => (Number(r.discount) > 0 ? `${money(r.discount)} (${Number(v)} %)` : '') },
  { field: 'errors', title: 'Problems', type: 'readonly', width: 90, format: (v) => (v ? `${v} to fix` : '') },
  { field: 'show_in_public_catalogue', title: 'Public', type: 'readonly', width: 65, format: (v) => (v ? 'Yes' : '') },
  { field: 'status', title: 'Status', type: 'readonly', width: 80 },
];

export function PackagesTab() {
  const { data: d, error } = useApi(api.listPackages, []);
  const dialogs = useDialogs();
  const toast = useToast();
  async function newPackage() {
    const v = await dialogs.form({ title: 'New package', okText: 'Create and add tests',
      intro: 'The package belongs to this lab and holds this lab\'s tests. On the next page you add the tests and type each one\'s price in the package; the package price and the discount are worked out from them.',
      fields: [
        { name: 'package_name', label: 'Package name', required: true },
        { name: 'description', label: 'Description (optional)' }] });
    if (!v) return;
    try { const r = await api.createPackage(v); openPkg(r); } catch (e) { toast(e.message, 'err'); }
  }
  return <>
    <PageHeader title="Test catalogue" audit={{ kind: 'packages' }}
      subtitle="Packages: several tests sold together at one price, quoted without being rebuilt. Each test carries its share of the price, so it is invoiced when its report is issued, and cancelling one takes off only its share."
      actions={d?.can_edit && <Button type="button" variant="primary" onClick={newPackage}>+ New package</Button>} />
    <TabBar tab="packages" />
    <Body error={error} data={d}>{() => (
      <EditableGrid readOnly search rows={d.rows} columns={PACKAGE_COLUMNS} onRowOpen={openPkg} rowClass={retiredMuted}
        emptyText={'No packages yet. "+ New package" puts tests together.'} />
    )}</Body>
  </>;
}

// ---------------------------------------------------------------- price changes
const PRICE_COLUMNS = [
  { field: 'change_code', title: 'Change', type: 'readonly', width: 80 },
  { field: 'effective_on', title: 'Starts', type: 'readonly', width: 100, format: (v) => String(v || '').slice(0, 10) },
  { field: 'pct', title: 'Change', type: 'readonly', width: 75, align: 'right', format: (v) => `${Number(v) > 0 ? '+' : ''}${Number(v)} %` },
  { field: 'scope', title: 'Tests', type: 'readonly', width: 280 },
  { field: 'rounding', title: 'Rounded to', type: 'readonly', width: 90, format: (v) => (v === 'Dollar' ? 'Dollar' : 'Cent') },
  { field: 'include_packages', title: 'Packages', type: 'readonly', width: 80, format: (v) => (v ? 'Yes' : 'No') },
  { field: 'status', title: 'Status', type: 'readonly', width: 90 },
  { field: 'reason', title: 'Reason', type: 'readonly', width: 220 },
  { field: 'created_by_name', title: 'By', type: 'readonly', width: 130 },
  { field: 'last_error', title: 'Note', type: 'readonly', width: 220, format: (v, r) => (r.status === 'Cancelled' ? `Cancelled by ${r.cancelled_by_name || ''}` : v || '') },
];
const cancelledMuted = (r) => (r.status === 'Cancelled' ? 'mutedrow' : '');

export function PricesTab() {
  const { data: d, error, reload } = useApi(api.listPriceChanges, []);
  const dialogs = useDialogs();
  const toast = useToast();
  const gridApi = useRef(null);
  async function cancelSelected() {
    const sel = (gridApi.current?.selectedRows() || []).filter((r) => r.status === 'Scheduled');
    if (!sel.length) { toast('Select a scheduled price change first.', 'err'); return; }
    if (!(await dialogs.confirm('Cancel price changes', `Cancel ${sel.map((r) => r.change_code).join(', ')}? Prices stay as they are.`, 'Cancel them'))) return;
    const reason = await dialogs.reason('the price change'); if (reason === null) return;
    try { for (const r of sel) await api.cancelPriceChange(r.id, reason); toast('Cancelled.'); } catch (e) { toast(e.message, 'err'); }
    reload();
  }
  return <>
    <PageHeader title="Test catalogue" audit={{ kind: 'price_changes' }}
      subtitle={'Price changes made with "Update prices…" (Tests tab): applied on their start date, the first time the hourly job runs that day. A scheduled one can be cancelled until then.'}
      actions={d?.can_edit && <Button type="button" variant="outline-secondary" onClick={cancelSelected}>Cancel selected…</Button>} />
    <TabBar tab="prices" />
    <Body error={error} data={d}>{() => (
      <EditableGrid readOnly rows={d.rows} columns={PRICE_COLUMNS} rowClass={cancelledMuted} apiRef={gridApi}
        emptyText={'No price changes yet. Select tests on the Tests tab and use "Update prices…".'} />
    )}</Body>
  </>;
}

// ---------------------------------------------------------------- charges (0.36.0)
const CHARGE_KINDS = ['Kit', 'Shipping', 'Report fee', 'Surcharge', 'Discount', 'Other'];
const newCharge = () => ({ kind: 'Other', price: 0, status: 'Active', scope: 'This lab' });

export function ChargesTab() {
  const { data, error, reload } = useApi(async (opts) => {
    const [d, sl] = await Promise.all([api.listChargeItems(opts), api.getServiceLines(opts)]);
    return { d, lines: sl.lines };
  }, []);
  const columns = useMemo(() => {
    if (!data) return [];
    const { d, lines } = data;
    return [
      { field: 'charge_code', title: 'Code', type: 'readonly', width: 80 },
      { field: 'charge_name', title: 'Charge', width: 220, required: true },
      { field: 'kind', title: 'Kind', type: 'select', width: 110, options: CHARGE_KINDS },
      { field: 'price', title: 'Price', type: 'money', min: 0, width: 95, help: 'The default price (a Discount: the amount taken off). Each client\'s price can be set on their quote.' },
      { field: 'description', title: 'Description', width: 240 },
      { field: 'service_line_id', title: 'Service line', type: 'select', width: 150, options: () => [{ value: null, label: '' }, ...lines.map((l) => ({ value: l.id, label: l.line_name }))],
        format: (v) => (lines.find((l) => l.id === v) || {}).line_name || '' },
      { field: 'scope', title: 'Applies to', type: 'select', width: 110, options: d.is_admin ? ['This lab', 'Every lab'] : ['This lab'], editable: (r, isNew) => isNew,
        format: (v, r) => (r.id ? (r.site_id ? r.site_code : 'Every lab') : v) },
      { field: 'status', title: 'Status', type: 'select', width: 95, options: ['Active', 'Inactive'] },
      { field: 'used', title: 'Used', type: 'readonly', width: 60, help: 'How many times it is on lab orders' },
    ];
  }, [data]);
  const d = data?.d;
  return <>
    <PageHeader title="Test catalogue" audit={{ kind: 'charges' }}
      subtitle="Charges that are not tests: sampling kits, shipping, report fees, surcharges and discounts. They go on lab orders (billed at once, never on a COA), on quotes at a price per client, and on draft invoices. A Discount is taken off." />
    <TabBar tab="charges" />
    <Body error={error} data={data}>{() => <>
      <p className="help">{d.can_edit ? `Add rows or paste from Excel; fill down with Ctrl+D. A new charge is this lab's${d.is_admin ? ', or every lab\'s (choose in Applies to; system administrators only)' : ''}. Retire a charge by setting it Inactive.` : 'Changed by people with catalog.edit (General Managers).'}</p>
      <EditableGrid rows={d.rows} columns={columns} search readOnly={!d.can_edit} allowAdd={d.can_edit} what="charges" newRow={newCharge} rowClass={inactiveMuted}
        emptyText="No charges yet. Add rows: e.g. Sampling kit (Kit), Ground shipping (Shipping), Rush report fee (Report fee), Loyalty discount (Discount)."
        save={api.saveChargeItems} afterSave={reload} />
    </>}</Body>
  </>;
}

// ---------------------------------------------------------------- service lines (0.36.0)
export function LinesTab() {
  const { data, error, reload } = useApi(async (opts) => {
    const [d, tests] = await Promise.all([api.getServiceLines(opts), api.serviceLineTests(opts)]);
    return { d, tests };
  }, []);
  const cols = useMemo(() => {
    if (!data) return null;
    const { d } = data;
    const typeLabel = (id) => { const t = d.types.find((x) => x.id === id); return t ? `${t.line_name} > ${t.type_name}` : ''; };
    return {
      lines: [
        { field: 'line_name', title: 'Service line', width: 200, required: true },
        { field: 'sort_order', title: 'Order', type: 'int', width: 70 },
        { field: 'status', title: 'Status', type: 'select', width: 95, options: ['Active', 'Inactive'] }],
      types: [
        { field: 'service_line_id', title: 'Service line', type: 'select', width: 170, required: true, editable: (r, isNew) => isNew,
          options: () => d.lines.map((l) => ({ value: l.id, label: l.line_name })), format: (v) => (d.lines.find((l) => l.id === v) || {}).line_name || '' },
        { field: 'type_name', title: 'Type', width: 190, required: true },
        { field: 'sort_order', title: 'Order', type: 'int', width: 70 },
        { field: 'status', title: 'Status', type: 'select', width: 95, options: ['Active', 'Inactive'] },
        { field: 'test_count', title: 'Tests here', type: 'readonly', width: 80 }],
      tests: [
        { field: 'test_code', title: 'Code', type: 'link', width: 85, href: (r) => '#/catalog/' + r.id },
        { field: 'test_name', title: 'Test', type: 'readonly', width: 260 },
        { field: 'department_name', title: 'Department', type: 'readonly', width: 140 },
        { field: 'service_line_type_id', title: 'Service line > type', type: 'select', width: 280,
          options: () => [{ value: null, label: '' }, ...d.types.filter((t) => t.status === 'Active').map((t) => ({ value: t.id, label: `${t.line_name} > ${t.type_name}` }))], format: typeLabel }],
      newLine: () => ({ status: 'Active', sort_order: (d.lines.length + 1) * 10 }),
    };
  }, [data]);
  const d = data?.d;
  return <>
    <PageHeader title="Test catalogue" audit={{ kind: 'service_lines' }}
      subtitle="Service line > service line type > department: how the order's test picker narrows this lab's tests (Cecilia, 2026-10-21). Service lines and types are shared by every lab; each lab puts its own tests under them. Clients' service lines are set on the client page." />
    <TabBar tab="lines" />
    <Body error={error} data={data}>{() => <>
      <div className="cols">
        <Section title="Service lines" help={d.can_edit ? 'Add, rename or set Inactive. Paste and fill down work.' : ''}>
          <EditableGrid rows={d.lines} columns={cols.lines} readOnly={!d.can_edit} allowAdd={d.can_edit} what="service lines" newRow={cols.newLine}
            rowClass={inactiveMuted} save={api.saveServiceLines} afterSave={reload} />
        </Section>
        <Section title="Service line types" help={d.can_edit ? 'Each type sits under one service line. Paste and fill down work.' : ''}>
          <EditableGrid rows={d.types} columns={cols.types} readOnly={!d.can_edit} allowAdd={d.can_edit} what="service line types" newRow={newType}
            rowClass={inactiveMuted} save={api.saveServiceLineTypes} afterSave={reload} />
        </Section>
      </div>
      <Section title="This lab's tests" help="Pick each test's service line type (type to search); select a block and fill down with Ctrl+D, or paste from Excel. Its department is set in the Workflow Designer.">
        <EditableGrid rows={data.tests} columns={cols.tests} search readOnly={!d.can_edit} what="the service line types of tests"
          save={api.saveServiceLineTests} afterSave={reload} />
      </Section>
    </>}</Body>
  </>;
}
const newType = () => ({ status: 'Active', sort_order: 10 });
