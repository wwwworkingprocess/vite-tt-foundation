import { z } from 'zod';
import { freezeSettlement } from '../settlement/settlement-metadata.js';
import {
  materializationPath,
  parseMaterializationCatalog,
  parseMaterializationKits,
  decodeMaterializationGeometry,
  type CityMaterialization,
} from './city-materialization.js';
import type { D3dLodBand } from './d3d-map-model.js';
export const materializationLevel = (lod: D3dLodBand) =>
  (({ far: 'A', medium: 'B', near: 'C' }) as const)[lod];
const root = z.object({
  schemaVersion: z.literal('0.1.0'),
  settlements: z.record(
    z.string().regex(/^[a-z]{2}-[a-z0-9-]+$/),
    z.object({ catalog: materializationPath }),
  ),
});
const city = z.object({
  schemaVersion: z.literal('0.1.0'),
  settlementId: z.string(),
  collections: z.object({ materialization: materializationPath.optional() }),
});
/** The public reader binds this cache to a content-hash ZIP revision. No source-road requests. */
export function createCityMaterializationLoader(
  input: Readonly<{
    baseUrl: string;
    fetchText: (
      url: string,
    ) => Promise<
      Readonly<{ ok: boolean; text(): Promise<string> }> | undefined
    >;
    digestSha256: (text: string) => Promise<string>;
  }>,
) {
  const files = new Map<string, Promise<unknown>>(),
    models = new Map<string, Promise<CityMaterialization | undefined>>();
  const url = (path: string) =>
    input.baseUrl.replace(/\/?$/, '/') + 'urban-assets/' + path;
  const read = (path: string, sha256?: string) => {
    const fileKey = path + ':' + (sha256 ?? '');
    let request = files.get(fileKey);
    if (!request) {
      request = (async () => {
        const response = await input.fetchText(url(path));
        if (!response?.ok)
          throw new Error('Materialization data unavailable: ' + path);
        const text = await response.text();
        if (sha256 && (await input.digestSha256(text)) !== sha256)
          throw new Error('Materialization integrity mismatch: ' + path);
        return JSON.parse(text) as unknown;
      })();
      files.set(fileKey, request);
      void request.catch(() => files.delete(fileKey));
    }
    return request;
  };
  return Object.freeze({
    async resolve(
      settlementId: string,
      lod: D3dLodBand,
    ): Promise<CityMaterialization | undefined> {
      const key = settlementId + ':' + lod;
      let request = models.get(key);
      if (!request) {
        request = (async () => {
          const index = root.parse(await read('catalog.json'));
          if (!Object.hasOwn(index.settlements, settlementId)) return undefined;
          const path = index.settlements[settlementId]!.catalog;
          if (path !== settlementId + '/catalog.json')
            throw new Error('Invalid materialization city catalog path');
          const entry = city.parse(await read(path));
          if (entry.settlementId !== settlementId)
            throw new Error('Invalid materialization city identity');
          if (!entry.collections.materialization) return undefined;
          const catalog = parseMaterializationCatalog(
            await read(settlementId + '/' + entry.collections.materialization),
            settlementId,
          );
          const kits = parseMaterializationKits(
            await read(catalog.kitCatalogPath),
          );
          const active = catalog.sites.filter(
            (s) =>
              (s.stage === 'proxy-ready' || s.stage === 'asset-ready') &&
              s.lod[materializationLevel(lod)] !== 'hidden',
          );
          const sites = await Promise.all(
            active.map(async (site) => {
              for (const recipe of site.recipes)
                if (
                  'kitId' in recipe &&
                  !kits.kits.some((k) => k.id === recipe.kitId)
                )
                  throw new Error(
                    'Unknown materialization kit: ' + recipe.kitId,
                  );
              const geometries = await Promise.all(
                site.geometries.map(async (reference) => ({
                  reference,
                  feature: decodeMaterializationGeometry(
                    await read(reference.path, reference.sha256),
                    reference,
                  ),
                })),
              );
              return { site, geometries };
            }),
          );
          return freezeSettlement({ catalog, kits, sites });
        })();
        models.set(key, request);
        void request.catch(() => {
          models.delete(key);
          files.clear();
        });
      }
      return request;
    },
  });
}
