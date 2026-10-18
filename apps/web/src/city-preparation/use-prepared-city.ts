import { useMemo } from 'react';
import { usePreparedValue } from './use-prepared-value.js';
import type { PreparationJob } from './preparation-protocol.js';
import { freezeSettlement } from '../settlement/settlement-metadata.js';
import type { ProceduralCity } from '../representation/d3d-city-model.js';
import { record } from './preparation-protocol.js';
const decode = (value: unknown) => {
  if (
    !record(value) ||
    !record(value.city) ||
    value.schemaVersion !== 1 ||
    typeof value.identity !== 'string' ||
    !(value.baseYs instanceof Float64Array) ||
    value.city.buildingSource !== 'street-cells-C' ||
    !Array.isArray(value.city.buildings) ||
    value.baseYs.length !== value.city.buildings.length
  )
    throw Error('Invalid prepared C city');
  return {
    identity: value.identity,
    city: freezeSettlement(value.city) as ProceduralCity,
    baseYs: value.baseYs,
  };
};
export function usePreparedCity(
  key: string,
  input: Extract<PreparationJob, { kind: 'compose' }> | undefined,
) {
  const job = useMemo(() => input, [input]);
  const decoder = useMemo(
    () => (value: unknown) => {
      const v = decode(value);
      if (v.identity !== key) throw Error('Prepared city identity mismatch');
      return v;
    },
    [key],
  );
  const state = usePreparedValue(key, job, decoder);
  return useMemo(
    () =>
      state?.status === 'ready'
        ? {
            status: 'ready' as const,
            city: state.value.city,
            baseYs: state.value.baseYs,
          }
        : state,
    [state],
  );
}
