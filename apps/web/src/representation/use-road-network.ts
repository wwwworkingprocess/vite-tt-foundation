import { usePreparationAttempt } from '../city-preparation/CityPreparationProvider.js';
import { useEffect, useState } from 'react';
import { runPreparation } from '../city-preparation/browser-preparation.js';
import { record } from '../city-preparation/preparation-protocol.js';
import { freezeSettlement } from '../settlement/settlement-metadata.js';
import type { createRoadNetworkLoader } from './road-network-loader.js';
import type { RoadLevel, RoadNetwork } from './road-network.js';
export type RoadNetworkState =
  | Readonly<{ status: 'absent' | 'loading' }>
  | Readonly<{ status: 'error'; message: string }>
  | Readonly<{ status: 'ready'; model: RoadNetwork }>;
type Loader = ReturnType<typeof createRoadNetworkLoader>;
let browserLoader: Loader | undefined;
function getBrowserLoader() {
  browserLoader ??= {
    async resolve(settlementId, level = 'C') {
      const value = await runPreparation(
        'roads:' + settlementId + ':' + level,
        { kind: 'roads', city: settlementId, level },
      );
      if (value === undefined) return undefined;
      if (
        !record(value) ||
        value.settlementId !== settlementId ||
        value.level !== level ||
        !Array.isArray(value.features)
      )
        throw Error('Invalid prepared roads model');
      return freezeSettlement(value) as unknown as RoadNetwork;
    },
  };
  return browserLoader;
}
/** Pending/failed transitions show provisional streets, never a mislabeled old level. */
export function useRoadNetwork(
  settlementId: string,
  level: RoadLevel,
  loader: Loader = getBrowserLoader(),
): RoadNetworkState {
  const attempt = usePreparationAttempt();
  const key = attempt + ':' + settlementId + ':' + level;
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
