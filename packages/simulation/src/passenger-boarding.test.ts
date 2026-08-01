import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VEHICLE_PASSENGER_CAPACITY,
  boardPassengersAtVehicleCalls,
  createVehiclePassengerCapacity,
  comparePassengerOnboardGroups,
  parseCurrentBoardingEvents,
  parseVehiclePassengerCapacities,
  parseVehiclePassengerLoadProjections,
  projectVehiclePassengerLoads,
  validatePassengerBoardingAuthority,
  type PassengerBoardingInput,
} from './index.js';

const cohort = (overrides: Record<string, unknown> = {}) => ({
  passengerWaitingCohortId: 'passenger-waiting-cohort-1',
  originStopPlaceId: 'place-origin',
  originStopNodeId: 'node-outbound',
  routeId: 'route-a',
  patternId: 'pattern-outbound',
  originOccurrenceIndex: 0,
  destinationCellId: 'r1c1',
  destinationStopPlaceId: 'place-destination',
  destinationStopNodeId: 'node-destination',
  destinationOccurrenceIndex: 2,
  wrapsPatternEnd: false,
  edgeCount: 2,
  count: 10,
  firstAssignedTick: 2,
  lastAssignedTick: 3,
  ...overrides,
});

const call = (overrides: Record<string, unknown> = {}) => ({
  vehicleId: 'bus-1',
  stopCallSequence: 4,
  patternRunSequence: 1,
  routeId: 'route-a',
  patternId: 'pattern-outbound',
  stopNodeId: 'node-outbound',
  occurrenceIndex: 0,
  tick: 5,
  ...overrides,
});

const input = (
  overrides: Partial<PassengerBoardingInput> = {},
): PassengerBoardingInput => ({
  tick: 5 as PassengerBoardingInput['tick'],
  waitingCohorts: [cohort()] as PassengerBoardingInput['waitingCohorts'],
  onboardGroups: [],
  nextPassengerOnboardGroupSequence: 1,
  totalBoardedPassengerCount: 0,
  capacities: [createVehiclePassengerCapacity('bus-1', 6)],
  vehicleOperations: [
    {
      vehicleId: 'bus-1',
      patternRunSequence: 1,
      patternRunStartedAtTick: 0,
      movementStartedAtTick: 0,
      stopCallSequence: 4,
    },
  ] as PassengerBoardingInput['vehicleOperations'],
  currentStopCalls: [call()] as PassengerBoardingInput['currentStopCalls'],
  itineraryIsValid: () => true,
  ...overrides,
});

describe('deterministic passenger boarding', () => {
  it('creates immutable default and explicit capacity authority', () => {
    const defaultCapacity = createVehiclePassengerCapacity('bus-1');
    expect(defaultCapacity).toEqual({
      vehicleId: 'bus-1',
      passengerCapacity: DEFAULT_VEHICLE_PASSENGER_CAPACITY,
    });
    expect(createVehiclePassengerCapacity('bus-2', 25)).toEqual({
      vehicleId: 'bus-2',
      passengerCapacity: 25,
    });
    expect(Object.isFrozen(defaultCapacity)).toBe(true);
    for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => createVehiclePassengerCapacity('bus-1', invalid)).toThrow();
  });

  it('boards an exact directional occurrence partially and conserves ownership', () => {
    const result = boardPassengersAtVehicleCalls(input());
    expect(result.waitingCohorts).toEqual([
      expect.objectContaining({
        passengerWaitingCohortId: 'passenger-waiting-cohort-1',
        count: 4,
        firstAssignedTick: 2,
        lastAssignedTick: 3,
      }),
    ]);
    expect(result.onboardGroups).toEqual([
      expect.objectContaining({
        passengerOnboardGroupId: 'passenger-onboard-group-1',
        sourceWaitingCohortId: 'passenger-waiting-cohort-1',
        vehicleId: 'bus-1',
        count: 6,
        boardedAtTick: 5,
        boardedAtPatternRunSequence: 1,
        alightAtPatternRunSequence: 1,
        boardedAtStopCallSequence: 4,
      }),
    ]);
    expect(result.totalWaitingForVehiclePassengerCount).toBe(4);
    expect(result.totalBoardedPassengerCount).toBe(6);
    expect(result.totalOnboardPassengerCount).toBe(6);
    expect(result.currentBoardingEvents).toEqual([
      expect.objectContaining({
        vehicleId: 'bus-1',
        boardedPassengerCount: 6,
        onboardPassengerCountAfterBoarding: 6,
        remainingCapacity: 0,
        onboardGroupIds: ['passenger-onboard-group-1'],
      }),
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.onboardGroups[0])).toBe(true);
    const base = result.onboardGroups[0]!;
    for (const changed of [
      { vehicleId: 'bus-2' },
      { alightAtPatternRunSequence: 2 },
      { destinationOccurrenceIndex: 3 },
      { destinationCellId: 'r2c1' },
      { destinationCellId: 'r1c2' },
      { passengerOnboardGroupId: 'passenger-onboard-group-2' },
    ])
      expect(
        comparePassengerOnboardGroups(base, {
          ...base,
          ...changed,
        } as typeof base),
      ).toBeLessThan(0);
  });

  it('requires route, pattern, StopNode, and occurrence identity', () => {
    for (const mismatch of [
      { routeId: 'route-b' },
      { patternId: 'pattern-return' },
      { stopNodeId: 'node-opposite-direction' },
      { occurrenceIndex: 1 },
    ]) {
      const result = boardPassengersAtVehicleCalls(
        input({
          currentStopCalls: [
            call(mismatch),
          ] as PassengerBoardingInput['currentStopCalls'],
        }),
      );
      expect(result.onboardGroups).toEqual([]);
      expect(result.waitingCohorts).toEqual([cohort()]);
    }
  });

  it('orders calls and oldest cohorts deterministically and handles wrapped runs', () => {
    const older = cohort({
      passengerWaitingCohortId: 'passenger-waiting-cohort-2',
      destinationCellId: 'r2c1',
      firstAssignedTick: 1,
      lastAssignedTick: 2,
      count: 2,
      wrapsPatternEnd: true,
    });
    const equalAgeLowerId = cohort({ count: 2 });
    const equalAgeHigherId = cohort({
      passengerWaitingCohortId: 'passenger-waiting-cohort-3',
      destinationCellId: 'r3c1',
      count: 2,
    });
    const result = boardPassengersAtVehicleCalls(
      input({
        waitingCohorts: [
          equalAgeHigherId,
          equalAgeLowerId,
          older,
        ] as PassengerBoardingInput['waitingCohorts'],
        capacities: [
          createVehiclePassengerCapacity('bus-2', 2),
          createVehiclePassengerCapacity('bus-1', 2),
        ],
        vehicleOperations: [
          {
            vehicleId: 'bus-2',
            patternRunSequence: 8,
            patternRunStartedAtTick: 5,
            movementStartedAtTick: 0,
            stopCallSequence: 7,
          },
          {
            vehicleId: 'bus-1',
            patternRunSequence: 1,
            patternRunStartedAtTick: 0,
            movementStartedAtTick: 0,
            stopCallSequence: 4,
          },
        ] as PassengerBoardingInput['vehicleOperations'],
        currentStopCalls: [
          call({
            vehicleId: 'bus-2',
            patternRunSequence: 8,
            stopCallSequence: 7,
          }),
          call(),
        ] as PassengerBoardingInput['currentStopCalls'],
      }),
    );
    expect(result.onboardGroups.map((group) => group.vehicleId)).toEqual([
      'bus-1',
      'bus-2',
    ]);
    expect(result.onboardGroups[0]).toMatchObject({
      sourceWaitingCohortId: 'passenger-waiting-cohort-2',
      alightAtPatternRunSequence: 2,
    });
    expect(result.onboardGroups[1]).toMatchObject({
      sourceWaitingCohortId: 'passenger-waiting-cohort-1',
      alightAtPatternRunSequence: 8,
    });
    expect(result.waitingCohorts).toEqual([
      expect.objectContaining({
        passengerWaitingCohortId: 'passenger-waiting-cohort-3',
        count: 2,
      }),
    ]);
  });

  it('does not board without a call, with an invalid itinerary, or when already full', () => {
    for (const overrides of [
      { currentStopCalls: [] },
      { itineraryIsValid: () => false },
    ] satisfies Array<Partial<PassengerBoardingInput>>)
      expect(boardPassengersAtVehicleCalls(input(overrides))).toMatchObject({
        onboardGroups: [],
        currentBoardingEvents: [],
        totalWaitingForVehiclePassengerCount: 10,
      });

    const first = boardPassengersAtVehicleCalls(input());
    const full = boardPassengersAtVehicleCalls(
      input({
        waitingCohorts: [
          cohort({ count: 2 }),
        ] as PassengerBoardingInput['waitingCohorts'],
        onboardGroups: first.onboardGroups,
        nextPassengerOnboardGroupSequence: 2,
        totalBoardedPassengerCount: 6,
      }),
    );
    expect(full.currentBoardingEvents).toEqual([]);
    expect(full.totalOnboardPassengerCount).toBe(6);
    expect(() =>
      boardPassengersAtVehicleCalls(
        input({ capacities: [], vehicleOperations: [], currentStopCalls: [] }),
      ),
    ).not.toThrow();
    expect(() =>
      boardPassengersAtVehicleCalls(input({ capacities: [] })),
    ).toThrow('Invalid passenger boarding authority');
    expect(() =>
      boardPassengersAtVehicleCalls(
        input({
          onboardGroups: first.onboardGroups,
          totalBoardedPassengerCount: 0,
        }),
      ),
    ).toThrow('Invalid boarded passenger total');
  });

  it('parses, projects, and validates exact boarding authority', () => {
    const result = boardPassengersAtVehicleCalls(input());
    const capacities = parseVehiclePassengerCapacities(input().capacities);
    const events = parseCurrentBoardingEvents(result.currentBoardingEvents);
    expect(
      parseVehiclePassengerLoadProjections([
        {
          vehicleId: 'bus-1',
          passengerCapacity: 6,
          onboardPassengerCount: 6,
          remainingPassengerCapacity: 0,
          currentAlightedPassengerCount: 0,
          currentBoardedPassengerCount: 0,
        },
      ]),
    ).toEqual(projectVehiclePassengerLoads(capacities, result.onboardGroups));
    expect(
      projectVehiclePassengerLoads(
        capacities,
        result.onboardGroups,
        [{ vehicleId: capacities[0]!.vehicleId, alightedPassengerCount: 2 }],
        [{ vehicleId: capacities[0]!.vehicleId, boardedPassengerCount: 3 }],
      )[0],
    ).toMatchObject({
      currentAlightedPassengerCount: 2,
      currentBoardedPassengerCount: 3,
    });
    const authority = {
      tick: input().tick,
      fleet: [
        { vehicleId: capacities[0]!.vehicleId, routeId: 'route-a' as never },
      ],
      capacities,
      onboardGroups: result.onboardGroups,
      waitingCohorts: result.waitingCohorts,
      nextPassengerWaitingCohortSequence: 2,
      nextPassengerOnboardGroupSequence:
        result.nextPassengerOnboardGroupSequence,
      totalWaitingForVehiclePassengerCount:
        result.totalWaitingForVehiclePassengerCount,
      totalBoardedPassengerCount: result.totalBoardedPassengerCount,
      totalOnboardPassengerCount: result.totalOnboardPassengerCount,
      currentStopCalls: input().currentStopCalls,
      currentBoardingEvents: events,
      vehicleOperations: input().vehicleOperations,
      itineraryIsValid: () => true,
    };
    expect(() => validatePassengerBoardingAuthority(authority)).not.toThrow();
    expect(Object.isFrozen(events[0])).toBe(true);
    expect(() =>
      projectVehiclePassengerLoads(
        [createVehiclePassengerCapacity('bus-1', 5)],
        result.onboardGroups,
      ),
    ).toThrow('capacity exceeded');
    expect(
      projectVehiclePassengerLoads(
        [createVehiclePassengerCapacity('bus-2', 5)],
        [],
      ),
    ).toEqual([
      expect.objectContaining({
        onboardPassengerCount: 0,
        remainingPassengerCapacity: 5,
      }),
    ]);

    const corruptions: Array<(value: typeof authority) => void> = [
      (value) => {
        (value.capacities as unknown[]).length = 0;
      },
      (value) => {
        (value.onboardGroups[0] as { boardedAtTick: number }).boardedAtTick = 6;
      },
      (value) => {
        value.onboardGroups = [...value.onboardGroups, value.onboardGroups[0]!];
      },
      (value) => {
        value.nextPassengerOnboardGroupSequence = 1;
      },
      (value) => {
        (
          value.onboardGroups[0] as { firstAssignedTick: number }
        ).firstAssignedTick = 4;
      },
      (value) => {
        (
          value.onboardGroups[0] as { lastAssignedTick: number }
        ).lastAssignedTick = 6;
      },
      (value) => {
        (
          value.onboardGroups[0] as { alightAtPatternRunSequence: number }
        ).alightAtPatternRunSequence = 2;
      },
      (value) => {
        (value.onboardGroups[0] as { vehicleId: string }).vehicleId = 'missing';
      },
      (value) => {
        (value.onboardGroups[0] as { routeId: string }).routeId = 'wrong';
      },
      (value) => {
        value.itineraryIsValid = () => false;
      },
      (value) => {
        value.totalOnboardPassengerCount = 5;
      },
      (value) => {
        (
          value.capacities[0] as { passengerCapacity: number }
        ).passengerCapacity = 5;
      },
      (value) => {
        (
          value.currentBoardingEvents[0] as { boardedPassengerCount: number }
        ).boardedPassengerCount = 5;
      },
      (value) => {
        (value.currentStopCalls as unknown[]).length = 0;
      },
    ];
    for (const corrupt of corruptions) {
      const value = {
        ...authority,
        fleet: structuredClone(authority.fleet),
        capacities: structuredClone(authority.capacities),
        onboardGroups: structuredClone(authority.onboardGroups),
        waitingCohorts: structuredClone(authority.waitingCohorts),
        currentStopCalls: structuredClone(authority.currentStopCalls),
        currentBoardingEvents: structuredClone(authority.currentBoardingEvents),
        itineraryIsValid: () => true,
      } as typeof authority;
      corrupt(value);
      expect(() => validatePassengerBoardingAuthority(value)).toThrow();
    }

    const invalidWaitingSequence = {
      ...authority,
      waitingCohorts: structuredClone(authority.waitingCohorts),
    };
    (
      invalidWaitingSequence.waitingCohorts[0] as {
        passengerWaitingCohortId: string;
      }
    ).passengerWaitingCohortId = 'passenger-waiting-cohort-2';
    expect(() =>
      validatePassengerBoardingAuthority(invalidWaitingSequence),
    ).toThrow('Invalid waiting-cohort sequence');

    const residualIdentityMismatch = {
      ...authority,
      waitingCohorts: structuredClone(authority.waitingCohorts),
    };
    (
      residualIdentityMismatch.waitingCohorts[0] as { lastAssignedTick: number }
    ).lastAssignedTick = 4;
    expect(() =>
      validatePassengerBoardingAuthority(residualIdentityMismatch),
    ).toThrow('Residual waiting cohort identity mismatch');

    const later = {
      ...authority,
      tick: 6 as typeof authority.tick,
      currentStopCalls: [],
      currentBoardingEvents: [],
    };
    expect(() => validatePassengerBoardingAuthority(later)).not.toThrow();
    expect(() =>
      validatePassengerBoardingAuthority({
        ...later,
        currentStopCalls: [
          call({ tick: 6, stopCallSequence: 5 }),
        ] as typeof authority.currentStopCalls,
      }),
    ).toThrow('Invalid current boarding call');

    const two = boardPassengersAtVehicleCalls(
      input({
        waitingCohorts: [
          cohort({ count: 1 }),
          cohort({
            passengerWaitingCohortId: 'passenger-waiting-cohort-2',
            destinationCellId: 'r2c1',
            count: 1,
          }),
        ] as PassengerBoardingInput['waitingCohorts'],
        capacities: [createVehiclePassengerCapacity('bus-1', 2)],
        currentStopCalls: [
          call({ stopCallSequence: 3 }),
          call({ stopCallSequence: 4 }),
        ] as PassengerBoardingInput['currentStopCalls'],
      }),
    );
    expect(two.totalOnboardPassengerCount).toBe(2);
    expect(() =>
      validatePassengerBoardingAuthority({
        ...authority,
        capacities: [createVehiclePassengerCapacity('bus-1', 2)],
        onboardGroups: [...two.onboardGroups].reverse(),
        waitingCohorts: two.waitingCohorts,
        nextPassengerWaitingCohortSequence: 3,
        nextPassengerOnboardGroupSequence: 3,
        totalWaitingForVehiclePassengerCount:
          two.totalWaitingForVehiclePassengerCount,
        totalBoardedPassengerCount: 2,
        totalOnboardPassengerCount: 2,
        currentBoardingEvents: two.currentBoardingEvents,
      }),
    ).toThrow('Invalid onboard passenger group');

    const splitSource = boardPassengersAtVehicleCalls(
      input({
        waitingCohorts: [
          cohort({ count: 2 }),
        ] as PassengerBoardingInput['waitingCohorts'],
        capacities: [
          createVehiclePassengerCapacity('bus-1', 1),
          createVehiclePassengerCapacity('bus-2', 1),
        ],
        vehicleOperations: [
          input().vehicleOperations[0]!,
          { ...input().vehicleOperations[0]!, vehicleId: 'bus-2' },
        ] as PassengerBoardingInput['vehicleOperations'],
        currentStopCalls: [
          call(),
          call({ vehicleId: 'bus-2' }),
        ] as PassengerBoardingInput['currentStopCalls'],
      }),
    );
    const splitAuthority = {
      tick: input().tick,
      fleet: [
        { vehicleId: 'bus-1' as never, routeId: 'route-a' as never },
        { vehicleId: 'bus-2' as never, routeId: 'route-a' as never },
      ],
      capacities: [
        createVehiclePassengerCapacity('bus-1', 1),
        createVehiclePassengerCapacity('bus-2', 1),
      ],
      waitingCohorts: splitSource.waitingCohorts,
      onboardGroups: structuredClone(splitSource.onboardGroups),
      nextPassengerWaitingCohortSequence: 2,
      nextPassengerOnboardGroupSequence: 3,
      totalWaitingForVehiclePassengerCount: 0,
      totalBoardedPassengerCount: 2,
      totalOnboardPassengerCount: 2,
      vehicleOperations: [
        input().vehicleOperations[0]!,
        { ...input().vehicleOperations[0]!, vehicleId: 'bus-2' as never },
      ],
      currentStopCalls: [
        call(),
        call({ vehicleId: 'bus-2' }),
      ] as PassengerBoardingInput['currentStopCalls'],
      currentBoardingEvents: splitSource.currentBoardingEvents,
      itineraryIsValid: () => true,
    };
    expect(() =>
      validatePassengerBoardingAuthority(splitAuthority),
    ).not.toThrow();
    (
      splitAuthority.onboardGroups[1] as { lastAssignedTick: number }
    ).lastAssignedTick = 4;
    expect(() => validatePassengerBoardingAuthority(splitAuthority)).toThrow(
      'Onboard source waiting-cohort identity mismatch',
    );

    const twoWaiting = {
      ...authority,
      waitingCohorts: [
        cohort({ count: 1 }),
        cohort({
          passengerWaitingCohortId: 'passenger-waiting-cohort-2',
          destinationCellId: 'r2c1',
          count: 1,
        }),
      ] as typeof authority.waitingCohorts,
      nextPassengerWaitingCohortSequence: 3,
      onboardGroups: [],
      nextPassengerOnboardGroupSequence: 1,
      totalWaitingForVehiclePassengerCount: 2,
      totalBoardedPassengerCount: 0,
      totalOnboardPassengerCount: 0,
      currentStopCalls: [],
      currentBoardingEvents: [],
    };
    expect(() => validatePassengerBoardingAuthority(twoWaiting)).not.toThrow();
    expect(() =>
      validatePassengerBoardingAuthority({
        ...twoWaiting,
        waitingCohorts: [...twoWaiting.waitingCohorts].reverse(),
      }),
    ).toThrow('not canonical');
  });

  it('rejects malformed calls, over-capacity input, and non-conserved cohort data', () => {
    for (const currentStopCalls of [
      [call({ tick: 4 })],
      [call({ vehicleId: 'missing' })],
      [call({ stopCallSequence: 5 })],
      [call({ patternRunSequence: 2 })],
      [call({ routeId: null })],
    ])
      expect(() =>
        boardPassengersAtVehicleCalls(
          input({
            currentStopCalls:
              currentStopCalls as PassengerBoardingInput['currentStopCalls'],
          }),
        ),
      ).toThrow('Invalid current boarding call');

    const boarded = boardPassengersAtVehicleCalls(input());
    expect(() =>
      boardPassengersAtVehicleCalls(
        input({
          onboardGroups: boarded.onboardGroups,
          totalBoardedPassengerCount: 6,
          capacities: [createVehiclePassengerCapacity('bus-1', 5)],
        }),
      ),
    ).toThrow('capacity exceeded');
    expect(() =>
      boardPassengersAtVehicleCalls(
        input({
          waitingCohorts: [
            cohort({ count: -1 }),
          ] as PassengerBoardingInput['waitingCohorts'],
        }),
      ),
    ).toThrow();
  });
});
