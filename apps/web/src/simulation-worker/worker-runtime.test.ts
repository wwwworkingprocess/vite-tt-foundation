import { describe, expect, it } from 'vitest';
import {
  startFoundationWorkerRuntime,
  type WorkerRuntimeEndpoint,
} from './worker-runtime.js';

describe('foundation Worker runtime validation', () => {
  it('rejects malformed, premature, and duplicate initialization requests safely', async () => {
    const responses: unknown[] = [];
    let listener: ((event: { readonly data: unknown }) => void) | undefined;
    const endpoint: WorkerRuntimeEndpoint = {
      postMessage: (message) => responses.push(message),
      addEventListener: (_type, next) => {
        listener = next;
      },
      removeEventListener: (_type, next) => {
        if (listener === next) listener = undefined;
      },
    };
    const stop = startFoundationWorkerRuntime(endpoint);
    listener?.({ data: { malformed: true } });
    listener?.({
      data: { kind: 'worker-request', requestId: 1, operation: 'close' },
    });
    await Promise.resolve();
    listener?.({
      data: {
        kind: 'worker-request',
        requestId: 2,
        operation: 'initialize',
        payload: {
          mode: 'new',
          gameId: 'game',
          timelineId: 'timeline',
          initialSimulationTick: 0,
        },
      },
    });
    await Promise.resolve();
    listener?.({
      data: {
        kind: 'worker-request',
        requestId: 3,
        operation: 'initialize',
        payload: {
          mode: 'new',
          gameId: 'game',
          timelineId: 'timeline',
          initialSimulationTick: 0,
        },
      },
    });
    await Promise.resolve();
    expect(responses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid-request' }),
        expect.objectContaining({ requestId: 1, code: 'operation-failed' }),
        expect.objectContaining({ requestId: 2, status: 'success' }),
        expect.objectContaining({ requestId: 3, code: 'operation-failed' }),
      ]),
    );
    stop();
    expect(listener).toBeUndefined();
  });

  it('makes close terminal and ignores requests delivered through a stale listener', async () => {
    const responses: unknown[] = [];
    let active: ((event: { readonly data: unknown }) => void) | undefined;
    const endpoint: WorkerRuntimeEndpoint = {
      postMessage: (message) => responses.push(message),
      addEventListener: (_type, listener) => {
        active = listener;
      },
      removeEventListener: (_type, listener) => {
        if (active === listener) active = undefined;
      },
    };
    const stop = startFoundationWorkerRuntime(endpoint);
    const stale = active;
    active?.({
      data: {
        kind: 'worker-request',
        requestId: 1,
        operation: 'initialize',
        payload: {
          mode: 'new',
          gameId: 'game',
          timelineId: 'timeline',
          initialSimulationTick: 0,
        },
      },
    });
    await Promise.resolve();
    active?.({
      data: { kind: 'worker-request', requestId: 2, operation: 'close' },
    });
    await Promise.resolve();
    expect(active).toBeUndefined();
    const responseCount = responses.length;
    stale?.({
      data: {
        kind: 'worker-request',
        requestId: 3,
        operation: 'synchronize',
        payload: { kind: 'foundation-synchronization-request', gameId: 'game' },
      },
    });
    await Promise.resolve();
    expect(responses).toHaveLength(responseCount);
    stop();
  });

  it('shuts down when posting the close acknowledgement throws', async () => {
    let active: ((event: { readonly data: unknown }) => void) | undefined;
    let closeAcknowledgements = 0;
    const endpoint: WorkerRuntimeEndpoint = {
      postMessage: (message) => {
        if (
          message.kind === 'worker-operation-result' &&
          message.requestId === 2
        ) {
          closeAcknowledgements += 1;
          throw new Error('close acknowledgement failed');
        }
      },
      addEventListener: (_type, listener) => {
        active = listener;
      },
      removeEventListener: (_type, listener) => {
        if (active === listener) active = undefined;
      },
    };
    const stop = startFoundationWorkerRuntime(endpoint);
    const stale = active;
    active?.({
      data: {
        kind: 'worker-request',
        requestId: 1,
        operation: 'initialize',
        payload: {
          mode: 'new',
          gameId: 'game',
          timelineId: 'timeline',
          initialSimulationTick: 0,
        },
      },
    });
    await Promise.resolve();
    active?.({
      data: { kind: 'worker-request', requestId: 2, operation: 'close' },
    });
    await Promise.resolve();
    expect(active).toBeUndefined();
    expect(closeAcknowledgements).toBe(1);
    stale?.({ data: { malformed: true } });
    await Promise.resolve();
    expect(closeAcknowledgements).toBe(1);
    stop();
  });

  it.each(['send-command', 'export-snapshot'] as const)(
    'suppresses a pending %s reply after runtime shutdown',
    async (operation) => {
      const responses: unknown[] = [];
      let active: ((event: { readonly data: unknown }) => void) | undefined;
      const endpoint: WorkerRuntimeEndpoint = {
        postMessage: (message) => responses.push(message),
        addEventListener: (_type, listener) => {
          active = listener;
        },
        removeEventListener: (_type, listener) => {
          if (active === listener) active = undefined;
        },
      };
      const stop = startFoundationWorkerRuntime(endpoint);
      active?.({
        data: {
          kind: 'worker-request',
          requestId: 1,
          operation: 'initialize',
          payload: {
            mode: 'new',
            gameId: 'game',
            timelineId: 'timeline',
            initialSimulationTick: 0,
          },
        },
      });
      await Promise.resolve();
      responses.length = 0;

      active?.({
        data:
          operation === 'send-command'
            ? {
                kind: 'worker-request',
                requestId: 2,
                operation,
                payload: {
                  kind: 'foundation-command',
                  gameId: 'game',
                  timelineId: 'timeline',
                  commandId: 'pending-command',
                  correlationId: 'pending-correlation',
                  clientId: 'pending-client',
                  sessionId: 'pending-session',
                  expectedCommandRevision: 0,
                  command: { type: 'foundation.advance-ticks', count: 1 },
                },
              }
            : {
                kind: 'worker-request',
                requestId: 2,
                operation,
              },
      });
      stop();
      await Promise.resolve();
      await Promise.resolve();

      expect(active).toBeUndefined();
      expect(responses).toEqual([]);
    },
  );

  it('classifies a non-Error endpoint posting failure deterministically', async () => {
    const responses: unknown[] = [];
    let active: ((event: { readonly data: unknown }) => void) | undefined;
    let failNextPost = true;
    const endpoint: WorkerRuntimeEndpoint = {
      postMessage: (message) => {
        if (failNextPost) {
          failNextPost = false;
          throw 'non-Error endpoint failure';
        }
        responses.push(message);
      },
      addEventListener: (_type, listener) => {
        active = listener;
      },
      removeEventListener: (_type, listener) => {
        if (active === listener) active = undefined;
      },
    };
    const stop = startFoundationWorkerRuntime(endpoint);

    active?.({
      data: {
        kind: 'worker-request',
        requestId: 1,
        operation: 'initialize',
        payload: {
          mode: 'new',
          gameId: 'game',
          timelineId: 'timeline',
          initialSimulationTick: 0,
        },
      },
    });
    await Promise.resolve();

    expect(responses).toEqual([
      {
        kind: 'worker-failure',
        requestId: 1,
        code: 'operation-failed',
        message: 'Worker operation failed.',
      },
    ]);
    stop();
    expect(active).toBeUndefined();
  });
});
