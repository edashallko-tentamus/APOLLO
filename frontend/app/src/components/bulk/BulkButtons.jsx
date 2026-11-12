// Excel export and bulk upload buttons for a list page (backend: bulk module, one KIND per list).
//   <BulkButtons kind="suppliers" selected={() => tickedIds} onDone={reload} />
//     selected(): ids of the ticked rows to export (optional; none = the whole list)
//     onDone(): after an upload is saved (reload the list)
// Upload shows every change and every error per row before anything is saved; one Reason for Change and one electronic
// signature ("Uploaded by") cover it, all or nothing. Some lists may only be uploaded by some people (UPLOAD_PERMISSION):
// the inventory list itself by QA and administrators (GxP risk); the backend refuses anyone else anyway.
// Also exported: useExportList() for an export from another button (e.g. a template), printTable() in printTable.js.
import { useCallback, useEffect, useRef, useState } from 'react';
import { applyUpload, exportFile, previewUpload } from '../../api/bulk.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { useDialogs } from '../dialogs/DialogProvider.jsx';
import DataGrid from '../grid/DataGrid.jsx';
import { useGrid } from '../grid/useGrid.js';
import { useToast } from '../Toasts.jsx';
import './bulk.css';
import { Button } from 'react-bootstrap';
import { Dialog } from '../Modal.jsx';

const UPLOAD_PERMISSION = { lots: 'inventory.upload', equipment: 'equipment.edit' }; // who may upload (the backend and database check too)
const MAX_PREVIEW_W = 760;

function saveBlob({ blob, name }) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

// exportList(kind, ids = [], template = false): downloads the file and says so
export function useExportList() {
  const { site } = useSession();
  const toast = useToast();
  return useCallback(async (kind, ids = [], template = false) => {
    try {
      const f = await exportFile(kind, { ids, template, siteId: site?.id });
      saveBlob(f);
      toast(`Exported ${ids.length ? ids.length + ' ticked row' + (ids.length === 1 ? '' : 's') : 'the list'} to ${f.name}`);
    } catch (e) { toast(e.message, 'err'); }
  }, [site, toast]);
}

async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer()); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const PREVIEW_COLS = [{ field: 'row', title: 'Row', type: 'readonly', width: 55 }, { field: 'key', title: 'ID', type: 'readonly', width: 120 },
  { field: 'action', title: 'Action', type: 'readonly', width: 80 }, { field: 'what', title: 'Changes or errors', type: 'readonly', width: MAX_PREVIEW_W }];
const errRow = (r) => (r.action === 'Error' ? 'errrow' : '');

function PreviewGrid({ rows }) {
  const grid = useGrid({ rows, columns: PREVIEW_COLS, keyField: 'row', readOnly: true });
  return <DataGrid grid={grid} rowClass={errRow} emptyText="Nothing to change: the file matches what is stored." />;
}

function UploadDialog({ kind, onDone }) {
  const dialogs = useDialogs();
  const exportList = useExportList();
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [p, setP] = useState(null); // { payload, file, rows, counts, unknownHeaders }
  const box = useRef(null);
  useEffect(() => { box.current?.querySelector('input')?.focus(); }, []);

  async function choose(e) {
    const file = e.target.files[0]; if (!file) return;
    setError(''); setP(null); setReading(true);
    try {
      const payload = { file_name: file.name, content_base64: await fileToBase64(file) };
      const res = await previewUpload(kind, payload);
      const n = (a) => res.rows.filter((r) => r.action === a).length;
      const rows = res.rows.filter((r) => r.action !== 'No change').map((r) => ({ ...r,
        what: r.errors.length ? r.errors.join(' · ') : Object.entries(r.changes).map(([k, [a, b]]) => `${k}: ${a === '' ? '∅' : a} → ${b === '' ? '∅' : b}`).join(' · ') }));
      setP({ payload, file: file.name, rows, total: res.total, unknownHeaders: res.unknownHeaders || [],
        counts: { creates: n('Create'), updates: n('Update'), errors: n('Error'), same: n('No change') } });
    } catch (ex) { setError(ex.message); }
    setReading(false);
  }

  const c = p?.counts;
  const canSave = !!c && !c.errors && c.creates + c.updates > 0;
  async function save() {
    if (!canSave) return;
    setError('');
    const d = await dialogs.sign({ what: `Excel upload ${p.file}: ${c.creates} to create, ${c.updates} to update`, meaning: 'Uploaded by', needReason: true,
      submit: async ({ reason, signature }) => {
        try { return await applyUpload(kind, p.payload, reason, signature); }
        catch (e) { throw new Error((e.message || 'The upload could not be saved') + ' Nothing was saved.'); }
      } });
    if (d) onDone(d);
  }

  return (
    <Dialog label="Upload from Excel" xwide onClose={() => onDone(null)}>
      <div ref={box} className="modal-body">
        <h3>Upload from Excel</h3>
        <p className="intro">Export the list first, edit it in Excel (change cells, or add rows with an empty ID), save it, and upload it here.
          Rows are matched on their ID. You will see every change before anything is saved. <a href="#" onClick={(e) => { e.preventDefault(); exportList(kind, [], true); }}>Download an empty template</a>.</p>
        <div className="field"><input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={choose} /></div>
        {reading && <p className="help">Reading the file…</p>}
        {c && <>
          <div className="bulksum"><span><b>{p.total}</b> rows read</span><span className="c-new"><b>{c.creates}</b> to create</span>
            <span className="c-upd"><b>{c.updates}</b> to update</span><span><b>{c.same}</b> unchanged</span><span className={c.errors ? 'c-err' : ''}><b>{c.errors}</b> with errors</span></div>
          {p.unknownHeaders.length > 0 && <p className="help">Columns not used: {p.unknownHeaders.join(', ')}.</p>}
          {c.errors > 0 && <p className="bad">Fix the rows with errors in Excel and upload the file again. Nothing has been saved.</p>}
          <PreviewGrid key={p.file + p.total + p.rows.length} rows={p.rows} />
        </>}
        <div className="merr" role="alert">{error}</div>
        <div className="mbtns">
          <Button type="button" variant="light" onClick={() => onDone(null)}>Cancel</Button>
          <Button type="button" variant="primary" disabled={!canSave} onClick={save}>
            {canSave ? `Sign and save ${c.creates + c.updates} row${c.creates + c.updates === 1 ? '' : 's'}` : 'Save changes'}</Button>
        </div>
      </div>
    </Dialog>
  );
}

export default function BulkButtons({ kind, selected = () => [], onDone }) {
  const { can } = useSession();
  const dialogs = useDialogs();
  const toast = useToast();
  const exportList = useExportList();
  const mayUpload = !UPLOAD_PERMISSION[kind] || can(UPLOAD_PERMISSION[kind]);
  async function upload() {
    const d = await dialogs.open((done) => <UploadDialog kind={kind} onDone={done} />);
    if (!d) return;
    toast(`Upload saved and signed: ${d.created} created, ${d.updated} updated.`);
    onDone?.();
  }
  return <>
    <Button type="button" variant="outline-secondary" title="Download this list as an Excel file (only the ticked rows, if any are ticked)" onClick={() => exportList(kind, selected())}>Export XLSX</Button>
    {mayUpload && <> <Button type="button" variant="outline-secondary" title="Upload an edited Excel file to update or add rows in bulk" onClick={upload}>Upload XLSX</Button></>}
  </>;
}
