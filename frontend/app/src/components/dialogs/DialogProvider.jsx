// Dialogs a screen can wait for, like the current app's modal(), signDialog(), askReason() and confirmBox():
//   const dialogs = useDialogs();
//   const v = await dialogs.form({ title, fields });                         // values, or null if cancelled
//   const ok = await dialogs.confirm('Remove step', 'Remove it?', 'Remove'); // true or false
//   const reason = await dialogs.reason('these records');                    // the reason text, or null
//   const r = await dialogs.sign({ what, meaning, submit });                 // { reason, signature } (or submit's answer), or null
//   const x = await dialogs.open((done) => <MyDialog onDone={done} />);     // any dialog of the screen's own
//   dialogs.menu(event, [{ label, onClick, disabled }])                      // a right-click menu at the pointer
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../Modal.jsx';
import FormDialog from './FormDialog.jsx';
import SignDialog from './SignDialog.jsx';
import './dialogs.css';

const DialogContext = createContext(null);
export const useDialogs = () => useContext(DialogContext);

function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', key); window.addEventListener('scroll', onClose, true);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key); window.removeEventListener('scroll', onClose, true); };
  }, [onClose]);
  return (
    <div ref={ref} className="tbmenu" role="menu" style={{ left: Math.min(x, window.innerWidth - 260), top: Math.max(8, Math.min(y, window.innerHeight - 36 * items.length - 16)) }}>
      {items.map((it, i) => (
        <button key={i} type="button" role="menuitem" disabled={it.disabled} onClick={() => { onClose(); it.onClick(); }}>{it.label}</button>
      ))}
    </div>
  );
}

export default function DialogProvider({ children }) {
  const [stack, setStack] = useState([]); // [{ id, render(done) }]
  const [menu, setMenu] = useState(null);

  const open = useCallback((render) => new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const done = (v) => { setStack((s) => s.filter((d) => d.id !== id)); resolve(v); };
    setStack((s) => [...s, { id, render: () => render(done) }]);
  }), []);

  const api = useMemo(() => ({
    open,
    form: (o) => open((done) => <FormDialog {...o} onDone={done} />),
    sign: (o) => open((done) => <SignDialog {...o} onDone={done} />),
    reason: (what) => open((done) => <SignDialog what={what} sign={false} onDone={done} />).then((r) => (r ? r.reason : null)),
    confirm: (title, text, okText = 'Continue') => open((done) => (
      <Modal title={title} intro={text} okText={okText} onOk={() => done(true)} onClose={() => done(false)} />)),
    menu: (e, items) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, items }); },
  }), [open]);

  const closeMenu = useCallback(() => setMenu(null), []);
  return (
    <DialogContext.Provider value={api}>
      {children}
      {stack.map((d) => <div key={d.id}>{d.render()}</div>)}
      {menu && <ContextMenu {...menu} onClose={closeMenu} />}
    </DialogContext.Provider>
  );
}
