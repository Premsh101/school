import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The built app in dist/ is served by the Worker as static assets.
// In development Vite serves the UI and forwards /api to `wrangler dev`.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://localhost:8787' } },
});
