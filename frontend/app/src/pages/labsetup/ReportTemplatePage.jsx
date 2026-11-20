// #/admin/report-templates/:id: one report template (migration 074): its versions, the designer for its draft,
// preview, signed approval, copy to the lab, accepting a newer shared version, the lab's default, and (shared
// templates, system administrators) the labs that may use it.
import { useEffect, useMemo, useState } from 'react';
import {
  acceptTemplateVersion, approveTemplateVersion, copyReportTemplate, getReportTemplate, makeTemplateDefault, newTemplateDraft, renameReportTemplate,
  retireReportTemplate, saveTemplateDraft, setTemplateLabs, templatePreviewUrl,
} from '../../api/labsetup.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import EditableGrid from '../../components/EditableGrid.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import TemplateDesigner from './TemplateDesigner.jsx';
import { Button, Card, Form } from 'react-bootstrap';
import './labsetup.css';

const dt = (v) => (v ? new Date(v).toLocaleString() : '');
const LAB_COLUMNS = [
  { field: 'site_code', title: 'Lab', type: 'readonly', width: 70 },
  { field: 'site_name', title: 'Name', type: 'readonly', width: 240 },
  { field: 'available', title: 'May use it', type: 'bool', width: 95 },
  { field: 'accepted_version', title: 'Lab is on', type: 'readonly', width: 85, compute: (r) => (r.accepted_version ? 'v' + r.accepted_version : '') },
  { field: 'is_default', title: 'Lab default', type: 'readonly', width: 95, compute: (r) => (r.is_default ? 'Yes' : '') },
];

export default function ReportTemplatePage({ params: [id] }) {
  const { site } = useSession();
  const dialogs = useDialogs(); const toast = useToast();
  const { data: t, error, reload } = useApi((o) => getReportTemplate(id, o), [id]);
  const draft = t?.versions.find((v) => v.status === 'Draft');
  const inUse = t?.versions.find((v) => v.id === t.in_use_version_id);
  const [design, setDesign] = useState(null);
  const [note, setNote] = useState('');
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setDesign(draft ? draft.design : inUse?.design || null); setNote(draft?.change_note || ''); setDirty(false); }, [t]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = useMemo(() => [
    { field: 'version_no', title: 'Version', type: 'readonly', width: 75, compute: (r) => 'v' + r.version_no + (r.id === t?.in_use_version_id ? ' (in use here)' : '') },
    { field: 'status', title: 'Status', type: 'readonly', width: 95 },
    { field: 'change_note', title: 'What changed', type: 'readonly', width: 260 },
    { field: 'created_by_name', title: 'Started by', type: 'readonly', width: 140 },
    { field: 'approved_by_name', title: 'Approved by', type: 'readonly', width: 140 },
    { field: 'approved_at', title: 'Approved', type: 'readonly', width: 160, format: dt },
  ], [t]);

  if (error && !t) return <><PageHeader title="Report template" /><Card body className="err">{error.message}</Card></>;
  if (!t || !design) return <><PageHeader title="Report template" /><div className="loading">Loading…</div></>;

  const shared = !t.site_id;
  const editing = !!draft && t.can_design;
  const preview = (vid) => window.open(templatePreviewUrl(vid, site?.id), '_blank', 'noopener');
  const run = async (fn, msg) => { const x = await fn(); if (x) { toast(msg); reload(); } return x; };
  const sign = (what, fn) => dialogs.sign({ what, meaning: 'Approved by', submit: ({ reason, signature }) => fn(reason, signature) });

  async function saveDraft() { await saveTemplateDraft(draft.id, design, note); setDirty(false); toast('Draft saved.'); reload(); }
  async function previewDraft() { if (dirty) await saveDraft(); preview(draft.id); }

  const actions = <>
    {t.can_design && <Button size="sm" variant="outline-secondary" onClick={() => run(() => dialogs.form({ title: 'Rename', fields: [
      { name: 'template_name', label: 'Name', value: t.template_name, required: true }, { name: 'description', label: 'Description', type: 'textarea', value: t.description || '' }],
      submit: (v) => renameReportTemplate(id, v) }), 'Renamed.')}>Rename…</Button>}
    {t.can_copy && <Button size="sm" variant="outline-secondary" onClick={async () => {
      const x = await dialogs.form({ title: 'Copy to this lab', okText: 'Copy', intro: 'The copy is this lab\'s own template, starting as a draft from the version in use. Later changes to this one do not reach it.',
        fields: [{ name: 'template_name', label: 'Name of the copy', value: 'Copy of ' + t.template_name, required: true }], submit: (v) => copyReportTemplate(id, v) });
      if (x) location.hash = '#/admin/report-templates/' + x.id;
    }}>Copy to my lab…</Button>}
    {t.can_use && shared && t.at_lab && t.versions.some((v) => v.status === 'Effective' && v.id !== t.in_use_version_id) && (
      <Button size="sm" onClick={() => run(() => sign(`Use the newest approved version of ${t.template_code} at this lab`, acceptTemplateVersion.bind(null, id)), 'This lab now uses the newest version.')}>Use the new version…</Button>)}
    {t.can_use && t.status === 'Active' && t.in_use_version_id && !(shared ? t.at_lab?.is_default : t.is_default) && (
      <Button size="sm" variant="outline-secondary" onClick={() => run(async () => { const r = await dialogs.reason(`Make ${t.template_code} this lab's default ${t.document_type} template`); return r && makeTemplateDefault(id, r); }, 'Default changed.')}>Make the lab default…</Button>)}
    {t.can_approve && t.status === 'Active' && (
      <Button size="sm" variant="light" onClick={() => run(async () => { const r = await dialogs.reason(`Retire ${t.template_code}`); return r && retireReportTemplate(id, r); }, 'Retired.')}>Retire…</Button>)}
  </>;

  return <>
    <PageHeader title={`${t.template_code} ${t.template_name}`} audit={{ kind: 'report_templates' }} actions={actions}
      subtitle={`${t.document_type} template · ${shared ? 'Shared (kept by system administrators)' : 'This lab\'s own'}${t.status !== 'Active' ? ' · Retired' : ''}${t.description ? ' · ' + t.description : ''}`} />

    <Section title="Versions" help={shared ? 'A lab stays on the version it uses until someone there with approval rights moves it to a newer approved one.' : 'The approved (Effective) version is the one COAs and invoices print with.'}
      actions={<>
        {inUse && <Button size="sm" variant="outline-secondary" onClick={() => preview(inUse.id)}>Preview the version in use</Button>}
        {t.can_design && !draft && <Button size="sm" onClick={() => run(() => newTemplateDraft(id), 'New draft made from the approved version.')}>+ New draft</Button>}
      </>}>
      <ReadGrid rows={t.versions} columns={columns} />
    </Section>

    <Section title={draft ? `Design: draft v${draft.version_no}` : inUse ? `Design: v${inUse.version_no} (read only)` : 'Design'}
      help={editing ? 'Change the draft, preview it, then save. Someone who did not work on it approves it, signed.' : draft ? 'A draft is being prepared; only designers can change it.' : 'Make a new draft to change the design.'}
      actions={draft && <>
        <Button size="sm" variant="outline-secondary" onClick={previewDraft}>Preview</Button>
        {editing && <Button size="sm" disabled={!dirty} onClick={saveDraft}>Save draft</Button>}
        {t.can_approve && <Button size="sm" disabled={dirty} title={dirty ? 'Save the draft first' : ''}
          onClick={() => run(() => sign(`Approve ${t.template_code} v${draft.version_no}`, approveTemplateVersion.bind(null, draft.id)), 'Approved: this version is now Effective.')}>Approve…</Button>}
      </>}>
      {editing && <Form.Control size="sm" className="mb-2" placeholder="What changed in this version" value={note} onChange={(e) => { setNote(e.target.value); setDirty(true); }} />}
      <TemplateDesigner type={t.document_type} design={design} choices={t.choices} readOnly={!editing} onChange={(d) => { setDesign(d); setDirty(true); }} />
    </Section>

    {t.labs && (
      <Section title="Labs that may use it" help="Tick the labs that may use this shared template. A lab still using it (a test prints with it, or it is the lab's default) cannot be unticked.">
        <EditableGrid rows={t.labs} columns={LAB_COLUMNS} keyField="site_id" what="the labs for this template"
          save={(rows, reason) => setTemplateLabs(id, rows.map((r) => ({ site_id: r.site_id, available: r.available === true || r.available === 'true' })), reason)} afterSave={reload} />
      </Section>
    )}
  </>;
}
