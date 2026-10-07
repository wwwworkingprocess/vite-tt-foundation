import { Mesh, MeshBasicMaterial, Vector3, Raycaster, DoubleSide } from 'three';
import { createD3dTerrainGeometry } from './d3d-terrain-geometry.js';
import { expect, it } from 'vitest';
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
  const plan = planD3dTerrain(world, 'normal');
  expect(plan.patches.map((p) => p.kind)).toEqual(['land', 'water']);
  expect(planD3dTerrain(world, 'normal')).toBe(plan);
  const native = d3dProjectedPoint(
    model,
    terrainToGeographic({ x: 3375012.5, y: 1720062.5 }),
  );
  expect(world.ground(native.x, native.z).y).toBeCloseTo(-4 * world.metre);
  const building = { id: 'a', ...native, baseY: 0.035, height: 2 };
  const city = {
    buildings: [building],
    far: [building],
    medium: [building],
    mini: [building],
  } as unknown as ProceduralCity;
  const grounded = groundCity(city, world);
  expect(grounded.buildings[0]!.baseY).toBeCloseTo(-4 * world.metre);
  expect(grounded.buildings[0]!.height).toBe(2);
  expect(grounded.buildings[0]!.x).toBe(building.x);
  expect(groundCity(city, world)).toBe(grounded);
  expect(city.buildings[0]!.baseY).toBe(0.035);
  expect(planD3dTerrain(world, 'mini').triangles).toBeLessThan(plan.triangles);
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
  expect(planD3dTerrain(w, 'normal').patches.map((p) => p.kind)).toEqual([
    'water',
  ]);
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
    patch = planD3dTerrain(w, 'normal').patches[0]!;
  const geometry = createD3dTerrainGeometry(patch),
    material = new MeshBasicMaterial({ side: DoubleSide }),
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
