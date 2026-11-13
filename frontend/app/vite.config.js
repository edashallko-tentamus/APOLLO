import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Built into dist/ and served by ../server.js at / (same address as the API, so the session cookie and CSP hold).
// Four pages: the app, and the three public pages clients open from emails (no sign-in).
// `npm run dev` serves it on 5173 with /api forwarded to the backend, for quick changes.
export default defineConfig({
  base: '/',
  plugins: [react()],
  server: { proxy: { '/api': process.env.LIMS_API_URL || 'http://127.0.0.1:3001' } },
  build: {
    outDir: 'dist', emptyOutDir: true, sourcemap: false,
    rollupOptions: { input: ['index.html', 'verify.html', 'quote-response.html', 'oos-response.html'] },
  },
});
