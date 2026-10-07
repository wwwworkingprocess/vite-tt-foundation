import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createTerrainLoader, type TerrainView } from './terrain-loader.js';
import { useTerrain } from './use-terrain.js';
import { terrainFixture } from '../test/terrain-fixture.js';
afterEach(() => vi.unstubAllGlobals());
it('keeps loading optional and ignores stale successful acquisition', async () => {
  let finish!: (v: TerrainView) => void;
  const resolve = vi.fn(
    () =>
      new Promise<TerrainView>((r) => {
        finish = r;
      }),
  );
  const loader = { resolve } satisfies ReturnType<typeof createTerrainLoader>;
  const view = renderHook(({ id }) => useTerrain('test', id, loader), {
    initialProps: { id: 'a' },
  });
  expect(view.result.current.status).toBe('loading');
  const old = finish;
  view.rerender({ id: 'b' });
  await act(async () => old({ status: 'unavailable' }));
  expect(view.result.current.status).toBe('loading');
  await act(async () => finish({ status: 'unavailable' }));
  expect(view.result.current.status).toBe('unavailable');
  view.rerender({ id: 'c' });
  expect(view.result.current.status).toBe('loading');
  view.unmount();
  await act(async () => finish({ status: 'unavailable' }));
});
it('publishes a clear error and ignores rejection after teardown', async () => {
  let reject!: (e: unknown) => void;
  const loader = {
    resolve: () =>
      new Promise<TerrainView>((_r, j) => {
        reject = j;
      }),
  };
  const view = renderHook(() => useTerrain('test', 'a', loader));
  await act(async () => reject(new Error('bad terrain')));
  expect(view.result.current).toEqual({
    status: 'error',
    message: 'bad terrain',
  });
  view.unmount();
  const v2 = renderHook(() => useTerrain('test', 'a', loader));
  await act(async () => reject('not an Error'));
  expect(v2.result.current).toEqual({
    status: 'error',
    message: 'Terrain could not be loaded',
  });
  v2.unmount();
  const v3 = renderHook(() => useTerrain('test', 'b', loader));
  v3.unmount();
  await act(async () => reject(new Error('stale')));
});
it('uses the lazily shared browser loader and reaches ready without injected acquisition', async () => {
  const f = terrainFixture();
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    text: async () =>
      JSON.stringify(
        url.endsWith('catalog.json')
          ? f.catalog
          : url.endsWith('height.json')
            ? f.height
            : url.endsWith('mask.json')
              ? f.surfaceMask
              : f.coastline,
      ),
  }));
  vi.stubGlobal('fetch', fetchMock);
  const a = renderHook(() => useTerrain('test', 'a'));
  await waitFor(() => expect(a.result.current.status).toBe('ready'));
  const b = renderHook(() => useTerrain('test', 'b'));
  await waitFor(() => expect(b.result.current.status).toBe('ready'));
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(fetchMock.mock.calls[0]![0]).toBe('/terrain/catalog.json');
  a.unmount();
  b.unmount();
});
