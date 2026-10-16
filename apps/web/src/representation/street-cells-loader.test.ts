import { createHash } from 'node:crypto';
import { readFileSync } from '../../../../scripts/public-layer-files.mjs';
import { readFileSync as rawRead } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { createPublicLayerLoader } from '../assets/public-layers.js';
import { streetCellRoot } from '../test/street-cells-fixture.js';
import { createStreetCellLoader } from './street-cells-loader.js';
const digestSha256 = async (s: string) =>
  createHash('sha256').update(s).digest('hex');
it.each(['/', '/game/'])(
  'lazily shares one revision-bound archive and only catalog/C+annotations at %s',
  async (baseUrl) => {
    const fetchArchive = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () =>
        Uint8Array.from(rawRead(streetCellRoot + 'street-cells.zip')).buffer,
    }));
    const registry = createPublicLayerLoader({
      baseUrl,
      revisions: { 'street-cells': 'accepted' },
      fetchArchive,
    });
    const fetchText = vi.fn(registry.fetchAsset);
    const loader = createStreetCellLoader({ baseUrl, fetchText, digestSha256 });
    expect(fetchArchive).not.toHaveBeenCalled();
    expect(await loader.resolve('es-cartagena')).toBeUndefined();
    const [a, b] = await Promise.all([
      loader.resolve('es-torrevieja'),
      loader.resolve('es-torrevieja'),
    ]);
    expect(a).toBe(b);
    expect(await loader.resolve('es-torrevieja')).toBe(a);
    expect(a?.features).toHaveLength(1623);
    expect(fetchText.mock.calls.map((c) => c[0])).toEqual([
      baseUrl + 'street-cells/catalog.json',
      baseUrl + 'street-cells/es-torrevieja/cells-c.v2.geojson',
      baseUrl + 'street-cells/es-torrevieja/annotations-c.v3.json',
      baseUrl + 'street-cells/es-torrevieja/masks.v0.geojson',
      baseUrl + 'street-cells/es-torrevieja/cell-mask-refs.v0.json',
    ]);
    expect(fetchArchive.mock.calls).toHaveLength(1);
    expect(fetchArchive).toHaveBeenCalledWith(
      baseUrl + 'street-cells/street-cells.zip?v=accepted',
    );
  },
);
it.each(['missing', 'undefined', 'http', 'invalid', 'archive'])(
  'retries required root %s and never labels it absent',
  async (failure) => {
    const fetchText = vi.fn<
      Parameters<typeof createStreetCellLoader>[0]['fetchText']
    >(async (url: string) => ({
      ok: true,
      text: async () =>
        readFileSync(streetCellRoot + url.split('/street-cells/')[1]!, 'utf8'),
    }));
    fetchText.mockImplementationOnce(async () => {
      if (failure === 'undefined') return undefined;
      if (failure === 'archive')
        throw new Error('Public layer unavailable: street-cells');
      return {
        ok: failure !== 'http' && failure !== 'missing',
        text: async () => '{}',
      };
    });
    const loader = createStreetCellLoader({
      baseUrl: '/',
      fetchText,
      digestSha256,
    });
    await expect(loader.resolve('es-cartagena')).rejects.toThrow();
    expect(await loader.resolve('es-cartagena')).toBeUndefined();
    expect(await loader.resolve('constructor')).toBeUndefined();
    expect(fetchText).toHaveBeenCalledTimes(2);
  },
);
it('retries unavailable, wrong-length, checksum and invalid C products without poisoning catalog', async () => {
  const fetchText = vi.fn<
    Parameters<typeof createStreetCellLoader>[0]['fetchText']
  >(async (url: string) => ({
    ok: true,
    text: async () =>
      readFileSync(streetCellRoot + url.split('/street-cells/')[1]!, 'utf8'),
  }));
  const digest = vi.fn(digestSha256);
  const loader = createStreetCellLoader({
    baseUrl: '/',
    fetchText,
    digestSha256: digest,
  });
  await loader.resolve('es-cartagena');
  fetchText.mockResolvedValueOnce(undefined);
  await expect(loader.resolve('es-torrevieja')).rejects.toThrow('unavailable');
  fetchText.mockResolvedValueOnce({ ok: false, text: async () => '' });
  await expect(loader.resolve('es-torrevieja')).rejects.toThrow('unavailable');
  fetchText.mockResolvedValueOnce({ ok: true, text: async () => '{}' });
  await expect(loader.resolve('es-torrevieja')).rejects.toThrow('integrity');
  expect(digest).not.toHaveBeenCalled();
  digest.mockResolvedValueOnce('bad');
  await expect(loader.resolve('es-torrevieja')).rejects.toThrow('integrity');
  expect((await loader.resolve('es-torrevieja'))?.level).toBe('C');
});

it('loads only the selected city/level; A/B never read annotations and failed C annotations retry', async () => {
  const fetchText = vi.fn<
    Parameters<typeof createStreetCellLoader>[0]['fetchText']
  >(async (url) => ({
    ok: true,
    text: async () =>
      readFileSync(streetCellRoot + url.split('/street-cells/')[1]!, 'utf8'),
  }));
  const loader = createStreetCellLoader({
    baseUrl: '/',
    fetchText,
    digestSha256,
  });
  const a = await loader.resolve('es-alicante', 'A');
  expect(a?.features).toHaveLength(348);
  expect(a?.annotations).toBeUndefined();
  expect(await loader.resolve('es-alicante', 'A')).toBe(a);
  expect((await loader.resolve('es-torrevieja', 'B'))?.features).toHaveLength(
    584,
  );
  expect(fetchText.mock.calls.map((c) => c[0])).toEqual([
    '/street-cells/catalog.json',
    '/street-cells/es-alicante/cells-a.v2.geojson',
    '/street-cells/es-torrevieja/cells-b.v2.geojson',
  ]);
  fetchText.mockImplementationOnce(async (url) => ({
    ok: true,
    text: async () =>
      readFileSync(streetCellRoot + url.split('/street-cells/')[1]!, 'utf8'),
  }));
  fetchText.mockResolvedValueOnce({ ok: false, text: async () => '' });
  await expect(loader.resolve('es-torrevieja', 'C')).rejects.toThrow(
    'annotations',
  );
  const c = await loader.resolve('es-torrevieja', 'C');
  expect(c?.annotations).toBeDefined();
  expect(Object.keys(c!.annotations!.cells)).toHaveLength(1623);
  expect(
    fetchText.mock.calls.every(
      ([url]) =>
        !url.includes('hierarchy') &&
        !url.includes('audit') &&
        !url.includes('road-network'),
    ),
  ).toBe(true);
});

it.each(['masks.v0.geojson', 'cell-mask-refs.v0.json'])(
  'reports and retries required V4 %s failures instead of returning absent',
  async (path) => {
    let broken = true;
    const fetchText = vi.fn(async (url: string) => ({
      ok: !(broken && url.endsWith(path)),
      text: async () =>
        readFileSync(streetCellRoot + url.split('/street-cells/')[1]!, 'utf8'),
    }));
    const loader = createStreetCellLoader({
      baseUrl: '/game/',
      fetchText,
      digestSha256,
    });
    await expect(loader.resolve('es-torrevieja')).rejects.toThrow(
      'unavailable',
    );
    broken = false;
    const ready = await loader.resolve('es-torrevieja');
    expect(ready?.masks?.features).toHaveLength(1000);
    expect(ready?.masks?.availability).toBe('available');
    expect(await loader.resolve('es-torrevieja')).toBe(ready);
    expect(
      fetchText.mock.calls.filter(([url]) => url.endsWith('catalog.json')),
    ).toHaveLength(1);
    expect(
      fetchText.mock.calls.every(
        ([url]) =>
          !url.includes('es-elche') &&
          !url.includes('es-alicante') &&
          !url.includes('-new') &&
          !url.includes('-next'),
      ),
    ).toBe(true);
  },
);
it('checks both V4 checksums and keeps unavailable and partial inventories explicit', async () => {
  let corrupt = true;
  const fetchText = vi.fn(async (url: string) => ({
    ok: true,
    text: async () =>
      corrupt && url.endsWith('masks.v0.geojson')
        ? '{}'
        : readFileSync(
            streetCellRoot + url.split('/street-cells/')[1]!,
            'utf8',
          ),
  }));
  const loader = createStreetCellLoader({
    baseUrl: '/',
    fetchText,
    digestSha256,
  });
  await expect(loader.resolve('es-alicante')).rejects.toThrow('integrity');
  corrupt = false;
  const alicante = await loader.resolve('es-alicante');
  expect(alicante?.masks?.availability).toBe('unavailable');
  expect(alicante?.masks?.missingSelectors).toHaveLength(6);
  expect(alicante?.masks?.features).toEqual([]);
  const elche = await loader.resolve('es-elche');
  expect(elche?.masks?.availability).toBe('partial');
  expect(elche?.masks?.features).toHaveLength(919);
  expect(elche?.masks?.missingSelectors).toEqual([
    'landuse=recreation_ground',
    'natural=wood',
  ]);
});
it('keeps legacy V3 acquisition explicit without inventing an empty V4 inventory', async () => {
  const root = JSON.parse(
    readFileSync(streetCellRoot + 'catalog.json', 'utf8'),
  ) as Record<string, unknown>;
  root.schemaVersion = 'street-cells-catalog-v3';
  root.version = '0.3.0';
  for (const key of [
    'maskRegistryVersion',
    'maskRegistrySha256',
    'maskTypes',
    'maskSemantics',
  ])
    delete root[key];
  for (const value of Object.values(
    root.settlements as Record<string, Record<string, unknown>>,
  )) {
    delete value.masks;
    delete value.cellMaskRefs;
  }
  const fetchText = vi.fn(async (url: string) => ({
    ok: true,
    text: async () =>
      url.endsWith('catalog.json')
        ? JSON.stringify(root)
        : readFileSync(
            streetCellRoot + url.split('/street-cells/')[1]!,
            'utf8',
          ),
  }));
  const model = await createStreetCellLoader({
    baseUrl: '/',
    fetchText,
    digestSha256,
  }).resolve('es-torrevieja');
  expect(model?.masks).toBeUndefined();
  expect(model?.annotations).toBeDefined();
  expect(fetchText.mock.calls.map(([url]) => url)).toHaveLength(3);
});
