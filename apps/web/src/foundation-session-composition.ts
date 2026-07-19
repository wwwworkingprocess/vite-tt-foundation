import { createStore } from 'zustand/vanilla';
import {
  parseGameId,
  parseTimelineId,
  type TimelineId,
} from '@torrevieja-tycoon/protocol';
import type {
  FoundationApplicationState,
  createFoundationApplicationController,
} from './application/foundation-controller.js';
import type { createBrowserPacingDriver } from './pacing/browser-pacing-driver.js';
import type {
  FoundationPacingState,
  createFoundationPacingController,
} from './pacing/foundation-pacing-controller.js';

type Application = ReturnType<typeof createFoundationApplicationController>;
type Pacing = ReturnType<typeof createFoundationPacingController>;
type Driver = ReturnType<typeof createBrowserPacingDriver>;

export interface FoundationSessionStack {
  readonly application: Pick<
    Application,
    'projection' | 'startNew' | 'save' | 'restore' | 'listSaves' | 'close'
  >;
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
export interface FoundationSessionCompositionState {
  readonly application: FoundationApplicationState;
  readonly pacing: FoundationPacingState;
  readonly saveMode: FoundationSaveMode;
  readonly operation: 'idle' | 'starting' | 'saving' | 'restoring' | 'closing';
  readonly canStartNewSession: boolean;
  readonly message?: string | undefined;
}

const idleApplication: FoundationApplicationState = Object.freeze({
  session: Object.freeze({ status: 'idle' }),
  synchronization: Object.freeze({ status: 'idle' }),
  persistence: Object.freeze({ status: 'idle', saves: Object.freeze([]) }),
});
const idlePacing: FoundationPacingState = Object.freeze({
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
  const store = createStore<FoundationSessionCompositionState>(() =>
    Object.freeze({
      application: idleApplication,
      pacing: idlePacing,
      saveMode: 'manual',
      operation: 'idle',
      canStartNewSession: true,
    }),
  );
  let stack: FoundationSessionStack | undefined;
  let removeApplication: (() => void) | undefined;
  let removePacing: (() => void) | undefined;
  let interval: unknown;
  let generation = 0;
  let sessionSequence = 0;
  let restoreSequence = 0;
  const issuedRestoreTimelines = new Set<TimelineId>();
  let autosaveInFlight = false;
  let disposed = false;

  const set = (patch: Partial<FoundationSessionCompositionState>) =>
    store.setState(Object.freeze({ ...store.getState(), ...patch }), true);
  const ready = () => store.getState().application.session.status === 'ready';
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
  const saveMetadata = (autosaveRecord: boolean) => {
    const now = input.nowUtcMs();
    return {
      saveId: autosaveRecord ? 'foundation-autosave' : 'foundation-slot',
      label: autosaveRecord ? 'Foundation autosave' : 'Foundation slot',
      createdAtUtcMs: now,
      updatedAtUtcMs: now,
    };
  };
  const recordError = (error: unknown) => set({ message: errorMessage(error) });
  async function autosave() {
    const current = stack;
    if (!shouldArmAutosave() || autosaveInFlight || !current) return;
    autosaveInFlight = true;
    set({ operation: 'saving' });
    try {
      await current.application.save(saveMetadata(true));
      set({ message: undefined });
    } catch (error) {
      recordError(error);
    } finally {
      autosaveInFlight = false;
      if (stack === current) set({ operation: 'idle' });
    }
  }
  const subscribeStack = (
    next: FoundationSessionStack,
    stackGeneration: number,
  ) => {
    removeApplication = next.application.projection.subscribe((application) => {
      if (generation !== stackGeneration || stack !== next) return;
      set({
        application,
        canStartNewSession:
          application.session.status === 'closed' ||
          application.session.status === 'failed',
      });
    });
    removePacing = next.pacing.projection.subscribe((pacing) => {
      if (generation === stackGeneration && stack === next) set({ pacing });
    });
    set({
      application: next.application.projection.getState(),
      pacing: next.pacing.projection.getState(),
    });
  };
  const freshRestoreTimeline = (): TimelineId => {
    const session = store.getState().application.session;
    const current = session.status === 'ready' ? session.timelineId : undefined;
    const source = store
      .getState()
      .application.persistence.saves.find(
        ({ saveId }) => saveId === 'foundation-slot',
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
  async function startNewSession() {
    if (disposed || store.getState().operation !== 'idle') return;
    if (stack) {
      const session = store.getState().application.session;
      if (session.status !== 'failed' && session.status !== 'closed') return;
      await closeSession();
      if (disposed || stack) return;
    }
    set({
      operation: 'starting',
      canStartNewSession: false,
      message: undefined,
    });
    let next: FoundationSessionStack;
    try {
      next = input.createStack();
    } catch (error) {
      recordError(error);
      set({ operation: 'idle', canStartNewSession: true });
      return;
    }
    const stackGeneration = ++generation;
    stack = next;
    subscribeStack(next, stackGeneration);
    try {
      const sequence = ++sessionSequence;
      await next.application.startNew({
        gameId: parseGameId('browser-foundation-game'),
        timelineId: parseTimelineId(
          sequence === 1
            ? 'browser-foundation-timeline'
            : `browser-foundation-timeline-${sequence}`,
        ),
        initialSimulationTick: 0,
      });
      if (generation !== stackGeneration || stack !== next) return;
      try {
        await next.application.listSaves();
      } catch (error) {
        recordError(error);
      }
      next.driver.start((elapsed) =>
        next.pacing.advanceByElapsedMicroseconds(elapsed),
      );
      set({ operation: 'idle', canStartNewSession: false });
      armAutosaveInterval();
    } catch (error) {
      recordError(error);
      removeSubscriptions();
      next.driver.close();
      await Promise.allSettled([next.pacing.close(), next.application.close()]);
      if (stack === next) stack = undefined;
      set({ operation: 'idle', canStartNewSession: true });
    }
  }
  async function saveManual() {
    const current = stack;
    if (!current || !ready() || store.getState().operation !== 'idle') return;
    const exists = store
      .getState()
      .application.persistence.saves.some(
        ({ saveId }) => saveId === 'foundation-slot',
      );
    if (exists) {
      try {
        if (
          !(await input.confirm(
            'This will overwrite your previous saved session. Continue?',
          ))
        )
          return;
      } catch (error) {
        recordError(error);
        return;
      }
    }
    cancelAutosave();
    set({ operation: 'saving', message: undefined });
    try {
      await current.application.save(saveMetadata(false));
    } catch (error) {
      recordError(error);
    } finally {
      if (stack === current) {
        set({ operation: 'idle' });
        armAutosaveInterval();
      }
    }
  }
  async function restoreManual() {
    const current = stack;
    if (!current || !ready() || store.getState().operation !== 'idle') return;
    try {
      if (
        !(await input.confirm(
          'Restoring will replace your current gameplay with an earlier saved moment. Continue?',
        ))
      )
        return;
    } catch (error) {
      recordError(error);
      return;
    }
    cancelAutosave();
    set({ operation: 'restoring', message: undefined });
    try {
      await current.application.restore({
        saveId: 'foundation-slot',
        newTimelineId: freshRestoreTimeline(),
      });
      set({ message: undefined });
    } catch (error) {
      recordError(error);
    } finally {
      if (stack === current) {
        set({ operation: 'idle' });
        armAutosaveInterval();
      }
    }
  }
  async function closeSession() {
    const current = stack;
    if (!current || store.getState().operation === 'closing') return;
    cancelAutosave();
    const finalApplication = current.application.projection.getState();
    const finalPacing = current.pacing.projection.getState();
    set({ operation: 'closing', message: undefined });
    generation += 1;
    stack = undefined;
    removeSubscriptions();
    current.driver.close();
    const results = await Promise.allSettled([
      current.pacing.close(),
      current.application.close(),
    ]);
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    set({
      application: {
        ...finalApplication,
        session: { status: 'closed' },
      },
      pacing: { ...finalPacing, status: 'closed' },
      operation: 'idle',
      canStartNewSession: !disposed,
      message: failure ? errorMessage(failure.reason) : undefined,
    });
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
      if (mode !== 'manual' && mode !== 'autosave') return Promise.resolve();
      set({ saveMode: mode });
      armAutosaveInterval();
      return Promise.resolve();
    },
    async setMode(mode: 'paused' | 'normal' | 'fast' | 'maximum') {
      try {
        await stack?.pacing.setMode(mode);
      } catch (error) {
        recordError(error);
      }
    },
    async grantBonus() {
      try {
        await stack?.pacing.grantDoubleSpeedBonus(24);
      } catch (error) {
        recordError(error);
      }
    },
    closeSession,
    async dispose() {
      disposed = true;
      cancelAutosave();
      await closeSession();
      set({ canStartNewSession: false });
    },
  };
  return Object.freeze(controller);
}
