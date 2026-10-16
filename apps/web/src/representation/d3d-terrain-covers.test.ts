import { expect, it } from 'vitest';
import type { TerrainMeshPlan } from './d3d-terrain-model.js';
import { createTerrainCoverProjector } from './d3d-terrain-covers.js';
import { pointInPolygon } from '../settlement/settlement-metadata-spatial.js';
const positions = new Float32Array([
  0, 0, 0, 4, 8, 0, 0, 12, 4, 4, 20, 4, 0, 10, 0,
]);
const patch = {
  id: 'surface',
  kind: 'land' as const,
  cells: { col: 0, row: 0, endCol: 1, endRow: 1 },
  positions,
  indices: new Uint32Array([0, 2, 1, 1, 2, 3, 0, 4, 1]),
};
const plan: Pick<TerrainMeshPlan, 'patches'> = { patches: [patch] };
const regions = [{ minX: 0, maxX: 4, minZ: 0, maxZ: 4 }];
const rect = (x: number, z: number, w: number, d: number) =>
  [
    [x, z],
    [x + w, z],
    [x + w, z + d],
    [x, z + d],
    [x, z],
  ] as const;
const area = (p: Float32Array) => {
  let sum = 0;
  for (let i = 0; i < p.length; i += 9)
    sum +=
      Math.abs(
        (p[i + 3]! - p[i]!) * (p[i + 8]! - p[i + 2]!) -
          (p[i + 5]! - p[i + 2]!) * (p[i + 6]! - p[i]!),
      ) / 2;
  return sum;
};
it('clips holes to the actual sloped native faces, preserves source arrays and upward winding', () => {
  const polygon = [rect(-1, -1, 6, 6), rect(1, 1, 1, 1)],
    before = JSON.stringify(polygon),
    bytes = positions.slice();
  const projector = createTerrainCoverProjector(plan, 2, regions);
  expect(projector.faces).toBe(2);
  expect(projector.indexBytes).toBeGreaterThan(0);
  const p = projector.project([polygon], 0.04, 100, () => true, 'Cover');
  expect(area(p)).toBeCloseTo(15, 5);
  for (let i = 0; i < p.length; i += 9) {
    const x = (p[i]! + p[i + 3]! + p[i + 6]!) / 3,
      z = (p[i + 2]! + p[i + 5]! + p[i + 8]!) / 3;
    expect(
      pointInPolygon([x, z], { type: 'Polygon', coordinates: polygon }),
    ).toBe(true);
    const normal =
      (p[i + 5]! - p[i + 2]!) * (p[i + 6]! - p[i]!) -
      (p[i + 3]! - p[i]!) * (p[i + 8]! - p[i + 2]!);
    expect(normal).toBeGreaterThan(0);
    for (let j = i; j < i + 9; j += 3)
      expect(p[j + 1]).toBeCloseTo(2 * p[j]! + 3 * p[j + 2]! + 0.04, 5);
  }
  expect(JSON.stringify(polygon)).toBe(before);
  expect(positions).toEqual(bytes);
  expect(projector.project([polygon], 0.04, 100, () => true, 'Cover')).toEqual(
    p,
  );
});
it('keeps disconnected concave intersections separate and includes closed-ring holes at face boundaries', () => {
  const u = [
    [
      [0, 0],
      [4, 0],
      [4, 4],
      [3, 4],
      [3, 1],
      [1, 1],
      [1, 4],
      [0, 4],
      [0, 0],
    ],
  ] as const;
  const p = createTerrainCoverProjector(plan, 1, regions).project(
    [u],
    0.04,
    100,
    () => true,
    'Cover',
  );
  expect(area(p)).toBeCloseTo(10, 5);
  for (let i = 0; i < p.length; i += 9)
    expect(
      pointInPolygon(
        [
          (p[i]! + p[i + 3]! + p[i + 6]!) / 3,
          (p[i + 2]! + p[i + 5]! + p[i + 8]!) / 3,
        ],
        { type: 'Polygon', coordinates: u },
      ),
    ).toBe(true);
  const mirrored = {
    patches: [{ ...patch, indices: new Uint32Array([0, 1, 2, 1, 3, 2]) }],
  };
  expect(
    area(
      createTerrainCoverProjector(mirrored, 2, regions).project(
        [u],
        0.04,
        100,
        () => true,
        'Cover',
      ),
    ),
  ).toBeCloseTo(10, 5);
});
it('reuses fully enclosed faces, omits outside/degenerate/rejected pieces and bounds both output and query work', () => {
  const projector = createTerrainCoverProjector(plan, 2, regions);
  const enclosing = [rect(-1, -1, 6, 6)];
  expect(
    projector.project([enclosing], 0.04, 100, () => true, 'Cover'),
  ).toHaveLength(18);
  expect(
    projector.project([enclosing], 0.04, 100, () => false, 'Cover'),
  ).toHaveLength(0);
  expect(
    projector.project([[rect(1e9, 1e9, 2, 2)]], 0.04, 100, () => true, 'Cover'),
  ).toHaveLength(0);
  expect(
    projector.project([[rect(4, 0, 1, 4)]], 0.04, 100, () => true, 'Cover'),
  ).toHaveLength(0);
  expect(
    createTerrainCoverProjector(plan, 2, [
      { minX: 0, maxX: 10, minZ: 0, maxZ: 10 },
    ]).project([[rect(8, 8, 1, 1)]], 0.04, 100, () => true, 'Cover'),
  ).toHaveLength(0);
  expect(
    createTerrainCoverProjector(plan, 2, []).project(
      [enclosing],
      0.04,
      100,
      () => true,
      'Cover',
    ),
  ).toHaveLength(0);
  expect(() =>
    projector.project([enclosing], 0.04, 1, () => true, 'Cover'),
  ).toThrow('Cover triangle budget exceeded');
  expect(() =>
    projector.project([enclosing], 0.04, 0, () => true, 'Cover'),
  ).toThrow('Cover triangle budget exceeded');
  const many = { patches: Array.from({ length: 40 }, () => patch) };
  expect(() =>
    createTerrainCoverProjector(many, 50, regions).project(
      [enclosing],
      0.04,
      1,
      () => false,
      'Cover',
    ),
  ).toThrow('Cover triangle budget exceeded');
});
