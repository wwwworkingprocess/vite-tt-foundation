import { describe, expect, it } from 'vitest';
import {
  advanceTransportTicks,
  applyTransportVehicleCommand,
  createTransportSimulationSnapshot,
  createTransportSimulationState,
  parseTransportSimulationSnapshot,
  restoreTransportSimulationState,
} from './index.js';
import { scenario, demandPlan } from './transport-snapshot-v9.fixture.test.js';

describe('Transport Snapshot V9 — core', () => {
  it('rejects obsolete versions, incoherent ticks, and missing or wrong plans', () => {
    const canonical = scenario();
    const plan = demandPlan();
    const snapshot = createTransportSimulationSnapshot(
      advanceTransportTicks(
        createTransportSimulationState(canonical, 0, plan),
        2,
      ),
    );
    for (const schemaVersion of [1, 2, 3, 4, 5, 6, 7, 8])
      expect(() =>
        parseTransportSimulationSnapshot({ ...snapshot, schemaVersion }),
      ).toThrow('unsupported-transport-snapshot');
    const wrongTick = structuredClone(snapshot);
    wrongTick.state.tick = 3;
    expect(() => parseTransportSimulationSnapshot(wrongTick)).toThrow(
      'processed tick',
    );
    expect(() => restoreTransportSimulationState(snapshot, canonical)).toThrow(
      'Exact passenger demand plan',
    );
    const wrongPlan = structuredClone(plan);
    wrongPlan.scenario.scenarioId = 'wrong-scenario';
    expect(() =>
      restoreTransportSimulationState(snapshot, canonical, wrongPlan),
    ).toThrow('Passenger demand plan scenario mismatch.');
    expect(() =>
      createTransportSimulationState(canonical, 0, wrongPlan),
    ).toThrow('scenario-id-mismatch');
  });

  it('rejects any non-zero current destination backlog without normalization', () => {
    const canonical = scenario();
    const plan = demandPlan();
    const snapshot = createTransportSimulationSnapshot(
      advanceTransportTicks(
        createTransportSimulationState(canonical, 0, plan),
        2,
      ),
    );
    expect(
      snapshot.state.passengerDemand.status === 'active' &&
        snapshot.state.passengerDemand.stopArrivals.every(
          (arrival) => arrival.awaitingDestinationCount === 0,
        ),
    ).toBe(true);
    const corrupted = structuredClone(snapshot);
    if (corrupted.state.passengerDemand.status !== 'active')
      throw new Error('Expected active fixture.');
    corrupted.state.passengerDemand.stopArrivals[0]!.awaitingDestinationCount = 1;
    corrupted.state.passengerDemand.totalArrivedAtStopPassengerCount += 1;
    corrupted.state.passengerDemand.servedEmittedPassengerCount += 1;
    corrupted.state.passengerDemand.totalEmittedPassengerCount += 1;
    expect(() =>
      restoreTransportSimulationState(corrupted, canonical, plan),
    ).toThrow(/destination backlog/i);
    expect(
      createTransportSimulationSnapshot(
        restoreTransportSimulationState(snapshot, canonical, plan),
      ),
    ).toEqual(snapshot);
  });

  it('rejects every coordinate mismatch and corrupted fleet identity', () => {
    const canonical = scenario();
    let state = createTransportSimulationState(canonical, 0);
    state = applyTransportVehicleCommand(state, {
      kind: 'transport.vehicle.create',
      vehicleId: 'snapshot-bus',
      label: 'Snapshot bus',
      patternId: 'legacy-A2-torrevieja-la-mata',
      movementPlan: {
        kind: 'vehicle-movement-plan-v1',
        edgeTravelTicks: [1, 1, 1, 1],
      },
    });
    const snapshot = createTransportSimulationSnapshot(state);
    for (const [field, value] of [
      ['scenarioSchemaVersion', '2.0.0'],
      ['scenarioId', 'wrong'],
      ['scenarioVersion', '2.0.0'],
      ['contentHash', '0'.repeat(64)],
    ] as const)
      expect(() =>
        restoreTransportSimulationState(
          {
            ...snapshot,
            scenario: { ...snapshot.scenario, [field]: value },
          },
          canonical,
        ),
      ).toThrow();
    const duplicate = structuredClone(snapshot);
    duplicate.state.fleet.push(structuredClone(duplicate.state.fleet[0]!));
    expect(() => restoreTransportSimulationState(duplicate, canonical)).toThrow(
      'Duplicate vehicle ID',
    );

    const corruptions = [
      (vehicle: (typeof snapshot.state.fleet)[number]) => {
        Object.assign(vehicle, { routeId: 'legacy-A2' });
      },
      (vehicle: (typeof snapshot.state.fleet)[number]) => {
        Object.assign(vehicle, { patternId: 'missing-pattern' });
      },
      (vehicle: (typeof snapshot.state.fleet)[number]) => {
        Object.assign(vehicle, {
          movement: {
            kind: 'parked-at-stop',
            stopNodeId: 'missing-stop',
            nextEdgeSequence: 0,
          },
        });
      },
      (vehicle: (typeof snapshot.state.fleet)[number]) => {
        Object.assign(vehicle, {
          movement: {
            kind: 'running-at-stop',
            stopNodeId: 'missing-stop',
            nextEdgeSequence: 0,
          },
        });
      },
      (vehicle: (typeof snapshot.state.fleet)[number]) => {
        Object.assign(vehicle, {
          movement: {
            kind: 'completed-at-stop',
            stopNodeId: 'tv-stop-0053',
          },
        });
      },
    ];
    for (const [index, corrupt] of corruptions.entries()) {
      const malformed = structuredClone(snapshot);
      corrupt(malformed.state.fleet[0]!);
      expect(
        () => restoreTransportSimulationState(malformed, canonical),
        `corruption ${index}`,
      ).toThrow();
    }
  });
});
