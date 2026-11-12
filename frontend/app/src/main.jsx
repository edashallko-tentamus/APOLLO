import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// The app's stylesheet (moved from the old screens' public/css/app.css).
import './styles/app.css';
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
