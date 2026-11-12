// Intake > Client licenses: every client's licenses, those expired or expiring within 30 days first
import { useMemo } from 'react';
import { listLicenses } from '../../api/clients.js';
import EditableGrid from '../../components/EditableGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useApi } from '../../hooks/useApi.js';
import { day, licenseStateCls } from './clientForm.jsx';
import { Card } from 'react-bootstrap';

const COLUMNS = [
  { field: 'client_name', title: 'Client', type: 'link', width: 220, href: (r) => '#/clients/' + r.client_id },
  { field: 'license_type', title: 'Type', type: 'readonly', width: 180 },
  { field: 'license_number', title: 'Number', type: 'readonly', width: 160 },
  { field: 'issuing_authority', title: 'Issued by', type: 'readonly', width: 140 },
  { field: 'expires_on', title: 'Expires', type: 'readonly', width: 100, format: (v) => day(v) || 'Does not expire' },
  { field: 'state', title: 'State', type: 'readonly', width: 140, cellClass: (r) => licenseStateCls(r.state), format: (v, r) => (v === 'Expiring soon' ? `Expiring soon (${r.days_left} d)` : v === 'Expired' ? `Expired ${-r.days_left} d ago` : v) },
  { field: 'account_status', title: 'Client status', type: 'readonly', width: 110 },
];
const openClient = (r) => { window.location.hash = '#/clients/' + r.client_id; };
const AUDIT = { kind: 'licenses' };

export default function LicensesPage({ query }) {
  const { data: d, error } = useApi(listLicenses, []);
  const want = new URLSearchParams(query).get('show');
  const show = ['due', 'all'].includes(want) ? want : 'due';
  const due = useMemo(() => (d ? d.rows.filter((r) => r.state !== 'Current') : []), [d]);
  const header = <PageHeader title="Client licenses" audit={AUDIT}
    subtitle="Every client's current licenses. Expired ones, then those expiring within 30 days, come first. Licenses are added and retired on each client's page." />;
  if (error && !d) return <>{header}<Card body className="err">{error.message}</Card></>;
  if (!d) return <>{header}<div className="loading">Loading…</div></>;
  return <>
    {header}
    <div className="tabs">
      <a className={`tab${show === 'due' ? ' on' : ''}`} href="#/licenses?show=due">Expired or expiring ({due.length})</a>
      <a className={`tab${show === 'all' ? ' on' : ''}`} href="#/licenses?show=all">All current ({d.rows.length})</a>
    </div>
    <EditableGrid readOnly search rows={show === 'due' ? due : d.rows} columns={COLUMNS} onRowOpen={openClient}
      emptyText={show === 'due' ? 'No license is expired or expiring within 30 days.' : 'No licenses recorded yet.'} />
  </>;
}
