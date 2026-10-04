import {
  citySeed as hash,
  distanceToCorridor,
  type UrbanCorridor,
} from './d3d-city-spatial.js';
export { distanceToCorridor } from './d3d-city-spatial.js';
import type { ScenarioPopulationView } from '../population/population-field-loader.js';
import {
  d3dWorldPoint,
  d3dMetreScale,
  type D3dMapModel,
  type D3dWorldPoint,
  type D3dLodBand,
} from './d3d-map-model.js';
import { projectTransportMapPoint } from './transport-map-projection.js';
import type { RepresentationMode } from './representation-cadence.js';
import { semanticBuildingArchetypes } from '../settlement/settlement-metadata.js';
import type { SettlementMetadataView } from '../settlement/settlement-metadata-loader.js';
import {
  enrichSettlementPopulation,
  type SettlementPopulationOverlay,
} from '../settlement/settlement-population-overlay.js';
import { generateMetadataCity } from './d3d-metadata-city.js';

export const buildingArchetypes = semanticBuildingArchetypes;
export type BuildingArchetype = (typeof buildingArchetypes)[number];
export type { UrbanCorridor } from './d3d-city-spatial.js';
export type CityBounds = Readonly<{
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}>;
type Tile = Readonly<{ r: number; c: number; density: number }>;
export type GeneratedSettlementComponent = Readonly<{
  id: string;
  tiles: readonly Tile[];
}>;
export type UrbanBlock = CityBounds &
  Readonly<{
    id: string;
    componentId: string;
    density: number;
    zoneId?: string;
    urbanProfileId?: string;
    widthM?: number;
    depthM?: number;
    layoutRow?: number;
    layoutColumn?: number;
  }>;
export type CityBuilding = D3dWorldPoint &
  Readonly<{
    id: string;
    blockId: string;
    width: number;
    depth: number;
    rotation: number;
    archetype: BuildingArchetype;
    storeys: number;
    height: number;
    baseY: number;
    wallVariant: number;
    roofVariant: number;
    density: number;
    zoneId?: string;
    buildingProfileId?: string;
    wallColor?: string;
    roofColor?: string;
  }>;
export type ProceduralCity = Readonly<{
  bounds: CityBounds;
  cellWidth: number;
  cellDepth: number;
  storeyHeight: number;
  stopClearance: number;
  corridors: readonly UrbanCorridor[];
  components: readonly GeneratedSettlementComponent[];
  blocks: readonly UrbanBlock[];
  ground: readonly (CityBounds & { readonly density: number })[];
  buildings: readonly CityBuilding[];
  far: readonly CityBuilding[];
  medium: readonly CityBuilding[];
  mini: readonly CityBuilding[];
  settlement?: SettlementPopulationOverlay;
  localStreets?: readonly UrbanCorridor[];
  reservations?: readonly (D3dWorldPoint & {
    readonly id: string;
    readonly radius: number;
  })[];
  landscapes?: readonly Readonly<{
    color: string;
    surfaceY?: number;
    rings: readonly (readonly D3dWorldPoint[])[];
  }>[];
}>;
type Population = Pick<
  ScenarioPopulationView,
  'grid' | 'crop' | 'canonicalCells'
>;
const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

/** Source adapter only. Collinear shared/reverse service edges reserve one street. */
export function buildUrbanCorridors(
  edges: readonly Pick<UrbanCorridor, 'from' | 'to'>[],
  width: number,
): readonly UrbanCorridor[] {
  const corridors: UrbanCorridor[] = [];
  const ordered = edges
    .map((edge) =>
      edge.from.x < edge.to.x ||
      (edge.from.x === edge.to.x && edge.from.z <= edge.to.z)
        ? edge
        : { from: edge.to, to: edge.from },
    )
    .sort(
      (a, b) =>
        a.from.x - b.from.x ||
        a.from.z - b.from.z ||
        a.to.x - b.to.x ||
        a.to.z - b.to.z,
    );
  for (const edge of ordered) {
    const length = Math.hypot(edge.to.x - edge.from.x, edge.to.z - edge.from.z);
    if (length < 1e-8) continue;
    let next = { ...edge, width };
    for (let i = corridors.length - 1; i >= 0; i--) {
      const old = corridors[i]!;
      const dx =
        (next.to.x - next.from.x) /
        Math.hypot(next.to.x - next.from.x, next.to.z - next.from.z);
      const dz =
        (next.to.z - next.from.z) /
        Math.hypot(next.to.x - next.from.x, next.to.z - next.from.z);
      const cross = (p: D3dWorldPoint) =>
        Math.abs((p.x - next.from.x) * dz - (p.z - next.from.z) * dx);
      const along = (p: D3dWorldPoint) =>
        (p.x - next.from.x) * dx + (p.z - next.from.z) * dz;
      const a = along(old.from),
        b = along(old.to),
        end = along(next.to);
      if (
        cross(old.from) < 1e-7 &&
        cross(old.to) < 1e-7 &&
        Math.max(a, b) >= -1e-7 &&
        Math.min(a, b) <= end + 1e-7
      ) {
        const points = [next.from, next.to, old.from, old.to].sort(
          (a, b) => along(a) - along(b),
        );
        next = { from: points[0]!, to: points[3]!, width };
        corridors.splice(i, 1);
      }
    }
    corridors.push(next);
  }
  return freeze(
    corridors.map((road) => ({
      ...road,
      from: { ...road.from },
      to: { ...road.to },
    })),
  );
}

export function populationSpace(model: D3dMapModel, population: Population) {
  // Runtime grids are cropped, while source-cell row/column identities remain canonical.
  const croppedRows =
    population.grid.rows === population.crop.rowEnd - population.crop.rowStart;
  const croppedColumns =
    population.grid.columns ===
    population.crop.columnEnd - population.crop.columnStart;
  const origin = {
    latitude:
      population.grid.originCellCenter.latitude +
      (croppedRows ? population.crop.rowStart : 0) *
        population.grid.resolutionDegrees,
    longitude:
      population.grid.originCellCenter.longitude -
      (croppedColumns ? population.crop.columnStart : 0) *
        population.grid.resolutionDegrees,
  };
  const resolution = population.grid.resolutionDegrees;
  const point = (r: number, c: number) =>
    d3dWorldPoint(
      model.bounds,
      projectTransportMapPoint(model.projection.bounds, {
        latitude: origin.latitude - r * resolution,
        longitude: origin.longitude + c * resolution,
      }),
    );
  const nw = point(-0.5, -0.5);
  const se = point(0.5, 0.5);
  const cellWidth = se.x - nw.x,
    cellDepth = se.z - nw.z;
  const a = point(
    population.crop.rowStart - 0.5,
    population.crop.columnStart - 0.5,
  );
  const b = point(
    population.crop.rowEnd - 0.5,
    population.crop.columnEnd - 0.5,
  );
  return {
    nw,
    cellWidth,
    cellDepth,
    bounds: {
      minX: Math.min(-model.bounds.width / 2, a.x),
      maxX: Math.max(model.bounds.width / 2, b.x),
      minZ: Math.min(-model.bounds.depth / 2, a.z),
      maxZ: Math.max(model.bounds.depth / 2, b.z),
    },
  };
}

const cache = new WeakMap<D3dMapModel, WeakMap<object, ProceduralCity>>();
const metadataCache = new WeakMap<
  D3dMapModel,
  WeakMap<object, WeakMap<object, Map<string, ProceduralCity>>>
>();
export function buildProceduralCity(
  model: D3dMapModel,
  population: Population,
  metadata?: SettlementMetadataView,
): ProceduralCity {
  if (metadata?.status === 'ready') {
    let byPopulation = metadataCache.get(model);
    if (!byPopulation) {
      byPopulation = new WeakMap();
      metadataCache.set(model, byPopulation);
    }
    let byMetadata = byPopulation.get(population);
    if (!byMetadata) {
      byMetadata = new WeakMap();
      byPopulation.set(population, byMetadata);
    }
    let byHash = byMetadata.get(metadata.metadata);
    if (!byHash) {
      byHash = new Map();
      byMetadata.set(metadata.metadata, byHash);
    }
    const previous = byHash.get(metadata.sha256);
    if (previous) return previous;
    const overlay = enrichSettlementPopulation(population, metadata.metadata);
    const corridors = buildUrbanCorridors(
      model.routes,
      12 * d3dMetreScale(model).worldUnitsPerMetre,
    );
    // Generate generic parcels only for research gaps, retaining the full crop extent.
    const generic = generateUrbanCity(
      model,
      {
        ...population,
        canonicalCells: overlay.cells
          .filter(
            (cell) => cell.zoneId === undefined && cell.buildability !== 'none',
          )
          .map((cell) => cell.cell),
      },
      corridors,
      model.stops,
    );
    const city = generateMetadataCity(model, overlay, generic);
    byHash.set(metadata.sha256, city);
    return city;
  }
  const previous = cache.get(model)?.get(population);
  if (previous) return previous;
  const space = populationSpace(model, population);
  const corridors = buildUrbanCorridors(
    model.routes,
    Math.min(space.cellWidth, space.cellDepth) * 0.24,
  );
  const city = generateUrbanCity(model, population, corridors, model.stops);
  let byPopulation = cache.get(model);
  if (!byPopulation) {
    byPopulation = new WeakMap();
    cache.set(model, byPopulation);
  }
  byPopulation.set(population, city);
  return city;
}

/** Pure source-independent layout; no fleet, camera, time or renderer enters this boundary. */
export function generateUrbanCity(
  model: D3dMapModel,
  population: Population,
  corridors: readonly UrbanCorridor[],
  stops: readonly D3dWorldPoint[],
): ProceduralCity {
  const { nw, cellWidth, cellDepth, bounds } = populationSpace(
    model,
    population,
  );
  const unit = Math.min(cellWidth, cellDepth);
  const stopClearance = Math.max(0.85, unit * 0.55);
  const stepX = cellWidth / 3,
    stepZ = cellDepth / 3;
  const key = (r: number, c: number) => `${r}:${c}`;
  const cells = new Map(
    population.canonicalCells.map((cell) => [
      key(cell.row, cell.column),
      cell.populationWeight,
    ]),
  );
  const maximum = [...cells.values()].reduce((a, b) => Math.max(a, b), 1);
  const densityAt = (r: number, c: number) => {
    let total = 0,
      support = 0;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const weight = cells.get(key(r + dr, c + dc)) ?? 0;
        total += weight;
        if (weight > 0) support++;
      }
    return Math.pow(total / (9 * maximum), 0.45) * (0.6 + (0.4 * support) / 9);
  };
  const center = (r: number, c: number) => ({
    x: nw.x + (c + 0.5) * stepX,
    z: nw.z + (r + 0.5) * stepZ,
  });
  const tiles = new Map<string, Tile>();
  // Conservative microtile reservation prevents components from bridging a street.
  for (const cell of [...population.canonicalCells].sort(
    (a, b) => a.row - b.row || a.column - b.column,
  )) {
    const density = densityAt(cell.row, cell.column);
    for (let dr = 0; dr < 3; dr++)
      for (let dc = 0; dc < 3; dc++) {
        const r = cell.row * 3 + dr,
          c = cell.column * 3 + dc;
        const p = center(r, c);
        if (
          corridors.some(
            (road) =>
              distanceToCorridor(p, road) <
              road.width / 2 + Math.hypot(stepX, stepZ) / 2,
          )
        )
          continue;
        tiles.set(key(r, c), { r, c, density });
      }
  }
  const components: GeneratedSettlementComponent[] = [];
  const remaining = new Map(tiles);
  for (const [start, tile] of tiles) {
    if (!remaining.delete(start)) continue;
    const connected: Tile[] = [tile];
    for (let i = 0; i < connected.length; i++) {
      const next = connected[i]!;
      for (const [r, c] of [
        [next.r - 1, next.c],
        [next.r + 1, next.c],
        [next.r, next.c - 1],
        [next.r, next.c + 1],
      ] as const) {
        const neighbor = remaining.get(key(r, c));
        if (neighbor) {
          remaining.delete(key(r, c));
          connected.push(neighbor);
        }
      }
    }
    components.push({ id: `zone-${start}`, tiles: connected });
  }
  const blocks: UrbanBlock[] = [];
  const ground: (CityBounds & { density: number })[] = [];
  const buildings: CityBuilding[] = [];
  const subdivide = (
    componentId: string,
    subset: readonly Tile[],
    id: string,
  ) => {
    const minR = subset.reduce((a, t) => Math.min(a, t.r), Infinity),
      maxR = subset.reduce((a, t) => Math.max(a, t.r), -Infinity) + 1;
    const minC = subset.reduce((a, t) => Math.min(a, t.c), Infinity),
      maxC = subset.reduce((a, t) => Math.max(a, t.c), -Infinity) + 1;
    const density =
      subset.reduce((sum, t) => sum + t.density, 0) / subset.length;
    const limit = density > 0.55 ? 9 : 12;
    if (maxR - minR > limit || maxC - minC > limit) {
      const horizontal = maxC - minC >= maxR - minR;
      const cut = Math.floor((horizontal ? minC + maxC : minR + maxR) / 2);
      subdivide(
        componentId,
        subset.filter((t) => (horizontal ? t.c : t.r) < cut),
        `${id}a`,
      );
      subdivide(
        componentId,
        subset.filter((t) => (horizontal ? t.c : t.r) >= cut),
        `${id}b`,
      );
      return;
    }
    const block: UrbanBlock = {
      id,
      componentId,
      density,
      minX: nw.x + minC * stepX,
      maxX: nw.x + maxC * stepX,
      minZ: nw.z + minR * stepZ,
      maxZ: nw.z + maxR * stepZ,
    };
    blocks.push(block);
    const buildable = new Set(subset.map((t) => key(t.r, t.c)));
    // Greedy rectangles retain support holes and corridor gaps without a visible cell lattice.
    const paving = new Set(buildable);
    for (const tile of [...subset].sort((a, b) => a.r - b.r || a.c - b.c)) {
      if (!paving.has(key(tile.r, tile.c))) continue;
      let endC = tile.c + 1,
        endR = tile.r + 1;
      while (paving.has(key(tile.r, endC))) endC++;
      while (
        Array.from({ length: endC - tile.c }, (_, i) =>
          paving.has(key(endR, tile.c + i)),
        ).every(Boolean)
      )
        endR++;
      for (let r = tile.r; r < endR; r++)
        for (let c = tile.c; c < endC; c++) paving.delete(key(r, c));
      ground.push({
        minX: nw.x + tile.c * stepX,
        maxX: nw.x + endC * stepX,
        minZ: nw.z + tile.r * stepZ,
        maxZ: nw.z + endR * stepZ,
        density,
      });
    }
    const seed = hash(`${population.grid.cityId}:${id}`);
    const gap = unit * 0.13;
    const spacingX = unit * (density > 0.55 ? 1.05 : 0.8);
    const spacingZ = unit * (density > 0.55 ? 0.92 : 0.75);
    const firstBuilding = buildings.length;
    let index = 0;
    for (
      let z = block.minZ + unit * 0.38;
      z < block.maxZ - unit * 0.3;
      z += spacingZ
    ) {
      for (
        let x = block.minX + unit * (0.35 + ((index + seed) % 3) * 0.1);
        x < block.maxX - unit * 0.3;
        x += spacingX
      ) {
        const variation = hash(
          `${id}:${index++}:${population.grid.gridVersion}`,
        );
        const p = {
          x: x + ((variation % 13) / 12 - 0.5) * unit * 0.15,
          z: z + ((variation % 11) / 10 - 0.5) * unit * 0.13,
        };
        const row = Math.floor((p.z - nw.z) / cellDepth),
          column = Math.floor((p.x - nw.x) / cellWidth);
        const local = densityAt(row, column);
        if ((variation % 100) / 100 > 0.4 + local * 0.6) continue;
        let nearest: UrbanCorridor | undefined;
        let nearestDistance = Infinity;
        for (const corridor of corridors) {
          const distance = distanceToCorridor(p, corridor);
          if (distance < nearestDistance) {
            nearest = corridor;
            nearestDistance = distance;
          }
        }
        const rotation =
          nearest && nearestDistance < unit * 3
            ? Math.atan2(
                nearest.to.x - nearest.from.x,
                nearest.to.z - nearest.from.z,
              ) +
              Math.PI / 2
            : (((seed % 5) - 2) * Math.PI) / 30 +
              ((variation % 2) * Math.PI) / 2;
        const band = local < 0.28 ? 0 : local < 0.5 ? 1 : local < 0.7 ? 2 : 3;
        const choices: readonly BuildingArchetype[][] = [
          ['detached-house', 'detached-house', 'terrace-row'],
          ['detached-house', 'terrace-row', 'corner-l'],
          ['terrace-row', 'midrise-slab', 'corner-l'],
          ['midrise-slab', 'corner-l', 'courtyard-u'],
        ];
        const archetype = choices[band]![variation % 3]!;
        const elongated =
          archetype === 'terrace-row' || archetype === 'midrise-slab';
        const width =
          unit * (elongated ? 0.69 : 0.49) * (0.9 + (variation % 7) / 35);
        const depth =
          unit * (elongated ? 0.3 : 0.46) * (0.9 + (variation % 5) / 30);
        const radius = Math.hypot(width, depth) / 2;
        if (
          p.x - radius < block.minX + gap ||
          p.x + radius > block.maxX - gap ||
          p.z - radius < block.minZ + gap ||
          p.z + radius > block.maxZ - gap
        )
          continue;
        // Reserve entire parcel envelope, including gaps, inside this support component.
        let supported = true;
        for (
          let r = Math.floor((p.z - radius - nw.z) / stepZ);
          r <= Math.floor((p.z + radius - nw.z) / stepZ);
          r++
        )
          for (
            let c = Math.floor((p.x - radius - nw.x) / stepX);
            c <= Math.floor((p.x + radius - nw.x) / stepX);
            c++
          ) {
            if (!buildable.has(key(r, c))) supported = false;
          }
        if (
          !supported ||
          corridors.some(
            (road) => distanceToCorridor(p, road) < radius + road.width / 2,
          ) ||
          stops.some(
            (stop) =>
              Math.hypot(p.x - stop.x, p.z - stop.z) < radius + stopClearance,
          )
        )
          continue;
        if (
          buildings
            .slice(firstBuilding)
            .some(
              (b) =>
                Math.hypot(b.x - p.x, b.z - p.z) <
                radius + Math.hypot(b.width, b.depth) / 2 + gap,
            )
        )
          continue;
        const storeys =
          archetype === 'detached-house'
            ? 1 + (variation % 2)
            : archetype === 'terrace-row'
              ? 2 + (variation % 2)
              : 3 + Math.floor(local * 3) + (variation % 2);
        buildings.push({
          ...p,
          id: `${id}-parcel-${index}`,
          blockId: id,
          width,
          depth,
          rotation,
          archetype,
          density: local,
          storeys,
          height: storeys * (unit * 0.16),
          baseY: 0.035,
          wallVariant: variation % 6,
          roofVariant: (variation >>> 4) % 5,
        });
      }
    }
  };
  for (const zone of components) subdivide(zone.id, zone.tiles, zone.id);
  const far = buildings.filter((_, i) => i % 6 === 0);
  return freeze({
    bounds,
    cellWidth,
    cellDepth,
    storeyHeight: unit * 0.16,
    stopClearance,
    corridors: corridors.map((road) => ({
      ...road,
      from: { ...road.from },
      to: { ...road.to },
    })),
    components,
    blocks,
    ground,
    buildings,
    far,
    medium: buildings.filter((_, i) => i % 2 === 0),
    mini: far.filter((_, i) => i % 4 === 0),
  });
}

export function cityLodBuildings(
  city: ProceduralCity,
  lod: D3dLodBand,
  mode: RepresentationMode,
): readonly CityBuilding[] {
  if (mode === 'mini') return city.mini;
  return lod === 'near'
    ? city.buildings
    : lod === 'medium'
      ? city.medium
      : city.far;
}
