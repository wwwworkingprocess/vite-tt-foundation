import { expect, it } from 'vitest';
import { planStreetCellRoads } from './d3d-street-cell-roads.js';
import { footprintRing } from './d3d-footprint.js';
import type { StreetCellAssociation } from './street-cells.js';
const road = (
  id: string,
  points: readonly (readonly [number, number])[],
  disposition = 'internal',
  sourceSegment = 0,
): StreetCellAssociation => ({
  roadId: id,
  sourceSegment,
  disposition,
  lengthM: 30,
  corridorAreaSqm: 100,
  clippedCoordinates: points,
});
const metadata = {
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
};
const project = ([x, z]: readonly [number, number]) => ({ x, z });
it('reserves full rotated footprints, including caps, joins and touching, rather than centers', () => {
  const p = planStreetCellRoads(
    [
      road('r', [
        [0, 0],
        [40, 0],
      ]),
    ],
    metadata,
    project,
    1,
  );
  expect(p.guides).toHaveLength(1);
  expect(p.guides[0]!.clearance).toBe(5);
  expect(
    p.conflicts(
      footprintRing({ x: 20, z: 10, width: 10, depth: 12, rotation: 0 }),
    ),
  ).toBe(true);
  expect(
    p.conflicts(
      footprintRing({ x: 20, z: 15, width: 10, depth: 12, rotation: 0 }),
    ),
  ).toBe(false);
  expect(
    p.conflicts(
      footprintRing({ x: -5, z: 0, width: 1, depth: 1, rotation: 0 }),
    ),
  ).toBe(true);
  expect(
    p.conflicts(
      footprintRing({ x: 20, z: 6, width: 2, depth: 2, rotation: 0 }),
    ),
  ).toBe(true);
});
it('joins collinear pieces deterministically while reserving support/short roads without frontage', () => {
  const records = [
    road('r', [
      [0, 0],
      [10, 0],
    ]),
    road(
      'r',
      [
        [10, 0],
        [40, 0],
      ],
      'internal',
      1,
    ),
    road(
      'r',
      [
        [40, 0],
        [50, 0],
      ],
      'corridor-support',
      2,
    ),
    road(
      'r',
      [
        [50, 0],
        [52, 0],
      ],
      'short',
      3,
    ),
    road(
      'r',
      [
        [20, -20],
        [20, 20],
      ],
      'grade-separated',
      4,
    ),
  ];
  const p = planStreetCellRoads(records, metadata, project, 1);
  expect(p.guides).toHaveLength(1);
  expect(p.guides[0]!.to).toEqual([40, 0]);
  expect(p.guides).toEqual(
    planStreetCellRoads(records.toReversed(), metadata, project, 1).guides,
  );
  expect(
    p.conflicts(
      footprintRing({ x: 49, z: 0, width: 1, depth: 1, rotation: 0 }),
    ),
  ).toBe(true);
  expect(
    p.conflicts(
      footprintRing({ x: 20, z: 15, width: 1, depth: 1, rotation: 0 }),
    ),
  ).toBe(false);
});
it('keeps curved joints conservative and excludes non-at-grade, degenerate and non-drawable guides', () => {
  const p = planStreetCellRoads(
    [
      road('r', [
        [0, 0],
        [20, 0],
        [20, 20],
      ]),
    ],
    metadata,
    project,
    1,
  );
  expect(p.guides).toHaveLength(2);
  expect(
    p.conflicts(
      footprintRing({ x: 23, z: -3, width: 1, depth: 1, rotation: 0 }),
    ),
  ).toBe(true);
  expect(
    planStreetCellRoads(
      [
        road('r', [
          [0, 0],
          [0, 0],
        ]),
        road(
          'r',
          [
            [0, 0],
            [20, 0],
          ],
          'non-drawable-candidate',
        ),
      ],
      metadata,
      project,
      1,
    ).guides,
  ).toEqual([]);
  expect(
    planStreetCellRoads(
      [
        road('r', [
          [0, 0],
          [20, 0],
        ]),
      ],
      { '"r"': [...metadata['"r"'].slice(0, 8), false, [6, 'tag']] },
      project,
      1,
    ).guides,
  ).toEqual([]);
});
it('rejects missing or malformed width provenance instead of inventing a corridor', () => {
  for (const m of [null, [], 1])
    expect(() => planStreetCellRoads([], m, project, 1)).toThrow('metadata');
  for (const metre of [0, NaN])
    expect(() => planStreetCellRoads([], {}, project, metre)).toThrow(
      'metadata',
    );
  for (const m of [{}, { '"r"': [] }, { '"r"': 'bad' }])
    expect(() =>
      planStreetCellRoads(
        [
          road('r', [
            [0, 0],
            [20, 0],
          ]),
        ],
        m,
        project,
        1,
      ),
    ).toThrow('Missing');
  for (const width of [
    null,
    ['6', 'tag'],
    [NaN, 'tag'],
    [0, 'tag'],
    [6, null],
    [6, 'invented'],
  ])
    expect(() =>
      planStreetCellRoads(
        [
          road('r', [
            [0, 0],
            [20, 0],
          ]),
        ],
        { '"r"': [...metadata['"r"'].slice(0, 9), width] },
        project,
        1,
      ),
    ).toThrow('Invalid');
  const duplicate = road('r', [
    [0, 0],
    [20, 0],
  ]);
  const p = planStreetCellRoads(
    [
      duplicate,
      duplicate,
      road('r', [
        [20, 0],
        [0, 0],
      ]),
    ],
    metadata,
    project,
    1,
  );
  expect(p.reservationSegments).toBe(1);
  expect(p.segments[0]).toMatchObject({
    roadId: 'r',
    sourceSegment: 0,
    widthSource: 'class-fallback',
  });
  expect(Object.isFrozen(p.segments[0]!.from)).toBe(true);
  expect(p.guides).toHaveLength(1);
  expect(
    planStreetCellRoads(
      [{ ...duplicate, clippedCoordinates: null }],
      metadata,
      project,
      1,
    ).guides,
  ).toEqual([]);
  for (const source of ['tag', 'inferred-lanes'])
    expect(
      planStreetCellRoads(
        [duplicate],
        { '"r"': [...metadata['"r"'].slice(0, 9), [8, source]] },
        project,
        2,
      ).guides[0],
    ).toMatchObject({ clearance: 12, widthSource: source });
});

it('requires own road metadata entries instead of inheriting undeclared road widths', () => {
  expect(() =>
    planStreetCellRoads(
      [
        road('r', [
          [0, 0],
          [40, 0],
        ]),
      ],
      Object.create(metadata),
      project,
      1,
    ),
  ).toThrow('Missing StreetCell road width');
});
