import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Bootstrap first (react-bootstrap's look), then the app's own styles (a copy of the current app's, without what Bootstrap replaces)
import 'bootstrap/dist/css/bootstrap.min.css';
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
