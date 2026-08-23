import { describe, expect, it } from 'vitest';
import {
  parseScenarioPackage,
  type StopCatchmentResult,
} from '@torrevieja-tycoon/transport-domain';
import {
  advancePassengerDemandToTick,
  advancePassengerDemandToTickWithEvents,
  advanceTrustedPassengerDemandToTick,
  calculatePassengerAccessTicks,
  createInitialPassengerDemandState,
  createPassengerDemandPlan,
  createDisabledPassengerDemandState,
  parsePassengerDemandPlan,
  parsePassengerDemandProjection,
  parsePassengerOriginStopArrivalEvents,
  projectPassengerDemand,
  replaceTrustedPassengerDemandFields,
  validatePassengerDemandState,
  type PassengerOriginStopArrivalEvent,
} from './passenger-demand.js';
import {
  buildPassengerDirectItineraryPlan,
  createPassengerDirectItineraryRuntimeIndex,
} from './passenger-direct-itinerary.js';

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

const itineraryScenario = parseScenarioPackage({
  manifest: {
    schemaVersion: '1.0.0',
    scenarioId: 'fixture-scenario',
    scenarioVersion: '1.0.0',
    status: 'test-fixture',
    title: 'Demand fixture',
    primarySettlementId: 'city',
    settlementIds: ['city'],
    contentHash: 'a'.repeat(64),
    assets: {
      settlements: {
        path: 'settlements.json',
        required: true,
        sha256: '1'.repeat(64),
      },
      stops: {
        path: 'stops.json',
        required: true,
        sha256: '2'.repeat(64),
      },
      routes: {
        path: 'routes.json',
        required: true,
        sha256: '3'.repeat(64),
      },
    },
    graphContract: {
      vertexSource: 'stops.stopNodes',
      edgeDerivation: 'consecutive-stopNodeIds',
      closeLoopPolicy: 'add-last-to-first-only-when-closesLoop-is-true',
      reverseEdgePolicy: 'never-infer',
    },
  },
  settlements: {
    schemaVersion: '1.0.0',
    scenarioId: 'fixture-scenario',
    settlements: [
      {
        settlementId: 'city',
        name: 'City',
        countryCode: 'ES',
        adminArea: 'Fixture',
        center: { latitude: 10, longitude: 20 },
        bounds: { south: 9, west: 19, north: 11, east: 21 },
      },
    ],
  },
  stops: {
    schemaVersion: '1.0.0',
    scenarioId: 'fixture-scenario',
    stopPlaces: ['stop-a', 'stop-b'].map((stopPlaceId, index) => ({
      stopPlaceId,
      settlementId: 'city',
      name: stopPlaceId,
      position: { latitude: 10, longitude: 20 + index * 0.001 },
    })),
    stopNodes: ['stop-a', 'stop-b'].map((stopPlaceId, index) => ({
      stopNodeId: `node-${stopPlaceId}`,
      stopPlaceId,
      settlementId: 'city',
      name: stopPlaceId,
      position: { latitude: 10, longitude: 20 + index * 0.001 },
      sourceReferences: [],
      resolution: { status: 'fixture' },
    })),
  },
  routes: {
    schemaVersion: '1.0.0',
    scenarioId: 'fixture-scenario',
    routes: [
      {
        routeId: 'route',
        publicCode: 'R',
        name: 'Route',
        dataStatus: 'fixture',
        patterns: [
          {
            patternId: 'out',
            directionLabel: 'Out',
            closesLoop: false,
            stopNodeIds: ['node-stop-a', 'node-stop-b'],
          },
          {
            patternId: 'in',
            directionLabel: 'In',
            closesLoop: false,
            stopNodeIds: ['node-stop-b', 'node-stop-a'],
          },
        ],
      },
    ],
  },
});

const createItineraryIndex = () => {
  const demandPlan = createPlan();
  const plan = buildPassengerDirectItineraryPlan({
    scenario: itineraryScenario,
    demandPlan,
  });
  return createPassengerDirectItineraryRuntimeIndex({
    plan,
    scenario: itineraryScenario,
    demandPlan,
  });
};

it('keeps validated and package-internal trusted multi-tick demand equal', () => {
  const plan = createPlan();
  const itineraryIndex = createItineraryIndex();
  let validated = createInitialPassengerDemandState(plan, 0);
  let trusted = validated;
  if (validated.status !== 'active') throw new Error('Expected active demand.');
  for (const tick of [1, 3, 7, 12]) {
    validated = advancePassengerDemandToTick(
      plan,
      itineraryIndex,
      validated,
      tick,
    );
    trusted = advanceTrustedPassengerDemandToTick(
      plan,
      itineraryIndex,
      trusted,
      tick,
    );
    expect(trusted).toEqual(validated);
  }
});

type MutablePlan = {
  schemaVersion: string;
  demandModelContentHash: string;
  grid: {
    rows: number;
    columns: number;
    totalPopulationWeight: number;
  };
  emissionPolicy: { emissionCreditsPerWeightPerTick: number };
  accessPolicy: { accessTicksPerCell: number };
  cells: Array<{
    cellId?: string;
    row?: number;
    column?: number;
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
  it('structurally shares unchanged canonical StopPlace authority', () => {
    const plan = createPlan();
    const index = createItineraryIndex();
    const initial = createInitialPassengerDemandState(plan, 0);
    const unchanged = advanceTrustedPassengerDemandToTick(
      plan,
      index,
      initial,
      1,
    );
    expect(unchanged.stopArrivals).toBe(initial.stopArrivals);
    expect(unchanged.destinationCursors).toBe(initial.destinationCursors);

    const withArrival = replaceTrustedPassengerDemandFields(initial, {
      stopArrivals: [
        { stopPlaceId: 'stop-a', awaitingDestinationCount: 1 },
        initial.stopArrivals[1]!,
      ],
      totalEmittedPassengerCount: 1,
      servedEmittedPassengerCount: 1,
      totalArrivedAtStopPassengerCount: 1,
    });
    const consumed = advanceTrustedPassengerDemandToTick(
      plan,
      index,
      withArrival,
      1,
    );
    expect(consumed.stopArrivals).not.toBe(withArrival.stopArrivals);
    expect(consumed.stopArrivals[0]).not.toBe(withArrival.stopArrivals[0]);
    expect(consumed.stopArrivals[1]).toBe(withArrival.stopArrivals[1]);

    const beforeCursorChange = advanceTrustedPassengerDemandToTick(
      plan,
      index,
      unchanged,
      2,
    );
    const afterCursorChange = advanceTrustedPassengerDemandToTick(
      plan,
      index,
      beforeCursorChange,
      3,
    );
    expect(afterCursorChange.destinationCursors).not.toBe(
      beforeCursorChange.destinationCursors,
    );
    expect(afterCursorChange.destinationCursors[0]).not.toBe(
      beforeCursorChange.destinationCursors[0],
    );
    expect(afterCursorChange.destinationCursors[1]).toBe(
      beforeCursorChange.destinationCursors[1],
    );

    for (const authority of [
      consumed.stopArrivals,
      afterCursorChange.destinationCursors,
    ]) {
      expect(Object.isFrozen(authority)).toBe(true);
      expect(authority.every(Object.isFrozen)).toBe(true);
      expect(() => {
        (authority as unknown[]).pop();
      }).toThrow();
      const record = authority[0]! as unknown as Record<string, unknown>;
      const original = { ...record };
      expect(() => {
        record.stopPlaceId = 'changed';
      }).toThrow();
      expect(record).toEqual(original);
    }

    let current = initial;
    let reusedStopArrivalArrays = 0;
    let reusedCursorRecords = 0;
    let changedCursorRecords = 0;
    for (let tick = 1; tick <= 20; tick += 1) {
      const next = advanceTrustedPassengerDemandToTick(
        plan,
        index,
        current,
        tick,
      );
      if (next.stopArrivals === current.stopArrivals)
        reusedStopArrivalArrays += 1;
      for (let stop = 0; stop < plan.stops.length; stop += 1)
        if (next.destinationCursors[stop] === current.destinationCursors[stop])
          reusedCursorRecords += 1;
        else changedCursorRecords += 1;
      current = next;
    }
    expect(reusedStopArrivalArrays).toBe(20);
    expect({ reusedCursorRecords, changedCursorRecords }).toEqual({
      reusedCursorRecords: 12,
      changedCursorRecords: 28,
    });
  });

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

  it.each([
    [
      'cell identity',
      (plan: MutablePlan) => {
        plan.cells[0]!.cellId = 'r1c1';
      },
    ],
    [
      'row bounds',
      (plan: MutablePlan) => {
        plan.cells[0]!.row = plan.grid.rows;
        plan.cells[0]!.cellId = `r${plan.grid.rows}c0`;
      },
    ],
    [
      'column bounds',
      (plan: MutablePlan) => {
        plan.cells[0]!.column = plan.grid.columns;
        plan.cells[0]!.cellId = `r0c${plan.grid.columns}`;
      },
    ],
    [
      'duplicate coordinates',
      (plan: MutablePlan) => {
        plan.cells[1]!.row = plan.cells[0]!.row;
        plan.cells[1]!.column = plan.cells[0]!.column;
      },
    ],
  ])('rejects invalid plan-cell %s', (_name, mutate) => {
    const raw = structuredClone(createPlan()) as unknown as MutablePlan;
    mutate(raw);
    expect(() => parsePassengerDemandPlan(raw)).toThrow();
  });

  it('normalizes shuffled valid cells to identical row-major output', () => {
    const expected = createPlan();
    const shuffled = structuredClone(expected) as unknown as MutablePlan;
    shuffled.cells.reverse();
    expect(parsePassengerDemandPlan(shuffled)).toEqual(expected);
  });
});

describe('deterministic passenger emission and access', () => {
  it('strictly parses positive immutable origin-stop arrival evidence', () => {
    const parsed = parsePassengerOriginStopArrivalEvents([
      { tick: 3, stopPlaceId: 'stop-a', arrivedPassengerCount: 2 },
    ]);
    expect(parsed[0]).toMatchObject({
      tick: 3,
      stopPlaceId: 'stop-a',
      arrivedPassengerCount: 2,
    });
    expect(Object.isFrozen(parsed[0])).toBe(true);
    for (const value of [
      [{ tick: -1, stopPlaceId: 'stop-a', arrivedPassengerCount: 2 }],
      [{ tick: 3, stopPlaceId: '', arrivedPassengerCount: 2 }],
      [{ tick: 3, stopPlaceId: 'stop-a', arrivedPassengerCount: 0 }],
      [{ tick: 3, stopPlaceId: 'stop-a', arrivedPassengerCount: 2, extra: 1 }],
    ])
      expect(() => parsePassengerOriginStopArrivalEvents(value)).toThrow();
  });

  it('publishes immutable physical-stop arrivals across a batched interval', () => {
    const plan = createPlan();
    const index = createItineraryIndex();
    const initial = createInitialPassengerDemandState(plan, 0);
    const batch = advancePassengerDemandToTickWithEvents(
      plan,
      index,
      initial,
      10,
    );
    let splitState = initial;
    const splitEvents: PassengerOriginStopArrivalEvent[] = [];
    for (let tick = 1; tick <= 10; tick += 1) {
      const step = advancePassengerDemandToTickWithEvents(
        plan,
        index,
        splitState,
        tick,
      );
      splitState = step.state;
      splitEvents.push(...step.passengerOriginStopArrivalEvents);
    }
    expect(batch.state).toEqual(splitState);
    expect(batch.passengerOriginStopArrivalEvents).toEqual(splitEvents);
    expect(batch.passengerOriginStopArrivalEvents.length).toBeGreaterThan(0);
    expect(
      batch.passengerOriginStopArrivalEvents.every(
        (event) =>
          event.arrivedPassengerCount > 0 &&
          Number.isSafeInteger(event.arrivedPassengerCount),
      ),
    ).toBe(true);
    expect(Object.isFrozen(batch)).toBe(true);
    expect(Object.isFrozen(batch.passengerOriginStopArrivalEvents)).toBe(true);
    expect(Object.isFrozen(batch.passengerOriginStopArrivalEvents[0])).toBe(
      true,
    );
  });

  it('starts with zero credit and settles zero-distance emissions on their spawn tick', () => {
    const plan = createPlan();
    const initial = createInitialPassengerDemandState(plan, 0);
    expect(initial.cellCredits.every((cell) => cell.credit === 0)).toBe(true);
    const tick1 = advancePassengerDemandToTick(
      plan,
      createItineraryIndex(),
      initial,
      1,
    );
    expect(tick1.cellCredits.map((cell) => cell.credit)).toEqual([2, 4, 3, 1]);
    expect(tick1.totalEmittedPassengerCount).toBe(2);
    expect(tick1.servedEmittedPassengerCount).toBe(1);
    expect(tick1.unservedAtSourcePassengerCount).toBe(1);
    expect(tick1.totalArrivedAtStopPassengerCount).toBe(0);
    const tick3 = advancePassengerDemandToTick(
      plan,
      createItineraryIndex(),
      tick1,
      3,
    );
    expect(
      tick3.stopArrivals.find((stop) => stop.stopPlaceId === 'stop-a')
        ?.awaitingDestinationCount,
    ).toBe(0);
    expect(tick3.totalArrivedAtStopPassengerCount).toBeGreaterThan(0);
    expect(tick3.totalDestinationAssignedPassengerCount).toBeGreaterThan(0);
    expect(
      tick3.accessingGroups.every(
        (group) => group.arrivalTick > tick3.processedThroughTick,
      ),
    ).toBe(true);
  });

  it('uses exact integer distance bands and orders groups by arrival then ID', () => {
    const state = advancePassengerDemandToTick(
      createPlan(),
      createItineraryIndex(),
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

  it.each([
    [Number.NaN, 5, 1],
    [-1, 5, 1],
    [0, 0, 1],
    [0, 5, 0],
  ])(
    'rejects invalid passenger access timing input (%s, %s, %s)',
    (distanceSquaredCells, maximumDistanceCells, accessTicksPerCell) => {
      expect(() =>
        calculatePassengerAccessTicks(
          distanceSquaredCells,
          maximumDistanceCells,
          accessTicksPerCell,
        ),
      ).toThrow('Invalid passenger access timing input.');
    },
  );

  it('preserves remainders, emits groups by count, and conserves all totals', () => {
    const plan = createPlan();
    const state = advancePassengerDemandToTick(
      plan,
      createItineraryIndex(),
      createInitialPassengerDemandState(plan, 0),
      20,
    );
    expect(state.totalEmittedPassengerCount).toBe(80);
    expect(state.servedEmittedPassengerCount).toBe(56);
    expect(state.unservedAtSourcePassengerCount).toBe(24);
    expect(state.cellCredits.every((cell) => cell.credit === 0)).toBe(true);
    expect(
      validatePassengerDemandState(plan, createItineraryIndex(), state),
    ).toEqual(state);
    expect(Object.isFrozen(state.accessingGroups)).toBe(true);
    expect(Object.isFrozen(state.stopArrivals[0])).toBe(true);
    const projection = projectPassengerDemand(state);
    expect(projection.totalEmittedPassengerCount).toBe(80);
    expect(
      projection.inAccessPassengerCount +
        projection.totalAwaitingDestinationCount +
        projection.destinationUnavailableAtStopPassengerCount +
        projection.directItineraryUnavailablePassengerCount +
        projection.totalWaitingForVehiclePassengerCount,
    ).toBe(56);
  });

  it('is split/batch equivalent, repeatable, immutable, and rejects backward advancement', () => {
    const plan = createPlan();
    const initial = createInitialPassengerDemandState(plan, 0);
    const batch = advancePassengerDemandToTick(
      plan,
      createItineraryIndex(),
      initial,
      20,
    );
    const split = advancePassengerDemandToTick(
      plan,
      createItineraryIndex(),
      advancePassengerDemandToTick(plan, createItineraryIndex(), initial, 7),
      20,
    );
    expect(split).toEqual(batch);
    expect(
      advancePassengerDemandToTick(plan, createItineraryIndex(), batch, 20),
    ).toBe(batch);
    expect(() =>
      advancePassengerDemandToTick(plan, createItineraryIndex(), batch, 19),
    ).toThrow();
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
        createItineraryIndex(),
        initial,
        1,
      ),
    ).toThrow(/overflow/i);
    const corrupt = structuredClone(
      advancePassengerDemandToTick(plan, createItineraryIndex(), initial, 2),
    ) as unknown as MutablePassengerState;
    corrupt.totalEmittedPassengerCount += 1;
    expect(() =>
      validatePassengerDemandState(plan, createItineraryIndex(), corrupt),
    ).toThrow();
  });

  it('validates exact plan coordinates, cell/stop ordering, and projection variants', () => {
    const plan = createPlan();
    const active = advancePassengerDemandToTick(
      plan,
      createItineraryIndex(),
      createInitialPassengerDemandState(plan, 0),
      2,
    );
    expect(() =>
      validatePassengerDemandState(
        plan,
        createItineraryIndex(),
        createDisabledPassengerDemandState(),
      ),
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
      expect(() =>
        validatePassengerDemandState(plan, createItineraryIndex(), corrupt),
      ).toThrow();
    }
    expect(parsePassengerDemandProjection({ status: 'disabled' })).toEqual({
      status: 'disabled',
    });
    expect(
      parsePassengerDemandProjection(projectPassengerDemand(active)),
    ).toEqual(projectPassengerDemand(active));
    expect(
      projectPassengerDemand(createDisabledPassengerDemandState()),
    ).toEqual({ status: 'disabled' });
  });

  it('rejects incomplete destination cursors and non-canonical access-group order', () => {
    const plan = createPlan();
    const active = advancePassengerDemandToTick(
      plan,
      createItineraryIndex(),
      createInitialPassengerDemandState(plan, 0),
      2,
    );

    const missingCursor = structuredClone(active) as unknown as {
      destinationCursors: unknown[];
    };
    missingCursor.destinationCursors.pop();
    expect(() =>
      validatePassengerDemandState(plan, createItineraryIndex(), missingCursor),
    ).toThrow('Invalid destination cursors.');

    expect(active.accessingGroups.length).toBeGreaterThan(1);
    const nonCanonicalGroups = structuredClone(active) as unknown as {
      accessingGroups: unknown[];
    };
    nonCanonicalGroups.accessingGroups.reverse();
    expect(() =>
      validatePassengerDemandState(
        plan,
        createItineraryIndex(),
        nonCanonicalGroups,
      ),
    ).toThrow('Accessing passenger group order is non-canonical.');
  });

  it('merges bounded directional cohorts and rejects corrupted waiting authority', () => {
    const plan = createPlan();
    const active = advancePassengerDemandToTick(
      plan,
      createItineraryIndex(),
      createInitialPassengerDemandState(plan, 0),
      20,
    );
    expect(active.waitingCohorts.length).toBeGreaterThan(0);
    expect(
      active.waitingCohorts.some(
        (group) => group.firstAssignedTick < group.lastAssignedTick,
      ),
    ).toBe(true);
    expect(
      active.waitingCohorts.reduce((total, group) => total + group.count, 0),
    ).toBe(active.totalWaitingForVehiclePassengerCount);
    const corruptions = [
      (state: Record<string, unknown>) =>
        ((
          state.destinationCursors as Array<Record<string, unknown>>
        )[0]!.destinationCursor = Number.MAX_SAFE_INTEGER),
      (state: Record<string, unknown>) =>
        (state.nextPassengerWaitingCohortSequence = 1),
      (state: Record<string, unknown>) => {
        const groups = state.waitingCohorts as Array<Record<string, unknown>>;
        groups.push(structuredClone(groups[0]!));
      },
      (state: Record<string, unknown>) => {
        const groups = state.waitingCohorts as Array<Record<string, unknown>>;
        groups[0]!.destinationStopPlaceId = groups[0]!.originStopPlaceId;
      },
      (state: Record<string, unknown>) => {
        const groups = state.waitingCohorts as Array<Record<string, unknown>>;
        groups.reverse();
      },
      (state: Record<string, unknown>) =>
        ((state.totalDestinationAssignedPassengerCount as number) += 1),
    ];
    for (const mutate of corruptions) {
      const corrupt = structuredClone(active) as unknown as Record<
        string,
        unknown
      >;
      mutate(corrupt);
      expect(() =>
        validatePassengerDemandState(plan, createItineraryIndex(), corrupt),
      ).toThrow();
    }
  });

  it('consumes arrivals explicitly when an origin has no other-stop destination', () => {
    const raw = structuredClone(createPlan()) as unknown as MutablePlan;
    raw.cells[2]!.assignedStopPlaceId = 'stop-a';
    raw.stops = [{ stopPlaceId: 'stop-a' }];
    const oneStopPlan = parsePassengerDemandPlan(raw);
    const state = advancePassengerDemandToTick(
      oneStopPlan,
      buildPassengerDirectItineraryPlan({
        scenario: itineraryScenario,
        demandPlan: oneStopPlan,
      }),
      createInitialPassengerDemandState(oneStopPlan, 0),
      10,
    );
    expect(state.totalArrivedAtStopPassengerCount).toBeGreaterThan(0);
    expect(state.waitingCohorts).toEqual([]);
    expect(state.totalDestinationAssignedPassengerCount).toBe(0);
    expect(state.destinationUnavailableAtStopPassengerCount).toBe(
      state.totalArrivedAtStopPassengerCount,
    );
    expect(state.stopArrivals[0]?.awaitingDestinationCount).toBe(0);
    expect(state.destinationCursors).toEqual([
      { stopPlaceId: 'stop-a', destinationCursor: 0 },
    ]);
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
        createItineraryIndex(),
        createInitialPassengerDemandState(plan, 0),
        2,
      ),
    ) as unknown as MutablePassengerState;
    mutate(state);
    expect(() =>
      validatePassengerDemandState(plan, createItineraryIndex(), state),
    ).toThrow();
  });
});
