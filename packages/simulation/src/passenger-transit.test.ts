import { describe, expect, it } from 'vitest';
import {
  advancePassengerDestinationAccessToTick,
  calculatePassengerAccessTicks,
  comparePassengerDestinationAccessGroups,
  createVehiclePassengerCapacity,
  processPassengerTransitAtVehicleCalls,
  parseWaitingGenerationLineageWatermarks,
  validatePassengerTransitCollections,
  validatePassengerTransitReplay,
  type PassengerTransitInput,
} from './index.js';

const onboard = (overrides: Record<string, unknown> = {}) => ({
  passengerOnboardGroupId: 'passenger-onboard-group-1',
  sourceWaitingCohortId: 'passenger-waiting-cohort-1',
  vehicleId: 'bus-1',
  routeId: 'route-a',
  patternId: 'pattern-a',
  originStopPlaceId: 'place-origin',
  originStopNodeId: 'node-origin',
  originOccurrenceIndex: 0,
  destinationCellId: 'r1c1',
  destinationStopPlaceId: 'place-destination',
  destinationStopNodeId: 'node-destination',
  destinationOccurrenceIndex: 2,
  wrapsPatternEnd: false,
  edgeCount: 2,
  boardedAtTick: 4,
  boardedAtPatternRunSequence: 1,
  alightAtPatternRunSequence: 1,
  boardedAtStopCallSequence: 1,
  count: 6,
  firstAssignedTick: 2,
  lastAssignedTick: 3,
  ...overrides,
});

const call = (overrides: Record<string, unknown> = {}) => ({
  vehicleId: 'bus-1',
  stopCallSequence: 3,
  patternRunSequence: 1,
  routeId: 'route-a',
  patternId: 'pattern-a',
  stopNodeId: 'node-destination',
  occurrenceIndex: 2,
  tick: 7,
  ...overrides,
});

const plan = {
  accessPolicy: { accessTicksPerCell: 2 },
  catchmentPolicy: { maxAccessDistanceCells: 5 },
  cells: [
    {
      cellId: 'r1c1',
      row: 1,
      column: 1,
      populationWeight: 1,
      assignedStopPlaceId: 'place-destination',
      distanceSquaredCells: 2.25,
    },
  ],
};

const input = (
  overrides: Partial<PassengerTransitInput> = {},
): PassengerTransitInput => ({
  tick: 7 as PassengerTransitInput['tick'],
  demandPlan: plan as PassengerTransitInput['demandPlan'],
  waitingCohorts: [],
  waitingGenerationLineageWatermarks: [
    {
      passengerWaitingCohortKey:
        'place-origin\u0000node-origin\u0000route-a\u0000pattern-a\u00000\u0000r1c1\u0000place-destination\u0000node-destination\u00002',
      passengerWaitingCohortId: 'passenger-waiting-cohort-1',
      originStopPlaceId: 'place-origin',
      originStopNodeId: 'node-origin',
      routeId: 'route-a',
      patternId: 'pattern-a',
      originOccurrenceIndex: 0,
      destinationCellId: 'r1c1',
      destinationStopPlaceId: 'place-destination',
      destinationStopNodeId: 'node-destination',
      destinationOccurrenceIndex: 2,
      wrapsPatternEnd: false,
      edgeCount: 2,
      firstAssignedTick: 2,
      lastAssignedTick: 3,
      earliestBoardedAtTick: 4,
    },
  ] as PassengerTransitInput['waitingGenerationLineageWatermarks'],
  onboardGroups: [onboard()] as PassengerTransitInput['onboardGroups'],
  destinationAccessGroups: [],
  nextPassengerOnboardGroupSequence: 2,
  nextPassengerDestinationAccessGroupSequence: 1,
  totalWaitingForVehiclePassengerCount: 0,
  totalBoardedPassengerCount: 6,
  totalOnboardPassengerCount: 6,
  totalAlightedPassengerCount: 0,
  totalInDestinationAccessPassengerCount: 0,
  totalCompletedJourneyPassengerCount: 0,
  capacities: [createVehiclePassengerCapacity('bus-1', 6)],
  vehicleOperations: [
    {
      vehicleId: 'bus-1',
      patternRunSequence: 1,
      patternRunStartedAtTick: 0,
      movementStartedAtTick: 0,
      stopCallSequence: 3,
    },
  ] as PassengerTransitInput['vehicleOperations'],
  currentStopCalls: [call()] as PassengerTransitInput['currentStopCalls'],
  itineraryIsValid: () => true,
  ...overrides,
});

describe('deterministic passenger alighting and destination access', () => {
  it('alights only at the exact canonical destination call', () => {
    const source = input();
    const result = processPassengerTransitAtVehicleCalls(source);
    expect(result.onboardGroups).toEqual([]);
    expect(result.totalOnboardPassengerCount).toBe(0);
    expect(result.totalAlightedPassengerCount).toBe(6);
    expect(result.totalInDestinationAccessPassengerCount).toBe(6);
    expect(result.currentAlightingEvents).toEqual([
      expect.objectContaining({
        vehicleId: 'bus-1',
        alightedPassengerCount: 6,
        onboardPassengerCountAfterAlighting: 0,
        remainingCapacityAfterAlighting: 6,
        sourceOnboardGroupIds: ['passenger-onboard-group-1'],
      }),
    ]);
    expect(result.destinationAccessGroups).toEqual([
      expect.objectContaining({
        passengerDestinationAccessGroupId:
          'passenger-destination-access-group-1',
        sourceOnboardGroupId: 'passenger-onboard-group-1',
        alightedAtTick: 7,
        destinationAccessTicks: 4,
        completionTick: 11,
        count: 6,
      }),
    ]);
    expect(source.onboardGroups).toHaveLength(1);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.destinationAccessGroups[0])).toBe(true);
  });

  it.each([
    ['vehicle', { vehicleId: 'bus-2' }],
    ['route', { routeId: 'route-b' }],
    ['pattern', { patternId: 'pattern-b' }],
    ['StopNode', { stopNodeId: 'node-other' }],
    ['occurrence', { occurrenceIndex: 1 }],
    ['pattern run', { patternRunSequence: 2 }],
    ['call sequence', { stopCallSequence: 1 }],
  ])('does not alight for a wrong %s identity', (_name, changed) => {
    const callValue = call(changed);
    const vehicleId = callValue.vehicleId as string;
    const patternRunSequence = callValue.patternRunSequence as number;
    const result = processPassengerTransitAtVehicleCalls(
      input({
        capacities: [createVehiclePassengerCapacity(vehicleId, 6)],
        vehicleOperations: [
          {
            vehicleId,
            patternRunSequence,
            patternRunStartedAtTick: 0,
            movementStartedAtTick: 0,
            stopCallSequence: callValue.stopCallSequence,
          },
        ] as PassengerTransitInput['vehicleOperations'],
        currentStopCalls: [
          callValue,
        ] as PassengerTransitInput['currentStopCalls'],
      }),
    );
    expect(result.onboardGroups).toHaveLength(1);
    expect(result.currentAlightingEvents).toEqual([]);
  });

  it('uses the shared angular-grid access duration and completes exactly', () => {
    expect(calculatePassengerAccessTicks(2.25, 5, 2)).toBe(4);
    const alighted = processPassengerTransitAtVehicleCalls(input());
    const before = advancePassengerDestinationAccessToTick({
      tick: 10,
      destinationAccessGroups: alighted.destinationAccessGroups,
      totalCompletedJourneyPassengerCount: 0,
    });
    expect(before.destinationAccessGroups).toHaveLength(1);
    expect(before.currentJourneyCompletionEvents).toEqual([]);
    const complete = advancePassengerDestinationAccessToTick({
      tick: 11,
      destinationAccessGroups: before.destinationAccessGroups,
      totalCompletedJourneyPassengerCount: 0,
    });
    expect(complete.destinationAccessGroups).toEqual([]);
    expect(complete.totalCompletedJourneyPassengerCount).toBe(6);
    expect(complete.currentJourneyCompletionEvents).toEqual([
      expect.objectContaining({
        completedAtTick: 11,
        count: 6,
        minimumAssignmentToCompletionTicks: 8,
        maximumAssignmentToCompletionTicks: 9,
        inVehicleTicks: 3,
      }),
    ]);
  });

  it('completes zero-distance access on the alighting tick', () => {
    const zero = structuredClone(plan);
    zero.cells[0]!.distanceSquaredCells = 0;
    const result = processPassengerTransitAtVehicleCalls(
      input({ demandPlan: zero as PassengerTransitInput['demandPlan'] }),
    );
    expect(result.destinationAccessGroups).toEqual([]);
    expect(result.totalCompletedJourneyPassengerCount).toBe(6);
    expect(result.currentJourneyCompletionEvents).toHaveLength(1);
  });

  it('releases capacity before boarding at the same canonical call', () => {
    const waiting = {
      passengerWaitingCohortId: 'passenger-waiting-cohort-2',
      originStopPlaceId: 'place-destination',
      originStopNodeId: 'node-destination',
      routeId: 'route-a',
      patternId: 'pattern-a',
      originOccurrenceIndex: 2,
      destinationCellId: 'r1c1',
      destinationStopPlaceId: 'place-destination',
      destinationStopNodeId: 'node-destination',
      destinationOccurrenceIndex: 2,
      wrapsPatternEnd: true,
      edgeCount: 2,
      count: 3,
      firstAssignedTick: 5,
      lastAssignedTick: 6,
    } as const;
    const result = processPassengerTransitAtVehicleCalls(
      input({
        waitingCohorts: [waiting] as PassengerTransitInput['waitingCohorts'],
        nextPassengerOnboardGroupSequence: 2,
        totalWaitingForVehiclePassengerCount: 3,
      }),
    );
    expect(result.currentAlightingEvents[0]?.alightedPassengerCount).toBe(6);
    expect(result.currentBoardingEvents[0]?.boardedPassengerCount).toBe(3);
    expect(result.onboardGroups).toEqual([
      expect.objectContaining({
        passengerOnboardGroupId: 'passenger-onboard-group-2',
        sourceWaitingCohortId: 'passenger-waiting-cohort-2',
        count: 3,
      }),
    ]);
    expect(result.totalBoardedPassengerCount).toBe(9);
    expect(result.totalOnboardPassengerCount).toBe(3);
  });

  it('orders simultaneous alighting by numeric onboard identity', () => {
    const groups = [
      onboard({
        passengerOnboardGroupId: 'passenger-onboard-group-10',
        count: 2,
      }),
      onboard({
        passengerOnboardGroupId: 'passenger-onboard-group-2',
        count: 4,
      }),
    ] as PassengerTransitInput['onboardGroups'];
    const result = processPassengerTransitAtVehicleCalls(
      input({ onboardGroups: groups, nextPassengerOnboardGroupSequence: 11 }),
    );
    expect(result.currentAlightingEvents[0]?.sourceOnboardGroupIds).toEqual([
      'passenger-onboard-group-2',
      'passenger-onboard-group-10',
    ]);
    expect(
      result.destinationAccessGroups.map((group) => group.sourceOnboardGroupId),
    ).toEqual(['passenger-onboard-group-2', 'passenger-onboard-group-10']);
  });

  it('validates access authority and replays truthful bounded events', () => {
    const result = processPassengerTransitAtVehicleCalls(input());
    const authority = { ...input(), ...result };
    expect(() =>
      validatePassengerTransitCollections({
        ...authority,
        nextPassengerWaitingCohortSequence: 2,
      }),
    ).not.toThrow();
    expect(() => validatePassengerTransitReplay(authority)).not.toThrow();
    expect(() =>
      validatePassengerTransitReplay({
        ...authority,
        currentAlightingEvents: [],
      }),
    ).toThrow('not canonical');
    expect(() =>
      advancePassengerDestinationAccessToTick({
        tick: 12,
        destinationAccessGroups: result.destinationAccessGroups,
        totalCompletedJourneyPassengerCount: 0,
      }),
    ).toThrow('Overdue');
    expect(
      advancePassengerDestinationAccessToTick({
        tick: 12,
        destinationAccessGroups: [],
        totalCompletedJourneyPassengerCount: 6,
      }).currentJourneyCompletionEvents,
    ).toEqual([]);
  });

  it('replays same-vehicle onboard authority in destination order, not issuance order', () => {
    const laterDestination = onboard({
      passengerOnboardGroupId: 'passenger-onboard-group-1',
      destinationOccurrenceIndex: 2,
      count: 2,
    });
    const earlierDestination = onboard({
      passengerOnboardGroupId: 'passenger-onboard-group-2',
      sourceWaitingCohortId: 'passenger-waiting-cohort-2',
      destinationOccurrenceIndex: 1,
      edgeCount: 1,
      count: 3,
    });
    expect(() =>
      validatePassengerTransitReplay({
        ...input(),
        tick: 8 as never,
        onboardGroups: [earlierDestination, laterDestination] as never,
        nextPassengerOnboardGroupSequence: 3,
        totalBoardedPassengerCount: 5,
        totalOnboardPassengerCount: 5,
        currentStopCalls: [],
        currentAlightingEvents: [],
        currentBoardingEvents: [],
        currentJourneyCompletionEvents: [],
      }),
    ).not.toThrow();
  });

  it('accepts historical onboard ID gaps and rejects duplicate lifecycle ownership', () => {
    const activeWithGap = onboard({
      passengerOnboardGroupId: 'passenger-onboard-group-2',
    });
    expect(() =>
      validatePassengerTransitReplay({
        ...input(),
        tick: 8 as never,
        onboardGroups: [activeWithGap] as never,
        nextPassengerOnboardGroupSequence: 3,
        totalBoardedPassengerCount: 7,
        totalAlightedPassengerCount: 1,
        totalCompletedJourneyPassengerCount: 1,
        currentStopCalls: [],
        currentAlightingEvents: [],
        currentBoardingEvents: [],
        currentJourneyCompletionEvents: [],
      }),
    ).not.toThrow();

    const result = processPassengerTransitAtVehicleCalls(input());
    expect(() =>
      validatePassengerTransitReplay({
        ...input(),
        ...result,
        onboardGroups: [onboard()] as never,
        totalOnboardPassengerCount: 6,
      }),
    ).toThrow(/lifecycle ownership/i);
  });

  it('orders destination access through every canonical tie-breaker', () => {
    const result = processPassengerTransitAtVehicleCalls(input());
    const base = result.destinationAccessGroups[0]!;
    expect(
      comparePassengerDestinationAccessGroups(base, {
        ...base,
        completionTick: 12 as never,
      }),
    ).toBeLessThan(0);
    expect(
      comparePassengerDestinationAccessGroups(base, {
        ...base,
        destinationCellId: 'r2c1' as never,
      }),
    ).toBeLessThan(0);
    expect(
      comparePassengerDestinationAccessGroups(base, {
        ...base,
        destinationCellId: 'r1c2' as never,
      }),
    ).toBeLessThan(0);
    expect(
      comparePassengerDestinationAccessGroups(base, {
        ...base,
        sourceOnboardGroupId: 'passenger-onboard-group-2' as never,
      }),
    ).toBeLessThan(0);
    expect(
      comparePassengerDestinationAccessGroups(base, {
        ...base,
        passengerDestinationAccessGroupId:
          'passenger-destination-access-group-2' as never,
      }),
    ).toBeLessThan(0);
    expect(
      parseWaitingGenerationLineageWatermarks(
        input().waitingGenerationLineageWatermarks,
      ),
    ).toEqual(input().waitingGenerationLineageWatermarks);
  });

  it('rejects malformed access and lineage collection authority', () => {
    const result = processPassengerTransitAtVehicleCalls(input());
    const base = {
      ...input(),
      ...result,
      nextPassengerWaitingCohortSequence: 2,
    };
    const corruptions: Array<(value: typeof base) => void> = [
      (value) => {
        value.destinationAccessGroups = [
          value.destinationAccessGroups[0]!,
          value.destinationAccessGroups[0]!,
        ];
      },
      (value) => {
        value.destinationAccessGroups[0] = {
          ...value.destinationAccessGroups[0]!,
          completionTick: 7 as never,
        };
      },
      (value) => {
        value.destinationAccessGroups[0] = {
          ...value.destinationAccessGroups[0]!,
          destinationAccessTicks: 3,
        };
      },
      (value) => {
        value.destinationAccessGroups[0] = {
          ...value.destinationAccessGroups[0]!,
          destinationCellId: 'r9c9' as never,
        };
      },
      (value) => {
        value.waitingGenerationLineageWatermarks[0] = {
          ...value.waitingGenerationLineageWatermarks[0]!,
          passengerWaitingCohortKey: 'wrong',
        };
      },
      (value) => {
        value.waitingGenerationLineageWatermarks[0] = {
          ...value.waitingGenerationLineageWatermarks[0]!,
          earliestBoardedAtTick: 1 as never,
        };
      },
      (value) => {
        value.waitingGenerationLineageWatermarks = [];
      },
      (value) => {
        value.onboardGroups = [onboard()] as never;
      },
      (value) => {
        value.destinationAccessGroups[0] = {
          ...value.destinationAccessGroups[0]!,
          sourceOnboardGroupId: 'passenger-onboard-group-2' as never,
        };
        value.nextPassengerOnboardGroupSequence = 2;
      },
    ];
    for (const corrupt of corruptions) {
      const { itineraryIsValid, ...data } = base;
      const value = { ...structuredClone(data), itineraryIsValid };
      corrupt(value);
      expect(() => validatePassengerTransitCollections(value)).toThrow();
    }
  });

  it('rejects non-current calls, invalid itineraries, and invalid cells', () => {
    expect(() =>
      processPassengerTransitAtVehicleCalls(
        input({ currentStopCalls: [call({ tick: 8 })] as never }),
      ),
    ).toThrow('Invalid current passenger transit call');
    expect(
      processPassengerTransitAtVehicleCalls(
        input({ currentStopCalls: [call({ routeId: null })] as never }),
      ).currentAlightingEvents,
    ).toEqual([]);
    expect(() =>
      processPassengerTransitAtVehicleCalls(
        input({ itineraryIsValid: () => false }),
      ),
    ).toThrow('Invalid onboard passenger itinerary');
    const wrongPlan = structuredClone(plan);
    wrongPlan.cells[0]!.assignedStopPlaceId = 'another-place';
    expect(() =>
      processPassengerTransitAtVehicleCalls(
        input({ demandPlan: wrongPlan as never }),
      ),
    ).toThrow('Invalid destination access cell');
  });

  it('replays immediate and previously alighted destination completions', () => {
    const zeroPlan = structuredClone(plan);
    zeroPlan.cells[0]!.distanceSquaredCells = 0;
    const zeroInput = input({ demandPlan: zeroPlan as never });
    const zero = processPassengerTransitAtVehicleCalls(zeroInput);
    expect(() =>
      validatePassengerTransitReplay({ ...zeroInput, ...zero }),
    ).not.toThrow();

    const alighted = processPassengerTransitAtVehicleCalls(input());
    const completed = advancePassengerDestinationAccessToTick({
      tick: 11,
      destinationAccessGroups: alighted.destinationAccessGroups,
      totalCompletedJourneyPassengerCount: 0,
    });
    expect(() =>
      validatePassengerTransitReplay({
        ...input(),
        tick: 11 as never,
        onboardGroups: [],
        destinationAccessGroups: completed.destinationAccessGroups,
        totalOnboardPassengerCount: 0,
        totalAlightedPassengerCount: 6,
        totalInDestinationAccessPassengerCount: 0,
        totalCompletedJourneyPassengerCount: 6,
        currentStopCalls: [],
        currentAlightingEvents: [],
        currentBoardingEvents: [],
        currentJourneyCompletionEvents:
          completed.currentJourneyCompletionEvents,
      }),
    ).not.toThrow();
  });

  it('updates one lineage watermark across multiple same-tick boardings', () => {
    const waiting = {
      passengerWaitingCohortId: 'passenger-waiting-cohort-1',
      originStopPlaceId: 'place-origin',
      originStopNodeId: 'node-origin',
      routeId: 'route-a',
      patternId: 'pattern-a',
      originOccurrenceIndex: 0,
      destinationCellId: 'r1c1',
      destinationStopPlaceId: 'place-destination',
      destinationStopNodeId: 'node-destination',
      destinationOccurrenceIndex: 2,
      wrapsPatternEnd: false,
      edgeCount: 2,
      count: 6,
      firstAssignedTick: 2,
      lastAssignedTick: 3,
    } as const;
    const result = processPassengerTransitAtVehicleCalls(
      input({
        waitingCohorts: [waiting] as never,
        waitingGenerationLineageWatermarks: [],
        onboardGroups: [],
        nextPassengerOnboardGroupSequence: 1,
        totalWaitingForVehiclePassengerCount: 6,
        totalBoardedPassengerCount: 0,
        totalOnboardPassengerCount: 0,
        capacities: [
          createVehiclePassengerCapacity('bus-1', 3),
          createVehiclePassengerCapacity('bus-2', 3),
        ],
        vehicleOperations: [
          {
            vehicleId: 'bus-1',
            patternRunSequence: 1,
            patternRunStartedAtTick: 0,
            movementStartedAtTick: 0,
            stopCallSequence: 1,
          },
          {
            vehicleId: 'bus-2',
            patternRunSequence: 1,
            patternRunStartedAtTick: 0,
            movementStartedAtTick: 0,
            stopCallSequence: 1,
          },
        ] as never,
        currentStopCalls: [
          call({
            vehicleId: 'bus-2',
            stopNodeId: 'node-origin',
            occurrenceIndex: 0,
            stopCallSequence: 1,
          }),
          call({
            vehicleId: 'bus-1',
            stopNodeId: 'node-origin',
            occurrenceIndex: 0,
            stopCallSequence: 1,
          }),
        ] as never,
      }),
    );
    expect(
      result.currentBoardingEvents.map((event) => event.vehicleId),
    ).toEqual(['bus-1', 'bus-2']);
    expect(result.waitingGenerationLineageWatermarks).toHaveLength(1);
    expect(result.totalOnboardPassengerCount).toBe(6);

    expect(() =>
      processPassengerTransitAtVehicleCalls(
        input({
          waitingCohorts: [waiting] as never,
          onboardGroups: [],
          totalWaitingForVehiclePassengerCount: 6,
          totalBoardedPassengerCount: 0,
          totalOnboardPassengerCount: 0,
          waitingGenerationLineageWatermarks: [
            {
              ...input().waitingGenerationLineageWatermarks[0]!,
              passengerWaitingCohortId: 'passenger-waiting-cohort-2',
            },
          ] as never,
          currentStopCalls: [
            call({ stopNodeId: 'node-origin', occurrenceIndex: 0 }),
          ] as never,
        }),
      ),
    ).toThrow('cannot move backward');
  });

  it('rejects non-canonical access and watermark ordering', () => {
    const result = processPassengerTransitAtVehicleCalls(input());
    const first = result.destinationAccessGroups[0]!;
    const second = {
      ...first,
      passengerDestinationAccessGroupId:
        'passenger-destination-access-group-2' as never,
      sourceOnboardGroupId: 'passenger-onboard-group-2' as never,
      sourceWaitingCohortId: 'passenger-waiting-cohort-2' as never,
    };
    expect(() =>
      validatePassengerTransitCollections({
        ...input(),
        onboardGroups: [],
        destinationAccessGroups: [second, first],
        nextPassengerWaitingCohortSequence: 2,
        nextPassengerDestinationAccessGroupSequence: 3,
      }),
    ).toThrow('destination-access authority');

    const firstWatermark = input().waitingGenerationLineageWatermarks[0]!;
    const secondWatermark = {
      ...firstWatermark,
      passengerWaitingCohortKey:
        'place-z\u0000node-z\u0000route-a\u0000pattern-a\u00000\u0000r1c1\u0000place-destination\u0000node-destination\u00002',
      passengerWaitingCohortId: 'passenger-waiting-cohort-2' as never,
      originStopPlaceId: 'place-z' as never,
      originStopNodeId: 'node-z' as never,
    };
    expect(() =>
      validatePassengerTransitCollections({
        ...input(),
        waitingCohorts: [],
        onboardGroups: [],
        destinationAccessGroups: [],
        waitingGenerationLineageWatermarks: [secondWatermark, firstWatermark],
        nextPassengerWaitingCohortSequence: 3,
      }),
    ).toThrow('lineage watermark');
  });

  it('rejects watermark identity conflicts and impossible replay subtraction', () => {
    const base = input();
    const residual = {
      ...onboard(),
      passengerWaitingCohortId: 'passenger-waiting-cohort-1',
      lastAssignedTick: 4,
    } as never;
    expect(() =>
      validatePassengerTransitCollections({
        ...base,
        waitingCohorts: [residual],
        onboardGroups: [],
        destinationAccessGroups: [],
        nextPassengerWaitingCohortSequence: 2,
      }),
    ).toThrow('watermark identity mismatch');
    const result = processPassengerTransitAtVehicleCalls(base);
    expect(() =>
      validatePassengerTransitReplay({
        ...base,
        ...result,
        nextPassengerDestinationAccessGroupSequence: 0,
      }),
    ).toThrow('underflow');
  });

  it('retains unrelated onboard groups while alighting and sorts same-vehicle calls', () => {
    const future = onboard({
      passengerOnboardGroupId: 'passenger-onboard-group-2',
      alightAtPatternRunSequence: 2,
      count: 1,
    });
    const result = processPassengerTransitAtVehicleCalls(
      input({
        onboardGroups: [onboard({ count: 5 }), future] as never,
        nextPassengerOnboardGroupSequence: 3,
        currentStopCalls: [
          call({ routeId: null, stopCallSequence: 4 }),
          call({ stopCallSequence: 3 }),
        ] as never,
      }),
    );
    expect(result.onboardGroups).toEqual([
      expect.objectContaining({
        passengerOnboardGroupId: 'passenger-onboard-group-2',
      }),
    ]);
    expect(
      result.currentAlightingEvents[0]?.onboardPassengerCountAfterAlighting,
    ).toBe(1);
  });
});
