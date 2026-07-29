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
  migratePassengerDemandStateV4,
  parsePassengerDemandState,
  parsePassengerDemandStateV4,
  parsePassengerDemandPlan,
  validatePassengerDemandState,
  type PassengerDemandPlanV1,
  type PassengerDemandState,
  type PassengerDemandStateV4,
} from './passenger-demand.js';

export type ScenarioCompatibilityErrorCode =
  | 'unsupported-transport-snapshot'
  | 'scenario-schema-mismatch'
  | 'scenario-id-mismatch'
  | 'scenario-version-mismatch'
  | 'scenario-content-hash-mismatch';

export const transportSimulationSnapshotSchemaVersion = 5 as const;

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
  readonly passengerDemand: PassengerDemandState;
}

export interface TransportSimulationSnapshotV1 {
  readonly kind: 'transport-simulation-snapshot';
  readonly schemaVersion: 1;
  readonly simulationVersion: 'transport-1';
  readonly scenario: ScenarioCoordinate;
  readonly state: Readonly<{ readonly tick: SimulationTick }>;
}

export interface TransportSimulationSnapshotV2 {
  readonly kind: 'transport-simulation-snapshot';
  readonly schemaVersion: 2;
  readonly simulationVersion: 'transport-2';
  readonly scenario: ScenarioCoordinate;
  readonly state: Readonly<{
    readonly tick: SimulationTick;
    readonly fleet: readonly VehicleState[];
  }>;
}

export interface TransportSimulationSnapshotV3 {
  readonly kind: 'transport-simulation-snapshot';
  readonly schemaVersion: 3;
  readonly simulationVersion: 'transport-3';
  readonly scenario: ScenarioCoordinate;
  readonly state: Readonly<{
    readonly tick: SimulationTick;
    readonly fleet: readonly VehicleState[];
  }>;
}

export interface TransportSimulationSnapshotV4 {
  readonly kind: 'transport-simulation-snapshot';
  readonly schemaVersion: 4;
  readonly simulationVersion: 'transport-4';
  readonly scenario: ScenarioCoordinate;
  readonly state: Readonly<{
    readonly tick: SimulationTick;
    readonly fleet: readonly VehicleState[];
    readonly passengerDemand: PassengerDemandStateV4;
  }>;
}

export interface TransportSimulationSnapshotV5 {
  readonly kind: 'transport-simulation-snapshot';
  readonly schemaVersion: 5;
  readonly simulationVersion: 'transport-5';
  readonly scenario: ScenarioCoordinate;
  readonly state: Readonly<{
    readonly tick: SimulationTick;
    readonly fleet: readonly VehicleState[];
    readonly passengerDemand: PassengerDemandState;
  }>;
}

export type TransportSimulationSnapshot = TransportSimulationSnapshotV5;

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const coordinateSchema = z.strictObject({
  scenarioSchemaVersion: z.literal('1.0.0'),
  scenarioId: z.string().trim().min(1),
  scenarioVersion: z
    .string()
    .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
  contentHash: hash,
});
const snapshotV1Schema = z.strictObject({
  kind: z.literal('transport-simulation-snapshot'),
  schemaVersion: z.literal(1),
  simulationVersion: z.literal('transport-1'),
  scenario: coordinateSchema,
  state: z.strictObject({ tick: z.number().int().nonnegative().safe() }),
});
const snapshotV2Schema = z.strictObject({
  kind: z.literal('transport-simulation-snapshot'),
  schemaVersion: z.literal(2),
  simulationVersion: z.literal('transport-2'),
  scenario: coordinateSchema,
  state: z.strictObject({
    tick: z.number().int().nonnegative().safe(),
    fleet: z.array(z.unknown()),
  }),
});
const snapshotV3Schema = z.strictObject({
  kind: z.literal('transport-simulation-snapshot'),
  schemaVersion: z.literal(3),
  simulationVersion: z.literal('transport-3'),
  scenario: coordinateSchema,
  state: z.strictObject({
    tick: z.number().int().nonnegative().safe(),
    fleet: z.array(z.unknown()),
  }),
});
const snapshotV4Schema = z.strictObject({
  kind: z.literal('transport-simulation-snapshot'),
  schemaVersion: z.literal(4),
  simulationVersion: z.literal('transport-4'),
  scenario: coordinateSchema,
  state: z.strictObject({
    tick: z.number().int().nonnegative().safe(),
    fleet: z.array(z.unknown()),
    passengerDemand: z.unknown(),
  }),
});
const snapshotV5Schema = z.strictObject({
  kind: z.literal('transport-simulation-snapshot'),
  schemaVersion: z.literal(transportSimulationSnapshotSchemaVersion),
  simulationVersion: z.literal('transport-5'),
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
  return freeze({
    tick: parseSimulationTick(tick),
    scenario,
    graph: buildDirectedScenarioGraph(scenario),
    fleet: [],
    passengerDemandPlan: parsedPlan ?? null,
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
    passengerDemand:
      state.passengerDemand.status === 'disabled'
        ? state.passengerDemand
        : advancePassengerDemandToTick(
            state.passengerDemandPlan!,
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
  const result = snapshotV5Schema.safeParse(value);
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

export function parseTransportSimulationSnapshotV4(
  value: unknown,
): TransportSimulationSnapshotV4 {
  const result = snapshotV4Schema.safeParse(value);
  if (!result.success)
    throw new ScenarioCompatibilityError(
      'unsupported-transport-snapshot',
      result.error.issues[0]!.message,
    );
  const passengerDemand = parsePassengerDemandStateV4(
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

export function parseTransportSimulationSnapshotV3(
  value: unknown,
): TransportSimulationSnapshotV3 {
  const result = snapshotV3Schema.safeParse(value);
  if (!result.success)
    throw new ScenarioCompatibilityError(
      'unsupported-transport-snapshot',
      result.error.issues[0]!.message,
    );
  return freeze({
    ...result.data,
    scenario: result.data.scenario as ScenarioCoordinate,
    state: {
      tick: parseSimulationTick(result.data.state.tick),
      fleet: parseVehicleFleetSnapshot(result.data.state.fleet),
    },
  });
}

export function parseTransportSimulationSnapshotV2(
  value: unknown,
): TransportSimulationSnapshotV2 {
  const result = snapshotV2Schema.safeParse(value);
  if (!result.success)
    throw new ScenarioCompatibilityError(
      'unsupported-transport-snapshot',
      result.error.issues[0]!.message,
    );
  return freeze({
    ...result.data,
    scenario: result.data.scenario as ScenarioCoordinate,
    state: {
      tick: parseSimulationTick(result.data.state.tick),
      fleet: parseVehicleFleetSnapshot(result.data.state.fleet),
    },
  });
}

export function parseTransportSimulationSnapshotV1(
  value: unknown,
): TransportSimulationSnapshotV1 {
  const result = snapshotV1Schema.safeParse(value);
  if (!result.success)
    throw new ScenarioCompatibilityError(
      'unsupported-transport-snapshot',
      result.error.issues[0]!.message,
    );
  return freeze({
    ...result.data,
    scenario: result.data.scenario as ScenarioCoordinate,
    state: { tick: parseSimulationTick(result.data.state.tick) },
  });
}

export function migrateTransportSimulationSnapshotV1(
  value: unknown,
): TransportSimulationSnapshotV5 {
  const snapshot = parseTransportSimulationSnapshotV1(value);
  return parseTransportSimulationSnapshot({
    ...snapshot,
    schemaVersion: 5,
    simulationVersion: 'transport-5',
    state: {
      tick: snapshot.state.tick,
      fleet: [],
      passengerDemand: createDisabledPassengerDemandState(),
    },
  });
}

export function migrateTransportSimulationSnapshotV2(
  value: unknown,
): TransportSimulationSnapshotV5 {
  const snapshot = parseTransportSimulationSnapshotV2(value);
  return parseTransportSimulationSnapshot({
    ...snapshot,
    schemaVersion: 5,
    simulationVersion: 'transport-5',
    state: {
      tick: snapshot.state.tick,
      fleet: snapshot.state.fleet.map((vehicle) => ({
        vehicleId: vehicle.vehicleId,
        label: vehicle.label,
        patternId: vehicle.patternId,
        movementPlan: vehicle.movementPlan,
        movement: vehicle.movement,
      })),
      passengerDemand: createDisabledPassengerDemandState(),
    },
  });
}

export function migrateTransportSimulationSnapshotV3(
  value: unknown,
): TransportSimulationSnapshotV5 {
  const snapshot = parseTransportSimulationSnapshotV3(value);
  return parseTransportSimulationSnapshot({
    ...snapshot,
    schemaVersion: 5,
    simulationVersion: 'transport-5',
    state: {
      ...snapshot.state,
      passengerDemand: createDisabledPassengerDemandState(),
    },
  });
}

export function migrateTransportSimulationSnapshotV4(
  value: unknown,
): TransportSimulationSnapshotV5 {
  const snapshot = parseTransportSimulationSnapshotV4(value);
  return parseTransportSimulationSnapshot({
    ...snapshot,
    schemaVersion: 5,
    simulationVersion: 'transport-5',
    state: {
      ...snapshot.state,
      passengerDemand: migratePassengerDemandStateV4(
        snapshot.state.passengerDemand,
      ),
    },
  });
}

export function createTransportSimulationSnapshot(
  state: TransportSimulationState,
): TransportSimulationSnapshot {
  return parseTransportSimulationSnapshot({
    kind: 'transport-simulation-snapshot',
    schemaVersion: 5,
    simulationVersion: 'transport-5',
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
      snapshot.state.passengerDemand,
    );
  }
  return freeze({
    tick: snapshot.state.tick,
    scenario,
    graph,
    passengerDemandPlan:
      passengerDemand.status === 'active' ? parsedPlan! : null,
    passengerDemand,
    fleet: restoreVehicleFleet(
      graph,
      snapshot.state.fleet,
      snapshot.state.tick,
    ),
  });
}
