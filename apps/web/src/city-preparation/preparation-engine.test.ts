import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createPreparationEngine } from './preparation-engine.js';
import type { PreparationJob } from './preparation-protocol.js';
const f = vi.hoisted(() => ({
  asset: vi.fn(),
  terrain: vi.fn(),
  cells: vi.fn(),
  roads: vi.fn(),
  research: vi.fn(),
  build: vi.fn(),
  landmarks: vi.fn(),
  configure: vi.fn(),
}));
vi.mock('../assets/public-layer-loader.js', () => ({
  createPublicLayerLoader: () => ({ fetchAsset: f.asset }),
}));
vi.mock('../terrain/terrain-loader.js', () => ({
  createTerrainLoader: () => ({ resolve: f.terrain }),
}));
vi.mock('../representation/street-cells-loader.js', () => ({
  createStreetCellLoader: () => ({ resolve: f.cells }),
}));
vi.mock('../representation/road-network-loader.js', () => ({
  createRoadNetworkLoader: (input: unknown) => {
    f.configure(input);
    return { resolve: f.roads };
  },
}));
vi.mock('../settlement/settlement-metadata-loader.js', () => ({
  createSettlementMetadataLoader: () => ({
    resolveSettlementMetadata: f.research,
  }),
}));
vi.mock('../representation/d3d-street-cell-city.js', () => ({
  buildStreetCellCity: f.build,
  streetCellLandmarkProtections: f.landmarks,
}));
vi.mock('../representation/d3d-terrain-model.js', () => ({
  createD3dTerrain: () => ({
    ground: (x: number, z: number) => ({ y: x + z }),
  }),
}));
const native = {
  identity: 'es-test:source',
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
  sample: () => 2,
  classify: () => 'land' as const,
};
const input = { baseUrl: '/', fetchArchive: vi.fn() };
const job = {
  kind: 'compose',
  identity: 'revision:A',
  sceneIdentity: 'scene#hash',
  city: 'es-test',
  scenario: 's',
  model: {},
  population: {},
  metadata: undefined,
  scale: 5,
} as unknown as Extract<PreparationJob, { kind: 'compose' }>;
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  f.asset.mockReset().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(2),
  });
  f.terrain.mockReset().mockResolvedValue({ status: 'ready', terrain: native });
  f.cells.mockReset().mockResolvedValue(undefined);
  f.roads.mockReset().mockResolvedValue(undefined);
  f.research.mockReset().mockResolvedValue({ status: 'unavailable' });
  f.build.mockReset().mockReturnValue({
    buildingSource: 'street-cells-C',
    buildings: [{ id: 'one', x: 1, z: 2, baseY: 0.035 }],
  });
  f.landmarks.mockReset().mockReturnValue({ reservations: [], polygons: [] });
});
afterEach(() => vi.unstubAllGlobals());
it('shares the existing storage owner and exposes native/cell/road absent states faithfully', async () => {
  const engine = createPreparationEngine(input);
  await expect(engine.run({ kind: 'asset', url: '/x' })).resolves.toMatchObject(
    { ok: true, bytes: new Uint8Array(2) },
  );
  await expect(
    engine.run({ kind: 'terrain', city: 'es-test', scenario: 's' }),
  ).resolves.toMatchObject({ status: 'ready' });
  f.terrain.mockResolvedValueOnce({ status: 'unavailable' });
  await expect(
    engine.run({ kind: 'terrain', city: 'es-test', scenario: 's' }),
  ).resolves.toEqual({ status: 'unavailable' });
  await expect(
    engine.run({ kind: 'cells', city: 'es-test', level: 'C' }),
  ).resolves.toBeUndefined();
  await expect(
    engine.run({ kind: 'roads', city: 'es-test', level: 'A' }),
  ).resolves.toBeUndefined();
});
it('reuses canonical physical work across messages and retains one recent city without detaching cached anchors', async () => {
  const engine = createPreparationEngine(input);
  const a = (await engine.run(job)) as { city: object; baseYs: Float64Array };
  expect(a.baseYs[0]).toBe(3);
  structuredClone(a, { transfer: [a.baseYs.buffer] });
  const a2 = (await engine.run({ ...job, identity: 'revision:B' })) as {
    city: object;
    baseYs: Float64Array;
  };
  expect(a2.baseYs[0]).toBe(3);
  expect(f.build).toHaveBeenCalledTimes(1);
  await engine.run({ ...job, city: 'es-second' });
  await engine.run(job);
  expect(f.build).toHaveBeenCalledTimes(2);
  await engine.run({ ...job, city: 'es-third' });
  await engine.run({ ...job, city: 'es-fourth' });
  await engine.run(job);
  expect(f.build).toHaveBeenCalledTimes(5);
});
it('isolates scale/research, tolerates absent or failed optional research, and retries a failed composition', async () => {
  const engine = createPreparationEngine(input);
  f.build.mockImplementationOnce(() => {
    throw Error('geometry failure');
  });
  await expect(engine.run(job)).rejects.toThrow('geometry failure');
  await expect(engine.run(job)).resolves.toMatchObject({
    baseYs: new Float64Array([3]),
  });
  await engine.run({ ...job, scale: 10 });
  expect(f.build).toHaveBeenCalledTimes(3);
  f.research.mockRejectedValueOnce(Error('optional research offline'));
  await engine.run({ ...job, resolveResearch: true });
  const metadata = {
    status: 'ready' as const,
    sha256: 'research-hash',
    primarySettlementId: 'es-test',
    metadata: {},
  };
  f.research.mockResolvedValue(metadata);
  await engine.run({ ...job, resolveResearch: true });
  expect(f.landmarks).toHaveBeenCalled();
  f.terrain.mockResolvedValue({ status: 'unavailable' });
  await expect(
    engine.run({ ...job, sceneIdentity: 'no-terrain' }),
  ).resolves.toMatchObject({ baseYs: new Float64Array([0.035]) });
});

it('wires the shared product verifier to UTF-8 SHA-256, preserving leading zero bytes', async () => {
  createPreparationEngine(input);
  await createPreparationEngine(input).run({
    kind: 'roads',
    city: 'es-test',
    level: 'A',
  });
  const config = f.configure.mock.calls.at(-1)![0] as {
    digestSha256: (s: string) => Promise<string>;
  };
  expect(await config.digestSha256('hello')).toBe(
    '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
  );
});

it('does not let a delayed failed plan evict a newer same-key request after a scenario round trip', async () => {
  let failOld!: (e: unknown) => void, finishNew!: (v: unknown) => void;
  f.terrain
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          failOld = reject;
        }),
    )
    .mockResolvedValueOnce({ status: 'ready', terrain: native })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishNew = resolve;
        }),
    );
  const engine = createPreparationEngine(input),
    old = engine.run(job),
    rejected = expect(old).rejects.toThrow('old read');
  await engine.run({ ...job, sceneIdentity: 'other-scene' });
  const current = engine.run(job);
  failOld(Error('old read'));
  await rejected;
  const shared = engine.run(job);
  expect(f.terrain).toHaveBeenCalledTimes(3);
  finishNew({ status: 'ready', terrain: native });
  await expect(current).resolves.toMatchObject({
    baseYs: new Float64Array([3]),
  });
  await expect(shared).resolves.toMatchObject({
    baseYs: new Float64Array([3]),
  });
  expect(f.build).toHaveBeenCalledTimes(2);
});
