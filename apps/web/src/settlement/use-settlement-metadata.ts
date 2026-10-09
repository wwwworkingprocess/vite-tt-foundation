import { fetchPublicAsset } from '../assets/public-layers.js';
import { useEffect, useState } from 'react';
import { browserSha256 } from '../scenarios/scenario-loader.js';
import {
  createSettlementMetadataLoader,
  type SettlementMetadataView,
} from './settlement-metadata-loader.js';
type Loader = ReturnType<typeof createSettlementMetadataLoader>;
type State =
  SettlementMetadataView | Readonly<{ status: 'loading' | 'failed' }>;
let browserLoader: Loader | undefined;
function getBrowserLoader(): Loader {
  browserLoader ??= createSettlementMetadataLoader({
    baseUrl: import.meta.env.BASE_URL,
    fetchText: (url) => fetchPublicAsset(url),
    digestSha256: browserSha256,
  });
  return browserLoader;
}
/** Optional presentation acquisition never blocks scenario/population authority. */
export function useSettlementMetadata(
  primarySettlementId: string,
  loader: Loader = getBrowserLoader(),
): State {
  const [result, setResult] = useState<{ id: string; view: State }>({
    id: primarySettlementId,
    view: { status: 'loading' },
  });
  useEffect(() => {
    let active = true;
    setResult({ id: primarySettlementId, view: { status: 'loading' } });
    void loader.resolveSettlementMetadata(primarySettlementId).then(
      (view) => {
        if (active) setResult({ id: primarySettlementId, view });
      },
      () => {
        if (active)
          setResult({ id: primarySettlementId, view: { status: 'failed' } });
      },
    );
    return () => {
      active = false;
    };
  }, [primarySettlementId, loader]);
  return result.id === primarySettlementId
    ? result.view
    : { status: 'loading' };
}
