import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useStreetCells } from './use-street-cells.js';
import type { StreetCells } from './street-cells.js';
vi.mock('../city-preparation/browser-preparation.js', () => ({
  runPreparation: vi.fn(),
}));
import { runPreparation as fetchPublicAsset } from '../city-preparation/browser-preparation.js';
const model: StreetCells = {
  settlementId: 'es-torrevieja',
  level: 'C',
  sha256: 'a'.repeat(64),
  features: [],
};
it('does no disabled acquisition, invalidates near exits/city/loader races, retries and rejects late callbacks', async () => {
  const pending: {
    resolve: (m: StreetCells | undefined) => void;
    reject: (e: unknown) => void;
  }[] = [];
  const loader = {
    resolve: vi.fn(
      () =>
        new Promise<StreetCells | undefined>((resolve, reject) =>
          pending.push({ resolve, reject }),
        ),
    ),
  };
  const hook = renderHook(
    ({ city, active }) => useStreetCells(city, active, loader),
    { initialProps: { city: 'es-torrevieja', active: false } },
  );
  expect(hook.result.current.status).toBe('inactive');
  expect(loader.resolve).not.toHaveBeenCalled();
  hook.rerender({ city: 'es-torrevieja', active: true });
  expect(hook.result.current.status).toBe('loading');
  hook.rerender({ city: 'es-elche', active: true });
  await act(async () => pending[0]!.resolve(model));
  expect(hook.result.current.status).toBe('loading');
  await act(async () => pending[1]!.resolve(undefined));
  expect(hook.result.current.status).toBe('absent');
  hook.rerender({ city: 'es-torrevieja', active: true });
  await act(async () => pending[2]!.reject(new Error('integrity')));
  expect(hook.result.current).toEqual({
    status: 'error',
    message: 'integrity',
  });
  hook.rerender({ city: 'es-torrevieja', active: false });
  hook.rerender({ city: 'es-torrevieja', active: true });
  await act(async () => pending[3]!.resolve(model));
  expect(hook.result.current.status).toBe('ready');
  hook.rerender({ city: 'es-elche', active: true });
  hook.rerender({ city: 'es-torrevieja', active: false });
  await act(async () => pending[4]!.reject('late'));
  expect(hook.result.current.status).toBe('inactive');
  hook.rerender({ city: 'es-torrevieja', active: true });
  hook.unmount();
  await act(async () => pending[5]!.resolve(model));
  const failingLoader = {
    resolve: async () => {
      throw 'broken';
    },
  };
  const failing = renderHook(() =>
    useStreetCells('es-torrevieja', true, failingLoader),
  );
  await waitFor(() =>
    expect(failing.result.current).toEqual({
      status: 'error',
      message: 'StreetCells could not be loaded',
    }),
  );
  failing.unmount();
});
it('uses the shared browser registry only when demanded and exposes required archive errors', async () => {
  vi.mocked(fetchPublicAsset).mockRejectedValue(
    new Error('Public layer unavailable: street-cells'),
  );
  const h = renderHook(() => useStreetCells('es-torrevieja', true));
  await waitFor(() =>
    expect(h.result.current).toEqual({
      status: 'error',
      message: 'Public layer unavailable: street-cells',
    }),
  );
  h.unmount();
});

it('invalidates same-city A/B/C requests and rejects delayed obsolete levels', async () => {
  const pending: ((m: StreetCells) => void)[] = [];
  const loader = {
    resolve: vi.fn(
      () => new Promise<StreetCells>((resolve) => pending.push(resolve)),
    ),
  };
  const h = renderHook(
    ({ level }: { level: 'A' | 'B' | 'C' }) =>
      useStreetCells('es-torrevieja', true, loader, level),
    { initialProps: { level: 'A' } },
  );
  h.rerender({ level: 'B' });
  await act(async () => pending[0]!({ ...model, level: 'A' }));
  expect(h.result.current.status).toBe('loading');
  await act(async () => pending[1]!({ ...model, level: 'B' }));
  expect(h.result.current).toEqual({
    status: 'ready',
    model: { ...model, level: 'B' },
  });
  h.rerender({ level: 'C' });
  expect(h.result.current.status).toBe('loading');
  await act(async () => pending[2]!(model));
  expect(h.result.current.status).toBe('ready');
  expect(loader.resolve.mock.calls).toEqual([
    ['es-torrevieja', 'A'],
    ['es-torrevieja', 'B'],
    ['es-torrevieja', 'C'],
  ]);
  h.unmount();
});
it('preserves absent coverage, freezes valid worker C and diagnoses foreign packets', async () => {
  for (const value of [
    undefined,
    model,
    { ...model, settlementId: 'es-foreign' },
  ]) {
    vi.mocked(fetchPublicAsset).mockResolvedValueOnce(value);
    const h = renderHook(() => useStreetCells('es-torrevieja', true));
    await waitFor(() =>
      expect(h.result.current.status).toBe(
        value === undefined ? 'absent' : value === model ? 'ready' : 'error',
      ),
    );
    if (h.result.current.status === 'ready')
      expect(Object.isFrozen(h.result.current.model)).toBe(true);
    h.unmount();
  }
});
