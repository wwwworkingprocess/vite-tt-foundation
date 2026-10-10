import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useRoadNetwork } from './use-road-network.js';
import type { RoadLevel, RoadNetwork } from './road-network.js';
vi.mock('../assets/public-layers.js', () => ({ fetchPublicAsset: vi.fn() }));
import { fetchPublicAsset } from '../assets/public-layers.js';
const model: RoadNetwork = {
  settlementId: 'es-torrevieja',
  level: 'A',
  sha256: 'a'.repeat(64),
  features: [],
};
it('does not label stale/previous products as the requested level and ignores stale success/failure', async () => {
  const pending: {
    resolve: (m: RoadNetwork | undefined) => void;
    reject: (e: unknown) => void;
  }[] = [];
  const loader = {
    resolve: vi.fn(
      () =>
        new Promise<RoadNetwork | undefined>((resolve, reject) =>
          pending.push({ resolve, reject }),
        ),
    ),
  };
  const hook = renderHook(
    ({ city, level }: { city: string; level: RoadLevel }) =>
      useRoadNetwork(city, level, loader),
    { initialProps: { city: 'es-torrevieja', level: 'A' as RoadLevel } },
  );
  expect(hook.result.current.status).toBe('loading');
  hook.rerender({ city: 'es-torrevieja', level: 'B' });
  await act(async () => pending[0]!.resolve(model));
  expect(hook.result.current.status).toBe('loading');
  await act(async () => pending[1]!.resolve({ ...model, level: 'B' }));
  expect(hook.result.current).toMatchObject({
    status: 'ready',
    model: { level: 'B' },
  });
  hook.rerender({ city: 'es-elche', level: 'A' });
  expect(hook.result.current.status).toBe('loading');
  await act(async () => pending[2]!.resolve(undefined));
  expect(hook.result.current.status).toBe('absent');
  hook.rerender({ city: 'es-torrevieja', level: 'C' });
  await act(async () => pending[3]!.reject(new Error('integrity')));
  expect(hook.result.current).toEqual({
    status: 'error',
    message: 'integrity',
  });
  hook.rerender({ city: 'es-torrevieja', level: 'A' });
  const stale = pending[4]!;
  hook.rerender({ city: 'es-torrevieja', level: 'B' });
  await act(async () => stale.reject(new Error('late')));
  expect(hook.result.current.status).toBe('loading');
  hook.unmount();
  await act(async () => pending[5]!.resolve(model));
  const failing = {
    resolve: async () => {
      throw 'broken';
    },
  };
  const nonError = renderHook(() =>
    useRoadNetwork('es-torrevieja', 'A', failing),
  );
  await waitFor(() =>
    expect(nonError.result.current).toEqual({
      status: 'error',
      message: 'Road network could not be loaded',
    }),
  );
});
it('uses the shared revision-bound browser layer and exposes missing required infrastructure as an error', async () => {
  vi.mocked(fetchPublicAsset).mockRejectedValueOnce(new Error('corrupt ZIP'));
  const broken = renderHook(() => useRoadNetwork('es-torrevieja', 'B'));
  await waitFor(() =>
    expect(broken.result.current).toEqual({
      status: 'error',
      message: 'corrupt ZIP',
    }),
  );
  broken.unmount();
  vi.mocked(fetchPublicAsset).mockRejectedValueOnce('corrupt bytes');
  const unknown = renderHook(() => useRoadNetwork('es-torrevieja', 'C'));
  await waitFor(() => expect(unknown.result.current.status).toBe('error'));
  unknown.unmount();
  vi.mocked(fetchPublicAsset).mockRejectedValueOnce(
    new Error('Public layer unavailable: road-network'),
  );
  const first = renderHook(() => useRoadNetwork('es-torrevieja', 'A'));
  await waitFor(() =>
    expect(first.result.current).toEqual({
      status: 'error',
      message: 'Public layer unavailable: road-network',
    }),
  );
  first.unmount();
  vi.mocked(fetchPublicAsset).mockRejectedValueOnce(
    new Error('Root catalog unavailable'),
  );
  const second = renderHook(() => useRoadNetwork('es-elche', 'C'));
  await waitFor(() =>
    expect(second.result.current).toEqual({
      status: 'error',
      message: 'Root catalog unavailable',
    }),
  );
  expect(fetchPublicAsset).toHaveBeenCalledTimes(4);
  second.unmount();
});
