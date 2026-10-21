// Barcode labels (Alex, 2026-10-13): Code 128 barcodes (1D: most labs already have the scanners), printed on a Dymo
// LabelWriter 450 through its driver. Samples use 2 1/8 x 4 in. labels (the tests and due dates; a long list continues
// on the next label); inventory lots, equipment and batches use 1 x 2 1/8 in. labels. By default as many labels print
// as there are units (sample units, inventory containers, batch entries). The ID is always printed as text too.
import { api, esc, modal, toast } from './app.js';

// ---------------------------------------------------------------- Code 128 (sets B and C)
// bar and space widths (in modules) of symbols 0 to 106; 103-105 start A/B/C, 106 stop
const P = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 '
  + '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 '
  + '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 '
  + '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 '
  + '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 '
  + '114131 311141 411131 211412 211214 211232 2331112').split(' ');
const digitsAt = (s, i) => { let n = 0; while (i + n < s.length && s[i + n] >= '0' && s[i + n] <= '9') n++; return n; };
// symbol values for a text: set B, switching to set C for runs of digits (pairs) to keep the barcode short
export function code128Values(text) {
  const s = String(text);
  if (/[^\x20-\x7e]/.test(s)) throw new Error('A barcode can only hold plain characters: ' + s);
  const out = []; let i = 0; let set;
  const lead = digitsAt(s, 0);
  if (lead >= 4 && (lead === s.length || lead >= 6)) { set = 'C'; out.push(105); } else { set = 'B'; out.push(104); }
  while (i < s.length) {
    const run = digitsAt(s, i);
    if (set === 'C') {
      if (run >= 2) { out.push(Number(s.slice(i, i + 2))); i += 2; continue; }
      set = 'B'; out.push(100); continue;
    }
    // in set B: switch to C for an even run of 4+ at the end, or 6+ in the middle (an odd run keeps its first digit in B)
    const atEnd = i + run === s.length;
    if ((atEnd && run >= 4) || run >= 6) {
      if (run % 2) { out.push(s.charCodeAt(i) - 32); i += 1; }
      set = 'C'; out.push(99); continue;
    }
    out.push(s.charCodeAt(i) - 32); i += 1;
  }
  let sum = out[0];
  for (let k = 1; k < out.length; k++) sum += out[k] * k;
  out.push(sum % 103, 106);
  return out;
}
// the bars as module runs: [bar, space, bar, ...] widths
export function code128Modules(text) { return code128Values(text).map((v) => P[v]).join('').split('').map(Number); }
// SVG of the barcode, filling the given width (inches) with a 10-module quiet zone each side
export function barcodeSvg(text, widthIn, heightIn) {
  const runs = code128Modules(text);
  const total = runs.reduce((a, b) => a + b, 0) + 20;
  let x = 10; let rects = '';
  runs.forEach((w, k) => { if (k % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="100"/>`; x += w; });
  return `<svg class="bc" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} 100" preserveAspectRatio="none" shape-rendering="crispEdges"
    style="width:${widthIn}in;height:${heightIn}in" role="img" aria-label="Barcode ${esc(text)}" data-code="${esc(text)}">${rects}</svg>`;
}

// ---------------------------------------------------------------- label layouts
const SIZES = { big: { w: 4, h: 2.125 }, small: { w: 2.125, h: 1 } };
const d10 = (v) => (v ? String(v).slice(0, 10) : '');
const css = document.createElement('style');
css.textContent = `
.lbl { box-sizing: border-box; overflow: hidden; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; position: relative; }
.lbl.small { width: 2.125in; height: 1in; padding: 0.05in 0.07in; }
.lbl.big { width: 4in; height: 2.125in; padding: 0.08in 0.12in; }
.lbl .bc { display: block; fill: #000; }
.lbl .id { font-weight: 700; font-size: 9pt; line-height: 1.1; margin-top: 1px; white-space: nowrap; }
.lbl.big .id { font-size: 13pt; }
.lbl .t { font-size: 6.5pt; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lbl.big .t { font-size: 7.5pt; }
.lbl .row { display: flex; justify-content: space-between; gap: 6px; }
.lbl .tests { margin-top: 3px; border-top: 0.5pt solid #000; padding-top: 2px; }
.lbl .tests div { display: flex; justify-content: space-between; gap: 8px; font-size: 7.5pt; line-height: 1.2; }
.lbl .tests div span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lbl .tests b { font-weight: 700; }
.lbl .pg { position: absolute; right: 0.12in; bottom: 0.06in; font-size: 6.5pt; }
.lblprev { display: flex; flex-wrap: wrap; gap: 10px; max-height: 52vh; overflow: auto; padding: 8px; background: #EEF1F4; border-radius: 8px; }
.lblprev .lbl { box-shadow: 0 1px 3px rgba(0,0,0,.25); }
#labelPrint { display: none; }
@media print {
  body.printing-labels > *:not(#labelPrint) { display: none !important; }
  body.printing-labels #labelPrint { display: block; }
  body.printing-labels #labelPrint .lbl { page-break-after: always; break-after: page; box-shadow: none; }
}`;
document.head.appendChild(css);

const smallLabel = (code, line1, line2) => `<div class="lbl small">${barcodeSvg(code, 1.99, 0.42)}<div class="id">${esc(code)}</div>
  <div class="t">${esc(line1 || '')}</div><div class="t">${esc(line2 || '')}</div></div>`;

// a sample: the first label has the details and up to 6 tests; a long list continues on more labels (up to 10 each)
function sampleLabels(s) {
  const tests = s.tests || [];
  const pages = [tests.slice(0, 6)];
  for (let i = 6; i < tests.length; i += 10) pages.push(tests.slice(i, i + 10));
  const testRows = (list) => list.map((x) => `<div><span>${esc(x.test_name)}${x.rush ? ' <b>RUSH</b>' : ''}</span><span>Due <b>${esc(d10(x.due_date) || 'n/a')}</b></span></div>`).join('');
  return pages.map((list, k) => `<div class="lbl big">${barcodeSvg(s.sample_code, 3.76, 0.5)}
    <div class="row"><div class="id">${esc(s.sample_code)}</div><div class="t" style="align-self:center">${esc(s.order_code || '')}${s.logged_at ? ' · logged ' + esc(d10(s.logged_at)) : ''}</div></div>
    ${k === 0 ? `<div class="t">${esc([s.client_sample_id, s.matrix, s.product_lot ? 'lot ' + s.product_lot : ''].filter(Boolean).join(' · '))}</div>
      <div class="t">${esc(s.client_name || '')}${s.description ? ' · ' + esc(s.description) : ''}</div>` : '<div class="t">Tests (continued)</div>'}
    <div class="tests">${testRows(list) || '<div><span>No tests ordered</span></div>'}</div>
    ${pages.length > 1 ? `<div class="pg">${k + 1} of ${pages.length}</div>` : ''}</div>`);
}
function lotLabel(l) {
  const exp = l.expiration_date ? `Exp ${d10(l.expiration_date)}` : l.retest_date ? `Retest ${d10(l.retest_date)}` : 'No expiry';
  return smallLabel(l.lot_code, l.item_name, `${exp}${l.manufacturer_lot ? ' · Lot ' + l.manufacturer_lot : ''}${l.qa_status && !/^Released/.test(l.qa_status) ? ' · ' + l.qa_status.toUpperCase() : ''}`);
}
function equipmentLabel(e) {
  return smallLabel(e.equipment_code, e.equipment_name, `${e.cal_expires ? 'Cal exp ' + d10(e.cal_expires) : 'No calibration on record'}${e.serial_number ? ' · SN ' + e.serial_number : ''}`);
}
function batchLabels(b, mode) {
  if (mode === 'batch') return [smallLabel(b.batch_code, `${b.test_code} ${b.test_name}`, `${(b.entries || []).length} entries · made ${d10(b.created_at)}`)];
  // one per entry: a sample's tube carries its sample ID; a QC entry carries the batch ID
  return (b.entries || []).map((e) => smallLabel(e.entry_type === 'Sample' && e.sample_code ? e.sample_code : b.batch_code,
    `#${e.position} ${e.label}`, `${b.batch_code} · ${b.test_name}`));
}

// ---------------------------------------------------------------- the print dialog
const KIND_WORDS = { sample: ['sample', 'samples', '2 1/8 x 4 in.'], lot: ['inventory item', 'inventory items', '1 x 2 1/8 in.'], equipment: ['piece of equipment', 'equipment', '1 x 2 1/8 in.'], batch: ['batch', 'batches', '1 x 2 1/8 in.'] };
const unitsOf = (kind, x) => (kind === 'sample' ? Number(x.number_of_units) || 1 : kind === 'lot' ? Number(x.container_count) || 1 : 1);

export async function printLabels(kind, ids) {
  ids = [...new Set((ids || []).filter(Boolean))];
  if (!ids.length) { toast('Choose what to print labels for first.', 'err'); return; }
  let rows;
  try { rows = await api(`/labels/${kind}?ids=${ids.join(',')}`); } catch (e) { toast(e.message, 'err'); return; }
  if (!rows.length) { toast(kind === 'sample' ? 'Only logged samples (with a sample ID) get labels.' : 'Nothing to print.', 'err'); return; }
  const [one, many, size] = KIND_WORDS[kind];
  let mode = kind === 'batch' ? 'entries' : 'units';
  let copies = null;   // null = as many as units
  const build = () => {
    const out = [];
    for (const x of rows) {
      const n = copies === null ? unitsOf(kind, x) : copies;
      const set = kind === 'sample' ? sampleLabels(x) : kind === 'lot' ? [lotLabel(x)] : kind === 'equipment' ? [equipmentLabel(x)] : batchLabels(x, mode);
      for (let i = 0; i < (kind === 'batch' ? 1 : n); i++) out.push(...set);
    }
    return out;
  };
  const html = `<div class="field"><label>How many</label>
      ${kind === 'batch' ? `<select id="lb_mode"><option value="entries">One label per entry (each sample and QC: the default)</option><option value="batch">One label for the batch</option></select>`
        : `<select id="lb_copies"><option value="">As many as there are ${kind === 'sample' ? 'units of each sample' : kind === 'lot' ? 'containers of each item' : 'items'} (default)</option>
           ${[1, 2, 3, 4, 5, 6, 8, 10].map((n) => `<option value="${n}">${n} of each</option>`).join('')}</select>`}</div>
    <div class="help" id="lb_count"></div>
    <div class="lblprev" id="lb_prev"></div>
    <div class="help" style="margin-top:8px">Dymo LabelWriter 450: in the print window choose the Dymo printer and the ${esc(size)} label, scale 100%, no margins. Each label prints on its own page; the barcode is Code 128 with the ID printed under it.</div>`;
  const show = (root) => {
    const labels = build();
    root.querySelector('#lb_prev').innerHTML = labels.slice(0, 60).join('');
    root.querySelector('#lb_count').textContent = `${labels.length} label${labels.length === 1 ? '' : 's'} for ${rows.length} ${rows.length === 1 ? one : many}${labels.length > 60 ? ' (first 60 shown)' : ''}.`;
    return labels;
  };
  const go = await new Promise((resolve) => {
    modal({ title: `Print labels: ${rows.length === 1 ? (rows[0].sample_code || rows[0].lot_code || rows[0].equipment_code || rows[0].batch_code) : rows.length + ' ' + many}`,
      okText: 'Print', wide: true, html, collect: () => true }).then(resolve);
    setTimeout(() => {
      const root = [...document.querySelectorAll('.modal')].pop(); if (!root) return;
      show(root);
      root.querySelector('#lb_copies')?.addEventListener('change', (e) => { copies = e.target.value ? Number(e.target.value) : null; show(root); });
      root.querySelector('#lb_mode')?.addEventListener('change', (e) => { mode = e.target.value; show(root); });
    }, 0);
  });
  if (!go) return;
  printNow(build(), kind === 'sample' ? SIZES.big : SIZES.small);
}

// print through the browser: one label per page, the page the size of the label
function printNow(labels, size) {
  let host = document.getElementById('labelPrint');
  if (!host) { host = document.createElement('div'); host.id = 'labelPrint'; document.body.appendChild(host); }
  host.innerHTML = labels.join('');
  let page = document.getElementById('labelPage');
  if (!page) { page = document.createElement('style'); page.id = 'labelPage'; document.head.appendChild(page); }
  page.textContent = `@media print { @page { size: ${size.w}in ${size.h}in; margin: 0; } }`;
  document.body.classList.add('printing-labels');
  const done = () => { document.body.classList.remove('printing-labels'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { try { window.print(); } catch (e) { toast('The browser could not open its print window: ' + e.message, 'err'); } setTimeout(done, 1500); }, 50);
}
