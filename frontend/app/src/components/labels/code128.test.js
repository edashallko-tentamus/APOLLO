// Self-check of the Code 128 encoder: node src/components/labels/code128.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { code128Modules, code128Values } from './code128.js';

// set B with a set C tail: I N V - then 00 01 23; check digit (104 + 41 + 46*2 + 54*3 + 13*4 + 99*5 + 0*6 + 1*7 + 23*8) % 103 = 4
assert.deepEqual(code128Values('INV-000123'), [104, 41, 46, 54, 13, 99, 0, 1, 23, 4, 106]);
// all digits: start C; (105 + 12 + 34*2 + 56*3) % 103 = 44
assert.deepEqual(code128Values('123456'), [105, 12, 34, 56, 44, 106]);
// an odd digit run in the middle keeps its first digit in set B
assert.deepEqual(code128Values('A1234567B').slice(0, 7), [104, 33, 17, 99, 23, 45, 67]);
assert.throws(() => code128Values('é'));

// every symbol is 11 modules wide, the stop 13
const v = code128Values('CFL261012001');
assert.equal(code128Modules('CFL261012001').reduce((a, b) => a + b, 0), 11 * (v.length - 1) + 13);

// the encoder is the one checked against a scanner decoder: same source text as public/js/labels.js
const section = (t) => { const s = t.split('\r\n').join('\n'); return s.slice(s.indexOf('const P = '), s.indexOf('export function code128Modules')); };
const here = readFileSync(new URL('./code128.js', import.meta.url), 'utf8');
const old = readFileSync(new URL('../../../../public/js/labels.js', import.meta.url), 'utf8');
assert.equal(section(here), section(old));

console.log('code128: all checks passed');
