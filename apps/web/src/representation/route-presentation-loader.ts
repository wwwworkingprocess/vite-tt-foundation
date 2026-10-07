import { z } from 'zod';
import type { CanonicalScenario } from '@torrevieja-tycoon/transport-domain';
import {
  parseRoutePresentation,
  validateRoutePresentation,
  type RoutePresentationAsset,
} from './route-presentation.js';

const catalogueSchema = z
  .strictObject({
    schemaVersion: z.literal('0.1.0'),
    scenarios: z.array(
      z.strictObject({
        scenarioId: z.string(),
        scenarioVersion: z.string(),
        contentHash: z.string().regex(/^[0-9a-f]{64}$/),
        path: z.string().regex(/^[a-z0-9-]+\/[a-z0-9.-]+\.json$/),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
      }),
    ),
  })
  .refine(
    (c) =>
      new Set(
        c.scenarios.map(
          (s) => `${s.scenarioId}:${s.scenarioVersion}:${s.contentHash}`,
        ),
      ).size === c.scenarios.length,
  );
export function createRoutePresentationLoader(
  input: Readonly<{
    baseUrl: string;
    fetchText: (
      url: string,
    ) => Promise<Readonly<{ ok: boolean; text(): Promise<string> }>>;
    digestSha256: (text: string) => Promise<string>;
  }>,
) {
  const url = (path: string) =>
    `${input.baseUrl.replace(/\/?$/, '/')}route-presentation/${path}`;
  let catalogue: Promise<z.infer<typeof catalogueSchema>> | undefined;
  const assets = new Map<string, Promise<RoutePresentationAsset>>();
  const parsed = new WeakMap<
    CanonicalScenario,
    Promise<RoutePresentationAsset | undefined>
  >();
  return Object.freeze({
    resolve(
      scenario: CanonicalScenario,
    ): Promise<RoutePresentationAsset | undefined> {
      const previous = parsed.get(scenario);
      if (previous) return previous;
      const request = (async () => {
        catalogue ??= (async () => {
          const response = await input.fetchText(url('catalog.json'));
          if (!response.ok) throw new Error('Route catalogue unavailable');
          return catalogueSchema.parse(
            JSON.parse(await response.text()) as unknown,
          );
        })();
        const entries = await catalogue;
        const entry = entries.scenarios.find(
          (e) =>
            e.scenarioId === scenario.manifest.scenarioId &&
            e.scenarioVersion === scenario.manifest.scenarioVersion &&
            e.contentHash === scenario.manifest.contentHash,
        );
        if (!entry) return undefined;
        const key = `${entry.path}:${entry.sha256}`;
        let asset = assets.get(key);
        if (!asset) {
          asset = (async () => {
            const response = await input.fetchText(url(entry.path));
            if (!response.ok) throw new Error('Route asset unavailable');
            const text = await response.text();
            if ((await input.digestSha256(text)) !== entry.sha256)
              throw new Error('Route asset integrity mismatch');
            return parseRoutePresentation(
              JSON.parse(text) as unknown,
              scenario,
            );
          })();
          assets.set(key, asset);
          void asset.catch(() => assets.delete(key));
        }
        try {
          return validateRoutePresentation(await asset, scenario);
        } catch (error) {
          assets.delete(key);
          throw error;
        }
      })();
      parsed.set(scenario, request);
      void request.catch(() => {
        parsed.delete(scenario);
        catalogue = undefined;
      });
      return request;
    },
  });
}
