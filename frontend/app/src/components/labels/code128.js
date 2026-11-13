// Code 128 (sets B and C), copied unchanged from public/js/labels.js (checked against a scanner decoder in 0.10.0).
// No DOM and no React here: the label components draw the bars from code128Modules().
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
