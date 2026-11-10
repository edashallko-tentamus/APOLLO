// A dialog of fields (the current app's modal()). fields: [{ name, label, type, options, required, value, help, list, cbLabel, blank }]
// type: text (default), number, date, time, password, email, select (a smart dropdown), textarea, checkbox, file.
// Gives back the values (trimmed text, true/false for tick boxes), or runs submit(values) while open when given.
import { useState } from 'react';
import Modal from '../Modal.jsx';
import SmartSelect from '../SmartSelect.jsx';

const optionList = (f) => {
  const opts = (f.options || []).map((o) => (typeof o === 'object' ? { value: String(o.value), label: String(o.label) } : { value: String(o), label: String(o) }));
  return f.blank === false ? opts : [{ value: '', label: '' }, ...opts];
};

function Field({ f, value, onChange }) {
  const id = 'f_' + f.name;
  let control;
  if (f.type === 'select') control = <SmartSelect id={id} value={value} options={optionList(f)} onChange={onChange} />;
  else if (f.type === 'textarea') control = <textarea id={id} rows={3} value={value} onChange={(e) => onChange(e.target.value)} />;
  // a file field gives back the chosen File (or null); accept: e.g. '.pdf,image/*'
  else if (f.type === 'file') control = <input id={id} type="file" accept={f.accept} onChange={(e) => onChange(e.target.files[0] || null)} />;
  else if (f.type === 'checkbox') control = <label className="cb"><input type="checkbox" id={id} checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {f.cbLabel || ''}</label>;
  else control = <>
    <input id={id} type={f.type || 'text'} value={value} list={f.list ? id + '_dl' : undefined} onChange={(e) => onChange(e.target.value)} />
    {f.list && <datalist id={id + '_dl'}>{f.list.map((x) => <option key={x} value={x} />)}</datalist>}
  </>;
  return (
    <div className="field">
      <label htmlFor={id}>{f.label}{f.required && <> <span className="req">*</span></>}</label>
      {control}
      {f.help && <div className="help">{f.help}</div>}
    </div>
  );
}

export default function FormDialog({ title, intro, fields = [], okText = 'Save', wide = false, before, after, submit, onDone }) {
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((f) => [f.name,
    f.type === 'checkbox' ? !!f.value : f.type === 'file' ? null : String(f.value ?? '')])));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function ok() {
    const out = {};
    for (const f of fields) {
      const v = values[f.name];
      out[f.name] = typeof v === 'string' ? v.trim() : v;
      if (f.required && (out[f.name] === '' || out[f.name] === null)) return setError(`${f.label} is required.`);
    }
    if (!submit) return onDone(out);
    setBusy(true); setError('');
    try { onDone((await submit(out)) ?? out); } catch (e) { setBusy(false); setError(e.message); }
  }

  return (
    <Modal title={title} intro={intro} okText={okText} wide={wide} error={error} busy={busy} onOk={ok} onClose={() => onDone(null)}>
      {before}
      {fields.map((f) => <Field key={f.name} f={f} value={values[f.name]} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} />)}
      {after}
    </Modal>
  );
}
