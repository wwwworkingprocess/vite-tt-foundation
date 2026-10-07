import { defineConfig } from 'cypress';
export default defineConfig({
  allowCypressEnv: false,
  e2e: {
    baseUrl: 'http://127.0.0.1:4173',
    specPattern: [
      'cypress/e2e/foundation.cy.ts',
      'cypress/e2e/route-presentation.cy.ts',
      'cypress/e2e/terrain.cy.ts',
    ],
    supportFile: false,
    video: false,
  },
});
