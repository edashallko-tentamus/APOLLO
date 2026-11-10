// Intake dashboard: rush requests, incoming work and today's samples for the lab being worked in
import { useMemo } from 'react';
import { decideRush, getIntake } from '../../api/intake.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import EditableGrid from '../../components/EditableGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { dateTime } from '../../lib/format.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { Card } from 'react-bootstrap';

const d8 = (v) => (v ? new Date(v + 'T12:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : '');
const ago = (v) => { if (!v) return ''; const m = Math.round((Date.now() - new Date(v).getTime()) / 60000); return m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`; };
const orderLink = (r) => '#/orders/' + r.lab_order_id;
const sampleLink = (r) => (r.sample_id ? '#/samples/' + r.sample_id : null);
const clientLink = (r) => '#/clients/' + r.client_id;
const testLink = (r) => '#/catalog/' + r.test_id;
const overdueRow = (r) => (r.overdue ? 'warnrow' : '');

const EXPECTED_COLUMNS = [
  { field: 'order_code', title: 'Order', type: 'link', width: 95, href: orderLink },
  { field: 'client_name', title: 'Client', type: 'readonly', width: 150 },
  { field: 'expected_samples', title: 'Samples', type: 'readonly', width: 70 },
  { field: 'account_status', title: 'Client', type: 'readonly', width: 80, format: (v) => (v === 'Active' ? '' : v) },
];
const TODAY_COLUMNS = [
  { field: 'sample_code', title: 'Sample', type: 'link', width: 125, href: sampleLink },
  { field: 'order_code', title: 'Order', type: 'link', width: 95, href: orderLink },
  { field: 'client_name', title: 'Client', type: 'readonly', width: 130 },
  { field: 'test_count', title: 'Tests', type: 'readonly', width: 55 },
  { field: 'due_date', title: 'Due', type: 'readonly', width: 100, format: d8 },
];
const AUDIT = { kind: 'intake' };

export default function IntakeDashboardPage() {
  const { data: d, error, reload } = useApi(getIntake, []);
  const { site } = useSession();
  const dialogs = useDialogs();
  const toast = useToast();

  const [pendingCols, incomingCols] = useMemo(() => {
    if (!d) return [[], []];
    async function decide(r, decision) {
      const what = `${r.test_name} on ${r.sample_code || r.client_sample_id} for ${r.client_name}.`;
      if (decision === 'Approved') {
        const v = await dialogs.form({ title: `Approve ${r.rush_tier_name} rush`, okText: 'Approve', intro: `${what} The rush fee and rush due date apply from now.`,
          fields: [{ name: 'reason', label: 'Note (optional)' }] });
        if (!v) return;
        try { await decideRush({ requested_test_id: r.id, decision, requested_tier_id: r.rush_tier_id, reason: v.reason || null }); toast('Rush approved.'); reload(); } catch (e) { toast(e.message, 'err'); }
        return;
      }
      const cur = d.tiers.find((t) => t.id === r.rush_tier_id);
      const slower = d.tiers.filter((t) => cur && t.schedule_id === cur.schedule_id && t.rush_tat > cur.rush_tat);
      const v = await dialogs.form({ title: `Rush not accepted: ${r.rush_tier_name}`, okText: 'Confirm and email client',
        intro: `${what} An automatic email goes to the ordering contact with the new turnaround, the fee change, your reason and your name.`,
        fields: [
          { name: 'replacement_tier_id', label: 'Change it to', type: 'select', blank: false, value: '',
            options: [{ value: '', label: 'Standard turnaround (no rush fee)' }, ...slower.map((t) => ({ value: t.id, label: `${t.tier_name} rush (${t.rush_tat} ${t.tat_unit === 'Business Days' ? 'business' : 'calendar'} days)` }))] },
          { name: 'reason', label: 'Reason (sent to the client)', type: 'textarea', required: true }] });
      if (!v) return;
      try { await decideRush({ requested_test_id: r.id, decision, requested_tier_id: r.rush_tier_id, replacement_tier_id: v.replacement_tier_id || null, reason: v.reason }); toast('Rush declined; email placed in the Outbox.'); reload(); } catch (e) { toast(e.message, 'err'); }
    }
    return [[
      { field: 'order_code', title: 'Order', type: 'link', width: 95, href: orderLink },
      { field: 'client_name', title: 'Client', type: 'link', width: 140, href: clientLink },
      { field: 'sample_code', title: 'Sample', type: 'link', width: 125, compute: (r) => r.sample_code || r.client_sample_id, href: sampleLink },
      { field: 'test_name', title: 'Test', type: 'link', width: 180, href: testLink },
      { field: 'rush_tier_name', title: 'Requested', type: 'readonly', width: 110 },
      { field: 'rush_requested_at', title: 'Requested', type: 'readonly', width: 120, format: ago },
      { field: 'approval_due_at', title: 'Approve by', type: 'readonly', width: 130, format: (v, r) => dateTime(v) + (r.overdue ? ' (overdue)' : ''), cellClass: (r) => (r.overdue ? 'flag' : '') },
      { field: 'ap', title: '', type: 'button', width: 85, label: 'Approve', onClick: (r) => decide(r, 'Approved') },
      { field: 'na', title: '', type: 'button', width: 120, label: 'Not accepted', onClick: (r) => decide(r, 'Not Accepted') },
    ], [
      { field: 'order_code', title: 'Order', type: 'link', width: 95, href: orderLink },
      { field: 'client_name', title: 'Client', type: 'link', width: 140, href: clientLink },
      { field: 'sample_code', title: 'Sample', type: 'link', width: 125, compute: (r) => r.sample_code || `${r.client_sample_id} (not logged)`, href: sampleLink },
      { field: 'test_name', title: 'Test', type: 'link', width: 180, href: testLink },
      { field: 'rush_tier_name', title: 'Rush', type: 'readonly', width: 110 },
      { field: 'rush_status', title: 'Status', type: 'readonly', width: 110 },
      { field: 'due_date', title: 'Due', type: 'readonly', width: 110, format: (v) => d8(v) || 'when logged' },
      { field: 'nax', title: '', type: 'button', width: 120, label: 'Not accepted', onClick: (r) => decide(r, 'Not Accepted') },
    ]];
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps

  const header = <PageHeader title="Intake dashboard" audit={AUDIT} subtitle={`Rush requests, incoming work and today's samples for ${site ? site.site_code : 'your lab'}.`} />;
  if (error && !d) return <>{header}<Card body className="err">{error.message}</Card></>;
  if (!d) return <>{header}<div className="loading">Loading…</div></>;
  const overdue = d.pending.filter((p) => p.overdue).length;

  return <>
    {header}
    <div className="tiles">
      <div className={`tile${d.pending.length ? ' warn' : ''}`}><b>{d.pending.length}</b><span>Rush awaiting approval</span></div>
      <div className={`tile${overdue ? ' warn' : ''}`}><b>{overdue}</b><span>Approvals overdue (escalate)</span></div>
      <div className="tile"><b>{d.incoming.length}</b><span>Rush tests active</span></div>
      <div className="tile"><b>{d.expected.reduce((s, x) => s + Number(x.expected_samples), 0)}</b><span>Samples expected</span></div>
      <div className="tile"><b>{d.today.length}</b><span>Samples logged (24 h)</span></div>
    </div>
    <Section title="Rush awaiting approval" help="These tiers need intake approval. Until approved, the test runs at standard turnaround and price. Overdue requests escalate to the lab manager.">
      <EditableGrid readOnly rows={d.pending} columns={pendingCols} emptyText="Nothing waiting for approval." rowClass={overdueRow} />
    </Section>
    <Section title="Rush incoming" help="Accepted rushes (automatic or approved). Plan the work around these due dates.">
      <EditableGrid readOnly rows={d.incoming} columns={incomingCols} emptyText="No active rush tests." />
    </Section>
    <div className="cols">
      <Section title="Samples expected" help="Orders with samples not yet logged.">
        <EditableGrid readOnly rows={d.expected} columns={EXPECTED_COLUMNS} emptyText="No samples expected." />
      </Section>
      <Section title="Logged in the last 24 hours">
        <EditableGrid readOnly rows={d.today} columns={TODAY_COLUMNS} emptyText="Nothing logged yet." />
      </Section>
    </div>
  </>;
}
