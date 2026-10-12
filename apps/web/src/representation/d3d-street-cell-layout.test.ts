import { expect, it } from 'vitest';
import {
  streetCellBuildingLots,
  streetCellFootprintCalibration,
} from './d3d-street-cell-layout.js';
import { footprintInside, footprintRing } from './d3d-footprint.js';
const rings = [
  [
    [0, 0],
    [200, 0],
    [200, 100],
    [0, 100],
    [0, 0],
  ] as const,
];
const bounds = { minX: 0, maxX: 200, minZ: 0, maxZ: 100 };
const urban = {
  width: 10,
  depth: 18,
  gap: 1,
  interiorGap: 3,
  parcelWidth: 14,
  parcelDepth: 26,
};
it('packs long streetfronts and secondary rows with a denser urban rhythm than garden lots', () => {
  const dense = streetCellBuildingLots(rings, bounds, urban, 0, 1000);
  const suburb = streetCellBuildingLots(
    rings,
    bounds,
    {
      width: 10,
      depth: 16,
      gap: 8,
      interiorGap: 10,
      parcelWidth: 20,
      parcelDepth: 30,
    },
    0,
    1000,
  );
  const inside = (lots: typeof dense) =>
    lots.filter((p) =>
      footprintInside(
        footprintRing({ ...p, width: urban.width, depth: urban.depth }),
        rings,
        0.001,
      ),
    );
  expect(inside(dense).length).toBeGreaterThan(inside(suburb).length);
  expect(dense.filter((p) => p.band === 'frontage').length).toBeGreaterThan(40);
  expect(dense.filter((p) => p.band === 'interior').length).toBeGreaterThan(20);
  expect(dense.some((p) => p.corner)).toBe(true);
  expect(streetCellBuildingLots(rings, bounds, urban, 0, 1000)).toEqual(dense);
  expect(streetCellFootprintCalibration.urban.areaMedianSqm).toBeCloseTo(
    120.34,
    2,
  );
  expect(streetCellFootprintCalibration.suburban.areaMedianSqm).toBeCloseTo(
    71.42,
    2,
  );
});
it('joins subdivided straight boundaries, handles winding/holes and keeps original source rings unchanged', () => {
  const outer = Array.from({ length: 21 }, (_, i) => [i * 10, 0] as const);
  const source = [
    [...outer, [200, 100] as const, [0, 100] as const, [0, 0] as const],
    [
      [80, 30],
      [120, 30],
      [120, 70],
      [80, 70],
      [80, 30],
    ] as const,
  ];
  const copy = JSON.stringify(source);
  const lots = streetCellBuildingLots(source, bounds, urban, 0, 1000);
  expect(
    lots.filter((p) => p.band === 'frontage' && Math.abs(p.z - 9) < 0.001)
      .length,
  ).toBeGreaterThan(10);
  const valid = lots.filter((p) =>
    footprintInside(
      footprintRing({ ...p, width: urban.width, depth: urban.depth }),
      source,
      0.001,
    ),
  );
  expect(valid.length).toBeGreaterThan(20);
  expect(
    valid.every((p) => p.x < 80 || p.x > 120 || p.z < 30 || p.z > 70),
  ).toBe(true);
  const reversed = streetCellBuildingLots(
    [[...rings[0]!].reverse()],
    bounds,
    urban,
    0,
    1000,
  );
  expect(reversed.some((p) => p.z === 9)).toBe(true);
  expect(JSON.stringify(source)).toBe(copy);
});
it('bounds proposals before geometric allocation and handles short, concave and zero-length edges', () => {
  expect(() => streetCellBuildingLots(rings, bounds, urban, 0, 1)).toThrow(
    'lot budget',
  );
  const awkward = [
    [
      [0, 0],
      [0, 0],
      [30, 0],
      [30, 5],
      [10, 5],
      [10, 30],
      [0, 30],
      [0, 0],
    ] as const,
  ];
  const lots = streetCellBuildingLots(
    awkward,
    { minX: 0, maxX: 30, minZ: 0, maxZ: 30 },
    urban,
    Math.PI / 4,
    1000,
  );
  expect(lots.every((p) => Number.isFinite(p.x + p.z + p.rotation))).toBe(true);
  expect(
    streetCellBuildingLots(
      [
        [
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
        ],
      ],
      { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
      urban,
      1,
      1,
    ),
  ).toEqual([]);
});

it('rejects excessive frontage and interior traversal before preparing large arrays', () => {
  expect(() =>
    streetCellBuildingLots(
      rings,
      bounds,
      { ...urban, width: 0.001, gap: 0 },
      0,
      1,
    ),
  ).toThrow('lot budget');
  expect(() =>
    streetCellBuildingLots(
      [
        [
          [0, 0],
          [10, 0],
          [0, 10],
          [0, 0],
        ],
      ],
      { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 },
      urban,
      0,
      1,
    ),
  ).toThrow('lot budget');
});

it('rejects invalid dimensions before any zero or negative stepping can begin', () => {
  for (const dimensions of [
    { ...urban, width: NaN },
    { ...urban, depth: -1 },
    { ...urban, gap: -0.5 },
    { ...urban, gap: Infinity },
  ])
    expect(() =>
      streetCellBuildingLots(rings, bounds, dimensions, 0, 1000),
    ).toThrow('Invalid StreetCell lot dimensions');
  expect(() => streetCellBuildingLots(rings, bounds, urban, NaN, 1000)).toThrow(
    'Invalid StreetCell lot dimensions',
  );
});

it('respects a caller center filter without emitting or consuming a geometric lot budget', () => {
  expect(
    streetCellBuildingLots(rings, bounds, urban, 0, 1000, () => false),
  ).toEqual([]);
});
