import {
  buildDirectedScenarioGraph,
  parseScenarioPackage,
  type CanonicalScenario,
  type DirectedScenarioGraph,
  type ScenarioId,
} from '@torrevieja-tycoon/transport-domain';
import { z } from 'zod';
import { deepFreeze as freeze } from './authority-utils.js';
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
  advancePassengerDemandToTick,
  createDisabledPassengerDemandState,
  createInitialPassengerDemandState,
  parsePassengerDemandState,
  parsePassengerDemandPlan,
  validatePassengerDemandState,
  type PassengerDemandPlanV1,
  type PassengerDemandState,
} from './passenger-demand.js';
import {
  buildPassengerDirectItineraryPlan,
  createPassengerDirectItineraryRuntimeIndex,
  type PassengerDirectItineraryPlanV1,
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
  boardPassengersAtVehicleCalls,
  createVehiclePassengerCapacity,
  parseCurrentBoardingEvents,
  parseVehiclePassengerCapacities,
  validatePassengerBoardingAuthority,
  type CurrentBoardingEvent,
  type VehiclePassengerCapacity,
} from './passenger-boarding.js';
import { passengerWaitingCohortMatchesItinerary } from './passenger-waiting-cohort.js';

export type ScenarioCompatibilityErrorCode =
  | 'unsupported-transport-snapshot'
  | 'scenario-schema-mismatch'
  | 'scenario-id-mismatch'
  | 'scenario-version-mismatch'
  | 'scenario-content-hash-mismatch';

export const transportSimulationSnapshotSchemaVersion = 8 as const;

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
  readonly passengerDirectItineraryPlan: PassengerDirectItineraryPlanV1 | null;
  readonly passengerDirectItineraryIndex: PassengerDirectItineraryRuntimeIndex | null;
  readonly passengerDemand: PassengerDemandState;
  readonly vehicleOperations: readonly VehiclePatternRunState[];
  readonly currentStopCalls: readonly VehicleStopNodeCall[];
  readonly vehicleCapacities: readonly VehiclePassengerCapacity[];
  readonly currentBoardingEvents: readonly CurrentBoardingEvent[];
}

export interface TransportSimulationSnapshotV8 {
  readonly kind: 'transport-simulation-snapshot';
  readonly schemaVersion: 8;
  readonly simulationVersion: 'transport-8';
  readonly scenario: ScenarioCoordinate;
  readonly state: Readonly<{
    readonly tick: SimulationTick;
    readonly fleet: readonly VehicleState[];
    readonly passengerDemand: PassengerDemandState;
    readonly vehicleOperations: readonly VehiclePatternRunState[];
    readonly currentStopCalls: readonly VehicleStopNodeCall[];
    readonly vehicleCapacities: readonly VehiclePassengerCapacity[];
    readonly currentBoardingEvents: readonly CurrentBoardingEvent[];
  }>;
}

export type TransportSimulationSnapshot = TransportSimulationSnapshotV8;

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const coordinateSchema = z.strictObject({
  scenarioSchemaVersion: z.literal('1.0.0'),
  scenarioId: z.string().trim().min(1),
  scenarioVersion: z
    .string()
    .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
  contentHash: hash,
});
const snapshotV8Schema = z.strictObject({
  kind: z.literal('transport-simulation-snapshot'),
  schemaVersion: z.literal(transportSimulationSnapshotSchemaVersion),
  simulationVersion: z.literal('transport-8'),
  scenario: coordinateSchema,
  state: z.strictObject({
    tick: z.number().int().nonnegative().safe(),
    fleet: z.array(z.unknown()),
    passengerDemand: z.unknown(),
    vehicleOperations: z.unknown(),
    currentStopCalls: z.unknown(),
    vehicleCapacities: z.unknown(),
    currentBoardingEvents: z.unknown(),
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
  const itineraryPlan =
    parsedPlan === undefined
      ? undefined
      : buildPassengerDirectItineraryPlan({
          scenario,
          demandPlan: parsedPlan,
        });
  const itineraryIndex =
    itineraryPlan === undefined
      ? undefined
      : createPassengerDirectItineraryRuntimeIndex({
          plan: itineraryPlan,
          scenario,
          demandPlan: parsedPlan!,
        });
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
        : createInitialPassengerDemandState(parsedPlan, tick),
    vehicleOperations: [],
    currentStopCalls: [],
    vehicleCapacities: [],
    currentBoardingEvents: [],
  });
}

export function advanceTransportTicks(
  state: TransportSimulationState,
  count: TickAdvancement | number,
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
    current = freeze({
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
    const passengerDemand =
      current.passengerDemand.status === 'disabled'
        ? current.passengerDemand
        : advancePassengerDemandToTick(
            current.passengerDemandPlan!,
            current.passengerDirectItineraryIndex!,
            current.passengerDemand,
            tick,
          );
    const boarding =
      passengerDemand.status === 'disabled'
        ? null
        : boardPassengersAtVehicleCalls({
            tick,
            waitingCohorts: passengerDemand.waitingCohorts,
            onboardGroups: passengerDemand.onboardGroups,
            nextPassengerOnboardGroupSequence:
              passengerDemand.nextPassengerOnboardGroupSequence,
            totalBoardedPassengerCount:
              passengerDemand.totalBoardedPassengerCount,
            capacities: current.vehicleCapacities,
            vehicleOperations: operations,
            currentStopCalls: calls,
            itineraryIsValid: (cohort) => {
              const itinerary = current.passengerDirectItineraryIndex!.find(
                cohort.originStopPlaceId,
                cohort.destinationStopPlaceId,
              );
              return (
                itinerary.status === 'direct' &&
                passengerWaitingCohortMatchesItinerary(cohort, itinerary)
              );
            },
          });
    current = freeze({
      ...current,
      tick,
      fleet,
      vehicleOperations: operations,
      currentStopCalls: calls,
      passengerDemand:
        boarding === null
          ? passengerDemand
          : {
              ...passengerDemand,
              waitingCohorts: boarding.waitingCohorts,
              onboardGroups: boarding.onboardGroups,
              nextPassengerOnboardGroupSequence:
                boarding.nextPassengerOnboardGroupSequence,
              totalWaitingForVehiclePassengerCount:
                boarding.totalWaitingForVehiclePassengerCount,
              totalBoardedPassengerCount: boarding.totalBoardedPassengerCount,
              totalOnboardPassengerCount: boarding.totalOnboardPassengerCount,
            },
      currentBoardingEvents: boarding?.currentBoardingEvents ?? [],
    });
  }
  return current;
}

export function applyTransportVehicleCommand(
  state: TransportSimulationState,
  command: unknown,
): TransportSimulationState {
  const parsedCommand = parseTransportVehicleCommand(command, state.graph);
  const fleet = applyVehicleCommand(state.graph, state.fleet, command);
  if (fleet.length === state.fleet.length) {
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
      parsedCommand.kind === 'transport.vehicle.start'
        ? undefined
        : parsedCommand.passengerCapacity,
    ),
  ];
  const boarding =
    state.passengerDemand.status === 'disabled'
      ? null
      : boardPassengersAtVehicleCalls({
          tick: state.tick,
          waitingCohorts: state.passengerDemand.waitingCohorts,
          onboardGroups: state.passengerDemand.onboardGroups,
          nextPassengerOnboardGroupSequence:
            state.passengerDemand.nextPassengerOnboardGroupSequence,
          totalBoardedPassengerCount:
            state.passengerDemand.totalBoardedPassengerCount,
          capacities: vehicleCapacities,
          vehicleOperations: [...state.vehicleOperations, created.operation],
          currentStopCalls: [created.call],
          itineraryIsValid: (cohort) => {
            const itinerary = state.passengerDirectItineraryIndex!.find(
              cohort.originStopPlaceId,
              cohort.destinationStopPlaceId,
            );
            return (
              itinerary.status === 'direct' &&
              passengerWaitingCohortMatchesItinerary(cohort, itinerary)
            );
          },
        });
  return freeze({
    ...state,
    fleet,
    vehicleOperations: [...state.vehicleOperations, created.operation],
    vehicleCapacities,
    passengerDemand:
      boarding === null
        ? state.passengerDemand
        : {
            ...state.passengerDemand,
            waitingCohorts: boarding.waitingCohorts,
            onboardGroups: boarding.onboardGroups,
            nextPassengerOnboardGroupSequence:
              boarding.nextPassengerOnboardGroupSequence,
            totalWaitingForVehiclePassengerCount:
              boarding.totalWaitingForVehiclePassengerCount,
            totalBoardedPassengerCount: boarding.totalBoardedPassengerCount,
            totalOnboardPassengerCount: boarding.totalOnboardPassengerCount,
          },
    currentBoardingEvents: boarding?.currentBoardingEvents ?? [],
    currentStopCalls: [...state.currentStopCalls, created.call].sort(
      (left, right) =>
        left.vehicleId.localeCompare(right.vehicleId) ||
        left.stopCallSequence - right.stopCallSequence,
    ),
  });
}

export function parseTransportSimulationSnapshot(
  value: unknown,
): TransportSimulationSnapshot {
  const result = snapshotV8Schema.safeParse(value);
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
    },
  });
}

export function createTransportSimulationSnapshot(
  state: TransportSimulationState,
): TransportSimulationSnapshot {
  return parseTransportSimulationSnapshot({
    kind: 'transport-simulation-snapshot',
    schemaVersion: 8,
    simulationVersion: 'transport-8',
    scenario: createScenarioCoordinate(state.scenario),
    state: {
      tick: state.tick,
      fleet: state.fleet,
      passengerDemand: state.passengerDemand,
      vehicleOperations: state.vehicleOperations,
      currentStopCalls: state.currentStopCalls,
      vehicleCapacities: state.vehicleCapacities,
      currentBoardingEvents: state.currentBoardingEvents,
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
  const itineraryPlan =
    parsedPlan === undefined
      ? undefined
      : buildPassengerDirectItineraryPlan({
          scenario,
          demandPlan: parsedPlan,
        });
  const itineraryIndex =
    itineraryPlan === undefined
      ? undefined
      : createPassengerDirectItineraryRuntimeIndex({
          plan: itineraryPlan,
          scenario,
          demandPlan: parsedPlan!,
        });
  let passengerDemand: PassengerDemandState;
  if (snapshot.state.passengerDemand.status === 'disabled') {
    passengerDemand = createDisabledPassengerDemandState();
  } else {
    if (parsedPlan === undefined)
      throw new Error('Exact passenger demand plan is required.');
    if (!scenarioCoordinatesEqual(parsedPlan.scenario, snapshot.scenario))
      throw new Error('Passenger demand plan scenario mismatch.');
    passengerDemand = validatePassengerDemandState(
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
  if (passengerDemand.status === 'active')
    validatePassengerBoardingAuthority({
      tick: snapshot.state.tick,
      fleet,
      capacities: snapshot.state.vehicleCapacities,
      onboardGroups: passengerDemand.onboardGroups,
      nextPassengerOnboardGroupSequence:
        passengerDemand.nextPassengerOnboardGroupSequence,
      totalBoardedPassengerCount: passengerDemand.totalBoardedPassengerCount,
      totalOnboardPassengerCount: passengerDemand.totalOnboardPassengerCount,
      currentStopCalls: operating.calls,
      currentBoardingEvents: snapshot.state.currentBoardingEvents,
      itineraryIsValid: (group) => {
        const itinerary = itineraryIndex!.find(
          group.originStopPlaceId,
          group.destinationStopPlaceId,
        );
        return (
          itinerary.status === 'direct' &&
          group.originStopNodeId === itinerary.originStopNodeId &&
          group.routeId === itinerary.routeId &&
          group.patternId === itinerary.patternId &&
          group.originOccurrenceIndex === itinerary.originOccurrenceIndex &&
          group.destinationStopNodeId === itinerary.destinationStopNodeId &&
          group.destinationOccurrenceIndex ===
            itinerary.destinationOccurrenceIndex &&
          group.wrapsPatternEnd === itinerary.wrapsPatternEnd &&
          group.edgeCount === itinerary.edgeCount
        );
      },
    });
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
  });
}
