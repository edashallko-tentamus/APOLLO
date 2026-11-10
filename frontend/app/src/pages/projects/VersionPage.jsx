// #/quote/<version id>: a quote or project version: its lines (final price or discount %, analytes, specs, trash),
// packages, totals, charges, the test picker, rush terms, and the lifecycle (issue, send, accept, reject, re-quote).
import { useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../../api/projects.js';
import { quotePeople, updateQuote } from '../../api/quotes.js';
import Badge from '../../components/Badge.jsx';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import DataGrid from '../../components/grid/DataGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import SmartSelect from '../../components/SmartSelect.jsx';
import { openSpecDialog } from '../../components/SpecDialog.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { money } from '../../lib/format.js';
import { useUnsavedChanges } from '../../router/useHashRoute.js';
import { QuoteChargesCard } from '../charges/ChargesCards.jsx';
import { decideQuote, sendQuote } from '../quotes/quoteDialogs.js';
import TestPicker from '../quotes/TestPicker.jsx';
import '../quotes/quotes.css';
import AnalyteDialog from './AnalyteDialog.jsx';

const NO_PACKAGES = { rows: [], options: [], allowed: false };
const has = (v) => v !== null && v !== undefined;
const round2 = (n) => Math.round(n * 100) / 100;
const issueOf = (r) => (r.status === 'Removed' ? '' : !has(r.final_price) ? 'Missing final price'
  : r.final_price > r.list_price ? 'Above list price' : r.list_price > 0 && (r.list_price - r.final_price) / r.list_price >= 0.5 ? 'Discount 50% or more'
    : r.final_price === 0 ? 'Zero price' : '');
const tatShort = (r) => `${r.standard_tat} ${r.tat_unit === 'Business Days' ? 'bus.' : 'cal.'} days`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function load(vid, o) {
  return Promise.all([api.getVersion(vid, o), api.versionPackages(vid, o).catch(() => NO_PACKAGES)]).then(([d, pk]) => ({ d, pk }));
}

export default function VersionPage({ params }) {
  const vid = params[0];
  const { data, error, reload } = useApi((o) => load(vid, o), [vid]);
  const stability = data?.d.version.kind === 'Stability';
  useEffect(() => { if (stability) window.location.replace('#/stability/quotes/' + data.d.version.project_id); }, [stability]); // eslint-disable-line react-hooks/exhaustive-deps -- migration 032
  if (error && !data) return <div className="card err">{error.message}</div>;
  if (!data || stability) return <div className="loading">Loading…</div>;
  return <Version key={vid} vid={vid} d={data.d} pk={data.pk} reload={reload} />;
}

function Version({ vid, d, pk, reload }) {
  const dialogs = useDialogs(); const toast = useToast();
  const v = d.version; const ed = v.editable; const lpa = v.is_list_price_acceptance;
  const isQuote = v.kind === 'Quote';
  const [busy, setBusy] = useState(false);
  const [pkPick, setPkPick] = useState(''); const [pkQty, setPkQty] = useState(1);
  const h = useRef({}); // the grids' buttons call the latest handlers

  // ---- lines
  const lineRows = useMemo(() => d.lines.map((l) => ({ ...l, id: l.line_id, status: 'Active' })), [d.lines]);
  const lineCols = useMemo(() => [
    { field: 'test_code', title: 'Code', type: 'link', width: 75, href: (r) => (r.test_id ? '#/catalog/' + r.test_id : null) },
    { field: 'test_name', title: 'Test', type: 'readonly', width: 210 },
    // another network lab's test is subcontracted (the 20-30 rule, migration 031)
    { field: 'lab', title: 'Lab', type: 'readonly', width: 150, compute: (r) => (r.is_subcontracted ? `${r.lab} (subcontracted)` : r.lab), cellClass: (r) => (r.is_subcontracted ? 'flag' : ''),
      help: 'The lab that does the test. Subcontracted: another Tentamus lab; its price is that lab\'s catalogue price less the in-network discount, plus this lab\'s markup.' },
    { field: 'analytes', title: 'Analytes', type: 'button', width: 95, label: (r) => (r.pricing_mode === 'Analyte Selection' ? `${r.analytes_included} of ${r.analytes_total}` : '—'),
      onClick: (r) => { if (r.pricing_mode === 'Analyte Selection') h.current.analytes(r); } },
    { field: 'quantity', title: 'Qty', type: 'int', min: 1, width: 60 },
    { field: 'list_price', title: 'List', type: 'money', width: 95, compute: (r) => r.list_price },
    { field: 'final_price', title: 'Final price', type: 'money', min: 0, width: 105, editable: () => !lpa },
    { field: 'd_amt', title: 'Discount $', type: 'money', width: 95, compute: (r) => (has(r.final_price) ? r.list_price - r.final_price : null) },
    // 0.36.0 (Cecilia): a discount typed as a percentage sets the final price (to the cent)
    { field: 'd_pct', title: 'Discount %', type: 'pct', width: 90, compute: (r) => (!has(r.final_price) || !r.list_price ? null : (r.list_price - r.final_price) / r.list_price * 100),
      assign: (r, x) => { r.final_price = round2(Number(r.list_price || 0) * (1 - Number(x) / 100)); }, editable: () => !lpa,
      help: 'Type a discount % to set the final price, or type the final price and the % follows' },
    { field: 'total', title: 'Line total', type: 'money', width: 105, compute: (r) => (has(r.final_price) ? r.final_price * (r.quantity || 0) : null) },
    { field: 'tat', title: 'Std TAT', type: 'readonly', width: 90, compute: tatShort },
    { field: 'rush_schedule', title: 'Rush schedule', type: 'readonly', width: 120 },
    { field: 'issue', title: 'Check', type: 'readonly', width: 150, compute: issueOf, cellClass: (r) => (issueOf(r) ? 'flag' : '') },
    { field: 'special_instructions', title: 'Instructions', width: 160 },
    // the trash button takes a line off the quote (Alex: easier than choosing Removed); kept in the audit trail
    { field: 'trash', title: '', type: 'button', width: 44, help: 'Remove this test from the quote', label: (r) => (ed && r.line_id ? '🗑' : ''), onClick: (r) => h.current.removeLine(r) },
    { field: 'specs', title: 'Specs', type: 'button', width: 95, label: (r) => (Number(r.spec_count) ? `${r.spec_count} limit${Number(r.spec_count) === 1 ? '' : 's'}` : 'Unspecified'),
      help: 'Specification limits for this quoted test; they are copied to every test ordered from this quote. Unspecified: results are reported as they are.',
      onClick: (r) => { if (r.line_id) h.current.specs(r.line_id); } },
    { field: 'cost_price', title: 'In-network cost', type: 'money', width: 110, compute: (r) => (r.is_subcontracted ? r.cost_price : null),
      help: 'Subcontracted tests only: what the other lab charges (its catalogue price less the in-network discount). Internal: not on the quotation.' },
  ], [ed, lpa]);
  const lg = useGrid({ rows: lineRows, columns: lineCols, readOnly: !ed });

  // ---- packages (P-1, migration 047)
  const showPk = pk.rows.length > 0 || (ed && pk.allowed);
  const pkRows = useMemo(() => pk.rows.map((r) => ({ ...r, tests_text: r.tests.map((t) => t.test_name + (t.pricing_mode === 'Analyte Selection' ? ` (${t.analytes_included} of ${t.analytes_total})` : '') + ': ' + money(t.final_price)).join('; ') })), [pk.rows]);
  const pkCols = useMemo(() => [
    { field: 'package_code', title: 'Package', type: 'link', width: 90, href: (r) => '#/catalog/packages/' + r.package_id },
    { field: 'package_name', title: 'Name', type: 'readonly', width: 190 },
    { field: 'tests_text', title: 'Tests and their shares', type: 'readonly', width: 360 },
    { field: 'quantity', title: 'Qty', type: 'int', min: 1, width: 60 },
    { field: 'list_price', title: 'Tests at list', type: 'money', width: 100, editable: () => false },
    { field: 'package_price', title: 'Package price', type: 'money', min: 0, width: 110 },
    { field: 'd_pct', title: 'Discount %', type: 'pct', width: 90, compute: (r) => (r.list_price ? (r.list_price - (r.package_price || 0)) / r.list_price * 100 : null),
      assign: (r, x) => { r.package_price = round2(Number(r.list_price || 0) * (1 - Number(x) / 100)); }, help: 'Type a discount % to set the package price' },
    { field: 'total', title: 'Total', type: 'money', width: 105, compute: (r) => (r.package_price || 0) * (r.quantity || 0) },
    { field: 'specs', title: 'Specs', type: 'button', width: 120, label: (r) => `${r.tests.reduce((n, t) => n + Number(t.spec_count || 0), 0)} limits…`,
      help: 'Specification limits for the package\'s tests', onClick: (r) => h.current.pkSpecs(r) },
    { field: 'trash', title: '', type: 'button', width: 44, help: 'Remove this package from the quote', label: () => (ed ? '🗑' : ''), onClick: (r) => h.current.pkRemove(r) },
  ], [ed]);
  const pg = useGrid({ rows: pkRows, columns: pkCols, readOnly: !ed });

  // ---- rush terms
  const rushCols = useMemo(() => {
    const example = (r) => d.lines.find((l) => l.rush_schedule === r.schedule_name && l.final_price !== null);
    return [
      { field: 'schedule_name', title: 'Schedule', type: 'readonly', width: 140 },
      { field: 'tier_name', title: 'Tier', type: 'readonly', width: 160 },
      { field: 'rush_tat', title: 'Rush TAT', type: 'readonly', width: 120, format: (x, r) => `${x} ${r.tat_unit === 'Business Days' ? 'business' : 'calendar'} days` },
      { field: 'surcharge_value', title: 'Surcharge', type: 'readonly', width: 100, format: (x, r) => (r.surcharge_type === 'Flat' ? money(x) : x + '% of price') },
      { field: 'discount_pct', title: 'Quote discount', type: 'pct', min: 0, max: 100, width: 115 },
      { field: 'eff', title: 'Client pays', type: 'readonly', width: 150, compute: (r) => (r.surcharge_type === 'Flat' ? money(r.surcharge_value * (1 - (r.discount_pct || 0) / 100)) + ' per test'
        : (r.surcharge_value * (1 - (r.discount_pct || 0) / 100)).toFixed(1) + '% of price') },
      { field: 'ex', title: 'Example', type: 'readonly', width: 260, compute: (r) => { const l = example(r); if (!l) return '';
        const fee = r.surcharge_type === 'Flat' ? r.surcharge_value : l.final_price * r.surcharge_value / 100;
        const net = fee * (1 - (r.discount_pct || 0) / 100);
        return `${l.test_name.slice(0, 22)}: ${money(fee)} − ${money(fee - net)} = ${money(net)}`; } },
    ];
  }, [d.lines]);
  const rg = useGrid({ rows: d.rush, columns: rushCols, readOnly: !ed });
  // a reload brings new rows: the grids start again from them
  const { reset: resetL } = lg; const { reset: resetP } = pg; const { reset: resetR } = rg;
  useEffect(() => { resetL(lineRows); }, [lineRows, resetL]);
  useEffect(() => { resetP(pkRows); }, [pkRows, resetP]);
  useEffect(() => { resetR(d.rush); }, [d.rush, resetR]);

  const nLines = lg.changes.length; const nPk = pg.changes.length; const nRush = rg.changes.length;
  useUnsavedChanges(nLines + nPk + nRush > 0);
  const unsaved = () => { if (nLines || nRush) { toast('Save or discard your changes first.', 'err'); return true; } return false; };
  const have = useMemo(() => new Set(d.lines.map((l) => l.test_code)), [d.lines]);

  // one action at a time; every change reloads the page's data
  async function run(fn, msg) {
    if (busy) return;
    setBusy(true);
    try { await fn(); if (msg) toast(msg); reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  }

  async function analytes(r) { if (await dialogs.open((done) => <AnalyteDialog line={r} editable={ed} onDone={done} />)) reload(); }
  async function specs(lineId) { if (await openSpecDialog(dialogs, { quoted_line: lineId })) reload(); }
  async function removeLine(r) {
    if (!ed || !r.line_id) return;
    if (lg.changes.length > 0) { toast('Save or discard your other changes to the lines first.', 'err'); return; }
    if (!(await dialogs.confirm('Remove the test', `Remove ${r.test_code} ${r.test_name} from this quote?`, 'Remove'))) return;
    run(() => api.saveLines(vid, [{ id: r.line_id, status: 'Removed' }]), `${r.test_name} removed.`);
  }
  async function pkSpecs(r) {
    if (r.tests.length === 1) return specs(r.tests[0].line_id);
    const x = await dialogs.form({ title: 'Specifications', okText: 'Open', fields: [{ name: 'line', label: 'Test', type: 'select', blank: false, value: r.tests[0]?.line_id, options: r.tests.map((t) => ({ value: t.line_id, label: `${t.test_name} (${Number(t.spec_count) || 'no'} limits)` })) }] });
    if (x) specs(x.line);
    return null;
  }
  async function pkRemove(r) {
    if (!ed) return;
    if (!(await dialogs.confirm('Remove the package', `Remove ${r.package_code} ${r.package_name} and its ${r.tests.length} tests from this quote?`, 'Remove'))) return;
    run(() => api.removeQuotedPackage(r.id), `${r.package_name} removed.`);
  }

  function saveLines() {
    if (lg.errorCount) { toast('Fix the cells marked in red first.', 'err'); return; }
    run(() => api.saveLines(vid, lg.changes), 'Lines saved.');
  }
  function savePackages() {
    if (pg.errorCount) { toast('Fix the cells marked in red first.', 'err'); return; }
    const ids = new Set(pg.changes.map((x) => x.id));
    run(async () => { for (const r of pg.state.rows.filter((x) => ids.has(x.id))) await api.updateQuotedPackage(r.id, { package_price: r.package_price, quantity: r.quantity }); }, 'Packages saved.');
  }
  function saveRush() {
    if (rg.errorCount) { toast('Discount must be between 0 and 100%.', 'err'); return; }
    run(() => api.saveRushTerms(vid, rg.changes), 'Rush terms saved.');
  }
  function addPackage() {
    if (!pkPick) { toast('Choose a package first.', 'err'); return; }
    run(() => api.addPackage(vid, pkPick, Number(pkQty) || 1), 'Package added.').then(() => setPkPick(''));
  }

  h.current = { analytes, removeLine, specs, pkSpecs, pkRemove };

  // 0.36.0: one discount % for every line still on the quote (then check and Save lines)
  async function pctAll() {
    const x = await dialogs.form({ title: 'Discount every line', okText: 'Apply', intro: 'Sets each line\'s final price to its list price less this percentage (rounded to the cent). Nothing is saved until you click Save lines.',
      fields: [{ name: 'pct', label: 'Discount %', type: 'number', required: true }] });
    if (!x) return;
    const p = Number(x.pct);
    if (!Number.isFinite(p) || p < 0 || p > 100) { toast('Give a discount between 0 and 100 %.', 'err'); return; }
    const ci = lineCols.findIndex((c) => c.field === 'final_price');
    lg.view.forEach((ri, vr) => { const r = lg.state.rows[ri]; if (r.status !== 'Removed') lg.act.setCell(vr, ci, null, { value: round2(Number(r.list_price || 0) * (1 - p / 100)) }); });
    toast(`${p} % applied to every line: check, then Save lines.`);
  }

  // serving size, Part B (033): the per-serving calculation as a priced line on the quote
  async function servingLine() {
    const x = await dialogs.form({ title: 'Per-serving calculation', okText: 'Add to the quote',
      intro: 'Results per serving need the serving measured: the Serving weight test (units weighed and averaged) for tablets, capsules, powders; the Density test for liquids served by volume. The line is priced from the catalogue; type over the final price to discount it.',
      fields: [{ name: 'role', label: 'Measurement', type: 'select', blank: false, value: 'Serving weight', options: [{ value: 'Serving weight', label: 'Serving weight (solids)' }, { value: 'Density', label: 'Density (liquids)' }] },
        { name: 'quantity', label: 'Quantity (samples)', type: 'number', value: 1 }],
      submit: (b) => api.addServingLine(vid, b) });
    if (!x) return;
    toast(`${x.role} test added to the quote.`); reload();
  }

  // ---- lifecycle actions
  async function setStatus(status) {
    if (unsaved()) return;
    const body = { status };
    if (status === 'Quoted') {
      const def = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
      const r = await dialogs.form({ title: 'Issue quote', okText: 'Issue', intro: 'Issuing locks the prices, analytes and rush terms on this version. List prices and rush surcharges are frozen as they are now.',
        fields: [{ name: 'valid_until', label: 'Valid until', type: 'date', value: def }] });
      if (!r) return; body.valid_until = r.valid_until || null;
    } else if (status === 'Accepted') {
      const r = await dialogs.form({ title: 'Record client acceptance', okText: 'Accept quote', intro: 'Acceptance must come from an active contact of this client. Once accepted, the client can order these tests at these prices; a previously accepted version is superseded.',
        fields: [{ name: 'accepted_by_contact_id', label: 'Accepted by', type: 'select', required: true, options: d.contacts.map((c) => ({ value: c.id, label: `${c.name} (${(c.roles || []).join(', ')})` })) }] });
      if (!r) return; body.accepted_by_contact_id = r.accepted_by_contact_id;
    } else if (!(await dialogs.confirm(status, `Mark this version as ${status}?`))) return;
    run(() => api.setVersionStatus(vid, body), 'Version is now ' + status + '.');
  }
  async function send() { if (!unsaved() && await sendQuote(dialogs, toast, { ...v, id: vid }, d.contacts)) reload(); }
  const qr = { version_id: vid, client_id: v.client_id, quote_contact_id: v.quote_contact_id, sent_to_contact_id: v.sent_to_contact_id, project_code: v.project_code };
  async function decide(decision) { if (await decideQuote(dialogs, toast, qr, decision)) reload(); }
  async function details() {
    const people = await quotePeople().catch(() => []);
    const r = await dialogs.form({ title: `${v.project_code} details`, fields: [{ name: 'project_name', label: 'Reference', value: v.project_name, required: true },
      { name: 'quote_contact_id', label: 'For (contact)', type: 'select', value: v.quote_contact_id || '', options: d.contacts.map((c) => ({ value: c.id, label: c.name })) },
      { name: 'owner_id', label: 'Prepared by', type: 'select', blank: false, value: v.owner_id, options: people.map((p) => ({ value: p.id, label: p.full_name })), help: 'Hand the quote to another sales person: it moves to their "My open quotes".' }],
    submit: (b) => updateQuote(v.project_id, b) });
    if (r) { toast('Saved.'); reload(); }
  }
  function newVersion() { run(async () => { const r = await api.newProjectVersion(v.project_id); window.location.hash = '#/quote/' + r.id; }); }

  // ---- header
  const today = new Date().toISOString().slice(0, 10);
  const sendable = ['Draft', 'Submitted for Quote', 'Quoted'].includes(v.status) && !(v.status === 'Quoted' && v.valid_until && v.valid_until < today);
  const B = (label, onClick, primary) => <button key={label} type="button" className={`btn${primary ? ' primary' : ''}`} onClick={onClick} disabled={busy}>{label}</button>;
  const acts = [];
  if (sendable) acts.push(B(v.sent_at ? 'Send again…' : 'Send to client…', send, !(v.status === 'Quoted' && v.sent_at)));
  if (isQuote && v.status === 'Quoted') acts.push(B('Accept…', () => decide('Accepted'), true), B('Reject…', () => decide('Rejected')));
  if (isQuote && v.status === 'Draft') acts.push(B('Issue without sending', () => setStatus('Quoted')));
  else if (v.status === 'Draft') acts.push(B('Submit for quote', () => setStatus('Submitted for Quote')), B('Issue quote', () => setStatus('Quoted'), true));
  if (v.status === 'Submitted for Quote') acts.push(B('Issue quote', () => setStatus('Quoted'), true), B('Reject', () => setStatus('Rejected')));
  if (v.status === 'Quoted' && !isQuote) acts.push(B('Record client acceptance', () => setStatus('Accepted'), true), B('Client rejected', () => setStatus('Rejected')));
  if (v.status === 'Quoted') acts.push(B('Expire', () => setStatus('Expired')));
  if (['Accepted', 'Superseded', 'Rejected', 'Expired'].includes(v.status)) acts.push(B('Start new version (re-quote)', newVersion, true));
  const pdfHref = api.quotePdfUrl(vid, ['Draft', 'Submitted for Quote'].includes(v.status) || !v.sent_at);
  const sp = (x) => [x, ' '];

  // ---- totals (as typed, before saving)
  const act = lg.state.rows.filter((r) => r.status !== 'Removed');
  const pks = pg.state.rows;
  const listV = act.reduce((s, r) => s + r.list_price * (r.quantity || 0), 0) + pks.reduce((s, r) => s + Number(r.list_price || 0) * (r.quantity || 0), 0);
  const fin = act.reduce((s, r) => s + (r.final_price || 0) * (r.quantity || 0), 0) + pks.reduce((s, r) => s + Number(r.package_price || 0) * (r.quantity || 0), 0);

  const contactName = (d.contacts.find((c) => c.id === v.quote_contact_id) || {}).name || '—';
  const pkOptions = pk.options.filter((o) => !pk.rows.some((r) => r.package_id === o.id))
    .map((o) => ({ value: o.errors ? '' : o.id, label: `${o.package_code} ${o.package_name} · ${money(o.package_price)}${o.errors ? ' (has problems to fix in the catalogue)' : ''}` }));
  // shortcut: SmartSelect has no disabled options, so a package with problems is listed with an empty value (cannot be added); a disabled option when the kit has one

  return <>
    <PageHeader title={isQuote ? `Quote ${v.project_code} · v${v.version_no}` : `${v.project_name} · v${v.version_no}`}
      audit={{ kind: isQuote ? 'quote' : 'version', id: isQuote ? v.project_id : vid }}
      subtitle={<>{isQuote ? `${v.project_name} · ` : <><a href={`#/projects/${v.project_id}`}>{v.project_code}</a> · </>}<a href={`#/clients/${v.client_id}`}>{v.client_name}</a>{' '}
        <Badge status={v.status} /> {lpa && <Badge status="List price acceptance" />} {v.account_status !== 'Active' && <Badge status={'Client ' + v.account_status} />}
        {v.latest_version_no > v.version_no && <> <Badge status="Newer version exists" /></>}</>}
      actions={<>
        {isQuote ? <><a className="btn ghost" href="#/quotes">All quotes</a> <button type="button" className="btn ghost" onClick={details}>Details…</button></> : <a className="btn ghost" href={`#/projects/${v.project_id}`}>All versions</a>}
        {' '}<a className="btn ghost" target="_blank" rel="noopener" href={pdfHref}>Quotation PDF</a> <a className="btn ghost" href={`#/print/${vid}`}>Print</a> {acts.flatMap(sp)}
      </>} />
    <div className="card meta3">
      {isQuote && <><div><span>For</span><b>{contactName}</b></div><div><span>Prepared by</span><b>{v.owner_name || '—'}</b></div></>}
      <div><span>Quoting lab</span><b title="The lab this quote was made in: its own tests are in-house, other labs' tests are subcontracted">{v.quote_site_code || 'Not recorded (made before 0.16.1)'}</b></div>
      <div><span>Valid until</span><b>{v.valid_until || 'Set when issued'}</b></div>
      <div><span>Quoted</span><b>{v.quoted_at ? new Date(v.quoted_at).toLocaleDateString() + (v.quoted_by_name ? ' by ' + v.quoted_by_name : '') : '—'}</b></div>
      <div><span>{v.status === 'Rejected' ? 'Rejected' : 'Accepted by'}</span><b>{v.status === 'Rejected' ? (v.rejected_reason || 'No reason given') + (v.decided_via === 'Client link' ? ' (online)' : '')
        : (v.accepted_by || '—') + (v.decided_via === 'Client link' && v.status === 'Accepted' ? ' (online)' : '')}</b></div>
    </div>
    {v.sent_at && <div className="qsent">Sent {new Date(v.sent_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} to <b>{v.sent_to_name || ''}</b> &lt;{v.sent_to_email || ''}&gt;. The client accepts or declines through the link in the email
      {v.client_token ? <>; you can also paste it in a chat or email yourself:<input readOnly value={`${window.location.origin}/quote-response.html?t=${v.client_token}`} onFocus={(e) => e.target.select()} /></> : '.'}</div>}
    {!ed && <div className="notice">This version is {v.status} and locked. {v.status === 'Accepted' ? 'Orders use these terms.' : ''} To change prices or tests, start a new version.</div>}

    <Section title="Tests on this quote"
      help={lpa ? 'List price acceptance: final price always equals list price.' : 'List price comes from the catalogue and cannot be typed over. Type the final price per sample, or the discount % (the final price follows); paste and fill down work in both. For analyte-priced tests, click the analyte button to remove analytes: the list price recalculates and the discount % is kept.'}
      actions={ed && !lpa && <button type="button" className="btn" onClick={pctAll}>Apply a discount % to every line…</button>}>
      <SaveBar n={nLines} what="line" onUndo={() => lg.reset(lineRows)} onSave={saveLines} saveText="Save lines" busy={busy} />
      <DataGrid grid={lg} rowClass={(r) => (r.status === 'Removed' ? 'mutedrow' : '')} />
    </Section>

    {showPk && <Section title="Packages on this quote" help="A package is several tests at one price per sample, taken from the Test catalogue. Type over the package price to negotiate it; each test's share follows. On the order, cancelling one of its tests takes off only that test's share.">
      <SaveBar n={nPk} what="package" onUndo={() => pg.reset(pkRows)} onSave={savePackages} saveText="Save packages" busy={busy} />
      <DataGrid grid={pg} emptyText="No packages on this quote." />
      {ed && pk.allowed && <div className="pkadd">
        <SmartSelect className="pkpick" value={pkPick} options={[{ value: '', label: 'Add a package…' }, ...pkOptions]} onChange={setPkPick} />
        <input type="number" min="1" value={pkQty} style={{ width: 70 }} title="Samples" onChange={(e) => setPkQty(e.target.value)} />
        <button type="button" className="btn" onClick={addPackage} disabled={busy}>+ Add package</button>
      </div>}
    </Section>}

    <div className="card"><div className="totals">
      <span>List value <b>{money(listV)}</b></span><span>Discount <b>{money(listV - fin)}</b> ({listV ? ((listV - fin) / listV * 100).toFixed(2) : '0.00'}%)</span><span className="big">Quote total <b>{money(fin)}</b></span>
    </div></div>
    <QuoteChargesCard versionId={vid} />{/* 0.36.0: kits, shipping, fees, discounts at this client's price */}

    {ed && <Section title="Add tests" help="Switch between labs to quote tests from any of them on the same quote; each line shows the lab that does the work."
      actions={<button type="button" className="btn" title="Adds the lab's Serving weight or Density test at its catalogue price, so the client sees what results per serving cost" onClick={servingLine}>+ Per-serving calculation…</button>}>
      <TestPicker versionId={vid} have={have} onAdded={reload} prefill={isQuote && !lpa} />
    </Section>}

    <Section title="Rush terms on this quote" help="Surcharges are copied from each rush schedule. Set a discount per tier: e.g. keep Same Day at full price, make a 5 Day rush free (100%). Example amounts use the first test on this quote with that schedule.">
      <div className={`savebar${nRush ? ' show' : ''}`}><span className="pending">{plural(nRush, 'tier')} changed</span><button type="button" className="btn primary" onClick={saveRush} disabled={busy}>Save rush terms</button></div>
      <DataGrid grid={rg} emptyText="No rush schedules on the tests in this quote." />
    </Section>
  </>;
}

function SaveBar({ n, what, onUndo, onSave, saveText, busy }) {
  return (
    <div className={`savebar${n ? ' show' : ''}`}>
      <span className="pending">{plural(n, what)} changed (not saved)</span>
      <button type="button" className="btn ghost" onClick={onUndo} disabled={busy}>Discard</button>
      <button type="button" className="btn primary" onClick={onSave} disabled={busy}>{saveText}</button>
    </div>
  );
}
