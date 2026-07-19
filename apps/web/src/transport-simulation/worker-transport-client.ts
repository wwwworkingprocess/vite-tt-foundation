import {
  advanceTransportTicks,
  createScenarioCoordinate,
  createTransportSimulationState,
  parseTickAdvancement,
  restoreTransportSimulationState,
  type TransportSimulationState,
} from '@torrevieja-tycoon/simulation';
import {
  parseFoundationHostMessage,
  parseFoundationRenderSnapshot,
  parseFoundationStateUpdate,
  parseFoundationSynchronizationRequest,
  type FoundationCommandEnvelope,
  type FoundationCommandResult,
  type FoundationRenderSnapshot,
  type FoundationStateUpdate,
} from '@torrevieja-tycoon/protocol';
import {
  createDirectTransportSimulationClient,
  type TransportClientConnectRequest,
  type TransportClientLifecycle,
  type TransportSimulationClient,
  type TransportSnapshotExport,
  type TransportSynchronizationResponse,
} from './transport-client.js';

type Operation =
  'connect' | 'send-command' | 'synchronize' | 'export-snapshot' | 'close';
interface RequestMessage {
  readonly kind: 'transport-worker-request';
  readonly contractVersion: 1;
  readonly requestId: number;
  readonly operation: Operation;
  readonly payload: unknown;
}
type ResponseMessage =
  | Readonly<{
      kind: 'transport-worker-result';
      contractVersion: 1;
      requestId: number;
      operation: Operation;
      payload: unknown;
    }>
  | Readonly<{
      kind: 'transport-worker-failure';
      contractVersion: 1;
      requestId: number;
      operation: Operation;
      message: string;
    }>
  | Readonly<{
      kind: 'transport-worker-publication';
      contractVersion: 1;
      channel: 'reliable' | 'render';
      payload: unknown;
    }>;

export interface TransportWorkerEndpoint {
  postMessage(message: ResponseMessage): void;
  addEventListener(
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ): void;
  removeEventListener(
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ): void;
}
export interface TransportWorkerLike {
  postMessage(message: RequestMessage): void;
  addEventListener(
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ): void;
  removeEventListener(
    type: 'message',
    listener: (event: { data: unknown }) => void,
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

export function startTransportWorkerRuntime(endpoint: TransportWorkerEndpoint) {
  let client: TransportSimulationClient | undefined;
  let closed = false;
  const cleanups: Array<() => void> = [];
  const shutdown = async () => {
    if (closed) return;
    closed = true;
    endpoint.removeEventListener('message', onMessage);
    for (const cleanup of cleanups.splice(0)) cleanup();
    await client?.close();
    client = undefined;
  };
  const onMessage = (event: { data: unknown }) => {
    if (closed) return;
    const request = event.data as Partial<RequestMessage>;
    if (
      request.kind !== 'transport-worker-request' ||
      request.contractVersion !== 1 ||
      typeof request.requestId !== 'number' ||
      typeof request.operation !== 'string'
    )
      return;
    const requestId = request.requestId;
    const operation = request.operation;
    void (async () => {
      try {
        let payload: unknown = null;
        if (request.operation === 'connect') {
          if (client) throw new Error('Transport Worker is already connected.');
          client = createDirectTransportSimulationClient();
          cleanups.push(
            client.subscribeReliableUpdates((update) =>
              endpoint.postMessage({
                kind: 'transport-worker-publication',
                contractVersion: 1,
                channel: 'reliable',
                payload: update,
              }),
            ),
            client.subscribeRenderSnapshots((snapshot) =>
              endpoint.postMessage({
                kind: 'transport-worker-publication',
                contractVersion: 1,
                channel: 'render',
                payload: snapshot,
              }),
            ),
          );
          await client.connect(
            request.payload as TransportClientConnectRequest,
          );
        } else if (request.operation === 'send-command') {
          if (!client) throw new Error('Transport Worker is not connected.');
          payload = await client.sendCommand(
            request.payload as FoundationCommandEnvelope,
          );
        } else if (request.operation === 'synchronize') {
          if (!client) throw new Error('Transport Worker is not connected.');
          payload = await client.synchronize(
            parseFoundationSynchronizationRequest(request.payload),
          );
        } else if (request.operation === 'export-snapshot') {
          if (!client) throw new Error('Transport Worker is not connected.');
          payload = await client.exportSnapshot();
        } else if (request.operation === 'close') {
          try {
            endpoint.postMessage({
              kind: 'transport-worker-result',
              contractVersion: 1,
              requestId,
              operation: 'close',
              payload: null,
            });
          } finally {
            await shutdown();
          }
          return;
        } else throw new Error('Unsupported Transport Worker operation.');
        endpoint.postMessage({
          kind: 'transport-worker-result',
          contractVersion: 1,
          requestId,
          operation,
          payload,
        });
      } catch (error) {
        if (!closed)
          endpoint.postMessage({
            kind: 'transport-worker-failure',
            contractVersion: 1,
            requestId,
            operation,
            message: errorMessage(error),
          });
      }
    })();
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
  const reliable = new Map<number, (update: FoundationStateUpdate) => void>();
  const render = new Map<
    number,
    (snapshot: FoundationRenderSnapshot) => void
  >();
  const lifecycleListeners = new Map<
    number,
    (state: TransportClientLifecycle) => void
  >();
  let registrationSequence = 0;
  const publishLifecycle = (next: TransportClientLifecycle) => {
    lifecycle = freeze(next);
    for (const listener of [...lifecycleListeners.values()])
      try {
        listener(lifecycle);
      } catch {
        /* isolated */
      }
  };
  const post = (operation: Operation, payload: unknown) => {
    if (!worker || (closed && operation !== 'close'))
      return Promise.reject(new Error('Transport Worker client is closed.'));
    const requestId = ++requestSequence;
    return new Promise<unknown>((resolve, reject) => {
      pending.set(requestId, { operation, resolve, reject });
      try {
        worker!.postMessage({
          kind: 'transport-worker-request',
          contractVersion: 1,
          requestId,
          operation,
          payload,
        });
      } catch (error) {
        pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(errorMessage(error)));
      }
    });
  };
  const onMessage = (event: { data: unknown }) => {
    const message = event.data as Partial<ResponseMessage>;
    if (message.contractVersion !== 1) return;
    if (message.kind === 'transport-worker-publication') {
      if (closed) return;
      if (message.channel === 'reliable') {
        const update = freeze(parseFoundationStateUpdate(message.payload));
        if (authority && update.simulationTick >= authority.tick)
          authority = advanceTransportTicks(
            authority,
            parseTickAdvancement(update.simulationTick - authority.tick),
          );
        for (const listener of [...reliable.values()])
          try {
            listener(update);
          } catch {
            /* isolated */
          }
      } else {
        const snapshot = freeze(parseFoundationRenderSnapshot(message.payload));
        for (const listener of [...render.values()])
          try {
            listener(snapshot);
          } catch {
            /* isolated */
          }
      }
      return;
    }
    if (
      message.kind !== 'transport-worker-result' &&
      message.kind !== 'transport-worker-failure'
    )
      return;
    const requestId = message.requestId;
    if (typeof requestId !== 'number') return;
    const entry = pending.get(requestId);
    if (!entry || entry.operation !== message.operation) return;
    pending.delete(requestId);
    if (message.kind === 'transport-worker-failure')
      entry.reject(new Error(message.message));
    else if ('payload' in message)
      entry.resolve(freeze(structuredClone(message.payload)));
  };
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
      if (worker || closed)
        throw new Error('Transport Worker client cannot connect.');
      if (
        request.kind !== 'transport-client-connect' ||
        request.contractVersion !== 1 ||
        (request.mode !== 'new' && request.mode !== 'restore')
      )
        throw new Error('Unsupported transport client connect request.');
      publishLifecycle({ state: 'connecting' });
      worker = input.workerFactory();
      worker.addEventListener('message', onMessage);
      authority =
        request.mode === 'new'
          ? createTransportSimulationState(
              request.scenario,
              request.initialSimulationTick,
            )
          : restoreTransportSimulationState(request.snapshot, request.scenario);
      try {
        await post('connect', structuredClone(request));
        publishLifecycle({
          state: 'ready',
          gameId: request.gameId,
          timelineId: request.timelineId,
          scenario: createScenarioCoordinate(authority.scenario),
        });
      } catch (error) {
        worker.removeEventListener('message', onMessage);
        worker.terminate();
        worker = undefined;
        authority = undefined;
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
      return (await post(
        'synchronize',
        request,
      )) as TransportSynchronizationResponse;
    },
    async exportSnapshot() {
      if (!authority) throw new Error('Transport client is not ready.');
      return (await post('export-snapshot', null)) as TransportSnapshotExport;
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
        try {
          if (worker) await post('close', null);
        } finally {
          for (const entry of pending.values())
            entry.reject(new Error('Transport Worker client closed.'));
          pending.clear();
          worker?.removeEventListener('message', onMessage);
          worker?.terminate();
          worker = undefined;
          authority = undefined;
          reliable.clear();
          render.clear();
          publishLifecycle({ state: 'closed' });
          lifecycleListeners.clear();
        }
      })();
      return closePromise;
    },
  };
  return Object.freeze(client);
}
