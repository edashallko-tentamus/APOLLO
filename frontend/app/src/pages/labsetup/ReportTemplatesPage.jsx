// Admin > Lab setup > Report templates (migration 074): the COA and invoice templates of the lab in the header (its own
// and the shared ones ticked for it), and, for system administrators, every shared template.
import { useMemo, useState } from 'react';
import { createReportTemplate, listReportTemplates } from '../../api/labsetup.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useApi } from '../../hooks/useApi.js';
import { Button, Card, Nav } from 'react-bootstrap';

const AUDIT = { kind: 'report_templates' };
const TYPES = ['COA', 'Invoice'];
const href = (r) => '#/admin/report-templates/' + r.id;
const vno = (n) => (n ? 'v' + n : '');

const LAB_COLUMNS = [
  { field: 'template_code', title: 'Code', type: 'link', width: 80, href },
  { field: 'template_name', title: 'Template', type: 'readonly', width: 240 },
  { field: 'owner', title: 'Kept by', type: 'readonly', width: 120, compute: (r) => (r.site_id ? 'This lab' : 'Shared') },
  { field: 'is_default', title: 'Default', type: 'readonly', width: 75, compute: (r) => (r.is_default ? 'Yes' : '') },
  { field: 'version_in_use', title: 'In use', type: 'readonly', width: 70, compute: (r) => vno(r.version_in_use) || 'None yet' },
  { field: 'draft_version', title: 'Draft', type: 'readonly', width: 70, compute: (r) => vno(r.draft_version) },
  { field: 'newer_shared_version', title: 'Newer version', type: 'readonly', width: 120, compute: (r) => (r.newer_shared_version ? `v${r.effective_version} to accept` : '') },
  { field: 'used_by', title: 'Tests using it', type: 'readonly', width: 105 },
  { field: 'status', title: 'Status', type: 'readonly', width: 85 },
];
const SHARED_COLUMNS = [
  { field: 'template_code', title: 'Code', type: 'link', width: 80, href },
  { field: 'template_name', title: 'Template', type: 'readonly', width: 240 },
  { field: 'document_type', title: 'Kind', type: 'readonly', width: 80 },
  { field: 'effective_version', title: 'Approved', type: 'readonly', width: 85, compute: (r) => vno(r.effective_version) || 'None yet' },
  { field: 'draft_version', title: 'Draft', type: 'readonly', width: 70, compute: (r) => vno(r.draft_version) },
  { field: 'labs', title: 'Labs that may use it', type: 'readonly', width: 220 },
  { field: 'status', title: 'Status', type: 'readonly', width: 85 },
];

export default function ReportTemplatesPage() {
  const dialogs = useDialogs();
  const [type, setType] = useState('COA');
  const { data: d, error } = useApi(listReportTemplates, []);
  const rows = useMemo(() => (d ? d.rows.filter((r) => r.document_type === type) : []), [d, type]);

  async function make(shared) {
    const v = await dialogs.form({ title: shared ? 'New shared template' : 'New template for this lab', okText: 'Make it',
      intro: 'It starts as a draft with the standard design. Change it, preview it, then ask for approval.',
      fields: [{ name: 'document_type', label: 'Kind', type: 'select', options: TYPES, value: type, blank: false, required: true },
        { name: 'template_name', label: 'Name', required: true }, { name: 'description', label: 'Description', type: 'textarea' }],
      submit: (x) => createReportTemplate({ ...x, shared }) });
    if (v) location.hash = href(v);
  }

  return <>
    <PageHeader title="Report templates" audit={AUDIT}
      subtitle="How this lab's COAs and invoices look. A template is drawn by the system from fixed blocks and settings, so every checked value stays visible. Each version is approved, signed, before it is used: QA or a General Manager for the lab's own templates, a system administrator for shared ones." />
    {error ? <Card body className="err">{error.message}</Card> : !d ? <div className="loading">Loading…</div> : <>
      <Nav variant="pills" className="mb-2">{TYPES.map((t) => <Nav.Link key={t} active={t === type} onClick={() => setType(t)}>{t === 'COA' ? 'COA templates' : 'Invoice templates'}</Nav.Link>)}</Nav>
      <Section title="This lab's templates"
        help="The lab's own templates and the shared templates a system administrator has made available here. Tests pick their COA template in the Workflow Designer; a test without one uses the default."
        actions={d.can_design && <Button size="sm" onClick={() => make(false)}>+ New template</Button>}>
        <ReadGrid rows={rows} columns={LAB_COLUMNS} search onRowOpen={(r) => { location.hash = href(r); }} />
      </Section>
      {d.sysadmin && (
        <Section title="Shared templates (system administrators)" help="Every shared template. Open one to change it, approve it, and tick the labs that may use it."
          actions={<Button size="sm" variant="outline-secondary" onClick={() => make(true)}>+ New shared template</Button>}>
          <ReadGrid rows={d.shared.filter((r) => r.document_type === type)} columns={SHARED_COLUMNS} search onRowOpen={(r) => { location.hash = href(r); }} />
        </Section>
      )}
    </>}
  </>;
}
