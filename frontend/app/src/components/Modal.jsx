// In-page dialog (never the browser's alert/confirm/prompt: the embedded browser blocks them), on react-bootstrap's Modal.
// Escape or Cancel closes it (Escape first closes an open smart dropdown); focus starts on its first field.
import { useEffect, useRef } from 'react';
import { Button, Modal as BsModal } from 'react-bootstrap';

// The frame every dialog uses. wide: 800 px; xwide: 1140 px (big grids)
export function Dialog({ label, wide = false, xwide = false, onClose, children }) {
  return (
    <BsModal show animation={false} size={xwide ? 'xl' : wide ? 'lg' : undefined} aria-label={label}
      onHide={() => { if (!document.querySelector('.combo-list')) onClose(); }}>
      {children}
    </BsModal>
  );
}

export default function Modal({ title, intro, children, error, okText = 'Save', busy = false, wide = false, xwide = false, onOk, onClose }) {
  const box = useRef(null);
  useEffect(() => { box.current?.querySelector('input,select,textarea,button')?.focus(); }, []);

  return (
    <Dialog label={title} wide={wide} xwide={xwide} onClose={onClose}>
      <form ref={box} noValidate onSubmit={(e) => { e.preventDefault(); if (!busy) onOk(); }}>
        <BsModal.Header><BsModal.Title as="h3">{title}</BsModal.Title></BsModal.Header>
        <BsModal.Body>
          {/* a div, not a p: an intro may hold a list (e.g. what a cancel will do) */}
          {intro && <div className="intro">{intro}</div>}
          <div className="fields">{children}</div>
          <div className="merr" role="alert">{error}</div>
        </BsModal.Body>
        <BsModal.Footer>
          <Button variant="light" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>{okText}</Button>
        </BsModal.Footer>
      </form>
    </Dialog>
  );
}
