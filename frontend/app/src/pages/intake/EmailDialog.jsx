// One email of the Outbox as the client would receive it (the current app's showEmail): await showEmail(dialogs, email, siteId)
import Modal from '../../components/Modal.jsx';
import { dateTime } from '../../lib/format.js';

function EmailDialog({ e, siteId, onDone }) {
  const s = encodeURIComponent(siteId || '');
  return (
    <Modal title={e.subject} okText="Close" wide onOk={() => onDone(true)} onClose={() => onDone(false)}>
      <div className="email">
        <div><b>To:</b> {e.to_name || ''} &lt;{e.to_address || ''}&gt;</div>
        <div><b>Status:</b> {e.delivery_status} · {dateTime(e.created_at)}</div>
        {e.coa_version_id && <div><b>Attachment:</b> <a href={`/api/reports/coa/${e.coa_version_id}/pdf?s=${s}`} target="_blank" rel="noopener noreferrer">the COA (PDF)</a></div>}
        {e.document_id && <div><b>Attachment:</b> <a href={e.project_version_id ? `/api/quotes/versions/${e.project_version_id}/pdf` : `/api/outbox/${e.id}/document?s=${s}`} target="_blank" rel="noopener noreferrer">
          {e.project_version_id ? 'the quotation (PDF)' : 'the investigation report (PDF)'}</a></div>}
        <pre>{e.body}</pre>
      </div>
    </Modal>
  );
}

export function showEmail(dialogs, e, siteId) {
  return dialogs.open((done) => <EmailDialog e={e} siteId={siteId} onDone={done} />);
}
