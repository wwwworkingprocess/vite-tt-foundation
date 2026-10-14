import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  cellCityMap,
  cellCityPopulation,
  cellCityCells,
  cellCityTerrain,
  cellCityMetadata,
  alicanteCellCityFixture,
} from '../test/street-cell-city-fixture.js';
import {
  buildStreetCellCity,
  streetCellLandmarkProtections,
  streetCellNativeLand,
} from './d3d-street-cell-city.js';
import { planStreetCellRoads } from './d3d-street-cell-roads.js';
import { d3dProjectedPoint } from './d3d-map-model.js';
import {
  footprintRing,
  footprintInside,
  createFootprintIndex,
} from './d3d-footprint.js';
const fixtures = [
  {
    id: 'es-torrevieja',
    model: cellCityMap,
    population: cellCityPopulation,
    cells: cellCityCells,
    terrain: cellCityTerrain,
    view: cellCityMetadata,
    hash: '473257f82ca5c24627da2b2d6f874523c71030ac455107a594469587839f85b4',
    count: 8878,
  },
  {
    id: 'es-alicante',
    ...alicanteCellCityFixture(),
    view: undefined,
    hash: 'd1e3ca2a49d332e2192ddf01f68bddcb2c25a6bf4c903146d1f2f649642ea5ff',
    count: 9331,
  },
];
const results = fixtures.map((f) => {
  const protections = f.view
    ? streetCellLandmarkProtections(f.model, f.view)
    : undefined;
  const city = buildStreetCellCity(
    f.model,
    f.population,
    f.view,
    f.cells,
    f.terrain,
    protections,
  );
  const without = buildStreetCellCity(
    f.model,
    f.population,
    undefined,
    f.cells,
    f.terrain,
    protections,
  );
  const slot = (b: (typeof city.buildings)[number]) => [
    b.id,
    b.cellId,
    b.x,
    b.z,
    b.width,
    b.depth,
    b.rotation,
  ];
  const pass1 = city.buildings.filter(
    (b) => f.cells.annotations!.cells[b.cellId!]!.classification === 'empty',
  );
  const pass2 = city.buildings.filter(
    (b) =>
      f.cells.annotations!.cells[b.cellId!]!.classification === 'road-crossed',
  );
  const violations: string[] = [];
  const byCell = new Map<string, (typeof city.buildings)[number][]>();
  for (const b of pass2) {
    const list = byCell.get(b.cellId!) ?? [];
    list.push(b);
    byCell.set(b.cellId!, list);
  }
  for (const [id, buildings] of byCell) {
    const a = f.cells.annotations!.cells[id]!,
      feature = f.cells.features.find((c) => c.id === id)!;
    const project = ([longitude, latitude]: readonly [number, number]) =>
      d3dProjectedPoint(f.model, { longitude, latitude });
    const rings = (r: typeof feature.geometry.coordinates) =>
      r.map((r) =>
        r.map((p) => {
          const q = project(p);
          return [q.x, q.z] as const;
        }),
      );
    const safe = rings(a.safeZoneCoordinates!),
      original = rings(feature.geometry.coordinates),
      roads = planStreetCellRoads(
        a.roads,
        f.cells.annotations!.roadMetadata,
        project,
        f.terrain.metre,
      ),
      index = createFootprintIndex(50 * f.terrain.metre, 0);
    for (const b of buildings) {
      const ring = footprintRing(b);
      if (
        !footprintInside(ring, safe, 0) ||
        !footprintInside(ring, original, 0) ||
        roads.conflicts(ring) ||
        !streetCellNativeLand(f.model, f.terrain, ring) ||
        !index.add(b.id, ring)
      )
        violations.push(b.id);
    }
  }
  return {
    f,
    city,
    without,
    pass1,
    pass2,
    violations,
    slots: city.buildings.map(slot),
    noResearchSlots: without.buildings.map(slot),
    hash: createHash('sha256')
      .update(JSON.stringify(pass1.map(slot)))
      .digest('hex'),
  };
});
for (const r of results)
  it(`${r.f.id}: pins refined frontage layouts for both passes with complete geographic safety`, () => {
    expect(r.pass1).toHaveLength(r.f.count);
    expect(r.hash).toBe(r.f.hash);
    expect(r.city.buildings).toHaveLength(
      r.f.id === 'es-torrevieja' ? 17562 : 13804,
    );
    expect(
      createHash('sha256').update(JSON.stringify(r.slots)).digest('hex'),
    ).toBe(
      r.f.id === 'es-torrevieja'
        ? '944cc75594313e949cbe45aeeb5d5e10ee1b5411dcf4b71f2d3c4b77a7a1ae20'
        : '48d610a2dcf7ac0ac1f0d1a800661eda4db31cb9be341d0c47ac8706d9396091',
    );
    expect(r.violations).toEqual([]);
    expect(r.slots).toEqual(r.noResearchSlots);
    expect(r.city.streetCellLayout!.outsideSafeZone).toBe(0);
    expect(r.city.streetCellLayout!.ineligible).toBe(0);
    expect(r.city.streetCellLayout!.candidates).toBeLessThanOrEqual(65536);
    expect(
      buildStreetCellCity(
        r.f.model,
        r.f.population,
        r.f.view,
        r.f.cells,
        r.f.terrain,
        r.f.view
          ? streetCellLandmarkProtections(r.f.model, r.f.view)
          : undefined,
      ),
    ).toBe(r.city);
  });
it('records road-crossed cells with no at-grade reservation without placing a speculative frontage', () => {
  const f = cellCityCells.features.find(
    (c) =>
      cellCityCells.annotations!.cells[c.id]!.classification === 'road-crossed',
  )!;
  const a = cellCityCells.annotations!.cells[f.id]!;
  const cells = {
    ...cellCityCells,
    features: [f],
    annotations: {
      ...cellCityCells.annotations!,
      cells: {
        [f.id]: {
          ...a,
          roads: a.roads.map((r) => ({ ...r, disposition: 'grade-separated' })),
        },
      },
    },
  };
  const city = buildStreetCellCity(
    cellCityMap,
    cellCityPopulation,
    undefined,
    cells,
    cellCityTerrain,
  );
  expect(city.buildings).toEqual([]);
  expect(city.streetCellLayout!.skippedCells).toEqual([
    { cellId: f.id, reason: 'no-at-grade-guide' },
  ]);
  expect(city.streetCellLayout!.pass2).toMatchObject({
    eligible: 0,
    processed: 1,
    occupied: 0,
    buildings: 0,
    guideSegments: 0,
  });
});
import { d3dGeographicPoint } from './d3d-map-model.js';
import type { StreetCellAssociation } from './street-cells.js';
const center = results[0]!.pass2[0]!;
const m = cellCityTerrain.metre;
const syntheticMap = { ...cellCityMap, routes: [], stops: [] };
const syntheticTerrain = {
  ...cellCityTerrain,
  terrain: { ...cellCityTerrain.terrain, classify: () => 'land' as const },
};
const syntheticPoint = ([x, z]: readonly [number, number]) => {
  const g = d3dGeographicPoint(syntheticMap, {
    x: center.x + x * m,
    z: center.z + z * m,
  });
  return [g.longitude, g.latitude] as const;
};
const outer = [
  [-80, -60],
  [80, -60],
  [80, 60],
  [-80, 60],
  [-80, -60],
] as const;
const roadFixture = (
  coordinates: readonly (readonly [number, number])[],
  disposition = 'internal',
  id = 'r',
  segment = 0,
): StreetCellAssociation => ({
  roadId: id,
  sourceSegment: segment,
  disposition,
  lengthM: 100,
  corridorAreaSqm: 100,
  clippedCoordinates: coordinates.map(syntheticPoint),
});
const syntheticCells = (
  roads: readonly StreetCellAssociation[],
  rings: readonly (readonly (readonly [number, number])[])[] = [outer],
) => {
  const feature = cellCityCells.features[0]!,
    a = cellCityCells.annotations!.cells[feature.id]!;
  const coordinates = rings.map((r) => r.map(syntheticPoint));
  return {
    ...cellCityCells,
    features: [
      { ...feature, geometry: { type: 'Polygon' as const, coordinates } },
    ],
    annotations: {
      ...cellCityCells.annotations!,
      roadMetadata: {
        '"r"': [
          'residential',
          null,
          null,
          null,
          0,
          null,
          null,
          false,
          true,
          [6, 'class-fallback'],
        ],
        '"s"': [
          'service',
          null,
          null,
          null,
          0,
          4,
          null,
          false,
          true,
          [4, 'tag'],
        ],
      },
      cells: {
        [feature.id]: {
          ...a,
          classification: 'road-crossed' as const,
          safeZoneCoordinates: coordinates,
          safeAreaSqm: 19200,
          roads,
          buildingEvidence: {
            ...a.buildingEvidence,
            safeRepresentativeCount: 60,
            safeFootprintUnionAreaSqm: 4000,
            safeFootprintCoverage: 0.3,
          },
        },
      },
    },
  };
};
for (const [name, roads] of [
  [
    'straight',
    [
      roadFixture([
        [-80, 0],
        [80, 0],
      ]),
    ],
  ],
  [
    'crossing',
    [
      roadFixture([
        [-80, 0],
        [80, 0],
      ]),
      roadFixture(
        [
          [0, -60],
          [0, 60],
        ],
        'internal',
        's',
      ),
    ],
  ],
  [
    'joined',
    [
      roadFixture([
        [-80, 0],
        [-40, 0],
      ]),
      roadFixture(
        [
          [-40, 0],
          [0, 0],
        ],
        'internal',
        'r',
        1,
      ),
      roadFixture(
        [
          [0, 0],
          [80, 0],
        ],
        'internal',
        'r',
        2,
      ),
    ],
  ],
  [
    'curve',
    [
      roadFixture([
        [-80, 0],
        [0, 0],
        [40, 40],
      ]),
    ],
  ],
  [
    'perimeter',
    [
      roadFixture([
        [-80, -55],
        [80, -55],
      ]),
    ],
  ],
  [
    'support only',
    [
      roadFixture(
        [
          [-80, 0],
          [80, 0],
        ],
        'corridor-support',
      ),
    ],
  ],
  [
    'short',
    [
      roadFixture(
        [
          [-10, 0],
          [10, 0],
        ],
        'short',
      ),
    ],
  ],
] as const)
  it(`composes ${name} through the shared pipeline with full corridor safety`, () => {
    const cells = syntheticCells(roads),
      city = buildStreetCellCity(
        syntheticMap,
        cellCityPopulation,
        undefined,
        cells,
        syntheticTerrain,
      ),
      a = cells.annotations.cells[cells.features[0]!.id]!;
    expect(city.buildings.length).toBeGreaterThan(0);
    const plan = planStreetCellRoads(
      roads,
      cells.annotations.roadMetadata,
      ([longitude, latitude]) =>
        d3dProjectedPoint(syntheticMap, { longitude, latitude }),
      m,
    );
    expect(
      city.buildings.filter((b) => plan.conflicts(footprintRing(b))),
    ).toEqual([]);
    expect(a.safeZoneCoordinates).toEqual(
      cells.features[0]!.geometry.coordinates,
    );
    const reordered = syntheticCells([...roads].reverse());
    expect(
      buildStreetCellCity(
        syntheticMap,
        cellCityPopulation,
        undefined,
        reordered,
        syntheticTerrain,
      ).buildings,
    ).toEqual(city.buildings);
  });
it('keeps hole, protected and native-water exclusions in Pass 2 and leaves tiny residual cells empty', () => {
  const roads = [
      roadFixture([
        [-80, 0],
        [80, 0],
      ]),
    ],
    hole = [
      [-20, 20],
      [20, 20],
      [20, 50],
      [-20, 50],
      [-20, 20],
    ] as const;
  const cells = syntheticCells(roads, [outer, hole]),
    city = buildStreetCellCity(
      syntheticMap,
      cellCityPopulation,
      undefined,
      cells,
      syntheticTerrain,
    );
  expect(city.buildings.length).toBeGreaterThan(0);
  const rings = [outer, hole].map((r) =>
    r.map((p) => [center.x + p[0] * m, center.z + p[1] * m] as const),
  );
  expect(
    city.buildings.filter((b) => !footprintInside(footprintRing(b), rings, 0)),
  ).toEqual([]);
  const protectedCity = buildStreetCellCity(
    syntheticMap,
    cellCityPopulation,
    undefined,
    cells,
    syntheticTerrain,
    { reservations: [], polygons: [rings] },
  );
  expect(protectedCity.buildings).toEqual([]);
  expect(
    protectedCity.streetCellLayout!.rejectedCandidates['physical-clearance'],
  ).toBeGreaterThan(0);
  const water = buildStreetCellCity(
    syntheticMap,
    cellCityPopulation,
    undefined,
    cells,
    {
      ...syntheticTerrain,
      terrain: {
        ...syntheticTerrain.terrain,
        classify: () => 'water' as const,
      },
    },
  );
  expect(water.buildings).toEqual([]);
  expect(
    water.streetCellLayout!.rejectedCandidates['native-water-or-coverage'],
  ).toBeGreaterThan(0);
  const tiny = syntheticCells(roads, [
    [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ],
  ]);
  expect(
    buildStreetCellCity(
      syntheticMap,
      cellCityPopulation,
      undefined,
      tiny,
      syntheticTerrain,
    ).buildings,
  ).toEqual([]);
});

for (const r of results)
  it(`${r.f.id}: assigns restrained deterministic appearance without changing research-independent slots`, () => {
    expect(
      new Set(r.without.buildings.map((b) => b.wallColor)).size,
    ).toBeGreaterThan(1);
    expect(
      new Set(r.without.buildings.map((b) => b.roofColor)).size,
    ).toBeGreaterThan(1);
    expect(
      new Set(r.without.buildings.map((b) => b.prototype ?? b.archetype)).size,
    ).toBeGreaterThan(2);
    expect(
      r.without.buildings.every((b) => b.storeys >= 1 && b.storeys <= 6),
    ).toBe(true);
    expect(r.without.buildings.map((b) => [b.width, b.depth, b.id])).toEqual(
      r.city.buildings.map((b) => [b.width, b.depth, b.id]),
    );
  });

it('fills four feasible real urban frontage spans around a protected courtyard and shares a real crossed triangle', () => {
  const tor = results[0]!.city;
  const rectangle = tor.streetCellLayout!.ledger.find(
    (r) => r.cellId === 'es-torrevieja-sc-145',
  )!;
  expect(rectangle.courtyard).toBe(true);
  expect(rectangle.rectangularity).toBeGreaterThan(0.95);
  expect(Object.values(rectangle.frontageSpans).sort()).toEqual([6, 6, 6, 6]);
  expect(
    tor.buildings
      .filter((b) => b.cellId === rectangle.cellId)
      .every((b) => b.layoutBand === 'frontage'),
  ).toBe(true);
  expect(
    rectangle.occupiedFootprintSqm / rectangle.safeAreaSqm,
  ).toBeGreaterThan(0.3);
  const triangle = tor.streetCellLayout!.ledger.find(
    (r) => r.cellId === 'es-torrevieja-sc-1031',
  )!;
  expect(triangle.classification).toBe('road-crossed');
  expect(triangle.rectangularity).toBeLessThan(0.55);
  expect(Object.keys(triangle.frontageSpans).length).toBeGreaterThan(10);
  expect(
    Math.max(...Object.values(triangle.frontageSpans)) / triangle.buildings,
  ).toBeLessThan(0.3);
  expect(triangle.reasons['internal-road-corridor']).toBeGreaterThan(0);
});
