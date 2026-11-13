import { useState } from 'react';
import { changePassword } from '../api/auth.js';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/Toasts.jsx';
import { PASSWORD_RULE } from '../config.js';
import { Form } from 'react-bootstrap';

const FIELDS = [['current', 'Current password', 'current-password'], ['password', 'New password', 'new-password'], ['confirm', 'Type it again', 'new-password']];

export default function ChangePasswordDialog({ onClose }) {
  const toast = useToast();
  const [v, setV] = useState({ current: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    const missing = FIELDS.find(([k]) => !v[k]);
    if (missing) return setError(`${missing[1]} is required.`);
    setBusy(true); setError('');
    try { await changePassword(v.current, v.password, v.confirm); toast('Password changed.'); onClose(); }
    catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <Modal title="Change password" intro={PASSWORD_RULE} okText="Save new password" error={error} busy={busy} onOk={save} onClose={onClose}>
      {FIELDS.map(([k, label, ac]) => (
        <div className="field" key={k}>
          <label htmlFor={`f_${k}`}>{label} <span className="req">*</span></label>
          <Form.Control id={`f_${k}`} type="password" autoComplete={ac} value={v[k]} onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value }))} />
        </div>
      ))}
    </Modal>
  );
}
