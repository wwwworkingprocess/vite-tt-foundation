import {
  buildDirectedScenarioGraph,
  parseScenarioPackage,
  type CanonicalScenario,
  type DirectedScenarioGraph,
  type ScenarioId,
} from '@torrevieja-tycoon/transport-domain';
import { z } from 'zod';
import {
  deepFreeze as freeze,
  freezeTrustedAuthority,
} from './authority-utils.js';
import {
  parseSimulationTick,
  parseTickAdvancement,
  type SimulationTick,
  type TickAdvancement,
} from './time.js';
import {
  advanceVehicleFleet,
  applyVehicleCommand,
  parseTransportVehicleCommand,
  parseVehicleFleetSnapshot,
  restoreVehicleFleet,
  type VehicleState,
} from './vehicle-movement.js';
import {
  advanceTrustedPassengerDemandToTick,
  advanceTrustedPassengerDemandToTickWithEvents,
  createDisabledPassengerDemandState,
  createInitialTrustedPassengerDemandState,
  parsePassengerDemandState,
  parsePassengerDemandPlan,
  validateTrustedPassengerDemandState,
  type PassengerDemandPlanV1,
  type PassengerDemandState,
  type PassengerOriginStopArrivalEvent,
} from './passenger-demand.js';
import {
  buildTrustedPassengerDirectItineraryAuthority,
  type PassengerDirectItineraryPlanV2,
  type PassengerDirectItineraryRuntimeIndex,
} from './passenger-direct-itinerary.js';
import {
  createVehicleOperationAuthority,
  deriveVehicleOperationTransition,
  fastForwardVehicleOperation,
  parseVehicleOperationAuthority,
  parseVehicleStopNodeCalls,
  validateVehicleOperationAuthority,
  type VehiclePatternRunState,
  type VehicleStopNodeCall,
} from './vehicle-operation.js';
import {
  createVehiclePassengerCapacity,
  parseCurrentBoardingEvents,
  parseVehiclePassengerCapacities,
  type CurrentBoardingEvent,
  type VehiclePassengerCapacity,
} from './passenger-boarding.js';
import {
  parseCurrentAlightingEvents,
  parsePassengerJourneyCompletionEvents,
  processPassengerTransitAtVehicleCalls,
  validatePassengerTransitReplay,
  validatePassengerJourneyRunAndCallIdentity,
  type CurrentAlightingEvent,
  type PassengerJourneyCompletionEvent,
} from './passenger-transit.js';
import { passengerWaitingCohortMatchesItinerary } from './passenger-waiting-cohort.js';

export type ScenarioCompatibilityErrorCode =
  | 'unsupported-transport-snapshot'
  | 'scenario-schema-mismatch'
  | 'scenario-id-mismatch'
  | 'scenario-version-mismatch'
  | 'scenario-content-hash-mismatch';

export const transportSimulationSnapshotSchemaVersion = 9 as const;

const compareCurrentPassengerEvents = (
  left: { readonly vehicleId: string },
  right: { readonly vehicleId: string },
) => left.vehicleId.localeCompare(right.vehicleId);

function passengerWaitingCohortMatchesRuntimeItinerary(
  index: PassengerDirectItineraryRuntimeIndex,
  cohort: Parameters<typeof passengerWaitingCohortMatchesItinerary>[0],
): boolean {
  const itinerary = index.find(
    cohort.originStopPlaceId,
    cohort.destinationStopPlaceId,
  );
  return (
    itinerary !== undefined &&
    passengerWaitingCohortMatchesItinerary(cohort, itinerary)
  );
}

export class ScenarioCompatibilityError extends Error {
  constructor(
    readonly code: ScenarioCompatibilityErrorCode,
    context: string,
  ) {
    super(`${code}: ${context}`);
    this.name = 'ScenarioCompatibilityError';
    Object.freeze(this);
  }
}

export interface ScenarioCoordinate {
  readonly scenarioSchemaVersion: '1.0.0';
  readonly scenarioId: ScenarioId;
  readonly scenarioVersion: string;
  readonly contentHash: string;
}

export interface TransportSimulationState {
  readonly tick: SimulationTick;
  readonly scenario: CanonicalScenario;
  readonly graph: DirectedScenarioGraph;
  readonly fleet: readonly VehicleState[];
  readonly passengerDemandPlan: PassengerDemandPlanV1 | null;
  readonly passengerDirectItineraryPlan: PassengerDirectItineraryPlanV2 | null;
  readonly passengerDirectItineraryIndex: PassengerDirectItineraryRuntimeIndex | null;
  readonly passengerDemand: PassengerDemandState;
  readonly vehicleOperations: readonly VehiclePatternRunState[];
  readonly currentStopCalls: readonly VehicleStopNodeCall[];
  readonly vehicleCapacities: readonly VehiclePassengerCapacity[];
  readonly currentBoardingEvents: readonly CurrentBoardingEvent[];
  readonly currentAlightingEvents: readonly CurrentAlightingEvent[];
  readonly currentJourneyCompletionEvents: readonly PassengerJourneyCompletionEvent[];
}

export interface TransportSimulationSnapshotV9 {
  readonly kind: 'transport-simulation-snapshot';
  readonly schemaVersion: 9;
  readonly simulationVersion: 'transport-9';
  readonly scenario: ScenarioCoordinate;
  readonly state: Readonly<{
    readonly tick: SimulationTick;
    readonly fleet: readonly VehicleState[];
    readonly passengerDemand: PassengerDemandState;
    readonly vehicleOperations: readonly VehiclePatternRunState[];
    readonly currentStopCalls: readonly VehicleStopNodeCall[];
    readonly vehicleCapacities: readonly VehiclePassengerCapacity[];
    readonly currentBoardingEvents: readonly CurrentBoardingEvent[];
    readonly currentAlightingEvents: readonly CurrentAlightingEvent[];
    readonly currentJourneyCompletionEvents: readonly PassengerJourneyCompletionEvent[];
  }>;
}

export type TransportSimulationSnapshot = TransportSimulationSnapshotV9;

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const coordinateSchema = z.strictObject({
  scenarioSchemaVersion: z.literal('1.0.0'),
  scenarioId: z.string().trim().min(1),
  scenarioVersion: z
    .string()
    .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
  contentHash: hash,
});
const snapshotV9Schema = z.strictObject({
  kind: z.literal('transport-simulation-snapshot'),
  schemaVersion: z.literal(transportSimulationSnapshotSchemaVersion),
  simulationVersion: z.literal('transport-9'),
  scenario: coordinateSchema,
  state: z.strictObject({
    tick: z.number().int().nonnegative().safe(),
    fleet: z.array(z.unknown()),
    passengerDemand: z.unknown(),
    vehicleOperations: z.unknown(),
    currentStopCalls: z.unknown(),
    vehicleCapacities: z.unknown(),
    currentBoardingEvents: z.unknown(),
    currentAlightingEvents: z.unknown(),
    currentJourneyCompletionEvents: z.unknown(),
  }),
});

const reparseScenario = (scenario: CanonicalScenario) =>
  parseScenarioPackage({
    manifest: scenario.manifest,
    settlements: scenario.settlements,
    stops: scenario.stops,
    routes: scenario.routes,
    presentation: scenario.presentation,
    provenance: scenario.provenance,
  });

export function createScenarioCoordinate(
  scenario: CanonicalScenario,
): ScenarioCoordinate {
  return freeze({
    scenarioSchemaVersion: scenario.manifest.schemaVersion,
    scenarioId: scenario.manifest.scenarioId,
    scenarioVersion: scenario.manifest.scenarioVersion,
    contentHash: scenario.manifest.contentHash,
  });
}

export function scenarioCoordinatesEqual(
  left: ScenarioCoordinate,
  right: ScenarioCoordinate,
): boolean {
  return (
    left.scenarioSchemaVersion === right.scenarioSchemaVersion &&
    left.scenarioId === right.scenarioId &&
    left.scenarioVersion === right.scenarioVersion &&
    left.contentHash === right.contentHash
  );
}

export function createTransportSimulationState(
  inputScenario: CanonicalScenario,
  tick: number,
  passengerDemandPlan?: PassengerDemandPlanV1,
): TransportSimulationState {
  const scenario = reparseScenario(inputScenario);
  const scenarioCoordinate = createScenarioCoordinate(scenario);
  const parsedPlan =
    passengerDemandPlan === undefined
      ? undefined
      : parsePassengerDemandPlan(passengerDemandPlan);
  if (
    parsedPlan !== undefined &&
    !scenarioCoordinatesEqual(parsedPlan.scenario, scenarioCoordinate)
  )
    throw new ScenarioCompatibilityError(
      'scenario-id-mismatch',
      'passenger demand plan scenario',
    );
  const itineraryAuthority =
    parsedPlan === undefined
      ? undefined
      : buildTrustedPassengerDirectItineraryAuthority({
          scenario,
          demandPlan: parsedPlan,
        });
  const itineraryPlan = itineraryAuthority?.plan;
  const itineraryIndex = itineraryAuthority?.index;
  return freeze({
    tick: parseSimulationTick(tick),
    scenario,
    graph: buildDirectedScenarioGraph(scenario),
    fleet: [],
    passengerDemandPlan: parsedPlan ?? null,
    passengerDirectItineraryPlan: itineraryPlan ?? null,
    passengerDirectItineraryIndex: itineraryIndex ?? null,
    passengerDemand:
      parsedPlan === undefined
        ? createDisabledPassengerDemandState()
        : createInitialTrustedPassengerDemandState(parsedPlan, tick),
    vehicleOperations: [],
    currentStopCalls: [],
    vehicleCapacities: [],
    currentBoardingEvents: [],
    currentAlightingEvents: [],
    currentJourneyCompletionEvents: [],
  });
}

function advanceTransportTicksInternal(
  state: TransportSimulationState,
  count: TickAdvancement | number,
  arrivalEvents?: PassengerOriginStopArrivalEvent[],
): TransportSimulationState {
  const tickCount = parseTickAdvancement(count) as number;
  let current = state;
  if (
    tickCount > 100 &&
    state.passengerDemand.status === 'disabled' &&
    state.fleet.every(
      (vehicle) =>
        vehicle.movement.kind !== 'parked-at-stop' &&
        vehicle.movement.kind !== 'completed-at-stop' &&
        (vehicle.routeLegs !== undefined ||
          state.graph.pattern(vehicle.patternId)?.closesLoop === true),
    )
  ) {
    const skipped = tickCount - 1;
    const tick = parseSimulationTick(state.tick + skipped);
    const fleet = advanceVehicleFleet(
      state.graph,
      state.fleet,
      parseTickAdvancement(skipped),
    );
    current = freezeTrustedAuthority({
      ...state,
      tick,
      fleet,
      vehicleOperations: fleet.map((vehicle, index) =>
        fastForwardVehicleOperation({
          graph: state.graph,
          before: state.fleet[index]!,
          after: vehicle,
          operation: state.vehicleOperations[index]!,
          tick,
          advancement: skipped,
        }),
      ),
      currentStopCalls: [],
      currentBoardingEvents: [],
      currentAlightingEvents: [],
      currentJourneyCompletionEvents: [],
    });
  }
  const remainingTicks = current === state ? tickCount : 1;
  for (let index = 0; index < remainingTicks; index += 1) {
    const tick = parseSimulationTick(current.tick + 1);
    const fleet = advanceVehicleFleet(
      current.graph,
      current.fleet,
      parseTickAdvancement(1),
    );
    const operations: VehiclePatternRunState[] = [];
    const calls: VehicleStopNodeCall[] = [];
    for (let vehicleIndex = 0; vehicleIndex < fleet.length; vehicleIndex += 1) {
      const transition = deriveVehicleOperationTransition({
        graph: current.graph,
        before: current.fleet[vehicleIndex]!,
        after: fleet[vehicleIndex]!,
        operation: current.vehicleOperations[vehicleIndex]!,
        tick,
      });
      operations.push(transition.operation);
      calls.push(...transition.calls);
    }
    calls.sort(
      (left, right) =>
        left.vehicleId.localeCompare(right.vehicleId) ||
        left.stopCallSequence - right.stopCallSequence,
    );
    const demandAdvancement =
      current.passengerDemand.status === 'active' && arrivalEvents !== undefined
        ? advanceTrustedPassengerDemandToTickWithEvents(
            current.passengerDemandPlan!,
            current.passengerDirectItineraryIndex!,
            current.passengerDemand,
            tick,
          )
        : undefined;
    if (demandAdvancement !== undefined) {
      arrivalEvents!.push(
        ...demandAdvancement.passengerOriginStopArrivalEvents,
      );
    }
    const passengerDemand =
      current.passengerDemand.status === 'disabled'
        ? current.passengerDemand
        : (demandAdvancement?.state ??
          advanceTrustedPassengerDemandToTick(
            current.passengerDemandPlan!,
            current.passengerDirectItineraryIndex!,
            current.passengerDemand,
            tick,
          ));
    const transit =
      passengerDemand.status === 'disabled'
        ? null
        : processPassengerTransitAtVehicleCalls({
            tick,
            demandPlan: current.passengerDemandPlan!,
            waitingCohorts: passengerDemand.waitingCohorts,
            waitingGenerationLineageWatermarks:
              passengerDemand.waitingGenerationLineageWatermarks,
            onboardGroups: passengerDemand.onboardGroups,
            destinationAccessGroups: passengerDemand.destinationAccessGroups,
            nextPassengerOnboardGroupSequence:
              passengerDemand.nextPassengerOnboardGroupSequence,
            nextPassengerDestinationAccessGroupSequence:
              passengerDemand.nextPassengerDestinationAccessGroupSequence,
            totalWaitingForVehiclePassengerCount:
              passengerDemand.totalWaitingForVehiclePassengerCount,
            totalBoardedPassengerCount:
              passengerDemand.totalBoardedPassengerCount,
            totalOnboardPassengerCount:
              passengerDemand.totalOnboardPassengerCount,
            totalAlightedPassengerCount:
              passengerDemand.totalAlightedPassengerCount,
            totalInDestinationAccessPassengerCount:
              passengerDemand.totalInDestinationAccessPassengerCount,
            totalCompletedJourneyPassengerCount:
              passengerDemand.totalCompletedJourneyPassengerCount,
            capacities: current.vehicleCapacities,
            vehicleOperations: operations,
            currentStopCalls: calls,
            itineraryIsValid:
              passengerWaitingCohortMatchesRuntimeItinerary.bind(
                undefined,
                current.passengerDirectItineraryIndex!,
              ),
          });
    current = freezeTrustedAuthority({
      ...current,
      tick,
      fleet,
      vehicleOperations: operations,
      currentStopCalls: calls,
      passengerDemand:
        transit === null
          ? passengerDemand
          : {
              ...passengerDemand,
              waitingCohorts: transit.waitingCohorts,
              waitingGenerationLineageWatermarks:
                transit.waitingGenerationLineageWatermarks,
              onboardGroups: transit.onboardGroups,
              destinationAccessGroups: transit.destinationAccessGroups,
              nextPassengerOnboardGroupSequence:
                transit.nextPassengerOnboardGroupSequence,
              nextPassengerDestinationAccessGroupSequence:
                transit.nextPassengerDestinationAccessGroupSequence,
              totalWaitingForVehiclePassengerCount:
                transit.totalWaitingForVehiclePassengerCount,
              totalBoardedPassengerCount: transit.totalBoardedPassengerCount,
              totalOnboardPassengerCount: transit.totalOnboardPassengerCount,
              totalAlightedPassengerCount: transit.totalAlightedPassengerCount,
              totalInDestinationAccessPassengerCount:
                transit.totalInDestinationAccessPassengerCount,
              totalCompletedJourneyPassengerCount:
                transit.totalCompletedJourneyPassengerCount,
            },
      currentAlightingEvents: transit?.currentAlightingEvents ?? [],
      currentBoardingEvents: transit?.currentBoardingEvents ?? [],
      currentJourneyCompletionEvents:
        transit?.currentJourneyCompletionEvents ?? [],
    });
  }
  return current;
}

export function advanceTransportTicks(
  state: TransportSimulationState,
  count: TickAdvancement | number,
): TransportSimulationState {
  return advanceTransportTicksInternal(state, count);
}

export interface TransportTickAdvancementResult {
  readonly state: TransportSimulationState;
  readonly passengerOriginStopArrivalEvents: readonly Readonly<PassengerOriginStopArrivalEvent>[];
}

export function advanceTransportTicksWithEvents(
  state: TransportSimulationState,
  count: TickAdvancement | number,
): TransportTickAdvancementResult {
  const tickCount = parseTickAdvancement(count) as number;
  const events: PassengerOriginStopArrivalEvent[] = [];
  const current = advanceTransportTicksInternal(state, tickCount, events);
  return freeze({
    state: current,
    passengerOriginStopArrivalEvents: events,
  });
}

export function applyTransportVehicleCommand(
  state: TransportSimulationState,
  command: unknown,
): TransportSimulationState {
  const parsedCommand = parseTransportVehicleCommand(command, state.graph);
  const fleet = applyVehicleCommand(state.graph, state.fleet, command);
  if (parsedCommand.kind === 'transport.vehicle.start') {
    const vehicleOperations = state.vehicleOperations.map((operation, index) =>
      state.fleet[index]!.movement.kind === 'parked-at-stop' &&
      fleet[index]!.movement.kind === 'running-at-stop'
        ? freeze({
            ...operation,
            movementStartedAtTick: state.tick,
          })
        : operation,
    );
    return freeze({ ...state, fleet, vehicleOperations });
  }
  const created = createVehicleOperationAuthority(
    state.graph,
    fleet.at(-1)!,
    state.tick,
  );
  const vehicleCapacities = [
    ...state.vehicleCapacities,
    createVehiclePassengerCapacity(
      fleet.at(-1)!.vehicleId,
      parsedCommand.passengerCapacity,
    ),
  ];
  const transit =
    state.passengerDemand.status === 'disabled'
      ? null
      : processPassengerTransitAtVehicleCalls({
          tick: state.tick,
          demandPlan: state.passengerDemandPlan!,
          waitingCohorts: state.passengerDemand.waitingCohorts,
          waitingGenerationLineageWatermarks:
            state.passengerDemand.waitingGenerationLineageWatermarks,
          onboardGroups: state.passengerDemand.onboardGroups,
          destinationAccessGroups:
            state.passengerDemand.destinationAccessGroups,
          nextPassengerOnboardGroupSequence:
            state.passengerDemand.nextPassengerOnboardGroupSequence,
          nextPassengerDestinationAccessGroupSequence:
            state.passengerDemand.nextPassengerDestinationAccessGroupSequence,
          totalWaitingForVehiclePassengerCount:
            state.passengerDemand.totalWaitingForVehiclePassengerCount,
          totalBoardedPassengerCount:
            state.passengerDemand.totalBoardedPassengerCount,
          totalOnboardPassengerCount:
            state.passengerDemand.totalOnboardPassengerCount,
          totalAlightedPassengerCount:
            state.passengerDemand.totalAlightedPassengerCount,
          totalInDestinationAccessPassengerCount:
            state.passengerDemand.totalInDestinationAccessPassengerCount,
          totalCompletedJourneyPassengerCount:
            state.passengerDemand.totalCompletedJourneyPassengerCount,
          capacities: vehicleCapacities,
          vehicleOperations: [...state.vehicleOperations, created.operation],
          currentStopCalls: [created.call],
          itineraryIsValid: passengerWaitingCohortMatchesRuntimeItinerary.bind(
            undefined,
            state.passengerDirectItineraryIndex!,
          ),
        });
  const currentAlightingEvents = [] as CurrentAlightingEvent[];
  for (const event of state.currentAlightingEvents)
    if (event.tick === state.tick) currentAlightingEvents.push(event);
  currentAlightingEvents.push(...(transit?.currentAlightingEvents ?? []));
  currentAlightingEvents.sort(compareCurrentPassengerEvents);
  return freeze({
    ...state,
    fleet,
    vehicleOperations: [...state.vehicleOperations, created.operation],
    vehicleCapacities,
    passengerDemand:
      transit === null
        ? state.passengerDemand
        : {
            ...state.passengerDemand,
            waitingCohorts: transit.waitingCohorts,
            waitingGenerationLineageWatermarks:
              transit.waitingGenerationLineageWatermarks,
            onboardGroups: transit.onboardGroups,
            destinationAccessGroups: transit.destinationAccessGroups,
            nextPassengerOnboardGroupSequence:
              transit.nextPassengerOnboardGroupSequence,
            nextPassengerDestinationAccessGroupSequence:
              transit.nextPassengerDestinationAccessGroupSequence,
            totalWaitingForVehiclePassengerCount:
              transit.totalWaitingForVehiclePassengerCount,
            totalBoardedPassengerCount: transit.totalBoardedPassengerCount,
            totalOnboardPassengerCount: transit.totalOnboardPassengerCount,
            totalAlightedPassengerCount: transit.totalAlightedPassengerCount,
            totalInDestinationAccessPassengerCount:
              transit.totalInDestinationAccessPassengerCount,
            totalCompletedJourneyPassengerCount:
              transit.totalCompletedJourneyPassengerCount,
          },
    currentAlightingEvents,
    currentBoardingEvents: [
      ...state.currentBoardingEvents.filter(
        (event) => event.tick === state.tick,
      ),
      ...(transit?.currentBoardingEvents ?? []),
    ].sort(compareCurrentPassengerEvents),
    currentJourneyCompletionEvents: [
      ...state.currentJourneyCompletionEvents,
      ...(transit?.currentJourneyCompletionEvents ?? []),
    ],
    currentStopCalls: [...state.currentStopCalls, created.call].sort(
      (left, right) => left.vehicleId.localeCompare(right.vehicleId),
    ),
  });
}

export function parseTransportSimulationSnapshot(
  value: unknown,
): TransportSimulationSnapshot {
  const result = snapshotV9Schema.safeParse(value);
  if (!result.success)
    throw new ScenarioCompatibilityError(
      'unsupported-transport-snapshot',
      result.error.issues[0]!.message,
    );
  const passengerDemand = parsePassengerDemandState(
    result.data.state.passengerDemand,
  );
  const tick = parseSimulationTick(result.data.state.tick);
  const fleet = parseVehicleFleetSnapshot(result.data.state.fleet);
  const vehicleOperations = parseVehicleOperationAuthority(
    result.data.state.vehicleOperations,
  );
  const currentStopCalls = parseVehicleStopNodeCalls(
    result.data.state.currentStopCalls,
  );
  const vehicleCapacities = parseVehiclePassengerCapacities(
    result.data.state.vehicleCapacities,
  );
  const currentBoardingEvents = parseCurrentBoardingEvents(
    result.data.state.currentBoardingEvents,
  );
  const currentAlightingEvents = parseCurrentAlightingEvents(
    result.data.state.currentAlightingEvents,
  );
  const currentJourneyCompletionEvents = parsePassengerJourneyCompletionEvents(
    result.data.state.currentJourneyCompletionEvents,
  );
  if (
    passengerDemand.status === 'active' &&
    passengerDemand.processedThroughTick !== tick
  )
    throw new ScenarioCompatibilityError(
      'unsupported-transport-snapshot',
      'Passenger demand processed tick must equal the snapshot tick.',
    );
  return freeze({
    ...result.data,
    scenario: result.data.scenario as ScenarioCoordinate,
    state: {
      tick,
      fleet,
      passengerDemand,
      vehicleOperations,
      currentStopCalls,
      vehicleCapacities,
      currentBoardingEvents,
      currentAlightingEvents,
      currentJourneyCompletionEvents,
    },
  });
}

export function createTransportSimulationSnapshot(
  state: TransportSimulationState,
): TransportSimulationSnapshot {
  return parseTransportSimulationSnapshot({
    kind: 'transport-simulation-snapshot',
    schemaVersion: 9,
    simulationVersion: 'transport-9',
    scenario: createScenarioCoordinate(state.scenario),
    state: {
      tick: state.tick,
      fleet: state.fleet,
      passengerDemand: state.passengerDemand,
      vehicleOperations: state.vehicleOperations,
      currentStopCalls: state.currentStopCalls,
      vehicleCapacities: state.vehicleCapacities,
      currentBoardingEvents: state.currentBoardingEvents,
      currentAlightingEvents: state.currentAlightingEvents,
      currentJourneyCompletionEvents: state.currentJourneyCompletionEvents,
    },
  });
}

function assertCoordinate(
  expected: ScenarioCoordinate,
  actual: ScenarioCoordinate,
): void {
  const checks = [
    ['scenarioSchemaVersion', 'scenario-schema-mismatch'],
    ['scenarioId', 'scenario-id-mismatch'],
    ['scenarioVersion', 'scenario-version-mismatch'],
    ['contentHash', 'scenario-content-hash-mismatch'],
  ] as const;
  for (const [field, code] of checks)
    if (expected[field] !== actual[field])
      throw new ScenarioCompatibilityError(code, field);
}

export function restoreTransportSimulationState(
  snapshotValue: unknown,
  scenarioValue: CanonicalScenario,
  passengerDemandPlan?: PassengerDemandPlanV1,
): TransportSimulationState {
  const snapshot = parseTransportSimulationSnapshot(snapshotValue);
  const scenario = reparseScenario(scenarioValue);
  assertCoordinate(snapshot.scenario, createScenarioCoordinate(scenario));
  const graph = buildDirectedScenarioGraph(scenario);
  const parsedPlan =
    passengerDemandPlan === undefined
      ? undefined
      : parsePassengerDemandPlan(passengerDemandPlan);
  if (
    parsedPlan !== undefined &&
    !scenarioCoordinatesEqual(parsedPlan.scenario, snapshot.scenario)
  )
    throw new Error('Passenger demand plan scenario mismatch.');
  const itineraryAuthority =
    parsedPlan === undefined
      ? undefined
      : buildTrustedPassengerDirectItineraryAuthority({
          scenario,
          demandPlan: parsedPlan,
        });
  const itineraryPlan = itineraryAuthority?.plan;
  const itineraryIndex = itineraryAuthority?.index;
  let passengerDemand: PassengerDemandState;
  if (snapshot.state.passengerDemand.status === 'disabled') {
    if (
      snapshot.state.currentBoardingEvents.length > 0 ||
      snapshot.state.currentAlightingEvents.length > 0 ||
      snapshot.state.currentJourneyCompletionEvents.length > 0
    )
      throw new Error('Disabled passenger authority cannot publish events.');
    passengerDemand = createDisabledPassengerDemandState();
  } else {
    if (parsedPlan === undefined)
      throw new Error('Exact passenger demand plan is required.');
    passengerDemand = validateTrustedPassengerDemandState(
      parsedPlan,
      itineraryIndex!,
      snapshot.state.passengerDemand,
    );
  }
  const fleet = restoreVehicleFleet(
    graph,
    snapshot.state.fleet,
    snapshot.state.tick,
  );
  if (
    snapshot.state.vehicleCapacities.length !== fleet.length ||
    snapshot.state.vehicleCapacities.some(
      (capacity, index) => capacity.vehicleId !== fleet[index]!.vehicleId,
    )
  )
    throw new Error('Vehicle capacity authority must align with fleet.');
  const operating = validateVehicleOperationAuthority({
    graph,
    fleet,
    operations: snapshot.state.vehicleOperations,
    calls: snapshot.state.currentStopCalls,
    tick: snapshot.state.tick,
  });
  if (passengerDemand.status === 'active') {
    const itineraryIsValid = (
      group: Parameters<typeof passengerWaitingCohortMatchesItinerary>[0],
    ) => {
      const itinerary = itineraryIndex!.find(
        group.originStopPlaceId,
        group.destinationStopPlaceId,
      );
      return (
        itinerary !== undefined &&
        passengerWaitingCohortMatchesItinerary(group, itinerary)
      );
    };
    validatePassengerJourneyRunAndCallIdentity({
      graph,
      fleet,
      vehicleOperations: operating.operations,
      currentStopCalls: operating.calls,
      onboardGroups: passengerDemand.onboardGroups,
      destinationAccessGroups: passengerDemand.destinationAccessGroups,
      currentJourneyCompletionEvents:
        snapshot.state.currentJourneyCompletionEvents,
    });
    validatePassengerTransitReplay({
      tick: snapshot.state.tick,
      demandPlan: parsedPlan!,
      capacities: snapshot.state.vehicleCapacities,
      onboardGroups: passengerDemand.onboardGroups,
      waitingCohorts: passengerDemand.waitingCohorts,
      waitingGenerationLineageWatermarks:
        passengerDemand.waitingGenerationLineageWatermarks,
      destinationAccessGroups: passengerDemand.destinationAccessGroups,
      nextPassengerOnboardGroupSequence:
        passengerDemand.nextPassengerOnboardGroupSequence,
      nextPassengerDestinationAccessGroupSequence:
        passengerDemand.nextPassengerDestinationAccessGroupSequence,
      totalWaitingForVehiclePassengerCount:
        passengerDemand.totalWaitingForVehiclePassengerCount,
      totalBoardedPassengerCount: passengerDemand.totalBoardedPassengerCount,
      totalOnboardPassengerCount: passengerDemand.totalOnboardPassengerCount,
      totalAlightedPassengerCount: passengerDemand.totalAlightedPassengerCount,
      totalInDestinationAccessPassengerCount:
        passengerDemand.totalInDestinationAccessPassengerCount,
      totalCompletedJourneyPassengerCount:
        passengerDemand.totalCompletedJourneyPassengerCount,
      currentStopCalls: operating.calls,
      currentAlightingEvents: snapshot.state.currentAlightingEvents,
      currentBoardingEvents: snapshot.state.currentBoardingEvents,
      currentJourneyCompletionEvents:
        snapshot.state.currentJourneyCompletionEvents,
      vehicleOperations: operating.operations,
      itineraryIsValid,
    });
  }
  return freeze({
    tick: snapshot.state.tick,
    scenario,
    graph,
    passengerDemandPlan:
      passengerDemand.status === 'active' ? parsedPlan! : null,
    passengerDirectItineraryPlan:
      passengerDemand.status === 'active' ? itineraryPlan! : null,
    passengerDirectItineraryIndex:
      passengerDemand.status === 'active' ? itineraryIndex! : null,
    passengerDemand,
    fleet,
    vehicleOperations: operating.operations,
    currentStopCalls: operating.calls,
    vehicleCapacities: snapshot.state.vehicleCapacities,
    currentBoardingEvents: snapshot.state.currentBoardingEvents,
    currentAlightingEvents: snapshot.state.currentAlightingEvents,
    currentJourneyCompletionEvents:
      snapshot.state.currentJourneyCompletionEvents,
  });
}
