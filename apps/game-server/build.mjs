// Bundles the game server (and the @dascade/* workspace packages it imports) into dist/index.js.
// Third-party dependencies stay external and are resolved from node_modules at runtime.
import { build } from 'esbuild';
import { cpSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@dascade/'));

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: [...external, ...external.map((d) => `${d}/*`)],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});

// Runtime data files read from disk next to the bundle (not bundled into index.js):
// the DASwords dictionary + its licence notices → dist/words-data/ (see src/rooms/words/dictionary.ts).
cpSync(new URL('./src/rooms/words/data/', import.meta.url), new URL('./dist/words-data/', import.meta.url), { recursive: true });
