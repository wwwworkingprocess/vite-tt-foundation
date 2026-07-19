import { createStore } from 'zustand/vanilla';
import {
  parseGameId,
  parseTimelineId,
  type TimelineId,
} from '@torrevieja-tycoon/protocol';
import type {
  ApplicationSaveSummary,
  FoundationApplicationState,
} from './application/foundation-controller.js';
import type { createBrowserPacingDriver } from './pacing/browser-pacing-driver.js';
import type {
  FoundationPacingState,
  createFoundationPacingController,
} from './pacing/foundation-pacing-controller.js';

type Pacing = ReturnType<typeof createFoundationPacingController>;
type Driver = ReturnType<typeof createBrowserPacingDriver>;

export interface FoundationSessionStack {
  readonly application: {
    readonly projection: {
      getState(): FoundationApplicationState;
      subscribe(
        listener: (state: FoundationApplicationState) => void,
      ): () => void;
    };
    startNew(request: {
      gameId: ReturnType<typeof parseGameId>;
      timelineId: TimelineId;
      initialSimulationTick: number;
    }): Promise<void>;
    save(metadata: {
      saveId: string;
      label?: string;
      createdAtUtcMs: number;
      updatedAtUtcMs: number;
    }): Promise<void>;
    restore(request: {
      saveId: string;
      newTimelineId: TimelineId;
    }): Promise<void>;
    listSaves(): Promise<readonly ApplicationSaveSummary[]>;
    close(): Promise<void>;
  };
  readonly pacing: Pick<
    Pacing,
    | 'projection'
    | 'setMode'
    | 'grantDoubleSpeedBonus'
    | 'advanceByElapsedMicroseconds'
    | 'close'
  >;
  readonly driver: Pick<Driver, 'start' | 'close'>;
}

export interface FoundationSessionTimer {
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(id: unknown): void;
}

export type FoundationSaveMode = 'manual' | 'autosave';
export type FoundationSessionOperation =
  | 'idle'
  | 'starting'
  | 'confirming-save'
  | 'confirming-restore'
  | 'saving'
  | 'restoring'
  | 'closing';

export interface FoundationSessionCompositionState {
  readonly application: FoundationApplicationState;
  readonly pacing: FoundationPacingState;
  readonly saveMode: FoundationSaveMode;
  readonly manualSaveAvailable: boolean;
  readonly autosaveSaveAvailable: boolean;
  readonly operation: FoundationSessionOperation;
  readonly canStartNewSession: boolean;
  readonly message?: string | undefined;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

const idleApplication = deepFreeze<FoundationApplicationState>({
  session: { status: 'idle' },
  synchronization: { status: 'idle' },
  persistence: { status: 'idle', saves: [] },
});
const idlePacing = deepFreeze<FoundationPacingState>({
  status: 'paused',
  mode: 'paused',
  selectedRate: 0,
  effectiveRate: 0,
  creditGameMicroseconds: 0,
  remainingDoubleSpeedBonusTicks: 0,
  advancedTicksTotal: 0,
});
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Operation failed.';
const saveId = (mode: FoundationSaveMode) =>
  mode === 'manual' ? 'foundation-slot' : 'foundation-autosave';

export function createFoundationSessionComposition(input: {
  readonly createStack: () => FoundationSessionStack;
  readonly confirm: (message: string) => boolean | Promise<boolean>;
  readonly timer: FoundationSessionTimer;
  readonly autosaveIntervalMs?: number;
  readonly nowUtcMs: () => number;
}) {
  const autosaveIntervalMs = input.autosaveIntervalMs ?? 30_000;
  if (!Number.isSafeInteger(autosaveIntervalMs) || autosaveIntervalMs <= 0)
    throw new Error('Autosave interval must be a positive safe integer.');

  const initial = deepFreeze<FoundationSessionCompositionState>({
    application: idleApplication,
    pacing: idlePacing,
    saveMode: 'manual',
    manualSaveAvailable: false,
    autosaveSaveAvailable: false,
    operation: 'idle',
    canStartNewSession: true,
  });
  const store = createStore<FoundationSessionCompositionState>(() => initial);
  let stack: FoundationSessionStack | undefined;
  let removeApplication: (() => void) | undefined;
  let removePacing: (() => void) | undefined;
  let interval: unknown;
  let generation = 0;
  let sessionSequence = 0;
  let restoreSequence = 0;
  let disposed = false;
  let autosaveOwnerGeneration: number | undefined;
  let closePromise: Promise<void> | undefined;
  const issuedRestoreTimelines = new Set<TimelineId>();

  const availability = (application: FoundationApplicationState) => ({
    manualSaveAvailable: application.persistence.saves.some(
      (save) => save.saveId === 'foundation-slot',
    ),
    autosaveSaveAvailable: application.persistence.saves.some(
      (save) => save.saveId === 'foundation-autosave',
    ),
  });
  const set = (patch: Partial<FoundationSessionCompositionState>) =>
    store.setState(deepFreeze({ ...store.getState(), ...patch }), true);
  const currentContext = (candidate: FoundationSessionStack, token: number) =>
    !disposed && stack === candidate && generation === token;
  const readyContext = (candidate: FoundationSessionStack, token: number) =>
    currentContext(candidate, token) &&
    store.getState().application.session.status === 'ready';
  const removeSubscriptions = () => {
    removeApplication?.();
    removePacing?.();
    removeApplication = undefined;
    removePacing = undefined;
  };
  const cancelAutosave = () => {
    if (interval !== undefined) input.timer.clearInterval(interval);
    interval = undefined;
  };
  const shouldArmAutosave = () => {
    const state = store.getState();
    return (
      !disposed &&
      stack !== undefined &&
      state.saveMode === 'autosave' &&
      state.operation === 'idle' &&
      state.application.session.status === 'ready'
    );
  };
  const armAutosaveInterval = () => {
    cancelAutosave();
    if (shouldArmAutosave())
      interval = input.timer.setInterval(() => {
        void autosave();
      }, autosaveIntervalMs);
  };
  const metadata = (mode: FoundationSaveMode) => {
    const now = input.nowUtcMs();
    return {
      saveId: saveId(mode),
      label: mode === 'manual' ? 'Foundation slot' : 'Foundation autosave',
      createdAtUtcMs: now,
      updatedAtUtcMs: now,
    };
  };
  const recordError = (
    error: unknown,
    candidate?: FoundationSessionStack,
    token?: number,
  ) => {
    if (!candidate || token === undefined || currentContext(candidate, token))
      set({ message: errorMessage(error) });
  };
  const finish = (candidate: FoundationSessionStack, token: number) => {
    if (!currentContext(candidate, token)) return;
    set({ operation: 'idle' });
    armAutosaveInterval();
  };

  async function autosave() {
    const candidate = stack;
    const token = generation;
    if (!candidate || !shouldArmAutosave() || autosaveOwnerGeneration === token)
      return;
    autosaveOwnerGeneration = token;
    set({ operation: 'saving' });
    try {
      await candidate.application.save(metadata('autosave'));
      if (currentContext(candidate, token)) set({ message: undefined });
    } catch (error) {
      recordError(error, candidate, token);
    } finally {
      if (autosaveOwnerGeneration === token)
        autosaveOwnerGeneration = undefined;
      if (currentContext(candidate, token)) set({ operation: 'idle' });
    }
  }

  const subscribeStack = (candidate: FoundationSessionStack, token: number) => {
    removeApplication = candidate.application.projection.subscribe(
      (application) => {
        if (!currentContext(candidate, token)) return;
        set({
          application,
          ...availability(application),
          canStartNewSession:
            application.session.status === 'closed' ||
            application.session.status === 'failed',
        });
      },
    );
    removePacing = candidate.pacing.projection.subscribe((pacing) => {
      if (currentContext(candidate, token)) set({ pacing });
    });
    const application = candidate.application.projection.getState();
    set({
      application,
      pacing: candidate.pacing.projection.getState(),
      ...availability(application),
    });
  };

  const freshRestoreTimeline = (target: string): TimelineId => {
    const session = store.getState().application.session;
    const current = session.status === 'ready' ? session.timelineId : undefined;
    const source = store
      .getState()
      .application.persistence.saves.find(
        (save) => save.saveId === target,
      )?.sourceTimelineId;
    for (;;) {
      const candidate = parseTimelineId(
        `browser-foundation-restored-${++restoreSequence}`,
      );
      if (
        candidate !== current &&
        candidate !== source &&
        !issuedRestoreTimelines.has(candidate)
      ) {
        issuedRestoreTimelines.add(candidate);
        return candidate;
      }
    }
  };

  async function cleanup(candidate: FoundationSessionStack): Promise<unknown> {
    let driverFailure: unknown;
    try {
      candidate.driver.close();
    } catch (error) {
      driverFailure = error;
    }
    const results = await Promise.allSettled([
      candidate.pacing.close(),
      candidate.application.close(),
    ]);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    const cleanupFailure: unknown = rejected?.reason;
    return driverFailure ?? cleanupFailure;
  }

  async function startNewSession() {
    if (disposed || store.getState().operation !== 'idle') return;
    if (stack) {
      const status = store.getState().application.session.status;
      if (status !== 'failed' && status !== 'closed') return;
      await closeSession();
      if (disposed || stack) return;
    }
    closePromise = undefined;
    set({
      operation: 'starting',
      canStartNewSession: false,
      message: undefined,
    });
    let candidate: FoundationSessionStack;
    try {
      candidate = input.createStack();
    } catch (error) {
      recordError(error);
      set({ operation: 'idle', canStartNewSession: true });
      return;
    }
    const token = ++generation;
    stack = candidate;
    subscribeStack(candidate, token);
    try {
      const sequence = ++sessionSequence;
      await candidate.application.startNew({
        gameId: parseGameId('browser-foundation-game'),
        timelineId: parseTimelineId(
          sequence === 1
            ? 'browser-foundation-timeline'
            : `browser-foundation-timeline-${sequence}`,
        ),
        initialSimulationTick: 0,
      });
      if (!currentContext(candidate, token)) return;
      try {
        await candidate.application.listSaves();
      } catch (error) {
        recordError(error, candidate, token);
      }
      if (!readyContext(candidate, token)) return;
      candidate.driver.start((elapsed) =>
        candidate.pacing.advanceByElapsedMicroseconds(elapsed),
      );
      set({ operation: 'idle', canStartNewSession: false });
      armAutosaveInterval();
    } catch (error) {
      if (!currentContext(candidate, token)) return;
      generation += 1;
      stack = undefined;
      removeSubscriptions();
      const cleanupFailure = await cleanup(candidate);
      set({
        operation: 'idle',
        canStartNewSession: true,
        message: errorMessage(cleanupFailure ?? error),
      });
    }
  }

  async function saveManual() {
    const candidate = stack;
    const token = generation;
    if (
      !candidate ||
      !readyContext(candidate, token) ||
      store.getState().operation !== 'idle'
    )
      return;
    cancelAutosave();
    const mode = store.getState().saveMode;
    set({ operation: 'saving', message: undefined });
    try {
      if (mode === 'manual') {
        await candidate.application.listSaves();
        if (!readyContext(candidate, token)) return;
        const exists = candidate.application.projection
          .getState()
          .persistence.saves.some((save) => save.saveId === saveId(mode));
        if (exists) {
          set({ operation: 'confirming-save' });
          const accepted = await input.confirm(
            'This will overwrite your previous saved session. Continue?',
          );
          if (!readyContext(candidate, token)) return;
          if (!accepted) return;
          set({ operation: 'saving' });
        }
      }
      await candidate.application.save(metadata(mode));
      if (currentContext(candidate, token)) set({ message: undefined });
    } catch (error) {
      recordError(error, candidate, token);
    } finally {
      finish(candidate, token);
    }
  }

  async function restoreManual() {
    const candidate = stack;
    const token = generation;
    if (
      !candidate ||
      !readyContext(candidate, token) ||
      store.getState().operation !== 'idle'
    )
      return;
    const mode = store.getState().saveMode;
    const target = saveId(mode);
    const exists = store
      .getState()
      .application.persistence.saves.some((save) => save.saveId === target);
    if (!exists) return;
    cancelAutosave();
    set({ operation: 'confirming-restore', message: undefined });
    try {
      const accepted = await input.confirm(
        'Restoring will replace your current gameplay with an earlier saved moment. Continue?',
      );
      if (!readyContext(candidate, token)) return;
      if (!accepted) return;
      set({ operation: 'restoring' });
      await candidate.application.restore({
        saveId: target,
        newTimelineId: freshRestoreTimeline(target),
      });
      if (currentContext(candidate, token)) set({ message: undefined });
    } catch (error) {
      recordError(error, candidate, token);
    } finally {
      finish(candidate, token);
    }
  }

  function closeSession(): Promise<void> {
    if (closePromise) return closePromise;
    const candidate = stack;
    if (!candidate) return Promise.resolve();
    cancelAutosave();
    const finalApplication = candidate.application.projection.getState();
    const finalPacing = candidate.pacing.projection.getState();
    set({ operation: 'closing', message: undefined });
    const token = ++generation;
    stack = undefined;
    removeSubscriptions();
    closePromise = (async () => {
      const failure = await cleanup(candidate);
      if (generation !== token) return;
      set({
        application: deepFreeze({
          ...finalApplication,
          session: { status: 'closed' },
        }),
        pacing: deepFreeze({ ...finalPacing, status: 'closed' }),
        operation: 'idle',
        canStartNewSession: !disposed,
        message: failure === undefined ? undefined : errorMessage(failure),
      });
    })();
    return closePromise;
  }

  const controller = {
    projection: Object.freeze({
      getState: store.getState,
      subscribe: store.subscribe,
    }),
    startNewSession,
    saveManual,
    restoreManual,
    setSaveMode(mode: FoundationSaveMode) {
      if (
        (mode !== 'manual' && mode !== 'autosave') ||
        disposed ||
        store.getState().operation !== 'idle'
      )
        return Promise.resolve();
      set({ saveMode: mode });
      armAutosaveInterval();
      return Promise.resolve();
    },
    async setMode(mode: 'paused' | 'normal' | 'fast' | 'maximum') {
      const candidate = stack;
      const token = generation;
      try {
        await candidate?.pacing.setMode(mode);
      } catch (error) {
        if (candidate) recordError(error, candidate, token);
      }
    },
    async grantBonus() {
      const candidate = stack;
      const token = generation;
      try {
        await candidate?.pacing.grantDoubleSpeedBonus(24);
      } catch (error) {
        if (candidate) recordError(error, candidate, token);
      }
    },
    closeSession,
    async dispose() {
      if (disposed) return closePromise;
      disposed = true;
      cancelAutosave();
      const closing = closeSession();
      await closing;
      set({ canStartNewSession: false });
    },
  };
  return Object.freeze(controller);
}
