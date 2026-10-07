import { z } from 'zod';
export const freezeTerrain = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeTerrain(child);
    Object.freeze(value);
  }
  return value;
};
const finite = z.number().finite();
export const terrainBoundsSchema = z
  .object({ west: finite, south: finite, east: finite, north: finite })
  .refine((b) => b.east > b.west && b.north > b.south);
export const terrainViewportSchema = z.object({
  terrainViewportId: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  rasterBounds3035: terrainBoundsSchema,
});
const product = z.object({
  path: z.string().regex(/^[a-z0-9-]+\/[a-z0-9.-]+$/),
  mediaType: z.string().min(1),
  schemaVersion: z.literal('0.0.0'),
  byteLength: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type TerrainProduct = Readonly<z.infer<typeof product>>;
const entry = z
  .object({
    terrainVersion: z.string().min(1),
    crs: z.literal('EPSG:3035'),
    resolutionMeters: z.object({ x: finite.positive(), y: finite.positive() }),
    scenarioIds: z.array(z.string().min(1)).min(1),
    scenarioViewportMap: z.record(z.string(), z.string()),
    viewports: z.array(terrainViewportSchema).min(1),
    products: z.object({
      height: product,
      surfaceMask: product,
      coastline: product,
    }),
  })
  .refine((e) => {
    const ids = new Set(e.viewports.map((v) => v.terrainViewportId));
    return (
      ids.size === e.viewports.length &&
      new Set(e.scenarioIds).size === e.scenarioIds.length &&
      Object.keys(e.scenarioViewportMap).length === e.scenarioIds.length &&
      e.scenarioIds.every((id) => ids.has(e.scenarioViewportMap[id]!)) &&
      e.viewports.every(
        (v) =>
          Math.abs(
            v.width * e.resolutionMeters.x -
              (v.rasterBounds3035.east - v.rasterBounds3035.west),
          ) < 1e-7 &&
          Math.abs(
            v.height * e.resolutionMeters.y -
              (v.rasterBounds3035.north - v.rasterBounds3035.south),
          ) < 1e-7,
      )
    );
  }, 'Terrain catalog viewport/mapping mismatch');
const schema = z.object({
  schemaVersion: z.literal('0.0.0'),
  purpose: z.string(),
  pathSemantics: z.literal('product paths are relative to this catalog file'),
  settlements: z.record(z.string(), entry),
});
export type TerrainCatalog = Readonly<z.infer<typeof schema>>;
export type TerrainResolution = Readonly<{
  settlementId: string;
  entry: Readonly<z.infer<typeof entry>>;
  viewport: Readonly<z.infer<typeof terrainViewportSchema>>;
}>;
export const parseTerrainCatalog = (value: unknown): TerrainCatalog =>
  freezeTerrain(schema.parse(value));
export function resolveTerrainViewport(
  catalog: TerrainCatalog,
  settlementId: string,
  scenarioId: string,
): TerrainResolution | undefined {
  const entry = catalog.settlements[settlementId];
  if (!entry) return undefined;
  const viewportId = entry.scenarioViewportMap[scenarioId];
  if (!viewportId) throw new Error('Terrain scenario has no viewport mapping');
  return Object.freeze({
    settlementId,
    entry,
    viewport: entry.viewports.find((v) => v.terrainViewportId === viewportId)!,
  });
}
