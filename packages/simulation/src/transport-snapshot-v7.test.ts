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

describe('Transport Snapshot V8', () => {
  it('advances after partial boarding into a later same-key waiting generation', () => {
    const canonical = scenario();
    const plan = structuredClone(demandPlan());
    plan.cells[0]!.assignedStopPlaceId = 'tv-place-0108';
    plan.cells[1]!.assignedStopPlaceId = 'tv-place-0093';
    plan.stops = [
      { stopPlaceId: 'tv-place-0093' },
      { stopPlaceId: 'tv-place-0108' },
    ];
    let state = advanceTransportTicks(
      createTransportSimulationState(canonical, 0, plan),
      2,
    );
    state = applyTransportVehicleCommand(state, {
      kind: 'transport.vehicle.create-route-cycle',
      vehicleId: 'generation-bus',
      label: 'Generation bus',
      routeId: 'legacy-A2',
      passengerCapacity: 1,
      legs: [
        {
          patternId: 'legacy-A2-torrevieja-la-mata',
          movementPlan: {
            kind: 'vehicle-movement-plan-v1',
            edgeTravelTicks: [1, 1, 1, 1],
          },
        },
        {
          patternId: 'legacy-A2-la-mata-torrevieja',
          movementPlan: {
            kind: 'vehicle-movement-plan-v1',
            edgeTravelTicks: [1, 1],
          },
        },
      ],
    });
    if (state.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    const historicalId =
      state.passengerDemand.onboardGroups[0]!.sourceWaitingCohortId;
    expect(
      state.passengerDemand.waitingCohorts.some(
        (cohort) => cohort.passengerWaitingCohortId === historicalId,
      ),
    ).toBe(true);
    const advanced = advanceTransportTicks(state, 2);
    expect(advanceTransportTicks(advanceTransportTicks(state, 1), 1)).toEqual(
      advanced,
    );
    if (advanced.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    const sameKeyGenerations = advanced.passengerDemand.waitingCohorts.filter(
      (cohort) =>
        cohort.originStopNodeId ===
          state.passengerDemand.waitingCohorts.find(
            (item) => item.passengerWaitingCohortId === historicalId,
          )!.originStopNodeId &&
        cohort.destinationCellId ===
          state.passengerDemand.waitingCohorts.find(
            (item) => item.passengerWaitingCohortId === historicalId,
          )!.destinationCellId,
    );
    expect(sameKeyGenerations).toHaveLength(2);
    expect(sameKeyGenerations[0]!.passengerWaitingCohortId).toBe(historicalId);
    expect(sameKeyGenerations[1]!.passengerWaitingCohortId).not.toBe(
      historicalId,
    );
    const historicalBounds = sameKeyGenerations[0]!;
    const later = advanceTransportTicks(state, 4);
    if (later.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    const laterSameKey = later.passengerDemand.waitingCohorts.filter(
      (cohort) =>
        cohort.originStopNodeId === historicalBounds.originStopNodeId &&
        cohort.destinationCellId === historicalBounds.destinationCellId,
    );
    expect(laterSameKey).toHaveLength(2);
    expect(laterSameKey[0]).toMatchObject({
      passengerWaitingCohortId: historicalId,
      firstAssignedTick: historicalBounds.firstAssignedTick,
      lastAssignedTick: historicalBounds.lastAssignedTick,
    });
    expect(laterSameKey[1]!.lastAssignedTick).toBeGreaterThan(
      laterSameKey[1]!.firstAssignedTick,
    );
    const snapshot = createTransportSimulationSnapshot(advanced);
    expect(
      createTransportSimulationSnapshot(
        restoreTransportSimulationState(snapshot, canonical, plan),
      ),
    ).toEqual(snapshot);
    const generationCorruptions: Array<(value: typeof snapshot) => void> = [
      (value) => {
        if (value.state.passengerDemand.status !== 'active')
          throw new Error('Expected active passenger authority.');
        value.state.passengerDemand.waitingCohorts.reverse();
      },
      (value) => {
        if (value.state.passengerDemand.status !== 'active')
          throw new Error('Expected active passenger authority.');
        const demand = value.state.passengerDemand;
        const historical = demand.waitingCohorts.find(
          (cohort) => cohort.passengerWaitingCohortId === historicalId,
        )!;
        const newer = demand.waitingCohorts.find(
          (cohort) =>
            cohort.originStopNodeId === historical.originStopNodeId &&
            cohort.destinationCellId === historical.destinationCellId &&
            cohort.passengerWaitingCohortId !== historicalId,
        )!;
        historical.count += newer.count;
        historical.lastAssignedTick = newer.lastAssignedTick;
        demand.waitingCohorts = demand.waitingCohorts.filter(
          (cohort) => cohort !== newer,
        );
      },
      (value) => {
        if (value.state.passengerDemand.status !== 'active')
          throw new Error('Expected active passenger authority.');
        const demand = value.state.passengerDemand;
        const historical = demand.waitingCohorts.find(
          (cohort) => cohort.passengerWaitingCohortId === historicalId,
        )!;
        const newerIndex = demand.waitingCohorts.findIndex(
          (cohort) =>
            cohort.originStopNodeId === historical.originStopNodeId &&
            cohort.destinationCellId === historical.destinationCellId &&
            cohort.passengerWaitingCohortId !== historicalId,
        );
        const newer = demand.waitingCohorts[newerIndex]!;
        if (newer.count < 2)
          throw new Error('Expected a mergeable generation.');
        newer.count -= 1;
        const sequence = demand.nextPassengerWaitingCohortSequence;
        demand.waitingCohorts.splice(newerIndex + 1, 0, {
          ...newer,
          passengerWaitingCohortId:
            `passenger-waiting-cohort-${sequence}` as never,
          count: 1,
        });
        demand.nextPassengerWaitingCohortSequence += 1;
      },
      (value) => {
        if (value.state.passengerDemand.status !== 'active')
          throw new Error('Expected active passenger authority.');
        const demand = value.state.passengerDemand;
        const newer = demand.waitingCohorts.find(
          (cohort) => cohort.passengerWaitingCohortId !== historicalId,
        )!;
        newer.firstAssignedTick = 0;
      },
      (value) => {
        if (value.state.passengerDemand.status !== 'active')
          throw new Error('Expected active passenger authority.');
        const demand = value.state.passengerDemand;
        const newer = demand.waitingCohorts.find(
          (cohort) => cohort.passengerWaitingCohortId !== historicalId,
        )!;
        newer.passengerWaitingCohortId =
          `passenger-waiting-cohort-${demand.nextPassengerWaitingCohortSequence + 1}` as never;
        demand.nextPassengerWaitingCohortSequence += 2;
      },
    ];
    for (const corrupt of generationCorruptions) {
      const value = structuredClone(snapshot);
      corrupt(value);
      expect(() =>
        restoreTransportSimulationState(value, canonical, plan),
      ).toThrow();
    }

    const secondBoarding = applyTransportVehicleCommand(later, {
      kind: 'transport.vehicle.create-route-cycle',
      vehicleId: 'generation-bus-2',
      label: 'Generation bus 2',
      routeId: 'legacy-A2',
      passengerCapacity: 80,
      legs: [
        {
          patternId: 'legacy-A2-torrevieja-la-mata',
          movementPlan: {
            kind: 'vehicle-movement-plan-v1',
            edgeTravelTicks: [1, 1, 1, 1],
          },
        },
        {
          patternId: 'legacy-A2-la-mata-torrevieja',
          movementPlan: {
            kind: 'vehicle-movement-plan-v1',
            edgeTravelTicks: [1, 1],
          },
        },
      ],
    });
    if (secondBoarding.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    expect(
      secondBoarding.passengerDemand.onboardGroups
        .filter((group) => group.vehicleId === 'generation-bus-2')
        .map((group) => group.sourceWaitingCohortId),
    ).toEqual(laterSameKey.map((cohort) => cohort.passengerWaitingCohortId));

    let fullyBoarded = advanceTransportTicks(
      createTransportSimulationState(canonical, 0, plan),
      2,
    );
    fullyBoarded = applyTransportVehicleCommand(fullyBoarded, {
      kind: 'transport.vehicle.create-route-cycle',
      vehicleId: 'full-generation-bus',
      label: 'Full generation bus',
      routeId: 'legacy-A2',
      passengerCapacity: 80,
      legs: [
        {
          patternId: 'legacy-A2-torrevieja-la-mata',
          movementPlan: {
            kind: 'vehicle-movement-plan-v1',
            edgeTravelTicks: [1, 1, 1, 1],
          },
        },
        {
          patternId: 'legacy-A2-la-mata-torrevieja',
          movementPlan: {
            kind: 'vehicle-movement-plan-v1',
            edgeTravelTicks: [1, 1],
          },
        },
      ],
    });
    if (fullyBoarded.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    const consumedId =
      fullyBoarded.passengerDemand.onboardGroups[0]!.sourceWaitingCohortId;
    fullyBoarded = advanceTransportTicks(fullyBoarded, 2);
    if (fullyBoarded.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    expect(
      fullyBoarded.passengerDemand.waitingCohorts.some(
        (cohort) => cohort.passengerWaitingCohortId === consumedId,
      ),
    ).toBe(false);
    expect(
      fullyBoarded.passengerDemand.waitingCohorts.some(
        (cohort) =>
          cohort.originStopNodeId ===
            fullyBoarded.passengerDemand.onboardGroups[0]!.originStopNodeId &&
          cohort.destinationCellId ===
            fullyBoarded.passengerDemand.onboardGroups[0]!.destinationCellId,
      ),
    ).toBe(true);
  });

  it('accumulates boarding events from separate vehicle creations on one tick', () => {
    const canonical = scenario();
    const plan = structuredClone(demandPlan());
    plan.cells[0]!.assignedStopPlaceId = 'tv-place-0108';
    plan.cells[1]!.assignedStopPlaceId = 'tv-place-0093';
    plan.stops = [
      { stopPlaceId: 'tv-place-0093' },
      { stopPlaceId: 'tv-place-0108' },
    ];
    let state = advanceTransportTicks(
      createTransportSimulationState(canonical, 0, plan),
      2,
    );
    const create = (vehicleId: string, passengerCapacity: number) => ({
      kind: 'transport.vehicle.create-route-cycle' as const,
      vehicleId,
      label: vehicleId,
      routeId: 'legacy-A2',
      passengerCapacity,
      legs: [
        {
          patternId: 'legacy-A2-torrevieja-la-mata',
          movementPlan: {
            kind: 'vehicle-movement-plan-v1' as const,
            edgeTravelTicks: [1, 1, 1, 1],
          },
        },
        {
          patternId: 'legacy-A2-la-mata-torrevieja',
          movementPlan: {
            kind: 'vehicle-movement-plan-v1' as const,
            edgeTravelTicks: [1, 1],
          },
        },
      ],
    });
    state = applyTransportVehicleCommand(state, create('boarding-bus-a', 1));
    state = applyTransportVehicleCommand(state, create('boarding-bus-b', 1));
    expect(state.currentStopCalls.map((call) => call.vehicleId)).toEqual([
      'boarding-bus-a',
      'boarding-bus-b',
    ]);
    expect(state.currentBoardingEvents.map((event) => event.vehicleId)).toEqual(
      ['boarding-bus-a', 'boarding-bus-b'],
    );
    expect(state.passengerDemand).toMatchObject({
      status: 'active',
      totalBoardedPassengerCount: 2,
      totalOnboardPassengerCount: 2,
    });
    const snapshot = createTransportSimulationSnapshot(state);
    expect(
      createTransportSimulationSnapshot(
        restoreTransportSimulationState(snapshot, canonical, plan),
      ),
    ).toEqual(snapshot);
    const missingEarlierEvent = structuredClone(snapshot);
    missingEarlierEvent.state.currentBoardingEvents.shift();
    expect(() =>
      restoreTransportSimulationState(missingEarlierEvent, canonical, plan),
    ).toThrow(/boarding authority/i);

    let noSecondBoarding = advanceTransportTicks(
      createTransportSimulationState(canonical, 0, plan),
      2,
    );
    noSecondBoarding = applyTransportVehicleCommand(
      noSecondBoarding,
      create('boarding-bus-a', 2),
    );
    noSecondBoarding = applyTransportVehicleCommand(
      noSecondBoarding,
      create('boarding-bus-b', 1),
    );
    expect(noSecondBoarding.currentStopCalls).toHaveLength(2);
    expect(
      noSecondBoarding.currentBoardingEvents.map((event) => event.vehicleId),
    ).toEqual(['boarding-bus-a']);
  });

  it('boards an exact current origin call and round-trips capacity and onboard authority', () => {
    const canonical = scenario();
    const plan = structuredClone(demandPlan());
    plan.cells[0]!.assignedStopPlaceId = 'tv-place-0108';
    plan.cells[1]!.assignedStopPlaceId = 'tv-place-0093';
    plan.stops = [
      { stopPlaceId: 'tv-place-0093' },
      { stopPlaceId: 'tv-place-0108' },
    ];
    let state = advanceTransportTicks(
      createTransportSimulationState(canonical, 0, plan),
      2,
    );
    state = applyTransportVehicleCommand(state, {
      kind: 'transport.vehicle.create-route-cycle',
      vehicleId: 'boarding-bus',
      label: 'Boarding bus',
      routeId: 'legacy-A2',
      passengerCapacity: 1,
      legs: [
        {
          patternId: 'legacy-A2-torrevieja-la-mata',
          movementPlan: {
            kind: 'vehicle-movement-plan-v1',
            edgeTravelTicks: [1, 1, 1, 1],
          },
        },
        {
          patternId: 'legacy-A2-la-mata-torrevieja',
          movementPlan: {
            kind: 'vehicle-movement-plan-v1',
            edgeTravelTicks: [1, 1],
          },
        },
      ],
    });
    expect(state.vehicleCapacities).toEqual([
      { vehicleId: 'boarding-bus', passengerCapacity: 1 },
    ]);
    expect(state.passengerDemand).toMatchObject({
      status: 'active',
      totalBoardedPassengerCount: 1,
      totalOnboardPassengerCount: 1,
    });
    expect(state.currentBoardingEvents).toEqual([
      expect.objectContaining({
        vehicleId: 'boarding-bus',
        boardedPassengerCount: 1,
        remainingCapacity: 0,
      }),
    ]);
    const snapshot = createTransportSimulationSnapshot(state);
    expect(
      createTransportSimulationSnapshot(
        restoreTransportSimulationState(snapshot, canonical, plan),
      ),
    ).toEqual(snapshot);
    expect(Object.isFrozen(snapshot.state.vehicleCapacities[0])).toBe(true);

    const missingCapacity = structuredClone(snapshot);
    missingCapacity.state.vehicleCapacities = [];
    expect(() =>
      restoreTransportSimulationState(missingCapacity, canonical, plan),
    ).toThrow(/capacity authority/i);
    const inflatedOnboard = structuredClone(snapshot);
    if (inflatedOnboard.state.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    inflatedOnboard.state.passengerDemand.onboardGroups[0]!.count = 2;
    inflatedOnboard.state.passengerDemand.totalBoardedPassengerCount = 2;
    inflatedOnboard.state.passengerDemand.totalOnboardPassengerCount = 2;
    inflatedOnboard.state.passengerDemand.totalWaitingForVehiclePassengerCount -= 1;
    expect(() =>
      restoreTransportSimulationState(inflatedOnboard, canonical, plan),
    ).toThrow();
    const fabricatedEvent = structuredClone(snapshot);
    fabricatedEvent.state.currentBoardingEvents[0]!.boardedPassengerCount = 2;
    expect(() =>
      restoreTransportSimulationState(fabricatedEvent, canonical, plan),
    ).toThrow(/boarding authority/i);

    const missingEvent = structuredClone(snapshot);
    missingEvent.state.currentBoardingEvents = [];
    expect(() =>
      restoreTransportSimulationState(missingEvent, canonical, plan),
    ).toThrow(/boarding authority/i);

    const inflatedNext = structuredClone(snapshot);
    if (inflatedNext.state.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    inflatedNext.state.passengerDemand.nextPassengerOnboardGroupSequence += 1;
    expect(() =>
      restoreTransportSimulationState(inflatedNext, canonical, plan),
    ).toThrow(/sequence/i);

    const sequenceGap = structuredClone(snapshot);
    if (sequenceGap.state.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    sequenceGap.state.passengerDemand.onboardGroups[0]!.passengerOnboardGroupId =
      'passenger-onboard-group-2' as never;
    sequenceGap.state.passengerDemand.nextPassengerOnboardGroupSequence = 3;
    sequenceGap.state.currentBoardingEvents[0]!.onboardGroupIds = [
      'passenger-onboard-group-2' as never,
    ];
    expect(() =>
      restoreTransportSimulationState(sequenceGap, canonical, plan),
    ).toThrow(/sequence/i);

    const inventedSource = structuredClone(snapshot);
    if (inventedSource.state.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    inventedSource.state.passengerDemand.onboardGroups[0]!.sourceWaitingCohortId =
      'passenger-waiting-cohort-999' as never;
    inventedSource.state.passengerDemand.nextPassengerWaitingCohortSequence = 1000;
    expect(() =>
      restoreTransportSimulationState(inventedSource, canonical, plan),
    ).toThrow(/source sequence/i);

    const erasedBoarding = structuredClone(snapshot);
    if (erasedBoarding.state.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    const erasedGroup = erasedBoarding.state.passengerDemand.onboardGroups[0]!;
    const residual = erasedBoarding.state.passengerDemand.waitingCohorts.find(
      (cohort) =>
        cohort.passengerWaitingCohortId === erasedGroup.sourceWaitingCohortId,
    );
    if (residual === undefined) throw new Error('Expected a residual cohort.');
    residual.count += erasedGroup.count;
    erasedBoarding.state.passengerDemand.onboardGroups = [];
    erasedBoarding.state.passengerDemand.nextPassengerOnboardGroupSequence = 1;
    erasedBoarding.state.passengerDemand.totalBoardedPassengerCount = 0;
    erasedBoarding.state.passengerDemand.totalOnboardPassengerCount = 0;
    erasedBoarding.state.passengerDemand.totalWaitingForVehiclePassengerCount +=
      erasedGroup.count;
    erasedBoarding.state.currentBoardingEvents = [];
    expect(() =>
      restoreTransportSimulationState(erasedBoarding, canonical, plan),
    ).toThrow(/boarding authority/i);
  });

  it('round-trips active waiting authority without embedding static plans', () => {
    const canonical = scenario();
    const plan = demandPlan();
    const state = advanceTransportTicks(
      createTransportSimulationState(canonical, 0, plan),
      2,
    );
    const snapshot = createTransportSimulationSnapshot(state);
    expect(snapshot).toMatchObject({
      schemaVersion: 8,
      simulationVersion: 'transport-8',
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
    for (const schemaVersion of [1, 2, 3, 4, 5, 6, 7])
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
