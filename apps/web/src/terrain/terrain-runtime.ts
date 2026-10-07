import type { TerrainResolution } from './terrain-catalog.js';
export type TerrainCoastline = Readonly<{
  sourceViewportIds: readonly string[];
  features: readonly Readonly<{
    id: string;
    properties: Readonly<{
      kind: 'land' | 'coastline' | 'coverage-edge';
      clippedByCoverage: boolean;
      boundarySourceViewportIds: readonly string[];
    }>;
    geometry: Readonly<{
      type: 'Polygon' | 'MultiLineString';
      coordinates: readonly (readonly (readonly [number, number])[])[];
    }>;
  }>[];
}>;
export interface TerrainRuntime {
  readonly identity: string;
  readonly viewport: TerrainResolution['viewport'];
  readonly resolution: Readonly<{ x: number; y: number }>;
  readonly coastline: TerrainCoastline;
  readonly statistics: Readonly<{
    nativeSamples: number;
    landSamples: number;
    waterSamples: number;
    minElevation: number | null;
    maxElevation: number | null;
  }>;
  sample(row: number, column: number): number | null;
  classify(row: number, column: number): 'land' | 'water';
}
export interface TerrainProductDecoder {
  decode(
    products: Readonly<{
      height: unknown;
      surfaceMask: unknown;
      coastline: unknown;
    }>,
    resolution: TerrainResolution,
  ): TerrainRuntime;
}
export type TerrainSample =
  | Readonly<{ kind: 'land'; elevation: number }>
  | Readonly<{ kind: 'water' | 'outside' }>;
/** Bounds are cell coverage edges; native samples lie at half-cell centers.
 * Bilinear only when every positive-weight neighbor is LAND. At NoData boundaries
 * choose the nearest valid supporting sample; never average water/zero into land.
 */
export function sampleTerrain(
  terrain: TerrainRuntime,
  x: number,
  y: number,
): TerrainSample {
  const { rasterBounds3035: b, width, height } = terrain.viewport;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < b.west ||
    x > b.east ||
    y < b.south ||
    y > b.north
  )
    return Object.freeze({ kind: 'outside' });
  const col = Math.min(
    width - 1,
    Math.floor((x - b.west) / terrain.resolution.x),
  );
  const row = Math.min(
    height - 1,
    Math.floor((b.north - y) / terrain.resolution.y),
  );
  if (terrain.classify(row, col) === 'water')
    return Object.freeze({ kind: 'water' });
  const u = Math.max(
    0,
    Math.min(width - 1, (x - b.west) / terrain.resolution.x - 0.5),
  );
  const v = Math.max(
    0,
    Math.min(height - 1, (b.north - y) / terrain.resolution.y - 0.5),
  );
  const c0 = Math.floor(u),
    r0 = Math.floor(v);
  let total = 0,
    weight = 0,
    nearest = Infinity,
    nearestHeight = terrain.sample(row, col)!;
  let missing = false;
  for (const r of [r0, Math.min(height - 1, r0 + 1)])
    for (const c of [c0, Math.min(width - 1, c0 + 1)]) {
      const w =
        (c === c0 ? 1 - (u - c0) : u - c0) * (r === r0 ? 1 - (v - r0) : v - r0);
      if (w <= 0) continue;
      const value = terrain.sample(r, c);
      if (value === null) {
        missing = true;
        continue;
      }
      total += value * w;
      weight += w;
      const distance = (c - u) ** 2 + (r - v) ** 2;
      if (distance < nearest) {
        nearest = distance;
        nearestHeight = value;
      }
    }
  return Object.freeze({
    kind: 'land',
    elevation: missing ? nearestHeight : total / weight,
  });
}
export type TerrainGround = Readonly<{
  elevation: number;
  diagnostic: 'native' | 'nearest-land' | 'flat-fallback';
}>;
/** At most 5x5 native cells (two-cell radius); ties use row-major order.
 * Outside coverage never searches unrelated land. Fallback is explicit, not DEM.
 */
export function terrainGround(
  terrain: TerrainRuntime,
  x: number,
  y: number,
): TerrainGround {
  const sample = sampleTerrain(terrain, x, y);
  if (sample.kind === 'land')
    return Object.freeze({ elevation: sample.elevation, diagnostic: 'native' });
  if (sample.kind === 'water') {
    const { rasterBounds3035: b, width, height } = terrain.viewport;
    const col = Math.min(
        width - 1,
        Math.floor((x - b.west) / terrain.resolution.x),
      ),
      row = Math.min(
        height - 1,
        Math.floor((b.north - y) / terrain.resolution.y),
      );
    let distance = Infinity,
      nearest: number | null = null;
    for (let r = Math.max(0, row - 2); r <= Math.min(height - 1, row + 2); r++)
      for (
        let c = Math.max(0, col - 2);
        c <= Math.min(width - 1, col + 2);
        c++
      ) {
        const value = terrain.sample(r, c);
        const next =
          ((c + 0.5) * terrain.resolution.x + b.west - x) ** 2 +
          (b.north - (r + 0.5) * terrain.resolution.y - y) ** 2;
        if (value !== null && next < distance) {
          distance = next;
          nearest = value;
        }
      }
    if (nearest !== null)
      return Object.freeze({ elevation: nearest, diagnostic: 'nearest-land' });
  }
  return Object.freeze({ elevation: 0, diagnostic: 'flat-fallback' });
}
