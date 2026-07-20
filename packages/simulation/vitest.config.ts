import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    name: 'simulation',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: '../../coverage/simulation',
      reporter: ['text', 'json'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      thresholds: { statements: 95, lines: 95, functions: 95, branches: 90 },
    },
  },
});
