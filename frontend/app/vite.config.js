import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Built into dist/ and served by ../server.js at /app/ (same address as the API, so the session cookie and CSP hold).
// `npm run dev` serves it on 5173 with /api forwarded to the backend, for quick changes.
export default defineConfig({
  base: '/app/',
  plugins: [react()],
  server: {
    fs: { allow: ['..'] }, // the shared stylesheet lives in ../public/css
    proxy: { '/api': process.env.LIMS_API_URL || 'http://127.0.0.1:3001' },
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
});
