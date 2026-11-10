// Short notices at the corner of the screen: toast('Saved.') or toast(message, 'err')
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
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
      <div id="toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast ${t.kind} show`}>{t.message}</div>)}
      </div>
    </ToastContext.Provider>
  );
}
