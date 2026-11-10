// Intake dashboard (rush approvals, incoming work) and the Outbox
import { get, post } from './client.js';

export const getIntake = ({ fresh = false } = {}) => get('/intake', { fresh });
// { requested_test_id, decision: 'Approved' | 'Not Accepted', requested_tier_id, replacement_tier_id, reason }
export const decideRush = (body) => post('/rush-decisions', body);

// One page of emails, newest first
export function listOutbox({ page, size, q }, { fresh = false } = {}) {
  const p = new URLSearchParams({ page: String(page), size: String(size) });
  if (q) p.set('q', q);
  return get(`/outbox?${p}`, { fresh });
}
