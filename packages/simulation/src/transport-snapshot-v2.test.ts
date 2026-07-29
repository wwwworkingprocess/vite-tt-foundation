import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import {
  advanceTransportTicks,
  applyTransportVehicleCommand,
  createTransportSimulationSnapshot,
  createTransportSimulationState,
  migrateTransportSimulationSnapshotV1,
  parseTransportSimulationSnapshot,
  parseTransportSimulationSnapshotV1,
  restoreTransportSimulationState,
} from './index.js';

const fixtureRoot = join(
  import.meta.dirname,
  '..',
  '..',
  'transport-domain',
  'fixtures',
  'torrevieja-mini-v1',
);
const json = (name: string) =>
  JSON.parse(readFileSync(join(fixtureRoot, name), 'utf8')) as unknown;
const scenario = () =>
  parseScenarioPackage({
    manifest: json('scenario.json'),
    settlements: json('settlements.json'),
    stops: json('stops.json'),
    routes: json('routes.json'),
    presentation: json('presentation.json'),
    provenance: json('provenance.json'),
  });
const v1 = {
  kind: 'transport-simulation-snapshot',
  schemaVersion: 1,
  simulationVersion: 'transport-1',
  scenario: {
    scenarioSchemaVersion: '1.0.0',
    scenarioId: 'torrevieja-mini-v1',
    scenarioVersion: '1.0.0',
    contentHash:
      'd9c378089d9f83b9ea4756aa57551535fab1f2118eb092d1badcd5ce06c1bb1f',
  },
  state: { tick: 12 },
};
type MutableVehicleSnapshot = {
  movement: Record<string, unknown>;
  movementPlan: { edgeTravelTicks: number[] };
};

const movingState = () => {
  let state = createTransportSimulationState(scenario(), 10);
  state = applyTransportVehicleCommand(state, {
    kind: 'transport.vehicle.create',
    vehicleId: 'vehicle-demo-1',
    label: 'Demo vehicle',
    patternId: 'legacy-A2-torrevieja-la-mata',
    movementPlan: {
      kind: 'vehicle-movement-plan-v1',
      edgeTravelTicks: [3, 4, 5, 6],
    },
  });
  state = applyTransportVehicleCommand(state, {
    kind: 'transport.vehicle.start',
    vehicleId: 'vehicle-demo-1',
  });
  return advanceTransportTicks(state, 5);
};

describe('Transport Snapshot V5 and legacy migration', () => {
  it('round-trips a compact, deeply immutable ordered fleet', () => {
    const snapshot = createTransportSimulationSnapshot(movingState());
    expect(snapshot).toMatchObject({
      kind: 'transport-simulation-snapshot',
      schemaVersion: 5,
      simulationVersion: 'transport-5',
      state: {
        tick: 15,
        fleet: [
          {
            vehicleId: 'vehicle-demo-1',
            movement: {
              kind: 'running-on-edge',
              edgeSequence: 1,
              progressTicks: 2,
              travelTicks: 4,
            },
          },
        ],
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain('stopNodes');
    const parsed = parseTransportSimulationSnapshot(
      JSON.parse(JSON.stringify(snapshot)),
    );
    expect(parsed).toEqual(snapshot);
    expect(Object.isFrozen(parsed.state.fleet)).toBe(true);
    expect(Object.isFrozen(parsed.state.fleet[0]?.movementPlan)).toBe(true);
    expect(Object.isFrozen(parsed.state.fleet[0]?.movement)).toBe(true);
    expect(
      createTransportSimulationSnapshot(
        restoreTransportSimulationState(parsed, scenario()),
      ),
    ).toEqual(createTransportSimulationSnapshot(movingState()));
  });

  it('parses V1 separately and migrates explicitly to an empty V5 authority', () => {
    expect(parseTransportSimulationSnapshotV1(v1)).toMatchObject({
      schemaVersion: 1,
      state: { tick: 12 },
    });
    expect(() => parseTransportSimulationSnapshot(v1)).toThrow();
    const migrated = migrateTransportSimulationSnapshotV1(v1);
    expect(migrated).toEqual({
      ...v1,
      schemaVersion: 5,
      simulationVersion: 'transport-5',
      state: {
        tick: 12,
        fleet: [],
        passengerDemand: { status: 'disabled' },
      },
    });
    expect(Object.isFrozen(migrated.state.fleet)).toBe(true);
  });

  it.each([
    [
      'duplicate ID',
      (fleet: unknown[]) => fleet.push(structuredClone(fleet[0])),
    ],
    [
      'unknown pattern',
      (fleet: Array<Record<string, unknown>>) =>
        (fleet[0]!.patternId = 'missing'),
    ],
    [
      'wrong edge ID',
      (fleet: Array<{ movement: Record<string, unknown> }>) =>
        (fleet[0]!.movement.edgeId = 'wrong:1'),
    ],
    [
      'wrong progress',
      (fleet: Array<{ movement: Record<string, unknown> }>) =>
        (fleet[0]!.movement.progressTicks = 4),
    ],
    [
      'wrong travel',
      (fleet: Array<{ movement: Record<string, unknown> }>) =>
        (fleet[0]!.movement.travelTicks = 99),
    ],
  ] as const)('rejects restored fleet invariant: %s', (_name, mutate) => {
    const snapshot = structuredClone(
      createTransportSimulationSnapshot(movingState()),
    );
    mutate(snapshot.state.fleet as never);
    expect(() =>
      restoreTransportSimulationState(snapshot, scenario()),
    ).toThrow();
  });
  it.each([
    [
      'parked away from origin',
      0,
      (v: MutableVehicleSnapshot) => (v.movement.stopNodeId = 'tv-stop-0053'),
    ],
    [
      'running at a missing edge',
      0,
      (v: MutableVehicleSnapshot) => {
        v.movement = {
          kind: 'running-at-stop',
          stopNodeId: 'tv-stop-0108',
          nextEdgeSequence: 99,
        };
      },
    ],
    [
      'running at the wrong stop',
      0,
      (v: MutableVehicleSnapshot) => {
        v.movement = {
          kind: 'running-at-stop',
          stopNodeId: 'tv-stop-0053',
          nextEdgeSequence: 0,
        };
      },
    ],
    [
      'wrong edge sequence',
      5,
      (v: MutableVehicleSnapshot) => (v.movement.edgeSequence = 99),
    ],
    [
      'wrong edge origin',
      5,
      (v: MutableVehicleSnapshot) =>
        (v.movement.fromStopNodeId = 'tv-stop-0053'),
    ],
    [
      'wrong edge destination',
      5,
      (v: MutableVehicleSnapshot) => (v.movement.toStopNodeId = 'tv-stop-0108'),
    ],
    [
      'wrong plan length',
      5,
      (v: MutableVehicleSnapshot) => v.movementPlan.edgeTravelTicks.pop(),
    ],
    [
      'invalid completion stop',
      100,
      (v: MutableVehicleSnapshot) => (v.movement.stopNodeId = 'tv-stop-0108'),
    ],
  ] as const)(
    'rejects %s during scenario-bound restoration',
    (_name, ticks, mutate) => {
      const snapshot = structuredClone(
        createTransportSimulationSnapshot(
          advanceTransportTicks(movingState(), ticks),
        ),
      );
      mutate(snapshot.state.fleet[0]);
      expect(() =>
        restoreTransportSimulationState(snapshot, scenario()),
      ).toThrow();
    },
  );

  it('accepts valid parked and completed states and detaches restored values', () => {
    let parked = createTransportSimulationState(scenario(), 0);
    parked = applyTransportVehicleCommand(parked, {
      kind: 'transport.vehicle.create',
      vehicleId: 'parked',
      label: 'Parked',
      patternId: 'legacy-A2-torrevieja-la-mata',
      movementPlan: {
        kind: 'vehicle-movement-plan-v1',
        edgeTravelTicks: [1, 1, 1, 1],
      },
    });
    const parkedSnapshot = structuredClone(
      createTransportSimulationSnapshot(parked),
    );
    const restoredParked = restoreTransportSimulationState(
      parkedSnapshot,
      scenario(),
    );
    parkedSnapshot.state.fleet[0]!.label = 'mutated';
    expect(restoredParked.fleet[0]?.label).toBe('Parked');
    const completed = advanceTransportTicks(
      applyTransportVehicleCommand(parked, {
        kind: 'transport.vehicle.start',
        vehicleId: 'parked',
      }),
      4,
    );
    expect(
      restoreTransportSimulationState(
        createTransportSimulationSnapshot(completed),
        scenario(),
      ).fleet[0]?.movement.kind,
    ).toBe('completed-at-stop');
  });

  it('rejects malformed V1 and V4 documents', () => {
    expect(() =>
      parseTransportSimulationSnapshotV1({ ...v1, state: {} }),
    ).toThrow();
    expect(() =>
      parseTransportSimulationSnapshot({ ...v1, schemaVersion: 4 }),
    ).toThrow();
  });

  it('rejects a completed lifecycle for an explicit loop pattern', () => {
    const packageInput = {
      manifest: json('scenario.json'),
      settlements: json('settlements.json'),
      stops: json('stops.json'),
      routes: structuredClone(json('routes.json')),
      presentation: json('presentation.json'),
      provenance: json('provenance.json'),
    };
    const routes = packageInput.routes as {
      routes: Array<{ patterns: Array<{ closesLoop: boolean }> }>;
    };
    routes.routes[0]!.patterns[0]!.closesLoop = true;
    const loop = parseScenarioPackage(packageInput);
    const snapshot = structuredClone(
      createTransportSimulationSnapshot(
        advanceTransportTicks(movingState(), 100),
      ),
    );
    snapshot.state.fleet[0]!.movementPlan.edgeTravelTicks.push(1);
    expect(() => restoreTransportSimulationState(snapshot, loop)).toThrow(
      'completion',
    );
  });
});
