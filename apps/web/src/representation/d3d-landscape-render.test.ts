import { expect, it } from 'vitest';
import { Color, InstancedMesh } from 'three';
import {
  createLandscapeResources,
  writeLandscapeInstances,
} from './D3dLandscapeDetails.js';
import type { LandscapeDetailPlan } from './d3d-landscape-scene.js';
const items = Array.from({ length: 6 }, (_, i) => ({
  id: 'i' + i,
  maskId: 'm',
  family: 'palm' as const,
  x: i * 10,
  y: 0.1,
  z: 0,
  width: 5,
  depth: 5,
  height: 9,
  rotation: 0.1 * i,
  colorVariant: i % 3,
}));
const plan: LandscapeDetailPlan = {
  identity: 'test',
  availability: 'available',
  instances: items,
  triangles: 192,
  gpuInstances: 12,
  proposals: 6,
  diagnostics: [],
  numericBytes: 384,
  terrainIndexBytes: 0,
  suppressedMasks: [],
  unsupportedSupports: {},
};
it('uploads actual per-instance linear colors and transforms without proliferating materials, and owns disposal', () => {
  const r = createLandscapeResources(plan);
  expect(r.batches).toHaveLength(2);
  expect(new Set(r.batches.map((b) => b.material)).size).toBe(1);
  const colors = new Set<string>();
  for (const b of r.batches) {
    const mesh = new InstancedMesh(b.geometry, b.material, b.instances.length);
    writeLandscapeInstances(mesh, b);
    expect(mesh.instanceColor).not.toBeNull();
    expect(mesh.instanceColor!.version).toBeGreaterThan(0);
    expect(mesh.instanceMatrix.version).toBeGreaterThan(0);
    for (let i = 0; i < items.length; i++) {
      const c = new Color().fromBufferAttribute(mesh.instanceColor!, i);
      colors.add(c.getHexString());
      expect(mesh.instanceMatrix.array[i * 16 + 13]).toBeCloseTo(0.1, 5);
    }
    mesh.dispose();
  }
  expect(colors.size).toBeGreaterThanOrEqual(6);
  expect(r.gpuBytes).toBeGreaterThan(6 * 76 * 2);
  let disposed = 0;
  for (const b of r.batches)
    b.geometry.addEventListener('dispose', () => disposed++);
  r.dispose();
  expect(disposed).toBe(2);
});
it('keeps all five families in eight fixed shared batches without one material per color', () => {
  const instances = (
    ['palm', 'olive', 'carob', 'succulent', 'scrub'] as const
  ).flatMap((family) =>
    items.map((i) => ({ ...i, id: family + i.id, family })),
  );
  const r = createLandscapeResources({
    ...plan,
    instances,
    triangles: 816,
    gpuInstances: 48,
    proposals: 30,
  });
  expect(r.batches).toHaveLength(8);
  expect(new Set(r.batches.map((b) => b.material)).size).toBe(1);
  r.dispose();
});
