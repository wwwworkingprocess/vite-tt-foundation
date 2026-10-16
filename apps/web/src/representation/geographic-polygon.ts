import { pointInPolygon } from '../settlement/settlement-metadata-spatial.js';
function ensure(ok: boolean, message: string): asserts ok {
  if (!ok) throw new Error('Invalid polygon: ' + message);
}
type Point = readonly [number, number];
const cross = (a: Point, b: Point, c: Point) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function edgesMeet(a: Point, b: Point, c: Point, d: Point) {
  const abC = cross(a, b, c),
    abD = cross(a, b, d),
    cdA = cross(c, d, a),
    cdB = cross(c, d, b);
  if (abC * abD < 0 && cdA * cdB < 0) return true;
  const on = (p: Point, q: Point, r: Point, area: number) =>
    Math.abs(area) < 1e-18 &&
    r[0] >= Math.min(p[0], q[0]) &&
    r[0] <= Math.max(p[0], q[0]) &&
    r[1] >= Math.min(p[1], q[1]) &&
    r[1] <= Math.max(p[1], q[1]);
  return (
    on(a, b, c, abC) || on(a, b, d, abD) || on(c, d, a, cdA) || on(c, d, b, cdB)
  );
}
function boundariesMeet(a: readonly Point[], b: readonly Point[]) {
  for (let i = 1; i < a.length; i++)
    for (let j = 1; j < b.length; j++)
      if (edgesMeet(a[i - 1]!, a[i]!, b[j - 1]!, b[j]!)) return true;
  return false;
}
export function validateGeographicPolygon(
  rings: readonly (readonly Point[])[],
) {
  for (const r of rings) {
    ensure(
      r[0]![0] === r.at(-1)![0] && r[0]![1] === r.at(-1)![1],
      'open polygon ring',
    );
    const points = r.filter(
      (p, i) => i === 0 || p[0] !== r[i - 1]![0] || p[1] !== r[i - 1]![1],
    );
    ensure(
      Math.abs(
        points
          .slice(1)
          .reduce(
            (a, p, i) => a + points[i]![0] * p[1] - p[0] * points[i]![1],
            0,
          ),
      ) > 1e-12,
      'degenerate polygon',
    );
    for (let i = 1; i < points.length; i++)
      for (let j = i + 2; j < points.length; j++) {
        if (i === 1 && j === points.length - 1) continue;
        const a = points[i - 1]!,
          b = points[i]!,
          c = points[j - 1]!,
          d = points[j]!;
        ensure(!edgesMeet(a, b, c, d), 'self-intersecting polygon');
      }
  }
  const outer = { type: 'Polygon' as const, coordinates: [rings[0]!] };
  for (const hole of rings.slice(1))
    ensure(
      hole.slice(0, -1).every((p) => pointInPolygon(p, outer)),
      'hole outside extent',
    );
  for (let i = 1; i < rings.length; i++) {
    ensure(!boundariesMeet(rings[0]!, rings[i]!), 'hole crosses exterior');
    for (let j = 1; j < i; j++)
      ensure(
        !boundariesMeet(rings[i]!, rings[j]!) &&
          !pointInPolygon(rings[i]![0]!, {
            type: 'Polygon',
            coordinates: [rings[j]!],
          }) &&
          !pointInPolygon(rings[j]![0]!, {
            type: 'Polygon',
            coordinates: [rings[i]!],
          }),
        'overlapping holes',
      );
  }
}
