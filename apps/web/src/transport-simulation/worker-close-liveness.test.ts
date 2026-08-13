import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
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
const connectRequest = () =>
  ({
    kind: 'transport-client-connect',
    contractVersion: 4,
    mode: 'new',
    gameId: 'game',
    timelineId: 'timeline',
    initialSimulationTick: 0,
    scenario: scenario(),
  }) as const;

const flush = async () => {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
};

function createLoopback(input: {
  readonly createRuntimeClient?: () => ReturnType<
    typeof createDirectTransportSimulationClient
  >;
  readonly throwClosePosts?: boolean;
  readonly throwBrowserRemove?: boolean;
  readonly throwBrowserTerminate?: boolean;
}) {
  let runtimeListener!: (event: { data: unknown }) => void;
  let browserListener: ((event: { data: unknown }) => void) | undefined;
  let browserErrorListener!: (event: {
    data: unknown;
    error?: unknown;
  }) => void;
  const terminate = vi.fn(() => {
    if (input.throwBrowserTerminate)
      throw new Error('browser terminate failed');
  });
  const remove = vi.fn(() => {
    if (input.throwBrowserRemove) throw new Error('browser remove failed');
  });
  const posted: unknown[] = [];
  const endpoint: TransportWorkerEndpoint = {
    postMessage(message) {
      posted.push(message);
      if (
        input.throwClosePosts &&
        'operation' in message &&
        message.operation === 'close'
      )
        throw new Error('close response post failed');
      queueMicrotask(() => browserListener?.({ data: message }));
    },
    addEventListener: (_type, listener) => {
      runtimeListener = listener;
    },
    removeEventListener: vi.fn(),
    reportError: (error) =>
      queueMicrotask(() => browserErrorListener({ data: undefined, error })),
  };
  const runtime = startTransportWorkerRuntime(
    endpoint,
    input.createRuntimeClient ?? createDirectTransportSimulationClient,
  );
  const worker: TransportWorkerLike = {
    postMessage: (message) =>
      queueMicrotask(() => runtimeListener({ data: message })),
    addEventListener: (type, listener) => {
      if (type === 'message') browserListener = listener;
      else if (type === 'error') browserErrorListener = listener;
    },
    removeEventListener: remove,
    terminate,
  };
  return {
    client: createWorkerTransportSimulationClient({
      workerFactory: () => worker,
    }),
    runtime,
    terminate,
    remove,
    emitToBrowser: (data: unknown) => browserListener?.({ data }),
    emitBrowserError: (event: { error?: unknown; message?: string }) =>
      browserErrorListener({ data: undefined, ...event }),
    sendToRuntime: (data: unknown) => runtimeListener({ data }),
    posted,
  };
}

describe('paired transport Worker close liveness', () => {
  it('settles a graceful close and shares one terminal promise', async () => {
    const loopback = createLoopback({});
    await loopback.client.connect(connectRequest() as never);
    const first = loopback.client.close();
    expect(loopback.client.close()).toBe(first);
    await expect(first).resolves.toBeUndefined();
    expect(loopback.client.getLifecycle()).toEqual({ state: 'closed' });
    expect(loopback.terminate).toHaveBeenCalledOnce();
    expect(loopback.remove).toHaveBeenCalledTimes(3);
  });

  it.each(['unsubscribe', 'client-close', 'both'] as const)(
    'settles with a correlated failure when runtime %s cleanup fails',
    async (variant) => {
      const direct = createDirectTransportSimulationClient();
      const unsubscribe = vi.fn(() => {
        if (variant !== 'client-close')
          throw new Error('runtime unsubscribe failed');
      });
      const runtimeClose = vi.fn(async () => {
        await direct.close();
        if (variant !== 'unsubscribe')
          throw new Error('runtime client close failed');
      });
      const loopback = createLoopback({
        createRuntimeClient: () =>
          Object.freeze({
            ...direct,
            subscribeReliableUpdates: () => unsubscribe,
            close: runtimeClose,
          }),
      });
      await loopback.client.connect(connectRequest() as never);
      let settled = false;
      const closing = loopback.client.close().finally(() => {
        settled = true;
      });
      await flush();
      expect(settled).toBe(true);
      await expect(closing).rejects.toThrow('cleanup');
      expect(unsubscribe).toHaveBeenCalledOnce();
      expect(runtimeClose).toHaveBeenCalledOnce();
      expect(loopback.client.getLifecycle()).toEqual({ state: 'closed' });
      expect(loopback.terminate).toHaveBeenCalledOnce();
    },
  );

  it('settles when posting the close acknowledgement throws', async () => {
    const loopback = createLoopback({ throwClosePosts: true });
    await loopback.client.connect(connectRequest() as never);
    let settled = false;
    const closing = loopback.client.close().finally(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(true);
    await expect(closing).rejects.toThrow('post failed');
    expect(loopback.client.getLifecycle()).toEqual({ state: 'closed' });
    expect(loopback.terminate).toHaveBeenCalledOnce();
  });

  it('finishes terminally when browser listener removal and termination throw', async () => {
    const loopback = createLoopback({
      throwBrowserRemove: true,
      throwBrowserTerminate: true,
    });
    await loopback.client.connect(connectRequest() as never);
    const lifecycle = vi.fn();
    loopback.client.subscribeLifecycle(lifecycle);
    const closing = loopback.client.close();
    await expect(closing).rejects.toThrow('cleanup failed');
    expect(loopback.client.close()).toBe(closing);
    expect(loopback.client.getLifecycle()).toEqual({ state: 'closed' });
    expect(lifecycle).toHaveBeenCalledWith({ state: 'closed' });
    expect(loopback.remove).toHaveBeenCalledTimes(3);
    expect(loopback.terminate).toHaveBeenCalledOnce();
  });

  it('reports both runtime cleanup and close-failure posting through the Worker error path', async () => {
    const direct = createDirectTransportSimulationClient();
    const loopback = createLoopback({
      throwClosePosts: true,
      createRuntimeClient: () =>
        Object.freeze({
          ...direct,
          subscribeReliableUpdates: () => () => {
            throw new Error('unsubscribe failed');
          },
        }),
    });
    await loopback.client.connect(connectRequest() as never);
    await expect(loopback.client.close()).rejects.toThrow('reporting failed');
    expect(loopback.client.getLifecycle()).toEqual({ state: 'closed' });
  });

  it('rejects valid runtime operations before connect and ignores unknown correlated failures', async () => {
    const loopback = createLoopback({});
    const request = (
      requestId: number,
      operation: string,
      payload: unknown,
    ) => ({
      kind: 'transport-worker-request',
      contractVersion: 4,
      requestId,
      operation,
      payload,
    });
    loopback.sendToRuntime(
      request(1, 'send-command', {
        kind: 'foundation-command',
        gameId: 'game',
        timelineId: 'timeline',
        commandId: 'command',
        correlationId: 'correlation',
        clientId: 'client',
        sessionId: 'session',
        command: { type: 'foundation.advance-ticks', count: 1 },
      }),
    );
    loopback.sendToRuntime(
      request(2, 'synchronize', {
        kind: 'foundation-synchronization-request',
        gameId: 'game',
      }),
    );
    loopback.sendToRuntime(request(3, 'export-snapshot', null));
    await flush();
    await loopback.client.connect(connectRequest() as never);
    loopback.emitToBrowser({
      kind: 'transport-worker-failure',
      contractVersion: 4,
      requestId: 999,
      operation: 'connect',
      message: 'unknown request',
    });
    loopback.emitToBrowser({
      kind: 'transport-worker-failure',
      contractVersion: 4,
      message: 'uncorrelated failure',
    });
    expect(loopback.client.getLifecycle()).toMatchObject({ state: 'ready' });
    expect(
      loopback.posted.filter(
        (message) =>
          (message as { kind?: string }).kind === 'transport-worker-failure',
      ),
    ).toHaveLength(3);
    await loopback.client.close();
  });

  it('preserves an active Worker error message as the first terminal cause', async () => {
    const loopback = createLoopback({});
    await loopback.client.connect(connectRequest() as never);
    loopback.emitBrowserError({ message: 'worker exploded' });
    expect(loopback.client.getLifecycle()).toMatchObject({
      state: 'failed',
      code: 'invalid-worker-message',
      message: 'worker exploded',
    });
    await expect(loopback.client.close()).resolves.toBeUndefined();
  });

  it('normalizes an active Worker error without structured details', async () => {
    const loopback = createLoopback({});
    await loopback.client.connect(connectRequest() as never);
    loopback.emitBrowserError({});
    expect(loopback.client.getLifecycle()).toMatchObject({
      state: 'failed',
      message: 'Transport Worker failed.',
    });
    await loopback.client.close();
  });
});
