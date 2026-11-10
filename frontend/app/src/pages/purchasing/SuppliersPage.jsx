// Purchasing > Vendor approvals (V-1, migration 050): every vendor at this lab with this lab's approval and the
// corporate one, what applies here, notices from Corporate QA and proposals waiting for corporate approval.
// QA approves vendors (purchasing.qualify, this lab); Corporate QA approves them for every lab (purchasing.qualify_corporate).
import { useEffect, useMemo, useState } from 'react';
import { acknowledgeNotices, listVendors, purchasingMe } from '../../api/purchasing.js';
import DataGrid from '../../components/grid/DataGrid.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { d8, decisionText, dt, expCls, Failed, levelText, Loading, NeedLab, PuTabs, supCls } from './shared.jsx';
import { Button } from 'react-bootstrap';

const AUDIT = { kind: 'vendors' };
const days = (v) => (new Date(v) - Date.now()) / 864e5;
const F = {
  all: ['All', () => true], approved: ['Approved here', (r) => r.approval_status === 'Approved'], attention: ['Not approved or expired', (r) => r.approval_status !== 'Approved'],
  due: ['Re-approve within 60 days', (r) => r.approval_status === 'Approved' && r.approved_until && days(r.approved_until) <= 60],
  certs: ['Certificates expiring', (r) => r.next_certificate_expiry && days(r.next_certificate_expiry) <= 60],
  corporate: ['Corporate approvals', (r) => !!r.corporate_status], stopped: ['Stopping requests', (r) => r.stopped_requests > 0],
};
const openVendor = (r) => { window.location.hash = '#/purchasing/suppliers/' + r.supplier_id; };
const vendorHref = (r) => '#/purchasing/suppliers/' + r.supplier_id;

const COLUMNS = [
  { field: 'supplier_code', title: 'Code', type: 'link', width: 85, href: vendorHref },
  { field: 'supplier_name', title: 'Vendor', type: 'readonly', width: 210 }, { field: 'supplier_type', title: 'Type', type: 'readonly', width: 150 },
  { field: 'approval_status', title: 'Here', type: 'readonly', width: 120, cellClass: (r) => supCls(r.approval_status) },
  { field: 'decided_at', title: 'Decided by', type: 'readonly', width: 95, format: (v, r) => levelText(r) },
  { field: 'approved_until', title: 'Until', type: 'readonly', width: 95, format: d8, cellClass: (r) => (r.approval_status === 'Approved' ? expCls(r.approved_until) : '') },
  { field: 'local_status', title: 'This lab', type: 'readonly', width: 220, format: (v, r) => decisionText(v, r.local_scopes), cellClass: (r) => (r.local_status ? supCls(r.local_status) : '') },
  { field: 'corporate_status', title: 'Corporate', type: 'readonly', width: 220, format: (v, r) => decisionText(v, r.corporate_scopes), cellClass: (r) => (r.corporate_status ? supCls(r.corporate_status) : '') },
  { field: 'next_certificate_expiry', title: 'Certificate expires', type: 'readonly', width: 120, format: d8, cellClass: (r) => expCls(r.next_certificate_expiry) },
  { field: 'document_count', title: 'Documents', type: 'readonly', width: 85 },
  { field: 'stopped_requests', title: 'Stopped requests', type: 'readonly', width: 115, format: (v) => (v ? String(v) : ''), cellClass: (r) => (r.stopped_requests ? 'cbad' : '') },
  { field: 'promotion_code', title: 'Proposal', type: 'readonly', width: 90 }];
const NOTICE_COLS = [
  { field: 'supplier_name', title: 'Vendor', type: 'link', width: 190, href: vendorHref },
  { field: 'notice', title: 'Notice', type: 'readonly', width: 620 }, { field: 'created_at', title: 'When', type: 'readonly', width: 130, format: dt }];
const WAITING_COLS = [
  { field: 'promotion_code', title: 'Proposal', type: 'link', width: 90, href: vendorHref },
  { field: 'supplier_name', title: 'Vendor', type: 'readonly', width: 190 }, { field: 'site_code', title: 'From', type: 'readonly', width: 60 },
  { field: 'scope_text', title: 'For', type: 'readonly', width: 230 }, { field: 'class_name', title: 'Risk class', type: 'readonly', width: 90 },
  { field: 'document_count', title: 'Documents', type: 'readonly', width: 85 }, { field: 'proposed_by_name', title: 'Proposed by', type: 'readonly', width: 140 },
  { field: 'created_at', title: 'When', type: 'readonly', width: 120, format: dt }, { field: 'note', title: 'Note', type: 'readonly', width: 240 }];

// QA marks the selected notices as read (none selected: all of them)
function Notices({ site, rows, canAck, onDone }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const grid = useGrid({ rows, columns: NOTICE_COLS, readOnly: true });
  const { reset } = grid;
  useEffect(() => { reset(rows); }, [rows, reset]);
  const ack = async () => {
    const sel = grid.selectedRows();
    setBusy(true);
    try { await acknowledgeNotices((sel.length ? sel : rows).map((r) => r.id)); toast('Marked as read.'); onDone(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Section className="warn" title={`Notices for ${site.site_code} (${rows.length})`} help="Corporate QA's decisions that affect this lab. QA marks them as read (select some, or none for all)."
      actions={canAck && <Button type="button" variant="outline-secondary" disabled={busy} onClick={ack}>Mark as read</Button>}>
      <DataGrid grid={grid} />
    </Section>
  );
}

export default function SuppliersPage({ query }) {
  const { site } = useSession();
  const { data, error, reload } = useApi(() => (site ? Promise.all([listVendors(), purchasingMe()]) : Promise.resolve(null)), [site?.id]);
  const q = new URLSearchParams(query).get('show');
  const show = F[q] ? q : 'all';
  const d = data?.[0];
  const shown = useMemo(() => (d ? d.rows.filter(F[show][1]) : []), [d, show]);
  const open = useMemo(() => (d ? d.notices.filter((n) => !n.acknowledged_at) : []), [d]);
  const waiting = useMemo(() => (d ? d.promotions.filter((p) => p.status === 'Proposed') : []), [d]);
  if (!site) return <NeedLab />;
  const me = data?.[1] || {};
  return <>
    <PageHeader title={`Vendor approvals: ${site.site_code}`} audit={AUDIT}
      subtitle={`Whether each vendor may be used at ${site.site_name}, and for what. QA approves vendors for this lab; Corporate QA approves them for every lab. A lab can be stricter than corporate (suspend or reject a vendor here), never looser: while Corporate QA has a vendor suspended or rejected, no lab can use it. Purchase requests are approved separately, by Lab Supervisors and General Managers.`}
      actions={<Button variant="outline-secondary" href="#/inventory/suppliers">Supplier list</Button>} />
    <PuTabs />
    {error && !data ? <Failed error={error} /> : !data ? <Loading /> : <>
      {open.length > 0 && <Notices site={site} rows={open} canAck={me.can_qualify} onDone={reload} />}
      {waiting.length > 0 && (
        <Section title={`Waiting for corporate approval (${waiting.length})`}
          help={me.can_qualify_corporate ? 'Open a vendor to approve it for every lab or reject the proposal (you cannot decide one you proposed).' : 'Proposals from the labs, waiting for Corporate QA.'}>
          <ReadGrid rows={waiting} columns={WAITING_COLS} onRowOpen={openVendor} />
        </Section>)}
      <div className="pubar">
        {Object.entries(F).map(([k, [lbl, fn]]) => <a key={k} className={`tab${k === show ? ' on' : ''}`} href={`#/purchasing/suppliers?show=${k}`}>{lbl} <small>{d.rows.filter(fn).length}</small></a>)}
      </div>
      {!(me.can_qualify || me.can_qualify_corporate) && <div className="alert alert-warning">QA approves vendors for this lab (purchasing.qualify); Corporate QA for every lab.</div>}
      <ReadGrid rows={shown} columns={COLUMNS} search onRowOpen={openVendor} />
    </>}
  </>;
}
