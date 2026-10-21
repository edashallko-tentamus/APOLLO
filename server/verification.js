// Workflow verification (WD-6, migration 024): writes a test version's verification protocol and executes it.
//  - The protocol: URS and FRS requirements written from the version's design, the samples of the run (a typical one,
//    one below the LOQ, one outside the specification...), every value the run will enter, and the expected results.
//  - The expected results come from a second calculation written here, independently of the database's calculation
//    engine: exact decimal arithmetic (rationals), its own formula parser (ordinary maths precedence), rounding, LOQ
//    and LOD reporting, dilution factors and specification conformance. The run then compares what the system produced
//    with what this calculation expected: two independent implementations must agree.
//  - The run: inside one transaction, the automated accounts (Verification analyst, witness, reviewer) do the work
//    through the same database functions and rules the bench and review screens use (SQL, not the screens: phase 2 adds
//    screenshots). Each check records what the system produced. Nothing is skipped silently: a check the run cannot
//    reach is Not tested, with the reason.
'use strict';

const GENERATOR = 'LIMS3 workflow verification 1.0 (protocol writer and independent calculation in server/verification.js)';

// ============================================================ exact decimals (rationals over BigInt)
const big = (x) => BigInt(x);
const babs = (x) => (x < 0n ? -x : x);
function gcd(a, b) { a = babs(a); b = babs(b); while (b) { [a, b] = [b, a % b]; } return a || 1n; }
class Q {
  constructor(n, d = 1n, approx = false) {
    if (d === 0n) throw new Error('The formula divides by zero with these values');
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n, d); this.n = n / g; this.d = d / g; this.approx = approx;
  }
  static of(x) {
    if (x instanceof Q) return x;
    if (typeof x === 'bigint') return new Q(x);
    const s = typeof x === 'number' ? (Number.isInteger(x) ? String(x) : x.toPrecision(17)) : String(x).trim();
    const m = s.match(/^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
    if (!m || (m[2] === '' && (m[3] || '') === '')) throw new Error('Not a number: ' + s);
    const digits = (m[2] || '0') + (m[3] || ''); let scale = (m[3] || '').length - Number(m[4] || 0);
    let n = big(digits); let d = 1n;
    if (scale > 0) d = 10n ** big(scale); else if (scale < 0) n *= 10n ** big(-scale);
    return new Q(m[1] === '-' ? -n : n, d, typeof x === 'number' && !Number.isInteger(x));
  }
  static fromDouble(x) { if (!Number.isFinite(x)) throw new Error('The formula gives a value that is not a number'); const q = Q.of(x.toPrecision(17)); q.approx = true; return q; }
  add(o) { return new Q(this.n * o.d + o.n * this.d, this.d * o.d, this.approx || o.approx); }
  sub(o) { return new Q(this.n * o.d - o.n * this.d, this.d * o.d, this.approx || o.approx); }
  mul(o) { return new Q(this.n * o.n, this.d * o.d, this.approx || o.approx); }
  div(o) { if (o.n === 0n) throw new Error('The formula divides by zero with these values'); return new Q(this.n * o.d, this.d * o.n, this.approx || o.approx); }
  neg() { return new Q(-this.n, this.d, this.approx); }
  abs() { return new Q(babs(this.n), this.d, this.approx); }
  cmp(o) { const a = this.n * o.d; const b = o.n * this.d; return a < b ? -1 : a > b ? 1 : 0; }
  isZero() { return this.n === 0n; }
  isInt() { return this.d === 1n; }
  num() { return Number(this.n) / Number(this.d); }
  // the value rounded half away from zero to `scale` decimals (scale may be negative), as PostgreSQL prints numeric
  round(scale) {
    if (scale >= 0) {
      const p = 10n ** big(scale); const m = this.n * p; let q = m / this.d; const r = babs(m % this.d);
      if (2n * r >= this.d) q += (m < 0n ? -1n : 1n);
      let s = babs(q).toString().padStart(scale + 1, '0');
      const out = scale > 0 ? s.slice(0, -scale) + '.' + s.slice(-scale) : s;
      return (q < 0n ? '-' : '') + out;
    }
    const p = 10n ** big(-scale); const den = this.d * p; let q = this.n / den; const r = babs(this.n % den);
    if (2n * r >= den) q += (this.n < 0n ? -1n : 1n);
    return (q * p).toString();
  }
  // floor(log10(|x|)), exactly
  log10Floor() {
    const a = this.abs(); let k = a.n.toString().length - a.d.toString().length;
    const pow = (e) => (e >= 0 ? new Q(10n ** big(e)) : new Q(1n, 10n ** big(-e)));
    while (pow(k).cmp(a) > 0) k -= 1;
    while (pow(k + 1).cmp(a) <= 0) k += 1;
    return k;
  }
  // a plain decimal text with at most `sig` significant figures (for values the run enters)
  toInput(sig = 6) { if (this.isZero()) return '0'; const s = this.round(sig - 1 - this.log10Floor()); return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s; }
  toString() { if (this.isInt()) return this.n.toString(); const s = this.round(12); return s.replace(/0+$/, '').replace(/\.$/, ''); }
}

// ============================================================ formulas (standard maths precedence)
const FUNCS = new Set(['log10', 'ln', 'exp', 'sqrt', 'abs', 'min', 'max', 'power']);
const LEX = /(\{[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\}|[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?|[A-Za-z_][A-Za-z0-9_]*|[-+*/^(),]|[^\s])/g;
function formulaTokens(f) { return [...new Set((String(f || '').match(LEX) || []).filter((t) => t.startsWith('{')).map((t) => t.slice(1, -1)))]; }
function powQ(a, b) {
  if (b.isInt() && babs(b.n) <= 1000n) {
    if (b.n >= 0n) return new Q(a.n ** b.n, a.d ** b.n, a.approx || b.approx);
    if (a.isZero()) throw new Error('The formula divides by zero with these values');
    return new Q(a.d ** -b.n, a.n ** -b.n, a.approx || b.approx);
  }
  if (a.cmp(new Q(0n)) < 0) throw new Error('The formula takes the log or root of a value that is zero or negative');
  return Q.fromDouble(Math.pow(a.num(), b.num()));
}
function log10Q(a) {
  if (a.cmp(new Q(0n)) <= 0) throw new Error('The formula takes the log or root of a value that is zero or negative');
  const k = a.log10Floor(); const p = k >= 0 ? new Q(10n ** big(k)) : new Q(1n, 10n ** big(-k));
  if (p.cmp(a) === 0) return new Q(big(k), 1n, a.approx);
  return Q.fromDouble(Math.log10(a.num()));
}
function evaluate(formula, values) {
  const toks = String(formula || '').match(LEX) || []; let i = 0;
  const peek = () => toks[i]; const next = () => toks[i++];
  const expect = (t) => { if (next() !== t) throw new Error(`The formula cannot be read near "${toks[i - 1] || 'the end'}"`); };
  function expr() { let v = term(); while (peek() === '+' || peek() === '-') { const op = next(); const r = term(); v = op === '+' ? v.add(r) : v.sub(r); } return v; }
  function term() { let v = unary(); while (peek() === '*' || peek() === '/') { const op = next(); const r = unary(); v = op === '*' ? v.mul(r) : v.div(r); } return v; }
  function unary() { if (peek() === '-') { next(); return unary().neg(); } if (peek() === '+') { next(); return unary(); } return power(); }
  function power() { const b = primary(); if (peek() === '^') { next(); return powQ(b, unary()); } return b; }
  function primary() {
    const t = next();
    if (t === undefined) throw new Error('The formula ends too early');
    if (t === '(') { const v = expr(); expect(')'); return v; }
    if (t.startsWith('{')) { const k = t.slice(1, -1); if (!(k in values) || values[k] === null || values[k] === undefined) throw new Error('No numeric value for ' + t); return Q.of(values[k]); }
    if (/^[0-9.]/.test(t)) return Q.of(t);
    const f = t.toLowerCase();
    if (!FUNCS.has(f)) throw new Error(`"${t}" is not a known function`);
    expect('('); const args = [expr()]; while (peek() === ',') { next(); args.push(expr()); } expect(')');
    const a = args[0];
    switch (f) {
      case 'abs': return a.abs();
      case 'min': return args.reduce((x, y) => (y.cmp(x) < 0 ? y : x));
      case 'max': return args.reduce((x, y) => (y.cmp(x) > 0 ? y : x));
      case 'power': return powQ(a, args[1]);
      case 'log10': return log10Q(a);
      case 'ln': if (a.cmp(new Q(0n)) <= 0) throw new Error('The formula takes the log or root of a value that is zero or negative'); return Q.fromDouble(Math.log(a.num()));
      case 'exp': return Q.fromDouble(Math.exp(a.num()));
      case 'sqrt': if (a.cmp(new Q(0n)) < 0) throw new Error('The formula takes the log or root of a value that is zero or negative'); return Q.fromDouble(Math.sqrt(a.num()));
      default: throw new Error('Unknown function ' + f);
    }
  }
  const v = expr(); if (i < toks.length) throw new Error(`The formula cannot be read near "${toks[i]}"`); return v;
}

// ============================================================ reporting rules (as the requirements say)
const fieldKey = (label) => String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
function roundResult(v, mode, digits) {
  if (mode === 'Decimal places') return v.round(digits);
  if (v.isZero()) return new Q(0n).round(Math.max(digits - 1, 0));
  return v.round(digits - 1 - v.log10Floor());
}
// A numeric result as reported for an analyte: "ND" below the LOD when chosen, "< LOQ" below the LOQ, else rounded
function reportValue(v, a, version) {
  if (v === null || v === undefined) return null;
  if (version.nd_below_lod && a.lod !== null && v.cmp(Q.of(a.lod)) < 0) return 'ND';
  if (a.loq !== null && v.cmp(Q.of(a.loq)) < 0) return '< ' + a.loq;
  return roundResult(v, a.rounding_mode || version.rounding_mode, a.rounding_digits ?? version.rounding_digits);
}
// Whether a reported result conforms to the sample's specification (limits in the result's unit)
function conformance(spec, a, reported, valueText) {
  if (!spec) return 'No specification';
  if (spec.min === null && spec.max === null) {
    if (valueText === null || valueText === undefined) return 'Not compared';
    return (a.found_values || []).includes(valueText) ? 'Does not conform' : 'Conforms';
  }
  let x; let below = false;
  if (reported !== null && /^\s*-?[0-9]*\.?[0-9]+\s*$/.test(reported)) x = Q.of(reported);
  else if (reported && (reported.startsWith('<') || reported === 'ND')) { below = true; const d = reported.replace(/[^0-9.]/g, ''); x = d ? Q.of(d) : new Q(0n); }
  else return 'Not compared';
  const out = (spec.max !== null && x.cmp(Q.of(spec.max)) > 0 && !below) || (spec.min !== null && (x.cmp(Q.of(spec.min)) < 0 || below));
  return out ? 'Does not conform' : 'Conforms';
}
function dilutionFactor(fields) {
  let v = null;
  for (const f of fields || []) {
    if (f.aliquot !== undefined && f.aliquot !== null && Q.of(f.aliquot).cmp(new Q(0n)) > 0) {
      const a = Q.of(f.aliquot); const d = f.diluent === undefined || f.diluent === null || f.diluent === '' ? new Q(0n) : Q.of(f.diluent);
      v = (v || new Q(1n)).mul(a.add(d).div(a));
    }
  }
  return v;
}
function dilutionFinalVolume(fields) {
  const ok = (fields || []).filter((f) => f.aliquot !== undefined && f.aliquot !== null && Q.of(f.aliquot).cmp(new Q(0n)) > 0);
  if (!ok.length) return null; const f = ok[ok.length - 1];
  return Q.of(f.aliquot).add(f.diluent === undefined || f.diluent === null || f.diluent === '' ? new Q(0n) : Q.of(f.diluent));
}
// two unrounded values agree (the database divides to about 20 significant figures; logarithms are approximate)
function close(a, b) {
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  const x = Q.of(a).num(); const y = Q.of(b).num();
  return Math.abs(x - y) <= 1e-9 * Math.max(Math.abs(x), Math.abs(y)) + 1e-12;
}

// ============================================================ the version's design
const pgList = (v) => (Array.isArray(v) ? v : v === null || v === undefined || v === '{}' ? [] : String(v).replace(/^\{|\}$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')));
async function loadDesign(db, versionId) {
  const v = await db.one(`SELECT v.id, v.version_no, v.status::text AS status, v.rounding_mode::text AS rounding_mode, v.rounding_digits, v.nd_below_lod,
      t.id AS test_id, t.test_name, t.test_code, t.site_id, s.site_code, s.site_name, m.method_name, test_version_config_hash(v.id) AS hash
      FROM test_version v JOIN test t ON t.id = v.test_id JOIN lab_site s ON s.id = t.site_id LEFT JOIN method m ON m.id = v.method_id WHERE v.id = $1`, [versionId]);
  if (!v) throw new Error('Test version not found');
  const analytes = (await db.rows(`SELECT a.analyte_id, an.analyte_name, a.result_type::text AS result_type, a.reporting_unit, a.loq::text AS loq, a.lod::text AS lod,
      a.rounding_mode::text AS rounding_mode, a.rounding_digits, a.default_spec_min::text AS default_spec_min, a.default_spec_max::text AS default_spec_max,
      a.default_spec_text, a.result_values, a.found_values, a.invalid_values
      FROM test_version_analyte a JOIN analyte an ON an.id = a.analyte_id WHERE a.test_version_id = $1 AND a.status = 'Active' ORDER BY a.sort_order, an.analyte_name`, [versionId]))
    .map((a) => ({ ...a, result_values: pgList(a.result_values), found_values: pgList(a.found_values), invalid_values: pgList(a.invalid_values) }))
    // readings that are not results (039) are never used as a planned reading
    .map((a) => ({ ...a, result_values: a.result_values.filter((x) => !a.invalid_values.includes(x)) }));
  const steps = await db.rows(`SELECT ws.id, ws.step_key, ws.step_name, ws.step_type::text AS step_type, ws.sort_order, ws.config,
      d.department_name, (SELECT count(*) FROM step_ancestors(ws.id))::int AS n_anc, step_base_token_fields(ws.id) AS base_fields
      FROM workflow_step ws LEFT JOIN department d ON d.id = step_department(ws.id) WHERE ws.test_version_id = $1 AND ws.status = 'Active' ORDER BY ws.sort_order, ws.step_key`, [versionId]);
  const deps = await db.rows(`SELECT s.step_key, p.step_key AS dep FROM workflow_step_dependency d JOIN workflow_step s ON s.id = d.step_id JOIN workflow_step p ON p.id = d.depends_on_step_id
      WHERE s.test_version_id = $1 AND d.status = 'Active' AND s.status = 'Active'`, [versionId]);
  const eq = await db.rows(`SELECT s.step_key, et.id AS equipment_type_id, et.type_name, e.is_main FROM workflow_step_equipment e JOIN workflow_step s ON s.id = e.step_id
      JOIN equipment_type et ON et.id = e.equipment_type_id WHERE s.test_version_id = $1 AND e.status = 'Active' AND s.status = 'Active' ORDER BY e.is_main DESC, et.type_name`, [versionId]);
  const qc = await db.rows(`SELECT qc_type, qc_class, limit_type, shape, analyte_id, analyte_name, applies, min_value::text AS min_value, max_value::text AS max_value, limit_ref
      FROM qc_criteria($1)`, [versionId]);
  const testNames = await db.rows(`SELECT id, test_name FROM test`);
  const anc = {};
  for (const s of steps) { s.config = s.config || {}; s.deps = deps.filter((d) => d.step_key === s.step_key).map((d) => d.dep); s.equipment = eq.filter((e) => e.step_key === s.step_key); s.base_fields = pgList(s.base_fields); }
  const byKey = Object.fromEntries(steps.map((s) => [s.step_key, s]));
  // L-2 (migration 035): a formula token that is not one of its step's own fields is a value published by the logbook entry of
  // the lot scanned at that step ({inoc.cfu_added}). The protocol picks, per analyte, a usable lot at the lab whose approved
  // entry publishes it (a lot naming organisms serves only them), and the run scans those lots.
  const material = {};
  const want = new Set();
  for (const cs of steps.filter((x) => x.step_type === 'Calculation')) {
    for (const f of [cs.config.formula, ...(cs.config.overrides || []).map((o) => o.formula)]) {
      for (const tok of formulaTokens(f)) { const [k, fld] = tok.split('.'); const ref = byKey[k]; if (ref && fld && !ref.base_fields.includes(fld)) want.add(k + '.' + fld); }
    }
  }
  for (const tok of want) {
    const [k, fld] = tok.split('.');
    const cand = await db.rows(`SELECT l.id AS lot_id, l.lot_code, COALESCE(l.item_name, '') AS item_name, e.id AS entry_id, e.entry_code, (e.entry_values->>$2) AS value,
          to_char(e.valid_until, 'YYYY-MM-DD HH24:MI') AS valid_until, lb.logbook_code,
          COALESCE((SELECT array_agg(la.analyte_id::text) FROM lot_analyte la WHERE la.lot_id = l.id AND la.status = 'Active'), '{}') AS analytes
        FROM inventory_lot l JOIN logbook_entry e ON e.lot_id = l.id AND e.status <> 'Voided' JOIN logbook lb ON lb.id = e.logbook_id
       WHERE l.site_id = $1 AND l.status::text = 'Available' AND l.receipt_status::text = 'Received'
         AND (l.expiration_date IS NULL OR l.expiration_date >= site_today(l.site_id))
         AND (e.status = 'Approved' OR lb.review_route = 'Batch') AND (e.valid_until IS NULL OR e.valid_until > clock_timestamp() + interval '30 minutes')
         AND jsonb_typeof(e.entry_values->$2) = 'number'
       ORDER BY e.entry_at DESC`, [v.site_id, fld]);
    cand.forEach((c) => { c.analytes = pgList(c.analytes); });
    const per = {};
    for (const a of analytes) {
      const own = cand.find((c) => c.analytes.includes(a.analyte_id));
      if (own) per[a.analyte_id] = own;
    }
    // a lot that names no organism serves every analyte: used only when no analyte has a lot of its own (two lots would clash)
    const generic = cand.find((c) => !c.analytes.length);
    if (!Object.keys(per).length && generic) for (const a of analytes) per[a.analyte_id] = generic;
    material[k] = material[k] || {};
    for (const [aid, c] of Object.entries(per)) {
      material[k][aid] = material[k][aid] || {};
      material[k][aid][fld] = { lot_id: c.lot_id, lot_code: c.lot_code, item_name: c.item_name, entry_id: c.entry_id, entry_code: c.entry_code, logbook_code: c.logbook_code, value: String(c.value), valid_until: c.valid_until };
    }
  }
  const ancestors = (k) => { if (anc[k]) return anc[k]; const out = new Set(); for (const d of (byKey[k] || {}).deps || []) { out.add(d); for (const x of ancestors(d)) out.add(x); } anc[k] = out; return out; };
  for (const s of steps) s.ancestors = [...ancestors(s.step_key)];
  const calcs = steps.filter((s) => s.step_type === 'Calculation').sort((a, b) => a.n_anc - b.n_anc || a.sort_order - b.sort_order);
  const finalCalc = calcs.length ? [...calcs].sort((a, b) => b.n_anc - a.n_anc || b.sort_order - a.sort_order)[0].step_key : null;
  // the order the bench works in: dependencies first, then the designer's order
  const order = []; const done = new Set();
  const visit = (s) => { if (done.has(s.step_key)) return; done.add(s.step_key); for (const d of s.deps) if (byKey[d]) visit(byKey[d]); order.push(s); };
  for (const s of steps) visit(s);
  const testName = (id) => (testNames.find((x) => x.id === id) || {}).test_name || 'the other test';
  return { version: v, analytes, steps, byKey, calcs, finalCalc, order, qc, testName, hash: v.hash, material, materialTokens: [...want] };
}
const formulaFor = (calc, analyteId) => {
  const o = (calc.config.overrides || []).find((x) => x.analyte_id === analyteId);
  return o && o.formula ? o.formula : calc.config.formula;
};
const timepointSteps = (D) => D.steps.filter((s) => s.step_type === 'QC Review' && (s.config.scope || 'Batch') === 'Timepoint'
  && !(D.finalCalc && s.ancestors.includes(D.finalCalc))
  && s.ancestors.some((k) => D.byKey[k].step_type === 'Calculation' && k !== D.finalCalc));
const timepointKeys = (D, s) => D.steps.filter((x) => s.ancestors.includes(x.step_key) && x.step_type === 'Calculation' && x.step_key !== D.finalCalc)
  .sort((a, b) => a.sort_order - b.sort_order).map((x) => x.step_key);
const readsAnalyte = (s, analyteId) => { const ids = s.config.analyte_ids; return !ids || !ids.length || ids.includes(analyteId); };

// ============================================================ the independent calculation of one entry
// inputs: { weigh: {step: '0.5'}, dil: {step: [fields]}, read: {step: {analyte_id: '10'}} } plus the batch's
// preparation fields and incubation durations. Returns every calculation per analyte, and the final reported result.
function calculateEntry(D, batchInputs, inputs) {
  const out = {};
  for (const a of D.analytes) {
    const r = { calcs: {}, final: null };
    if (!D.calcs.length || a.result_type !== 'Numeric') {
      // no calculation, or a qualitative / text / count result: the result is the last reading of the analyte
      const de = D.steps.filter((s) => s.step_type === 'Data Entry' && readsAnalyte(s, a.analyte_id)).sort((x, y) => y.sort_order - x.sort_order)[0];
      const raw = de ? (inputs.read[de.step_key] || {})[a.analyte_id] : undefined;
      if (a.result_type === 'Numeric') {
        const v = raw === undefined || raw === null ? null : Q.of(raw);
        r.final = { value: v, value_text: null, reported: v ? reportValue(v, a, D.version) : null, waiting: v ? null : 'no reading' };
      } else r.final = { value: null, value_text: raw ?? null, reported: raw ?? null, waiting: raw ? null : 'no reading' };
      out[a.analyte_id] = r; continue;
    }
    const calc = {};
    for (const cs of D.calcs) {
      const f = formulaFor(cs, a.analyte_id); const vals = {}; const miss = [];
      for (const tok of formulaTokens(f)) {
        const [k, fld] = tok.split('.'); const ref = D.byKey[k]; let v = null;
        if (!ref) { miss.push('{' + tok + '}'); continue; }
        if (ref.base_fields && fld && !ref.base_fields.includes(fld)) {
          // a value published by the logbook entry of the lot the protocol scans at that step (L-2)
          const m = (((batchInputs.mat || {})[k] || {})[a.analyte_id] || {})[fld];
          v = m ? m.value : null;
          if (v === null || v === undefined) { miss.push('{' + tok + '} (no usable lot at the lab publishes ' + fld + ' for ' + a.analyte_name + ')'); continue; }
          vals[tok] = Q.of(v); continue;
        }
        if (ref.step_type === 'Weighing') v = (inputs.weigh || {})[k] ?? null;
        else if (ref.step_type === 'Dilution') { const fl = (inputs.dil || {})[k]; const q = fl ? (fld === 'factor' ? dilutionFactor(fl) : dilutionFinalVolume(fl)) : null; v = q; }
        else if (ref.step_type === 'Preparation') { const x = ((batchInputs.prep || {})[k] || {})[fld]; v = x !== undefined && /^\s*-?[0-9]*\.?[0-9]+\s*$/.test(String(x)) ? String(x) : null; }
        else if (ref.step_type === 'Incubation') v = ((batchInputs.inc || {})[k] || {}).duration ?? null;
        else if (ref.step_type === 'Data Entry') v = readsAnalyte(ref, a.analyte_id) ? ((inputs.read[k] || {})[a.analyte_id] ?? null) : null;
        else if (ref.step_type === 'Calculation') v = calc[k] ? calc[k].value : null;
        else if (ref.step_type === 'Hold Point') { v = null; miss.push('{' + tok + '} (waits for ' + D.testName(ref.config.test_id) + ')'); continue; }
        if (v === null || v === undefined) miss.push('{' + tok + '}'); else vals[tok] = v instanceof Q ? v : Q.of(v);
      }
      let value = null; let error = null;
      if (!miss.length) { try { value = evaluate(f, vals); } catch (e) { error = e.message; } } else error = 'Waiting for ' + miss.join(', ');
      calc[cs.step_key] = { value, error, formula: f, inputs: Object.fromEntries(Object.entries(vals).map(([k, x]) => [k, x.toString()])) };
    }
    r.calcs = calc;
    const fin = D.finalCalc ? calc[D.finalCalc] : null;
    r.final = fin && fin.value ? { value: fin.value, value_text: null, reported: reportValue(fin.value, a, D.version), waiting: null }
      : { value: null, value_text: null, reported: null, waiting: fin ? fin.error : 'no calculation' };
    out[a.analyte_id] = r;
  }
  return out;
}

// ============================================================ the protocol: samples, inputs, expected results, requirements, checks
const qcLabel = (q) => `${q.qc_type}${(q.frequency || 'Once') === 'Once' && Number(q.count || 1) > 1 ? ' x' + q.count : ''} (${(q.frequency || 'Once') === 'Every N' ? 'every ' + (q.every_n || 10) + ' samples, opening and closing' : (q.frequency || 'Once').toLowerCase()})`;
function baseWeight(s) {
  const c = s.config;
  if ((c.target_mode === 'Single' || (!c.target_mode && c.target !== undefined && c.target !== null)) && c.target !== undefined && c.target !== null) return Q.of(String(c.target)).toInput(8);
  if (c.target_mode === 'By product category' && (c.by_category || []).some((y) => y.min !== null && y.min !== undefined && y.max !== null && y.max !== undefined)) {
    const x = c.by_category.find((y) => y.min !== null && y.min !== undefined && y.max !== null && y.max !== undefined); return Q.of(String(x.min)).add(Q.of(String(x.max))).div(new Q(2n)).toInput(8);
  }
  return '1';
}
function baseDilution(s) {
  const c = s.config; const n = (x, d) => (x === undefined || x === null || x === '' ? d : String(x));
  if (c.mode === 'Serial') {
    const f = [{ aliquot: n(c.initial_amount, '1'), diluent: n(c.initial_diluent, '9') }];
    for (let i = 1; i < Math.max(Number(c.depth) || 1, 1); i += 1) f.push({ aliquot: n(c.transfer_aliquot, '1'), diluent: n(c.transfer_diluent, '9') });
    return f;
  }
  if (c.aliquot !== undefined && c.aliquot !== null && c.aliquot !== '') return [{ aliquot: String(c.aliquot), diluent: n(c.diluent, '0') }];
  if ((c.by_category || []).length) return [{ aliquot: n(c.by_category[0].aliquot, '1'), diluent: n(c.by_category[0].diluent, '9') }];
  return [{ aliquot: '1', diluent: '9' }];
}
function prepValue(f) {
  const t = f.type || 'Text'; const l = String(f.label || '').toLowerCase();
  if (t === 'Number') return l.includes('temperature') ? '95' : l.includes('volume') ? '50' : '10';
  if (t === 'Time') return '08:00';
  if (t === 'Date') return new Date().toISOString().slice(0, 10);
  return 'Verification run';
}
function incubationOf(s) {
  const c = s.config; const unit = c.duration_unit || 'hours';
  let d = c.duration !== undefined && c.duration !== null ? Q.of(String(c.duration)) : null;
  const lo = c.window_min !== undefined && c.window_min !== null ? Q.of(String(c.window_min)) : null;
  const hi = c.window_max !== undefined && c.window_max !== null ? Q.of(String(c.window_max)) : null;
  if (!d || (lo && d.cmp(lo) < 0) || (hi && d.cmp(hi) > 0)) d = lo && hi ? lo.add(hi).div(new Q(2n)) : lo || hi || new Q(24n);
  return { duration: d.toInput(8), unit, temperature: c.temp_c !== undefined && c.temp_c !== null ? String(c.temp_c) : null };
}
// The Data Entry step whose reading moves the analyte's final result (the latest one the final formula reaches)
function steeringStep(D, a) {
  if (!D.finalCalc || a.result_type !== 'Numeric') return null;
  const seen = new Set(); const reads = [];
  const walk = (calcKey) => {
    if (seen.has(calcKey)) return; seen.add(calcKey);
    for (const tok of formulaTokens(formulaFor(D.byKey[calcKey], a.analyte_id))) {
      const k = tok.split('.')[0]; const ref = D.byKey[k]; if (!ref) continue;
      if (ref.step_type === 'Data Entry' && readsAnalyte(ref, a.analyte_id)) reads.push(ref);
      if (ref.step_type === 'Calculation') walk(k);
    }
  };
  walk(D.finalCalc);
  return reads.sort((x, y) => y.sort_order - x.sort_order)[0] || null;
}
const BASE_READING = '10';
function niceUp(q) { // a round limit at or above q (1, 2 or 5 times a power of ten)
  const x = q.abs(); const k = x.log10Floor(); const p = k >= 0 ? new Q(10n ** big(k)) : new Q(1n, 10n ** big(-k));
  for (const m of [1n, 2n, 5n, 10n]) { const c = p.mul(new Q(m)); if (c.cmp(x) >= 0) return q.cmp(new Q(0n)) < 0 ? c.neg() : c; }
  return x;
}

function buildPlan(D) {
  const batch = { prep: {}, inc: {}, mat: D.material || {} };
  for (const s of D.steps) {
    if (s.step_type === 'Preparation') batch.prep[s.step_key] = Object.fromEntries((s.config.fields || []).filter((f) => f.label).map((f) => [fieldKey(f.label), prepValue(f)]));
    if (s.step_type === 'Incubation') batch.inc[s.step_key] = incubationOf(s);
  }
  const baseInputs = () => {
    const x = { weigh: {}, dil: {}, plates: {}, read: {} };
    for (const s of D.steps) {
      if (s.step_type === 'Weighing') x.weigh[s.step_key] = baseWeight(s);
      if (s.step_type === 'Dilution') x.dil[s.step_key] = baseDilution(s);
      if (s.step_type === 'Plating/Inoculation') x.plates[s.step_key] = String(Math.max(Number(s.config.plates_per_entry) || 1, 1));
      if (s.step_type === 'Data Entry') {
        x.read[s.step_key] = {};
        for (const a of D.analytes) {
          if (!readsAnalyte(s, a.analyte_id)) continue;
          if (a.result_type === 'Numeric') x.read[s.step_key][a.analyte_id] = BASE_READING;
          else if (a.result_type === 'Count') x.read[s.step_key][a.analyte_id] = '25';
          else if (a.result_type === 'Qualitative') x.read[s.step_key][a.analyte_id] = a.result_values.find((v) => !a.found_values.includes(v)) || a.result_values[0] || 'Absent';
          else x.read[s.step_key][a.analyte_id] = 'Verification text';
        }
      }
    }
    return x;
  };
  const finalOf = (inputs, a) => calculateEntry(D, batch, inputs)[a.analyte_id].final;
  // a reading that brings the analyte's final result to the target (searched on a log scale, then bisected)
  const steer = (inputs, a, target, isCount) => {
    const st = steeringStep(D, a); if (!st) return null;
    const f = (r) => { const x = JSON.parse(JSON.stringify(inputs)); x.read[st.step_key][a.analyte_id] = r; const v = finalOf(x, a).value; return v ? v.num() : null; };
    const t = target.num(); let lo = null; let hi = null; let prev = null;
    for (let k = -8; k <= 10; k += 0.25) {
      const r = Math.pow(10, k); const y = f(Q.fromDouble(r).toInput(12));
      if (y !== null && Number.isFinite(y)) { if (prev && (prev.y - t) * (y - t) <= 0) { lo = prev.r; hi = r; break; } prev = { r, y }; }
    }
    if (lo === null) return null;
    const ylo = f(Q.fromDouble(lo).toInput(12)) - t;
    for (let i = 0; i < 80; i += 1) { const m = Math.sqrt(lo * hi); const y = f(Q.fromDouble(m).toInput(12)) - t; if ((y < 0) === (ylo < 0)) lo = m; else hi = m; }
    const r = Math.sqrt(lo * hi);
    return isCount ? String(Math.max(Math.round(r), 0)) : Q.fromDouble(r).toInput(6);
  };
  // keeps a value clear of rounding and LOQ boundaries, so the comparison is fair to both calculations
  const safe = (v, a) => {
    if (!v) return true;
    const up = v.mul(Q.of('1.00000001')); const dn = v.mul(Q.of('0.99999999'));
    return reportValue(up, a, D.version) === reportValue(dn, a, D.version);
  };
  const samples = []; const specs = {};
  const typical = baseInputs();
  // the typical sample: within the LOQ and the specification
  const notes = {};
  for (const a of D.analytes.filter((x) => x.result_type === 'Numeric')) {
    let v = finalOf(typical, a).value; const loq = a.loq !== null ? Q.of(a.loq) : null;
    const dmax = a.default_spec_max !== null ? Q.of(a.default_spec_max) : null; const dmin = a.default_spec_min !== null ? Q.of(a.default_spec_min) : null;
    let target = null;
    if (v && loq && v.cmp(loq.mul(new Q(2n))) < 0) target = loq.mul(new Q(10n));
    if (v && dmax && (target || v).cmp(dmax) >= 0) target = dmax.mul(Q.of('0.5'));
    if (v && dmin && (target || v).cmp(dmin) <= 0) target = dmin.cmp(new Q(0n)) > 0 ? dmin.mul(new Q(2n)) : dmin.add(new Q(1n));
    if (target && loq && target.cmp(loq) < 0 && dmax) target = loq.add(dmax).div(new Q(2n));
    if (target) { const st = steeringStep(D, a); const r = steer(typical, a, target, false); if (st && r !== null) typical.read[st.step_key][a.analyte_id] = r; }
    v = finalOf(typical, a).value;
    for (let i = 0; i < 5 && v && !safe(v, a); i += 1) { const st = steeringStep(D, a); if (!st) break; typical.read[st.step_key][a.analyte_id] = Q.of(typical.read[st.step_key][a.analyte_id]).mul(Q.of('1.0007')).toInput(7); v = finalOf(typical, a).value; }
    // the specification the run puts on its samples: the test's usual limits, else limits around the typical result
    if (dmin || dmax) specs[a.analyte_id] = { min: dmin ? dmin.toString() : null, max: dmax ? dmax.toString() : null, text: null, unit: a.reporting_unit || null, source: 'the test\'s usual limits' };
    else if (v) specs[a.analyte_id] = v.cmp(new Q(0n)) > 0 ? { min: null, max: niceUp(v.mul(new Q(2n))).toString(), text: null, unit: a.reporting_unit || null, source: 'set by the protocol (twice the typical result, rounded up)' }
      : { min: v.sub(new Q(1n)).toInput(6), max: null, text: null, unit: a.reporting_unit || null, source: 'set by the protocol (the typical result less 1)' };
  }
  for (const a of D.analytes.filter((x) => x.result_type === 'Qualitative')) {
    specs[a.analyte_id] = { min: null, max: null, text: a.default_spec_text || a.result_values.find((v) => !a.found_values.includes(v)) || 'Absent', unit: null, source: a.default_spec_text ? 'the test\'s usual limit' : 'set by the protocol (not found)' };
  }
  samples.push({ key: 'S1', case: 'Typical', description: 'Automated verification sample: typical result, within the specification', inputs: typical });
  // below the LOQ (and below the LOD when the test reports ND)
  const withLoq = D.analytes.filter((a) => a.result_type === 'Numeric' && a.loq !== null && steeringStep(D, a));
  const caseSample = (key, kase, description, targetOf) => {
    const x = JSON.parse(JSON.stringify(typical)); const steered = [];
    for (const a of D.analytes) {
      const target = targetOf(a); if (!target) continue;
      const st = steeringStep(D, a); if (!st) continue;
      const r = steer(x, a, target, false); if (r === null) continue;
      x.read[st.step_key][a.analyte_id] = r; steered.push(a.analyte_id);
      let v = finalOf(x, a).value;
      for (let i = 0; i < 5 && v && !safe(v, a); i += 1) { x.read[st.step_key][a.analyte_id] = Q.of(x.read[st.step_key][a.analyte_id]).mul(Q.of('1.0007')).toInput(7); v = finalOf(x, a).value; }
    }
    if (kase === 'Outside the specification') {
      for (const a of D.analytes.filter((y) => y.result_type === 'Qualitative')) {
        for (const s of D.steps.filter((y) => y.step_type === 'Data Entry' && readsAnalyte(y, a.analyte_id))) x.read[s.step_key][a.analyte_id] = a.found_values[0] || 'Present';
        steered.push(a.analyte_id);
      }
    }
    if (steered.length) samples.push({ key, case: kase, description, inputs: x, steered });
  };
  if (withLoq.length) {
    const nd = D.version.nd_below_lod;
    caseSample('S2', 'Below the LOQ', 'Automated verification sample: result below the LOQ', (a) => (a.result_type === 'Numeric' && a.loq !== null
      ? (nd && a.lod !== null ? Q.of(a.lod).add(Q.of(a.loq)).div(new Q(2n)) : Q.of(a.loq).mul(Q.of('0.5'))) : null));
  }
  caseSample('S3', 'Outside the specification', 'Automated verification sample: result outside the specification', (a) => {
    const sp = specs[a.analyte_id]; if (!sp || a.result_type !== 'Numeric') return null;
    if (sp.max !== null) { const m = Q.of(sp.max); return m.cmp(new Q(0n)) > 0 ? m.mul(Q.of('1.5')) : m.add(new Q(1n)); }
    if (sp.min !== null) { const m = Q.of(sp.min); return m.cmp(new Q(0n)) > 0 ? m.mul(Q.of('0.5')) : m.sub(new Q(1n)); }
    return null;
  });
  if (D.version.nd_below_lod && D.analytes.some((a) => a.result_type === 'Numeric' && a.lod !== null && steeringStep(D, a))) {
    caseSample('S4', 'Below the LOD', 'Automated verification sample: result below the LOD (reported ND)', (a) => (a.result_type === 'Numeric' && a.lod !== null ? Q.of(a.lod).mul(Q.of('0.5')) : null));
  }
  for (const s of samples) {
    s.specs = Object.entries(specs).map(([analyte_id, sp]) => ({ analyte_id, min: sp.min, max: sp.max, text: sp.text, unit: sp.unit }));
    s.expected = calculateEntry(D, batch, s.inputs);
  }
  return { batch, samples, specs, typical };
}

// Requirements (URS: what the lab needs; FRS: what the workflow does) and the checks that test them
function buildProtocol(D) {
  const plan = buildPlan(D);
  const V = D.version; const reqs = []; const checks = [];
  let nu = 0; let nf = 0; let nc = 0;
  const urs = (statement, source) => { nu += 1; const code = 'URS-' + String(nu).padStart(2, '0'); reqs.push({ req_code: code, kind: 'URS', statement, source, traces: [] }); return code; };
  const frs = (statement, source, traces) => { nf += 1; const code = 'FRS-' + String(nf).padStart(2, '0'); reqs.push({ req_code: code, kind: 'FRS', statement, source, traces: traces.filter(Boolean) }); return code; };
  const check = (c) => { nc += 1; checks.push({ check_code: 'VC-' + String(nc).padStart(2, '0'), ...c }); };
  const bs = D.steps.find((s) => s.step_type === 'Batching');
  const qcCfg = bs ? (bs.config.qc || []) : [];
  const unitOf = (a) => (a.reporting_unit ? ' ' + a.reporting_unit : '');
  const rounding = (a) => { const m = a.rounding_mode || V.rounding_mode; const d = a.rounding_digits ?? V.rounding_digits; return `${d} ${m === 'Decimal places' ? 'decimal place' + (d === 1 ? '' : 's') : 'significant figure' + (d === 1 ? '' : 's')}`; };

  // ---- URS
  const uTest = urs(`${D.version.test_name} (version ${V.version_no}) tests a sample for ${D.analytes.map((a) => a.analyte_name).join(', ')} at ${V.site_code}${V.method_name ? ', by ' + V.method_name : ''}, and reports one approved result for each.`, 'The test, its method and its analytes');
  const uAnalyte = {};
  for (const a of D.analytes) {
    if (a.result_type === 'Numeric') {
      uAnalyte[a.analyte_id] = urs(`${a.analyte_name} is reported${a.reporting_unit ? ' in ' + a.reporting_unit : ''}, rounded to ${rounding(a)}${a.loq !== null ? `; a result below the LOQ (${a.loq}${unitOf(a)}) is reported as "< ${a.loq}"` : ''}${V.nd_below_lod && a.lod !== null ? `, and below the LOD (${a.lod}${unitOf(a)}) as "ND"` : ''}.`, `Analyte ${a.analyte_name}: unit, rounding, LOQ and LOD`);
    } else {
      uAnalyte[a.analyte_id] = urs(`${a.analyte_name} is reported as recorded (${a.result_type.toLowerCase()} result${a.result_type === 'Qualitative' ? ': ' + a.result_values.join(', ') + '; found means ' + a.found_values.join(' or ') : ''}).`, `Analyte ${a.analyte_name}: result type`);
    }
  }
  const uSpec = urs('Each result is compared with the sample\'s specification; a result outside it is reported as not conforming ("< LOQ" counts as below any limit).', 'Specifications on requested tests');
  const uQc = qcCfg.length ? urs(`Samples are tested in batches of at most ${bs.config.max_samples || 500}, with ${qcCfg.map(qcLabel).join(', ')}; each QC is judged against its acceptance criteria.`, 'Batching step: maximum and QC') : null;
  const uIntegrity = urs('Every bench step is done by a person in the step\'s department, recorded under their name and signed when completed (with a witness where the step needs one); a step cannot be completed with data missing; every recorded value is in the audit trail.', 'Data integrity (21 CFR Part 11)');
  const uReview = urs('A different person reviews each step and approves the results before they are reported; nobody reviews work they did.', 'QC Review');
  const tps = timepointSteps(D);
  const uTime = tps.length ? urs(`Interim results (${tps.map((s) => s.step_name).join(', ')}) are reviewed and released as preliminary results; the final approval keeps them unchanged.`, 'Timepoint reviews') : null;
  const splits = D.steps.filter((s) => s.step_type === 'Split off Test');
  const uSplit = {}; for (const s of splits) uSplit[s.step_key] = urs(`${D.testName(s.config.test_id)} is ${s.config.trigger === 'On finding' ? 'split off for a sample with a finding (' + (s.config.finding || 'Present') + ')' : 'split off for every sample'}${s.config.consent_required === false ? ', ordered at once' : ', with the customer\'s consent'}.`, 'Step ' + s.step_name);
  const holds = D.steps.filter((s) => s.step_type === 'Hold Point');
  const uHold = {}; for (const s of holds) uHold[s.step_key] = urs(`${s.step_name} waits for the ${D.testName(s.config.test_id)} result on the same sample.`, 'Step ' + s.step_name);
  const uOrder = urs('The order shows Approved once every test on it has approved results.', 'Order statuses');

  // ---- FRS per step
  const fStep = {};
  const eqText = (s) => (s.equipment.length ? ` with the ${s.equipment.map((e) => e.type_name).join(' or ')} used (available and in calibration)` : '');
  const witness = (s) => (s.config.witness === 'Required' ? '; a witness signs too' : '');
  for (const s of D.order) {
    const c = s.config; const dept = s.department_name ? ` (${s.department_name})` : ''; let text = '';
    switch (s.step_type) {
      case 'Batching': text = `${s.step_name}${dept} makes a batch from the backlog of at most ${c.max_samples || 500} samples${qcCfg.length ? ' and adds ' + qcCfg.map(qcLabel).join(', ') : ''}.`; break;
      case 'Weighing': text = `${s.step_name}${dept} records ${Number(c.replicates) > 1 ? `${c.replicates} weights (their average is the step's weight)` : 'a weight'} in ${c.unit || 'g'} for each sample and prep QC${eqText(s)}${witness(s)}.`; break;
      case 'Preparation': text = `${s.step_name}${dept} records ${(c.fields || []).length ? (c.fields || []).map((f) => f.label).join(', ') : 'that it was done'} once for the batch${witness(s)}.`; break;
      case 'Dilution': text = `${s.step_name}${dept} records each sample's dilution (aliquot and diluent${c.mode === 'Serial' ? ', serial' : ''}); the dilution factor multiplies the steps${witness(s)}.`; break;
      case 'Plating/Inoculation': text = `${s.step_name}${dept} records the plates for each sample and prep QC, and the media lot used${witness(s)}.`; break;
      case 'Incubation': text = `${s.step_name}${dept} records incubator loads${eqText(s)}: time in, time out and temperature, against ${c.temp_c ?? '?'} ± ${c.temp_tolerance ?? 0} °C for ${c.window_min ?? '?'} to ${c.window_max ?? '?'} ${c.duration_unit || 'hours'}${witness(s)}.`; break;
      case 'Data Entry': text = `${s.step_name}${dept} records ${c.value_label || 'the reading'}${c.value_unit ? ' in ' + c.value_unit : ''} for every entry and analyte${(c.analyte_ids || []).length ? ' (' + D.analytes.filter((a) => readsAnalyte(s, a.analyte_id)).map((a) => a.analyte_name).join(', ') + ')' : ''}${c.require_attachment === false ? '' : ', with the raw data file'}${eqText(s)}${witness(s)}.`; break;
      case 'Calculation': text = `${s.step_name} calculates ${c.formula || '(no formula)'}${(c.overrides || []).length ? ' (own formula for ' + (c.overrides || []).map((o) => (D.analytes.find((a) => a.analyte_id === o.analyte_id) || {}).analyte_name + ': ' + o.formula).join('; ') + ')' : ''}${c.result_unit ? ', in ' + c.result_unit : ''}${s.step_key === D.finalCalc ? '; it is the test\'s final result' : ''}.`; break;
      case 'Split off Test': text = `${s.step_name}${dept}: completing it raises a request to order ${D.testName(c.test_id)} for ${c.trigger === 'On finding' ? 'each sample with ' + (c.finding || 'a finding') + ' in ' + (c.finding_steps || []).join(', ') : 'every sample'}.`; break;
      case 'Hold Point': text = `${s.step_name}${dept} cannot be completed until the ${D.testName(c.test_id)} result on the same sample is ready.`; break;
      case 'QC Review': text = (c.scope || 'Batch') === 'Timepoint' && tps.includes(s)
        ? `${s.step_name} (timepoint review): once the steps before it are completed and approved, the reviewer releases ${timepointKeys(D, s).map((k) => D.byKey[k].step_name).join(', ')} as preliminary results (signed).`
        : `${s.step_name}: the reviewer approves each step, chooses the reportable reading, accepts or rejects QC, and approves the batch (signed); the results are stored as final.`; break;
      default: text = `${s.step_name} (${s.step_type}).`;
    }
    const traces = [uIntegrity];
    if (s.step_type === 'Batching') traces.push(uQc || uTest);
    if (s.step_type === 'Calculation') for (const a of D.analytes) if (a.result_type === 'Numeric') traces.push(uAnalyte[a.analyte_id]);
    if (s.step_type === 'QC Review') traces.push(uReview, (s.config.scope || 'Batch') === 'Timepoint' ? uTime : uTest);
    if (s.step_type === 'Split off Test') traces.push(uSplit[s.step_key]);
    if (s.step_type === 'Hold Point') traces.push(uHold[s.step_key]);
    if (s.step_type === 'Data Entry' || s.step_type === 'Weighing') traces.push(uTest);
    fStep[s.step_key] = frs(text, 'Step ' + s.step_name + ' (' + s.step_type + ')', [...new Set(traces)]);
  }
  const fQc = {};
  const crit = {}; for (const q of D.qc) { const k = q.qc_type + '|' + q.limit_type; (crit[k] = crit[k] || []).push(q); }
  for (const [k, rows] of Object.entries(crit)) {
    const [t, l] = k.split('|'); const ap = rows.filter((r) => r.applies);
    const lim = (r) => (r.min_value !== null && r.max_value !== null ? `${r.min_value} to ${r.max_value}` : r.max_value !== null ? `at most ${r.max_value}` : r.limit_ref ? `below ${r.limit_ref}` : r.min_value !== null ? `at least ${r.min_value}` : l);
    const limits = [...new Set(ap.map(lim))];
    fQc[k] = frs(`${t} is judged on ${l}: ${limits.length === 1 ? limits[0] + ' for ' + (ap.length === D.analytes.length ? 'every analyte' : ap.map((r) => r.analyte_name).join(', ')) : ap.map((r) => r.analyte_name + ' ' + lim(r)).join('; ')}; a failed or missing QC result stops the approval until the reviewer accepts it with a justification.`, 'Batching step QC criteria', [uQc]);
  }
  const fConf = frs('The final result is compared with the sample\'s specification (in the result\'s unit) and stored with Conforms, Does not conform or No specification.', 'QC Review: specification comparison', [uSpec]);
  const fOrder = frs('The order\'s status follows its tests: In Testing while batched, In Review when nothing is left at the bench, Approved when every test has final results.', 'Order statuses', [uOrder]);

  // ---- the batches the run will make, and their QC
  const maxS = bs ? Number(bs.config.max_samples) || 500 : 500;
  const keys = plan.samples.map((s) => s.key); const batches = [];
  for (let i = 0; i < keys.length; i += maxS) batches.push(keys.slice(i, i + maxS));
  const expectQc = (n, first) => {
    const out = [];
    for (const q of qcCfg) {
      const f = q.frequency || 'Once';
      if (f === 'Once') { const c = Number(q.count) || 1; for (let i = 1; i <= c; i += 1) out.push(q.qc_type + (c > 1 ? ' ' + i : '')); }
      else if (f === 'Every N') { const e = Math.max(Number(q.every_n) || 10, 1); const k = Math.ceil(n / e) + 1; for (let i = 1; i <= k; i += 1) out.push(q.qc_type + '-' + i); }
      else if (f === 'Daily') out.push(q.qc_type + (first ? ' (daily)' : ' (daily, from the first batch)'));
    }
    return out;
  };
  check({ case_label: 'Process', title: 'The samples are in the backlog and batches are made from it with the Batching step\'s QC',
    procedure_text: 'Order and log the samples below (internal client, codes VER-...); the automated analyst makes batches from the backlog until it is empty.',
    requirement_codes: [uTest, uQc, fStep[bs ? bs.step_key : D.order[0].step_key]].filter(Boolean),
    inputs: { kind: 'batches' }, expected: { text: batches.map((b, i) => `Batch ${i + 1}: ${b.join(', ')}${expectQc(b.length, i === 0).length ? ' with ' + expectQc(b.length, i === 0).join(', ') : ''}`).join('; '),
      batches: batches.map((b, i) => ({ samples: b, qc: expectQc(b.length, i === 0) })) } });
  const firstWork = D.order.find((s) => ['Weighing', 'Dilution', 'Data Entry', 'Plating/Inoculation', 'Incubation'].includes(s.step_type) || (s.step_type === 'Preparation' && (s.config.fields || []).length));
  if (firstWork) check({ case_label: 'Process', title: `"${firstWork.step_name}" cannot be completed while its data are missing`, procedure_text: `Before entering anything, try to complete ${firstWork.step_name} (signed).`,
    requirement_codes: [uIntegrity, fStep[firstWork.step_key]], inputs: { kind: 'refuse_incomplete', step_key: firstWork.step_key }, expected: { text: 'Refused: the step cannot be completed yet' } });
  for (const s of D.order) {
    if (s.step_type === 'QC Review') continue;
    if (s.step_type === 'Hold Point') {
      check({ case_label: 'Process', title: `"${s.step_name}" waits for ${D.testName(s.config.test_id)}`, procedure_text: `Try to complete ${s.step_name} before the other test has a result.`,
        requirement_codes: [uHold[s.step_key], fStep[s.step_key]], inputs: { kind: 'hold', step_key: s.step_key }, expected: { text: 'Refused while the other test\'s result is not ready (the steps after it cannot be tested in this run)' } });
      continue;
    }
    const lots = stepLots(s, plan, D);
    const lacking = (D.materialTokens || []).filter((x) => x.startsWith(s.step_key + '.')).flatMap((x) => D.analytes.filter((a) => !((((plan.batch.mat || {})[s.step_key] || {})[a.analyte_id] || {})[x.split('.')[1]])).map((a) => `${x.split('.')[1]} for ${a.analyte_name}`));
    check({ case_label: 'Process', title: `"${s.step_name}" is completed and signed Performed by${s.config.witness === 'Required' ? ' and Witnessed by' : ''}`,
      procedure_text: describeStep(s, plan) + (lots.length || lacking.length ? ` Scan the logbook lots the calculation reads${lots.length ? ': ' + lots.join('; ') : ''}${lacking.length ? `. No usable lot at the lab gives ${lacking.join(', ')} (record and approve one in its logbook, then write the protocol again)` : ''}.` : ''),
      requirement_codes: [uIntegrity, fStep[s.step_key]], inputs: { kind: 'step', step_key: s.step_key, values: { ...stepInputs(s, plan), ...(lots.length ? { 'Logbook lots': lots.join('; ') } : {}) } },
      expected: { text: `Completed in every batch by the Verification analyst, signed "Performed by"${s.config.witness === 'Required' ? ' and "Witnessed by"' : ''}` } });
    if (s.step_type === 'Split off Test') {
      const finding = plan.samples.filter((x) => (s.config.trigger !== 'On finding') || (s.config.finding_steps || []).some((k) => Object.values((x.inputs.read[k] || {})).some((v) => D.analytes.some((a) => a.found_values.includes(v)))));
      check({ case_label: 'Process', title: `"${s.step_name}" raises a split-off request for each sample with a finding, and only for them`, procedure_text: 'Complete the step, then read the split-off requests of the batch.',
        requirement_codes: [uSplit[s.step_key], fStep[s.step_key]], inputs: { kind: 'split', step_key: s.step_key },
        expected: { text: finding.length ? 'Requests for ' + finding.map((x) => x.key).join(', ') + ' only' : 'No request (no sample has a finding)', samples: finding.map((x) => x.key) } });
    }
  }
  // QC
  for (const [k, rows] of Object.entries(crit)) {
    const [t, l] = k.split('|'); if (!rows.some((r) => r.applies)) continue;
    const solve = l === 'Recovery %' ? 'readings set so the recovery is 100 % (from the standard or spike recorded)' : l === 'Blank threshold' ? 'reading 0' : l === 'Presence' ? 'a reading that shows growth' : l === 'Absence' ? 'a reading that shows no growth' : l === 'Identified' ? 'an identification' : l === 'RPD' ? 'the spike and its duplicate read alike' : 'a typical reading (this limit type is not judged yet)';
    check({ case_label: 'QC', title: `${t}: ${l} passes`, procedure_text: `Enter the QC readings (${solve}); at review, read the QC verdicts.`,
      requirement_codes: [uQc, fQc[k]], inputs: { kind: 'qc', qc_type: t, limit_type: l }, expected: { text: ['RSD', 'Stdev', 'Area Counts', 'Tailing Factor', 'Retention time', 'Signal-to-noise', 'Resolution'].includes(l) ? 'Not judged (the bench records it; judged in a later slice)' : 'Pass for every analyte it judges' } });
  }
  // results per sample
  const tpAll = tps.map((s) => ({ s, keys: timepointKeys(D, s) }));
  for (const smp of plan.samples) {
    for (const a of D.analytes) {
      const ex = smp.expected[a.analyte_id]; const sp = (smp.specs || []).find((x) => x.analyte_id === a.analyte_id) || null;
      // calculations before the final one
      if (a.result_type === 'Numeric') {
        for (const cs of D.calcs) {
          if (cs.step_key === D.finalCalc) continue;
          const c = ex.calcs[cs.step_key];
          check({ case_label: smp.case, sample_key: smp.key, title: `${smp.key} ${a.analyte_name}: ${cs.step_name} = ${c.value ? c.value.toString() : c.error}`,
            procedure_text: `Read the calculated ${cs.step_name} of ${smp.key} at the bench.`, requirement_codes: [fStep[cs.step_key], uAnalyte[a.analyte_id]],
            inputs: { kind: 'calc', step_key: cs.step_key, analyte_id: a.analyte_id, formula: c.formula, tokens: c.inputs },
            expected: { text: c.value ? c.value.toString() + (c.value.approx ? ' (to 9 significant figures)' : '') : 'Not calculable: ' + c.error, value: c.value ? c.value.toString() : null } });
        }
        for (const tp of tpAll) {
          for (const key of tp.keys) {
            const c = ex.calcs[key]; if (!c) continue;
            check({ case_label: smp.case, sample_key: smp.key, title: `${smp.key} ${a.analyte_name}: ${D.byKey[key].step_name} released as preliminary`,
              procedure_text: `The reviewer approves the steps before ${tp.s.step_name} and releases it (signed); read the stored result.`,
              requirement_codes: [uTime, fStep[tp.s.step_key], uAnalyte[a.analyte_id]],
              inputs: { kind: 'timepoint', step_key: tp.s.step_key, result_key: key, analyte_id: a.analyte_id },
              expected: { text: c.value ? `${reportValue(c.value, a, V)} (Preliminary)` : 'Not calculable: ' + c.error, value: c.value ? c.value.toString() : null, reported: c.value ? reportValue(c.value, a, V) : null, stage: 'Preliminary' } });
          }
        }
      }
      const fin = ex.final; const conf = fin.reported === null && fin.value_text === null ? null : conformance(sp, a, fin.reported, fin.value_text);
      const fcodes = [uTest, uAnalyte[a.analyte_id], D.finalCalc && a.result_type === 'Numeric' ? fStep[D.finalCalc] : null, sp ? uSpec : null, sp ? fConf : null].filter(Boolean);
      const spText = sp ? (sp.text ? `specification ${sp.text}` : `specification ${sp.min !== null ? 'at least ' + sp.min : ''}${sp.min !== null && sp.max !== null ? ' and ' : ''}${sp.max !== null ? 'at most ' + sp.max : ''}${sp.unit ? ' ' + sp.unit : ''}`) : 'no specification';
      check({ case_label: smp.case, sample_key: smp.key, title: `${smp.key} ${a.analyte_name}: final result ${fin.reported ?? fin.value_text ?? '(none)'}${conf ? ', ' + conf : ''}`,
        procedure_text: `After the approval, read the stored final result of ${smp.key} (${spText}).`, requirement_codes: fcodes,
        inputs: { kind: 'result', analyte_id: a.analyte_id, spec: sp, readings: Object.fromEntries(Object.entries(smp.inputs.read).map(([k, x]) => [k, x[a.analyte_id]]).filter(([, x]) => x !== undefined)) },
        expected: { text: fin.reported !== null || fin.value_text !== null ? `${fin.reported ?? fin.value_text}${a.reporting_unit && fin.reported && !/^</.test(fin.reported) && fin.reported !== 'ND' ? ' ' + a.reporting_unit : ''}, ${conf}${fin.value ? ' (unrounded ' + fin.value.toString() + ')' : ''}`
          : 'No result: ' + fin.waiting, value: fin.value ? fin.value.toString() : null, reported: fin.reported, value_text: fin.value_text, conformance: conf, stage: 'Final' } });
    }
  }
  check({ case_label: 'Process', title: 'The person who did the bench work cannot review the batch', procedure_text: 'The Verification analyst tries to approve a step in QC Review.',
    requirement_codes: [uReview, fStep[(D.steps.find((s) => s.step_type === 'QC Review' && !tps.includes(s)) || {}).step_key]].filter(Boolean), inputs: { kind: 'refuse_self_review' }, expected: { text: 'Refused: someone else must review it' } });
  check({ case_label: 'Process', title: 'The batch cannot be approved before each step is approved', procedure_text: 'The Verification reviewer tries to approve the batch (signed) before approving the steps.',
    requirement_codes: [uReview, fStep[(D.steps.find((s) => s.step_type === 'QC Review' && !tps.includes(s)) || {}).step_key]].filter(Boolean), inputs: { kind: 'refuse_unapproved' }, expected: { text: 'Refused: steps not approved yet' } });
  check({ case_label: 'Process', title: 'The reviewer approves each batch and the results are stored as final, signed Reviewed by', procedure_text: 'The Verification reviewer approves each step, accepts what needs accepting, and approves the batch (signed "Reviewed by").',
    requirement_codes: [uReview, uTest, fStep[(D.steps.find((s) => s.step_type === 'QC Review' && !tps.includes(s)) || {}).step_key]].filter(Boolean), inputs: { kind: 'approve' }, expected: { text: 'Every batch Approved by the Verification reviewer; one final result per sample and analyte' } });
  check({ case_label: 'Process', title: 'The order shows Approved', procedure_text: 'After the last approval, read the order\'s status.', requirement_codes: [uOrder, fOrder], inputs: { kind: 'order_status' }, expected: { text: 'Approved' } });
  check({ case_label: 'Process', title: 'Every recorded value and signature is in the audit trail', procedure_text: 'Count the audit entries of the values recorded in the batches, and the signatures of the completed steps.',
    requirement_codes: [uIntegrity], inputs: { kind: 'audit' }, expected: { text: 'One audit entry by the Verification analyst for each value recorded; each completed step points to its signature' } });
  // the protocol keeps the inputs, not the rational objects
  const planOut = { batch: plan.batch, batches, samples: plan.samples.map((s) => ({ key: s.key, case: s.case, description: s.description, inputs: s.inputs, specs: s.specs, steered: s.steered || null })) };
  return { requirements: reqs, checks, plan: planOut };
}
function stepInputs(s, plan) {
  const k = s.step_key;
  if (s.step_type === 'Weighing') return Object.fromEntries(plan.samples.map((x) => [x.key, x.inputs.weigh[k] + ' ' + (s.config.unit || 'g')]));
  if (s.step_type === 'Dilution') return Object.fromEntries(plan.samples.map((x) => [x.key, x.inputs.dil[k].map((f) => f.aliquot + ' + ' + f.diluent).join(', ')]));
  if (s.step_type === 'Preparation') return plan.batch.prep[k] || {};
  if (s.step_type === 'Incubation') return plan.batch.inc[k] || {};
  if (s.step_type === 'Plating/Inoculation') return Object.fromEntries(plan.samples.map((x) => [x.key, x.inputs.plates[k] + ' plate(s)']));
  if (s.step_type === 'Data Entry') return Object.fromEntries(plan.samples.map((x) => [x.key, x.inputs.read[k]]));
  return {};
}
// the logbook lots scanned at a step (L-2): one line per lot, with the values it gives and the analytes it serves
function stepLots(s, plan, D) {
  const m = (plan.batch.mat || {})[s.step_key]; if (!m) return [];
  const by = new Map();
  for (const [aid, flds] of Object.entries(m)) for (const [fld, x] of Object.entries(flds)) {
    const o = by.get(x.lot_id) || { ...x, values: {}, analytes: new Set() };
    o.values[fld] = x.value; o.analytes.add((D.analytes.find((a) => a.analyte_id === aid) || {}).analyte_name || aid); by.set(x.lot_id, o);
  }
  return [...by.values()].map((o) => `${o.lot_code} ${o.item_name} (${o.logbook_code} entry ${o.entry_code}: ${Object.entries(o.values).map(([f, v]) => f + ' = ' + v).join(', ')}; for ${[...o.analytes].join(', ')})`);
}
function describeStep(s, plan) {
  const k = s.step_key; const c = s.config;
  switch (s.step_type) {
    case 'Batching': return 'Complete the Batching step (spiked QC tied to the first sample).';
    case 'Weighing': return `Record the weights (${plan.samples.map((x) => x.key + ' ' + x.inputs.weigh[k]).join(', ')} ${c.unit || 'g'}; prep QC as S1) and a usable balance; complete (signed).`;
    case 'Preparation': return `Record ${Object.entries(plan.batch.prep[k] || {}).map(([f, v]) => f + ' = ' + v).join(', ') || 'nothing (no fields)'}; complete (signed).`;
    case 'Dilution': return `Record each dilution (${plan.samples[0].inputs.dil[k].map((f) => f.aliquot + ' + ' + f.diluent).join(', ')} for every entry); complete (signed).`;
    case 'Plating/Inoculation': return `Record ${plan.samples[0].inputs.plates[k]} plate(s) per entry and a usable media lot; complete (signed).`;
    case 'Incubation': { const i = plan.batch.inc[k] || {}; return `Put the batch in a usable incubator for ${i.duration} ${i.unit} at ${i.temperature ?? 'the target'} °C (one load, times in the past); complete (signed).`; }
    case 'Data Entry': return `Enter the readings (see the inputs), the QC readings, the standards, spikes and strains the QC needs${c.require_attachment === false ? '' : ', the raw data file'} and a usable instrument; complete (signed).`;
    case 'Calculation': return 'Read the calculated results; complete (signed).';
    case 'Split off Test': return 'Complete the step (signed).';
    default: return 'Complete the step (signed).';
  }
}

// ============================================================ the run
const USERS = { analyst: 'verify.analyst', witness: 'verify.witness', reviewer: 'verify.reviewer' };
async function execute(t, verificationId, log) {
  const w = await t.one('SELECT * FROM workflow_verification WHERE id = $1', [verificationId]);
  const D = await loadDesign(t, w.test_version_id);
  const plan = w.plan;
  const checks = await t.rows('SELECT * FROM verification_check WHERE verification_id = $1 ORDER BY sort_order', [verificationId]);
  const users = {};
  for (const [k, u] of Object.entries(USERS)) users[k] = await t.one('SELECT id, full_name FROM app_user WHERE username = $1', [u]);
  const executor = await t.one("SELECT current_setting('lims.user_id', true) AS id");
  const at = () => new Date().toISOString();
  const say = (who, action, detail) => log.push({ at: at(), who, action, detail: detail ?? null });
  let current = 'executor';
  const as = async (who) => { current = who; await t.query("SELECT set_config('lims.user_id', $1, true)", [who === 'executor' ? executor.id : users[who].id]); };
  const reason = (r) => t.query("SELECT set_config('lims.reason', $1, true)", [r || '']);
  const sign = async (meaning, action, module = 'Testing') => (await t.one('SELECT sign_action($1, $2, $3, NULL) AS id', [meaning, action, module])).id;
  let sp = 0;
  const attempt = async (fn) => {
    sp += 1; const name = 'v' + sp; await t.query('SAVEPOINT ' + name);
    try { const v = await fn(); await t.query('RELEASE SAVEPOINT ' + name); return { ok: true, value: v }; }
    catch (e) { await t.query('ROLLBACK TO SAVEPOINT ' + name); await t.query('RELEASE SAVEPOINT ' + name); return { ok: false, error: String(e.message || e) }; }
  };
  // results gathered per check (a check can span several batches)
  const res = new Map();
  const put = (code, result, actual, note, batchId, evidence) => {
    const o = res.get(code) || { results: [], actual: [], notes: [], batch: null, evidence: null };
    o.results.push(result); if (actual !== undefined) o.actual.push(actual); if (note) o.notes.push(note);
    if (!o.batch && batchId) o.batch = batchId; if (!o.evidence && evidence) o.evidence = evidence; res.set(code, o);
  };
  const byKind = (kind, f = () => true) => checks.filter((c) => c.inputs.kind === kind && f(c));
  const one = (kind, f) => byKind(kind, f)[0];

  // ---- the order and its samples
  const setup = await t.one('SELECT start_verification_run($1, $2::jsonb) AS x', [verificationId, JSON.stringify(plan.samples.map((s) => ({ key: s.key, description: s.description, specs: s.specs })))]);
  const samples = Object.fromEntries(setup.x.samples.map((s) => [s.key, s]));
  say('executor', 'Started the run (signed "Executed by")', `${setup.x.samples.length} samples ordered and logged: ${setup.x.samples.map((s) => s.sample_code).join(', ')}`);
  const site = w.site_id;

  // ---- usable equipment and lots
  const usable = async (stepKey) => {
    const s = D.byKey[stepKey]; if (!s.equipment.length) return null;
    return t.one(`SELECT e.id, e.equipment_code, e.equipment_name, e.type_name FROM equipment_view e
      WHERE e.site_id = $1 AND e.equipment_type_id = ANY($2::uuid[]) AND e.availability = 'Available' AND e.calibration_status IS DISTINCT FROM 'Deficient'
      ORDER BY array_position($2::uuid[], e.equipment_type_id), e.equipment_code LIMIT 1`, [site, s.equipment.map((x) => x.equipment_type_id)]);
  };
  const lotFor = async (purpose, analyteIds, hint) => {
    const rows = await t.rows(`SELECT l.id, l.lot_code, l.item_name, l.unit, l.physical_form::text AS form, l.chemical_types,
        (SELECT count(*) FROM lot_analyte la WHERE la.lot_id = l.id AND la.status = 'Active' AND la.analyte_id = ANY($2::uuid[]))::int AS covers,
        (SELECT count(*) FROM lot_analyte la WHERE la.lot_id = l.id AND la.status = 'Active')::int AS names
      FROM inventory_lot l WHERE l.site_id = $1 AND l.receipt_status::text = 'Received' AND l.status::text = 'Available'
        AND (l.expiration_date IS NULL OR l.expiration_date >= site_today(l.site_id)) AND (l.retest_date IS NULL OR l.retest_date >= site_today(l.site_id))
        -- a lot that needs QA testing is usable only where it is released (migration 040; media since 023)
        AND lot_qa_problem(l.id, $3) IS NULL`, [site, analyteIds, D.version.test_id]);
    const types = (r) => pgList(r.chemical_types);
    let c = [];
    // a strain lot that names its organisms must name one of the test's
    if (purpose === 'Strain') c = rows.filter((r) => types(r).includes('Microbiological Strain') && (r.names === 0 || r.covers > 0));
    else if (purpose === 'Media') c = rows.filter((r) => types(r).includes('Media'));
    else c = rows.filter((r) => r.covers > 0 && (types(r).includes('Reference Standard') || types(r).includes('In-house mixture')));
    if (hint) {
      const h = String(hint).toLowerCase();
      const score = (r) => String(r.item_name || '').toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2 && h.includes(x)).length;
      c.sort((a, b) => score(b) - score(a));
    }
    c.sort((a, b) => b.covers - a.covers);
    return c[0] || null;
  };
  const amount = async (lot, wanted) => {
    for (const [v, u] of [[wanted, 'mL'], ['1', lot.unit]]) {
      const ok = await t.one('SELECT unit_factor($1, $2, $3) IS NOT NULL AS ok', [u, lot.unit, lot.form]);
      if (ok && ok.ok) return { volume: v, unit: u };
    }
    return { volume: '1', unit: lot.unit };
  };

  // ---- batches
  await as('analyst'); await reason('Workflow verification run');
  const batches = []; const allBatchChecks = [];
  for (let i = 0; i < 20; i += 1) {
    const left = await t.one('SELECT count(*)::int AS n FROM test_pool_view WHERE site_id = $1 AND test_version_id = $2', [site, w.test_version_id]);
    if (!left.n) break;
    const b = await attempt(() => t.one('SELECT create_batch($1, $2) AS id', [site, w.test_version_id]));
    if (!b.ok) { say('analyst', 'Could not make a batch', b.error); break; }
    const info = await t.one('SELECT batch_code FROM test_batch WHERE id = $1', [b.value.id]);
    const ents = await t.rows(`SELECT e.*, s.client_sample_id AS sample_key FROM batch_entry e LEFT JOIN requested_test rt ON rt.id = e.requested_test_id LEFT JOIN sample s ON s.id = rt.sample_id
      WHERE e.batch_id = $1 AND e.status = 'Active' ORDER BY e.position`, [b.value.id]);
    batches.push({ id: b.value.id, code: info.batch_code, entries: ents });
    say('analyst', 'Made batch ' + info.batch_code + ' from the backlog', ents.map((e) => e.label).join(', '));
  }
  {
    const c = one('batches'); const exp = c.expected.batches || [];
    const got = batches.map((b) => ({ samples: b.entries.filter((e) => e.entry_type === 'Sample').map((e) => e.sample_key), qc: b.entries.filter((e) => e.entry_type === 'QC').map((e) => e.label) }));
    const norm = (q) => q.replace(/ \(daily, from .*\)$/, ' (daily, from the first batch)');
    const same = got.length === exp.length && got.every((g, i) => JSON.stringify([...g.samples].sort()) === JSON.stringify([...exp[i].samples].sort())
      && JSON.stringify(g.qc.map(norm).sort()) === JSON.stringify([...exp[i].qc].sort()));
    put(c.check_code, same ? 'Pass' : 'Fail', { text: got.map((g, i) => `${batches[i].code}: ${g.samples.join(', ')}${g.qc.length ? ' with ' + g.qc.join(', ') : ''}`).join('; ') || 'No batch was made', batches: got },
      same ? null : 'The batches differ from the protocol', batches[0] && batches[0].id, batches[0] ? '#/testing/batches/' + batches[0].id : null);
  }
  const stepRun = async (batchId, key) => t.one('SELECT r.* FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = $1 AND ws.step_key = $2 AND ws.status = \'Active\'', [batchId, key]);
  const sampleInputs = (e) => (plan.samples.find((s) => s.key === e.sample_key) || plan.samples[0]).inputs;
  const typical = plan.samples[0].inputs;
  const worksOn = (e) => e.daily_of_entry_id === null && (e.entry_type === 'Sample' || e.qc_class === 'Prep');
  const tps = timepointSteps(D);
  const blocked = new Map(); // batch id -> reason the run stopped there
  let refusedOnce = false;

  const completeStep = async (b, s, r) => {
    const what = `${s.step_name} of ${b.code}`;
    return attempt(async () => {
      await reason('Step completed');
      await sign('Performed by', what);
      let wsig = null;
      if (s.config.witness === 'Required') wsig = (await t.one('SELECT sign_witness($1, $2) AS id', [users.witness.id, 'Witnessed: ' + what])).id;
      await t.query('SELECT complete_step($1, $2)', [r.id, wsig]);
      await reason('Workflow verification run');
    });
  };

  for (const b of batches) {
    const entries = b.entries;
    for (const s of D.order) {
      if (blocked.has(b.id)) break;
      if (s.step_type === 'QC Review') {
        // a timepoint review is released as soon as the steps before it are done; the final review comes last
        if (!tps.includes(s)) continue;
        await as('reviewer');
        const r = await stepRun(b.id, s.step_key);
        for (const k of s.ancestors) {
          if (D.byKey[k].step_type === 'QC Review') continue;
          const rr = await stepRun(b.id, k);
          const m = await attempt(() => reason('Step approved in QC Review').then(() => t.query('SELECT approve_review_step($1)', [rr.id])));
          if (!m.ok) say('reviewer', 'Could not approve ' + D.byKey[k].step_name, m.error);
        }
        const rel = await attempt(async () => { await reason('Timepoint reviewed: preliminary results released'); await sign('Reviewed by', `${s.step_name} of ${b.code}: release preliminary results`); return (await t.one('SELECT release_timepoint($1) AS n', [r.id])).n; });
        say('reviewer', `Released ${s.step_name} of ${b.code}`, rel.ok ? rel.value + ' preliminary results' : rel.error);
        for (const c of byKind('timepoint', (x) => x.inputs.step_key === s.step_key)) {
          const smp = samples[c.sample_key]; if (!entries.some((e) => e.sample_key === c.sample_key)) continue;
          if (!rel.ok) { put(c.check_code, 'Fail', { text: 'Not released: ' + rel.error }, rel.error, b.id, '#/testing/batches/' + b.id + '?step=' + s.step_key); continue; }
          const tr = await t.one(`SELECT value_num::text AS value, reported, stage FROM test_result WHERE requested_test_id = $1 AND analyte_id = $2 AND result_key = $3 AND status = 'Active'`, [smp.requested_test_id, c.inputs.analyte_id, c.inputs.result_key]);
          const ok = tr && close(tr.value, c.expected.value) && tr.reported === c.expected.reported && tr.stage === 'Preliminary';
          put(c.check_code, ok ? 'Pass' : 'Fail', { text: tr ? `${tr.reported} (${tr.stage}; unrounded ${tr.value})` : 'No stored result', value: tr && tr.value, reported: tr && tr.reported, stage: tr && tr.stage },
            ok ? null : 'Differs from the expected result', b.id, '#/testing/batches/' + b.id + '?step=' + s.step_key);
        }
        await as('analyst');
        continue;
      }
      const r = await stepRun(b.id, s.step_key);
      const ev = '#/testing/batches/' + b.id + '?step=' + s.step_key;
      const work = entries.filter(worksOn);
      // the negative check: completing before the data are in is refused
      const neg = one('refuse_incomplete', (c) => c.inputs.step_key === s.step_key);
      if (neg && !refusedOnce) {
        refusedOnce = true;
        const x = await attempt(async () => { await reason('Step completed'); await sign('Performed by', `${s.step_name} of ${b.code}`); await t.query('SELECT complete_step($1, NULL)', [r.id]); });
        const ok = !x.ok && /cannot be completed yet/.test(x.error);
        put(neg.check_code, ok ? 'Pass' : 'Fail', { text: x.ok ? 'The step was completed with its data missing' : 'Refused: ' + x.error }, ok ? null : 'Not refused as expected', b.id, ev);
        await reason('Workflow verification run');
        if (x.ok) { blocked.set(b.id, 'The step was completed without data'); break; }
      }
      const problems = [];
      const run = async (label, fn) => { const x = await attempt(fn); if (!x.ok) problems.push(label + ': ' + x.error); return x; };
      const eq = await usable(s.step_key);
      switch (s.step_type) {
        case 'Batching':
          for (const e of entries.filter((x) => ['Matrix Spike', 'Matrix Spike Duplicate'].includes(x.qc_type) && !x.parent_entry_id && x.daily_of_entry_id === null)) {
            const first = entries.find((x) => x.entry_type === 'Sample');
            await run('Spiked sample of ' + e.label, async () => { await reason('Spiked sample chosen'); await t.query('UPDATE batch_entry SET parent_entry_id = $2 WHERE id = $1', [e.id, first.id]); await reason('Workflow verification run'); });
          }
          break;
        case 'Weighing':
          // replicate weighings (033): the planned weight for each one, so their average is the planned weight
          for (const e of work) {
            const reps = Math.max(1, Math.min(10, Number(s.config.replicates) || 1));
            for (let k = 1; k <= reps; k++) {
              await run(`Weight of ${e.label}${reps > 1 ? ` (${k} of ${reps})` : ''}`, () => t.query('INSERT INTO entry_value (step_run_id, entry_id, run_no, value_num) VALUES ($1, $2, $3, $4)',
                [r.id, e.id, k, (e.entry_type === 'Sample' ? sampleInputs(e) : typical).weigh[s.step_key]]));
            }
          }
          if (eq) await run('Balance', () => t.query('INSERT INTO entry_equipment (step_run_id, entry_id, equipment_id) VALUES ($1, NULL, $2)', [r.id, eq.id]));
          else if (s.equipment.length) problems.push(`No usable ${s.equipment.map((x) => x.type_name).join(' or ')} at the lab (available and in calibration)`);
          break;
        case 'Preparation':
          await run('Fields', () => t.query('UPDATE step_run SET fields = $2::jsonb WHERE id = $1', [r.id, JSON.stringify(plan.batch.prep[s.step_key] || {})]));
          if (eq) await run('Equipment', () => t.query('INSERT INTO entry_equipment (step_run_id, entry_id, equipment_id) VALUES ($1, NULL, $2)', [r.id, eq.id]));
          break;
        case 'Dilution':
          for (const e of work) await run('Dilution of ' + e.label, () => t.query('INSERT INTO entry_value (step_run_id, entry_id, data) VALUES ($1, $2, $3::jsonb)', [r.id, e.id, JSON.stringify({ fields: (e.entry_type === 'Sample' ? sampleInputs(e) : typical).dil[s.step_key] })]));
          break;
        case 'Plating/Inoculation': {
          for (const e of work) await run('Plates of ' + e.label, () => t.query('INSERT INTO entry_value (step_run_id, entry_id, value_num) VALUES ($1, $2, $3)', [r.id, e.id, (e.entry_type === 'Sample' ? sampleInputs(e) : typical).plates[s.step_key]]));
          const lot = await lotFor('Media', [], s.config.expected_media);
          if (lot) { const am = await amount(lot, '20'); await run('Media lot', () => t.query('INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit) VALUES ($1, NULL, $2, \'Media\', $3, $4)', [r.id, lot.id, am.volume, am.unit])); }
          else problems.push('No usable media lot at the lab (received, available, in date, and qualified for this test when it needs qualifying)');
          break;
        }
        case 'Incubation': {
          if (!eq) { problems.push(`No usable ${s.equipment.map((x) => x.type_name).join(' or ') || 'incubator'} at the lab (available and in calibration)`); break; }
          const inc = plan.batch.inc[s.step_key];
          const secs = Number(inc.duration) * (inc.unit === 'days' ? 86400 : 3600);
          await run('Load', () => t.query(`INSERT INTO incubation_load (step_run_id, equipment_id, entry_ids, time_in, time_out, temperature)
              VALUES ($1, $2, NULL, date_trunc('second', clock_timestamp()) - make_interval(secs => $3::double precision), date_trunc('second', clock_timestamp()), $4)`, [r.id, eq.id, secs, inc.temperature]));
          break;
        }
        case 'Data Entry': {
          const ans = D.analytes.filter((a) => readsAnalyte(s, a.analyte_id));
          const valOf = (a, v) => (a.result_type === 'Numeric' ? [v, null] : [null, v]);
          const read = async (e, a, v) => run(`Reading of ${e.label} ${a.analyte_name}`, () => t.query('INSERT INTO entry_value (step_run_id, entry_id, analyte_id, run_no, value_num, value_text) VALUES ($1, $2, $3, 1, $4, $5)', [r.id, e.id, a.analyte_id, ...valOf(a, v)]));
          // materials the QC needs, before its readings
          const qcE = entries.filter((e) => e.entry_type === 'QC' && e.daily_of_entry_id === null);
          const anIds = D.analytes.map((a) => a.analyte_id);
          for (const e of qcE) {
            const cr = D.qc.filter((q) => q.qc_type === e.qc_type && q.applies);
            const needSpike = e.qc_class === 'Prep' && cr.some((q) => q.limit_type === 'Recovery %');
            const needStd = e.qc_class === 'Analytical' && ['ICV', 'CCV'].includes(e.qc_type);
            const bq = (D.byKey[D.steps.find((x) => x.step_type === 'Batching').step_key].config.qc || []).find((q) => q.qc_type === e.qc_type) || {};
            for (const [need, purpose] of [[needSpike, 'Spike'], [needStd, 'Standard'], [bq.material === 'Strains' && e.entry_type === 'QC', 'Strain']]) {
              if (!need) continue;
              const done = await t.one(`SELECT 1 AS x FROM entry_material em JOIN step_run sr ON sr.id = em.step_run_id WHERE sr.batch_id = $1 AND em.entry_id = $2 AND em.purpose::text = $3 AND em.status = 'Active'`, [b.id, e.id, purpose]);
              if (done) continue;
              const lot = await lotFor(purpose, anIds, purpose === 'Spike' ? 'spike' : purpose === 'Standard' ? 'check standard calibration' : null);
              if (!lot) { problems.push(`No usable ${purpose.toLowerCase()} lot for ${e.label} at the lab`); continue; }
              const am = await amount(lot, purpose === 'Spike' ? '0.5' : '0.1');
              await run(`${purpose} for ${e.label}`, () => t.query('INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit) VALUES ($1, $2, $3, $4, $5, $6)', [r.id, e.id, lot.id, purpose, am.volume, am.unit]));
            }
          }
          // the samples' readings (from the protocol)
          for (const e of entries.filter((x) => x.entry_type === 'Sample')) for (const a of ans) await read(e, a, sampleInputs(e).read[s.step_key][a.analyte_id]);
          // the QC readings: set so each QC meets its criteria
          const dataStep = D.steps.filter((x) => x.step_type === 'Data Entry').sort((x, y) => y.sort_order - x.sort_order)[0];
          const verdicts = async () => t.rows('SELECT * FROM batch_qc_verdicts($1)', [b.id]);
          for (const e of qcE) {
            for (const a of ans) {
              const cr = D.qc.filter((q) => q.qc_type === e.qc_type && q.applies && q.analyte_id === a.analyte_id).map((q) => q.limit_type);
              const nf = a.result_values.find((v) => !a.found_values.includes(v)) || 'Absent'; const fv = a.found_values[0] || 'Present';
              let v = typical.read[s.step_key][a.analyte_id];
              if (cr.includes('Absence')) v = a.result_type === 'Numeric' ? '0' : nf;
              else if (cr.includes('Presence')) v = a.result_type === 'Numeric' ? '50' : fv;
              else if (cr.includes('Identified')) v = a.result_type === 'Numeric' ? '50' : (a.result_type === 'Qualitative' ? fv : 'Verification organism (identified)');
              else if (cr.includes('Blank threshold')) v = '0';
              else if (cr.includes('Recovery %') && a.result_type === 'Numeric' && s.step_key === dataStep.step_key) {
                if (e.qc_class === 'Analytical') {
                  const c = await t.one(`SELECT lot_analyte_conc(em.lot_id, $3, $4)::text AS v FROM entry_material em JOIN step_run sr ON sr.id = em.step_run_id
                     WHERE sr.batch_id = $1 AND em.entry_id = $2 AND em.purpose = 'Standard' AND em.status = 'Active' ORDER BY em.created_at DESC LIMIT 1`, [b.id, e.id, a.analyte_id, s.config.value_unit || null]);
                  if (c && c.v !== null) v = Q.of(c.v).toInput(10);
                } else {
                  // the recovery is linear in the reading: try two readings (rolled back), then enter the one that gives 100 %
                  const probe = async (x) => { let m = null; await attempt(async () => { await t.query('INSERT INTO entry_value (step_run_id, entry_id, analyte_id, run_no, value_num) VALUES ($1, $2, $3, 1, $4)', [r.id, e.id, a.analyte_id, x]); const q = (await verdicts()).find((y) => y.entry_id === e.id && y.analyte_id === a.analyte_id && y.limit_type === 'Recovery %' && y.analytical_run === 1); m = q && q.measured !== null ? Number(q.measured) : null; throw new Error('probe'); }); return m; };
                  const x1 = Number(typical.read[s.step_key][a.analyte_id]) || 10; const x2 = x1 * 3 + 1;
                  const m1 = await probe(String(x1)); const m2 = await probe(String(x2));
                  if (m1 !== null && m2 !== null && m2 !== m1) v = Q.fromDouble(x1 + (100 - m1) * (x2 - x1) / (m2 - m1)).toInput(8);
                }
              }
              // a spike duplicate is read like its spike (so their RPD is 0)
              if (cr.includes('RPD') && e.qc_type === 'Matrix Spike Duplicate') {
                const ms = entries.find((x) => x.qc_type === 'Matrix Spike' && x.parent_entry_id === e.parent_entry_id && x.daily_of_entry_id === null);
                const mv = ms && await t.one("SELECT value_num::text AS v FROM entry_value WHERE step_run_id = $1 AND entry_id = $2 AND analyte_id = $3 AND run_no = 1 AND status = 'Active'", [r.id, ms.id, a.analyte_id]);
                if (mv && mv.v !== null) v = mv.v;
              }
              await read(e, a, v);
            }
          }
          if (s.config.require_attachment !== false) {
            const rows = [['Entry', 'Analyte', 'Reading']]; for (const e of entries.filter((x) => x.daily_of_entry_id === null)) for (const a of ans) {
              const x = await t.one('SELECT COALESCE(value_num::text, value_text) AS v FROM entry_value WHERE step_run_id = $1 AND entry_id = $2 AND analyte_id = $3 AND run_no = 1 AND status = \'Active\'', [r.id, e.id, a.analyte_id]);
              rows.push([e.label, a.analyte_name, x ? x.v : '']);
            }
            const csv = '# Raw data written by the automated workflow verification run (not an instrument export)\r\n' + rows.map((x) => x.map((y) => '"' + String(y).replace(/"/g, '""') + '"').join(',')).join('\r\n') + '\r\n';
            await run('Raw data file', async () => {
              const d = await t.one(`INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ($1, 'text/csv', 0, '', convert_to($2, 'UTF8')) RETURNING id`, [`${b.code}-${s.step_key}-verification.csv`, csv]);
              await t.query('INSERT INTO step_attachment (step_run_id, document_id, label, analytical_run_no) VALUES ($1, $2, $3, 1)', [r.id, d.id, 'Verification raw data']);
            });
          }
          if (eq) await run('Instrument', () => t.query('INSERT INTO entry_equipment (step_run_id, entry_id, equipment_id, analytical_run_no) VALUES ($1, NULL, $2, 1)', [r.id, eq.id]));
          else if (s.equipment.length && s.config.require_attachment !== false) problems.push(`No usable ${s.equipment.map((x) => x.type_name).join(' or ')} at the lab (available and in calibration)`);
          break;
        }
        case 'Calculation': {
          const live = await t.rows('SELECT entry_id, analyte_id, value::text AS value, waiting FROM batch_results($1) WHERE step_key = $2 AND run_no = 1', [b.id, s.step_key]);
          for (const c of byKind('calc', (x) => x.inputs.step_key === s.step_key)) {
            const e = entries.find((x) => x.sample_key === c.sample_key && x.entry_type === 'Sample'); if (!e) continue;
            const got = live.find((x) => x.entry_id === e.id && x.analyte_id === c.inputs.analyte_id);
            const ok = got && (c.expected.value === null ? got.value === null : close(got.value, c.expected.value));
            put(c.check_code, ok ? 'Pass' : 'Fail', { text: got ? (got.value ?? got.waiting) : 'No result', value: got && got.value }, ok ? null : 'Differs from the independent calculation', b.id, ev);
          }
          break;
        }
        case 'Hold Point': {
          const c = one('hold', (x) => x.inputs.step_key === s.step_key);
          const x = await completeStep(b, s, r);
          if (!x.ok) {
            const ok = /Waits for/.test(x.error);
            if (c) put(c.check_code, ok ? 'Pass' : 'Fail', { text: 'Refused: ' + x.error }, null, b.id, ev);
            blocked.set(b.id, `${s.step_name} waits for ${D.testName(s.config.test_id)}: the steps after it cannot be done in this run`);
            say('analyst', 'Stopped at ' + s.step_name + ' of ' + b.code, x.error);
          } else {
            if (c) put(c.check_code, 'Fail', { text: 'Completed without the other test\'s result' }, 'The step did not wait', b.id, ev);
            say('analyst', 'Completed ' + s.step_name + ' of ' + b.code, null);
          }
          continue;
        }
        default: break;
      }
      // L-2: the logbook lots the calculations read from this step, scanned for every entry with the protocol's entry
      if ((plan.batch.mat || {})[s.step_key]) {
        const lots = new Map();
        for (const flds of Object.values(plan.batch.mat[s.step_key])) for (const x of Object.values(flds)) lots.set(x.lot_id, x);
        for (const x of lots.values()) {
          const lot = await t.one('SELECT id, lot_code, unit, physical_form::text AS form, chemical_types FROM inventory_lot WHERE id = $1', [x.lot_id]);
          if (!lot) { problems.push(`Lot ${x.lot_code} is gone`); continue; }
          const am = await amount(lot, '0.1');
          const purpose = pgList(lot.chemical_types).includes('Microbiological Strain') ? 'Strain' : 'Reagent';
          for (const e of entries.filter((y) => y.daily_of_entry_id === null)) {
            await run(`${x.lot_code} (${x.entry_code}) for ${e.label}`, () => t.query('INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit, logbook_entry_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
              [r.id, e.id, x.lot_id, purpose, am.volume, am.unit, x.entry_id]));
          }
        }
      }
      const stc = one('step', (c) => c.inputs.step_key === s.step_key);
      const x = await completeStep(b, s, r);
      if (!x.ok) {
        const why = [...problems, x.error].join('; ');
        if (stc) put(stc.check_code, problems.some((p) => /^No usable/.test(p)) ? 'Not tested' : 'Fail', { text: 'Not completed: ' + x.error, problems }, why, b.id, ev);
        blocked.set(b.id, `${s.step_name} could not be completed: ${why}`);
        say('analyst', 'Could not complete ' + s.step_name + ' of ' + b.code, why);
        break;
      }
      const done = await t.one(`SELECT r.status, u.full_name AS by, se.meaning, se.method, w2.full_name AS witness FROM step_run r JOIN app_user u ON u.id = r.performed_by
          JOIN signature_event se ON se.id = r.signature_id LEFT JOIN app_user w2 ON w2.id = r.witness_id WHERE r.id = $1`, [r.id]);
      const okStep = done && done.status === 'Completed' && done.meaning === 'Performed by' && done.method === 'Automated verification run' && (s.config.witness !== 'Required' || done.witness);
      if (stc) put(stc.check_code, okStep ? 'Pass' : 'Fail', { text: `${b.code}: ${done ? done.status + ', ' + done.meaning + ' ' + done.by + (done.witness ? ', witnessed by ' + done.witness : '') : 'not completed'}` },
        problems.length ? problems.join('; ') : null, b.id, ev);
      say('analyst', `Completed ${s.step_name} of ${b.code} (signed "Performed by")`, problems.length ? problems.join('; ') : null);
      if (s.step_type === 'Split off Test') {
        const c = one('split', (y) => y.inputs.step_key === s.step_key);
        if (c) {
          const got = (await t.rows('SELECT s.client_sample_id AS k FROM split_request q JOIN sample s ON s.id = q.sample_id WHERE q.step_run_id = $1 AND q.status <> \'Cancelled\' ORDER BY 1', [r.id])).map((y) => y.k);
          const expd = (c.expected.samples || []).filter((k) => entries.some((e) => e.sample_key === k)).sort();
          const ok = JSON.stringify(got) === JSON.stringify(expd);
          put(c.check_code, ok ? 'Pass' : 'Fail', { text: got.length ? 'Requests for ' + got.join(', ') : 'No request', samples: got }, ok ? null : 'Differs from the protocol', b.id, ev);
        }
      }
    }
    if (blocked.has(b.id)) continue;
    // ---- QC Review (final), by the automated reviewer
    const finalReview = D.steps.find((x) => x.step_type === 'QC Review' && !tps.includes(x));
    const ev = '#/testing/batches/' + b.id + '?step=' + (finalReview ? finalReview.step_key : 'results');
    const evResults = '#/testing/batches/' + b.id + '?step=results';
    const status = await t.one('SELECT status::text AS s FROM test_batch WHERE id = $1', [b.id]);
    if (status.s !== 'Awaiting Review') { blocked.set(b.id, 'The batch is ' + status.s + ', not waiting for review'); continue; }
    const marks = await t.rows('SELECT * FROM review_step_runs($1)', [b.id]);
    const self = one('refuse_self_review');
    if (self && !res.has(self.check_code) && marks.length) {
      await as('analyst');
      const x = await attempt(() => reason('Step approved in QC Review').then(() => t.query('SELECT approve_review_step($1)', [marks[0].step_run_id])));
      const ok = !x.ok && /someone else must review/.test(x.error);
      put(self.check_code, ok ? 'Pass' : 'Fail', { text: x.ok ? 'The analyst approved a step of their own batch' : 'Refused: ' + x.error }, null, b.id, ev);
    }
    await as('reviewer');
    const unap = one('refuse_unapproved');
    if (unap && !res.has(unap.check_code)) {
      const x = await attempt(async () => { await reason('Batch reviewed and approved'); await sign('Reviewed by', `QC Review and approval of ${b.code}`); await t.query('SELECT approve_batch($1)', [b.id]); });
      const listed = !x.ok && (await t.one("SELECT count(*)::int AS n FROM batch_review_problems($1) WHERE problem LIKE '%not approved yet%'", [b.id])).n > 0;
      const ok = !x.ok && listed;
      put(unap.check_code, ok ? 'Pass' : 'Fail', { text: x.ok ? 'The batch was approved with steps not approved' : 'Refused: ' + x.error }, null, b.id, ev);
      if (x.ok) continue;
    }
    for (const m of marks) {
      if (m.mark_id) continue;
      const x = await attempt(() => reason('Step approved in QC Review').then(() => t.query('SELECT approve_review_step($1)', [m.step_run_id])));
      if (!x.ok) say('reviewer', 'Could not approve a step', x.error);
    }
    say('reviewer', `Approved each step of ${b.code} in QC Review`, null);
    // QC verdicts: record them; anything failed or waiting is a failed check, accepted only so the run can go on
    const used = (await t.one('SELECT batch_used_runs($1)::text AS u', [b.id])).u;
    const usedRuns = pgList(used).map(Number);
    const verd = (await t.rows('SELECT * FROM batch_qc_verdicts($1)', [b.id])).filter((v) => v.analytical_run === 1 || usedRuns.includes(v.analytical_run));
    for (const c of byKind('qc')) {
      const vs = verd.filter((v) => v.qc_type === c.inputs.qc_type && v.limit_type === c.inputs.limit_type && v.verdict !== 'Not judged');
      const nj = verd.filter((v) => v.qc_type === c.inputs.qc_type && v.limit_type === c.inputs.limit_type && v.verdict === 'Not judged');
      const notJudgedType = /Not judged/.test(c.expected.text);
      if (notJudgedType) { put(c.check_code, nj.length ? 'Pass' : 'Fail', { text: nj.map((v) => `${v.label} ${v.analyte_name || ''}: ${v.verdict}${v.note ? ' (' + v.note + ')' : ''}`).join('; ') || 'No verdict' }, null, b.id, evResults); continue; }
      if (!vs.length && !nj.length) continue;   // not in this batch (e.g. linked daily QC)
      const bad = vs.filter((v) => v.verdict !== 'Pass');
      put(c.check_code, bad.length || !vs.length ? 'Fail' : 'Pass', { text: [...vs, ...nj].map((v) => `${v.label} ${v.analyte_name || ''}: ${v.verdict}${v.measured !== null ? ' ' + v.measured : ''}${v.note ? ' (' + v.note + ')' : ''}`).join('; ') },
        bad.length ? `${bad.length} verdict${bad.length > 1 ? 's' : ''} not Pass (accepted by the automated reviewer only so the run could go on)` : !vs.length ? 'Not judged' : null, b.id, evResults);
      for (const v of bad) {
        const x = await attempt(() => reason('QC accepted by the reviewer').then(() => t.query('SELECT accept_qc($1, $2, $3, $4, $5, $6)', [b.id, v.entry_id, v.analyte_id, v.limit_type, `Automated verification: recorded as a failed check (${c.check_code}); accepted only so the run can go on`, v.analytical_run])));
        if (!x.ok) say('reviewer', 'Could not accept QC ' + v.label, x.error);
      }
    }
    for (const l of await t.rows('SELECT * FROM batch_load_problems($1)', [b.id])) {
      await attempt(() => reason('Incubator load accepted by the reviewer').then(() => t.query('SELECT accept_load($1, $2, $3)', [b.id, l.load_id, 'Automated verification run: load times set by the run'])));
    }
    const ap = await attempt(async () => { await reason('Batch reviewed and approved'); await sign('Reviewed by', `QC Review and approval of ${b.code}`); return (await t.one('SELECT approve_batch($1) AS n', [b.id])).n; });
    const apc = one('approve');
    const bst = await t.one(`SELECT b.status::text AS status, u.full_name AS by, se.meaning, se.method FROM test_batch b LEFT JOIN app_user u ON u.id = b.reviewed_by LEFT JOIN signature_event se ON se.id = b.review_signature_id WHERE b.id = $1`, [b.id]);
    const okAp = ap.ok && bst.status === 'Approved' && bst.meaning === 'Reviewed by';
    if (apc) put(apc.check_code, okAp ? 'Pass' : 'Fail', { text: `${b.code}: ${bst.status}${bst.by ? ', ' + bst.meaning + ' ' + bst.by : ''}${ap.ok ? ' (' + ap.value + ' results stored)' : ' (' + ap.error + ')'}` }, ap.ok ? null : ap.error, b.id, ev);
    say('reviewer', ap.ok ? `Approved ${b.code} (signed "Reviewed by"): ${ap.value} results stored` : `Could not approve ${b.code}`, ap.ok ? null : ap.error);
    if (!ap.ok) { blocked.set(b.id, 'The batch could not be approved: ' + ap.error); continue; }
    // the stored final results against the independent calculation
    for (const c of byKind('result')) {
      if (!b.entries.some((e) => e.sample_key === c.sample_key)) continue;
      const smp = samples[c.sample_key];
      const tr = await t.one(`SELECT value_num::text AS value, value_text, reported, conformance, stage FROM test_result WHERE requested_test_id = $1 AND analyte_id = $2 AND result_key IS NULL AND status = 'Active'`, [smp.requested_test_id, c.inputs.analyte_id]);
      const e = c.expected;
      const ok = tr && (e.value === null ? tr.value === null : close(tr.value, e.value)) && (tr.reported ?? null) === (e.reported ?? null)
        && (tr.value_text ?? null) === (e.value_text ?? null) && tr.conformance === e.conformance && tr.stage === 'Final';
      put(c.check_code, ok ? 'Pass' : 'Fail', { text: tr ? `${tr.reported ?? tr.value_text ?? '(none)'}, ${tr.conformance}${tr.value !== null ? ' (unrounded ' + tr.value + ')' : ''}, ${tr.stage}` : 'No stored result', ...(tr || {}) },
        ok ? null : 'Differs from the independent calculation', b.id, '#/samples/' + smp.sample_id);
    }
  }
  // ---- across the run
  await as('executor');
  const os = await t.one('SELECT status::text AS s FROM lab_order WHERE id = $1', [setup.x.lab_order_id]);
  const oc = one('order_status');
  if (oc && batches.length && ![...blocked.keys()].length) put(oc.check_code, os.s === 'Approved' ? 'Pass' : 'Fail', { text: os.s }, null, null, '#/orders/' + setup.x.lab_order_id);
  const au = one('audit');
  if (au && batches.length) {
    const ids = batches.map((b) => b.id);
    const a1 = await t.one(`SELECT count(*)::int AS vals, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM audit_log al WHERE al.table_name = 'entry_value' AND al.record_id = ev.id AND al.action = 'CREATE' AND al.changed_by = ev.created_by))::int AS audited
        FROM entry_value ev JOIN step_run r ON r.id = ev.step_run_id WHERE r.batch_id = ANY($1::uuid[])`, [ids]);
    const a2 = await t.one(`SELECT count(*)::int AS steps, count(*) FILTER (WHERE se.id IS NOT NULL AND EXISTS (SELECT 1 FROM audit_log al WHERE al.table_name = 'step_run' AND al.record_id = r.id AND al.signature_id = r.signature_id))::int AS signed
        FROM step_run r LEFT JOIN signature_event se ON se.id = r.signature_id WHERE r.batch_id = ANY($1::uuid[]) AND r.status = 'Completed'`, [ids]);
    const ok = a1.vals > 0 && a1.vals === a1.audited && a2.steps === a2.signed;
    put(au.check_code, ok ? 'Pass' : 'Fail', { text: `${a1.audited} of ${a1.vals} values audited under who recorded them; ${a2.signed} of ${a2.steps} completed steps with their signature in the audit trail` }, null, batches[0].id, '#/testing/batches/' + batches[0].id + '?step=results');
  }
  // ---- record every check (blocked batches leave theirs Not tested, with the reason)
  const why = [...blocked.values()];
  for (const c of checks) {
    const o = res.get(c.check_code);
    if (!o) {
      if (why.length) await t.query('SELECT record_verification_check($1, $2, $3::jsonb, $4, $5, NULL, NULL)', [verificationId, c.check_code, '{}', 'Not tested', 'Blocked: ' + why.join('; ')]);
      continue;
    }
    const result = o.results.includes('Fail') ? 'Fail' : o.results.includes('Not tested') ? 'Not tested' : 'Pass';
    const actual = o.actual.length === 1 ? o.actual[0] : { text: o.actual.map((x) => x.text).join('; '), runs: o.actual };
    await t.query('SELECT record_verification_check($1, $2, $3::jsonb, $4, $5, $6, $7)', [verificationId, c.check_code, JSON.stringify(actual), result, [...new Set(o.notes)].join('; ') || null, o.batch, o.evidence]);
  }
  return { batches: batches.map((b) => b.code), blocked: why };
}

module.exports = { GENERATOR, Q, evaluate, reportValue, roundResult, conformance, dilutionFactor, formulaTokens, fieldKey, loadDesign, buildProtocol, calculateEntry, execute, pgList };
