import type { TerrainRuntime } from '../terrain/terrain-runtime.js';
import { sampleTerrain, terrainGround } from '../terrain/terrain-runtime.js';
import {
  geographicToTerrain,
  terrainToGeographic,
} from '../terrain/terrain-projection.js';
import {
  d3dGeographicPoint,
  d3dProjectedPoint,
  d3dMetreScale,
  type D3dMapModel,
  type D3dLodBand,
} from './d3d-map-model.js';
import type { ProceduralCity } from './d3d-city-model.js';
import type { RepresentationMode } from './representation-cadence.js';
export const terrainLayerOffsets = Object.freeze({
  route: 0.3,
  stop: 0.3,
  vehicle: 0.35,
  surface: 0.15,
  selection: 0.5,
}); // metres
export interface D3dTerrain {
  readonly terrain: TerrainRuntime;
  readonly metre: number;
  readonly step: number;
  readonly bounds: Readonly<{
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    minY: number;
    maxY: number;
  }>;
  worldPoint(x: number, y: number): Readonly<{ x: number; z: number }>;
  ground(
    x: number,
    z: number,
  ): Readonly<{
    y: number;
    diagnostic: 'native' | 'nearest-land' | 'flat-fallback';
  }>;
  sample(x: number, z: number): ReturnType<typeof sampleTerrain>;
}
const surfaceCorners = new WeakMap<TerrainRuntime, Float64Array>();
/** Lazy renderer support only; native heights/mask remain untouched. NaN marks
 * an uncomputed render corner, never DEM NoData. Shared across map transforms. */
function renderCorner(terrain: TerrainRuntime, col: number, row: number) {
  let values = surfaceCorners.get(terrain);
  const { width, height, rasterBounds3035: b } = terrain.viewport;
  if (!values) {
    values = new Float64Array((width + 1) * (height + 1)).fill(NaN);
    surfaceCorners.set(terrain, values);
  }
  const index = row * (width + 1) + col;
  if (Number.isNaN(values[index]))
    values[index] = terrainGround(
      terrain,
      b.west + col * terrain.resolution.x,
      b.north - row * terrain.resolution.y,
    ).elevation;
  return values[index]!;
}
/** Barycentric height of the exact native-center cell fan used by native near detail.
 * Native query APIs retain bilinear semantics; all D3D anchors share this rendered
 * surface so slight interpolation differences cannot bury transport geometry. */
function renderedGround(terrain: TerrainRuntime, x: number, y: number) {
  const sampled = terrainGround(terrain, x, y);
  if (sampled.diagnostic !== 'native') return sampled;
  const { width, height, rasterBounds3035: b } = terrain.viewport;
  const c = Math.min(
      width - 1,
      Math.floor((x - b.west) / terrain.resolution.x),
    ),
    r = Math.min(height - 1, Math.floor((b.north - y) / terrain.resolution.y));
  const u = (x - b.west) / terrain.resolution.x - c,
    v = (b.north - y) / terrain.resolution.y - r;
  const center = terrain.sample(r, c)!,
    nw = renderCorner(terrain, c, r),
    ne = renderCorner(terrain, c + 1, r),
    sw = renderCorner(terrain, c, r + 1),
    se = renderCorner(terrain, c + 1, r + 1);
  const elevation =
    v <= Math.min(u, 1 - u)
      ? center * 2 * v + nw * (1 - u - v) + ne * (u - v)
      : v >= Math.max(u, 1 - u)
        ? center * 2 * (1 - v) + sw * (v - u) + se * (v + u - 1)
        : u < 0.5
          ? center * 2 * u + nw * (1 - u - v) + sw * (v - u)
          : center * 2 * (1 - u) + ne * (u - v) + se * (u + v - 1);
  return Object.freeze({ elevation, diagnostic: 'native' as const });
}
export function createD3dTerrain(
  terrain: TerrainRuntime,
  model: D3dMapModel,
): D3dTerrain {
  let maps = worlds.get(terrain);
  if (!maps) {
    maps = new WeakMap();
    worlds.set(terrain, maps);
  }
  const previous = maps.get(model);
  if (previous) return previous;
  const metre = d3dMetreScale(model).worldUnitsPerMetre;
  const projected = (x: number, z: number) =>
    geographicToTerrain(d3dGeographicPoint(model, { x, z }));
  const worldPoint = (x: number, y: number) =>
    d3dProjectedPoint(model, terrainToGeographic({ x, y }));
  const { west, east, south, north } = terrain.viewport.rasterBounds3035;
  const corners = [
    [west, south],
    [west, north],
    [east, south],
    [east, north],
  ].map((p) => worldPoint(p[0]!, p[1]!));
  const world = Object.freeze({
    terrain,
    metre,
    step: Math.min(terrain.resolution.x, terrain.resolution.y) * metre,
    worldPoint,
    ground(x: number, z: number) {
      const p = projected(x, z),
        s = renderedGround(terrain, p.x, p.y);
      return Object.freeze({
        y: s.elevation * metre,
        diagnostic: s.diagnostic,
      });
    },
    sample(x: number, z: number) {
      const p = projected(x, z);
      return sampleTerrain(terrain, p.x, p.y);
    },
    bounds: Object.freeze({
      minX: Math.min(...corners.map((p) => p.x)),
      maxX: Math.max(...corners.map((p) => p.x)),
      minZ: Math.min(...corners.map((p) => p.z)),
      maxZ: Math.max(...corners.map((p) => p.z)),
      minY: (terrain.statistics.minElevation ?? 0) * metre,
      maxY: (terrain.statistics.maxElevation ?? 0) * metre,
    }),
  });
  maps.set(model, world);
  return world;
}
const worlds = new WeakMap<TerrainRuntime, WeakMap<D3dMapModel, D3dTerrain>>();
export type TerrainMeshPatch = Readonly<{
  id: string;
  cells: Readonly<{ col: number; row: number; endCol: number; endRow: number }>;
  kind: 'land' | 'water';
  positions: Float32Array;
  indices: Uint32Array;
}>;
export type TerrainMeshPlan = Readonly<{
  patches: readonly TerrainMeshPatch[];
  vertices: number;
  triangles: number;
  stride: number;
  lod: D3dLodBand;
}>;
const plans = new WeakMap<D3dTerrain, Map<string, TerrainMeshPlan>>();
/** Conservative display support at coarse zoom: a reduced triangle must not
 * rise above native-grounded anchors in valleys it cannot resolve. This lower
 * envelope only affects display vertices, never runtime samples or queries.
 * One native-cell halo includes support used by the native corner interpolation. */
function coarseSupport(
  terrain: TerrainRuntime,
  col: number,
  row: number,
  radius: number,
  initial: number,
) {
  let minimum = initial;
  const { width, height } = terrain.viewport;
  for (
    let r = Math.max(0, Math.floor(row - radius) - 1);
    r < Math.min(height, Math.ceil(row + radius) + 1);
    r++
  )
    for (
      let c = Math.max(0, Math.floor(col - radius) - 1);
      c < Math.min(width, Math.ceil(col + radius) + 1);
      c++
    ) {
      const elevation = terrain.sample(r, c);
      if (elevation !== null) minimum = Math.min(minimum, elevation);
    }
  return minimum;
}
/** Presentation-only density. Native queries and all entity anchors are independent
 * of the displayed stride. Near buffers cover at most 64 x 64 native cells. */
export function planD3dTerrain(
  world: D3dTerrain,
  options: Readonly<{
    representationMode: RepresentationMode;
    lod: D3dLodBand;
  }>,
): TerrainMeshPlan {
  const lod = options.representationMode === 'mini' ? 'far' : options.lod;
  const key = options.representationMode + ':' + lod;
  let modes = plans.get(world);
  if (!modes) {
    modes = new Map();
    plans.set(world, modes);
  }
  const previous = modes.get(key);
  if (previous) return previous;
  const { terrain, metre } = world,
    { width, height, rasterBounds3035: b } = terrain.viewport;
  const stride = lod === 'far' ? 8 : lod === 'medium' ? 4 : 1;
  const chunk = lod === 'near' ? 64 : Math.max(width, height);
  const patches: TerrainMeshPatch[] = [];
  for (let rowStart = 0; rowStart < height; rowStart += chunk)
    for (let colStart = 0; colStart < width; colStart += chunk)
      for (const kind of ['land', 'water'] as const) {
        const endCol = Math.min(width, colStart + chunk);
        const endRow = Math.min(height, rowStart + chunk);
        const positions: number[] = [],
          indices: number[] = [];
        const cornerWidth = endCol - colStart + 1;
        const corners = new Int32Array(
          cornerWidth * (endRow - rowStart + 1),
        ).fill(-1);
        const vertex = (col: number, row: number, elevation: number) => {
          const p = world.worldPoint(
            b.west + col * terrain.resolution.x,
            b.north - row * terrain.resolution.y,
          );
          const index = positions.length / 3;
          positions.push(p.x, elevation * metre, p.z);
          return index;
        };
        const corner = (col: number, row: number) => {
          const key = (row - rowStart) * cornerWidth + col - colStart;
          const existing = corners[key]!;
          if (existing >= 0) return existing;
          const native = kind === 'water' ? 0 : renderCorner(terrain, col, row);
          const h =
            kind === 'land' && stride > 1
              ? coarseSupport(terrain, col, row, stride, native)
              : native;
          const index = vertex(col, row, h);
          corners[key] = index;
          return index;
        };
        for (let row = rowStart; row < endRow; row += stride)
          for (let col = colStart; col < endCol; col += stride) {
            const colEnd = Math.min(endCol, col + stride),
              rowEnd = Math.min(endRow, row + stride);
            const c = Math.floor((col + colEnd - 1) / 2),
              r = Math.floor((row + rowEnd - 1) / 2);
            if (terrain.classify(r, c) !== kind) continue;
            const a = corner(col, row),
              b = corner(colEnd, row),
              c1 = corner(col, rowEnd),
              d = corner(colEnd, rowEnd);
            if (kind === 'water') indices.push(a, c1, b, b, c1, d);
            else {
              const center = vertex(
                c + 0.5,
                r + 0.5,
                stride === 1
                  ? terrain.sample(r, c)!
                  : coarseSupport(
                      terrain,
                      c + 0.5,
                      r + 0.5,
                      stride / 2,
                      terrain.sample(r, c)!,
                    ),
              );
              indices.push(
                a,
                center,
                b,
                b,
                center,
                d,
                d,
                center,
                c1,
                c1,
                center,
                a,
              );
            }
          }
        if (indices.length)
          patches.push(
            Object.freeze({
              id: kind + ':' + colStart + ':' + rowStart,
              cells: Object.freeze({
                col: colStart,
                row: rowStart,
                endCol,
                endRow,
              }),
              kind,
              positions: new Float32Array(positions),
              indices: new Uint32Array(indices),
            }),
          );
      }
  const plan = Object.freeze({
    patches: Object.freeze(patches),
    stride,
    lod,
    vertices: patches.reduce((n, p) => n + p.positions.length / 3, 0),
    triangles: patches.reduce((n, p) => n + p.indices.length / 3, 0),
  });
  modes.set(key, plan);
  return plan;
}
const cities = new WeakMap<
  ProceduralCity,
  WeakMap<D3dTerrain, ProceduralCity>
>();
/** Anchor-only placement preserves footprints, height, morphology, and LOD subsets. */
export function groundCity(
  city: ProceduralCity,
  world: D3dTerrain,
): ProceduralCity {
  let terrains = cities.get(city);
  if (!terrains) {
    terrains = new WeakMap();
    cities.set(city, terrains);
  }
  const previous = terrains.get(world);
  if (previous) return previous;
  const grounded = new Map(
    city.buildings.map((b) => [
      b,
      Object.freeze({ ...b, baseY: world.ground(b.x, b.z).y }),
    ]),
  );
  const subset = (list: ProceduralCity['buildings']) =>
    Object.freeze(list.map((b) => grounded.get(b)!));
  const result = Object.freeze({
    ...city,
    buildings: subset(city.buildings),
    far: subset(city.far),
    medium: subset(city.medium),
    mini: subset(city.mini),
  });
  terrains.set(world, result);
  return result;
}
