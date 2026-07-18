import { describe, expect, it } from 'vitest';
import {
  createFoundationState,
  parseSimulationTick,
} from '@torrevieja-tycoon/simulation';
import {
  parseCommandId,
  parseFoundationCommandEnvelope,
  parseGameId,
  parseTimelineId,
  type FoundationCommandEnvelope,
} from '@torrevieja-tycoon/protocol';

import { createInMemorySimulationHost } from './in-memory-host.js';

const gameId = parseGameId('game-1');
const timelineId = parseTimelineId('timeline-1');

function envelope(
  commandId: string,
  count: number,
  overrides: Readonly<Record<string, unknown>> = {},
): FoundationCommandEnvelope {
  return parseFoundationCommandEnvelope({
    kind: 'foundation-command',
    gameId,
    timelineId,
    commandId: parseCommandId(commandId),
    correlationId: 'correlation-1',
    clientId: 'client-1',
    sessionId: 'session-1',
    expectedCommandRevision: 0,
    command: { type: 'foundation.advance-ticks', count },
    ...overrides,
  });
}

function host() {
  return createInMemorySimulationHost({
    gameId,
    timelineId,
    initialState: createFoundationState(parseSimulationTick(10)),
  });
}

describe('in-memory foundation host', () => {
  it('uses injected identity and starts all authoritative positions at zero', () => {
    const baseline = host().synchronize({
      kind: 'foundation-synchronization-request',
      gameId,
    });

    expect(baseline).toEqual({
      kind: 'foundation-synchronization-response',
      mode: 'full',
      reason: 'no-baseline',
      baseline: {
        kind: 'foundation-full-baseline',
        gameId,
        timelineId,
        commandRevision: 0,
        simulationTick: 10,
        lastIncludedStreamOffset: 0,
        readModel: { tick: 10 },
      },
    });
    expect(Object.isFrozen(baseline)).toBe(true);
    if (
      baseline.kind !== 'foundation-synchronization-response' ||
      baseline.mode !== 'full'
    )
      throw new Error('Expected full baseline.');
    const compileTimeReadonlyCheck = () => {
      // @ts-expect-error nested read-model fields are readonly
      baseline.baseline.readModel.tick = 11;
    };
    void compileTimeReadonlyCheck;
    expect(Object.isFrozen(baseline.baseline)).toBe(true);
    expect(Object.isFrozen(baseline.baseline.readModel)).toBe(true);
  });

  it('applies at the current tick and publishes independently sequenced outputs', async () => {
    const instance = host();
    const updates: unknown[] = [];
    const snapshots: unknown[] = [];
    instance.subscribeReliableUpdates((update) => updates.push(update));
    instance.subscribeRenderSnapshots((snapshot) => snapshots.push(snapshot));

    const result = await instance.sendCommand(envelope('command-1', 3));

    expect(result).toMatchObject({
      status: 'applied',
      appliedAtTick: 10,
      resultingSimulationTick: 13,
      appliedCommandRevision: 1,
      duplicate: false,
    });
    expect(updates).toEqual([
      expect.objectContaining({
        streamOffset: 1,
        commandRevision: 1,
        simulationTick: 13,
      }),
    ]);
    expect(snapshots).toEqual([
      expect.objectContaining({
        sequence: 1,
        commandRevision: 1,
        simulationTick: 13,
      }),
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(updates[0])).toBe(true);
    expect(Object.isFrozen(snapshots[0])).toBe(true);
  });

  it('rejects a stale revision without mutation or publication, then accepts a match', async () => {
    const instance = host();
    const updates: unknown[] = [];
    instance.subscribeReliableUpdates((update) => updates.push(update));

    expect(
      await instance.sendCommand(
        envelope('stale', 4, { expectedCommandRevision: 1 }),
      ),
    ).toMatchObject({
      status: 'rejected',
      rejection: { code: 'stale-command-revision' },
      currentCommandRevision: 0,
    });
    expect(updates).toHaveLength(0);

    expect(await instance.sendCommand(envelope('matching', 4))).toMatchObject({
      status: 'applied',
      appliedAtTick: 10,
      resultingSimulationTick: 14,
      appliedCommandRevision: 1,
    });
  });

  it('keeps a retained stale rejection deeply immutable across duplicate retry', async () => {
    const instance = host();
    const stale = envelope('immutable-stale', 1, {
      expectedCommandRevision: 1,
    });
    const first = await instance.sendCommand(stale);
    if (
      first.kind !== 'foundation-command-result' ||
      first.status !== 'rejected'
    )
      throw new Error('Expected a rejected command result.');

    const compileTimeReadonlyCheck = () => {
      // @ts-expect-error public nested rejection fields are readonly
      first.rejection.code = 'changed';
    };
    void compileTimeReadonlyCheck;

    expect(Reflect.set(first.rejection, 'code', 'changed')).toBe(false);
    const duplicate = await instance.sendCommand(stale);

    expect(duplicate).toMatchObject({
      status: 'rejected',
      duplicate: true,
      rejection: {
        code: 'stale-command-revision',
        expectedCommandRevision: 1,
        currentCommandRevision: 0,
      },
    });
  });

  it('returns equivalent duplicates without reapplying or republishing', async () => {
    const instance = host();
    const updates: unknown[] = [];
    instance.subscribeReliableUpdates((update) => updates.push(update));
    const first = await instance.sendCommand(envelope('same', 2));
    const duplicate = await instance.sendCommand(
      envelope('same', 2, {
        correlationId: 'changed-correlation',
        clientId: 'changed-client',
        sessionId: 'changed-session',
        sentAt: 'changed-sent-at',
      }),
    );

    expect(first).toMatchObject({
      duplicate: false,
      resultingSimulationTick: 12,
    });
    expect(duplicate).toMatchObject({
      duplicate: true,
      resultingSimulationTick: 12,
    });
    expect(updates).toHaveLength(1);
  });

  it('returns a protocol error for conflicting command-ID reuse', async () => {
    const instance = host();
    await instance.sendCommand(envelope('conflict', 2));

    expect(await instance.sendCommand(envelope('conflict', 3))).toMatchObject({
      kind: 'foundation-protocol-error',
      code: 'command-id-conflict',
    });
    expect(
      instance.synchronize({
        kind: 'foundation-synchronization-request',
        gameId,
        timelineId,
        lastAppliedStreamOffset: 0,
      }),
    ).toMatchObject({ mode: 'delta', throughStreamOffset: 1 });
  });

  it('rejects identity mismatch without changing coordinates', async () => {
    const instance = host();
    expect(
      await instance.sendCommand(
        envelope('wrong-game', 1, { gameId: parseGameId('other-game') }),
      ),
    ).toMatchObject({ code: 'identity-mismatch' });
    expect(instance.getCoordinates()).toEqual({
      commandRevision: 0,
      simulationTick: 10,
      streamOffset: 0,
      renderSnapshotSequence: 0,
    });
  });

  it('keeps offsets contiguous and publishes nothing for rejected or duplicate commands', async () => {
    const instance = host();
    const updates: Array<{ streamOffset: number }> = [];
    const snapshots: Array<{ sequence: number }> = [];
    instance.subscribeReliableUpdates((update) => updates.push(update));
    instance.subscribeRenderSnapshots((snapshot) => snapshots.push(snapshot));

    await instance.sendCommand(envelope('one', 1));
    await instance.sendCommand(envelope('one', 1));
    await instance.sendCommand(envelope('stale', 1));
    await instance.sendCommand(
      envelope('two', 1, { expectedCommandRevision: 1 }),
    );

    expect(updates.map(({ streamOffset }) => streamOffset)).toEqual([1, 2]);
    expect(snapshots.map(({ sequence }) => sequence)).toEqual([1, 2]);
  });

  it('cleans subscriptions idempotently and isolates listener failures', async () => {
    const diagnostics: unknown[] = [];
    const received: number[] = [];
    const instance = createInMemorySimulationHost({
      gameId,
      timelineId,
      initialState: createFoundationState(parseSimulationTick(0)),
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    const removeFailing = instance.subscribeReliableUpdates(() => {
      throw new Error('listener failed');
    });
    const removeWorking = instance.subscribeReliableUpdates((update) =>
      received.push(update.streamOffset),
    );

    await instance.sendCommand(envelope('one', 1));
    removeFailing();
    removeFailing();
    removeWorking();
    removeWorking();
    await instance.sendCommand(
      envelope('two', 1, { expectedCommandRevision: 1 }),
    );

    expect(received).toEqual([1]);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        kind: 'listener-failure',
        channel: 'reliable-update',
      }),
    ]);
  });

  it('serializes reentrant command submission through one FIFO publication order', async () => {
    const instance = host();
    const observed: string[] = [];
    let reentrantResult: ReturnType<typeof instance.sendCommand> | undefined;
    instance.subscribeReliableUpdates((update) => {
      observed.push(`reliable-${update.streamOffset}`);
      if (update.streamOffset === 1) {
        reentrantResult = instance.sendCommand(
          envelope('reentrant', 1, { expectedCommandRevision: 1 }),
        );
      }
    });
    instance.subscribeRenderSnapshots((snapshot) => {
      observed.push(`render-${snapshot.sequence}`);
    });

    await instance.sendCommand(envelope('first', 1));
    await reentrantResult;

    expect(observed).toEqual([
      'reliable-1',
      'render-1',
      'reliable-2',
      'render-2',
    ]);
  });

  it('continues processing queued commands after an invalid submission rejects', async () => {
    const instance = host();

    await expect(
      instance.sendCommand({ kind: 'invalid-foundation-command' }),
    ).rejects.toThrow();

    await expect(
      instance.sendCommand(envelope('after-invalid', 1)),
    ).resolves.toMatchObject({
      status: 'applied',
      appliedCommandRevision: 1,
    });
  });

  it('isolates a throwing diagnostic callback from publication and results', async () => {
    const received: number[] = [];
    const instance = createInMemorySimulationHost({
      gameId,
      timelineId,
      initialState: createFoundationState(parseSimulationTick(0)),
      onDiagnostic: () => {
        throw new Error('diagnostic callback failed');
      },
    });
    instance.subscribeReliableUpdates(() => {
      throw new Error('listener failed');
    });
    instance.subscribeReliableUpdates((update) =>
      received.push(update.streamOffset),
    );

    const result = await instance.sendCommand(envelope('diagnostic', 1));

    expect(result).toMatchObject({ status: 'applied' });
    expect(received).toEqual([1]);
  });

  it('treats repeated subscription of one callback as independent registrations', async () => {
    const instance = host();
    const received: number[] = [];
    const listener = (update: { streamOffset: number }) =>
      received.push(update.streamOffset);
    const removeFirst = instance.subscribeReliableUpdates(listener);
    const removeSecond = instance.subscribeReliableUpdates(listener);

    removeFirst();
    removeFirst();
    await instance.sendCommand(envelope('one-registration', 1));
    removeSecond();
    removeSecond();
    await instance.sendCommand(
      envelope('no-registrations', 1, { expectedCommandRevision: 1 }),
    );

    expect(received).toEqual([1]);
  });

  it('returns contiguous, empty, ahead, and wrong-timeline synchronization results', async () => {
    const instance = host();
    await instance.sendCommand(envelope('one', 1));
    await instance.sendCommand(
      envelope('two', 2, { expectedCommandRevision: 1 }),
    );

    const delta = instance.synchronize({
      kind: 'foundation-synchronization-request',
      gameId,
      timelineId,
      lastAppliedStreamOffset: 0,
    });
    expect(delta).toMatchObject({
      mode: 'delta',
      fromExclusiveStreamOffset: 0,
      throughStreamOffset: 2,
    });
    if (
      delta.kind === 'foundation-synchronization-response' &&
      delta.mode === 'delta'
    ) {
      expect(delta.updates.map((u) => u.streamOffset)).toEqual([1, 2]);
      const compileTimeReadonlyCheck = () => {
        // @ts-expect-error synchronization update arrays are readonly
        delta.updates.push(delta.updates[0]);
        // @ts-expect-error synchronization update items are readonly
        delta.updates[0].streamOffset = 2;
      };
      void compileTimeReadonlyCheck;
      expect(Object.isFrozen(delta.updates)).toBe(true);
      expect(delta.updates.every((update) => Object.isFrozen(update))).toBe(
        true,
      );
    }

    expect(
      instance.synchronize({
        kind: 'foundation-synchronization-request',
        gameId,
        timelineId,
        lastAppliedStreamOffset: 2,
      }),
    ).toMatchObject({ mode: 'delta', updates: [] });
    expect(
      instance.synchronize({
        kind: 'foundation-synchronization-request',
        gameId,
        timelineId,
        lastAppliedStreamOffset: 3,
      }),
    ).toMatchObject({ mode: 'full', reason: 'client-ahead' });
    expect(
      instance.synchronize({
        kind: 'foundation-synchronization-request',
        gameId,
        timelineId: parseTimelineId('wrong'),
        lastAppliedStreamOffset: 0,
      }),
    ).toMatchObject({ mode: 'full', reason: 'timeline-mismatch' });
  });

  it('returns identity mismatch for synchronization against another game', () => {
    const instance = host();

    const result = instance.synchronize({
      kind: 'foundation-synchronization-request',
      gameId: parseGameId('other-game'),
      timelineId,
      lastAppliedStreamOffset: 0,
    });

    expect(result).toEqual({
      kind: 'foundation-synchronization-identity-mismatch',
      code: 'identity-mismatch',
      gameId: parseGameId('other-game'),
    });
    expect(Object.keys(result)).not.toContain('baseline');
    expect(Object.keys(result)).not.toContain('updates');
    expect(instance.getCoordinates()).toMatchObject({
      commandRevision: 0,
      streamOffset: 0,
      renderSnapshotSequence: 0,
    });
  });

  it('does not use render sequence for reliable synchronization', async () => {
    const instance = host();
    await instance.sendCommand(envelope('one', 1));
    const request = {
      kind: 'foundation-synchronization-request' as const,
      gameId,
      timelineId,
      lastAppliedStreamOffset: 0,
    };
    expect(Object.keys(request)).not.toContain('renderSnapshotSequence');
    expect(instance.synchronize(request)).toMatchObject({
      mode: 'delta',
      throughStreamOffset: 1,
    });
  });
});
