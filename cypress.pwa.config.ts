import { defineConfig } from 'cypress';
export default defineConfig({
  allowCypressEnv: false,
  e2e: {
    baseUrl: 'http://127.0.0.1:4174',
    specPattern: 'cypress/e2e/pwa-offline.cy.ts',
    supportFile: false,
    video: false,
  },
});
