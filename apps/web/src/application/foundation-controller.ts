import { createStore } from 'zustand/vanilla';
import {
  parseFoundationSynchronizationResponse,
  parseGameId,
  parseTimelineId,
  type FoundationCommandEnvelope,
  type FoundationCommandResult,
  type FoundationRenderSnapshot,
  type FoundationSimulationClient,
  type FoundationStateUpdate,
  type GameId,
  type TimelineId,
} from '@torrevieja-tycoon/protocol';
import {
  parseSimulationTick,
  type ScenarioCoordinate,
} from '@torrevieja-tycoon/simulation';
import {
  parseFoundationSaveId,
  parseFoundationSaveRecord,
  type FoundationSaveSummary,
} from '../persistence/save-record.js';
import type { FoundationSaveRepository } from '../persistence/save-repository.js';

type Session = Readonly<
  | { status: 'idle' | 'starting' | 'restoring' | 'closed' }
  | { status: 'ready'; gameId: GameId; timelineId: TimelineId }
  | { status: 'failed'; message: string }
>;
export interface ApplicationSaveSummary {
  readonly saveId: string;
  readonly sourceTimelineId: TimelineId;
  readonly sourceSimulationTick: number;
  readonly createdAtUtcMs: number;
  readonly updatedAtUtcMs: number;
  readonly label?: string | undefined;
  readonly scenarioId?: string | undefined;
  readonly scenarioSchemaVersion?: string | undefined;
  readonly scenarioVersion?: string | undefined;
  readonly contentHash?: string | undefined;
  readonly snapshotVersion?: 1 | 2 | 3 | 4 | undefined;
  readonly authoritativeEntityCount?: number | undefined;
  readonly compatibility?:
    'current' | 'migratable' | 'legacy-incompatible' | undefined;
}
export interface FoundationApplicationState {
  readonly session: Session;
  readonly authoritative?: Readonly<{
    commandRevision: number;
    simulationTick: number;
    streamOffset: number;
  }>;
  readonly scenario?: ScenarioCoordinate | undefined;
  readonly latestRenderSnapshot?: FoundationRenderSnapshot | undefined;
  readonly synchronization: Readonly<
    | { status: 'idle' | 'synchronized' | 'synchronizing' }
    | { status: 'required'; reason: 'gap' | 'timeline-mismatch' }
    | { status: 'failed'; message: string }
  >;
  readonly persistence: Readonly<
    | {
        status: 'idle' | 'saving' | 'loading' | 'restoring';
        saves: readonly ApplicationSaveSummary[];
      }
    | {
        status: 'failed';
        saves: readonly ApplicationSaveSummary[];
        message: string;
      }
  >;
}
const emptySaves = Object.freeze([]) as readonly FoundationSaveSummary[];
function freezeState(
  value: FoundationApplicationState,
): FoundationApplicationState {
  Object.freeze(value.session);
  if (value.authoritative) Object.freeze(value.authoritative);
  if (value.scenario) Object.freeze(value.scenario);
  Object.freeze(value.synchronization);
  Object.freeze(value.persistence.saves);
  Object.freeze(value.persistence);
  return Object.freeze(value);
}
export function createFoundationApplicationController(input: {
  readonly repository: FoundationSaveRepository;
  readonly clientFactory: () => FoundationSimulationClient;
}) {
  const store = createStore<FoundationApplicationState>(() =>
    freezeState({
      session: { status: 'idle' },
      synchronization: { status: 'idle' },
      persistence: { status: 'idle', saves: emptySaves },
    }),
  );
  let client: FoundationSimulationClient | undefined;
  let cleanups: Array<() => void> = [];
  let generation = 0;
  let queue: Promise<void> = Promise.resolve();
  let closing = false;
  let closed = false;
  let sessionClaimed = false;
  let closePromise: Promise<void> | undefined;
  const set = (patch: Partial<FoundationApplicationState>) =>
    store.setState(freezeState({ ...store.getState(), ...patch }), true);
  function subscriptions(
    next: FoundationSimulationClient,
    timelineId: TimelineId,
    clientGeneration: number,
  ) {
    cleanups = [
      next.subscribeReliableUpdates((update) => {
        if (isCurrent(next, timelineId, clientGeneration))
          applyReliable(update, timelineId);
      }),
      next.subscribeRenderSnapshots((snapshot) => {
        if (isCurrent(next, timelineId, clientGeneration))
          applyRender(snapshot, timelineId);
      }),
    ];
  }
  function isCurrent(
    source: FoundationSimulationClient,
    timelineId: TimelineId,
    clientGeneration: number,
  ): boolean {
    const session = store.getState().session;
    return (
      !closing &&
      !closed &&
      generation === clientGeneration &&
      client === source &&
      session.status === 'ready' &&
      session.timelineId === timelineId
    );
  }
  function applyReliable(
    update: FoundationStateUpdate,
    timelineId: TimelineId,
  ) {
    const current = store.getState().authoritative;
    if (update.timelineId !== timelineId) {
      set({
        synchronization: { status: 'required', reason: 'timeline-mismatch' },
      });
      return;
    }
    if (current && update.streamOffset <= current.streamOffset) return;
    if (current && update.streamOffset !== current.streamOffset + 1) {
      set({ synchronization: { status: 'required', reason: 'gap' } });
      return;
    }
    set({
      authoritative: {
        commandRevision: update.commandRevision,
        simulationTick: update.simulationTick,
        streamOffset: update.streamOffset,
      },
    });
  }
  function applyRender(
    snapshot: FoundationRenderSnapshot,
    timelineId: TimelineId,
  ) {
    const current = store.getState().latestRenderSnapshot;
    if (
      snapshot.timelineId !== timelineId ||
      (current && snapshot.sequence <= current.sequence)
    )
      return;
    set({ latestRenderSnapshot: Object.freeze(snapshot) });
  }
  async function synchronizeCurrent() {
    try {
      if (!client) throw new Error('No active foundation client.');
      set({ synchronization: { status: 'synchronizing' } });
      const session = store.getState().session;
      if (session.status !== 'ready') throw new Error('Session is not ready.');
      const response = parseFoundationSynchronizationResponse(
        await client.synchronize({
          kind: 'foundation-synchronization-request',
          gameId: session.gameId,
        }),
      );
      if (
        response.kind !== 'foundation-synchronization-response' ||
        response.mode !== 'full'
      )
        throw new Error('Full synchronization is required.');
      set({
        authoritative: {
          commandRevision: response.baseline.commandRevision,
          simulationTick: response.baseline.simulationTick,
          streamOffset: response.baseline.lastIncludedStreamOffset,
        },
        synchronization: { status: 'synchronized' },
      });
    } catch (error) {
      set({ synchronization: { status: 'failed', message: message(error) } });
      throw error;
    }
  }
  const message = (error: unknown) =>
    error instanceof Error ? error.message : 'Operation failed.';
  function persistenceFailed(error: unknown): void {
    set({
      persistence: {
        status: 'failed',
        saves: store.getState().persistence.saves,
        message: message(error),
      },
    });
  }
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const result = new Promise<T>((r, j) => {
      resolve = r;
      reject = j;
    });
    queue = queue
      .then(async () => {
        if (closing || closed)
          throw new Error('Foundation application controller is closed.');
        return operation();
      })
      .then(resolve, reject)
      .then(
        () => undefined,
        () => undefined,
      );
    return result;
  }
  async function activate(
    request: Parameters<FoundationSimulationClient['connect']>[0],
    status: 'starting' | 'restoring',
  ) {
    set({ session: { status } });
    const next = input.clientFactory();
    const clientGeneration = ++generation;
    client = next;
    subscriptions(next, request.timelineId, clientGeneration);
    try {
      await next.connect(request);
      if (closing || closed || generation !== clientGeneration)
        throw new Error('Foundation application controller is closed.');
      set({
        session: {
          status: 'ready',
          gameId: request.gameId,
          timelineId: request.timelineId,
        },
      });
      await synchronizeCurrent();
      if (closing || closed || generation !== clientGeneration)
        throw new Error('Foundation application controller is closed.');
    } catch (error) {
      if (generation === clientGeneration) generation += 1;
      for (const cleanup of cleanups.splice(0)) cleanup();
      let cleanupError: unknown;
      try {
        await next.close();
      } catch (nextCloseError) {
        cleanupError = nextCloseError;
      } finally {
        if (client === next) client = undefined;
        sessionClaimed = false;
        set({ session: { status: 'failed', message: message(error) } });
      }
      if (cleanupError !== undefined)
        throw new AggregateError(
          [error, cleanupError],
          `Activation and cleanup failed: ${message(error)}`,
          { cause: error },
        );
      throw error;
    }
  }
  const projection = Object.freeze({
    getState: store.getState,
    subscribe: store.subscribe,
  });
  const controller = {
    projection,
    startNew(request: {
      gameId: GameId;
      timelineId: TimelineId;
      initialSimulationTick: number;
    }) {
      if (sessionClaimed)
        return Promise.reject(
          new Error('A foundation session is already active.'),
        );
      let validated;
      try {
        validated = {
          mode: 'new' as const,
          gameId: parseGameId(request.gameId),
          timelineId: parseTimelineId(request.timelineId),
          initialSimulationTick: parseSimulationTick(
            request.initialSimulationTick,
          ),
        };
      } catch (error) {
        return Promise.reject(
          error instanceof Error ? error : new Error('Invalid start request.'),
        );
      }
      sessionClaimed = true;
      return enqueue(() => activate(validated, 'starting'));
    },
    synchronize: () => enqueue(synchronizeCurrent),
    sendCommand(
      envelope: FoundationCommandEnvelope,
    ): Promise<FoundationCommandResult> {
      return enqueue(async () => {
        if (!client) throw new Error('No active foundation client.');
        return client.sendCommand(envelope);
      });
    },
    listSaves() {
      return enqueue(async () => {
        try {
          const saves = await input.repository.list();
          set({ persistence: { status: 'idle', saves } });
          return saves;
        } catch (error) {
          persistenceFailed(error);
          throw error;
        }
      });
    },
    save(metadata: {
      saveId: unknown;
      label?: string;
      createdAtUtcMs: number;
      updatedAtUtcMs: number;
    }) {
      return enqueue(async () => {
        if (!client) throw new Error('No active foundation client.');
        set({
          persistence: {
            status: 'saving',
            saves: store.getState().persistence.saves,
          },
        });
        try {
          const exported = await client.exportSnapshot();
          const record = parseFoundationSaveRecord({
            kind: 'foundation-save-record',
            schemaVersion: 1,
            saveId: parseFoundationSaveId(metadata.saveId),
            ...(metadata.label === undefined ? {} : { label: metadata.label }),
            gameId: exported.gameId,
            sourceTimelineId: exported.timelineId,
            sourceCommandRevision: exported.commandRevision,
            sourceSimulationTick: exported.simulationTick,
            sourceStreamOffset: exported.streamOffset,
            createdAtUtcMs: metadata.createdAtUtcMs,
            updatedAtUtcMs: metadata.updatedAtUtcMs,
            snapshot: exported.snapshot,
          });
          await input.repository.put(record);
          const saves = await input.repository.list();
          set({ persistence: { status: 'idle', saves } });
        } catch (error) {
          persistenceFailed(error);
          throw error;
        }
      });
    },
    restore(request: { saveId: unknown; newTimelineId: TimelineId }) {
      return enqueue(async () => {
        let oldSessionInvalidated = false;
        let restoredReady = false;
        try {
          const record = await input.repository.get(
            parseFoundationSaveId(request.saveId),
          );
          if (!record) throw new Error('Save was not found.');
          const timelineId = parseTimelineId(request.newTimelineId);
          if (timelineId === record.sourceTimelineId)
            throw new Error('Restore requires a different timeline.');
          generation += 1;
          const previous = client;
          client = undefined;
          oldSessionInvalidated = true;
          for (const cleanup of cleanups.splice(0)) cleanup();
          await previous?.close();
          set({
            latestRenderSnapshot: undefined,
            persistence: {
              status: 'restoring',
              saves: store.getState().persistence.saves,
            },
          });
          sessionClaimed = true;
          await activate(
            {
              mode: 'restore',
              gameId: record.gameId,
              timelineId,
              snapshot: record.snapshot,
            },
            'restoring',
          );
          restoredReady = true;
          set({
            persistence: {
              status: 'idle',
              saves: await input.repository.list(),
            },
          });
        } catch (error) {
          persistenceFailed(error);
          if (oldSessionInvalidated && !restoredReady)
            set({ session: { status: 'failed', message: message(error) } });
          throw error;
        }
      });
    },
    deleteSave(saveId: unknown) {
      return enqueue(async () => {
        try {
          await input.repository.delete(parseFoundationSaveId(saveId));
          set({
            persistence: {
              status: 'idle',
              saves: await input.repository.list(),
            },
          });
        } catch (error) {
          persistenceFailed(error);
          throw error;
        }
      });
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      generation += 1;
      closePromise = (async () => {
        await queue;
        const current = client;
        client = undefined;
        for (const cleanup of cleanups.splice(0)) cleanup();
        const errors: unknown[] = [];
        try {
          await current?.close();
        } catch (error) {
          errors.push(error);
        }
        try {
          await input.repository.close();
        } catch (error) {
          errors.push(error);
        } finally {
          closed = true;
          sessionClaimed = false;
          set({ session: { status: 'closed' } });
        }
        if (errors.length > 0)
          throw new AggregateError(errors, 'Controller cleanup failed.');
      })();
      return closePromise;
    },
  };
  return Object.freeze(controller);
}
