// The block designer of a report template (migration 074). It only offers what the server draws: fixed blocks with
// settings, a font, a text size and an accent colour. The checked COA values (order, sample ID, client sample ID, lot,
// results) always print; the header comes first and the signature and verification code last.
import { Button, Form } from 'react-bootstrap';

const LABELS = {
  address: 'Address', contact: 'Contact', po: 'PO number', license: 'License',
  description: 'Description', matrix: 'Matrix', product: 'Product', batch: 'Batch', metrc_id: 'METRC ID', category: 'Compliance category',
  serving: 'Serving size', received: 'Received', condition: 'Condition',
  show_method: 'Method', show_test_version: 'Test version', show_tested_dates: 'Dates tested', show_loq: 'LOQ column',
  show_list_price: 'List price column', show_discount: 'Discount column', show_rush: 'Rush column', show_date: 'Date column',
  show_logo: 'Logo', show_address: 'Lab address', show_accreditation: 'Accreditation statement',
};
const BLOCK_NAMES = { client: 'Client', sample: 'Sample', photos: 'Photos', tests: 'Test results', pending: 'Tests in progress', text: 'Text' };
const BLOCK_HELP = {
  client: 'The client\'s name and the order always print.', sample: 'The sample ID, client sample ID and lot always print.',
  tests: 'Each test with its results, units, specification and conformance (always printed).', pending: 'Tests still in the lab, on a partial COA.',
  photos: 'The sample\'s photos marked Report photo 1 and 2 at receipt (4:3).',
};

function Ticks({ keys, values, onChange, disabled }) {
  return <div className="rt-ticks">{keys.map((k) => (
    <label key={k} className="cb"><Form.Check.Input type="checkbox" disabled={disabled} checked={values?.[k] !== false}
      onChange={(e) => onChange({ ...values, [k]: e.target.checked })} /> {LABELS[k] || k}</label>))}</div>;
}

function Theme({ d, set, choices, ro }) {
  const t = d.theme || {};
  const th = (k, v) => set({ ...d, theme: { ...t, [k]: v } });
  return <div className="rt-row">
    <div className="field"><label>Font</label>
      <Form.Select size="sm" disabled={ro} value={t.font} onChange={(e) => th('font', e.target.value)}>{choices.fonts.map((f) => <option key={f}>{f}</option>)}</Form.Select></div>
    <div className="field"><label>Text size</label>
      <Form.Select size="sm" disabled={ro} value={t.size} onChange={(e) => th('size', Number(e.target.value))}>{choices.sizes.map((s) => <option key={s} value={s}>{s} pt</option>)}</Form.Select></div>
    <div className="field"><label>Accent colour</label>
      <div className="rt-swatches" role="radiogroup" aria-label="Accent colour">{choices.accents.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={t.accent === c} aria-label={c} disabled={ro} className={'rt-sw' + (t.accent === c ? ' on' : '')}
          style={{ background: c }} onClick={() => th('accent', c)} />))}</div></div>
  </div>;
}

function Text({ label, value, onChange, ro, area, max }) {
  return <div className="field"><label>{label}</label>
    <Form.Control size="sm" as={area ? 'textarea' : 'input'} rows={area ? 3 : undefined} maxLength={max} disabled={ro} value={value || ''} onChange={(e) => onChange(e.target.value)} /></div>;
}

export default function TemplateDesigner({ type, design: d, choices, readOnly: ro, onChange: set }) {
  if (type === 'Invoice') return <div className="rt-design">
    <Theme d={d} set={set} choices={choices} ro={ro} />
    <div className="rt-row">
      <Text label="Title" value={d.title} max={80} ro={ro} onChange={(v) => set({ ...d, title: v })} />
      <Text label="Credit note title" value={d.credit_title} max={80} ro={ro} onChange={(v) => set({ ...d, credit_title: v })} />
      <Text label="Company line (under the lab's name)" value={d.company_line} max={120} ro={ro} onChange={(v) => set({ ...d, company_line: v })} />
    </div>
    <Ticks keys={choices.invoice_flags} values={d} disabled={ro} onChange={(v) => set({ ...d, ...v })} />
    <Text label="Payment text (used when the lab has no remit-to details)" area max={2000} value={d.payment_text} ro={ro} onChange={(v) => set({ ...d, payment_text: v })} />
    <Text label="Footer text" area max={2000} value={d.footer_text} ro={ro} onChange={(v) => set({ ...d, footer_text: v })} />
  </div>;

  const blocks = d.blocks || [];
  const setBlock = (i, b) => set({ ...d, blocks: blocks.map((x, k) => (k === i ? b : x)) });
  const move = (i, by) => { const n = [...blocks]; const [b] = n.splice(i, 1); n.splice(i + by, 0, b); set({ ...d, blocks: n }); };
  const texts = blocks.filter((b) => b.type === 'text').length;
  return <div className="rt-design">
    <Theme d={d} set={set} choices={choices} ro={ro} />
    <div className="rt-row"><Text label="Title" value={d.title} max={80} ro={ro} onChange={(v) => set({ ...d, title: v })} /></div>
    <div className="rt-block fixed"><b>Header</b> <span className="help">always first: the lab's name, the title, report ID, version and issue date</span>
      <Ticks keys={['show_logo', 'show_address', 'show_accreditation']} values={d.header} disabled={ro} onChange={(v) => set({ ...d, header: v })} /></div>
    {blocks.map((b, i) => (
      <div key={i} className="rt-block">
        <div className="rt-bhead">
          <b>{BLOCK_NAMES[b.type] || b.type}</b> <span className="help">{BLOCK_HELP[b.type] || ''}</span>
          {!ro && <span className="rt-bbtn">
            <Button size="sm" variant="light" className="mini" disabled={i === 0} aria-label="Move up" onClick={() => move(i, -1)}>↑</Button>
            <Button size="sm" variant="light" className="mini" disabled={i === blocks.length - 1} aria-label="Move down" onClick={() => move(i, 1)}>↓</Button>
            {b.type === 'text' && <Button size="sm" variant="light" className="mini" onClick={() => set({ ...d, blocks: blocks.filter((_, k) => k !== i) })}>Remove</Button>}
          </span>}
        </div>
        {b.type === 'client' && <Ticks keys={choices.client_fields} values={b.fields} disabled={ro} onChange={(v) => setBlock(i, { ...b, fields: v })} />}
        {b.type === 'sample' && <Ticks keys={choices.sample_fields} values={b.fields} disabled={ro} onChange={(v) => setBlock(i, { ...b, fields: v })} />}
        {b.type === 'tests' && <Ticks keys={choices.test_options} values={b} disabled={ro} onChange={(v) => setBlock(i, { ...b, ...v })} />}
        {b.type === 'photos' && <Form.Select size="sm" className="rt-narrow" disabled={ro} value={b.count} onChange={(e) => setBlock(i, { ...b, count: Number(e.target.value) })}>
          <option value={0}>No photos</option><option value={1}>1 photo</option><option value={2}>2 photos</option></Form.Select>}
        {b.type === 'text' && <Form.Control size="sm" as="textarea" rows={2} maxLength={2000} disabled={ro} value={b.text || ''} onChange={(e) => setBlock(i, { ...b, text: e.target.value })} />}
      </div>
    ))}
    {!ro && texts < 5 && <Button size="sm" variant="outline-secondary" onClick={() => set({ ...d, blocks: [...blocks, { type: 'text', text: '' }] })}>+ Add a text block</Button>}
    <Text label="Statement above the signature" area max={2000} value={d.disclaimer} ro={ro} onChange={(v) => set({ ...d, disclaimer: v })} />
    <div className="rt-block fixed"><b>Signature and verification</b> <span className="help">always last: who authorized it, the signature, the verification code and QR code</span></div>
  </div>;
}
