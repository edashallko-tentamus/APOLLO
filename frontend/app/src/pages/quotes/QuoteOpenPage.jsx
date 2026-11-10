// #/quotes/<quote id> (links from the audit trail): opens its latest version
import { useEffect } from 'react';
import { getProject } from '../../api/quotes.js';
import { useApi } from '../../hooks/useApi.js';

export default function QuoteOpenPage({ params }) {
  const id = params[0];
  const { data, error } = useApi(() => getProject(id), [id]);
  const target = !data ? null : data.project?.kind === 'Stability' ? '#/stability/quotes/' + id : data.versions[0] ? '#/quote/' + data.versions[0].id : null;
  useEffect(() => { if (target) window.location.replace(target); }, [target]);
  if (error) return <div className="card err">{error.message}</div>;
  if (data && !target) return <div className="card">This quote has no version.</div>;
  return <div className="loading">Loading…</div>;
}
