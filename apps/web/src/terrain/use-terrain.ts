import { useEffect, useState } from 'react';
import { createTerrainLoader, type TerrainView } from './terrain-loader.js';
type Loader = ReturnType<typeof createTerrainLoader>;
export type TerrainState =
  | TerrainView
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'error'; message: string }>;
let browserLoader: Loader | undefined;
function getBrowserLoader() {
  browserLoader ??= createTerrainLoader({
    baseUrl: import.meta.env.BASE_URL,
    fetchText: (url) => fetch(url),
  });
  return browserLoader;
}
/** Optional acquisition; simulation readiness never waits for terrain. */
export function useTerrain(
  settlementId: string,
  scenarioId: string,
  loader: Loader = getBrowserLoader(),
): TerrainState {
  const key = `${settlementId}:${scenarioId}`;
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
