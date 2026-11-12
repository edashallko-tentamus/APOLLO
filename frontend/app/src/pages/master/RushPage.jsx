// Rush fee schedules: named, reusable rush options, each with its tiers. Assigned to tests in the test catalogue.
import { useMemo } from 'react';
import { createRushSchedules, listRushSchedules, saveRushTiers } from '../../api/master.js';
import EditableGrid from '../../components/EditableGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useMeta } from '../../hooks/useMeta.js';
import { money } from '../../lib/format.js';
import { Button, Card, Nav } from 'react-bootstrap';

const AUDIT = { kind: 'rush' };
let lastSelected = null; // the schedule shown last, as the old screen remembered it

export default function RushPage({ params }) {
  const meta = useMeta();
  const dialogs = useDialogs();
  const toast = useToast();
  const { data: schedules, error, reload } = useApi(listRushSchedules, []);
  const cur = schedules && (schedules.find((s) => s.id === (params[0] || lastSelected)) || schedules[0]);
  if (cur) lastSelected = cur.id;

  const columns = useMemo(() => [
    { field: 'sort_order', title: 'Order', type: 'int', width: 60 },
    { field: 'tier_name', title: 'Tier', required: true, width: 170 },
    { field: 'rush_tat', title: 'Rush TAT', type: 'int', min: 0, width: 80 },
    { field: 'tat_unit', title: 'Unit', type: 'select', options: meta?.enums.tat_unit || [], width: 130 },
    { field: 'surcharge_type', title: 'Surcharge type', type: 'select', options: meta?.enums.surcharge_type || [], width: 120 },
    { field: 'surcharge_value', title: 'Surcharge', type: 'number', min: 0, width: 90, format: (v, r) => (v === null || v === undefined ? '' : r.surcharge_type === 'Flat' ? money(v) : v + '%') },
    { field: 'requires_approval', title: 'Needs approval', type: 'bool', width: 110 },
    { field: 'escalation_hours', title: 'Escalate after (h)', type: 'number', min: 0.25, width: 120 },
    { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 90 },
  ], [meta]);
  const tierCount = cur?.tiers.length || 0;
  const newRow = useMemo(() => () => ({ tat_unit: 'Business Days', surcharge_type: 'Percent', requires_approval: false, escalation_hours: 2, status: 'Active', sort_order: tierCount + 1 }), [tierCount]);
  const save = useMemo(() => (rows, reason) => saveRushTiers(cur.id, rows, reason), [cur?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function newSchedule() {
    const v = await dialogs.form({ title: 'New rush fee schedule', okText: 'Create',
      fields: [{ name: 'schedule_name', label: 'Schedule name', required: true }, { name: 'description', label: 'Description' }] });
    if (!v) return;
    try { const r = await createRushSchedules([v]); lastSelected = r[0].id; window.location.hash = '#/rush/' + r[0].id; reload(); } catch (e) { toast(e.message, 'err'); }
  }

  return <>
    <PageHeader title="Rush fee schedules" audit={AUDIT} subtitle="Named, reusable rush options (for example micro differs from chemistry). Assigned to tests in the test catalogue."
      actions={<Button type="button" variant="primary" onClick={newSchedule}>+ New schedule</Button>} />
    {error ? <Card body className="err">{error.message}</Card> : !schedules ? <div className="loading">Loading…</div> : <>
      <Nav variant="pills" className="tabs">{schedules.map((s) => (
        <Nav.Link active={cur && s.id === cur.id} key={s.id} href={'#/rush/' + s.id}>{s.schedule_name} <small>{s.test_count} tests</small></Nav.Link>
      ))}</Nav>
      {cur ? (
        <Section title={cur.schedule_name + ' tiers'} help={`${cur.description || ''} The test's standard TAT is the maximum; each tier offers a faster TAT for a surcharge. "Needs approval" is the default for tests using this schedule; each test can override it.`}>
          <EditableGrid key={cur.id} rows={cur.tiers} columns={columns} allowAdd newRow={newRow} what={`rush tiers on ${cur.schedule_name}`} save={save} afterSave={reload} />
        </Section>
      ) : <Card body>No schedules yet.</Card>}
    </>}
  </>;
}
