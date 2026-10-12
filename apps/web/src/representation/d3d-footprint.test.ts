import { cellCityCells } from '../test/street-cell-city-fixture.js';
import {
  preparePolygonQuery,
  pointInPolygon,
} from '../settlement/settlement-metadata-spatial.js';
import { expect, it } from 'vitest';
import {
  footprintRing,
  createFootprintIndex,
  footprintInside,
  footprintOverlaps,
} from './d3d-footprint.js';
const ring = (points: number[][]) => points.map(([x, z]) => [x!, z!] as const);
const square = (x: number, z: number, size: number) =>
  ring([
    [x, z],
    [x + size, z],
    [x + size, z + size],
    [x, z + size],
    [x, z],
  ]);
const rectangle = (
  x: number,
  z: number,
  width: number,
  depth: number,
  rotation = 0,
) => footprintRing({ x, z, width, depth, rotation });
it('checks whole rotated footprints, narrow shapes, touching and concave boundaries', () => {
  const outer = [square(0, 0, 20)];
  expect(
    footprintInside(rectangle(10, 10, 8, 6, Math.PI / 4), outer, 0.001),
  ).toBe(true);
  expect(
    footprintInside(rectangle(2, 2, 8, 6, Math.PI / 4), outer, 0.001),
  ).toBe(false);
  expect(footprintInside(rectangle(2, 10, 4, 4), outer, 0.001)).toBe(false);
  expect(
    footprintInside(rectangle(10, 10, 8, 6), [square(8, 0, 4)], 0.001),
  ).toBe(false);
  const concave = [
    ring([
      [0, 0],
      [20, 0],
      [20, 20],
      [12, 20],
      [12, 5],
      [8, 5],
      [8, 20],
      [0, 20],
      [0, 0],
    ]),
  ];
  expect(footprintInside(rectangle(10, 10, 16, 4), concave, 0.001)).toBe(false);
  expect(footprintInside(rectangle(4, 10, 4, 4), concave, 0.001)).toBe(true);
});
it('rejects enclosed holes and detects forbidden-region containment, crossings and tangencies', () => {
  const building = rectangle(10, 10, 10, 10);
  expect(
    footprintInside(building, [square(0, 0, 20), square(9, 9, 2)], 0.001),
  ).toBe(false);
  expect(
    footprintInside(building, [square(0, 0, 20), square(13, 9, 3)], 0.001),
  ).toBe(false);
  expect(footprintOverlaps(building, [square(9, 9, 2)], 0.001)).toBe(true);
  expect(footprintOverlaps(building, [square(0, 0, 20)], 0.001)).toBe(true);
  expect(footprintOverlaps(building, [square(15, 9, 3)], 0.001)).toBe(true);
  expect(footprintOverlaps(building, [square(30, 30, 3)], 0.001)).toBe(false);
  expect(
    footprintOverlaps(building, [square(0, 0, 20), square(4, 4, 12)], 0.001),
  ).toBe(false);
});

it('bins complete rotated envelopes across boundaries and enforces spacing without an all-city scan', () => {
  const index = createFootprintIndex(10, 0.001);
  expect(index.add('first', rectangle(10, 10, 8, 8, Math.PI / 4))).toBe(true);
  expect(index.add('overlap', rectangle(12, 10, 3, 3))).toBe(false);
  expect(index.add('distant', rectangle(30, 30, 4, 4))).toBe(true);
  expect(index.add('same-bin-separated', rectangle(32, 35, 2, 2))).toBe(true);
  expect(index.add('tangent', rectangle(30, 34, 4, 4))).toBe(false);
});

it('queries dense immutable boundaries with the same holes, edge inclusion and stripe seams', () => {
  const outer = [
    ...Array.from({ length: 101 }, (_, i) => [i, 0] as const),
    [100, 100] as const,
    [0, 100] as const,
    [0, 0] as const,
  ];
  const hole = square(40, 40, 20);
  const polygon = { type: 'Polygon' as const, coordinates: [outer, hole] };
  const before = JSON.stringify(polygon);
  const query = preparePolygonQuery(polygon);
  expect(preparePolygonQuery(polygon)).toBe(query);
  for (const p of [
    [10, 10],
    [0, 0],
    [100, 100],
    [99, 50],
  ] as const)
    expect(query(p)).toBe(true);
  for (const p of [
    [50, 50],
    [40, 50],
    [-1, 50],
    [101, 50],
    [50, -1],
    [50, 101],
  ] as const)
    expect(query(p)).toBe(false);
  for (let z = 0; z <= 100; z += 100 / 32) expect(query([10, z])).toBe(true);
  expect(
    preparePolygonQuery({ type: 'Polygon', coordinates: [outer, hole] }),
  ).toBeTypeOf('function');
  expect(JSON.stringify(polygon)).toBe(before);
  const flat = [
    ...Array.from({ length: 80 }, (_, i) => [i, 0] as const),
    [0, 0] as const,
  ];
  expect(
    preparePolygonQuery({ type: 'Polygon', coordinates: [flat] })([1, 0]),
  ).toBe(true);
});

it('matches the original predicate on real C safe-zone boundaries and bounded interior samples', () => {
  const cells = [...cellCityCells.features]
    .filter((c) => cellCityCells.annotations!.cells[c.id]!.safeZoneCoordinates)
    .sort(
      (a, b) =>
        cellCityCells.annotations!.cells[b.id]!.safeZoneCoordinates![0]!
          .length -
        cellCityCells.annotations!.cells[a.id]!.safeZoneCoordinates![0]!.length,
    )
    .slice(0, 32);
  for (const cell of cells) {
    const coordinates =
      cellCityCells.annotations!.cells[cell.id]!.safeZoneCoordinates!;
    const polygon = { type: 'Polygon' as const, coordinates },
      query = preparePolygonQuery(polygon),
      ring = coordinates[0]!;
    for (
      let i = 0;
      i < ring.length;
      i += Math.max(1, Math.ceil(ring.length / 12))
    )
      expect(query(ring[i]!)).toBe(pointInPolygon(ring[i]!, polygon));
    const xs = ring.map((p) => p[0]),
      ys = ring.map((p) => p[1]),
      west = Math.min(...xs),
      east = Math.max(...xs),
      south = Math.min(...ys),
      north = Math.max(...ys);
    for (const u of [0, 0.25, 0.5, 0.75, 1])
      for (const v of [0, 0.25, 0.5, 0.75, 1]) {
        const point = [
          west + (east - west) * u,
          south + (north - south) * v,
        ] as const;
        expect(query(point)).toBe(pointInPolygon(point, polygon));
      }
  }
});
