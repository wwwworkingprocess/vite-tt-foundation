import { describe, expect, it } from 'vitest';
import {
  parseCommandId,
  parseCommandRevision,
  parseFoundationCommandEnvelope,
  parseFoundationFullBaseline,
  parseGameId,
  parseRenderSnapshotSequence,
  parseStreamOffset,
  parseTimelineId,
  type FoundationRenderSnapshot,
  type FoundationSimulationClient,
  type FoundationStateUpdate,
} from '@torrevieja-tycoon/protocol';
import { createDirectFoundationClient } from '../simulation-host/direct-client.js';
import { createInMemoryFoundationSaveRepository } from '../persistence/save-repository.js';
import { createFoundationApplicationController } from './foundation-controller.js';

const gameId = parseGameId('app-game');
const timelineId = parseTimelineId('app-timeline');
describe('foundation application controller and vanilla store', () => {
  it('starts synchronized, projects updates, saves, and restores to a new timeline', async () => {
    const repository = createInMemoryFoundationSaveRepository();
    const retainedReliable: Array<(value: FoundationStateUpdate) => void> = [];
    const retainedRender: Array<(value: FoundationRenderSnapshot) => void> = [];
    const controller = createFoundationApplicationController({
      repository,
      clientFactory: () => {
        const base = createDirectFoundationClient();
        return Object.freeze({
          ...base,
          subscribeReliableUpdates(
            listener: (value: FoundationStateUpdate) => void,
          ) {
            retainedReliable.push(listener);
            return base.subscribeReliableUpdates(listener);
          },
          subscribeRenderSnapshots(
            listener: (value: FoundationRenderSnapshot) => void,
          ) {
            retainedRender.push(listener);
            return base.subscribeRenderSnapshots(listener);
          },
        });
      },
    });
    await controller.startNew({ gameId, timelineId, initialSimulationTick: 4 });
    expect(controller.projection.getState()).toMatchObject({
      session: { status: 'ready' },
      authoritative: { simulationTick: 4, commandRevision: 0, streamOffset: 0 },
      synchronization: { status: 'synchronized' },
    });
    await controller.sendCommand(
      parseFoundationCommandEnvelope({
        kind: 'foundation-command',
        gameId,
        timelineId,
        commandId: parseCommandId('app-command'),
        correlationId: 'app-correlation',
        clientId: 'app-client',
        sessionId: 'app-session',
        command: { type: 'foundation.advance-ticks', count: 2 },
      }),
    );
    expect(controller.projection.getState().authoritative).toMatchObject({
      simulationTick: 6,
      commandRevision: 1,
      streamOffset: 1,
    });
    expect(controller.projection.getState().latestRenderSnapshot).toMatchObject(
      {
        sequence: 1,
      },
    );
    await controller.save({
      saveId: 'slot-1',
      label: 'Slot',
      createdAtUtcMs: 10,
      updatedAtUtcMs: 10,
    });
    expect(controller.projection.getState().persistence.saves).toHaveLength(1);
    const restoredTimeline = parseTimelineId('app-restored');
    await controller.restore({
      saveId: 'slot-1',
      newTimelineId: restoredTimeline,
    });
    expect(controller.projection.getState()).toMatchObject({
      session: { status: 'ready', timelineId: restoredTimeline },
      authoritative: { simulationTick: 6, commandRevision: 0, streamOffset: 0 },
    });
    retainedReliable[0]?.(
      Object.freeze({
        kind: 'foundation-state-update',
        gameId,
        timelineId,
        streamOffset: parseStreamOffset(99),
        commandRevision: parseCommandRevision(99),
        simulationTick: 99,
      }),
    );
    retainedRender[0]?.(
      Object.freeze({
        kind: 'foundation-render-snapshot',
        gameId,
        timelineId,
        sequence: parseRenderSnapshotSequence(99),
        commandRevision: parseCommandRevision(99),
        simulationTick: 99,
      }),
    );
    expect(controller.projection.getState().authoritative?.simulationTick).toBe(
      6,
    );
    expect(
      controller.projection.getState().latestRenderSnapshot,
    ).toBeUndefined();
    expect(Object.isFrozen(controller.projection.getState())).toBe(true);
    await controller.close();
  });

  it('rejects same-timeline restore and is terminal after idempotent close', async () => {
    const controller = createFoundationApplicationController({
      repository: createInMemoryFoundationSaveRepository(),
      clientFactory: createDirectFoundationClient,
    });
    await controller.startNew({ gameId, timelineId, initialSimulationTick: 0 });
    await controller.save({
      saveId: 'slot',
      createdAtUtcMs: 1,
      updatedAtUtcMs: 1,
    });
    await expect(
      controller.restore({ saveId: 'slot', newTimelineId: timelineId }),
    ).rejects.toThrow('different');
    await controller.close();
    await controller.close();
    await expect(controller.listSaves()).rejects.toThrow('closed');
    expect(controller.projection.getState().session).toEqual({
      status: 'closed',
    });
  });

  it('covers save listing, deletion, synchronization, and failed workflows', async () => {
    const invalid = createFoundationApplicationController({
      repository: createInMemoryFoundationSaveRepository(),
      clientFactory: createDirectFoundationClient,
    });
    await expect(invalid.synchronize()).rejects.toThrow('No active');
    await expect(
      invalid.sendCommand(
        parseFoundationCommandEnvelope({
          kind: 'foundation-command',
          gameId,
          timelineId,
          commandId: 'early-command',
          correlationId: 'early-correlation',
          clientId: 'early-client',
          sessionId: 'early-session',
          command: { type: 'foundation.advance-ticks', count: 1 },
        }),
      ),
    ).rejects.toThrow('No active');
    await expect(
      invalid.restore({
        saveId: 'missing',
        newTimelineId: parseTimelineId('new'),
      }),
    ).rejects.toThrow('not found');
    await expect(
      invalid.startNew({ gameId, timelineId, initialSimulationTick: -1 }),
    ).rejects.toThrow();
    await invalid.close();

    const controller = createFoundationApplicationController({
      repository: createInMemoryFoundationSaveRepository(),
      clientFactory: createDirectFoundationClient,
    });
    await controller.startNew({ gameId, timelineId, initialSimulationTick: 0 });
    await controller.save({
      saveId: 'delete-me',
      createdAtUtcMs: 1,
      updatedAtUtcMs: 1,
    });
    await expect(controller.listSaves()).resolves.toHaveLength(1);
    await controller.deleteSave('delete-me');
    await expect(controller.listSaves()).resolves.toEqual([]);
    await controller.synchronize();
    const firstClose = controller.close();
    const secondClose = controller.close();
    await Promise.all([firstClose, secondClose]);
  });

  it('rejects non-full initial synchronization and closes the failed authority', async () => {
    let closeCount = 0;
    let cleanupCount = 0;
    const client: FoundationSimulationClient = {
      async connect() {
        // The synchronization response below is the failure under test.
      },
      async sendCommand() {
        throw new Error('unused');
      },
      async synchronize() {
        return {
          kind: 'foundation-synchronization-response',
          mode: 'delta',
          gameId,
          timelineId,
          fromExclusiveStreamOffset: parseStreamOffset(0),
          throughStreamOffset: parseStreamOffset(0),
          throughCommandRevision: parseCommandRevision(0),
          simulationTick: 0,
          updates: [],
        } as const;
      },
      async exportSnapshot() {
        throw new Error('unused');
      },
      subscribeReliableUpdates: () => () => {
        cleanupCount += 1;
      },
      subscribeRenderSnapshots: () => () => {
        cleanupCount += 1;
      },
      getLifecycle: () => ({ state: 'idle' }),
      subscribeLifecycle: () => () => undefined,
      async close() {
        closeCount += 1;
      },
    };
    const controller = createFoundationApplicationController({
      repository: createInMemoryFoundationSaveRepository(),
      clientFactory: () => client,
    });

    await expect(
      controller.startNew({ gameId, timelineId, initialSimulationTick: 0 }),
    ).rejects.toThrow('Full synchronization is required.');
    expect(closeCount).toBe(1);
    expect(cleanupCount).toBe(2);
    expect(controller.projection.getState()).toMatchObject({
      session: {
        status: 'failed',
        message: 'Full synchronization is required.',
      },
      synchronization: {
        status: 'failed',
        message: 'Full synchronization is required.',
      },
    });
    await controller.close();
  });

  it('closes terminally when close begins during initial synchronization', async () => {
    let releaseSynchronization: (() => void) | undefined;
    let closeCount = 0;
    const base = createDirectFoundationClient();
    const controller = createFoundationApplicationController({
      repository: createInMemoryFoundationSaveRepository(),
      clientFactory: () =>
        Object.freeze({
          ...base,
          async synchronize(
            request: Parameters<FoundationSimulationClient['synchronize']>[0],
          ) {
            await new Promise<void>((resolve) => {
              releaseSynchronization = resolve;
            });
            return base.synchronize(request);
          },
          async close() {
            closeCount += 1;
            await base.close();
          },
        }),
    });

    const starting = controller.startNew({
      gameId,
      timelineId,
      initialSimulationTick: 0,
    });
    await expect.poll(() => releaseSynchronization).toBeTypeOf('function');
    const closing = controller.close();
    releaseSynchronization?.();

    await expect(starting).rejects.toThrow(
      'Foundation application controller is closed.',
    );
    await closing;
    expect(closeCount).toBe(1);
    expect(controller.projection.getState().session).toEqual({
      status: 'closed',
    });
  });

  it('classifies repository failures and rejects saving without active authority', async () => {
    const backing = createInMemoryFoundationSaveRepository();
    let failList = true;
    let failDelete = false;
    const repository = {
      ...backing,
      list: async () => {
        if (failList) return Promise.reject('list unavailable');
        return backing.list();
      },
      delete: async (saveId: Parameters<typeof backing.delete>[0]) => {
        if (failDelete) throw new Error('delete unavailable');
        return backing.delete(saveId);
      },
    };
    const controller = createFoundationApplicationController({
      repository,
      clientFactory: createDirectFoundationClient,
    });

    await expect(controller.listSaves()).rejects.toBe('list unavailable');
    expect(controller.projection.getState().persistence).toEqual({
      status: 'failed',
      saves: [],
      message: 'Operation failed.',
    });
    failList = false;
    await expect(
      controller.save({
        saveId: 'inactive',
        createdAtUtcMs: 1,
        updatedAtUtcMs: 1,
      }),
    ).rejects.toThrow('No active foundation client.');

    await controller.startNew({ gameId, timelineId, initialSimulationTick: 0 });
    failDelete = true;
    await expect(controller.deleteSave('missing')).rejects.toThrow(
      'delete unavailable',
    );
    expect(controller.projection.getState().persistence).toEqual({
      status: 'failed',
      saves: [],
      message: 'delete unavailable',
    });
    await controller.close();
  });

  it('detects reliable gaps and replaces only newer matching render projections', async () => {
    let reliable: ((value: FoundationStateUpdate) => void) | undefined;
    let render: ((value: FoundationRenderSnapshot) => void) | undefined;
    let subscribedBeforeConnect = false;
    let failSynchronization = false;
    const fake: FoundationSimulationClient = {
      async connect() {
        subscribedBeforeConnect =
          reliable !== undefined && render !== undefined;
      },
      async sendCommand() {
        throw new Error('unused');
      },
      async synchronize() {
        if (failSynchronization) throw new Error('synchronization failed');
        return {
          kind: 'foundation-synchronization-response',
          mode: 'full',
          reason: 'no-baseline',
          baseline: parseFoundationFullBaseline({
            kind: 'foundation-full-baseline',
            gameId,
            timelineId,
            commandRevision: 0,
            simulationTick: 0,
            lastIncludedStreamOffset: 0,
            readModel: { tick: 0 },
          }),
        } as const;
      },
      async exportSnapshot() {
        throw new Error('unused');
      },
      subscribeReliableUpdates(listener) {
        reliable = listener;
        return () => undefined;
      },
      subscribeRenderSnapshots(listener) {
        render = listener;
        return () => undefined;
      },
      getLifecycle: () => ({ state: 'idle' }),
      subscribeLifecycle: () => () => undefined,
      async close() {
        // Retain callbacks to model an already-queued stale publication.
      },
    };
    const controller = createFoundationApplicationController({
      repository: createInMemoryFoundationSaveRepository(),
      clientFactory: () => fake,
    });
    await controller.startNew({ gameId, timelineId, initialSimulationTick: 0 });
    expect(subscribedBeforeConnect).toBe(true);
    failSynchronization = true;
    await expect(controller.synchronize()).rejects.toThrow(
      'synchronization failed',
    );
    expect(controller.projection.getState().synchronization).toEqual({
      status: 'failed',
      message: 'synchronization failed',
    });
    const update = (
      offset: number,
      updateTimeline = timelineId,
    ): FoundationStateUpdate =>
      Object.freeze({
        kind: 'foundation-state-update',
        gameId,
        timelineId: updateTimeline,
        streamOffset: parseStreamOffset(offset),
        commandRevision: parseCommandRevision(offset),
        simulationTick: offset,
      });
    reliable?.(update(1));
    reliable?.(update(1));
    reliable?.(update(3));
    expect(controller.projection.getState().synchronization).toEqual({
      status: 'required',
      reason: 'gap',
    });
    reliable?.(update(2, parseTimelineId('other')));
    expect(controller.projection.getState().synchronization).toEqual({
      status: 'required',
      reason: 'timeline-mismatch',
    });
    const snapshot = (
      sequence: number,
      snapshotTimeline = timelineId,
    ): FoundationRenderSnapshot =>
      Object.freeze({
        kind: 'foundation-render-snapshot',
        gameId,
        timelineId: snapshotTimeline,
        sequence: parseRenderSnapshotSequence(sequence),
        commandRevision: parseCommandRevision(sequence),
        simulationTick: sequence,
      });
    render?.(snapshot(2));
    render?.(snapshot(1));
    render?.(snapshot(3, parseTimelineId('other')));
    expect(
      controller.projection.getState().latestRenderSnapshot?.sequence,
    ).toBe(2);
    await controller.close();
    expect(() => reliable?.(update(2))).not.toThrow();
    expect(controller.projection.getState().session).toEqual({
      status: 'closed',
    });
  });

  it('exposes a read-only projection and rejects a second active start', async () => {
    let constructions = 0;
    const controller = createFoundationApplicationController({
      repository: createInMemoryFoundationSaveRepository(),
      clientFactory: () => {
        constructions += 1;
        return createDirectFoundationClient();
      },
    });
    expect('setState' in controller.projection).toBe(false);
    await controller.startNew({ gameId, timelineId, initialSimulationTick: 0 });
    await expect(
      controller.startNew({ gameId, timelineId, initialSimulationTick: 0 }),
    ).rejects.toThrow('active');
    expect(constructions).toBe(1);
    // @ts-expect-error consumers receive no writable Zustand API
    const unavailableSetState = controller.projection.setState;
    expect(unavailableSetState).toBeUndefined();
    await controller.close();
  });

  it('makes concurrent close callers await the same repository cleanup', async () => {
    let release: (() => void) | undefined;
    const repository = createInMemoryFoundationSaveRepository();
    const delayed = {
      ...repository,
      close: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    };
    const controller = createFoundationApplicationController({
      repository: delayed,
      clientFactory: createDirectFoundationClient,
    });
    const first = controller.close();
    const second = controller.close();
    let secondFinished = false;
    void second.then(() => {
      secondFinished = true;
    });
    await expect.poll(() => release).toBeTypeOf('function');
    expect(secondFinished).toBe(false);
    release?.();
    await Promise.all([first, second]);
    expect(controller.projection.getState().session).toEqual({
      status: 'closed',
    });
  });

  it('normalizes persistence and post-teardown restore failures', async () => {
    const backing = createInMemoryFoundationSaveRepository();
    let failList = false;
    const repository = {
      ...backing,
      list: async () => {
        if (failList) throw new Error('list failed');
        return backing.list();
      },
    };
    let construction = 0;
    const controller = createFoundationApplicationController({
      repository,
      clientFactory: () => {
        construction += 1;
        const base = createDirectFoundationClient();
        if (construction === 1) return base;
        return Object.freeze({
          ...base,
          async connect() {
            throw new Error('restore activation failed');
          },
        });
      },
    });
    await controller.startNew({ gameId, timelineId, initialSimulationTick: 0 });
    failList = true;
    await expect(
      controller.save({
        saveId: 'saved-despite-list',
        createdAtUtcMs: 1,
        updatedAtUtcMs: 1,
      }),
    ).rejects.toThrow('list failed');
    expect(controller.projection.getState().persistence).toMatchObject({
      status: 'failed',
      message: 'list failed',
    });
    failList = false;
    await controller
      .restore({
        saveId: 'saved-despite-list',
        newTimelineId: parseTimelineId('failed-restore'),
      })
      .catch(() => undefined);
    expect(controller.projection.getState().session).toMatchObject({
      status: 'failed',
    });
    expect(controller.projection.getState().persistence).toMatchObject({
      status: 'failed',
    });
    await controller.close();
  });

  it('keeps a successful restored session ready when its save-list refresh fails', async () => {
    const backing = createInMemoryFoundationSaveRepository();
    let failList = false;
    const repository = {
      ...backing,
      list: async () => {
        if (failList) throw new Error('refresh failed');
        return backing.list();
      },
    };
    const controller = createFoundationApplicationController({
      repository,
      clientFactory: createDirectFoundationClient,
    });
    await controller.startNew({ gameId, timelineId, initialSimulationTick: 3 });
    await controller.save({
      saveId: 'restore-refresh',
      createdAtUtcMs: 1,
      updatedAtUtcMs: 1,
    });
    failList = true;
    const restoredTimeline = parseTimelineId('refresh-restored');
    await expect(
      controller.restore({
        saveId: 'restore-refresh',
        newTimelineId: restoredTimeline,
      }),
    ).rejects.toThrow('refresh failed');
    expect(controller.projection.getState()).toMatchObject({
      session: { status: 'ready', timelineId: restoredTimeline },
      authoritative: { simulationTick: 3, commandRevision: 0, streamOffset: 0 },
      persistence: {
        status: 'failed',
        message: 'refresh failed',
        saves: [{ saveId: 'restore-refresh' }],
      },
    });
    await controller.close().catch(() => undefined);
  });

  it('closes a replacement client when close begins during delayed restore activation', async () => {
    const repository = createInMemoryFoundationSaveRepository();
    let releaseConnect: (() => void) | undefined;
    let replacementCloseCount = 0;
    let construction = 0;
    const controller = createFoundationApplicationController({
      repository,
      clientFactory: () => {
        construction += 1;
        const base = createDirectFoundationClient();
        if (construction === 1) return base;
        return Object.freeze({
          ...base,
          async connect(
            request: Parameters<FoundationSimulationClient['connect']>[0],
          ) {
            await new Promise<void>((resolve) => {
              releaseConnect = resolve;
            });
            return base.connect(request);
          },
          async close() {
            replacementCloseCount += 1;
            await base.close();
          },
        });
      },
    });
    await controller.startNew({ gameId, timelineId, initialSimulationTick: 1 });
    await controller.save({
      saveId: 'delayed',
      createdAtUtcMs: 1,
      updatedAtUtcMs: 1,
    });
    const restoring = controller.restore({
      saveId: 'delayed',
      newTimelineId: parseTimelineId('delayed-new'),
    });
    await expect.poll(() => releaseConnect).toBeTypeOf('function');
    const closing = controller.close();
    releaseConnect?.();
    await restoring.catch(() => undefined);
    await closing.catch(() => undefined);
    expect(replacementCloseCount).toBeGreaterThan(0);
    expect(controller.projection.getState().session).toEqual({
      status: 'closed',
    });
  });

  it('fails restore safely when closing the old client fails', async () => {
    const repository = createInMemoryFoundationSaveRepository();
    const base = createDirectFoundationClient();
    let constructions = 0;
    const controller = createFoundationApplicationController({
      repository,
      clientFactory: () => {
        constructions += 1;
        if (constructions > 1) return createDirectFoundationClient();
        return Object.freeze({
          ...base,
          async close() {
            await base.close();
            throw new Error('old close failed');
          },
        });
      },
    });
    await controller.startNew({ gameId, timelineId, initialSimulationTick: 0 });
    await controller.save({
      saveId: 'old-close',
      createdAtUtcMs: 1,
      updatedAtUtcMs: 1,
    });
    await expect(
      controller.restore({
        saveId: 'old-close',
        newTimelineId: parseTimelineId('old-close-new'),
      }),
    ).rejects.toThrow('old close failed');
    expect(constructions).toBe(1);
    expect(controller.projection.getState().session).toMatchObject({
      status: 'failed',
    });
    expect(controller.projection.getState().persistence).toMatchObject({
      status: 'failed',
    });
    await controller.close().catch(() => undefined);
  });

  it('clears a failed replacement even when its activation cleanup close rejects', async () => {
    const repository = createInMemoryFoundationSaveRepository();
    let construction = 0;
    let failedCloseCount = 0;
    const controller = createFoundationApplicationController({
      repository,
      clientFactory: () => {
        construction += 1;
        if (construction === 1) return createDirectFoundationClient();
        const failed = createDirectFoundationClient();
        return Object.freeze({
          ...failed,
          async connect() {
            throw new Error('activation failed');
          },
          async close() {
            failedCloseCount += 1;
            throw new Error('cleanup failed');
          },
        });
      },
    });
    await controller.startNew({ gameId, timelineId, initialSimulationTick: 0 });
    await controller.save({
      saveId: 'cleanup',
      createdAtUtcMs: 1,
      updatedAtUtcMs: 1,
    });
    await expect(
      controller.restore({
        saveId: 'cleanup',
        newTimelineId: parseTimelineId('cleanup-new'),
      }),
    ).rejects.toThrow();
    expect(failedCloseCount).toBe(1);
    expect(controller.projection.getState().session).toMatchObject({
      status: 'failed',
    });
    await controller.close().catch(() => undefined);
  });

  it('attempts client and repository cleanup and becomes terminal when both fail', async () => {
    const backing = createInMemoryFoundationSaveRepository();
    let repositoryCloseCount = 0;
    const repository = {
      ...backing,
      async close() {
        repositoryCloseCount += 1;
        throw new Error('repository close failed');
      },
    };
    const base = createDirectFoundationClient();
    let clientCloseCount = 0;
    const controller = createFoundationApplicationController({
      repository,
      clientFactory: () =>
        Object.freeze({
          ...base,
          async close() {
            clientCloseCount += 1;
            await base.close();
            throw new Error('client close failed');
          },
        }),
    });
    await controller.startNew({ gameId, timelineId, initialSimulationTick: 0 });
    const first = controller.close();
    const second = controller.close();
    expect(first).toBe(second);
    await expect(first).rejects.toThrow();
    await expect(second).rejects.toThrow();
    expect(clientCloseCount).toBe(1);
    expect(repositoryCloseCount).toBe(1);
    expect(controller.projection.getState().session).toEqual({
      status: 'closed',
    });
    await expect(controller.listSaves()).rejects.toThrow('closed');
  });
});
