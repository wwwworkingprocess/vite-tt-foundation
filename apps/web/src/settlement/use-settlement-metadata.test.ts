import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useSettlementMetadata } from './use-settlement-metadata.js';
import type { SettlementMetadataView } from './settlement-metadata-loader.js';

it('uses a shared base-path browser loader without making absent metadata fatal', async () => {
  const fetchText = vi.fn(async () => ({
    ok: true,
    text: async () => JSON.stringify({ schemaVersion: '0.1.0', cities: [] }),
  }));
  vi.stubGlobal('fetch', fetchText);
  const first = renderHook(() => useSettlementMetadata('es-other'));
  await act(async () => {});
  expect(first.result.current.status).toBe('unavailable');
  const second = renderHook(() => useSettlementMetadata('es-another'));
  await act(async () => {});
  expect(second.result.current.status).toBe('unavailable');
  expect(fetchText).toHaveBeenCalledTimes(1);
  expect(fetchText).toHaveBeenCalledWith('/settlement-metadata/catalog.json');
  first.unmount();
  second.unmount();
  vi.unstubAllGlobals();
});

it('ignores failed requests after unmount', async () => {
  let reject!: (error: Error) => void;
  const loader = {
    resolveSettlementMetadata: () =>
      new Promise<SettlementMetadataView>((_, r) => {
        reject = r;
      }),
  };
  const hook = renderHook(() => useSettlementMetadata('old', loader));
  hook.unmount();
  await act(async () => reject(new Error('late failure')));
});

it('loads presentation metadata, suppresses stale completions, and falls back on unavailable/failure', async () => {
  let resolve!: (view: SettlementMetadataView) => void;
  let reject!: (error: Error) => void;
  const loader = {
    resolveSettlementMetadata: vi
      .fn<(id: string) => Promise<SettlementMetadataView>>()
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((_, r) => {
            reject = r;
          }),
      )
      .mockResolvedValue({ status: 'unavailable' }),
  };
  const hook = renderHook(({ id }) => useSettlementMetadata(id, loader), {
    initialProps: { id: 'old' },
  });
  expect(hook.result.current.status).toBe('loading');
  hook.rerender({ id: 'new' });
  await act(async () => resolve({ status: 'unavailable' }));
  expect(hook.result.current.status).toBe('loading');
  await act(async () => reject(new Error('missing')));
  expect(hook.result.current.status).toBe('failed');
  hook.rerender({ id: 'unavailable' });
  await act(async () => {});
  expect(hook.result.current.status).toBe('unavailable');
  hook.unmount();
});
