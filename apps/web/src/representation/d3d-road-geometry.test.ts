import { join } from 'node:path';
import { readFileSync } from '../../../../scripts/public-layer-files.mjs';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import { createTransportMapProjection } from './transport-map-projection.js';
import { parseRoadCatalog, decodeRoadProduct } from './road-network.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createD3dMapModel, d3dProjectedPoint } from './d3d-map-model.js';
import {
  prepareD3dRoads,
  createRoadGeometry,
  roadSupportMetres,
} from './d3d-road-geometry.js';
import type { RoadNetwork } from './road-network.js';
import { terrainFixture } from '../test/terrain-fixture.js';
import {
  parseTerrainCatalog,
  resolveTerrainViewport,
} from '../terrain/terrain-catalog.js';
import { terrainJsonDecoder } from '../terrain/terrain-json-decoder.js';
import { terrainToGeographic } from '../terrain/terrain-projection.js';
import { createD3dTerrain } from './d3d-terrain-model.js';
const model = createD3dMapModel({
  bounds: { west: -0.73, east: -0.64, north: 38.01, south: 37.94 },
  edges: [],
  stopPlaces: [],
});
const roads: RoadNetwork = {
  settlementId: 'es-torrevieja',
  level: 'C',
  sha256: 'a'.repeat(64),
  features: [
    {
      type: 'Feature',
      id: 'W1',
      properties: { highway: 'residential' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-0.7, 37.98],
          [-0.699, 37.98],
        ],
      },
    },
    {
      type: 'Feature',
      id: 'W2',
      properties: { highway: 'primary', bridge: 'yes', layer: 1 },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-0.7, 37.981],
          [-0.699, 37.981],
        ],
      },
    },
    {
      type: 'Feature',
      id: 'W3',
      properties: { highway: 'service', tunnel: 'building_passage', layer: -1 },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-0.7, 37.982],
          [-0.699, 37.982],
        ],
      },
    },
  ],
};
it('builds finite front-facing buffered context, preserves tags, caches CPU buffers and owns fresh GPU attributes', () => {
  const plan = prepareD3dRoads(roads, model);
  expect(prepareD3dRoads(roads, model)).toBe(plan);
  expect(plan.batches.map((b) => b.kind)).toEqual([
    'surface',
    'bridge',
    'tunnel',
  ]);
  expect(plan.triangles).toBeGreaterThan(6);
  expect(plan.fallbackSupports).toBeGreaterThan(0);
  expect(plan.fallbackSupports).toBeLessThan(plan.vertices);
  const p = d3dProjectedPoint(model, { longitude: -0.7, latitude: 37.98 });
  const positions = plan.batches[0]!.positions;
  expect((positions[0]! + positions[6]!) / 2).toBeCloseTo(p.x, 5);
  expect((positions[2]! + positions[8]!) / 2).toBeCloseTo(p.z, 5);
  for (let i = 0; i < positions.length; i += 9) {
    const crossY =
      (positions[i + 5]! - positions[i + 2]!) *
        (positions[i + 6]! - positions[i]!) -
      (positions[i + 3]! - positions[i]!) *
        (positions[i + 8]! - positions[i + 2]!);
    expect(crossY).toBeGreaterThan(0);
  }
  expect([...positions].every(Number.isFinite)).toBe(true);
  const a = createRoadGeometry(plan.batches[0]!),
    b = createRoadGeometry(plan.batches[0]!);
  expect(a).not.toBe(b);
  expect(a.getAttribute('position')).not.toBe(b.getAttribute('position'));
  expect(a.getAttribute('position').array).toBe(
    b.getAttribute('position').array,
  );
  a.dispose();
  expect(b.getAttribute('position').count).toBe(
    plan.batches[0]!.positions.length / 3,
  );
  b.dispose();
  expect(roads.features[1]!.properties.bridge).toBe('yes');
  expect(
    prepareD3dRoads({ ...roads, level: 'A' }, model).triangles,
  ).toBeLessThan(plan.triangles);
  expect(roadSupportMetres.A).toBeGreaterThan(roadSupportMetres.B);
  expect(roadSupportMetres.B).toBeGreaterThan(roadSupportMetres.C);
});
it('grounds ribbon corners on rendered 10x native relief with finite no-data/outside fallback, including bridges', () => {
  const f = terrainFixture(),
    resolution = resolveTerrainViewport(
      parseTerrainCatalog(f.catalog),
      'test',
      'a',
    )!;
  const native = terrainJsonDecoder.decode(f, resolution);
  const nw = terrainToGeographic({ x: 3375000, y: 1720075 }),
    se = terrainToGeographic({ x: 3375075, y: 1720000 });
  const m = createD3dMapModel({
    bounds: {
      west: nw.longitude,
      east: se.longitude,
      north: nw.latitude,
      south: se.latitude,
    },
    edges: [],
    stopPlaces: [],
  });
  const terrain = createD3dTerrain(native, m);
  const geo = (x: number, y: number) => {
    const p = terrainToGeographic({ x, y });
    return [p.longitude, p.latitude] as const;
  };
  const input: RoadNetwork = {
    ...roads,
    features: [
      {
        ...roads.features[1]!,
        geometry: {
          type: 'LineString',
          coordinates: [
            geo(3375012.5, 1720062.5),
            geo(3375062.5, 1720037.5),
            geo(3375200, 1720037.5),
          ],
        },
      },
    ],
  };
  const plan = prepareD3dRoads(input, m, terrain);
  expect(prepareD3dRoads(input, m, terrain)).toBe(plan);
  expect(plan.batches[0]!.kind).toBe('bridge');
  expect(plan.fallbackSupports).toBeGreaterThan(0);
  const a = plan.batches[0]!.positions;
  for (let i = 0; i < a.length; i += 3)
    expect(a[i + 1]).toBeCloseTo(
      terrain.ground(a[i]!, a[i + 2]!).y + 0.22 * terrain.metre,
      4,
    );
  expect([...a].every(Number.isFinite)).toBe(true);
  expect(
    Math.min(...Array.from({ length: a.length / 3 }, (_, i) => a[i * 3 + 1]!)),
  ).toBeLessThan(0);
  expect(prepareD3dRoads(input, m).batches[0]!.positions).not.toBe(a);
});
it('ignores zero-length support and rejects excessive subdivision without allocating unbounded geometry', () => {
  const zero: RoadNetwork = {
    ...roads,
    features: [
      {
        ...roads.features[0]!,
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [0, 0],
          ],
        },
      },
    ],
  };
  expect(prepareD3dRoads(zero, model).vertices).toBe(0);
  const long: RoadNetwork = {
    ...roads,
    features: [
      {
        ...roads.features[0]!,
        geometry: {
          type: 'LineString',
          coordinates: [
            [-180, -90],
            [180, 90],
          ],
        },
      },
    ],
  };
  expect(() => prepareD3dRoads(long, model)).toThrow(
    'Road geometry support budget exceeded',
  );
});

describe('real Torrevieja grounded road plans', () => {
  let roadCatalog: ReturnType<typeof parseRoadCatalog>,
    m: ReturnType<typeof createD3dMapModel>,
    terrain: ReturnType<typeof createD3dTerrain>;
  const root = join(import.meta.dirname, '../../public') + '/';
  beforeAll(() => {
    roadCatalog = parseRoadCatalog(
      JSON.parse(
        readFileSync(root + 'road-network/catalog.json', 'utf8'),
      ) as unknown,
    );
    const scenarioRoot =
      root + 'scenarios/torrevieja-v1/torrevieja-legacy-all-v1/';
    const json = (name: string) =>
      JSON.parse(readFileSync(scenarioRoot + name, 'utf8')) as unknown;
    const scenario = parseScenarioPackage({
      manifest: json('scenario.json'),
      settlements: json('settlements.json'),
      stops: json('stops.json'),
      routes: json('routes.json'),
    });
    m = createD3dMapModel(createTransportMapProjection(scenario));
    const catalog = parseTerrainCatalog(
      JSON.parse(
        readFileSync(root + 'terrain/catalog.json', 'utf8'),
      ) as unknown,
    );
    const resolution = resolveTerrainViewport(
        catalog,
        'es-torrevieja',
        'torrevieja-legacy-all-v1',
      )!,
      products = resolution.entry.products;
    const native = terrainJsonDecoder.decode(
      {
        height: readFileSync(root + 'terrain/' + products.height.path, 'utf8'),
        surfaceMask: readFileSync(
          root + 'terrain/' + products.surfaceMask.path,
          'utf8',
        ),
        coastline: readFileSync(
          root + 'terrain/' + products.coastline.path,
          'utf8',
        ),
      },
      resolution,
    );
    terrain = createD3dTerrain(native, m);
  });
  it.each(['A', 'B', 'C'] as const)(
    'prepares complete %s geometry within bounded batches and reuses it without fleet/selection inputs',
    (level) => {
      const descriptor = roadCatalog.products.find((p) => p.level === level)!;
      const road = decodeRoadProduct(
        JSON.parse(
          readFileSync(root + 'road-network/' + descriptor.path, 'utf8'),
        ) as unknown,
        roadCatalog,
        descriptor,
      );
      const start = performance.now(),
        plan = prepareD3dRoads(road, m, terrain),
        milliseconds = performance.now() - start;
      expect(plan.batches.length).toBe({ A: 2, B: 2, C: 3 }[level]);
      expect(plan.triangles).toBe({ A: 1850, B: 10728, C: 122972 }[level]);
      expect(plan.triangles).toBeLessThanOrEqual(262144);
      expect(prepareD3dRoads(road, m, terrain)).toBe(plan);
      process.stdout.write(
        'Road geometry measurement ' +
          JSON.stringify({
            level,
            features: road.features.length,
            batches: plan.batches.length,
            vertices: plan.vertices,
            triangles: plan.triangles,
            fallbackSupports: plan.fallbackSupports,
            milliseconds,
          }) +
          '\n',
      );
    },
  );
});
