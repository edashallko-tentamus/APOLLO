// Self-check of the logbook preview calculator: node src/pages/logbooks/calc.test.js
import assert from 'node:assert/strict';
import { calcExpr, evalFormula, judge, fmtN, needsReason } from './calc.js';

assert.equal(calcExpr('1 + 2 * 3'), 7);
assert.equal(calcExpr('(1 + 2) * 3'), 9);
assert.equal(calcExpr('2 ^ 3 ^ 2'), 512); // right associative
assert.equal(calcExpr('-2 ^ 2'), -4);
assert.equal(calcExpr('10 / 4 - 1.5e0'), 1);
assert.equal(calcExpr('log10(1000)'), 3);
assert.equal(calcExpr('max(1, 5, 3) + min(2, 4)'), 7);
assert.equal(calcExpr('power(2, 10)'), 1024);
assert.equal(calcExpr('1 / 0'), null); // not finite
assert.equal(calcExpr('1 +'), null);
assert.equal(calcExpr('alert(1)'), null); // unknown function
assert.equal(calcExpr('1 ; 2'), null); // stray characters
assert.equal(calcExpr('constructor'), null);

assert.equal(evalFormula('{a} * {b}', { a: 2, b: 3 }), 6);
assert.equal(evalFormula('{a} * {b}', { a: 2 }), null); // missing value
assert.equal(evalFormula('{lot.passage} + 1', {}), null); // only known on save

const fields = [
  { field_key: 'nominal', label: 'Nominal', field_type: 'Number' },
  { field_key: 'reading', label: 'Reading', field_type: 'Number' },
  { field_key: 'error', label: 'Error', field_type: 'Calculated', formula: '({reading} - {nominal}) / {nominal} * 100', unit: '%', limit_min: -1, limit_max: 1 },
  { field_key: 'visual', label: 'Visual', field_type: 'Pass/Fail' },
];
let j = judge(fields, { f_nominal: '100', f_reading: '100.5', f_visual: 'Pass' });
assert.equal(j.vals.error, 0.5); assert.deepEqual(j.probs, []);
j = judge(fields, { f_nominal: 100, f_reading: 102, f_visual: 'Fail' });
assert.deepEqual(j.probs, ['Error 2 % is above 1', 'Visual: Fail']);
// per-equipment limits win over the field's own
const perEq = [{ field_key: 'temperature', label: 'Temp', field_type: 'Number', equipment_limits: true, limit_min: 0, limit_max: 100 }];
assert.equal(judge(perEq, { f_temperature: 9 }, { limits: { temperature: { min: 2, max: 8 } } }).probs.length, 1);
assert.equal(judge(perEq, { f_temperature: 26 }, { temperature_c: 25, temperature_tol: 2 }).probs.length, 0);

assert.equal(fmtN(1234567), '1.235 x 10^6');
assert.equal(fmtN(0.1 + 0.2), '0.3');
assert.equal(needsReason({ result: 'Fail', status: 'Recorded' }), true);
assert.equal(needsReason({ result: 'Fail', status: 'Voided' }), false);

console.log('logbook calculator: all checks passed');
