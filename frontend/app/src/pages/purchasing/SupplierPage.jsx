// One vendor (V-1): this lab's and the corporate approval history, documents, proposals for corporate approval and the
// lab's requests. Approve vendor…, Attach document…, Propose for corporate approval…, and Corporate QA's decision.
import { useMemo } from 'react';
import { addQualification, attachDocuments, decidePromotion, documentUrl, getSupplier, proposePromotion, purchasingMe,
  withdrawDocument, withdrawPromotion, withdrawQualification } from '../../api/purchasing.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { DocRows, docsToBody, ScopeBoxes } from './dialogs.jsx';
import { d8, decisionText, dt, expCls, Failed, Kv, levelText, lineColsWithout, Loading, mutedInactive, signed, supCls, today } from './shared.jsx';
import { Button, Card } from 'react-bootstrap';

const LINES = lineColsWithout('supplier_name');
const PROMO_COLS = [
  { field: 'promotion_code', title: 'Proposal', type: 'readonly', width: 90 }, { field: 'status', title: 'Status', type: 'readonly', width: 95, cellClass: (r) => (r.status === 'Approved' ? 'cok' : r.status === 'Rejected' ? 'cbad' : r.status === 'Proposed' ? 'cwarn' : '') },
  { field: 'site_code', title: 'From', type: 'readonly', width: 60 }, { field: 'from_code', title: 'Lab approval', type: 'readonly', width: 95 },
  { field: 'scope_text', title: 'For', type: 'readonly', width: 220 }, { field: 'proposed_by_name', title: 'Proposed by', type: 'readonly', width: 140 },
  { field: 'decided_by_name', title: 'Decided by', type: 'readonly', width: 140 }, { field: 'decision_note', title: 'Decision', type: 'readonly', width: 240 },
  { field: 'corporate_code', title: 'Corporate record', type: 'readonly', width: 115 }];
const classLabel = (c) => `${c.class_name} (re-approve every ${c.requal_months} months)${c.site_id ? ': this lab only' : ''}`;

export default function SupplierPage({ params }) {
  const id = params[0];
  const { site } = useSession();
  const dialogs = useDialogs();
  const toast = useToast();
  const { data, error, reload } = useApi(() => Promise.all([getSupplier(id), purchasingMe()]), [id]);
  const d = data?.[0]; const me = data?.[1] || {};
  const canLab = !!me.can_qualify; const canCorp = !!me.can_qualify_corporate;

  // the grids' columns depend on the record (withdraw buttons, the record a document belongs to)
  const cols = useMemo(() => {
    if (!d) return null;
    const mayEdit = (q) => (q.site_id ? canLab : canCorp);
    const docEditable = (dd) => (dd.qualification_id ? mayEdit(d.qualifications.find((x) => x.id === dd.qualification_id) || { site_id: true }) : canLab);
    const recCode = (dd) => (dd.qualification_id ? (d.qualifications.find((q) => q.id === dd.qualification_id) || {}).qualification_code : (d.promotions.find((p) => p.id === dd.promotion_id) || {}).promotion_code) || '';
    const quals = [
      { field: 'qualification_code', title: 'Record', type: 'readonly', width: 85 }, { field: 'approval_status', title: 'Decision', type: 'readonly', width: 110, cellClass: (r) => supCls(r.approval_status) },
      { field: 'site_code', title: 'For', type: 'readonly', width: 95, format: (v) => v || 'Corporate' }, { field: 'scope_text', title: 'Approved for', type: 'readonly', width: 220 },
      { field: 'class_name', title: 'Risk class', type: 'readonly', width: 90 },
      { field: 'approval_date', title: 'Date', type: 'readonly', width: 95, format: d8 }, { field: 'expiration_date', title: 'Until', type: 'readonly', width: 95, format: d8 },
      { field: 'accreditations', title: 'Accreditations', type: 'readonly', width: 140 }, { field: 'justification', title: 'Justification', type: 'readonly', width: 230, format: (v, r) => (r.is_legacy ? 'Legacy (go-live): ' : '') + (v || '') },
      { field: 'signed_by', title: 'Signed', type: 'readonly', width: 170, format: (v, r) => (v ? `${v} (${r.signature_meaning})` : r.is_legacy ? 'Migration' : '') },
      { field: 'status', title: 'Record', type: 'readonly', width: 75, format: (v) => (v === 'Inactive' ? 'Withdrawn' : '') },
      ...(canLab || canCorp ? [{ field: '_w', title: '', type: 'button', width: 90, label: (r) => (r.status === 'Active' && mayEdit(r) ? 'Withdraw' : ''), onClick: async (r) => {
        if (r.status !== 'Active' || !mayEdit(r)) return;
        const ok = await signed(dialogs, { what: `Withdraw ${r.qualification_code} (entered in error)`, meaning: 'Withdrawn by', needReason: true }, (reason, signature) => withdrawQualification(r.id, reason, signature));
        if (ok) { toast('Withdrawn and signed.'); reload(); }
      } }] : [])];
    const docs = [
      { field: 'doc_kind', title: 'Kind', type: 'readonly', width: 120 },
      // the file opens in a new tab
      { field: 'title', title: 'Document', type: 'link', width: 260, href: () => '#', format: (v, r) => v || r.file_name, onClick: (r) => window.open(documentUrl(r.id, site?.id), '_blank', 'noopener') },
      { field: '_rec', title: 'For', type: 'readonly', width: 90, compute: recCode },
      { field: 'certificate_expires', title: 'Certificate expires', type: 'readonly', width: 125, format: d8, cellClass: (r) => (r.status === 'Active' ? expCls(r.certificate_expires) : '') },
      { field: 'added_by', title: 'Added by', type: 'readonly', width: 150 }, { field: 'created_at', title: 'Added', type: 'readonly', width: 120, format: dt },
      { field: 'status', title: 'Record', type: 'readonly', width: 75, format: (v) => (v === 'Inactive' ? 'Withdrawn' : '') },
      ...(canLab || canCorp ? [{ field: '_wd', title: '', type: 'button', width: 90, label: (r) => (r.status === 'Active' && docEditable(r) ? 'Withdraw' : ''), onClick: async (r) => {
        if (r.status !== 'Active' || !docEditable(r)) return;
        const ok = await signed(dialogs, { what: `Withdraw the document "${r.title || r.file_name}" (attached in error)`, sign: false, needReason: true }, (reason) => withdrawDocument(r.id, reason));
        if (ok) { toast('Withdrawn.'); reload(); }
      } }] : [])];
    return { quals, docs };
  }, [d, canLab, canCorp, dialogs, toast, reload, site?.id]);

  if (error && !d) return <Failed error={error} />;
  if (!d) return <Loading />;
  const s = d.supplier; const row = d.row || {};
  const local = d.qualifications.find((q) => q.site_id && q.status === 'Active');
  const corp = d.qualifications.find((q) => !q.site_id && q.status === 'Active');
  const openProp = d.promotions.find((p) => p.status === 'Proposed');
  const localCurrent = local && local.approval_status === 'Approved' && (!local.expiration_date || new Date(local.expiration_date) >= new Date(today()));
  const canPropose = canLab && localCurrent && !openProp && !(corp && corp.approval_status !== 'Approved');
  const shared = d.classes.filter((c) => !c.site_id);
  const fail = (e) => toast(e.message, 'err');

  // ---- Approve vendor… (this lab, or every lab for Corporate QA)
  const approve = async () => {
    const levels = [...(canLab ? [{ value: 'lab', label: `This lab only (${site.site_code})` }] : []), ...(canCorp ? [{ value: 'corporate', label: 'Corporate: every lab' }] : [])];
    const h = {};
    const v = await dialogs.form({ title: `Approve ${s.supplier_name}`, okText: 'Next: sign', wide: true,
      intro: 'A new decision record. Approved needs what the vendor is approved for. Suspended or Not Approved stops the whole vendor. The expiry comes from the risk class unless you give one. A corporate decision uses a shared risk class and applies to every lab.',
      fields: [{ name: 'level', label: 'Applies to', type: 'select', options: levels, value: levels[0].value, blank: false },
        { name: 'approval_status', label: 'Decision', type: 'select', options: ['Approved', 'Suspended', 'Not Approved'], value: 'Approved', blank: false },
        { name: 'risk_class_id', label: 'Risk class', type: 'select', options: d.classes.map((c) => ({ value: c.id, label: classLabel(c) })), required: true },
        { name: 'approval_date', label: 'Date of the review', type: 'date', value: today() }, { name: 'expiration_date', label: 'Expires (leave empty to use the risk class)', type: 'date' },
        { name: 'accreditations', label: 'Accreditations (e.g. ISO 17025, ISO 9001)' }, { name: 'justification', label: 'Justification / evidence', type: 'textarea' }],
      after: <><ScopeBoxes scopes={d.scopes} allowEvery holder={h} /><DocRows n={2} holder={h} /></>,
      submit: (x) => { if (x.approval_status === 'Approved' && !h.all_scopes && !h.scope_ids.length) throw new Error('Tick what the vendor is approved for, or "Every scope".'); return x; } });
    if (!v) return;
    let documents;
    try { documents = await docsToBody(h.docs); } catch (e) { fail(e); return; }
    const corporate = v.level === 'corporate';
    const ok = await signed(dialogs, { what: `Vendor approval of ${s.supplier_name}: ${v.approval_status} (${corporate ? 'corporate, every lab' : 'this lab'})`, meaning: v.approval_status === 'Approved' ? 'Approved by' : v.approval_status === 'Suspended' ? 'Suspended by' : 'Rejected by', needReason: false },
      (reason, signature) => addQualification(s.id, { row: { ...v, all_scopes: h.all_scopes, scope_ids: h.scope_ids }, documents, signature }));
    if (ok) { toast('Decision recorded and signed.'); reload(); }
  };

  // ---- Attach document…
  const attach = async () => {
    const mayEdit = (q) => (q.site_id ? canLab : canCorp);
    const recs = d.qualifications.filter((x) => x.status === 'Active' && mayEdit(x));
    if (!recs.length) { toast('Approve the vendor first: documents belong to an approval.', 'err'); return; }
    const h = {};
    const v = await dialogs.form({ title: 'Attach documents', okText: 'Attach', wide: true,
      fields: [{ name: 'qualification_id', label: 'To the approval', type: 'select', blank: false, value: recs[0].id, options: recs.map((x) => ({ value: x.id, label: `${x.qualification_code}: ${x.site_code || 'Corporate'}, ${x.approval_status}` })) }],
      after: <DocRows n={3} holder={h} />,
      submit: async (x) => {
        if (!h.docs.length) throw new Error('Choose a file to attach.');
        await attachDocuments(x.qualification_id, await docsToBody(h.docs));
        return x;
      } });
    if (v) { toast('Attached.'); reload(); }
  };

  // ---- Propose for corporate approval…
  const propose = async () => {
    const hasDoc = d.documents.some((x) => x.status === 'Active' && x.qualification_id === local.id);
    if (!hasDoc) { toast(`Attach at least one document to ${local.qualification_code} first ("Attach document…"): Corporate QA decides on the evidence.`, 'err'); return; }
    const every = !local.scope_ids;
    const h = {};
    const v = await dialogs.form({ title: `Propose ${s.supplier_name} for corporate approval`, okText: 'Next: sign', wide: true,
      intro: `Corporate QA reviews ${local.qualification_code} and its documents, and approves the vendor for every lab or rejects the proposal. You can propose only what ${site.site_code} approved it for.`,
      fields: [{ name: 'risk_class_id', label: 'Shared risk class', type: 'select', required: true, options: shared.map((c) => ({ value: c.id, label: classLabel(c) })), value: (shared.find((c) => c.id === local.risk_class_id) || {}).id || '' },
        { name: 'note', label: 'Note for Corporate QA', type: 'textarea' }],
      after: every ? <p className="help">This lab approved it for every scope; the proposal is for every scope too.</p>
        : <ScopeBoxes scopes={d.scopes.filter((sc) => local.scope_ids.includes(sc.id))} ticked={local.scope_ids} holder={h} /> });
    if (!v) return;
    const ok = await signed(dialogs, { what: `Propose ${s.supplier_name} (${local.qualification_code}) for corporate approval`, meaning: 'Proposed by', needReason: false },
      (reason, signature) => proposePromotion(local.id, { risk_class_id: v.risk_class_id, scope_ids: every ? null : h.scope_ids, note: v.note, signature }));
    if (ok) { toast('Proposed: waiting for Corporate QA.'); reload(); }
  };

  // ---- Corporate QA decides
  const decide = async (yes) => {
    const from = d.qualifications.find((x) => x.id === openProp.from_qualification_id) || {};
    const fromScopes = from.scope_ids || null;
    const h = {};
    const v = await dialogs.form({ title: `${yes ? 'Approve' : 'Reject'} ${openProp.promotion_code}`, okText: 'Next: sign', wide: true,
      intro: yes ? `Approves ${s.supplier_name} for every lab, at most for what ${openProp.site_code} approved; the lab's documents are carried to the corporate record.` : `The proposal is rejected; ${openProp.site_code}'s own approval stands. The lab sees your reason.`,
      fields: [...(yes ? [{ name: 'risk_class_id', label: 'Shared risk class', type: 'select', blank: false, options: shared.map((c) => ({ value: c.id, label: classLabel(c) })), value: openProp.risk_class_id }] : []),
        { name: 'note', label: yes ? 'Note (optional)' : 'Why it is rejected', type: 'textarea', required: !yes }],
      after: yes && fromScopes ? <ScopeBoxes scopes={d.scopes.filter((sc) => fromScopes.includes(sc.id))} ticked={openProp.scope_ids || fromScopes} holder={h} /> : null });
    if (!v) return;
    const ok = await signed(dialogs, { what: `${yes ? 'Approve' : 'Reject'} ${openProp.promotion_code}: ${s.supplier_name} for every lab`, meaning: yes ? 'Approved by' : 'Rejected by', needReason: false },
      (reason, signature) => decidePromotion(openProp.id, { decision: yes ? 'Approved' : 'Rejected', note: v.note, risk_class_id: v.risk_class_id, scope_ids: yes && fromScopes ? h.scope_ids : null, signature }));
    if (ok) { toast(yes ? 'Approved for every lab.' : 'Proposal rejected.'); reload(); }
  };
  const withdrawProp = async () => {
    const ok = await signed(dialogs, { what: `Withdraw ${openProp.promotion_code}`, sign: false, needReason: true }, (reason) => withdrawPromotion(openProp.id, reason));
    if (ok) { toast('Proposal withdrawn.'); reload(); }
  };

  const qText = (q) => (q ? `${q.qualification_code}: ${decisionText(q.approval_status, q.scope_text)}${q.expiration_date ? ' until ' + d8(q.expiration_date) : ''}` : 'No decision');
  return <>
    <div className="eyebrow">{s.supplier_code} · {s.supplier_type}</div>
    <PageHeader title={s.supplier_name} audit={{ kind: 'supplier', id }}
      subtitle={<><span className={`s-${String(s.approval_status).split(' ')[0]}`}>{s.approval_status} for {site?.site_code}</span>{s.approved_until ? ` until ${d8(s.approved_until)}` : ''}{s.decided_at ? ` · decided ${s.decided_at === 'Corporate' ? 'by Corporate QA' : 'by this lab'}` : ''}</>}
      actions={<>
        <Button variant="light" href="#/purchasing/suppliers">All vendors</Button>{' '}
        {(canLab || canCorp) && <><Button type="button" variant="outline-secondary" onClick={() => attach().catch(fail)}>Attach document…</Button>{' '}</>}
        {canPropose && <><Button type="button" variant="outline-secondary" onClick={() => propose().catch(fail)}>Propose for corporate approval…</Button>{' '}</>}
        {(canLab || canCorp) && <Button type="button" variant="primary" onClick={() => approve().catch(fail)}>Approve vendor…</Button>}
      </>} />
    {openProp && (
      <Section className={canCorp ? 'warn' : ''} title={`Proposed for corporate approval: ${openProp.promotion_code}`}
        help={`${openProp.site_code} (${openProp.proposed_by_name}, ${dt(openProp.created_at)}) proposes ${openProp.from_code} for every lab: ${openProp.scope_text}, ${openProp.class_name}. ${openProp.document_count} document${openProp.document_count === 1 ? '' : 's'}.${openProp.note ? ' Note: ' + openProp.note : ''}`}
        actions={<>
          {canCorp && <><Button type="button" variant="outline-secondary" onClick={() => decide(false).catch(fail)}>Reject proposal…</Button>{' '}<Button type="button" variant="primary" onClick={() => decide(true).catch(fail)}>Approve for every lab…</Button>{' '}</>}
          {canLab && openProp.site_id === site?.id && <Button type="button" variant="light" onClick={() => withdrawProp().catch(fail)}>Withdraw proposal…</Button>}
        </>} />)}
    <div className="cols">
      <Card body><h2>Vendor</h2><Kv pairs={[['Code', s.supplier_code], ['Type', s.supplier_type], ['Our account #', s.account_number], ['Contact', s.contact_name],
        ['Email', s.email], ['Phone', s.phone], ['Website', s.website], ['Address', s.address], ['Notes', s.notes]]} /></Card>
      <Card body><h2>Here and now</h2><Kv pairs={[['Status', s.approval_status], ['Decided by', levelText(s)], ['Approved until', d8(s.approved_until)], ['Risk class', s.risk_class],
        ['This lab', qText(local)], ['Corporate', qText(corp)], ['Next certificate expiry', d8(row.next_certificate_expiry)]]} /></Card>
    </div>
    <Section title="Approval history" help="Each decision is its own signed record; nothing is overwritten. Corporate (every lab) and this lab's own. A corporate suspension or rejection applies everywhere; otherwise this lab's decision comes first. Withdraw a record only if it was entered in error.">
      <ReadGrid rows={d.qualifications} columns={cols.quals} emptyText="Never approved." rowClass={mutedInactive} />
    </Section>
    <Section title="Documents" help="The evidence behind the approvals: questionnaires, certificates (with their expiry), audit reports, quality agreements. A document is never changed; withdraw it if attached in error.">
      <ReadGrid rows={d.documents} columns={cols.docs} emptyText={'No documents yet: "Attach document…".'} rowClass={mutedInactive} />
    </Section>
    {d.promotions.length > 0 && <Section title="Proposals for corporate approval"><ReadGrid rows={d.promotions} columns={PROMO_COLS} /></Section>}
    <Section title="Requests from this lab"><ReadGrid rows={d.lines} columns={LINES} emptyText="No requests." /></Section>
  </>;
}
