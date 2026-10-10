import { join } from 'node:path';
import { readFileSync } from '../../../../scripts/public-layer-files.mjs';

import { Mesh, MeshBasicMaterial, Vector3, Raycaster } from 'three';
import { createD3dTerrainGeometry } from './d3d-terrain-geometry.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { terrainFixture } from '../test/terrain-fixture.js';
import {
  parseTerrainCatalog,
  resolveTerrainViewport,
} from '../terrain/terrain-catalog.js';
import { terrainJsonDecoder } from '../terrain/terrain-json-decoder.js';
import { terrainToGeographic } from '../terrain/terrain-projection.js';
import { createD3dMapModel, d3dProjectedPoint } from './d3d-map-model.js';
import {
  createD3dTerrain,
  planD3dTerrain,
  groundCity,
} from './d3d-terrain-model.js';
import type { ProceduralCity } from './d3d-city-model.js';
it('renders native relief and distinct mask surfaces with static plans and grounded city anchors', () => {
  const f = terrainFixture(),
    resolved = resolveTerrainViewport(
      parseTerrainCatalog(f.catalog),
      'test',
      'a',
    )!;
  const terrain = terrainJsonDecoder.decode(f, resolved);
  const nw = terrainToGeographic({ x: 3375000, y: 1720075 }),
    se = terrainToGeographic({ x: 3375075, y: 1720000 });
  const model = createD3dMapModel({
    bounds: {
      west: nw.longitude,
      east: se.longitude,
      north: nw.latitude,
      south: se.latitude,
    },
    edges: [],
    stopPlaces: [],
  });
  const world = createD3dTerrain(terrain, model);
  expect(createD3dTerrain(terrain, model)).toBe(world);
  const plan = planD3dTerrain(world, {
    representationMode: 'normal',
    lod: 'near',
  });
  expect(plan.patches.map((p) => p.kind)).toEqual(['land', 'water']);
  expect(
    planD3dTerrain(world, { representationMode: 'normal', lod: 'near' }),
  ).toBe(plan);
  const native = d3dProjectedPoint(
    model,
    terrainToGeographic({ x: 3375012.5, y: 1720062.5 }),
  );
  expect(world.ground(native.x, native.z).y).toBeCloseTo(-40 * world.metre);
  expect(world.bounds.maxY).toBeCloseTo(
    terrain.statistics.maxElevation! * world.metre * 10,
  );
  expect(terrain.sample(0, 0)).toBe(-4);
  const building = { id: 'a', ...native, baseY: 0.035, height: 2 };
  const city = {
    buildings: [building],
    far: [building],
    medium: [building],
    mini: [building],
  } as unknown as ProceduralCity;
  const grounded = groundCity(city, world);
  expect(grounded.buildings[0]!.baseY).toBeCloseTo(-40 * world.metre);
  expect(grounded.buildings[0]!.height).toBe(2);
  expect(grounded.buildings[0]!.x).toBe(building.x);
  expect(groundCity(city, world)).toBe(grounded);
  expect(city.buildings[0]!.baseY).toBe(0.035);
  expect(
    planD3dTerrain(world, { representationMode: 'mini', lod: 'near' })
      .triangles,
  ).toBeLessThan(plan.triangles);
});

it('keeps an all-water viewport distinct and exposes outside/nearest sampling diagnostics', () => {
  const f = terrainFixture();
  f.height.viewports[0]!.elevations.fill(null);
  f.surfaceMask.viewports[0]!.cells.fill(0);
  const t = terrainJsonDecoder.decode(
    f,
    resolveTerrainViewport(parseTerrainCatalog(f.catalog), 'test', 'a')!,
  );
  const map = createD3dMapModel({
    bounds: { west: -0.8, east: -0.6, south: 37.9, north: 38.1 },
    edges: [],
    stopPlaces: [],
  });
  const w = createD3dTerrain(t, map);
  expect(w.bounds.minY).toBe(0);
  expect(w.bounds.maxY).toBe(0);
  const p = w.worldPoint(3375012.5, 1720062.5);
  expect(w.sample(p.x, p.z).kind).toBe('water');
  expect(w.ground(p.x, p.z).diagnostic).toBe('flat-fallback');
  expect(
    planD3dTerrain(w, {
      representationMode: 'normal',
      lod: 'near',
    }).patches.map((p) => p.kind),
  ).toEqual(['water']);
});

it('places every cell-fan quadrant on the rendered native land surface rather than a different interpolation plane', () => {
  const f = terrainFixture(),
    t = terrainJsonDecoder.decode(
      f,
      resolveTerrainViewport(parseTerrainCatalog(f.catalog), 'test', 'a')!,
    );
  const map = createD3dMapModel({
    bounds: { west: -0.8, east: -0.6, south: 37.9, north: 38.1 },
    edges: [],
    stopPlaces: [],
  });
  const w = createD3dTerrain(t, map),
    patch = planD3dTerrain(w, { representationMode: 'normal', lod: 'near' })
      .patches[0]!;
  const geometry = createD3dTerrainGeometry(patch),
    material = new MeshBasicMaterial(),
    mesh = new Mesh(geometry, material);
  mesh.updateMatrixWorld();
  for (const [u, v] of [
    [0.5, 0.1],
    [0.5, 0.9],
    [0.1, 0.5],
    [0.9, 0.5],
  ]) {
    const p = w.worldPoint(3375000 + (1 + u!) * 25, 1720075 - v! * 25);
    const ray = new Raycaster(new Vector3(p.x, 5, p.z), new Vector3(0, -1, 0));
    const hits = ray.intersectObject(mesh);
    expect(hits.length).toBeGreaterThan(0);
    expect(w.ground(p.x, p.z).y).toBeCloseTo(hits[0]!.point.y, 4);
  }
  const water = w.worldPoint(3375012.5, 1720012.5);
  expect(w.ground(water.x, water.z).diagnostic).toBe('nearest-land');
  geometry.dispose();
  material.dispose();
});

describe('full native dataset render LOD', () => {
  let world: ReturnType<typeof createD3dTerrain>;
  beforeAll(() => {
    const root = join(import.meta.dirname, '..', '..', 'public', 'terrain');
    const read = (path: string) =>
      JSON.parse(readFileSync(join(root, path), 'utf8')) as unknown;
    const resolved = resolveTerrainViewport(
      parseTerrainCatalog(read('catalog.json')),
      'es-torrevieja',
      'torrevieja-legacy-all-v1',
    )!;
    const products = resolved.entry.products;
    const terrain = terrainJsonDecoder.decode(
      {
        height: read(products.height.path),
        surfaceMask: read(products.surfaceMask.path),
        coastline: read(products.coastline.path),
      },
      resolved,
    );
    const model = createD3dMapModel({
      bounds: { west: -0.8, east: -0.6, south: 37.9, north: 38.1 },
      edges: [],
      stopPlaces: [],
    });
    const mapped = createD3dTerrain(terrain, model);
    const bounds = terrain.viewport.rasterBounds3035;
    // Planning counts use a local metre transform; small ray fixtures above
    // verify the real geographic mapping and native mesh/anchor agreement.
    world = Object.freeze({
      ...mapped,
      worldPoint: (x: number, y: number) => ({
        x: (x - bounds.west) * mapped.metre,
        z: (bounds.north - y) * mapped.metre,
      }),
    });
  });
  it('retains every native sample while selecting cheap far and moderate medium plans', () => {
    const far = planD3dTerrain(world, {
      representationMode: 'normal',
      lod: 'far',
    });
    const medium = planD3dTerrain(world, {
      representationMode: 'normal',
      lod: 'medium',
    });
    expect(world.terrain.statistics.nativeSamples).toBe(161680);
    expect(world.terrain.sample(0, 0)).toBe(21.832195281982422);
    expect(far.stride).toBe(8);
    expect(medium.stride).toBe(4);
    expect(far.triangles).toBe(8690);
    expect(medium.triangles).toBe(34772);
    expect(far.patches).toHaveLength(2);
    expect(medium.patches).toHaveLength(2);
    expect(
      planD3dTerrain(world, { representationMode: 'normal', lod: 'medium' }),
    ).toBe(medium);
  });
  it('includes every unchanged native LAND sample in detailed GPU buffers at ten-fold elevation', () => {
    const near = planD3dTerrain(world, {
      representationMode: 'normal',
      lod: 'near',
    });
    expect(near.stride).toBe(1);
    expect(near.patches).toHaveLength(53);
    expect(near.triangles).toBe(553692);
    const step = world.terrain.resolution.x * world.metre;
    const samples = new Map<number, number>();
    for (const patch of near.patches.filter((p) => p.kind === 'land'))
      for (let i = 0; i < patch.positions.length; i += 3) {
        const c = patch.positions[i]! / step,
          r = patch.positions[i + 2]! / step;
        if (
          Math.abs(c - Math.floor(c) - 0.5) < 0.0001 &&
          Math.abs(r - Math.floor(r) - 0.5) < 0.0001
        )
          samples.set(
            Math.floor(r) * world.terrain.viewport.width + Math.floor(c),
            patch.positions[i + 1]!,
          );
      }
    expect(samples.size).toBe(115166);
    // Inspect every native center, with one mismatch assertion rather than
    // allocating 115,166 assertion objects during concurrent dataset validation.
    const mismatchedCenters: number[] = [];
    for (const [index, y] of samples) {
      const native = world.terrain.sample(
        Math.floor(index / world.terrain.viewport.width),
        index % world.terrain.viewport.width,
      )!;
      if (y !== Math.fround(native * world.metre * 10))
        mismatchedCenters.push(index);
    }
    expect(mismatchedCenters).toEqual([]);
    expect(world.terrain.statistics.nativeSamples).toBe(161680);
    expect(world.terrain.sample(0, 0)).toBe(21.832195281982422);
  });
  it('keeps mini coarse regardless of the supplied camera band', () => {
    const far = planD3dTerrain(world, {
      representationMode: 'normal',
      lod: 'far',
    });
    const mini = planD3dTerrain(world, {
      representationMode: 'mini',
      lod: 'near',
    });
    expect(mini.triangles).toBe(far.triangles);
    expect(mini.lod).toBe('far');
    expect(
      planD3dTerrain(world, { representationMode: 'mini', lod: 'far' }),
    ).toBe(mini);
  });
});

it('chunks native detail with exact neighboring supports, including partial final rows and columns', () => {
  const f = terrainFixture(),
    width = 129,
    height = 65;
  for (const viewport of [
    f.catalog.settlements.test.viewports[0]!,
    f.height.viewports[0]!,
    f.surfaceMask.viewports[0]!,
  ]) {
    viewport.width = width;
    viewport.height = height;
    viewport.rasterBounds3035.east =
      viewport.rasterBounds3035.west + width * 25;
    viewport.rasterBounds3035.south =
      viewport.rasterBounds3035.north - height * 25;
  }
  f.height.viewports[0]!.elevations = Array.from(
    { length: width * height },
    (_, i) => (Math.floor(i / width) % 13) - (i % 17),
  );
  f.surfaceMask.viewports[0]!.cells = Array(width * height).fill(1);
  const terrain = terrainJsonDecoder.decode(
    f,
    resolveTerrainViewport(parseTerrainCatalog(f.catalog), 'test', 'a')!,
  );
  const model = createD3dMapModel({
    bounds: { west: -0.8, east: -0.6, south: 37.9, north: 38.1 },
    edges: [],
    stopPlaces: [],
  });
  const world = createD3dTerrain(terrain, model);
  const near = planD3dTerrain(world, {
    representationMode: 'normal',
    lod: 'near',
  });
  expect(near.stride).toBe(1);
  expect(near.triangles).toBe(width * height * 4);
  expect(near.patches).toHaveLength(6);
  expect(new Set(near.patches.map((p) => p.id)).size).toBe(6);
  expect(
    planD3dTerrain(world, { representationMode: 'normal', lod: 'near' }),
  ).toBe(near);
  for (const patch of near.patches) {
    expect(patch.cells.endCol - patch.cells.col).toBeLessThanOrEqual(64);
    expect(patch.cells.endRow - patch.cells.row).toBeLessThanOrEqual(64);
  }
  const left = near.patches.find(
    (p) => p.cells.col === 0 && p.cells.row === 0,
  )!;
  const right = near.patches.find(
    (p) => p.cells.col === 64 && p.cells.row === 0,
  )!;
  const shared = new Map<string, number>();
  for (let i = 0; i < left.positions.length; i += 3)
    shared.set(
      left.positions[i] + ':' + left.positions[i + 2],
      left.positions[i + 1]!,
    );
  let matched = 0,
    mismatched = 0;
  for (let i = 0; i < right.positions.length; i += 3) {
    const y = shared.get(right.positions[i] + ':' + right.positions[i + 2]);
    if (y !== undefined) {
      matched++;
      if (right.positions[i + 1] !== y) mismatched++;
    }
  }
  expect(matched).toBe(65);
  expect(mismatched).toBe(0);
});

it('keeps coarse terrain below native-grounded anchors rather than burying transport in simplified relief', () => {
  const f = terrainFixture();
  const t = terrainJsonDecoder.decode(
    f,
    resolveTerrainViewport(parseTerrainCatalog(f.catalog), 'test', 'a')!,
  );
  const map = createD3dMapModel({
    bounds: { west: -0.8, east: -0.6, south: 37.9, north: 38.1 },
    edges: [],
    stopPlaces: [],
  });
  const w = createD3dTerrain(t, map);
  const plan = planD3dTerrain(w, { representationMode: 'normal', lod: 'far' });
  const patch = plan.patches.find((p) => p.kind === 'land')!;
  expect(
    Math.max(...Array.from(patch.positions).filter((_, i) => i % 3 === 1)),
  ).toBeLessThanOrEqual(-40 * w.metre + 1e-6);
});
