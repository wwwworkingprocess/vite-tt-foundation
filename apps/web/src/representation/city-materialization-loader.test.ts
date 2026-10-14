import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from '../../../../scripts/public-layer-files.mjs';
import { join } from 'node:path';
import { createCityMaterializationLoader } from './city-materialization-loader.js';
const root = join(import.meta.dirname, '../../public/urban-assets/');
function fixture() {
  const fetchText = vi.fn<
    Parameters<typeof createCityMaterializationLoader>[0]['fetchText']
  >(async (url: string) => ({
    ok: true,
    text: async () => {
      const path = url.split('/urban-assets/')[1]!;
      if (path === 'catalog.json')
        return JSON.stringify({
          schemaVersion: '0.1.0',
          settlements: {
            'es-torrevieja': { catalog: 'es-torrevieja/catalog.json' },
          },
        });
      if (path === 'es-torrevieja/catalog.json')
        return JSON.stringify({
          schemaVersion: '0.1.0',
          settlementId: 'es-torrevieja',
          collections: { materialization: 'materialization/catalog.v0.json' },
        });
      return readFileSync(root + path, 'utf8');
    },
  }));
  return {
    fetchText,
    digestSha256: async (text: string) =>
      createHash('sha256').update(text).digest('hex'),
  };
}
it('resolves absent coverage normally, shares immutable LOD requests and uses subpath URLs', async () => {
  const io = fixture(),
    loader = createCityMaterializationLoader({ baseUrl: '/game/', ...io });
  expect(await loader.resolve('es-alicante', 'far')).toBeUndefined();
  expect(io.fetchText).toHaveBeenCalledTimes(1);
  const [a, b] = await Promise.all([
    loader.resolve('es-torrevieja', 'near'),
    loader.resolve('es-torrevieja', 'near'),
  ]);
  expect(a).toBe(b);
  expect(a?.sites).toHaveLength(8);
  expect(io.fetchText.mock.calls[0]![0]).toBe(
    '/game/urban-assets/catalog.json',
  );
});
it('required root failure is an error with retry, never unsupported-city absence', async () => {
  const io = fixture();
  io.fetchText.mockResolvedValueOnce({ ok: false, text: async () => '' });
  const loader = createCityMaterializationLoader({ baseUrl: '/', ...io });
  await expect(loader.resolve('es-torrevieja', 'far')).rejects.toThrow(
    'unavailable',
  );
  expect((await loader.resolve('es-torrevieja', 'far'))?.sites).toHaveLength(8);
});

it.each([
  'root missing',
  'undefined root',
  'malformed root',
  'city missing',
  'city mismatch',
  'catalog malformed',
  'geometry missing',
  'bad checksum',
  'unknown kit',
  'other city path',
])('reports %s without converting to absence and retries', async (kind) => {
  const io = fixture(),
    original = io.fetchText.getMockImplementation()!,
    loader = createCityMaterializationLoader({ baseUrl: '/', ...io });
  io.fetchText.mockImplementation(async (url) => {
    const path = url.split('/urban-assets/')[1]!;
    if (path === 'catalog.json') {
      if (kind === 'root missing') return { ok: false, text: async () => '' };
      if (kind === 'undefined root') return undefined;
      if (kind === 'malformed root') return { ok: true, text: async () => '{' };
      if (kind === 'other city path')
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              schemaVersion: '0.1.0',
              settlements: {
                'es-torrevieja': { catalog: 'es-elche/catalog.json' },
              },
            }),
        };
    }
    if (path === 'es-torrevieja/catalog.json') {
      if (kind === 'city missing') return { ok: false, text: async () => '' };
      if (kind === 'city mismatch')
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              schemaVersion: '0.1.0',
              settlementId: 'es-elche',
              collections: {},
            }),
        };
    }
    if (path.endsWith('materialization/catalog.v0.json')) {
      if (kind === 'catalog malformed')
        return { ok: true, text: async () => JSON.stringify({}) };
      if (kind === 'unknown kit') {
        const response = await original(url);
        const data = JSON.parse(await response!.text());
        data.sites[1].recipes[1].kitId = 'missing-kit';
        return { ok: true, text: async () => JSON.stringify(data) };
      }
    }
    if (path.endsWith('laguna-rosa.geojson')) {
      if (kind === 'geometry missing')
        return { ok: false, text: async () => '' };
      if (kind === 'bad checksum')
        return { ok: true, text: async () => '{"type":"Feature"}' };
    }
    return original(url);
  });
  await expect(loader.resolve('es-torrevieja', 'near')).rejects.toThrow();
  io.fetchText.mockImplementation(original);
  expect((await loader.resolve('es-torrevieja', 'near'))?.sites).toHaveLength(
    8,
  );
});
it('valid city without materialization is absent and hidden/disabled sites never request their geometry', async () => {
  const io = fixture(),
    original = io.fetchText.getMockImplementation()!;
  io.fetchText.mockImplementation(async (url) =>
    url.endsWith('es-torrevieja/catalog.json')
      ? {
          ok: true,
          text: async () =>
            JSON.stringify({
              schemaVersion: '0.1.0',
              settlementId: 'es-torrevieja',
              collections: {},
            }),
        }
      : original(url),
  );
  const absent = createCityMaterializationLoader({ baseUrl: '/', ...io });
  expect(await absent.resolve('es-torrevieja', 'far')).toBeUndefined();
  expect(io.fetchText).toHaveBeenCalledTimes(2);
  io.fetchText.mockClear();
  io.fetchText.mockImplementation(async (url) => {
    const response = await original(url);
    if (url.endsWith('materialization/catalog.v0.json')) {
      const data = JSON.parse(await response!.text());
      for (const site of data.sites) site.lod.A = 'hidden';
      return { ok: true, text: async () => JSON.stringify(data) };
    }
    return response;
  });
  const hidden = createCityMaterializationLoader({ baseUrl: '/', ...io });
  expect((await hidden.resolve('es-torrevieja', 'far'))?.sites).toEqual([]);
  expect(io.fetchText.mock.calls.some(([p]) => p.endsWith('.geojson'))).toBe(
    false,
  );
  expect((await hidden.resolve('es-torrevieja', 'near'))?.sites).toHaveLength(
    8,
  );
});

it('loads asset-ready sites but does not inflate disabled/unmaterialized geometries', async () => {
  const io = fixture(),
    original = io.fetchText.getMockImplementation()!;
  io.fetchText.mockImplementation(async (url) => {
    const response = await original(url);
    if (url.endsWith('materialization/catalog.v0.json')) {
      const data = JSON.parse(await response!.text());
      data.sites[0].stage = 'disabled';
      data.sites[1].stage = 'asset-ready';
      data.sites[2].stage = 'unmaterialized';
      return { ok: true, text: async () => JSON.stringify(data) };
    }
    return response;
  });
  const loader = createCityMaterializationLoader({ baseUrl: '/', ...io });
  const model = await loader.resolve('es-torrevieja', 'near');
  expect(model?.sites).toHaveLength(6);
  expect(
    io.fetchText.mock.calls.some(
      ([url]) =>
        url.endsWith('laguna-rosa.geojson') ||
        url.endsWith('torre-moro.geojson'),
    ),
  ).toBe(false);
});

it('never reuses a successful shared-file read for a conflicting declared SHA and retries after correction', async () => {
  const io = fixture();
  const original = io.fetchText.getMockImplementation()!;
  io.fetchText.mockImplementation(async (url) => {
    if (!url.endsWith('/materialization/catalog.v0.json')) return original(url);
    const catalog = JSON.parse(
      readFileSync(
        root + 'es-torrevieja/materialization/catalog.v0.json',
        'utf8',
      ),
    ) as { sites: { id: string; geometries: { sha256: string }[] }[] };
    const duplicate = structuredClone(catalog.sites[0]!);
    duplicate.id = 'ua-site-es-torrevieja-conflicting-shared-hash';
    duplicate.geometries[0]!.sha256 = 'f'.repeat(64);
    catalog.sites.push(duplicate);
    return { ok: true, text: async () => JSON.stringify(catalog) };
  });
  const loader = createCityMaterializationLoader({ baseUrl: '/', ...io });
  const result = await loader.resolve('es-torrevieja', 'far').then(
    () => 'accepted',
    (error) => String(error),
  );
  expect(result).toContain('integrity mismatch');
  io.fetchText.mockImplementation(original);
  expect((await loader.resolve('es-torrevieja', 'far'))?.sites).toHaveLength(8);
});
