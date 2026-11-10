// Specifications of a quoted test or a requested test (owner: { quoted_line } or { requested_test })
import { get, post } from './client.js';

const ownerQs = (owner) => (owner.quoted_line ? 'quoted_line=' + owner.quoted_line : 'requested_test=' + owner.requested_test);

// { owner: { kind, editable, test_code, test_name, sample_code }, analytes: [...], specs: [...] }
export const getSpecs = (owner) => get('/specs?' + ownerQs(owner), { fresh: true });
export const saveSpecs = (owner, rows, reason) => post('/specs', { ...owner, rows, reason });
