import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    name: 'simulation',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
