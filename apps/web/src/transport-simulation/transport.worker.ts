/// <reference lib="webworker" />
import { startTransportWorkerRuntime } from './worker-transport-client.js';

const scope = self as unknown as DedicatedWorkerGlobalScope;
startTransportWorkerRuntime({
  postMessage: (message) => scope.postMessage(message),
  addEventListener: (_type, listener) =>
    scope.addEventListener(
      'message',
      listener as (event: MessageEvent) => void,
    ),
  removeEventListener: (_type, listener) =>
    scope.removeEventListener(
      'message',
      listener as (event: MessageEvent) => void,
    ),
  reportError: (error) => scope.reportError(error),
});
