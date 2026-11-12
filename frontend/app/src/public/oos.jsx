// /oos-response.html?t=TOKEN&a=retest: the link in the "Out of specification result" email (R-2). The client tells the
// lab what they want done. No sign-in; the link is valid for 90 days from the email. Each answer waits on the OOS record.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './oos.css';

const q = new URLSearchParams(location.search);
const url = '/api/public/oos/' + encodeURIComponent(q.get('t') || '');
const PRE = { retest: 'Retest', duplicate: 'Retest in duplicate', new: 'Test a new sample', retain: 'Hold the retained sample', call: 'Call with QA', ack: 'Acknowledge' };
const CHOICES = [
  ['Retest', 'Phase II re-testing: retest the sample', 'The lab prepares the retained sample again and tests it once.'],
  ['Retest in duplicate', 'Phase II re-testing in duplicate', 'Two new preparations from the retained sample.'],
  ['Test a new sample', 'Test a new sample', 'You send a new sample of the lot; the lab will tell you how to submit it.'],
  ['Hold the retained sample', 'Hold the retained sample', 'Keep the retained sample while you decide.'],
  ['Return the retained sample', 'Return the retained sample', 'Send the retained sample back to you.'],
  ['Call with QA', 'Arrange a call with the lab\'s Quality team', 'Talk the result through before deciding.'],
  ['Acknowledge', 'Acknowledge the result', 'No further testing is needed.'],
];

function Form() {
  const [choice, setChoice] = useState(PRE[q.get('a')] || '');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [sent, setSent] = useState(null); // the OOS code
  if (sent) return <><p className="ok">Thank you. Your answer ("{choice}") was sent to the laboratory.</p><p className="muted">The lab will contact you about the next steps. Reference: {sent}.</p></>;
  const go = async () => {
    if (!choice) { setMsg('Choose one of the options first.'); return; }
    setBusy(true); setMsg('');
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ choice, name, note }) });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error || 'The answer could not be sent');
      setSent(r.oos_code);
    } catch (e) { setMsg(e.message); setBusy(false); }
  };
  return <>
    <p>Would you like the laboratory to conduct Phase II re-testing of this sample, or something else? Choose one:</p>
    {CHOICES.map(([v, t, h]) => <label className="opt" key={v}><input type="radio" name="c" value={v} checked={v === choice} onChange={() => setChoice(v)} /> <b>{t}</b><span>{h}</span></label>)}
    <label className="f" htmlFor="nm">Your name</label><input type="text" id="nm" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
    <label className="f" htmlFor="nt">Anything the lab should know (optional)</label><textarea id="nt" rows="3" value={note} onChange={(e) => setNote(e.target.value)} />
    <button id="go" disabled={busy} onClick={go}>Send my answer</button><p id="msg" className="bad">{msg}</p>
  </>;
}

function OosPage() {
  const [d, setD] = useState(null);
  useEffect(() => { fetch(url).then((r) => r.json()).catch(() => ({ found: false })).then(setD); }, []);
  if (!d) return <main><div className="card" id="top"><h1>Out of specification result</h1><p className="muted">Loading…</p></div></main>;
  if (!d.found) return <main><div className="card" id="top"><h1>Out of specification result</h1><p className="bad">This link is not valid any more.</p><p className="muted">Please contact the laboratory directly.</p></div></main>;
  return <main>
    <div className="card" id="top">
      <h1>Out of specification result</h1><p className="muted">{d.site_name} · {d.oos_code}</p>
      <dl>
        <dt>Your sample</dt><dd>{d.client_sample_id || d.sample_code} ({d.sample_code})</dd><dt>Test</dt><dd>{d.test_name}</dd>
        <dt>Analyte</dt><dd>{d.analyte_name}</dd><dt>Result</dt><dd><b>{[d.reported, d.unit].filter(Boolean).join(' ')}</b></dd><dt>Specification</dt><dd>{d.spec_text || ''}</dd>
      </dl>
      {d.answers.length > 0 && <p className="muted" style={{ marginTop: 12 }}>Answers already received: {d.answers.map((a) => `${a.choice} (${new Date(a.received_at).toLocaleString()})`).join('; ')}</p>}
    </div>
    <div className="card" id="form"><Form /></div>
  </main>;
}

createRoot(document.getElementById('root')).render(<StrictMode><OosPage /></StrictMode>);
