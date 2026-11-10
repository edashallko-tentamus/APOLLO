// The email templates (the Outbox's Templates tab). Exported for the intake area: <OutboxTemplates />
import { useMemo } from 'react';
import { emailTemplates, saveEmailTemplates } from '../../api/reports.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import EditableGrid from '../../components/EditableGrid.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { Failed, Loading } from './shared.jsx';

export default function OutboxTemplates() {
  const { data: d, error, reload } = useApi(() => emailTemplates(), []);
  const dialogs = useDialogs();
  const toast = useToast();
  const canEdit = !!d?.can_edit;
  const columns = useMemo(() => {
    async function wording(r) {
      const v = await dialogs.form({ title: r.template_name, wide: true, okText: canEdit ? 'Save' : 'Close', intro: `Filled in by the system: ${r.placeholders || 'nothing'}`,
        fields: [{ name: 'body', label: 'Wording', type: 'textarea', value: r.body, required: true }] });
      if (!v || !canEdit || v.body === r.body) return;
      const reason = await dialogs.reason('the template wording'); if (reason === null) return;
      try { await saveEmailTemplates([{ id: r.id, body: v.body }], reason); toast('Template saved.'); reload(); } catch (e) { toast(e.message, 'err'); }
    }
    return [
      { field: 'template_name', title: 'Template', width: 260, required: true },
      { field: 'template_code', title: 'Sent for', type: 'readonly', width: 160 },
      { field: 'subject', title: 'Subject', width: 420, required: true },
      { field: 'is_active', title: 'Active', type: 'bool', width: 70 },
      { field: 'body', title: 'Wording', type: 'button', width: 110, label: () => (canEdit ? 'Wording…' : 'Read…'), onClick: wording },
    ];
  }, [canEdit, dialogs, toast, reload]);
  if (error && !d) return <Failed error={error} />;
  if (!d) return <Loading />;
  return <div className="card">
    <p className="help">Every automatic email is sent from one of these templates. Words in {'{{double braces}}'} are filled in by the system (the list is under each template). {canEdit ? 'Edit the name, subject or active tick here; "Wording…" edits the body.' : 'QA and administrators edit them (outbox.templates).'}</p>
    <EditableGrid rows={d.rows} columns={columns} readOnly={!canEdit} what="the email templates" save={saveEmailTemplates} afterSave={reload} />
  </div>;
}
