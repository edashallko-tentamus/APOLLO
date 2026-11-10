// Admin > Lab setup > Report templates (migration 030): the layouts COAs are printed in. The designer picks one per test.
import { useMemo } from 'react';
import { listReportTemplates, saveReportTemplates } from '../../api/labsetup.js';
import EditableGrid from '../../components/EditableGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useApi } from '../../hooks/useApi.js';

const AUDIT = { kind: 'report_templates' };
const TITLE = 'CERTIFICATE OF ANALYSIS';
const yes = (v) => v === true || v === 'true';
const rowClass = (r) => (r.status === 'Inactive' ? 'mutedrow' : '');

export default function ReportTemplatesPage() {
  const { data: d, error, reload } = useApi(listReportTemplates, []);

  const view = useMemo(() => {
    if (!d) return null;
    const canAny = d.sysadmin || Object.values(d.can).some(Boolean);
    const mayEdit = (r) => (r.site_id ? d.can[r.site_id] : d.sysadmin);
    const ed = (r, isNew) => isNew || mayEdit(r);
    const rows = d.rows.map((r) => ({ ...r, lab: r.site_id || '', show_method: r.options.show_method !== false, show_test_version: r.options.show_test_version !== false,
      show_tested_dates: r.options.show_tested_dates !== false, show_loq: r.options.show_loq !== false, title: r.options.title || TITLE }));
    const labOpts = [{ value: '', label: 'Every lab' }, ...d.labs.map((l) => ({ value: l.id, label: l.site_code }))];
    const columns = [
      { field: 'template_code', title: 'Code', type: 'readonly', width: 75 },
      { field: 'template_name', title: 'Template', width: 240, required: true, editable: ed },
      { field: 'lab', title: 'Lab', type: 'select', options: labOpts, width: 100, editable: (r, isNew) => isNew },
      { field: 'layout', title: 'Layout', type: 'select', options: d.layouts, width: 130, editable: ed },
      { field: 'is_default', title: 'Default', type: 'bool', width: 70, editable: ed },
      { field: 'title', title: 'Title on the report', width: 210, editable: ed },
      { field: 'show_method', title: 'Method', type: 'bool', width: 70, editable: ed, help: 'Print each test\'s method and SOP' },
      { field: 'show_test_version', title: 'Version', type: 'bool', width: 70, editable: ed, help: 'Print the test version number' },
      { field: 'show_tested_dates', title: 'Dates tested', type: 'bool', width: 95, editable: ed },
      { field: 'show_loq', title: 'LOQ column', type: 'bool', width: 90, editable: ed },
      { field: 'description', title: 'Description', width: 260, editable: ed },
      { field: 'used_by', title: 'Test versions', type: 'readonly', width: 95 },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 90, editable: ed },
    ];
    const newRow = () => ({ status: 'Active', layout: 'Standard COA', lab: d.labs.find((l) => d.can[l.id])?.id || '', is_default: false, show_method: true, show_test_version: true, show_tested_dates: true, show_loq: true, title: TITLE });
    // every changed row goes whole (its options are one value), from the row as loaded plus the changes
    const save = (changed, reason) => saveReportTemplates(changed.map((r) => {
      const full = { ...rows.find((x) => x.id === r.id), ...r };
      const out = { id: r.id, template_name: full.template_name, description: full.description, layout: full.layout, is_default: yes(full.is_default), status: full.status,
        options: { show_method: yes(full.show_method), show_test_version: yes(full.show_test_version), show_tested_dates: yes(full.show_tested_dates), show_loq: yes(full.show_loq), title: full.title || TITLE } };
      if (!r.id) out.site_id = full.lab || null;
      return out;
    }), reason);
    return { canAny, rows, columns, newRow, save };
  }, [d]);

  return <>
    <PageHeader title="Report templates" audit={AUDIT}
      subtitle={'The layouts COAs are printed in. Each test picks its template in the Workflow Designer (tab 1, Reporting); a test without one uses its lab\'s default. When the tests on one sample use different templates, the COA is one PDF in parts, each test in its own template\'s part. Layouts: "Standard COA", and "COA with 1 photo" or "COA with 2 photos" (the sample\'s photos marked Report photo 1 and 2 at receipt, 4:3, under its details). Every COA carries a QR code of its verification link.'} />
    {error ? <div className="card err">{error.message}</div> : !view ? <div className="loading">Loading…</div> : (
      <Section title="Templates" help={`${view.canAny ? 'QA and lab administrators keep their lab\'s templates (reports.templates); templates for every lab are kept by system administrators.' : 'QA and lab administrators keep these (reports.templates).'} The default is the one tests use when they name none.`}>
        <EditableGrid rows={view.rows} columns={view.columns} allowAdd={view.canAny} readOnly={!view.canAny} what="the report templates"
          newRow={view.newRow} rowClass={rowClass} save={view.save} afterSave={reload} />
      </Section>
    )}
  </>;
}
