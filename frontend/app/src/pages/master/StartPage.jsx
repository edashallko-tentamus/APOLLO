// The tiles page (#/start): counts of the main lists and things to try in the Sandbox
import { getStartCounts } from '../../api/master.js';
import PageHeader from '../../components/PageHeader.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { Card } from 'react-bootstrap';

function Tile({ n, label, href, warn }) {
  return <a className={`tile${warn ? ' warn' : ''}`} href={href}><b>{n}</b><span>{label}</span></a>;
}

export default function StartPage() {
  const { site } = useSession();
  const { data: d, error } = useApi(getStartCounts, []);
  const at = site ? ` (${site.site_code})` : '';
  return <>
    <PageHeader title="LIMS3 Sandbox" subtitle={`Clients, quotes, lab orders and samples. You are working in ${site ? `${site.site_code} (${site.site_name})` : 'no lab: ask an administrator to assign you'}.`} />
    {error ? <Card body className="err">{error.message}</Card> : !d ? <div className="loading">Loading…</div> : (
      <div className="tiles">
        <Tile n={d.open_orders} label={`Open lab orders${at}`} href="#/orders" />
        <Tile n={d.rush_pending} label={`Rush awaiting approval${at}`} href="#/intake" warn={d.rush_pending > 0} />
        <Tile n={d.clients} label="Clients" href="#/clients" />
        <Tile n={d.on_hold} label="Clients on hold" href="#/clients" warn={d.on_hold > 0} />
        <Tile n={d.contacts} label="Contacts" href="#/contacts" />
        <Tile n={d.tests} label="Tests in catalogue" href="#/catalog" />
        <Tile n={d.analytes} label="Active analytes" href="#/analytes" />
        <Tile n={d.projects} label="Projects" href="#/projects" />
        <Tile n={d.open_quotes} label="Quotes in draft" href="#/projects" />
        <Tile n={d.pricing_issues} label="Draft quote lines to check" href="#/projects" warn={d.pricing_issues > 0} />
        <Tile n={d.audit_entries} label="Audit trail entries" href="#/audit" />
      </div>
    )}
    <Card body className="guide">
      <h2>Things to try</h2>
      <ol>
        <li><b>Analytes:</b> select a few cells in a column and press <kbd>Ctrl</kbd>+<kbd>D</kbd> to fill down, or copy a block from Excel and paste it with <kbd>Ctrl</kbd>+<kbd>V</kbd>. Type a wrong CAS number and watch it get rejected.</li>
        <li><b>Test catalogue:</b> open &quot;Heavy Metals Panel&quot;, switch pricing modes, change analyte prices with fill down, and watch the list price update.</li>
        <li><b>Projects and quotes:</b> open the Acme Irvine project, start a new version, untick analytes on the metals line and see the price drop while the discount % stays the same. Then quote it and accept it.</li>
        <li><b>Clients:</b> put a client On Hold and see that it can still order but cannot release reports.</li>
        <li><b>Lab orders:</b> open LO-000001. Each sample&apos;s tests are listed under it (▾ hides them). Tick the strawberry sample and log it: it gets a CFL yymmdd ### ID such as CFL261012004 and due dates. Pick a rush tier in a test&apos;s Rush tier cell (type to search), or type a new number in its TAT cell to override the turnaround.</li>
        <li><b>Smart dropdowns:</b> in any pick list, type a few letters to jump to the closest match, or press the Down arrow (Enter in a grid cell) and use the arrow keys.</li>
        <li><b>Links:</b> every ID (order, sample, client, quote, test) is a link to its record. Copy it to share with a colleague.</li>
        <li><b>Intake dashboard:</b> approve the Same Day rush, or click &quot;Not accepted&quot;, pick a slower tier and a reason, then read the automatic email in the Outbox.</li>
        <li><b>Audit trail:</b> the small clock icon next to a page title shows what changed on that page, who changed it and why. The Audit trail page shows everything.</li>
        <li><b>Labs:</b> the lab icon at the top right switches lab (CFL or TPS); you only see orders for your labs. Administrators assign labs under Admin, Users and lab access, and keep the Matrix list under Admin, Matrices.</li>
      </ol>
      <p className="help">Everyone signs in with their own user ID and password (Sign out is at the top right). Inventory changes ask for an electronic signature: your user ID and password again, with a reason picked from the canned list or typed. Administrators give each person a temporary password under Admin, Users and lab access. This is a sandbox with fictional demo data.</p>
    </Card>
  </>;
}
