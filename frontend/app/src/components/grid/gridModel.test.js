// Self-check of the grid rules: node src/components/grid/gridModel.test.js (npm test in frontend/app)
import assert from 'node:assert/strict';
import * as M from './gridModel.js';

const columns = [
  { field: 'code', title: 'Code', type: 'readonly' },
  { field: 'name', title: 'Name', required: true },
  { field: 'qty', title: 'Qty', type: 'int', min: 0 },
  { field: 'ok', title: 'OK', type: 'bool' },
  { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'] },
];
const rows = [
  { id: 1, code: 'A', name: 'one', qty: 1, ok: false, status: 'Active' },
  { id: 2, code: 'B', name: 'two', qty: 2, ok: false, status: 'Active' },
  { id: 3, code: 'C', name: 'three', qty: 3, ok: false, status: 'Active' },
];
const ctx = (st, extra = {}) => ({ columns, view: M.viewOf(st, columns), allowAdd: true, newRow: () => ({ status: 'Active' }), ...extra });
const sel = (st, r1, c1, r2 = r1, c2 = c1) => ({ ...st, sel: { r1, c1, r2, c2 }, anchor: { r: r1, c: c1 }, extra: [] });

// reading values
assert.deepEqual(M.parse(columns[2], ' 12 ', {}), { value: 12 });
assert.equal(M.parse(columns[2], '1.5', {}).error, 'Whole number required');
assert.equal(M.parse(columns[2], '-1', {}).error, 'Must be at least 0');
assert.deepEqual(M.parse(columns[4], 'inactive', {}), { value: 'Inactive' });
assert.equal(M.parse(columns[4], 'Gone', {}).error, 'Not one of the allowed values');
assert.equal(M.parse(columns[1], '', {}).error, 'Required');
assert.deepEqual(M.parse({ type: 'date' }, '3/7/2026', {}), { value: '2026-03-07' });
assert.deepEqual(M.parse({ type: 'bool' }, 'Yes', {}), { value: true });

const st0 = M.initState(rows);

// fill down: a block takes its top row; nothing changes in place
let st = M.fillDown(sel(st0, 0, 1, 2, 2), ctx(sel(st0, 0, 1, 2, 2)));
assert.deepEqual(st.rows.map((r) => [r.name, r.qty]), [['one', 1], ['one', 1], ['one', 1]]);
assert.equal(st0.rows[1].name, 'two', 'original state untouched');
assert.deepEqual(M.getChanges(st, columns), [{ id: 2, name: 'one', qty: 1 }, { id: 3, name: 'one', qty: 1 }]);
// a single cell takes the row above; read-only columns are skipped
st = M.fillDown(sel(st0, 1, 0, 1, 1), ctx(sel(st0, 1, 0, 1, 1)));
assert.equal(st.rows[1].code, 'B'); assert.equal(st.rows[1].name, 'one');

// paste from Excel: a block, with bad cells marked and new rows added
st = M.paste(sel(st0, 1, 1), ctx(sel(st0, 1, 1)), 'x\t5\r\ny\tbad\r\nz\t7\r\n');
assert.deepEqual(st.rows.map((r) => r.name), ['one', 'x', 'y', 'z']);
assert.equal(st.rows[3].qty, 7); assert.equal(st.isNew[3], true);
assert.equal(st.errors[2].qty, 'Not a number'); assert.equal(M.errorCount(st), 1);
assert.deepEqual(st.sel, { r1: 1, c1: 1, r2: 3, c2: 2 });
// one value fills the selection
st = M.paste(sel(st0, 0, 4, 2, 4), ctx(sel(st0, 0, 4, 2, 4)), 'Inactive');
assert.deepEqual(st.rows.map((r) => r.status), ['Inactive', 'Inactive', 'Inactive']);

// Ctrl+click selections: fill down copies each column's first selected value
let s2 = M.pressCell(st0, 0, 2, {}); s2 = M.pressCell(s2, 2, 2, { ctrl: true });
assert.equal(s2.extra.length, 1);
st = M.fillDown(s2, ctx(s2));
assert.deepEqual(st.rows.map((r) => r.qty), [1, 2, 1]);
// Ctrl+click a selected cell takes it out
s2 = M.pressCell(s2, 2, 2, { ctrl: true });
assert.deepEqual(M.selRows(s2), [0]);

// clear, toggle, move
st = M.clearSel(sel(st0, 0, 1), ctx(st0)); assert.equal(st.errors[0].name, 'Required');
st = M.toggleSel(sel(st0, 0, 3, 2, 3), ctx(st0)); assert.deepEqual(st.rows.map((r) => r.ok), [true, true, true]);
st = M.move(sel(st0, 2, 4), ctx(st0), 1, 1, false); assert.deepEqual(st.anchor, { r: 2, c: 4 }, 'stays inside');
// read only grid changes nothing
const ro = sel(st0, 0, 1);
assert.equal(M.paste(ro, ctx(st0, { readOnly: true }), 'q'), ro);

// filter and sort give display order
assert.deepEqual(M.viewOf({ ...st0, filter: 'th' }, columns), [2]);
assert.deepEqual(M.viewOf({ ...st0, sort: { ci: 2, dir: -1 } }, columns), [2, 1, 0]);

// rows added with given values are new rows, starting from newRow()
st = M.addRows(st0, ctx(st0), [{ name: 'four' }]);
assert.deepEqual(st.rows[3], { status: 'Active', name: 'four' }); assert.equal(st.isNew[3], true);

console.log('gridModel: all checks passed');
