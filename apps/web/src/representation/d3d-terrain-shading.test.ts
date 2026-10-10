import { expect, it, vi } from 'vitest';
import { terrainFixture } from '../test/terrain-fixture.js';
import {
  parseTerrainCatalog,
  resolveTerrainViewport,
} from '../terrain/terrain-catalog.js';
import { terrainJsonDecoder } from '../terrain/terrain-json-decoder.js';
import { terrainSelfShade } from './d3d-terrain-shading.js';
it('caches deterministic fixed-sun shading, preserves negative LAND and leaves water/bounds neutral', () => {
  const f = terrainFixture();
  const t = terrainJsonDecoder.decode(
    f,
    resolveTerrainViewport(parseTerrainCatalog(f.catalog), 'test', 'a')!,
  );
  const sample = vi.fn(t.sample);
  const runtime = { ...t, sample };
  const shade = terrainSelfShade(runtime, 1, 1, 10);
  expect(shade).toBeGreaterThanOrEqual(0.65);
  expect(shade).toBeLessThanOrEqual(1);
  const calls = sample.mock.calls.length;
  expect(terrainSelfShade(runtime, 1.4, 1.4, 10)).toBe(shade);
  expect(sample).toHaveBeenCalledTimes(calls);
  expect(terrainSelfShade(runtime, 0, 0, 10)).toBeGreaterThanOrEqual(0.65);
  expect(terrainSelfShade(runtime, 0, 2, 10)).toBe(1);
  expect(terrainSelfShade(runtime, -1, 0, 10)).toBe(1);
  expect(terrainSelfShade(runtime, 3, 0, 10)).toBe(1);
  expect(t.sample(0, 0)).toBe(-4);
});
it('a northwest ridge casts a bounded shadow; flat land stays bright without inventing water heights', () => {
  const f = terrainFixture();
  const t = terrainJsonDecoder.decode(
    f,
    resolveTerrainViewport(parseTerrainCatalog(f.catalog), 'test', 'a')!,
  );
  const flat = { ...t, sample: () => 0 };
  const ridge = {
    ...t,
    sample: (r: number, c: number) => (r === 0 && c === 0 ? 50 : 0),
  };
  expect(terrainSelfShade(flat, 1, 1, 10)).toBe(1);
  expect(terrainSelfShade(ridge, 1, 1, 10)).toBeLessThan(0.85);
  expect(terrainSelfShade(ridge, 2, 1, 10)).toBeGreaterThanOrEqual(0.65);
});

it('uses neutral missing neighbors and keys shade by elevation scale; northwest slopes face the fixed sun', () => {
  const f = terrainFixture();
  const t = terrainJsonDecoder.decode(
    f,
    resolveTerrainViewport(parseTerrainCatalog(f.catalog), 'test', 'a')!,
  );
  const isolated = {
    ...t,
    sample: (r: number, c: number) => (r === 1 && c === 1 ? 5 : null),
  };
  expect(terrainSelfShade(isolated, 1, 1, 10)).toBe(1);
  expect(terrainSelfShade(t, 0, -1, 10)).toBe(1);
  expect(terrainSelfShade(t, 0, 3, 10)).toBe(1);
  const ridge = {
    ...t,
    sample: (r: number, c: number) => (r === 0 && c === 0 ? 10 : 0),
  };
  expect(terrainSelfShade(ridge, 1, 1, 10)).toBeLessThan(
    terrainSelfShade(ridge, 1, 1, 1),
  );
  const toward = { ...t, sample: (r: number, c: number) => r + c };
  const away = { ...t, sample: (r: number, c: number) => -r - c };
  expect(terrainSelfShade(toward, 1, 1, 10)).toBeGreaterThan(
    terrainSelfShade(away, 1, 1, 10),
  );
});
