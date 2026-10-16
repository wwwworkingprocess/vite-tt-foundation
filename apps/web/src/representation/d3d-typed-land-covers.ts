import type { StreetCellMasks } from './street-cell-masks.js';
import type { D3dMapModel, D3dLodBand } from './d3d-map-model.js';
import type { D3dTerrain } from './d3d-terrain-model.js';
import type { CityMaterialization } from './city-materialization.js';
import { prepareStreetCellMaskQueries } from './d3d-street-cell-masks.js';
import { createTerrainCoverProjector } from './d3d-terrain-covers.js';
import { planD3dTerrain } from './d3d-terrain-model.js';
export const typedLandCoverPolicy = Object.freeze({
  triangles: 65_536,
  trianglesPerFeature: 8_192,
  clearanceMetres: 0.04,
  minimumAreaSqm: Object.freeze({ far: 1000, medium: 100, near: 0 }),
  // Draw all covers after native terrain, but before roads, buildings and sites.
  // No cover writes depth: later genuine scene objects always retain visibility.
  priority: Object.freeze([4, 5, 3, 2, 1, 0]),
});
export type TypedLandCoverPlan = Readonly<{
  identity: string;
  batches: readonly Readonly<{
    type: number;
    positions: Float32Array;
    renderOrder: number;
  }>[];
  triangles: number;
  bytes: number;
  features: number;
  suppressedBySites: readonly string[];
  belowAreaThreshold: number;
  outsideSupportTriangles: number;
  nativeWaterLandCoverTriangles: number;
  failures: readonly Readonly<{ id: string; message: string }>[];
}>;
const noSites = Object.freeze({});
const cache = new WeakMap<
  StreetCellMasks,
  WeakMap<
    D3dMapModel,
    WeakMap<D3dTerrain, WeakMap<object, Map<D3dLodBand, TypedLandCoverPlan>>>
  >
>();
/** One source polygon is considered once, independent of C associations. Source
 * holes and edges survive triangulation; visual faces alone clip to native coverage. */
export function prepareD3dTypedLandCovers(
  masks: StreetCellMasks,
  model: D3dMapModel,
  terrain: D3dTerrain,
  lod: D3dLodBand,
  sites?: CityMaterialization,
): TypedLandCoverPlan {
  let models = cache.get(masks);
  if (!models) {
    models = new WeakMap();
    cache.set(masks, models);
  }
  let terrains = models.get(model);
  if (!terrains) {
    terrains = new WeakMap();
    models.set(model, terrains);
  }
  let collections = terrains.get(terrain);
  if (!collections) {
    collections = new WeakMap();
    terrains.set(terrain, collections);
  }
  const siteKey = sites ?? noSites;
  let levels = collections.get(siteKey);
  if (!levels) {
    levels = new Map();
    collections.set(siteKey, levels);
  }
  const previous = levels.get(lod);
  if (previous) return previous;
  const siteSources = new Set(
    sites?.sites.flatMap((s) =>
      s.geometries.map((g) => g.reference.sourceFeatureId),
    ),
  );
  const chunks = new Map<number, Float32Array[]>(),
    suppressedBySites: string[] = [],
    failures: { id: string; message: string }[] = [];
  let triangles = 0,
    features = 0,
    belowAreaThreshold = 0,
    outsideSupportTriangles = 0,
    nativeWaterLandCoverTriangles = 0;
  const sources = [...prepareStreetCellMaskQueries(masks, model).features].sort(
    (a, b) => a.id.localeCompare(b.id),
  );
  const regions = sources
    .filter(
      (m) =>
        !siteSources.has(m.sourceId) &&
        m.areaSqm >= typedLandCoverPolicy.minimumAreaSqm[lod],
    )
    .map((m) => {
      const xs = m.rings[0]!.map((p) => p[0]),
        zs = m.rings[0]!.map((p) => p[1]);
      return {
        minX: Math.max(terrain.bounds.minX, Math.min(...xs)),
        maxX: Math.min(terrain.bounds.maxX, Math.max(...xs)),
        minZ: Math.max(terrain.bounds.minZ, Math.min(...zs)),
        maxZ: Math.min(terrain.bounds.maxZ, Math.max(...zs)),
      };
    })
    .filter((b) => b.minX < b.maxX && b.minZ < b.maxZ);
  let projector: ReturnType<typeof createTerrainCoverProjector> | undefined;
  for (const mask of sources) {
    if (siteSources.has(mask.sourceId)) {
      suppressedBySites.push(mask.id);
      continue;
    }
    if (mask.areaSqm < typedLandCoverPolicy.minimumAreaSqm[lod]) {
      belowAreaThreshold++;
      continue;
    }
    try {
      projector ??= createTerrainCoverProjector(
        planD3dTerrain(terrain, { lod, representationMode: 'normal' }),
        terrain.metre * 50,
        regions,
      );
      const positions = projector.project(
        [mask.rings],
        typedLandCoverPolicy.clearanceMetres * terrain.metre,
        Math.min(
          typedLandCoverPolicy.trianglesPerFeature,
          typedLandCoverPolicy.triangles - triangles,
        ),
        (a, b, c) => {
          const support = [a, b, c].map(([x, z]) => terrain.sample(x, z).kind);
          if (support.includes('outside')) {
            outsideSupportTriangles++;
            return false;
          }
          if (mask.type !== 0 && support.includes('water')) {
            nativeWaterLandCoverTriangles++;
            return false;
          }
          return true;
        },
        'Typed cover',
      );
      if (!positions.length) continue;
      const list = chunks.get(mask.type) ?? [];
      list.push(positions);
      chunks.set(mask.type, list);
      triangles += positions.length / 9;
      features++;
    } catch (error) {
      failures.push({ id: mask.id, message: String(error) });
    }
  }
  const batches = typedLandCoverPolicy.priority.flatMap((type, index) => {
    const list = chunks.get(type);
    if (!list) return [];
    const positions = new Float32Array(
      list.reduce((sum, c) => sum + c.length, 0),
    );
    let offset = 0;
    for (const c of list) {
      positions.set(c, offset);
      offset += c.length;
    }
    return [{ type, positions, renderOrder: -10 + index }];
  });
  const plan = Object.freeze({
    identity: [
      masks.sha256,
      masks.refsSha256,
      terrain.terrain.identity,
      terrain.verticalExaggeration,
      lod,
      JSON.stringify(model.projection.bounds),
    ].join(':'),
    batches: Object.freeze(batches),
    triangles,
    bytes: triangles * 9 * 4,
    features,
    suppressedBySites: Object.freeze(suppressedBySites),
    belowAreaThreshold,
    outsideSupportTriangles,
    nativeWaterLandCoverTriangles,
    failures: Object.freeze(failures),
  });
  levels.set(lod, plan);
  return plan;
}
