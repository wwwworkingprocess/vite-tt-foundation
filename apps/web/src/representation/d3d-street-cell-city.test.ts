import {
  lookupSettlementZone,
  lookupSettlementContext,
} from '../settlement/settlement-metadata-spatial.js';
import * as cellLayout from './d3d-street-cell-layout.js';
import * as metadataLayout from './d3d-metadata-city.js';
import { d3dGeographicPoint, d3dMetreScale } from './d3d-map-model.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildProceduralCity } from './d3d-city-model.js';
import { expect, it, vi } from 'vitest';
import {
  auditStreetCellBuildings,
  buildStreetCellCity as compose,
  emptyStreetCellCity,
  streetCellLotBudget,
} from './d3d-street-cell-city.js';
import { d3dProjectedPoint } from './d3d-map-model.js';
import { footprintRing, footprintInside } from './d3d-footprint.js';
import {
  cellCityMap,
  cellCityMetadata,
  cellCityPopulation,
  cellCityCells,
  cellCityTerrain,
} from '../test/street-cell-city-fixture.js';
const cellLayoutOriginal = cellLayout.iterateStreetCellBuildingLots;
const buildStreetCellCity = (...args: Parameters<typeof compose>) =>
  compose(
    args[0],
    args[1],
    args[2],
    args[3],
    args[4] ?? cellCityTerrain,
    args[5],
  );
const legacyCity = buildProceduralCity(
  cellCityMap,
  cellCityPopulation,
  cellCityMetadata,
);

const start = performance.now();
const city = buildStreetCellCity(
  cellCityMap,
  cellCityPopulation,
  cellCityMetadata,
  cellCityCells,
);
const coldMs = performance.now() - start;

// Index immutable polygons once; exhaustively inspect every real building, with
// expensive reference projections outside the timed assertion bodies.
const projectReferenceRings = (
  rings: (typeof cellCityCells.features)[number]['geometry']['coordinates'],
) =>
  rings.map((r) =>
    r.map(([longitude, latitude]) => {
      const p = d3dProjectedPoint(cellCityMap, { longitude, latitude });
      return [p.x, p.z] as const;
    }),
  );
const referencePolygons = new Map(
  cellCityCells.features.map((f) => [
    f.id,
    {
      original: projectReferenceRings(f.geometry.coordinates),
      safe: cellCityCells.annotations!.cells[f.id]!.safeZoneCoordinates
        ? projectReferenceRings(
            cellCityCells.annotations!.cells[f.id]!.safeZoneCoordinates!,
          )
        : undefined,
    },
  ]),
);
const realFootprintViolations = city.buildings.flatMap((b) => {
  const polygon = referencePolygons.get(b.cellId!)!,
    ring = footprintRing(b);
  return cellCityCells.annotations!.cells[b.cellId!]!.classification !==
    'empty' ||
    !polygon.safe ||
    !footprintInside(ring, polygon.safe, 0) ||
    !footprintInside(ring, polygon.original, 0) ||
    !Object.isFrozen(b)
    ? [b.id]
    : [];
});
const buildingsByBlock = new Map<string, (typeof city.buildings)[number][]>();
for (const b of city.buildings) {
  const local = buildingsByBlock.get(b.blockId) ?? [];
  local.push(b);
  buildingsByBlock.set(b.blockId, local);
}
const profileValues = new Map(
  cellCityMetadata.metadata.buildingProfiles.map((p) => [
    p.id,
    {
      profile: p,
      walls: p.wallPalette.map(metadataLayout.settlementPaletteColor),
      roofs: p.roofPalette.map(metadataLayout.settlementPaletteColor),
    },
  ]),
);

it('materializes both real Torrevieja families exclusively from empty C safe zones', () => {
  const cachedStart = performance.now();
  expect(
    buildStreetCellCity(
      cellCityMap,
      cellCityPopulation,
      cellCityMetadata,
      cellCityCells,
    ),
  ).toBe(city);
  const cachedMs = performance.now() - cachedStart;
  const folder = join(
    import.meta.dirname,
    '../../../../node_modules/.cache/street-cells',
  );
  mkdirSync(folder, { recursive: true });
  const old = legacyCity;
  writeFileSync(
    join(folder, 'cell-city-layout.json'),
    JSON.stringify(
      {
        coldMs,
        cachedMs,
        oldBuildings: old.buildings.length,
        newBuildings: city.buildings.length,
        diagnostics: city.streetCellLayout,
        profiles: Object.fromEntries(
          [...new Set(city.buildings.map((b) => b.buildingProfileId!))].map(
            (id) => [
              id,
              city.buildings.filter((b) => b.buildingProfileId === id).length,
            ],
          ),
        ),
      },
      null,
      2,
    ),
  );
  expect(city.buildings.length).toBeGreaterThan(0);
  expect(city.streetCellLayout!.urbanBuildings).toBeGreaterThan(0);
  expect(city.streetCellLayout!.suburbanBuildings).toBeGreaterThan(0);
  expect(city.streetCellLayout!.sourceCells).toBe(1623);
  expect(city.localStreets).toEqual([]);
  expect(city.ground).toEqual([]);
  expect(city.far).toBe(city.buildings);
  expect(city.medium).toBe(city.buildings);
  expect(realFootprintViolations).toEqual([]);

  expect(
    buildStreetCellCity(
      cellCityMap,
      cellCityPopulation,
      cellCityMetadata,
      cellCityCells,
    ),
  ).toBe(city);
  expect(city.reservations!.length).toBe(22);
});

it('keeps pending C as empty research support and separates immutable cache inputs', () => {
  const pending = buildStreetCellCity(
    cellCityMap,
    cellCityPopulation,
    cellCityMetadata,
  );
  expect(pending.buildings).toEqual([]);
  expect(pending.reservations).toHaveLength(22);

  expect(
    buildStreetCellCity(cellCityMap, cellCityPopulation, {
      ...cellCityMetadata,
      sha256: 'new-research',
    }),
  ).not.toBe(pending);
  expect(
    buildStreetCellCity(
      { ...cellCityMap },
      cellCityPopulation,
      cellCityMetadata,
    ),
  ).not.toBe(pending);
  expect(
    emptyStreetCellCity(cellCityMap, cellCityPopulation).buildingSource,
  ).toBe('street-cells-C-empty');
});
it('rejects non-C or foreign data and safely skips ineligible or missing safe zones', () => {
  for (const invalid of [
    { ...cellCityCells, level: 'A' as const },
    { ...cellCityCells, annotations: undefined },
  ])
    expect(() =>
      buildStreetCellCity(
        cellCityMap,
        cellCityPopulation,
        cellCityMetadata,
        invalid,
      ),
    ).toThrow('require C');
  const sample = cellCityCells.features[0]!;
  const noZone = {
    ...cellCityCells,
    features: [sample],
    annotations: {
      ...cellCityCells.annotations!,
      cells: {
        [sample.id]: {
          ...cellCityCells.annotations!.cells[sample.id]!,
          classification: 'empty' as const,
          safeZoneCoordinates: null,
        },
      },
    },
  };
  const plan = buildStreetCellCity(
    cellCityMap,
    cellCityPopulation,
    cellCityMetadata,
    noZone,
  );
  expect(plan.buildings).toEqual([]);
  expect(plan.streetCellLayout!.skippedCells).toEqual([
    { cellId: sample.id, reason: 'no-safe-zone' },
  ]);
  const gates = {
    ...cellCityCells,
    features: cellCityCells.features.filter(
      (f) => cellCityCells.annotations!.cells[f.id]!.classification !== 'empty',
    ),
  };
  const gated = buildStreetCellCity(
    cellCityMap,
    cellCityPopulation,
    cellCityMetadata,
    gates,
  );
  expect(gated.buildings).toEqual([]);
  expect(gated.streetCellLayout!.roadCrossed).toBe(311);
  expect(gated.streetCellLayout!.nonDrawable).toBe(186);
});
it('honors zero population and fails before allocating an excessive parcel layout', () => {
  const selected = {
    ...cellCityCells,
    features: cellCityCells.features.filter((f) =>
      ['es-torrevieja-sc-1', 'es-torrevieja-sc-429'].includes(f.id),
    ),
  };
  const zero = buildStreetCellCity(
    cellCityMap,
    { ...cellCityPopulation, canonicalCells: [] },
    cellCityMetadata,
    selected,
  );
  expect(zero.buildings.length).toBeGreaterThan(0); // Trusted V3 footprint observations survive zero display support.
  const budgetGuard = vi
    .spyOn(cellLayout, 'iterateStreetCellBuildingLots')
    .mockImplementation((rings, crop, dimensions, angle) =>
      cellLayoutOriginal(rings, crop, dimensions, angle, 0),
    );
  try {
    expect(() =>
      buildStreetCellCity(
        cellCityMap,
        cellCityPopulation,
        cellCityMetadata,
        selected,
      ),
    ).toThrow('lot budget exceeded');
  } finally {
    budgetGuard.mockRestore();
  }
  expect(streetCellLotBudget).toBe(65536);
});
it('keeps complete footprints out of research masks and zone-crossing ambiguity', () => {
  const selected = {
    ...cellCityCells,
    features: cellCityCells.features.filter((f) =>
      ['es-torrevieja-sc-1', 'es-torrevieja-sc-429'].includes(f.id),
    ),
  };
  const polygon = {
    type: 'Polygon' as const,
    coordinates: [
      [
        [-1, 37],
        [0, 37],
        [0, 39],
        [-1, 39],
        [-1, 37],
      ] as const,
    ],
  };
  const protectedView = {
    ...cellCityMetadata,
    metadata: {
      ...cellCityMetadata.metadata,
      landscapeRegions: [
        {
          ...cellCityMetadata.metadata.landscapeRegions[0]!,
          boundary: polygon,
          buildability: 'none' as const,
        },
      ],
    },
  };
  const protectedCity = buildStreetCellCity(
    cellCityMap,
    cellCityPopulation,
    protectedView,
    selected,
  );
  expect(protectedCity.buildings.length).toBeGreaterThan(0);
  expect(
    protectedCity.streetCellLayout!.protectionConflicts!.length,
  ).toBeGreaterThan(0);
});

it('rejects a small protected polygon enclosed by a building envelope even when the population centers are outside it', () => {
  const original = buildStreetCellCity(
    cellCityMap,
    cellCityPopulation,
    cellCityMetadata,
    cellCityCells,
  );
  const building = original.buildings.find(
    (b) => b.cellId === 'es-torrevieja-sc-1',
  )!;
  const [x, z] = footprintRing(building)[0]!;
  const m = d3dMetreScale(cellCityMap).worldUnitsPerMetre;
  const ring = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
    [-1, -1],
  ].map(([u, v]) => {
    const p = d3dGeographicPoint(cellCityMap, { x: x + u! * m, z: z + v! * m });
    return [p.longitude, p.latitude] as const;
  });
  const view = {
    ...cellCityMetadata,
    metadata: {
      ...cellCityMetadata.metadata,
      landscapeRegions: [
        {
          ...cellCityMetadata.metadata.landscapeRegions[0]!,
          boundary: { type: 'Polygon' as const, coordinates: [ring] },
          buildability: 'none' as const,
        },
      ],
    },
  };
  const selected = {
    ...cellCityCells,
    features: cellCityCells.features.filter((f) => f.id === building.cellId),
  };
  const protectedCity = buildStreetCellCity(
    cellCityMap,
    cellCityPopulation,
    view,
    selected,
    cellCityTerrain,
    {
      reservations: [],
      polygons: [
        [
          ring.map(([longitude, latitude]) => {
            const p = d3dProjectedPoint(cellCityMap, { longitude, latitude });
            return [p.x, p.z] as const;
          }),
        ],
      ],
    },
  );
  expect(
    protectedCity.streetCellLayout!.rejectedCandidates['physical-clearance'],
  ).toBeGreaterThan(0);
  expect(protectedCity.buildings.some((b) => b.id === building.id)).toBe(false);
});
it('rejects colliding lots from an overlapping parcel-layout proposal', () => {
  const original = cellLayout.iterateStreetCellBuildingLots;
  const layout = vi
    .spyOn(cellLayout, 'iterateStreetCellBuildingLots')
    .mockImplementation(function* (...args) {
      for (const value of original(...args)) {
        yield value;
        yield value;
      }
    });
  try {
    const selected = {
      ...cellCityCells,
      features: cellCityCells.features.filter(
        (f) => f.id === 'es-torrevieja-sc-1',
      ),
    };
    const city = buildStreetCellCity(
      cellCityMap,
      cellCityPopulation,
      cellCityMetadata,
      selected,
    );
    expect(
      city.streetCellLayout!.rejectedCandidates['spacing'],
    ).toBeGreaterThan(0);
    expect(city.buildings.length).toBeGreaterThan(0);
  } finally {
    layout.mockRestore();
  }
});
it('keeps the shared primary-zone appearance query consistent with the complete research lookup', () => {
  const context = metadataLayout.metadataCityContext(
    cellCityMap,
    legacyCity.settlement!,
    {
      bounds: legacyCity.bounds,
      corridors: legacyCity.corridors,
    },
  );
  const point = city.buildings.find((b) => b.zoneId === 'z-central-grid')!;
  const geo = d3dGeographicPoint(cellCityMap, point);
  expect(context.zoneAt(point)).toBe(
    lookupSettlementZone(cellCityMetadata.metadata, [
      geo.longitude,
      geo.latitude,
    ])!.id,
  );
  expect(context.zoneAt({ x: 1e6, z: 1e6 })).toBeUndefined();
});
it('retains research storeys, prototypes, colors and stable local family repetition', () => {
  const city = buildStreetCellCity(
    cellCityMap,
    cellCityPopulation,
    cellCityMetadata,
    cellCityCells,
  );
  const urban = city.buildings.filter(
    (b) =>
      b.buildingProfileId === 'bp-central-mixed' ||
      b.buildingProfileId === 'bp-midrise-apartment',
  );
  const villas = city.buildings.filter(
    (b) => b.buildingProfileId === 'bp-detached-villa',
  );
  expect(Math.min(...urban.map((b) => b.storeys))).toBeGreaterThanOrEqual(2);
  expect(Math.max(...villas.map((b) => b.storeys))).toBeLessThanOrEqual(2);
  expect(villas.every((b) => b.archetype === 'detached-house')).toBe(true);
  for (const b of city.buildings) {
    if (!b.buildingProfileId) continue;
    const { profile, walls, roofs } = profileValues.get(b.buildingProfileId)!;
    expect(profile.allowedArchetypes).toContain(b.archetype);
    expect(b.storeys).toBeGreaterThanOrEqual(profile.storeys.min);
    expect(b.storeys).toBeLessThanOrEqual(profile.storeys.max);
    expect(walls).toContain(b.wallColor);
    expect(roofs).toContain(b.roofColor);
  }
  const repetitiveBlocks = city.blocks.filter((block) => {
    const local = buildingsByBlock.get(block.id)!;
    return (
      local.length > 1 && local[0]!.buildingProfileId === 'bp-terrace-bungalow'
    );
  });
  expect(repetitiveBlocks.length).toBeGreaterThan(0);
  for (const block of repetitiveBlocks) {
    const local = buildingsByBlock
      .get(block.id)!
      .filter((b) => b.buildingProfileId === 'bp-terrace-bungalow');
    expect(local.every((b) => b.cellId === block.cellId)).toBe(true);
    expect(new Set(local.map((b) => b.archetype)).size).toBe(1);
    expect(new Set(local.map((b) => b.wallColor)).size).toBe(1);
    expect(new Set(local.map((b) => b.roofColor)).size).toBe(1);
  }
});

it('does not trust a safe zone that extends beyond its original C planning boundary', () => {
  const selected = cellCityCells.features.find(
    (f) => f.id === 'es-torrevieja-sc-1',
  )!;
  const point = selected.geometry.coordinates[0]![0]!;
  const tiny = [
    point,
    [point[0] + 0.000001, point[1]],
    [point[0] + 0.000001, point[1] + 0.000001],
    [point[0], point[1] + 0.000001],
    point,
  ] as const;
  const cells = {
    ...cellCityCells,
    features: [
      {
        ...selected,
        geometry: { type: 'Polygon' as const, coordinates: [tiny] },
      },
    ],
  };
  const city = buildStreetCellCity(
    cellCityMap,
    cellCityPopulation,
    cellCityMetadata,
    cells,
  );
  expect(city.buildings).toEqual([]);
  expect(
    city.streetCellLayout!.rejectedCandidates['safe-zone-footprint'],
  ).toBeGreaterThan(0);
});

it('measures safety diagnostics from actual building provenance and footprint, including deliberately invalid descriptors', () => {
  const city = buildStreetCellCity(
    cellCityMap,
    cellCityPopulation,
    cellCityMetadata,
    cellCityCells,
  );
  expect(
    auditStreetCellBuildings(cellCityMap, cellCityCells, city.buildings),
  ).toEqual({ outsideSafeZone: 0, ineligible: 0 });
  const first = city.buildings[0]!;
  expect(
    auditStreetCellBuildings(cellCityMap, cellCityCells, [
      { ...first, x: 1e6, z: 1e6 },
    ]),
  ).toEqual({ outsideSafeZone: 1, ineligible: 0 });
  const crossed = cellCityCells.features.find(
    (f) =>
      cellCityCells.annotations!.cells[f.id]!.classification === 'road-crossed',
  )!;
  expect(
    auditStreetCellBuildings(cellCityMap, cellCityCells, [
      { ...first, cellId: crossed.id },
    ]).ineligible,
  ).toBe(1);
  expect(
    auditStreetCellBuildings(cellCityMap, cellCityCells, [
      { ...first, cellId: 'missing-cell' },
    ]),
  ).toEqual({ outsideSafeZone: 1, ineligible: 1 });
  const none = cellCityCells.features.find(
    (f) =>
      cellCityCells.annotations!.cells[f.id]!.classification === 'non-drawable',
  )!;
  expect(
    auditStreetCellBuildings(cellCityMap, cellCityCells, [
      { ...first, cellId: none.id },
    ]),
  ).toEqual({ outsideSafeZone: 1, ineligible: 1 });
});

it('replaces the sparse Pass 1 reference with developed, repeated safe-zone fabrics', () => {
  expect(city.buildings.length).toBeGreaterThan(594 * 3);
  expect(city.streetCellLayout!.usableEmptyCells).toBeGreaterThan(91 * 3);
  const central = city.buildings.filter((b) => b.zoneId === 'z-central-grid');
  expect(central.length).toBeGreaterThan(20);
  const counts = new Map<string, number>();
  for (const b of city.buildings)
    counts.set(b.cellId!, (counts.get(b.cellId!) ?? 0) + 1);
  expect(
    [...counts.values()].filter((n) => n > 1).length / counts.size,
  ).toBeGreaterThan(0.8);
  expect(city.streetCellLayout!.outsideSafeZone).toBe(0);
  expect(city.streetCellLayout!.ineligible).toBe(0);
});

it('uses one shared primary research-zone rule for cheap frontage filtering and full context', () => {
  const metadata = cellCityMetadata.metadata;
  for (const point of [
    [-0.686, 37.982],
    [-0.681, 37.976],
    [-0.705, 37.99],
    [0, 0],
  ] as const)
    expect(lookupSettlementZone(metadata, point)?.id).toBe(
      lookupSettlementContext(metadata, point).zoneId,
    );
  const clone = { ...metadata };
  expect(lookupSettlementZone(clone, [0, 0])).toBeUndefined();
});
