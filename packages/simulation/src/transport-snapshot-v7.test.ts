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
  parseSimulationTick,
  parseTransportSimulationSnapshot,
  restoreTransportSimulationState,
  validatePassengerJourneyRunAndCallIdentity,
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

const boardingPlan = () => {
  const plan = structuredClone(demandPlan());
  plan.cells[0]!.assignedStopPlaceId = 'tv-place-0108';
  plan.cells[1]!.assignedStopPlaceId = 'tv-place-0093';
  plan.stops = [
    { stopPlaceId: 'tv-place-0093' },
    { stopPlaceId: 'tv-place-0108' },
  ];
  return plan;
};

const routeCycleVehicle = (vehicleId: string, passengerCapacity = 1) => ({
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

const boardedState = (vehicleId = 'boarding-bus') => {
  const canonical = scenario();
  const plan = boardingPlan();
  let state = advanceTransportTicks(
    createTransportSimulationState(canonical, 0, plan),
    2,
  );
  state = applyTransportVehicleCommand(state, routeCycleVehicle(vehicleId));
  state = applyTransportVehicleCommand(state, {
    kind: 'transport.vehicle.start',
    vehicleId,
  });
  return { canonical, plan, state };
};

const destinationAccessStates = () => {
  const canonical = scenario();
  const plan = structuredClone(boardingPlan());
  for (const cell of plan.cells) cell.distanceSquaredCells = 4;
  plan.accessPolicy.accessTicksPerCell = 2;
  let state = advanceTransportTicks(
    createTransportSimulationState(canonical, 0, plan),
    2,
  );
  state = applyTransportVehicleCommand(state, routeCycleVehicle('access-bus'));
  state = applyTransportVehicleCommand(state, {
    kind: 'transport.vehicle.start',
    vehicleId: 'access-bus',
  });
  while (state.currentAlightingEvents.length === 0)
    state = advanceTransportTicks(state, 1);
  const alighted = state;
  state = advanceTransportTicks(state, 1);
  const activeAccess = state;
  return { canonical, plan, alighted, activeAccess };
};

const completedJourneyState = () => {
  const { canonical, plan, state: boarded } = boardedState('completion-bus');
  let state = boarded;
  while (state.currentJourneyCompletionEvents.length === 0)
    state = advanceTransportTicks(state, 1);
  return { canonical, plan, completed: state };
};

const laterRunJourneyStates = () => {
  const canonical = scenario();
  const build = (accessDistance: number) => {
    const plan = structuredClone(boardingPlan());
    for (const cell of plan.cells) cell.distanceSquaredCells = accessDistance;
    plan.accessPolicy.accessTicksPerCell = 3;
    plan.emissionPolicy.creditsPerPassenger = 8;
    let state = advanceTransportTicks(
      createTransportSimulationState(canonical, 0, plan),
      2,
    );
    state = applyTransportVehicleCommand(
      state,
      routeCycleVehicle('later-run-bus'),
    );
    return {
      plan,
      state: applyTransportVehicleCommand(state, {
        kind: 'transport.vehicle.start',
        vehicleId: 'later-run-bus',
      }),
    };
  };
  const accessAuthority = build(4);
  let access: typeof accessAuthority.state | undefined;
  let state = accessAuthority.state;
  for (let index = 0; index < 200 && !access; index += 1) {
    state = advanceTransportTicks(state, 1);
    if (
      state.passengerDemand.status === 'active' &&
      state.passengerDemand.destinationAccessGroups.some(
        (group) => group.boardedAtPatternRunSequence >= 2,
      )
    )
      access = advanceTransportTicks(state, 1);
  }
  const completionAuthority = build(0);
  let completion: typeof completionAuthority.state | undefined;
  state = completionAuthority.state;
  for (let index = 0; index < 200 && !completion; index += 1) {
    state = advanceTransportTicks(state, 1);
    if (
      state.currentJourneyCompletionEvents.some(
        (event) => event.boardedAtPatternRunSequence >= 2,
      )
    )
      completion = state;
  }
  if (!access || !completion)
    throw new Error('Expected generated later-run passenger journey states.');
  return {
    canonical,
    accessPlan: accessAuthority.plan,
    completionPlan: completionAuthority.plan,
    access,
    completion,
  };
};

describe('Transport Snapshot V9', () => {
  it('rejects internally consistent backward shifts of exact historical run and call coordinates', () => {
    const { canonical, accessPlan, completionPlan, access, completion } =
      laterRunJourneyStates();
    for (const source of [access, completion]) {
      const plan = source === access ? accessPlan : completionPlan;
      const snapshot = createTransportSimulationSnapshot(source);
      const passenger =
        source === access
          ? snapshot.state.passengerDemand.status === 'active'
            ? snapshot.state.passengerDemand.destinationAccessGroups.find(
                (group) => group.boardedAtPatternRunSequence >= 2,
              )
            : undefined
          : snapshot.state.currentJourneyCompletionEvents.find(
              (event) => event.boardedAtPatternRunSequence >= 2,
            );
      expect(passenger?.boardedAtStopCallSequence).toBeGreaterThan(1);
      expect(passenger?.alightedAtStopCallSequence).toBeGreaterThan(
        (passenger?.edgeCount ?? 0) + 1,
      );

      const shiftedRun = structuredClone(snapshot);
      const runGroup =
        source === access
          ? shiftedRun.state.passengerDemand.status === 'active'
            ? shiftedRun.state.passengerDemand.destinationAccessGroups.find(
                (group) => group.boardedAtPatternRunSequence >= 2,
              )!
            : undefined
          : shiftedRun.state.currentJourneyCompletionEvents.find(
              (event) => event.boardedAtPatternRunSequence >= 2,
            )!;
      runGroup!.boardedAtPatternRunSequence -= 1;
      runGroup!.alightedAtPatternRunSequence -= 1;
      expect(() =>
        restoreTransportSimulationState(shiftedRun, canonical, plan),
      ).toThrow();

      const shiftedCall = structuredClone(snapshot);
      const callGroup =
        source === access
          ? shiftedCall.state.passengerDemand.status === 'active'
            ? shiftedCall.state.passengerDemand.destinationAccessGroups.find(
                (group) => group.boardedAtPatternRunSequence >= 2,
              )!
            : undefined
          : shiftedCall.state.currentJourneyCompletionEvents.find(
              (event) => event.boardedAtPatternRunSequence >= 2,
            )!;
      callGroup!.boardedAtStopCallSequence -= 1;
      callGroup!.alightedAtStopCallSequence -= 1;
      expect(() =>
        restoreTransportSimulationState(shiftedCall, canonical, plan),
      ).toThrow();
    }
  });

  it('rejects active onboard groups that claim a future boarding run', () => {
    const { canonical, plan, state: boarded } = boardedState();
    const state = advanceTransportTicks(boarded, 1);
    if (state.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    const currentRun = state.vehicleOperations[0]!.patternRunSequence;
    for (const offset of [1, 10]) {
      const snapshot = structuredClone(
        createTransportSimulationSnapshot(state),
      );
      if (snapshot.state.passengerDemand.status !== 'active')
        throw new Error('Expected active passenger authority.');
      const group = snapshot.state.passengerDemand.onboardGroups[0]!;
      group.boardedAtPatternRunSequence = currentRun + offset;
      group.alightAtPatternRunSequence = currentRun + offset;
      expect(() =>
        restoreTransportSimulationState(snapshot, canonical, plan),
      ).toThrow(/pattern-run|onboard passenger|run\/call/i);
    }

    const futureCall = structuredClone(
      createTransportSimulationSnapshot(state),
    );
    if (futureCall.state.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    futureCall.state.passengerDemand.onboardGroups[0]!.boardedAtStopCallSequence =
      state.vehicleOperations[0]!.stopCallSequence + 1;
    expect(() =>
      restoreTransportSimulationState(futureCall, canonical, plan),
    ).toThrow(/pattern-run|onboard passenger|run\/call/i);
  });

  it('rejects a fabricated wrapped interval on a non-loop route leg', () => {
    const { state } = boardedState('wrapped-lineage-bus');
    if (state.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    const group = {
      ...state.passengerDemand.onboardGroups[0]!,
      wrapsPatternEnd: true,
      alightAtPatternRunSequence:
        state.vehicleOperations[0]!.patternRunSequence + 1,
    };
    const base = {
      graph: state.graph,
      fleet: state.fleet,
      vehicleOperations: state.vehicleOperations,
      currentStopCalls: [],
      destinationAccessGroups: [],
      currentJourneyCompletionEvents: [],
    };
    expect(() =>
      validatePassengerJourneyRunAndCallIdentity({
        ...base,
        onboardGroups: [group],
      }),
    ).toThrow(/run|call/i);

    expect(() =>
      validatePassengerJourneyRunAndCallIdentity({
        ...base,
        onboardGroups: [
          {
            ...group,
            boardedAtPatternRunSequence: group.boardedAtPatternRunSequence + 1,
            alightAtPatternRunSequence: group.alightAtPatternRunSequence + 1,
          },
        ],
      }),
    ).toThrow(/pattern-run/i);

    const targetRun = group.alightAtPatternRunSequence;
    expect(() =>
      validatePassengerJourneyRunAndCallIdentity({
        ...base,
        vehicleOperations: [
          {
            ...state.vehicleOperations[0]!,
            patternRunSequence: targetRun,
            patternRunStartedAtTick: state.tick,
          },
        ],
        onboardGroups: [group],
      }),
    ).toThrow(/run|call/i);
  });

  it('rejects false historical destination-access run and call identity', () => {
    const { canonical, plan, activeAccess } = destinationAccessStates();
    if (activeAccess.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    expect(activeAccess.passengerDemand.destinationAccessGroups).toHaveLength(
      1,
    );
    for (const field of [
      'alightedAtPatternRunSequence',
      'alightedAtStopCallSequence',
    ] as const) {
      const snapshot = structuredClone(
        createTransportSimulationSnapshot(activeAccess),
      );
      if (snapshot.state.passengerDemand.status !== 'active')
        throw new Error('Expected active passenger authority.');
      snapshot.state.passengerDemand.destinationAccessGroups[0]![field] += 1;
      expect(() =>
        restoreTransportSimulationState(snapshot, canonical, plan),
      ).toThrow(/journey|alight|passenger|run\/call/i);
    }

    const futureRun = structuredClone(
      createTransportSimulationSnapshot(activeAccess),
    );
    if (futureRun.state.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    const futureRunGroup =
      futureRun.state.passengerDemand.destinationAccessGroups[0]!;
    futureRunGroup.boardedAtPatternRunSequence =
      activeAccess.vehicleOperations[0]!.patternRunSequence + 1;
    futureRunGroup.alightedAtPatternRunSequence =
      futureRunGroup.boardedAtPatternRunSequence;
    expect(() =>
      restoreTransportSimulationState(futureRun, canonical, plan),
    ).toThrow(/journey|alight|passenger|run\/call/i);

    const futureCall = structuredClone(
      createTransportSimulationSnapshot(activeAccess),
    );
    if (futureCall.state.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    const futureCallGroup =
      futureCall.state.passengerDemand.destinationAccessGroups[0]!;
    futureCallGroup.boardedAtStopCallSequence =
      activeAccess.vehicleOperations[0]!.stopCallSequence + 1;
    futureCallGroup.alightedAtStopCallSequence =
      futureCallGroup.boardedAtStopCallSequence + futureCallGroup.edgeCount;
    expect(() =>
      restoreTransportSimulationState(futureCall, canonical, plan),
    ).toThrow(/journey|alight|passenger|run\/call/i);
  });

  it('validates historical access against exact vehicle ownership and progress', () => {
    const { activeAccess } = destinationAccessStates();
    if (activeAccess.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    const group = activeAccess.passengerDemand.destinationAccessGroups[0]!;
    const base = {
      graph: activeAccess.graph,
      fleet: activeAccess.fleet,
      vehicleOperations: activeAccess.vehicleOperations,
      currentStopCalls: activeAccess.currentStopCalls,
      onboardGroups: [],
      destinationAccessGroups: [group],
      currentJourneyCompletionEvents: [],
    };
    expect(() =>
      validatePassengerJourneyRunAndCallIdentity(base),
    ).not.toThrow();

    const corruptions = [
      { ...group, vehicleId: 'missing-vehicle' },
      { ...group, routeId: 'missing-route' },
      { ...group, patternId: 'missing-pattern' },
      { ...group, boardedAtTick: group.alightedAtTick + 1 },
    ] as unknown as typeof base.destinationAccessGroups;
    for (const corrupted of corruptions)
      expect(() =>
        validatePassengerJourneyRunAndCallIdentity({
          ...base,
          destinationAccessGroups: [corrupted],
        }),
      ).toThrow(/alighting run\/call/i);

    const vehicle = activeAccess.fleet[0]!;
    expect(() =>
      validatePassengerJourneyRunAndCallIdentity({
        ...base,
        fleet: [
          {
            ...vehicle,
            movement: {
              kind: 'running-at-stop',
              stopNodeId: activeAccess.graph.pattern(vehicle.patternId)!
                .stopNodeIds[0]!,
              nextEdgeSequence: 0,
            },
          },
        ],
        vehicleOperations: [
          {
            ...activeAccess.vehicleOperations[0]!,
            patternRunSequence: group.alightedAtPatternRunSequence,
          },
        ],
      }),
    ).toThrow(/alighting run\/call/i);
  });

  it('rejects false historical alighting identity in current completion output', () => {
    const { canonical, plan, completed } = completedJourneyState();
    expect(completed.currentJourneyCompletionEvents).toHaveLength(1);
    const corruptions = [
      (event: {
        boardedAtPatternRunSequence: number;
        alightedAtPatternRunSequence: number;
        alightedAtStopCallSequence: number;
      }) => {
        event.alightedAtPatternRunSequence += 1;
      },
      (event: {
        boardedAtPatternRunSequence: number;
        alightedAtPatternRunSequence: number;
        alightedAtStopCallSequence: number;
      }) => {
        event.alightedAtStopCallSequence += 1;
      },
      (event: {
        boardedAtPatternRunSequence: number;
        alightedAtPatternRunSequence: number;
        alightedAtStopCallSequence: number;
      }) => {
        event.boardedAtPatternRunSequence += 1;
        event.alightedAtPatternRunSequence += 1;
      },
    ];
    for (const corrupt of corruptions) {
      const snapshot = structuredClone(
        createTransportSimulationSnapshot(completed),
      );
      corrupt(snapshot.state.currentJourneyCompletionEvents[0]!);
      expect(() =>
        restoreTransportSimulationState(snapshot, canonical, plan),
      ).toThrow(/journey|alight|passenger|run\/call/i);
    }
  });

  it('rejects onboard passengers whose destination call is already past', () => {
    const { canonical, plan, state: boarded } = boardedState();
    if (boarded.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    const group = structuredClone(boarded.passengerDemand.onboardGroups[0]!);
    expect(
      createTransportSimulationSnapshot(
        restoreTransportSimulationState(
          createTransportSimulationSnapshot(boarded),
          canonical,
          plan,
        ),
      ),
    ).toEqual(createTransportSimulationSnapshot(boarded));

    let atDestination = boarded;
    while (
      atDestination.passengerDemand.status === 'active' &&
      atDestination.passengerDemand.onboardGroups.length > 0
    )
      atDestination = advanceTransportTicks(atDestination, 1);
    expect(atDestination.currentAlightingEvents).toHaveLength(1);

    const corrupt = (later: typeof atDestination) => {
      const snapshot = structuredClone(
        createTransportSimulationSnapshot(later),
      );
      if (snapshot.state.passengerDemand.status !== 'active')
        throw new Error('Expected active passenger authority.');
      const demand = snapshot.state.passengerDemand;
      demand.onboardGroups = [group];
      demand.totalOnboardPassengerCount += group.count;
      demand.totalAlightedPassengerCount -= group.count;
      if (demand.destinationAccessGroups.length > 0) {
        demand.destinationAccessGroups = [];
        demand.totalInDestinationAccessPassengerCount -= group.count;
      } else demand.totalCompletedJourneyPassengerCount -= group.count;
      snapshot.state.currentAlightingEvents = [];
      snapshot.state.currentJourneyCompletionEvents = [];
      return snapshot;
    };

    const exactCurrentCall = corrupt(atDestination);
    expect(() =>
      restoreTransportSimulationState(exactCurrentCall, canonical, plan),
    ).toThrow();

    const passedOccurrenceState = advanceTransportTicks(atDestination, 1);
    const passedOccurrence = corrupt(passedOccurrenceState);
    expect(() =>
      restoreTransportSimulationState(passedOccurrence, canonical, plan),
    ).toThrow(/overdue onboard passenger/i);

    let laterRun = passedOccurrenceState;
    while (
      laterRun.vehicleOperations[0]!.patternRunSequence <=
      group.alightAtPatternRunSequence
    )
      laterRun = advanceTransportTicks(laterRun, 1);
    const pastRun = corrupt(laterRun);
    expect(() =>
      restoreTransportSimulationState(pastRun, canonical, plan),
    ).toThrow(/overdue onboard passenger/i);
  });

  it('does not confuse near-match calls or an in-progress edge with the destination event', () => {
    const { state: boarded } = boardedState();
    if (boarded.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    const group = boarded.passengerDemand.onboardGroups[0]!;
    const operation = boarded.vehicleOperations[0]!;
    const destinationCall = {
      vehicleId: group.vehicleId,
      routeId: group.routeId,
      patternId: group.patternId,
      stopNodeId: group.destinationStopNodeId,
      occurrenceIndex: group.destinationOccurrenceIndex,
      patternRunSequence: group.alightAtPatternRunSequence,
      stopCallSequence: group.boardedAtStopCallSequence + 1,
      tick: boarded.tick,
    } as (typeof boarded.currentStopCalls)[number];
    const nearMatches = [
      { ...destinationCall, routeId: 'unrelated-route' },
      { ...destinationCall, patternId: 'unrelated-pattern' },
      { ...destinationCall, stopNodeId: 'unrelated-node' },
      {
        ...destinationCall,
        occurrenceIndex: destinationCall.occurrenceIndex + 1,
      },
      {
        ...destinationCall,
        patternRunSequence: destinationCall.patternRunSequence + 1,
      },
      {
        ...destinationCall,
        stopCallSequence: group.boardedAtStopCallSequence,
      },
    ] as unknown as Array<(typeof boarded.currentStopCalls)[number]>;

    for (const nearMatch of nearMatches)
      expect(() =>
        validatePassengerJourneyRunAndCallIdentity({
          graph: boarded.graph,
          fleet: boarded.fleet,
          vehicleOperations: [operation],
          currentStopCalls: [nearMatch],
          onboardGroups: [group],
          destinationAccessGroups: [],
          currentJourneyCompletionEvents: [],
        }),
      ).not.toThrow();

    const vehicle = boarded.fleet[0]!;
    const edge = boarded.graph.patternEdges(vehicle.patternId)[0]!;
    const onEdgeVehicle = {
      ...vehicle,
      movement: {
        kind: 'running-on-edge' as const,
        edgeId: edge.edgeId,
        edgeSequence: edge.sequence,
        fromStopNodeId: edge.fromStopNodeId,
        toStopNodeId: edge.toStopNodeId,
        progressTicks: 1,
        travelTicks: 2,
      },
    };
    expect(() =>
      validatePassengerJourneyRunAndCallIdentity({
        graph: boarded.graph,
        fleet: [onEdgeVehicle],
        vehicleOperations: boarded.vehicleOperations,
        currentStopCalls: [],
        onboardGroups: [group],
        destinationAccessGroups: [],
        currentJourneyCompletionEvents: [],
      }),
    ).not.toThrow();
  });

  it('round-trips canonical onboard authority rather than numeric issuance order', () => {
    const canonical = scenario();
    const plan = boardingPlan();
    let state = advanceTransportTicks(
      createTransportSimulationState(canonical, 0, plan),
      2,
    );
    state = applyTransportVehicleCommand(state, routeCycleVehicle('z-bus'));
    state = applyTransportVehicleCommand(state, routeCycleVehicle('a-bus'));
    state = advanceTransportTicks(state, 1);
    if (state.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    expect(
      state.passengerDemand.onboardGroups.map((group) => [
        group.vehicleId,
        group.passengerOnboardGroupId,
      ]),
    ).toEqual([
      ['a-bus', 'passenger-onboard-group-2'],
      ['z-bus', 'passenger-onboard-group-1'],
    ]);
    expect(state.currentBoardingEvents).toEqual([]);
    const snapshot = createTransportSimulationSnapshot(state);
    expect(
      createTransportSimulationSnapshot(
        restoreTransportSimulationState(snapshot, canonical, plan),
      ),
    ).toEqual(snapshot);
  });

  it('preserves only current-tick alighting events across vehicle creation', () => {
    const { alighted } = destinationAccessStates();
    const current = alighted.currentAlightingEvents;
    const withStaleEvent = {
      ...alighted,
      currentAlightingEvents: [
        ...current,
        {
          ...current[0]!,
          tick: parseSimulationTick(alighted.tick - 1),
        },
      ],
    };
    const next = applyTransportVehicleCommand(withStaleEvent, {
      kind: 'transport.vehicle.create',
      vehicleId: 'event-preservation-bus',
      label: 'Event preservation bus',
      patternId: 'legacy-A2-torrevieja-la-mata',
      movementPlan: {
        kind: 'vehicle-movement-plan-v1',
        edgeTravelTicks: [1, 1, 1, 1],
      },
    });

    expect(next.currentAlightingEvents).toEqual(current);
  });

  it('rejects passenger events while passenger authority is disabled', () => {
    const canonical = scenario();
    const disabled = createTransportSimulationSnapshot(
      createTransportSimulationState(canonical, 0),
    );
    const { plan, state } = boardedState();
    let alighted = state;
    while (alighted.currentAlightingEvents.length === 0)
      alighted = advanceTransportTicks(alighted, 1);
    const passengerSnapshot = createTransportSimulationSnapshot(alighted);
    const corruptions = [
      (value: typeof disabled) => {
        value.state.currentBoardingEvents = structuredClone(
          createTransportSimulationSnapshot(
            applyTransportVehicleCommand(
              advanceTransportTicks(
                createTransportSimulationState(canonical, 0, plan),
                2,
              ),
              routeCycleVehicle('event-bus'),
            ),
          ).state.currentBoardingEvents,
        );
      },
      (value: typeof disabled) => {
        value.state.currentAlightingEvents = structuredClone(
          passengerSnapshot.state.currentAlightingEvents,
        );
      },
      (value: typeof disabled) => {
        value.state.currentJourneyCompletionEvents = structuredClone(
          passengerSnapshot.state.currentJourneyCompletionEvents,
        );
      },
    ];
    for (const mutate of corruptions) {
      const corrupted = structuredClone(disabled);
      mutate(corrupted);
      expect(() =>
        restoreTransportSimulationState(corrupted, canonical),
      ).toThrow(/disabled passenger authority/i);
    }
  });
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
    ];
    for (const [index, corrupt] of generationCorruptions.entries()) {
      const value = structuredClone(snapshot);
      corrupt(value);
      expect(
        () => restoreTransportSimulationState(value, canonical, plan),
        `generation corruption ${index}`,
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

    const firstHistoricalGroup =
      fullyBoarded.passengerDemand.onboardGroups.find(
        (group) => group.sourceWaitingCohortId === consumedId,
      )!;
    const secondGeneration = fullyBoarded.passengerDemand.waitingCohorts.find(
      (cohort) =>
        cohort.originStopNodeId === firstHistoricalGroup.originStopNodeId &&
        cohort.destinationCellId === firstHistoricalGroup.destinationCellId,
    )!;
    const fullyBoardedSnapshot =
      createTransportSimulationSnapshot(fullyBoarded);
    expect(
      createTransportSimulationSnapshot(
        restoreTransportSimulationState(fullyBoardedSnapshot, canonical, plan),
      ),
    ).toEqual(fullyBoardedSnapshot);
    const impossibleSuccessor = structuredClone(fullyBoardedSnapshot);
    if (impossibleSuccessor.state.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    const corruptedSecondGeneration =
      impossibleSuccessor.state.passengerDemand.waitingCohorts.find(
        (cohort) =>
          cohort.passengerWaitingCohortId ===
          secondGeneration.passengerWaitingCohortId,
      )!;
    corruptedSecondGeneration.firstAssignedTick =
      firstHistoricalGroup.boardedAtTick;
    expect(() =>
      restoreTransportSimulationState(impossibleSuccessor, canonical, plan),
    ).toThrow(/waiting-generation lineage successor/i);

    const secondGenerationId = secondGeneration.passengerWaitingCohortId;
    fullyBoarded = applyTransportVehicleCommand(fullyBoarded, {
      kind: 'transport.vehicle.create-route-cycle',
      vehicleId: 'full-generation-bus-2',
      label: 'Full generation bus 2',
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
    expect(
      fullyBoarded.passengerDemand.waitingCohorts.some(
        (cohort) => cohort.passengerWaitingCohortId === secondGenerationId,
      ),
    ).toBe(false);
    fullyBoarded = advanceTransportTicks(fullyBoarded, 2);
    if (fullyBoarded.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    const thirdGeneration = fullyBoarded.passengerDemand.waitingCohorts.find(
      (cohort) =>
        cohort.originStopNodeId === firstHistoricalGroup.originStopNodeId &&
        cohort.destinationCellId === firstHistoricalGroup.destinationCellId,
    )!;
    const chainedSnapshot = createTransportSimulationSnapshot(fullyBoarded);
    expect(
      createTransportSimulationSnapshot(
        restoreTransportSimulationState(chainedSnapshot, canonical, plan),
      ),
    ).toEqual(chainedSnapshot);
    const impossibleChain = structuredClone(chainedSnapshot);
    if (impossibleChain.state.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    const secondHistoricalGroup =
      impossibleChain.state.passengerDemand.onboardGroups.find(
        (group) => group.sourceWaitingCohortId === secondGenerationId,
      )!;
    impossibleChain.state.passengerDemand.waitingCohorts.find(
      (cohort) =>
        cohort.passengerWaitingCohortId ===
        thirdGeneration.passengerWaitingCohortId,
    )!.firstAssignedTick = secondHistoricalGroup.boardedAtTick;
    expect(() =>
      restoreTransportSimulationState(impossibleChain, canonical, plan),
    ).toThrow(/waiting-generation lineage successor/i);
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
    ).toThrow(/passenger (boarding|transit) authority/i);

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
    ).toThrow(/passenger (boarding|transit) authority/i);

    const missingEvent = structuredClone(snapshot);
    missingEvent.state.currentBoardingEvents = [];
    expect(() =>
      restoreTransportSimulationState(missingEvent, canonical, plan),
    ).toThrow(/passenger (boarding|transit) authority/i);

    const inflatedNext = structuredClone(snapshot);
    if (inflatedNext.state.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    inflatedNext.state.passengerDemand.nextPassengerOnboardGroupSequence += 1;
    expect(() =>
      restoreTransportSimulationState(inflatedNext, canonical, plan),
    ).toThrow(/(sequence|transit authority)/i);

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
    ).toThrow(/waiting-cohort sequence/i);

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
    ).toThrow(/passenger (boarding|transit) authority/i);
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
      schemaVersion: 9,
      simulationVersion: 'transport-9',
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
