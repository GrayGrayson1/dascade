import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'apps/web/vite/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'e2e/**'],
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 20_000,
    pool: 'forks',
  },
});
