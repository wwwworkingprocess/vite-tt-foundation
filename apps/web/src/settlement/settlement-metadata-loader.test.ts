import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createSettlementMetadataLoader } from './settlement-metadata-loader.js';

const root = join(
  import.meta.dirname,
  '..',
  '..',
  'public',
  'settlement-metadata',
);
const catalogue = readFileSync(join(root, 'catalog.json'), 'utf8');
const asset = readFileSync(
  join(root, 'torrevieja', 'torrevieja-settlement-metadata.v0.json'),
  'utf8',
);
const digestSha256 = async (text: string) =>
  createHash('sha256').update(text).digest('hex');
const fetchText = vi.fn(async (url: string) => ({
  ok: true,
  text: async () => (url.endsWith('catalog.json') ? catalogue : asset),
}));

it('loads base-path-safe checksum-pinned public metadata once, preserves immutable identity and returns unavailable for other cities', async () => {
  fetchText.mockClear();
  const loader = createSettlementMetadataLoader({
    baseUrl: '/torrevieja-tycoon',
    fetchText,
    digestSha256,
  });
  const first = await loader.resolveSettlementMetadata('es-torrevieja');
  expect(first.status).toBe('ready');
  if (first.status !== 'ready') throw new Error('Expected metadata');
  expect(first.metadata.city.id).toBe('torrevieja');
  expect(first.sha256).toBe(
    '703d6aa93e3dcfbc8e3da9b85a4cc466b64401ce39a4f727abf7ff4e8fc2dd9c',
  );
  expect(Object.isFrozen(first)).toBe(true);
  expect(await loader.resolveSettlementMetadata('es-torrevieja')).toBe(first);
  expect(await loader.resolveSettlementMetadata('es-elche')).toEqual({
    status: 'unavailable',
  });
  expect(fetchText.mock.calls.map((call) => call[0])).toEqual([
    '/torrevieja-tycoon/settlement-metadata/catalog.json',
    '/torrevieja-tycoon/settlement-metadata/torrevieja/torrevieja-settlement-metadata.v0.json',
  ]);
});

it('rejects missing, corrupt and inconsistent assets and retries recoverable catalogue/asset requests without poisoning cache', async () => {
  const missingCatalogue = vi
    .fn()
    .mockResolvedValueOnce({ ok: false })
    .mockImplementation(fetchText);
  const catalogueLoader = createSettlementMetadataLoader({
    baseUrl: '/',
    fetchText: missingCatalogue,
    digestSha256,
  });
  await expect(
    catalogueLoader.resolveSettlementMetadata('es-torrevieja'),
  ).rejects.toThrow('catalogue unavailable');
  await expect(
    catalogueLoader.resolveSettlementMetadata('es-torrevieja'),
  ).resolves.toMatchObject({ status: 'ready' });
  const missingAsset = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, text: async () => catalogue })
    .mockResolvedValueOnce({ ok: false })
    .mockImplementation(fetchText);
  const assetLoader = createSettlementMetadataLoader({
    baseUrl: '/',
    fetchText: missingAsset,
    digestSha256,
  });
  await expect(
    assetLoader.resolveSettlementMetadata('es-torrevieja'),
  ).rejects.toThrow('asset unavailable');
  await expect(
    assetLoader.resolveSettlementMetadata('es-torrevieja'),
  ).resolves.toMatchObject({ status: 'ready' });
  const hashLoader = createSettlementMetadataLoader({
    baseUrl: '/',
    fetchText,
    digestSha256: async () => 'f'.repeat(64),
  });
  await expect(
    hashLoader.resolveSettlementMetadata('es-torrevieja'),
  ).rejects.toThrow('integrity mismatch');
  for (const replacement of [
    catalogue.replace('0.1.0', '0.2.0'),
    catalogue.replace('703d6aa9', 'INVALID'),
    catalogue.replace('torrevieja/torrevieja', '../torrevieja'),
    catalogue.replace('"cityId": "torrevieja"', '"cityId": "wrong-city"'),
  ]) {
    const badLoader = createSettlementMetadataLoader({
      baseUrl: '/',
      fetchText: async (url) => ({
        ok: true,
        text: async () => (url.endsWith('catalog.json') ? replacement : asset),
      }),
      digestSha256,
    });
    await expect(
      badLoader.resolveSettlementMetadata('es-torrevieja'),
    ).rejects.toThrow();
  }
});
