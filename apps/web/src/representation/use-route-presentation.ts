import { useEffect, useState } from 'react';
import type { CanonicalScenario } from '@torrevieja-tycoon/transport-domain';
import { browserSha256 } from '../scenarios/scenario-loader.js';
import { createRoutePresentationLoader } from './route-presentation-loader.js';
import type { RoutePresentationAsset } from './route-presentation.js';

type Loader = ReturnType<typeof createRoutePresentationLoader>;
let browserLoader: Loader | undefined;
function getBrowserLoader() {
  browserLoader ??= createRoutePresentationLoader({
    baseUrl: import.meta.env.BASE_URL,
    fetchText: (url) => fetch(url),
    digestSha256: browserSha256,
  });
  return browserLoader;
}
export function useRoutePresentation(
  scenario: CanonicalScenario | undefined,
  loader: Loader = getBrowserLoader(),
) {
  const [result, setResult] =
    useState<
      Readonly<{ scenario: CanonicalScenario; asset: RoutePresentationAsset }>
    >();
  useEffect(() => {
    let active = true;
    if (scenario)
      void loader.resolve(scenario).then(
        (asset) => {
          if (active && asset) setResult({ scenario, asset });
        },
        () => {
          if (active) setResult(undefined);
        },
      );
    return () => {
      active = false;
    };
  }, [scenario, loader]);
  return result?.scenario === scenario ? result?.asset : undefined;
}
