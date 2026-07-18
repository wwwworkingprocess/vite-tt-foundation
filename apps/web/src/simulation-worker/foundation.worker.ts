/// <reference lib="webworker" />

import { startFoundationWorkerRuntime } from './worker-runtime.js';

// The web app program includes DOM and WebWorker libs together; this entry is
// loaded only by Vite as a dedicated Worker, where globalThis has this shape.
const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
const listenerMap = new Map<
  (event: { readonly data: unknown }) => void,
  (event: MessageEvent<unknown>) => void
>();

startFoundationWorkerRuntime({
  postMessage(message) {
    scope.postMessage(message);
  },
  addEventListener(_type, listener) {
    const wrapped = (event: MessageEvent<unknown>) =>
      listener({ data: event.data });
    listenerMap.set(listener, wrapped);
    scope.addEventListener('message', wrapped);
  },
  removeEventListener(_type, listener) {
    const wrapped = listenerMap.get(listener);
    if (wrapped !== undefined) scope.removeEventListener('message', wrapped);
    listenerMap.delete(listener);
  },
});
