import {
  parseStreetCellCatalog,
  decodeStreetCells,
  decodeStreetCellAnnotations,
  type CellLevel,
  type StreetCellCatalog,
  type StreetCells,
} from './street-cells.js';
/** Revision-bound selected-level acquisition. Only C also reads annotations;
 * hierarchy/audit/source roads remain offline provenance, never runtime fetches. */
export function createStreetCellLoader(
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
    `${input.baseUrl.replace(/\/?$/, '/')}street-cells/${path}`;
  let catalog: Promise<StreetCellCatalog> | undefined;
  const models = new Map<string, Promise<StreetCells>>();
  return Object.freeze({
    async resolve(
      settlementId: string,
      level: CellLevel = 'C',
    ): Promise<StreetCells | undefined> {
      catalog ??= (async () => {
        const r = await input.fetchText(url('catalog.json'));
        if (!r?.ok)
          throw new Error(
            'StreetCell catalog unavailable: ' + url('catalog.json'),
          );
        return parseStreetCellCatalog(JSON.parse(await r.text()) as unknown);
      })();
      let entries: StreetCellCatalog;
      try {
        entries = await catalog;
      } catch (error) {
        catalog = undefined;
        throw error;
      }
      if (!Object.hasOwn(entries.settlements, settlementId)) return undefined;
      const entry = entries.settlements[settlementId]!;
      const product = entry.products.find((p) => p.level === level)!;
      const key = settlementId + ':' + level + ':' + product.sha256;
      let model = models.get(key);
      if (!model) {
        model = (async () => {
          const read = async (
            file: Readonly<{
              path: string;
              byteLength: number;
              sha256: string;
            }>,
          ) => {
            const r = await input.fetchText(url(file.path));
            if (!r?.ok)
              throw new Error('StreetCell product unavailable: ' + file.path);
            const text = await r.text();
            if (
              new TextEncoder().encode(text).length !== file.byteLength ||
              (await input.digestSha256(text)) !== file.sha256
            )
              throw new Error(
                'StreetCell product integrity mismatch: ' + file.path,
              );
            return JSON.parse(text) as unknown;
          };
          const cells = decodeStreetCells(
            await read(product),
            settlementId,
            product,
          );
          if (level !== 'C') return cells;
          const annotations = decodeStreetCellAnnotations(
            await read(entry.annotations),
            cells,
            entry.source.products.find((p) => p.level === 'C')!.sha256,
          );
          return Object.freeze({ ...cells, annotations });
        })();
        models.set(key, model);
        void model.catch(() => models.delete(key));
      }
      return model;
    },
  });
}
