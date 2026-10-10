import { join } from 'node:path';
import { parseRoadCatalog } from './road-network.js';
import { readFileSync } from '../../../../scripts/public-layer-files.mjs';
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createRoadNetworkLoader } from './road-network-loader.js';
const root = join(import.meta.dirname, '../../public/road-network') + '/';
function fixture() {
  const fetchText = vi.fn<
    Parameters<typeof createRoadNetworkLoader>[0]['fetchText']
  >(async (url: string) => ({
    ok: true,
    text: async () =>
      readFileSync(root + url.split('/road-network/')[1]!, 'utf8'),
  }));
  const digestSha256 = vi.fn(async (text: string) =>
    createHash('sha256').update(text).digest('hex'),
  );
  return { fetchText, digestSha256 };
}
it('loads catalog first, only parses requested level, shares successful immutable products and resolves missing settlements', async () => {
  const io = fixture(),
    loader = createRoadNetworkLoader({ baseUrl: '/game/', ...io });
  expect(await loader.resolve('es-cartagena', 'A')).toBeUndefined();
  expect(io.fetchText).toHaveBeenCalledTimes(1);
  const [a, b] = await Promise.all([
    loader.resolve('es-torrevieja', 'A'),
    loader.resolve('es-torrevieja', 'A'),
  ]);
  expect(a).toBe(b);
  expect(a?.features).toHaveLength(124);
  expect(io.fetchText.mock.calls.map((c) => c[0])).toEqual([
    '/game/road-network/catalog.json',
    '/game/road-network/es-torrevieja/roads-a.v0.geojson',
  ]);
  await loader.resolve('es-torrevieja', 'C');
  expect(await loader.resolve('es-torrevieja', 'A')).toBe(a);
  expect(io.digestSha256).toHaveBeenCalledTimes(2);
});
it('retries required catalog parsing and failed declared products', async () => {
  const io = fixture();
  io.fetchText.mockImplementationOnce(async () => ({
    ok: true,
    text: async () => '{',
  }));
  const loader = createRoadNetworkLoader({ baseUrl: '/', ...io });
  await expect(loader.resolve('es-torrevieja', 'A')).rejects.toThrow();
  const model = await loader.resolve('es-torrevieja', 'A');
  expect(model?.features).toHaveLength(124);
  io.fetchText.mockImplementationOnce(async () => ({
    ok: false,
    text: async () => '',
  }));
  await expect(loader.resolve('es-torrevieja', 'B')).rejects.toThrow(
    'Road product unavailable',
  );
  io.fetchText.mockResolvedValueOnce(undefined);
  await expect(loader.resolve('es-torrevieja', 'B')).rejects.toThrow(
    'Road product unavailable',
  );
  io.digestSha256.mockResolvedValueOnce('bad');
  await expect(loader.resolve('es-torrevieja', 'B')).rejects.toThrow(
    'Road product integrity mismatch',
  );
  expect((await loader.resolve('es-torrevieja', 'B'))?.features).toHaveLength(
    664,
  );
});
it('checks original UTF-8 byte length before accepting a product', async () => {
  const io = fixture(),
    loader = createRoadNetworkLoader({ baseUrl: '/', ...io });
  io.fetchText.mockImplementationOnce(async () => ({
    ok: true,
    text: async () => readFileSync(root + 'catalog.json', 'utf8'),
  }));
  io.fetchText.mockImplementationOnce(async () => ({
    ok: true,
    text: async () => '{}',
  }));
  await expect(loader.resolve('es-torrevieja', 'C')).rejects.toThrow(
    'Road product integrity mismatch',
  );
  expect(io.digestSha256).not.toHaveBeenCalled();
});

it('keeps level identity separate when cumulative products legitimately have identical source bytes', async () => {
  const catalog = parseRoadCatalog(
      JSON.parse(readFileSync(root + 'catalog.json', 'utf8')) as unknown,
    ),
    primary = catalog.settlements['es-torrevieja']!.products[0]!;
  const text = readFileSync(root + primary.path, 'utf8');
  const input = {
    ...catalog,
    schemaVersion: 'road-network-catalog-v0',
    version: '0.0.0',
    settlementId: 'es-torrevieja',
    source: {},
    audit: {},
    products: catalog.settlements['es-torrevieja']!.products.map((p) => ({
      ...p,
      featureCount: primary.featureCount,
      byteLength: primary.byteLength,
      sha256: primary.sha256,
      bridgeLineCount: primary.bridgeLineCount,
      tunnelLineCount: primary.tunnelLineCount,
      classCounts: Object.fromEntries(
        Object.keys(p.classCounts).map((key) => [
          key,
          primary.classCounts[key] ?? 0,
        ]),
      ),
    })),
  };
  const v0 = { ...input };
  Reflect.deleteProperty(v0, 'settlements');
  const fetchText = vi.fn(async (url: string) => ({
    ok: true,
    text: async () =>
      url.endsWith('catalog.json') ? JSON.stringify(v0) : text,
  }));
  const loader = createRoadNetworkLoader({
    baseUrl: '/',
    fetchText,
    digestSha256: async () => primary.sha256,
  });
  const a = await loader.resolve('es-torrevieja', 'A'),
    b = await loader.resolve('es-torrevieja', 'B'),
    c = await loader.resolve('es-torrevieja', 'C');
  expect([a?.level, b?.level, c?.level]).toEqual(['A', 'B', 'C']);
  expect(await loader.resolve('es-torrevieja', 'B')).toBe(b);
  expect(fetchText).toHaveBeenCalledTimes(4);
});

it.each(['missing', 'http', 'invalid', 'unreadable', 'archive'] as const)(
  'reports required root infrastructure %s as an error and retries even for an unlisted city',
  async (failure) => {
    const io = fixture();
    io.fetchText.mockImplementationOnce(async () => {
      if (failure === 'missing') return undefined;
      if (failure === 'http') return { ok: false, text: async () => '' };
      if (failure === 'archive')
        throw new Error('Public layer unavailable: road-network');
      return {
        ok: true,
        text: async () => {
          if (failure === 'unreadable')
            throw new Error('Root catalog unreadable');
          return '{}';
        },
      };
    });
    const loader = createRoadNetworkLoader({ baseUrl: '/game/', ...io });
    await expect(loader.resolve('es-cartagena', 'A')).rejects.toThrow(
      failure === 'missing' || failure === 'http'
        ? 'Road catalog unavailable: /game/road-network/catalog.json'
        : failure === 'archive'
          ? 'Public layer unavailable: road-network'
          : failure === 'unreadable'
            ? 'Root catalog unreadable'
            : 'Invalid road',
    );
    expect(await loader.resolve('es-cartagena', 'A')).toBeUndefined();
    expect(io.fetchText.mock.calls.map(([url]) => url)).toEqual([
      '/game/road-network/catalog.json',
      '/game/road-network/catalog.json',
    ]);
    expect((await loader.resolve('es-torrevieja', 'A'))?.features).toHaveLength(
      124,
    );
  },
);

it('lazily resolves distinct cities at root and subpath without inflating other city products', async () => {
  for (const baseUrl of ['/', '/game/']) {
    const io = fixture(),
      loader = createRoadNetworkLoader({ baseUrl, ...io });
    const tor = await loader.resolve('es-torrevieja', 'A');
    const [elche, duplicate] = await Promise.all([
      loader.resolve('es-elche', 'B'),
      loader.resolve('es-elche', 'B'),
    ]);
    expect(elche).toBe(duplicate);
    expect(elche?.settlementId).toBe('es-elche');
    expect(elche?.features).toHaveLength(2068);
    expect(await loader.resolve('es-torrevieja', 'A')).toBe(tor);
    expect(await loader.resolve('es-cartagena', 'C')).toBeUndefined();
    expect(await loader.resolve('constructor', 'C')).toBeUndefined();
    expect(io.fetchText.mock.calls.map(([url]) => url)).toEqual([
      baseUrl + 'road-network/catalog.json',
      baseUrl + 'road-network/es-torrevieja/roads-a.v0.geojson',
      baseUrl + 'road-network/es-elche/roads-b.v0.geojson',
    ]);
  }
});
