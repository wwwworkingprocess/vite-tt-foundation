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
) {
  let inside = false;
  for (let i = 1; i < ring.length; i++) {
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

export function lookupSettlementContext(
  metadata: SettlementMetadata,
  point: GeographicPoint,
) {
  let index = spatialIndexes.get(metadata);
  if (!index) {
    index = prepareMetadata(metadata);
    spatialIndexes.set(metadata, index);
  }
  const zones = index.zones
    .filter((zone) => covers(point, zone))
    .sort((a, b) => a.area - b.area || (a.record.id < b.record.id ? -1 : 1))
    .map((zone) => zone.record);
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
