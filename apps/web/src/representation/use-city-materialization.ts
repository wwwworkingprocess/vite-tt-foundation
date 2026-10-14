import { useEffect, useState } from 'react';
import { fetchPublicAsset } from '../assets/public-layers.js';
import { browserSha256 } from '../scenarios/scenario-loader.js';
import { createCityMaterializationLoader } from './city-materialization-loader.js';
import type { CityMaterialization } from './city-materialization.js';
import type { D3dLodBand } from './d3d-map-model.js';
export type CityMaterializationState =
  | Readonly<{ status: 'inactive' | 'loading' | 'absent' }>
  | Readonly<{ status: 'error'; message: string }>
  | Readonly<{ status: 'ready'; model: CityMaterialization }>;
type Loader = ReturnType<typeof createCityMaterializationLoader>;
let browserLoader: Loader | undefined;
function getLoader() {
  browserLoader ??= createCityMaterializationLoader({
    baseUrl: import.meta.env.BASE_URL,
    fetchText: fetchPublicAsset,
    digestSha256: browserSha256,
  });
  return browserLoader;
}
export function useCityMaterialization(
  settlementId: string,
  lod: D3dLodBand,
  enabled: boolean,
  loader: Loader = getLoader(),
): CityMaterializationState {
  const key = settlementId + ':' + lod;
  const [result, setResult] =
    useState<
      Readonly<{ key: string; loader: Loader; view: CityMaterializationState }>
    >();
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void loader.resolve(settlementId, lod).then(
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
                  : 'City materialization could not be loaded',
            },
          });
      },
    );
    return () => {
      active = false;
    };
  }, [settlementId, lod, key, enabled, loader]);
  if (!enabled) return { status: 'inactive' };
  return result?.key === key && result.loader === loader
    ? result.view
    : { status: 'loading' };
}
