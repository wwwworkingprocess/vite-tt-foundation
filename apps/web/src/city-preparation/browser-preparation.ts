import workerUrl from 'virtual:city-preparation-worker-url';
import { createPreparationClient } from './preparation-client.js';
import {
  cityPreparationSettings,
  validatePreparationSettings,
} from './city-preparation-settings.js';
import type { PreparationJob } from './preparation-protocol.js';
validatePreparationSettings();
let workerDenied = false;
let client: ReturnType<typeof createPreparationClient> | undefined;
let fallback:
  | Promise<
      ReturnType<
        typeof import('./preparation-engine.js').createPreparationEngine
      >
    >
  | undefined;
/** Code/handshake only: no archive or city data is requested until a real job. */
export function warmPreparationWorker() {
  getClient();
}
function getClient() {
  if (cityPreparationSettings.enabled && typeof Worker !== 'undefined') {
    if (client?.isClosed()) client = undefined;
    try {
      if (!client) {
        const worker = new Worker(new URL(workerUrl, location.origin), {
          type: 'module',
          name: 'city-preparation',
        });
        if (
          ![
            'postMessage',
            'addEventListener',
            'removeEventListener',
            'terminate',
          ].every((name) => typeof worker[name as keyof Worker] === 'function')
        )
          throw Error('Incomplete visual Worker API');
        client = createPreparationClient(
          worker,
          cityPreparationSettings.maxQueuedJobs,
          cityPreparationSettings.maxRetainedBytes,
          cityPreparationSettings.maxJobMilliseconds,
        );
      }
      workerDenied = false;
      return client;
    } catch {
      workerDenied = true;
    }
  }
  return undefined;
}
export function runPreparation(
  key: string,
  job: PreparationJob,
): Promise<unknown> {
  const active = getClient();
  if (active) return active.request(key, job);
  // Explicit degraded mode: yield between requests; the synchronous legacy composer
  // cannot be preempted without changing its algorithm. Never label this off-thread.
  fallback ??= import('./preparation-engine.js').then(
    ({ createPreparationEngine }) =>
      createPreparationEngine({
        baseUrl: import.meta.env.BASE_URL,
        revisions: import.meta.env.PUBLIC_LAYER_REVISIONS,
        fetchArchive: (url) => fetch(url),
      }),
  );
  return new Promise<void>((resolve) => setTimeout(resolve, 0)).then(async () =>
    (await fallback!).run(job),
  );
}
export const preparationExecution = () =>
  !cityPreparationSettings.enabled ||
  typeof Worker === 'undefined' ||
  workerDenied
    ? 'cooperative-fallback'
    : 'visual-worker';

export const preparationMetrics = () => client?.metrics();
