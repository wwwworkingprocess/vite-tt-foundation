import {
  advanceTransportTicks,
  advanceTransportTicksWithEvents,
  applyTransportVehicleCommand,
  createFoundationSimulationSnapshot,
  createFoundationState,
  createScenarioCoordinate,
  createTransportSimulationSnapshot,
  createTransportSimulationState,
  parseTickAdvancement,
  projectPassengerDemand,
  projectVehiclePassengerLoads,
  parseTransportVehicleCommand,
  restoreTransportSimulationState,
  type ScenarioCoordinate,
  type PassengerDemandPlanV1,
  type PassengerDemandProjection,
  type TransportSimulationSnapshot,
  type TransportSimulationState,
  type TransportVehicleCommand,
  type VehicleState,
  type VehiclePatternRunState,
  type VehicleStopNodeCall,
  type VehiclePassengerCapacity,
  type CurrentBoardingEvent,
  type CurrentAlightingEvent,
  type PassengerJourneyCompletionEvent,
  type PassengerOriginStopArrivalEvent,
  type VehiclePassengerLoadProjection,
} from '@torrevieja-tycoon/simulation';
import type { CanonicalScenario } from '@torrevieja-tycoon/transport-domain';
import type {
  FoundationClientLifecycle,
  FoundationCommandEnvelope,
  FoundationCommandResult,
  FoundationRenderSnapshot,
  FoundationStateUpdate,
  FoundationSynchronizationRequest,
  FoundationSynchronizationResponse,
  GameId,
  TimelineId,
} from '@torrevieja-tycoon/protocol';
import {
  parseFoundationCommandEnvelope,
  parseFoundationProtocolError,
} from '@torrevieja-tycoon/protocol';
import { createDirectFoundationClient } from '../simulation-host/direct-client.js';

export const transportClientContractVersion = 4 as const;

export type TransportClientConnectRequest =
  | Readonly<{
      kind: 'transport-client-connect';
      contractVersion: 4;
      mode: 'new';
      gameId: GameId;
      timelineId: TimelineId;
      initialSimulationTick: number;
      scenario: CanonicalScenario;
      passengerDemandPlan?: PassengerDemandPlanV1;
    }>
  | Readonly<{
      kind: 'transport-client-connect';
      contractVersion: 4;
      mode: 'restore';
      gameId: GameId;
      timelineId: TimelineId;
      scenario: CanonicalScenario;
      snapshot: TransportSimulationSnapshot;
      passengerDemandPlan?: PassengerDemandPlanV1;
    }>;

export type TransportClientLifecycle =
  | Exclude<FoundationClientLifecycle, { readonly state: 'ready' }>
  | Readonly<{
      state: 'ready';
      gameId: GameId;
      timelineId: TimelineId;
      scenario: ScenarioCoordinate;
    }>;

export interface TransportSnapshotExport {
  readonly kind: 'transport-snapshot-export';
  readonly gameId: GameId;
  readonly timelineId: TimelineId;
  readonly commandRevision: number;
  readonly simulationTick: number;
  readonly streamOffset: number;
  readonly snapshot: TransportSimulationSnapshot;
}

export type TransportCommandEnvelope = Readonly<
  Omit<FoundationCommandEnvelope, 'command'> & {
    readonly command:
      FoundationCommandEnvelope['command'] | TransportVehicleCommand;
  }
>;

export type TransportStateUpdate = Readonly<
  FoundationStateUpdate & {
    readonly fleet: readonly VehicleState[];
    readonly passengerDemand: PassengerDemandProjection;
    readonly vehicleOperations: readonly VehiclePatternRunState[];
    readonly currentStopCalls: readonly VehicleStopNodeCall[];
    readonly vehicleCapacities: readonly VehiclePassengerCapacity[];
    readonly currentBoardingEvents: readonly CurrentBoardingEvent[];
    readonly currentAlightingEvents: readonly CurrentAlightingEvent[];
    readonly currentJourneyCompletionEvents: readonly PassengerJourneyCompletionEvent[];
    readonly vehiclePassengerLoads: readonly VehiclePassengerLoadProjection[];
    readonly passengerOriginStopArrivalEvents: readonly PassengerOriginStopArrivalEvent[];
  }
>;
export type TransportRenderSnapshot = Readonly<
  FoundationRenderSnapshot & {
    readonly fleet: readonly VehicleState[];
    readonly passengerDemand: PassengerDemandProjection;
    readonly vehicleOperations: readonly VehiclePatternRunState[];
    readonly currentStopCalls: readonly VehicleStopNodeCall[];
    readonly vehicleCapacities: readonly VehiclePassengerCapacity[];
    readonly currentBoardingEvents: readonly CurrentBoardingEvent[];
    readonly currentAlightingEvents: readonly CurrentAlightingEvent[];
    readonly currentJourneyCompletionEvents: readonly PassengerJourneyCompletionEvent[];
    readonly vehiclePassengerLoads: readonly VehiclePassengerLoadProjection[];
    readonly passengerOriginStopArrivalEvents: readonly PassengerOriginStopArrivalEvent[];
  }
>;

export type TransportSynchronizationResponse =
  | FoundationSynchronizationResponse
  | Readonly<{
      kind: 'transport-synchronization-response';
      foundation: FoundationSynchronizationResponse;
      scenario: ScenarioCoordinate;
      fleet: readonly VehicleState[];
      passengerDemand: PassengerDemandProjection;
      vehicleOperations: readonly VehiclePatternRunState[];
      currentStopCalls: readonly VehicleStopNodeCall[];
      vehicleCapacities: readonly VehiclePassengerCapacity[];
      currentBoardingEvents: readonly CurrentBoardingEvent[];
      currentAlightingEvents: readonly CurrentAlightingEvent[];
      currentJourneyCompletionEvents: readonly PassengerJourneyCompletionEvent[];
      vehiclePassengerLoads: readonly VehiclePassengerLoadProjection[];
      passengerOriginStopArrivalEvents: readonly PassengerOriginStopArrivalEvent[];
    }>;

export interface TransportSimulationClient {
  connect(request: TransportClientConnectRequest): Promise<void>;
  sendCommand(
    command: TransportCommandEnvelope,
  ): Promise<FoundationCommandResult>;
  synchronize(
    request: FoundationSynchronizationRequest,
  ): Promise<TransportSynchronizationResponse>;
  exportSnapshot(): Promise<TransportSnapshotExport>;
  subscribeReliableUpdates(
    listener: (update: TransportStateUpdate) => void,
  ): () => void;
  subscribeRenderSnapshots(
    listener: (snapshot: TransportRenderSnapshot) => void,
  ): () => void;
  getLifecycle(): TransportClientLifecycle;
  subscribeLifecycle(
    listener: (state: TransportClientLifecycle) => void,
  ): () => void;
  getAuthoritativeState(): TransportSimulationState;
  close(): Promise<void>;
}

const freeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
};

function assertConnectShape(request: TransportClientConnectRequest): void {
  if (
    request.kind !== 'transport-client-connect' ||
    request.contractVersion !== transportClientContractVersion ||
    (request.mode !== 'new' && request.mode !== 'restore')
  )
    throw new Error('Unsupported transport client connect request.');
}

export function createDirectTransportSimulationClient(): TransportSimulationClient {
  const foundation = createDirectFoundationClient();
  let authority: TransportSimulationState | undefined;
  let lifecycle: TransportClientLifecycle = freeze({ state: 'idle' });
  let closing = false;
  let closePromise: Promise<void> | undefined;
  let commandQueue = Promise.resolve();
  let registrationSequence = 0;
  let publicationSequence = 0;
  let latestFoundationUpdate: FoundationStateUpdate | undefined;
  let latestFoundationRender: FoundationRenderSnapshot | undefined;
  let pendingPassengerOriginStopArrivalEvents: readonly PassengerOriginStopArrivalEvent[] =
    [];
  const reliableListeners = new Map<
    number,
    (update: TransportStateUpdate) => void
  >();
  const renderListeners = new Map<
    number,
    (snapshot: TransportRenderSnapshot) => void
  >();
  const commandIntentFingerprints = new Map<string, string>();
  const lifecycleListeners = new Map<
    number,
    (state: TransportClientLifecycle) => void
  >();
  const publishLifecycle = (next: TransportClientLifecycle) => {
    lifecycle = freeze(next);
    for (const listener of [...lifecycleListeners.values()])
      try {
        listener(lifecycle);
      } catch {
        // Listener diagnostics cannot affect the authoritative client.
      }
  };
  const removeFoundationReliable = foundation.subscribeReliableUpdates(
    (update) => {
      latestFoundationUpdate = update;
      const currentAuthority = authority!;
      const advancement = advanceTransportTicksWithEvents(
        currentAuthority,
        parseTickAdvancement(update.simulationTick - currentAuthority.tick),
      );
      authority = advancement.state;
      pendingPassengerOriginStopArrivalEvents =
        advancement.passengerOriginStopArrivalEvents;
    },
  );
  const removeFoundationRender = foundation.subscribeRenderSnapshots(
    (snapshot) => {
      latestFoundationRender = snapshot;
    },
  );
  const publish = <T>(listeners: Map<number, (value: T) => void>, value: T) => {
    for (const listener of [...listeners.values()])
      try {
        listener(value);
      } catch {
        // Publication listeners are isolated from authoritative processing.
      }
  };
  const subscribe = <T>(
    listeners: Map<number, (value: T) => void>,
    listener: (value: T) => void,
  ) => {
    if (closing) throw new Error('Transport client is closed.');
    const registration = ++publicationSequence;
    listeners.set(registration, listener);
    let active = true;
    return () => {
      if (active) {
        active = false;
        listeners.delete(registration);
      }
    };
  };
  const foundationEnvelope = (command: TransportCommandEnvelope) =>
    parseFoundationCommandEnvelope({
      ...command,
      command: { type: 'foundation.advance-ticks', count: 0 },
    });
  const fingerprintEnvelope = (
    envelope: ReturnType<typeof parseFoundationCommandEnvelope>,
    command: FoundationCommandEnvelope['command'] | TransportVehicleCommand,
  ) =>
    JSON.stringify({
      gameId: envelope.gameId,
      timelineId: envelope.timelineId,
      expectedCommandRevision: envelope.expectedCommandRevision ?? null,
      command,
    });
  const commandConflict = (command: TransportCommandEnvelope) =>
    freeze(
      parseFoundationProtocolError({
        kind: 'foundation-protocol-error',
        gameId: command.gameId,
        commandId: command.commandId,
        correlationId: command.correlationId,
        code: 'command-id-conflict',
        message: 'Command ID was reused with different stable intent.',
      }),
    );
  const publishAuthority = () => {
    const passengerDemand = projectPassengerDemand(authority!.passengerDemand);
    const vehiclePassengerLoads = projectVehiclePassengerLoads(
      authority!.vehicleCapacities,
      authority!.passengerDemand.status === 'active'
        ? authority!.passengerDemand.onboardGroups
        : [],
      authority!.currentAlightingEvents,
      authority!.currentBoardingEvents,
    );
    const projection = {
      fleet: authority!.fleet,
      passengerDemand,
      vehicleOperations: authority!.vehicleOperations,
      currentStopCalls: authority!.currentStopCalls,
      vehicleCapacities: authority!.vehicleCapacities,
      currentBoardingEvents: authority!.currentBoardingEvents,
      currentAlightingEvents: authority!.currentAlightingEvents,
      currentJourneyCompletionEvents: authority!.currentJourneyCompletionEvents,
      vehiclePassengerLoads,
      passengerOriginStopArrivalEvents: pendingPassengerOriginStopArrivalEvents,
    };
    publish(
      reliableListeners,
      freeze({ ...latestFoundationUpdate!, ...projection }),
    );
    if (renderListeners.size > 0)
      publish(
        renderListeners,
        freeze({
          ...latestFoundationRender!,
          ...projection,
        }),
      );
    pendingPassengerOriginStopArrivalEvents = [];
  };
  const enqueueOperation = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = commandQueue.then(operation);
    commandQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const client: TransportSimulationClient = {
    async connect(request) {
      if (lifecycle.state !== 'idle')
        throw new Error('Transport client can connect only from idle.');
      assertConnectShape(request);
      const nextAuthority =
        request.mode === 'new'
          ? createTransportSimulationState(
              request.scenario,
              request.initialSimulationTick,
              request.passengerDemandPlan,
            )
          : restoreTransportSimulationState(
              request.snapshot,
              request.scenario,
              request.passengerDemandPlan,
            );
      publishLifecycle({ state: 'connecting' });
      try {
        authority = nextAuthority;
        await foundation.connect(
          request.mode === 'new'
            ? {
                mode: 'new',
                gameId: request.gameId,
                timelineId: request.timelineId,
                initialSimulationTick: authority.tick,
              }
            : {
                mode: 'restore',
                gameId: request.gameId,
                timelineId: request.timelineId,
                snapshot: createFoundationSimulationSnapshot(
                  createFoundationState(authority.tick),
                ),
              },
        );
        publishLifecycle({
          state: 'ready',
          gameId: request.gameId,
          timelineId: request.timelineId,
          scenario: createScenarioCoordinate(authority.scenario),
        });
      } catch (error) {
        authority = undefined;
        publishLifecycle({
          state: 'failed',
          code: 'invalid-worker-message',
          message: (error as Error).message,
        });
        throw error;
      }
    },
    sendCommand(command) {
      return enqueueOperation(async () => {
        if (closing) throw new Error('Transport client is closed.');
        const current = authority;
        if (!current) throw new Error('Transport client is not ready.');
        if ('type' in command.command) {
          let parsedEnvelope: ReturnType<typeof parseFoundationCommandEnvelope>;
          try {
            parsedEnvelope = parseFoundationCommandEnvelope(command);
          } catch {
            return foundation.sendCommand(command as FoundationCommandEnvelope);
          }
          const fingerprint = fingerprintEnvelope(
            parsedEnvelope,
            parsedEnvelope.command,
          );
          const storedFingerprint = commandIntentFingerprints.get(
            parsedEnvelope.commandId,
          );
          if (
            storedFingerprint !== undefined &&
            storedFingerprint !== fingerprint
          )
            return commandConflict(command);
          const result = await foundation.sendCommand(parsedEnvelope);
          if (result.kind === 'foundation-command-result')
            commandIntentFingerprints.set(
              parsedEnvelope.commandId,
              fingerprint,
            );
          if (
            result.kind === 'foundation-command-result' &&
            result.status === 'applied' &&
            !result.duplicate
          )
            publishAuthority();
          return result;
        }
        let parsedCommand: TransportVehicleCommand;
        let parsedEnvelope: ReturnType<typeof parseFoundationCommandEnvelope>;
        try {
          parsedCommand = parseTransportVehicleCommand(
            command.command,
            current.graph,
          );
          parsedEnvelope = foundationEnvelope(command);
        } catch (error) {
          return freeze(
            parseFoundationProtocolError({
              kind: 'foundation-protocol-error',
              gameId: command.gameId,
              commandId: command.commandId,
              correlationId: command.correlationId,
              code: 'invalid-message',
              message: String(error),
            }),
          );
        }
        const fingerprint = fingerprintEnvelope(parsedEnvelope, parsedCommand);
        const storedFingerprint = commandIntentFingerprints.get(
          command.commandId,
        );
        if (
          storedFingerprint !== undefined &&
          storedFingerprint !== fingerprint
        )
          return commandConflict(command);
        let candidate = current;
        if (storedFingerprint === undefined)
          try {
            candidate = applyTransportVehicleCommand(current, parsedCommand);
          } catch (error) {
            return freeze(
              parseFoundationProtocolError({
                kind: 'foundation-protocol-error',
                gameId: command.gameId,
                commandId: command.commandId,
                correlationId: command.correlationId,
                code: 'invalid-message',
                message: String(error),
              }),
            );
          }
        const result = await foundation.sendCommand(parsedEnvelope);
        if (result.kind === 'foundation-command-result')
          commandIntentFingerprints.set(command.commandId, fingerprint);
        if (
          storedFingerprint === undefined &&
          result.kind === 'foundation-command-result' &&
          result.status === 'applied' &&
          !result.duplicate
        ) {
          authority = candidate;
          publishAuthority();
        }
        return result;
      });
    },
    synchronize(request) {
      return enqueueOperation(async () => {
        const current = closing ? undefined : authority;
        if (!current) throw new Error('Transport client is not ready.');
        const response = await foundation.synchronize(request);
        return freeze({
          kind: 'transport-synchronization-response',
          foundation: response,
          scenario: createScenarioCoordinate(current.scenario),
          fleet: current.fleet,
          passengerDemand: projectPassengerDemand(current.passengerDemand),
          vehicleOperations: current.vehicleOperations,
          currentStopCalls: current.currentStopCalls,
          vehicleCapacities: current.vehicleCapacities,
          currentBoardingEvents: current.currentBoardingEvents,
          currentAlightingEvents: current.currentAlightingEvents,
          currentJourneyCompletionEvents:
            current.currentJourneyCompletionEvents,
          vehiclePassengerLoads: projectVehiclePassengerLoads(
            current.vehicleCapacities,
            current.passengerDemand.status === 'active'
              ? current.passengerDemand.onboardGroups
              : [],
            current.currentAlightingEvents,
            current.currentBoardingEvents,
          ),
          passengerOriginStopArrivalEvents: [],
        });
      });
    },
    exportSnapshot() {
      return enqueueOperation(async () => {
        const current = closing ? undefined : authority;
        if (!current) throw new Error('Transport client is not ready.');
        const exported = await foundation.exportSnapshot();
        authority = advanceTransportTicks(
          current,
          parseTickAdvancement(exported.simulationTick - current.tick),
        );
        return freeze({
          kind: 'transport-snapshot-export',
          gameId: exported.gameId,
          timelineId: exported.timelineId,
          commandRevision: exported.commandRevision,
          simulationTick: exported.simulationTick,
          streamOffset: exported.streamOffset,
          snapshot: createTransportSimulationSnapshot(authority),
        });
      });
    },
    subscribeReliableUpdates: (listener) =>
      subscribe(reliableListeners, listener),
    subscribeRenderSnapshots: (listener) =>
      subscribe(renderListeners, listener),
    getLifecycle: () => lifecycle,
    subscribeLifecycle(listener) {
      if (closing || lifecycle.state === 'closed')
        throw new Error('Transport client is closed.');
      const registration = ++registrationSequence;
      lifecycleListeners.set(registration, listener);
      return () => lifecycleListeners.delete(registration);
    },
    getAuthoritativeState() {
      if (!authority) throw new Error('Transport client is not ready.');
      return authority;
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      authority = undefined;
      closePromise = (async () => {
        try {
          removeFoundationReliable();
          removeFoundationRender();
          await foundation.close();
        } finally {
          authority = undefined;
          publishLifecycle({ state: 'closed' });
          lifecycleListeners.clear();
          reliableListeners.clear();
          renderListeners.clear();
        }
      })();
      return closePromise;
    },
  };
  return Object.freeze(client);
}

export function createStructuredCloneTransportSimulationClient(): TransportSimulationClient {
  const direct = createDirectTransportSimulationClient();
  const clone = <T>(value: T): T => freeze(structuredClone(value));
  return Object.freeze({
    ...direct,
    connect: (request: TransportClientConnectRequest) =>
      direct.connect(structuredClone(request)),
    sendCommand: async (command: TransportCommandEnvelope) =>
      clone(await direct.sendCommand(structuredClone(command))),
    synchronize: async (request: FoundationSynchronizationRequest) =>
      clone(await direct.synchronize(structuredClone(request))),
    exportSnapshot: async () => clone(await direct.exportSnapshot()),
    subscribeReliableUpdates: (
      listener: (update: TransportStateUpdate) => void,
    ) => direct.subscribeReliableUpdates((update) => listener(clone(update))),
    subscribeRenderSnapshots: (
      listener: (snapshot: TransportRenderSnapshot) => void,
    ) =>
      direct.subscribeRenderSnapshots((snapshot) => listener(clone(snapshot))),
    getLifecycle: () => clone(direct.getLifecycle()),
    subscribeLifecycle: (listener: (state: TransportClientLifecycle) => void) =>
      direct.subscribeLifecycle((state) => listener(clone(state))),
  });
}
