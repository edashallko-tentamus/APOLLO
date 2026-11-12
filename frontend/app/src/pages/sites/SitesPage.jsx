// Admin > Sites and holidays: each lab's settings, holiday calendar and images, and the product name
import { useMemo } from 'react';
import { listHolidays, listSites, listTimezones, saveHolidays, saveSites } from '../../api/sites.js';
import EditableGrid from '../../components/EditableGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import MediaCard from '../labsetup/MediaCard.jsx';
import ProductNameCard from '../labsetup/ProductNameCard.jsx';
import { Card } from 'react-bootstrap';

const AUDIT = { kind: 'sites' };
const d8 = (v) => (v ? new Date(v + 'T12:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : '');
const newSite = () => ({ status: 'Active', default_oos_procedure: 'Check and Acknowledge' });
const newHoliday = () => ({ status: 'Active' });
const HOLIDAY_COLUMNS = [
  { field: 'holiday_date', title: 'Date', type: 'date', width: 130, required: true, format: (v) => (v ? `${v} (${d8(v)})` : '') },
  { field: 'description', title: 'Holiday', width: 260, required: true },
  { field: 'status', title: 'Status', type: 'select', width: 90, options: ['Active', 'Inactive'] },
];
let lastSelected = null; // the lab shown last, as the old screen remembered it

export default function SitesPage({ params }) {
  const { user } = useSession();
  const sysAdmin = !!user?.is_admin;
  const { data: rows, error, reload } = useApi(listSites, []);
  const { data: tzs } = useApi(listTimezones, []);
  const cur = rows && (rows.find((s) => s.id === (params[0] || lastSelected)) || rows[0]);
  if (cur) lastSelected = cur.id;

  const columns = useMemo(() => [
    { field: 'site_code', title: 'Code', type: 'text', width: 80, required: true, help: 'Lab prefix, used in sample IDs, e.g. CFL261012001' },
    { field: 'site_name', title: 'Name', width: 240, required: true },
    { field: 'time_zone', title: 'Time zone', type: 'select', width: 200, options: (tzs || []).map((t) => t.name) },
    { field: 'address', title: 'Address', width: 220 },
    { field: 'default_oos_procedure', title: 'Default OOS procedure', type: 'select', width: 220, options: ['Full Phase I (21 CFR 211)', 'Check and Acknowledge'] },
    { field: 'require_workflow_verification', title: 'Verify workflows', type: 'bool', width: 110, help: 'A test version is approved only with a signed, passing workflow verification of its design (WD-6). Versions already approved keep their approval.' },
    { field: 'accreditation_body', title: 'Accreditation body', width: 150, help: 'Placeholder until the lab confirms it, e.g. A2LA or ANAB' },
    { field: 'accreditation_certificate', title: 'Certificate no.', width: 120 },
    { field: 'accreditation_statement', title: 'Accreditation statement (on the COA)', width: 320, help: 'Printed under the lab\'s name on every COA once filled in, e.g. "Accredited to ISO/IEC 17025:2017 (certificate 1234.01)". Empty: nothing is printed.' },
    // the 20-30 rule (migration 031): another network lab's test on this lab's quotes
    { field: 'subcontract_discount_pct', title: 'In-network discount %', type: 'number', min: 0, width: 110, help: 'Subcontracting to another Tentamus lab: the discount off that lab\'s catalogue price (the 20 of the 20-30 rule). Applies to new quote lines.' },
    { field: 'subcontract_markup_pct', title: 'Subcontract markup %', type: 'number', min: 0, width: 110, help: 'Added to that cost for the client (the 30 of the 20-30 rule). Applies to new quote lines.' },
    { field: 'stability_pull_window_days', title: 'Pull window (± days)', type: 'number', width: 120, help: 'Stability: the days early and late a new timepoint starts with (QA decision; 7 by default). Each timepoint can change it.' },
    { field: 'stability_reserve_pct', title: 'Stability reserve %', type: 'number', width: 120, help: 'Extra material asked for at placement, on top of every pull of the design' },
    { field: 'custody_signature_required', title: 'Signed receipt', type: 'bool', width: 110, help: 'Samples are logged only by "Receive and sign": the receiver signs the chain of custody with their password, and their handwritten signature goes in its Received area (0.29.0).' },
    { field: 'require_training', title: 'Training gate', type: 'bool', width: 110, help: 'Bench steps are signed only by people with a current qualification for the test (Training and competency). Grant the legacy qualifications first (0.31.0).' },
    { field: 'status', title: 'Status', type: 'select', width: 90, options: ['Active', 'Inactive'] },
  ], [tzs]);

  return <>
    <PageHeader title="Sites and holidays" audit={AUDIT}
      subtitle={'Admin. Each site has its own time zone (cutoff times are local) and holiday calendar (business-day turnaround skips these days). Only system administrators add or change labs (a new lab gets the standard groups); each lab\'s administrators keep its holidays. People get a lab by joining one of its groups (Admin, People and groups).'} />
    {error ? <Card body className="err">{error.message}</Card> : !rows ? <div className="loading">Loading…</div> : <>
      <Section title="Sites">
        <EditableGrid rows={rows} columns={columns} allowAdd={sysAdmin} readOnly={!sysAdmin} what="site settings" newRow={newSite} save={saveSites} afterSave={reload} />
      </Section>
      <Section title={cur ? `Holidays: ${cur.site_code}` : 'Holidays'} help="Paste a holiday list from Excel (date, description) or add rows.">
        <div className="tabs">{rows.map((s) => (
          <button key={s.id} type="button" className={`tab${cur && s.id === cur.id ? ' on' : ''}`} onClick={() => { window.location.hash = '#/admin/sites/' + s.id; }}>{s.site_code} <small>{s.holiday_count}</small></button>
        ))}</div>
        {cur && <Holidays key={cur.id} site={cur} onSaved={reload} />}
      </Section>
      {cur && <>
        <MediaCard key={cur.id} site={cur} />
        <ProductNameCard sysAdmin={sysAdmin} />
      </>}
    </>}
  </>;
}

function Holidays({ site, onSaved }) {
  const { data, error, reload } = useApi((opts) => listHolidays(site.id, opts), [site.id]);
  const save = useMemo(() => (rows, reason) => saveHolidays(site.id, rows, reason), [site.id]);
  if (error) return <div className="err">{error.message}</div>;
  if (!data) return <div className="loading">Loading…</div>;
  return <EditableGrid rows={data} columns={HOLIDAY_COLUMNS} allowAdd what={`holidays for ${site.site_code}`} newRow={newHoliday} save={save}
    afterSave={() => { reload(); onSaved(); }} />;
}
