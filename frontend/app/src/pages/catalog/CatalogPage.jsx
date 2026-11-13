// Test catalogue: tabs Tests | Packages (P-1, migration 047) | Price changes | Charges | Service lines (0.36.0, migration 058)
import { useRef } from 'react';
import * as api from '../../api/catalog.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import EditableGrid from '../../components/EditableGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { money, plural } from '../../lib/format.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { ChargesTab, LinesTab, PackagesTab, PricesTab, TABS, TabBar } from './CatalogTabs.jsx';
import { Button, Card } from 'react-bootstrap';

const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const testHref = (r) => '#/catalog/' + r.test_id;
const openTest = (r) => { window.location.hash = testHref(r); };
const retiredMuted = (r) => (r.test_status === 'Retired' ? 'mutedrow' : '');
const COLUMNS = [
  { field: 'test_code', title: 'Code', type: 'link', width: 85, href: testHref },
  { field: 'test_name', title: 'Test', type: 'link', width: 230, href: testHref },
  { field: 'site_code', title: 'Lab', type: 'readonly', width: 60 },
  { field: 'pricing_mode', title: 'Pricing mode', type: 'readonly', width: 170 },
  { field: 'base_price', title: 'Base', type: 'money', width: 85 },
  { field: 'prep_fee', title: 'Prep fee', type: 'money', width: 85 },
  { field: 'analyte_count', title: 'Analytes', type: 'readonly', width: 75, align: 'right', format: (v, r) => (r.pricing_mode === 'Analyte Selection' ? v : '') },
  { field: 'list_price', title: 'List price', type: 'money', width: 95 },
  { field: 'standard_tat', title: 'Std TAT', type: 'readonly', width: 120, format: (v, r) => `${v} ${r.tat_unit === 'Business Days' ? 'business' : 'calendar'} days` },
  { field: 'cutoff_time', title: 'Cutoff', type: 'readonly', width: 70, format: (v) => (v || '').slice(0, 5) },
  { field: 'rush_schedule', title: 'Rush schedule', type: 'readonly', width: 130 },
  { field: 'show_in_public_catalogue', title: 'Public', type: 'readonly', width: 65, format: (v) => (v ? 'Yes' : '') },
];

function TestsTab({ query }) {
  const { data: rows, error, reload } = useApi(api.listCatalog, []);
  const { can, site } = useSession();
  const dialogs = useDialogs();
  const toast = useToast();
  const gridApi = useRef(null);
  const find = new URLSearchParams(query).get('find') || '';

  // dated price change (P-1, Alex 2026-10-19): one test, a selection or every active test of this lab, by a percentage,
  // rounded to the cent or the dollar, from an effective date; quotes already made keep their prices
  async function reprice() {
    const siteId = site?.id;
    const mine = rows.filter((r) => r.test_status !== 'Retired' && r.site_id === siteId);
    const sel = (gridApi.current?.selectedRows() || []).filter((r) => r.test_status !== 'Retired');
    const other = sel.filter((r) => r.site_id !== siteId);
    const ids = [...new Set(sel.filter((r) => r.site_id === siteId).map((r) => r.test_id))];
    const v = await dialogs.form({ title: 'Update catalogue prices', okText: 'Next: reason',
      intro: <>Each part of the price (base price, preparation fee, analyte prices) changes by the percentage, so the list price follows. With "Packages" ticked, these tests' prices in packages change by the same percentage. Quotes already made keep their prices; quotes made from the start date use the new ones.
        {other.length > 0 && <> <b>{other.length} selected test{other.length === 1 ? ' is' : 's are'} another lab's and will be left out</b> (change them from that lab).</>}</>,
      fields: [
        { name: 'scope', label: 'Tests', type: 'select', blank: false, value: ids.length ? 'selected' : 'all',
          options: [...(ids.length ? [{ value: 'selected', label: `The ${plural(ids.length, 'selected test')}` }] : []), { value: 'all', label: `Every active test of this lab (${mine.length})` }] },
        { name: 'pct', label: 'Change by (%)', type: 'number', required: true, help: 'e.g. 3 for a 3 % increase, -5 for a 5 % decrease' },
        { name: 'effective_on', label: 'New prices start on', type: 'date', required: true, value: todayIso(), help: 'Today changes the prices at once; a later date is scheduled and applied that morning.' },
        { name: 'rounding', label: 'Round each price to', type: 'select', blank: false, value: 'Cent', options: [{ value: 'Cent', label: 'The cent ($104.03)' }, { value: 'Dollar', label: 'The dollar ($104.00)' }] },
        { name: 'include_packages', label: 'Packages', type: 'checkbox', value: true, cbLabel: 'Also change these tests\' prices in packages' }] });
    if (!v) return;
    const pct = Number(v.pct);
    if (!pct) { toast('Give the percentage (not 0).', 'err'); return; }
    const scope = v.scope === 'selected' ? mine.filter((r) => ids.includes(r.test_id)) : mine;
    const ex = scope.find((r) => Number(r.list_price) > 0);
    const r1 = (x) => (v.rounding === 'Dollar' ? Math.round(x) : Math.round(x * 100) / 100);
    const today = v.effective_on <= todayIso();
    if (!(await dialogs.confirm('Update catalogue prices', `${pct > 0 ? 'Raise' : 'Lower'} the prices of ${plural(scope.length, 'test')} by ${Math.abs(pct)} % ${today ? 'now' : 'from ' + v.effective_on}?${ex ? ` For example ${ex.test_name}: ${money(ex.list_price)} becomes about ${money(r1(ex.list_price * (1 + pct / 100)))}.` : ''}`, 'Continue'))) return;
    const reason = await dialogs.reason('catalogue prices'); if (reason === null) return;
    try {
      const r = await api.createPriceChange({ pct, tests: v.scope === 'selected' ? ids : null, effective_on: v.effective_on, rounding: v.rounding, include_packages: v.include_packages, reason });
      const applied = r.applied !== null && r.applied !== undefined;
      toast(applied ? `${r.change_code}: ${plural(r.applied, 'price')} changed by ${pct} %.` : `${r.change_code} scheduled for ${v.effective_on}.`);
      if (applied) reload(); else window.location.hash = '#/catalog?tab=prices';
    } catch (e) { toast(e.message, 'err'); }
  }

  return <>
    <PageHeader title="Test catalogue" audit={{ kind: 'catalog' }}
      subtitle="Built by the Test Workflow Designer (step 1). Pricing lives here, outside the validated test version."
      actions={<>
        <Button variant="light" href="/api/catalog.csv">Download catalogue (CSV)</Button>{' '}
        <Button variant="light" href="/api/catalog.csv?public=1">Public catalogue (CSV)</Button>{' '}
        {can('catalog.edit') && <><Button type="button" variant="outline-secondary" onClick={reprice} disabled={!rows}>Update prices…</Button>{' '}</>}
        {/* new tests are made in the Workflow Designer (they belong to a lab and a department, and are approved there) */}
        <Button variant="primary" href="#/methods?new=1">+ New test</Button>
      </>} />
    <TabBar tab="tests" />
    <p className="help">Select tests (Ctrl+click or Shift+click for several) and "Update prices…" changes them by a percentage from the date you choose; with nothing selected it can change every active test of this lab.</p>
    {error && !rows ? <Card body className="err">{error.message}</Card>
      : !rows ? <div className="loading">Loading…</div>
        : <EditableGrid readOnly search filter={find} rows={rows} columns={COLUMNS} onRowOpen={openTest} rowClass={retiredMuted} apiRef={gridApi} />}
  </>;
}

export default function CatalogPage({ query }) {
  const want = new URLSearchParams(query).get('tab');
  const tab = TABS.some(([k]) => k === want) ? want : 'tests';
  if (tab === 'packages') return <PackagesTab />;
  if (tab === 'prices') return <PricesTab />;
  if (tab === 'charges') return <ChargesTab />;
  if (tab === 'lines') return <LinesTab />;
  return <TestsTab query={query} />;
}
