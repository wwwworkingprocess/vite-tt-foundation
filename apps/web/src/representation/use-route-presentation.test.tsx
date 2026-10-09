vi.mock('../assets/public-layers.js', () => ({
  fetchPublicAsset: (url: string) => fetch(url),
}));
import { act, renderHook, waitFor } from '@testing-library/react';
import { readFileSync } from '../../../../scripts/public-layer-files.mjs';

import { join } from 'node:path';
import {
  parseScenarioPackage,
  type CanonicalScenario,
} from '@torrevieja-tycoon/transport-domain';
import { expect, it, vi } from 'vitest';
import { useRoutePresentation } from './use-route-presentation.js';
import {
  parseRoutePresentation,
  type RoutePresentationAsset,
} from './route-presentation.js';

const root = join(
  import.meta.dirname,
  '../../public/scenarios/torrevieja-v1/torrevieja-legacy-all-v1',
);
const json = (name: string) =>
  JSON.parse(readFileSync(join(root, name), 'utf8')) as unknown;
const scenario = parseScenarioPackage({
  manifest: json('scenario.json'),
  settlements: json('settlements.json'),
  stops: json('stops.json'),
  routes: json('routes.json'),
});
const asset = parseRoutePresentation(
  JSON.parse(
    readFileSync(
      join(
        import.meta.dirname,
        '../../public/route-presentation/torrevieja/torrevieja-route-presentation.v0.json',
      ),
      'utf8',
    ),
  ) as unknown,
  scenario,
);

it('offers immediate canonical fallback and ignores stale success after scenario replacement', async () => {
  let accept!: (asset: RoutePresentationAsset | undefined) => void;
  const loader = {
    resolve: vi.fn(
      () =>
        new Promise<RoutePresentationAsset | undefined>((resolve) => {
          accept = resolve;
        }),
    ),
  };
  const hook = renderHook(
    ({ current }: { current: CanonicalScenario | undefined }) =>
      useRoutePresentation(current, loader),
    { initialProps: { current: scenario as CanonicalScenario | undefined } },
  );
  expect(hook.result.current).toBeUndefined();
  const first = accept;
  hook.rerender({ current: { ...scenario } });
  await act(async () => first(asset));
  expect(hook.result.current).toBeUndefined();
  await act(async () => accept(asset));
  expect(hook.result.current).toBe(asset);
  hook.rerender({ current: undefined });
  expect(hook.result.current).toBeUndefined();
});

it('keeps missing and failed enrichment nonfatal and ignores late failure after unmount', async () => {
  let reject!: (reason: Error) => void;
  const loader = {
    resolve: vi.fn(
      () =>
        new Promise<RoutePresentationAsset | undefined>((_, fail) => {
          reject = fail;
        }),
    ),
  };
  const hook = renderHook(() => useRoutePresentation(scenario, loader));
  await act(async () => reject(new Error('offline')));
  expect(hook.result.current).toBeUndefined();
  hook.rerender();
  hook.unmount();
  const late = renderHook(() => useRoutePresentation(scenario, loader));
  late.unmount();
  await act(async () => reject(new Error('late')));
  const missing = renderHook(() =>
    useRoutePresentation(scenario, { resolve: async () => undefined }),
  );
  await waitFor(() => expect(missing.result.current).toBeUndefined());
  missing.unmount();
});

it('shares lazy browser acquisition and retains fallback when the catalogue is unavailable', async () => {
  const fetch = vi.fn(async () => ({ ok: false }));
  vi.stubGlobal('fetch', fetch);
  const first = renderHook(() => useRoutePresentation(scenario));
  const second = renderHook(() => useRoutePresentation(scenario));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(first.result.current).toBeUndefined();
  first.unmount();
  second.unmount();
  vi.unstubAllGlobals();
});
