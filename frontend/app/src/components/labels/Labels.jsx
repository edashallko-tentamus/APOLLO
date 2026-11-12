// Barcode labels (Alex, 2026-10-13): Code 128 barcodes (1D: most labs already have the scanners), printed on a Dymo
// LabelWriter 450 through its driver. Samples use 2 1/8 x 4 in. labels (the tests and due dates; a long list continues
// on the next label); inventory lots, equipment and batches use 1 x 2 1/8 in. labels. By default as many labels print
// as there are units (sample units, inventory containers, batch entries). The ID is always printed as text too.
import { cloneElement } from 'react';
import { code128Modules } from './code128.js';
import './labels.css';

export const SIZES = { big: { w: 4, h: 2.125 }, small: { w: 2.125, h: 1 } };
const d10 = (v) => (v ? String(v).slice(0, 10) : '');

// the barcode, filling the given width (inches) with a 10-module quiet zone each side
export function Barcode({ text, widthIn, heightIn }) {
  const runs = code128Modules(text);
  const total = runs.reduce((a, b) => a + b, 0) + 20;
  const rects = []; let x = 10;
  runs.forEach((w, k) => { if (k % 2 === 0) rects.push(<rect key={k} x={x} y="0" width={w} height="100" />); x += w; });
  return (
    <svg className="bc" xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${total} 100`} preserveAspectRatio="none" shapeRendering="crispEdges"
      style={{ width: `${widthIn}in`, height: `${heightIn}in` }} role="img" aria-label={`Barcode ${text}`} data-code={text}>{rects}</svg>
  );
}

const SmallLabel = ({ code, line1, line2 }) => (
  <div className="lbl small"><Barcode text={code} widthIn={1.99} heightIn={0.42} /><div className="id">{code}</div>
    <div className="t">{line1 || ''}</div><div className="t">{line2 || ''}</div></div>
);

// a sample: the first label has the details and up to 6 tests; a long list continues on more labels (up to 10 each)
function sampleLabels(s) {
  const tests = s.tests || [];
  const pages = [tests.slice(0, 6)];
  for (let i = 6; i < tests.length; i += 10) pages.push(tests.slice(i, i + 10));
  return pages.map((list, k) => (
    <div className="lbl big"><Barcode text={s.sample_code} widthIn={3.76} heightIn={0.5} />
      <div className="lrow"><div className="id">{s.sample_code}</div><div className="t" style={{ alignSelf: 'center' }}>{s.order_code || ''}{s.logged_at ? ' · logged ' + d10(s.logged_at) : ''}</div></div>
      {k === 0 ? <>
        <div className="t">{[s.client_sample_id, s.matrix, s.product_lot ? 'lot ' + s.product_lot : ''].filter(Boolean).join(' · ')}</div>
        <div className="t">{s.client_name || ''}{s.description ? ' · ' + s.description : ''}</div>
      </> : <div className="t">Tests (continued)</div>}
      <div className="tests">{list.length ? list.map((x, i) => (
        <div key={i}><span>{x.test_name}{x.rush && <> <b>RUSH</b></>}</span><span>Due <b>{d10(x.due_date) || 'n/a'}</b></span></div>
      )) : <div><span>No tests ordered</span></div>}</div>
      {pages.length > 1 && <div className="pg">{k + 1} of {pages.length}</div>}
    </div>
  ));
}
function lotLabel(l) {
  const exp = l.expiration_date ? `Exp ${d10(l.expiration_date)}` : l.retest_date ? `Retest ${d10(l.retest_date)}` : 'No expiry';
  return <SmallLabel code={l.lot_code} line1={l.item_name}
    line2={`${exp}${l.manufacturer_lot ? ' · Lot ' + l.manufacturer_lot : ''}${l.qa_status && !/^Released/.test(l.qa_status) ? ' · ' + l.qa_status.toUpperCase() : ''}`} />;
}
function equipmentLabel(e) {
  return <SmallLabel code={e.equipment_code} line1={e.equipment_name}
    line2={`${e.cal_expires ? 'Cal exp ' + d10(e.cal_expires) : 'No calibration on record'}${e.serial_number ? ' · SN ' + e.serial_number : ''}`} />;
}
function batchLabels(b, mode) {
  if (mode === 'batch') return [<SmallLabel code={b.batch_code} line1={`${b.test_code} ${b.test_name}`} line2={`${(b.entries || []).length} entries · made ${d10(b.created_at)}`} />];
  // one per entry: a sample's tube carries its sample ID; a QC entry carries the batch ID
  return (b.entries || []).map((e) => <SmallLabel code={e.entry_type === 'Sample' && e.sample_code ? e.sample_code : b.batch_code}
    line1={`#${e.position} ${e.label}`} line2={`${b.batch_code} · ${b.test_name}`} />);
}

export const unitsOf = (kind, x) => (kind === 'sample' ? Number(x.number_of_units) || 1 : kind === 'lot' ? Number(x.container_count) || 1 : 1);

// every label to print, in order. copies: null = as many as units; mode (batches): 'entries' or 'batch'
export function buildLabels(kind, rows, copies, mode) {
  const out = [];
  for (const x of rows) {
    const n = copies === null ? unitsOf(kind, x) : copies;
    const set = kind === 'sample' ? sampleLabels(x) : kind === 'lot' ? [lotLabel(x)] : kind === 'equipment' ? [equipmentLabel(x)] : batchLabels(x, mode);
    for (let i = 0; i < (kind === 'batch' ? 1 : n); i++) out.push(...set);
  }
  return out.map((el, i) => cloneElement(el, { key: String(i) }));
}
