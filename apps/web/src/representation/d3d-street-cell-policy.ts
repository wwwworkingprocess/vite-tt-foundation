import type { FootprintPolygon } from './d3d-footprint.js';
/** Shape is a layout hint, never a substitute for full footprint containment. */
export function streetCellForm(
  rings: FootprintPolygon,
  depth: number,
  metre: number,
) {
  const outer = rings[0]!;
  let longest = 0,
    angle = 0,
    area = 0;
  for (const ring of rings) {
    let signed = 0;
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1]!,
        b = ring[i]!;
      signed += a[0] * b[1] - b[0] * a[1];
      if (ring === outer) {
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length > longest) {
          longest = length;
          angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
        }
      }
    }
    area += ((ring === outer ? 1 : -1) * Math.abs(signed)) / 2;
  }
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  const points = outer.map(([x, z]) => [x * cos + z * sin, -x * sin + z * cos]);
  const minU = Math.min(...points.map((p) => p[0]!)),
    maxU = Math.max(...points.map((p) => p[0]!)),
    minV = Math.min(...points.map((p) => p[1]!)),
    maxV = Math.max(...points.map((p) => p[1]!));
  const width = maxU - minU,
    length = maxV - minV;
  const rectangularity =
    width * length > 0 ? Math.max(0, area / (width * length)) : 0;
  return Object.freeze({
    rectangularity,
    courtyard:
      rings.length === 1 &&
      rectangularity >= 0.82 &&
      Math.min(width, length) > 2 * depth + 12 * metre,
  });
}
/** Stable row seed; population/evidence select intensity, research cannot move slots. */
export function streetCellStoreys(
  urban: boolean,
  intensity: number,
  seed: number,
) {
  const band = seed % 10;
  if (urban)
    return intensity >= 0.45
      ? [5, 5, 5, 5, 5, 5, 4, 4, 6, 3][band]!
      : [3, 4, 4, 5, 5, 5, 4, 3, 5, 4][band]!;
  if (intensity >= 0.4 && band === 0) return 4;
  if (intensity >= 0.5 && band === 1) return 5;
  return band < 4 ? 1 : 2;
}
