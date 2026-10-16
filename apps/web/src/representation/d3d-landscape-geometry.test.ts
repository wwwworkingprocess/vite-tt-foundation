import { expect, it } from 'vitest';
import {
  createLandscapePrototype,
  landscapePrototypeInfo,
} from './d3d-landscape-geometry.js';
it('provides three non-conifer tree silhouettes plus two low ground families inside normalized meaningful envelopes', () => {
  const signatures = new Set<string>();
  for (const family of [
    'palm',
    'olive',
    'carob',
    'succulent',
    'scrub',
  ] as const) {
    const p = createLandscapePrototype(family);
    let triangles = 0;
    for (const g of [p.trunk, p.foliage].filter((g) => g !== undefined)) {
      g.computeBoundingBox();
      const b = g.boundingBox!;
      expect(b.min.y).toBeGreaterThanOrEqual(-1e-7);
      expect(b.max.y).toBeLessThanOrEqual(1.000001);
      expect(
        Math.max(
          Math.abs(b.min.x),
          Math.abs(b.max.x),
          Math.abs(b.min.z),
          Math.abs(b.max.z),
        ),
      ).toBeLessThanOrEqual(0.500001);
      triangles += (g.index?.count ?? g.getAttribute('position').count) / 3;
    }
    expect(triangles).toBe(landscapePrototypeInfo[family].triangles);
    expect(Boolean(p.trunk)).toBe(['palm', 'olive', 'carob'].includes(family));
    signatures.add(
      JSON.stringify(Array.from(p.foliage.getAttribute('position').array)),
    );
    p.trunk?.dispose();
    p.foliage.dispose();
  }
  expect(signatures.size).toBe(5);
});
