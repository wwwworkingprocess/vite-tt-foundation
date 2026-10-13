import { freezeSettlement } from '../settlement/settlement-metadata.js';
import { footprintOverlaps, type FootprintPolygon } from './d3d-footprint.js';
import type { StreetCellAssociation } from './street-cells.js';
export type StreetCellRoadGuide = Readonly<{
  roadId: string;
  sourceSegment: number;
  from: readonly [number, number];
  to: readonly [number, number];
  clearance: number;
  widthSource: string;
}>;
/** Derived reservations only. Circumscribed octagonal caps cover the full width
 * at joins/turns; no polygon subtraction or source geometry mutation is needed. */
export function planStreetCellRoads(
  roads: readonly StreetCellAssociation[],
  metadata: unknown,
  project: (point: readonly [number, number]) => {
    readonly x: number;
    readonly z: number;
  },
  metre: number,
) {
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata) ||
    !Number.isFinite(metre) ||
    metre <= 0
  )
    throw new Error('Invalid StreetCell road metadata');
  const guides: StreetCellRoadGuide[] = [],
    reservations: FootprintPolygon[] = [];
  const segments: (StreetCellRoadGuide & { readonly disposition: string })[] =
    [];
  const seen = new Set<string>();
  const sorted = [...roads].sort(
    (a, b) =>
      a.roadId.localeCompare(b.roadId) ||
      a.sourceSegment - b.sourceSegment ||
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
  );
  for (const road of sorted) {
    if (
      road.disposition === 'grade-separated' ||
      road.disposition === 'non-drawable-candidate' ||
      !road.clippedCoordinates
    )
      continue;
    const tag: unknown = Object.getOwnPropertyDescriptor(
      metadata,
      JSON.stringify(road.roadId),
    )?.value;
    if (!Array.isArray(tag) || tag.length !== 10)
      throw new Error('Missing StreetCell road width');
    if (tag[8] !== true) continue;
    const width: unknown = tag[9];
    const widthM: unknown = Array.isArray(width) ? width[0] : undefined;
    const widthSource: unknown = Array.isArray(width) ? width[1] : undefined;
    if (
      typeof widthM !== 'number' ||
      !Number.isFinite(widthM) ||
      widthM <= 0 ||
      typeof widthSource !== 'string' ||
      !['tag', 'inferred-lanes', 'class-fallback'].includes(widthSource)
    )
      throw new Error('Invalid StreetCell road width');
    const clearance = (widthM / 2 + 2) * metre;
    for (let i = 1; i < road.clippedCoordinates.length; i++) {
      const p = project(road.clippedCoordinates[i - 1]!),
        q = project(road.clippedCoordinates[i]!);
      const from = [p.x, p.z] as const,
        to = [q.x, q.z] as const,
        dx = q.x - p.x,
        dz = q.z - p.z,
        length = Math.hypot(dx, dz);
      if (length === 0) continue;
      const endpoints = [JSON.stringify(from), JSON.stringify(to)]
          .sort()
          .join('|'),
        key = `${endpoints}|${clearance}|${road.disposition}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const nx = (-dz / length) * clearance,
        nz = (dx / length) * clearance;
      const ring = [
        [p.x + nx, p.z + nz],
        [q.x + nx, q.z + nz],
        [q.x - nx, q.z - nz],
        [p.x - nx, p.z - nz],
        [p.x + nx, p.z + nz],
      ] as const;
      reservations.push([ring]);
      for (const point of [from, to]) {
        const radius = clearance / Math.cos(Math.PI / 8);
        const cap = Array.from(
          { length: 9 },
          (_, j) =>
            [
              point[0] +
                radius * Math.cos(((j % 8) * Math.PI) / 4 + Math.PI / 8),
              point[1] +
                radius * Math.sin(((j % 8) * Math.PI) / 4 + Math.PI / 8),
            ] as const,
        );
        reservations.push([cap]);
      }
      segments.push({
        roadId: road.roadId,
        sourceSegment: road.sourceSegment,
        from,
        to,
        clearance,
        widthSource,
        disposition: road.disposition,
      });
      if (road.disposition !== 'internal') continue;
      const last = guides.at(-1);
      if (
        last &&
        last.roadId === road.roadId &&
        last.clearance === clearance &&
        last.to[0] === from[0] &&
        last.to[1] === from[1]
      ) {
        const ux = last.to[0] - last.from[0],
          uz = last.to[1] - last.from[1];
        if (
          ux * dx + uz * dz > 0 &&
          Math.abs(ux * dz - uz * dx) <= 1e-8 * length * Math.hypot(ux, uz)
        ) {
          guides[guides.length - 1] = { ...last, to };
          continue;
        }
      }
      guides.push({
        roadId: road.roadId,
        sourceSegment: road.sourceSegment,
        from,
        to,
        clearance,
        widthSource,
      });
    }
  }
  // Bounded cell-local index avoids scanning hundreds of remote segments per lot.
  const buckets = new Map<string, Set<FootprintPolygon>>(),
    step = 50 * metre;
  const keys = (ring: FootprintPolygon[number]) => {
    const xs = ring.map((p) => p[0]),
      zs = ring.map((p) => p[1]),
      result: string[] = [];
    for (
      let x = Math.floor(Math.min(...xs) / step);
      x <= Math.floor(Math.max(...xs) / step);
      x++
    )
      for (
        let z = Math.floor(Math.min(...zs) / step);
        z <= Math.floor(Math.max(...zs) / step);
        z++
      )
        result.push(`${x}:${z}`);
    return result;
  };
  for (const r of reservations)
    for (const key of keys(r[0]!)) {
      const bucket = buckets.get(key) ?? new Set<FootprintPolygon>();
      bucket.add(r);
      buckets.set(key, bucket);
    }
  return freezeSettlement({
    guides,
    segments,
    reservationSegments: seen.size,
    conflicts: (ring: FootprintPolygon[number]) => {
      const neighbors = new Set(
        keys(ring).flatMap((k) => [...(buckets.get(k) ?? [])]),
      );
      return [...neighbors].some((r) =>
        footprintOverlaps(ring, r, 0.001 * metre),
      );
    },
  });
}
