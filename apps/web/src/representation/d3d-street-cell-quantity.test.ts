import { expect, it } from 'vitest';
import {
  buildStreetCellCity,
  streetCellPopulationSupport,
  streetCellLandmarkProtections,
  streetCellNativeLand,
} from './d3d-street-cell-city.js';
import {
  cellCityMap,
  cellCityPopulation,
  cellCityMetadata,
  cellCityCells,
  cellCityTerrain,
  alicanteCellCityFixture,
} from '../test/street-cell-city-fixture.js';
const present = buildStreetCellCity(
  cellCityMap,
  cellCityPopulation,
  cellCityMetadata,
  cellCityCells,
  cellCityTerrain,
);
const absent = buildStreetCellCity(
  cellCityMap,
  cellCityPopulation,
  undefined,
  cellCityCells,
  cellCityTerrain,
);
it('keeps slots, counts and geographic eligibility independent of optional research and fills developed empty C cells', () => {
  const slots = (city: typeof present) =>
    city.buildings.map(({ id, cellId, x, z, width, depth, rotation }) => ({
      id,
      cellId,
      x,
      z,
      width,
      depth,
      rotation,
    }));
  expect(slots(absent)).toEqual(slots(present));
  expect(present.buildings.length).toBeGreaterThan(8000);
  expect(present.streetCellLayout!.usableEmptyCells).toBeGreaterThan(850);
  expect(present.buildings.map((b) => b.buildingProfileId)).not.toEqual(
    absent.buildings.map((b) => b.buildingProfileId),
  );
  expect(present.streetCellLayout!.outsideSafeZone).toBe(0);
  expect(present.streetCellLayout!.ineligible).toBe(0);
});

const f = alicanteCellCityFixture();
const alicanteCity = buildStreetCellCity(
  f.model,
  f.population,
  undefined,
  f.cells,
  f.terrain,
);
it('composes Alicante with the same C-owned composer without research', () => {
  expect(alicanteCity.buildings.length).toBeGreaterThan(8000);
  expect(alicanteCity.streetCellLayout!.sourceCells).toBe(3201);
  expect(alicanteCity.streetCellLayout!.empty).toBe(2378);
  expect(
    alicanteCity.buildings.every(
      (b) =>
        b.cellId &&
        f.cells.annotations.cells[b.cellId]!.classification === 'empty',
    ),
  ).toBe(true);
  expect(alicanteCity.streetCellLayout!.outsideSafeZone).toBe(0);
});

import { populationSpace } from './d3d-city-model.js';
import { footprintRing } from './d3d-footprint.js';
import type { StreetCells } from './street-cells.js';
import { d3dProjectedPoint, d3dGeographicPoint } from './d3d-map-model.js';
import { terrainToGeographic } from '../terrain/terrain-projection.js';
const selected: StreetCells = {
  ...cellCityCells,
  features: cellCityCells.features.filter((c) => c.id === 'es-torrevieja-sc-1'),
};
const zeroPopulation = {
  ...cellCityPopulation,
  canonicalCells: [],
  grid: {
    ...cellCityPopulation.grid,
    populationWeights: cellCityPopulation.grid.populationWeights.map((r) =>
      r.map(() => 0),
    ),
  },
};
it('preserves native ground safety and caches explicit landmark reservations independently of visual research', () => {
  const protections = streetCellLandmarkProtections(
    cellCityMap,
    cellCityMetadata,
  );
  expect(streetCellLandmarkProtections(cellCityMap, cellCityMetadata)).toBe(
    protections,
  );
  expect(
    streetCellLandmarkProtections(cellCityMap, {
      ...cellCityMetadata,
      metadata: { ...cellCityMetadata.metadata },
    }),
  ).not.toBe(protections);
  expect(protections.reservations).toHaveLength(22);
  const a = buildStreetCellCity(
    cellCityMap,
    cellCityPopulation,
    cellCityMetadata,
    selected,
    cellCityTerrain,
    protections,
  );
  for (const view of [
    undefined,
    {
      ...cellCityMetadata,
      sha256: 'partial',
      metadata: { ...cellCityMetadata.metadata, zones: [], landmarks: [] },
    },
  ]) {
    const b = buildStreetCellCity(
      cellCityMap,
      cellCityPopulation,
      view,
      selected,
      cellCityTerrain,
      protections,
    );
    expect(
      b.buildings.map(({ id, x, z, width, depth, rotation }) => ({
        id,
        x,
        z,
        width,
        depth,
        rotation,
      })),
    ).toEqual(
      a.buildings.map(({ id, x, z, width, depth, rotation }) => ({
        id,
        x,
        z,
        width,
        depth,
        rotation,
      })),
    );
  }
  const first = a.buildings[0]!;
  const reserved = buildStreetCellCity(
    cellCityMap,
    cellCityPopulation,
    undefined,
    selected,
    cellCityTerrain,
    {
      reservations: [
        { x: first.x, z: first.z, radius: 50 * cellCityTerrain.metre },
      ],
      polygons: [],
    },
  );
  expect(reserved.buildings.some((b) => b.id === first.id)).toBe(false);
  expect(
    reserved.streetCellLayout!.rejectedCandidates['physical-clearance'],
  ).toBeGreaterThan(0);
  expect(
    buildStreetCellCity(cellCityMap, cellCityPopulation, undefined, selected)
      .buildings,
  ).toEqual([]);
  expect(
    buildStreetCellCity(cellCityMap, cellCityPopulation, undefined).buildings,
  ).toEqual([]);
});
it('distinguishes quantitative zero, cropped support, unknown tiles and available positive population', () => {
  const full = populationSpace(cellCityMap, zeroPopulation),
    point = {
      x: full.nw.x + 20.5 * full.cellWidth,
      z: full.nw.z + 20.5 * full.cellDepth,
    };
  expect(
    streetCellPopulationSupport(cellCityMap, zeroPopulation, point),
  ).toEqual({ state: 'zero', weight: 0 });
  expect(
    streetCellPopulationSupport(cellCityMap, zeroPopulation, {
      x: 1e9,
      z: 1e9,
    }),
  ).toEqual({ state: 'unknown', weight: 0 });
  const crop = { rowStart: 19, rowEnd: 22, columnStart: 19, columnEnd: 22 };
  const grid = {
    ...zeroPopulation.grid,
    rows: 3,
    columns: 3,
    originCellCenter: {
      latitude:
        zeroPopulation.grid.originCellCenter.latitude -
        19 * zeroPopulation.grid.resolutionDegrees,
      longitude:
        zeroPopulation.grid.originCellCenter.longitude +
        19 * zeroPopulation.grid.resolutionDegrees,
    },
    populationWeights: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
  };
  const cropped = { ...zeroPopulation, crop, grid };
  expect(streetCellPopulationSupport(cellCityMap, cropped, point)).toEqual({
    state: 'zero',
    weight: 0,
  });
  expect(
    streetCellPopulationSupport(
      cellCityMap,
      {
        ...cropped,
        grid: { ...grid, populationWeights: [[1, 0, 0], [], [0, 0, 0]] },
      },
      point,
    ).state,
  ).toBe('positive');
  expect(
    streetCellPopulationSupport(
      cellCityMap,
      {
        ...cropped,
        grid: { ...grid, populationWeights: [[0, 0, 0], [], [0, 0, 0]] },
      },
      point,
    ).state,
  ).toBe('unknown');
  expect(
    buildStreetCellCity(
      cellCityMap,
      zeroPopulation,
      undefined,
      selected,
      cellCityTerrain,
    ).buildings.length,
  ).toBeGreaterThan(0);
  const a = selected.annotations!.cells[selected.features[0]!.id]!;
  const unavailable = {
    ...selected,
    annotations: {
      ...selected.annotations!,
      evidence: {
        ...selected.annotations!.evidence,
        availability: 'unavailable' as const,
        source: null,
      },
      cells: {
        [a.cellId]: {
          ...a,
          buildingEvidence: {
            ownedFeatureCount: null,
            ownedComponentCount: null,
            safeRepresentativeCount: null,
            safeFullyContainedCount: null,
            safeIntersectingFeatureCount: null,
            safeFootprintUnionAreaSqm: null,
            safeFootprintCoverage: null,
            estimatedBuildingCount: null,
            desiredFootprintCoverage: null,
          },
        },
      },
    },
  };
  const absentEvidence = buildStreetCellCity(
    cellCityMap,
    cellCityPopulation,
    undefined,
    unavailable,
    cellCityTerrain,
  );
  expect(absentEvidence.buildings.length).toBeGreaterThan(0);
  expect(
    buildStreetCellCity(
      cellCityMap,
      zeroPopulation,
      undefined,
      unavailable,
      cellCityTerrain,
    ).buildings,
  ).toEqual([]);
  const unknown = buildStreetCellCity(
    cellCityMap,
    {
      ...zeroPopulation,
      crop: { rowStart: 0, rowEnd: 1, columnStart: 0, columnEnd: 1 },
    },
    undefined,
    unavailable,
    cellCityTerrain,
  );
  expect(unknown.streetCellLayout!.skippedCells[0]!.reason).toBe(
    'unknown-population-no-evidence',
  );
});
it('accepts negative finite native LAND, excludes WATER and detects viewport-edge crossings', () => {
  const b = cellCityTerrain.terrain.viewport.rasterBounds3035;
  const t = cellCityTerrain.terrain;
  const center = cellCityTerrain.worldPoint(
    b.west + 5.5 * t.resolution.x,
    b.north - 5.5 * t.resolution.y,
  );
  const ring = footprintRing({
    ...center,
    width: 5 * cellCityTerrain.metre,
    depth: 5 * cellCityTerrain.metre,
    rotation: 0,
  });
  const land = {
    ...cellCityTerrain,
    terrain: { ...t, classify: () => 'land' as const, sample: () => -4 },
  };
  expect(streetCellNativeLand(cellCityMap, land, ring)).toBe(true);
  expect(
    streetCellNativeLand(
      cellCityMap,
      {
        ...land,
        terrain: { ...land.terrain, classify: () => 'water' as const },
      },
      ring,
    ),
  ).toBe(false);
  const west = d3dProjectedPoint(
    cellCityMap,
    terrainToGeographic({ x: b.west - 10, y: (b.north + b.south) / 2 }),
  );
  expect(
    streetCellNativeLand(
      cellCityMap,
      land,
      footprintRing({
        ...west,
        width: 5 * land.metre,
        depth: 5 * land.metre,
        rotation: 0,
      }),
    ),
  ).toBe(false);
  const south = d3dProjectedPoint(
    cellCityMap,
    terrainToGeographic({ x: (b.west + b.east) / 2, y: b.south - 10 }),
  );
  expect(
    streetCellNativeLand(
      cellCityMap,
      land,
      footprintRing({
        ...south,
        width: 5 * land.metre,
        depth: 5 * land.metre,
        rotation: 0,
      }),
    ),
  ).toBe(false);
  const constrained = {
    ...cellCityTerrain,
    bounds: { ...cellCityTerrain.bounds, minZ: 1e9, maxZ: 1e9 + 1 },
  };
  expect(
    buildStreetCellCity(
      cellCityMap,
      cellCityPopulation,
      undefined,
      selected,
      constrained,
    ).streetCellLayout!.skippedCells[0]!.reason,
  ).toBe('native-water-or-coverage');
});

it('finds an interior positive tile missed by boundary probes and diagnoses unsupported cropped lots individually', () => {
  const active = cellCityPopulation.canonicalCells.find(
    (c) =>
      c.center.longitude > -0.69 &&
      c.center.longitude < -0.675 &&
      c.center.latitude > 37.98 &&
      c.center.latitude < 37.99,
  )!;
  const center = d3dProjectedPoint(cellCityMap, active.center),
    m = cellCityTerrain.metre;
  const points = footprintRing({
    ...center,
    width: 600 * m,
    depth: 600 * m,
    rotation: 0,
  }).map(([x, z]) => {
    const p = d3dGeographicPoint(cellCityMap, { x, z });
    return [p.longitude, p.latitude] as const;
  });
  const original = selected.features[0]!,
    id = 'es-torrevieja-sc-900001';
  const coordinate = d3dGeographicPoint(cellCityMap, {
    x: center.x + 270 * m,
    z: center.z + 270 * m,
  });
  const annotation = {
    ...selected.annotations!.cells[original.id]!,
    cellId: id,
    representativePoint: [coordinate.longitude, coordinate.latitude] as const,
    safeZoneCoordinates: [points],
    safeAreaSqm: 360000,
    buildingEvidence: {
      ownedFeatureCount: null,
      ownedComponentCount: null,
      safeRepresentativeCount: null,
      safeFullyContainedCount: null,
      safeIntersectingFeatureCount: null,
      safeFootprintUnionAreaSqm: null,
      safeFootprintCoverage: null,
      estimatedBuildingCount: null,
      desiredFootprintCoverage: null,
    },
  };
  const cells = {
    ...selected,
    features: [
      {
        ...original,
        id,
        geometry: { ...original.geometry, coordinates: [points] },
      },
    ],
    annotations: {
      ...selected.annotations!,
      evidence: {
        ...selected.annotations!.evidence,
        availability: 'unavailable' as const,
        source: null,
      },
      cells: { [id]: annotation },
    },
  };
  const grid = {
    ...zeroPopulation.grid,
    populationWeights: zeroPopulation.grid.populationWeights.map((r, row) =>
      r.map((_, col) =>
        row === active.row && col === active.column ? 100 : 0,
      ),
    ),
  };
  const population = {
    grid,
    canonicalCells: [{ ...active, populationWeight: 100 }],
    crop: {
      rowStart: active.row - 2,
      rowEnd: active.row + 3,
      columnStart: active.column - 2,
      columnEnd: active.column + 3,
    },
  };
  const city = buildStreetCellCity(
    cellCityMap,
    population,
    undefined,
    cells,
    cellCityTerrain,
  );
  expect(city.buildings.length).toBeGreaterThan(0);
  expect(
    city.streetCellLayout!.rejectedCandidates['unknown-population-no-evidence'],
  ).toBeGreaterThan(0);
  expect(city.streetCellLayout!.ledger[0]!.population).toBe('unknown');
});
