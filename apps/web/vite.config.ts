import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { jukeboxPlugin } from './vite/jukebox-plugin.ts';

const webPort = Number(process.env.WEB_PORT ?? 5173);

export default defineConfig({
  // jukeboxPlugin: manifest + cover art generated from public/audio/jukebox/*.mp3 (see vite/jukebox-plugin.ts).
  plugins: [react(), jukeboxPlugin()],
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
    // Maps are generated for error reporting but not referenced from the published bundles.
    sourcemap: 'hidden',
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        // Zod runs "jitless" in the browser: zod 4 probes `Function('')` when the first object schema is
        // built (at module load) to decide whether it may JIT-compile parsers. The production CSP
        // (`script-src 'self'`, no 'unsafe-eval') always refuses it and Firefox logs that as a console
        // error on every page load. Zod reads this global when its module initialises, which is why it
        // has to be set here (top of every chunk) rather than from app code: chunk evaluation order
        // would run zod's chunk before any module of ours. Parsing results are identical.
        intro: 'globalThis.__zod_globalConfig ??= { jitless: true };',
      },
    },
  },
});
