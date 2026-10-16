import { z } from 'zod';
import { freezeSettlement } from '../settlement/settlement-metadata.js';
import { validateGeographicPolygon } from './geographic-polygon.js';
import type { StreetCells } from './street-cells.js';

export const streetCellMaskRegistry = freezeSettlement([
  { t: 0, key: 'natural', value: 'water', name: 'inland water' },
  { t: 1, key: 'natural', value: 'wood', name: 'woods' },
  { t: 2, key: 'leisure', value: 'park', name: 'park' },
  { t: 3, key: 'leisure', value: 'garden', name: 'garden' },
  { t: 4, key: 'landuse', value: 'grass', name: 'grass' },
  {
    t: 5,
    key: 'landuse',
    value: 'recreation_ground',
    name: 'recreation ground',
  },
] as const);
// Registry identity is versioned policy, not the changing archive revision.
export const streetCellMaskRegistryHash =
  '6140c09bf31a4680da053ebeb48f39827910a6e13a89d6529ad951e2faec65b0';
export const streetCellMaskSemantics =
  'ordinary-building-full-footprint-intersection-exclusion-independent-C-overlay';
const registryVersion = 'osm-building-exclusion-types-v0';
function ensure(ok: boolean, message: string): asserts ok {
  if (!ok) throw new Error('Invalid StreetCell masks: ' + message);
}
export function validateStreetCellMaskRegistry(value: Record<string, unknown>) {
  ensure(
    value.maskRegistryVersion === registryVersion &&
      value.maskRegistrySha256 === streetCellMaskRegistryHash &&
      value.maskSemantics === streetCellMaskSemantics,
    'registry identity',
  );
  const types = z
    .array(
      z.strictObject({
        t: z.number().int().min(0).max(15),
        key: z.string(),
        value: z.string(),
        name: z.string(),
      }),
    )
    .max(16)
    .parse(value.maskTypes);
  ensure(
    types.length === streetCellMaskRegistry.length &&
      streetCellMaskRegistry.every(
        (expected) =>
          types.filter(
            (t) =>
              t.t === expected.t &&
              t.key === expected.key &&
              t.value === expected.value &&
              t.name === expected.name,
          ).length === 1,
      ),
    'unsupported type registry',
  );
}
const integer = z.number().int().nonnegative().safe();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const source = z.strictObject({
  path: z.string().regex(/^osm-layers\/[a-z0-9_-]+\/[a-z0-9_-]+\.geojson$/),
  byteLength: integer.positive(),
  sha256: hash,
  selector: z.string(),
});
const scope = z.strictObject({
  bounds: z
    .array(z.number())
    .length(4)
    .transform(
      (v) =>
        [
          z.number().min(-180).max(180).parse(v[0]),
          z.number().min(-90).max(90).parse(v[1]),
          z.number().min(-180).max(180).parse(v[2]),
          z.number().min(-90).max(90).parse(v[3]),
        ] as const,
    )
    .refine(([w, s, e, n]) => w < e && s < n),
  policy: z.literal(
    'positive-area-intersection-with-configured-city-box-no-clipping',
  ),
});
const descriptor = {
  path: z.string(),
  byteLength: integer.positive().max(64 * 1024 * 1024),
  sha256: hash,
  count: integer.max(100_000),
  crs: z.literal('EPSG:4326'),
};
const masksDescriptor = z.strictObject({
  ...descriptor,
  schemaVersion: z.literal('city-masks-v0'),
  geometry: z.literal('Polygon'),
  scope,
  sources: z.array(source).max(16),
});
const refsDescriptor = z.strictObject({
  ...descriptor,
  schemaVersion: z.literal('cell-mask-refs-v0'),
  geometry: z.literal('cell-ID-references'),
  sourceCProductSha256: hash,
  sourceMaskProductSha256: hash,
});
export type StreetCellMaskDescriptor = Readonly<
  z.infer<typeof masksDescriptor>
>;
export type StreetCellMaskRefsDescriptor = Readonly<
  z.infer<typeof refsDescriptor>
>;
export function parseStreetCellMaskDescriptors(
  masks: unknown,
  refs: unknown,
  city: string,
  cHash: string,
  cCount: number,
) {
  const m = masksDescriptor.parse(masks),
    r = refsDescriptor.parse(refs);
  ensure(
    m.path === city + '/masks.v0.geojson' &&
      r.path === city + '/cell-mask-refs.v0.json',
    'city-local paths',
  );
  ensure(
    r.sourceCProductSha256 === cHash &&
      r.sourceMaskProductSha256 === m.sha256 &&
      r.count === cCount,
    'descriptor source join',
  );
  for (const s of m.sources)
    ensure(
      s.path.startsWith('osm-layers/' + city.slice(3) + '/') &&
        streetCellMaskRegistry.some(
          (t) => t.key + '=' + t.value === s.selector,
        ),
      'source provenance',
    );
  ensure(
    new Set(m.sources.map((s) => s.selector)).size === m.sources.length,
    'duplicate source selector',
  );
  return freezeSettlement({ masks: m, cellMaskRefs: r });
}
const number = z
  .number()
  .finite()
  .refine((n) => n === Number(n.toFixed(7)), 'seven-decimal coordinate');
const longitude = number.min(-180).max(180),
  latitude = number.min(-90).max(90);
const point = z
  .array(number)
  .length(2)
  .transform((v) => [longitude.parse(v[0]), latitude.parse(v[1])] as const);
const polygon = z.strictObject({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(point).min(4).max(2048)).min(1).max(32),
});
const maskFeature = z.strictObject({
  type: z.literal('Feature'),
  id: z.string().min(1),
  geometry: polygon,
  properties: z.strictObject({
    t: integer.max(15),
    src: z.string().regex(/^[RWN][1-9][0-9]*$/),
    part: integer,
    sources: z.array(integer).min(1).max(16),
    areaSqm: z.number().positive().finite(),
    tags: z.record(
      z.string(),
      z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
    ),
  }),
});
const counts = z.record(z.enum(['0', '1', '2', '3', '4', '5']), integer);
const audit = z.strictObject({
  availability: z.enum(['available', 'partial', 'unavailable']),
  cutoffAreaSqm: z.number().positive().nullable(),
  diagnostics: z.array(z.record(z.string(), z.unknown())).max(100_000),
  duplicates: integer,
  exploded: integer,
  missingSelectors: z.array(z.string()).max(16),
  omittedCapacity: integer,
  ranked: integer,
  raw: integer,
  selected: integer,
  typeCandidateCounts: counts,
  typeCounts: counts,
  typeOmittedCounts: counts,
  unique: integer,
  valid: integer,
});
const maskCollection = z.strictObject({
  type: z.literal('FeatureCollection'),
  schemaVersion: z.literal('city-masks-v0'),
  settlementId: z.string(),
  crs: z.literal('EPSG:4326'),
  metricCrs: z.literal('EPSG:3035'),
  geometryPolicy: z.literal('polygon-grid7-metric-checked-v0'),
  registryVersion: z.literal(registryVersion),
  scope,
  sources: z.array(source).max(16),
  audit,
  features: z.array(maskFeature).max(100_000),
});
const cellNumber = integer.positive(),
  maskReferences = z.array(z.string()).max(100_000);
const refCollection = z.strictObject({
  schemaVersion: z.literal('cell-mask-refs-v0'),
  settlementId: z.string(),
  criterion: z.literal('positive-source-C-polygon-area-intersection'),
  cells: z
    .array(
      z
        .array(z.unknown())
        .length(2)
        .transform(
          (v) => [cellNumber.parse(v[0]), maskReferences.parse(v[1])] as const,
        ),
    )
    .max(100_000),
  statistics: z.strictObject({
    associations: integer,
    candidatePairs: integer,
    cells: integer,
    referencedMasks: integer,
    touchedCells: integer,
    zeroMaskCells: integer,
  }),
});
export type StreetCellMasks = Readonly<{
  sha256: string;
  refsSha256: string;
  availability: 'available' | 'partial' | 'unavailable';
  omittedCapacity: number;
  missingSelectors: readonly string[];
  features: readonly Readonly<{
    id: string;
    geometry: Readonly<{
      type: 'Polygon';
      coordinates: readonly (readonly (readonly [number, number])[])[];
    }>;
    properties: Readonly<{
      t: number;
      src: string;
      part: number;
      sources: readonly number[];
      areaSqm: number;
      tags: Readonly<Record<string, string | number | boolean | null>>;
    }>;
  }>[];
  cellRefs: Readonly<Record<string, readonly string[]>>;
}>;
/** Strict independent overlay; C geometry/annotations remain byte-for-byte authoritative. */
export function decodeStreetCellMasks(
  value: unknown,
  references: unknown,
  cells: StreetCells,
  descriptor: StreetCellMaskDescriptor,
  refsDescriptor: StreetCellMaskRefsDescriptor,
): StreetCellMasks {
  const m = maskCollection.parse(value),
    r = refCollection.parse(references);
  ensure(
    cells.level === 'C' &&
      m.settlementId === cells.settlementId &&
      r.settlementId === cells.settlementId,
    'city/C identity',
  );
  ensure(
    JSON.stringify(m.scope) === JSON.stringify(descriptor.scope) &&
      JSON.stringify(m.sources) === JSON.stringify(descriptor.sources),
    'source/scope identity',
  );
  ensure(
    m.features.length === descriptor.count &&
      m.audit.selected === m.features.length &&
      r.cells.length === refsDescriptor.count &&
      r.cells.length === cells.features.length &&
      refsDescriptor.sourceCProductSha256 === cells.sha256 &&
      refsDescriptor.sourceMaskProductSha256 === descriptor.sha256,
    'counts/product join',
  );
  const ids = new Set<string>(),
    typeCounts = new Array<number>(streetCellMaskRegistry.length).fill(0);
  for (const f of m.features) {
    const t = streetCellMaskRegistry.find((t) => t.t === f.properties.t);
    ensure(
      t !== undefined &&
        f.id ===
          `${cells.settlementId}-mask-s%3A${encodeURIComponent(f.properties.src)}-${f.properties.part}` &&
        !ids.has(f.id),
      'type/feature identity',
    );
    ensure(
      new Set(f.properties.sources).size === f.properties.sources.length &&
        f.properties.sources.every((i) => i < m.sources.length) &&
        f.properties.sources.some(
          (i) => m.sources[i]!.selector === t.key + '=' + t.value,
        ),
      'feature source references',
    );
    validateGeographicPolygon(f.geometry.coordinates);
    ids.add(f.id);
    typeCounts[t.t]!++;
  }
  for (const t of streetCellMaskRegistry)
    ensure(m.audit.typeCounts[t.t] === typeCounts[t.t], 'type counts');
  const sum = (counts: Record<string, number>) =>
    Object.values(counts).reduce((n, v) => n + v, 0);
  ensure(
    m.audit.ranked === m.audit.selected + m.audit.omittedCapacity &&
      sum(m.audit.typeCandidateCounts) === m.audit.ranked &&
      sum(m.audit.typeOmittedCounts) === m.audit.omittedCapacity &&
      streetCellMaskRegistry.every(
        (t) =>
          m.audit.typeCandidateCounts[t.t] ===
          m.audit.typeCounts[t.t] + m.audit.typeOmittedCounts[t.t],
      ),
    'capacity/type inventory',
  );
  const missing = streetCellMaskRegistry
    .map((t) => t.key + '=' + t.value)
    .filter((selector) => !m.sources.some((s) => s.selector === selector));
  ensure(
    JSON.stringify([...m.audit.missingSelectors].sort()) ===
      JSON.stringify(missing.sort()) &&
      m.audit.availability ===
        (missing.length === 6
          ? 'unavailable'
          : missing.length
            ? 'partial'
            : 'available'),
    'source availability',
  );
  const validCells = new Set(cells.features.map((f) => f.id)),
    cellRefs: Record<string, readonly string[]> = {},
    referenced = new Set<string>();
  let associations = 0,
    touched = 0;
  for (const [number, masks] of r.cells) {
    const id = `${cells.settlementId}-sc-${number}`;
    ensure(
      validCells.has(id) &&
        !Object.hasOwn(cellRefs, id) &&
        new Set(masks).size === masks.length &&
        masks.every((mask) => ids.has(mask)),
      'C/mask reference join',
    );
    cellRefs[id] = masks;
    associations += masks.length;
    if (masks.length) touched++;
    masks.forEach((mask) => referenced.add(mask));
  }
  const s = r.statistics;
  ensure(
    s.cells === validCells.size &&
      s.associations === associations &&
      s.touchedCells === touched &&
      s.zeroMaskCells === validCells.size - touched &&
      s.referencedMasks === referenced.size &&
      s.candidatePairs >= associations,
    'reference statistics',
  );
  return freezeSettlement({
    sha256: descriptor.sha256,
    refsSha256: refsDescriptor.sha256,
    features: m.features,
    availability: m.audit.availability,
    omittedCapacity: m.audit.omittedCapacity,
    missingSelectors: m.audit.missingSelectors,
    cellRefs,
  });
}
