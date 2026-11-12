// /quote-response.html?t=TOKEN: the link in the quotation email (migration 029). The client reads the quotation and
// accepts or declines it, without signing in. Accepting lets them submit samples against it at the prices shown.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './quote.css';

const money = (v) => '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const token = new URLSearchParams(location.search).get('t') || '';
const url = '/api/public/quote/' + encodeURIComponent(token);

function Answer({ d }) {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState(null); // { decision, quote_code }
  if (d.status === 'Accepted') return <><p className="ok">This quotation was accepted{d.response_name ? ' by ' + d.response_name : ''}.</p><p className="muted">You can submit samples against it. Thank you.</p></>;
  if (d.status === 'Rejected') return <p>This quotation was declined. If you would like a new one, please contact the laboratory.</p>;
  if (d.status !== 'Quoted') return <p>This quotation is {String(d.status).toLowerCase()} and can no longer be answered online. Please contact the laboratory.</p>;
  if (d.expired) return <><p className="bad">This quotation expired on {d.valid_until_text}.</p><p className="muted">Please contact the laboratory for a new one.</p></>;
  if (done) return done.decision === 'Accept'
    ? <><p className="ok">Thank you: quotation {done.quote_code} is accepted.</p><p className="muted">The laboratory has been told. You can now submit samples against this quotation at the prices shown.</p></>
    : <><p>Thank you for letting us know. Quotation {done.quote_code} is declined.</p><p className="muted">If anything changes, please contact the laboratory.</p></>;
  const send = async (decision) => {
    if (!name.trim()) { setMsg('Type your name first.'); return; }
    setBusy(true); setMsg('');
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, name: name.trim(), note }) });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error || 'Your answer could not be sent');
      setDone({ decision, quote_code: r.quote_code });
    } catch (e) { setMsg(e.message); setBusy(false); }
  };
  return <>
    <p><b>Would you like to accept this quotation?</b></p>
    <label className="f" htmlFor="nm">Your name</label><input type="text" id="nm" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
    <label className="f" htmlFor="nt">Comments or purchase order number (optional)</label><textarea id="nt" rows="3" value={note} onChange={(e) => setNote(e.target.value)} />
    <div className="btns"><button id="yes" disabled={busy} onClick={() => send('Accept')}>Accept the quotation</button><button id="no" className="no" disabled={busy} onClick={() => send('Decline')}>Decline</button></div>
    <p id="msg" className="bad">{msg}</p>
  </>;
}

function QuotePage() {
  const [d, setD] = useState(null);
  useEffect(() => { fetch(url).then((r) => r.json()).catch(() => ({ found: false })).then(setD); }, []);
  if (!d) return <main><div className="card" id="q"><h1>Your quotation</h1><p className="muted">Loading…</p></div></main>;
  if (!d.found) return <main><div className="card" id="q"><h1>Your quotation</h1><p className="bad">This link is not valid.</p><p className="muted">Please contact the laboratory directly.</p></div></main>;
  const many = new Set(d.lines.map((l) => l.lab)).size > 1;
  return <main>
    <div className="card" id="q">
      <h1>Quotation {d.quote_code}</h1>
      <p className="muted">For {d.client_name}{d.contact ? ' · attention ' + d.contact : ''} · prepared by {d.prepared_by || ''} · version {d.version_no}{d.valid_until_text ? ' · valid until ' + d.valid_until_text : ''}</p>
      <div className="wrap"><table>
        <thead><tr><th>Test</th>{many && <th>Laboratory</th>}<th className="n">Qty</th><th className="n">List price</th><th className="n">Your price</th><th className="n">Total</th><th>Turnaround</th></tr></thead>
        <tbody>{d.lines.map((l, i) => <tr key={i}>
          <td><b>{l.test_name}</b>{l.analytes && <div className="muted">{l.analytes}</div>}</td>{many && <td>{l.lab}</td>}
          <td className="n">{l.quantity}</td><td className="n">{money(l.list_price)}</td><td className="n">{money(l.final_price)}</td><td className="n">{money(l.line_total)}</td><td>{l.tat}</td>
        </tr>)}</tbody>
      </table></div>
      <div className="tot">Total {money(d.total)}</div>
      {d.notes && <p className="muted">{d.notes}</p>}
      <p className="muted"><a href={url + '/pdf'} target="_blank" rel="noopener">Download the quotation (PDF)</a></p>
    </div>
    <div className="card" id="act"><Answer d={d} /></div>
  </main>;
}

createRoot(document.getElementById('root')).render(<StrictMode><QuotePage /></StrictMode>);
