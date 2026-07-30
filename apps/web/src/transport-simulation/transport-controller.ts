import type { CanonicalScenario } from '@torrevieja-tycoon/transport-domain';
import {
  projectPassengerDemand,
  restoreTransportSimulationState,
  type ActivePassengerDemandState,
  type PassengerDemandPlanV1,
  type PassengerDemandProjection,
  type ScenarioCoordinate,
  type VehicleState,
} from '@torrevieja-tycoon/simulation';
import {
  parseClientId,
  parseCommandId,
  parseCorrelationId,
  parseGameId,
  parseSessionId,
  parseTimelineId,
  type GameId,
  type TimelineId,
} from '@torrevieja-tycoon/protocol';
import {
  parseTransportSaveRecord,
  type PersistedSaveClassification,
  type TransportSaveRecord,
} from './transport-save-record.js';
import type {
  TransportCommandEnvelope,
  TransportSimulationClient,
  TransportSnapshotExport,
} from './transport-client.js';

export interface ScenarioResolver {
  resolve(coordinate: ScenarioCoordinate): Promise<CanonicalScenario>;
}
export interface PassengerDemandPlanResolver {
  resolve(
    coordinate: ActivePassengerDemandState['demandPlanCoordinate'],
  ): Promise<PassengerDemandPlanV1>;
}

export interface TransportSaveRepositoryPort {
  get(saveId: string): Promise<PersistedSaveClassification | undefined>;
  put(record: TransportSaveRecord): Promise<void>;
  close?(): Promise<void>;
}

export interface TransportApplicationProjection {
  readonly status:
    'idle' | 'starting' | 'ready' | 'restoring' | 'failed' | 'closed';
  readonly gameId?: GameId | undefined;
  readonly timelineId?: TimelineId | undefined;
  readonly scenario?: ScenarioCoordinate | undefined;
  readonly simulationTick?: number | undefined;
  readonly commandRevision?: number | undefined;
  readonly streamOffset?: number | undefined;
  readonly fleet?: readonly VehicleState[] | undefined;
  readonly passengerDemand?: PassengerDemandProjection | undefined;
  readonly message?: string | undefined;
}

const freeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
};
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Transport operation failed.';

export function createTransportApplicationController(input: {
  readonly createClient: () => TransportSimulationClient;
  readonly repository: TransportSaveRepositoryPort;
  readonly scenarioResolver: ScenarioResolver;
  readonly passengerDemandPlanResolver?: PassengerDemandPlanResolver;
}) {
  let state = freeze<TransportApplicationProjection>({ status: 'idle' });
  let client: TransportSimulationClient | undefined;
  let generation = 0;
  let listenerSequence = 0;
  let commandSequence = 0;
  let queue: Promise<void> = Promise.resolve();
  let sessionClaimed = false;
  let closing = false;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  const cleanups: Array<() => void> = [];
  const listeners = new Map<
    number,
    (state: TransportApplicationProjection) => void
  >();
  const set = (next: TransportApplicationProjection) => {
    state = freeze(next);
    for (const listener of [...listeners.values()])
      try {
        listener(state);
      } catch {
        // Projection diagnostics cannot affect serialized operations.
      }
  };
  const isCurrent = (
    candidate: TransportSimulationClient,
    token: number,
    timelineId: TimelineId,
  ) =>
    [
      !closing,
      !closed,
      generation === token,
      client === candidate,
      state.timelineId === timelineId,
    ].every(Boolean);
  const removeSubscriptions = () => {
    const errors: unknown[] = [];
    for (const cleanup of cleanups.splice(0))
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    return errors;
  };
  const withCleanupFailures = (
    primary: unknown,
    cleanupErrors: readonly unknown[],
    message: string,
  ) =>
    cleanupErrors.length
      ? new AggregateError([primary, ...cleanupErrors], message)
      : primary;
  const subscribeClient = (
    candidate: TransportSimulationClient,
    token: number,
    timelineId: TimelineId,
  ) => {
    cleanups.push(
      candidate.subscribeReliableUpdates((update) => {
        if (!isCurrent(candidate, token, timelineId)) return;
        set({
          ...state,
          simulationTick: update.simulationTick,
          commandRevision: update.commandRevision,
          streamOffset: update.streamOffset,
          fleet: update.fleet,
          passengerDemand: update.passengerDemand,
        });
      }),
    );
    cleanups.push(candidate.subscribeRenderSnapshots(() => undefined));
  };
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const result = new Promise<T>((accept, decline) => {
      resolve = accept;
      reject = decline;
    });
    queue = queue
      .then(async () => {
        if (closing || closed)
          throw new Error('Transport application controller is closed.');
        return operation();
      })
      .then(resolve, reject)
      .then(
        () => undefined,
        () => undefined,
      );
    return result;
  };
  const synchronizeReady = async (
    candidate: TransportSimulationClient,
    gameId: GameId,
    timelineId: TimelineId,
    token: number,
  ) => {
    const response = await candidate.synchronize({
      kind: 'foundation-synchronization-request',
      gameId,
    });
    if (!isCurrent(candidate, token, timelineId))
      throw new Error('Transport activation became stale.');
    const foundation =
      response.kind === 'transport-synchronization-response'
        ? response.foundation
        : response;
    if (
      foundation.kind !== 'foundation-synchronization-response' ||
      foundation.mode !== 'full'
    )
      throw new Error('Full transport synchronization is required.');
    return foundation.baseline;
  };
  const activate = async (
    candidate: TransportSimulationClient,
    request: Parameters<TransportSimulationClient['connect']>[0],
    token: number,
  ) => {
    client = candidate;
    set({
      status: request.mode === 'new' ? 'starting' : 'restoring',
      timelineId: request.timelineId,
    });
    try {
      subscribeClient(candidate, token, request.timelineId);
      await candidate.connect(request);
      const baseline = await synchronizeReady(
        candidate,
        request.gameId,
        request.timelineId,
        token,
      );
      const exported = await candidate.exportSnapshot();
      if (!isCurrent(candidate, token, request.timelineId))
        throw new Error('Transport activation became stale.');
      set({
        status: 'ready',
        gameId: request.gameId,
        timelineId: request.timelineId,
        scenario: exported.snapshot.scenario,
        simulationTick: baseline.simulationTick,
        commandRevision: baseline.commandRevision,
        streamOffset: baseline.lastIncludedStreamOffset,
        fleet: exported.snapshot.state.fleet,
        passengerDemand: projectPassengerDemand(
          exported.snapshot.state.passengerDemand,
        ),
      });
    } catch (error) {
      if (generation === token) generation += 1;
      const cleanupErrors = removeSubscriptions();
      try {
        await candidate.close();
      } catch (closeError) {
        cleanupErrors.push(closeError);
      } finally {
        if (client === candidate) client = undefined;
        sessionClaimed = false;
        if (!closing && !closed)
          set({ status: 'failed', message: errorMessage(error) });
      }
      throw withCleanupFailures(
        error,
        cleanupErrors,
        'Transport activation and cleanup failed.',
      );
    }
  };

  const controller = {
    projection: Object.freeze({
      getState: () => state,
      subscribe(listener: (state: TransportApplicationProjection) => void) {
        if (closing || closed)
          throw new Error('Transport application controller is closed.');
        const registration = ++listenerSequence;
        listeners.set(registration, listener);
        let active = true;
        return () => {
          if (active) {
            active = false;
            listeners.delete(registration);
          }
        };
      },
    }),
    startNew(request: {
      gameId: GameId;
      timelineId: TimelineId;
      scenario: CanonicalScenario;
      passengerDemandPlan?: PassengerDemandPlanV1;
      initialSimulationTick?: number;
    }) {
      if (sessionClaimed || closing || closed)
        return Promise.reject(new Error('Transport session is unavailable.'));
      sessionClaimed = true;
      const starting = enqueue(async () => {
        const gameId = parseGameId(request.gameId);
        const timelineId = parseTimelineId(request.timelineId);
        const token = ++generation;
        let candidate: TransportSimulationClient;
        try {
          candidate = input.createClient();
        } catch (error) {
          sessionClaimed = false;
          if (!closing && !closed && generation === token)
            set({ status: 'failed', message: errorMessage(error) });
          throw error;
        }
        await activate(
          candidate,
          {
            kind: 'transport-client-connect',
            contractVersion: 3,
            mode: 'new',
            gameId,
            timelineId,
            initialSimulationTick: request.initialSimulationTick ?? 0,
            scenario: request.scenario,
            ...(request.passengerDemandPlan === undefined
              ? {}
              : { passengerDemandPlan: request.passengerDemandPlan }),
          },
          token,
        );
      });
      return starting.catch((error) => {
        if (!client && !closing && !closed) sessionClaimed = false;
        throw error;
      });
    },
    restore(request: { saveId: string; timelineId: TimelineId }) {
      return enqueue(async () => {
        const previous = client;
        const previousState = state;
        if (!previous || previousState.status !== 'ready')
          throw new Error('No ready transport session.');
        const classified = await input.repository.get(request.saveId);
        if (!classified) {
          const error = new Error('Save was not found.');
          set({ ...previousState, message: error.message });
          throw error;
        }
        if (classified.classification !== 'current') {
          const error =
            classified.classification === 'unrelated'
              ? new Error('The selected record is not a transport save.')
              : classified.error;
          set({ ...previousState, message: error.message });
          throw error;
        }
        const restoredRecord = classified.record;
        let scenario: CanonicalScenario;
        let passengerDemandPlan: PassengerDemandPlanV1 | undefined;
        try {
          scenario = await input.scenarioResolver.resolve(
            restoredRecord.scenario,
          );
          if (
            restoredRecord.snapshot.state.passengerDemand.status === 'active'
          ) {
            if (!input.passengerDemandPlanResolver)
              throw new Error('Passenger demand plan resolver is unavailable.');
            passengerDemandPlan =
              await input.passengerDemandPlanResolver.resolve(
                restoredRecord.snapshot.state.passengerDemand
                  .demandPlanCoordinate,
              );
          }
          restoreTransportSimulationState(
            restoredRecord.snapshot,
            scenario,
            passengerDemandPlan,
          );
        } catch (error) {
          if (client === previous && !closing && !closed)
            set({ ...previousState, message: errorMessage(error) });
          throw error;
        }
        if (client !== previous || closing || closed)
          throw new Error('Transport restore became stale.');
        const timelineId = parseTimelineId(request.timelineId);
        const token = ++generation;
        const teardownErrors = removeSubscriptions();
        client = undefined;
        set({ status: 'restoring' });
        let next: TransportSimulationClient | undefined;
        try {
          try {
            await previous.close();
          } catch (closeError) {
            throw withCleanupFailures(
              closeError,
              teardownErrors,
              'Transport authority teardown failed.',
            );
          }
          if (teardownErrors.length)
            throw new AggregateError(
              teardownErrors,
              'Transport subscription teardown failed.',
            );
          if (closing || closed || generation !== token)
            throw new Error('Transport restore became stale.');
          next = input.createClient();
          await activate(
            next,
            {
              kind: 'transport-client-connect',
              contractVersion: 3,
              mode: 'restore',
              gameId: restoredRecord.gameId,
              timelineId,
              scenario,
              snapshot: restoredRecord.snapshot,
              ...(passengerDemandPlan === undefined
                ? {}
                : { passengerDemandPlan }),
            },
            token,
          );
        } catch (error) {
          const cleanupErrors = removeSubscriptions();
          sessionClaimed = false;
          if (!closing && !closed)
            set({ status: 'failed', message: errorMessage(error) });
          throw withCleanupFailures(
            error,
            cleanupErrors,
            'Transport restore and cleanup failed.',
          );
        }
      });
    },
    save(metadata: {
      saveId: string;
      label?: string;
      createdAtUtcMs: number;
      updatedAtUtcMs: number;
    }) {
      return enqueue(async () => {
        const candidate = client;
        const operationState = state;
        const token = generation;
        if (!candidate || operationState.status !== 'ready')
          throw new Error('No ready transport session.');
        try {
          const exported: TransportSnapshotExport =
            await candidate.exportSnapshot();
          if (
            !isCurrent(candidate, token, operationState.timelineId!) ||
            state.status !== 'ready'
          )
            return;
          await input.repository.put(
            parseTransportSaveRecord({
              kind: 'transport-save-record',
              schemaVersion: 4,
              ...metadata,
              gameId: exported.gameId,
              sourceTimelineId: exported.timelineId,
              sourceCommandRevision: exported.commandRevision,
              sourceSimulationTick: exported.simulationTick,
              sourceStreamOffset: exported.streamOffset,
              scenario: exported.snapshot.scenario,
              snapshot: exported.snapshot,
            }),
          );
          if (isCurrent(candidate, token, operationState.timelineId!))
            set({ ...state, message: undefined });
        } catch (error) {
          if (isCurrent(candidate, token, operationState.timelineId!))
            set({ ...state, message: errorMessage(error) });
          throw error;
        }
      });
    },
    sendCommand(envelope: TransportCommandEnvelope) {
      return enqueue(async () => {
        const candidate = client;
        const operationState = state;
        const token = generation;
        if (!candidate || operationState.status !== 'ready')
          throw new Error('No ready transport session.');
        try {
          const result = await candidate.sendCommand(envelope);
          if (isCurrent(candidate, token, operationState.timelineId!)) {
            const exported = await candidate.exportSnapshot();
            if (isCurrent(candidate, token, operationState.timelineId!))
              set({
                ...state,
                simulationTick: exported.simulationTick,
                commandRevision: exported.commandRevision,
                streamOffset: exported.streamOffset,
                fleet: exported.snapshot.state.fleet,
                passengerDemand: projectPassengerDemand(
                  exported.snapshot.state.passengerDemand,
                ),
                message: undefined,
              });
          }
          return result;
        } catch (error) {
          if (isCurrent(candidate, token, operationState.timelineId!))
            set({ ...state, message: errorMessage(error) });
          throw error;
        }
      });
    },
    advanceTicks(count: number) {
      return enqueue(async () => {
        const candidate = client;
        const current = state;
        const token = generation;
        if (
          !candidate ||
          current.status !== 'ready' ||
          !current.gameId ||
          !current.timelineId
        )
          throw new Error('No ready transport session.');
        const id = `transport-pacing-${++commandSequence}`;
        const result = await candidate.sendCommand({
          kind: 'foundation-command',
          gameId: current.gameId,
          timelineId: current.timelineId,
          commandId: parseCommandId(id),
          correlationId: parseCorrelationId(id),
          clientId: parseClientId('transport-browser'),
          sessionId: parseSessionId('transport-session'),
          command: { type: 'foundation.advance-ticks', count },
        });
        if (isCurrent(candidate, token, current.timelineId)) {
          const exported = await candidate.exportSnapshot();
          if (isCurrent(candidate, token, current.timelineId))
            set({
              ...state,
              simulationTick: exported.simulationTick,
              commandRevision: exported.commandRevision,
              streamOffset: exported.streamOffset,
              fleet: exported.snapshot.state.fleet,
              passengerDemand: projectPassengerDemand(
                exported.snapshot.state.passengerDemand,
              ),
              message: undefined,
            });
        }
        return result;
      });
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      generation += 1;
      const current = client;
      client = undefined;
      closePromise = (async () => {
        const errors = removeSubscriptions();
        try {
          await queue;
          try {
            await current?.close();
          } catch (error) {
            errors.push(error);
          }
          try {
            await input.repository.close?.();
          } catch (error) {
            errors.push(error);
          }
        } finally {
          closed = true;
          sessionClaimed = false;
          set({ status: 'closed' });
          listeners.clear();
        }
        if (errors.length)
          throw new AggregateError(
            errors,
            'Transport controller cleanup failed.',
          );
      })();
      return closePromise;
    },
  };
  return Object.freeze(controller);
}
