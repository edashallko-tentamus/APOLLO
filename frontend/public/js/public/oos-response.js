// Moved out of oos-response.html in 0.32.0 so the page can run under a Content-Security-Policy without inline scripts.
// The link in the "Out of specification result" email (R-2): the client tells the lab what they want done. No sign-in;
// the link is valid for 90 days from the email. Each answer is recorded and waits on the OOS record for the lab.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const q = new URLSearchParams(location.search); const token = q.get('t') || '';
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
const head = document.getElementById('top'); const form = document.getElementById('form');
(async () => {
  let d;
  try { d = await (await fetch('/api/public/oos/' + encodeURIComponent(token))).json(); } catch (_) { d = { found: false }; }
  if (!d.found) { head.innerHTML = '<h1>Out of specification result</h1><p class="bad">This link is not valid any more.</p><p class="muted">Please contact the laboratory directly.</p>'; return; }
  head.innerHTML = `<h1>Out of specification result</h1><p class="muted">${esc(d.site_name)} · ${esc(d.oos_code)}</p>
    <dl><dt>Your sample</dt><dd>${esc(d.client_sample_id || d.sample_code)} (${esc(d.sample_code)})</dd><dt>Test</dt><dd>${esc(d.test_name)}</dd>
    <dt>Analyte</dt><dd>${esc(d.analyte_name)}</dd><dt>Result</dt><dd><b>${esc([d.reported, d.unit].filter(Boolean).join(' '))}</b></dd><dt>Specification</dt><dd>${esc(d.spec_text || '')}</dd></dl>
    ${d.answers.length ? `<p class="muted" style="margin-top:12px">Answers already received: ${d.answers.map((a) => esc(a.choice) + ' (' + esc(new Date(a.received_at).toLocaleString()) + ')').join('; ')}</p>` : ''}`;
  const pre = PRE[q.get('a')] || '';
  form.hidden = false;
  form.innerHTML = `<p>Would you like the laboratory to conduct Phase II re-testing of this sample, or something else? Choose one:</p>
    ${CHOICES.map(([v, t, h]) => `<label class="opt"><input type="radio" name="c" value="${esc(v)}" ${v === pre ? 'checked' : ''}> <b>${esc(t)}</b><span>${esc(h)}</span></label>`).join('')}
    <label class="f" for="nm">Your name</label><input type="text" id="nm" autocomplete="name">
    <label class="f" for="nt">Anything the lab should know (optional)</label><textarea id="nt" rows="3"></textarea>
    <button id="go">Send my answer</button><p id="msg"></p>`;
  document.getElementById('go').onclick = async () => {
    const c = form.querySelector('input[name=c]:checked'); const msg = document.getElementById('msg');
    if (!c) { msg.className = 'bad'; msg.textContent = 'Choose one of the options first.'; return; }
    const btn = document.getElementById('go'); btn.disabled = true;
    try {
      const res = await fetch('/api/public/oos/' + encodeURIComponent(token), { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice: c.value, name: document.getElementById('nm').value, note: document.getElementById('nt').value }) });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error || 'The answer could not be sent');
      form.innerHTML = `<p class="ok">Thank you. Your answer ("${esc(c.value)}") was sent to the laboratory.</p><p class="muted">The lab will contact you about the next steps. Reference: ${esc(r.oos_code)}.</p>`;
    } catch (e) { msg.className = 'bad'; msg.textContent = e.message; btn.disabled = false; }
  };
})();
