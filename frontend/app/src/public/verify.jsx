// /verify.html?c=CODE: anyone can check a Certificate of Analysis by its verification code (no sign-in).
// The PDF is fingerprinted in the browser: it never leaves the person's computer.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import 'bootstrap/dist/css/bootstrap.min.css';
import './verify.css';
import { Button, Card, Form } from 'react-bootstrap';

async function sha256(file) {
  const h = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function Result({ r }) {
  const [file, setFile] = useState(null); // { hash } of the PDF the person gave
  const take = async (f) => { if (f) setFile({ hash: await sha256(f) }); };
  if (r === 'checking') return <p className="muted">Checking…</p>;
  if (r === 'error') return <p className="res bad">The check could not be made. Try again later.</p>;
  if (!r.found) return <><p className="res bad">No certificate has this verification code.</p><p className="muted">Check the code, or contact the laboratory.</p></>;
  return <>
    <p className={`res ${r.superseded ? 'warn' : 'ok'}`}>{r.superseded ? 'Issued, and since replaced by a later version' : 'Issued by the laboratory, and the current version'}</p>
    <dl>
      <dt>Laboratory</dt><dd>{r.site_name}</dd>
      <dt>Certificate</dt><dd>{r.coa_code}, version {r.version_no}{r.is_final ? '' : ' (tests still in progress at the time)'}</dd>
      <dt>Issued</dt><dd>{new Date(r.issued_at).toLocaleString()}</dd>
      {r.superseded && <><dt>Latest version</dt><dd>{r.latest_version} (ask the laboratory for it)</dd></>}
      <dt>Fingerprint (SHA-256)</dt><dd><code>{r.sha256}</code></dd>
    </dl>
    <div className="drop" id="drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); take(e.dataTransfer.files[0]); }}>
      Drop your PDF here, or <label style={{ textDecoration: 'underline', cursor: 'pointer' }}>choose it<Form.Control type="file" id="file" accept="application/pdf" hidden onChange={(e) => take(e.target.files[0])} /></label>, to check it is this certificate, unchanged.
    </div>
    <p id="fileres">{file && (file.hash === r.sha256
      ? <span className="res ok">Your PDF is this certificate, unchanged.</span>
      : <><span className="res bad">Your PDF is not this certificate as issued (it was changed, or it is another version).</span><br /><span className="muted">Its fingerprint: <code>{file.hash}</code></span></>)}</p>
  </>;
}

function VerifyPage() {
  const first = new URLSearchParams(location.search).get('c') || '';
  const [code, setCode] = useState(first);
  const [r, setR] = useState(null);
  const check = async (c) => {
    setR('checking');
    try { setR(await (await fetch('/api/public/coa/' + encodeURIComponent(c.trim()))).json()); } catch (_) { setR('error'); }
  };
  useEffect(() => { if (first) check(first); }, [first]);
  return <main>
    <Card body>
      <h1>Verify a Certificate of Analysis</h1>
      <p className="muted">Enter the verification code printed at the bottom of the certificate. You will see when the lab issued that version and its fingerprint; you can then check your PDF against it. The PDF never leaves your computer.</p>
      <form id="f" onSubmit={(e) => { e.preventDefault(); if (code.trim()) check(code); }}>
        <Form.Control type="text" id="code" placeholder="XXXX-XXXX-XXXX" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} /><Button variant="primary" type="submit">Check</Button>
      </form>
    </Card>
    {/* a new check starts afresh: no PDF result from the last one */}
    {r && <Card body id="out"><Result key={typeof r === 'object' ? r.sha256 : r} r={r} /></Card>}
  </main>;
}

createRoot(document.getElementById('root')).render(<StrictMode><VerifyPage /></StrictMode>);
