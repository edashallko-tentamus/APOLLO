// Moved out of verify.html in 0.32.0 so the page can run under a Content-Security-Policy without inline scripts.
const out = document.getElementById('out'); const codeEl = document.getElementById('code');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let current = null;
async function check(code) {
  out.hidden = false; out.innerHTML = '<p class="muted">Checking…</p>';
  try {
    const r = await (await fetch('/api/public/coa/' + encodeURIComponent(code.trim()))).json();
    if (!r.found) { current = null; out.innerHTML = '<p class="res bad">No certificate has this verification code.</p><p class="muted">Check the code, or contact the laboratory.</p>'; return; }
    current = r;
    out.innerHTML = `<p class="res ${r.superseded ? 'warn' : 'ok'}">${r.superseded ? 'Issued, and since replaced by a later version' : 'Issued by the laboratory, and the current version'}</p>
      <dl><dt>Laboratory</dt><dd>${esc(r.site_name)}</dd><dt>Certificate</dt><dd>${esc(r.coa_code)}, version ${r.version_no}${r.is_final ? '' : ' (tests still in progress at the time)'}</dd>
      <dt>Issued</dt><dd>${esc(new Date(r.issued_at).toLocaleString())}</dd>${r.superseded ? `<dt>Latest version</dt><dd>${r.latest_version} (ask the laboratory for it)</dd>` : ''}
      <dt>Fingerprint (SHA-256)</dt><dd><code>${esc(r.sha256)}</code></dd></dl>
      <div class="drop" id="drop">Drop your PDF here, or <label style="text-decoration:underline;cursor:pointer">choose it<input type="file" id="file" accept="application/pdf" hidden></label>, to check it is this certificate, unchanged.</div><p id="fileres"></p>`;
    const take = async (file) => {
      const buf = await file.arrayBuffer(); const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf))).map((b) => b.toString(16).padStart(2, '0')).join('');
      document.getElementById('fileres').innerHTML = h === current.sha256 ? '<span class="res ok">Your PDF is this certificate, unchanged.</span>'
        : `<span class="res bad">Your PDF is not this certificate as issued (it was changed, or it is another version).</span><br><span class="muted">Its fingerprint: <code>${h}</code></span>`;
    };
    document.getElementById('file').onchange = (e) => { if (e.target.files[0]) take(e.target.files[0]); };
    const drop = document.getElementById('drop');
    drop.ondragover = (e) => { e.preventDefault(); }; drop.ondrop = (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) take(e.dataTransfer.files[0]); };
  } catch (e) { out.innerHTML = '<p class="res bad">The check could not be made. Try again later.</p>'; }
}
document.getElementById('f').onsubmit = (e) => { e.preventDefault(); if (codeEl.value.trim()) check(codeEl.value); };
const c = new URLSearchParams(location.search).get('c'); if (c) { codeEl.value = c; check(c); }
