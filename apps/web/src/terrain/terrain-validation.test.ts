import { expect, it } from 'vitest';
import { terrainFixture } from '../test/terrain-fixture.js';
import {
  parseTerrainCatalog,
  resolveTerrainViewport,
} from './terrain-catalog.js';
import { terrainJsonDecoder } from './terrain-json-decoder.js';
import { sampleTerrain, terrainGround } from './terrain-runtime.js';
function decode(f: ReturnType<typeof terrainFixture>) {
  return terrainJsonDecoder.decode(
    f,
    resolveTerrainViewport(parseTerrainCatalog(f.catalog), 'test', 'a')!,
  );
}
it('rejects catalog schema, unsafe paths, duplicate viewports, incomplete mappings, and invalid raster bounds', () => {
  for (const change of [
    (f: ReturnType<typeof terrainFixture>) => {
      f.catalog.schemaVersion = 'other';
    },
    (f: ReturnType<typeof terrainFixture>) => {
      f.catalog.settlements.test.products.height.path = '../height.json';
    },
    (f: ReturnType<typeof terrainFixture>) => {
      f.catalog.settlements.test.scenarioIds.push('a');
    },
    (f: ReturnType<typeof terrainFixture>) => {
      f.catalog.settlements.test.scenarioIds.push('missing');
    },
    (f: ReturnType<typeof terrainFixture>) => {
      f.catalog.settlements.test.viewports.push(
        f.catalog.settlements.test.viewports[0]!,
      );
    },
    (f: ReturnType<typeof terrainFixture>) => {
      f.catalog.settlements.test.viewports[0]!.width = 4;
    },
    (f: ReturnType<typeof terrainFixture>) => {
      f.catalog.settlements.test.viewports[0]!.rasterBounds3035.east = 0;
    },
    (f: ReturnType<typeof terrainFixture>) => {
      f.catalog.settlements.test.scenarioViewportMap.a = 'missing';
    },
  ]) {
    const f = terrainFixture();
    change(f);
    expect(() => parseTerrainCatalog(f.catalog)).toThrow();
  }
  const catalog = parseTerrainCatalog(terrainFixture().catalog);
  expect(
    Object.isFrozen(catalog.settlements.test!.viewports[0]!.rasterBounds3035),
  ).toBe(true);
});
it('rejects mismatched identities, resolution, mappings, dimensions, orders, and missing viewports', () => {
  const bad = [
    (f: ReturnType<typeof terrainFixture>) => {
      f.height.settlementId = 'other';
    },
    (f: ReturnType<typeof terrainFixture>) => {
      f.surfaceMask.resolutionMetersX = 50;
    },
    (f: ReturnType<typeof terrainFixture>) => {
      f.height.scenarioViewportMap.a = 'other';
    },
    (f: ReturnType<typeof terrainFixture>) => {
      f.height.viewports[0]!.width = 4;
    },
    (f: ReturnType<typeof terrainFixture>) => {
      f.surfaceMask.viewports[0]!.height = 4;
    },
    (f: ReturnType<typeof terrainFixture>) => {
      f.height.viewports[0]!.terrainViewportId = 'other';
    },
    (f: ReturnType<typeof terrainFixture>) => {
      f.surfaceMask.viewports[0]!.terrainViewportId = 'other';
    },
    (f: ReturnType<typeof terrainFixture>) => {
      f.height.viewports[0]!.rowOrder = 'south-to-north';
    },
    (f: ReturnType<typeof terrainFixture>) => {
      f.height.viewports[0]!.elevations.pop();
    },
    (f: ReturnType<typeof terrainFixture>) => {
      f.surfaceMask.viewports[0]!.cells.pop();
    },
  ];
  for (const change of bad) {
    const f = terrainFixture();
    change(f);
    expect(() => decode(f)).toThrow();
  }
});
it('rejects nonfinite elevation, invalid mask domain, and finite/null classification contradictions', () => {
  for (const value of [NaN, Infinity, -Infinity, 'bad', undefined]) {
    const f = terrainFixture();
    Reflect.set(f.height.viewports[0]!.elevations, 0, value);
    expect(() => decode(f)).toThrow('classification');
  }
  for (const cell of [2, -1, NaN, '1']) {
    const f = terrainFixture();
    Reflect.set(f.surfaceMask.viewports[0]!.cells, 0, cell);
    expect(() => decode(f)).toThrow('classification');
  }
  for (const index of [0, 6]) {
    const f = terrainFixture();
    f.surfaceMask.viewports[0]!.cells[index] = index === 0 ? 0 : 1;
    expect(() => decode(f)).toThrow('classification');
  }
});
const feature = (
  kind: string,
  type: string,
  coordinates: number[][][],
  clippedByCoverage = false,
) => ({
  type: 'Feature',
  id: kind,
  properties: {
    settlementId: 'test',
    kind,
    clippedByCoverage,
    boundarySourceViewportIds: ['test-viewport'],
  },
  geometry: { type, coordinates },
});
it('validates coastline polygon closure, line types, coverage semantics, and source identities', () => {
  const polygon = [
    [
      [3375000, 1720000],
      [3375075, 1720000],
      [3375075, 1720075],
      [3375000, 1720000],
    ],
  ];
  const lines = [
    [
      [3375000, 1720000],
      [3375075, 1720000],
    ],
  ];
  const parse = (features: unknown[], root: Record<string, unknown> = {}) => {
    const f = terrainFixture();
    const resolved = resolveTerrainViewport(
      parseTerrainCatalog(f.catalog),
      'test',
      'a',
    )!;
    return terrainJsonDecoder.decode(
      { ...f, coastline: { ...f.coastline, ...root, features } },
      resolved,
    );
  };
  expect(
    parse([
      feature('land', 'Polygon', polygon),
      feature('coastline', 'MultiLineString', lines),
      feature('coverage-edge', 'MultiLineString', lines, true),
    ]).coastline.features,
  ).toHaveLength(3);
  for (const f of [
    feature('land', 'MultiLineString', polygon),
    feature('land', 'Polygon', lines),
    feature('land', 'Polygon', [
      [
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 0],
      ],
    ]),
    feature('coastline', 'Polygon', polygon),
    feature('coverage-edge', 'MultiLineString', lines),
    feature('coastline', 'MultiLineString', lines, true),
  ])
    expect(() => parse([f])).toThrow();
  expect(() => parse([], { settlementId: 'other' })).toThrow('identity');
  expect(() => parse([], { sourceViewportIds: ['other'] })).toThrow('identity');
  expect(() =>
    parse([], { sourceViewportIds: ['test-viewport', 'other'] }),
  ).toThrow('identity');
  const wrongSettlement = feature('land', 'Polygon', polygon);
  wrongSettlement.properties.settlementId = 'other';
  expect(() => parse([wrongSettlement])).toThrow('identity');
  const wrongViewport = feature('land', 'Polygon', polygon);
  wrongViewport.properties.boundarySourceViewportIds = ['other'];
  expect(() => parse([wrongViewport])).toThrow('identity');
});
it('preserves double precision privately, samples exact edges, and uses safe bounded NoData fallback', () => {
  const f = terrainFixture();
  const precision = 1.123456789012345;
  f.height.viewports[0]!.elevations[0] = precision;
  const t = decode(f);
  f.height.viewports[0]!.elevations[0] = 99;
  f.surfaceMask.viewports[0]!.cells[0] = 0;
  expect(t.sample(0, 0)).toBe(precision);
  expect(Object.isFrozen(t)).toBe(true);
  expect(() => t.sample(-1, 0)).toThrow(RangeError);
  expect(() => t.classify(0, 3)).toThrow(RangeError);
  expect(() => t.sample(0.5, 0)).toThrow(RangeError);
  expect(sampleTerrain(t, 3375075, 1720075)).toEqual({
    kind: 'land',
    elevation: 4,
  });
  expect(sampleTerrain(t, 3375075, 1720000)).toEqual({ kind: 'water' });
  expect(sampleTerrain(t, 3375025, 1720035)).toEqual({
    kind: 'land',
    elevation: 4,
  });
  for (const [x, y] of [
    [NaN, 1720075],
    [3375000, Infinity],
    [3375000, 1720080],
    [3375076, 1720075],
    [3375000, 1719999],
  ])
    expect(sampleTerrain(t, x!, y!).kind).toBe('outside');
  expect(terrainGround(t, 0, 0)).toEqual({
    elevation: 0,
    diagnostic: 'flat-fallback',
  });
  expect(terrainGround(t, 3375012.5, 1720062.5).diagnostic).toBe('native');
  const wet = terrainFixture();
  wet.height.viewports[0]!.elevations.fill(null);
  wet.surfaceMask.viewports[0]!.cells.fill(0);
  const water = decode(wet);
  expect(water.statistics).toMatchObject({
    landSamples: 0,
    minElevation: null,
    maxElevation: null,
  });
  expect(terrainGround(water, 3375012.5, 1720062.5)).toEqual({
    elevation: 0,
    diagnostic: 'flat-fallback',
  });
});

it('rejects missing/non-array rasters before scanning samples', () => {
  const f = terrainFixture(),
    resolved = resolveTerrainViewport(
      parseTerrainCatalog(f.catalog),
      'test',
      'a',
    )!;
  const h = {
    ...f.height,
    viewports: [{ ...f.height.viewports[0], elevations: {} }],
  };
  expect(() =>
    terrainJsonDecoder.decode({ ...f, height: h }, resolved),
  ).toThrow('arrays');
  const m = {
    ...f.surfaceMask,
    viewports: [{ ...f.surfaceMask.viewports[0], cells: undefined }],
  };
  expect(() =>
    terrainJsonDecoder.decode({ ...f, surfaceMask: m }, resolved),
  ).toThrow('arrays');
});

it.each(['height', 'surfaceMask', 'coastline'] as const)(
  'rejects unsupported JSON serialization for %s',
  (key) => {
    const f = terrainFixture();
    f.catalog.settlements.test.products[key].mediaType =
      'application/octet-stream';
    expect(() => decode(f)).toThrow('media type');
  },
);
