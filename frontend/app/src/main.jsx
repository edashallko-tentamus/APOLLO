import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// The current app's stylesheet, so both look the same while screens move over; split per component as they move.
import '../../public/css/app.css';
import DialogProvider from './components/dialogs/DialogProvider.jsx';
import ToastProvider from './components/Toasts.jsx';
import SessionProvider from './session/SessionProvider.jsx';
import AppShell from './shell/AppShell.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ToastProvider>
      <SessionProvider>
        <DialogProvider>
          <AppShell />
        </DialogProvider>
      </SessionProvider>
    </ToastProvider>
  </StrictMode>,
);
