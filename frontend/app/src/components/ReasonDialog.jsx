// Reason for Change (21 CFR Part 11 audit trail): pick a canned reason (comment optional) or Other (typing required).
// onSubmit(reason) runs while the dialog is open: if it fails, its message shows and the dialog stays open.
// shortcut: no electronic signature fields yet; add them here (user ID + password) before a signed list moves.
import { useMemo, useState } from 'react';
import { cannedReasons } from '../api/reasons.js';
import { useApi } from '../hooks/useApi.js';
import Modal from './Modal.jsx';
import SmartSelect from './SmartSelect.jsx';

const OTHER = '__other__';

export default function ReasonDialog({ what, module, onSubmit, onClose }) {
  const { data: list = [] } = useApi(() => cannedReasons(module).catch(() => []), [module]);
  const [pick, setPick] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const textRequired = pick === OTHER || (!pick && text.trim());
  const options = useMemo(() => [{ value: '', label: '' }, ...list.map((r) => ({ value: r.reason_text, label: r.reason_text })),
    { value: OTHER, label: 'Other (type the reason below)' }], [list]);

  async function submit() {
    const t = text.trim();
    let reason;
    if (pick && pick !== OTHER) reason = t ? `${pick}: ${t}` : pick;
    else if (t) reason = t;
    else return setError(pick === OTHER ? 'Type the reason (Other was chosen).' : 'Pick a reason, or choose Other and type it.');
    setBusy(true); setError('');
    try { await onSubmit(reason); } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <Modal title="Reason for Change" okText="Confirm" error={error} busy={busy} onOk={submit} onClose={onClose}
      intro={`You are changing ${what}. The reason is stored in the audit trail with your name and the time.`}>
      <div className="field"><label htmlFor="f_rpick">Reason for change <span className="req">*</span></label>
        <SmartSelect id="f_rpick" value={pick} onChange={setPick} options={options} /></div>
      <div className="field"><label htmlFor="f_rtext">Comment {textRequired ? <span className="req">*</span> : <span className="rreq">(optional)</span>}</label>
        <textarea id="f_rtext" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="help">Pick a reason from the list, or choose Other and type it.</div></div>
    </Modal>
  );
}
