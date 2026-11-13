// Printing barcode labels from any screen:
//   const printLabels = usePrintLabels();
//   await printLabels('lot', [id1, id2]);          // kind: sample | lot | equipment | batch
// It loads what each label shows, opens the dialog (how many, a preview), then prints through the browser: one label per
// page, the page the size of the label (the Dymo driver takes it from there).
import { useCallback, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { getLabels } from '../../api/labels.js';
import { useDialogs } from '../dialogs/DialogProvider.jsx';
import Modal from '../Modal.jsx';
import SmartSelect from '../SmartSelect.jsx';
import { useToast } from '../Toasts.jsx';
import { buildLabels, SIZES } from './Labels.jsx';

const KIND_WORDS = { sample: ['sample', 'samples', '2 1/8 x 4 in.'], lot: ['inventory item', 'inventory items', '1 x 2 1/8 in.'], equipment: ['piece of equipment', 'equipment', '1 x 2 1/8 in.'], batch: ['batch', 'batches', '1 x 2 1/8 in.'] };
const PREVIEW_MAX = 60;

function LabelDialog({ kind, rows, onDone }) {
  const [one, many, size] = KIND_WORDS[kind];
  const [copies, setCopies] = useState(''); // '' = as many as units
  const [mode, setMode] = useState('entries');
  const labels = useMemo(() => buildLabels(kind, rows, copies === '' ? null : Number(copies), mode), [kind, rows, copies, mode]);
  const title = `Print labels: ${rows.length === 1 ? (rows[0].sample_code || rows[0].lot_code || rows[0].equipment_code || rows[0].batch_code) : rows.length + ' ' + many}`;
  const unitWord = kind === 'sample' ? 'units of each sample' : kind === 'lot' ? 'containers of each item' : 'items';
  return (
    <Modal title={title} okText="Print" wide onOk={() => onDone({ copies: copies === '' ? null : Number(copies), mode })} onClose={() => onDone(null)}>
      <div className="field"><label htmlFor="lb_how">How many</label>
        {kind === 'batch'
          ? <SmartSelect id="lb_how" value={mode} onChange={setMode} options={[{ value: 'entries', label: 'One label per entry (each sample and QC: the default)' }, { value: 'batch', label: 'One label for the batch' }]} />
          : <SmartSelect id="lb_how" value={copies} onChange={setCopies}
            options={[{ value: '', label: `As many as there are ${unitWord} (default)` }, ...[1, 2, 3, 4, 5, 6, 8, 10].map((n) => ({ value: String(n), label: `${n} of each` }))]} />}
      </div>
      <div className="help">{`${labels.length} label${labels.length === 1 ? '' : 's'} for ${rows.length} ${rows.length === 1 ? one : many}${labels.length > PREVIEW_MAX ? ` (first ${PREVIEW_MAX} shown)` : ''}.`}</div>
      <div className="lblprev">{labels.slice(0, PREVIEW_MAX)}</div>
      <div className="help" style={{ marginTop: 8 }}>Dymo LabelWriter 450: in the print window choose the Dymo printer and the {size} label, scale 100%, no margins. Each label prints on its own page; the barcode is Code 128 with the ID printed under it.</div>
    </Modal>
  );
}

// print through the browser: one label per page, the page the size of the label
function printNow(labels, size, toast) {
  let host = document.getElementById('labelPrint');
  if (!host) { host = document.createElement('div'); host.id = 'labelPrint'; document.body.appendChild(host); }
  const root = createRoot(host);
  flushSync(() => root.render(labels)); // drawn before the print window opens
  let page = document.getElementById('labelPage');
  if (!page) { page = document.createElement('style'); page.id = 'labelPage'; document.head.appendChild(page); }
  page.textContent = `@media print { @page { size: ${size.w}in ${size.h}in; margin: 0; } }`;
  document.body.classList.add('printing-labels');
  let finished = false;
  const done = () => {
    if (finished) return; finished = true;
    document.body.classList.remove('printing-labels'); window.removeEventListener('afterprint', done);
    setTimeout(() => root.unmount(), 0);
  };
  window.addEventListener('afterprint', done);
  setTimeout(() => { try { window.print(); } catch (e) { toast('The browser could not open its print window: ' + e.message, 'err'); } setTimeout(done, 1500); }, 50);
}

export function usePrintLabels() {
  const dialogs = useDialogs();
  const toast = useToast();
  return useCallback(async (kind, ids) => {
    ids = [...new Set((ids || []).filter(Boolean))];
    if (!ids.length) { toast('Choose what to print labels for first.', 'err'); return; }
    let rows;
    try { rows = await getLabels(kind, ids); } catch (e) { toast(e.message, 'err'); return; }
    if (!rows.length) { toast(kind === 'sample' ? 'Only logged samples (with a sample ID) get labels.' : 'Nothing to print.', 'err'); return; }
    const go = await dialogs.open((done) => <LabelDialog kind={kind} rows={rows} onDone={done} />);
    if (!go) return;
    printNow(buildLabels(kind, rows, go.copies, go.mode), kind === 'sample' ? SIZES.big : SIZES.small, toast);
  }, [dialogs, toast]);
}
