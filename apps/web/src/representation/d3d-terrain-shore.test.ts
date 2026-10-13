import { expect, it } from 'vitest';
import { Mesh, MeshLambertMaterial, Raycaster, Vector3 } from 'three';
import { createD3dTerrainGeometry } from './d3d-terrain-geometry.js';
import { terrainFixture } from '../test/terrain-fixture.js';
import {
  parseTerrainCatalog,
  resolveTerrainViewport,
} from '../terrain/terrain-catalog.js';
import { terrainJsonDecoder } from '../terrain/terrain-json-decoder.js';
import { createD3dMapModel } from './d3d-map-model.js';
import {
  createD3dTerrain,
  planD3dTerrain,
  type TerrainMeshPlan,
} from './d3d-terrain-model.js';
function fixture(
  width: number,
  height: number,
  elevation: (r: number, c: number) => number | null,
) {
  const f = terrainFixture();
  for (const v of [
    f.catalog.settlements.test.viewports[0]!,
    f.height.viewports[0]!,
    f.surfaceMask.viewports[0]!,
  ]) {
    v.width = width;
    v.height = height;
    v.rasterBounds3035.east = v.rasterBounds3035.west + width * 25;
    v.rasterBounds3035.south = v.rasterBounds3035.north - height * 25;
  }
  const values = Array.from({ length: width * height }, (_, i) =>
    elevation(Math.floor(i / width), i % width),
  );
  f.height.viewports[0]!.elevations = values;
  f.surfaceMask.viewports[0]!.cells = values.map((v) => (v === null ? 0 : 1));
  const terrain = terrainJsonDecoder.decode(
    f,
    resolveTerrainViewport(parseTerrainCatalog(f.catalog), 'test', 'a')!,
  );
  const model = createD3dMapModel({
    bounds: { west: -0.8, east: -0.6, south: 37.9, north: 38.1 },
    edges: [],
    stopPlaces: [],
  });
  const base = createD3dTerrain(terrain, model),
    b = terrain.viewport.rasterBounds3035;
  return Object.freeze({
    ...base,
    metre: 1,
    worldPoint: (x: number, y: number) => ({ x: x - b.west, z: b.north - y }),
  });
}
function faces(plan: TerrainMeshPlan) {
  return plan.patches.flatMap((p) =>
    Array.from({ length: p.indices.length / 3 }, (_, i) => {
      const vertices = [0, 1, 2].map((j) =>
        new Vector3().fromArray(p.positions, p.indices[i * 3 + j]! * 3),
      );
      const normal = new Vector3()
        .subVectors(vertices[1]!, vertices[0]!)
        .cross(new Vector3().subVectors(vertices[2]!, vertices[0]!));
      return { kind: p.kind, vertices, normal };
    }),
  );
}
const walls = (p: TerrainMeshPlan) =>
  faces(p).filter((f) => Math.abs(f.normal.y) < 1e-8);
for (const lod of ['near', 'medium', 'far'] as const)
  for (const height of [7, -7])
    it(`closes ${lod} displayed adjacency at ${height}m with outward one-sided triangles and intact tops`, () => {
      const w = fixture(17, 17, (_r, c) => (c < 8 ? height : null)),
        p = planD3dTerrain(w, { representationMode: 'normal', lod });
      const shore = walls(p),
        rows = Math.ceil(17 / p.stride);
      expect(shore).toHaveLength(rows * 2);
      for (const f of shore) {
        expect(f.kind).toBe('land');
        expect(f.normal.x * Math.sign(height)).toBeGreaterThan(0);
        expect(f.normal.length()).toBeGreaterThan(0);
        expect(f.vertices.map((v) => v.x)).toEqual([200, 200, 200]);
        for (const v of f.vertices) {
          expect(Number.isFinite(v.z)).toBe(true);
          expect([0, height * 5]).toContain(v.y);
        }
      }
      expect(faces(p).filter((f) => f.normal.y > 0)).toHaveLength(
        rows * (8 / p.stride) * 4 + rows * Math.ceil(9 / p.stride) * 2,
      );
      expect(w.terrain.sample(0, 0)).toBe(height);
      expect(w.terrain.classify(0, 8)).toBe('water');
      expect(planD3dTerrain(w, { representationMode: 'normal', lod })).toBe(p);
      expect(
        planD3dTerrain(w, { representationMode: 'mini', lod: 'near' })
          .triangles,
      ).toBe(
        planD3dTerrain(w, { representationMode: 'normal', lod: 'far' })
          .triangles,
      );
    });
it('closes islands on all four sides without extending coverage or zero-height walls', () => {
  const w = fixture(3, 3, (r, c) => (r === 1 && c === 1 ? 9 : null)),
    p = planD3dTerrain(w, { representationMode: 'normal', lod: 'near' });
  expect(walls(p)).toHaveLength(8);
  for (const f of walls(p)) {
    const center = f.vertices
      .reduce((a, v) => a.add(v), new Vector3())
      .multiplyScalar(1 / 3);
    expect(
      f.normal.dot(new Vector3(center.x - 37.5, 0, center.z - 37.5)),
    ).toBeGreaterThan(0);
  }
  for (const h of [0, 4, null]) {
    const q = planD3dTerrain(
      fixture(3, 3, () => h),
      { representationMode: 'normal', lod: 'near' },
    );
    expect(walls(q)).toHaveLength(0);
    expect(q.triangles).toBe(h === null ? 18 : 36);
  }
});
it('uses coarse displayed classification rather than native island edges', () => {
  const w = fixture(8, 8, (r, c) => (r === 0 && c === 0 ? 9 : null));
  for (const lod of ['medium', 'far'] as const) {
    const p = planD3dTerrain(w, { representationMode: 'normal', lod });
    expect(p.patches.every((p) => p.kind === 'water')).toBe(true);
    expect(walls(p)).toHaveLength(0);
  }
});
it('matches shore supports across native chunks without walls along LAND chunk seams', () => {
  const p = planD3dTerrain(
    fixture(129, 65, (r) => (r < 32 ? 8 : null)),
    { representationMode: 'normal', lod: 'near' },
  );
  expect(walls(p)).toHaveLength(129 * 2);
  expect(faces(p).filter((f) => f.normal.y > 0)).toHaveLength(
    129 * 32 * 4 + 129 * 33 * 2,
  );
  for (const f of walls(p))
    expect(f.vertices.map((v) => v.z)).toEqual([800, 800, 800]);
  const boundary = walls(p)
    .flatMap((f) => f.vertices)
    .filter((v) => v.x === 1600);
  expect(boundary.length).toBeGreaterThan(0);
  expect(new Set(boundary.map((v) => v.y))).toEqual(new Set([0, 40]));
});
it('splits sign-changing shore edges at water level without inverted or degenerate triangles', () => {
  const p = planD3dTerrain(
    fixture(2, 3, (r, c) => (c === 0 ? [8, -8, 0][r]! : null)),
    { representationMode: 'normal', lod: 'near' },
  );
  expect(walls(p).length).toBeGreaterThan(0);
  for (const f of walls(p)) {
    expect(
      f.normal.x * Math.sign(f.vertices.find((v) => v.y !== 0)!.y),
    ).toBeGreaterThan(0);
    expect(f.normal.length()).toBeGreaterThan(0);
    expect(f.vertices.some((v) => v.y === 0)).toBe(true);
    expect(
      f.vertices.some((v) => v.y > 0) && f.vertices.some((v) => v.y < 0),
    ).toBe(false);
  }
});

it('covers the oblique opening with the existing front-sided land material without changing its top normals', () => {
  const p = planD3dTerrain(
    fixture(2, 1, (_r, c) => (c === 0 ? 7 : null)),
    { representationMode: 'normal', lod: 'near' },
  );
  const geometry = createD3dTerrainGeometry(
      p.patches.find((p) => p.kind === 'land')!,
    ),
    material = new MeshLambertMaterial({ vertexColors: true }),
    mesh = new Mesh(geometry, material);
  mesh.updateMatrixWorld();
  expect(
    new Raycaster(
      new Vector3(40, 17.5, 9),
      new Vector3(-1, 0, 0),
    ).intersectObject(mesh),
  ).toHaveLength(1);
  expect(
    new Raycaster(
      new Vector3(10, 17.5, 9),
      new Vector3(1, 0, 0),
    ).intersectObject(mesh),
  ).toHaveLength(0);
  const normal = geometry.getAttribute('normal');
  expect(normal.getY(0)).toBe(1);
  geometry.dispose();
  material.dispose();
});

it('adds no degenerate closure where native land already meets sea level', () => {
  const p = planD3dTerrain(
    fixture(2, 1, (_r, c) => (c === 0 ? 0 : null)),
    { representationMode: 'normal', lod: 'near' },
  );
  expect(walls(p)).toHaveLength(0);
  expect(p.triangles).toBe(6);
  expect(p.vertices).toBe(9);
});

it('faces the inland opening when native LAND is below the water surface', () => {
  const p = planD3dTerrain(
    fixture(2, 1, (_r, c) => (c === 0 ? -7 : null)),
    { representationMode: 'normal', lod: 'near' },
  );
  const geometry = createD3dTerrainGeometry(
      p.patches.find((p) => p.kind === 'land')!,
    ),
    material = new MeshLambertMaterial(),
    mesh = new Mesh(geometry, material);
  mesh.updateMatrixWorld();
  expect(
    new Raycaster(
      new Vector3(10, -17.5, 9),
      new Vector3(1, 0, 0),
    ).intersectObject(mesh),
  ).toHaveLength(1);
  expect(
    new Raycaster(
      new Vector3(40, -17.5, 9),
      new Vector3(-1, 0, 0),
    ).intersectObject(mesh),
  ).toHaveLength(0);
  geometry.dispose();
  material.dispose();
});
