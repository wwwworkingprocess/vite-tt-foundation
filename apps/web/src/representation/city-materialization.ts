import { z } from 'zod';
import { freezeSettlement } from '../settlement/settlement-metadata.js';
import { validateGeographicPolygon } from './geographic-polygon.js';
const text = z.string().min(1);
const city = text.regex(/^[a-z]{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
export const materializationPath = text
  .regex(/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*$/)
  .refine(
    (v) => v.split('/').every((p) => p !== '.' && p !== '..'),
    'Noncanonical materialization path',
  );
const fractions = z.strictObject({
  A: z.number().finite().min(0).max(1),
  B: z.number().finite().min(0).max(1),
  C: z.number().finite().min(0).max(1),
});
const placement = z.enum(['extent-centroid', 'anchor']);
const rotationDeg = z.number().finite().min(-360).max(360);
const repeat = {
  kitId: text,
  spacingM: z.number().finite().positive().max(250),
  maxInstances: z.number().int().min(0).max(2000),
  lodFractions: fractions,
};
const recipes = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('surface'),
    preset: z.enum([
      'salt-lagoon-pink-v0',
      'beach-sand-v0',
      'park-ground-v0',
      'market-ground-v0',
      'harbor-water-v0',
      'salt-flat-v0',
      'civic-stone-v0',
    ]),
    terrainRule: z.enum(['native-land', 'native-water', 'native-both']),
    clearanceM: z.number().finite().min(0).max(1),
  }),
  z.strictObject({
    kind: z.literal('area-repeat'),
    ...repeat,
    pattern: z.enum(['rows', 'grid', 'scattered']),
    orientation: z.enum(['site-long-axis', 'north', 'layout-guide']),
  }),
  z.strictObject({
    kind: z.literal('line-repeat'),
    ...repeat,
    geometryRole: z.enum(['layout-guide', 'mooring-line']),
  }),
  z.strictObject({
    kind: z.literal('single-kit'),
    kitId: text,
    placement,
    rotationDeg,
  }),
  z.strictObject({
    kind: z.literal('glb-model'),
    assetPath: materializationPath,
    assetSha256: hash,
    placement,
    rotationDeg,
    scale: z.number().finite().positive().max(100),
  }),
]);
const reference = z.strictObject({
  role: z.enum([
    'extent',
    'layout-guide',
    'anchor',
    'water-boundary',
    'mooring-line',
  ]),
  path: materializationPath,
  sha256: hash,
  sourceDataset: text,
  sourceFeatureId: text,
  quality: z.enum([
    'osm-observed',
    'official-verified',
    'authored-reviewed',
    'research-approximate',
  ]),
});
const visibility = z.enum([
  'hidden',
  'surface-or-symbol',
  'simplified',
  'full',
]);
const site = z.strictObject({
  id: text.regex(/^ua-site-[a-z0-9-]+$/),
  name: text,
  sourceAssetId: text.nullable(),
  stage: z.enum(['unmaterialized', 'proxy-ready', 'asset-ready', 'disabled']),
  geometries: z.array(reference),
  recipes: z.array(recipes),
  lod: z.strictObject({ A: visibility, B: visibility, C: visibility }),
  physical: z.strictObject({
    mode: z.enum(['visual-only', 'reserve-reviewed-extent']),
    approved: z.boolean(),
    approvalId: z.string().optional(),
  }),
  notes: z.array(z.string()),
});
const catalog = z.strictObject({
  schemaVersion: z.literal('0.1.0'),
  contract: z.literal('city-materialization'),
  settlementId: city,
  coordinatePrecisionDecimals: z.literal(7),
  kitCatalogPath: materializationPath,
  sites: z.array(site).max(128),
});
export const materializationRenderKeys = [
  'market-canopy-v0',
  'beach-umbrella-v0',
  'park-tree-v0',
  'small-boat-v0',
  'salt-stack-v0',
  'tower-proxy-v0',
  'civic-proxy-v0',
] as const;
const kits = z.strictObject({
  schemaVersion: z.literal('0.1.0'),
  contract: z.literal('materialization-kit-catalog'),
  kits: z.array(
    z.strictObject({
      id: text.regex(/^ua-kit-[a-z0-9-]+$/),
      implementation: z.literal('builtin'),
      renderKey: z.enum(materializationRenderKeys),
      instanced: z.boolean(),
    }),
  ),
});
type Immutable<T> = T extends readonly unknown[]
  ? { readonly [K in keyof T]: Immutable<T[K]> }
  : T extends object
    ? { readonly [K in keyof T]: Immutable<T[K]> }
    : T;
export type MaterializationCatalog = Immutable<z.infer<typeof catalog>>;
export type MaterializationReference = Immutable<z.infer<typeof reference>>;
export type MaterializationKitCatalog = Immutable<z.infer<typeof kits>>;
export type MaterializationRecipe = Immutable<z.infer<typeof recipes>>;
function ensure(ok: boolean, message: string): asserts ok {
  if (!ok) throw new Error('Invalid materialization: ' + message);
}
export function parseMaterializationCatalog(
  value: unknown,
  settlementId: string,
): MaterializationCatalog {
  const parsed = catalog.parse(value);
  ensure(parsed.settlementId === settlementId, 'settlement identity');
  ensure(
    new Set(parsed.sites.map((s) => s.id)).size === parsed.sites.length,
    'duplicate site ID',
  );
  for (const s of parsed.sites) {
    ensure(
      s.physical.mode === 'visual-only' && !s.physical.approved,
      'physical reservation is unsupported',
    );
    if (s.stage === 'proxy-ready' || s.stage === 'asset-ready')
      ensure(
        s.geometries.length > 0 && s.recipes.length > 0,
        'ready site lacks geometry or recipe',
      );
    ensure(
      new Set(s.geometries.map((g) => g.path)).size === s.geometries.length,
      'duplicate geometry',
    );
    for (const g of s.geometries)
      ensure(
        g.path.startsWith(settlementId + '/materialization/'),
        'geometry belongs to another city',
      );
  }
  ensure(
    parsed.kitCatalogPath.startsWith('shared/materialization/'),
    'shared kit path',
  );
  return freezeSettlement(parsed);
}
export function parseMaterializationKits(
  value: unknown,
): MaterializationKitCatalog {
  const parsed = kits.parse(value);
  ensure(
    new Set(parsed.kits.map((k) => k.id)).size === parsed.kits.length,
    'duplicate kit ID',
  );
  return freezeSettlement(parsed);
}
// Reuse the project's existing finite WGS84-pair validation pattern.
const coordinate = z
  .array(z.number().finite())
  .length(2)
  .refine(
    (p) => Math.abs(p[0]!) <= 180 && Math.abs(p[1]!) <= 90,
    'Invalid WGS84 coordinate',
  )
  .refine(
    (p) => p.every((v) => Math.abs(v * 1e7 - Math.round(v * 1e7)) < 1e-6),
    'Coordinate exceeds seven decimals',
  )
  .transform((p) => [p[0]!, p[1]!] as const);
const ring = z.array(coordinate).min(4).max(2048);
const polygon = z.strictObject({
  type: z.literal('Polygon'),
  coordinates: z.array(ring).min(1).max(32),
});
const geometry = z.discriminatedUnion('type', [
  polygon,
  z.strictObject({
    type: z.literal('MultiPolygon'),
    coordinates: z.array(z.array(ring).min(1)).min(1),
  }),
  z.strictObject({ type: z.literal('Point'), coordinates: coordinate }),
  z.strictObject({
    type: z.literal('LineString'),
    coordinates: z.array(coordinate).min(2),
  }),
  z.strictObject({
    type: z.literal('MultiLineString'),
    coordinates: z.array(z.array(coordinate).min(2)).min(1),
  }),
]);
const feature = z.strictObject({
  type: z.literal('Feature'),
  id: text,
  geometry,
  properties: z.record(z.string(), z.unknown()),
});
export type MaterializationGeometry = Immutable<z.infer<typeof feature>>;
export function decodeMaterializationGeometry(
  value: unknown,
  ref: MaterializationReference,
): MaterializationGeometry {
  const parsed = feature.parse(value);
  ensure(parsed.id === ref.sourceFeatureId, 'source identity');
  const g = parsed.geometry;
  if (ref.role === 'extent' || ref.role === 'water-boundary')
    ensure(
      g.type === 'Polygon' || g.type === 'MultiPolygon',
      'extent geometry',
    );
  else if (ref.role === 'anchor') ensure(g.type === 'Point', 'anchor geometry');
  else
    ensure(
      g.type === 'LineString' || g.type === 'MultiLineString',
      'guide geometry',
    );
  if (g.type === 'Polygon') validateGeographicPolygon(g.coordinates);
  if (g.type === 'MultiPolygon')
    for (const p of g.coordinates) validateGeographicPolygon(p);
  return freezeSettlement(parsed);
}
export type CityMaterialization = Readonly<{
  catalog: MaterializationCatalog;
  kits: MaterializationKitCatalog;
  sites: readonly Readonly<{
    site: MaterializationCatalog['sites'][number];
    geometries: readonly Readonly<{
      reference: MaterializationReference;
      feature: MaterializationGeometry;
    }>[];
  }>[];
}>;
