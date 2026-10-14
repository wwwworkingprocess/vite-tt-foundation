import { expect, it } from 'vitest';
import { streetCellBuildingLots } from './d3d-street-cell-layout.js';
import {
  footprintInside,
  footprintRing,
  footprintOverlaps,
  createFootprintIndex,
} from './d3d-footprint.js';
import { streetCellForm, streetCellStoreys } from './d3d-street-cell-policy.js';
const ring = [
  [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
    [0, 0],
  ],
] as const;
const dimensions = {
  width: 10,
  depth: 15,
  gap: 1,
  interiorGap: 2,
  parcelWidth: 9.6,
  parcelDepth: 14.6,
};
it('offers all four frontage spans before exhausting a rectangle and preserves canonical proposal identities', () => {
  const legacy = streetCellBuildingLots(
    ring,
    { minX: 0, maxX: 100, minZ: 0, maxZ: 100 },
    dimensions,
    0,
    1000,
  );
  const fair = streetCellBuildingLots(
    ring,
    { minX: 0, maxX: 100, minZ: 0, maxZ: 100 },
    dimensions,
    0,
    1000,
    undefined,
    [],
    { balanced: true, frontageOnly: true },
  );
  expect(new Set(fair.slice(0, 4).map((p) => p.spanId)).size).toBe(4);
  expect(fair.every((p) => p.band === 'frontage')).toBe(true);
  for (const lot of fair)
    expect(legacy[lot.ordinal!]).toMatchObject({
      x: lot.x,
      z: lot.z,
      rotation: lot.rotation,
    });
});
it('balances triangle frontages, leaves holes to containment, and does not invent a courtyard in skinny geometry', () => {
  const triangle = [
    [
      [0, 0],
      [120, 0],
      [40, 100],
      [0, 0],
    ],
  ] as const;
  const lots = streetCellBuildingLots(
    triangle,
    { minX: 0, maxX: 120, minZ: 0, maxZ: 100 },
    dimensions,
    0,
    1000,
    undefined,
    [],
    { balanced: true },
  );
  expect(new Set(lots.slice(0, 3).map((p) => p.spanId)).size).toBe(3);
  expect(streetCellForm(ring, 15, 1).courtyard).toBe(true);
  expect(
    streetCellForm(
      [
        [
          [0, 0],
          [100, 0],
          [100, 20],
          [0, 20],
          [0, 0],
        ],
      ],
      15,
      1,
    ).courtyard,
  ).toBe(false);
  expect(streetCellForm(triangle, 15, 1).courtyard).toBe(false);
});
it('uses coherent seeded typical five-storey urban rows and low suburban profiles', () => {
  const urban = Array.from({ length: 100 }, (_, seed) =>
    streetCellStoreys(true, 0.8, seed),
  );
  const suburb = Array.from({ length: 100 }, (_, seed) =>
    streetCellStoreys(false, 0.1, seed),
  );
  expect(urban.filter((n) => n === 5).length).toBeGreaterThan(40);
  expect(new Set(suburb)).toEqual(new Set([1, 2]));
  expect(streetCellStoreys(false, 0.5, 0)).toBe(4);
  expect(streetCellStoreys(true, 0.8, 42)).toBe(
    streetCellStoreys(true, 0.8, 42),
  );
});

it('protects a real open courtyard while rejecting impossible corners, holes and collisions', () => {
  const lots = streetCellBuildingLots(
    ring,
    { minX: 0, maxX: 100, minZ: 0, maxZ: 100 },
    dimensions,
    0,
    1000,
    undefined,
    [],
    { balanced: true, frontageOnly: true, frontageSetback: 0.75 },
  );
  const index = createFootprintIndex(50, 0.001);
  const accepted = lots.filter((lot, i) => {
    const body = footprintRing({
      ...lot,
      width: dimensions.width,
      depth: dimensions.depth,
    });
    return footprintInside(body, ring, 0.001) && index.add(String(i), body);
  });
  expect(new Set(accepted.map((l) => l.spanId)).size).toBe(4);
  for (const lot of accepted)
    expect(
      footprintOverlaps(
        footprintRing({ ...lot, width: 10, depth: 15 }),
        [
          [
            [20, 20],
            [80, 20],
            [80, 80],
            [20, 80],
            [20, 20],
          ],
        ],
        0.001,
      ),
    ).toBe(false);
  const hole = [
    ...ring,
    [
      [40, 40],
      [60, 40],
      [60, 60],
      [40, 60],
      [40, 40],
    ] as const,
  ];
  expect(streetCellForm(hole, 15, 1).courtyard).toBe(false);
  expect(
    streetCellForm(
      [...ring].map((r) => [...r].reverse()),
      15,
      1,
    ).rectangularity,
  ).toBe(1);
  expect(
    streetCellForm(
      [
        [
          [0, 0],
          [10, 0],
          [20, 0],
          [0, 0],
        ],
      ],
      15,
      1,
    ),
  ).toEqual({ rectangularity: 0, courtyard: false });
  expect(() =>
    streetCellBuildingLots(
      ring,
      { minX: 0, maxX: 100, minZ: 0, maxZ: 100 },
      dimensions,
      0,
      1000,
      undefined,
      [],
      { frontageSetback: NaN },
    ),
  ).toThrow('Invalid StreetCell lot dimensions');
});
it('preserves internal canonical side identities while offering distinct spans fairly', () => {
  const guides = [
    {
      roadId: 'r',
      sourceSegment: 0,
      from: [20, 50] as const,
      to: [80, 50] as const,
      clearance: 4,
      widthSource: 'class-fallback' as const,
    },
  ];
  const legacy = streetCellBuildingLots(
    ring,
    { minX: 0, maxX: 100, minZ: 0, maxZ: 100 },
    dimensions,
    0,
    1000,
    undefined,
    guides,
  );
  const fair = streetCellBuildingLots(
    ring,
    { minX: 0, maxX: 100, minZ: 0, maxZ: 100 },
    dimensions,
    0,
    1000,
    undefined,
    guides,
    { balanced: true },
  );
  for (const lot of fair)
    expect(legacy[lot.ordinal!]).toMatchObject({
      x: lot.x,
      z: lot.z,
      rotation: lot.rotation,
    });
  expect(new Set(fair.slice(0, 6).map((l) => l.spanId)).size).toBe(6);
  expect(() =>
    streetCellBuildingLots(
      ring,
      { minX: 0, maxX: 100, minZ: 0, maxZ: 100 },
      { ...dimensions, width: 0.1, depth: 0.1, gap: 0 },
      0,
      1,
      undefined,
      [],
      { balanced: true },
    ),
  ).toThrow('budget exceeded');
  expect(streetCellStoreys(false, 0.6, 1)).toBe(5);
  expect(streetCellStoreys(true, 0.1, 0)).toBe(3);
});

it('handles collapsed shape diagnostics and asymmetric road-side center availability', () => {
  expect(
    streetCellForm(
      [
        [
          [0, 0],
          [0, 0],
          [0, 0],
        ],
      ],
      15,
      1,
    ).courtyard,
  ).toBe(false);
  const guides = [
    {
      roadId: 'r',
      sourceSegment: 0,
      from: [20, 50] as const,
      to: [80, 50] as const,
      clearance: 4,
      widthSource: 'class-fallback' as const,
    },
  ];
  const lots = streetCellBuildingLots(
    ring,
    { minX: 0, maxX: 100, minZ: 0, maxZ: 100 },
    dimensions,
    0,
    1000,
    (p) => p.z > 50,
    guides,
  );
  expect(lots.length).toBeGreaterThan(0);
  expect(lots.every((p) => p.z > 50)).toBe(true);
});

it('gives three feasible triangle sides accepted envelopes before the same target is exhausted', () => {
  const triangle = [
    [
      [0, 0],
      [120, 0],
      [40, 100],
      [0, 0],
    ],
  ] as const;
  const compose = (balanced: boolean) => {
    const index = createFootprintIndex(50, 0.001),
      accepted = [];
    const lots = streetCellBuildingLots(
      triangle,
      { minX: 0, maxX: 120, minZ: 0, maxZ: 100 },
      dimensions,
      0,
      1000,
      undefined,
      [],
      { balanced, frontageOnly: true, frontageSetback: 0.75 },
    );
    for (const lot of lots) {
      const body = footprintRing({ ...lot, width: 10, depth: 15 });
      if (
        footprintInside(body, triangle, 0.001) &&
        index.add(String(lot.ordinal), body)
      )
        accepted.push(lot);
      if (accepted.length === 6) break;
    }
    return accepted;
  };
  const before = compose(false),
    after = compose(true);
  expect(before).toHaveLength(6);
  expect(after).toHaveLength(6);
  expect(new Set(before.map((l) => l.spanId)).size).toBe(1);
  expect(new Set(after.map((l) => l.spanId)).size).toBe(3);
});
