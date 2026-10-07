import { expect, it } from 'vitest';
import { terrainFixture } from '../test/terrain-fixture.js';
import {
  parseTerrainCatalog,
  resolveTerrainViewport,
} from './terrain-catalog.js';
import { terrainJsonDecoder } from './terrain-json-decoder.js';
import { sampleTerrain, terrainGround } from './terrain-runtime.js';
import {
  geographicToTerrain,
  terrainToGeographic,
} from './terrain-projection.js';

it('resolves a shared viewport and preserves native negative land and null water', () => {
  const fixture = terrainFixture();
  const catalog = parseTerrainCatalog(fixture.catalog);
  const resolved = resolveTerrainViewport(catalog, 'test', 'a')!;
  expect(resolveTerrainViewport(catalog, 'test', 'b')!.viewport).toBe(
    resolved.viewport,
  );
  const runtime = terrainJsonDecoder.decode(fixture, resolved);
  expect(runtime.sample(0, 0)).toBe(-4);
  expect(runtime.sample(2, 0)).toBeNull();
  expect(runtime.classify(0, 0)).toBe('land');
  expect(runtime.classify(2, 0)).toBe('water');
  expect(sampleTerrain(runtime, 3375012.5, 1720062.5)).toEqual({
    kind: 'land',
    elevation: -4,
  });
  expect(sampleTerrain(runtime, 3375025, 1720050)).toEqual({
    kind: 'land',
    elevation: 2,
  });
  expect(sampleTerrain(runtime, 3375000, 1720075)).toEqual({
    kind: 'land',
    elevation: -4,
  });
  expect(sampleTerrain(runtime, 3375012.5, 1720012.5)).toEqual({
    kind: 'water',
  });
  expect(sampleTerrain(runtime, 3374999, 1720062.5)).toEqual({
    kind: 'outside',
  });
  expect(terrainGround(runtime, 3375012.5, 1720012.5)).toEqual({
    elevation: 4,
    diagnostic: 'nearest-land',
  });
});

it('converts EPSG:3035 with the ellipsoidal EPSG 9820 published control point', () => {
  const p = geographicToTerrain({ longitude: 5, latitude: 50 });
  expect(p.x).toBeCloseTo(3962799.45, 2);
  expect(p.y).toBeCloseTo(2999718.85, 2);
  expect(terrainToGeographic(p).latitude).toBeCloseTo(50, 9);
  expect(terrainToGeographic(p).longitude).toBeCloseTo(5, 9);
  for (const x of [3373300, 3382700])
    for (const y of [1716725, 1727475]) {
      const roundtrip = geographicToTerrain(terrainToGeographic({ x, y }));
      expect(roundtrip.x).toBeCloseTo(x, 6);
      expect(roundtrip.y).toBeCloseTo(y, 6);
    }
});

it('maps the projection origin without a singular inverse', () => {
  expect(terrainToGeographic({ x: 4321000, y: 3210000 })).toEqual({
    longitude: 10,
    latitude: 52,
  });
  expect(geographicToTerrain({ longitude: 10, latitude: 52 })).toEqual({
    x: 4321000,
    y: 3210000,
  });
});
