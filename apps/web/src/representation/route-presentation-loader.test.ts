import { readFileSync } from '../../../../scripts/public-layer-files.mjs';

import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import { expect, it, vi } from 'vitest';
import { createRoutePresentationLoader } from './route-presentation-loader.js';

const publicRoot = join(import.meta.dirname, '../../public');
const root = join(
  publicRoot,
  'scenarios/torrevieja-v1/torrevieja-legacy-all-v1',
);
const json = (name: string) =>
  JSON.parse(readFileSync(join(root, name), 'utf8')) as unknown;
const scenario = parseScenarioPackage({
  manifest: json('scenario.json'),
  settlements: json('settlements.json'),
  stops: json('stops.json'),
  routes: json('routes.json'),
  presentation: json('presentation.json'),
  provenance: json('provenance.json'),
});
const catalogue = readFileSync(
  join(publicRoot, 'route-presentation/catalog.json'),
  'utf8',
);
const asset = readFileSync(
  join(
    publicRoot,
    'route-presentation/torrevieja/torrevieja-route-presentation.v0.json',
  ),
  'utf8',
);
const digest = async (text: string) =>
  createHash('sha256').update(text).digest('hex');

it('resolves the exact coordinate under either base path and shares one verified asset request', async () => {
  for (const baseUrl of ['/', '/game']) {
    const fetchText = vi.fn(async (url: string) => ({
      ok: true,
      text: async () => (url.endsWith('catalog.json') ? catalogue : asset),
    }));
    const loader = createRoutePresentationLoader({
      baseUrl,
      fetchText,
      digestSha256: digest,
    });
    const promise = loader.resolve(scenario);
    expect(loader.resolve(scenario)).toBe(promise);
    const parsed = await promise;
    expect(parsed!.routes).toHaveLength(8);
    expect(fetchText).toHaveBeenCalledTimes(2);
    expect(fetchText.mock.calls[0]![0]).toBe(
      `${baseUrl === '/' ? '/' : '/game/'}route-presentation/catalog.json`,
    );
    expect(await loader.resolve({ ...scenario })).toBe(parsed);
    expect(fetchText).toHaveBeenCalledTimes(2);
    await expect(
      loader.resolve({
        ...scenario,
        routes: { ...scenario.routes, routes: [] },
      }),
    ).rejects.toThrow(/canonical scenario/);
  }
});

it('has no asset request for an unsupported full scenario coordinate', async () => {
  const fetchText = vi.fn(async () => ({
    ok: true,
    text: async () => catalogue,
  }));
  const loader = createRoutePresentationLoader({
    baseUrl: '/',
    fetchText,
    digestSha256: digest,
  });
  await expect(
    loader.resolve({
      ...scenario,
      manifest: { ...scenario.manifest, contentHash: '0'.repeat(64) },
    }),
  ).resolves.toBeUndefined();
  expect(fetchText).toHaveBeenCalledTimes(1);
});

it.each(['catalogue', 'asset', 'integrity', 'schema', 'path', 'duplicate'])(
  'rejects %s failure and releases failed requests for a clean retry',
  async (kind) => {
    let failing = true;
    const fetchText = vi.fn(async (url: string) => {
      const cat = url.endsWith('catalog.json');
      const data = JSON.parse(catalogue);
      if (failing && kind === 'path')
        data.scenarios[0].path = '../outside.json';
      if (failing && kind === 'duplicate')
        data.scenarios.push(data.scenarios[0]);
      return {
        ok: !(
          failing &&
          ((kind === 'catalogue' && cat) || (kind === 'asset' && !cat))
        ),
        text: async () =>
          cat
            ? JSON.stringify(data)
            : failing && kind === 'schema'
              ? '{}'
              : asset,
      };
    });
    const loader = createRoutePresentationLoader({
      baseUrl: '/',
      fetchText,
      digestSha256: async (text) =>
        failing && kind === 'integrity'
          ? '0'.repeat(64)
          : kind === 'schema' && text === '{}'
            ? JSON.parse(catalogue).scenarios[0].sha256
            : digest(text),
    });
    await expect(loader.resolve(scenario)).rejects.toThrow();
    failing = false;
    await expect(loader.resolve(scenario)).resolves.toHaveProperty('routes');
  },
);
