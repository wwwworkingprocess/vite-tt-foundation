import { defineConfig } from 'cypress';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig({
  allowCypressEnv: false,
  e2e: {
    baseUrl: 'http://127.0.0.1:4174',
    specPattern: 'cypress/performance/representation-runtime.cy.ts',
    supportFile: false,
    video: false,
    setupNodeEvents(on) {
      on('task', {
        writeRepresentationProfiles(results: unknown) {
          const directory = resolve('performance-results');
          mkdirSync(directory, { recursive: true });
          writeFileSync(
            resolve(directory, 'representation-runtime.json'),
            `${JSON.stringify(results, null, 2)}\n`,
          );
          return null;
        },
      });
    },
  },
});
