import {
  parseFoundationAppliedCommandResult,
  parseFoundationFullBaseline,
  parseFoundationProtocolError,
  parseFoundationRejectedCommandResult,
  parseFoundationRenderSnapshot,
  parseFoundationStateUpdate,
  parseFoundationSynchronizationResponse,
  parseGameId,
  parseTimelineId,
  foundationProtocolErrorSchema,
  type FoundationClientLifecycle,
  type FoundationCommandResult,
  type FoundationRenderSnapshot,
  type FoundationSimulationClient,
  type FoundationStateUpdate,
  type FoundationSynchronizationResponse,
} from '@torrevieja-tycoon/protocol';
import { parseSimulationTick } from '@torrevieja-tycoon/simulation';

import { parseWorkerResponse } from './worker-wire.js';

type WorkerEventType = 'message' | 'error' | 'messageerror';
type WorkerListener = (event: { readonly data?: unknown }) => void;

export interface FoundationWorkerLike {
  postMessage(message: unknown): void;
  addEventListener(type: WorkerEventType, listener: WorkerListener): void;
  removeEventListener(type: WorkerEventType, listener: WorkerListener): void;
  terminate(): void;
}

interface PendingOperation {
  readonly operation: 'initialize' | 'send-command' | 'synchronize' | 'close';
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
}

export function createWorkerFoundationClient(input: {
  readonly workerFactory: () => FoundationWorkerLike;
}): FoundationSimulationClient {
  let lifecycle: FoundationClientLifecycle = Object.freeze({ state: 'idle' });
  let worker: FoundationWorkerLike | undefined;
  let nextRequestId = 1;
  let terminated = false;
  const pending = new Map<number, PendingOperation>();
  const lifecycleListeners = new Set<{
    readonly listener: (value: FoundationClientLifecycle) => void;
  }>();
  const reliableListeners = new Set<{
    readonly listener: (value: FoundationStateUpdate) => void;
  }>();
  const renderListeners = new Set<{
    readonly listener: (value: FoundationRenderSnapshot) => void;
  }>();

  function publishLifecycle(next: FoundationClientLifecycle): void {
    lifecycle = Object.freeze(next);
    for (const registration of [...lifecycleListeners]) {
      try {
        registration.listener(lifecycle);
      } catch {
        /* isolate listeners */
      }
    }
  }

  function publish<T>(
    listeners: ReadonlySet<{ readonly listener: (value: T) => void }>,
    value: T,
  ): void {
    for (const registration of [...listeners]) {
      try {
        registration.listener(value);
      } catch {
        /* isolate listeners */
      }
    }
  }

  function freezeCommandResult(value: unknown): FoundationCommandResult {
    if (foundationProtocolErrorSchema.safeParse(value).success)
      return Object.freeze(parseFoundationProtocolError(value));
    try {
      const result = parseFoundationRejectedCommandResult(value);
      Object.freeze(result.rejection);
      return Object.freeze(result);
    } catch {
      return Object.freeze(parseFoundationAppliedCommandResult(value));
    }
  }

  function freezeSynchronization(
    value: unknown,
  ): FoundationSynchronizationResponse {
    const response = parseFoundationSynchronizationResponse(value);
    if (response.kind === 'foundation-synchronization-identity-mismatch')
      return Object.freeze(response);
    if (response.mode === 'full') {
      const baseline = parseFoundationFullBaseline(response.baseline);
      Object.freeze(baseline.readModel);
      Object.freeze(baseline);
      return Object.freeze({ ...response, baseline });
    }
    const updates = response.updates.map((update) =>
      Object.freeze(parseFoundationStateUpdate(update)),
    );
    Object.freeze(updates);
    return Object.freeze({ ...response, updates });
  }

  function rejectAll(error: Error): void {
    for (const operation of pending.values()) operation.reject(error);
    pending.clear();
  }

  function cleanupWorker(): void {
    if (worker === undefined || terminated) return;
    worker.removeEventListener('message', onMessage);
    worker.removeEventListener('error', onError);
    worker.removeEventListener('messageerror', onMessageError);
    worker.terminate();
    terminated = true;
  }

  function fail(
    code: Extract<FoundationClientLifecycle, { state: 'failed' }>['code'],
    message: string,
  ): void {
    const error = new Error(message);
    rejectAll(error);
    publishLifecycle({ state: 'failed', code, message });
    cleanupWorker();
  }

  function onMessage(event: { readonly data?: unknown }): void {
    let message;
    try {
      message = parseWorkerResponse(event.data);
    } catch {
      fail('invalid-worker-message', 'Worker returned an invalid message.');
      return;
    }
    if (message.kind === 'worker-reliable-update') {
      const update = Object.freeze(
        parseFoundationStateUpdate(structuredClone(message.update)),
      );
      publish(reliableListeners, update);
      return;
    }
    if (message.kind === 'worker-render-snapshot') {
      const snapshot = Object.freeze(
        parseFoundationRenderSnapshot(structuredClone(message.snapshot)),
      );
      publish(renderListeners, snapshot);
      return;
    }
    if (message.kind === 'worker-failure') {
      if (message.requestId !== undefined) {
        const operation = pending.get(message.requestId);
        if (operation?.operation === 'initialize') {
          fail('worker-startup-failed', message.message);
        } else {
          operation?.reject(new Error(message.message));
          pending.delete(message.requestId);
        }
      } else fail('invalid-worker-message', message.message);
      return;
    }
    const operation = pending.get(message.requestId);
    if (operation === undefined) return;
    try {
      let result: unknown;
      if (
        operation.operation === 'initialize' ||
        operation.operation === 'close'
      ) {
        if (message.result !== null) throw new Error('Expected a null result.');
        result = null;
      } else if (operation.operation === 'send-command') {
        result = freezeCommandResult(message.result);
      } else {
        result = freezeSynchronization(message.result);
      }
      pending.delete(message.requestId);
      operation.resolve(result);
    } catch {
      fail(
        'invalid-worker-message',
        'Worker returned a result for the wrong operation.',
      );
    }
  }

  const onError = () => fail('worker-crashed', 'Worker crashed.');
  const onMessageError = () =>
    fail('message-error', 'Worker message could not be decoded.');

  function request(
    operation: PendingOperation['operation'],
    payload?: unknown,
  ): Promise<unknown> {
    if (worker === undefined)
      return Promise.reject(new Error('Worker is unavailable.'));
    const requestId = nextRequestId++;
    const promise = new Promise<unknown>((resolve, reject) =>
      pending.set(requestId, { operation, resolve, reject }),
    );
    try {
      worker.postMessage(
        payload === undefined
          ? { kind: 'worker-request', requestId, operation }
          : { kind: 'worker-request', requestId, operation, payload },
      );
    } catch (error) {
      const failure =
        error instanceof Error
          ? error
          : new Error('Worker request could not be posted.');
      pending.get(requestId)?.reject(failure);
      pending.delete(requestId);
      return promise;
    }
    return promise;
  }

  function requireReady(): void {
    if (lifecycle.state !== 'ready')
      throw new Error('Foundation client is not ready.');
  }

  function isConnecting(): boolean {
    return lifecycle.state === 'connecting';
  }

  function subscribe<T>(
    listeners: Set<{ readonly listener: (value: T) => void }>,
    listener: (value: T) => void,
  ): () => void {
    if (lifecycle.state === 'closed')
      throw new Error('Foundation client is closed.');
    const registration = Object.freeze({ listener });
    listeners.add(registration);
    let active = true;
    return () => {
      if (active) {
        active = false;
        listeners.delete(registration);
      }
    };
  }

  const client: FoundationSimulationClient = {
    async connect(connectRequest) {
      if (lifecycle.state !== 'idle')
        throw new Error('Foundation client can connect only from idle.');
      const gameId = parseGameId(connectRequest.gameId);
      const timelineId = parseTimelineId(connectRequest.timelineId);
      const initialSimulationTick = parseSimulationTick(
        connectRequest.initialSimulationTick,
      );
      publishLifecycle({ state: 'connecting' });
      try {
        worker = input.workerFactory();
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        worker.addEventListener('messageerror', onMessageError);
      } catch {
        fail('worker-startup-failed', 'Worker could not be started.');
        throw new Error('Worker could not be started.');
      }
      try {
        await request('initialize', {
          gameId,
          timelineId,
          initialSimulationTick,
        });
      } catch (error) {
        if (isConnecting())
          fail(
            'worker-startup-failed',
            error instanceof Error
              ? error.message
              : 'Worker initialization failed.',
          );
        throw error;
      }
      publishLifecycle({ state: 'ready', gameId, timelineId });
    },
    async sendCommand(envelope) {
      requireReady();
      return (await request(
        'send-command',
        envelope,
      )) as FoundationCommandResult;
    },
    async synchronize(syncRequest) {
      requireReady();
      return (await request(
        'synchronize',
        syncRequest,
      )) as FoundationSynchronizationResponse;
    },
    subscribeReliableUpdates: (listener) =>
      subscribe(reliableListeners, listener),
    subscribeRenderSnapshots: (listener) =>
      subscribe(renderListeners, listener),
    getLifecycle: () => lifecycle,
    subscribeLifecycle: (listener) => subscribe(lifecycleListeners, listener),
    close() {
      if (lifecycle.state === 'closed') return Promise.resolve();
      const closing = request('close');
      void closing.catch(() => undefined);
      rejectAll(new Error('Foundation client closed.'));
      cleanupWorker();
      reliableListeners.clear();
      renderListeners.clear();
      publishLifecycle({ state: 'closed' });
      lifecycleListeners.clear();
      return Promise.resolve();
    },
  };
  return Object.freeze(client);
}
