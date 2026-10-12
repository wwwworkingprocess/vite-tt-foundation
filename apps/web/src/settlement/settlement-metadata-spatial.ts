import {
  freezeSettlement,
  type GeographicPoint,
  type ResearchPolygon,
  type SettlementMetadata,
  type SettlementLandmark,
} from './settlement-metadata.js';

function ringContains(
  point: GeographicPoint,
  ring: readonly GeographicPoint[],
  edges?: readonly number[],
) {
  let inside = false;
  const count = edges?.length ?? ring.length - 1;
  for (let j = 0; j < count; j++) {
    const i = edges ? edges[j]! : j + 1;
    const a = ring[i - 1]!,
      b = ring[i]!;
    const cross =
      (point[0] - a[0]) * (b[1] - a[1]) - (point[1] - a[1]) * (b[0] - a[0]);
    if (
      Math.abs(cross) <= 1e-12 &&
      point[0] >= Math.min(a[0], b[0]) - 1e-12 &&
      point[0] <= Math.max(a[0], b[0]) + 1e-12 &&
      point[1] >= Math.min(a[1], b[1]) - 1e-12 &&
      point[1] <= Math.max(a[1], b[1]) + 1e-12
    )
      return true;
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
/** Outer boundary is included; hole interiors and boundaries are excluded. */
export function pointInPolygon(
  point: GeographicPoint,
  polygon: ResearchPolygon,
): boolean {
  return (
    ringContains(point, polygon.coordinates[0]!) &&
    !polygon.coordinates.slice(1).some((ring) => ringContains(point, ring))
  );
}
const polygonQueries = new WeakMap<
  ResearchPolygon['coordinates'],
  (point: GeographicPoint) => boolean
>();
/** Static query accelerator on immutable source/renderer ring identity. It uses the same exact
 * ray/boundary predicate; rows only select potentially intersecting edges, never rewrite polygons. */
export function preparePolygonQuery(
  polygon: ResearchPolygon,
): (point: GeographicPoint) => boolean {
  const cached = polygonQueries.get(polygon.coordinates);
  if (cached) return cached;
  const queries = polygon.coordinates.map((ring) => {
    const west = Math.min(...ring.map((p) => p[0])),
      east = Math.max(...ring.map((p) => p[0])),
      south = Math.min(...ring.map((p) => p[1])),
      north = Math.max(...ring.map((p) => p[1]));
    const count = Math.min(32, Math.ceil(Math.sqrt(ring.length - 1)));
    const step = (north - south) / count;
    const buckets =
      ring.length >= 64 && step > 0
        ? Array.from({ length: count }, () => [] as number[])
        : undefined;
    const row = (y: number) =>
      Math.max(0, Math.min(count - 1, Math.floor((y - south) / step)));
    if (buckets)
      for (let i = 1; i < ring.length; i++)
        for (
          let r = row(Math.min(ring[i - 1]![1], ring[i]![1]) - 1e-12);
          r <= row(Math.max(ring[i - 1]![1], ring[i]![1]) + 1e-12);
          r++
        )
          buckets[r]!.push(i);
    return (point: GeographicPoint) => {
      if (
        point[0] < west - 1e-12 ||
        point[0] > east + 1e-12 ||
        point[1] < south - 1e-12 ||
        point[1] > north + 1e-12
      )
        return false;
      return ringContains(point, ring, buckets?.[row(point[1])]);
    };
  });
  const query = (point: GeographicPoint) =>
    queries[0]!(point) && !queries.slice(1).some((q) => q(point));
  polygonQueries.set(polygon.coordinates, query);
  return query;
}
export function polygonArea(polygon: ResearchPolygon): number {
  const areas = polygon.coordinates.map(
    (ring) =>
      Math.abs(
        ring
          .slice(1)
          .reduce(
            (sum, point, i) =>
              sum + ring[i]![0] * point[1] - point[0] * ring[i]![1],
            0,
          ),
      ) / 2,
  );
  return areas[0]! - areas.slice(1).reduce((sum, area) => sum + area, 0);
}
export type Buildability = 'default' | 'strongly-constrained' | 'none';

function prepareRegion<T extends { readonly boundary: ResearchPolygon }>(
  record: T,
) {
  const ring = record.boundary.coordinates[0]!;
  return {
    record,
    area: polygonArea(record.boundary),
    west: Math.min(...ring.map((point) => point[0])) - 1e-12,
    east: Math.max(...ring.map((point) => point[0])) + 1e-12,
    south: Math.min(...ring.map((point) => point[1])) - 1e-12,
    north: Math.max(...ring.map((point) => point[1])) + 1e-12,
  };
}
function prepareMetadata(metadata: SettlementMetadata) {
  return {
    zones: metadata.zones.map(prepareRegion),
    landscapes: metadata.landscapeRegions.map(prepareRegion),
  };
}
// Immutable source identity permits a private index; no geographic authority is copied or changed.
const spatialIndexes = new WeakMap<
  SettlementMetadata,
  ReturnType<typeof prepareMetadata>
>();
function covers(
  point: GeographicPoint,
  region: ReturnType<typeof prepareRegion>,
) {
  return (
    point[0] >= region.west &&
    point[0] <= region.east &&
    point[1] >= region.south &&
    point[1] <= region.north &&
    pointInPolygon(point, region.record.boundary)
  );
}

function metadataIndex(metadata: SettlementMetadata) {
  let index = spatialIndexes.get(metadata);
  if (!index) {
    index = prepareMetadata(metadata);
    spatialIndexes.set(metadata, index);
  }
  return index;
}
function coveringZones(
  index: ReturnType<typeof prepareMetadata>,
  point: GeographicPoint,
) {
  return index.zones
    .filter((zone) => covers(point, zone))
    .sort((a, b) => a.area - b.area || (a.record.id < b.record.id ? -1 : 1))
    .map((zone) => zone.record);
}
/** Same primary-zone selection as full research context, without preparing/freeze-copying landscape diagnostics per proposal. */
export function lookupSettlementZone(
  metadata: SettlementMetadata,
  point: GeographicPoint,
) {
  return coveringZones(metadataIndex(metadata), point)[0];
}
export function lookupSettlementContext(
  metadata: SettlementMetadata,
  point: GeographicPoint,
) {
  const index = metadataIndex(metadata);
  const zones = coveringZones(index, point);
  const landscapes = index.landscapes
    .filter((region) => covers(point, region))
    .map((region) => region.record)
    .sort((a, b) => a.id.localeCompare(b.id));
  const buildability: Buildability = landscapes.some(
    (v) => v.buildability === 'none',
  )
    ? 'none'
    : landscapes.length > 0
      ? 'strongly-constrained'
      : 'default';
  return freezeSettlement({
    zoneId: zones[0]?.id,
    districtId: zones[0]?.districtId,
    overlappingZoneIds: zones.map((v) => v.id),
    landscapeRegionIds: landscapes.map((v) => v.id),
    buildability,
  });
}
/** Semantic association is valid even outside a research polygon; report it without special cases. */
export function diagnoseLandmarkAssociations(metadata: SettlementMetadata) {
  return freezeSettlement(
    metadata.landmarks
      .filter(
        (landmark) =>
          landmark.zoneId !== null &&
          !pointInPolygon(
            landmark.coordinate,
            metadata.zones.find((zone) => zone.id === landmark.zoneId)!
              .boundary,
          ),
      )
      .map((landmark) => ({
        landmarkId: landmark.id,
        zoneId: landmark.zoneId,
        districtId: landmark.districtId,
      }))
      .sort((a, b) => a.landmarkId.localeCompare(b.landmarkId)),
  );
}
export function landmarkReservationMetres(
  metadata: SettlementMetadata,
  landmark: SettlementLandmark,
): number {
  const zone = metadata.zones.find((zone) => zone.id === landmark.zoneId);
  const profile = metadata.urbanProfiles.find(
    (profile) => profile.id === zone?.urbanProfileId,
  );
  const localScale = profile
    ? (profile.typicalBlockWidthM.min + profile.typicalBlockDepthM.min) / 2
    : 90;
  const roleScale = {
    'parcel-reservation': 0.55,
    'district-anchor': 0.35,
    'activity-anchor': 0.28,
    'visual-landmark': 0.2,
    'context-only': 0.18,
  }[landmark.proceduralRole];
  return Math.max(
    12,
    localScale * roleScale * (landmark.importance === 'city' ? 1 : 0.8),
  );
}
export function geographicDistanceMetres(
  a: GeographicPoint,
  b: GeographicPoint,
): number {
  return (
    Math.hypot(
      (a[0] - b[0]) * Math.cos(((a[1] + b[1]) * Math.PI) / 360),
      a[1] - b[1],
    ) * 111320
  );
}
