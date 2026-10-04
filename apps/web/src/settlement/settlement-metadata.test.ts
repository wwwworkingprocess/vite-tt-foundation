import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  listActivePopulationCells,
  parseCityPopulationGrid,
} from '@torrevieja-tycoon/transport-domain';
import {
  parseSettlementMetadata,
  type SettlementMetadata,
} from './settlement-metadata.js';
import {
  diagnoseLandmarkAssociations,
  lookupSettlementContext,
  pointInPolygon,
  polygonArea,
} from './settlement-metadata-spatial.js';
import { enrichSettlementPopulation } from './settlement-population-overlay.js';
import { landmarkReservationMetres } from './settlement-metadata-spatial.js';

it('accepts unassociated landmarks with bounded default reservations', () => {
  const value = structuredClone(source);
  value.landmarks[0]!.districtId = null;
  value.landmarks[0]!.zoneId = null;
  const accepted = parseSettlementMetadata(value);
  expect(
    landmarkReservationMetres(accepted, accepted.landmarks[0]!),
  ).toBeGreaterThanOrEqual(12);
});

type Mutable<T> = {
  -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K];
};
// A validated fixture clone is mutable solely for corruption tests; runtime data stays readonly.
const source = structuredClone(
  parseSettlementMetadata(
    JSON.parse(
      readFileSync(
        join(
          import.meta.dirname,
          '..',
          '..',
          'public',
          'settlement-metadata',
          'torrevieja',
          'torrevieja-settlement-metadata.v0.json',
        ),
        'utf8',
      ),
    ) as unknown,
  ),
) as Mutable<SettlementMetadata>;
const metadata = () => parseSettlementMetadata(source);

it('accepts the immutable real V0 package and diagnoses semantic landmark associations without rewriting provenance', () => {
  const before = structuredClone(source);
  const value = metadata();
  expect([
    value.sourceRegistry.length,
    value.urbanProfiles.length,
    value.buildingProfiles.length,
    value.districts.length,
    value.zones.length,
    value.landmarks.length,
    value.landscapeRegions.length,
  ]).toEqual([35, 11, 10, 13, 31, 22, 6]);
  expect(value.schemaVersion).toBe('0.1.0');
  expect(Object.isFrozen(value.zones[0]!.boundary.coordinates[0])).toBe(true);
  expect(structuredClone(value)).toEqual(value);
  expect(source).toEqual(before);
  expect(Object.isFrozen(source)).toBe(false);
  expect(diagnoseLandmarkAssociations(value).map((v) => v.landmarkId)).toEqual([
    'lm-eras-sal',
    'lm-hospital-quiron',
    'lm-palacio-deportes',
  ]);
  expect(
    value.landmarks.find((v) => v.id === 'lm-eras-sal')!.coordinate,
  ).toEqual([-0.68523, 37.97557]);
});

it('rejects corrupt schema, identifiers, cross references, ranges, mixes and geographic coordinates', () => {
  const corruptions = [
    (v: typeof source) => {
      Object.assign(v, { schemaVersion: '1.0.0' });
    },
    (v: typeof source) => {
      v.sourceRegistry[0]!.url = 'relative/source';
    },
    (v: typeof source) => {
      v.landmarks[0]!.coordinate = [181, 37.98];
    },
    (v: typeof source) => {
      v.landmarks[0]!.coordinate = [-0.685, 91];
    },
    (v: typeof source) => {
      v.zones.push(v.zones[0]!);
    },
    (v: typeof source) => {
      v.zones[0]!.districtId = 'missing';
    },
    (v: typeof source) => {
      v.districts[0]!.zoneIds.push('missing');
    },
    (v: typeof source) => {
      v.districts[0]!.landmarkIds.push('missing');
    },
    (v: typeof source) => {
      v.zones[0]!.urbanProfileId = 'missing';
    },
    (v: typeof source) => {
      v.zones[0]!.buildingProfileMix[0]!.buildingProfileId = 'missing';
    },
    (v: typeof source) => {
      v.zones[0]!.sourceIds.push('SRC-999');
    },
    (v: typeof source) => {
      v.landmarks[0]!.districtId = 'missing';
    },
    (v: typeof source) => {
      v.landmarks[0]!.zoneId = 'missing';
    },
    (v: typeof source) => {
      v.landmarks[0]!.districtId = v.districts[1]!.id;
    },
    (v: typeof source) => {
      v.districts[1]!.zoneIds.push(v.zones[0]!.id);
    },
    (v: typeof source) => {
      v.zones[0]!.buildingProfileMix[0]!.weight = 0.5;
    },
    (v: typeof source) => {
      v.urbanProfiles[0]!.typicalBlockWidthM.min = 999;
    },
    (v: typeof source) => {
      v.urbanProfiles[0]!.setbackM.frontMin = 9;
    },
    (v: typeof source) => {
      v.buildingProfiles[0]!.storeys.typicalMin = 99;
    },
    (v: typeof source) => {
      v.zones[0]!.boundary.coordinates[0]!.pop();
    },
    (v: typeof source) => {
      v.zones[0]!.boundary.coordinates = [
        [
          [-0.69, 37.98],
          [-0.68, 37.98],
          [-0.67, 37.98],
          [-0.69, 37.98],
        ],
      ];
    },
    (v: typeof source) => {
      v.landmarks[0]!.coordinate = [37.97, -0.68];
    },
    (v: typeof source) => {
      v.landmarks[0]!.coordinate = [-0.9, 37.98];
    },
    (v: typeof source) => {
      v.city.researchBounds.west = 0;
    },
  ];
  for (const corrupt of corruptions) {
    const value = structuredClone(source);
    corrupt(value);
    expect(() => parseSettlementMetadata(value)).toThrow();
  }
});

it('uses boundary-aware polygons, area then lexical overlap order, semantic districts, gaps and landscape precedence', () => {
  const square = {
    type: 'Polygon' as const,
    coordinates: [
      [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
        [0, 0],
      ] as [number, number][],
    ],
  };
  expect(pointInPolygon([1, 1], square)).toBe(true);
  expect(pointInPolygon([0, 1], square)).toBe(true);
  expect(pointInPolygon([3, 1], square)).toBe(false);
  expect(polygonArea(square)).toBe(4);
  const hole = {
    ...square,
    coordinates: [
      ...square.coordinates,
      [
        [0.5, 0.5],
        [1.5, 0.5],
        [1.5, 1.5],
        [0.5, 1.5],
        [0.5, 0.5],
      ] as [number, number][],
    ],
  };
  expect(pointInPolygon([1, 1], hole)).toBe(false);
  expect(pointInPolygon([0.5, 1], hole)).toBe(false);
  expect(polygonArea(hole)).toBe(3);
  const value = metadata();
  const base = value.zones[0]!;
  const fixture = {
    ...value,
    zones: [
      { ...base, id: 'z-b' },
      { ...base, id: 'z-a' },
      {
        ...value.zones[1]!,
        id: 'z-small',
        boundary: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [-0.686, 37.976],
              [-0.684, 37.976],
              [-0.684, 37.978],
              [-0.686, 37.978],
              [-0.686, 37.976],
            ] as [number, number][],
          ],
        },
      },
    ],
  };
  const match = lookupSettlementContext(fixture, [-0.685, 37.977]);
  expect(match.overlappingZoneIds).toEqual(['z-small', 'z-a', 'z-b']);
  expect(
    lookupSettlementContext(
      { ...fixture, zones: [...fixture.zones].reverse() },
      [-0.685, 37.977],
    ).overlappingZoneIds,
  ).toEqual(match.overlappingZoneIds);
  expect(match.zoneId).toBe('z-small');
  expect(match.districtId).toBe(base.districtId);
  expect(
    lookupSettlementContext(
      { ...fixture, zones: fixture.zones.slice(0, 2) },
      [-0.685, 37.977],
    ).zoneId,
  ).toBe('z-a');
  expect(
    lookupSettlementContext(value, [-0.805, 38.06]).zoneId,
  ).toBeUndefined();
  expect(lookupSettlementContext(value, [-0.75, 37.98]).buildability).toBe(
    'none',
  );
  expect(
    lookupSettlementContext(
      {
        ...value,
        landscapeRegions: value.landscapeRegions.filter(
          (v) => v.buildability !== 'none',
        ),
      },
      [-0.75, 37.98],
    ).buildability,
  ).toBe('strongly-constrained');
  expect(
    lookupSettlementContext(
      { ...value, landscapeRegions: [] },
      [-0.685, 37.977],
    ).buildability,
  ).toBe('default');
});

it('enriches population identities and exact weights without changing grid, crop, quantity or demand meaning', () => {
  const grid = parseCityPopulationGrid({
    schemaVersion: '1.0.0',
    cityId: 'Q36730',
    gridVersion: '1.0.0',
    originCellCenter: { latitude: 37.97749, longitude: -0.68285 },
    resolutionDegrees: 0.001,
    rowDirection: 'north-to-south',
    columnDirection: 'west-to-east',
    rows: 2,
    columns: 3,
    populationWeights: [
      [10, 0, 30],
      [40, 50, 60],
    ],
  });
  const population = {
    grid,
    crop: { rowStart: 0, rowEnd: 2, columnStart: 0, columnEnd: 3 },
    canonicalCells: listActivePopulationCells(grid),
  };
  const value = metadata();
  const enriched = enrichSettlementPopulation(population, value);
  expect(enriched.population).toBe(population);
  expect(enriched.cells.map((c) => c.cell)).toEqual(population.canonicalCells);
  expect(
    enriched.cells.reduce((sum, c) => sum + c.cell.populationWeight, 0),
  ).toBe(190);
  expect(enriched.cells[0]!.nearbyLandmarkIds).toContain(
    'lm-plaza-constitucion',
  );
  expect(enriched.diagnostics.totalCells).toBe(6);
  expect(enriched.diagnostics.nonzeroCells).toBe(5);
  expect(enrichSettlementPopulation(population, value)).toEqual(enriched);
  expect(Object.isFrozen(enriched.cells[0])).toBe(true);
  expect(Object.isFrozen(enriched.cells[0]!.nearbyLandmarkIds)).toBe(true);
  const replaced = enrichSettlementPopulation(population, {
    ...value,
    zones: value.zones.map((zone) => ({
      ...zone,
      boundary: {
        type: 'Polygon',
        coordinates: [
          [
            [-0.8, 38.06],
            [-0.79, 38.06],
            [-0.79, 38.064],
            [-0.8, 38.064],
            [-0.8, 38.06],
          ],
        ],
      },
    })),
  });
  expect(replaced.cells.map((c) => c.cell)).toEqual(population.canonicalCells);
  expect(replaced.diagnostics.cellsWithoutZone).toBe(5);
  expect(replaced.diagnostics.cellsWithZone).toBe(0);
  expect(Object.isFrozen(population)).toBe(false);
});
