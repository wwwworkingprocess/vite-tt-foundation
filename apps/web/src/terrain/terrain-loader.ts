import {
  parseTerrainCatalog,
  resolveTerrainViewport,
  type TerrainCatalog,
  type TerrainProduct,
} from './terrain-catalog.js';
import { terrainJsonDecoder } from './terrain-json-decoder.js';
import type {
  TerrainProductDecoder,
  TerrainRuntime,
} from './terrain-runtime.js';
export type TerrainView =
  | Readonly<{ status: 'ready'; terrain: TerrainRuntime }>
  | Readonly<{ status: 'unavailable' }>;
export function createTerrainLoader(
  input: Readonly<{
    baseUrl: string;
    fetchText: (
      url: string,
    ) => Promise<Readonly<{ ok: boolean; text(): Promise<string> }>>;
    decoder?: TerrainProductDecoder;
    acquireProduct?: (
      url: string,
      descriptor: TerrainProduct,
    ) => Promise<unknown>;
  }>,
) {
  const url = (path: string) =>
    `${input.baseUrl.replace(/\/?$/, '/')}terrain/${path}`;
  let catalog: Promise<TerrainCatalog> | undefined;
  const cache = new Map<string, Promise<TerrainView>>();
  const read = async (path: string): Promise<string> => {
    const response = await input.fetchText(url(path));
    if (!response.ok) throw new Error(`Terrain asset unavailable: ${path}`);
    return response.text();
  };
  return Object.freeze({
    async resolve(
      settlementId: string,
      scenarioId: string,
    ): Promise<TerrainView> {
      catalog ??= read('catalog.json').then((text) =>
        parseTerrainCatalog(JSON.parse(text) as unknown),
      );
      let entries: TerrainCatalog;
      try {
        entries = await catalog;
      } catch (error) {
        catalog = undefined;
        throw error;
      }
      const resolved = resolveTerrainViewport(
        entries,
        settlementId,
        scenarioId,
      );
      if (!resolved) return Object.freeze({ status: 'unavailable' });
      const key = `${settlementId}:${resolved.entry.terrainVersion}:${resolved.viewport.terrainViewportId}:${Object.values(
        resolved.entry.products,
      )
        .map((p) => p.sha256)
        .join(':')}`;
      const previous = cache.get(key);
      if (previous) return previous;
      const request = (async (): Promise<TerrainView> => {
        const p = resolved.entry.products;
        const acquire = (descriptor: TerrainProduct) =>
          input.acquireProduct
            ? input.acquireProduct(url(descriptor.path), descriptor)
            : read(descriptor.path);
        const [height, surfaceMask, coastline] = await Promise.all([
          acquire(p.height),
          acquire(p.surfaceMask),
          acquire(p.coastline),
        ]);
        const terrain = (input.decoder ?? terrainJsonDecoder).decode(
          { height, surfaceMask, coastline },
          resolved,
        );
        return Object.freeze({ status: 'ready', terrain });
      })();
      cache.set(key, request);
      void request.catch(() => cache.delete(key));
      return request;
    },
  });
}
