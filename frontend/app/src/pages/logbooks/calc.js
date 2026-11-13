// The logbook screens' formats and live preview (a preview only: the database calculates and judges every entry
// when it is saved). calcExpr is a small arithmetic evaluator: the security policy forbids eval and Function().
// Self-check: node src/pages/logbooks/calc.test.js

export const KINDS = ['Equipment check', 'Temperature', 'Culture', 'Inoculum', 'Control', 'Sample weights', 'General'];

export const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
export const loc = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : ''); // a lab-local timestamp as stored
export const fmtN = (v) => {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v); if (!Number.isFinite(n)) return String(v);
  if (n !== 0 && (Math.abs(n) >= 1e6 || Math.abs(n) < 1e-3)) return n.toExponential(3).replace('e+', ' x 10^').replace('e-', ' x 10^-');
  return String(Number(n.toPrecision(6)));
};
export const showVal = (f, v) => (v === null || v === undefined || v === '' ? '' : typeof v === 'number' || ['Number', 'Calculated'].includes(f.field_type) ? fmtN(v) + (f.unit ? ' ' + f.unit : '') : String(v));

// Numbers, + - * / ^, brackets and the functions below
const CALC_FN = { log10: Math.log10, ln: Math.log, sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, min: Math.min, max: Math.max, power: Math.pow };
export function calcExpr(src) {
  const t = String(src).match(/\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?|[a-z_][a-z0-9_]*|[-+*/^(),]/gi) || [];
  if (t.join('') !== String(src).replace(/\s+/g, '')) return null;
  let k = 0;
  const peek = () => t[k]; const next = () => t[k++];
  const expect = (x) => { if (next() !== x) throw new Error('syntax'); };
  function atom() {
    const x = next();
    if (x === undefined) throw new Error('syntax');
    if (x === '(') { const v = sum(); expect(')'); return v; }
    if (/^[\d.]/.test(x)) return Number(x);
    if (CALC_FN[x.toLowerCase()]) {
      expect('('); const args = [sum()];
      while (peek() === ',') { next(); args.push(sum()); }
      expect(')'); return CALC_FN[x.toLowerCase()](...args);
    }
    throw new Error('syntax');
  }
  function power() { const b = atom(); if (peek() === '^') { next(); return Math.pow(b, unary()); } return b; }
  function unary() { if (peek() === '-') { next(); return -unary(); } if (peek() === '+') { next(); return unary(); } return power(); }
  function product() { let v = unary(); while (peek() === '*' || peek() === '/') { const op = next(); const r = unary(); v = op === '*' ? v * r : v / r; } return v; }
  function sum() { let v = product(); while (peek() === '+' || peek() === '-') { const op = next(); const r = product(); v = op === '+' ? v + r : v - r; } return v; }
  try { const r = sum(); if (k !== t.length) return null; return Number.isFinite(r) ? r : null; } catch { return null; }
}

// {key} takes the row's value; {lot_field.prop} is only known on save (null here)
export function evalFormula(formula, vals) {
  let ok = true;
  const expr = String(formula || '').replace(/\{([a-z][a-z0-9_]*)(\.[a-z][a-z0-9_]*)?\}/g, (m, k, sub) => {
    if (sub) { ok = false; return '0'; }
    const v = vals[k]; if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) { ok = false; return '0'; }
    return '(' + Number(v) + ')';
  });
  if (!ok || !/^[\s0-9+\-*/^().,eEa-z_]*$/.test(expr)) return null;
  return calcExpr(expr);
}

export function limitsFor(f, eqRow) {
  const lo = f.limit_min ?? null; const hi = f.limit_max ?? null;
  if (f.equipment_limits && eqRow) {
    const l = (eqRow.limits || {})[f.field_key];
    if (l) return { lo: l.min ?? null, hi: l.max ?? null };
    if (eqRow.temperature_c !== null && eqRow.temperature_c !== undefined && f.field_key === 'temperature') return { lo: Number(eqRow.temperature_c) - Number(eqRow.temperature_tol || 0), hi: Number(eqRow.temperature_c) + Number(eqRow.temperature_tol || 0) };
    if (eqRow.humidity_pct !== null && eqRow.humidity_pct !== undefined && f.field_key === 'humidity') return { lo: Number(eqRow.humidity_pct) - Number(eqRow.humidity_tol || 0), hi: Number(eqRow.humidity_pct) + Number(eqRow.humidity_tol || 0) };
  }
  return { lo: lo === null ? null : Number(lo), hi: hi === null ? null : Number(hi) };
}
export const limText = (l) => (l.lo !== null && l.hi !== null ? `${fmtN(l.lo)} to ${fmtN(l.hi)}` : l.lo !== null ? `at least ${fmtN(l.lo)}` : l.hi !== null ? `at most ${fmtN(l.hi)}` : '');

// what a row would be: its calculated values and what is outside a limit
export function judge(fields, row, eqRow) {
  const vals = {}; const probs = [];
  for (const f of fields) {
    const v = row['f_' + f.field_key];
    if (f.field_type === 'Calculated') { const c = evalFormula(f.formula, vals); if (c !== null) vals[f.field_key] = c; }
    else if (f.field_type === 'Number') { if (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) vals[f.field_key] = Number(v); }
    if (f.field_type === 'Pass/Fail' && String(v || '').toLowerCase().startsWith('f')) probs.push(`${f.label}: Fail`);
    if (['Number', 'Calculated'].includes(f.field_type) && vals[f.field_key] !== undefined) {
      const l = limitsFor(f, eqRow); const n = vals[f.field_key];
      if (l.lo !== null && n < l.lo) probs.push(`${f.label} ${fmtN(n)}${f.unit ? ' ' + f.unit : ''} is below ${fmtN(l.lo)}`);
      if (l.hi !== null && n > l.hi) probs.push(`${f.label} ${fmtN(n)}${f.unit ? ' ' + f.unit : ''} is above ${fmtN(l.hi)}`);
    }
  }
  return { vals, probs };
}

// entries from the sensor feed (0.25.0): when they cover, and whether a person still has to give the reason
export const tloc = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '');
export const sensorWhen = (x) => (!x.sensor ? null : x.sensor.kind === 'Hour' ? (x.sensor.summary || {}).label || tloc(x.sensor.start)
  : `${tloc(x.sensor.start)} to ${x.sensor.end ? new Date(x.sensor.end).toLocaleTimeString([], { timeStyle: 'short' }) : 'now'}`);
export const needsReason = (x) => x.result === 'Fail' && !x.failure_reason && x.status !== 'Voided';
export const resultClass = (x) => ({ Pass: 'tbpass', Fail: 'tbfail' }[x.result] || '');
export const entries = (n) => `entr${n === 1 ? 'y' : 'ies'}`;
