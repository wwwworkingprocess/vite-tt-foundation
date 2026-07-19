import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import { createDirectTransportSimulationClient } from './transport-client.js';
import {
  createWorkerTransportSimulationClient,
  startTransportWorkerRuntime,
  type TransportWorkerEndpoint,
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
    const runtime = startTransportWorkerRuntime(endpoint);
    listener({
      data: {
        kind: 'transport-worker-request',
        contractVersion: 1,
        requestId: 1,
        operation: 'connect',
        payload: {
          kind: 'transport-client-connect',
          contractVersion: 1,
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
        contractVersion: 1,
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
      contractVersion: 1,
      mode: 'new',
      gameId: 'game',
      timelineId: 'timeline',
      initialSimulationTick: 0,
      scenario: scenario(),
    };
    listener({
      data: {
        kind: 'transport-worker-request',
        contractVersion: 1,
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
        contractVersion: 1,
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
                contractVersion: 1,
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
      contractVersion: 1,
      mode: 'new',
      gameId: 'game',
      timelineId: 'timeline',
      initialSimulationTick: 0,
      scenario: scenario(),
    } as never;
    await client.connect(request);
    await expect(client.connect(request)).rejects.toThrow('idle');
    listener({ data: { contractVersion: 2 } });
    listener({ data: { contractVersion: 1, kind: 'unknown' } });
    listener({ data: { contractVersion: 1, kind: 'transport-worker-result' } });
    listener({
      data: {
        contractVersion: 1,
        kind: 'transport-worker-result',
        requestId: 999,
        operation: 'send-command',
        payload: null,
      },
    });
    const pending = client.sendCommand({} as never);
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
    startTransportWorkerRuntime(endpoint);
    listener({ data: { nope: true } });
    listener({
      data: {
        kind: 'transport-worker-request',
        contractVersion: 1,
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
          contractVersion: 1,
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
      contractVersion: 1,
      mode: 'new',
      gameId: 'game',
      timelineId: 'runtime-timeline',
      initialSimulationTick: 0,
      scenario: scenario(),
    };
    listener({
      data: {
        kind: 'transport-worker-request',
        contractVersion: 1,
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
        contractVersion: 1,
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
        contractVersion: 1,
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
        contractVersion: 1,
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
        contractVersion: 1,
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
          if (state.failPost) throw new Error('post failed');
          queueMicrotask(() =>
            state.listener?.({
              data: {
                kind: 'transport-worker-failure',
                contractVersion: 1,
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
      contractVersion: 1,
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
    await expect(second.connect(request)).rejects.toThrow('post failed');
    expect(workers[1]!.terminate).toHaveBeenCalledOnce();
    await second.close();
    expect(() => second.subscribeReliableUpdates(() => undefined)).toThrow(
      'closed',
    );
  });
});
