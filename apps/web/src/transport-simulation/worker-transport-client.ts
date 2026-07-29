import {
  createScenarioCoordinate,
  createTransportSimulationState,
  parseSimulationTick,
  restoreTransportSimulationState,
  type TransportSimulationState,
} from '@torrevieja-tycoon/simulation';
import {
  parseFoundationHostMessage,
  parseFoundationSynchronizationRequest,
  type FoundationCommandResult,
} from '@torrevieja-tycoon/protocol';
import {
  transportClientContractVersion,
  type TransportCommandEnvelope,
  type TransportClientConnectRequest,
  type TransportClientLifecycle,
  type TransportSimulationClient,
  type TransportRenderSnapshot,
  type TransportStateUpdate,
} from './transport-client.js';
import {
  parseTransportWorkerRequest,
  parseTransportWorkerResponse,
  parseTransportSnapshotExportResult,
  parseTransportSynchronizationResult,
  type TransportWorkerRequest,
  type TransportWorkerResponse,
} from './transport-worker-wire.js';

type Operation =
  'connect' | 'send-command' | 'synchronize' | 'export-snapshot' | 'close';

export interface TransportWorkerEndpoint {
  postMessage(message: TransportWorkerResponse): void;
  addEventListener(
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ): void;
  removeEventListener(
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ): void;
  reportError?(error: unknown): void;
}
export type TransportWorkerEvent = Readonly<{
  data: unknown;
  error?: unknown;
  message?: string;
}>;
export interface TransportWorkerLike {
  postMessage(message: TransportWorkerRequest): void;
  addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: (event: TransportWorkerEvent) => void,
  ): void;
  removeEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: (event: TransportWorkerEvent) => void,
  ): void;
  terminate(): void;
}

const freeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
};
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Transport Worker operation failed.';

export function startTransportWorkerRuntime(
  endpoint: TransportWorkerEndpoint,
  createClient: () => TransportSimulationClient,
) {
  let client: TransportSimulationClient | undefined;
  let closed = false;
  let operationQueue = Promise.resolve();
  const cleanups: Array<() => void> = [];
  const removeSubscriptions = () => {
    const errors: unknown[] = [];
    for (const cleanup of cleanups.splice(0))
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    return errors;
  };
  const shutdown = async () => {
    if (closed) return;
    closed = true;
    endpoint.removeEventListener('message', onMessage);
    const errors = removeSubscriptions();
    try {
      await client?.close();
    } catch (error) {
      errors.push(error);
    } finally {
      client = undefined;
    }
    if (errors.length)
      throw new AggregateError(
        errors,
        'Transport Worker runtime cleanup failed.',
      );
  };
  const onMessage = (event: { data: unknown }) => {
    if (closed) return;
    let request: TransportWorkerRequest;
    try {
      request = parseTransportWorkerRequest(event.data);
    } catch {
      const raw = event.data as { requestId?: unknown };
      const validRequestId =
        typeof raw.requestId === 'number' &&
        Number.isSafeInteger(raw.requestId) &&
        raw.requestId > 0
          ? raw.requestId
          : undefined;
      try {
        endpoint.postMessage({
          kind: 'transport-worker-failure',
          contractVersion: 3,
          ...(validRequestId === undefined
            ? {}
            : { requestId: validRequestId }),
          message: 'Invalid Transport Worker request.',
        });
      } catch {
        operationQueue = operationQueue.then(shutdown, shutdown);
      }
      return;
    }
    const requestId = request.requestId;
    const operation = request.operation;
    operationQueue = operationQueue.then(async () => {
      try {
        let payload: unknown = null;
        if (request.operation === 'connect') {
          if (client) throw new Error('Transport Worker is already connected.');
          const next = createClient();
          client = next;
          try {
            cleanups.push(
              next.subscribeReliableUpdates((update) =>
                endpoint.postMessage({
                  kind: 'transport-worker-publication',
                  contractVersion: 3,
                  channel: 'reliable',
                  payload: update,
                }),
              ),
            );
            cleanups.push(
              next.subscribeRenderSnapshots((snapshot) =>
                endpoint.postMessage({
                  kind: 'transport-worker-publication',
                  contractVersion: 3,
                  channel: 'render',
                  payload: snapshot,
                }),
              ),
            );
            await next.connect(
              request.payload as TransportClientConnectRequest,
            );
          } catch (error) {
            const cleanupErrors = removeSubscriptions();
            try {
              await next.close();
            } catch (closeError) {
              cleanupErrors.push(closeError);
            } finally {
              client = undefined;
            }
            throw cleanupErrors.length
              ? new AggregateError(
                  [error, ...cleanupErrors],
                  errorMessage(error),
                )
              : error;
          }
        } else if (request.operation === 'send-command') {
          if (!client) throw new Error('Transport Worker is not connected.');
          payload = await client.sendCommand(
            request.payload as TransportCommandEnvelope,
          );
        } else if (request.operation === 'synchronize') {
          if (!client) throw new Error('Transport Worker is not connected.');
          payload = await client.synchronize(
            parseFoundationSynchronizationRequest(request.payload),
          );
        } else if (request.operation === 'export-snapshot') {
          if (!client) throw new Error('Transport Worker is not connected.');
          payload = await client.exportSnapshot();
        } else {
          let cleanupError: unknown;
          try {
            await shutdown();
          } catch (error) {
            cleanupError = error;
          }
          try {
            endpoint.postMessage(
              cleanupError === undefined
                ? {
                    kind: 'transport-worker-result',
                    contractVersion: 3,
                    requestId,
                    operation: 'close',
                    payload: null,
                  }
                : {
                    kind: 'transport-worker-failure',
                    contractVersion: 3,
                    requestId,
                    operation: 'close',
                    message: errorMessage(cleanupError),
                  },
            );
          } catch (postError) {
            endpoint.reportError?.(
              cleanupError === undefined
                ? postError
                : new AggregateError(
                    [cleanupError, postError],
                    'Transport Worker close reporting failed.',
                  ),
            );
          }
          return;
        }
        endpoint.postMessage({
          kind: 'transport-worker-result',
          contractVersion: 3,
          requestId,
          operation,
          payload,
        });
      } catch (error) {
        try {
          endpoint.postMessage({
            kind: 'transport-worker-failure',
            contractVersion: 3,
            requestId,
            operation,
            message: errorMessage(error),
          });
        } catch {
          await shutdown();
        }
      }
    });
  };
  endpoint.addEventListener('message', onMessage);
  return Object.freeze({ close: shutdown });
}

export function createWorkerTransportSimulationClient(input: {
  readonly workerFactory: () => TransportWorkerLike;
}): TransportSimulationClient {
  let worker: TransportWorkerLike | undefined;
  let requestSequence = 0;
  let authority: TransportSimulationState | undefined;
  let lifecycle: TransportClientLifecycle = freeze({ state: 'idle' });
  let closed = false;
  let closePromise: Promise<void> | undefined;
  const pending = new Map<
    number,
    {
      operation: Operation;
      resolve(value: unknown): void;
      reject(error: unknown): void;
    }
  >();
  const reliable = new Map<number, (update: TransportStateUpdate) => void>();
  const render = new Map<number, (snapshot: TransportRenderSnapshot) => void>();
  const lifecycleListeners = new Map<
    number,
    (state: TransportClientLifecycle) => void
  >();
  let registrationSequence = 0;
  let terminalFailurePublished = false;
  const publishLifecycle = (next: TransportClientLifecycle) => {
    lifecycle = freeze(next);
    for (const listener of [...lifecycleListeners.values()])
      try {
        listener(lifecycle);
      } catch {
        /* isolated */
      }
  };
  const workerError = (event: TransportWorkerEvent) =>
    event.error instanceof Error
      ? event.error
      : new Error(event.message ?? 'Transport Worker failed.');
  const cleanupWorker = (pendingError: Error) => {
    const errors: unknown[] = [];
    const current = worker;
    worker = undefined;
    if (current) {
      for (const [type, listener] of [
        ['message', onMessage],
        ['error', onError],
        ['messageerror', onMessageError],
      ] as const)
        try {
          current.removeEventListener(type, listener);
        } catch (error) {
          errors.push(error);
        }
      try {
        current.terminate();
      } catch (error) {
        errors.push(error);
      }
    }
    for (const entry of pending.values()) entry.reject(pendingError);
    pending.clear();
    authority = undefined;
    reliable.clear();
    render.clear();
    return errors;
  };
  const failTerminal = (error: Error) => {
    closed = true;
    terminalFailurePublished = true;
    cleanupWorker(error);
    publishLifecycle({
      state: 'failed',
      code: 'invalid-worker-message',
      message: error.message,
    });
  };
  const post = (operation: Operation, payload: unknown) => {
    if (!worker || (closed && operation !== 'close'))
      return Promise.reject(new Error('Transport Worker client is closed.'));
    const requestId = ++requestSequence;
    return new Promise<unknown>((resolve, reject) => {
      pending.set(requestId, { operation, resolve, reject });
      try {
        worker!.postMessage(
          parseTransportWorkerRequest({
            kind: 'transport-worker-request',
            contractVersion: 3,
            requestId,
            operation,
            payload,
          }),
        );
      } catch (error) {
        pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(errorMessage(error)));
      }
    });
  };
  const onMessage = (event: { data: unknown }) => {
    let message: TransportWorkerResponse;
    try {
      message = parseTransportWorkerResponse(event.data);
    } catch {
      const error = new Error('Transport Worker returned an invalid message.');
      failTerminal(error);
      return;
    }
    if (message.kind === 'transport-worker-publication') {
      if (closed) return;
      if (message.channel === 'reliable') {
        const update = freeze(message.payload as TransportStateUpdate);
        if (authority && update.simulationTick >= authority.tick)
          authority = freeze({
            ...authority,
            tick: parseSimulationTick(update.simulationTick),
            fleet: update.fleet,
          });
        for (const listener of [...reliable.values()])
          try {
            listener(update);
          } catch {
            /* isolated */
          }
      } else {
        const snapshot = freeze(message.payload as TransportRenderSnapshot);
        for (const listener of [...render.values()])
          try {
            listener(snapshot);
          } catch {
            /* isolated */
          }
      }
      return;
    }
    const requestId = message.requestId;
    if (requestId === undefined) return;
    const entry = pending.get(requestId);
    if (!entry) return;
    if (entry.operation !== message.operation) {
      failTerminal(
        new Error('Transport Worker response operation did not match request.'),
      );
      return;
    }
    pending.delete(requestId);
    if (message.kind === 'transport-worker-failure')
      entry.reject(new Error(message.message));
    else entry.resolve(freeze(structuredClone(message.payload)));
  };
  const onError = (event: TransportWorkerEvent) => {
    const error = workerError(event);
    if (closed) {
      cleanupWorker(error);
      return;
    }
    failTerminal(error);
  };
  const onMessageError = (event: TransportWorkerEvent) => onError(event);
  const subscribe = <T>(
    map: Map<number, (value: T) => void>,
    listener: (value: T) => void,
  ) => {
    if (closed) throw new Error('Transport Worker client is closed.');
    const id = ++registrationSequence;
    map.set(id, listener);
    return () => map.delete(id);
  };
  const client: TransportSimulationClient = {
    async connect(request) {
      if (lifecycle.state !== 'idle' || worker || closed)
        throw new Error('Transport Worker client can connect only from idle.');
      if (
        request.kind !== 'transport-client-connect' ||
        request.contractVersion !== transportClientContractVersion ||
        (request.mode !== 'new' && request.mode !== 'restore')
      )
        throw new Error('Unsupported transport client connect request.');
      const nextAuthority =
        request.mode === 'new'
          ? createTransportSimulationState(
              request.scenario,
              request.initialSimulationTick,
            )
          : restoreTransportSimulationState(request.snapshot, request.scenario);
      publishLifecycle({ state: 'connecting' });
      try {
        worker = input.workerFactory();
        worker.addEventListener('error', onError);
        worker.addEventListener('messageerror', onMessageError);
        worker.addEventListener('message', onMessage);
        authority = nextAuthority;
        await post('connect', structuredClone(request));
        publishLifecycle({
          state: 'ready',
          gameId: request.gameId,
          timelineId: request.timelineId,
          scenario: createScenarioCoordinate(authority.scenario),
        });
      } catch (error) {
        cleanupWorker(
          error instanceof Error ? error : new Error(errorMessage(error)),
        );
        if (!terminalFailurePublished)
          publishLifecycle({
            state: 'failed',
            code: 'worker-startup-failed',
            message: errorMessage(error),
          });
        throw error;
      }
    },
    async sendCommand(command) {
      return parseFoundationHostMessage(
        await post('send-command', command),
      ) as FoundationCommandResult;
    },
    async synchronize(request) {
      if (!authority) throw new Error('Transport client is not ready.');
      return parseTransportSynchronizationResult(
        await post('synchronize', request),
      );
    },
    async exportSnapshot() {
      if (!authority) throw new Error('Transport client is not ready.');
      return parseTransportSnapshotExportResult(
        await post('export-snapshot', null),
      );
    },
    subscribeReliableUpdates: (listener) => subscribe(reliable, listener),
    subscribeRenderSnapshots: (listener) => subscribe(render, listener),
    getLifecycle: () => lifecycle,
    subscribeLifecycle: (listener) => subscribe(lifecycleListeners, listener),
    getAuthoritativeState() {
      if (!authority) throw new Error('Transport client is not ready.');
      return authority;
    },
    close() {
      if (closePromise) return closePromise;
      closed = true;
      closePromise = (async () => {
        let primaryError: unknown;
        try {
          if (worker) await post('close', null);
        } catch (error) {
          primaryError = error;
        }
        const cleanupErrors = cleanupWorker(
          new Error('Transport Worker client closed.'),
        );
        publishLifecycle({ state: 'closed' });
        lifecycleListeners.clear();
        if (primaryError !== undefined || cleanupErrors.length)
          throw new AggregateError(
            [
              ...(primaryError === undefined ? [] : [primaryError]),
              ...cleanupErrors,
            ],
            primaryError instanceof Error
              ? primaryError.message
              : 'Transport Worker client cleanup failed.',
          );
      })();
      return closePromise;
    },
  };
  return Object.freeze(client);
}
