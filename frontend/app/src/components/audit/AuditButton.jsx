// The small audit-trail icon beside every page title: every change to this record and its parts (or to the records
// of a list page), newest first, written by the database and never editable. Records open from their links.
import { useEffect, useMemo } from 'react';
import { auditScope } from '../../api/common.js';
import { useApi } from '../../hooks/useApi.js';
import { useDialogs } from '../dialogs/DialogProvider.jsx';
import DataGrid from '../grid/DataGrid.jsx';
import { useGrid } from '../grid/useGrid.js';
import { auditColumns } from './auditColumns.js';
import { Button, Card } from 'react-bootstrap';
import { Dialog } from '../Modal.jsx';

const COLUMNS = auditColumns();
const NO_ROWS = [];

function AuditDialog({ scope, title, onDone }) {
  const { data, error, loading } = useApi(() => auditScope(scope), [scope.kind, scope.id]);
  const rows = data || NO_ROWS;
  const grid = useGrid({ rows, columns: COLUMNS, readOnly: true });
  const { reset } = grid;
  useEffect(() => { reset(rows); }, [rows, reset]);
  useEffect(() => { // following a record's link closes the dialog
    window.addEventListener('hashchange', onDone);
    return () => window.removeEventListener('hashchange', onDone);
  }, [onDone]);
  return (
    <Dialog label={`Audit trail: ${title}`} xwide onClose={() => onDone()}>
      <div className="modal-body">
        <h3>Audit trail: {title}</h3>
        <p className="intro">{scope.id ? 'Every change to this record and its parts' : 'Every change to the records on this page'}, newest first (latest 500). Written by the database; it cannot be edited. Click a record to open it.</p>
        {error ? <Card body className="err">{error.message}</Card> : loading && !data ? <div className="loading">Loading…</div>
          : <DataGrid grid={grid} search emptyText="No changes recorded yet." maxHeight="60vh" />}
        <div className="mbtns"><Button type="button" variant="primary" onClick={() => onDone()} autoFocus>Close</Button></div>
      </div>
    </Dialog>
  );
}

export default function AuditButton({ scope, title }) {
  const dialogs = useDialogs();
  const key = useMemo(() => scope, [scope.kind, scope.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <button type="button" className="auditbtn" title="Audit trail: what changed on this page, who changed it and why" aria-label="Audit trail for this page"
      onClick={() => dialogs.open((done) => <AuditDialog scope={key} title={title} onDone={() => done()} />)}>
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2" /></svg>
    </button>
  );
}
