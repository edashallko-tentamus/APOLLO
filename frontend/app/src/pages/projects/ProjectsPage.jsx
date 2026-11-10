// Pricing > Projects: reusable, client-specific quoted test packages, one page at a time (0.35.0), newest first
import { listProjects } from '../../api/projects.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import PagedList from '../../components/PagedList.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { openNewProject } from './newProject.js';

const FILTERS = [['all', 'All'], ['open', 'Open'], ['accepted', 'Accepted'], ['closed', 'Closed']];
const openQuote = (r) => { window.location.hash = '#/quote/' + r.latest_version_id; };
const COLUMNS = [
  { field: 'project_code', title: 'Code', type: 'link', width: 100, href: (r) => '#/projects/' + r.id },
  { field: 'project_name', title: 'Project', type: 'readonly', width: 260 },
  { field: 'client_name', title: 'Client', type: 'link', width: 170, href: (r) => '#/clients/' + r.client_id },
  { field: 'latest_version', title: 'Version', type: 'link', width: 70, href: (r) => (r.latest_version_id ? '#/quote/' + r.latest_version_id : null) },
  { field: 'latest_status', title: 'Status', type: 'readonly', width: 150 },
  { field: 'line_count', title: 'Tests', type: 'readonly', width: 60 },
  { field: 'is_list_price_acceptance', title: 'List price only', type: 'readonly', width: 110, format: (v) => (v ? 'Yes' : '') },
  { field: 'available_to_child_clients', title: 'Shared to sites', type: 'readonly', width: 115, format: (v) => (v ? 'Yes' : '') },
  { field: 'latest_version_id', title: '', type: 'button', width: 110, label: 'Open quote', onClick: openQuote },
];
const AUDIT = { kind: 'projects' };

export default function ProjectsPage({ query }) {
  const dialogs = useDialogs(); const toast = useToast();
  return <>
    <PageHeader title="Projects" audit={AUDIT}
      subtitle="A project is a reusable, client-specific quoted list of tests for a product or a recurring testing bundle. Each re-quote is a new version; orders keep the terms of the version they used. One-off customer requests are Quotes."
      actions={<><button type="button" className="btn primary" onClick={() => openNewProject(dialogs, toast)}>+ New project</button> <a className="btn ghost" href="#/quotes">Quotes</a></>} />
    <PagedList load={listProjects} query={query} filters={FILTERS} placeholder="Search by code, project or client; type a project code and press Enter to open it"
      open={(r) => { window.location.hash = '#/projects/' + r.id; }}>
      {(rows) => <ReadGrid rows={rows} columns={COLUMNS} emptyText="No projects here." onRowOpen={openQuote} />}
    </PagedList>
  </>;
}
