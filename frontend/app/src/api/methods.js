// Workflow Designer (backend: methods module): tests and their versions, Methods (SOPs), the designer's writes.
// Every write to a Draft is signed (signature) and a change carries its reason; the backend checks it all again.
import { get, post, put } from './client.js';

const INV = '/methods';

export const listTests = (opts) => get('/methods/tests', opts);
export const newTestOptions = () => get('/methods/new-options');
export const createTest = (row, signature) => post('/methods/tests', { row, signature }, { invalidates: INV });
export const getTest = (id, opts) => get('/methods/tests/' + id, opts);
export const newVersion = (testId, signature) => post(`/methods/tests/${testId}/new-version`, { signature }, { invalidates: INV });
export const copyTest = (testId, body) => post(`/methods/tests/${testId}/copy`, body, { invalidates: INV });

export const listSops = (opts) => get('/methods/sops', opts);
export const saveSops = (rows, reason, signature) => post('/methods/sops', { rows, reason, signature }, { invalidates: INV });

export const getVersion = (id, opts) => get('/methods/versions/' + id, opts);
// body: { test: {changed fields}, version: {changed fields}, reason, signature }
export const saveHeader = (vid, body) => put(`/methods/versions/${vid}/header`, body, { invalidates: INV });
export const saveAnalytes = (vid, rows, reason, signature) => post(`/methods/versions/${vid}/analytes`, { rows, reason, signature }, { invalidates: INV });
// body: { step, deps, equipment, reason, signature } → the saved step { id }
export const saveStep = (vid, body) => post(`/methods/versions/${vid}/steps`, body, { invalidates: INV });
export const removeStep = (vid, stepId, reason, signature) => post(`/methods/versions/${vid}/steps/${stepId}/remove`, { reason, signature }, { invalidates: INV });
export const approveVersion = (vid, signature) => post(`/methods/versions/${vid}/approve`, { signature, reason: 'Test version approved' }, { invalidates: INV });
export const formulaTest = (formula, values) => post('/methods/formula-test', { formula, values });
