import { usePreparationAttempt } from '../city-preparation/CityPreparationProvider.js';
import { useEffect, useMemo, useState } from 'react';
import { runPreparation } from '../city-preparation/browser-preparation.js';
import { record } from '../city-preparation/preparation-protocol.js';
import { freezeSettlement } from '../settlement/settlement-metadata.js';
import type { createStreetCellLoader } from './street-cells-loader.js';
import type { CellLevel, StreetCells } from './street-cells.js';
export type StreetCellState =
  | Readonly<{ status: 'inactive' | 'loading' | 'absent' }>
  | Readonly<{ status: 'error'; message: string }>
  | Readonly<{ status: 'ready'; model: StreetCells }>;
type Loader = ReturnType<typeof createStreetCellLoader>;
let browserLoader: Loader | undefined;
function getBrowserLoader() {
  browserLoader ??= {
    async resolve(settlementId, level = 'C') {
      const value = await runPreparation(
        'cells:' + settlementId + ':' + level,
        { kind: 'cells', city: settlementId, level },
      );
      if (value === undefined) return undefined;
      if (
        !record(value) ||
        value.settlementId !== settlementId ||
        value.level !== level ||
        !Array.isArray(value.features)
      )
        throw Error('Invalid prepared cells model');
      return freezeSettlement(value) as unknown as StreetCells;
    },
  };
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
  const attempt = usePreparationAttempt();
  const request = useMemo(
    () => ({ settlementId, active, loader, level, attempt }),
    [settlementId, active, loader, level, attempt],
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
