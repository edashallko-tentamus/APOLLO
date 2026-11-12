// A project: its quote versions, Edit project, Start new version (re-quote)
import { useMemo } from 'react';
import { getProject, newProjectVersion, updateProject } from '../../api/projects.js';
import Badge from '../../components/Badge.jsx';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { Button, Card } from 'react-bootstrap';

const dateOf = (v) => (v ? new Date(v).toLocaleDateString() : '');
const openVersion = (r) => { window.location.hash = '#/quote/' + r.id; };

export default function ProjectPage({ params }) {
  const id = params[0];
  const { data: d, error, reload } = useApi((o) => getProject(id, o), [id]);
  const dialogs = useDialogs(); const toast = useToast();
  const p = d?.project;
  const columns = useMemo(() => [
    { field: 'version_no', title: 'Version', type: 'link', width: 110, compute: (r) => `${p?.project_code} v${r.version_no}`, href: (r) => '#/quote/' + r.id },
    { field: 'status', title: 'Status', type: 'readonly', width: 150 },
    { field: 'total', title: 'Quote total', type: 'money', width: 120 },
    { field: 'quoted_at', title: 'Quoted', type: 'readonly', width: 160, format: dateOf },
    { field: 'valid_until', title: 'Valid until', type: 'readonly', width: 110 },
    { field: 'accepted_by', title: 'Accepted by', type: 'readonly', width: 150 },
    { field: 'accepted_at', title: 'Accepted', type: 'readonly', width: 120, format: dateOf },
  ], [p?.project_code]);

  if (error && !d) return <Card body className="err">{error.message}</Card>;
  if (!d) return <div className="loading">Loading…</div>;

  async function newVersion() {
    try { const r = await newProjectVersion(id); window.location.hash = '#/quote/' + r.id; } catch (e) { toast(e.message, 'err'); }
  }
  async function edit() {
    const v = await dialogs.form({ title: 'Edit project', fields: [
      { name: 'project_name', label: 'Project name', required: true, value: p.project_name }, { name: 'purpose', label: 'Purpose', value: p.purpose },
      { name: 'available_to_child_clients', label: 'Sharing', type: 'checkbox', value: p.available_to_child_clients, cbLabel: 'Child clients (sites) may order under this project' },
      { name: 'status', label: 'Status', type: 'select', blank: false, value: p.status, options: ['Active', 'Inactive'] }],
    submit: (row) => updateProject(id, row) });
    if (v) reload();
  }

  return <>
    <PageHeader title={p.project_name} audit={{ kind: 'project', id }}
      subtitle={<><a href={`#/projects/${p.id}`}>{p.project_code}</a> · <a href={`#/clients/${p.client_id}`}>{p.client_name}</a> {p.is_list_price_acceptance && <Badge status="List price acceptance" />}</>}
      actions={<><Button variant="light" href="#/projects">All projects</Button> <Button type="button" variant="outline-secondary" onClick={edit}>Edit project</Button> <Button type="button" variant="primary" onClick={newVersion}>Start new version (re-quote)</Button></>} />
    <Section title="Versions" help="Re-pricing or changing tests creates a new version, copied from the latest. Accepting it supersedes the previous accepted version.">
      <ReadGrid rows={d.versions} columns={columns} onRowOpen={openVersion} />
    </Section>
  </>;
}
