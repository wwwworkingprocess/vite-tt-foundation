import { ShapeUtils, Vector2 } from 'three';
import type { TerrainMeshPlan } from './d3d-terrain-model.js';
import type { FootprintPolygon } from './d3d-footprint.js';
import { footprintInside } from './d3d-footprint.js';
import { validateGeographicPolygon } from './geographic-polygon.js';
type Point = readonly [number, number];
type Bounds = Readonly<{
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}>;
const cross = (a: Point, b: Point, c: Point) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const bounds = (points: readonly Point[]): Bounds => ({
  minX: Math.min(...points.map((p) => p[0])),
  maxX: Math.max(...points.map((p) => p[0])),
  minZ: Math.min(...points.map((p) => p[1])),
  maxZ: Math.max(...points.map((p) => p[1])),
});
const disjoint = (a: Bounds, b: Bounds) =>
  a.maxX < b.minX || a.minX > b.maxX || a.maxZ < b.minZ || a.minZ > b.maxZ;
function triangulate(rings: FootprintPolygon) {
  const contour = rings[0]!.slice(0, -1).map((p) => new Vector2(...p)),
    holes = rings
      .slice(1)
      .map((r) => r.slice(0, -1).map((p) => new Vector2(...p))),
    vertices = [...contour, ...holes.flat()];
  return ShapeUtils.triangulateShape(contour, holes).map((face) =>
    face.map((i) => [vertices[i]!.x, vertices[i]!.y] as const),
  );
}
/** Clip to an existing convex terrain face. The input source rings stay untouched. */
function clip(points: readonly Point[], triangle: readonly Point[]) {
  let out = points;
  const sign = Math.sign(cross(triangle[0]!, triangle[1]!, triangle[2]!));
  for (let edge = 0; edge < 3; edge++) {
    const a = triangle[edge]!,
      b = triangle[(edge + 1) % 3]!,
      next: Point[] = [];
    for (let i = 0; i < out.length; i++) {
      const p = out[i]!,
        q = out[(i + 1) % out.length]!,
        fp = sign * cross(a, b, p),
        fq = sign * cross(a, b, q),
        ip = fp >= 0,
        iq = fq >= 0;
      if (ip) next.push(p);
      if (ip !== iq) {
        const t = fp / (fp - fq);
        next.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    out = next;
  }
  return out;
}
/** Temporary numeric broad-phase over the already displayed terrain. No new DEM
 * is built. Interior faces are reused; simple clipped contours are triangulated
 * once. Disconnected/touching clipped rings fall back to exact source-triangle
 * intersections, so a concavity or hole cannot acquire an artificial bridge. */
export function createTerrainCoverProjector(
  plan: Pick<TerrainMeshPlan, 'patches'>,
  step: number,
  regions: readonly Bounds[],
) {
  const active = new Set<string>();
  const range = {
    minX: Infinity,
    maxX: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
  };
  for (const b of regions) {
    range.minX = Math.min(range.minX, Math.floor(b.minX / step));
    range.maxX = Math.max(range.maxX, Math.floor(b.maxX / step));
    range.minZ = Math.min(range.minZ, Math.floor(b.minZ / step));
    range.maxZ = Math.max(range.maxZ, Math.floor(b.maxZ / step));
  }
  for (const b of regions)
    for (let x = Math.floor(b.minX / step); x <= Math.floor(b.maxX / step); x++)
      for (
        let z = Math.floor(b.minZ / step);
        z <= Math.floor(b.maxZ / step);
        z++
      )
        active.add(x + ':' + z);
  const records: number[] = [],
    buckets = new Map<string, number[]>();
  plan.patches.forEach((patch, pi) => {
    const p = patch.positions,
      ids = patch.indices;
    for (let offset = 0; offset < ids.length; offset += 3) {
      const a = ids[offset]! * 3,
        b = ids[offset + 1]! * 3,
        c = ids[offset + 2]! * 3;
      const ax = p[a]!,
        az = p[a + 2]!,
        bx = p[b]!,
        bz = p[b + 2]!,
        cx = p[c]!,
        cz = p[c + 2]!;
      if (Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) < 1e-15)
        continue;
      let id: number | undefined;
      for (
        let x = Math.floor(Math.min(ax, bx, cx) / step);
        x <= Math.floor(Math.max(ax, bx, cx) / step);
        x++
      )
        for (
          let z = Math.floor(Math.min(az, bz, cz) / step);
          z <= Math.floor(Math.max(az, bz, cz) / step);
          z++
        ) {
          const key = x + ':' + z;
          if (!active.has(key)) continue;
          if (id === undefined) {
            id = records.length / 2;
            records.push(pi, offset);
          }
          const bucket = buckets.get(key) ?? [];
          bucket.push(id);
          buckets.set(key, bucket);
        }
    }
  });
  const faces = new Uint32Array(records),
    rows = new Map([...buckets].map(([k, v]) => [k, new Uint32Array(v)]));
  return Object.freeze({
    faces: faces.length / 2,
    indexBytes:
      faces.byteLength +
      [...rows.values()].reduce((n, r) => n + r.byteLength, 0),
    project(
      polygons: readonly FootprintPolygon[],
      clearance: number,
      maxTriangles: number,
      accept: (a: Point, b: Point, c: Point) => boolean,
      label: string,
    ) {
      const output: number[] = [];
      let emitted = 0,
        visited = 0;
      const work = () => {
        if (++visited > maxTriangles * 32)
          throw new Error(label + ' triangle budget exceeded');
      };
      for (const rings of polygons) {
        const sourceTriangles = triangulate(rings).map((points) => ({
            points,
            bounds: bounds(points),
          })),
          b = bounds(rings[0]!),
          seen = new Set<number>();
        for (
          let x = Math.max(range.minX, Math.floor(b.minX / step));
          x <= Math.min(range.maxX, Math.floor(b.maxX / step));
          x++
        )
          for (
            let z = Math.max(range.minZ, Math.floor(b.minZ / step));
            z <= Math.min(range.maxZ, Math.floor(b.maxZ / step));
            z++
          ) {
            work();
            for (const id of rows.get(x + ':' + z) ?? []) {
              if (seen.has(id)) continue;
              seen.add(id);
              work();
              const patch = plan.patches[faces[id * 2]!]!,
                offset = faces[id * 2 + 1]!,
                p = patch.positions;
              const indices = [
                  patch.indices[offset]! * 3,
                  patch.indices[offset + 1]! * 3,
                  patch.indices[offset + 2]! * 3,
                ],
                triangle = indices.map((i) => [p[i]!, p[i + 2]!] as const),
                box = bounds(triangle);
              if (disjoint(b, box)) continue;
              const a = triangle[0]!,
                bb = triangle[1]!,
                c = triangle[2]!,
                denominator = cross(a, bb, c);
              const height = (point: Point) => {
                const u = cross(point, bb, c) / denominator,
                  v = cross(a, point, c) / denominator;
                return (
                  u * p[indices[0]! + 1]! +
                  v * p[indices[1]! + 1]! +
                  (1 - u - v) * p[indices[2]! + 1]! +
                  clearance
                );
              };
              const emit = (a: Point, b: Point, c: Point) => {
                const area = cross(a, b, c);
                if (Math.abs(area) < 1e-15 || !accept(a, b, c)) return;
                if (emitted >= maxTriangles)
                  throw new Error(label + ' triangle budget exceeded');
                for (const point of area > 0 ? [a, c, b] : [a, b, c])
                  output.push(point[0], height(point), point[1]);
                emitted++;
              };
              if (footprintInside([...triangle, triangle[0]!], rings, 0)) {
                emit(a, bb, c);
                continue;
              }
              let clippedTriangles: Point[][] | undefined;
              try {
                const clipped = rings.map((r) =>
                  clip(r.slice(0, -1), triangle).filter(
                    (p, i, all) =>
                      i === 0 ||
                      Math.hypot(p[0] - all[i - 1]![0], p[1] - all[i - 1]![1]) >
                        1e-12,
                  ),
                );
                if (clipped[0]!.length < 3) continue;
                const closed = clipped
                  .filter((r, i) => i === 0 || r.length >= 3)
                  .map((r) => [...r, r[0]!]);
                validateGeographicPolygon(closed);
                clippedTriangles = triangulate(closed);
              } catch {
                // A disconnected concavity or hole cut open by a native face is not
                // a new polygon. Use the original validated source triangulation.
              }
              if (clippedTriangles) {
                for (const t of clippedTriangles) emit(t[0]!, t[1]!, t[2]!);
              } else
                for (const source of sourceTriangles) {
                  work();
                  if (disjoint(source.bounds, box)) continue;
                  const clipped = clip(source.points, triangle);
                  for (let i = 1; i + 1 < clipped.length; i++)
                    emit(clipped[0]!, clipped[i]!, clipped[i + 1]!);
                }
            }
          }
      }
      return new Float32Array(output);
    },
  });
}
