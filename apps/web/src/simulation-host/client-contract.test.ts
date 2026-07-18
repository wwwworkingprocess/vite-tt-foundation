import { describe, expect, it } from 'vitest';
import {
  parseCommandId,
  parseFoundationCommandEnvelope,
  parseGameId,
  parseStreamOffset,
  parseTimelineId,
  type FoundationSimulationClient,
} from '@torrevieja-tycoon/protocol';

import { createDirectFoundationClient } from './direct-client.js';
import { createWorkerFoundationClient } from '../simulation-worker/worker-client.js';
import { createStructuredCloneLoopbackWorker } from '../simulation-worker/worker-test-double.js';

const gameId = parseGameId('contract-game');
const timelineId = parseTimelineId('contract-timeline');
const connectRequest = { gameId, timelineId, initialSimulationTick: 10 };

function command(id: string, count: number, expectedCommandRevision = 0) {
  return parseFoundationCommandEnvelope({
    kind: 'foundation-command',
    gameId,
    timelineId,
    commandId: parseCommandId(id),
    correlationId: `correlation-${id}`,
    clientId: 'contract-client',
    sessionId: 'contract-session',
    expectedCommandRevision,
    command: { type: 'foundation.advance-ticks', count },
  });
}

const factories: ReadonlyArray<
  readonly [string, () => FoundationSimulationClient]
> = [
  ['direct', () => createDirectFoundationClient()],
  [
    'worker-loopback',
    () =>
      createWorkerFoundationClient({
        workerFactory: () => createStructuredCloneLoopbackWorker(),
      }),
  ],
];

describe.each(factories)(
  '%s foundation client contract',
  (_name, createClient) => {
    it.each([
      ['gameId', { ...connectRequest, gameId: 'invalid id' }],
      ['timelineId', { ...connectRequest, timelineId: 'invalid id' }],
      [
        'initialSimulationTick',
        { ...connectRequest, initialSimulationTick: -1 },
      ],
    ])(
      'rejects an invalid %s while remaining idle and can connect later',
      async (_field, malformed) => {
        const client = createClient();
        await expect(client.connect(malformed as never)).rejects.toThrow();
        expect(client.getLifecycle()).toEqual({ state: 'idle' });
        await expect(client.connect(connectRequest)).resolves.toBeUndefined();
        expect(client.getLifecycle()).toMatchObject({ state: 'ready' });
        await client.close();
      },
    );

    it('starts idle, rejects early operations, connects once, and closes idempotently', async () => {
      const client = createClient();
      expect(client.getLifecycle()).toEqual({ state: 'idle' });
      await expect(client.sendCommand(command('early', 1))).rejects.toThrow();
      await client.connect(connectRequest);
      expect(client.getLifecycle()).toEqual({
        state: 'ready',
        gameId,
        timelineId,
      });
      await expect(client.connect(connectRequest)).rejects.toThrow();
      await client.close();
      await client.close();
      expect(client.getLifecycle()).toEqual({ state: 'closed' });
      await expect(
        client.synchronize({
          kind: 'foundation-synchronization-request',
          gameId,
        }),
      ).rejects.toThrow();
    });

    it('applies FIFO commands and keeps result, reliable, and render channels distinct', async () => {
      const client = createClient();
      const observed: string[] = [];
      await client.connect(connectRequest);
      client.subscribeReliableUpdates((update) =>
        observed.push(`reliable-${update.streamOffset}`),
      );
      client.subscribeRenderSnapshots((snapshot) =>
        observed.push(`render-${snapshot.sequence}`),
      );

      const first = await client.sendCommand(command('one', 2));
      const second = await client.sendCommand(command('two', 3, 1));

      expect(first).toMatchObject({
        status: 'applied',
        resultingSimulationTick: 12,
      });
      expect(second).toMatchObject({
        status: 'applied',
        resultingSimulationTick: 15,
      });
      expect(observed).toEqual([
        'reliable-1',
        'render-1',
        'reliable-2',
        'render-2',
      ]);
      await client.close();
    });

    it('preserves synchronization, independent subscriptions, and clone-safe immutability', async () => {
      const client = createClient();
      await client.connect(connectRequest);
      const received: number[] = [];
      const listener = (update: { streamOffset: number }) =>
        received.push(update.streamOffset);
      const removeFirst = client.subscribeReliableUpdates(listener);
      const removeSecond = client.subscribeReliableUpdates(listener);
      removeFirst();
      await client.sendCommand(command('sync', 1));
      expect(received).toEqual([1]);
      removeSecond();

      const delta = await client.synchronize({
        kind: 'foundation-synchronization-request',
        gameId,
        timelineId,
        lastAppliedStreamOffset: parseStreamOffset(0),
      });
      expect(delta).toMatchObject({ mode: 'delta', throughStreamOffset: 1 });
      if (
        delta.kind === 'foundation-synchronization-response' &&
        delta.mode === 'delta'
      ) {
        expect(Object.isFrozen(delta)).toBe(true);
        expect(Object.isFrozen(delta.updates)).toBe(true);
        expect(delta.updates.every(Object.isFrozen)).toBe(true);
      }
      await client.close();
    });

    it('matches rejection, duplicate, conflict, and synchronization outcomes', async () => {
      const client = createClient();
      await client.connect(connectRequest);

      const stale = command('stale', 1, 1);
      const rejected = await client.sendCommand(stale);
      expect(rejected).toMatchObject({ status: 'rejected', duplicate: false });
      if (
        rejected.kind === 'foundation-command-result' &&
        rejected.status === 'rejected'
      ) {
        expect(Object.isFrozen(rejected.rejection)).toBe(true);
      }
      await expect(client.sendCommand(stale)).resolves.toMatchObject({
        duplicate: true,
      });
      await client.sendCommand(command('accepted', 1));
      await expect(
        client.sendCommand(command('accepted', 2)),
      ).resolves.toMatchObject({
        code: 'command-id-conflict',
      });

      await expect(
        client.synchronize({
          kind: 'foundation-synchronization-request',
          gameId,
        }),
      ).resolves.toMatchObject({ mode: 'full', reason: 'no-baseline' });
      await expect(
        client.synchronize({
          kind: 'foundation-synchronization-request',
          gameId: parseGameId('wrong-game'),
        }),
      ).resolves.toMatchObject({ code: 'identity-mismatch' });
      await expect(
        client.synchronize({
          kind: 'foundation-synchronization-request',
          gameId,
          timelineId: parseTimelineId('wrong-timeline'),
          lastAppliedStreamOffset: parseStreamOffset(0),
        }),
      ).resolves.toMatchObject({ mode: 'full', reason: 'timeline-mismatch' });
      await expect(
        client.synchronize({
          kind: 'foundation-synchronization-request',
          gameId,
          timelineId,
          lastAppliedStreamOffset: parseStreamOffset(2),
        }),
      ).resolves.toMatchObject({ mode: 'full', reason: 'client-ahead' });
      await expect(
        client.synchronize({
          kind: 'foundation-synchronization-request',
          gameId,
          timelineId,
          lastAppliedStreamOffset: parseStreamOffset(1),
        }),
      ).resolves.toMatchObject({ mode: 'delta', updates: [] });
      await client.close();
    });

    it('isolates lifecycle and publication listener failures', async () => {
      const client = createClient();
      const lifecycleStates: string[] = [];
      client.subscribeLifecycle(() => {
        throw new Error('lifecycle listener');
      });
      const removeLifecycle = client.subscribeLifecycle((state) =>
        lifecycleStates.push(state.state),
      );
      await client.connect(connectRequest);
      const offsets: number[] = [];
      client.subscribeReliableUpdates(() => {
        throw new Error('update listener');
      });
      client.subscribeReliableUpdates((update) =>
        offsets.push(update.streamOffset),
      );
      await client.sendCommand(command('listener', 1));
      removeLifecycle();
      removeLifecycle();
      await client.close();
      expect(lifecycleStates).toEqual(['connecting', 'ready']);
      expect(offsets).toEqual([1]);
    });

    it('supports independent subscriptions registered before connect', async () => {
      const client = createClient();
      const offsets: number[] = [];
      const listener = (update: { streamOffset: number }) =>
        offsets.push(update.streamOffset);
      const removeFirst = client.subscribeReliableUpdates(listener);
      const removeSecond = client.subscribeReliableUpdates(listener);
      removeFirst();
      await client.connect(connectRequest);
      await client.sendCommand(command('pre-connect', 1));
      expect(offsets).toEqual([1]);
      removeFirst();
      removeSecond();
      await client.close();
    });

    it('rejects a pending command when close begins and publishes nothing later', async () => {
      const client = createClient();
      const publications: string[] = [];
      await client.connect(connectRequest);
      client.subscribeReliableUpdates(() => publications.push('reliable'));
      client.subscribeRenderSnapshots(() => publications.push('render'));
      const pending = client.sendCommand(command('closed-pending', 1));
      await client.close();
      await expect(pending).rejects.toThrow('closed');
      await Promise.resolve();
      expect(publications).toEqual([]);
    });

    it('throws synchronously when subscribing after close', async () => {
      const client = createClient();
      await client.close();
      expect(() => client.subscribeReliableUpdates(() => undefined)).toThrow(
        'closed',
      );
      expect(() => client.subscribeRenderSnapshots(() => undefined)).toThrow(
        'closed',
      );
      expect(() => client.subscribeLifecycle(() => undefined)).toThrow(
        'closed',
      );
    });
  },
);
