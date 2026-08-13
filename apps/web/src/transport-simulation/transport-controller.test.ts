import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import {
  advanceTransportTicks,
  applyTransportVehicleCommand,
  createScenarioCoordinate,
  createTransportSimulationSnapshot,
  createTransportSimulationState,
  parsePassengerDemandPlan,
  type PassengerDemandPlanV1,
} from '@torrevieja-tycoon/simulation';
import { parseGameId, parseTimelineId } from '@torrevieja-tycoon/protocol';
import {
  classifyPersistedSaveRecord,
  parseTransportSaveRecord,
} from './transport-save-record.js';
import { createDirectTransportSimulationClient } from './transport-client.js';
import { createTransportApplicationController } from './transport-controller.js';

const root = join(
  import.meta.dirname,
  '..',
  '..',
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
const record = () => {
  const canonical = scenario();
  return parseTransportSaveRecord({
    kind: 'transport-save-record',
    schemaVersion: 7,
    saveId: 'slot',
    gameId: 'game-fixture',
    sourceTimelineId: 'timeline-source',
    sourceCommandRevision: 2,
    sourceSimulationTick: 120,
    sourceStreamOffset: 2,
    createdAtUtcMs: 1,
    updatedAtUtcMs: 2,
    scenario: createScenarioCoordinate(canonical),
    snapshot: createTransportSimulationSnapshot(
      createTransportSimulationState(canonical, 120),
    ),
  });
};
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
      columns: 1,
      resolutionDegrees: 0.001,
      totalActiveCellCount: 1,
      totalPopulationWeight: 1,
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
    ],
    stops: [{ stopPlaceId: 'tv-place-0053' }],
  });
};
const boardingDemandPlan = () => {
  const canonical = scenario();
  return parsePassengerDemandPlan({
    schemaVersion: '1.0.0',
    demandModelContentHash: 'b'.repeat(64),
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
        assignedStopPlaceId: 'tv-place-0108',
        distanceSquaredCells: 0,
      },
      {
        cellId: 'r0c1',
        row: 0,
        column: 1,
        populationWeight: 1,
        assignedStopPlaceId: 'tv-place-0093',
        distanceSquaredCells: 0,
      },
    ],
    stops: [{ stopPlaceId: 'tv-place-0093' }, { stopPlaceId: 'tv-place-0108' }],
  });
};

describe('transport application controller', () => {
  it('rejects obsolete pre-release saves before replacing authority', async () => {
    const canonical = scenario();
    const value = record();
    const v1 = {
      ...value,
      schemaVersion: 1,
      snapshot: {
        kind: 'transport-simulation-snapshot',
        schemaVersion: 1,
        simulationVersion: 'transport-1',
        scenario: createScenarioCoordinate(canonical),
        state: { tick: value.sourceSimulationTick },
      },
    };
    const controller = createTransportApplicationController({
      createClient: () => createDirectTransportSimulationClient(),
      repository: {
        get: async () => classifyPersistedSaveRecord(v1),
        put: async () => undefined,
      },
      scenarioResolver: { resolve: async () => canonical },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-current'),
      scenario: canonical,
    });
    await expect(
      controller.restore({
        saveId: 'slot',
        timelineId: parseTimelineId('timeline-v1-restored'),
      }),
    ).rejects.toThrow('obsolete');
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'timeline-current',
    });
    await controller.close();
  });

  it('resolves the exact active demand plan before restore teardown', async () => {
    const canonical = scenario();
    const plan = demandPlan();
    const activeRecord = parseTransportSaveRecord({
      ...record(),
      saveId: 'active-demand',
      sourceSimulationTick: 2,
      snapshot: createTransportSimulationSnapshot(
        advanceTransportTicks(
          createTransportSimulationState(canonical, 0, plan),
          2,
        ),
      ),
    });
    let resolutionFails = true;
    const resolver = vi.fn(async () => {
      if (resolutionFails) throw new Error('demand plan unavailable');
      return plan;
    });
    const controller = createTransportApplicationController({
      createClient: () => createDirectTransportSimulationClient(),
      repository: {
        get: async () => classifyPersistedSaveRecord(activeRecord),
        put: async () => undefined,
      },
      scenarioResolver: { resolve: async () => canonical },
      passengerDemandPlanResolver: { resolve: resolver },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-current'),
      scenario: canonical,
    });
    await expect(
      controller.restore({
        saveId: 'active-demand',
        timelineId: parseTimelineId('timeline-demand'),
      }),
    ).rejects.toThrow('demand plan unavailable');
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'timeline-current',
      passengerDemand: { status: 'disabled' },
    });
    resolutionFails = false;
    await controller.restore({
      saveId: 'active-demand',
      timelineId: parseTimelineId('timeline-demand'),
    });
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'timeline-demand',
      passengerDemand: {
        status: 'active',
        processedThroughTick: 2,
        totalEmittedPassengerCount: 2,
      },
    });
    expect(resolver).toHaveBeenCalledTimes(2);
    await controller.close();
  });

  it('preflights resolved active plans before touching current authority', async () => {
    const canonical = scenario();
    const plan = demandPlan();
    const activeRecord = parseTransportSaveRecord({
      ...record(),
      saveId: 'active-demand-preflight',
      sourceSimulationTick: 2,
      snapshot: createTransportSimulationSnapshot(
        advanceTransportTicks(
          createTransportSimulationState(canonical, 0, plan),
          2,
        ),
      ),
    });
    const current = createDirectTransportSimulationClient();
    const currentClose = vi.fn(() => current.close());
    let clientCreations = 0;
    let resolved: unknown = plan;
    let storedRecord = activeRecord;
    const controller = createTransportApplicationController({
      createClient: () => {
        clientCreations += 1;
        return clientCreations === 1
          ? Object.freeze({ ...current, close: currentClose })
          : createDirectTransportSimulationClient();
      },
      repository: {
        get: async () => classifyPersistedSaveRecord(storedRecord),
        put: async () => undefined,
      },
      scenarioResolver: { resolve: async () => canonical },
      passengerDemandPlanResolver: {
        resolve: async () => resolved as PassengerDemandPlanV1,
      },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-current'),
      scenario: canonical,
      passengerDemandPlan: plan,
    });
    await controller.advanceTicks(1);
    const expected = controller.projection.getState();

    const wrongHash = structuredClone(plan);
    (wrongHash as { demandModelContentHash: string }).demandModelContentHash =
      'e'.repeat(64);
    resolved = wrongHash;
    await expect(
      controller.restore({
        saveId: 'active-demand-preflight',
        timelineId: parseTimelineId('timeline-wrong'),
      }),
    ).rejects.toThrow(/demand plan/i);
    expect(controller.projection.getState()).toEqual({
      ...expected,
      message: expect.stringMatching(/demand plan/i),
    });
    expect(currentClose).not.toHaveBeenCalled();
    expect(clientCreations).toBe(1);

    resolved = {};
    await expect(
      controller.restore({
        saveId: 'active-demand-preflight',
        timelineId: parseTimelineId('timeline-malformed'),
      }),
    ).rejects.toThrow();
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'timeline-current',
      simulationTick: expected.simulationTick,
      fleet: expected.fleet,
      passengerDemand: expected.passengerDemand,
    });
    expect(currentClose).not.toHaveBeenCalled();
    expect(clientCreations).toBe(1);

    resolved = plan;
    const backlog = structuredClone(activeRecord);
    if (backlog.snapshot.state.passengerDemand.status !== 'active')
      throw new Error('Expected active fixture.');
    const mutableDemand = backlog.snapshot.state.passengerDemand as unknown as {
      stopArrivals: Array<{ awaitingDestinationCount: number }>;
      totalArrivedAtStopPassengerCount: number;
      servedEmittedPassengerCount: number;
      totalEmittedPassengerCount: number;
    };
    mutableDemand.stopArrivals[0]!.awaitingDestinationCount = 1;
    mutableDemand.totalArrivedAtStopPassengerCount += 1;
    mutableDemand.servedEmittedPassengerCount += 1;
    mutableDemand.totalEmittedPassengerCount += 1;
    storedRecord = parseTransportSaveRecord(backlog);
    await expect(
      controller.restore({
        saveId: 'active-demand-preflight',
        timelineId: parseTimelineId('timeline-backlog'),
      }),
    ).rejects.toThrow(/destination backlog/i);
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'timeline-current',
      simulationTick: expected.simulationTick,
    });
    expect(currentClose).not.toHaveBeenCalled();
    expect(clientCreations).toBe(1);

    storedRecord = activeRecord;
    const inconsistent = structuredClone(plan);
    (
      inconsistent as { accessPolicy: { accessTicksPerCell: number } }
    ).accessPolicy.accessTicksPerCell = 2;
    resolved = inconsistent;
    await expect(
      controller.restore({
        saveId: 'active-demand-preflight',
        timelineId: parseTimelineId('timeline-inconsistent'),
      }),
    ).rejects.toThrow(/demand plan/i);
    expect(currentClose).not.toHaveBeenCalled();
    expect(clientCreations).toBe(1);

    resolved = plan;
    await controller.restore({
      saveId: 'active-demand-preflight',
      timelineId: parseTimelineId('timeline-restored'),
    });
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'timeline-restored',
      simulationTick: 2,
      passengerDemand: { status: 'active', processedThroughTick: 2 },
    });
    expect(currentClose).toHaveBeenCalledTimes(1);
    expect(clientCreations).toBe(2);
    await controller.close();
  });

  it('preflights Snapshot V9 operation and capacity corruption before replacing authority', async () => {
    const canonical = scenario();
    let savedState = createTransportSimulationState(canonical, 0);
    for (const vehicleId of ['saved-a', 'saved-b'])
      savedState = applyTransportVehicleCommand(savedState, {
        kind: 'transport.vehicle.create',
        vehicleId,
        label: vehicleId,
        patternId: 'legacy-A2-torrevieja-la-mata',
        movementPlan: {
          kind: 'vehicle-movement-plan-v1',
          edgeTravelTicks: [1, 2, 3, 4],
        },
      });
    savedState = applyTransportVehicleCommand(savedState, {
      kind: 'transport.vehicle.start',
      vehicleId: 'saved-a',
    });
    savedState = advanceTransportTicks(savedState, 1);
    const validRecord = parseTransportSaveRecord({
      ...record(),
      saveId: 'operation-preflight',
      sourceSimulationTick: savedState.tick,
      snapshot: createTransportSimulationSnapshot(savedState),
    });
    let stored: unknown = validRecord;
    const current = createDirectTransportSimulationClient();
    const currentClose = vi.fn(() => current.close());
    let clientCreations = 0;
    const controller = createTransportApplicationController({
      createClient: () => {
        clientCreations += 1;
        return clientCreations === 1
          ? Object.freeze({ ...current, close: currentClose })
          : createDirectTransportSimulationClient();
      },
      repository: {
        get: async () => classifyPersistedSaveRecord(stored),
        put: async () => undefined,
      },
      scenarioResolver: { resolve: async () => canonical },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-current'),
      scenario: canonical,
      initialSimulationTick: 5,
    });
    const expected = controller.projection.getState();
    const corruptions: Array<(value: typeof validRecord) => void> = [
      (value) => {
        (
          value.snapshot.state.vehicleOperations as unknown as Array<{
            vehicleId: string;
          }>
        ).reverse();
      },
      (value) => {
        (
          value.snapshot.state.vehicleCapacities as unknown as Array<{
            vehicleId: string;
          }>
        ).reverse();
      },
      (value) => {
        (
          value.snapshot.state.vehicleOperations[0] as unknown as {
            stopCallSequence: number;
          }
        ).stopCallSequence += 1;
      },
      (value) => {
        (
          value.snapshot.state as unknown as {
            currentStopCalls: unknown[];
          }
        ).currentStopCalls = [];
      },
      (value) => {
        (
          value.snapshot.state.currentStopCalls[0] as unknown as {
            routeId: string | null;
          }
        ).routeId = 'legacy-A2';
      },
    ];
    for (const [index, corrupt] of corruptions.entries()) {
      const value = structuredClone(validRecord);
      corrupt(value);
      stored = value;
      await expect(
        controller.restore({
          saveId: 'operation-preflight',
          timelineId: parseTimelineId(`timeline-corrupt-${index}`),
        }),
      ).rejects.toThrow();
      expect(controller.projection.getState()).toEqual({
        ...expected,
        message: expect.any(String),
      });
      expect(currentClose).not.toHaveBeenCalled();
      expect(clientCreations).toBe(1);
    }

    stored = validRecord;
    await controller.restore({
      saveId: 'operation-preflight',
      timelineId: parseTimelineId('timeline-valid-operation'),
    });
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'timeline-valid-operation',
      simulationTick: 1,
      fleet: savedState.fleet,
      vehicleOperations: savedState.vehicleOperations,
      currentStopCalls: savedState.currentStopCalls,
    });
    expect(currentClose).toHaveBeenCalledTimes(1);
    expect(clientCreations).toBe(2);
    await controller.close();
  });

  it('preflights non-canonical Snapshot V9 boarding without replacing authority', async () => {
    const canonical = scenario();
    const plan = boardingDemandPlan();
    let boarded = advanceTransportTicks(
      createTransportSimulationState(canonical, 0, plan),
      2,
    );
    boarded = applyTransportVehicleCommand(boarded, {
      kind: 'transport.vehicle.create-route-cycle',
      vehicleId: 'boarding-preflight',
      label: 'Boarding preflight',
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
    const validRecord = parseTransportSaveRecord({
      ...record(),
      saveId: 'boarding-preflight',
      sourceSimulationTick: boarded.tick,
      snapshot: createTransportSimulationSnapshot(boarded),
    });
    let stored: unknown = validRecord;
    const current = createDirectTransportSimulationClient();
    const currentClose = vi.fn(() => current.close());
    let clientCreations = 0;
    const controller = createTransportApplicationController({
      createClient: () => {
        clientCreations += 1;
        return clientCreations === 1
          ? Object.freeze({ ...current, close: currentClose })
          : createDirectTransportSimulationClient();
      },
      repository: {
        get: async () => classifyPersistedSaveRecord(stored),
        put: async () => undefined,
      },
      scenarioResolver: { resolve: async () => canonical },
      passengerDemandPlanResolver: { resolve: async () => plan },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-current'),
      scenario: canonical,
      passengerDemandPlan: plan,
    });
    const expected = controller.projection.getState();
    const corruptions: Array<(value: typeof validRecord) => void> = [
      (value) => {
        (
          value.snapshot.state as unknown as {
            currentBoardingEvents: unknown[];
          }
        ).currentBoardingEvents = [];
      },
      (value) => {
        if (value.snapshot.state.passengerDemand.status !== 'active')
          throw new Error('Expected active fixture.');
        const demand = value.snapshot.state.passengerDemand as unknown as {
          waitingCohorts: Array<{
            passengerWaitingCohortId: string;
            count: number;
          }>;
          onboardGroups: Array<{
            sourceWaitingCohortId: string;
            count: number;
          }>;
          nextPassengerOnboardGroupSequence: number;
          nextPassengerWaitingCohortSequence: number;
          totalWaitingForVehiclePassengerCount: number;
          totalBoardedPassengerCount: number;
          totalOnboardPassengerCount: number;
        };
        const group = demand.onboardGroups[0]!;
        const residual = demand.waitingCohorts.find(
          (cohort) =>
            cohort.passengerWaitingCohortId === group.sourceWaitingCohortId,
        )!;
        residual.count += group.count;
        demand.onboardGroups = [];
        demand.nextPassengerOnboardGroupSequence = 1;
        demand.totalWaitingForVehiclePassengerCount += group.count;
        demand.totalBoardedPassengerCount = 0;
        demand.totalOnboardPassengerCount = 0;
        (
          value.snapshot.state as unknown as {
            currentBoardingEvents: unknown[];
          }
        ).currentBoardingEvents = [];
      },
      (value) => {
        if (value.snapshot.state.passengerDemand.status !== 'active')
          throw new Error('Expected active fixture.');
        const demand = value.snapshot.state.passengerDemand as unknown as {
          onboardGroups: Array<{ sourceWaitingCohortId: string }>;
          nextPassengerWaitingCohortSequence: number;
        };
        demand.onboardGroups[0]!.sourceWaitingCohortId =
          'passenger-waiting-cohort-999';
        demand.nextPassengerWaitingCohortSequence = 1000;
      },
      (value) => {
        if (value.snapshot.state.passengerDemand.status !== 'active')
          throw new Error('Expected active fixture.');
        const watermarks = value.snapshot.state.passengerDemand
          .waitingGenerationLineageWatermarks as unknown as Array<{
          passengerWaitingCohortKey: string;
        }>;
        watermarks[0] = {
          ...watermarks[0]!,
          passengerWaitingCohortKey: 'fabricated-lineage-key',
        };
      },
    ];
    for (const [index, corrupt] of corruptions.entries()) {
      const value = structuredClone(validRecord);
      corrupt(value);
      stored = value;
      await expect(
        controller.restore({
          saveId: 'boarding-preflight',
          timelineId: parseTimelineId(`timeline-boarding-corrupt-${index}`),
        }),
      ).rejects.toThrow();
      expect(controller.projection.getState()).toEqual({
        ...expected,
        message: expect.any(String),
      });
      expect(currentClose).not.toHaveBeenCalled();
      expect(clientCreations).toBe(1);
    }
    const generationState = advanceTransportTicks(boarded, 2);
    const generationRecord = parseTransportSaveRecord({
      ...validRecord,
      sourceSimulationTick: generationState.tick,
      snapshot: createTransportSimulationSnapshot(generationState),
    });
    const wrongGenerationOrder = structuredClone(generationRecord);
    if (wrongGenerationOrder.snapshot.state.passengerDemand.status !== 'active')
      throw new Error('Expected active fixture.');
    const generationDemand = wrongGenerationOrder.snapshot.state
      .passengerDemand as unknown as {
      waitingCohorts: Array<{
        originStopNodeId: string;
        destinationCellId: string;
        passengerWaitingCohortId: string;
      }>;
      onboardGroups: Array<{ sourceWaitingCohortId: string }>;
    };
    const sourceId = generationDemand.onboardGroups[0]!.sourceWaitingCohortId;
    const source = generationDemand.waitingCohorts.find(
      (cohort) => cohort.passengerWaitingCohortId === sourceId,
    )!;
    const sourceIndex = generationDemand.waitingCohorts.indexOf(source);
    const newerIndex = generationDemand.waitingCohorts.findIndex(
      (cohort) =>
        cohort.originStopNodeId === source.originStopNodeId &&
        cohort.destinationCellId === source.destinationCellId &&
        cohort.passengerWaitingCohortId !== sourceId,
    );
    [
      generationDemand.waitingCohorts[sourceIndex],
      generationDemand.waitingCohorts[newerIndex],
    ] = [
      generationDemand.waitingCohorts[newerIndex]!,
      generationDemand.waitingCohorts[sourceIndex]!,
    ];
    stored = wrongGenerationOrder;
    await expect(
      controller.restore({
        saveId: 'boarding-preflight',
        timelineId: parseTimelineId('timeline-generation-corrupt'),
      }),
    ).rejects.toThrow();
    expect(controller.projection.getState()).toEqual({
      ...expected,
      message: expect.any(String),
    });
    expect(currentClose).not.toHaveBeenCalled();
    expect(clientCreations).toBe(1);

    stored = generationRecord;
    await controller.restore({
      saveId: 'boarding-preflight',
      timelineId: parseTimelineId('timeline-boarding-valid'),
    });
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'timeline-boarding-valid',
      simulationTick: 4,
      fleet: generationState.fleet,
      currentBoardingEvents: generationState.currentBoardingEvents,
    });
    expect(currentClose).toHaveBeenCalledTimes(1);
    expect(clientCreations).toBe(2);
    await controller.close();
  });

  it('preflights overdue and duplicate passenger lifecycle authority without teardown', async () => {
    const canonical = scenario();
    const plan = boardingDemandPlan();
    const createVehicle = (vehicleId: string) => ({
      kind: 'transport.vehicle.create-route-cycle' as const,
      vehicleId,
      label: vehicleId,
      routeId: 'legacy-A2',
      passengerCapacity: 1,
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
    let boarded = advanceTransportTicks(
      createTransportSimulationState(canonical, 0, plan),
      2,
    );
    boarded = applyTransportVehicleCommand(boarded, createVehicle('z-bus'));
    const sourceGroup =
      boarded.passengerDemand.status === 'active'
        ? structuredClone(boarded.passengerDemand.onboardGroups[0]!)
        : undefined;
    if (sourceGroup === undefined) throw new Error('Expected onboard group.');
    boarded = applyTransportVehicleCommand(boarded, {
      kind: 'transport.vehicle.start',
      vehicleId: 'z-bus',
    });
    let alighted = boarded;
    while (alighted.currentAlightingEvents.length === 0)
      alighted = advanceTransportTicks(alighted, 1);
    const later = advanceTransportTicks(alighted, 1);
    const overdue = structuredClone(createTransportSimulationSnapshot(later));
    if (overdue.state.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    const overdueDemand = overdue.state.passengerDemand as unknown as {
      onboardGroups: Array<typeof sourceGroup>;
      totalOnboardPassengerCount: number;
      totalAlightedPassengerCount: number;
      totalCompletedJourneyPassengerCount: number;
    };
    overdueDemand.onboardGroups = [sourceGroup];
    overdueDemand.totalOnboardPassengerCount += sourceGroup.count;
    overdueDemand.totalAlightedPassengerCount -= sourceGroup.count;
    overdueDemand.totalCompletedJourneyPassengerCount -= sourceGroup.count;

    let ordered = advanceTransportTicks(
      createTransportSimulationState(canonical, 0, plan),
      2,
    );
    ordered = applyTransportVehicleCommand(ordered, createVehicle('z-bus'));
    ordered = applyTransportVehicleCommand(ordered, createVehicle('a-bus'));
    ordered = advanceTransportTicks(ordered, 1);
    const wrongOrder = structuredClone(
      createTransportSimulationSnapshot(ordered),
    );
    if (wrongOrder.state.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    (
      wrongOrder.state.passengerDemand as unknown as {
        onboardGroups: unknown[];
      }
    ).onboardGroups.reverse();
    const duplicateId = structuredClone(
      createTransportSimulationSnapshot(ordered),
    );
    if (duplicateId.state.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    const duplicateGroups = (
      duplicateId.state.passengerDemand as unknown as {
        onboardGroups: Array<{ passengerOnboardGroupId: string }>;
      }
    ).onboardGroups;
    duplicateGroups[1]!.passengerOnboardGroupId =
      duplicateGroups[0]!.passengerOnboardGroupId;

    const futureBoardingRun = structuredClone(
      createTransportSimulationSnapshot(ordered),
    );
    if (futureBoardingRun.state.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    const futureOnboard = (
      futureBoardingRun.state.passengerDemand as unknown as {
        onboardGroups: Array<{
          boardedAtPatternRunSequence: number;
          alightAtPatternRunSequence: number;
        }>;
      }
    ).onboardGroups[0]!;
    futureOnboard.boardedAtPatternRunSequence =
      ordered.vehicleOperations[0]!.patternRunSequence + 1;
    futureOnboard.alightAtPatternRunSequence =
      futureOnboard.boardedAtPatternRunSequence;

    const accessPlan = structuredClone(plan);
    const mutableAccessPlan = accessPlan as unknown as {
      demandModelContentHash: string;
      accessPolicy: { accessTicksPerCell: number };
      emissionPolicy: { creditsPerPassenger: number };
      cells: Array<{ distanceSquaredCells: number | null }>;
    };
    mutableAccessPlan.demandModelContentHash = 'a'.repeat(64);
    mutableAccessPlan.accessPolicy.accessTicksPerCell = 2;
    mutableAccessPlan.emissionPolicy.creditsPerPassenger = 8;
    for (const cell of mutableAccessPlan.cells) cell.distanceSquaredCells = 4;
    let accessState = advanceTransportTicks(
      createTransportSimulationState(canonical, 0, accessPlan),
      2,
    );
    accessState = applyTransportVehicleCommand(
      accessState,
      createVehicle('access-preflight-bus'),
    );
    accessState = applyTransportVehicleCommand(accessState, {
      kind: 'transport.vehicle.start',
      vehicleId: 'access-preflight-bus',
    });
    while (accessState.currentAlightingEvents.length === 0)
      accessState = advanceTransportTicks(accessState, 1);
    accessState = advanceTransportTicks(accessState, 1);
    const backwardRun = structuredClone(
      createTransportSimulationSnapshot(accessState),
    );
    const backwardRunGroup = (
      backwardRun.state.passengerDemand as unknown as {
        destinationAccessGroups: Array<{
          boardedAtPatternRunSequence: number;
          alightedAtPatternRunSequence: number;
        }>;
      }
    ).destinationAccessGroups[0]!;
    backwardRunGroup.boardedAtPatternRunSequence -= 1;
    backwardRunGroup.alightedAtPatternRunSequence -= 1;
    const backwardCall = structuredClone(
      createTransportSimulationSnapshot(accessState),
    );
    const backwardCallGroup = (
      backwardCall.state.passengerDemand as unknown as {
        destinationAccessGroups: Array<{
          boardedAtStopCallSequence: number;
          alightedAtStopCallSequence: number;
        }>;
      }
    ).destinationAccessGroups[0]!;
    backwardCallGroup.boardedAtStopCallSequence -= 1;
    backwardCallGroup.alightedAtStopCallSequence -= 1;
    const falseAccessCall = structuredClone(
      createTransportSimulationSnapshot(accessState),
    );
    if (falseAccessCall.state.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    (
      falseAccessCall.state.passengerDemand as unknown as {
        destinationAccessGroups: Array<{
          alightedAtStopCallSequence: number;
        }>;
      }
    ).destinationAccessGroups[0]!.alightedAtStopCallSequence += 1;

    const falseCompletionRun = structuredClone(
      createTransportSimulationSnapshot(alighted),
    );
    (
      falseCompletionRun.state as unknown as {
        currentJourneyCompletionEvents: Array<{
          alightedAtPatternRunSequence: number;
        }>;
      }
    ).currentJourneyCompletionEvents[0]!.alightedAtPatternRunSequence += 1;

    const disabledEvent = structuredClone(
      createTransportSimulationSnapshot(
        createTransportSimulationState(canonical, later.tick),
      ),
    );
    (
      disabledEvent.state as unknown as { currentAlightingEvents: unknown[] }
    ).currentAlightingEvents = structuredClone(
      alighted.currentAlightingEvents,
    ) as unknown as unknown[];
    const validRecord = parseTransportSaveRecord({
      ...record(),
      saveId: 'journey-preflight',
      sourceSimulationTick: ordered.tick,
      snapshot: createTransportSimulationSnapshot(ordered),
    });
    let stored: unknown = validRecord;
    const current = createDirectTransportSimulationClient();
    const currentClose = vi.fn(() => current.close());
    let clientCreations = 0;
    const controller = createTransportApplicationController({
      createClient: () => {
        clientCreations += 1;
        return clientCreations === 1
          ? Object.freeze({ ...current, close: currentClose })
          : createDirectTransportSimulationClient();
      },
      repository: {
        get: async () => classifyPersistedSaveRecord(stored),
        put: async () => undefined,
      },
      scenarioResolver: { resolve: async () => canonical },
      passengerDemandPlanResolver: {
        resolve: async (coordinate) =>
          coordinate.demandModelContentHash ===
          accessPlan.demandModelContentHash
            ? accessPlan
            : plan,
      },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-current'),
      scenario: canonical,
      passengerDemandPlan: plan,
    });
    const expected = controller.projection.getState();
    const corruptions: ReadonlyArray<
      readonly [string, ReturnType<typeof createTransportSimulationSnapshot>]
    > = [
      ['future-boarding-run', futureBoardingRun],
      ['overdue', overdue],
      ['wrong-order', wrongOrder],
      ['duplicate-id', duplicateId],
      ['disabled-event', disabledEvent],
      ['false-access-call', falseAccessCall],
      ['backward-run', backwardRun],
      ['backward-call', backwardCall],
      ['false-completion-run', falseCompletionRun],
    ];
    for (const [index, [name, snapshot]] of corruptions.entries()) {
      stored = {
        ...validRecord,
        sourceSimulationTick: snapshot.state.tick,
        snapshot,
      };
      let rejected = false;
      try {
        await controller.restore({
          saveId: 'journey-preflight',
          timelineId: parseTimelineId(`timeline-journey-corrupt-${index}`),
        });
      } catch {
        rejected = true;
      }
      expect(rejected, name).toBe(true);
      expect(controller.projection.getState()).toEqual({
        ...expected,
        message: expect.any(String),
      });
      expect(currentClose).not.toHaveBeenCalled();
      expect(clientCreations).toBe(1);
    }

    stored = validRecord;
    await controller.restore({
      saveId: 'journey-preflight',
      timelineId: parseTimelineId('timeline-journey-valid'),
    });
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'timeline-journey-valid',
      simulationTick: ordered.tick,
      fleet: ordered.fleet,
      passengerDemand: {
        status: 'active',
        processedThroughTick: ordered.tick,
        onboardGroups:
          ordered.passengerDemand.status === 'active'
            ? ordered.passengerDemand.onboardGroups
            : [],
        destinationAccessGroups:
          ordered.passengerDemand.status === 'active'
            ? ordered.passengerDemand.destinationAccessGroups
            : [],
      },
      currentAlightingEvents: ordered.currentAlightingEvents,
      currentJourneyCompletionEvents: ordered.currentJourneyCompletionEvents,
    });
    expect(currentClose).toHaveBeenCalledTimes(1);
    expect(clientCreations).toBe(2);
    await controller.close();
  });

  it('preflights missing and fabricated terminal calls before teardown', async () => {
    const canonical = scenario();
    let terminal = createTransportSimulationState(canonical, 0);
    terminal = applyTransportVehicleCommand(terminal, {
      kind: 'transport.vehicle.create',
      vehicleId: 'terminal-preflight',
      label: 'Terminal preflight',
      patternId: 'legacy-A2-torrevieja-la-mata',
      movementPlan: {
        kind: 'vehicle-movement-plan-v1',
        edgeTravelTicks: [1, 1, 1, 1],
      },
    });
    terminal = applyTransportVehicleCommand(terminal, {
      kind: 'transport.vehicle.start',
      vehicleId: 'terminal-preflight',
    });
    terminal = advanceTransportTicks(terminal, 4);
    const validRecord = parseTransportSaveRecord({
      ...record(),
      saveId: 'terminal-preflight',
      sourceSimulationTick: terminal.tick,
      snapshot: createTransportSimulationSnapshot(terminal),
    });
    const missing = structuredClone(validRecord);
    (
      missing.snapshot.state as unknown as { currentStopCalls: unknown[] }
    ).currentStopCalls = [];
    const laterState = advanceTransportTicks(terminal, 1);
    const fabricatedLater = structuredClone(
      parseTransportSaveRecord({
        ...validRecord,
        sourceSimulationTick: laterState.tick,
        snapshot: createTransportSimulationSnapshot(laterState),
      }),
    );
    (
      fabricatedLater.snapshot.state as unknown as {
        currentStopCalls: unknown[];
      }
    ).currentStopCalls = [
      {
        ...terminal.currentStopCalls[0]!,
        tick: laterState.tick,
      },
    ];

    let stored: unknown = missing;
    const current = createDirectTransportSimulationClient();
    const currentClose = vi.fn(() => current.close());
    let clientCreations = 0;
    const controller = createTransportApplicationController({
      createClient: () => {
        clientCreations += 1;
        return clientCreations === 1
          ? Object.freeze({ ...current, close: currentClose })
          : createDirectTransportSimulationClient();
      },
      repository: {
        get: async () => classifyPersistedSaveRecord(stored),
        put: async () => undefined,
      },
      scenarioResolver: { resolve: async () => canonical },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-current'),
      scenario: canonical,
      initialSimulationTick: 6,
    });
    const expected = controller.projection.getState();
    for (const [index, corrupt] of [missing, fabricatedLater].entries()) {
      stored = corrupt;
      await expect(
        controller.restore({
          saveId: 'terminal-preflight',
          timelineId: parseTimelineId(`terminal-corrupt-${index}`),
        }),
      ).rejects.toThrow();
      expect(controller.projection.getState()).toEqual({
        ...expected,
        message: expect.any(String),
      });
      expect(currentClose).not.toHaveBeenCalled();
      expect(clientCreations).toBe(1);
    }
    await controller.close();
  });

  it('publishes failed and permits retry after synchronous initial construction failure', async () => {
    const reliable = vi.fn();
    const render = vi.fn();
    const close = vi.fn();
    const valid = createDirectTransportSimulationClient();
    let calls = 0;
    const controller = createTransportApplicationController({
      createClient: () => {
        if (++calls === 1) throw new Error('construction failed');
        return Object.freeze({
          ...valid,
          subscribeReliableUpdates(
            listener: Parameters<typeof valid.subscribeReliableUpdates>[0],
          ) {
            reliable();
            return valid.subscribeReliableUpdates(listener);
          },
          subscribeRenderSnapshots(
            listener: Parameters<typeof valid.subscribeRenderSnapshots>[0],
          ) {
            render();
            return valid.subscribeRenderSnapshots(listener);
          },
          async close() {
            close();
            await valid.close();
          },
        });
      },
      repository: { get: async () => undefined, put: async () => undefined },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await expect(
      controller.startNew({
        gameId: parseGameId('game-fixture'),
        timelineId: parseTimelineId('failed-timeline'),
        scenario: scenario(),
      }),
    ).rejects.toThrow('construction failed');
    expect(controller.projection.getState()).toEqual({
      status: 'failed',
      message: 'construction failed',
    });
    expect(reliable).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('retry-timeline'),
      scenario: scenario(),
    });
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'retry-timeline',
    });
    await controller.close();
  });

  it('normalizes a non-Error initial construction failure', async () => {
    const controller = createTransportApplicationController({
      createClient: () => {
        throw 'construction failed';
      },
      repository: { get: async () => undefined, put: async () => undefined },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await expect(
      controller.startNew({
        gameId: parseGameId('game-fixture'),
        timelineId: parseTimelineId('failed-timeline'),
        scenario: scenario(),
      }),
    ).rejects.toBe('construction failed');
    expect(controller.projection.getState()).toEqual({
      status: 'failed',
      message: 'Transport operation failed.',
    });
    await controller.close();
  });

  it('finishes terminal close when construction failure starts close', async () => {
    const holder: {
      controller?: ReturnType<typeof createTransportApplicationController>;
    } = {};
    const controller = createTransportApplicationController({
      createClient: () => {
        void holder.controller!.close();
        throw new Error('construction failed during close');
      },
      repository: { get: async () => undefined, put: async () => undefined },
      scenarioResolver: { resolve: async () => scenario() },
    });
    holder.controller = controller;
    await expect(
      controller.startNew({
        gameId: parseGameId('game-fixture'),
        timelineId: parseTimelineId('failed-timeline'),
        scenario: scenario(),
      }),
    ).rejects.toThrow('construction failed during close');
    await controller.close();
    expect(controller.projection.getState()).toEqual({ status: 'closed' });
  });

  it('rejects every authority operation while idle and subscriptions after close', async () => {
    const controller = createTransportApplicationController({
      createClient: createDirectTransportSimulationClient,
      repository: { get: async () => undefined, put: async () => undefined },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await expect(
      controller.save({
        saveId: 'idle',
        createdAtUtcMs: 1,
        updatedAtUtcMs: 1,
      }),
    ).rejects.toThrow('No ready');
    await expect(controller.advanceTicks(1)).rejects.toThrow('No ready');
    await expect(
      controller.restore({
        saveId: 'idle',
        timelineId: parseTimelineId('idle-restore'),
      }),
    ).rejects.toThrow('No ready');
    await controller.close();
    expect(() => controller.projection.subscribe(() => undefined)).toThrow(
      'closed',
    );
  });

  it('serializes duplicate start and save behind a pending activation', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = createDirectTransportSimulationClient();
    const stored: unknown[] = [];
    const controller = createTransportApplicationController({
      createClient: () =>
        Object.freeze({
          ...base,
          async connect(request: Parameters<typeof base.connect>[0]) {
            await gate;
            await base.connect(request);
          },
        }),
      repository: {
        get: async () => undefined,
        put: async (value) => {
          stored.push(value);
        },
      },
      scenarioResolver: { resolve: async () => scenario() },
    });
    const starting = controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-queued'),
      scenario: scenario(),
    });
    await expect(
      controller.startNew({
        gameId: parseGameId('game-fixture'),
        timelineId: parseTimelineId('duplicate'),
        scenario: scenario(),
      }),
    ).rejects.toThrow('unavailable');
    const saving = controller.save({
      saveId: 'queued',
      createdAtUtcMs: 1,
      updatedAtUtcMs: 1,
    });
    expect(stored).toHaveLength(0);
    release();
    await starting;
    await saving;
    expect(stored).toHaveLength(1);
    await controller.close();
  });

  it('serializes commands and saves behind restore resolution', async () => {
    let resolve!: (value: ReturnType<typeof scenario>) => void;
    const clients = [
      createDirectTransportSimulationClient(),
      createDirectTransportSimulationClient(),
    ];
    const stored: unknown[] = [];
    const controller = createTransportApplicationController({
      createClient: () => clients.shift()!,
      repository: {
        get: async () => classifyPersistedSaveRecord(record()),
        put: async (value) => {
          stored.push(value);
        },
      },
      scenarioResolver: {
        resolve: () => new Promise((accept) => (resolve = accept)),
      },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-current'),
      scenario: scenario(),
    });
    const restoring = controller.restore({
      saveId: 'slot',
      timelineId: parseTimelineId('timeline-restored'),
    });
    const advancing = controller.advanceTicks(1);
    const saving = controller.save({
      saveId: 'after-restore',
      createdAtUtcMs: 1,
      updatedAtUtcMs: 1,
    });
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    resolve(scenario());
    await restoring;
    await advancing;
    await saving;
    expect(controller.projection.getState()).toMatchObject({
      timelineId: 'timeline-restored',
      simulationTick: 121,
    });
    expect(stored[0]).toMatchObject({ sourceTimelineId: 'timeline-restored' });
    await controller.close();
  });

  it('makes close terminal while snapshot export is pending and suppresses the stale save', async () => {
    const base = createDirectTransportSimulationClient();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const exportEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let delay = false;
    const put = vi.fn(async () => undefined);
    const controller = createTransportApplicationController({
      createClient: () =>
        Object.freeze({
          ...base,
          async exportSnapshot() {
            if (delay) {
              entered();
              await gate;
            }
            return base.exportSnapshot();
          },
        }),
      repository: { get: async () => undefined, put },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-close-save'),
      scenario: scenario(),
    });
    delay = true;
    const saving = controller.save({
      saveId: 'stale',
      createdAtUtcMs: 1,
      updatedAtUtcMs: 1,
    });
    await exportEntered;
    const closing = controller.close();
    release();
    await saving;
    await closing;
    expect(put).not.toHaveBeenCalled();
    expect(controller.projection.getState()).toEqual({ status: 'closed' });
  });

  it('serializes two competing restores and leaves only the last timeline active', async () => {
    const clients = Array.from({ length: 3 }, () =>
      createDirectTransportSimulationClient(),
    );
    const controller = createTransportApplicationController({
      createClient: () => clients.shift()!,
      repository: {
        get: async () => classifyPersistedSaveRecord(record()),
        put: async () => undefined,
      },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-current'),
      scenario: scenario(),
    });
    const first = controller.restore({
      saveId: 'slot',
      timelineId: parseTimelineId('timeline-one'),
    });
    const second = controller.restore({
      saveId: 'slot',
      timelineId: parseTimelineId('timeline-two'),
    });
    await Promise.all([first, second]);
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'timeline-two',
      simulationTick: 120,
    });
    await controller.close();
  });

  it('isolates command/save failures and aggregates both cleanup failures', async () => {
    const base = createDirectTransportSimulationClient();
    let failCommand = false;
    const controller = createTransportApplicationController({
      createClient: () =>
        Object.freeze({
          ...base,
          sendCommand: (command: Parameters<typeof base.sendCommand>[0]) =>
            failCommand
              ? Promise.reject(new Error('command failed'))
              : base.sendCommand(command),
          async close() {
            await base.close();
            throw new Error('client close failed');
          },
        }),
      repository: {
        get: async () => undefined,
        put: async () => Promise.reject(new Error('put failed')),
        close: async () => Promise.reject(new Error('repository close failed')),
      },
      scenarioResolver: { resolve: async () => scenario() },
    });
    const remove = controller.projection.subscribe(() => undefined);
    remove();
    remove();
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-failures'),
      scenario: scenario(),
    });
    await expect(
      controller.save({
        saveId: 'slot',
        createdAtUtcMs: 1,
        updatedAtUtcMs: 1,
      }),
    ).rejects.toThrow('put failed');
    expect(controller.projection.getState().message).toBe('put failed');
    failCommand = true;
    await expect(controller.advanceTicks(1)).rejects.toThrow('command failed');
    await expect(controller.close()).rejects.toThrow('cleanup failed');
    expect(controller.projection.getState()).toEqual({ status: 'closed' });
  });

  it('closes a replacement whose readiness export fails', async () => {
    const base = createDirectTransportSimulationClient();
    const close = vi.fn(() => base.close());
    const controller = createTransportApplicationController({
      createClient: () =>
        Object.freeze({
          ...base,
          exportSnapshot: async () =>
            Promise.reject(new Error('readiness failed')),
          close,
        }),
      repository: { get: async () => undefined, put: async () => undefined },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await expect(
      controller.startNew({
        gameId: parseGameId('game-fixture'),
        timelineId: parseTimelineId('timeline-readiness'),
        scenario: scenario(),
      }),
    ).rejects.toThrow('readiness failed');
    expect(close).toHaveBeenCalledOnce();
    expect(controller.projection.getState()).toMatchObject({
      status: 'failed',
      message: 'readiness failed',
    });
    await controller.close();
  });

  it('closes an idle controller and notifies a healthy projection listener', async () => {
    const listener = vi.fn();
    const controller = createTransportApplicationController({
      createClient: createDirectTransportSimulationClient,
      repository: { get: async () => undefined, put: async () => undefined },
      scenarioResolver: { resolve: async () => scenario() },
    });
    const remove = controller.projection.subscribe(listener);
    await controller.close();
    expect(listener).toHaveBeenCalledWith({ status: 'closed' });
    remove();
  });

  it('cleans up a client whose readiness becomes stale and normalizes non-Error startup failure', async () => {
    const base = createDirectTransportSimulationClient();
    let releaseExport!: () => void;
    const exportGate = new Promise<void>((resolve) => {
      releaseExport = resolve;
    });
    const delayed = Object.freeze({
      ...base,
      async exportSnapshot() {
        await exportGate;
        return base.exportSnapshot();
      },
    });
    const controller = createTransportApplicationController({
      createClient: () => delayed,
      repository: { get: async () => undefined, put: async () => undefined },
      scenarioResolver: { resolve: async () => scenario() },
    });
    const starting = controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-delayed'),
      scenario: scenario(),
    });
    await Promise.resolve();
    await controller.close();
    releaseExport();
    await expect(starting).rejects.toThrow('stale');
    expect(controller.projection.getState()).toEqual({ status: 'closed' });

    const failingBase = createDirectTransportSimulationClient();
    const failing = createTransportApplicationController({
      createClient: () =>
        Object.freeze({
          ...failingBase,
          connect: async () => Promise.reject('startup failed'),
        }),
      repository: { get: async () => undefined, put: async () => undefined },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await expect(
      failing.startNew({
        gameId: parseGameId('game-fixture'),
        timelineId: parseTimelineId('timeline-failed'),
        scenario: scenario(),
      }),
    ).rejects.toBe('startup failed');
    expect(failing.projection.getState()).toEqual({
      status: 'failed',
      message: 'Transport operation failed.',
    });
    await failing.close();
  });

  it('resolves the exact scenario before closing the current client', async () => {
    const events: string[] = [];
    let resolveScenario!: (value: ReturnType<typeof scenario>) => void;
    const first = createDirectTransportSimulationClient();
    const second = createDirectTransportSimulationClient();
    const clients = [
      Object.freeze({
        ...first,
        async close() {
          events.push('close-old');
          await first.close();
        },
      }),
      second,
    ];
    const controller = createTransportApplicationController({
      createClient: () => clients.shift()!,
      repository: {
        get: async () => classifyPersistedSaveRecord(record()),
        put: async () => undefined,
      },
      scenarioResolver: {
        resolve: () =>
          new Promise((resolve) => {
            events.push('resolve-start');
            resolveScenario = resolve;
          }),
      },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-current'),
      scenario: scenario(),
    });
    const restoring = controller.restore({
      saveId: 'slot',
      timelineId: parseTimelineId('timeline-restored'),
    });
    await vi.waitFor(() => expect(events).toEqual(['resolve-start']));
    resolveScenario(scenario());
    await restoring;
    expect(events).toEqual(['resolve-start', 'close-old']);
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'timeline-restored',
      scenario: { scenarioId: 'torrevieja-mini-v1' },
      simulationTick: 120,
    });
    await controller.close();
  });

  it('keeps the current ready session when resolution fails', async () => {
    const base = createDirectTransportSimulationClient();
    const close = vi.fn(() => base.close());
    const client = Object.freeze({ ...base, close });
    const controller = createTransportApplicationController({
      createClient: () => client,
      repository: {
        get: async () => classifyPersistedSaveRecord(record()),
        put: async () => undefined,
      },
      scenarioResolver: {
        resolve: async () => Promise.reject(new Error('missing scenario')),
      },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-current'),
      scenario: scenario(),
    });
    await expect(
      controller.restore({
        saveId: 'slot',
        timelineId: parseTimelineId('timeline-restored'),
      }),
    ).rejects.toThrow('missing scenario');
    expect(close).not.toHaveBeenCalled();
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'timeline-current',
      message: 'missing scenario',
    });
    await controller.close();
  });

  it('saves the queued authoritative export and rejects legacy restore before teardown', async () => {
    const stored: unknown[] = [];
    const base = createDirectTransportSimulationClient();
    const close = vi.fn(() => base.close());
    const controller = createTransportApplicationController({
      createClient: () => Object.freeze({ ...base, close }),
      repository: {
        get: async () =>
          classifyPersistedSaveRecord({
            kind: 'foundation-save-record',
            schemaVersion: 1,
            saveId: 'legacy',
            gameId: 'game-fixture',
            sourceTimelineId: 'old',
            sourceCommandRevision: 0,
            sourceSimulationTick: 0,
            sourceStreamOffset: 0,
            createdAtUtcMs: 1,
            updatedAtUtcMs: 1,
            snapshot: {
              kind: 'foundation-simulation-snapshot',
              schemaVersion: 1,
              simulationVersion: 'foundation-1',
              state: { tick: 0 },
            },
          }),
        put: async (value) => {
          stored.push(value);
        },
      },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-current'),
      scenario: scenario(),
    });
    await controller.advanceTicks(2);
    expect(controller.projection.getState()).toMatchObject({
      simulationTick: 2,
      commandRevision: 1,
      streamOffset: 1,
    });
    await controller.save({
      saveId: 'slot',
      createdAtUtcMs: 1,
      updatedAtUtcMs: 2,
    });
    expect(stored[0]).toMatchObject({
      kind: 'transport-save-record',
      scenario: { scenarioId: 'torrevieja-mini-v1' },
      snapshot: { state: { tick: 2 } },
    });
    await expect(
      controller.restore({
        saveId: 'legacy',
        timelineId: parseTimelineId('timeline-restored'),
      }),
    ).rejects.toThrow('obsolete');
    expect(close).not.toHaveBeenCalled();
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      message: expect.stringContaining('obsolete'),
    });
    const listener = vi.fn();
    const remove = controller.projection.subscribe(listener);
    remove();
    remove();
    const firstClose = controller.close();
    expect(controller.close()).toBe(firstClose);
    await firstClose;
    expect(controller.projection.getState()).toEqual({ status: 'closed' });
  });

  it('keeps missing and malformed restore failures recoverable and enforces terminal guards', async () => {
    const client = createDirectTransportSimulationClient();
    const raws = [
      undefined,
      classifyPersistedSaveRecord({
        kind: 'transport-save-record',
        schemaVersion: 1,
      }),
      classifyPersistedSaveRecord({ saveId: 'other', kind: 'other-product' }),
    ];
    const controller = createTransportApplicationController({
      createClient: () => client,
      repository: {
        get: async () => raws.shift(),
        put: async () => undefined,
      },
      scenarioResolver: { resolve: async () => scenario() },
    });
    controller.projection.subscribe(() => {
      throw new Error('projection listener');
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('timeline-current'),
      scenario: scenario(),
      initialSimulationTick: 5,
    });
    await expect(
      controller.startNew({
        gameId: parseGameId('game-fixture'),
        timelineId: parseTimelineId('another'),
        scenario: scenario(),
      }),
    ).rejects.toThrow('unavailable');
    await expect(
      controller.restore({
        saveId: 'missing',
        timelineId: parseTimelineId('timeline-restored'),
      }),
    ).rejects.toThrow('not found');
    await expect(
      controller.restore({
        saveId: 'malformed',
        timelineId: parseTimelineId('timeline-restored'),
      }),
    ).rejects.toThrow('obsolete');
    await expect(
      controller.restore({
        saveId: 'unrelated',
        timelineId: parseTimelineId('timeline-restored'),
      }),
    ).rejects.toThrow('not a transport save');
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'timeline-current',
    });
    await controller.close();
    await expect(
      controller.save({ saveId: 'x', createdAtUtcMs: 1, updatedAtUtcMs: 1 }),
    ).rejects.toThrow('closed');
    await expect(
      controller.restore({
        saveId: 'x',
        timelineId: parseTimelineId('late'),
      }),
    ).rejects.toThrow('closed');
  });

  it('releases the session claim after invalid start and failed restore teardown', async () => {
    const first = createDirectTransportSimulationClient();
    const clients = [
      Object.freeze({
        ...first,
        async close() {
          await first.close();
          throw new Error('old close failed');
        },
      }),
      createDirectTransportSimulationClient(),
      createDirectTransportSimulationClient(),
    ];
    const controller = createTransportApplicationController({
      createClient: () => clients.shift()!,
      repository: {
        get: async () => classifyPersistedSaveRecord(record()),
        put: async () => undefined,
      },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await expect(
      controller.startNew({
        gameId: '' as never,
        timelineId: parseTimelineId('invalid'),
        scenario: scenario(),
      }),
    ).rejects.toThrow();
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('current'),
      scenario: scenario(),
    });
    await expect(
      controller.restore({
        saveId: 'slot',
        timelineId: parseTimelineId('replacement'),
      }),
    ).rejects.toThrow('old close failed');
    expect(controller.projection.getState()).toEqual({
      status: 'failed',
      message: 'old close failed',
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('recovered'),
      scenario: scenario(),
    });
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'recovered',
    });
    await controller.close();
  });

  it('recovers after synchronous replacement construction failure', async () => {
    const clients = [
      createDirectTransportSimulationClient(),
      createDirectTransportSimulationClient(),
    ];
    let calls = 0;
    const controller = createTransportApplicationController({
      createClient: () => {
        if (++calls === 2) throw new Error('construction failed');
        return clients.shift()!;
      },
      repository: {
        get: async () => classifyPersistedSaveRecord(record()),
        put: async () => undefined,
      },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('current'),
      scenario: scenario(),
    });
    await expect(
      controller.restore({
        saveId: 'slot',
        timelineId: parseTimelineId('replacement'),
      }),
    ).rejects.toThrow('construction failed');
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'current',
      message: 'construction failed',
    });
    await controller.restore({
      saveId: 'slot',
      timelineId: parseTimelineId('recovered'),
    });
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'recovered',
    });
    await controller.close();
  });

  it('keeps ready authority when a restore candidate fails and validates candidate cleanup', async () => {
    const current = createDirectTransportSimulationClient();
    const failed = createDirectTransportSimulationClient();
    const failedClose = vi.fn(async () => {
      await failed.close();
      throw new Error('candidate cleanup failed');
    });
    let creation = 0;
    const controller = createTransportApplicationController({
      createClient: () =>
        ++creation === 1
          ? current
          : Object.freeze({
              ...failed,
              connect: async () => {
                throw new Error('candidate connect failed');
              },
              close: failedClose,
            }),
      repository: {
        get: async () => classifyPersistedSaveRecord(record()),
        put: async () => undefined,
      },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('current'),
      scenario: scenario(),
    });
    const before = controller.projection.getState();
    await expect(
      controller.restore({
        saveId: 'slot',
        timelineId: parseTimelineId('candidate-failed'),
      }),
    ).rejects.toBeInstanceOf(AggregateError);
    expect(failedClose).toHaveBeenCalledOnce();
    expect(controller.projection.getState()).toEqual({
      ...before,
      message: 'candidate connect failed',
    });
    await controller.advanceTicks(1);
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'current',
      simulationTick: 1,
    });
    await controller.close();
  });

  it('rejects a candidate without full synchronization before replacing authority', async () => {
    const current = createDirectTransportSimulationClient();
    const candidate = createDirectTransportSimulationClient();
    const candidateClose = vi.fn(() => candidate.close());
    let creation = 0;
    const controller = createTransportApplicationController({
      createClient: () =>
        ++creation === 1
          ? current
          : Object.freeze({
              ...candidate,
              synchronize: async () =>
                ({
                  kind: 'transport-synchronization-response',
                  contractVersion: 4,
                  foundation: {
                    kind: 'foundation-synchronization-response',
                    contractVersion: 1,
                    mode: 'incremental',
                    updates: [],
                  },
                }) as never,
              close: candidateClose,
            }),
      repository: {
        get: async () => classifyPersistedSaveRecord(record()),
        put: async () => undefined,
      },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('current'),
      scenario: scenario(),
    });
    await expect(
      controller.restore({
        saveId: 'slot',
        timelineId: parseTimelineId('invalid-sync'),
      }),
    ).rejects.toThrow('Full transport synchronization');
    expect(candidateClose).toHaveBeenCalledOnce();
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'current',
    });
    await controller.close();
  });

  it('discards a prepared restore candidate when terminal close makes it stale', async () => {
    const current = createDirectTransportSimulationClient();
    const candidate = createDirectTransportSimulationClient();
    const candidateClose = vi.fn(() => candidate.close());
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const connecting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let creation = 0;
    const controller = createTransportApplicationController({
      createClient: () =>
        ++creation === 1
          ? current
          : Object.freeze({
              ...candidate,
              async connect(request: Parameters<typeof candidate.connect>[0]) {
                entered();
                await gate;
                await candidate.connect(request);
              },
              close: candidateClose,
            }),
      repository: {
        get: async () => classifyPersistedSaveRecord(record()),
        put: async () => undefined,
      },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('current'),
      scenario: scenario(),
    });
    const restoring = controller.restore({
      saveId: 'slot',
      timelineId: parseTimelineId('stale-candidate'),
    });
    await connecting;
    const closing = controller.close();
    release();
    await expect(restoring).rejects.toThrow('stale');
    await closing;
    expect(candidateClose).toHaveBeenCalledOnce();
    expect(controller.projection.getState()).toEqual({ status: 'closed' });
  });

  it('accepts a direct full synchronization response from a restore candidate', async () => {
    const current = createDirectTransportSimulationClient();
    const candidate = createDirectTransportSimulationClient();
    let creation = 0;
    const controller = createTransportApplicationController({
      createClient: () =>
        ++creation === 1
          ? current
          : Object.freeze({
              ...candidate,
              async synchronize(
                request: Parameters<typeof candidate.synchronize>[0],
              ) {
                const response = await candidate.synchronize(request);
                return response.kind === 'transport-synchronization-response'
                  ? response.foundation
                  : response;
              },
            }),
      repository: {
        get: async () => classifyPersistedSaveRecord(record()),
        put: async () => undefined,
      },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('current'),
      scenario: scenario(),
    });
    await controller.restore({
      saveId: 'slot',
      timelineId: parseTimelineId('direct-sync'),
    });
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'direct-sync',
    });
    await controller.close();
  });

  it('does not publish candidate failure after terminal close begins', async () => {
    const current = createDirectTransportSimulationClient();
    const candidate = createDirectTransportSimulationClient();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const connecting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let creation = 0;
    const controller = createTransportApplicationController({
      createClient: () =>
        ++creation === 1
          ? current
          : Object.freeze({
              ...candidate,
              async connect() {
                entered();
                await gate;
                throw new Error('late candidate failure');
              },
            }),
      repository: {
        get: async () => classifyPersistedSaveRecord(record()),
        put: async () => undefined,
      },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('current'),
      scenario: scenario(),
    });
    const restoring = controller.restore({
      saveId: 'slot',
      timelineId: parseTimelineId('late-failure'),
    });
    await connecting;
    const closing = controller.close();
    release();
    await expect(restoring).rejects.toThrow('late candidate failure');
    await closing;
    expect(controller.projection.getState()).toEqual({ status: 'closed' });
  });

  it('preserves ready authority when an active restore has no demand-plan resolver', async () => {
    const canonical = scenario();
    const plan = demandPlan();
    const activeState = createTransportSimulationState(canonical, 0, plan);
    const activeRecord = parseTransportSaveRecord({
      ...record(),
      saveId: 'active-without-resolver',
      sourceSimulationTick: activeState.tick,
      snapshot: createTransportSimulationSnapshot(activeState),
    });
    const current = createDirectTransportSimulationClient();
    const currentClose = vi.fn(() => current.close());
    const controller = createTransportApplicationController({
      createClient: () => Object.freeze({ ...current, close: currentClose }),
      repository: {
        get: async () => classifyPersistedSaveRecord(activeRecord),
        put: async () => undefined,
      },
      scenarioResolver: { resolve: async () => canonical },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('current-without-plan-resolver'),
      scenario: canonical,
    });

    await expect(
      controller.restore({
        saveId: 'active-without-resolver',
        timelineId: parseTimelineId('replacement-without-plan-resolver'),
      }),
    ).rejects.toThrow('Passenger demand plan resolver is unavailable.');
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'current-without-plan-resolver',
      message: 'Passenger demand plan resolver is unavailable.',
    });
    expect(currentClose).not.toHaveBeenCalled();

    await controller.close();
    expect(currentClose).toHaveBeenCalledOnce();
  });

  it('publishes the current command failure without replacing ready authority', async () => {
    const base = createDirectTransportSimulationClient();
    const controller = createTransportApplicationController({
      createClient: () =>
        Object.freeze({
          ...base,
          sendCommand: async () => {
            throw new Error('transport command failed');
          },
        }),
      repository: { get: async () => undefined, put: async () => undefined },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('command-failure'),
      scenario: scenario(),
    });

    await expect(controller.sendCommand({} as never)).rejects.toThrow(
      'transport command failed',
    );
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'command-failure',
      message: 'transport command failed',
    });

    await controller.close();
  });

  it('projects active passenger authority after a successful command', async () => {
    const canonical = scenario();
    const controller = createTransportApplicationController({
      createClient: createDirectTransportSimulationClient,
      repository: { get: async () => undefined, put: async () => undefined },
      scenarioResolver: { resolve: async () => canonical },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('active-command-projection'),
      scenario: canonical,
      passengerDemandPlan: demandPlan(),
    });

    await controller.sendCommand({
      kind: 'foundation-command',
      gameId: 'game-fixture',
      timelineId: 'active-command-projection',
      commandId: 'active-command',
      correlationId: 'active-command',
      clientId: 'transport-browser',
      sessionId: 'transport-session',
      command: { type: 'foundation.advance-ticks', count: 1 },
    } as never);
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      simulationTick: 1,
      passengerDemand: { status: 'active' },
      vehiclePassengerLoads: [],
    });

    await controller.close();
  });

  it.each(['send-command', 'advance-ticks'] as const)(
    'uses reliable authority without exporting a %s snapshot',
    async (operation) => {
      const base = createDirectTransportSimulationClient();
      const exported = vi.fn(() => base.exportSnapshot());
      const controller = createTransportApplicationController({
        createClient: () =>
          Object.freeze({
            ...base,
            exportSnapshot: exported,
          }),
        repository: { get: async () => undefined, put: async () => undefined },
        scenarioResolver: { resolve: async () => scenario() },
      });
      await controller.startNew({
        gameId: parseGameId('game-fixture'),
        timelineId: parseTimelineId(`stale-${operation}`),
        scenario: scenario(),
      });
      exported.mockClear();
      const pending =
        operation === 'send-command'
          ? controller.sendCommand({
              kind: 'foundation-command',
              gameId: 'game-fixture',
              timelineId: `stale-${operation}`,
              commandId: `stale-${operation}`,
              correlationId: `stale-${operation}`,
              clientId: 'transport-browser',
              sessionId: 'transport-session',
              command: { type: 'foundation.advance-ticks', count: 1 },
            } as never)
          : controller.advanceTicks(1);
      await pending;
      expect(exported).not.toHaveBeenCalled();
      expect(controller.projection.getState()).toMatchObject({
        status: 'ready',
        simulationTick: 1,
      });
      await controller.close();
    },
  );

  it('does not export an advancement result made stale while the command is pending', async () => {
    const base = createDirectTransportSimulationClient();
    let delayCommand = false;
    let enterCommand!: () => void;
    let releaseCommand!: () => void;
    const commandEntered = new Promise<void>((resolve) => {
      enterCommand = resolve;
    });
    const commandGate = new Promise<void>((resolve) => {
      releaseCommand = resolve;
    });
    const exported = vi.fn(() => base.exportSnapshot());
    const controller = createTransportApplicationController({
      createClient: () =>
        Object.freeze({
          ...base,
          async sendCommand(command: Parameters<typeof base.sendCommand>[0]) {
            if (delayCommand) {
              enterCommand();
              await commandGate;
            }
            return base.sendCommand(command);
          },
          exportSnapshot: exported,
        }),
      repository: { get: async () => undefined, put: async () => undefined },
      scenarioResolver: { resolve: async () => scenario() },
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('stale-advance-command'),
      scenario: scenario(),
    });
    exported.mockClear();
    delayCommand = true;
    const advancing = controller.advanceTicks(1);
    await commandEntered;
    const closing = controller.close();
    releaseCommand();
    await advancing;
    await closing;

    expect(exported).not.toHaveBeenCalled();
    expect(controller.projection.getState()).toEqual({ status: 'closed' });
  });

  it('publishes starting while new authority connection is pending', async () => {
    const base = createDirectTransportSimulationClient();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const controller = createTransportApplicationController({
      createClient: () =>
        Object.freeze({
          ...base,
          async connect(request: Parameters<typeof base.connect>[0]) {
            await gate;
            await base.connect(request);
          },
        }),
      repository: { get: async () => undefined, put: async () => undefined },
      scenarioResolver: { resolve: async () => scenario() },
    });

    const starting = controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('pending-start'),
      scenario: scenario(),
    });

    await vi.waitFor(() =>
      expect(controller.projection.getState()).toMatchObject({
        status: 'starting',
        timelineId: 'pending-start',
      }),
    );
    release();
    await starting;
    expect(controller.projection.getState()).toMatchObject({
      status: 'ready',
      timelineId: 'pending-start',
    });
    await controller.close();
  });

  it('keeps terminal close authoritative when restore teardown fails late', async () => {
    const current = createDirectTransportSimulationClient();
    const candidate = createDirectTransportSimulationClient();
    let creation = 0;
    let release!: () => void;
    let enterClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const closeEntered = new Promise<void>((resolve) => {
      enterClose = resolve;
    });
    let delayCurrentClose = false;
    let delayedCloseFailed = false;
    const controller = createTransportApplicationController({
      createClient: () => {
        const selected = ++creation === 1 ? current : candidate;
        const isCurrent = selected === current;
        return Object.freeze({
          ...selected,
          async close() {
            if (isCurrent && delayCurrentClose && !delayedCloseFailed) {
              delayedCloseFailed = true;
              enterClose();
              await closeGate;
              throw new Error('late authority teardown failed');
            }
            await selected.close();
          },
        });
      },
      repository: {
        get: async () => classifyPersistedSaveRecord(record()),
        put: async () => undefined,
      },
      scenarioResolver: { resolve: async () => scenario() },
    });
    const projections: Array<
      ReturnType<typeof controller.projection.getState>
    > = [];
    controller.projection.subscribe((projection) => {
      projections.push(projection);
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('teardown-current'),
      scenario: scenario(),
    });

    delayCurrentClose = true;
    const restoring = controller.restore({
      saveId: 'slot',
      timelineId: parseTimelineId('teardown-restored'),
    });
    await closeEntered;
    const closing = controller.close();
    release();

    await expect(restoring).rejects.toThrow('late authority teardown failed');
    await closing;

    expect(
      projections.some(
        (projection) =>
          projection.status === 'failed' &&
          projection.message === 'late authority teardown failed',
      ),
    ).toBe(false);
    expect(controller.projection.getState()).toEqual({ status: 'closed' });
  });

  it('suppresses a stale command rejection after close begins', async () => {
    const base = createDirectTransportSimulationClient();
    let delayCommand = false;
    let enterCommand!: () => void;
    let releaseCommand!: () => void;
    const commandEntered = new Promise<void>((resolve) => {
      enterCommand = resolve;
    });
    const commandGate = new Promise<void>((resolve) => {
      releaseCommand = resolve;
    });
    const controller = createTransportApplicationController({
      createClient: () =>
        Object.freeze({
          ...base,
          async sendCommand(command: Parameters<typeof base.sendCommand>[0]) {
            if (delayCommand) {
              enterCommand();
              await commandGate;
              throw new Error('late command failed');
            }
            return base.sendCommand(command);
          },
        }),
      repository: { get: async () => undefined, put: async () => undefined },
      scenarioResolver: { resolve: async () => scenario() },
    });
    const projections: Array<
      ReturnType<typeof controller.projection.getState>
    > = [];
    controller.projection.subscribe((projection) => {
      projections.push(projection);
    });
    await controller.startNew({
      gameId: parseGameId('game-fixture'),
      timelineId: parseTimelineId('stale-command-rejection'),
      scenario: scenario(),
    });

    delayCommand = true;
    const pending = controller.sendCommand({
      kind: 'foundation-command',
      gameId: 'game-fixture',
      timelineId: 'stale-command-rejection',
      commandId: 'stale-command-rejection',
      correlationId: 'stale-command-rejection',
      clientId: 'transport-browser',
      sessionId: 'transport-session',
      command: { type: 'foundation.advance-ticks', count: 1 },
    } as never);
    await commandEntered;
    const closing = controller.close();
    const rejected = expect(pending).rejects.toThrow('late command failed');
    releaseCommand();

    await rejected;
    await closing;

    expect(
      projections.some(
        (projection) =>
          'message' in projection &&
          projection.message === 'late command failed',
      ),
    ).toBe(false);
    expect(controller.projection.getState()).toEqual({ status: 'closed' });
  });
});
