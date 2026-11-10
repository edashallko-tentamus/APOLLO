// Parts the Report Finalization screens share: formats, a selectable read-only grid, and the review session
// (the COAs picked on the queue, reviewed one at a time on #/reports/review).
import { useEffect } from 'react';
import DataGrid from '../../components/grid/DataGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import './reports.css';

export const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
export const d8 = (v) => (v ? new Date(v).toLocaleDateString([], { dateStyle: 'medium' }) : '');
export const Loading = () => <div className="loading">Loading…</div>;
export const Failed = ({ error }) => <div className="card err">{error.message}</div>;

// A read-only grid whose selected rows a button reads through gridRef.current.selectedRows()
const NONE = [];
export function SelectGrid({ rows, columns, gridRef, ...props }) {
  const list = rows || NONE;
  const grid = useGrid({ rows: list, columns, readOnly: true });
  const { reset } = grid;
  useEffect(() => { reset(list); }, [list, reset]);
  gridRef.current = grid;
  return <DataGrid grid={grid} {...props} />;
}

// The review session: { items: [{ sample_id, sample_code, client_sample_id, tests, test_names }], i, ready, acks, data }.
// Kept for the browser tab's life, like the current app (leaving the review and coming back keeps it).
export const review = { session: null };
export function startReview(items) {
  review.session = { items, i: 0, ready: {}, acks: {}, data: {} };
  window.location.hash = '#/reports/review';
}
