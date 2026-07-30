import {
  buildDirectedScenarioGraph,
  parseScenarioPackage,
  type CanonicalScenario,
  type DirectedScenarioGraph,
  type ScenarioId,
} from '@torrevieja-tycoon/transport-domain';
import { z } from 'zod';
import {
  parseSimulationTick,
  parseTickAdvancement,
  type SimulationTick,
  type TickAdvancement,
} from './time.js';
import {
  advanceVehicleFleet,
  applyVehicleCommand,
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

export type ScenarioCompatibilityErrorCode =
  | 'unsupported-transport-snapshot'
  | 'scenario-schema-mismatch'
  | 'scenario-id-mismatch'
  | 'scenario-version-mismatch'
  | 'scenario-content-hash-mismatch';

export const transportSimulationSnapshotSchemaVersion = 6 as const;

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
}

export interface TransportSimulationSnapshotV6 {
  readonly kind: 'transport-simulation-snapshot';
  readonly schemaVersion: 6;
  readonly simulationVersion: 'transport-6';
  readonly scenario: ScenarioCoordinate;
  readonly state: Readonly<{
    readonly tick: SimulationTick;
    readonly fleet: readonly VehicleState[];
    readonly passengerDemand: PassengerDemandState;
  }>;
}

export type TransportSimulationSnapshot = TransportSimulationSnapshotV6;

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const coordinateSchema = z.strictObject({
  scenarioSchemaVersion: z.literal('1.0.0'),
  scenarioId: z.string().trim().min(1),
  scenarioVersion: z
    .string()
    .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
  contentHash: hash,
});
const snapshotV6Schema = z.strictObject({
  kind: z.literal('transport-simulation-snapshot'),
  schemaVersion: z.literal(transportSimulationSnapshotSchemaVersion),
  simulationVersion: z.literal('transport-6'),
  scenario: coordinateSchema,
  state: z.strictObject({
    tick: z.number().int().nonnegative().safe(),
    fleet: z.array(z.unknown()),
    passengerDemand: z.unknown(),
  }),
});

const freeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
};

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
  });
}

export function advanceTransportTicks(
  state: TransportSimulationState,
  count: TickAdvancement | number,
): TransportSimulationState {
  const tickCount = parseTickAdvancement(count);
  const tick = parseSimulationTick(state.tick + tickCount);
  return freeze({
    tick,
    scenario: state.scenario,
    graph: state.graph,
    fleet: advanceVehicleFleet(state.graph, state.fleet, tickCount),
    passengerDemandPlan: state.passengerDemandPlan,
    passengerDirectItineraryPlan: state.passengerDirectItineraryPlan,
    passengerDirectItineraryIndex: state.passengerDirectItineraryIndex,
    passengerDemand:
      state.passengerDemand.status === 'disabled'
        ? state.passengerDemand
        : advancePassengerDemandToTick(
            state.passengerDemandPlan!,
            state.passengerDirectItineraryIndex!,
            state.passengerDemand,
            tick,
          ),
  });
}

export function applyTransportVehicleCommand(
  state: TransportSimulationState,
  command: unknown,
): TransportSimulationState {
  return freeze({
    ...state,
    fleet: applyVehicleCommand(state.graph, state.fleet, command),
  });
}

export function parseTransportSimulationSnapshot(
  value: unknown,
): TransportSimulationSnapshot {
  const result = snapshotV6Schema.safeParse(value);
  if (!result.success)
    throw new ScenarioCompatibilityError(
      'unsupported-transport-snapshot',
      result.error.issues[0]!.message,
    );
  const passengerDemand = parsePassengerDemandState(
    result.data.state.passengerDemand,
  );
  const tick = parseSimulationTick(result.data.state.tick);
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
      fleet: parseVehicleFleetSnapshot(result.data.state.fleet),
      passengerDemand,
    },
  });
}

export function createTransportSimulationSnapshot(
  state: TransportSimulationState,
): TransportSimulationSnapshot {
  return parseTransportSimulationSnapshot({
    kind: 'transport-simulation-snapshot',
    schemaVersion: 6,
    simulationVersion: 'transport-6',
    scenario: createScenarioCoordinate(state.scenario),
    state: {
      tick: state.tick,
      fleet: state.fleet,
      passengerDemand: state.passengerDemand,
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
    fleet: restoreVehicleFleet(
      graph,
      snapshot.state.fleet,
      snapshot.state.tick,
    ),
  });
}
