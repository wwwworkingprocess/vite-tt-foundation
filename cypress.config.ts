import { readFileSync } from './scripts/public-layer-files.mjs';
import { defineConfig } from 'cypress';
export default defineConfig({
  allowCypressEnv: false,
  e2e: {
    setupNodeEvents(on) {
      on('task', {
        roadProductCounts() {
          const catalog = JSON.parse(
            readFileSync(
              new URL(
                './apps/web/public/road-network/catalog.json',
                import.meta.url,
              ),
              'utf8',
            ),
          );
          return Object.fromEntries(
            Object.entries(catalog.settlements).map(([city, entry]) => [
              city,
              Object.fromEntries(
                (
                  entry as {
                    products: { level: string; featureCount: number }[];
                  }
                ).products.map((p) => [p.level, p.featureCount]),
              ),
            ]),
          );
        },
      });
    },
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
