import { expect, it, vi } from 'vitest';
import { terrainFixture } from '../test/terrain-fixture.js';
import {
  parseTerrainCatalog,
  resolveTerrainViewport,
} from './terrain-catalog.js';
import { createTerrainLoader } from './terrain-loader.js';
import { terrainJsonDecoder } from './terrain-json-decoder.js';
function source(base = '/game/') {
  const f = terrainFixture();
  const texts = new Map(
    [
      ['catalog.json', f.catalog],
      ['test/height.json', f.height],
      ['test/mask.json', f.surfaceMask],
      ['test/coast.geojson', f.coastline],
    ].map(([p, v]) => [base + 'terrain/' + p, JSON.stringify(v)]),
  );
  const fetchText = vi.fn(async (url: string) => ({
    ok: texts.has(url),
    text: async () => texts.get(url)!,
  }));
  return { texts, fetchText };
}
it.each(['/game/', '/game', '/'])(
  'shares fetch/decode across scenarios and uses configured base %s',
  async (base) => {
    const io = source(base.endsWith('/') ? base : base + '/');
    const decode = vi.fn(terrainJsonDecoder.decode);
    const loader = createTerrainLoader({
      baseUrl: base,
      fetchText: io.fetchText,
      decoder: { decode },
    });
    const [a, b] = await Promise.all([
      loader.resolve('test', 'a'),
      loader.resolve('test', 'b'),
    ]);
    expect(a).toBe(b);
    expect(a.status).toBe('ready');
    expect(io.fetchText).toHaveBeenCalledTimes(4);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(await loader.resolve('test', 'a')).toBe(a);
    expect(await loader.resolve('other', 'a')).toEqual({
      status: 'unavailable',
    });
    await expect(loader.resolve('test', 'absent')).rejects.toThrow('mapping');
  },
);
it('evicts failed catalog/product requests and can resolve a subsequent explicit request', async () => {
  const io = source();
  const loader = createTerrainLoader({
    baseUrl: '/game/',
    fetchText: io.fetchText,
  });
  const catalog = io.texts.get('/game/terrain/catalog.json')!;
  io.texts.delete('/game/terrain/catalog.json');
  await expect(loader.resolve('test', 'a')).rejects.toThrow('catalog.json');
  io.texts.set('/game/terrain/catalog.json', catalog);
  const height = io.texts.get('/game/terrain/test/height.json')!;
  io.texts.delete('/game/terrain/test/height.json');
  await expect(loader.resolve('test', 'a')).rejects.toThrow('height.json');
  io.texts.set('/game/terrain/test/height.json', height);
  expect((await loader.resolve('test', 'b')).status).toBe('ready');
});
it('surfaces invalid JSON and decoder errors without installing an asset', async () => {
  const io = source();
  io.texts.set('/game/terrain/test/height.json', 'malformed');
  await expect(
    createTerrainLoader({ baseUrl: '/game/', fetchText: io.fetchText }).resolve(
      'test',
      'a',
    ),
  ).rejects.toThrow();
});

it('allows an independent binary product provider/decoder without changing native runtime queries', async () => {
  const f = terrainFixture();
  const runtime = terrainJsonDecoder.decode(
    f,
    resolveTerrainViewport(parseTerrainCatalog(f.catalog), 'test', 'a')!,
  );
  for (const product of Object.values(f.catalog.settlements.test.products)) {
    product.path = product.path.replace(/\.(json|geojson)$/, '.bin');
    product.mediaType = 'application/octet-stream';
  }
  const fetchText = vi.fn(async () => ({
    ok: true,
    text: async () => JSON.stringify(f.catalog),
  }));
  const bytes = new Uint8Array([1, 2, 3]);
  const acquireProduct = vi.fn(async (url: string, descriptor: unknown) => {
    expect(url).toContain('/game/terrain/test/');
    expect(descriptor).toMatchObject({ mediaType: 'application/octet-stream' });
    return bytes;
  });
  const decode = vi.fn((products: unknown, resolved: unknown) => {
    expect(products).toEqual({
      height: bytes,
      surfaceMask: bytes,
      coastline: bytes,
    });
    expect(resolved).toMatchObject({ settlementId: 'test' });
    return runtime;
  });
  const loader = createTerrainLoader({
    baseUrl: '/game/',
    fetchText,
    acquireProduct,
    decoder: { decode },
  });
  const ready = await loader.resolve('test', 'a');
  expect(ready).toEqual({ status: 'ready', terrain: runtime });
  expect(fetchText).toHaveBeenCalledTimes(1);
  expect(acquireProduct).toHaveBeenCalledTimes(3);
  expect(acquireProduct.mock.calls[0]![0]).toBe(
    '/game/terrain/test/height.bin',
  );
  expect(decode.mock.calls[0]![0]).toEqual({
    height: bytes,
    surfaceMask: bytes,
    coastline: bytes,
  });
  expect(runtime.sample(0, 0)).toBe(-4);
});
