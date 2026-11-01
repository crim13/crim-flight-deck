import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev: `npm run dev` starts the server (mock or real) on :3000 and Vite on :5173 which proxies /ws and /api.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', target: 'es2020', sourcemap: false, chunkSizeWarningLimit: 600 },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:3000', ws: true },
      '/api': { target: 'http://127.0.0.1:3000' },
    },
  },
});
