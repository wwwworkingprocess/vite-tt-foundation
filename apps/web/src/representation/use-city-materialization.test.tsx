import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useCityMaterialization } from './use-city-materialization.js';
import type { createCityMaterializationLoader } from './city-materialization-loader.js';
import type { CityMaterialization } from './city-materialization.js';
import type { D3dLodBand } from './d3d-map-model.js';
import { fetchPublicAsset } from '../assets/public-layers.js';
vi.mock('../assets/public-layers.js', () => ({
  fetchPublicAsset: vi.fn(async () => ({
    ok: true,
    text: async () =>
      JSON.stringify({ schemaVersion: '0.1.0', settlements: {} }),
  })),
}));
type Loader = ReturnType<typeof createCityMaterializationLoader>;
const model: CityMaterialization = {
  catalog: {
    schemaVersion: '0.1.0',
    contract: 'city-materialization',
    settlementId: 'es-torrevieja',
    coordinatePrecisionDecimals: 7,
    kitCatalogPath: 'shared/materialization/kits.v0.json',
    sites: [],
  },
  kits: {
    schemaVersion: '0.1.0',
    contract: 'materialization-kit-catalog',
    kits: [],
  },
  sites: [],
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('does not acquire disabled/mini/no-terrain data, then shares the browser loader and normal absence', async () => {
  const first = renderHook(() =>
    useCityMaterialization('es-alicante', 'far', false),
  );
  expect(first.result.current.status).toBe('inactive');
  expect(fetchPublicAsset).not.toHaveBeenCalled();
  first.unmount();
  const ready = renderHook(() =>
    useCityMaterialization('es-alicante', 'far', true),
  );
  await waitFor(() => expect(ready.result.current.status).toBe('absent'));
  expect(fetchPublicAsset).toHaveBeenCalledTimes(1);
  ready.unmount();
  const second = renderHook(() =>
    useCityMaterialization('es-elche', 'near', true),
  );
  await waitFor(() => expect(second.result.current.status).toBe('absent'));
  expect(fetchPublicAsset).toHaveBeenCalledTimes(1);
});
it('installs current ready data, rejects stale city/LOD/mode promises and does not publish after unmount', async () => {
  const pending: ((value: CityMaterialization | undefined) => void)[] = [];
  const loader: Loader = {
    resolve: vi.fn<Loader['resolve']>(
      () => new Promise((resolve) => pending.push(resolve)),
    ),
  };
  const props: { city: string; lod: D3dLodBand; enabled: boolean } = {
    city: 'es-torrevieja',
    lod: 'far',
    enabled: true,
  };
  const hook = renderHook(
    (p) => useCityMaterialization(p.city, p.lod, p.enabled, loader),
    { initialProps: props },
  );
  expect(hook.result.current.status).toBe('loading');
  hook.rerender({ ...props, lod: 'near' });
  await act(async () => pending[0]!(model));
  expect(hook.result.current.status).toBe('loading');
  await act(async () => pending[1]!(model));
  expect(hook.result.current).toEqual({ status: 'ready', model });
  hook.rerender({ ...props, city: 'es-elche', lod: 'near' });
  expect(hook.result.current.status).toBe('loading');
  hook.rerender({ ...props, city: 'es-elche', lod: 'near', enabled: false });
  await act(async () => pending[2]!(model));
  expect(hook.result.current.status).toBe('inactive');
  hook.rerender(props);
  hook.unmount();
  await act(async () => pending[3]!(model));
});
it.each([new Error('corrupt archive'), 'unexpected rejection'])(
  'reports recoverable errors from active requests: %s',
  async (error) => {
    const loader: Loader = { resolve: vi.fn().mockRejectedValue(error) };
    const hook = renderHook(() =>
      useCityMaterialization('es-torrevieja', 'far', true, loader),
    );
    await waitFor(() =>
      expect(hook.result.current).toEqual({
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'City materialization could not be loaded',
      }),
    );
  },
);
it('rejects late errors after city changes and permits a replacement loader to retry', async () => {
  let reject: (error: unknown) => void = () => {
    throw Error('request not started');
  };
  const loader: Loader = {
    resolve: vi.fn<Loader['resolve']>(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    ),
  };
  const other: Loader = { resolve: vi.fn(async () => undefined) };
  const hook = renderHook(
    ({ loader }) =>
      useCityMaterialization('es-torrevieja', 'near', true, loader),
    { initialProps: { loader } },
  );
  hook.rerender({ loader: other });
  await act(async () => reject(new Error('old failure')));
  await waitFor(() => expect(hook.result.current.status).toBe('absent'));
});
