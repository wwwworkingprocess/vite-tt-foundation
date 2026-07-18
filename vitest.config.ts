import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts'],
    coverage: {
      exclude: [
        'apps/web/src/App.tsx',
        'apps/web/src/simulation-worker/foundation.worker.ts',
        'apps/web/src/simulation-worker/browser-worker.ts',
        'apps/web/src/simulation-worker/worker-test-double.ts',
      ],
    },
  },
});
