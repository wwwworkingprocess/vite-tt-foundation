import type { ResearchPolygon } from '../settlement/settlement-metadata.js';
import { preparePolygonQuery } from '../settlement/settlement-metadata-spatial.js';
import { distanceToCorridor } from './d3d-city-spatial.js';
import type { D3dWorldPoint } from './d3d-map-model.js';
export type FootprintPolygon = ResearchPolygon['coordinates'];
type Point = FootprintPolygon[number][number];
const world = (p: Point): D3dWorldPoint => ({ x: p[0], z: p[1] });
export function footprintRing(
  b: D3dWorldPoint & {
    readonly width: number;
    readonly depth: number;
    readonly rotation: number;
  },
): readonly Point[] {
  const cos = Math.cos(b.rotation),
    sin = Math.sin(b.rotation);
  const points = (
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const
  ).map(
    ([u, v]) =>
      [
        b.x + (u * b.width * cos) / 2 + (v * b.depth * sin) / 2,
        b.z - (u * b.width * sin) / 2 + (v * b.depth * cos) / 2,
      ] as const,
  );
  return [...points, points[0]!];
}
const contains = (p: Point, rings: FootprintPolygon) =>
  preparePolygonQuery({ type: 'Polygon', coordinates: rings })(p);
function touching(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  tolerance: number,
): boolean {
  // Disjoint segment envelopes cannot intersect or approach within tolerance.
  // Avoid projection objects and four distance queries for every remote polygon edge.
  if (
    Math.max(a[0], b[0]) + tolerance < Math.min(c[0], d[0]) ||
    Math.max(c[0], d[0]) + tolerance < Math.min(a[0], b[0]) ||
    Math.max(a[1], b[1]) + tolerance < Math.min(c[1], d[1]) ||
    Math.max(c[1], d[1]) + tolerance < Math.min(a[1], b[1])
  )
    return false;
  const cross = (p: Point, q: Point, r: Point) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  if (
    cross(a, b, c) * cross(a, b, d) < 0 &&
    cross(c, d, a) * cross(c, d, b) < 0
  )
    return true;
  const ab = { from: world(a), to: world(b), width: 0 },
    cd = { from: world(c), to: world(d), width: 0 };
  return (
    Math.min(
      distanceToCorridor(world(a), cd),
      distanceToCorridor(world(b), cd),
      distanceToCorridor(world(c), ab),
      distanceToCorridor(world(d), ab),
    ) <= tolerance
  );
}
type BoundaryEdge = readonly [Point, Point];
const boundaryQueries = new WeakMap<
  FootprintPolygon,
  (ring: readonly Point[], tolerance: number) => readonly BoundaryEdge[]
>();
/** Immutable polygon identity owns a conservative row index. Exact edge predicates
 * still decide every candidate; source rings and full-envelope semantics stay intact. */
function boundaryEdges(rings: FootprintPolygon) {
  let query = boundaryQueries.get(rings);
  if (query) return query;
  const edges: BoundaryEdge[] = [];
  let south = Infinity,
    north = -Infinity;
  for (const ring of rings)
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1]!,
        b = ring[i]!;
      edges.push([a, b]);
      south = Math.min(south, a[1], b[1]);
      north = Math.max(north, a[1], b[1]);
    }
  const count = Math.min(64, Math.ceil(Math.sqrt(edges.length))),
    step = (north - south) / count;
  const row = (z: number) =>
    Math.max(0, Math.min(count - 1, Math.floor((z - south) / step)));
  const buckets =
    edges.length >= 64 && step > 0
      ? Array.from({ length: count }, () => [] as BoundaryEdge[])
      : undefined;
  if (buckets)
    for (const edge of edges)
      for (
        let r = row(Math.min(edge[0][1], edge[1][1]));
        r <= row(Math.max(edge[0][1], edge[1][1]));
        r++
      )
        buckets[r]!.push(edge);
  query = (ring, tolerance) => {
    if (!buckets) return edges;
    let low = Infinity,
      high = -Infinity;
    for (const p of ring) {
      low = Math.min(low, p[1]);
      high = Math.max(high, p[1]);
    }
    const found = new Set<BoundaryEdge>();
    for (let r = row(low - tolerance); r <= row(high + tolerance); r++)
      for (const edge of buckets[r]!) found.add(edge);
    return [...found];
  };
  boundaryQueries.set(rings, query);
  return query;
}
function boundariesTouch(
  footprint: readonly Point[],
  rings: FootprintPolygon,
  tolerance: number,
): boolean {
  for (const [a, b] of boundaryEdges(rings)(footprint, tolerance))
    for (let j = 1; j < footprint.length; j++)
      if (touching(a, b, footprint[j - 1]!, footprint[j]!, tolerance))
        return true;
  return false;
}
/** Conservative full-envelope test: no corner-only shortcut, hole enclosure, edge touch or concave crossing. */
export function footprintInside(
  footprint: readonly Point[],
  rings: FootprintPolygon,
  tolerance: number,
): boolean {
  return (
    footprint.every((p) => contains(p, rings)) &&
    !boundariesTouch(footprint, rings, tolerance) &&
    !rings.slice(1).some((r) => contains(r[0]!, [footprint]))
  );
}
const polygonBounds = new WeakMap<FootprintPolygon, readonly number[]>();
export function footprintOverlaps(
  footprint: readonly Point[],
  rings: FootprintPolygon,
  tolerance: number,
): boolean {
  let bounds = polygonBounds.get(rings);
  if (!bounds) {
    const outer = rings[0]!;
    bounds = [
      Math.min(...outer.map((p) => p[0])),
      Math.max(...outer.map((p) => p[0])),
      Math.min(...outer.map((p) => p[1])),
      Math.max(...outer.map((p) => p[1])),
    ];
    polygonBounds.set(rings, bounds);
  }
  const margin = Math.max(tolerance, 1e-12);
  if (
    footprint.every((p) => p[0] < bounds[0]! - margin) ||
    footprint.every((p) => p[0] > bounds[1]! + margin) ||
    footprint.every((p) => p[1] < bounds[2]! - margin) ||
    footprint.every((p) => p[1] > bounds[3]! + margin)
  )
    return false;
  return (
    footprint.some((p) => contains(p, rings)) ||
    contains(rings[0]![0]!, [footprint]) ||
    boundariesTouch(footprint, rings, tolerance)
  );
}

/** Cell-local collision index; buckets contain whole envelopes, not only centers. */
export function createFootprintIndex(step: number, tolerance: number) {
  const polygons = new Map<string, FootprintPolygon>();
  const buckets = new Map<string, Set<string>>();
  return {
    add(id: string, footprint: FootprintPolygon[number]): boolean {
      const xs = footprint.map((p) => p[0]),
        zs = footprint.map((p) => p[1]),
        keys: string[] = [];
      for (
        let x = Math.floor((Math.min(...xs) - tolerance) / step);
        x <= Math.floor((Math.max(...xs) + tolerance) / step);
        x++
      )
        for (
          let z = Math.floor((Math.min(...zs) - tolerance) / step);
          z <= Math.floor((Math.max(...zs) + tolerance) / step);
          z++
        )
          keys.push(`${x}:${z}`);
      const neighbors = new Set(
        keys.flatMap((key) => [...(buckets.get(key) ?? [])]),
      );
      if (
        [...neighbors].some((other) =>
          footprintOverlaps(footprint, polygons.get(other)!, tolerance),
        )
      )
        return false;
      polygons.set(id, [footprint]);
      for (const key of keys) {
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = new Set();
          buckets.set(key, bucket);
        }
        bucket.add(id);
      }
      return true;
    },
  };
}
