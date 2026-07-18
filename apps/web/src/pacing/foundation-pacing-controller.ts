import { createStore } from 'zustand/vanilla';
import {
  parseFoundationCommandEnvelope,
  type TimelineId,
} from '@torrevieja-tycoon/protocol';
import type { createFoundationApplicationController } from '../application/foundation-controller.js';
import {
  defaultPlaybackProfile,
  planPacing,
  resolveEffectiveRate,
  type PlaybackMode,
  type PlaybackProfile,
} from './pacing-plan.js';

type Application = ReturnType<typeof createFoundationApplicationController>;
export interface FoundationPacingState {
  readonly status: 'idle' | 'running' | 'paused' | 'failed' | 'closed';
  readonly mode: PlaybackMode;
  readonly selectedRate: number;
  readonly effectiveRate: number;
  readonly creditGameMicroseconds: number;
  readonly remainingDoubleSpeedBonusTicks: number;
  readonly advancedTicksTotal: number;
  readonly message?: string | undefined;
}
const freeze = (value: FoundationPacingState) => Object.freeze(value);
export function createFoundationPacingController(input: {
  readonly application: Application;
  readonly profile?: PlaybackProfile;
}) {
  const profile = input.profile ?? defaultPlaybackProfile;
  const store = createStore<FoundationPacingState>(() =>
    freeze({
      status: 'paused',
      mode: 'paused',
      selectedRate: 0,
      effectiveRate: 0,
      creditGameMicroseconds: 0,
      remainingDoubleSpeedBonusTicks: 0,
      advancedTicksTotal: 0,
    }),
  );
  let queue = Promise.resolve(),
    closed = false,
    generation = 0,
    closePromise: Promise<void> | undefined,
    timeline: TimelineId | undefined;
  const set = (patch: Partial<FoundationPacingState>) =>
    store.setState(freeze({ ...store.getState(), ...patch }), true);
  const reset = (next?: TimelineId) => {
    generation += 1;
    timeline = next;
    set({
      status: 'paused',
      mode: 'paused',
      selectedRate: 0,
      effectiveRate: 0,
      creditGameMicroseconds: 0,
      remainingDoubleSpeedBonusTicks: 0,
      advancedTicksTotal: 0,
      message: undefined,
    });
  };
  const unsubscribe = input.application.projection.subscribe((state) => {
    const next =
      state.session.status === 'ready' ? state.session.timelineId : undefined;
    if (
      next !== timeline ||
      state.session.status === 'failed' ||
      state.session.status === 'closed'
    )
      reset(next);
    else if (next && state.authoritative) {
      const pacing = store.getState();
      set({
        effectiveRate: resolveEffectiveRate({
          mode: pacing.mode,
          simulationTick: state.authoritative.simulationTick,
          profile,
          remainingDoubleSpeedBonusTicks: pacing.remainingDoubleSpeedBonusTicks,
        }),
      });
    }
  });
  const initial = input.application.projection.getState().session;
  if (initial.status === 'ready') timeline = initial.timelineId;
  const enqueue = <T>(fn: () => Promise<T> | T) => {
    let resolve!: (value: T) => void, reject!: (error: unknown) => void;
    const result = new Promise<T>((r, j) => {
      resolve = r;
      reject = j;
    });
    queue = queue
      .then(() => {
        if (closed) throw new Error('Pacing controller is closed.');
        return fn();
      })
      .then(resolve, reject)
      .then(
        () => undefined,
        () => undefined,
      );
    return result;
  };
  const selected = (mode: PlaybackMode) =>
    mode === 'normal'
      ? profile.normalRate
      : mode === 'fast'
        ? profile.fastRate
        : mode === 'maximum'
          ? profile.maximumRate
          : 0;
  const controller = {
    projection: Object.freeze({
      getState: store.getState,
      subscribe: store.subscribe,
    }),
    setMode(mode: PlaybackMode) {
      return enqueue(() => {
        set({
          mode,
          status: mode === 'paused' ? 'paused' : 'running',
          selectedRate: selected(mode),
          message: undefined,
          effectiveRate: resolveEffectiveRate({
            mode,
            simulationTick:
              input.application.projection.getState().authoritative
                ?.simulationTick ?? 0,
            profile,
            remainingDoubleSpeedBonusTicks:
              store.getState().remainingDoubleSpeedBonusTicks,
          }),
        });
      });
    },
    grantDoubleSpeedBonus(ticks: number) {
      return enqueue(() => {
        if (!Number.isSafeInteger(ticks) || ticks <= 0)
          throw new Error('Bonus ticks must be a positive safe integer.');
        const remaining =
          store.getState().remainingDoubleSpeedBonusTicks + ticks;
        if (!Number.isSafeInteger(remaining))
          throw new Error('Bonus overflow.');
        set({
          remainingDoubleSpeedBonusTicks: remaining,
          effectiveRate: resolveEffectiveRate({
            mode: store.getState().mode,
            simulationTick:
              input.application.projection.getState().authoritative
                ?.simulationTick ?? 0,
            profile,
            remainingDoubleSpeedBonusTicks: remaining,
          }),
        });
      });
    },
    advanceByElapsedMicroseconds(elapsed: number) {
      return enqueue(async () => {
        const application = input.application.projection.getState();
        const pacing = store.getState();
        if (
          pacing.mode === 'paused' ||
          application.session.status !== 'ready' ||
          !application.authoritative
        )
          return;
        const operationGeneration = generation;
        try {
          const plan = planPacing({
            simulationTick: application.authoritative.simulationTick,
            elapsedPacingMicroseconds: elapsed,
            creditGameMicroseconds: pacing.creditGameMicroseconds,
            mode: pacing.mode,
            profile,
            remainingDoubleSpeedBonusTicks:
              pacing.remainingDoubleSpeedBonusTicks,
          });
          if (plan.advancedTicks === 0) {
            set({ creditGameMicroseconds: plan.nextCreditGameMicroseconds });
            return;
          }
          const id = application.authoritative.commandRevision + 1;
          const result = await input.application.sendCommand(
            parseFoundationCommandEnvelope({
              kind: 'foundation-command',
              gameId: application.session.gameId,
              timelineId: application.session.timelineId,
              commandId: `pacing-${id}`,
              correlationId: `pacing-correlation-${id}`,
              clientId: 'foundation-pacing-client',
              sessionId: 'foundation-pacing-session',
              command: {
                type: 'foundation.advance-ticks',
                count: plan.advancedTicks,
              },
            }),
          );
          if (operationGeneration !== generation) return;
          if (
            result.kind !== 'foundation-command-result' ||
            result.status !== 'applied' ||
            result.resultingSimulationTick !== plan.nextSimulationTick
          ) {
            set({
              status: 'failed',
              mode: 'paused',
              selectedRate: 0,
              effectiveRate: 0,
              message: 'Pacing command did not apply as planned.',
            });
            return;
          }
          set({
            creditGameMicroseconds: plan.nextCreditGameMicroseconds,
            remainingDoubleSpeedBonusTicks: plan.remainingDoubleSpeedBonusTicks,
            advancedTicksTotal: pacing.advancedTicksTotal + plan.advancedTicks,
            effectiveRate: resolveEffectiveRate({
              mode: pacing.mode,
              simulationTick: plan.nextSimulationTick,
              profile,
              remainingDoubleSpeedBonusTicks:
                plan.remainingDoubleSpeedBonusTicks,
            }),
          });
        } catch (error) {
          if (operationGeneration === generation)
            set({
              status: 'failed',
              mode: 'paused',
              selectedRate: 0,
              effectiveRate: 0,
              message:
                error instanceof Error
                  ? error.message
                  : 'Pacing operation failed.',
            });
        }
      });
    },
    resetForCurrentSession() {
      return enqueue(() => {
        const session = input.application.projection.getState().session;
        reset(session.status === 'ready' ? session.timelineId : undefined);
      });
    },
    close() {
      if (closePromise) return closePromise;
      closed = true;
      generation += 1;
      unsubscribe();
      closePromise = queue.then(() => {
        set({
          status: 'closed',
          mode: 'paused',
          selectedRate: 0,
          effectiveRate: 0,
          creditGameMicroseconds: 0,
          remainingDoubleSpeedBonusTicks: 0,
        });
      });
      return closePromise;
    },
  };
  return Object.freeze(controller);
}
