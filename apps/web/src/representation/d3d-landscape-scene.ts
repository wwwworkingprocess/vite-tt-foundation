import type { StreetCells } from './street-cells.js';
import {
  d3dProjectedPoint,
  type D3dMapModel,
  type D3dLodBand,
} from './d3d-map-model.js';
import { planD3dTerrain, type D3dTerrain } from './d3d-terrain-model.js';
import type { ProceduralCity } from './d3d-city-model.js';
import type { CityMaterialization } from './city-materialization.js';
import type { MaterializationPlan } from './d3d-materialization.js';
import { prepareStreetCellMaskQueries } from './d3d-street-cell-masks.js';
import {
  footprintInside,
  footprintOverlaps,
  footprintRing,
  type FootprintPolygon,
} from './d3d-footprint.js';
import { planStreetCellRoads } from './d3d-street-cell-roads.js';
import { streetCellNativeLand } from './d3d-street-cell-city.js';
import {
  buildLandscapeLayout,
  selectLandscapeLod,
  type LandscapeLayout,
} from './d3d-landscape.js';
import {
  landscapeOverrides,
  landscapePolicy,
  type LandscapeOverrides,
} from './d3d-landscape-policy.js';
import { createTerrainCoverProjector } from './d3d-terrain-covers.js';
import { citySeed } from './d3d-city-spatial.js';
import { freezeSettlement } from '../settlement/settlement-metadata.js';
type Scene = Readonly<{
  cityId: string;
  cells: StreetCells;
  model: D3dMapModel;
  terrain: D3dTerrain;
  city: ProceduralCity;
  sites?: CityMaterialization | undefined;
  sitePlan?: MaterializationPlan | undefined;
  overrides?: LandscapeOverrides | undefined;
}>;
const noSites = Object.freeze({});
function polygonIndex<T>(
  items: readonly T[],
  rings: (item: T) => FootprintPolygon,
  step: number,
) {
  const bins = new Map<string, Set<T>>();
  const keys = (ring: FootprintPolygon[number]) => {
    const xs = ring.map((p) => p[0]),
      zs = ring.map((p) => p[1]),
      out: string[] = [];
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
        out.push(x + ':' + z);
    return out;
  };
  for (const item of items)
    for (const k of keys(rings(item)[0]!)) {
      const set = bins.get(k) ?? new Set<T>();
      set.add(item);
      bins.set(k, set);
    }
  return (ring: FootprintPolygon[number]) => [
    ...new Set(keys(ring).flatMap((k) => [...(bins.get(k) ?? [])])),
  ];
}
/** Read-only exact envelope predicates; C safe zones are reused solely as conservative road-clearance evidence. */
export function createLandscapeSafety(input: Scene) {
  const { cells, model, terrain, city, sites, sitePlan } = input,
    m = terrain.metre;
  const project = (p: readonly [number, number]) =>
    d3dProjectedPoint(model, { longitude: p[0], latitude: p[1] });
  const polygon = (rings: FootprintPolygon): FootprintPolygon =>
    rings.map((r) =>
      r.map((p) => {
        const v = project(p);
        return [v.x, v.z] as const;
      }),
    );
  const safe = Object.entries(cells.annotations?.cells ?? {}).flatMap(
    ([id, c]) =>
      c.safeZoneCoordinates
        ? [{ id, annotation: c, rings: polygon(c.safeZoneCoordinates) }]
        : [],
  );
  const nearbySafe = polygonIndex(safe, (s) => s.rings, 100 * m),
    roadPlans = new Map<string, ReturnType<typeof planStreetCellRoads>>();
  const water = cells.masks
    ? prepareStreetCellMaskQueries(cells.masks, model).features.filter(
        (mask) => mask.type === 0,
      )
    : [];
  const nearbyWater = polygonIndex(water, (mask) => mask.rings, 100 * m);
  const buildingRings = city.buildings.map((b) => [footprintRing(b)]);
  const nearbyBuildings = polygonIndex(buildingRings, (p) => p, 40 * m);
  const siteRings: FootprintPolygon[] =
    sites?.sites.flatMap((s) =>
      s.geometries.flatMap((g) => {
        const f = g.feature.geometry;
        return f.type === 'Polygon'
          ? [polygon(f.coordinates)]
          : f.type === 'MultiPolygon'
            ? f.coordinates.map(polygon)
            : [];
      }),
    ) ?? [];
  for (const i of sitePlan?.instances ?? []) siteRings.push([footprintRing(i)]);
  const nearbySites = polygonIndex(siteRings, (p) => p, 100 * m);
  const transport = city.corridors.map((c) => {
    const dx = c.to.x - c.from.x,
      dz = c.to.z - c.from.z;
    return [
      footprintRing({
        x: (c.from.x + c.to.x) / 2,
        z: (c.from.z + c.to.z) / 2,
        width: Math.hypot(dx, dz) + c.width,
        depth: c.width,
        rotation: -Math.atan2(dz, dx),
      }),
    ];
  });
  for (const p of [
    ...model.stops.map((s) => ({ ...s, radius: city.stopClearance })),
    ...(city.reservations ?? []),
  ])
    transport.push([
      footprintRing({
        x: p.x,
        z: p.z,
        width: p.radius * 2,
        depth: p.radius * 2,
        rotation: 0,
      }),
    ]);
  const nearbyTransport = polygonIndex(transport, (p) => p, 50 * m);
  return {
    metre: m,
    sample: (x: number, z: number) => {
      const g = terrain.ground(x, z);
      return {
        kind: terrain.sample(x, z).kind,
        native: g.diagnostic === 'native',
        y: g.y,
      };
    },
    reject: (ring: FootprintPolygon[number]): string | undefined => {
      if (!streetCellNativeLand(model, terrain, ring)) return 'native-surface';
      if (
        nearbyWater(ring).some((mask) =>
          footprintOverlaps(ring, mask.rings, 0.001 * m),
        )
      )
        return 'inland-water';
      if (nearbySites(ring).some((p) => footprintOverlaps(ring, p, 0.1 * m)))
        return 'site';
      if (
        nearbyBuildings(ring).some((p) => footprintOverlaps(ring, p, 0.3 * m))
      )
        return 'building';
      if (
        nearbyTransport(ring).some((p) => footprintOverlaps(ring, p, 0.3 * m))
      )
        return 'transport';
      for (const region of nearbySafe(ring)) {
        if (!footprintInside(ring, region.rings, 0.001 * m)) continue;
        let roads = roadPlans.get(region.id);
        if (!roads) {
          roads = planStreetCellRoads(
            region.annotation.roads,
            cells.annotations!.roadMetadata,
            project,
            m,
          );
          roadPlans.set(region.id, roads);
        }
        if (!roads.conflicts(ring)) return undefined;
      }
      return 'road';
    },
  };
}
export type LandscapeDetailPlan = Readonly<{
  identity: string;
  availability: string;
  instances: LandscapeLayout['instances'];
  triangles: number;
  gpuInstances: number;
  proposals: number;
  diagnostics: LandscapeLayout['diagnostics'];
  numericBytes: number;
  terrainIndexBytes: number;
  suppressedMasks: readonly string[];
  unsupportedSupports: Readonly<Record<string, number>>;
}>;
type CacheNode = {
  children: WeakMap<object, CacheNode>;
  layout?: LandscapeLayout;
  levels: Map<D3dLodBand, LandscapeDetailPlan>;
};
const root: CacheNode = { children: new WeakMap(), levels: new Map() };
/** Display-only support may be unavailable at a clipped/changed native face. Never invent a floating base. */
export function groundLandscapeInstances(
  instances: LandscapeLayout['instances'],
  height: (x: number, z: number) => number | undefined,
  clearance: number,
) {
  const unsupportedSupports: Record<string, number> = {};
  const grounded = instances.flatMap((i) => {
    const y = height(i.x, i.z);
    if (y === undefined) {
      unsupportedSupports[i.maskId] = (unsupportedSupports[i.maskId] ?? 0) + 1;
      return [];
    }
    return [{ ...i, y: y + clearance }];
  });
  return freezeSettlement({ instances: grounded, unsupportedSupports });
}
/** Weak identity cache: no frame, fleet, selection, palette or pan input. Colors cannot move an instance. */
export function prepareLandscapeDetails(
  input: Scene & Readonly<{ lod: D3dLodBand }>,
): LandscapeDetailPlan {
  if (input.cells.settlementId !== input.cityId || input.cells.level !== 'C')
    throw Error('Landscape C settlement/level mismatch');
  const { cells, model, terrain, city, sites, sitePlan, lod } = input,
    overrides = input.overrides ?? landscapeOverrides;
  let node = root;
  for (const key of [
    cells,
    model,
    terrain,
    city,
    sites ?? noSites,
    sitePlan ?? noSites,
    overrides,
  ]) {
    let next = node.children.get(key);
    if (!next) {
      next = { children: new WeakMap(), levels: new Map() };
      node.children.set(key, next);
    }
    node = next;
  }
  const previous = node.levels.get(lod);
  if (previous) return previous;
  const masks = cells.masks;
  const sources = new Set(
    sites?.sites.flatMap((s) =>
      s.geometries.map((g) => g.reference.sourceFeatureId),
    ),
  );
  const areas = masks
    ? prepareStreetCellMaskQueries(masks, model).features
    : [];
  const suppressedMasks = areas
    .filter((a) => sources.has(a.sourceId))
    .map((a) => a.id);
  if (lod !== 'far' && !node.layout)
    node.layout = buildLandscapeLayout(
      input.cityId,
      areas.filter((a) => !sources.has(a.sourceId)),
      createLandscapeSafety(input),
      overrides,
    );
  const layout =
    node.layout ??
    freezeSettlement({
      instances: [],
      triangles: 0,
      gpuInstances: 0,
      proposals: 0,
      diagnostics: [],
    });
  const selected = selectLandscapeLod(layout, lod);
  let indexBytes = 0;
  let instances = selected.instances;
  let unsupportedSupports: Readonly<Record<string, number>> = {};
  if (instances.length) {
    const regions = instances.map((i) => ({
      minX: i.x - i.width,
      maxX: i.x + i.width,
      minZ: i.z - i.depth,
      maxZ: i.z + i.depth,
    }));
    const projector = createTerrainCoverProjector(
      planD3dTerrain(terrain, { lod, representationMode: 'normal' }),
      50 * terrain.metre,
      regions,
    );
    indexBytes = projector.indexBytes;
    const grounded = groundLandscapeInstances(
      instances,
      (x, z) => projector.height(x, z),
      0.045 * terrain.metre,
    );
    instances = grounded.instances;
    unsupportedSupports = grounded.unsupportedSupports;
  }
  const instanceIds = citySeed(instances.map((i) => i.id).join('|'));
  const result = freezeSettlement({
    identity: [
      landscapePolicy.version,
      citySeed(
        layout.diagnostics
          .map((d) => d.maskId + ':' + d.variantId + ':' + d.seed)
          .join('|'),
      ),
      JSON.stringify(model.projection.bounds),
      input.cityId,
      masks?.sha256 ?? 'none',
      terrain.terrain.identity,
      terrain.verticalExaggeration,
      lod,
      instanceIds,
    ].join(':'),
    availability: masks?.availability ?? 'legacy',
    instances,
    triangles: instances.reduce(
      (n, i) => n + landscapePrototypeInfo[i.family].triangles,
      0,
    ),
    proposals: layout.proposals,
    diagnostics: layout.diagnostics,
    gpuInstances: instances.reduce(
      (n, i) => n + landscapePrototypeInfo[i.family].parts,
      0,
    ),
    numericBytes: instances.length * 8 * 8,
    terrainIndexBytes: indexBytes,
    suppressedMasks,
    unsupportedSupports,
  });
  node.levels.set(lod, result);
  return result;
}
import { landscapePrototypeInfo } from './d3d-landscape-geometry.js';
