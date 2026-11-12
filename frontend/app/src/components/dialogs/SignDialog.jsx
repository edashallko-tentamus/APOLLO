// Reason for Change and/or electronic signature in one dialog (21 CFR Part 11).
// Reason: pick a canned reason (comment optional) or Other (typing required). Signature: the signer's own user ID and
// password; the meaning (e.g. "Approved by") is set by the action. submit({ reason, signature }) runs while the dialog
// is open: if it fails, its message shows (and the password is cleared) and the dialog stays open.
import { useMemo, useState } from 'react';
import { cannedReasons } from '../../api/reasons.js';
import { useApi } from '../../hooks/useApi.js';
import { moduleForPage } from '../../lib/moduleForPage.js';
import { useSession } from '../../session/SessionProvider.jsx';
import Modal from '../Modal.jsx';
import SmartSelect from '../SmartSelect.jsx';
import { Form } from 'react-bootstrap';

const OTHER = '__other__';

export default function SignDialog({ title, what = '', meaning = 'Changed by', needReason = true, sign = true, defaultReason = '',
  module, okText, submit, onDone }) {
  const { user } = useSession();
  const mod = module || moduleForPage();
  const { data: list = [] } = useApi(() => (needReason ? cannedReasons(mod).catch(() => []) : Promise.resolve([])), [mod, needReason]);
  const [pick, setPick] = useState(defaultReason ? OTHER : '');
  const [text, setText] = useState(defaultReason);
  const [username, setUsername] = useState(user?.username || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const options = useMemo(() => [{ value: '', label: '' }, ...list.map((r) => ({ value: r.reason_text, label: r.reason_text })),
    { value: OTHER, label: 'Other (type the reason below)' }], [list]);
  const textRequired = pick === OTHER || (!pick && text.trim());

  async function ok() {
    let reason = '';
    if (needReason) {
      const t = text.trim();
      if (pick && pick !== OTHER) reason = t ? `${pick}: ${t}` : pick;
      else if (t) reason = t;
      else return setError(pick === OTHER ? 'Type the reason (Other was chosen).' : 'Pick a reason, or choose Other and type it.');
    }
    let signature = null;
    if (sign) {
      if (!username.trim()) return setError('Enter your user ID.');
      if (!password) return setError('Enter your password to sign.');
      signature = { username: username.trim(), password };
    }
    if (!submit) return onDone({ reason, signature });
    setBusy(true); setError('');
    try { onDone((await submit({ reason, signature })) ?? true); }
    catch (e) { setBusy(false); setPassword(''); setError(e.message); }
  }

  const intro = sign
    ? <>{what && <>You are signing: <b>{what}</b>.<br /></>}Your signature means <b>{meaning}</b> and is stored with your name, the date and time{needReason ? ' and the reason' : ''}.</>
    : <>You are changing {what || 'these records'}. The reason is stored in the audit trail with your name and the time.</>;

  return (
    <Modal title={title || (sign ? 'Electronic signature' : 'Reason for Change')} intro={intro} okText={okText || (sign ? 'Sign' : 'Confirm')}
      error={error} busy={busy} onOk={ok} onClose={() => onDone(null)}>
      {needReason && <>
        <div className="field"><label htmlFor="f_rpick">Reason for change <span className="req">*</span></label>
          <SmartSelect id="f_rpick" value={pick} onChange={setPick} options={options} /></div>
        <div className="field"><label htmlFor="f_rtext">Comment {textRequired ? <span className="req">*</span> : <span className="rreq">(optional)</span>}</label>
          <Form.Control as="textarea" id="f_rtext" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="help">Pick a reason from the list, or choose Other and type it.</div></div>
      </>}
      {sign && <div className="sigbox">
        <div className="field"><label htmlFor="f_suser">User ID <span className="req">*</span></label>
          <Form.Control id="f_suser" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></div>
        <div className="field"><label htmlFor="f_spass">Password <span className="req">*</span></label>
          <Form.Control id="f_spass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      </div>}
    </Modal>
  );
}
