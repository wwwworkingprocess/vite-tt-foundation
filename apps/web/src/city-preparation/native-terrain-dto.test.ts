import { expect, it } from 'vitest';
import {
  packNativeTerrain,
  unpackNativeTerrain,
} from './native-terrain-dto.js';
import { preparationBytes } from './preparation-bytes.js';
import type { TerrainRuntime } from '../terrain/terrain-runtime.js';
const native: TerrainRuntime = {
  identity: 'es-test:hash',
  viewport: {
    terrainViewportId: 'v',
    width: 2,
    height: 1,
    rasterBounds3035: { west: 0, south: 0, east: 2, north: 1 },
  },
  resolution: { x: 1, y: 1 },
  coastline: { sourceViewportIds: ['v'], features: [] },
  statistics: {
    nativeSamples: 2,
    landSamples: 1,
    waterSamples: 1,
    minElevation: -1.234567890123,
    maxElevation: -1.234567890123,
  },
  sample: (_r, c) => (c === 0 ? -1.234567890123 : null),
  classify: (_r, c) => (c === 0 ? 'land' : 'water'),
};
it('transfers independent Float64 native buffers without changing source values, water or closure identity', () => {
  const dto = packNativeTerrain(native);
  const transferred = structuredClone(dto, {
    transfer: [dto.elevations.buffer, dto.land.buffer],
  });
  expect(dto.elevations.byteLength).toBe(0);
  expect(native.sample(0, 0)).toBe(-1.234567890123);
  const runtime = unpackNativeTerrain(transferred);
  expect(runtime.sample(0, 0)).toBe(native.sample(0, 0));
  expect(runtime.sample(0, 1)).toBeNull();
  expect(runtime.classify(0, 0)).toBe('land');
  expect(runtime.classify(0, 1)).toBe('water');
  expect(unpackNativeTerrain(transferred)).toBe(runtime);
  expect(() => runtime.sample(-1, 0)).toThrow('outside');
  expect(() => runtime.sample(0, 2)).toThrow('outside');
  expect(() => runtime.sample(0.5, 0)).toThrow('outside');
});
it('rejects malformed native envelopes and wrong buffer dimensions', () => {
  for (const value of [
    null,
    {},
    { ...packNativeTerrain(native), elevations: new Float64Array(1) },
    { ...packNativeTerrain(native), land: new Uint8Array(0) },
  ])
    expect(() => unpackNativeTerrain(value)).toThrow();
});
it('counts shared DTO buffers once and ignores nonpayload fields', () => {
  const a = new Uint8Array(5);
  const value = { a, b: a, n: 2, s: 'ok', t: true, none: null, fn: () => 0 };
  expect(preparationBytes(value)).toBe(21);
  expect(preparationBytes(new ArrayBuffer(8))).toBe(8);
});
