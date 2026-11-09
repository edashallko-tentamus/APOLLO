// In-page dialog (never the browser's alert/confirm/prompt: the embedded browser blocks them).
// Escape or Cancel closes it; focus starts on its first field.
import { useEffect, useRef } from 'react';

export default function Modal({ title, intro, children, error, okText = 'Save', busy = false, wide = false, onOk, onClose }) {
  const box = useRef(null);
  useEffect(() => { box.current?.querySelector('input,select,textarea,button')?.focus(); }, []);

  return (
    <div className="modal-bg" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <form ref={box} className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} noValidate
        onSubmit={(e) => { e.preventDefault(); if (!busy) onOk(); }}>
        <h3>{title}</h3>
        {intro && <p className="intro">{intro}</p>}
        <div className="fields">{children}</div>
        <div className="merr" role="alert">{error}</div>
        <div className="mbtns">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>{okText}</button>
        </div>
      </form>
    </div>
  );
}
