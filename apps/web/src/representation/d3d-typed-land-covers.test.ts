import { expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as terrainPlanning from './d3d-terrain-model.js';
import type { TerrainMeshPlan } from './d3d-terrain-model.js';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readFileSync } from '../../../../scripts/public-layer-files.mjs';
import { FrontSide } from 'three';
import {
  cellCityMap,
  cellCityTerrain,
} from '../test/street-cell-city-fixture.js';
import { d3dGeographicPoint } from './d3d-map-model.js';
import type { StreetCellMasks } from './street-cell-masks.js';
import type { D3dTerrain } from './d3d-terrain-model.js';
import {
  prepareD3dTypedLandCovers,
  typedLandCoverPolicy,
} from './d3d-typed-land-covers.js';
import { createTypedLandCoverResources } from './D3dTypedLandCovers.js';
import { resolveTypedLandCoverMaterial } from './d3d-material-presets.js';
import { createCityMaterializationLoader } from './city-materialization-loader.js';
const metre = cellCityTerrain.metre;
const rectangle = (x: number, z: number, w: number, d: number) =>
  [
    [x, z],
    [x + w, z],
    [x + w, z + d],
    [x, z + d],
    [x, z],
  ].map(([x, z]) => {
    const p = d3dGeographicPoint(cellCityMap, { x: x! * metre, z: z! * metre });
    return [
      Number(p.longitude.toFixed(7)),
      Number(p.latitude.toFixed(7)),
    ] as const;
  });
const feature = (
  type: number,
  id: string,
  size = 100,
): StreetCellMasks['features'][number] => ({
  id,
  geometry: {
    type: 'Polygon',
    coordinates: [rectangle(0, 0, size, size), rectangle(35, 35, 20, 20)],
  },
  properties: {
    t: type,
    src: type === 0 ? 'R14660913' : `W${type}`,
    part: 0,
    sources: [0],
    areaSqm: size * size - 400,
    tags: {},
  },
});
const masksFor = (features: StreetCellMasks['features']): StreetCellMasks => ({
  sha256: 'masks',
  refsSha256: 'refs',
  availability: 'available',
  omittedCapacity: 0,
  missingSelectors: [],
  features,
  cellRefs: { 'es-torrevieja-sc-1': features.map((f) => f.id) },
});
const masks = masksFor(
  Array.from({ length: 6 }, (_, t) => feature(t, 'mask-' + t)),
);
const terrain: D3dTerrain = {
  ...cellCityTerrain,
  bounds: {
    ...cellCityTerrain.bounds,
    minX: -metre,
    maxX: 101 * metre,
    minZ: -metre,
    maxZ: 101 * metre,
  },
  ground: (x, z) => ({ y: 2 * x + 3 * z, diagnostic: 'native' }),
  sample: () => ({ kind: 'land', elevation: 0 }),
};
function syntheticTerrainPlan(
  world: D3dTerrain,
  lod: 'near' | 'medium' | 'far',
): TerrainMeshPlan {
  const b = world.bounds,
    columns = Math.min(64, Math.ceil((b.maxX - b.minX) / (25 * metre))),
    rows = Math.min(64, Math.ceil((b.maxZ - b.minZ) / (25 * metre))),
    positions: number[] = [],
    indices: number[] = [];
  for (let r = 0; r <= rows; r++)
    for (let c = 0; c <= columns; c++) {
      const x = b.minX + ((b.maxX - b.minX) * c) / columns,
        z = b.minZ + ((b.maxZ - b.minZ) * r) / rows;
      positions.push(x, world.ground(x, z).y, z);
    }
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < columns; c++) {
      const a = r * (columns + 1) + c,
        bb = a + 1,
        d = a + columns + 1;
      indices.push(a, d, bb, bb, d, d + 1);
    }
  return {
    lod,
    stride: 1,
    vertices: positions.length / 3,
    triangles: indices.length / 3,
    patches: [
      {
        id: 'synthetic',
        kind: 'land',
        cells: { col: 0, row: 0, endCol: columns, endRow: rows },
        positions: new Float32Array(positions),
        indices: new Uint32Array(indices),
      },
    ],
  };
}
beforeEach(() => {
  vi.spyOn(terrainPlanning, 'planD3dTerrain').mockImplementation(
    (world, policy) => syntheticTerrainPlan(world, policy?.lod ?? 'near'),
  );
});
afterEach(() => vi.restoreAllMocks());
it('batches six classes in deterministic order, follows slope, preserves holes and reuses immutable plans', () => {
  const snapshot = JSON.stringify(masks);
  const plan = prepareD3dTypedLandCovers(masks, cellCityMap, terrain, 'near');
  expect(prepareD3dTypedLandCovers(masks, cellCityMap, terrain, 'near')).toBe(
    plan,
  );
  expect(plan.batches.map((b) => b.type)).toEqual([4, 5, 3, 2, 1, 0]);
  expect(plan.features).toBe(6);
  expect(plan.failures).toEqual([]);
  expect(plan.triangles).toBeGreaterThan(12);
  const near = typedLandCoverPolicy.clearanceMetres * metre;
  for (const batch of plan.batches) {
    expect(batch.renderOrder).toBeGreaterThan(-20);
    expect(batch.renderOrder).toBeLessThan(0);
    const p = batch.positions;
    for (let i = 0; i < p.length; i += 9) {
      const x = (p[i]! + p[i + 3]! + p[i + 6]!) / 3,
        z = (p[i + 2]! + p[i + 5]! + p[i + 8]!) / 3;
      expect(
        x > 35.1 * metre &&
          x < 54.9 * metre &&
          z > 35.1 * metre &&
          z < 54.9 * metre,
      ).toBe(false);
      for (let k = i; k < i + 9; k += 3)
        expect(p[k + 1]).toBeCloseTo(
          terrain.ground(p[k]!, p[k + 2]!).y + near,
          6,
        );
    }
  }
  const reversed = prepareD3dTypedLandCovers(
    { ...masks, features: [...masks.features].reverse() },
    cellCityMap,
    terrain,
    'near',
  );
  expect(reversed.batches.map((b) => [...b.positions])).toEqual(
    plan.batches.map((b) => [...b.positions]),
  );
  expect(JSON.stringify(masks)).toBe(snapshot);
  const medium = prepareD3dTypedLandCovers(
    masks,
    cellCityMap,
    terrain,
    'medium',
  );
  const far = prepareD3dTypedLandCovers(masks, cellCityMap, terrain, 'far');
  expect(far.triangles).toBeLessThanOrEqual(medium.triangles);
  expect(medium.triangles).toBeLessThanOrEqual(plan.triangles);
  const relief = prepareD3dTypedLandCovers(
    masks,
    cellCityMap,
    {
      ...terrain,
      verticalExaggeration: 10,
      ground: (x, z) => ({ y: 4 * x + 6 * z, diagnostic: 'native' }),
    },
    'near',
  );
  expect(relief).not.toBe(plan);
  expect(relief.batches[0]!.positions).not.toEqual(plan.batches[0]!.positions);
});
it('omits small coarse covers and genuinely outside/native-water land faces without changing protection data', () => {
  const tiny = {
    ...feature(4, 'small', 8),
    geometry: {
      type: 'Polygon' as const,
      coordinates: [rectangle(0, 0, 8, 8)],
    },
    properties: { ...feature(4, 'unused').properties, areaSqm: 64 },
  };
  const small = masksFor([tiny]);
  expect(
    prepareD3dTypedLandCovers(small, cellCityMap, terrain, 'far')
      .belowAreaThreshold,
  ).toBe(1);
  expect(
    prepareD3dTypedLandCovers(small, cellCityMap, terrain, 'medium').features,
  ).toBe(0);
  expect(
    prepareD3dTypedLandCovers(small, cellCityMap, terrain, 'near').features,
  ).toBe(1);
  const outside = masksFor([
    {
      ...tiny,
      geometry: { type: 'Polygon', coordinates: [rectangle(200, 200, 8, 8)] },
    },
  ]);
  expect(
    prepareD3dTypedLandCovers(outside, cellCityMap, terrain, 'near').triangles,
  ).toBe(0);
  const actualCoverage: D3dTerrain = {
    ...terrain,
    sample: (x) =>
      x > 50 * metre ? { kind: 'outside' } : { kind: 'land', elevation: 0 },
  };
  const clipped = prepareD3dTypedLandCovers(
    masks,
    cellCityMap,
    actualCoverage,
    'near',
  );
  expect(clipped.outsideSupportTriangles).toBeGreaterThan(0);
  for (const b of clipped.batches)
    for (let i = 0; i < b.positions.length; i += 3)
      expect(b.positions[i]).toBeLessThanOrEqual(50 * metre + 1e-7);
  const water = prepareD3dTypedLandCovers(
    masks,
    cellCityMap,
    { ...terrain, sample: () => ({ kind: 'water' }) },
    'near',
  );
  expect(water.batches.map((b) => b.type)).toEqual([0]);
  expect(water.nativeWaterLandCoverTriangles).toBeGreaterThan(0);
  expect(
    prepareD3dTypedLandCovers(masksFor([]), cellCityMap, terrain, 'near')
      .batches,
  ).toEqual([]);
});
it('gives verified sites source-identity priority, including the deliberately suppressed marina', async () => {
  const sites = await createCityMaterializationLoader({
    baseUrl: '/',
    digestSha256: async (s) => createHash('sha256').update(s).digest('hex'),
    fetchText: async (url) => ({
      ok: true,
      text: async () =>
        readFileSync(join(import.meta.dirname, '../../public', url), 'utf8'),
    }),
  }).resolve('es-torrevieja', 'near');
  const plan = prepareD3dTypedLandCovers(
    masks,
    cellCityMap,
    terrain,
    'near',
    sites,
  );
  expect(plan.suppressedBySites).toEqual(['mask-0']);
  expect(plan.batches.some((b) => b.type === 0)).toBe(false);
  expect(
    prepareD3dTypedLandCovers(masks, cellCityMap, terrain, 'near', sites),
  ).toBe(plan);
});
it('reports bounded feature failures and keeps valid neighbors and exact source polygons', () => {
  const large = feature(4, 'large', 10000),
    source = masksFor([...masks.features, large]);
  const broad = {
    ...terrain,
    bounds: {
      ...cellCityTerrain.bounds,
      minX: -metre,
      minZ: -metre,
      maxX: 10001 * metre,
      maxZ: 10001 * metre,
    },
  };
  const snapshot = JSON.stringify(source);
  const plan = prepareD3dTypedLandCovers(source, cellCityMap, broad, 'near');
  expect(plan.features).toBe(6);
  expect(plan.failures).toEqual([
    { id: 'large', message: 'Error: Typed cover triangle budget exceeded' },
  ]);
  expect(plan.triangles).toBeLessThanOrEqual(65536);
  expect(JSON.stringify(source)).toBe(snapshot);
});
it('owns one one-sided, depth-safe GPU batch per type and disposes without touching CPU arrays', () => {
  const plan = prepareD3dTypedLandCovers(masks, cellCityMap, terrain, 'near');
  const bytes = plan.batches.map((b) => b.positions.slice());
  const resources = createTypedLandCoverResources(plan);
  expect(resources.batches).toHaveLength(6);
  const dispose = resources.batches.flatMap((b) => [
    vi.spyOn(b.geometry, 'dispose'),
    vi.spyOn(b.material, 'dispose'),
  ]);
  for (const b of resources.batches) {
    expect(b.material.side).toBe(FrontSide);
    expect(b.material.depthWrite).toBe(false);
    expect(b.material.depthTest).toBe(true);
    expect(b.material.transparent).toBe(false);
    expect(b.material.color.getHexString()).toBe(
      resolveTypedLandCoverMaterial(b.type).slice(1),
    );
  }
  resources.dispose();
  dispose.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
  expect(plan.batches.map((b) => b.positions)).toEqual(bytes);
  expect(() => resolveTypedLandCoverMaterial(15)).toThrow(
    'Unknown typed land cover',
  );
});
import { createStreetCellLoader } from './street-cells-loader.js';
const realMaskInput = {
  baseUrl: '/',
  digestSha256: async (s: string) =>
    createHash('sha256').update(s).digest('hex'),
  fetchText: async (url: string) => ({
    ok: true,
    text: async () =>
      readFileSync(join(import.meta.dirname, '../../public', url), 'utf8'),
  }),
};
const nativeCells =
  (await createStreetCellLoader(realMaskInput).resolve('es-torrevieja'))!;
const nativeSites = await createCityMaterializationLoader(
  realMaskInput,
).resolve('es-torrevieja', 'near');
const nativeCover = prepareD3dTypedLandCovers(
  nativeCells.masks!,
  cellCityMap,
  cellCityTerrain,
  'near',
  nativeSites,
);
const nativeChordErrors: number[] = [];
for (const batch of nativeCover.batches)
  for (let i = 0; i < batch.positions.length; i += 9) {
    const p = batch.positions,
      x = (p[i]! + p[i + 3]! + p[i + 6]!) / 3,
      z = (p[i + 2]! + p[i + 5]! + p[i + 8]!) / 3,
      y = (p[i + 1]! + p[i + 4]! + p[i + 7]!) / 3;
    nativeChordErrors.push(
      Math.abs(
        (y - cellCityTerrain.ground(x, z).y) / metre -
          typedLandCoverPolicy.clearanceMetres,
      ),
    );
  }
it('keeps real near fills on the native triangle surface between supports, not buried or floating chords', () => {
  expect(nativeCover.failures).toEqual([]);
  expect(Math.max(...nativeChordErrors)).toBeLessThan(0.02);
});
import { elcheCellCityFixture } from '../test/street-cell-city-fixture.js';
const elcheNative = elcheCellCityFixture();
const elcheNativeCells =
  (await createStreetCellLoader(realMaskInput).resolve('es-elche'))!;
const elcheNativeCover = prepareD3dTypedLandCovers(
  elcheNativeCells.masks!,
  elcheNative.model,
  elcheNative.terrain,
  'near',
);
it('clips real partial Elche covers to its native viewport without exhausting the unchanged budget', () => {
  expect(elcheNativeCells.masks!.availability).toBe('partial');
  expect(elcheNativeCover.failures).toEqual([]);
  expect(elcheNativeCover.triangles).toBeLessThanOrEqual(65536);
  expect(elcheNativeCover.features).toBeGreaterThan(100);
  expect(elcheNativeCover.batches.map((b) => b.type).sort()).toEqual([
    0, 2, 3, 4,
  ]);
});
