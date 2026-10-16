import { ShapeUtils, Vector2 } from 'three';
import type { D3dTerrain } from './d3d-terrain-model.js';
import type { FootprintPolygon } from './d3d-footprint.js';
type Point = readonly [number, number];
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** Sutherland-Hodgman clipping of already triangulated site faces to native coverage. */
export function clipD3dSurfaceTriangle(
  points: Point[],
  bounds: D3dTerrain['bounds'],
): Point[] {
  let result = points;
  for (const [axis, limit, greater] of [
    [0, bounds.minX, true],
    [0, bounds.maxX, false],
    [1, bounds.minZ, true],
    [1, bounds.maxZ, false],
  ] as const) {
    const next: Point[] = [];
    for (let i = 0; i < result.length; i++) {
      const a = result[i]!,
        b = result[(i + 1) % result.length]!,
        insideA = greater ? a[axis] >= limit : a[axis] <= limit,
        insideB = greater ? b[axis] >= limit : b[axis] <= limit;
      if (insideA) next.push(a);
      if (insideA !== insideB) {
        const t = (limit - a[axis]) / (b[axis] - a[axis]);
        next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    result = next;
  }
  return result;
}
/** Shared bounded, viewport-clipped terrain support. Source rings are never changed. */
export function prepareDrapedPolygonSurface(
  polygons: readonly FootprintPolygon[],
  terrain: D3dTerrain,
  support: number,
  clearance: number,
  maxTriangles: number,
  accept: (a: Point, b: Point, c: Point) => boolean,
  label: string,
): Float32Array {
  const output: number[] = [];
  let emitted = 0,
    visited = 0;
  const emit = (a: Point, b: Point, c: Point, depth = 0) => {
    if (++visited > maxTriangles * 4 || emitted >= maxTriangles)
      throw new Error(label + ' triangle budget exceeded');
    if (
      Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) <
      1e-15
    )
      return;
    const ab = distance(a, b),
      bc = distance(b, c),
      ca = distance(c, a);
    if (Math.max(ab, bc, ca) > support) {
      if (depth >= 24) throw new Error(label + ' support depth exceeded');
      const midpoint = (p: Point, q: Point): Point => [
        (p[0] + q[0]) / 2,
        (p[1] + q[1]) / 2,
      ];
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
    if (!accept(a, b, c)) return;
    // ShapeUtils/Earcut emits CCW in X/Z; clipping preserves order. Reverse for +Y.
    for (const p of [a, c, b])
      output.push(p[0], terrain.ground(p[0], p[1]).y + clearance, p[1]);
    emitted++;
  };
  for (const rings of polygons) {
    const contour = rings[0]!.slice(0, -1).map((p) => new Vector2(...p)),
      holes = rings
        .slice(1)
        .map((r) => r.slice(0, -1).map((p) => new Vector2(...p))),
      vertices = [...contour, ...holes.flat()];
    for (const face of ShapeUtils.triangulateShape(contour, holes)) {
      const clipped = clipD3dSurfaceTriangle(
        face.map((i) => [vertices[i]!.x, vertices[i]!.y]),
        terrain.bounds,
      );
      for (let i = 1; i + 1 < clipped.length; i++)
        emit(clipped[0]!, clipped[i]!, clipped[i + 1]!);
    }
  }
  return new Float32Array(output);
}
