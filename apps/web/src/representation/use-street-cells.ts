import { useEffect, useMemo, useState } from 'react';
import { fetchPublicAsset } from '../assets/public-layers.js';
import { browserSha256 } from '../scenarios/scenario-loader.js';
import { createStreetCellLoader } from './street-cells-loader.js';
import type { CellLevel, StreetCells } from './street-cells.js';
export type StreetCellState =
  | Readonly<{ status: 'inactive' | 'loading' | 'absent' }>
  | Readonly<{ status: 'error'; message: string }>
  | Readonly<{ status: 'ready'; model: StreetCells }>;
type Loader = ReturnType<typeof createStreetCellLoader>;
let browserLoader: Loader | undefined;
function getBrowserLoader() {
  browserLoader ??= createStreetCellLoader({
    baseUrl: import.meta.env.BASE_URL,
    fetchText: fetchPublicAsset,
    digestSha256: browserSha256,
  });
  return browserLoader;
}
/** No acquisition until normal/native-ready selected-level demand. Effect identity rejects
 * even same-city late results after a disabled interval or independent remount. */
export function useStreetCells(
  settlementId: string,
  active: boolean,
  loader: Loader = getBrowserLoader(),
  level: CellLevel = 'C',
): StreetCellState {
  const request = useMemo(
    () => ({ settlementId, active, loader, level }),
    [settlementId, active, loader, level],
  );
  const [result, setResult] =
    useState<Readonly<{ request: typeof request; view: StreetCellState }>>();
  useEffect(() => {
    if (!active) return;
    let current = true;
    void loader.resolve(settlementId, level).then(
      (model) => {
        if (current)
          setResult({
            request,
            view: model ? { status: 'ready', model } : { status: 'absent' },
          });
      },
      (error: unknown) => {
        if (current)
          setResult({
            request,
            view: {
              status: 'error',
              message:
                error instanceof Error
                  ? error.message
                  : 'StreetCells could not be loaded',
            },
          });
      },
    );
    return () => {
      current = false;
    };
  }, [request, active, settlementId, loader, level]);
  if (!active) return { status: 'inactive' };
  return result?.request === request ? result.view : { status: 'loading' };
}
