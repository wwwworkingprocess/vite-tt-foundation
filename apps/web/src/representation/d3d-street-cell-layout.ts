import { preparePolygonQuery } from '../settlement/settlement-metadata-spatial.js';
import type { CityBounds } from './d3d-city-model.js';
import type { FootprintPolygon } from './d3d-footprint.js';

/** Offline reference: building.geojson SHA 6f28934613fef4531d0a4bb43fae19f802d89f9686afb0bbe0d94a0a4c4cc601.
 * Quantiles use existing local metre mapping and research neighborhoods; no runtime footprint authority. */
export const streetCellFootprintCalibration = Object.freeze({
  urban: Object.freeze({
    areaMedianSqm: 120.33597267360892,
    shortMin: 5.458501645254728,
    shortMax: 12.454261886019594,
    longMin: 11.090187336317058,
    longMax: 22.793516867151766,
  }),
  suburban: Object.freeze({
    areaMedianSqm: 71.42317304440076,
    shortMin: 5.232128318392824,
    shortMax: 11.070557188925363,
    longMin: 9.095910562090339,
    longMax: 17.244319981752597,
  }),
});
type Dimensions = Readonly<{
  width: number;
  depth: number;
  gap: number;
  interiorGap: number;
  parcelWidth: number;
  parcelDepth: number;
}>;
export type StreetCellLot = Readonly<{
  x: number;
  z: number;
  u: number;
  v: number;
  width: number;
  depth: number;
  rotation: number;
  corner: boolean;
  band: 'frontage' | 'interior';
}>;
/** Placement proposals, not clipping/buildability: the composer checks every complete footprint.
 * Boundary bands precede a street-aligned interior lattice. Subdivided collinear source edges form one frontage. */
export function* iterateStreetCellBuildingLots(
  rings: FootprintPolygon,
  crop: CityBounds,
  dimensions: Dimensions,
  fallbackAngle: number,
  budget: number,
  acceptCenter: (point: {
    readonly x: number;
    readonly z: number;
  }) => boolean = () => true,
): Generator<StreetCellLot, void> {
  if (
    ![
      dimensions.width,
      dimensions.depth,
      dimensions.parcelWidth,
      dimensions.parcelDepth,
    ].every((v) => Number.isFinite(v) && v > 0) ||
    ![dimensions.gap, dimensions.interiorGap, budget].every(
      (v) => Number.isFinite(v) && v >= 0,
    ) ||
    !Number.isFinite(fallbackAngle)
  )
    throw new Error('Invalid StreetCell lot dimensions');
  const outer = rings[0]!,
    guides: {
      from: readonly [number, number];
      to: readonly [number, number];
    }[] = [];
  const joinTolerance = Math.min(dimensions.width, dimensions.depth) * 0.05;
  let signed = 0;
  for (let i = 1; i < outer.length; i++) {
    const from = outer[i - 1]!,
      to = outer[i]!;
    signed += from[0] * to[1] - to[0] * from[1];
    const dx = to[0] - from[0],
      dz = to[1] - from[1],
      length = Math.hypot(dx, dz);
    if (length === 0) continue;
    const last = guides.at(-1);
    if (last) {
      const ux = last.to[0] - last.from[0],
        uz = last.to[1] - last.from[1],
        span = Math.hypot(ux, uz);
      if (
        ux * dx + uz * dz > 0 &&
        Math.abs(ux * dz - uz * dx) / length / span < 0.15 &&
        Math.abs(ux * (to[1] - last.from[1]) - uz * (to[0] - last.from[0])) /
          span <=
          joinTolerance
      ) {
        last.to = to;
        continue;
      }
    }
    guides.push({ from, to });
  }
  if (signed === 0) return;
  const step = dimensions.width + dimensions.gap,
    rowStep = dimensions.depth + dimensions.interiorGap;
  let emitted = 0;
  const contains = preparePolygonQuery({ type: 'Polygon', coordinates: rings });
  const emit = (
    x: number,
    z: number,
    rotation: number,
    corner: boolean,
    band: StreetCellLot['band'],
  ) => {
    if (x < crop.minX || x > crop.maxX || z < crop.minZ || z > crop.maxZ)
      return;
    if (!contains([x, z])) return;
    if (!acceptCenter({ x, z })) return;
    if (emitted >= budget)
      throw new Error('StreetCell building lot budget exceeded');
    emitted++;
    return Object.freeze({
      x,
      z,
      u: 0,
      v: 0,
      width: dimensions.parcelWidth,
      depth: dimensions.parcelDepth,
      rotation,
      corner,
      band,
    });
  };
  let longest = 0,
    angle = fallbackAngle;
  for (const guide of guides) {
    const dx = guide.to[0] - guide.from[0],
      dz = guide.to[1] - guide.from[1],
      length = Math.hypot(dx, dz);
    if (length > longest) {
      longest = length;
      angle = -Math.atan2(dz, dx);
    }
    const count = Math.floor(length / step);
    if (count > Math.max(budget * 4, 1024))
      throw new Error('StreetCell building lot budget exceeded');
    const side = signed > 0 ? 1 : -1;
    for (let i = 0; i < count; i++) {
      const along = (length - count * step) / 2 + (i + 0.5) * step,
        offset = dimensions.depth / 2;
      const lot = emit(
        guide.from[0] + (dx * along - dz * offset * side) / length,
        guide.from[1] + (dz * along + dx * offset * side) / length,
        -Math.atan2(dz, dx),
        i === 0 || i === count - 1,
        'frontage',
      );
      if (lot) yield lot;
    }
  }
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  const local = (
    [
      [crop.minX, crop.minZ],
      [crop.maxX, crop.minZ],
      [crop.maxX, crop.maxZ],
      [crop.minX, crop.maxZ],
    ] as const
  ).map(([x, z]) => [x * cos - z * sin, x * sin + z * cos] as const);
  const minU = Math.min(...local.map((p) => p[0])),
    maxU = Math.max(...local.map((p) => p[0])),
    minV = Math.min(...local.map((p) => p[1])),
    maxV = Math.max(...local.map((p) => p[1]));
  const columns = Math.max(
    0,
    Math.floor((maxU - minU - dimensions.width) / step) + 1,
  );
  const rows = Math.max(
    0,
    Math.floor((maxV - minV - dimensions.depth) / rowStep) + 1,
  );
  if (columns * rows > Math.max(budget * 4, 1024))
    throw new Error('StreetCell building lot budget exceeded');
  for (
    let v = minV + dimensions.depth / 2;
    v <= maxV - dimensions.depth / 2;
    v += rowStep
  )
    for (
      let u = minU + dimensions.width / 2;
      u <= maxU - dimensions.width / 2;
      u += step
    ) {
      const lot = emit(
        u * cos + v * sin,
        -u * sin + v * cos,
        angle,
        false,
        'interior',
      );
      if (lot) yield lot;
    }
}

/** Compatibility materialization for callers/tests needing the whole bounded plan. */
export function streetCellBuildingLots(
  ...args: Parameters<typeof iterateStreetCellBuildingLots>
): readonly StreetCellLot[] {
  return Object.freeze([...iterateStreetCellBuildingLots(...args)]);
}
