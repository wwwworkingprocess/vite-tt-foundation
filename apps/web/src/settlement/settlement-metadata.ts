import { z } from 'zod';

export const semanticBuildingArchetypes = [
  'small-apartment',
  'perimeter-block',
  'corner-l',
  'courtyard-u',
  'midrise-slab',
  'tower-podium',
  'detached-house',
  'semi-detached',
  'terrace-row',
  'commercial-box',
  'industrial-shed',
  'civic-special',
] as const;
export type SemanticBuildingArchetype =
  (typeof semanticBuildingArchetypes)[number];
type Immutable<T> = T extends readonly unknown[]
  ? { readonly [K in keyof T]: Immutable<T[K]> }
  : T extends object
    ? { readonly [K in keyof T]: Immutable<T[K]> }
    : T;
export function freezeSettlement<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeSettlement(child);
    Object.freeze(value);
  }
  return value;
}
const text = z.string().min(1);
const id = text.regex(/^[A-Za-z][A-Za-z0-9-]*$/);
const confidence = z.enum(['low', 'medium', 'high']);
const quality = z.enum(['research-approximation', 'open-data-derived']);
const ratio = z.number().finite().min(0).max(1);
const nonnegative = z.number().finite().nonnegative();
const range = z
  .strictObject({ min: nonnegative, max: nonnegative })
  .refine((v) => v.min <= v.max, 'Reversed range');
const metricRange = range.refine(
  (v) => v.min > 0 && v.max <= 1000,
  'Invalid metric scale',
);
const ratioRange = range.refine((v) => v.max <= 1, 'Invalid ratio');
// WGS84 is a fixed pair of finite numbers; retain a copied tuple after validation.
const coordinate = z
  .array(z.number().finite())
  .length(2)
  .refine(
    (value) => Math.abs(value[0]!) <= 180 && Math.abs(value[1]!) <= 90,
    'Invalid WGS84 coordinate',
  )
  .transform((value) => [value[0]!, value[1]!] as const);
export type GeographicPoint = readonly [number, number];
const ring = z
  .array(coordinate)
  .min(4)
  .refine((v) => {
    const first = v[0]!,
      last = v[v.length - 1]!;
    const area = v
      .slice(1)
      .reduce((sum, p, i) => sum + v[i]![0] * p[1] - p[0] * v[i]![1], 0);
    return (
      first[0] === last[0] && first[1] === last[1] && Math.abs(area) > 1e-12
    );
  }, 'Open or degenerate polygon ring');
const polygon = z.strictObject({
  type: z.literal('Polygon'),
  coordinates: z.array(ring).min(1),
});
export type ResearchPolygon = Immutable<z.infer<typeof polygon>>;
const attributed = { confidence, sourceIds: z.array(id).min(1) };
const shaped = { boundary: polygon, geometryQuality: quality, ...attributed };
const urbanProfile = z.strictObject({
  id,
  name: text,
  description: text,
  streetPattern: z.enum([
    'orthogonal',
    'semi-orthogonal',
    'mixed',
    'arterial-superblock',
    'industrial-access',
  ]),
  streetRegularity: ratio,
  orientationBehavior: z.enum(['dual-axis', 'locally-adaptive', 'single-axis']),
  typicalBlockWidthM: metricRange,
  typicalBlockDepthM: metricRange,
  typicalStreetWidthM: metricRange,
  parcelPattern: z.enum([
    'fine-grain',
    'medium-grain',
    'detached-lot',
    'mixed',
    'large-plot',
    'superblock',
  ]),
  typicalParcelFrontageM: metricRange,
  typicalParcelDepthM: metricRange,
  plotCoverageRatio: ratioRange,
  openSpaceRatio: ratioRange,
  setbackM: z
    .strictObject({
      frontMin: nonnegative,
      frontMax: nonnegative,
      sideMin: nonnegative,
      sideMax: nonnegative,
    })
    .refine(
      (v) => v.frontMin <= v.frontMax && v.sideMin <= v.sideMax,
      'Reversed setbacks',
    ),
  urbanEdgeBehavior: z.enum([
    'hard',
    'mixed',
    'tapered',
    'landscaped',
    'water-bounded',
    'infrastructure-bounded',
    'fragmented',
  ]),
  proceduralNotes: text,
  ...attributed,
});
const buildingProfile = z.strictObject({
  id,
  name: text,
  description: text,
  dominantUses: z.array(text).min(1),
  allowedArchetypes: z.array(z.enum(semanticBuildingArchetypes)).min(1),
  storeys: z
    .strictObject({
      min: z.number().int().min(1).max(100),
      typicalMin: z.number().int().min(1).max(100),
      typicalMax: z.number().int().min(1).max(100),
      max: z.number().int().min(1).max(100),
    })
    .refine(
      (v) =>
        v.min <= v.typicalMin &&
        v.typicalMin <= v.typicalMax &&
        v.typicalMax <= v.max,
      'Reversed storeys',
    ),
  footprintScale: z.enum(['small', 'medium', 'large']),
  roofFamilies: z.array(text).min(1),
  wallPalette: z.array(text).min(1),
  roofPalette: z.array(text).min(1),
  repetitionBehavior: z.enum([
    'highly-repetitive',
    'locally-repetitive',
    'mixed',
    'landmark-driven',
  ]),
  variationNotes: text,
  ...attributed,
});
const district = z.strictObject({
  id,
  name: text,
  aliases: z.array(text),
  classification: z.enum([
    'research-district',
    'named-neighborhood',
    'planning-area',
  ]),
  ...shaped,
  centroid: coordinate,
  centroidGeometryQuality: quality,
  centroidConfidence: confidence,
  urbanCharacter: text,
  dominantLandUses: z.array(text).min(1),
  zoneIds: z.array(id).min(1),
  landmarkIds: z.array(id),
  gameSemanticsPotential: z.array(text),
  researchNotes: text,
});
const zone = z.strictObject({
  id,
  districtId: id,
  name: text,
  ...shaped,
  urbanProfileId: id,
  buildingProfileMix: z
    .array(z.strictObject({ buildingProfileId: id, weight: ratio }))
    .min(1)
    .refine(
      (v) =>
        Math.abs(v.reduce((sum, p) => sum + p.weight, 0) - 1) <= 1e-8 &&
        new Set(v.map((p) => p.buildingProfileId)).size === v.length,
      'Invalid building profile mix',
    ),
  densityCharacter: z.enum(['very-low', 'low', 'medium', 'high', 'very-high']),
  principalOrientationDeg: z.number().finite().min(0).max(360),
  orientationConfidence: confidence,
  corridorRelationship: z.enum([
    'local-grid',
    'route-oriented',
    'arterial-oriented',
    'mixed',
    'weakly-corridor-related',
  ]),
  populationInterpretation: text,
  proceduralGenerationNotes: text,
  edgeTreatment: text,
});
const landmark = z.strictObject({
  id,
  name: text,
  category: z.enum([
    'civic',
    'cultural',
    'marina',
    'transport',
    'park',
    'tourism',
    'sports',
    'health',
    'retail',
    'industrial',
    'other',
  ]),
  coordinate,
  geometryQuality: quality,
  districtId: id.nullable(),
  zoneId: id.nullable(),
  importance: z.enum(['city', 'district']),
  proceduralRole: z.enum([
    'district-anchor',
    'parcel-reservation',
    'activity-anchor',
    'visual-landmark',
    'context-only',
  ]),
  description: text,
  ...attributed,
});
const metadataSchema = z.strictObject({
  schemaVersion: z.literal('0.1.0'),
  city: z.strictObject({
    id,
    name: text,
    country: text,
    province: text,
    autonomousCommunity: text,
    coordinateReferenceSystem: z.literal('EPSG:4326'),
    centroid: coordinate,
    centroidGeometryQuality: quality,
    centroidConfidence: confidence,
    researchBounds: z
      .strictObject({
        west: z.number().min(-180).max(180),
        east: z.number().min(-180).max(180),
        south: z.number().min(-90).max(90),
        north: z.number().min(-90).max(90),
      })
      .refine(
        (v) => v.west < v.east && v.south < v.north,
        'Reversed research bounds',
      ),
    urbanCharacterSummary: text,
    proceduralGenerationSummary: text,
  }),
  sourceRegistry: z
    .array(
      z.strictObject({
        id,
        title: text,
        publisher: text,
        url: text.refine(
          (value) => URL.canParse(value),
          'Invalid research source URL',
        ),
        sourceType: z.enum([
          'official',
          'planning',
          'institutional',
          'satellite',
          'open-map',
          'tourism',
        ]),
        accessed: text.regex(/^\d{4}-\d{2}-\d{2}$/),
        supports: z.array(text).min(1),
        notes: text,
      }),
    )
    .min(1),
  urbanProfiles: z.array(urbanProfile).min(1),
  buildingProfiles: z.array(buildingProfile).min(1),
  districts: z.array(district).min(1),
  zones: z.array(zone).min(1),
  landmarks: z.array(landmark),
  landscapeRegions: z.array(
    z.strictObject({
      id,
      name: text,
      type: z.enum([
        'sea',
        'lagoon',
        'protected-land',
        'wetland',
        'infrastructure',
      ]),
      ...shaped,
      buildability: z.enum(['none', 'strongly-constrained']),
      urbanEffect: text,
    }),
  ),
  researchAssessment: z.strictObject({
    coverageSummary: text,
    strongestEvidence: z.array(text),
    weakestEvidence: z.array(text),
    importantUncertainties: z.array(text),
    recommendedManualReview: z.array(text),
    recommendedNextResearch: z.array(text),
    generatorReadiness: z.literal('needs-review'),
    generatorReadinessReason: text,
  }),
});
export type SettlementMetadata = Immutable<z.infer<typeof metadataSchema>>;
export type MorphologyZone = SettlementMetadata['zones'][number];
export type UrbanProfile = SettlementMetadata['urbanProfiles'][number];
export type BuildingProfile = SettlementMetadata['buildingProfiles'][number];
export type SettlementLandmark = SettlementMetadata['landmarks'][number];

/** Research geometry is approximate. Landmark associations assert identity, never containment. */
export function parseSettlementMetadata(input: unknown): SettlementMetadata {
  const value = metadataSchema.parse(input);
  const require = (condition: boolean, context: string) => {
    if (!condition) throw new Error(`Invalid settlement metadata: ${context}`);
  };
  const collections = [
    value.sourceRegistry,
    value.urbanProfiles,
    value.buildingProfiles,
    value.districts,
    value.zones,
    value.landmarks,
    value.landscapeRegions,
  ];
  for (const collection of collections)
    require(new Set(collection.map((v) => v.id)).size ===
      collection.length, 'duplicate IDs');
  const sourceIds = new Set(value.sourceRegistry.map((v) => v.id));
  for (const collection of [
    value.urbanProfiles,
    value.buildingProfiles,
    value.districts,
    value.zones,
    value.landmarks,
    value.landscapeRegions,
  ])
    for (const record of collection)
      for (const source of record.sourceIds)
        require(sourceIds.has(source), `unknown source ${source}`);
  const districts = new Map(value.districts.map((v) => [v.id, v]));
  const zones = new Map(value.zones.map((v) => [v.id, v]));
  const landmarks = new Set(value.landmarks.map((v) => v.id));
  const urban = new Set(value.urbanProfiles.map((v) => v.id));
  const building = new Set(value.buildingProfiles.map((v) => v.id));
  for (const district of value.districts) {
    for (const zoneId of district.zoneIds)
      require(zones.get(zoneId)?.districtId ===
        district.id, `district zone ${zoneId}`);
    for (const landmarkId of district.landmarkIds)
      require(landmarks.has(landmarkId), `unknown landmark ${landmarkId}`);
  }
  for (const zone of value.zones) {
    require(districts.has(
      zone.districtId,
    ), `unknown district ${zone.districtId}`);
    require(urban.has(
      zone.urbanProfileId,
    ), `unknown urban profile ${zone.urbanProfileId}`);
    for (const mix of zone.buildingProfileMix)
      require(building.has(
        mix.buildingProfileId,
      ), `unknown building profile ${mix.buildingProfileId}`);
  }
  for (const landmark of value.landmarks) {
    if (landmark.districtId !== null)
      require(districts.has(
        landmark.districtId,
      ), `unknown landmark district ${landmark.districtId}`);
    if (landmark.zoneId !== null)
      require(zones.has(landmark.zoneId) &&
        zones.get(landmark.zoneId)!.districtId ===
          landmark.districtId, `landmark zone/district association ${landmark.id}`);
  }
  const bounds = value.city.researchBounds;
  const checkPoint = (p: GeographicPoint) =>
    require(p[0] >= bounds.west &&
      p[0] <= bounds.east &&
      p[1] >= bounds.south &&
      p[1] <= bounds.north, 'coordinate outside research bounds');
  checkPoint(value.city.centroid);
  for (const district of value.districts) checkPoint(district.centroid);
  for (const landmark of value.landmarks) checkPoint(landmark.coordinate);
  for (const collection of [
    value.districts,
    value.zones,
    value.landscapeRegions,
  ])
    for (const record of collection)
      for (const ring of record.boundary.coordinates)
        for (const point of ring) checkPoint(point);
  return freezeSettlement(value);
}
