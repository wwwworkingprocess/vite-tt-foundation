import { createCityMaterializationLoader } from './apps/web/src/representation/city-materialization-loader.js';
import { prepareStreetCellMaskQueries } from './apps/web/src/representation/d3d-street-cell-masks.js';
import { createStreetCellLoader } from './apps/web/src/representation/street-cells-loader.js';
import { createHash } from 'node:crypto';
import {
  buildStreetCellCity,
  streetCellLandmarkProtections,
} from './apps/web/src/representation/d3d-street-cell-city.js';
import {
  cellCityMap,
  cellCityMetadata,
  cellCityPopulation,
  cellCityCells,
  cellCityTerrain,
  elcheCellCityFixture,
} from './apps/web/src/test/street-cell-city-fixture.js';
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
        async elchePartialMaskSample() {
          const f = elcheCellCityFixture();
          const cells = (await createStreetCellLoader({
            baseUrl: '/',
            digestSha256: async (text) =>
              createHash('sha256').update(text).digest('hex'),
            fetchText: async (url) => ({
              ok: true,
              text: async () =>
                readFileSync(
                  new URL('./apps/web/public' + url, import.meta.url),
                  'utf8',
                ),
            }),
          }).resolve('es-elche'))!;
          const city = buildStreetCellCity(
            f.model,
            f.population,
            undefined,
            cells,
            f.terrain,
          );
          const row = city.streetCellLayout!.ledger.find(
            (r) =>
              r.classification === 'empty' &&
              r.buildings > 0 &&
              r.estimatedMaskedAreaSqm! > 100 &&
              (r.reasons['typed-mask-footprint'] ?? 0) > 0,
          )!;
          const group = city.buildings.filter((b) => b.cellId === row.cellId);
          const x = group.reduce((n, b) => n + b.x, 0) / group.length;
          const z = group.reduce((n, b) => n + b.z, 0) / group.length;
          const forward =
            (f.terrain.ground(x, z).y / Math.tan((35 * Math.PI) / 180)) *
            Math.SQRT1_2;
          return {
            x: x - forward,
            z: z - forward,
            cellId: row.cellId,
            buildings: group.length,
            maskRejected: row.reasons['typed-mask-footprint'],
          };
        },
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
        async materializationControlSamples() {
          const sites = (await createCityMaterializationLoader({
            baseUrl: '/',
            digestSha256: async (text) =>
              createHash('sha256').update(text).digest('hex'),
            fetchText: async (url) => ({
              ok: true,
              text: async () =>
                readFileSync(
                  new URL('./apps/web/public' + url, import.meta.url),
                  'utf8',
                ),
            }),
          }).resolve('es-torrevieja', 'near'))!;
          return [
            'laguna-rosa',
            'parque-naciones',
            'friday-market',
            'marina-internacional',
          ].map((name) => {
            const site = sites.sites.find((s) => s.site.id.endsWith(name))!;
            const geometry = site.geometries[0]!.feature.geometry;
            if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')
              throw new Error('Control area unavailable');
            const rings =
              geometry.type === 'Polygon'
                ? geometry.coordinates
                : geometry.coordinates.flat();
            const points = rings
              .flat()
              .map(([longitude, latitude]) =>
                d3dProjectedPoint(cellCityMap, { longitude, latitude }),
              );
            const x =
                (Math.min(...points.map((p) => p.x)) +
                  Math.max(...points.map((p) => p.x))) /
                2,
              z =
                (Math.min(...points.map((p) => p.z)) +
                  Math.max(...points.map((p) => p.z))) /
                2;
            const forward =
              (cellCityTerrain.ground(x, z).y /
                Math.tan((35 * Math.PI) / 180)) *
              Math.SQRT1_2;
            return { name, id: site.site.id, x: x - forward, z: z - forward };
          });
        },
        async streetCellBuildingSamples() {
          const cells = (await createStreetCellLoader({
            baseUrl: '/',
            digestSha256: async (text) =>
              createHash('sha256').update(text).digest('hex'),
            fetchText: async (url) => ({
              ok: true,
              text: async () =>
                readFileSync(
                  new URL('./apps/web/public' + url, import.meta.url),
                  'utf8',
                ),
            }),
          }).resolve('es-torrevieja'))!;
          const start = performance.now();
          const city = buildStreetCellCity(
            cellCityMap,
            cellCityPopulation,
            cellCityMetadata,
            cells,
            cellCityTerrain,
            streetCellLandmarkProtections(cellCityMap, cellCityMetadata),
          );
          const coldMs = performance.now() - start,
            cachedStart = performance.now();
          const cached = buildStreetCellCity(
            cellCityMap,
            cellCityPopulation,
            cellCityMetadata,
            cells,
            cellCityTerrain,
            streetCellLandmarkProtections(cellCityMap, cellCityMetadata),
          );
          const cachedMs = performance.now() - cachedStart;
          if (cached !== city) throw new Error('Static cell city cache failed');
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
          const native = await loader.resolve(
            'es-torrevieja',
            'torrevieja-legacy-all-v1',
          );
          if (native.status !== 'ready')
            throw new Error('Cell city DEM unavailable');
          const world = createD3dTerrain(native.terrain, cellCityMap);
          const groundCounts: Record<string, number> = {};
          for (const b of city.buildings) {
            const key = world.ground(b.x, b.z).diagnostic;
            groundCounts[key] = (groundCounts[key] ?? 0) + 1;
          }
          const sample = (profiles: readonly string[], urban = false) => {
            const groups = new Map<string, (typeof city.buildings)[number][]>();
            for (const b of city.buildings)
              if (
                profiles.includes(b.buildingProfileId!) &&
                (!urban || b.zoneId === 'z-central-grid') &&
                cellCityCells.annotations!.cells[b.cellId!]!.classification ===
                  'road-crossed'
              ) {
                const key = b.cellId! + ':' + b.zoneId;
                let group = groups.get(key);
                if (!group) {
                  group = [];
                  groups.set(key, group);
                }
                group.push(b);
              }
            const group = [...groups.values()].sort(
              (a, b) => b.length - a.length || a[0]!.id.localeCompare(b[0]!.id),
            )[0]!;
            const x = group.reduce((sum, b) => sum + b.x, 0) / group.length,
              z = group.reduce((sum, b) => sum + b.z, 0) / group.length;
            const ground = world.ground(x, z);
            const forward =
              (ground.y / Math.tan((35 * Math.PI) / 180)) * Math.SQRT1_2;
            return {
              x: x - forward,
              z: z - forward,
              cellId: group[0]!.cellId,
              zoneId: group[0]!.zoneId,
              profiles: [...new Set(group.map((b) => b.buildingProfileId))],
              buildings: group.length,
              ground: ground.diagnostic,
            };
          };
          return {
            coldMs,
            cachedMs,
            buildings: city.buildings.length,
            diagnostics: city.streetCellLayout,
            groundCounts,
            typedCovers: Array.from({ length: 6 }, (_, type) => {
              const masks = prepareStreetCellMaskQueries(
                cells.masks!,
                cellCityMap,
              ).features;
              for (const mask of masks
                .filter(
                  (m) =>
                    m.type === type &&
                    m.areaSqm > 1000 &&
                    m.areaSqm < 50000 &&
                    !['R14660913', 'R14960789'].includes(m.sourceId),
                )
                .sort((a, b) => a.areaSqm - b.areaSqm)) {
                const xs = mask.rings[0]!.map((p) => p[0]),
                  zs = mask.rings[0]!.map((p) => p[1]);
                const x = (Math.min(...xs) + Math.max(...xs)) / 2,
                  z = (Math.min(...zs) + Math.max(...zs)) / 2;
                if (
                  !mask.contains([x, z]) ||
                  world.sample(x, z).kind === 'outside'
                )
                  continue;
                const forward =
                  (world.ground(x, z).y / Math.tan((35 * Math.PI) / 180)) *
                  Math.SQRT1_2;
                return {
                  type,
                  id: mask.id,
                  sourceId: mask.sourceId,
                  x: x - forward,
                  z: z - forward,
                };
              }
              throw new Error('No native-covered typed sample: ' + type);
            }),
            urban: sample(['bp-central-mixed', 'bp-midrise-apartment'], true),
            centralGrid: sample(
              ['bp-central-mixed', 'bp-midrise-apartment'],
              true,
            ),
            suburban: sample(['bp-detached-villa', 'bp-terrace-bungalow']),
            highGuides: (() => {
              const candidates = city
                .streetCellLayout!.ledger.filter(
                  (c) => c.classification === 'road-crossed' && c.buildings > 0,
                )
                .sort(
                  (a, b) =>
                    b.guideSegments - a.guideSegments ||
                    a.cellId.localeCompare(b.cellId),
                );
              const record = candidates[0]!,
                group = city.buildings.filter(
                  (b) => b.cellId === record.cellId,
                ),
                point = group[Math.floor(group.length / 2)]!,
                ground = world.ground(point.x, point.z),
                forward =
                  (ground.y / Math.tan((35 * Math.PI) / 180)) * Math.SQRT1_2;
              return {
                x: point.x - forward,
                z: point.z - forward,
                cellId: record.cellId,
                buildings: record.buildings,
                guideSegments: record.guideSegments,
              };
            })(),
          };
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
      'cypress/e2e/landscape.cy.ts',
      'cypress/e2e/city-preparation.cy.ts',
    ],
    supportFile: false,
    video: false,
  },
});
