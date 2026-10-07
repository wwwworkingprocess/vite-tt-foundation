import { expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry } from 'three';
import {
  createD3dTerrainGeometry,
  drapeD3dGeometry,
} from './d3d-terrain-geometry.js';
import type { D3dTerrain } from './d3d-terrain-model.js';
import { terrainFixture } from '../test/terrain-fixture.js';
import {
  parseTerrainCatalog,
  resolveTerrainViewport,
} from '../terrain/terrain-catalog.js';
import { terrainJsonDecoder } from '../terrain/terrain-json-decoder.js';
const fixture = terrainFixture();
const runtime = terrainJsonDecoder.decode(
  fixture,
  resolveTerrainViewport(parseTerrainCatalog(fixture.catalog), 'test', 'a')!,
);
const terrain: D3dTerrain = {
  metre: 1,
  step: 1,
  bounds: { minX: 0, maxX: 5, minZ: 0, maxZ: 5, minY: 0, maxY: 5 },
  ground: (x, z) => ({ y: x + z, diagnostic: 'native' }),
  sample: () => ({ kind: 'land', elevation: 1 }),
  worldPoint: (x, z) => ({ x, z }),
  terrain: runtime,
};
function triangle(points: number[], colored: boolean) {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(points), 3));
  if (colored)
    g.setAttribute(
      'color',
      new BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), 3),
    );
  return g;
}
it('materializes shared indexed patches with upward normals and separate surface geometry', () => {
  const g = createD3dTerrainGeometry({
    kind: 'land',
    positions: new Float32Array([0, 1, 0, 1, 2, 0, 0, 2, 1]),
    indices: new Uint32Array([0, 2, 1]),
  });
  expect(g.index!.count).toBe(3);
  expect(g.getAttribute('normal').getY(0)).toBeGreaterThan(0);
  expect(g.boundingSphere!.radius).toBeGreaterThan(0);
  g.dispose();
});
it.each(
  [
    [0, 0, 0, 4, 0, 0, 2, 0, 0.3],
    [0, 0, 0, 0.3, 0, 0, 0, 0, 4],
    [0, 0, 0, 0, 0, 0.3, 4, 0, 0],
  ].map((points) => [points]),
)(
  'subdivides long triangles and follows ground with a small semantic offset',
  (points) => {
    const source = triangle(points, false);
    const geometry = drapeD3dGeometry(source, terrain, 0.3);
    const p = geometry.getAttribute('position');
    expect(p.count).toBeGreaterThan(3);
    for (let i = 0; i < p.count; i++)
      expect(p.getY(i)).toBeCloseTo(p.getX(i) + p.getZ(i) + 0.3, 5);
    geometry.dispose();
  },
);
it('retains interpolated surface color and suppresses water/outside ground patches', () => {
  const g = drapeD3dGeometry(
    triangle([0, 0, 0, 3, 0, 0, 0, 0, 3], true),
    terrain,
    0.15,
    true,
  );
  expect(g.getAttribute('position').count).toBe(g.getAttribute('color').count);
  expect(g.getAttribute('color').getX(0)).toBe(1);
  g.dispose();
  for (const kind of ['water', 'outside'] as const) {
    const g = drapeD3dGeometry(
      triangle([0, 0, 0, 0.5, 0, 0, 0, 0, 0.5], true),
      { ...terrain, sample: () => ({ kind }) },
      0.15,
      true,
    );
    expect(g.getAttribute('position').count).toBe(0);
    g.dispose();
  }
});

it('rejects uncovered ground patches before subdivision and retains cheap flat fallback transport', () => {
  for (const [x, z] of [
    [-10, 2],
    [10, 2],
    [2, -10],
    [2, 10],
  ]) {
    const points = [x!, 0, z!, x! + 0.5, 0, z!, x!, 0, z! + 0.5];
    const ground = drapeD3dGeometry(
      triangle(points, false),
      terrain,
      0.15,
      true,
    );
    expect(ground.getAttribute('position').count).toBe(0);
    ground.dispose();
    const route = drapeD3dGeometry(triangle(points, false), terrain, 0.3);
    expect(route.getAttribute('position').count).toBe(3);
    route.dispose();
  }
});

it('samples shared subdivision vertices once per preparation while keeping independent preparations current', () => {
  let queries = 0;
  const sampled = {
    ...terrain,
    ground: (x: number, z: number) => {
      queries++;
      return terrain.ground(x, z);
    },
  };
  const points = [0, 0, 0, 4, 0, 0, 0, 0, 4];
  const first = drapeD3dGeometry(triangle(points, false), sampled, 0.3);
  expect(queries).toBeLessThan(first.getAttribute('position').count);
  const before = queries;
  const second = drapeD3dGeometry(triangle(points, false), sampled, 0.3);
  expect(queries).toBeGreaterThan(before);
  expect(second.getAttribute('position').array).toEqual(
    first.getAttribute('position').array,
  );
  first.dispose();
  second.dispose();
});
