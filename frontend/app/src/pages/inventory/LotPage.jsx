// One lot (as in Alex's mock-up): status cards, identity and quantities, analytes, warning rules, components, Supplier
// COAs, QA testing, stock movements, and every action on it (each signed, except routine usage).
import { useMemo, useState } from 'react';
import { coaFileUrl, getLot, inventoryMe, inventoryMeta, inventorySites, lotAction, recordMovements } from '../../api/inventory.js';
import Badge from '../../components/Badge.jsx';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import { usePrintLabels } from '../../components/labels/usePrintLabels.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { LotLogbookCard } from '../logbooks/LogbookCards.jsx';
import { useSession } from '../../session/SessionProvider.jsx';
import { coaReviewDialog, coaUploadDialog, qualifyDialog, receiveDialog, reorderDialog, signed, usageDialog } from './dialogs.jsx';
import { d8, dt, Failed, fmtN, isMixture, Kv, Loading, LocLink, qty, ReadGrid } from './shared.jsx';

const lotHref = (id) => '#/inventory/lots/' + id;
const StatCard = ({ label, text, cls }) => <div className={`statcard ${cls || ''}`}><span>{label}</span><b>{text}</b></div>;
const ruleCls = (r) => (!r ? '' : r.result === 'Alert' ? 'alert' : r.result === 'Deficient' ? 'deficient' : r.result === 'Conforms' ? 'conforms' : '');
const SampleLink = ({ l }) => (l.sample_id ? <a href={'#/samples/' + l.sample_id}>{l.lot_code}</a> : l.lot_code);

const MOVEMENT_COLS = (unit, site) => [
  { field: 'txn_at', title: 'When', type: 'readonly', width: 140, format: dt },
  { field: 'txn_type', title: 'Movement', type: 'readonly', width: 100 },
  { field: 'quantity_change', title: 'Quantity', type: 'readonly', width: 90, align: 'right', format: (v) => (v > 0 ? '+' : '') + qty(v) },
  { field: 'running_total', title: 'On hand after', type: 'readonly', width: 100, align: 'right', format: (v) => qty(v, unit) },
  { field: 'reference', title: 'Reference', type: 'readonly', width: 230 },
  { field: 'related_code', title: 'Related lot', type: 'link', width: 110, href: (r) => (r.related_id ? lotHref(r.related_id) : null), format: (v, r) => (v ? `${v}${r.related_site && r.related_site !== site ? ' (' + r.related_site + ')' : ''}` : '') },
  { field: 'reason', title: 'Reason', type: 'readonly', width: 160 }, { field: 'by_name', title: 'By', type: 'readonly', width: 130 }];
const QUAL_COLS = [
  { field: 'qualification_code', title: 'QA testing', type: 'readonly', width: 110, format: (v, r) => v + (r.retest_of_id ? ' (retest)' : '') },
  { field: 'use_test_name', title: 'Released for', type: 'readonly', width: 240 },
  { field: 'qualification_test_name', title: 'QA test', type: 'readonly', width: 230 },
  { field: 'status', title: 'Status', type: 'readonly', width: 90, cellClass: (r) => (r.status === 'Failed' ? 'cbad' : r.status === 'Testing' ? 'cwarn' : '') },
  { field: 'batch_code', title: 'Batch', type: 'link', width: 105, href: (r) => (r.batch_id ? '#/testing/batches/' + r.batch_id : null) },
  { field: 'decision_note', title: 'Decision', type: 'readonly', width: 330, format: (v, r) => (v ? `${v}${r.decided_by_name ? ' (' + r.decided_by_name + ', ' + dt(r.decided_at) + ')' : ''}` : 'Waiting for the test and QA\'s review') }];
const COMPONENT_COLS = [
  { field: 'lot_code', title: 'Lot', type: 'link', width: 100, href: (r) => lotHref(r.component_lot_id) },
  { field: 'material', title: 'Name', type: 'readonly', width: 230 }, { field: 'chemical_types_text', title: 'Type', type: 'readonly', width: 160 },
  { field: 'quantity_used', title: 'Amount used', type: 'readonly', width: 170, format: (v, r) => (r.entered_unit && r.entered_unit !== r.unit ? `${qty(r.entered_quantity, r.entered_unit)} (= ${qty(v, r.unit)})` : qty(v, r.unit)) },
  { field: 'manufacturer_lot', title: 'Lot #', type: 'readonly', width: 110 }, { field: 'expiration_date', title: 'Expires', type: 'readonly', width: 100, format: d8 }];

function QaBox({ l, d }) {
  const s = l.qa_status;
  return (
    <div className={`mqbox ${/^Released/.test(s) ? 'ok' : /^Rejected/.test(s) ? 'bad' : ''}`}><b>QA testing: {s}.</b>{' '}
      {s === 'Awaiting QA testing' ? <>{l.qa_default ? 'Your lab tests this type of item before use.' : 'This lot was marked for QA testing when it was received.'} It cannot be used until it passes. Use <b>Send for QA testing</b> to choose the QA test and what it is released for (every use, or a named test); a test sample with this lot's ID goes to the backlog.</>
        : s === 'In QA testing' ? <>Its test sample <SampleLink l={l} /> is being tested. The lot cannot be used until QA approves the result.</>
          : s === 'Released for every use' ? 'Released for every use by the QA testing below.'
            : s === 'Released for named tests' ? 'Released for the tests below only: the bench refuses it for any other test, and it cannot go into a mixture.'
              : s === 'Rejected, retest under way' ? <>Rejected; its retest is being tested (sample <SampleLink l={l} />). It stays blocked for every use until the retest passes.</>
                : <>Rejected: blocked for every use. QA can send it for a <b>Retest</b>, or <b>Dispose</b> of it (or return it to the supplier, noting that as the reason).</>}
      {d.qualifications.length > 0 && <div style={{ marginTop: 8 }}><ReadGrid rows={d.qualifications} columns={QUAL_COLS} /></div>}
    </div>
  );
}

export default function LotPage({ params: [id] }) {
  const { site } = useSession();
  const dialogs = useDialogs();
  const toast = useToast();
  const printLabels = usePrintLabels();
  const { data, error, reload } = useApi((o) => Promise.all([inventoryMeta(), getLot(id, { fresh: true, ...o }), inventoryMe()]), [id]);
  const [busy, setBusy] = useState(false);
  const ui = { dialogs, toast, siteId: site?.id };
  const [M, d, who] = data || [];
  const l = d?.lot;
  const mixture = l ? isMixture(l) : false;

  const analyteCols = useMemo(() => [
    { field: 'analyte_name', title: 'Analyte', type: 'link', width: 150, href: (r) => '#/analytes?find=' + encodeURIComponent(r.analyte_code) },
    { field: 'analyte_cas', title: 'CAS', type: 'readonly', width: 95 },
    { field: 'concentration', title: mixture ? 'Prepared concentration' : 'Concentration', type: 'readonly', width: 150, format: (v, r) => (v === null || v === undefined ? (mixture ? 'Not calculated' : '') : `${fmtN(v)} ${r.concentration_unit || ''}`) },
    { field: 'target_concentration', title: 'Target', type: 'readonly', width: 140, format: (v, r) => (v === null || v === undefined ? '' : `${fmtN(v)} ${r.concentration_unit} ± ${fmtN(r.tolerance_pct || 0)}%`) },
    { field: 'conformance', title: 'Result', type: 'readonly', width: 100, cellClass: (r) => (r.conformance === 'Alert' ? 'cwarn' : '') },
    { field: 'calc_note', title: 'How', type: 'readonly', width: 420 }], [mixture]);
  const usedInCols = useMemo(() => [
    { field: 'lot_code', title: 'Mixture', type: 'link', width: 100, href: (r) => lotHref(r.id) },
    { field: 'material', title: 'Name', type: 'readonly', width: 300 }, { field: 'quantity_used', title: 'Used', type: 'readonly', width: 90, format: (v) => qty(v, l?.unit) },
    { field: 'expiration_date', title: 'Expires', type: 'readonly', width: 100, format: d8 }, { field: 'status', title: 'Status', type: 'readonly', width: 90 }], [l?.unit]);
  const movementCols = useMemo(() => MOVEMENT_COLS(l?.unit, l?.site_code), [l?.unit, l?.site_code]);
  const coaCols = useMemo(() => [
    { field: 'file_name', title: 'Document', type: 'link', width: 200, href: () => '#', onClick: (r) => window.open(coaFileUrl(r.id, site?.id), '_blank') },
    { field: 'extraction_method', title: 'How values were read', type: 'readonly', width: 190 },
    { field: 'values_confirmed', title: 'Values confirmed', type: 'readonly', width: 260, format: (v) => (v ? Object.entries(v).map(([k, x]) => `${k.replace(/_/g, ' ')}: ${x}`).join('; ') : 'Not confirmed yet') },
    { field: 'confirmed_by_name', title: 'Confirmed by', type: 'readonly', width: 140, format: (v, r) => (v ? `${v} ${dt(r.confirmed_at)}` : '') },
    { field: 'uploaded_by', title: 'Uploaded', type: 'readonly', width: 150, format: (v, r) => `${v} ${dt(r.created_at)}` },
    { field: 'sha256', title: 'SHA-256', type: 'readonly', width: 120, format: (v) => (v ? v.slice(0, 12) + '…' : '') },
    { field: 'review', title: '', type: 'button', width: 90, label: (r) => (r.values_confirmed ? 'View' : 'Review'),
      onClick: (r) => coaReviewDialog({ dialogs, toast, siteId: site?.id }, r, l).then((ok) => { if (ok) reload(); }) }], [dialogs, toast, site, l, reload]);

  if (error && !data) return <Failed error={error} />;
  if (!data) return <Loading />;

  const isClosed = ['Disposed', 'Cancelled'].includes(l.status);
  const received = l.receipt_status === 'Received';
  const qRule = d.rules.find((r) => r.detail.startsWith('Quantity on hand'));
  const eRule = d.rules.find((r) => r.detail.startsWith('Expiration'));
  const days = l.days_to_expiry;
  const expText = !l.expiration_date ? 'No expiry date' : days < 0 ? `${eRule?.result || 'Deficient'}: expired ${-days} day${days === -1 ? '' : 's'} ago` : `${eRule?.result || 'Conforms'}: ${days} day${days === 1 ? '' : 's'} left`;
  const pct = l.pct_remaining;
  const qtyText = !received ? 'Not received yet' : `${qRule?.result || 'Conforms'}: ${pct === null || pct === undefined ? qty(l.on_hand, l.unit) : fmtN(pct) + '% remaining'}`;
  // Analyte-eligible (vault: Inventory Lot): a Reference Standard or Microbiological Strain that names its analyte
  const eligible = (l.chemical_types || []).some((t) => ['Reference Standard', 'Microbiological Strain'].includes(t)) && Number(l.analyte_count) > 0;
  const name = `${l.lot_code} ${l.material}`;
  const send = (action, body) => (reason, signature) => lotAction(id, action, { ...body, reason: reason || body.reason, signature });

  async function act(key) {
    if (busy) return;
    setBusy(true);
    try {
      let done = null;
      if (key === 'approve') done = await signed(dialogs, { what: `Approve purchase request ${name}`, meaning: 'Approved by', needReason: false }, send('purchase-status', { receipt_status: 'Approved' }));
      if (key === 'ordered') done = await signed(dialogs, { what: `Mark ${name} as ordered`, meaning: 'Ordered by', needReason: false }, send('purchase-status', { receipt_status: 'Ordered' }));
      if (key === 'receive') done = await receiveDialog(ui, l);
      if (key === 'use') { await usageDialog(ui, [l]); done = true; }
      if (key === 'adjust') {
        const v = await dialogs.form({ title: `Adjust stock: ${l.lot_code}`, okText: 'Next: sign', intro: `On hand now: ${qty(l.on_hand, l.unit)}. Enter the change (negative to reduce), for example after a stock count.`,
          fields: [{ name: 'quantity', label: `Change (${l.unit})`, type: 'number', required: true }] });
        if (!v) return;
        done = await signed(dialogs, { what: `Stock adjustment ${name}: ${Number(v.quantity) > 0 ? '+' : ''}${v.quantity} ${l.unit || ''}`, meaning: 'Adjusted by' },
          (reason, signature) => recordMovements({ rows: [{ lot_id: id, txn_type: 'Adjustment', quantity: Number(v.quantity) }], reason, signature }));
      }
      if (key === 'coa') {
        const r = await coaUploadDialog(ui, l, M.ai); if (!r) return;
        reload();
        const fresh = await getLot(id, { fresh: true }); const c = fresh.coas.find((x) => x.id === r.id);
        if (c && await coaReviewDialog(ui, c, fresh.lot)) reload();
        return;
      }
      if (key === 'reorder') { if (!await reorderDialog(ui, l)) reload(); return; }
      if (key === 'labels') { await printLabels('lot', [id]); return; }
      if (key === 'qualify') { if (await qualifyDialog(ui, { ...l })) reload(); return; }
      if (key === 'waiveqa') done = await signed(dialogs, { what: `Waive QA testing of ${name}: it can be used without being tested`, meaning: 'Approved by' }, send('waive-qa', {}));
      if (key === 'transfer') {
        const sites = (await inventorySites()).filter((s) => s.id !== l.site_id);
        const v = await dialogs.form({ title: `Transfer ${l.lot_code} to another lab`, okText: 'Next: sign',
          intro: `The quantity leaves ${l.site_code} now. The receiving lab gets a new lot (same item, manufacturer lot, expiry, analytes and Supplier COA) marked In Transit, and receives it like any new lot.`,
          fields: [{ name: 'to_site_id', label: 'To lab', type: 'select', options: sites.map((s) => ({ value: s.id, label: `${s.site_code} ${s.site_name}` })), required: true },
            { name: 'quantity', label: `Quantity (${l.unit})`, type: 'number', required: true }, { name: 'notes', label: 'Notes' }] });
        if (!v) return;
        const to = sites.find((s) => s.id === v.to_site_id);
        done = await signed(dialogs, { what: `Transfer ${v.quantity} ${l.unit || ''} of ${name} to ${to ? to.site_code : 'another lab'}`, meaning: 'Transferred by', needReason: false },
          send('transfer', { ...v, quantity: Number(v.quantity) }));
        if (done) toast('Transferred. The receiving lab will see it In Transit.');
      }
      if (key === 'cancel') done = await signed(dialogs, { what: `Cancel purchase request ${name}`, meaning: 'Cancelled by' }, send('cancel', {}));
      if (key === 'dispose') done = await signed(dialogs, { what: `Dispose of ${name} (${qty(l.on_hand, l.unit)} will be written off)${l.waste ? ` as ${l.waste.waste_name}${l.waste.waste_stream ? ' (' + l.waste.waste_stream + ')' : ''}` : ''}`, meaning: 'Disposed by' }, send('dispose', {}));
      if (!done) return;
      const said = { approve: 'Request approved and signed.', ordered: 'Marked as ordered and signed.', adjust: 'Adjustment recorded and signed.', cancel: 'Request cancelled and signed.', dispose: 'Lot disposed and signed.' }[key];
      if (said) toast(said);
      reload();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  }
  const Btn = ({ k, label, show, primary }) => (show ? <button type="button" className={`btn${primary ? ' primary' : ''}`} disabled={busy} onClick={() => act(k)}>{label}</button> : null);

  return <>
    <div className="eyebrow">{l.lot_code} · {l.site_code}</div>
    <PageHeader title={l.material} audit={{ kind: 'lot', id }}
      subtitle={<><span className="chips2">{(l.chemical_types || []).map((t) => <span key={t} className="badge w-info">{t}</span>)}{eligible && <span className="badge w-ok">Analyte-eligible</span>}</span>{' '}<Badge status={received ? l.status : l.receipt_status} /></>}
      actions={<>
        <a className="btn ghost" href="#/inventory">All items</a> <a className="btn" href={`#/inventory/new?from=${l.id}`}>Duplicate</a>{' '}
        <button type="button" className="btn" disabled={busy || mixture || l.status === 'Cancelled'} title={mixture || l.status === 'Cancelled' ? 'A mixture is prepared, not ordered' : undefined} onClick={() => act('reorder')}>Reorder</button>{' '}
        <a className="btn primary" href={`#/inventory/lots/${l.id}/edit`}>Edit</a>
      </>} />
    <div className="actbar">
      <Btn k="approve" label="Approve request" show={l.receipt_status === 'Requested' && !isClosed && who.can_approve} primary />
      <Btn k="ordered" label="Mark as ordered" show={l.receipt_status === 'Approved' && !isClosed && who.can_order} primary />
      <Btn k="receive" label="Receive" show={['Ordered', 'In Transit'].includes(l.receipt_status) && !isClosed} primary />
      <Btn k="use" label="Record usage" show={l.use_eligible} />
      <Btn k="adjust" label="Adjust stock" show={received && !isClosed} />
      <Btn k="coa" label="Upload Supplier COA" show={!isClosed && !mixture} />
      <Btn k="transfer" label="Transfer to another lab" show={received && !isClosed} />
      <Btn k="cancel" label="Cancel request" show={!received && !isClosed} />
      <Btn k="dispose" label="Dispose" show={received && !isClosed} />
      <Btn k="qualify" label={/^Rejected$/.test(l.qa_status || '') ? 'Retest…' : 'Send for QA testing…'} show={received && !isClosed && who.can_qualify && !/In QA testing|retest under way/.test(l.qa_status || '')} primary={['Awaiting QA testing', 'Rejected'].includes(l.qa_status)} />
      <Btn k="waiveqa" label="Waive QA testing…" show={l.qa_status === 'Awaiting QA testing' && !d.qualifications.length && !isClosed && who.can_qa_configure} />
      <Btn k="labels" label="Print label" show={received && !isClosed} />
    </div>
    {l.qa_required && <QaBox l={l} d={d} />}
    {l.receipt_status === 'Requested' && !who.can_approve && <div className="notice">Waiting for a Lab Supervisor to approve this request.</div>}
    {d.purchase && <div className="notice">Purchase request <a href={'#/purchasing/requests/' + d.purchase.id}>{d.purchase.line_code}</a>: {d.purchase.status}{d.purchase.po_code ? ` on ${d.purchase.po_code}${d.purchase.external_po_number ? ' (PO ' + d.purchase.external_po_number + ')' : ''}` : ''}. Approval, ordering and receiving are also done in Purchasing.</div>}
    {l.not_usable_because && !isClosed && <div className="notice">Not usable: {l.not_usable_because}.</div>}
    <div className="statcards">
      <StatCard label="Purchase status" text={mixture ? 'N/A: in-house' : l.receipt_status + (l.approved_by_name ? ` (approved by ${l.approved_by_name})` : '')} />
      <StatCard label="Expiration" text={expText} cls={ruleCls(eRule)} />
      <StatCard label="Quantity on hand" text={qtyText} cls={received ? ruleCls(qRule) : ''} />
    </div>
    <div className="cols">
      <div className="card"><h2>Identity</h2><Kv pairs={[
        ['Analytes', d.analytes.length ? d.analytes.map((a, i) => <span key={a.analyte_id || i}>{i > 0 && ', '}<a href={'#/analytes?find=' + encodeURIComponent(a.analyte_code)}>{a.analyte_name}</a>{a.analyte_cas ? ` (CAS ${a.analyte_cas})` : ''}</span>) : ''],
        ['CAS', l.cas_display],
        [mixture ? 'Resource ID' : 'Lot #', mixture ? `${l.lot_code} (system-generated)` : l.manufacturer_lot],
        mixture ? ['Prepared by', l.created_by_name] : ['Vendor', l.supplier_name],
        mixture ? null : ['Manufacturer', l.manufacturer_name], mixture ? null : ['Catalog #', l.catalog_number],
        ['Department', l.department_name || ''],
        ['Waste', l.waste ? <>{l.waste.waste_name}{l.waste.needs_review && <> <span className="bad">to classify from the SDS</span></>}</> : <span className="bad">none</span>],
        mixture ? null : ['Web link', l.item_url ? <a href={l.item_url} target="_blank" rel="noopener noreferrer">{l.item_url.replace(/^https?:\/\//, '').slice(0, 60)}</a> : ''],
        ['Solid or liquid', l.physical_form],
        ['Storage location', l.storage_location_id ? <LocLink id={l.storage_location_id} code={l.location_code} path={l.location_path} /> : ''], ['Storage condition', l.storage_condition],
        ['Came from', l.transferred_from_code ? <a href={lotHref(l.transferred_from_lot_id)}>{`${l.transferred_from_code} (${l.transferred_from_site})`}</a> : (l.reorder_of_code ? <>Reorder of <a href={lotHref(l.reorder_of_lot_id)}>{l.reorder_of_code}</a></> : '')],
      ]} /></div>
      <div className="card"><h2>Quantitative</h2><Kv pairs={[
        ['Concentration', l.conc_display], ['Purity / potency', l.purity_pct === null ? '' : fmtN(l.purity_pct) + '%'],
        [mixture ? 'Prepared quantity' : 'Received quantity', received ? qty(l.quantity_received, l.unit) : `${qty(l.requested_quantity, l.unit)} requested`],
        ['Quantity on hand', <><b>{qty(l.on_hand, l.unit)}</b>{l.negative_stock && <> <span className="bad">negative: reconcile with a stock count</span></>}</>],
        [mixture ? 'Date made' : 'Received date', d8(l.received_date)], ['Expiration date', <>{d8(l.expiration_date)}{mixture && l.expiration_date && <> <span className="help">(not after the earliest component)</span></>}</>],
        ['Retest date', d8(l.retest_date)], ['Opened date', d8(l.opened_date)], ['Notes', l.notes],
      ]} /></div>
      {l.waste && <div className="card" id="wastecard"><h2>Waste and disposal</h2><Kv pairs={[
        ['Classification', <>{l.waste.waste_code} {l.waste.waste_name}{l.waste.needs_review && <> <span className="bad">to classify: read the SDS, then choose its classification (Edit)</span></>}</>],
        ['Hazard classes', String(l.waste.hazard_classes || '').replace(/[{}"]/g, '').replace(/,/g, ', ')], ['EPA waste codes', l.waste.epa_codes],
        ['Waste stream', l.waste.waste_stream], ['Container', l.waste.container], ['How to dispose of it', l.waste.disposal_instructions], ['Keep away from', l.waste.segregation],
      ]} /></div>}
    </div>
    {d.analytes.length > 0 && <Section title={mixture ? 'Calculated concentration' : 'Analytes'} help={mixture ? 'Calculated from the component lots when the mixture was prepared, using the Units and Unit conversions tables.' : ''}>
      <ReadGrid rows={d.analytes} columns={analyteCols} keyField="analyte_id" /></Section>}
    <Section title="Threshold rules applied"><div className="rulelist">{d.rules.length
      ? d.rules.map((r, i) => <div key={i} className="rule"><span><b>{r.rule_name}</b><br /><span className="help">{r.detail}</span></span><span className={'res-' + r.result}>{r.result}</span></div>)
      : <p className="help">No warning rules apply.</p>}</div></Section>
    {mixture && <Section title="Component lots" help="The lots this mixture was prepared from. Each was drawn from stock when the mixture was made."><ReadGrid rows={d.components} columns={COMPONENT_COLS} emptyText="No components recorded." /></Section>}
    {d.usedIn.length > 0 && <Section title="Used to prepare"><ReadGrid rows={d.usedIn} columns={usedInCols} /></Section>}
    {d.related.length > 0 && <Section title="Linked lots">{d.related.map((x) => <div key={x.id}>{x.relation} <a href={lotHref(x.id)}>{`${x.lot_code} (${x.site_code})`}</a> <Badge status={x.receipt_status === 'Received' ? x.status : x.receipt_status} /></div>)}</Section>}
    {!mixture && <Section title="Supplier COA" help="The uploaded document is kept exactly as uploaded, with its SHA-256 fingerprint. Values read from it (by a person, or proposed by AI) are only saved to the lot when a person confirms them.">
      <ReadGrid rows={d.coas} columns={coaCols} emptyText="No Supplier COA uploaded yet." /></Section>}
    <LotLogbookCard lotId={l.id} />
    <Section title="Stock movements" help="Append-only. Corrections are recorded as Adjustments with a reason."><ReadGrid rows={d.movements} columns={movementCols} emptyText="No stock movements yet." /></Section>
    <div className="lotfoot">{mixture ? 'Prepared' : 'Received'} {d8(l.received_date) || '—'}{mixture ? ' by ' + (l.created_by_name || '') : ''} · Last modified {dt(l.modified_at)} by {l.modified_by_name || ''} · Audit trail: the clock icon next to the name</div>
  </>;
}
