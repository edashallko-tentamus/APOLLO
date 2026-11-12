// A test package (P-1; 049, Alex 2026-10-19): each test is priced in the package; the package price is their sum and the
// discount is worked out from the catalogue prices
import { useMemo, useRef, useState } from 'react';
import * as api from '../../api/catalog.js';
import Badge from '../../components/Badge.jsx';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import DataGrid from '../../components/grid/DataGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { money, plural } from '../../lib/format.js';
import { useUnsavedChanges } from '../../router/useHashRoute.js';
import PickList from '../charges/PickList.jsx';
import { useRowQueue } from './rowQueue.js';
import { Button, Card } from 'react-bootstrap';

const pctOff = (list, price) => (Number(list) > 0 && Number(price) < Number(list) ? Math.round((1 - Number(price) / Number(list)) * 1000) / 10 : 0);
const ITEM_COLUMNS = [
  { field: 'test_name', title: 'Test', type: 'readonly', width: 240 },
  { field: 'pricing_mode', title: 'Pricing mode', type: 'readonly', width: 150 },
  { field: 'analytes', title: 'Analytes', type: 'readonly', width: 80 },
  { field: 'list_price', title: 'Catalogue price', type: 'money', width: 115, editable: () => false },
  { field: 'component_price', title: 'Price in the package', type: 'money', min: 0, required: true, width: 145 },
  { field: 'discount', title: 'Discount', type: 'readonly', width: 120, align: 'right',
    format: (v, r) => { const lp = Number(r.list_price) || 0; const pr = Number(r.component_price ?? lp); return lp - pr > 0 ? `${money(lp - pr)} (${pctOff(lp, pr)} %)` : (pr > lp ? 'Above catalogue' : ''); } },
  { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 95 },
];
const ANALYTE_COLUMNS = [
  { field: 'test_name', title: 'Test', type: 'readonly', width: 200 },
  { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 200 },
  { field: 'catalogue_price', title: 'Catalogue price', type: 'money', width: 115, editable: () => false },
  { field: 'included', title: 'In the package', type: 'bool', width: 115 },
];

function Editor({ d, opts, reload }) {
  const p = d.package; const ed = d.can_edit && p.status === 'Active';
  const dialogs = useDialogs();
  const toast = useToast();
  const [orig] = useState(() => ({ package_name: p.package_name || '', description: p.description || '', show_in_public_catalogue: !!p.show_in_public_catalogue }));
  const [form, setForm] = useState(orig);
  const [saving, setSaving] = useState(false);

  const itemRows = useMemo(() => d.lines.map((l) => ({ id: l.item_id, test_id: l.test_id, test_name: l.test_name, pricing_mode: l.pricing_mode, list_price: l.list_price,
    component_price: l.typed_price, analytes: l.pricing_mode === 'Analyte Selection' ? `${l.analytes_in} of ${l.analytes_total}` : '', status: 'Active' })), [d]);
  const anRows = useMemo(() => d.analytes.map((a) => ({ id: a.item_id + ':' + a.analyte_id, item_id: a.item_id, analyte_id: a.analyte_id,
    test_name: (d.lines.find((l) => l.item_id === a.item_id) || {}).test_name || '', analyte_name: a.analyte_name, catalogue_price: a.catalogue_price, included: a.included })), [d]);
  const queue = useRowQueue(() => ({ status: 'Active' }));
  // allowAdd only so "+ Add tests" can add rows; the grid's own add buttons are hidden (rows without a test are not saved)
  const ig = useGrid({ rows: itemRows, columns: ITEM_COLUMNS, readOnly: !ed, allowAdd: true, newRow: queue.newRow });
  queue.useClear(ig);
  const ag = useGrid({ rows: anRows, columns: ANALYTE_COLUMNS, readOnly: !ed });

  const headerDirty = JSON.stringify(form) !== JSON.stringify(orig);
  useUnsavedChanges(headerDirty || ig.changes.length > 0 || ag.changes.length > 0);

  const active = ig.state.rows.filter((r) => r.test_id && r.status !== 'Inactive');
  const price = active.reduce((s, r) => s + (Number(r.component_price ?? r.list_price) || 0), 0);
  const list = active.reduce((s, r) => s + (Number(r.list_price) || 0), 0);
  const errors = d.problems.filter((x) => x.severity === 'Error');

  async function addTests() {
    const have = new Set(ig.state.rows.map((r) => r.test_id));
    const avail = opts.tests.filter((t) => !have.has(t.id) && Number(t.list_price) > 0);
    const picked = new Set();
    const v = await dialogs.form({ title: 'Add tests to the package', okText: 'Add', wide: true,
      intro: 'This lab\'s active, priced tests. A test with no approved workflow can be packaged but not ordered until it has one.',
      after: <PickList items={avail.map((t) => ({ value: t.id, label: t.test_name, small: `${t.test_code} · ${money(t.list_price)}${t.approved ? '' : ' · no approved workflow'}` }))}
        picked={picked} empty="Every priced test of this lab is in the package already." /> });
    if (!v || !picked.size) return;
    queue.add(ig, [...picked].map((tid) => {
      const t = opts.tests.find((x) => x.id === tid);
      return { test_id: tid, test_name: t.test_name, pricing_mode: t.pricing_mode, list_price: t.list_price, component_price: Number(t.list_price), analytes: '', status: 'Active' };
    }));
    toast(`${plural(picked.size, 'test')} added: Save to keep ${picked.size === 1 ? 'it' : 'them'}.`);
  }

  async function save() {
    if (saving) return;
    if (ig.errorCount || ag.errorCount) { toast('Fix the cells marked in red first.', 'err'); return; }
    // existing items are sent whole (price and status), new ones by test with their price
    const items = ig.changes.map((c) => {
      if (c.id) { const r = ig.state.rows.find((x) => x.id === c.id); return { id: r.id, component_price: r.component_price, status: r.status }; }
      return c.test_id ? { test_id: c.test_id, component_price: c.component_price } : null;
    }).filter(Boolean);
    const analytes = ag.changes.map((c) => ag.state.rows.find((x) => x.id === c.id)).map((r) => ({ item_id: r.item_id, analyte_id: r.analyte_id, included: !!r.included }));
    if (!headerDirty && !items.length && !analytes.length) { toast('Nothing to save.'); return; }
    const reason = await dialogs.reason(`package ${p.package_code}`); if (reason === null) return;
    const body = { reason, items, analytes };
    if (headerDirty) body.header = { ...form };
    setSaving(true);
    try { await api.savePackage(p.id, body); ig.reset(itemRows); ag.reset(anRows); setForm(orig); toast('Saved.'); reload(); }
    catch (e) { toast(e.message, 'err'); } finally { setSaving(false); }
  }
  async function retire() {
    if (!(await dialogs.confirm('Retire the package', `Retire ${p.package_code} ${p.package_name}? New quotes can no longer take it. Quotes and orders that have it keep it.`, 'Retire'))) return;
    const reason = await dialogs.reason(`package ${p.package_code}`); if (reason === null) return;
    try { await api.retirePackage(p.id, reason); ig.reset(itemRows); ag.reset(anRows); setForm(orig); toast('Retired.'); reload(); } catch (e) { toast(e.message, 'err'); }
  }

  const field = (k) => <input value={form[k]} disabled={!ed} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />;
  return <>
    <PageHeader title={p.package_name} audit={{ kind: 'test_package', id: p.id }}
      subtitle={<>{p.package_code} <Badge status={p.status} /> · {p.site_code} · Test catalogue package</>}
      actions={<><Button variant="light" href="#/catalog?tab=packages">Packages</Button>
        {ed && <>{' '}<Button type="button" variant="light" onClick={retire}>Retire…</Button>{' '}<Button type="button" variant="primary" onClick={save} disabled={saving}>Save</Button></>}</>} />
    {d.problems.length > 0 && (
      <Card body className={errors.length ? 'warn' : undefined}><h2>{errors.length ? 'To fix before it can be quoted' : 'Worth a look'}</h2>
        <ul>{d.problems.map((x, i) => <li key={i}><b>{x.severity}:</b> {x.problem}</li>)}</ul></Card>
    )}
    <div className="cols">
      <Card body><h2>Package</h2><div className="frm">
        <label>Package name{field('package_name')}</label>
        <label>Description{field('description')}</label>
        <div className="row3" id="pksum">
          <div className="listprice"><span>Package price</span><b data-s="price">{money(price)}</b><small>The tests' prices added up</small></div>
          <div className="listprice"><span>Tests at catalogue price</span><b data-s="list">{money(list)}</b><small>The analytes in the package</small></div>
          <div className="listprice"><span>Discount</span><b data-s="disc">{money(Math.max(list - price, 0))}</b><small data-s="pct">{pctOff(list, price)} % off</small></div>
        </div>
        <label className="cb"><input type="checkbox" checked={form.show_in_public_catalogue} disabled={!ed}
          onChange={(e) => setForm((f) => ({ ...f, show_in_public_catalogue: e.target.checked }))} /> Show in public catalogue</label>
      </div></Card>
      <Card body><h2>On quotes</h2>
        {d.quotes.length
          ? <table className="tbl"><tbody><tr><th>Quote</th><th>Client</th><th>Status</th><th>Price</th></tr>
            {d.quotes.map((q) => <tr key={q.version_id}><td><a href={'#/quote/' + q.version_id}>{q.project_code} v{q.version_no}</a></td><td>{q.client_name}</td><td><Badge status={q.status} /></td><td>{money(q.package_price)}</td></tr>)}</tbody></table>
          : <p className="help">Not on any quote yet. Quotes take the package from Pricing: open a quote and use "Add a package".</p>}
        <p className="help">Changing the package changes new quotes only. A quote keeps the price and shares it was given.</p></Card>
    </div>
    <Section title="Tests in the package" help="Type each test's price in the package: that is what it is quoted and invoiced at, and the package price is their sum. A test added starts at its catalogue price (no discount). The discount is worked out from the catalogue prices."
      actions={ed && <Button type="button" variant="outline-secondary" onClick={addTests}>+ Add tests</Button>}>
      <DataGrid grid={{ ...ig, allowAdd: false }} emptyText={'No tests yet: "+ Add tests".'} />
    </Section>
    {anRows.length > 0 && (
      <Section title="Analytes of analyte-priced tests" help="Untick an analyte to leave it out of the package. The test's catalogue price follows after saving; its price in the package stays as typed, so lower it too if it should.">
        <DataGrid grid={ag} />
      </Section>
    )}
  </>;
}

export default function PackageEditorPage({ params }) {
  const [id] = params;
  const { data, error, reload } = useApi(async () => {
    const [d, opts] = await Promise.all([api.getPackage(id), api.packageOptions()]);
    return { d, opts };
  }, [id]);
  const gen = useRef({ data: null, n: 0 });
  if (data && data !== gen.current.data) gen.current = { data, n: gen.current.n + 1 };
  if (error && !data) return <Card body className="err">{error.message}</Card>;
  if (!data) return <div className="loading">Loading…</div>;
  return <Editor key={gen.current.n} {...data} reload={reload} />;
}
