import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import {
  createDirectTransportSimulationClient,
  type TransportStateUpdate,
} from './transport-client.js';
import {
  createWorkerTransportSimulationClient,
  startTransportWorkerRuntime,
  type TransportWorkerEndpoint,
  type TransportWorkerEvent,
  type TransportWorkerLike,
} from './worker-transport-client.js';

const fixture = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'transport-domain',
  'fixtures',
  'torrevieja-mini-v1',
);
const json = (name: string) =>
  JSON.parse(readFileSync(join(fixture, name), 'utf8')) as unknown;
const scenario = () =>
  parseScenarioPackage({
    manifest: json('scenario.json'),
    settlements: json('settlements.json'),
    stops: json('stops.json'),
    routes: json('routes.json'),
    presentation: json('presentation.json'),
    provenance: json('provenance.json'),
  });

describe('transport Worker boundary failures', () => {
  it('shuts down when invalid-request failure publication throws', async () => {
    let listener!: (event: { data: unknown }) => void;
    const remove = vi.fn();
    const runtime = startTransportWorkerRuntime(
      {
        postMessage() {
          throw new Error('failure post failed');
        },
        addEventListener: (_type, next) => {
          listener = next;
        },
        removeEventListener: remove,
      },
      createDirectTransportSimulationClient,
    );
    listener({ data: { requestId: 1, invalid: true } });
    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
    await expect(runtime.close()).resolves.toBeUndefined();
  });

  it('clears runtime authority after subscription and client cleanup errors', async () => {
    let listener!: (event: { data: unknown }) => void;
    const posted: unknown[] = [];
    const direct = createDirectTransportSimulationClient();
    const runtime = startTransportWorkerRuntime(
      {
        postMessage: (message) => posted.push(message),
        addEventListener: (_type, next) => {
          listener = next;
        },
        removeEventListener: vi.fn(),
      },
      () =>
        Object.freeze({
          ...direct,
          subscribeReliableUpdates: () => () => {
            throw new Error('unsubscribe failed');
          },
          close: async () => {
            await direct.close();
            throw new Error('client close failed');
          },
        }),
    );
    listener({
      data: {
        kind: 'transport-worker-request',
        contractVersion: 3,
        requestId: 1,
        operation: 'connect',
        payload: {
          kind: 'transport-client-connect',
          contractVersion: 3,
          mode: 'new',
          gameId: 'game',
          timelineId: 'timeline',
          initialSimulationTick: 0,
          scenario: scenario(),
        },
      },
    });
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    await expect(runtime.close()).rejects.toThrow('cleanup failed');
    await expect(runtime.close()).resolves.toBeUndefined();
  });

  it('finishes runtime shutdown when close acknowledgement posting throws', async () => {
    let listener!: (event: { data: unknown }) => void;
    let connected = false;
    const remove = vi.fn();
    const endpoint: TransportWorkerEndpoint = {
      postMessage(message) {
        if (
          message.kind === 'transport-worker-result' &&
          message.operation === 'connect'
        )
          connected = true;
        if (
          message.kind === 'transport-worker-result' &&
          message.operation === 'close'
        )
          throw new Error('close acknowledgement failed');
      },
      addEventListener: (_type, next) => {
        listener = next;
      },
      removeEventListener: remove,
    };
    const runtime = startTransportWorkerRuntime(
      endpoint,
      createDirectTransportSimulationClient,
    );
    listener({
      data: {
        kind: 'transport-worker-request',
        contractVersion: 3,
        requestId: 1,
        operation: 'connect',
        payload: {
          kind: 'transport-client-connect',
          contractVersion: 3,
          mode: 'new',
          gameId: 'game',
          timelineId: 'timeline',
          initialSimulationTick: 0,
          scenario: scenario(),
        },
      },
    });
    await vi.waitFor(() => expect(connected).toBe(true));
    listener({
      data: {
        kind: 'transport-worker-request',
        contractVersion: 3,
        requestId: 2,
        operation: 'close',
        payload: null,
      },
    });
    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
    await expect(runtime.close()).resolves.toBeUndefined();
  });

  it('cleans a failed runtime client and permits a later valid connect', async () => {
    const posted: unknown[] = [];
    let listener!: (event: { data: unknown }) => void;
    const endpoint: TransportWorkerEndpoint = {
      postMessage: (message) => posted.push(message),
      addEventListener: (_type, next) => {
        listener = next;
      },
      removeEventListener: vi.fn(),
    };
    const failed = createDirectTransportSimulationClient();
    const failedClose = vi.fn(() => failed.close());
    let sequence = 0;
    startTransportWorkerRuntime(endpoint, () => {
      if (++sequence === 1)
        return Object.freeze({
          ...failed,
          connect: async () => Promise.reject(new Error('connect failed')),
          close: failedClose,
        });
      return createDirectTransportSimulationClient();
    });
    const payload = {
      kind: 'transport-client-connect',
      contractVersion: 3,
      mode: 'new',
      gameId: 'game',
      timelineId: 'timeline',
      initialSimulationTick: 0,
      scenario: scenario(),
    };
    listener({
      data: {
        kind: 'transport-worker-request',
        contractVersion: 3,
        requestId: 1,
        operation: 'connect',
        payload,
      },
    });
    await vi.waitFor(() =>
      expect(posted).toContainEqual(
        expect.objectContaining({
          kind: 'transport-worker-failure',
          requestId: 1,
        }),
      ),
    );
    expect(failedClose).toHaveBeenCalledOnce();
    listener({
      data: {
        kind: 'transport-worker-request',
        contractVersion: 3,
        requestId: 2,
        operation: 'connect',
        payload: { ...payload, timelineId: 'timeline-2' },
      },
    });
    await vi.waitFor(() =>
      expect(posted).toContainEqual(
        expect.objectContaining({
          kind: 'transport-worker-result',
          requestId: 2,
        }),
      ),
    );
  });

  it('ignores malformed responses, rejects duplicate connect, and closes pending work', async () => {
    let listener!: (event: { data: unknown }) => void;
    const worker: TransportWorkerLike = {
      postMessage(message) {
        if (message.operation === 'connect' || message.operation === 'close')
          queueMicrotask(() =>
            listener({
              data: {
                kind: 'transport-worker-result',
                contractVersion: 3,
                requestId: message.requestId,
                operation: message.operation,
                payload: null,
              },
            }),
          );
      },
      addEventListener: (_type, next) => {
        listener = next;
      },
      removeEventListener: vi.fn(),
      terminate: vi.fn(),
    };
    const client = createWorkerTransportSimulationClient({
      workerFactory: () => worker,
    });
    await expect(client.sendCommand({} as never)).rejects.toThrow('closed');
    const request = {
      kind: 'transport-client-connect',
      contractVersion: 3,
      mode: 'new',
      gameId: 'game',
      timelineId: 'timeline',
      initialSimulationTick: 0,
      scenario: scenario(),
    } as never;
    await client.connect(request);
    await expect(client.connect(request)).rejects.toThrow('idle');
    listener({ data: { contractVersion: 3 } });
    listener({ data: { contractVersion: 3, kind: 'unknown' } });
    listener({ data: { contractVersion: 3, kind: 'transport-worker-result' } });
    listener({
      data: {
        contractVersion: 3,
        kind: 'transport-worker-result',
        requestId: 999,
        operation: 'send-command',
        payload: null,
      },
    });
    const pending = client.sendCommand({
      kind: 'foundation-command',
      gameId: 'game',
      timelineId: 'timeline',
      commandId: 'command',
      correlationId: 'correlation',
      clientId: 'client',
      sessionId: 'session',
      command: { type: 'foundation.advance-ticks', count: 1 },
    } as never);
    const closing = client.close();
    await expect(pending).rejects.toThrow('closed');
    await closing;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('rejects operations before connect and makes runtime close terminal', async () => {
    let listener!: (event: { data: unknown }) => void;
    const posted: unknown[] = [];
    const endpoint: TransportWorkerEndpoint = {
      postMessage: (message) => posted.push(message),
      addEventListener: (_type, next) => {
        listener = next;
      },
      removeEventListener: vi.fn(),
    };
    startTransportWorkerRuntime(
      endpoint,
      createDirectTransportSimulationClient,
    );
    listener({ data: { nope: true } });
    listener({
      data: {
        kind: 'transport-worker-request',
        contractVersion: 3,
        requestId: 1,
        operation: 'send-command',
        payload: {},
      },
    });
    await vi.waitFor(() =>
      expect(posted).toContainEqual(
        expect.objectContaining({
          kind: 'transport-worker-failure',
          requestId: 1,
        }),
      ),
    );
    for (const [requestId, operation, payload] of [
      [2, 'synchronize', {}],
      [3, 'export-snapshot', null],
    ] as const) {
      listener({
        data: {
          kind: 'transport-worker-request',
          contractVersion: 3,
          requestId,
          operation,
          payload,
        },
      });
      await vi.waitFor(() =>
        expect(posted).toContainEqual(
          expect.objectContaining({
            kind: 'transport-worker-failure',
            requestId,
          }),
        ),
      );
    }
    const connectPayload = {
      kind: 'transport-client-connect',
      contractVersion: 3,
      mode: 'new',
      gameId: 'game',
      timelineId: 'runtime-timeline',
      initialSimulationTick: 0,
      scenario: scenario(),
    };
    listener({
      data: {
        kind: 'transport-worker-request',
        contractVersion: 3,
        requestId: 4,
        operation: 'connect',
        payload: connectPayload,
      },
    });
    await vi.waitFor(() =>
      expect(posted).toContainEqual(
        expect.objectContaining({
          kind: 'transport-worker-result',
          requestId: 4,
        }),
      ),
    );
    listener({
      data: {
        kind: 'transport-worker-request',
        contractVersion: 3,
        requestId: 5,
        operation: 'connect',
        payload: connectPayload,
      },
    });
    await vi.waitFor(() =>
      expect(posted).toContainEqual(
        expect.objectContaining({
          kind: 'transport-worker-failure',
          requestId: 5,
        }),
      ),
    );
    listener({
      data: {
        kind: 'transport-worker-request',
        contractVersion: 3,
        requestId: 6,
        operation: 'unknown',
        payload: null,
      },
    });
    await vi.waitFor(() =>
      expect(posted).toContainEqual(
        expect.objectContaining({
          kind: 'transport-worker-failure',
          requestId: 6,
        }),
      ),
    );
    listener({
      data: {
        kind: 'transport-worker-request',
        contractVersion: 3,
        requestId: 7,
        operation: 'close',
        payload: null,
      },
    });
    await vi.waitFor(() =>
      expect(posted).toContainEqual(
        expect.objectContaining({
          kind: 'transport-worker-result',
          requestId: 7,
          payload: null,
        }),
      ),
    );
    const count = posted.length;
    listener({
      data: {
        kind: 'transport-worker-request',
        contractVersion: 3,
        requestId: 8,
        operation: 'export-snapshot',
        payload: null,
      },
    });
    expect(posted).toHaveLength(count);
    expect(endpoint.removeEventListener).toHaveBeenCalledOnce();
  });

  it('cleans up initialization failure and postMessage exceptions', async () => {
    const workers: Array<{
      listener?: (event: { data: unknown }) => void;
      terminate: ReturnType<typeof vi.fn<() => void>>;
      failPost: boolean;
    }> = [];
    const workerFactory = (): TransportWorkerLike => {
      const state = { terminate: vi.fn(), failPost: workers.length === 1 } as {
        listener?: (event: { data: unknown }) => void;
        terminate: ReturnType<typeof vi.fn<() => void>>;
        failPost: boolean;
      };
      workers.push(state);
      return {
        postMessage(message) {
          if (state.failPost) throw 'post failed';
          queueMicrotask(() =>
            state.listener?.({
              data: {
                kind: 'transport-worker-failure',
                contractVersion: 3,
                requestId: message.requestId,
                operation: message.operation,
                message: 'initialization failed',
              },
            }),
          );
        },
        addEventListener: (_type, next) => {
          state.listener = next;
        },
        removeEventListener: (_type, next) => {
          if (state.listener === next) delete state.listener;
        },
        terminate() {
          state.terminate();
        },
      };
    };
    const request = {
      kind: 'transport-client-connect',
      contractVersion: 3,
      mode: 'new',
      gameId: 'game',
      timelineId: 'timeline',
      initialSimulationTick: 0,
      scenario: scenario(),
    } as never;
    const first = createWorkerTransportSimulationClient({ workerFactory });
    await expect(first.connect(request)).rejects.toThrow(
      'initialization failed',
    );
    expect(workers[0]!.terminate).toHaveBeenCalledOnce();

    const second = createWorkerTransportSimulationClient({ workerFactory });
    await expect(second.connect(request)).rejects.toThrow(
      'Transport Worker operation failed',
    );
    expect(workers[1]!.terminate).toHaveBeenCalledOnce();
    await second.close();
    expect(() => second.subscribeReliableUpdates(() => undefined)).toThrow(
      'closed',
    );
  });

  it.each([
    'missing-operation',
    'wrong-operation',
    'malformed-payload',
  ] as const)(
    'fails terminally for a correlated %s response',
    async (variant) => {
      let listener!: (event: { data: unknown }) => void;
      const terminate = vi.fn();
      const remove = vi.fn();
      const worker: TransportWorkerLike = {
        postMessage(message) {
          if (message.operation === 'connect')
            queueMicrotask(() =>
              listener({
                data: {
                  kind: 'transport-worker-result',
                  contractVersion: 3,
                  requestId: message.requestId,
                  operation: 'connect',
                  payload: null,
                },
              }),
            );
        },
        addEventListener: (_type, next) => {
          listener = next;
        },
        removeEventListener: remove,
        terminate,
      };
      const client = createWorkerTransportSimulationClient({
        workerFactory: () => worker,
      });
      await client.connect({
        kind: 'transport-client-connect',
        contractVersion: 3,
        mode: 'new',
        gameId: 'game',
        timelineId: 'timeline',
        initialSimulationTick: 0,
        scenario: scenario(),
      } as never);
      const pending = client.sendCommand({
        kind: 'foundation-command',
        gameId: 'game',
        timelineId: 'timeline',
        commandId: 'command',
        correlationId: 'correlation',
        clientId: 'client',
        sessionId: 'session',
        command: { type: 'foundation.advance-ticks', count: 1 },
      } as never);
      listener({
        data:
          variant === 'missing-operation'
            ? {
                kind: 'transport-worker-failure',
                contractVersion: 3,
                requestId: 2,
                message: 'missing operation',
              }
            : {
                kind: 'transport-worker-result',
                contractVersion: 3,
                requestId: 2,
                operation:
                  variant === 'wrong-operation' ? 'connect' : 'send-command',
                payload: null,
              },
      });
      await expect(pending).rejects.toThrow(
        variant === 'malformed-payload' ? 'invalid message' : 'did not match',
      );
      expect(client.getLifecycle()).toMatchObject({ state: 'failed' });
      expect(remove).toHaveBeenCalledTimes(3);
      expect(terminate).toHaveBeenCalledOnce();
      expect(() => client.subscribeReliableUpdates(() => undefined)).toThrow(
        'closed',
      );
    },
  );

  it('preserves authority for stale publications and suppresses publications after close', async () => {
    let canonicalUpdate!: TransportStateUpdate;
    const direct = createDirectTransportSimulationClient();
    direct.subscribeReliableUpdates((update) => {
      canonicalUpdate = update;
    });
    await direct.connect({
      kind: 'transport-client-connect',
      contractVersion: 3,
      mode: 'new',
      gameId: 'game',
      timelineId: 'worker-publications',
      initialSimulationTick: 0,
      scenario: scenario(),
    } as never);
    await direct.sendCommand({
      kind: 'foundation-command',
      gameId: 'game',
      timelineId: 'worker-publications',
      commandId: 'advance',
      correlationId: 'advance',
      clientId: 'client',
      sessionId: 'session',
      command: { type: 'foundation.advance-ticks', count: 1 },
    } as never);
    await direct.close();

    const listeners = new Map<
      'message' | 'error' | 'messageerror',
      (event: TransportWorkerEvent) => void
    >();
    const terminate = vi.fn();
    const worker: TransportWorkerLike = {
      postMessage(message) {
        if (message.operation === 'connect' || message.operation === 'close')
          queueMicrotask(() =>
            listeners.get('message')?.({
              data: {
                kind: 'transport-worker-result',
                contractVersion: 3,
                requestId: message.requestId,
                operation: message.operation,
                payload: null,
              },
            }),
          );
      },
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type, listener) => {
        if (listeners.get(type) === listener) listeners.delete(type);
      },
      terminate,
    };
    const client = createWorkerTransportSimulationClient({
      workerFactory: () => worker,
    });
    await client.connect({
      kind: 'transport-client-connect',
      contractVersion: 3,
      mode: 'new',
      gameId: 'game',
      timelineId: 'worker-publications',
      initialSimulationTick: 0,
      scenario: scenario(),
    } as never);
    const staleMessageListener = listeners.get('message')!;
    const received = vi.fn();
    client.subscribeReliableUpdates(received);

    staleMessageListener({
      data: {
        kind: 'transport-worker-publication',
        contractVersion: 3,
        channel: 'reliable',
        payload: canonicalUpdate,
      },
    });
    staleMessageListener({
      data: {
        kind: 'transport-worker-publication',
        contractVersion: 3,
        channel: 'reliable',
        payload: { ...canonicalUpdate, simulationTick: 0 },
      },
    });
    expect(client.getAuthoritativeState().tick).toBe(1);
    expect(received).toHaveBeenCalledTimes(2);

    await client.close();
    staleMessageListener({
      data: {
        kind: 'transport-worker-publication',
        contractVersion: 3,
        channel: 'reliable',
        payload: canonicalUpdate,
      },
    });
    expect(received).toHaveBeenCalledTimes(2);
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('fails terminally when the Worker reports a messageerror event', async () => {
    const listeners = new Map<
      'message' | 'error' | 'messageerror',
      (event: TransportWorkerEvent) => void
    >();
    const terminate = vi.fn();
    const worker: TransportWorkerLike = {
      postMessage(message) {
        if (message.operation === 'connect')
          queueMicrotask(() =>
            listeners.get('message')?.({
              data: {
                kind: 'transport-worker-result',
                contractVersion: 3,
                requestId: message.requestId,
                operation: 'connect',
                payload: null,
              },
            }),
          );
      },
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type, listener) => {
        if (listeners.get(type) === listener) listeners.delete(type);
      },
      terminate,
    };
    const client = createWorkerTransportSimulationClient({
      workerFactory: () => worker,
    });
    await client.connect({
      kind: 'transport-client-connect',
      contractVersion: 3,
      mode: 'new',
      gameId: 'game',
      timelineId: 'messageerror',
      initialSimulationTick: 0,
      scenario: scenario(),
    } as never);

    listeners.get('messageerror')!({ data: null, message: 'clone failed' });
    expect(client.getLifecycle()).toEqual({
      state: 'failed',
      code: 'invalid-worker-message',
      message: 'clone failed',
    });
    expect(terminate).toHaveBeenCalledOnce();
    await client.close();
  });

  it('preserves Error postMessage failures and normalizes non-Error factory failures', async () => {
    const request = {
      kind: 'transport-client-connect',
      contractVersion: 3,
      mode: 'new',
      gameId: 'game',
      timelineId: 'startup-failure',
      initialSimulationTick: 0,
      scenario: scenario(),
    } as never;
    const terminate = vi.fn();
    const postFailure = createWorkerTransportSimulationClient({
      workerFactory: () => ({
        postMessage() {
          throw new Error('post failed');
        },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        terminate,
      }),
    });
    await expect(postFailure.connect(request)).rejects.toThrow('post failed');
    expect(postFailure.getLifecycle()).toMatchObject({
      state: 'failed',
      code: 'worker-startup-failed',
      message: 'post failed',
    });
    expect(terminate).toHaveBeenCalledOnce();
    await postFailure.close();

    const factoryFailure = createWorkerTransportSimulationClient({
      workerFactory: () => {
        throw 'factory failed';
      },
    });
    await expect(factoryFailure.connect(request)).rejects.toBe(
      'factory failed',
    );
    expect(factoryFailure.getLifecycle()).toEqual({
      state: 'failed',
      code: 'worker-startup-failed',
      message: 'Transport Worker operation failed.',
    });
    await factoryFailure.close();
  });

  it('keeps the terminal invalid-message lifecycle emitted during connect', async () => {
    const listeners = new Map<
      'message' | 'error' | 'messageerror',
      (event: TransportWorkerEvent) => void
    >();
    const terminate = vi.fn();
    const worker: TransportWorkerLike = {
      postMessage() {
        queueMicrotask(() =>
          listeners.get('message')?.({ data: { malformed: true } }),
        );
      },
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type, listener) => {
        if (listeners.get(type) === listener) listeners.delete(type);
      },
      terminate,
    };
    const client = createWorkerTransportSimulationClient({
      workerFactory: () => worker,
    });
    const lifecycle = vi.fn();
    client.subscribeLifecycle(lifecycle);

    await expect(
      client.connect({
        kind: 'transport-client-connect',
        contractVersion: 3,
        mode: 'new',
        gameId: 'game',
        timelineId: 'malformed-connect',
        initialSimulationTick: 0,
        scenario: scenario(),
      } as never),
    ).rejects.toThrow('invalid message');
    expect(lifecycle).toHaveBeenLastCalledWith({
      state: 'failed',
      code: 'invalid-worker-message',
      message: 'Transport Worker returned an invalid message.',
    });
    expect(
      lifecycle.mock.calls.filter(([state]) => state.state === 'failed'),
    ).toHaveLength(1);
    expect(terminate).toHaveBeenCalledOnce();
    await client.close();
  });
});
