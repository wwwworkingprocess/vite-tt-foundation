import { z } from 'zod';
import {
  freezeTerrain,
  terrainViewportSchema,
  type TerrainResolution,
} from './terrain-catalog.js';
import type { TerrainProductDecoder } from './terrain-runtime.js';
// Same fixed-pair validation convention as settlement metadata; no new validator family.
const position = z
  .array(z.number().finite())
  .length(2)
  .transform((value) => [value[0]!, value[1]!] as const);
const line = z.array(position).min(2);
const feature = z
  .object({
    type: z.literal('Feature'),
    id: z.string(),
    properties: z.object({
      settlementId: z.string(),
      kind: z.enum(['land', 'coastline', 'coverage-edge']),
      clippedByCoverage: z.boolean(),
      boundarySourceViewportIds: z.array(z.string()).min(1),
    }),
    geometry: z.object({
      type: z.enum(['Polygon', 'MultiLineString']),
      coordinates: z.array(line).min(1),
    }),
  })
  .refine((f) =>
    f.properties.kind === 'land'
      ? f.geometry.type === 'Polygon' &&
        f.geometry.coordinates.every(
          (r) =>
            r.length >= 4 &&
            r[0]![0] === r.at(-1)![0] &&
            r[0]![1] === r.at(-1)![1],
        )
      : f.geometry.type === 'MultiLineString' &&
        f.properties.clippedByCoverage ===
          (f.properties.kind === 'coverage-edge'),
  );
const coastSchema = z.object({
  type: z.literal('FeatureCollection'),
  schemaVersion: z.literal('0.0.0'),
  settlementId: z.string(),
  coordinateReferenceSystem: z.literal('EPSG:3035'),
  coordinateUnit: z.literal('m'),
  geoJsonProfile: z.literal('workbench-projected-v0'),
  sourceMaskSchemaVersion: z.literal('0.0.0'),
  sourceViewportIds: z.array(z.string()).min(1),
  features: z.array(feature),
});
const rasterViewport = terrainViewportSchema.extend({
  rowOrder: z.literal('north-to-south'),
  columnOrder: z.literal('west-to-east'),
  storageOrder: z.literal('row-major'),
});
const heightViewport = rasterViewport.extend({
  elevationUnit: z.literal('m'),
  // Validate/copy once in the decoder loop; Zod must not clone the large source arrays.
  elevations: z.unknown(),
});
const maskViewport = rasterViewport.extend({
  encoding: z.literal('row-major-0-water-1-land'),
  cells: z.unknown(),
});
const root = z.object({
  schemaVersion: z.literal('0.0.0'),
  settlementId: z.string(),
  crs: z.literal('EPSG:3035'),
  resolutionMetersX: z.number().positive(),
  resolutionMetersY: z.number().positive(),
  scenarioViewportMap: z.record(z.string(), z.string()),
});
const heightSchema = root.extend({ viewports: z.array(heightViewport).min(1) });
const maskSchema = root.extend({
  derivationRule: z.literal('prepared-coastal-eudem-finite-land-null-water-v0'),
  viewports: z.array(maskViewport).min(1),
});
function matchesRaster(
  product: z.infer<typeof root>,
  resolved: TerrainResolution,
) {
  if (
    product.settlementId !== resolved.settlementId ||
    product.resolutionMetersX !== resolved.entry.resolutionMeters.x ||
    product.resolutionMetersY !== resolved.entry.resolutionMeters.y ||
    JSON.stringify(Object.entries(product.scenarioViewportMap).sort()) !==
      JSON.stringify(Object.entries(resolved.entry.scenarioViewportMap).sort())
  )
    throw new Error('Terrain product identity/resolution/mapping mismatch');
}
/** JSON V0 adapter. Float64 preserves every finite JS source value, including
 * future fixtures with precision beyond Float32. Validity is the independent mask.
 * Typed storage is private; callers cannot mutate either authority.
 */
export const terrainJsonDecoder: TerrainProductDecoder =
  Object.freeze<TerrainProductDecoder>({
    decode(products, resolved) {
      const p = resolved.entry.products;
      if (
        p.height.mediaType !== 'application/json' ||
        p.surfaceMask.mediaType !== 'application/json' ||
        p.coastline.mediaType !== 'application/geo+json'
      )
        throw new Error('Unsupported terrain JSON media type');
      const decodeJson = (value: unknown): unknown =>
        typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
      const height = heightSchema.parse(decodeJson(products.height)),
        mask = maskSchema.parse(decodeJson(products.surfaceMask));
      const coastline = coastSchema.parse(decodeJson(products.coastline));
      matchesRaster(height, resolved);
      matchesRaster(mask, resolved);
      const h = height.viewports.find(
        (v) => v.terrainViewportId === resolved.viewport.terrainViewportId,
      );
      const m = mask.viewports.find(
        (v) => v.terrainViewportId === resolved.viewport.terrainViewportId,
      );
      const meta = (v: TerrainResolution['viewport']) =>
        JSON.stringify([v.width, v.height, v.rasterBounds3035]);
      if (
        !h ||
        !m ||
        meta(h) !== meta(resolved.viewport) ||
        meta(m) !== meta(resolved.viewport)
      )
        throw new Error('Terrain product viewport mismatch');
      const n = h.width * h.height;
      const sourceHeights = h.elevations,
        sourceMask = m.cells;
      if (!Array.isArray(sourceHeights) || !Array.isArray(sourceMask))
        throw new Error('Terrain raster arrays malformed');
      if (sourceHeights.length !== n || sourceMask.length !== n)
        throw new Error('Terrain sample count mismatch');
      const elevations = new Float64Array(n),
        cells = new Uint8Array(n);
      let landSamples = 0,
        minimum = Infinity,
        maximum = -Infinity;
      for (let i = 0; i < n; i++) {
        const value: unknown = sourceHeights[i],
          cell: unknown = sourceMask[i];
        if (
          !(
            value === null ||
            (typeof value === 'number' && Number.isFinite(value))
          ) ||
          !(cell === 0 || cell === 1) ||
          (value === null ? 0 : 1) !== cell
        )
          throw new Error('Terrain elevation/mask classification mismatch');
        cells[i] = cell;
        if (value !== null) {
          elevations[i] = value;
          landSamples++;
          minimum = Math.min(minimum, value);
          maximum = Math.max(maximum, value);
        }
      }
      const viewportIds = new Set(
        resolved.entry.viewports.map((v) => v.terrainViewportId),
      );
      if (
        coastline.settlementId !== resolved.settlementId ||
        !coastline.sourceViewportIds.includes(h.terrainViewportId) ||
        coastline.sourceViewportIds.some((id) => !viewportIds.has(id)) ||
        coastline.features.some(
          (f) =>
            f.properties.settlementId !== resolved.settlementId ||
            f.properties.boundarySourceViewportIds.some(
              (id) => !viewportIds.has(id),
            ),
        )
      )
        throw new Error('Terrain coastline identity mismatch');
      const width = h.width,
        rows = h.height;
      const index = (r: number, c: number) => {
        if (
          !Number.isInteger(r) ||
          !Number.isInteger(c) ||
          r < 0 ||
          c < 0 ||
          r >= rows ||
          c >= width
        )
          throw new RangeError('Terrain native sample outside viewport');
        return r * width + c;
      };
      return Object.freeze({
        identity: `${resolved.settlementId}:${resolved.entry.terrainVersion}:${h.terrainViewportId}:${Object.values(
          resolved.entry.products,
        )
          .map((p) => p.sha256)
          .join(':')}`,
        viewport: resolved.viewport,
        resolution: resolved.entry.resolutionMeters,
        coastline: freezeTerrain(coastline),
        statistics: Object.freeze({
          nativeSamples: n,
          landSamples,
          waterSamples: n - landSamples,
          minElevation: landSamples ? minimum : null,
          maxElevation: landSamples ? maximum : null,
        }),
        sample: (r: number, c: number) => {
          const i = index(r, c);
          return cells[i] === 1 ? elevations[i]! : null;
        },
        classify: (r: number, c: number) =>
          cells[index(r, c)] === 1 ? ('land' as const) : ('water' as const),
      });
    },
  });
