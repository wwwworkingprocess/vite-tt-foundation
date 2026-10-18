import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../city-preparation/browser-preparation.js', () => ({
  runPreparation: vi.fn(),
  warmPreparationWorker: vi.fn(),
}));
import { runPreparation } from '../city-preparation/browser-preparation.js';
import { fetchPublicAsset } from './public-layers.js';
it('returns independent browser bytes and rejects malformed worker asset replies', async () => {
  const bytes = new Uint8Array([123, 125]);
  vi.mocked(runPreparation).mockResolvedValueOnce({ ok: true, bytes });
  const asset = await fetchPublicAsset('/game/terrain/catalog.json');
  expect(await asset.text()).toBe('{}');
  new Uint8Array(await asset.arrayBuffer()).fill(0);
  expect(await asset.text()).toBe('{}');
  expect(bytes[0]).toBe(123);
  for (const value of [null, { ok: 'bad', bytes }, { ok: true, bytes: [] }]) {
    vi.mocked(runPreparation).mockResolvedValueOnce(value);
    await expect(
      fetchPublicAsset('/game/terrain/catalog.json'),
    ).rejects.toThrow('Invalid prepared public asset');
  }
});

import { zipFixture } from '../test/zip-fixture.js';
afterEach(() => vi.unstubAllGlobals());

it('keeps canonical scenario/population acquisition responsive while the visual worker is busy, with one archive owner per layer', async () => {
  vi.mocked(runPreparation).mockReset();
  let finish!: (v: unknown) => void;
  vi.mocked(runPreparation).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const fetcher = vi.fn(async (url: string) => ({
    ok: url.startsWith('/'),
    arrayBuffer: async () =>
      Uint8Array.from(zipFixture('catalog.json', '{"critical":true}', 0))
        .buffer,
  }));
  vi.stubGlobal('fetch', fetcher);
  const visual = fetchPublicAsset('/terrain/catalog.json');
  const scenario = fetchPublicAsset('/scenarios/catalog.json');
  expect(runPreparation).toHaveBeenCalledTimes(1);
  expect(await (await scenario).text()).toBe('{"critical":true}');
  expect(
    await (await fetchPublicAsset('/population-fields/catalog.json')).text(),
  ).toBe('{"critical":true}');
  await fetchPublicAsset('/scenarios/catalog.json');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.map((c) => c[0])).toEqual([
    expect.stringMatching(/^\/scenarios\/scenarios.zip/),
    expect.stringMatching(/^\/population-fields\/population-fields.zip/),
  ]);
  finish({ ok: true, bytes: new Uint8Array([123, 125]) });
  expect(await (await visual).text()).toBe('{}');
});
