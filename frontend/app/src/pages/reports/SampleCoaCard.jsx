// The COA card on the sample page (every version issued, notes, attachments), and "Add an attachment" (also used by the
// order page). Exported for the orders area:
//   <SampleCoaCard sampleId={id} />
//   await addAttachment(dialogs, toast, sampleId)  -> true when added
import { useMemo } from 'react';
import { addSampleAttachment, attachmentUrl, coaPdfUrl, sampleCoa, verifyUrl } from '../../api/reports.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { dt, startReview } from './shared.jsx';
import { Button } from 'react-bootstrap';

const NOTE_COLS = [
  { field: 'kind', title: 'Kind', type: 'readonly', width: 90, format: (v) => (v === 'Internal' ? 'Internal' : 'On the COA') },
  { field: 'on', title: 'On', type: 'readonly', width: 220, compute: (n) => (n.analyte ? `${n.test_name}: ${n.analyte}` : n.test_name || 'The sample') },
  { field: 'note_text', title: 'Note', type: 'readonly', width: 420 },
  { field: 'by_name', title: 'By', type: 'readonly', width: 150 },
  { field: 'created_at', title: 'When', type: 'readonly', width: 150, format: dt },
];
const KINDS = ['Sample submission form', 'Chain of custody', 'Client correspondence', 'Photo', 'Other'];

const toBase64 = (file) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = no; r.readAsDataURL(file); });

export async function addAttachment(dialogs, toast, sampleId) {
  const v = await dialogs.form({ title: 'Add an attachment', okText: 'Add',
    fields: [{ name: 'file', label: 'File', type: 'file' },
      { name: 'kind', label: 'Kind', type: 'select', blank: false, value: 'Sample submission form', options: KINDS },
      { name: 'label', label: 'Label' }, { name: 'whole_order', label: 'For', type: 'checkbox', cbLabel: 'The whole order (e.g. one submission form for every sample)', value: true }],
    submit: async (x) => {
      if (!x.file) throw new Error('Choose a file.');
      await addSampleAttachment(sampleId, { file_name: x.file.name, mime_type: x.file.type || 'application/octet-stream', b64: await toBase64(x.file), kind: x.kind, label: x.label, whole_order: x.whole_order });
      return x;
    } });
  if (!v) return false;
  toast('Attachment added.');
  return true;
}

export default function SampleCoaCard({ sampleId }) {
  const { site, can } = useSession();
  const dialogs = useDialogs();
  const toast = useToast();
  const siteId = site?.id;
  const { data: d, reload } = useApi(() => sampleCoa(sampleId), [sampleId]);
  const versionCols = useMemo(() => [
    { field: 'version_no', title: 'Report', type: 'link', width: 170, compute: (v) => (v.report_id ? `${v.report_id} (v${v.version_no})` : `${v.coa_code} v${v.version_no}`), href: (v) => coaPdfUrl(v.id, siteId) },
    { field: 'is_final', title: 'Final', type: 'readonly', width: 60, format: (v) => (v ? 'Yes' : '') },
    { field: 'issued_at', title: 'Issued', type: 'readonly', width: 150, format: dt },
    { field: 'issued_by_name', title: 'Finalized by', type: 'readonly', width: 160 },
    { field: 'group_code', title: 'Group', type: 'readonly', width: 90 },
    { field: 'verify_code', title: 'Verification code', type: 'link', width: 150, href: (v) => verifyUrl(v.verify_code) },
    { field: 'sha256', title: 'SHA-256', type: 'readonly', width: 230, format: (v) => (v ? v.slice(0, 24) + '…' : '') },
    { field: 'prev_sha256', title: 'Previous version\'s', type: 'readonly', width: 180, format: (v) => (v ? v.slice(0, 16) + '…' : '') },
  ], [siteId]);
  const attachCols = useMemo(() => [
    { field: 'file_name', title: 'File', type: 'link', width: 280, compute: (a) => a.label || a.file_name, href: (a) => attachmentUrl(a.id, siteId) },
    { field: 'kind', title: 'Kind', type: 'readonly', width: 170 },
    { field: 'scope', title: 'For', type: 'readonly', width: 110, compute: (a) => (a.sample_id ? 'This sample' : 'Whole order') },
    { field: 'added_by', title: 'Added by', type: 'readonly', width: 150 },
    { field: 'created_at', title: 'When', type: 'readonly', width: 150, format: dt },
  ], [siteId]);
  if (!d) return null; // loading, or not allowed: the card stays away, as in the current app

  function reissue() {
    const v = d.versions[0];
    startReview([{ sample_id: sampleId, sample_code: v.report_id ? v.report_id.replace(/-R\d+$/, '') : v.coa_code.replace(/^COA-/, ''), client_sample_id: '', tests: [], test_names: ['A new version (no new result)'] }]);
  }
  return <Section title="Certificate of Analysis"
    help="Every version issued for this sample, newest first. Versions are never changed or deleted; each PDF has its SHA-256 fingerprint and carries the previous version's, and its verification code lets anyone check a copy.">
    <ReadGrid rows={d.versions} columns={versionCols} emptyText="No COA issued yet (Result Finalization)." />
    <h3 className="rfsub">Notes</h3>
    <ReadGrid rows={d.notes} columns={NOTE_COLS} emptyText="No notes." />
    <h3 className="rfsub">Attachments</h3>
    <ReadGrid rows={d.attachments} columns={attachCols} emptyText="No attachments." />
    {d.can_attach && <p><Button type="button" variant="outline-secondary" onClick={async () => { if (await addAttachment(dialogs, toast, sampleId)) reload(); }}>Add an attachment…</Button></p>}
    {d.versions.length > 0 && can('reports.finalize') && <p className="help">A new version without a new result (a corrected note or client detail): <Button type="button" variant="outline-secondary" onClick={reissue}>Issue a new version…</Button></p>}
  </Section>;
}
