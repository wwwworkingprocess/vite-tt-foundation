import { expect, it } from 'vitest';
import {
  decodePreparationJob,
  validatePreparationResult,
} from './preparation-wire.js';
import type { PreparationJob } from './preparation-protocol.js';
const compose = {
  kind: 'compose',
  identity: 'request-hash',
  sceneIdentity: 'scene-hash',
  city: 'es-test',
  scenario: 's',
  scale: 5,
  model: {},
  population: {},
  metadata: undefined,
} as unknown as Extract<PreparationJob, { kind: 'compose' }>;
it('preserves valid request identity and rejects malformed or foreign wire envelopes', () => {
  const valid: PreparationJob[] = [
    { kind: 'asset', url: '/game/terrain/catalog.json' },
    { kind: 'terrain', city: 'es-test', scenario: 's' },
    { kind: 'cells', city: 'es-test', level: 'C' },
    { kind: 'roads', city: 'es-test', level: 'A' },
    compose,
  ];
  for (const job of valid) expect(decodePreparationJob(job)).toBe(job);
  for (const bad of [
    null,
    { kind: 'asset', url: 1 },
    { kind: 'asset', url: 'external' },
    { kind: 'cells', city: '', level: 'C' },
    { kind: 'cells', city: 'es-test', level: 'D' },
    { kind: 'terrain', city: 'es-test', scenario: '' },
    { kind: 'wrong', city: 'es-test', scenario: 's' },
    { ...compose, identity: 2 },
    { ...compose, sceneIdentity: 2 },
    { ...compose, model: null },
    { ...compose, population: null },
    { ...compose, scale: NaN },
    { ...compose, scale: 0 },
  ])
    expect(() => decodePreparationJob(bad)).toThrow('payload');
});
it('distinguishes valid absent products from malformed claimed success and validates byte payloads', () => {
  const asset: PreparationJob = { kind: 'asset', url: '/x' };
  validatePreparationResult(asset, { ok: true, bytes: new Uint8Array(1) });
  for (const bad of [
    null,
    { ok: 'yes', bytes: new Uint8Array(1) },
    { ok: true, bytes: new Float64Array(1) },
  ])
    expect(() => validatePreparationResult(asset, bad)).toThrow('payload');
  for (const kind of ['cells', 'roads'] as const) {
    const job = { kind, city: 'es-test', level: 'C' as const };
    validatePreparationResult(job, undefined);
    const value = {
      settlementId: 'es-test',
      level: 'C',
      sha256: 'a'.repeat(64),
      features: [],
    };
    validatePreparationResult(job, value);
    for (const bad of [
      null,
      { ...value, settlementId: 'es-other' },
      { ...value, level: 'A' },
      { ...value, sha256: 1 },
      { ...value, sha256: 'wrong' },
      { ...value, features: {} },
    ])
      expect(() => validatePreparationResult(job, bad)).toThrow('payload');
  }
});
it('validates composition version, exact correlation, city identity and complete native anchor lengths', () => {
  const good = {
    schemaVersion: 1,
    identity: compose.identity,
    cityId: compose.city,
    city: { buildingSource: 'street-cells-C', buildings: [] },
    baseYs: new Float64Array(0),
  };
  validatePreparationResult(compose, good);
  for (const value of [
    null,
    { ...good, schemaVersion: 2 },
    { ...good, identity: 'old' },
    { ...good, cityId: 'es-old' },
    { ...good, city: null },
    { ...good, city: { buildingSource: 'other', buildings: [] } },
    { ...good, city: { buildingSource: 'street-cells-C', buildings: {} } },
    { ...good, baseYs: [] },
    { ...good, baseYs: new Float64Array(1) },
    {
      ...good,
      city: { ...good.city, buildings: [{}] },
      baseYs: new Float64Array([NaN]),
    },
  ])
    expect(() => validatePreparationResult(compose, value)).toThrow('payload');
});
it('retains valid unavailable native terrain but rejects malformed statuses and dimensions', () => {
  const job: PreparationJob = {
    kind: 'terrain',
    city: 'es-test',
    scenario: 's',
  };
  validatePreparationResult(job, { status: 'unavailable' });
  for (const bad of [
    null,
    { status: 'error' },
    { status: 'ready', terrain: {} },
  ])
    expect(() => validatePreparationResult(job, bad)).toThrow();
});

it('validates native terrain success and rejects a foreign city identity', () => {
  const dto = {
    schemaVersion: 1,
    identity: 'es-test:hash',
    viewport: {
      terrainViewportId: 'v',
      width: 1,
      height: 1,
      rasterBounds3035: { west: 0, south: 0, east: 1, north: 1 },
    },
    resolution: { x: 1, y: 1 },
    coastline: { sourceViewportIds: ['v'], features: [] },
    statistics: {
      nativeSamples: 1,
      landSamples: 1,
      waterSamples: 0,
      minElevation: 2,
      maxElevation: 2,
    },
    elevations: new Float64Array([2]),
    land: new Uint8Array([1]),
  };
  const job = { kind: 'terrain' as const, city: 'es-test', scenario: 's' };
  validatePreparationResult(job, { status: 'ready', terrain: dto });
  expect(() =>
    validatePreparationResult(
      { ...job, city: 'es-other' },
      { status: 'ready', terrain: dto },
    ),
  ).toThrow('payload');
});
