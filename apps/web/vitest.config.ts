import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [react()],
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.tsx'],
    coverage: {
      provider: 'v8',
      reportsDirectory: '../../coverage/web-simulation-host',
      include: [
        'src/simulation-host/**/*.ts',
        'src/simulation-worker/**/*.ts',
        'src/application/**/*.ts',
        'src/persistence/**/*.ts',
        'src/pacing/**/*.ts',
        'apps/web/src/simulation-host/**/*.ts',
        'apps/web/src/simulation-worker/**/*.ts',
        'apps/web/src/application/**/*.ts',
        'apps/web/src/persistence/**/*.ts',
        'apps/web/src/pacing/**/*.ts',
      ],
      exclude: [
        'src/**/*.test.ts',
        'src/simulation-worker/foundation.worker.ts',
        'src/simulation-worker/browser-worker.ts',
        'src/simulation-worker/worker-test-double.ts',
        'apps/web/src/**/*.test.ts',
        'apps/web/src/simulation-worker/foundation.worker.ts',
        'apps/web/src/simulation-worker/browser-worker.ts',
        'apps/web/src/simulation-worker/worker-test-double.ts',
      ],
      thresholds: { statements: 95, lines: 95, functions: 95, branches: 90 },
    },
  },
});
