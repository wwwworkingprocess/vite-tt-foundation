import { z } from 'zod';
import {
  freezeSettlement,
  parseSettlementMetadata,
  type SettlementMetadata,
} from './settlement-metadata.js';

const catalogueSchema = z
  .strictObject({
    schemaVersion: z.literal('0.1.0'),
    cities: z.array(
      z.strictObject({
        primarySettlementId: z.string().min(1),
        cityId: z.string().min(1),
        path: z.string().regex(/^[a-z0-9-]+\/[a-z0-9.-]+\.json$/),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        metadataSchemaVersion: z.literal('0.1.0'),
        readiness: z.literal('needs-review'),
      }),
    ),
  })
  .refine(
    (value) =>
      new Set(value.cities.map((city) => city.primarySettlementId)).size ===
      value.cities.length,
    'Duplicate settlement metadata mapping',
  );
export type SettlementMetadataView =
  | Readonly<{
      status: 'ready';
      metadata: SettlementMetadata;
      sha256: string;
      primarySettlementId: string;
    }>
  | Readonly<{ status: 'unavailable' }>;
export function createSettlementMetadataLoader(
  input: Readonly<{
    baseUrl: string;
    fetchText: (
      url: string,
    ) => Promise<Readonly<{ ok: boolean; text(): Promise<string> }>>;
    digestSha256: (text: string) => Promise<string>;
  }>,
) {
  const url = (path: string) =>
    `${input.baseUrl.endsWith('/') ? input.baseUrl : input.baseUrl + '/'}settlement-metadata/${path}`;
  let catalogue: Promise<z.infer<typeof catalogueSchema>> | undefined;
  const requests = new Map<string, Promise<SettlementMetadataView>>();
  const loadCatalogue = () => {
    if (catalogue) return catalogue;
    const request = (async () => {
      const response = await input.fetchText(url('catalog.json'));
      if (!response.ok)
        throw new Error('Settlement metadata catalogue unavailable');
      return catalogueSchema.parse(
        JSON.parse(await response.text()) as unknown,
      );
    })();
    catalogue = request;
    void request.catch(() => {
      catalogue = undefined;
    });
    return request;
  };
  return Object.freeze({
    async resolveSettlementMetadata(
      primarySettlementId: string,
    ): Promise<SettlementMetadataView> {
      const entries = await loadCatalogue();
      const entry = entries.cities.find(
        (entry) => entry.primarySettlementId === primarySettlementId,
      );
      if (!entry) return Object.freeze({ status: 'unavailable' });
      const key = `${entry.path}:${entry.sha256}`;
      const previous = requests.get(key);
      if (previous) return previous;
      const request = (async (): Promise<SettlementMetadataView> => {
        const response = await input.fetchText(url(entry.path));
        if (!response.ok)
          throw new Error(
            `Settlement metadata asset unavailable: ${entry.path}`,
          );
        const text = await response.text();
        if ((await input.digestSha256(text)) !== entry.sha256)
          throw new Error(
            `Settlement metadata integrity mismatch: ${entry.path}`,
          );
        const metadata = parseSettlementMetadata(JSON.parse(text) as unknown);
        if (metadata.city.id !== entry.cityId)
          throw new Error('Settlement metadata city identity mismatch');
        return freezeSettlement({
          status: 'ready',
          metadata,
          sha256: entry.sha256,
          primarySettlementId,
        });
      })();
      requests.set(key, request);
      void request.catch(() => {
        requests.delete(key);
      });
      return request;
    },
  });
}
