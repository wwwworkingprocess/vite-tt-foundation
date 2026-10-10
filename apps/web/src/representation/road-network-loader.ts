import {
  decodeRoadProduct,
  parseRoadCatalog,
  type RoadCatalog,
  type RoadLevel,
  type RoadNetwork,
} from './road-network.js';
/** A loader instance is bound to one ZIP revision by its injected public asset reader.
 * At most three successful models per catalog; unknown settlements are never cached.
 */
export function createRoadNetworkLoader(
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
  const url = (path: string) =>
    `${input.baseUrl.replace(/\/?$/, '/')}road-network/${path}`;
  let catalog: Promise<RoadCatalog> | undefined;
  const models = new Map<string, Promise<RoadNetwork>>();
  return Object.freeze({
    async resolve(
      settlementId: string,
      level: RoadLevel,
    ): Promise<RoadNetwork | undefined> {
      catalog ??= (async () => {
        const response = await input.fetchText(url('catalog.json'));
        if (!response?.ok)
          throw new Error('Road catalog unavailable: ' + url('catalog.json'));
        return parseRoadCatalog(JSON.parse(await response.text()) as unknown);
      })();
      let entries: RoadCatalog;
      try {
        entries = await catalog;
      } catch (error) {
        catalog = undefined;
        throw error;
      }
      if (entries.settlementId !== settlementId) return undefined;
      const product = entries.products.find((p) => p.level === level)!;
      const key =
        entries.settlementId + ':' + product.level + ':' + product.sha256;
      let model = models.get(key);
      if (!model) {
        const selected = entries;
        model = (async () => {
          const response = await input.fetchText(url(product.path));
          if (!response?.ok)
            throw new Error('Road product unavailable: ' + product.path);
          const text = await response.text();
          if (
            new TextEncoder().encode(text).length !== product.byteLength ||
            (await input.digestSha256(text)) !== product.sha256
          )
            throw new Error('Road product integrity mismatch: ' + product.path);
          return decodeRoadProduct(
            JSON.parse(text) as unknown,
            selected,
            product,
          );
        })();
        models.set(key, model);
        void model.catch(() => models.delete(key));
      }
      return model;
    },
  });
}
