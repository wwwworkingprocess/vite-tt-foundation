import { crc32, inflateRawSync } from 'node:zlib';
import { parseTerrainCatalog } from '../terrain/terrain-catalog.js';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createPublicLayerLoader,
  fetchPublicAsset,
  publicLayerNames,
} from './public-layers.js';
import { indexZip, readZipEntry, verifyZipEntry } from './zip-layer.js';
import { zipFixture } from '../test/zip-fixture.js';
afterEach(() => vi.unstubAllGlobals());
const response = (bytes: Uint8Array, ok = true) => ({
  ok,
  arrayBuffer: async () => Uint8Array.from(bytes).buffer,
});

it('loads a used folder once, preserves base/revision URLs and returns independent bytes', async () => {
  const fetchArchive = vi.fn(async () => response(zipFixture()));
  const loader = createPublicLayerLoader({
    baseUrl: '/game/',
    revisions: { scenarios: 'hash' },
    fetchArchive,
  });
  expect(fetchArchive).not.toHaveBeenCalled();
  const [a, b] = await Promise.all([
    loader.fetchAsset('/game/scenarios/catalog.json'),
    loader.fetchAsset('/game/scenarios/catalog.json'),
  ]);
  expect(fetchArchive.mock.calls).toEqual([
    ['/game/scenarios/scenarios.zip?v=hash'],
  ]);
  expect(await a.text()).toBe('{"unchanged":true}');
  expect(await b.text()).toBe(await a.text());
  new Uint8Array(await a.arrayBuffer()).fill(0);
  expect(await b.text()).toBe('{"unchanged":true}');
  const missing = await loader.fetchAsset('/game/scenarios/missing');
  expect(missing.ok).toBe(false);
  expect(await missing.text()).toBe('');
  expect((await missing.arrayBuffer()).byteLength).toBe(0);
  await expect(
    loader.fetchAsset('/other/scenarios/catalog.json'),
  ).rejects.toThrow('base');
  for (const path of [
    '/game/unknown/file',
    '/game/scenarios/',
    '/game/scenarios/file?query',
    '/game/scenarios/file%2f',
  ])
    await expect(loader.fetchAsset(path)).rejects.toThrow('layer');
});
it('retries failed acquisition without poisoning another layer', async () => {
  const fetchArchive = vi
    .fn()
    .mockResolvedValueOnce(response(new Uint8Array(), false))
    .mockResolvedValueOnce(response(new Uint8Array()))
    .mockResolvedValue(response(zipFixture()));
  const loader = createPublicLayerLoader({ baseUrl: '/', fetchArchive });
  await expect(loader.fetchAsset('/terrain/catalog.json')).rejects.toThrow(
    'unavailable',
  );
  await expect(loader.fetchAsset('/terrain/catalog.json')).rejects.toThrow(
    'ZIP',
  );
  expect((await loader.fetchAsset('/terrain/catalog.json')).ok).toBe(true);
  expect((await loader.fetchAsset('/urban-assets/catalog.json')).ok).toBe(true);
  expect(fetchArchive).toHaveBeenCalledTimes(4);
});
it('rejects entry corruption on every attempt', async () => {
  const bytes = zipFixture('data', 'source', 0);
  bytes[34] = 0;
  const fetchArchive = vi.fn(async () => response(bytes));
  const loader = createPublicLayerLoader({ baseUrl: '/', fetchArchive });
  await expect(loader.fetchAsset('/scenarios/data')).rejects.toThrow(
    'integrity',
  );
  await expect(loader.fetchAsset('/scenarios/data')).rejects.toThrow(
    'integrity',
  );
  expect(fetchArchive).toHaveBeenCalledTimes(1);
});
it('does not return directories as files', async () => {
  const loader = createPublicLayerLoader({
    baseUrl: '/',
    fetchArchive: async () => response(zipFixture('directory/', '', 0)),
  });
  expect((await loader.fetchAsset('/scenarios/directory/')).ok).toBe(false);
});
it('shares the browser storage adapter lazily', async () => {
  const fetchArchive = vi.fn(async () => response(zipFixture()));
  vi.stubGlobal('fetch', fetchArchive);
  expect(await (await fetchPublicAsset('/scenarios/catalog.json')).text()).toBe(
    '{"unchanged":true}',
  );
  expect((await fetchPublicAsset('/scenarios/catalog.json')).ok).toBe(true);
  expect(fetchArchive).toHaveBeenCalledTimes(1);
});
it.each(publicLayerNames.filter((layer) => layer !== 'terrain'))(
  'loads the real %s archive without changing entry bytes',
  async (layer) => {
    const root = join(import.meta.dirname, '../../public', layer);
    const zip = indexZip(readFileSync(join(root, `${layer}.zip`)));
    for (const [name, entry] of zip) {
      const bytes = await readZipEntry(entry);
      expect(bytes.byteLength).toBe(entry.byteLength);
      expect(verifyZipEntry(entry, bytes)).toBe(bytes);
      if (!name.endsWith('/')) {
        // Original files are optional after the owner removes them; the ZIP CRC remains mandatory.
        if (existsSync(join(root, name)))
          expect(createHash('sha256').update(bytes).digest('hex')).toBe(
            createHash('sha256')
              .update(readFileSync(join(root, name)))
              .digest('hex'),
          );
      }
    }
  },
);

const terrainRoot = join(import.meta.dirname, '../../public/terrain');
const terrainArchive = indexZip(readFileSync(join(terrainRoot, 'terrain.zip')));
const terrainCatalogEntry = terrainArchive.get('catalog.json')!;
const terrainCatalog = parseTerrainCatalog(
  JSON.parse(
    new TextDecoder().decode(
      verifyZipEntry(
        terrainCatalogEntry,
        inflateRawSync(terrainCatalogEntry.compressed),
      ),
    ),
  ) as unknown,
);
const terrainProducts = Object.values(terrainCatalog.settlements).flatMap(
  (entry) => Object.values(entry.products),
);
it.each([...terrainArchive].filter(([name]) => !name.endsWith('/')))(
  'preserves real terrain product %s',
  async (name, entry) => {
    // Large source fixtures are storage-integrity checks. Native inflation avoids
    // repeated streamed buffer copies for 113 MB products; the streaming reader
    // is exercised above and in live terrain/PWA browser acceptance.
    const bytes =
      entry.byteLength <= 16 * 1024 * 1024
        ? await readZipEntry(entry)
        : inflateRawSync(entry.compressed, {
            maxOutputLength: entry.byteLength,
          });
    expect(crc32(bytes)).toBe(entry.crc32);
    expect(bytes.byteLength).toBe(entry.byteLength);
    const product = terrainProducts.find((p) => p.path === name);
    if (product) {
      expect(bytes.byteLength).toBe(product.byteLength);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        product.sha256,
      );
    }
    if (existsSync(join(terrainRoot, name)))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        createHash('sha256')
          .update(readFileSync(join(terrainRoot, name)))
          .digest('hex'),
      );
  },
);

it.each(['/', '/game/'])(
  'addresses all road products through the one revision-bound ZIP at %s',
  async (base) => {
    const bytes = readFileSync(
      join(import.meta.dirname, '../../public/road-network/road-network.zip'),
    );
    const fetchArchive = vi.fn(async () => response(bytes));
    const loader = createPublicLayerLoader({
      baseUrl: base,
      revisions: { 'road-network': 'accepted' },
      fetchArchive,
    });
    const catalog = await loader.fetchAsset(base + 'road-network/catalog.json');
    expect(catalog.ok).toBe(true);
    for (const level of ['a', 'b', 'c']) {
      const entry = await loader.fetchAsset(
        base + `road-network/es-torrevieja/roads-${level}.v0.geojson`,
      );
      expect(entry.ok).toBe(true);
      expect(JSON.parse(await entry.text()).type).toBe('FeatureCollection');
    }
    expect(fetchArchive.mock.calls).toEqual([
      [base + 'road-network/road-network.zip?v=accepted'],
    ]);
  },
);
