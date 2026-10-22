// 0.36.0 (migration 058): the test picker on a lab order. Cecilia (2026-10-21): too many tests to scroll through;
// Alex: drill down Service line > Service line type > Department (material/matrix later). Any test of this lab can be
// ordered: the client's quoted price when there is one, else the list price, without a warning (Alex). The client's
// quoted tests and service lines come first; a search box looks across everything.
import { api, esc, toast, money } from '../app.js';

const css = document.createElement('style');
css.textContent = `
.tpk { width: 1080px; max-width: 96vw; display: flex; flex-direction: column; max-height: 90vh; }
.tpk .tpkq { width: 100%; padding: 8px 10px; font-size: 14px; border: 1px solid var(--line); border-radius: 7px; margin: 4px 0 10px; }
.tpk .tpkcols { display: grid; grid-template-columns: 190px 190px 170px 1fr; gap: 10px; min-height: 340px; flex: 1; overflow: hidden; }
.tpk .tpkcol { border: 1px solid var(--line); border-radius: 8px; overflow: auto; background: #fbfcfc; }
.tpk .tpkcol h4 { margin: 0; padding: 7px 10px; font-size: 12px; color: var(--muted); font-weight: 600; border-bottom: 1px solid var(--line); background: #fff; position: sticky; top: 0; }
.tpk .tpkcol button { display: flex; justify-content: space-between; gap: 6px; width: 100%; text-align: left; border: 0; border-bottom: 1px solid #eef1f3; background: none; padding: 7px 10px; font-size: 13px; cursor: pointer; color: var(--ink); }
.tpk .tpkcol button:hover { background: #eef4f1; } .tpk .tpkcol button.on { background: #1f3a2c; color: #fff; } .tpk .tpkcol button small { opacity: .7; }
.tpk .tpkcol button.mine { font-weight: 700; }
.tpk .tpktests table { width: 100%; border-collapse: collapse; font-size: 13px; } .tpk .tpktests td { padding: 6px 8px; border-bottom: 1px solid #eef1f3; vertical-align: top; }
.tpk .tpktests tr.off td { color: #8a949c; } .tpk .tpktests label { cursor: pointer; display: block; } .tpk .tpktests .m { color: var(--muted); font-size: 11.5px; }
.tpk .tpktests td.n { text-align: right; white-space: nowrap; } .tpk .tpkq2 { color: #1f6b3a; font-weight: 600; }
.tpk .tpkfoot { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-top: 12px; } .tpk .tpkfoot .sp { flex: 1; }
@media (max-width: 900px) { .tpk .tpkcols { grid-template-columns: 1fr; } }
`;
document.head.appendChild(css);

const QUOTED = '__quoted';
const ALL = '__all';
const NONE = '__none';

// opts: { orderId, sampleIds, sampleLabel, tiers: [{id, schedule_id, tier_name, rush_tat, tat_unit}], onAdded }
export async function testPicker(opts) {
  let d;
  try { d = await api(`/orders/${opts.orderId}/picker`); } catch (e) { toast(e.message, 'err'); return; }
  const tests = d.tests;
  const quoted = tests.filter((t) => t.quote_price !== null && t.quote_price !== undefined);
  const chosen = new Set();
  let line = quoted.length ? QUOTED : (d.lines.find((l) => l.client_line) || {}).id || ALL;
  let type = null; let dept = null; let q = '';

  const m = document.createElement('div'); m.className = 'modal-bg';
  m.innerHTML = `<div class="modal tpk"><h3>Add tests to ${esc(opts.sampleLabel)}</h3>
    <p class="intro">Choose a service line, then narrow by type and department, or search. Tick the tests to add. The client's quoted tests are at their quoted price; any other test of this lab is at its list price.</p>
    <input class="tpkq" placeholder="Search every test by name or code" aria-label="Search tests">
    <div class="tpkcols"><div class="tpkcol" data-c="line"></div><div class="tpkcol" data-c="type"></div><div class="tpkcol" data-c="dept"></div><div class="tpkcol tpktests" data-c="tests"></div></div>
    ${(d.elsewhere || []).length ? `<p class="help">Quoted tests of another lab cannot be ordered here yet: ${esc(d.elsewhere.map((x) => `${x.test_name} (${x.site_code})`).join(', '))}. Order them at that lab.</p>` : ''}
    <div class="tpkfoot"><span id="tpkn">Nothing ticked</span><span class="sp"></span>
      <label>Rush <select id="tpkr"><option value="">Standard turnaround</option></select></label>
      <button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok disabled>Add</button></div>
    <div class="merr"></div></div>`;
  document.body.appendChild(m);
  const $ = (s) => m.querySelector(s);
  const close = () => m.remove();
  $('[data-x]').onclick = close;
  m.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  const inLine = (t) => (line === QUOTED ? t.quote_price !== null && t.quote_price !== undefined : line === ALL ? true : line === NONE ? !t.line_id : t.line_id === line);
  const pool = () => {
    if (q) { const s = q.toLowerCase(); return tests.filter((t) => `${t.test_name} ${t.test_code} ${t.description || ''}`.toLowerCase().includes(s)); }
    return tests.filter((t) => inLine(t) && (!type || (t.type_id || NONE) === type) && (!dept || (t.department_id || NONE) === dept));
  };
  const btn = (key, label, n, on, cls = '') => `<button data-k="${esc(key)}" class="${on ? 'on' : ''} ${cls}">${esc(label)} <small>${n}</small></button>`;

  function draw() {
    // service lines: the client's quoted tests, the client's lines, the rest, not yet sorted, all
    const lineCount = (k) => tests.filter((t) => (k === QUOTED ? t.quote_price !== null && t.quote_price !== undefined : k === ALL ? true : k === NONE ? !t.line_id : t.line_id === k)).length;
    const lines = [...d.lines].sort((a, b) => (b.client_line - a.client_line) || (a.sort_order - b.sort_order));
    $('[data-c="line"]').innerHTML = '<h4>Service line</h4>'
      + (quoted.length ? btn(QUOTED, "On this client's quotes", quoted.length, !q && line === QUOTED, 'mine') : '')
      + lines.filter((l) => lineCount(l.id)).map((l) => btn(l.id, l.line_name + (l.client_line ? ' ★' : ''), lineCount(l.id), !q && line === l.id, l.client_line ? 'mine' : '')).join('')
      + (lineCount(NONE) ? btn(NONE, 'Not yet sorted', lineCount(NONE), !q && line === NONE) : '')
      + btn(ALL, 'All tests', tests.length, !q && line === ALL);
    const base = tests.filter(inLine);
    const types = new Map(); base.forEach((t) => { const k = t.type_id || NONE; if (!types.has(k)) types.set(k, { label: t.type_name || 'No type', n: 0 }); types.get(k).n++; });
    $('[data-c="type"]').innerHTML = '<h4>Type</h4>' + btn('', 'Every type', base.length, !type) + [...types].map(([k, v]) => btn(k, v.label, v.n, type === k)).join('');
    const base2 = base.filter((t) => !type || (t.type_id || NONE) === type);
    const depts = new Map(); base2.forEach((t) => { const k = t.department_id || NONE; if (!depts.has(k)) depts.set(k, { label: t.department_name || 'No department', n: 0 }); depts.get(k).n++; });
    $('[data-c="dept"]').innerHTML = '<h4>Department</h4>' + btn('', 'Every department', base2.length, !dept) + [...depts].map(([k, v]) => btn(k, v.label, v.n, dept === k)).join('');
    const rows = pool();
    $('[data-c="tests"]').innerHTML = `<h4>${q ? `Tests matching "${esc(q)}"` : 'Tests'} (${rows.length})</h4>` + (rows.length ? `<table>${rows.map((t) => {
      const off = !!t.problem;
      const price = t.quote_price !== null && t.quote_price !== undefined ? `<span class="tpkq2">${money(t.quote_price)}</span><div class="m">${esc(t.project_code)}</div>` : `${money(t.list_price)}<div class="m">list price</div>`;
      return `<tr class="${off ? 'off' : ''}"><td style="width:26px"><input type="checkbox" id="tpk_${t.id}" data-t="${t.id}" ${chosen.has(t.id) ? 'checked' : ''} ${off ? 'disabled' : ''}></td>
        <td><label for="tpk_${t.id}">${esc(t.test_name)}</label><div class="m">${esc(t.test_code)}${t.department_name ? ' · ' + esc(t.department_name) : ''}${t.standard_tat ? ` · ${esc(t.standard_tat)} ${t.tat_unit === 'Business Days' ? 'business' : 'calendar'} days` : ''}${off ? ' · ' + esc(t.problem) : ''}</div></td>
        <td class="n">${price}</td></tr>`; }).join('')}</table>` : '<p class="help" style="padding:10px">No tests here.</p>');
    m.querySelectorAll('[data-c="line"] [data-k]').forEach((b) => { b.onclick = () => { line = b.dataset.k; type = null; dept = null; q = ''; $('.tpkq').value = ''; draw(); }; });
    m.querySelectorAll('[data-c="type"] [data-k]').forEach((b) => { b.onclick = () => { type = b.dataset.k || null; dept = null; draw(); }; });
    m.querySelectorAll('[data-c="dept"] [data-k]').forEach((b) => { b.onclick = () => { dept = b.dataset.k || null; draw(); }; });
    m.querySelectorAll('[data-t]').forEach((c) => { c.onchange = () => { if (c.checked) chosen.add(c.dataset.t); else chosen.delete(c.dataset.t); foot(); }; });
    foot();
  }
  function foot() {
    const picked = tests.filter((t) => chosen.has(t.id));
    $('#tpkn').textContent = picked.length ? `${picked.length} test${picked.length === 1 ? '' : 's'} ticked: ${picked.map((t) => t.test_name).join(', ')}` : 'Nothing ticked';
    $('[data-ok]').disabled = !picked.length;
    // rush tiers of the ticked tests' schedules (a tier applies only to the tests on its schedule)
    const scheds = new Set(picked.map((t) => t.rush_schedule_id).filter(Boolean));
    const sel = $('#tpkr'); const cur = sel.value;
    const tiers = (opts.tiers || []).filter((t) => scheds.has(t.schedule_id));
    sel.innerHTML = '<option value="">Standard turnaround</option>' + tiers.map((t) => `<option value="${esc(t.id)}">${esc(t.schedule_name ? t.schedule_name + ': ' : '')}${esc(t.tier_name)} (${esc(t.rush_tat)} days)</option>`).join('');
    if (tiers.some((t) => t.id === cur)) sel.value = cur;
    sel.disabled = !tiers.length;
  }
  $('.tpkq').addEventListener('input', (e) => { q = e.target.value.trim(); draw(); });
  $('[data-ok]').onclick = async () => {
    const ok = $('[data-ok]'); ok.disabled = true;
    try {
      const r = await api(`/orders/${opts.orderId}/catalogue-tests`, { method: 'POST', body: { sample_ids: opts.sampleIds, test_ids: [...chosen], rush_tier_id: $('#tpkr').value || null } });
      close();
      toast(`${r.added} test${r.added === 1 ? '' : 's'} added${r.skipped ? ` (${r.skipped} already on the sample${r.skipped === 1 ? '' : 's'})` : ''}.`);
      if (opts.onAdded) opts.onAdded(r);
    } catch (e) { ok.disabled = false; $('.merr').textContent = e.message; }
  };
  draw();
  $('.tpkq').focus();
}
