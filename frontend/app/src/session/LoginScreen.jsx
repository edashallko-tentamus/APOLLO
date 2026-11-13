// Sign in, first-time administrator setup, or choosing a new password (temporary password set by an administrator)
import { useState } from 'react';
import { changePassword, login, setupAdmin } from '../api/auth.js';
import { PASSWORD_RULE } from '../config.js';
import SmartSelect from '../components/SmartSelect.jsx';
import Brand from '../shell/Brand.jsx';
import { Button } from 'react-bootstrap';

const TITLES = { login: 'Sign in', setup: 'First-time setup', change: 'Choose a new password' };
const BUTTONS = { login: 'Sign in', setup: 'Set password and sign in', change: 'Save new password' };

function Field({ id, label, ...input }) {
  return <div className="field"><label htmlFor={id}>{label}</label><input id={id} {...input} /></div>;
}

export default function LoginScreen({ mode, message, username = '', setupUsers = [], productName, onDone }) {
  const [form, setForm] = useState({ username: username || setupUsers[0]?.username || '', password: '', confirm: '', current: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (busy) return; // one submission at a time
    setBusy(true); setError('');
    try {
      if (mode === 'setup') await setupAdmin(form.username, form.password, form.confirm);
      else if (mode === 'change') await changePassword(form.current, form.password, form.confirm);
      else await login(form.username.trim(), form.password);
      await onDone();
    } catch (err) {
      setError(err.message); setForm((f) => ({ ...f, password: '' }));
    } finally { setBusy(false); }
  }

  return (
    <div className="login-bg" id="loginScreen">
      <form className="login" noValidate onSubmit={submit}>
        <Brand productName={productName} />
        <h3>{TITLES[mode]}</h3>
        {mode === 'setup' && <>
          <p className="intro">No administrator has a password yet. Choose your administrator account and set your own password. Nobody else will see it; it is stored only as a one-way hash.</p>
          <div className="field"><label htmlFor="lg_user">Administrator account</label>
            <SmartSelect id="lg_user" value={form.username} onChange={(v) => setForm((f) => ({ ...f, username: v }))}
              options={setupUsers.map((u) => ({ value: u.username, label: `${u.full_name} (${u.username})` }))} /></div>
        </>}
        {mode === 'change' && <>
          <p className="intro">{message || 'Your password is temporary. Choose your own before continuing.'}</p>
          <Field id="lg_cur" label="Current (temporary) password" type="password" autoComplete="current-password" value={form.current} onChange={set('current')} autoFocus />
        </>}
        {mode === 'login' && <>
          {message && <p className="intro">{message}</p>}
          <Field id="lg_user" label="User ID" autoComplete="username" value={form.username} onChange={set('username')} autoFocus={!username} />
        </>}
        <Field id="lg_pass" label={mode === 'login' ? 'Password' : 'New password'} type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={form.password} onChange={set('password')} autoFocus={mode === 'login' && !!username} />
        {mode !== 'login' && <Field id="lg_conf" label="Type it again" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />}
        <div className="help">{mode === 'login' ? 'Forgotten your password, or locked out? Ask an administrator for a temporary password.' : PASSWORD_RULE}</div>
        <div className="merr" role="alert">{error}</div>
        <Button variant="primary" type="submit" className="w-100 mt-2" disabled={busy}>{BUTTONS[mode]}</Button>
      </form>
    </div>
  );
}
