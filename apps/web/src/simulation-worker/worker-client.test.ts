import { describe, expect, it } from 'vitest';
import { parseGameId, parseTimelineId } from '@torrevieja-tycoon/protocol';
import { createWorkerFoundationClient } from './worker-client.js';
import { createControllableWorker } from './worker-test-double.js';

describe('Worker foundation client failures', () => {
  const gameId = parseGameId('game');
  const timelineId = parseTimelineId('timeline');
  const connectRequest = { gameId, timelineId, initialSimulationTick: 0 };

  async function connectControllable() {
    const worker = createControllableWorker();
    const client = createWorkerFoundationClient({
      workerFactory: () => worker,
    });
    const connecting = client.connect(connectRequest);
    worker.emitMessage({
      kind: 'worker-operation-result',
      requestId: 1,
      status: 'success',
      result: null,
    });
    await connecting;
    return { client, worker };
  }
  it('uses request IDs from one and ignores unknown responses', async () => {
    const worker = createControllableWorker();
    const client = createWorkerFoundationClient({
      workerFactory: () => worker,
    });
    const connecting = client.connect({
      gameId,
      timelineId,
      initialSimulationTick: 0,
    });
    expect(worker.postedMessages[0]).toMatchObject({
      requestId: 1,
      operation: 'initialize',
    });
    worker.emitMessage({
      kind: 'worker-operation-result',
      requestId: 999,
      status: 'success',
      result: null,
    });
    worker.emitMessage({
      kind: 'worker-operation-result',
      requestId: 1,
      status: 'success',
      result: null,
    });
    await connecting;
    await client.close();
    expect(worker.postedMessages[1]).toMatchObject({
      requestId: 2,
      operation: 'close',
    });
    worker.emitMessage({
      kind: 'worker-operation-result',
      requestId: 1,
      status: 'success',
      result: null,
    });
  });

  it.each(['error', 'messageerror'] as const)(
    'rejects pending work and enters failed on %s',
    async (event) => {
      const worker = createControllableWorker();
      const client = createWorkerFoundationClient({
        workerFactory: () => worker,
      });
      const connecting = client.connect({
        gameId,
        timelineId,
        initialSimulationTick: 0,
      });
      worker.emitFailure(event);
      await expect(connecting).rejects.toThrow();
      expect(client.getLifecycle()).toMatchObject({ state: 'failed' });
      expect(worker.listenerCount()).toBe(0);
      expect(worker.terminateCount).toBe(1);
    },
  );

  it('fails malformed messages without leaving pending work', async () => {
    const worker = createControllableWorker();
    const client = createWorkerFoundationClient({
      workerFactory: () => worker,
    });
    const connecting = client.connect({
      gameId,
      timelineId,
      initialSimulationTick: 0,
    });
    worker.emitMessage({ malformed: true });
    await expect(connecting).rejects.toThrow();
    expect(client.getLifecycle()).toMatchObject({
      state: 'failed',
      code: 'invalid-worker-message',
    });
  });

  it('maps Worker construction failure and rejects close-pending initialization', async () => {
    const startup = createWorkerFoundationClient({
      workerFactory: () => {
        throw new Error('cannot start');
      },
    });
    await expect(
      startup.connect({ gameId, timelineId, initialSimulationTick: 0 }),
    ).rejects.toThrow();
    expect(startup.getLifecycle()).toMatchObject({
      state: 'failed',
      code: 'worker-startup-failed',
    });

    const worker = createControllableWorker();
    const pendingClient = createWorkerFoundationClient({
      workerFactory: () => worker,
    });
    const connecting = pendingClient.connect({
      gameId,
      timelineId,
      initialSimulationTick: 0,
    });
    await pendingClient.close();
    await expect(connecting).rejects.toThrow('closed');
    expect(worker.terminateCount).toBe(1);
    await pendingClient.close();
    expect(worker.terminateCount).toBe(1);
  });

  it('makes initialization post failure terminal and exception-safe', async () => {
    const worker = createControllableWorker();
    worker.failNextPost();
    const client = createWorkerFoundationClient({
      workerFactory: () => worker,
    });
    await expect(client.connect(connectRequest)).rejects.toThrow(
      'postMessage failed',
    );
    expect(client.getLifecycle()).toMatchObject({ state: 'failed' });
    expect(worker.listenerCount()).toBe(0);
    expect(worker.terminateCount).toBe(1);
  });

  it.each([
    { ...connectRequest, gameId: 'invalid id' },
    { ...connectRequest, timelineId: 'invalid id' },
    { ...connectRequest, initialSimulationTick: -1 },
  ])('validates connect before constructing a Worker', async (malformed) => {
    let constructionCount = 0;
    const client = createWorkerFoundationClient({
      workerFactory: () => {
        constructionCount += 1;
        return createControllableWorker();
      },
    });
    await expect(client.connect(malformed as never)).rejects.toThrow();
    expect(client.getLifecycle()).toEqual({ state: 'idle' });
    expect(constructionCount).toBe(0);
  });

  it('treats initialization operation failure as terminal', async () => {
    const worker = createControllableWorker();
    const client = createWorkerFoundationClient({
      workerFactory: () => worker,
    });
    const connecting = client.connect(connectRequest);
    worker.emitMessage({
      kind: 'worker-failure',
      requestId: 1,
      code: 'operation-failed',
      message: 'initialization failed',
    });
    await expect(connecting).rejects.toThrow('initialization failed');
    expect(client.getLifecycle()).toMatchObject({ state: 'failed' });
    expect(worker.listenerCount()).toBe(0);
    expect(worker.terminateCount).toBe(1);
  });

  it('rejects operation/result mismatches without becoming ready', async () => {
    const worker = createControllableWorker();
    const client = createWorkerFoundationClient({
      workerFactory: () => worker,
    });
    const connecting = client.connect(connectRequest);
    worker.emitMessage({
      kind: 'worker-operation-result',
      requestId: 1,
      status: 'success',
      result: {
        kind: 'foundation-protocol-error',
        code: 'invalid-command',
        message: 'wrong operation result',
      },
    });
    await expect(connecting).rejects.toThrow();
    expect(client.getLifecycle()).toMatchObject({ state: 'failed' });
  });

  it('removes a command request whose post throws and remains usable', async () => {
    const { client, worker } = await connectControllable();
    worker.failNextPost();
    await expect(client.sendCommand({} as never)).rejects.toThrow(
      'postMessage failed',
    );
    expect(client.getLifecycle()).toMatchObject({ state: 'ready' });
    await client.close();
  });

  it('rejects a send-command response containing another operation result type', async () => {
    const { client, worker } = await connectControllable();
    const command = client.sendCommand({} as never);
    worker.emitMessage({
      kind: 'worker-operation-result',
      requestId: 2,
      status: 'success',
      result: null,
    });
    await expect(command).rejects.toThrow('wrong operation');
    expect(client.getLifecycle()).toMatchObject({
      state: 'failed',
      code: 'invalid-worker-message',
    });
    expect(worker.terminateCount).toBe(1);
  });

  it('closes completely when close posting throws and ignores late responses', async () => {
    const { client, worker } = await connectControllable();
    worker.failNextPost();
    await expect(client.close()).resolves.toBeUndefined();
    expect(client.getLifecycle()).toEqual({ state: 'closed' });
    expect(worker.listenerCount()).toBe(0);
    expect(worker.terminateCount).toBe(1);
    worker.emitMessage({
      kind: 'worker-operation-result',
      requestId: 2,
      status: 'success',
      result: null,
    });
    expect(client.getLifecycle()).toEqual({ state: 'closed' });
  });

  it('stays closed when a close response arrives synchronously', async () => {
    const { client, worker } = await connectControllable();
    worker.onPost = (message) => {
      const posted = message as {
        readonly operation?: unknown;
        readonly requestId?: unknown;
      };
      if (posted.operation === 'close')
        worker.emitMessage({
          kind: 'worker-operation-result',
          requestId: posted.requestId,
          status: 'success',
          result: null,
        });
    };
    await client.close();
    expect(client.getLifecycle()).toEqual({ state: 'closed' });
    expect(worker.terminateCount).toBe(1);
  });
});
