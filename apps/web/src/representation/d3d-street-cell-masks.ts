import type { StreetCellMasks } from './street-cell-masks.js';
import { d3dProjectedPoint, type D3dMapModel } from './d3d-map-model.js';
import { footprintOverlaps, type FootprintPolygon } from './d3d-footprint.js';
import { preparePolygonQuery } from '../settlement/settlement-metadata-spatial.js';
import { freezeSettlement } from '../settlement/settlement-metadata.js';
export type ProjectedStreetCellMask = Readonly<{
  id: string;
  type: number;
  sourceId: string;
  areaSqm: number;
  rings: FootprintPolygon;
  contains: (point: readonly [number, number]) => boolean;
}>;
const cache = new WeakMap<
  StreetCellMasks,
  WeakMap<D3dMapModel, ReturnType<typeof projectMasks>>
>();
function projectMasks(masks: StreetCellMasks, model: D3dMapModel) {
  const features = masks.features.map((f): ProjectedStreetCellMask => {
    const rings = f.geometry.coordinates.map((r) =>
      r.map(([longitude, latitude]) => {
        const p = d3dProjectedPoint(model, { longitude, latitude });
        return [p.x, p.z] as const;
      }),
    );
    return {
      id: f.id,
      type: f.properties.t,
      sourceId: f.properties.src,
      areaSqm: f.properties.areaSqm,
      rings,
      contains: preparePolygonQuery({ type: 'Polygon', coordinates: rings }),
    };
  });
  const byId = new Map(features.map((f) => [f.id, f]));
  const byCell = new Map(
    Object.entries(masks.cellRefs).map(([cell, ids]) => [
      cell,
      Object.freeze(ids.map((id) => byId.get(id)!)),
    ]),
  );
  const remainders = new Map<
    string,
    {
      source: FootprintPolygon;
      area: number;
      result: Readonly<{
        safe: FootprintPolygon;
        estimate: ReturnType<typeof estimateStreetCellRemainder>;
      }>;
    }
  >();
  return freezeSettlement({
    features,
    forCell: (id: string) => byCell.get(id) ?? [],
    remainder: (id: string, source: FootprintPolygon, area: number) => {
      const previous = remainders.get(id);
      if (previous?.source === source && previous.area === area)
        return previous.result;
      const safe = source.map((r) =>
        r.map(([longitude, latitude]) => {
          const p = d3dProjectedPoint(model, { longitude, latitude });
          return [p.x, p.z] as const;
        }),
      );
      const result = freezeSettlement({
        safe,
        estimate: estimateStreetCellRemainder(safe, byCell.get(id) ?? [], area),
      });
      remainders.set(id, { source, area, result });
      return result;
    },
    conflicts: (
      id: string,
      ring: FootprintPolygon[number],
      tolerance: number,
    ) =>
      (byCell.get(id) ?? []).some((mask) =>
        footprintOverlaps(ring, mask.rings, tolerance),
      ),
  });
}
/** Projection identity is independent of palette, LOD, fleet and appearance research. */
export function prepareStreetCellMaskQueries(
  masks: StreetCellMasks,
  model: D3dMapModel,
) {
  let maps = cache.get(masks);
  if (!maps) {
    maps = new WeakMap();
    cache.set(masks, maps);
  }
  let result = maps.get(model);
  if (!result) {
    result = projectMasks(masks, model);
    maps.set(model, result);
  }
  return result;
}
/** Grid quadrature estimates capacity only. Full-envelope admission below is exact;
 * overlapping masks are sampled as a union, and holes remain unmasked. */
export function estimateStreetCellRemainder(
  safe: FootprintPolygon,
  masks: readonly ProjectedStreetCellMask[],
  safeAreaSqm: number,
) {
  const overlaps = masks.filter(
    (m) =>
      footprintOverlaps(safe[0]!, m.rings, 0) &&
      footprintOverlaps(m.rings[0]!, safe, 0),
  );
  if (!overlaps.length)
    return {
      maskIds: [],
      maskTypes: [],
      estimatedBuildableAreaSqm: safeAreaSqm,
      estimatedMaskedAreaSqm: 0,
    };
  const contains = preparePolygonQuery({ type: 'Polygon', coordinates: safe });
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const [x, z] of safe[0]!) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  // Each estimate reuses the same 32 sample rows. Compute crossings once per
  // polygon/row instead of rescanning all edges at every column. Boundary rows
  // and exact crossing hits retain the established point predicate.
  const rowQuery = (
    rings: FootprintPolygon,
    z: number,
    exact: (p: readonly [number, number]) => boolean,
  ) => {
    if (rings.some((r) => r.some((p) => Math.abs(p[1] - z) <= 1e-12)))
      return (x: number) => exact([x, z]);
    const crossings = rings.map((r) => {
      const xs: number[] = [];
      for (let i = 1; i < r.length; i++) {
        const a = r[i - 1]!,
          b = r[i]!;
        if (a[1] > z !== b[1] > z)
          xs.push(a[0] + ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]));
      }
      return xs;
    });
    return (x: number) => {
      if (crossings.some((xs) => xs.some((c) => Math.abs(c - x) <= 1e-12)))
        return exact([x, z]);
      const inside = (xs: number[]) => xs.filter((c) => x < c).length % 2 === 1;
      return inside(crossings[0]!) && !crossings.slice(1).some(inside);
    };
  };
  let total = 0,
    excluded = 0;
  for (let row = 0; row < 32; row++) {
    const z = minZ + ((row + 0.5) * (maxZ - minZ)) / 32;
    const inSafe = rowQuery(safe, z, contains);
    const inMasks = overlaps.map((m) => rowQuery(m.rings, z, m.contains));
    for (let col = 0; col < 32; col++) {
      const x = minX + ((col + 0.5) * (maxX - minX)) / 32;
      if (!inSafe(x)) continue;
      total++;
      if (inMasks.some((contains) => contains(x))) excluded++;
    }
  }
  const estimatedMaskedAreaSqm = total ? (safeAreaSqm * excluded) / total : 0;
  return {
    maskIds: overlaps.map((m) => m.id),
    maskTypes: [...new Set(overlaps.map((m) => m.type))],
    estimatedBuildableAreaSqm: safeAreaSqm - estimatedMaskedAreaSqm,
    estimatedMaskedAreaSqm,
  };
}
