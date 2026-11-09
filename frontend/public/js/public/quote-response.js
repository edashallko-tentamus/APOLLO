// Moved out of quote-response.html in 0.32.0 so the page can run under a Content-Security-Policy without inline scripts.
// The link in the quotation email (migration 029): the client reads the quotation and accepts or declines it, without
// signing in. Accepting lets them submit samples against it at the prices shown.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v) => '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const token = new URLSearchParams(location.search).get('t') || '';
const box = document.getElementById('q'); const act = document.getElementById('act');
(async () => {
  let d;
  try { d = await (await fetch('/api/public/quote/' + encodeURIComponent(token))).json(); } catch (_) { d = { found: false }; }
  if (!d.found) { box.innerHTML = '<h1>Your quotation</h1><p class="bad">This link is not valid.</p><p class="muted">Please contact the laboratory directly.</p>'; return; }
  const labs = [...new Set(d.lines.map((l) => l.lab))];
  box.innerHTML = `<h1>Quotation ${esc(d.quote_code)}</h1>
    <p class="muted">For ${esc(d.client_name)}${d.contact ? ' · attention ' + esc(d.contact) : ''} · prepared by ${esc(d.prepared_by || '')} · version ${d.version_no}${d.valid_until_text ? ' · valid until ' + esc(d.valid_until_text) : ''}</p>
    <div class="wrap"><table><thead><tr><th>Test</th>${labs.length > 1 ? '<th>Laboratory</th>' : ''}<th class="n">Qty</th><th class="n">List price</th><th class="n">Your price</th><th class="n">Total</th><th>Turnaround</th></tr></thead>
    <tbody>${d.lines.map((l) => `<tr><td><b>${esc(l.test_name)}</b>${l.analytes ? `<div class="muted">${esc(l.analytes)}</div>` : ''}</td>${labs.length > 1 ? `<td>${esc(l.lab)}</td>` : ''}
      <td class="n">${l.quantity}</td><td class="n">${money(l.list_price)}</td><td class="n">${money(l.final_price)}</td><td class="n">${money(l.line_total)}</td><td>${esc(l.tat)}</td></tr>`).join('')}</tbody></table></div>
    <div class="tot">Total ${money(d.total)}</div>
    ${d.notes ? `<p class="muted">${esc(d.notes)}</p>` : ''}
    <p class="muted"><a href="/api/public/quote/${encodeURIComponent(token)}/pdf" target="_blank" rel="noopener">Download the quotation (PDF)</a></p>`;
  act.hidden = false;
  if (d.status === 'Accepted') { act.innerHTML = `<p class="ok">This quotation was accepted${d.response_name ? ' by ' + esc(d.response_name) : ''}.</p><p class="muted">You can submit samples against it. Thank you.</p>`; return; }
  if (d.status === 'Rejected') { act.innerHTML = '<p>This quotation was declined. If you would like a new one, please contact the laboratory.</p>'; return; }
  if (d.status !== 'Quoted') { act.innerHTML = `<p>This quotation is ${esc(d.status.toLowerCase())} and can no longer be answered online. Please contact the laboratory.</p>`; return; }
  if (d.expired) { act.innerHTML = `<p class="bad">This quotation expired on ${esc(d.valid_until_text)}.</p><p class="muted">Please contact the laboratory for a new one.</p>`; return; }
  act.innerHTML = `<p><b>Would you like to accept this quotation?</b></p>
    <label class="f" for="nm">Your name</label><input type="text" id="nm" autocomplete="name">
    <label class="f" for="nt">Comments or purchase order number (optional)</label><textarea id="nt" rows="3"></textarea>
    <div class="btns"><button id="yes">Accept the quotation</button><button id="no" class="no">Decline</button></div><p id="msg"></p>`;
  const send = async (decision) => {
    const msg = document.getElementById('msg'); const name = document.getElementById('nm').value.trim();
    if (!name) { msg.className = 'bad'; msg.textContent = 'Type your name first.'; return; }
    document.getElementById('yes').disabled = true; document.getElementById('no').disabled = true;
    try {
      const res = await fetch('/api/public/quote/' + encodeURIComponent(token), { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, name, note: document.getElementById('nt').value }) });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error || 'Your answer could not be sent');
      act.innerHTML = decision === 'Accept'
        ? `<p class="ok">Thank you: quotation ${esc(r.quote_code)} is accepted.</p><p class="muted">The laboratory has been told. You can now submit samples against this quotation at the prices shown.</p>`
        : `<p>Thank you for letting us know. Quotation ${esc(r.quote_code)} is declined.</p><p class="muted">If anything changes, please contact the laboratory.</p>`;
    } catch (e) { msg.className = 'bad'; msg.textContent = e.message; document.getElementById('yes').disabled = false; document.getElementById('no').disabled = false; }
  };
  document.getElementById('yes').onclick = () => send('Accept');
  document.getElementById('no').onclick = () => send('Decline');
})();
