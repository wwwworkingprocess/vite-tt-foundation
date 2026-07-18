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
      include: ['src/simulation-host/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      thresholds: { statements: 95, lines: 95, functions: 95, branches: 90 },
    },
  },
});
