import { parseGameId, parseTimelineId } from '@torrevieja-tycoon/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { FoundationApplicationState } from './application/foundation-controller.js';
import {
  createFoundationSessionComposition,
  type FoundationSessionStack,
  type FoundationSessionTimer,
} from './foundation-session-composition.js';
import type { FoundationPacingState } from './pacing/foundation-pacing-controller.js';

function projection<T>(initial: T) {
  let state = initial;
  const listeners = new Set<(value: T, previous: T) => void>();
  return {
    api: Object.freeze({
      getState: () => state,
      subscribe(listener: (value: T, previous: T) => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    }),
    set(next: T) {
      const previous = state;
      state = next;
      for (const listener of [...listeners]) listener(next, previous);
    },
    listenerCount: () => listeners.size,
  };
}

function fakeTimer(): FoundationSessionTimer & {
  fire(): Promise<void>;
  activeCount(): number;
  createdCount(): number;
} {
  let id = 0;
  let created = 0;
  const callbacks = new Map<number, () => void>();
  return {
    setInterval(callback, milliseconds) {
      expect(milliseconds).toBe(3_000);
      created += 1;
      callbacks.set(++id, callback);
      return id;
    },
    clearInterval(intervalId) {
      if (typeof intervalId === 'number') callbacks.delete(intervalId);
    },
    async fire() {
      for (const callback of [...callbacks.values()]) callback();
      await Promise.resolve();
      await Promise.resolve();
    },
    activeCount: () => callbacks.size,
    createdCount: () => created,
  };
}

function harness(options?: {
  confirm?: (message: string) => boolean | Promise<boolean>;
}) {
  const timer = fakeTimer();
  const saves = new Set<string>();
  const saveSources = new Map<string, string>();
  const stacks: Array<{
    stack: FoundationSessionStack;
    app: ReturnType<typeof projection<FoundationApplicationState>>;
    pacing: ReturnType<typeof projection<FoundationPacingState>>;
    save: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    listSaves: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    setMode: ReturnType<typeof vi.fn>;
    bonus: ReturnType<typeof vi.fn>;
    pacingClose: ReturnType<typeof vi.fn>;
    driverClose: ReturnType<typeof vi.fn>;
    pulse: ((elapsed: number) => Promise<void>) | undefined;
  }> = [];
  let delayedSave: Promise<void> | undefined;
  let delayedRestore: Promise<void> | undefined;
  let nextSaveFailure: Error | undefined;
  let nextListFailure: Error | undefined;
  const createStack = () => {
    const app = projection<FoundationApplicationState>({
      session: { status: 'idle' },
      synchronization: { status: 'idle' },
      persistence: { status: 'idle', saves: [] },
    });
    const pacing = projection<FoundationPacingState>({
      status: 'paused',
      mode: 'paused',
      selectedRate: 0,
      effectiveRate: 0,
      creditGameMicroseconds: 0,
      remainingDoubleSpeedBonusTicks: 0,
      advancedTicksTotal: 0,
    });
    const refreshSaves = () =>
      app.set({
        ...app.api.getState(),
        persistence: {
          status: 'idle',
          saves: [...saves].map((saveId) => ({
            saveId,
            sourceTimelineId: saveSources.get(saveId),
          })) as never,
        },
      });
    const save = vi.fn(async ({ saveId }: { saveId: unknown }) => {
      if (delayedSave) await delayedSave;
      if (nextSaveFailure) {
        const failure = nextSaveFailure;
        nextSaveFailure = undefined;
        throw failure;
      }
      saves.add(String(saveId));
      const session = app.api.getState().session;
      if (session.status === 'ready')
        saveSources.set(String(saveId), session.timelineId);
      refreshSaves();
    });
    const restore = vi.fn(
      async ({ newTimelineId }: { saveId: unknown; newTimelineId: string }) => {
        if (delayedRestore) await delayedRestore;
        app.set({
          ...app.api.getState(),
          session: {
            status: 'ready',
            gameId: parseGameId('browser-foundation-game'),
            timelineId: parseTimelineId(newTimelineId),
          },
        });
      },
    );
    const listSaves = vi.fn(async () => {
      if (nextListFailure) {
        const failure = nextListFailure;
        nextListFailure = undefined;
        throw failure;
      }
      refreshSaves();
      return app.api.getState().persistence.saves;
    });
    const close = vi.fn(async () => {
      app.set({ ...app.api.getState(), session: { status: 'closed' } });
    });
    const setMode = vi.fn(async () => undefined);
    const bonus = vi.fn(async () => undefined);
    const pacingClose = vi.fn(async () => {
      pacing.set({ ...pacing.api.getState(), status: 'closed' });
    });
    const driverClose = vi.fn();
    const entry = {
      stack: {
        application: {
          projection: app.api,
          async startNew(request) {
            app.set({
              ...app.api.getState(),
              session: {
                status: 'ready',
                gameId: request.gameId,
                timelineId: request.timelineId,
              },
            });
          },
          save,
          restore,
          listSaves,
          close,
        },
        pacing: {
          projection: pacing.api,
          setMode,
          grantDoubleSpeedBonus: bonus,
          advanceByElapsedMicroseconds: vi.fn(async () => undefined),
          close: pacingClose,
        },
        driver: {
          start(callback) {
            entry.pulse = callback;
          },
          close: driverClose,
        },
      } satisfies FoundationSessionStack,
      app,
      pacing,
      save,
      restore,
      listSaves,
      close,
      setMode,
      bonus,
      pacingClose,
      driverClose,
      pulse: undefined as ((elapsed: number) => Promise<void>) | undefined,
    };
    stacks.push(entry);
    return entry.stack;
  };
  const composition = createFoundationSessionComposition({
    createStack,
    confirm: options?.confirm ?? (() => true),
    timer,
    autosaveIntervalMs: 3_000,
    nowUtcMs: () => 1,
  });
  return {
    composition,
    timer,
    stacks,
    saves,
    delaySave(promise: Promise<void>) {
      delayedSave = promise;
    },
    delayRestore(promise: Promise<void>) {
      delayedRestore = promise;
    },
    failNextSave(error: Error) {
      nextSaveFailure = error;
    },
    failNextList(error: Error) {
      nextListFailure = error;
    },
  };
}

describe('foundation session composition', () => {
  it('serializes deferred confirmations as operations', async () => {
    let answer!: (value: boolean) => void;
    const confirm = vi.fn(
      () => new Promise<boolean>((resolve) => (answer = resolve)),
    );
    const { composition, stacks } = harness({ confirm });
    await composition.startNewSession();
    await composition.saveManual();

    const first = composition.restoreManual();
    const second = composition.restoreManual();
    await Promise.resolve();
    expect(composition.projection.getState().operation).toBe(
      'confirming-restore',
    );
    expect(confirm).toHaveBeenCalledOnce();
    expect(stacks[0]?.restore).not.toHaveBeenCalled();
    answer(true);
    await Promise.all([first, second]);
    expect(stacks[0]?.restore).toHaveBeenCalledOnce();
  });

  it('uses the selected save mode as the save and restore target', async () => {
    const { composition, stacks } = harness();
    await composition.startNewSession();
    expect(composition.projection.getState().manualSaveAvailable).toBe(false);
    await composition.setSaveMode('autosave');
    expect(composition.projection.getState().autosaveSaveAvailable).toBe(false);
    await composition.saveManual();
    expect(stacks[0]?.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ saveId: 'foundation-autosave' }),
    );
    expect(composition.projection.getState().autosaveSaveAvailable).toBe(true);
    await composition.restoreManual();
    expect(stacks[0]?.restore).toHaveBeenLastCalledWith(
      expect.objectContaining({ saveId: 'foundation-autosave' }),
    );
  });

  it('deeply freezes every published composition projection', async () => {
    const { composition } = harness();
    await composition.startNewSession();
    await composition.closeSession();
    const state = composition.projection.getState();
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.application)).toBe(true);
    expect(Object.isFrozen(state.application.session)).toBe(true);
    expect(Object.isFrozen(state.application.persistence.saves)).toBe(true);
    expect(Object.isFrozen(state.pacing)).toBe(true);
  });

  it('invalidates a pending confirmation when close replaces the stack', async () => {
    let answer!: (value: boolean) => void;
    const { composition, stacks } = harness({
      confirm: () => new Promise<boolean>((resolve) => (answer = resolve)),
    });
    await composition.startNewSession();
    await composition.saveManual();
    const restoring = composition.restoreManual();
    await Promise.resolve();
    await composition.closeSession();
    await composition.startNewSession();
    answer(true);
    await restoring;
    expect(stacks[0]?.restore).not.toHaveBeenCalled();
    expect(stacks[1]?.restore).not.toHaveBeenCalled();
    expect(composition.projection.getState().application.session.status).toBe(
      'ready',
    );
  });

  it('does not silently overwrite when refreshing save summaries fails', async () => {
    const { composition, stacks, failNextList } = harness();
    await composition.startNewSession();
    failNextList(new Error('save list unavailable'));
    await composition.saveManual();
    expect(stacks[0]?.save).not.toHaveBeenCalled();
    expect(composition.projection.getState().message).toBe(
      'save list unavailable',
    );
    expect(composition.projection.getState().operation).toBe('idle');
  });

  it('shares close cleanup and remains terminal when driver cleanup throws', async () => {
    const { composition, stacks } = harness();
    await composition.startNewSession();
    stacks[0]?.driverClose.mockImplementationOnce(() => {
      throw new Error('driver cleanup unavailable');
    });
    const first = composition.closeSession();
    const second = composition.closeSession();
    expect(second).toBe(first);
    await expect(Promise.all([first, second])).resolves.toBeDefined();
    expect(stacks[0]?.driverClose).toHaveBeenCalledOnce();
    expect(stacks[0]?.pacingClose).toHaveBeenCalledOnce();
    expect(stacks[0]?.close).toHaveBeenCalledOnce();
    expect(composition.projection.getState()).toMatchObject({
      application: { session: { status: 'closed' } },
      operation: 'idle',
      canStartNewSession: true,
      message: 'driver cleanup unavailable',
    });
  });

  it('validates the injected autosave interval', () => {
    const base = {
      createStack: () => {
        throw new Error('unused');
      },
      confirm: () => true,
      timer: fakeTimer(),
      nowUtcMs: () => 1,
    };
    expect(() =>
      createFoundationSessionComposition({ ...base, autosaveIntervalMs: 0 }),
    ).toThrow('positive safe integer');
    expect(() =>
      createFoundationSessionComposition({
        ...base,
        autosaveIntervalMs: 1.5,
      }),
    ).toThrow('positive safe integer');
  });

  it('supports save, restore, save, restore with fresh non-source timelines', async () => {
    const { composition, stacks } = harness();
    await composition.startNewSession();
    await composition.saveManual();
    await composition.restoreManual();
    await composition.saveManual();
    await composition.restoreManual();

    expect(stacks[0]?.restore).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        newTimelineId: 'browser-foundation-restored-1',
      }),
    );
    expect(stacks[0]?.restore).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        newTimelineId: 'browser-foundation-restored-2',
      }),
    );
    expect(composition.projection.getState().application.session).toMatchObject(
      { status: 'ready', timelineId: 'browser-foundation-restored-2' },
    );
  });

  it('cancels restore before teardown and confirmed restore remains usable', async () => {
    const confirm = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const { composition, stacks } = harness({ confirm });
    await composition.startNewSession();
    await composition.saveManual();
    const original = composition.projection.getState().application.session;

    await composition.restoreManual();
    expect(stacks[0]?.restore).not.toHaveBeenCalled();
    expect(stacks[0]?.close).not.toHaveBeenCalled();
    expect(composition.projection.getState().application.session).toEqual(
      original,
    );

    await composition.restoreManual();
    await composition.setMode('normal');
    await composition.saveManual();
    expect(stacks[0]?.restore).toHaveBeenCalledOnce();
    expect(stacks[0]?.stack.pacing.setMode).toHaveBeenCalledWith('normal');
  });

  it('confirms only manual overwrite and cancellation performs no write', async () => {
    const confirm = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const { composition, stacks } = harness({ confirm });
    await composition.startNewSession();
    await composition.saveManual();
    expect(confirm).not.toHaveBeenCalled();
    expect(stacks[0]?.save).toHaveBeenCalledOnce();

    await composition.saveManual();
    expect(confirm).toHaveBeenCalledWith(
      'This will overwrite your previous saved session. Continue?',
    );
    expect(stacks[0]?.save).toHaveBeenCalledOnce();
    expect(composition.projection.getState().operation).toBe('idle');

    await composition.saveManual();
    expect(stacks[0]?.save).toHaveBeenCalledTimes(2);
  });

  it('autosaves on an injected interval, overwrites silently, and never overlaps', async () => {
    const confirm = vi.fn(() => true);
    const { composition, stacks, timer, delaySave } = harness({ confirm });
    await composition.startNewSession();
    await composition.setSaveMode('autosave');
    expect(timer.activeCount()).toBe(1);

    let release!: () => void;
    delaySave(new Promise<void>((resolve) => (release = resolve)));
    await timer.fire();
    await timer.fire();
    expect(stacks[0]?.save).toHaveBeenCalledOnce();
    release();
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
    await timer.fire();
    expect(stacks[0]?.save).toHaveBeenCalledTimes(2);
    expect(stacks[0]?.save).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ saveId: 'foundation-autosave' }),
    );
    expect(stacks[0]?.save).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ saveId: 'foundation-autosave' }),
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it('cancels autosave in manual mode and while restoring or closing', async () => {
    const { composition, timer, stacks, delayRestore } = harness();
    await composition.startNewSession();
    await composition.setSaveMode('autosave');
    await composition.setSaveMode('manual');
    expect(timer.activeCount()).toBe(0);

    await composition.setSaveMode('autosave');
    await composition.saveManual();
    stacks[0]?.save.mockClear();
    let release!: () => void;
    delayRestore(new Promise<void>((resolve) => (release = resolve)));
    const restoring = composition.restoreManual();
    await Promise.resolve();
    expect(timer.activeCount()).toBe(0);
    await timer.fire();
    expect(stacks[0]?.save).not.toHaveBeenCalled();
    release();
    await restoring;
    expect(timer.activeCount()).toBe(1);

    await composition.closeSession();
    expect(timer.activeCount()).toBe(0);
  });

  it('installs exactly one schedule after replacement and recovers after autosave failure', async () => {
    const { composition, timer, failNextSave, stacks } = harness();
    await composition.startNewSession();
    await composition.setSaveMode('autosave');
    failNextSave(new Error('autosave unavailable'));
    await timer.fire();
    expect(composition.projection.getState()).toMatchObject({
      message: 'autosave unavailable',
      saveMode: 'autosave',
    });
    await timer.fire();
    expect(stacks[0]?.save).toHaveBeenCalledTimes(2);

    await composition.closeSession();
    await composition.startNewSession();
    expect(timer.activeCount()).toBe(1);
    expect(timer.createdCount()).toBe(2);
  });

  it('starts a completely new stack after close while retaining saves', async () => {
    const { composition, stacks } = harness();
    await composition.startNewSession();
    await composition.saveManual();
    const staleApplication = stacks[0]?.app;
    await composition.closeSession();
    expect(composition.projection.getState().canStartNewSession).toBe(true);

    await composition.startNewSession();
    expect(stacks).toHaveLength(2);
    expect(stacks[0]?.driverClose).toHaveBeenCalledOnce();
    expect(stacks[0]?.close).toHaveBeenCalledOnce();
    expect(
      composition.projection.getState().application.persistence.saves,
    ).toHaveLength(1);
    staleApplication?.set({
      ...staleApplication.api.getState(),
      session: { status: 'failed', message: 'stale' },
    });
    stacks[0]?.pacing.set({
      ...stacks[0].pacing.api.getState(),
      status: 'failed',
      message: 'stale pacing',
    });
    expect(composition.projection.getState().application.session.status).toBe(
      'ready',
    );
    expect(composition.projection.getState().pacing.message).toBeUndefined();
  });

  it('keeps a failed restore visible and retryable with another fresh timeline', async () => {
    const { composition, stacks } = harness();
    await composition.startNewSession();
    await composition.saveManual();
    stacks[0]?.restore.mockRejectedValueOnce(new Error('restore unavailable'));

    await expect(composition.restoreManual()).resolves.toBeUndefined();
    expect(composition.projection.getState()).toMatchObject({
      message: 'restore unavailable',
      operation: 'idle',
    });
    await expect(composition.restoreManual()).resolves.toBeUndefined();
    expect(stacks[0]?.restore).toHaveBeenLastCalledWith(
      expect.objectContaining({
        newTimelineId: 'browser-foundation-restored-2',
      }),
    );
    expect(composition.projection.getState().message).toBeUndefined();
  });

  it('does not leak subscriptions or schedules across repeated close/start cycles', async () => {
    const { composition, stacks, timer } = harness();
    await composition.startNewSession();
    await composition.setSaveMode('autosave');
    await composition.closeSession();
    await composition.startNewSession();
    await composition.closeSession();
    await composition.startNewSession();

    expect(timer.activeCount()).toBe(1);
    expect(stacks.map(({ app }) => app.listenerCount())).toEqual([0, 0, 1]);
    expect(stacks.map(({ pacing }) => pacing.listenerCount())).toEqual([
      0, 0, 1,
    ]);
  });

  it('contains confirmation exceptions and rejected UI operations', async () => {
    const confirm = vi.fn(async () => {
      throw new Error('dialog unavailable');
    });
    const { composition, stacks } = harness({ confirm });
    await expect(composition.startNewSession()).resolves.toBeUndefined();
    await composition.saveManual();
    await expect(composition.saveManual()).resolves.toBeUndefined();
    expect(composition.projection.getState().message).toBe(
      'dialog unavailable',
    );
    stacks[0]?.restore.mockRejectedValueOnce(new Error('restore failed'));
    await expect(composition.restoreManual()).resolves.toBeUndefined();
    expect(composition.projection.getState().message).toBe(
      'dialog unavailable',
    );
  });

  it('contains stack-construction, pacing-control, and cleanup failures', async () => {
    const construction = createFoundationSessionComposition({
      createStack: () => {
        throw new Error('stack unavailable');
      },
      confirm: () => true,
      timer: fakeTimer(),
      autosaveIntervalMs: 3_000,
      nowUtcMs: () => 1,
    });
    await expect(construction.startNewSession()).resolves.toBeUndefined();
    expect(construction.projection.getState()).toMatchObject({
      message: 'stack unavailable',
      canStartNewSession: true,
    });

    const { composition, stacks } = harness();
    await composition.saveManual();
    await composition.restoreManual();
    await composition.closeSession();
    await composition.setMode('normal');
    await composition.grantBonus();
    await composition.startNewSession();
    stacks[0]?.setMode.mockRejectedValueOnce(new Error('mode unavailable'));
    await composition.setMode('normal');
    expect(composition.projection.getState().message).toBe('mode unavailable');
    stacks[0]?.bonus.mockRejectedValueOnce(new Error('bonus unavailable'));
    await composition.grantBonus();
    expect(composition.projection.getState().message).toBe('bonus unavailable');
    stacks[0]?.pacingClose.mockRejectedValueOnce('cleanup unavailable');
    await composition.closeSession();
    expect(composition.projection.getState().message).toBe('Operation failed.');
  });

  it('invalidates pending save, restore, and autosave completions during close', async () => {
    const manual = harness();
    await manual.composition.startNewSession();
    let releaseManual!: () => void;
    manual.delaySave(
      new Promise<void>((resolve) => {
        releaseManual = resolve;
      }),
    );
    const saving = manual.composition.saveManual();
    await Promise.resolve();
    await manual.composition.closeSession();
    releaseManual();
    await saving;
    expect(
      manual.composition.projection.getState().application.session.status,
    ).toBe('closed');

    const restoringHarness = harness();
    await restoringHarness.composition.startNewSession();
    await restoringHarness.composition.saveManual();
    let releaseRestore!: () => void;
    restoringHarness.delayRestore(
      new Promise<void>((resolve) => {
        releaseRestore = resolve;
      }),
    );
    const restoring = restoringHarness.composition.restoreManual();
    await Promise.resolve();
    await restoringHarness.composition.closeSession();
    releaseRestore();
    await restoring;
    expect(
      restoringHarness.composition.projection.getState().application.session
        .status,
    ).toBe('closed');

    const automatic = harness();
    await automatic.composition.startNewSession();
    await automatic.composition.setSaveMode('autosave');
    let releaseAutosave!: () => void;
    automatic.delaySave(
      new Promise<void>((resolve) => {
        releaseAutosave = resolve;
      }),
    );
    await automatic.timer.fire();
    await automatic.composition.closeSession();
    releaseAutosave();
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    expect(automatic.timer.activeCount()).toBe(0);
    expect(
      automatic.composition.projection.getState().application.session.status,
    ).toBe('closed');
  });

  it('ignores duplicate starts and remains terminal after disposal', async () => {
    const { composition, stacks } = harness();
    await composition.startNewSession();
    await composition.startNewSession();
    expect(stacks).toHaveLength(1);
    await composition.dispose();
    await composition.startNewSession();
    expect(stacks).toHaveLength(1);
    expect(composition.projection.getState().canStartNewSession).toBe(false);
  });
});
