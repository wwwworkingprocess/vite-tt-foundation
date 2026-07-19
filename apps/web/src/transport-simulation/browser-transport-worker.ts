import type { TransportWorkerLike } from './worker-transport-client.js';

export function createBrowserTransportWorker(): TransportWorkerLike {
  return new Worker(new URL('./transport.worker.ts', import.meta.url), {
    type: 'module',
    name: 'transport-simulation',
  });
}

export const isBrowserTransportWorkerAvailable = () =>
  typeof Worker !== 'undefined';
