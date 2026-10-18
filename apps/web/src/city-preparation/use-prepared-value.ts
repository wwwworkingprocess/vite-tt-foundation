import { usePreparationAttempt } from './CityPreparationProvider.js';
import { useEffect, useMemo, useState } from 'react';
import { runPreparation } from './browser-preparation.js';
import type { PreparationJob } from './preparation-protocol.js';
/** Effect ownership rejects stale resolutions, including same-city return and unmount. */
export function usePreparedValue<T>(
  key: string,
  job: PreparationJob | undefined,
  decode: (value: unknown) => T,
) {
  const attempt = usePreparationAttempt();
  const request = useMemo(
    () => ({ key, job, decode }),
    [key, job, decode, attempt],
  );
  const [result, setResult] = useState<
    | { request: typeof request; status: 'ready'; value: T }
    | { request: typeof request; status: 'error'; message: string }
  >();
  useEffect(() => {
    if (!job) return;
    let active = true;
    void runPreparation(key, job).then(
      (value) => {
        if (active) {
          try {
            setResult({ request, status: 'ready', value: decode(value) });
          } catch (error) {
            setResult({ request, status: 'error', message: String(error) });
          }
        }
      },
      (error) => {
        if (active)
          setResult({ request, status: 'error', message: String(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [request, key, job, decode]);
  return !job
    ? undefined
    : result?.request === request
      ? result
      : { status: 'loading' as const };
}
