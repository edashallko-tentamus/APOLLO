// Excel export and bulk upload buttons for a list page (server: server/bulk.js).
// Upload shows every change and every error per row before anything is saved; one Reason for Change and one electronic signature cover it.
// The inventory list itself can only be uploaded by QA and administrators (GxP risk; the server refuses anyone else).
import { esc, state, toast, can, signDialog } from './app.js';
import { Grid } from './grid.js';

const UPLOAD_PERMISSION = { lots: 'inventory.upload', equipment: 'equipment.edit' }; // who may upload (the server and database check too)
export function bulkButtons(kind) {
  if (UPLOAD_PERMISSION[kind] && !can(UPLOAD_PERMISSION[kind])) return `<button class="btn" data-export="${kind}" title="Download this list as an Excel file (only the ticked rows, if any are ticked)">Export XLSX</button>`;
  return `<button class="btn" data-export="${kind}" title="Download this list as an Excel file (only the ticked rows, if any are ticked)">Export XLSX</button>
    <button class="btn" data-upload="${kind}" title="Upload an edited Excel file to update or add rows in bulk">Upload XLSX</button>`;
}

// selected(): ids of ticked rows (optional); done(): reload the page after an upload
export function wireBulk(root, { selected = () => [], done }) {
  root.querySelectorAll('[data-export]').forEach((b) => { b.onclick = () => exportList(b.dataset.export, selected()); });
  root.querySelectorAll('[data-upload]').forEach((b) => { b.onclick = () => uploadList(b.dataset.upload, done); });
}

async function post(path, body) {
  const res = await fetch('/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-site-id': state.site || '' }, body: JSON.stringify(body) });
  return res;
}

export async function exportList(kind, ids = [], template = false) {
  try {
    const res = await post(`/bulk/${kind}/export`, { ids, template });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Export failed'); }
    const blob = await res.blob();
    const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || `${kind}.xlsx`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    toast(`Exported ${ids.length ? ids.length + ' ticked row' + (ids.length === 1 ? '' : 's') : 'the list'} to ${name}`);
  } catch (e) { toast(e.message, 'err'); }
}

async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer()); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function uploadList(kind, done) {
  const m = document.createElement('div'); m.className = 'modal-bg';
  m.innerHTML = `<div class="modal xwide"><h3>Upload from Excel</h3>
    <p class="intro">Export the list first, edit it in Excel (change cells, or add rows with an empty ID), save it, and upload it here.
      Rows are matched on their ID. You will see every change before anything is saved. <a href="#" data-template>Download an empty template</a>.</p>
    <div class="field"><input type="file" id="bulkf" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"></div>
    <div id="bulksum"></div><div id="bulkg"></div>
    <div class="merr"></div>
    <div class="mbtns"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok disabled>Save changes</button></div></div>`;
  document.body.appendChild(m);
  let grid = null; let payload = null; let counts = {};
  const close = () => { if (grid) grid.destroy(); m.remove(); };
  m.querySelector('[data-x]').onclick = close;
  m.querySelector('[data-template]').onclick = (e) => { e.preventDefault(); exportList(kind, [], true); };
  m.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  const ok = m.querySelector('[data-ok]'); const err = m.querySelector('.merr');
  m.querySelector('#bulkf').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    err.textContent = ''; ok.disabled = true; m.querySelector('#bulksum').innerHTML = '<p class="help">Reading the file…</p>';
    try {
      payload = { file_name: file.name, content_base64: await fileToBase64(file) };
      const res = await post(`/bulk/${kind}/preview`, payload); const p = await res.json();
      if (!res.ok) throw new Error(p.error || 'The file could not be read');
      const n = (a) => p.rows.filter((r) => r.action === a).length;
      const creates = n('Create'); const updates = n('Update'); const errors = n('Error'); const same = n('No change');
      m.querySelector('#bulksum').innerHTML = `<div class="bulksum"><span><b>${p.total}</b> rows read</span><span class="c-new"><b>${creates}</b> to create</span>
        <span class="c-upd"><b>${updates}</b> to update</span><span><b>${same}</b> unchanged</span><span class="${errors ? 'c-err' : ''}"><b>${errors}</b> with errors</span></div>
        ${p.unknownHeaders.length ? `<p class="help">Columns not used: ${esc(p.unknownHeaders.join(', '))}.</p>` : ''}
        ${errors ? '<p class="bad">Fix the rows with errors in Excel and upload the file again. Nothing has been saved.</p>' : ''}`;
      const rows = p.rows.filter((r) => r.action !== 'No change').map((r) => ({ ...r,
        what: r.errors.length ? r.errors.join(' · ') : Object.entries(r.changes).map(([k, [a, b]]) => `${k}: ${a === '' ? '∅' : a} → ${b === '' ? '∅' : b}`).join(' · ') }));
      if (grid) grid.destroy();
      grid = new Grid(m.querySelector('#bulkg'), { readOnly: true, rows, emptyText: 'Nothing to change: the file matches what is stored.',
        rowClass: (r) => (r.action === 'Error' ? 'errrow' : ''),
        columns: [{ field: 'row', title: 'Row', type: 'readonly', width: 55 }, { field: 'key', title: 'ID', type: 'readonly', width: 120 },
          { field: 'action', title: 'Action', type: 'readonly', width: 80 }, { field: 'what', title: 'Changes or errors', type: 'readonly', width: 760 }] });
      const can = !errors && (creates + updates) > 0;
      ok.disabled = !can; counts = { creates, updates, file: file.name };
      ok.textContent = can ? `Sign and save ${creates + updates} row${creates + updates === 1 ? '' : 's'}` : 'Save changes';
    } catch (ex) { m.querySelector('#bulksum').innerHTML = ''; err.textContent = ex.message; }
  };
  ok.onclick = async () => {
    err.textContent = '';
    const d = await signDialog({ what: `Excel upload ${counts.file}: ${counts.creates} to create, ${counts.updates} to update`, meaning: 'Uploaded by', needReason: true,
      submit: async ({ reason, signature }) => {
        const res = await post(`/bulk/${kind}/apply`, { ...payload, reason, signature }); const out = await res.json();
        if (!res.ok) throw new Error((out.error || 'The upload could not be saved') + ' Nothing was saved.');
        return out;
      } });
    if (!d) return;
    toast(`Upload saved and signed: ${d.created} created, ${d.updated} updated.`); close(); if (done) done();
  };
}

// Print a simple table of rows (columns: [{ title, get(row) }])
export function printTable(title, columns, rows) {
  const host = document.createElement('div'); host.id = 'printarea';
  host.innerHTML = `<h2>${esc(title)}</h2><p class="help">${esc(new Date().toLocaleString())} · ${rows.length} row${rows.length === 1 ? '' : 's'}</p>
    <table class="qt"><thead><tr>${columns.map((c) => `<th>${esc(c.title)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${columns.map((c) => `<td>${esc(c.get(r) ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  document.body.appendChild(host); document.body.classList.add('printing-list');
  const cleanup = () => { document.body.classList.remove('printing-list'); host.remove(); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => { try { window.print(); } catch (_) { /* printing blocked */ } setTimeout(cleanup, 1000); }, 50);
}
