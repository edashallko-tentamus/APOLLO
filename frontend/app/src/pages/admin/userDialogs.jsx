// Dialogs of Admin > People and groups: temporary password, COA signature, sign-in history
import { useEffect } from 'react';
import { authEvents, saveUserSignature, setTempPassword, userSignatureUrl } from '../../api/admin.js';
import DataGrid from '../../components/grid/DataGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import { useApi } from '../../hooks/useApi.js';
import { Button, Card, Form } from 'react-bootstrap';
import { Dialog } from '../../components/Modal.jsx';

// A one-time password made in the browser, shown once to the administrator to pass on; the person must change it at sign-in
export function makeTempPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'; const num = '23456789'; const all = abc + num;
  const r = crypto.getRandomValues(new Uint32Array(12));
  const out = [...r].map((x) => all[x % all.length]);
  out[0] = abc[r[0] % abc.length]; out[5] = num[r[5] % num.length]; out[9] = num[r[9] % num.length];
  return out.join('');
}

export async function tempPassword(dialogs, toast, u) {
  if (!(await dialogs.confirm('Set temporary password', `Give ${u.full_name} (${u.username}) a new temporary password? Any password they have now stops working, they are signed out everywhere, and a locked account is unlocked.`, 'Set temporary password'))) return false;
  const pw = makeTempPassword();
  try { await setTempPassword(u.id, pw); } catch (e) { toast(e.message, 'err'); return false; }
  await dialogs.form({ title: 'Temporary password set', okText: 'Done',
    intro: `Give this password to ${u.full_name} in person or by phone (not by email). It works once: they must choose their own password when they sign in. It is not shown again.`,
    before: <div className="temppw"><span>User ID</span><b>{u.username}</b><span>Temporary password</span><b className="pwtext">{pw}</b></div> });
  return true;
}

const readBase64 = (file) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = no; r.readAsDataURL(file); });

// The handwritten signature (a PNG or JPEG scan, up to 1 MB) and title printed on the person's COAs; signed by the administrator
export async function signatureDialog(dialogs, toast, u, lab, siteId) {
  let file = null;
  let chosen = null;
  const v = await dialogs.form({ title: `COA signature: ${u.full_name}`, okText: 'Next: sign',
    intro: 'Scan or photograph the person\'s handwritten signature on white paper and crop it closely. It is printed above their name, title and the date on every COA they finalize. An electronic signature without it is not enough.',
    before: <>
      {u.has_signature
        ? <><p>On file:</p><img src={userSignatureUrl(u.id, siteId)} alt="Signature on file" style={{ maxWidth: 320, maxHeight: 110, border: '1px solid var(--line)', background: '#fff', padding: 4 }} /></>
        : <p className="help">No signature on file yet: this person cannot issue COAs.</p>}
      <div className="field"><label htmlFor="sigf">Signature image (PNG or JPEG, up to 1 MB){u.has_signature ? ': leave empty to keep the one on file' : ''}</label>
        <Form.Control type="file" id="sigf" accept="image/png,image/jpeg" onChange={(e) => { file = e.target.files[0] || null; }} /></div>
    </>,
    fields: [{ name: 'title', label: 'Title (printed under the name)', required: true, value: u.title || '', help: 'e.g. Project Manager, QA Manager' }],
    submit: async (vals) => {
      if (!file && !u.has_signature) throw new Error('Choose the signature image.');
      if (file && !/^image\/(png|jpeg)$/.test(file.type)) throw new Error('The signature must be a PNG or JPEG image.');
      if (file && file.size > 1048576) throw new Error('The image is larger than 1 MB: crop or shrink it.');
      chosen = { file, b64: file ? await readBase64(file) : '' };
      return vals;
    } });
  if (!v || !chosen) return false;
  const f = chosen.file;
  const done = await dialogs.sign({ what: `${u.full_name}: handwritten signature and title "${v.title}"${lab ? ' (' + lab.site_code + ')' : ''}`, meaning: 'Recorded by', needReason: !!u.has_signature,
    submit: ({ signature, reason }) => saveUserSignature(u.id, { signature, reason, title: v.title, b64: chosen.b64, mime_type: f ? f.type : '', file_name: f ? f.name : '' }) });
  if (done) toast('Signature recorded.');
  return !!done;
}

const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' }) : '');
const HISTORY_COLUMNS = [
  { field: 'at', title: 'When', type: 'readonly', width: 150, format: dt },
  { field: 'username', title: 'User ID', type: 'readonly', width: 120 }, { field: 'event', title: 'Event', type: 'readonly', width: 170 },
  { field: 'detail', title: 'Detail', type: 'readonly', width: 300 }, { field: 'by_name', title: 'Done by (administrator)', type: 'readonly', width: 170 },
];
const NO_ROWS = [];

export function SignInHistoryDialog({ onDone }) {
  const { data, error, loading } = useApi(authEvents, []);
  const rows = data || NO_ROWS;
  const grid = useGrid({ rows, columns: HISTORY_COLUMNS, readOnly: true });
  const { reset } = grid;
  useEffect(() => { reset(rows); }, [rows, reset]);
  return (
    <Dialog label="Sign-in history" xwide onClose={() => onDone()}>
      <div className="modal-body">
        <h3>Sign-in history</h3>
        <p className="intro">Every sign-in, failed attempt, lockout, sign-out, password change and failed signature, newest first (latest 300). Written by the system; it cannot be edited.</p>
        {error ? <Card body className="err">{error.message}</Card> : loading && !data ? <div className="loading">Loading…</div>
          : <DataGrid grid={grid} search emptyText="Nothing recorded yet." maxHeight="60vh" />}
        <div className="mbtns"><Button type="button" variant="primary" onClick={() => onDone()} autoFocus>Close</Button></div>
      </div>
    </Dialog>
  );
}
