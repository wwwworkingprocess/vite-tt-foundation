import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import {
  advanceTransportTicks,
  applyTransportVehicleCommand,
  createScenarioCoordinate,
  createTransportSimulationSnapshot,
  createTransportSimulationState,
  parsePassengerDemandPlan,
  parseTransportSimulationSnapshot,
  restoreTransportSimulationState,
} from './index.js';

const root = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'apps',
  'web',
  'public',
  'scenarios',
  'torrevieja-mini-v1',
);
const json = (name: string) =>
  JSON.parse(readFileSync(join(root, name), 'utf8')) as unknown;
const scenario = () =>
  parseScenarioPackage({
    manifest: json('scenario.json'),
    settlements: json('settlements.json'),
    stops: json('stops.json'),
    routes: json('routes.json'),
    presentation: json('presentation.json'),
    provenance: json('provenance.json'),
  });
const demandPlan = () => {
  const canonical = scenario();
  return parsePassengerDemandPlan({
    schemaVersion: '1.0.0',
    demandModelContentHash: 'd'.repeat(64),
    scenario: createScenarioCoordinate(canonical),
    grid: {
      cityId: 'Q36730',
      populationGridSchemaVersion: '1.0.0',
      gridVersion: '1.0.0',
      rows: 1,
      columns: 2,
      resolutionDegrees: 0.001,
      totalActiveCellCount: 2,
      totalPopulationWeight: 2,
    },
    catchmentPolicy: { maxAccessDistanceCells: 5 },
    emissionPolicy: {
      emissionCreditsPerWeightPerTick: 1,
      creditsPerPassenger: 1,
    },
    accessPolicy: { accessTicksPerCell: 1 },
    cells: [
      {
        cellId: 'r0c0',
        row: 0,
        column: 0,
        populationWeight: 1,
        assignedStopPlaceId: 'tv-place-0053',
        distanceSquaredCells: 0,
      },
      {
        cellId: 'r0c1',
        row: 0,
        column: 1,
        populationWeight: 1,
        assignedStopPlaceId: 'tv-place-0065',
        distanceSquaredCells: 0,
      },
    ],
    stops: [{ stopPlaceId: 'tv-place-0053' }, { stopPlaceId: 'tv-place-0065' }],
  });
};

describe('Transport Snapshot V7', () => {
  it('round-trips active waiting authority without embedding static plans', () => {
    const canonical = scenario();
    const plan = demandPlan();
    const state = advanceTransportTicks(
      createTransportSimulationState(canonical, 0, plan),
      2,
    );
    const snapshot = createTransportSimulationSnapshot(state);
    expect(snapshot).toMatchObject({
      schemaVersion: 7,
      simulationVersion: 'transport-7',
      state: {
        passengerDemand: {
          status: 'active',
          processedThroughTick: 2,
          totalWaitingForVehiclePassengerCount: expect.any(Number),
        },
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain('itineraryEntries');
    expect(JSON.stringify(snapshot)).not.toContain('populationWeights');
    expect(
      createTransportSimulationSnapshot(
        restoreTransportSimulationState(snapshot, canonical, plan),
      ),
    ).toEqual(snapshot);
  });

  it('rejects obsolete versions, incoherent ticks, and missing or wrong plans', () => {
    const canonical = scenario();
    const plan = demandPlan();
    const snapshot = createTransportSimulationSnapshot(
      advanceTransportTicks(
        createTransportSimulationState(canonical, 0, plan),
        2,
      ),
    );
    for (const schemaVersion of [1, 2, 3, 4, 5])
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
    ).toThrow();
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
