import { useEffect, useState } from 'react';
import { fetchPublicAsset } from '../assets/public-layers.js';
import { browserSha256 } from '../scenarios/scenario-loader.js';
import { createRoadNetworkLoader } from './road-network-loader.js';
import type { RoadLevel, RoadNetwork } from './road-network.js';
export type RoadNetworkState =
  | Readonly<{ status: 'absent' | 'loading' }>
  | Readonly<{ status: 'error'; message: string }>
  | Readonly<{ status: 'ready'; model: RoadNetwork }>;
type Loader = ReturnType<typeof createRoadNetworkLoader>;
let browserLoader: Loader | undefined;
function getBrowserLoader() {
  browserLoader ??= createRoadNetworkLoader({
    baseUrl: import.meta.env.BASE_URL,
    digestSha256: browserSha256,
    fetchText: fetchPublicAsset,
  });
  return browserLoader;
}
/** Pending/failed transitions show provisional streets, never a mislabeled old level. */
export function useRoadNetwork(
  settlementId: string,
  level: RoadLevel,
  loader: Loader = getBrowserLoader(),
): RoadNetworkState {
  const key = settlementId + ':' + level;
  const [result, setResult] =
    useState<
      Readonly<{ key: string; loader: Loader; view: RoadNetworkState }>
    >();
  useEffect(() => {
    let active = true;
    void loader.resolve(settlementId, level).then(
      (model) => {
        if (active)
          setResult({
            key,
            loader,
            view: model ? { status: 'ready', model } : { status: 'absent' },
          });
      },
      (error: unknown) => {
        if (active)
          setResult({
            key,
            loader,
            view: {
              status: 'error',
              message:
                error instanceof Error
                  ? error.message
                  : 'Road network could not be loaded',
            },
          });
      },
    );
    return () => {
      active = false;
    };
  }, [key, settlementId, level, loader]);
  return result?.key === key && result.loader === loader
    ? result.view
    : { status: 'loading' };
}
