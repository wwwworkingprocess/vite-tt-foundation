import { readFileSync } from '../../../../scripts/public-layer-files.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { performance } from 'node:perf_hooks';
import { createD3dMapModel, d3dGeographicPoint } from './d3d-map-model.js';
import { createD3dTerrain, terrainLayerOffsets } from './d3d-terrain-model.js';
import { terrainFixture } from '../test/terrain-fixture.js';
import {
  parseTerrainCatalog,
  resolveTerrainViewport,
} from '../terrain/terrain-catalog.js';
import { terrainJsonDecoder } from '../terrain/terrain-json-decoder.js';
import { terrainToGeographic } from '../terrain/terrain-projection.js';
import {
  streetCellJson,
  streetCellFixture,
  withStreetCellZones,
} from '../test/street-cells-fixture.js';
import {
  decodeStreetCells,
  decodeStreetCellAnnotations,
  parseStreetCellCatalog,
} from './street-cells.js';
import {
  prepareD3dStreetCells,
  createStreetCellGeometry,
  streetCellBoundaryOffsetMetres,
  streetCellSupportMetres,
  streetCellSegmentBudget,
} from './d3d-street-cells.js';
const map = createD3dMapModel({
  bounds: { west: -0.73, east: -0.64, north: 38.01, south: 37.94 },
  edges: [],
  stopPlaces: [],
});
const f = terrainFixture();
const resolution = resolveTerrainViewport(
  parseTerrainCatalog(f.catalog),
  'test',
  'a',
)!;
const native = terrainJsonDecoder.decode(f, resolution);
const terrain = createD3dTerrain(native, map);
const descriptor = parseStreetCellCatalog(streetCellJson('catalog.json'))
  .settlements['es-torrevieja']!.products[2]!;

const cells = withStreetCellZones(
  decodeStreetCells(streetCellFixture(), 'es-torrevieja', {
    ...descriptor,
    featureCount: 2,
  }),
);
const square = (x: number, z: number, w: number) => [
  [x, z],
  [x + w, z],
  [x + w, z + w],
  [x, z + w],
  [x, z],
];
function metricCells(polygons: number[][][][]) {
  const fixture = streetCellFixture();
  fixture.features = polygons.map((rings, i) => ({
    ...fixture.features[0]!,
    id: `es-torrevieja-sc-${i + 1}`,
    geometry: {
      type: 'Polygon',
      coordinates: rings.map((r) =>
        r.map(([x, z]) => {
          const p = d3dGeographicPoint(map, {
            x: x! * terrain.metre,
            z: z! * terrain.metre,
          });
          return [p.longitude, p.latitude];
        }),
      ),
    },
  }));
  return withStreetCellZones(
    decodeStreetCells(fixture, 'es-torrevieja', {
      ...descriptor,
      featureCount: polygons.length,
    }),
  );
}
it('deduplicates exact reversed shared A/B edges and retains hole seams without a game inset', () => {
  const source = metricCells([
    [square(0, 0, 100)],
    [square(100, 0, 100), square(120, 20, 20).reverse()],
  ]);
  const original = JSON.stringify(source);
  for (const level of ['A', 'B'] as const) {
    const model = { ...source, level };
    const plan = prepareD3dStreetCells(model, map, terrain);
    expect(plan.rawEdges).toBe(12);
    expect(plan.uniqueEdges).toBe(11);
    expect(plan.displayEdges).toBe(11);
    expect(plan.displayedCells).toBe(2);
    expect(plan.rejectedCells).toEqual([]);
    const xs = Array.from(plan.positions)
      .filter((_, i) => i % 3 === 0)
      .map((x) => x / terrain.metre);
    expect(Math.min(...xs)).toBeCloseTo(0, 4);
    expect(Math.max(...xs)).toBeCloseTo(200, 4);
    expect(xs.some((x) => Math.abs(x - 100) < 0.001)).toBe(true);
  }
  expect(JSON.stringify(source)).toBe(original);
});
it('joins precomputed C zones by ID, skips exactly non-drawables and never offsets their coordinates again', () => {
  const model = metricCells([[square(0, 0, 100)], [square(100, 0, 100)]]);
  const safe = metricCells([[square(5, 5, 90), square(30, 30, 20)]])
    .features[0]!.geometry.coordinates;
  const annotations = {
    ...model.annotations!,
    cells: {
      'es-torrevieja-sc-2': {
        ...model.annotations!.cells['es-torrevieja-sc-2']!,
        classification: 'non-drawable' as const,
        safeZoneCoordinates: null,
        safeAreaSqm: 0,
      },
      'es-torrevieja-sc-1': {
        ...model.annotations!.cells['es-torrevieja-sc-1']!,
        classification: 'road-crossed' as const,
        safeZoneCoordinates: safe,
      },
    },
  };
  const input = { ...model, annotations };
  const original = JSON.stringify(input);
  const plan = prepareD3dStreetCells(input, map, terrain);
  expect(plan.cells).toBe(2);
  expect(plan.displayedCells).toBe(1);
  expect(plan.rejectedCells).toEqual([
    { id: 'es-torrevieja-sc-2', reason: 'non-drawable' },
  ]);
  expect(plan.displayEdges).toBe(8);
  expect(plan.positions[0]! / terrain.metre).toBeCloseTo(5, 4);
  expect(JSON.stringify(input)).toBe(original);
  expect(prepareD3dStreetCells(input, map, terrain)).toBe(plan);
  expect(prepareD3dStreetCells(input, { ...map }, terrain)).not.toBe(plan);
  expect(prepareD3dStreetCells(input, map, { ...terrain })).not.toBe(plan);
  const gpu = createStreetCellGeometry(plan);
  expect(gpu.getAttribute('position').array).toBe(plan.positions);
  expect(createStreetCellGeometry(plan)).not.toBe(gpu);
  gpu.dispose();
});
it('samples every support on steep native ground with exact unscaled clearance above coincident roads', () => {
  const model = metricCells([[square(0, 0, 50)]]);
  const ground = vi.fn((x: number, z: number) => ({
    ...terrain.ground(x, z),
    y: x * 2 + z * 0.4,
  }));
  const world = { ...terrain, ground };
  const original = JSON.stringify(model);
  const plan = prepareD3dStreetCells(model, map, world),
    p = plan.positions;
  expect(plan.supports).toBe(ground.mock.calls.length);
  expect(plan.supports).toBeLessThan(plan.vertices);
  expect(streetCellBoundaryOffsetMetres).toBeGreaterThan(
    terrainLayerOffsets.route,
  );
  for (let i = 0; i < p.length; i += 3) {
    const y = world.ground(p[i]!, p[i + 2]!).y;
    expect(p[i + 1]).toBeCloseTo(y + 0.5 * world.metre, 4);
    expect(p[i + 1]! - (y + 0.22 * world.metre)).toBeCloseTo(
      0.28 * world.metre,
      4,
    );
  }
  for (let i = 0; i < p.length; i += 6)
    expect(
      Math.hypot(p[i + 3]! - p[i]!, p[i + 5]! - p[i + 2]!) / world.metre,
    ).toBeLessThanOrEqual(streetCellSupportMetres + 0.001);
  expect(Array.from(p).every(Number.isFinite)).toBe(true);
  expect(JSON.stringify(model)).toBe(original);
  const flat = {
    ...terrain,
    ground: vi.fn((x: number, z: number) => ({
      ...terrain.ground(x, z),
      y: 0,
    })),
  };
  const zero = prepareD3dStreetCells(model, map, flat);
  expect(zero.supports).toBe(flat.ground.mock.calls.length);
  expect(zero.positions[1]).toBeCloseTo(0.5 * flat.metre);
});
it('rejects missing annotations, degeneracy and aggregate budgets without partial cells', () => {
  expect(() =>
    prepareD3dStreetCells({ ...cells, annotations: undefined }, map, terrain),
  ).toThrow('missing C');
  expect(() =>
    prepareD3dStreetCells(
      { ...cells, annotations: { ...cells.annotations!, cells: {} } },
      map,
      terrain,
    ),
  ).toThrow('missing annotation');
  const bad = streetCellFixture();
  bad.features[0]!.geometry.coordinates[0]![1] =
    bad.features[0]!.geometry.coordinates[0]![0]!;
  expect(() =>
    prepareD3dStreetCells(
      { ...cells, features: bad.features as unknown as typeof cells.features },
      map,
      terrain,
    ),
  ).toThrow('degenerate');
  expect(() =>
    prepareD3dStreetCells(
      cells,
      { ...map, bounds: { width: 0, depth: 0 } },
      terrain,
    ),
  ).toThrow('degenerate projected');
  for (const metre of [0, 1e-10])
    expect(() =>
      prepareD3dStreetCells(cells, map, { ...terrain, metre }),
    ).toThrow('budget');
  const huge = metricCells(
    Array.from({ length: 9 }, (_, i) => [square(i * 110000, 0, 100000)]),
  );
  expect(() => prepareD3dStreetCells(huge, map, terrain)).toThrow('budget');
  expect(streetCellSegmentBudget).toBe(262144);
});

// Decode and prepare immutable real-data fixtures once, outside timed assertion bodies.
// This retains cold measurements and full production preparation under coverage instrumentation.
const nativePlans = ['es-torrevieja', 'es-alicante'].flatMap((city) =>
  ['A', 'B', 'C'].map((level) => {
    const terrainRoot = join(import.meta.dirname, '../../public/terrain/');
    const read = (path: string): unknown =>
      JSON.parse(readFileSync(terrainRoot + path, 'utf8'));
    const catalog = parseTerrainCatalog(read('catalog.json'));
    const scenario =
      city === 'es-torrevieja'
        ? 'torrevieja-legacy-all-v1'
        : 'alicante-legacy-v1';
    const entry = catalog.settlements[city]!;
    const resolved = resolveTerrainViewport(
      catalog,
      city,
      entry.scenarioIds.includes(scenario) ? scenario : entry.scenarioIds[0]!,
    )!;
    const products = resolved.entry.products;
    const nativeReal = terrainJsonDecoder.decode(
      {
        height: read(products.height.path),
        surfaceMask: read(products.surfaceMask.path),
        coastline: read(products.coastline.path),
      },
      resolved,
    );
    const b = resolved.viewport.rasterBounds3035;
    const sw = terrainToGeographic({ x: b.west, y: b.south }),
      ne = terrainToGeographic({ x: b.east, y: b.north });
    const m = createD3dMapModel({
      bounds: {
        west: sw.longitude,
        east: ne.longitude,
        north: ne.latitude,
        south: sw.latitude,
      },
      edges: [],
      stopPlaces: [],
    });
    const world = createD3dTerrain(nativeReal, m);

    const e = parseStreetCellCatalog(streetCellJson('catalog.json'))
      .settlements[city]!;
    const metrics = [];
    for (const product of e.products.filter((p) => p.level === level)) {
      const parseStart = performance.now();
      let real = decodeStreetCells(streetCellJson(product.path), city, product);
      if (product.level === 'C')
        real = Object.freeze({
          ...real,
          annotations: decodeStreetCellAnnotations(
            streetCellJson(e.annotations.path),
            real,
            e.source.products[2]!.sha256,
          ),
        });
      const parseMs = performance.now() - parseStart,
        start = performance.now();
      const plan = prepareD3dStreetCells(real, m, world);
      const coldMs = performance.now() - start;
      const cachedStart = performance.now();
      const cached = prepareD3dStreetCells(real, m, world);
      const cachedMs = performance.now() - cachedStart;
      metrics.push({
        ...plan,
        expectedCells: product.featureCount,
        cacheReused: cached === plan,
        positions: undefined,
        geometryBytes: plan.positions.byteLength,
        parseMs,
        coldMs,
        cachedMs,
        batches: 1,
      });
    }
    const dir = join(
      import.meta.dirname,
      '../../../../node_modules/.cache/street-cells',
    );
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, city + '-' + level + '-v3-geometry.json'),
      JSON.stringify(metrics, null, 2),
    );
    return {
      city,
      level,
      metrics,
      nativeSamples: nativeReal.statistics.nativeSamples,
    };
  }),
);
it.each(nativePlans)(
  'measures real V3 $city/$level native plan and repeat-identity cache',
  ({ city, level, metrics, nativeSamples }) => {
    if (city === 'es-torrevieja') expect(nativeSamples).toBe(161680);
    for (const plan of metrics) {
      expect(plan.cacheReused).toBe(true);
      expect(plan.cells).toBe(plan.expectedCells);
      expect(plan.segments).toBeLessThan(streetCellSegmentBudget);
      expect(plan.vertices).toBe(plan.segments * 2);
      if (level === 'C')
        expect(plan.displayedCells).toBe(
          city === 'es-torrevieja' ? 1437 : 2759,
        );
    }
  },
);

it('renders V3 coincident encoded safe vertices without rewriting the annotation or dropping cells', () => {
  const f = cells.features[0]!,
    a = cells.annotations!.cells[f.id]!,
    r = a.safeZoneCoordinates![0]!;
  const duplicated = {
    ...cells,
    annotations: {
      ...cells.annotations!,
      cells: {
        ...cells.annotations!.cells,
        [f.id]: {
          ...a,
          safeZoneCoordinates: [
            [r[0]!, ...r],
            ...a.safeZoneCoordinates!.slice(1),
          ],
        },
      },
    },
  };
  const original = JSON.stringify(duplicated);
  const plan = prepareD3dStreetCells(duplicated, map, terrain),
    plain = prepareD3dStreetCells(cells, map, terrain);
  expect(plan.positions).toEqual(plain.positions);
  expect(plan.displayedCells).toBe(plain.displayedCells);
  expect(JSON.stringify(duplicated)).toBe(original);
});
