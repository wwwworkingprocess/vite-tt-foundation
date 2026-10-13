import { d3dAppSettings } from './d3d-app-settings.js';
import { planStreetCellRoads } from './d3d-street-cell-roads.js';
import {
  iterateStreetCellBuildingLots,
  streetCellFootprintCalibration,
} from './d3d-street-cell-layout.js';
import { freezeSettlement } from '../settlement/settlement-metadata.js';
import type { SettlementMetadataView } from '../settlement/settlement-metadata-loader.js';
import {
  enrichSettlementPopulation,
  type SettlementPopulationInput,
} from '../settlement/settlement-population-overlay.js';
import {
  lookupSettlementZone,
  pointInPolygon,
  landmarkReservationMetres,
} from '../settlement/settlement-metadata-spatial.js';
import {
  buildUrbanCorridors,
  populationSpace,
  type ProceduralCity,
  type CityBuilding,
  type UrbanBlock,
} from './d3d-city-model.js';
import {
  d3dProjectedPoint,
  d3dMetreScale,
  d3dGeographicPoint,
  type D3dMapModel,
} from './d3d-map-model.js';
import { citySeed, distanceToCorridor } from './d3d-city-spatial.js';
import {
  metadataCityContext,
  metadataRangeSample,
  selectDevelopmentProfile,
  settlementPaletteColor,
} from './d3d-metadata-city.js';
import {
  footprintInside,
  footprintOverlaps,
  footprintRing,
  createFootprintIndex,
  type FootprintPolygon,
} from './d3d-footprint.js';
import type { StreetCells } from './street-cells.js';
import type { D3dTerrain } from './d3d-terrain-model.js';
import { geographicToTerrain } from '../terrain/terrain-projection.js';

export const streetCellLotBudget = d3dAppSettings.city.maxLotProposals;
export type StreetCellLayout = Readonly<{
  outsideSafeZone: number;
  ineligible: number;
  sourceCells: number;
  empty: number;
  roadCrossed: number;
  nonDrawable: number;
  usableEmptyCells: number;
  pass1: Readonly<{ buildings: number; occupied: number; proposed: number }>;
  pass2: Readonly<{
    eligible: number;
    processed: number;
    occupied: number;
    buildings: number;
    proposed: number;
    guideSegments: number;
    reservationSegments: number;
    corridorConflicts: number;
    budgetCells: number;
  }>;
  urbanBuildings: number;
  suburbanBuildings: number;
  frontageBuildings: number;
  interiorBuildings: number;
  candidates: number;
  rejectedCandidates: Readonly<Record<string, number>>;
  skippedCells: readonly Readonly<{ cellId: string; reason: string }>[];
  samples: Readonly<Record<string, readonly string[]>>;
  ledger: readonly StreetCellDisposition[];
  protectionConflicts?: readonly string[];
}>;
type Metadata = Extract<SettlementMetadataView, { status: 'ready' }>;
const emptySource = Object.freeze({});
const slotCache = new WeakMap<
  D3dMapModel,
  WeakMap<object, WeakMap<object, WeakMap<object, WeakMap<object, Slots>>>>
>();
const appearanceCache = new WeakMap<
  Slots,
  WeakMap<object, Map<string, ProceduralCity>>
>();
const noProtections: StreetCellProtections = Object.freeze({
  reservations: [],
  polygons: [],
});
const bounds = (points: FootprintPolygon[number]) => ({
  minX: Math.min(...points.map((p) => p[0])),
  maxX: Math.max(...points.map((p) => p[0])),
  minZ: Math.min(...points.map((p) => p[1])),
  maxZ: Math.max(...points.map((p) => p[1])),
});

/** Static read-only audit of the produced descriptors, not an acceptance flag.
 * The caller supplies the validated C model used for composition. */
export function auditStreetCellBuildings(
  model: D3dMapModel,
  cells: StreetCells,
  buildings: readonly CityBuilding[],
  roadPlans = new Map<string, ReturnType<typeof planStreetCellRoads>>(),
) {
  const polygons = new Map<string, FootprintPolygon>();
  let outsideSafeZone = 0,
    ineligible = 0;
  for (const building of buildings) {
    const annotation = cells.annotations!.cells[building.cellId!];
    if (annotation?.classification !== 'empty') {
      if (annotation?.classification !== 'road-crossed') ineligible++;
      else {
        let roads = roadPlans.get(building.cellId!);
        if (!roads) {
          roads = planStreetCellRoads(
            annotation.roads,
            cells.annotations!.roadMetadata,
            ([longitude, latitude]) =>
              d3dProjectedPoint(model, { longitude, latitude }),
            d3dMetreScale(model).worldUnitsPerMetre,
          );
          roadPlans.set(building.cellId!, roads);
        }
        if (
          roads.reservationSegments === 0 ||
          roads.conflicts(footprintRing(building))
        )
          ineligible++;
      }
    }
    if (!annotation?.safeZoneCoordinates) {
      outsideSafeZone++;
      continue;
    }
    let polygon = polygons.get(building.cellId!);
    if (!polygon) {
      polygon = annotation.safeZoneCoordinates.map((r) =>
        r.map(([longitude, latitude]) => {
          const p = d3dProjectedPoint(model, { longitude, latitude });
          return [p.x, p.z] as const;
        }),
      );
      polygons.set(building.cellId!, polygon);
    }
    if (!footprintInside(footprintRing(building), polygon, 0))
      outsideSafeZone++;
  }
  return Object.freeze({ outsideSafeZone, ineligible });
}

export function emptyStreetCellCity(
  model: D3dMapModel,
  population: SettlementPopulationInput,
): ProceduralCity {
  const metre = d3dMetreScale(model).worldUnitsPerMetre;
  return freezeSettlement({
    buildingSource: 'street-cells-C' as const,
    ...populationSpace(model, population),
    storeyHeight: 3.1 * metre,
    stopClearance: 12 * metre,
    corridors: buildUrbanCorridors(model.routes, 12 * metre),
    components: [],
    blocks: [],
    ground: [],
    localStreets: [],
    buildings: [],
    far: [],
    medium: [],
    mini: [],
  });
}

export type StreetCellProtections = Readonly<{
  reservations: readonly Readonly<{ x: number; z: number; radius: number }>[];
  polygons: readonly FootprintPolygon[];
}>;
export type StreetCellDisposition = Readonly<{
  cellId: string;
  classification: string;
  safeAreaSqm: number;
  population: 'positive' | 'zero' | 'unknown';
  observedBuildings: number | null;
  geometricFit: boolean;
  buildings: number;
  target: number;
  proposed: number;
  guideSegments: number;
  reservationSegments: number;
  proposalAllowance: number;
  reasons: Readonly<Record<string, number>>;
}>;
type Slots = Readonly<{
  buildings: readonly CityBuilding[];
  blocks: readonly UrbanBlock[];
  diagnostics: StreetCellLayout;
}>;
/** Explicit geographic reservations are independent of optional visual recipes. */
const landmarkProtectionsCache = new WeakMap<
  D3dMapModel,
  WeakMap<object, StreetCellProtections>
>();
export function streetCellLandmarkProtections(
  model: D3dMapModel,
  view: Metadata,
): StreetCellProtections {
  let entries = landmarkProtectionsCache.get(model);
  if (!entries) {
    entries = new WeakMap();
    landmarkProtectionsCache.set(model, entries);
  }
  const previous = entries.get(view.metadata);
  if (previous) return previous;
  const result = freezeSettlement({
    reservations: view.metadata.landmarks.map((l) => ({
      ...d3dProjectedPoint(model, {
        longitude: l.coordinate[0],
        latitude: l.coordinate[1],
      }),
      radius:
        landmarkReservationMetres(view.metadata, l) *
        d3dMetreScale(model).worldUnitsPerMetre,
    })),
    polygons: [],
  });
  entries.set(view.metadata, result);
  return result;
}
/** Query native raster support without interpreting missing/cropped samples as zero. */
export function streetCellPopulationSupport(
  model: D3dMapModel,
  population: SettlementPopulationInput,
  p: { x: number; z: number },
) {
  const space = populationSpace(model, population);
  const row = Math.floor((p.z - space.nw.z) / space.cellDepth),
    column = Math.floor((p.x - space.nw.x) / space.cellWidth);
  const { crop, grid } = population;
  const rowOffset =
    grid.rows === crop.rowEnd - crop.rowStart ? crop.rowStart : 0;
  const colOffset =
    grid.columns === crop.columnEnd - crop.columnStart ? crop.columnStart : 0;
  let weight = 0,
    covered = 0;
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      const r = row + dr,
        c = column + dc;
      if (
        r < crop.rowStart ||
        r >= crop.rowEnd ||
        c < crop.columnStart ||
        c >= crop.columnEnd
      )
        continue;
      const w = grid.populationWeights[r - rowOffset]?.[c - colOffset];
      if (w === undefined) continue;
      covered++;
      weight +=
        w * (dr === 0 && dc === 0 ? 1 : dr === 0 || dc === 0 ? 0.35 : 0.15);
    }
  return Object.freeze({
    state:
      weight > 0
        ? ('positive' as const)
        : covered === 9
          ? ('zero' as const)
          : ('unknown' as const),
    weight,
  });
}
/** Every intersected WATER raster cell excludes a footprint, even at a narrow shoreline intersection. */
export function streetCellNativeLand(
  model: D3dMapModel,
  terrain: D3dTerrain,
  ring: FootprintPolygon[number],
): boolean {
  const native = ring.map(([x, z]) =>
    geographicToTerrain(d3dGeographicPoint(model, { x, z })),
  );
  const t = terrain.terrain,
    b = t.viewport.rasterBounds3035;
  const xs = native.map((p) => p.x),
    ys = native.map((p) => p.y);
  if (
    Math.min(...xs) < b.west ||
    Math.max(...xs) > b.east ||
    Math.min(...ys) < b.south ||
    Math.max(...ys) > b.north
  )
    return false;
  const c0 = Math.floor((Math.min(...xs) - b.west) / t.resolution.x),
    c1 = Math.min(
      t.viewport.width - 1,
      Math.floor((Math.max(...xs) - b.west) / t.resolution.x),
    );
  const r0 = Math.floor((b.north - Math.max(...ys)) / t.resolution.y),
    r1 = Math.min(
      t.viewport.height - 1,
      Math.floor((b.north - Math.min(...ys)) / t.resolution.y),
    );
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      if (t.classify(r, c) === 'land') continue;
      const x = b.west + c * t.resolution.x,
        y = b.north - r * t.resolution.y;
      const points = [
        [x, y],
        [x + t.resolution.x, y],
        [x + t.resolution.x, y - t.resolution.y],
        [x, y - t.resolution.y],
        [x, y],
      ].map((p) => {
        const q = terrain.worldPoint(p[0]!, p[1]!);
        return [q.x, q.z] as const;
      });
      if (footprintOverlaps(ring, [points], 0)) return false;
    }
  return true;
}
function composeSlots(
  model: D3dMapModel,
  population: SettlementPopulationInput,
  cells: StreetCells,
  terrain: D3dTerrain,
  protections: StreetCellProtections,
): Slots {
  const metre = terrain.metre,
    tolerance = 0.001 * metre;
  const project = (rings: FootprintPolygon): FootprintPolygon =>
    rings.map((r) =>
      r.map(([longitude, latitude]) => {
        const p = d3dProjectedPoint(model, { longitude, latitude });
        return [p.x, p.z] as const;
      }),
    );
  const corridors = buildUrbanCorridors(model.routes, 12 * metre);
  const populationSpaceMapping = populationSpace(model, population);
  // Positive canonical tiles can lie entirely inside a large safe zone; vertex probes alone miss them.
  const positiveTiles = population.canonicalCells.map((c) => ({
    x:
      populationSpaceMapping.nw.x +
      (c.column + 0.5) * populationSpaceMapping.cellWidth,
    z:
      populationSpaceMapping.nw.z +
      (c.row + 0.5) * populationSpaceMapping.cellDepth,
  }));
  const maximum = population.canonicalCells.reduce(
    (n, c) => Math.max(n, c.populationWeight),
    1,
  );
  const buildings: CityBuilding[] = [],
    blocks: UrbanBlock[] = [],
    used = new Set<string>();
  const diagnostics = {
    outsideSafeZone: 0,
    ineligible: 0,
    sourceCells: cells.features.length,
    empty: 0,
    roadCrossed: 0,
    nonDrawable: 0,
    usableEmptyCells: 0,
    pass1: { buildings: 0, occupied: 0, proposed: 0 },
    pass2: {
      eligible: 0,
      processed: 0,
      occupied: 0,
      buildings: 0,
      proposed: 0,
      guideSegments: 0,
      reservationSegments: 0,
      corridorConflicts: 0,
      budgetCells: 0,
    },
    urbanBuildings: 0,
    suburbanBuildings: 0,
    frontageBuildings: 0,
    interiorBuildings: 0,
    candidates: 0,
    rejectedCandidates: {} as Record<string, number>,
    skippedCells: [] as { cellId: string; reason: string }[],
    samples: {} as Record<string, string[]>,
    ledger: [] as StreetCellDisposition[],
  };
  // Accepted Pass 1 runs first in its unchanged source order and consumes its
  // unchanged proposals. Pass 2 shares only the remaining global guard.
  const roadPlans = new Map<string, ReturnType<typeof planStreetCellRoads>>();
  const ordered = [
    ...cells.features.filter(
      (c) => cells.annotations!.cells[c.id]!.classification === 'empty',
    ),
    ...cells.features.filter(
      (c) => cells.annotations!.cells[c.id]!.classification !== 'empty',
    ),
  ];
  let remainingRoadCells = cells.features.filter(
    (c) => cells.annotations!.cells[c.id]!.classification === 'road-crossed',
  ).length;
  for (const cell of ordered) {
    const a = cells.annotations!.cells[cell.id]!,
      evidence = a.buildingEvidence;
    const representative = d3dProjectedPoint(model, {
      longitude: a.representativePoint[0],
      latitude: a.representativePoint[1],
    });
    const support = streetCellPopulationSupport(
      model,
      population,
      representative,
    );
    const record = {
      cellId: cell.id,
      classification: a.classification,
      safeAreaSqm: a.safeAreaSqm,
      population: support.state,
      observedBuildings: evidence.safeRepresentativeCount,
      geometricFit: false,
      buildings: 0,
      target: 0,
      proposed: 0,
      guideSegments: 0,
      reservationSegments: 0,
      proposalAllowance: 0,
      reasons: {} as Record<string, number>,
    };
    diagnostics.ledger.push(record);
    const pass2 = a.classification === 'road-crossed';
    if (a.classification === 'non-drawable') {
      diagnostics.nonDrawable++;
      continue;
    }
    const startCandidates = diagnostics.candidates;
    // Equal-share admission prevents a high-segment early cell exhausting the rest;
    // unused allowances are redistributed deterministically to remaining cells.
    const allowance = pass2
      ? Math.floor(
          (streetCellLotBudget - startCandidates) / remainingRoadCells--,
        )
      : streetCellLotBudget - startCandidates;
    if (pass2) {
      diagnostics.roadCrossed++;
      diagnostics.pass2.processed++;
    } else diagnostics.empty++;
    const roads = pass2
      ? planStreetCellRoads(
          a.roads,
          cells.annotations!.roadMetadata,
          ([longitude, latitude]) =>
            d3dProjectedPoint(model, { longitude, latitude }),
          metre,
        )
      : undefined;
    if (roads) {
      roadPlans.set(cell.id, roads);
      if (roads.reservationSegments > 0) diagnostics.pass2.eligible++;
      record.guideSegments = roads.guides.length;
      record.reservationSegments = roads.reservationSegments;
      diagnostics.pass2.guideSegments += roads.guides.length;
      diagnostics.pass2.reservationSegments += roads.reservationSegments;
    }
    record.proposalAllowance = allowance;
    const reject = (reason: string) => {
      record.reasons[reason] = (record.reasons[reason] ?? 0) + 1;
      diagnostics.rejectedCandidates[reason] =
        (diagnostics.rejectedCandidates[reason] ?? 0) + 1;
    };
    const finish = () => {
      if (record.buildings === 0)
        diagnostics.skippedCells.push({
          cellId: cell.id,
          reason:
            Object.keys(record.reasons).sort(
              (a, b) =>
                record.reasons[b]! - record.reasons[a]! || a.localeCompare(b),
            )[0] ?? 'no-fitting-lots',
        });
    };
    if (pass2 && !roads!.reservationSegments) {
      reject('no-at-grade-guide');
      finish();
      continue;
    }
    if (!a.safeZoneCoordinates) {
      reject('no-safe-zone');
      finish();
      continue;
    }
    const safe = project(a.safeZoneCoordinates),
      original = project(cell.geometry.coordinates),
      cellBounds = bounds(safe[0]!);
    const crop = {
      minX: Math.max(cellBounds.minX, terrain.bounds.minX),
      maxX: Math.min(cellBounds.maxX, terrain.bounds.maxX),
      minZ: Math.max(cellBounds.minZ, terrain.bounds.minZ),
      maxZ: Math.min(cellBounds.maxZ, terrain.bounds.maxZ),
    };
    if (crop.minX >= crop.maxX || crop.minZ >= crop.maxZ) {
      reject('native-water-or-coverage');
      finish();
      continue;
    }
    const observed = evidence.safeRepresentativeCount ?? 0;
    if (observed === 0) {
      const points = [representative, ...safe[0]!.map(([x, z]) => ({ x, z }))];
      const supports = points.map((p) =>
        streetCellPopulationSupport(model, population, p),
      );
      if (
        !supports.some((s) => s.state === 'positive') &&
        !positiveTiles.some(
          (p) =>
            p.x >= cellBounds.minX &&
            p.x <= cellBounds.maxX &&
            p.z >= cellBounds.minZ &&
            p.z <= cellBounds.maxZ &&
            pointInPolygon([p.x, p.z], { type: 'Polygon', coordinates: safe }),
        )
      ) {
        reject(
          supports.some((s) => s.state === 'unknown')
            ? 'unknown-population-no-evidence'
            : 'zero-population-no-evidence',
        );
        finish();
        continue;
      }
    }
    const intensity = Math.min(
      1,
      Math.pow(support.weight / (maximum * 3), 0.4),
    );
    const coverage = evidence.safeFootprintCoverage;
    // Observations are lower bounds, not Workbench targets. Missing evidence uses population intensity.
    const urban =
      (coverage !== null && coverage >= 0.25) ||
      (observed / a.safeAreaSqm) * 10000 >= 25 ||
      intensity >= 0.55;
    const calibration =
      streetCellFootprintCalibration[urban ? 'urban' : 'suburban'];
    const seed = citySeed(cell.id);
    // Union area / representative observations calibrates the local footprint scale,
    // bounded around the accepted reference ranges (overlaps/partial coverage are not a census).
    const footprintScale =
      observed > 0
        ? Math.max(
            0.75,
            Math.min(
              1.6,
              Math.sqrt(
                evidence.safeFootprintUnionAreaSqm! /
                  observed /
                  calibration.areaMedianSqm,
              ),
            ),
          )
        : 1;
    const width =
        footprintScale *
        metadataRangeSample(
          { min: calibration.shortMin, max: calibration.shortMax },
          seed,
        ),
      depth =
        footprintScale *
        metadataRangeSample(
          { min: calibration.longMin, max: calibration.longMax },
          seed >>> 8,
        );
    const targetCoverage = Math.min(
      0.6,
      Math.max(
        urban ? 0.25 : 0.14,
        coverage === null ? intensity * 0.45 : coverage,
      ),
    );
    record.target = Math.max(
      1,
      Math.ceil(
        Math.max(observed, (a.safeAreaSqm * targetCoverage) / (width * depth)),
      ),
    );
    const occupied = createFootprintIndex(50 * metre, tolerance);
    let occupiedArea = 0;
    for (const scale of [1, 0.65]) {
      if (
        record.buildings >= record.target ||
        (scale < 1 && record.buildings > 0)
      )
        break;
      const w = width * scale * metre,
        d = depth * scale * metre;
      const lots = iterateStreetCellBuildingLots(
        safe,
        crop,
        {
          width: w + 0.4 * metre,
          depth: d + 0.4 * metre,
          gap: (urban ? 1 : 4) * metre,
          interiorGap: (urban ? 2 : 5) * metre,
          parcelWidth: w,
          parcelDepth: d,
        },
        0,
        pass2
          ? streetCellLotBudget
          : streetCellLotBudget - diagnostics.candidates,
        undefined,
        roads?.guides,
      );
      let ordinal = 0;
      for (const lot of lots) {
        const index = ordinal++;
        if (pass2 && diagnostics.candidates - startCandidates >= allowance) {
          if (!record.reasons['candidate-budget'])
            diagnostics.pass2.budgetCells++;
          reject('candidate-budget');
          break;
        }
        if (
          record.buildings >= record.target ||
          (record.buildings > 0 &&
            occupiedArea + w * d >
              a.safeAreaSqm * metre * metre * targetCoverage)
        )
          break;
        diagnostics.candidates++;
        record.proposed++;
        if (pass2) diagnostics.pass2.proposed++;
        const envelope = footprintRing({
          ...lot,
          width: w + 0.4 * metre,
          depth: d + 0.4 * metre,
        });
        const fitting =
          footprintInside(envelope, safe, tolerance) &&
          footprintInside(envelope, original, tolerance);
        const witness = footprintRing({
          ...lot,
          width: 10 * metre,
          depth: 10 * metre,
        });
        if (!record.geometricFit && footprintInside(witness, safe, tolerance))
          record.geometricFit = true;
        if (!fitting) {
          reject('safe-zone-footprint');
          continue;
        }
        if (roads?.conflicts(envelope)) {
          reject('internal-road-corridor');
          diagnostics.pass2.corridorConflicts++;
          continue;
        }
        if (!streetCellNativeLand(model, terrain, envelope)) {
          reject('native-water-or-coverage');
          continue;
        }
        const local = streetCellPopulationSupport(model, population, lot);
        if (local.state !== 'positive' && observed === 0) {
          reject(
            local.state === 'zero'
              ? 'zero-population-no-evidence'
              : 'unknown-population-no-evidence',
          );
          continue;
        }
        const radius = Math.hypot(w, d) / 2;
        if (
          model.stops.some(
            (s) => Math.hypot(s.x - lot.x, s.z - lot.z) < 12 * metre + radius,
          ) ||
          corridors.some(
            (r) => distanceToCorridor(lot, r) < r.width / 2 + radius,
          ) ||
          protections.reservations.some(
            (p) => Math.hypot(p.x - lot.x, p.z - lot.z) < p.radius + radius,
          ) ||
          protections.polygons.some((p) =>
            footprintOverlaps(envelope, p, tolerance),
          )
        ) {
          reject('physical-clearance');
          continue;
        }
        if (
          occupiedArea + w * d >
          a.safeAreaSqm * metre * metre * targetCoverage
        ) {
          reject('cell-coverage');
          continue;
        }
        const id = `${cell.id}-parcel-${index + (scale === 1 ? 0 : streetCellLotBudget)}`,
          ring = footprintRing({ ...lot, width: w, depth: d });
        if (!occupied.add(id, ring)) {
          reject('spacing');
          continue;
        }
        const building: CityBuilding = {
          id,
          cellId: cell.id,
          blockId: cell.id,
          x: lot.x,
          z: lot.z,
          width: w,
          depth: d,
          rotation: lot.rotation,
          archetype: urban ? 'perimeter-block' : 'detached-house',
          storeys: urban ? 4 : 2,
          height: (urban ? 4 : 2) * 3.1 * metre,
          baseY: 0.035,
          wallVariant: seed % 3,
          roofVariant: (seed >>> 8) % 3,
          density: intensity,
        };
        buildings.push(building);
        record.buildings++;
        occupiedArea += w * d;
        if (pass2) diagnostics.pass2.buildings++;
        else used.add(cell.id);
        if (urban) diagnostics.urbanBuildings++;
        else diagnostics.suburbanBuildings++;
        if (lot.band === 'frontage') diagnostics.frontageBuildings++;
        else diagnostics.interiorBuildings++;
      }
    }
    if (pass2 && record.buildings > 0) diagnostics.pass2.occupied++;
    if (record.buildings > 0)
      blocks.push({
        ...crop,
        id: cell.id,
        cellId: cell.id,
        componentId: cell.id,
        density: intensity,
      });
    finish();
  }
  diagnostics.usableEmptyCells = used.size;
  diagnostics.pass1 = {
    buildings: buildings.length - diagnostics.pass2.buildings,
    occupied: used.size,
    proposed: diagnostics.candidates - diagnostics.pass2.proposed,
  };
  Object.assign(
    diagnostics,
    auditStreetCellBuildings(model, cells, buildings, roadPlans),
  );
  return freezeSettlement({ buildings, blocks, diagnostics });
}
/** C owns placement; research only assigns recipes to already accepted slots. */
export function buildStreetCellCity(
  model: D3dMapModel,
  population: SettlementPopulationInput,
  view: Metadata | undefined,
  cells?: StreetCells,
  terrain?: D3dTerrain,
  protections: StreetCellProtections = noProtections,
): ProceduralCity {
  if (cells && (cells.level !== 'C' || !cells.annotations))
    throw new Error('StreetCell buildings require C annotations');
  if (!cells || !terrain) {
    const empty = emptyStreetCellCity(model, population);
    if (!view) return empty;
    const settlement = enrichSettlementPopulation(population, view.metadata),
      context = metadataCityContext(model, settlement, {
        bounds: empty.bounds,
        corridors: empty.corridors,
      });
    return freezeSettlement({
      ...empty,
      settlement,
      reservations: context.reservations,
      landscapes: context.landscapes,
    });
  }
  let pops = slotCache.get(model);
  if (!pops) {
    pops = new WeakMap();
    slotCache.set(model, pops);
  }
  let products = pops.get(population);
  if (!products) {
    products = new WeakMap();
    pops.set(population, products);
  }
  let terrains = products.get(cells);
  if (!terrains) {
    terrains = new WeakMap();
    products.set(cells, terrains);
  }
  let protectedPlans = terrains.get(terrain);
  if (!protectedPlans) {
    protectedPlans = new WeakMap();
    terrains.set(terrain, protectedPlans);
  }
  let slots = protectedPlans.get(protections);
  if (!slots) {
    slots = composeSlots(model, population, cells, terrain, protections);
    protectedPlans.set(protections, slots);
  }
  let recipes = appearanceCache.get(slots);
  if (!recipes) {
    recipes = new WeakMap();
    appearanceCache.set(slots, recipes);
  }
  const key = view?.metadata ?? emptySource;
  let hashes = recipes.get(key);
  if (!hashes) {
    hashes = new Map();
    recipes.set(key, hashes);
  }
  const hash = view?.sha256 ?? '';
  const previous = hashes.get(hash);
  if (previous) return previous;
  const settlement = view
    ? enrichSettlementPopulation(population, view.metadata)
    : undefined;
  const support = settlement
    ? metadataCityContext(model, settlement, {
        bounds: populationSpace(model, population).bounds,
        corridors: buildUrbanCorridors(model.routes, 0),
      })
    : undefined;
  const samples: Record<string, string[]> = {};
  const buildings = slots.buildings.map((slot) => {
    const seed = citySeed(slot.cellId!),
      geo = d3dGeographicPoint(model, slot),
      zone = view
        ? lookupSettlementZone(view.metadata, [geo.longitude, geo.latitude])
        : undefined;
    const profile = zone
      ? selectDevelopmentProfile(view!.metadata, zone.buildingProfileMix, seed)
      : undefined;
    // Row-normal coordinate and orientation give coherent repetition, independent
    // of camera, load order and optional research. Physical slots stay frozen.
    const rowSeed = citySeed(
      `${slot.cellId}:${Math.round(slot.rotation * 1000)}:${Math.round((slot.x * Math.sin(slot.rotation) + slot.z * Math.cos(slot.rotation)) / (12 * terrain.metre))}`,
    );
    if (!profile) {
      const urban = slot.archetype === 'perimeter-block';
      return {
        ...slot,
        prototype: urban
          ? rowSeed % 2 === 0
            ? ('perimeter-block' as const)
            : ('small-apartment' as const)
          : rowSeed % 2 === 0
            ? ('detached-house' as const)
            : ('detached-villa' as const),
        wallColor: (urban
          ? ['#c8c0ad', '#bbb49f', '#cec8b7']
          : ['#d3cab8', '#c5bda8', '#ddd4c2'])[rowSeed % 3]!,
        roofColor: (urban
          ? ['#949a95', '#aba899', '#a5a797']
          : ['#aa7a62', '#bd9275', '#978e79'])[(rowSeed >>> 8) % 3]!,
      };
    }
    const archetype =
      profile.allowedArchetypes[rowSeed % profile.allowedArchetypes.length]!;
    const storeys = Math.round(
      metadataRangeSample(
        { min: profile.storeys.typicalMin, max: profile.storeys.typicalMax },
        rowSeed,
      ),
    );
    const list = samples[profile.id] ?? (samples[profile.id] = []);
    if (list.length < 4 && !list.includes(slot.cellId!))
      list.push(slot.cellId!);
    return {
      ...slot,
      zoneId: zone!.id,
      buildingProfileId: profile.id,
      archetype,
      ...(archetype === 'detached-house'
        ? { prototype: 'detached-villa' as const }
        : {}),
      storeys,
      height: storeys * 3.1 * terrain.metre,
      wallColor: settlementPaletteColor(
        profile.wallPalette[rowSeed % profile.wallPalette.length]!,
      ),
      roofColor: settlementPaletteColor(
        profile.roofPalette[rowSeed % profile.roofPalette.length]!,
      ),
    };
  });
  const conflicts = slots.diagnostics.ledger
    .filter(
      (c) =>
        c.classification === 'empty' &&
        (c.observedBuildings ?? 0) > 0 &&
        view &&
        view.metadata.landscapeRegions.some((r) =>
          pointInPolygon(
            cells.annotations!.cells[c.cellId]!.representativePoint,
            r.boundary,
          ),
        ),
    )
    .map((c) => c.cellId);
  const result = freezeSettlement({
    ...emptyStreetCellCity(model, population),
    ...(settlement ? { settlement } : {}),
    ...(support
      ? { reservations: support.reservations, landscapes: support.landscapes }
      : {}),
    components: [...new Set(buildings.map((b) => b.cellId!))].map((id) => ({
      id,
      tiles: [],
    })),
    blocks: slots.blocks,
    buildings,
    far: buildings,
    medium: buildings,
    mini: buildings.filter((_, i) => i % 32 === 0),
    streetCellLayout: {
      ...slots.diagnostics,
      samples,
      protectionConflicts: conflicts,
    },
  });
  hashes.set(hash, result);
  return result;
}
