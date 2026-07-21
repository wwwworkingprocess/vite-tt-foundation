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

export type ScenarioCompatibilityErrorCode =
  | 'unsupported-transport-snapshot'
  | 'scenario-schema-mismatch'
  | 'scenario-id-mismatch'
  | 'scenario-version-mismatch'
  | 'scenario-content-hash-mismatch';

export const transportSimulationSnapshotSchemaVersion = 3 as const;

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

export type TransportSimulationSnapshot = TransportSimulationSnapshotV3;

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
  schemaVersion: z.literal(transportSimulationSnapshotSchemaVersion),
  simulationVersion: z.literal('transport-3'),
  scenario: coordinateSchema,
  state: z.strictObject({
    tick: z.number().int().nonnegative().safe(),
    fleet: z.array(z.unknown()),
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
): TransportSimulationState {
  const scenario = reparseScenario(inputScenario);
  return freeze({
    tick: parseSimulationTick(tick),
    scenario,
    graph: buildDirectedScenarioGraph(scenario),
    fleet: [],
  });
}

export function advanceTransportTicks(
  state: TransportSimulationState,
  count: TickAdvancement | number,
): TransportSimulationState {
  const tickCount = parseTickAdvancement(count);
  return freeze({
    tick: parseSimulationTick(state.tick + tickCount),
    scenario: state.scenario,
    graph: state.graph,
    fleet: advanceVehicleFleet(state.graph, state.fleet, tickCount),
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
): TransportSimulationSnapshotV3 {
  const snapshot = parseTransportSimulationSnapshotV1(value);
  return parseTransportSimulationSnapshot({
    ...snapshot,
    schemaVersion: 3,
    simulationVersion: 'transport-3',
    state: { tick: snapshot.state.tick, fleet: [] },
  });
}

export function migrateTransportSimulationSnapshotV2(
  value: unknown,
): TransportSimulationSnapshotV3 {
  const snapshot = parseTransportSimulationSnapshotV2(value);
  return parseTransportSimulationSnapshot({
    ...snapshot,
    schemaVersion: 3,
    simulationVersion: 'transport-3',
    state: {
      tick: snapshot.state.tick,
      fleet: snapshot.state.fleet.map((vehicle) => ({
        vehicleId: vehicle.vehicleId,
        label: vehicle.label,
        patternId: vehicle.patternId,
        movementPlan: vehicle.movementPlan,
        movement: vehicle.movement,
      })),
    },
  });
}

export function createTransportSimulationSnapshot(
  state: TransportSimulationState,
): TransportSimulationSnapshot {
  return parseTransportSimulationSnapshot({
    kind: 'transport-simulation-snapshot',
    schemaVersion: 3,
    simulationVersion: 'transport-3',
    scenario: createScenarioCoordinate(state.scenario),
    state: { tick: state.tick, fleet: state.fleet },
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
): TransportSimulationState {
  const snapshot = parseTransportSimulationSnapshot(snapshotValue);
  const scenario = reparseScenario(scenarioValue);
  assertCoordinate(snapshot.scenario, createScenarioCoordinate(scenario));
  const graph = buildDirectedScenarioGraph(scenario);
  return freeze({
    tick: snapshot.state.tick,
    scenario,
    graph,
    fleet: restoreVehicleFleet(graph, snapshot.state.fleet),
  });
}
