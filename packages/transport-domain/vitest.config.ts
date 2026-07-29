import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'transport-domain',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      reportsDirectory: '../../coverage/transport-domain',
      thresholds: { statements: 95, branches: 90, functions: 95, lines: 95 },
    },
  },
});
