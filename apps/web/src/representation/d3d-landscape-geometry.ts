import { freezeSettlement } from '../settlement/settlement-metadata.js';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  OctahedronGeometry,
} from 'three';
import type { LandscapeFamily } from './d3d-landscape-policy.js';
export const landscapePrototypeInfo = freezeSettlement({
  palm: { width: 5, depth: 5, height: 9, triangles: 32, parts: 2 },
  olive: { width: 5.5, depth: 5.5, height: 4.2, triangles: 32, parts: 2 },
  carob: { width: 8, depth: 7, height: 5.5, triangles: 28, parts: 2 },
  succulent: { width: 1.8, depth: 1.5, height: 1.6, triangles: 36, parts: 1 },
  scrub: { width: 2.2, depth: 1.8, height: 0.7, triangles: 8, parts: 1 },
});
function merge(parts: BufferGeometry[]) {
  const arrays = parts.map((g) => {
    const flat = g.index ? g.toNonIndexed() : g;
    const a = new Float32Array(flat.getAttribute('position').array);
    if (flat !== g) flat.dispose();
    g.dispose();
    return a;
  });
  const values = new Float32Array(arrays.reduce((n, a) => n + a.length, 0));
  let offset = 0;
  for (const a of arrays) {
    values.set(a, offset);
    offset += a.length;
  }
  const result = new BufferGeometry();
  result.setAttribute('position', new BufferAttribute(values, 3));
  result.computeVertexNormals();
  return result;
}
/** Shared normalized prototypes; transforms/instance colors supply variety, never per-object meshes. */
export function createLandscapePrototype(family: LandscapeFamily) {
  let trunk: BufferGeometry | undefined;
  if (family === 'palm' || family === 'olive' || family === 'carob') {
    trunk = new CylinderGeometry(
      family === 'palm' ? 0.035 : 0.055,
      0.07,
      family === 'palm' ? 0.84 : 0.52,
      4,
      1,
      true,
    );
    trunk.rotateZ(family === 'palm' ? 0.07 : -0.04);
    trunk.translate(0, family === 'palm' ? 0.424 : 0.263, 0);
  }
  let foliage: BufferGeometry;
  if (family === 'palm') {
    const p: number[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3,
        c = Math.cos(a),
        s = Math.sin(a);
      const root = [0, 0.85, 0],
        tip = [c * 0.5, 0.76, s * 0.5],
        left = [c * 0.25 - s * 0.09, 0.96, s * 0.25 + c * 0.09],
        right = [c * 0.25 + s * 0.09, 0.96, s * 0.25 - c * 0.09];
      for (const t of [
        [root, left, tip],
        [root, tip, right],
        [root, right, left],
        [left, right, tip],
      ])
        for (const v of t) p.push(...v);
    }
    foliage = new BufferGeometry();
    foliage.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(p), 3),
    );
    foliage.computeVertexNormals();
  } else if (family === 'olive') {
    foliage = merge(
      (
        [
          [-0.19, 0.67, 0],
          [0.19, 0.72, 0.07],
          [0, 0.85, -0.12],
        ] as const
      ).map(([x, y, z]) => {
        const g = new OctahedronGeometry(0.3);
        g.scale(1, 0.48, 1);
        g.translate(x, y, z);
        return g;
      }),
    );
  } else if (family === 'carob') {
    foliage = new IcosahedronGeometry(0.5, 0);
    foliage.scale(1, 0.65, 1);
    foliage.translate(0, 0.67, 0);
  } else if (family === 'succulent') {
    foliage = merge(
      (
        [
          [0.2, 0.5, 0.25, 0, 0],
          [0.14, 0.25, 0.2, -0.25, 0],
          [0.15, 0.3, 0.18, 0.24, 0.12],
        ] as const
      ).map(([w, h, d, x, z]) => {
        const g = new BoxGeometry(w, h, d);
        g.translate(x, h / 2, z);
        return g;
      }),
    );
  } else {
    foliage = new OctahedronGeometry(0.5);
    foliage.scale(1, 0.65, 1);
    foliage.translate(0, 0.325, 0);
  }
  return { trunk, foliage };
}
