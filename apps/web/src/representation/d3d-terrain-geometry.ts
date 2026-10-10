import { d3dDrapeBudget } from './d3d-presentation-policy.js';
import { BufferAttribute, BufferGeometry } from 'three';
import type { D3dTerrain, TerrainMeshPatch } from './d3d-terrain-model.js';
export function createD3dTerrainGeometry(patch: TerrainMeshPatch) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(patch.positions, 3));
  geometry.setIndex(new BufferAttribute(patch.indices, 1));
  if (patch.colors)
    geometry.setAttribute('color', new BufferAttribute(patch.colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
/** Split presentation triangles to bounded LOD support before draping; the
 * source horizontal geometry remains unchanged. No simulation/path edits.
 * Legacy surface layer ranks retain millimetre differences in metre space.
 * Caller owns/disposes the geometry; raw temporary buffers are released.
 */
export function drapeD3dGeometry(
  source: BufferGeometry,
  terrain: D3dTerrain,
  offsetMeters: number,
  landOnly = false,
  maxEdgeLength = terrain.step,
  budget: Readonly<{
    maxTriangles?: number;
    maxDepth?: number;
  }> = d3dDrapeBudget,
  selfShade = false,
) {
  // A split adds one output face. Reserve every original face so exhaustion
  // retains coarser coverage rather than leaving holes. Stack depth is also bounded.
  const maxTriangles = Math.min(
      d3dDrapeBudget.maxTriangles,
      Math.max(
        0,
        Math.floor(budget.maxTriangles ?? d3dDrapeBudget.maxTriangles),
      ),
    ),
    maxDepth = Math.min(
      d3dDrapeBudget.maxDepth,
      Math.max(0, Math.floor(budget.maxDepth ?? d3dDrapeBudget.maxDepth)),
    );
  const vertices = source.getAttribute('position'),
    color = source.getAttribute('color');
  let splits = Math.max(0, maxTriangles - vertices.count / 3);
  let limited = false;
  const positions: number[] = [],
    colors: number[] = [];
  type Vertex = readonly [number, number, number, number, number, number];
  const heights = new WeakMap<Vertex, ReturnType<D3dTerrain['ground']>>();
  const height = (p: Vertex) => {
    const previous = heights.get(p);
    if (previous !== undefined) return previous;
    const y = terrain.ground(p[0], p[2]);
    heights.set(p, y);
    return y;
  };
  const read = (i: number): Vertex => [
    vertices.getX(i),
    vertices.getY(i),
    vertices.getZ(i),
    color ? color.getX(i) : 0,
    color ? color.getY(i) : 0,
    color ? color.getZ(i) : 0,
  ];
  const midpoint = (a: Vertex, b: Vertex): Vertex => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
    (a[2] + b[2]) / 2,
    (a[3] + b[3]) / 2,
    (a[4] + b[4]) / 2,
    (a[5] + b[5]) / 2,
  ];
  const distance = (a: Vertex, b: Vertex) =>
    Math.hypot(a[0] - b[0], a[2] - b[2]);
  const emit = (a: Vertex, b: Vertex, c: Vertex, depth = 0) => {
    const bounds = terrain.bounds;
    const outside =
      Math.min(a[0], b[0], c[0]) > bounds.maxX ||
      Math.max(a[0], b[0], c[0]) < bounds.minX ||
      Math.min(a[2], b[2], c[2]) > bounds.maxZ ||
      Math.max(a[2], b[2], c[2]) < bounds.minZ;
    if (landOnly && outside) return;
    const ab = distance(a, b),
      bc = distance(b, c),
      ca = distance(c, a);
    const needsSplit = !outside && Math.max(ab, bc, ca) > maxEdgeLength;
    if (needsSplit && depth < maxDepth && splits > 0) {
      splits--;
      if (ab >= bc && ab >= ca) {
        const m = midpoint(a, b);
        emit(a, m, c, depth + 1);
        emit(m, b, c, depth + 1);
      } else if (bc >= ca) {
        const m = midpoint(b, c);
        emit(a, b, m, depth + 1);
        emit(a, m, c, depth + 1);
      } else {
        const m = midpoint(c, a);
        emit(a, b, m, depth + 1);
        emit(m, b, c, depth + 1);
      }
      return;
    }
    if (needsSplit) limited = true;
    if (
      landOnly &&
      terrain.sample((a[0] + b[0] + c[0]) / 3, (a[2] + b[2] + c[2]) / 3)
        .kind !== 'land'
    )
      return;
    for (const p of [a, b, c]) {
      positions.push(
        p[0],
        height(p).y + (offsetMeters + (landOnly ? p[1] : 0)) * terrain.metre,
        p[2],
      );
      if (color) {
        const shade = selfShade ? (height(p).shade ?? 1) : 1;
        colors.push(p[3] * shade, p[4] * shade, p[5] * shade);
      }
    }
  };
  for (let i = 0; i < vertices.count; i += 3)
    emit(read(i), read(i + 1), read(i + 2));
  source.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(positions), 3),
  );
  if (color)
    source.setAttribute(
      'color',
      new BufferAttribute(new Float32Array(colors), 3),
    );
  source.userData.drapeLimited = limited;
  source.computeVertexNormals();
  source.computeBoundingSphere();
  return source;
}
