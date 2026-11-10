// The pulls grid (Pulls due, and a study's pulls) with "Record pull…"
import { useMemo } from 'react';
import { recordPull } from '../../api/stability.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { d8, dt } from './shared.jsx';

const pullRow = (r) => (r.overdue ? 'tbnc' : r.status === 'Pulled' ? 'mutedrow' : '');

async function record(dialogs, toast, r, reload) {
  const now = new Date(); const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const v = await dialogs.form({ title: `Record pull: ${r.study_code} ${r.timepoint_label}, ${r.condition_name}`, okText: 'Record pull',
    intro: `Take the units out of ${r.equipment_name}, rack ${r.rack_code}${r.position ? ', ' + r.position : ''} (${r.storage_code}). The pull sample is then logged in and its tests go to the backlog; turnaround counts from the scheduled date, ${d8(r.scheduled_date)}. Window: ${d8(r.window_start)} to ${d8(r.window_end)}.`,
    fields: [{ name: 'pulled_at', label: 'Pulled at', type: 'datetime-local', value: local, required: true }, { name: 'units', label: 'Units taken out', type: 'number', value: r.units_required, required: true },
      { name: 'note', label: 'Note (required outside the window)', type: 'textarea' }],
    submit: (x) => recordPull(r.id, { ...x, pulled_at: new Date(x.pulled_at).toISOString() }) });
  if (!v) return;
  toast(`Pulled: ${v.left} units left in storage. The sample is logged in.`);
  reload();
}

export default function PullsGrid({ rows, canManage, reload, withStudy }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const columns = useMemo(() => [
    ...(withStudy ? [{ field: 'study_code', title: 'Study', type: 'link', width: 95, href: (r) => '#/stability/studies/' + r.study_id }, { field: 'client_name', title: 'Client', type: 'readonly', width: 150 }] : []),
    { field: 'timepoint_label', title: 'Timepoint', type: 'readonly', width: 85 },
    { field: 'condition_name', title: 'Condition', type: 'readonly', width: 130 },
    { field: 'scheduled_date', title: 'Pull on', type: 'readonly', width: 105, format: d8 },
    { field: 'window', title: 'Window', type: 'readonly', width: 150, compute: (r) => `${d8(r.window_start)} to ${d8(r.window_end)}` },
    { field: 'status', title: 'Status', type: 'readonly', width: 95, compute: (r) => (r.overdue ? 'Overdue' : r.status), cellClass: (r) => (r.overdue ? 'tbfail' : r.status === 'Ordered' ? 'tbwait' : r.status === 'Pulled' ? 'tbpass' : '') },
    { field: 'rec', title: '', type: 'button', width: 100, label: (r) => (canManage && r.status === 'Ordered' ? 'Record pull…' : ''), onClick: (r) => canManage && r.status === 'Ordered' && record(dialogs, toast, r, reload) },
    { field: 'where', title: 'Where', type: 'readonly', width: 230, compute: (r) => `${r.equipment_name} · rack ${r.rack_code}${r.position ? ' · ' + r.position : ''}` },
    { field: 'units_required', title: 'Units', type: 'readonly', width: 60 },
    { field: 'order_code', title: 'Order', type: 'link', width: 95, href: (r) => (r.lab_order_id ? '#/orders/' + r.lab_order_id : null) },
    { field: 'sample', title: 'Sample', type: 'link', width: 140, compute: (r) => r.sample_code || r.client_sample_id || '', href: (r) => (r.sample_id ? '#/samples/' + r.sample_id : null) },
    { field: 'pulled_at', title: 'Pulled', type: 'readonly', width: 150, format: dt },
    { field: 'units_pulled', title: 'Units out', type: 'readonly', width: 75 },
    { field: 'within_window', title: 'In window', type: 'readonly', width: 80, compute: (r) => (r.within_window === true ? 'Yes' : r.within_window === false ? 'No' : '') },
    { field: 'pull_note', title: 'Note', type: 'readonly', width: 200 },
  ], [withStudy, canManage, dialogs, toast, reload]);
  return <ReadGrid rows={rows} columns={columns} search emptyText="No pulls in the next 60 days." rowClass={pullRow} />;
}
