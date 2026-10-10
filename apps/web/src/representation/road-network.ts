import type { D3dLodBand } from './d3d-map-model.js';
import type { RepresentationMode } from './representation-cadence.js';
export type RoadLevel = 'A' | 'B' | 'C';
type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | JsonObject;
interface JsonObject {
  readonly [key: string]: JsonValue;
}
export type RoadDescriptor = Readonly<{
  level: RoadLevel;
  name: string;
  path: string;
  featureCount: number;
  classCounts: Readonly<Record<string, number>>;
  bridgeLineCount: number;
  tunnelLineCount: number;
  byteLength: number;
  sha256: string;
}>;
export type RoadCatalog = Readonly<{
  schemaVersion: 'road-network-catalog-v0';
  version: '0.0.0';
  settlementId: string;
  crs: 'EPSG:4326';
  geometry: 'LineString';
  coordinateSemantics: 'source-longitude-latitude-preserved-no-clipping';
  identityPolicy: 'source-feature-id-preserved-no-created-road-identities';
  policy: Readonly<{
    version: 'motor-street-lines-v0';
    classes: Readonly<Record<RoadLevel, readonly string[]>>;
  }>;
  products: readonly RoadDescriptor[];
  source: JsonObject;
  audit: JsonObject;
}>;
export type RoadFeature = Readonly<{
  type: 'Feature';
  id: string;
  properties: Readonly<{
    highway: string;
    bridge?: string;
    tunnel?: string;
    layer?: number | string;
    [key: string]: JsonValue | undefined;
  }>;
  geometry: Readonly<{
    type: 'LineString';
    coordinates: readonly (readonly [number, number])[];
  }>;
}>;
export type RoadNetwork = Readonly<{
  settlementId: string;
  level: RoadLevel;
  sha256: string;
  features: readonly RoadFeature[];
}>;
const levels = ['A', 'B', 'C'] as const;
const primary = [
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
];
const connected = [
  ...primary,
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'unclassified',
];
const classes = {
  A: primary,
  B: connected,
  C: [...connected, 'residential', 'living_street', 'service'],
};
const names = { A: 'Primary', B: 'Connected', C: 'Detailed' };
/** All graphs have passed bounded JSON validation before freezing. Already frozen
 * parents must still have their children traversed (shallow freeze is insufficient). */
function freezeRoad<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) freezeRoad(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
}
function requireRoad(valid: boolean, message: string): asserts valid {
  if (!valid) throw new Error('Invalid road ' + message);
}
function dictionary(
  value: unknown,
  keys?: readonly string[],
): Record<string, unknown> {
  requireRoad(
    typeof value === 'object' && value !== null && !Array.isArray(value),
    'object',
  );
  // The runtime object guard supplies the dictionary narrowing TypeScript cannot infer.
  const result = value as Record<string, unknown>;
  const prototype: unknown = Object.getPrototypeOf(result);
  requireRoad(
    prototype === Object.prototype || prototype === null,
    'JSON object prototype',
  );
  if (keys)
    requireRoad(
      Object.keys(result).length === keys.length &&
        keys.every((k) => Object.hasOwn(result, k)),
      'object fields',
    );
  return result;
}
function text(value: unknown): string {
  requireRoad(typeof value === 'string' && value.length > 0, 'string');
  return value;
}
function integer(value: unknown, minimum = 0): number {
  requireRoad(
    typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= minimum,
    'count/byte length',
  );
  return value;
}
function list(value: unknown): unknown[] {
  requireRoad(Array.isArray(value), 'array');
  return value;
}
function level(value: unknown): RoadLevel {
  requireRoad(value === 'A' || value === 'B' || value === 'C', 'level');
  return value;
}
/** JSON transport has already parsed these values. Check metadata as well for the
 * pure unknown-input API; bound nesting and detect cycles before deep freezing.
 * Retain the original graph, rather than cloning all OSM properties/coordinates.
 */
function jsonValue(
  value: unknown,
  ancestors = new Set<object>(),
  depth = 0,
): asserts value is JsonValue {
  requireRoad(depth <= 128, 'metadata depth');
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return;
  if (typeof value === 'number') {
    requireRoad(Number.isFinite(value), 'metadata number');
    return;
  }
  const values = Array.isArray(value)
    ? value
    : Object.values(dictionary(value));
  requireRoad(!ancestors.has(value as object), 'metadata cycle');
  ancestors.add(value as object);
  for (const child of values) jsonValue(child, ancestors, depth + 1);
  ancestors.delete(value as object);
}
function jsonObject(value: unknown): JsonObject {
  dictionary(value);
  jsonValue(value);
  return value as JsonObject;
}
export function parseRoadCatalog(value: unknown): RoadCatalog {
  const c = dictionary(value, [
    'schemaVersion',
    'version',
    'settlementId',
    'crs',
    'geometry',
    'coordinateSemantics',
    'identityPolicy',
    'policy',
    'products',
    'source',
    'audit',
  ]);
  requireRoad(
    c.schemaVersion === 'road-network-catalog-v0' &&
      c.version === '0.0.0' &&
      c.crs === 'EPSG:4326' &&
      c.geometry === 'LineString' &&
      c.coordinateSemantics ===
        'source-longitude-latitude-preserved-no-clipping' &&
      c.identityPolicy ===
        'source-feature-id-preserved-no-created-road-identities',
    'catalog semantics',
  );
  const settlementId = text(c.settlementId);
  requireRoad(/^[a-z0-9-]+$/.test(settlementId), 'settlement');
  const policy = dictionary(c.policy, ['version', 'classes']);
  requireRoad(
    policy.version === 'motor-street-lines-v0',
    'class policy version',
  );
  const declared = dictionary(policy.classes, levels);
  const validatedClasses = {
    A: [] as string[],
    B: [] as string[],
    C: [] as string[],
  };
  for (const l of levels) {
    const keys = list(declared[l]).map(text);
    requireRoad(
      keys.length === classes[l].length &&
        classes[l].every((k) => keys.includes(k)),
      'class policy',
    );
    validatedClasses[l] = keys;
  }
  const sourceProducts = list(c.products);
  requireRoad(sourceProducts.length === 3, 'product levels');
  const seen = new Set<RoadLevel>();
  const products = sourceProducts.map((raw) => {
    const p = dictionary(raw, [
      'level',
      'name',
      'path',
      'featureCount',
      'classCounts',
      'bridgeLineCount',
      'tunnelLineCount',
      'byteLength',
      'sha256',
    ]);
    const l = level(p.level);
    requireRoad(!seen.has(l), 'duplicate product level');
    seen.add(l);
    const name = text(p.name),
      path = text(p.path),
      sha256 = text(p.sha256);
    requireRoad(
      name === names[l] &&
        path === `${settlementId}/roads-${l.toLowerCase()}.v0.geojson` &&
        /^[0-9a-f]{64}$/.test(sha256),
      'product identity/path/hash',
    );
    const counts = dictionary(p.classCounts, classes[l]);
    const classCounts = Object.fromEntries(
      Object.entries(counts).map(([k, n]) => [k, integer(n)]),
    );
    const featureCount = integer(p.featureCount),
      bridgeLineCount = integer(p.bridgeLineCount),
      tunnelLineCount = integer(p.tunnelLineCount);
    requireRoad(
      Object.values(classCounts).reduce((sum, n) => sum + n, 0) ===
        featureCount &&
        bridgeLineCount <= featureCount &&
        tunnelLineCount <= featureCount,
      'declared counts',
    );
    return {
      level: l,
      name,
      path,
      sha256,
      classCounts,
      featureCount,
      bridgeLineCount,
      tunnelLineCount,
      byteLength: integer(p.byteLength, 1),
    };
  });
  return freezeRoad({
    schemaVersion: 'road-network-catalog-v0',
    version: '0.0.0',
    settlementId,
    crs: 'EPSG:4326',
    geometry: 'LineString',
    coordinateSemantics: 'source-longitude-latitude-preserved-no-clipping',
    identityPolicy: 'source-feature-id-preserved-no-created-road-identities',
    policy: { version: 'motor-street-lines-v0', classes: validatedClasses },
    products,
    source: jsonObject(c.source),
    audit: jsonObject(c.audit),
  });
}
function validateFeature(value: unknown): RoadFeature {
  const f = dictionary(value, ['type', 'id', 'properties', 'geometry']),
    g = dictionary(f.geometry, ['type', 'coordinates']);
  requireRoad(
    f.type === 'Feature' && g.type === 'LineString',
    'GeoJSON feature/geometry',
  );
  text(f.id);
  const props = jsonObject(f.properties);
  text(props.highway);
  for (const tag of ['bridge', 'tunnel'])
    if (props[tag] !== undefined) text(props[tag]);
  if (props.layer !== undefined)
    requireRoad(
      typeof props.layer === 'number' ||
        (typeof props.layer === 'string' && /^-?\d+$/.test(props.layer)),
      'layer tag',
    );
  const coordinates = list(g.coordinates);
  requireRoad(coordinates.length >= 2, 'LineString support');
  for (const raw of coordinates) {
    const p = list(raw);
    requireRoad(
      p.length === 2 &&
        typeof p[0] === 'number' &&
        Number.isFinite(p[0]) &&
        Math.abs(p[0]) <= 180 &&
        typeof p[1] === 'number' &&
        Number.isFinite(p[1]) &&
        Math.abs(p[1]) <= 90,
      'WGS84 coordinate',
    );
  }
  // Every feature field, property value and coordinate has now been checked.
  return value as RoadFeature;
}
const tagged = (value: string | undefined) =>
  value !== undefined && value !== 'no';
export function decodeRoadProduct(
  value: unknown,
  catalog: RoadCatalog,
  product: RoadDescriptor,
): RoadNetwork {
  const data = dictionary(value, ['type', 'features']);
  requireRoad(data.type === 'FeatureCollection', 'GeoJSON collection');
  const features = list(data.features).map(validateFeature),
    ids = new Set<string>(),
    counts: Record<string, number> = {};
  let bridges = 0,
    tunnels = 0;
  for (const f of features) {
    if (
      ids.has(f.id) ||
      !catalog.policy.classes[product.level].includes(f.properties.highway)
    )
      throw new Error('Road feature identity or highway class mismatch');
    ids.add(f.id);
    counts[f.properties.highway] = (counts[f.properties.highway] ?? 0) + 1;
    if (tagged(f.properties.bridge)) bridges++;
    if (tagged(f.properties.tunnel)) tunnels++;
  }
  if (
    features.length !== product.featureCount ||
    bridges !== product.bridgeLineCount ||
    tunnels !== product.tunnelLineCount ||
    Object.entries(product.classCounts).some(
      ([key, n]) => (counts[key] ?? 0) !== n,
    )
  )
    throw new Error('Road product feature/tag/class count mismatch');
  return freezeRoad({
    settlementId: catalog.settlementId,
    level: product.level,
    sha256: product.sha256,
    features,
  });
}
export function roadNetworkLevel(
  mode: RepresentationMode,
  lod: D3dLodBand,
): RoadLevel {
  return mode === 'mini'
    ? 'A'
    : ({ far: 'A', medium: 'B', near: 'C' } as const)[lod];
}
