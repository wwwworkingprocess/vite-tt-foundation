import { usePreparationAttempt } from '../city-preparation/CityPreparationProvider.js';
import { runPreparation } from '../city-preparation/browser-preparation.js';
import { unpackNativeTerrain } from '../city-preparation/native-terrain-dto.js';
import { record } from '../city-preparation/preparation-protocol.js';
import { useEffect, useState } from 'react';
import {
  type createTerrainLoader,
  type TerrainView,
} from './terrain-loader.js';
type Loader = ReturnType<typeof createTerrainLoader>;
export type TerrainState =
  | TerrainView
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'error'; message: string }>;
let browserLoader: Loader | undefined;
function getBrowserLoader() {
  browserLoader ??= {
    async resolve(settlementId, scenarioId) {
      const value = await runPreparation(
        'terrain:' + settlementId + ':' + scenarioId,
        { kind: 'terrain', city: settlementId, scenario: scenarioId },
      );
      if (!record(value)) throw Error('Invalid prepared terrain view');
      if (value.status === 'unavailable') return { status: 'unavailable' };
      if (value.status !== 'ready')
        throw Error('Invalid prepared terrain status');
      return { status: 'ready', terrain: unpackNativeTerrain(value.terrain) };
    },
  };
  return browserLoader;
}
/** Optional acquisition; simulation readiness never waits for terrain. */
export function useTerrain(
  settlementId: string,
  scenarioId: string,
  loader: Loader = getBrowserLoader(),
): TerrainState {
  const attempt = usePreparationAttempt();
  const key = `${attempt}:${settlementId}:${scenarioId}`;
  const [result, setResult] = useState<
    Readonly<{ key: string; view: TerrainState }>
  >({ key, view: { status: 'loading' } });
  useEffect(() => {
    let active = true;
    void loader.resolve(settlementId, scenarioId).then(
      (view) => {
        if (active) setResult({ key, view });
      },
      (error: unknown) => {
        if (active)
          setResult({
            key,
            view: {
              status: 'error',
              message:
                error instanceof Error
                  ? error.message
                  : 'Terrain could not be loaded',
            },
          });
      },
    );
    return () => {
      active = false;
    };
  }, [key, settlementId, scenarioId, loader]);
  return result.key === key ? result.view : { status: 'loading' };
}
