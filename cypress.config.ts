import { createTerrainLoader } from './apps/web/src/terrain/terrain-loader.js';
import { createD3dTerrain } from './apps/web/src/representation/d3d-terrain-model.js';
import {
  createD3dMapModel,
  d3dProjectedPoint,
} from './apps/web/src/representation/d3d-map-model.js';
import { createTransportMapProjection } from './apps/web/src/representation/transport-map-projection.js';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import { readFileSync } from './scripts/public-layer-files.mjs';
import { defineConfig } from 'cypress';
export default defineConfig({
  allowCypressEnv: false,
  e2e: {
    setupNodeEvents(on) {
      on('task', {
        async streetCellDowntown(city: string = 'es-torrevieja') {
          const scenarioId =
            city === 'es-alicante'
              ? 'alicante-legacy-core-v1'
              : 'torrevieja-legacy-all-v1';
          const folder =
            city === 'es-alicante' ? 'alicante-v1' : 'torrevieja-v1';
          const root = new URL(
            `./apps/web/public/scenarios/${folder}/${scenarioId}/`,
            import.meta.url,
          );
          const json = (name: string): unknown =>
            JSON.parse(readFileSync(new URL(name + '.json', root), 'utf8'));
          const scenario = parseScenarioPackage({
            manifest: json('scenario'),
            settlements: json('settlements'),
            stops: json('stops'),
            routes: json('routes'),
            presentation: json('presentation'),
            provenance: json('provenance'),
          });
          const map = createD3dMapModel(createTransportMapProjection(scenario));
          const point = d3dProjectedPoint(map, {
            longitude: city === 'es-alicante' ? -0.4846 : -0.6802,
            latitude: city === 'es-alicante' ? 38.3452 : 37.9791,
          });
          const loader = createTerrainLoader({
            baseUrl: '/',
            fetchText: async (url) => ({
              ok: true,
              text: async () =>
                readFileSync(
                  new URL('./apps/web/public' + url, import.meta.url),
                  'utf8',
                ),
            }),
          });
          const view = await loader.resolve(city, scenarioId);
          if (view.status !== 'ready')
            throw new Error('Native downtown fixture unavailable');
          const world = createD3dTerrain(view.terrain, map);
          // Camera target Y remains zero: compensate the point's exaggerated ground
          // projection so this known geographic neighborhood lies at screen center.
          const forward =
            (world.ground(point.x, point.z).y /
              Math.tan((35 * Math.PI) / 180)) *
            Math.SQRT1_2;
          return { x: point.x - forward, z: point.z - forward };
        },
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
