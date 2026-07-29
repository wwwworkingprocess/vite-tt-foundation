import { describe, expect, it } from 'vitest';
import type { StopCatchmentResult } from '@torrevieja-tycoon/transport-domain';
import {
  advancePassengerDemandToTick,
  createInitialPassengerDemandState,
  createPassengerDemandPlan,
  createDisabledPassengerDemandState,
  parsePassengerDemandPlan,
  parsePassengerDemandProjection,
  projectPassengerDemand,
  validatePassengerDemandState,
} from './passenger-demand.js';

const catchment = {
  scenario: {
    scenarioSchemaVersion: '1.0.0',
    scenarioId: 'fixture-scenario',
    scenarioVersion: '1.0.0',
    contentHash: 'a'.repeat(64),
  },
  catchmentPolicy: { maxAccessDistanceCells: 5 },
  grid: {
    cityId: 'Q36730',
    populationGridSchemaVersion: '1.0.0',
    gridVersion: '1.2.3',
    rows: 2,
    columns: 3,
    resolutionDegrees: 0.001,
    totalActiveCellCount: 4,
    totalPopulationWeight: 10,
  },
  cellAssignments: [
    {
      cellId: 'r0c0',
      row: 0,
      column: 0,
      center: { latitude: 10, longitude: 20 },
      populationWeight: 1,
      assignedStopPlaceId: 'stop-a',
      distanceSquaredCells: 0,
    },
    {
      cellId: 'r0c1',
      row: 0,
      column: 1,
      center: { latitude: 10, longitude: 20.001 },
      populationWeight: 2,
      assignedStopPlaceId: 'stop-a',
      distanceSquaredCells: 1,
    },
    {
      cellId: 'r1c0',
      row: 1,
      column: 0,
      center: { latitude: 9.999, longitude: 20 },
      populationWeight: 4,
      assignedStopPlaceId: 'stop-b',
      distanceSquaredCells: 1.000_000_01,
    },
    {
      cellId: 'r1c2',
      row: 1,
      column: 2,
      center: { latitude: 9.999, longitude: 20.002 },
      populationWeight: 3,
      assignedStopPlaceId: null,
      distanceSquaredCells: null,
    },
  ],
  stopSummaries: [
    {
      stopPlaceId: 'stop-a',
      assignedActiveCellCount: 2,
      assignedPopulationWeight: 3,
    },
    {
      stopPlaceId: 'stop-b',
      assignedActiveCellCount: 1,
      assignedPopulationWeight: 4,
    },
  ],
  coverage: {
    totalPopulationWeight: 10,
    servedPopulationWeight: 7,
    unservedPopulationWeight: 3,
    servedActiveCellCount: 3,
    unservedActiveCellCount: 1,
    coverageBasisPoints: 7000,
  },
} as unknown as StopCatchmentResult;

const createPlan = () =>
  createPassengerDemandPlan({
    catchment,
    demandModelContentHash: 'b'.repeat(64),
    emissionPolicy: {
      emissionCreditsPerWeightPerTick: 2,
      creditsPerPassenger: 5,
    },
    accessPolicy: { accessTicksPerCell: 3 },
  });

type MutablePlan = {
  schemaVersion: string;
  demandModelContentHash: string;
  grid: { totalPopulationWeight: number };
  emissionPolicy: { emissionCreditsPerWeightPerTick: number };
  accessPolicy: { accessTicksPerCell: number };
  cells: Array<{
    populationWeight: number;
    assignedStopPlaceId: string | null;
    distanceSquaredCells: number | null;
  }>;
  stops: Array<{ stopPlaceId: string }>;
  extra?: boolean;
};
type MutablePassengerState = {
  totalEmittedPassengerCount: number;
  nextPassengerGroupSequence: number;
  accessingGroups: Array<{
    passengerGroupId: string;
    spawnTick: number;
    arrivalTick: number;
  }>;
};

describe('Passenger Demand Plan V1', () => {
  it('normalizes exact identity, cells, stops, policies, and deeply freezes values', () => {
    const plan = createPlan();
    expect(plan).toMatchObject({
      schemaVersion: '1.0.0',
      demandModelContentHash: 'b'.repeat(64),
      scenario: catchment.scenario,
      grid: catchment.grid,
      catchmentPolicy: { maxAccessDistanceCells: 5 },
      emissionPolicy: {
        emissionCreditsPerWeightPerTick: 2,
        creditsPerPassenger: 5,
      },
      accessPolicy: { accessTicksPerCell: 3 },
    });
    expect(plan.cells.map((cell) => cell.cellId)).toEqual([
      'r0c0',
      'r0c1',
      'r1c0',
      'r1c2',
    ]);
    expect(plan.stops.map((stop) => stop.stopPlaceId)).toEqual([
      'stop-a',
      'stop-b',
    ]);
    expect(Object.isFrozen(plan.cells[0])).toBe(true);
    expect(Object.isFrozen(plan.scenario)).toBe(true);
  });

  it.each([
    ['schema', (plan: MutablePlan) => (plan.schemaVersion = '2.0.0')],
    ['hash', (plan: MutablePlan) => (plan.demandModelContentHash = 'ABC')],
    ['duplicate cell', (plan: MutablePlan) => plan.cells.push(plan.cells[0]!)],
    ['duplicate stop', (plan: MutablePlan) => plan.stops.push(plan.stops[0]!)],
    [
      'served without distance',
      (plan: MutablePlan) => (plan.cells[0]!.distanceSquaredCells = null),
    ],
    [
      'unknown stop',
      (plan: MutablePlan) => (plan.cells[0]!.assignedStopPlaceId = 'missing'),
    ],
    [
      'unserved with distance',
      (plan: MutablePlan) => (plan.cells[3]!.distanceSquaredCells = 1),
    ],
    [
      'distance beyond catchment',
      (plan: MutablePlan) => (plan.cells[0]!.distanceSquaredCells = 26),
    ],
    [
      'zero weight',
      (plan: MutablePlan) => (plan.cells[0]!.populationWeight = 0),
    ],
    [
      'emission policy',
      (plan: MutablePlan) =>
        (plan.emissionPolicy.emissionCreditsPerWeightPerTick = 0),
    ],
    [
      'access policy',
      (plan: MutablePlan) => (plan.accessPolicy.accessTicksPerCell = 0),
    ],
    ['unknown field', (plan: MutablePlan) => (plan.extra = true)],
  ])('rejects malformed plan: %s', (_name, mutate) => {
    const raw = structuredClone(createPlan()) as unknown as MutablePlan;
    mutate(raw);
    expect(() => parsePassengerDemandPlan(raw)).toThrow();
  });

  it('rejects a catchment with a mismatched or non-conserved scenario model', () => {
    const wrong = structuredClone(catchment) as unknown as StopCatchmentResult;
    const mutableWrong = wrong as unknown as {
      grid: { totalPopulationWeight: number };
    };
    mutableWrong.grid.totalPopulationWeight = 11;
    expect(() =>
      createPassengerDemandPlan({
        catchment: mutableWrong as unknown as StopCatchmentResult,
        demandModelContentHash: 'b'.repeat(64),
        emissionPolicy: {
          emissionCreditsPerWeightPerTick: 2,
          creditsPerPassenger: 5,
        },
        accessPolicy: { accessTicksPerCell: 3 },
      }),
    ).toThrow();
  });

  it('rejects plan total overflow before exposing a plan', () => {
    const raw = structuredClone(createPlan()) as unknown as MutablePlan;
    raw.cells[0]!.populationWeight = Number.MAX_SAFE_INTEGER;
    raw.cells[1]!.populationWeight = Number.MAX_SAFE_INTEGER;
    raw.grid.totalPopulationWeight = Number.MAX_SAFE_INTEGER;
    expect(() => parsePassengerDemandPlan(raw)).toThrow(/overflow/i);
  });
});

describe('deterministic passenger emission and access', () => {
  it('starts with zero credit and settles zero-distance emissions on their spawn tick', () => {
    const plan = createPlan();
    const initial = createInitialPassengerDemandState(plan, 0);
    expect(initial.cellCredits.every((cell) => cell.credit === 0)).toBe(true);
    const tick1 = advancePassengerDemandToTick(plan, initial, 1);
    expect(tick1.cellCredits.map((cell) => cell.credit)).toEqual([2, 4, 3, 1]);
    expect(tick1.totalEmittedPassengerCount).toBe(2);
    expect(tick1.servedEmittedPassengerCount).toBe(1);
    expect(tick1.unservedAtSourcePassengerCount).toBe(1);
    expect(tick1.totalArrivedAtStopPassengerCount).toBe(0);
    const tick3 = advancePassengerDemandToTick(plan, tick1, 3);
    expect(
      tick3.stopArrivals.find((stop) => stop.stopPlaceId === 'stop-a')
        ?.awaitingDestinationCount,
    ).toBeGreaterThan(0);
    expect(tick3.totalArrivedAtStopPassengerCount).toBeGreaterThan(0);
    expect(
      tick3.accessingGroups.every(
        (group) => group.arrivalTick > tick3.processedThroughTick,
      ),
    ).toBe(true);
  });

  it('uses exact integer distance bands and orders groups by arrival then ID', () => {
    const state = advancePassengerDemandToTick(
      createPlan(),
      createInitialPassengerDemandState(createPlan(), 0),
      2,
    );
    expect(
      state.accessingGroups.map((group) => ({
        cellId: group.cellId,
        spawnTick: group.spawnTick,
        arrivalTick: group.arrivalTick,
      })),
    ).toContainEqual({ cellId: 'r0c1', spawnTick: 2, arrivalTick: 5 });
    expect(
      state.accessingGroups.map((group) => ({
        cellId: group.cellId,
        spawnTick: group.spawnTick,
        arrivalTick: group.arrivalTick,
      })),
    ).toContainEqual({ cellId: 'r1c0', spawnTick: 1, arrivalTick: 7 });
  });

  it('preserves remainders, emits groups by count, and conserves all totals', () => {
    const plan = createPlan();
    const state = advancePassengerDemandToTick(
      plan,
      createInitialPassengerDemandState(plan, 0),
      20,
    );
    expect(state.totalEmittedPassengerCount).toBe(80);
    expect(state.servedEmittedPassengerCount).toBe(56);
    expect(state.unservedAtSourcePassengerCount).toBe(24);
    expect(state.cellCredits.every((cell) => cell.credit === 0)).toBe(true);
    expect(validatePassengerDemandState(plan, state)).toEqual(state);
    expect(Object.isFrozen(state.accessingGroups)).toBe(true);
    expect(Object.isFrozen(state.stopArrivals[0])).toBe(true);
    const projection = projectPassengerDemand(state);
    expect(projection.totalEmittedPassengerCount).toBe(80);
    expect(
      projection.inAccessPassengerCount +
        projection.totalAwaitingDestinationCount,
    ).toBe(56);
  });

  it('is split/batch equivalent, repeatable, immutable, and rejects backward advancement', () => {
    const plan = createPlan();
    const initial = createInitialPassengerDemandState(plan, 0);
    const batch = advancePassengerDemandToTick(plan, initial, 20);
    const split = advancePassengerDemandToTick(
      plan,
      advancePassengerDemandToTick(plan, initial, 7),
      20,
    );
    expect(split).toEqual(batch);
    expect(advancePassengerDemandToTick(plan, batch, 20)).toBe(batch);
    expect(() => advancePassengerDemandToTick(plan, batch, 19)).toThrow();
    expect(initial).toEqual(createInitialPassengerDemandState(plan, 0));
  });

  it('rejects overflow and corrupted conservation or references', () => {
    const plan = createPlan();
    const initial = createInitialPassengerDemandState(plan, 0);
    const overflowPlan = structuredClone(plan) as unknown as MutablePlan;
    overflowPlan.cells[0]!.populationWeight = Number.MAX_SAFE_INTEGER;
    overflowPlan.grid.totalPopulationWeight = Number.MAX_SAFE_INTEGER;
    expect(() =>
      advancePassengerDemandToTick(
        parsePassengerDemandPlan(overflowPlan),
        initial,
        1,
      ),
    ).toThrow(/overflow/i);
    const corrupt = structuredClone(
      advancePassengerDemandToTick(plan, initial, 2),
    ) as unknown as MutablePassengerState;
    corrupt.totalEmittedPassengerCount += 1;
    expect(() => validatePassengerDemandState(plan, corrupt)).toThrow();
  });

  it('validates exact plan coordinates, cell/stop ordering, and projection variants', () => {
    const plan = createPlan();
    const active = advancePassengerDemandToTick(
      plan,
      createInitialPassengerDemandState(plan, 0),
      2,
    );
    expect(() =>
      validatePassengerDemandState(plan, createDisabledPassengerDemandState()),
    ).toThrow(/active/i);
    for (const mutate of [
      (state: Record<string, unknown>) => {
        const coordinate = state.demandPlanCoordinate as {
          scenario: { contentHash: string };
        };
        coordinate.scenario.contentHash = 'c'.repeat(64);
      },
      (state: Record<string, unknown>) => {
        const coordinate = state.demandPlanCoordinate as {
          grid: { gridVersion: string };
        };
        coordinate.grid.gridVersion = '2.0.0';
      },
      (state: Record<string, unknown>) => {
        const coordinate = state.demandPlanCoordinate as {
          accessPolicy: { accessTicksPerCell: number };
        };
        coordinate.accessPolicy.accessTicksPerCell = 4;
      },
      (state: Record<string, unknown>) => {
        (state.cellCredits as unknown[]).pop();
      },
      (state: Record<string, unknown>) => {
        (state.stopArrivals as unknown[]).pop();
      },
    ]) {
      const corrupt = structuredClone(active) as unknown as Record<
        string,
        unknown
      >;
      mutate(corrupt);
      expect(() => validatePassengerDemandState(plan, corrupt)).toThrow();
    }
    expect(parsePassengerDemandProjection({ status: 'disabled' })).toEqual({
      status: 'disabled',
    });
    expect(
      parsePassengerDemandProjection(projectPassengerDemand(active)),
    ).toEqual(projectPassengerDemand(active));
  });

  it.each([
    [
      'future spawn',
      (state: MutablePassengerState) =>
        (state.accessingGroups[0]!.spawnTick = 99),
    ],
    [
      'invalid group sequence',
      (state: MutablePassengerState) => (state.nextPassengerGroupSequence = 1),
    ],
    [
      'arrival before spawn',
      (state: MutablePassengerState) => {
        state.accessingGroups[0]!.spawnTick = 2;
        state.accessingGroups[0]!.arrivalTick = 1;
      },
    ],
  ])('rejects corrupted passenger-group state: %s', (_name, mutate) => {
    const plan = createPlan();
    const state = structuredClone(
      advancePassengerDemandToTick(
        plan,
        createInitialPassengerDemandState(plan, 0),
        2,
      ),
    ) as unknown as MutablePassengerState;
    mutate(state);
    expect(() => validatePassengerDemandState(plan, state)).toThrow();
  });
});
