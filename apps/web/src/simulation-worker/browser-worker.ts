import type { FoundationWorkerLike } from './worker-client.js';

export function createBrowserFoundationWorker(): FoundationWorkerLike {
  const worker = new Worker(
    new URL('./foundation.worker.ts', import.meta.url),
    {
      type: 'module',
      name: 'foundation-simulation',
    },
  );
  const listenerMap = new Map<
    string,
    Map<(event: { readonly data?: unknown }) => void, EventListener>
  >();

  return {
    postMessage(message) {
      worker.postMessage(message);
    },
    addEventListener(type, listener) {
      const wrapped: EventListener = (event) =>
        listener(event instanceof MessageEvent ? { data: event.data } : {});
      const listeners =
        listenerMap.get(type) ??
        new Map<(event: { readonly data?: unknown }) => void, EventListener>();
      listeners.set(listener, wrapped);
      listenerMap.set(type, listeners);
      worker.addEventListener(type, wrapped);
    },
    removeEventListener(type, listener) {
      const wrapped = listenerMap.get(type)?.get(listener);
      if (wrapped !== undefined) worker.removeEventListener(type, wrapped);
      listenerMap.get(type)?.delete(listener);
    },
    terminate() {
      worker.terminate();
      listenerMap.clear();
    },
  };
}
