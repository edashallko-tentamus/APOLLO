// Short notices at the corner of the screen: toast('Saved.') or toast(message, 'err')
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Toast, ToastContainer } from 'react-bootstrap';
import { TOAST_MS } from '../config.js';

const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export default function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const timers = useRef(new Set());
  useEffect(() => () => timers.current.forEach(clearTimeout), []); // nothing fires after the app closes

  const toast = useCallback((message, kind = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setItems((l) => [...l, { id, message, kind }]);
    const t = setTimeout(() => { timers.current.delete(t); setItems((l) => l.filter((x) => x.id !== id)); }, TOAST_MS[kind] || TOAST_MS.ok);
    timers.current.add(t);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastContainer id="toasts" position="bottom-end" className="p-3 position-fixed" role="status" aria-live="polite">
        {items.map((t) => <Toast key={t.id} className={t.kind} bg={t.kind === 'err' ? 'danger' : undefined} animation={false}>
          <Toast.Body className="text-white">{t.message}</Toast.Body></Toast>)}
      </ToastContainer>
    </ToastContext.Provider>
  );
}
