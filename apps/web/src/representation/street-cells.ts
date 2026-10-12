export type CellLevel = 'A' | 'B' | 'C';
type CellFile = Readonly<{ path: string; byteLength: number; sha256: string }>;
export type StreetCellDescriptor = CellFile &
  Readonly<{ level: CellLevel; featureCount: number }>;
type SourceProduct = CellFile & Readonly<{ level: CellLevel }>;
type CityEntry = Readonly<{
  audit: CellFile;
  annotations: CellFile;
  hierarchy: CellFile;
  products: readonly StreetCellDescriptor[];
  source: Readonly<{
    roadArchiveSha256: string;
    roadCatalogSchema: 'road-network-catalog-v1';
    products: readonly SourceProduct[];
    roadCity: JsonValue;
  }>;
}>;
const policies = Object.freeze({
  schemaVersion: 'street-cells-catalog-v3',
  version: '0.3.0',
  classificationPolicy: 'at-grade-interior-corridor-v1',
  idPolicy: 'city-sc-sa-sb-geography-source-monotonic-v2',
  marginPolicy: 'estimated-width-half-plus-2m-bevel-v1',
  mergePolicy: 'shared-edge-shape-road-barrier-v1',
  storagePolicy: 'grid7-numeric-c-evidence-tuples-v3',
  annotationEncoding: 'wgs84-grid-7-v3',
  buildingEvidencePolicy:
    'observed-feature-largest-component-interior-owned-lexical-tie-unioned-area-v3',
  crs: 'EPSG:4326',
  metricCrs: 'EPSG:3035',
  geometry: 'Polygon',
  coordinateSemantics: 'source-xy-vertices-preserved-no-clipping',
  topologyPolicy: 'shared-vertex-at-grade-v0',
  eligibilityPolicy: 'exclude-service-bridge-tunnel-nonzero-layer-v0',
} as const);
export type StreetCellCatalog = Readonly<
  typeof policies & { settlements: Readonly<Record<string, CityEntry>> }
>;
export type Point = readonly [number, number];
type CellFeature = Readonly<{
  type: 'Feature';
  id: string;
  properties: Readonly<{
    settlementId: string;
    level: CellLevel;
    areaSqm: number;
    perimeterM: number;
    sourceRoadIds: readonly string[];
    representativePoint?: Point;
    mergePolicy?: string;
    mergeExplanation?: JsonValue;
  }>;
  geometry: Readonly<{
    type: 'Polygon';
    coordinates: readonly (readonly Point[])[];
  }>;
}>;
export type StreetCells = Readonly<{
  settlementId: string;
  level: CellLevel;
  sha256: string;
  features: readonly CellFeature[];
  annotations?: StreetCellAnnotations | undefined;
}>;
function requireCell(valid: boolean, message: string): asserts valid {
  if (!valid) throw new Error('Invalid StreetCell ' + message);
}
function object(
  value: unknown,
  keys?: readonly string[],
): Record<string, unknown> {
  requireCell(
    typeof value === 'object' && value !== null && !Array.isArray(value),
    'object',
  );
  // The runtime object guard supplies the dictionary narrowing TS cannot infer.
  const result = value as Record<string, unknown>;
  requireCell(
    Object.getPrototypeOf(result) === Object.prototype ||
      Object.getPrototypeOf(result) === null,
    'object prototype',
  );
  if (keys)
    requireCell(
      Object.keys(result).length === keys.length &&
        keys.every((k) => Object.hasOwn(result, k)),
      'object fields',
    );
  return result;
}
function list(value: unknown): unknown[] {
  requireCell(Array.isArray(value), 'array');
  return value;
}
function text(value: unknown): string {
  requireCell(typeof value === 'string' && value.length > 0, 'string');
  return value;
}
function positive(value: unknown): number {
  requireCell(
    typeof value === 'number' && Number.isFinite(value) && value > 0,
    'positive measure',
  );
  return value;
}
function integer(value: unknown): number {
  const n = positive(value);
  requireCell(Number.isSafeInteger(n), 'count/byte length');
  return n;
}
function hash(value: unknown): string {
  const s = text(value);
  requireCell(/^[0-9a-f]{64}$/.test(s), 'SHA-256');
  return s;
}
function cityId(value: unknown): string {
  const s = text(value);
  requireCell(/^[a-z]{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s), 'settlement ID');
  return s;
}
function level(value: unknown): CellLevel {
  requireCell(value === 'A' || value === 'B' || value === 'C', 'level');
  return value;
}
function file(o: Record<string, unknown>, path: string): CellFile {
  requireCell(o.path === path, 'city-local path');
  return Object.freeze({
    path,
    byteLength: integer(o.byteLength),
    sha256: hash(o.sha256),
  });
}
function sources(value: unknown, id: string): readonly SourceProduct[] {
  const products = list(value).map((p) => {
    const o = object(p, ['path', 'byteLength', 'sha256', 'level']);
    const l = level(o.level);
    return Object.freeze({
      ...file(o, `${id}/roads-${l.toLowerCase()}.v0.geojson`),
      level: l,
    });
  });
  requireCell(
    products
      .map((p) => p.level)
      .sort()
      .join('') === 'ABC',
    'exactly one A/B/C source',
  );
  return Object.freeze(products);
}
/** Exact V3 grammar, using the same explicit validation convention as roads.
 * No new schema features inflate unrelated shared runtime chunks. */
export function parseStreetCellCatalog(value: unknown): StreetCellCatalog {
  const root = object(value, [...Object.keys(policies), 'settlements']);
  requireCell(
    Object.entries(policies).every(([key, expected]) => root[key] === expected),
    'catalog policy/version',
  );
  const entries = object(root.settlements),
    settlements: Record<string, CityEntry> = {};
  for (const [key, value] of Object.entries(entries)) {
    const id = cityId(key),
      entry = object(value, [
        'audit',
        'annotations',
        'hierarchy',
        'products',
        'source',
      ]);
    const audit = file(
      object(entry.audit, ['path', 'byteLength', 'sha256']),
      id + '/audit.v3.json',
    );
    const products = list(entry.products).map((p) => {
      const o = object(p, [
        'path',
        'byteLength',
        'sha256',
        'level',
        'featureCount',
      ]);
      const l = level(o.level);
      return Object.freeze({
        ...file(o, `${id}/cells-${l.toLowerCase()}.v2.geojson`),
        level: l,
        featureCount: integer(o.featureCount),
      });
    });
    requireCell(
      products
        .map((p) => p.level)
        .sort()
        .join('') === 'ABC',
      'exactly one A/B/C descriptor',
    );
    const source = object(entry.source, [
      'roadArchiveSha256',
      'roadCatalogSchema',
      'products',
      'roadCity',
    ]);
    requireCell(
      source.roadCatalogSchema === 'road-network-catalog-v1',
      'source catalog schema',
    );
    const sourceProducts = sources(source.products, id),
      roadCity = object(source.roadCity, ['audit', 'products', 'source']);
    const embedded = list(roadCity.products).map((p) => object(p));
    requireCell(
      embedded.length === 3 &&
        sourceProducts.every((p) =>
          embedded.some(
            (r) =>
              r.level === p.level &&
              r.path === p.path &&
              r.sha256 === p.sha256 &&
              r.byteLength === p.byteLength,
          ),
        ),
      'embedded source products',
    );
    settlements[id] = Object.freeze({
      audit,
      annotations: file(
        object(entry.annotations, ['path', 'byteLength', 'sha256']),
        id + '/annotations-c.v3.json',
      ),
      hierarchy: file(
        object(entry.hierarchy, ['path', 'byteLength', 'sha256']),
        id + '/hierarchy.v2.json',
      ),
      products: Object.freeze(products),
      source: Object.freeze({
        roadArchiveSha256: hash(source.roadArchiveSha256),
        roadCatalogSchema: 'road-network-catalog-v1',
        products: sourceProducts,
        roadCity: freezeJson(source.roadCity),
      }),
    });
  }
  return Object.freeze({
    ...policies,
    settlements: Object.freeze(settlements),
  });
}
export function streetCellPoint(value: unknown): Point {
  const p = list(value);
  requireCell(
    p.length === 2 &&
      typeof p[0] === 'number' &&
      Number.isFinite(p[0]) &&
      Math.abs(p[0]) <= 180 &&
      typeof p[1] === 'number' &&
      Number.isFinite(p[1]) &&
      Math.abs(p[1]) <= 90,
    'WGS84 pair',
  );
  return Object.freeze([p[0], p[1]]);
}
function ring(value: unknown, annotation = false): readonly Point[] {
  const r = list(value).map(annotation ? annotationPoint : streetCellPoint);
  requireCell(r.length >= 4, 'polygon ring length');
  const a = r[0]!,
    b = r[r.length - 1]!;
  requireCell(a[0] === b[0] && a[1] === b[1], 'polygon closure');
  requireCell(
    annotation ||
      r.slice(1).every((p, i) => p[0] !== r[i]![0] || p[1] !== r[i]![1]),
    'degenerate edge',
  );
  if (annotation) {
    const origin = r[0]!;
    const area = r
      .slice(1)
      .reduce(
        (sum, p, i) =>
          sum +
          (r[i]![0] - origin[0]) * (p[1] - origin[1]) -
          (p[0] - origin[0]) * (r[i]![1] - origin[1]),
        0,
      );
    requireCell(area !== 0, 'polygon area');
  }
  return Object.freeze(r);
}
/** Preserve exact polygon rings/holes, IDs, measurements and source-road metadata.
 * Arrays are copied/frozen once; no rounding, clipping or topology inference. */
export function decodeStreetCells(
  value: unknown,
  settlementId: string,
  product: StreetCellDescriptor,
): StreetCells {
  const root = object(value, ['type', 'features']);
  requireCell(root.type === 'FeatureCollection', 'FeatureCollection');
  const data = list(root.features);
  requireCell(data.length === product.featureCount, 'product count');
  const ids = new Set<string>();
  const features = data.map((value) => {
    const f = object(value, ['type', 'id', 'geometry', 'properties']);
    requireCell(f.type === 'Feature', 'Feature');
    const id = text(f.id);
    requireCell(
      new RegExp(
        '^' +
          settlementId +
          '-s' +
          product.level.toLowerCase() +
          '-[1-9][0-9]*$',
      ).test(id),
      'city-scoped feature ID',
    );
    requireCell(!ids.has(id), 'duplicate feature ID');
    ids.add(id);
    const p = object(f.properties, [
      'settlementId',
      'level',
      'areaSqm',
      'perimeterM',
      'sourceRoadIds',
      ...(product.level === 'C'
        ? []
        : ['representativePoint', 'mergePolicy', 'mergeExplanation']),
    ]);
    const city = cityId(p.settlementId),
      l = level(p.level);
    requireCell(
      city === settlementId && l === product.level,
      'product identity',
    );
    if (l !== 'C')
      requireCell(p.mergePolicy === policies.mergePolicy, 'merge policy');
    const roads = list(p.sourceRoadIds).map(text);
    requireCell(roads.length > 0, 'source roads');
    const g = object(f.geometry, ['type', 'coordinates']);
    requireCell(g.type === 'Polygon', 'Polygon');
    const rings = list(g.coordinates).map((r) => ring(r));
    requireCell(rings.length > 0, 'polygon rings');
    return Object.freeze({
      type: 'Feature' as const,
      id,
      properties: Object.freeze({
        settlementId: city,
        level: l,
        areaSqm: positive(p.areaSqm),
        perimeterM: positive(p.perimeterM),
        sourceRoadIds: Object.freeze(roads),
        ...(l === 'C'
          ? {}
          : {
              representativePoint: streetCellPoint(p.representativePoint),
              mergePolicy: policies.mergePolicy,
              mergeExplanation: freezeJson(p.mergeExplanation),
            }),
      }),
      geometry: Object.freeze({
        type: 'Polygon' as const,
        coordinates: Object.freeze(rings),
      }),
    });
  });
  return Object.freeze({
    settlementId,
    level: product.level,
    sha256: product.sha256,
    features: Object.freeze(features),
  });
}

/** Preserve arbitrary exporter provenance as immutable JSON, not executable data. */
type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
function freezeJson(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value;
  if (typeof value === 'number') {
    requireCell(Number.isFinite(value), 'finite metadata');
    return value;
  }
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJson));
  const o = object(value);
  return Object.freeze(
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, freezeJson(v)])),
  );
}
function nonnegative(value: unknown): number {
  requireCell(
    typeof value === 'number' && Number.isFinite(value) && value >= 0,
    'nonnegative measure',
  );
  return value;
}
function polygon(value: unknown) {
  const rings = list(value).map((r) => ring(r, true));
  requireCell(rings.length > 0, 'polygon rings');
  return Object.freeze(rings);
}
export type StreetCellAssociation = Readonly<{
  roadId: string;
  sourceSegment: number;
  disposition: string;
  lengthM: number | null;
  corridorAreaSqm: number | null;
  clippedCoordinates: readonly Point[] | null;
}>;
export type StreetCellAnnotation = Readonly<{
  cellId: string;
  classification: 'empty' | 'road-crossed' | 'non-drawable';
  representativePoint: Point;
  safeZoneCoordinates: readonly (readonly Point[])[] | null;
  safeAreaSqm: number;
  reasons: readonly string[];
  margins: readonly Readonly<{
    roadIds: readonly string[];
    appliedClearanceM: number;
  }>[];
  roads: readonly StreetCellAssociation[];
  buildingEvidence: StreetCellBuildingEvidence;
}>;
export type StreetCellAnnotations = Readonly<{
  cells: Readonly<Record<string, StreetCellAnnotation>>;
  roadMetadata: JsonValue;
  roadProductSha256: string;
  evidence: StreetCellEvidence;
}>;
const tupleKeys = {
  cell: [
    'cellNumber',
    'classification',
    'representativePoint',
    'safeZoneCoordinates',
    'safeAreaSqm',
    'reasons',
    'margins',
    'roads',
    'buildingEvidence',
  ],
  building: [
    'ownedFeatureCount',
    'ownedComponentCount',
    'safeRepresentativeCount',
    'safeFullyContainedCount',
    'safeIntersectingFeatureCount',
    'safeFootprintUnionAreaSqm',
    'safeFootprintCoverage',
    'estimatedBuildingCount',
    'desiredFootprintCoverage',
  ],
  association: [
    'roadId',
    'sourceSegment',
    'disposition',
    'lengthM',
    'corridorAreaSqm',
    'clippedCoordinates',
  ],
  margin: ['roadIds', 'appliedClearanceM'],
  road: [
    'highway',
    'service',
    'bridge',
    'tunnel',
    'layer',
    'rawWidth',
    'rawLanes',
    'layerPresent',
    'atGrade',
    'width',
  ],
  width: ['widthM', 'source'],
} as const;
/** Compact V3 tuple decoding is confined to this boundary; rendering joins named
 * safe zones by stable city-scoped identity, never ordinal feature position. */
export function decodeStreetCellAnnotations(
  value: unknown,
  model: StreetCells,
  roadHash: string,
): StreetCellAnnotations {
  const root = object(value, [
    'candidatePairs',
    'cells',
    'classificationPolicy',
    'coordinateEncoding',
    'geometryPolicy',
    'evidence',
    'crs',
    'interiorToleranceM',
    'keys',
    'marginPolicy',
    'metricCrs',
    'minimumCorridorAreaSqm',
    'minimumLengthM',
    'pedestrianAllowanceM',
    'roadMetadata',
    'roadProductSha256',
    'schemaVersion',
    'serializationToleranceM',
    'settlementId',
    'widthConfidence',
  ]);
  requireCell(
    model.level === 'C' &&
      root.schemaVersion === 'street-cells-annotations-v3' &&
      root.settlementId === model.settlementId &&
      root.roadProductSha256 === roadHash,
    'annotation identity/provenance',
  );
  requireCell(
    root.classificationPolicy === policies.classificationPolicy &&
      root.marginPolicy === policies.marginPolicy &&
      root.crs === policies.crs &&
      root.metricCrs === policies.metricCrs &&
      root.coordinateEncoding === policies.annotationEncoding &&
      root.geometryPolicy === 'wgs84-grid-7-metric-checked-v3' &&
      root.serializationToleranceM === 0.021,
    'annotation policy',
  );
  const keys = object(root.keys, Object.keys(tupleKeys));
  for (const [k, fields] of Object.entries(tupleKeys))
    requireCell(
      JSON.stringify(keys[k]) === JSON.stringify(fields),
      'tuple keys',
    );
  for (const k of [
    'interiorToleranceM',
    'minimumCorridorAreaSqm',
    'minimumLengthM',
    'pedestrianAllowanceM',
    'serializationToleranceM',
  ])
    positive(root[k]);
  requireCell(
    Number.isSafeInteger(nonnegative(root.candidatePairs)),
    'candidate pairs',
  );
  const confidence = object(root.widthConfidence, ['other', 'tag']);
  requireCell(
    confidence.other === 'low' && confidence.tag === 'medium',
    'width confidence',
  );
  const metadata = object(root.roadMetadata);
  for (const [key, value] of Object.entries(metadata)) {
    text(JSON.parse(key) as unknown);
    const r = list(value);
    requireCell(r.length === 10, 'road tuple');
    text(r[0]);
    for (let i = 1; i < 7; i++)
      requireCell(
        r[i] === null ||
          typeof r[i] === 'string' ||
          (typeof r[i] === 'number' && Number.isFinite(r[i])),
        'road tag',
      );
    requireCell(
      typeof r[7] === 'boolean' && typeof r[8] === 'boolean',
      'road grade',
    );
    const width = list(r[9]);
    requireCell(width.length === 2, 'width tuple');
    positive(width[0]);
    requireCell(
      ['tag', 'inferred-lanes', 'class-fallback'].includes(text(width[1])),
      'width source',
    );
  }
  const evidence = decodeEvidence(root.evidence, model.settlementId);
  const roadId = (value: unknown) => {
    const id = text(value);
    requireCell(Object.hasOwn(metadata, JSON.stringify(id)), 'road reference');
    return id;
  };
  const ids = new Set(model.features.map((f) => f.id)),
    cells: Record<string, StreetCellAnnotation> = {};
  for (const value of list(root.cells)) {
    const t = list(value);
    requireCell(t.length === 9, 'cell tuple');
    const cellId = `${model.settlementId}-sc-${integer(t[0])}`;
    requireCell(
      ids.has(cellId) && !Object.hasOwn(cells, cellId),
      'annotation cell ID',
    );
    const classification = t[1];
    requireCell(
      classification === 'empty' ||
        classification === 'road-crossed' ||
        classification === 'non-drawable',
      'classification',
    );
    const safeAreaSqm = nonnegative(t[4]);
    requireCell(
      classification === 'non-drawable'
        ? t[3] === null && safeAreaSqm === 0
        : t[3] !== null && safeAreaSqm > 0,
      'safe zone classification',
    );
    const margins = list(t[6]).map((value) => {
      const m = list(value);
      requireCell(m.length === 2, 'margin tuple');
      const roadIds = list(m[0]).map(roadId);
      requireCell(roadIds.length > 0, 'margin roads');
      return Object.freeze({
        roadIds: Object.freeze(roadIds),
        appliedClearanceM: positive(m[1]),
      });
    });
    const roads = list(t[7]).map((value) => {
      const r = list(value);
      requireCell(r.length === 3 || r.length === 6, 'association tuple');
      const id = roadId(r[0]),
        sourceSegment = nonnegative(r[1]);
      requireCell(Number.isSafeInteger(sourceSegment), 'source segment');
      const disposition = text(r[2]);
      requireCell(
        [
          'internal',
          'corridor-support',
          'grade-separated',
          'short',
          'non-drawable-candidate',
        ].includes(disposition),
        'disposition',
      );
      requireCell(
        r.length === 6 ||
          disposition === 'grade-separated' ||
          disposition === 'non-drawable-candidate',
        'association measures',
      );
      const coords = r.length === 6 ? list(r[5]).map(annotationPoint) : null;
      requireCell(coords === null || coords.length >= 2, 'clipped line');
      return Object.freeze({
        roadId: id,
        sourceSegment,
        disposition,
        lengthM: r.length === 6 ? positive(r[3]) : null,
        corridorAreaSqm:
          r.length === 6 && r[4] !== null ? nonnegative(r[4]) : null,
        clippedCoordinates: coords === null ? null : Object.freeze(coords),
      });
    });
    cells[cellId] = Object.freeze({
      cellId,
      classification,
      representativePoint: annotationPoint(t[2]),
      safeZoneCoordinates: t[3] === null ? null : polygon(t[3]),
      safeAreaSqm,
      reasons: Object.freeze(list(t[5]).map(text)),
      margins: Object.freeze(margins),
      roads: Object.freeze(roads),
      buildingEvidence: decodeBuildingEvidence(
        t[8],
        classification,
        safeAreaSqm,
        evidence.availability,
      ),
    });
  }
  requireCell(Object.keys(cells).length === ids.size, 'annotation count');
  return Object.freeze({
    cells: Object.freeze(cells),
    evidence,
    roadMetadata: freezeJson(metadata),
    roadProductSha256: hash(root.roadProductSha256),
  });
}

/** V3 annotation precision is transport validation; original C geometry stays exact. */
function annotationPoint(value: unknown): Point {
  const point = streetCellPoint(value);
  requireCell(
    point.every((v) => Math.abs(v * 1e7 - Math.round(v * 1e7)) < 1e-6),
    'annotation coordinate precision',
  );
  return point;
}
export type StreetCellEvidence = Readonly<{
  availability: 'available' | 'partial' | 'unavailable';
  source: CellFile | null;
  sourceCounts: JsonValue;
  diagnostics: JsonValue;
}>;
export type StreetCellBuildingEvidence = Readonly<{
  ownedFeatureCount: number | null;
  ownedComponentCount: number | null;
  safeRepresentativeCount: number | null;
  safeFullyContainedCount: number | null;
  safeIntersectingFeatureCount: number | null;
  safeFootprintUnionAreaSqm: number | null;
  safeFootprintCoverage: number | null;
  estimatedBuildingCount: number | null;
  desiredFootprintCoverage: number | null;
}>;
function count(value: unknown) {
  const n = nonnegative(value);
  requireCell(Number.isSafeInteger(n), 'evidence count');
  return n;
}
function decodeEvidence(value: unknown, city: string): StreetCellEvidence {
  const e = object(value, [
    'availability',
    'source',
    'sourceCounts',
    'diagnostics',
    'estimate',
    'policy',
  ]);
  const availability = e.availability;
  requireCell(
    availability === 'available' ||
      availability === 'partial' ||
      availability === 'unavailable',
    'evidence availability',
  );
  requireCell(
    e.policy === policies.buildingEvidencePolicy &&
      e.estimate === 'unavailable-no-supported-local-estimator',
    'evidence policy',
  );
  const source =
    e.source === null
      ? null
      : file(
          object(e.source, ['path', 'byteLength', 'sha256']),
          `osm-layers/${city.slice(3)}/building.geojson`,
        );
  requireCell(
    (availability === 'unavailable') === (source === null),
    'evidence source availability',
  );
  const counts = object(e.sourceCounts, [
    'candidatePairs',
    'components',
    'excludedTagFeatures',
    'features',
    'nonPolygonFeatures',
    'partFeatures',
    'polygonFeatures',
    'rejectedFeatures',
    'unownedComponents',
    'unownedFeatures',
  ]);
  Object.values(counts).forEach(count);
  const diagnostics = list(e.diagnostics);
  for (const d of diagnostics) {
    const o = object(d, ['feature', 'id', 'reason']);
    count(o.feature);
    text(o.id);
    text(o.reason);
  }
  requireCell(
    availability !== 'unavailable' ||
      Object.values(counts).every((n) => n === 0),
    'unavailable evidence counters',
  );
  return Object.freeze({
    availability,
    source,
    sourceCounts: freezeJson(counts),
    diagnostics: freezeJson(diagnostics),
  });
}
function decodeBuildingEvidence(
  value: unknown,
  classification: StreetCellAnnotation['classification'],
  area: number,
  availability: StreetCellEvidence['availability'],
): StreetCellBuildingEvidence {
  const values = list(value);
  requireCell(
    values.length === tupleKeys.building.length,
    'building evidence tuple',
  );
  const observed = availability !== 'unavailable';
  const safe = observed && classification !== 'non-drawable';
  for (let i = 0; i < 9; i++) {
    const expected = i < 2 ? observed : i < 7 ? safe : false;
    requireCell(
      expected ? values[i] !== null : values[i] === null,
      'building evidence availability',
    );
    if (expected) {
      if (i < 5) count(values[i]);
      else nonnegative(values[i]);
    }
  }
  if (observed)
    requireCell(
      nonnegative(values[1]) >= nonnegative(values[0]),
      'owned component count',
    );
  if (safe) {
    const owned = nonnegative(values[0]),
      representative = nonnegative(values[2]),
      contained = nonnegative(values[3]),
      intersecting = nonnegative(values[4]),
      union = nonnegative(values[5]),
      coverage = nonnegative(values[6]);
    requireCell(
      contained <= representative &&
        representative <= owned &&
        contained <= intersecting,
      'safe evidence counts',
    );
    requireCell(
      coverage <= 1 && Math.abs(union / area - coverage) <= 1e-9,
      'safe evidence coverage',
    );
  }
  const measurement = (value: unknown) =>
    value === null ? null : nonnegative(value);
  return Object.freeze({
    ownedFeatureCount: measurement(values[0]),
    ownedComponentCount: measurement(values[1]),
    safeRepresentativeCount: measurement(values[2]),
    safeFullyContainedCount: measurement(values[3]),
    safeIntersectingFeatureCount: measurement(values[4]),
    safeFootprintUnionAreaSqm: measurement(values[5]),
    safeFootprintCoverage: measurement(values[6]),
    estimatedBuildingCount: null,
    desiredFootprintCoverage: null,
  });
}
