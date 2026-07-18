import {
  parseGameId,
  parseTimelineId,
  type FoundationRenderSnapshot,
  type FoundationStateUpdate,
} from '@torrevieja-tycoon/protocol';
import {
  createFoundationState,
  parseSimulationTick,
} from '@torrevieja-tycoon/simulation';

import {
  createInMemorySimulationHost,
  type InMemorySimulationHost,
} from '../simulation-host/in-memory-host.js';
import { parseWorkerRequest, type WorkerResponse } from './worker-wire.js';

export interface WorkerRuntimeEndpoint {
  postMessage(message: WorkerResponse): void;
  addEventListener(
    type: 'message',
    listener: (event: { readonly data: unknown }) => void,
  ): void;
  removeEventListener(
    type: 'message',
    listener: (event: { readonly data: unknown }) => void,
  ): void;
}

export function startFoundationWorkerRuntime(
  endpoint: WorkerRuntimeEndpoint,
): () => void {
  let host: InMemorySimulationHost | undefined;
  let closed = false;
  const cleanups: Array<() => void> = [];

  function shutdown(): void {
    if (closed) return;
    closed = true;
    endpoint.removeEventListener('message', listener);
    for (const cleanup of cleanups.splice(0)) cleanup();
    host = undefined;
  }

  const listener = (event: { readonly data: unknown }) => {
    if (closed) return;
    let request;
    try {
      request = parseWorkerRequest(event.data);
    } catch {
      endpoint.postMessage({
        kind: 'worker-failure',
        code: 'invalid-request',
        message: 'Invalid Worker request.',
      });
      return;
    }
    void (async () => {
      try {
        if (request.operation === 'initialize') {
          if (host !== undefined)
            throw new Error('Worker host is already initialized.');
          host = createInMemorySimulationHost({
            gameId: parseGameId(request.payload.gameId),
            timelineId: parseTimelineId(request.payload.timelineId),
            initialState: createFoundationState(
              parseSimulationTick(request.payload.initialSimulationTick),
            ),
          });
          cleanups.push(
            host.subscribeReliableUpdates((update: FoundationStateUpdate) =>
              endpoint.postMessage({ kind: 'worker-reliable-update', update }),
            ),
            host.subscribeRenderSnapshots(
              (snapshot: FoundationRenderSnapshot) =>
                endpoint.postMessage({
                  kind: 'worker-render-snapshot',
                  snapshot,
                }),
            ),
          );
          endpoint.postMessage({
            kind: 'worker-operation-result',
            requestId: request.requestId,
            status: 'success',
            result: null,
          });
          return;
        }
        if (host === undefined)
          throw new Error('Worker host is not initialized.');
        if (request.operation === 'send-command') {
          const result = await host.sendCommand(request.payload);
          if (closed) return;
          endpoint.postMessage({
            kind: 'worker-operation-result',
            requestId: request.requestId,
            status: 'success',
            result,
          });
        } else if (request.operation === 'synchronize') {
          endpoint.postMessage({
            kind: 'worker-operation-result',
            requestId: request.requestId,
            status: 'success',
            result: host.synchronize(request.payload),
          });
        } else {
          try {
            endpoint.postMessage({
              kind: 'worker-operation-result',
              requestId: request.requestId,
              status: 'success',
              result: null,
            });
          } catch {
            // Closing is terminal even when its acknowledgement cannot cross.
          } finally {
            shutdown();
          }
        }
      } catch (error) {
        endpoint.postMessage({
          kind: 'worker-failure',
          requestId: request.requestId,
          code: 'operation-failed',
          message:
            error instanceof Error ? error.message : 'Worker operation failed.',
        });
      }
    })();
  };
  endpoint.addEventListener('message', listener);
  return () => {
    shutdown();
  };
}
