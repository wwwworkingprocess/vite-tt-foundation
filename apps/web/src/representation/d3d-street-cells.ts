import { BufferAttribute, BufferGeometry } from 'three';
import { d3dProjectedPoint, type D3dMapModel } from './d3d-map-model.js';
import type { D3dTerrain } from './d3d-terrain-model.js';
import type { StreetCells } from './street-cells.js';
/** Display-only clearance above roads (+0.22m)/transit (+0.30m), not DEM or cell height.
 * Ground already includes 10x relief; this metre clearance is never exaggerated. */
export const streetCellBoundaryOffsetMetres = 0.5;
export const streetCellSupportMetres = 12.5;
export const streetCellSegmentBudget = 262144;

type Point = Readonly<{ x: number; z: number }>;

export type StreetCellPlan = Readonly<{
  positions: Float32Array;
  cells: number;
  rawEdges: number;
  uniqueEdges: number;
  displayEdges: number;
  displayedCells: number;
  rejectedCells: readonly Readonly<{ id: string; reason: 'non-drawable' }>[];
  segments: number;
  supports: number;
  vertices: number;
}>;
const cache = new WeakMap<
  StreetCells,
  WeakMap<D3dMapModel, WeakMap<D3dTerrain, StreetCellPlan>>
>();
/** Exact source A/B shared edges are deduplicated. C uses supplied safe zones,
 * not the former game inset; semantic polygons/IDs remain untouched. */
export function prepareD3dStreetCells(
  cells: StreetCells,
  map: D3dMapModel,
  terrain: D3dTerrain,
): StreetCellPlan {
  let maps = cache.get(cells);
  if (!maps) {
    maps = new WeakMap();
    cache.set(cells, maps);
  }
  let worlds = maps.get(map);
  if (!worlds) {
    worlds = new WeakMap();
    maps.set(map, worlds);
  }
  const previous = worlds.get(terrain);
  if (previous) return previous;
  if (!(terrain.metre > 0))
    throw new Error('StreetCell geometry support budget exceeded');
  const seen = new Set<string>();
  const edges: {
    a: Readonly<{ x: number; z: number }>;
    b: Readonly<{ x: number; z: number }>;
    count: number;
  }[] = [];
  const rejectedCells: { id: string; reason: 'non-drawable' }[] = [];
  let rawEdges = 0,
    segments = 0,
    displayedCells = 0;
  if (cells.level === 'C' && !cells.annotations)
    throw new Error('StreetCell missing C annotations');
  const displaySeen = new Set<string>();
  const edgeKey = (a: readonly number[], b: readonly number[]) => {
    const ka = JSON.stringify(a),
      kb = JSON.stringify(b);
    if (ka === kb) throw new Error('StreetCell degenerate edge');
    return ka < kb ? ka + '|' + kb : kb + '|' + ka;
  };
  for (const f of cells.features) {
    for (const ring of f.geometry.coordinates)
      for (let i = 1; i < ring.length; i++) {
        rawEdges++;
        seen.add(edgeKey(ring[i - 1]!, ring[i]!));
      }
    const annotation =
      cells.level === 'C' ? cells.annotations!.cells[f.id] : undefined;
    if (cells.level === 'C' && !annotation)
      throw new Error('StreetCell missing annotation');
    const rings = annotation
      ? annotation.safeZoneCoordinates
      : f.geometry.coordinates;
    if (rings === null) {
      rejectedCells.push(Object.freeze({ id: f.id, reason: 'non-drawable' }));
      continue;
    }
    displayedCells++;
    for (const ring of rings) {
      const points = ring.map((p) =>
        d3dProjectedPoint(map, { longitude: p[0], latitude: p[1] }),
      );
      for (let i = 1; i < ring.length; i++) {
        // V3 grid encoding can preserve coincident consecutive safe vertices.
        // Omit only their zero-length display segment; retain the semantic ring.
        if (ring[i - 1]![0] === ring[i]![0] && ring[i - 1]![1] === ring[i]![1])
          continue;
        const key = edgeKey(ring[i - 1]!, ring[i]!);
        if (displaySeen.has(key)) continue;
        displaySeen.add(key);
        const a = points[i - 1]!,
          b = points[i]!;
        const count = Math.ceil(
          Math.hypot(b.x - a.x, b.z - a.z) /
            (terrain.metre * streetCellSupportMetres),
        );
        if (count < 1) throw new Error('StreetCell degenerate projected edge');
        segments += count;
        if (!Number.isFinite(segments) || segments > streetCellSegmentBudget)
          throw new Error('StreetCell geometry support budget exceeded');
        edges.push({ a, b, count });
      }
    }
  }
  const positions = new Float32Array(segments * 6);
  let cursor = 0,
    supports = 0;
  const heights = new WeakMap<Point, number>();
  const sample = (x: number, z: number) => {
    supports++;
    return (
      terrain.ground(x, z).y + streetCellBoundaryOffsetMetres * terrain.metre
    );
  };
  const height = (p: Point) => {
    const previous = heights.get(p);
    if (previous !== undefined) return previous;
    const y = sample(p.x, p.z);
    heights.set(p, y);
    return y;
  };
  for (const { a, b, count } of edges) {
    let x = a.x,
      z = a.z,
      y = height(a);
    for (let i = 1; i <= count; i++) {
      positions[cursor++] = x;
      positions[cursor++] = y;
      positions[cursor++] = z;
      x = i === count ? b.x : a.x + ((b.x - a.x) * i) / count;
      z = i === count ? b.z : a.z + ((b.z - a.z) * i) / count;
      y = i === count ? height(b) : sample(x, z);
      positions[cursor++] = x;
      positions[cursor++] = y;
      positions[cursor++] = z;
    }
  }
  const plan = Object.freeze({
    positions,
    cells: cells.features.length,
    rawEdges,
    uniqueEdges: seen.size,
    displayEdges: edges.length,
    displayedCells,
    rejectedCells: Object.freeze(rejectedCells),
    segments,
    supports,
    vertices: segments * 2,
  });
  worlds.set(terrain, plan);
  return plan;
}
/** Each scene owns a fresh GPU geometry/attribute; shared CPU arrays are untouched. */
export function createStreetCellGeometry(plan: StreetCellPlan) {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(plan.positions, 3));
  g.computeBoundingSphere();
  return g;
}
