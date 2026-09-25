import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const webPort = Number(process.env.WEB_PORT ?? 5173);

export default defineConfig({
  plugins: [react()],
  // One .env at the repo root serves both apps (only VITE_* vars reach the browser).
  envDir: '../..',
  // Separate caches let several dev servers run side by side (VITE_CACHE_DIR=node_modules/.vite-<name>).
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
  server: {
    port: webPort,
    strictPort: true,
    host: true,
  },
  preview: {
    port: webPort,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1800,
  },
});
