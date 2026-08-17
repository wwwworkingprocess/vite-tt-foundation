import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import {
  advanceTransportTicks,
  applyTransportVehicleCommand,
  canonicalVehicleCallCoordinate,
  completedLoopEventsAtElapsedTick,
  createTransportSimulationSnapshot,
  createTransportSimulationState,
  deriveVehicleOperationTransition,
  fastForwardVehicleOperation,
  restoreTransportSimulationState,
  vehicleCallCanServeWaitingCohort,
} from './index.js';

const root = join(
  import.meta.dirname,
  '..',
  '..',
  'transport-domain',
  'fixtures',
  'torrevieja-mini-v1',
);
const json = (name: string) =>
  JSON.parse(readFileSync(join(root, name), 'utf8')) as unknown;

function scenario() {
  const routes = structuredClone(json('routes.json')) as {
    routes: Array<{
      routeId: string;
      patterns: Array<{
        patternId: string;
        directionLabel: string;
        closesLoop: boolean;
        stopNodeIds: string[];
      }>;
    }>;
  };
  const outbound = routes.routes[0]!.patterns[0]!;
  routes.routes[0]!.routeId = 'route-a';
  routes.routes[0]!.patterns = [
    {
      ...outbound,
      patternId: 'outbound',
      stopNodeIds: ['tv-stop-0108', 'tv-stop-0053', 'tv-stop-0078'],
    },
    {
      ...outbound,
      patternId: 'return',
      directionLabel: 'Return',
      stopNodeIds: ['tv-stop-0067', 'tv-stop-0053', 'tv-stop-0108'],
    },
  ];
  return parseScenarioPackage({
    manifest: json('scenario.json'),
    settlements: json('settlements.json'),
    stops: json('stops.json'),
    routes,
    presentation: json('presentation.json'),
    provenance: json('provenance.json'),
  });
}

function started(
  plans: readonly [readonly number[], readonly number[]] = [
    [1, 1],
    [1, 1],
  ],
) {
  let state = createTransportSimulationState(scenario(), 0);
  state = applyTransportVehicleCommand(state, {
    kind: 'transport.vehicle.create-route-cycle',
    vehicleId: 'bus-1',
    label: 'Bus 1',
    routeId: 'route-a',
    legs: [
      {
        patternId: 'outbound',
        movementPlan: {
          kind: 'vehicle-movement-plan-v1',
          edgeTravelTicks: [...plans[0]],
        },
      },
      {
        patternId: 'return',
        movementPlan: {
          kind: 'vehicle-movement-plan-v1',
          edgeTravelTicks: [...plans[1]],
        },
      },
    ],
  });
  return applyTransportVehicleCommand(state, {
    kind: 'transport.vehicle.start',
    vehicleId: 'bus-1',
  });
}

function closedLoopStarted() {
  const routes = structuredClone(json('routes.json')) as {
    routes: Array<{
      patterns: Array<{
        patternId: string;
        closesLoop: boolean;
        stopNodeIds: string[];
      }>;
    }>;
  };
  const pattern = routes.routes[0]!.patterns[0]!;
  pattern.patternId = 'closed-loop';
  pattern.closesLoop = true;
  pattern.stopNodeIds = ['tv-stop-0108', 'tv-stop-0053', 'tv-stop-0078'];
  routes.routes[0]!.patterns = [pattern];
  const canonical = parseScenarioPackage({
    manifest: json('scenario.json'),
    settlements: json('settlements.json'),
    stops: json('stops.json'),
    routes,
    presentation: json('presentation.json'),
    provenance: json('provenance.json'),
  });
  let state = createTransportSimulationState(canonical, 0);
  state = applyTransportVehicleCommand(state, {
    kind: 'transport.vehicle.create',
    vehicleId: 'loop-bus',
    label: 'Loop bus',
    patternId: 'closed-loop',
    movementPlan: {
      kind: 'vehicle-movement-plan-v1',
      edgeTravelTicks: [2, 2, 2],
    },
  });
  return applyTransportVehicleCommand(state, {
    kind: 'transport.vehicle.start',
    vehicleId: 'loop-bus',
  });
}

function routeOwnedClosedLoopStarted() {
  const routes = structuredClone(json('routes.json')) as {
    routes: Array<{
      routeId: string;
      patterns: Array<{
        patternId: string;
        closesLoop: boolean;
        stopNodeIds: string[];
      }>;
    }>;
  };
  const route = routes.routes[0]!;
  const pattern = route.patterns[0]!;
  route.routeId = 'closed-loop-route';
  pattern.patternId = 'closed-loop-route-pattern';
  pattern.closesLoop = true;
  pattern.stopNodeIds = ['tv-stop-0108', 'tv-stop-0053', 'tv-stop-0078'];
  route.patterns = [pattern];
  const canonical = parseScenarioPackage({
    manifest: json('scenario.json'),
    settlements: json('settlements.json'),
    stops: json('stops.json'),
    routes,
    presentation: json('presentation.json'),
    provenance: json('provenance.json'),
  });
  let state = createTransportSimulationState(canonical, 0);
  state = applyTransportVehicleCommand(state, {
    kind: 'transport.vehicle.create-route-cycle',
    vehicleId: 'route-loop-bus',
    label: 'Route loop bus',
    routeId: 'closed-loop-route',
    legs: [
      {
        patternId: 'closed-loop-route-pattern',
        movementPlan: {
          kind: 'vehicle-movement-plan-v1',
          edgeTravelTicks: [2, 2, 2],
        },
      },
    ],
  });
  return applyTransportVehicleCommand(state, {
    kind: 'transport.vehicle.start',
    vehicleId: 'route-loop-bus',
  });
}

const repeatTicks = (
  state: ReturnType<typeof createTransportSimulationState>,
  count: number,
) => {
  let result = state;
  for (let index = 0; index < count; index += 1)
    result = advanceTransportTicks(result, 1);
  return result;
};

describe('light vehicle pattern runs and StopNode calls', () => {
  it('derives exact canonical pattern-run and StopNode-call coordinates', () => {
    const routeState = started();
    const routeVehicle = routeState.fleet[0]!;
    expect(
      canonicalVehicleCallCoordinate(routeState.graph, routeVehicle, 4, 2),
    ).toEqual(['return', 12]);

    const loopState = closedLoopStarted();
    expect(
      canonicalVehicleCallCoordinate(
        loopState.graph,
        loopState.fleet[0]!,
        10,
        2,
      ),
    ).toEqual(['closed-loop', 30]);
    expect(() =>
      canonicalVehicleCallCoordinate(routeState.graph, routeVehicle, 1, 3),
    ).toThrow(/run\/call/i);

    let standalone = createTransportSimulationState(scenario(), 0);
    standalone = applyTransportVehicleCommand(standalone, {
      kind: 'transport.vehicle.create',
      vehicleId: 'standalone-coordinate',
      label: 'Standalone coordinate',
      patternId: 'outbound',
      movementPlan: {
        kind: 'vehicle-movement-plan-v1',
        edgeTravelTicks: [1, 1],
      },
    });
    expect(
      canonicalVehicleCallCoordinate(
        standalone.graph,
        standalone.fleet[0]!,
        1,
        1,
      ),
    ).toEqual(['outbound', 2]);
    for (const run of [0, 2])
      expect(() =>
        canonicalVehicleCallCoordinate(
          standalone.graph,
          standalone.fleet[0]!,
          run,
          0,
        ),
      ).toThrow(/run\/call/i);
  });

  it('creates one immutable origin call and emits destinations only on arrival', () => {
    const initial = started();
    expect(initial.vehicleOperations).toEqual([
      expect.objectContaining({
        vehicleId: 'bus-1',
        patternRunSequence: 1,
        patternRunStartedAtTick: 0,
        stopCallSequence: 1,
      }),
    ]);
    expect(initial.currentStopCalls).toEqual([
      expect.objectContaining({
        vehicleId: 'bus-1',
        patternId: 'outbound',
        stopNodeId: 'tv-stop-0108',
        occurrenceIndex: 0,
        tick: 0,
        stopCallSequence: 1,
      }),
    ]);

    const firstArrival = advanceTransportTicks(initial, 1);
    expect(firstArrival.currentStopCalls).toEqual([
      expect.objectContaining({
        stopNodeId: 'tv-stop-0053',
        occurrenceIndex: 1,
        stopCallSequence: 2,
      }),
    ]);
    expect(Object.isFrozen(firstArrival.currentStopCalls)).toBe(true);
    expect(Object.isFrozen(firstArrival.currentStopCalls[0])).toBe(true);
  });

  it('preserves terminal timing and emits the next origin on the next positive tick', () => {
    const terminal = advanceTransportTicks(started(), 2);
    expect(terminal.fleet[0]?.movement).toMatchObject({
      kind: 'running-at-stop',
      stopNodeId: 'tv-stop-0078',
      nextEdgeSequence: 2,
    });
    expect(terminal.currentStopCalls).toEqual([
      expect.objectContaining({
        patternId: 'outbound',
        stopNodeId: 'tv-stop-0078',
        occurrenceIndex: 2,
        tick: 2,
        stopCallSequence: 3,
      }),
    ]);

    const handedOff = advanceTransportTicks(terminal, 1);
    expect(handedOff.vehicleOperations[0]).toMatchObject({
      patternRunSequence: 2,
      patternRunStartedAtTick: 3,
      stopCallSequence: 5,
    });
    expect(handedOff.currentStopCalls).toEqual([
      expect.objectContaining({
        patternId: 'return',
        stopNodeId: 'tv-stop-0067',
        occurrenceIndex: 0,
        tick: 3,
        stopCallSequence: 4,
      }),
      expect.objectContaining({
        patternId: 'return',
        stopNodeId: 'tv-stop-0053',
        occurrenceIndex: 1,
        tick: 3,
        stopCallSequence: 5,
      }),
    ]);
  });

  it('starts a new canonical run when a one-leg route cycle wraps to the same pattern', () => {
    const firstCircuitComplete = advanceTransportTicks(
      routeOwnedClosedLoopStarted(),
      6,
    );
    expect(firstCircuitComplete.fleet[0]).toMatchObject({
      routeId: 'closed-loop-route',
      routeLegIndex: 0,
      completedRouteCycles: 0,
      patternId: 'closed-loop-route-pattern',
      movement: {
        kind: 'running-at-stop',
        stopNodeId: 'tv-stop-0108',
        nextEdgeSequence: 3,
      },
    });
    expect(firstCircuitComplete.vehicleOperations[0]).toMatchObject({
      patternRunSequence: 1,
      patternRunStartedAtTick: 0,
      stopCallSequence: 4,
    });

    const secondRun = advanceTransportTicks(firstCircuitComplete, 1);
    expect(secondRun.fleet[0]).toMatchObject({
      routeId: 'closed-loop-route',
      routeLegIndex: 0,
      completedRouteCycles: 1,
      patternId: 'closed-loop-route-pattern',
      movement: {
        kind: 'running-on-edge',
        edgeSequence: 0,
        progressTicks: 1,
        travelTicks: 2,
      },
    });
    expect(secondRun.vehicleOperations[0]).toMatchObject({
      patternRunSequence: 2,
      patternRunStartedAtTick: 7,
      stopCallSequence: 5,
    });
    expect(secondRun.currentStopCalls).toEqual([
      {
        vehicleId: 'route-loop-bus',
        stopCallSequence: 5,
        patternRunSequence: 2,
        routeId: 'closed-loop-route',
        patternId: 'closed-loop-route-pattern',
        stopNodeId: 'tv-stop-0108',
        occurrenceIndex: 0,
        tick: 7,
      },
    ]);

    const firstArrivalOfSecondRun = advanceTransportTicks(secondRun, 1);
    expect(firstArrivalOfSecondRun.vehicleOperations[0]).toMatchObject({
      patternRunSequence: 2,
      patternRunStartedAtTick: 7,
      stopCallSequence: 6,
    });
    expect(firstArrivalOfSecondRun.currentStopCalls).toEqual([
      expect.objectContaining({
        stopCallSequence: 6,
        patternRunSequence: 2,
        occurrenceIndex: 1,
        tick: 8,
      }),
    ]);
  });

  it('issues exactly one new run and origin call at each repeated one-leg cycle boundary', () => {
    let state = routeOwnedClosedLoopStarted();
    for (const [index, boundaryTick] of [7, 13, 19].entries()) {
      state = advanceTransportTicks(state, boundaryTick - state.tick);
      const completedCycles = index + 1;
      expect(state.fleet[0]).toMatchObject({
        routeLegIndex: 0,
        completedRouteCycles: completedCycles,
        patternId: 'closed-loop-route-pattern',
      });
      expect(state.vehicleOperations[0]).toMatchObject({
        patternRunSequence: completedCycles + 1,
        patternRunStartedAtTick: boundaryTick,
        stopCallSequence: completedCycles * 4 + 1,
      });
      expect(state.currentStopCalls).toEqual([
        expect.objectContaining({
          stopCallSequence: completedCycles * 4 + 1,
          patternRunSequence: completedCycles + 1,
          patternId: 'closed-loop-route-pattern',
          stopNodeId: 'tv-stop-0108',
          occurrenceIndex: 0,
          tick: boundaryTick,
        }),
      ]);
    }
  });

  it('keeps split and batched advancement exact across repeated one-leg handoffs', () => {
    const initial = routeOwnedClosedLoopStarted();
    const batched = advanceTransportTicks(initial, 13);
    let split = initial;
    for (const partition of [5, 2, 5, 1])
      split = advanceTransportTicks(split, partition);

    expect(createTransportSimulationSnapshot(split)).toEqual(
      createTransportSimulationSnapshot(batched),
    );
    expect(batched.fleet[0]).toMatchObject({
      routeLegIndex: 0,
      completedRouteCycles: 2,
    });
    expect(batched.vehicleOperations[0]).toMatchObject({
      patternRunSequence: 3,
      patternRunStartedAtTick: 13,
      stopCallSequence: 9,
    });
    expect(batched.currentStopCalls).toEqual([
      expect.objectContaining({
        patternRunSequence: 3,
        stopCallSequence: 9,
        occurrenceIndex: 0,
        tick: 13,
      }),
    ]);
  });

  it('fast-forwards one-leg route cycles identically to repeated one-tick advancement', () => {
    const initial = routeOwnedClosedLoopStarted();
    const repeated = repeatTicks(initial, 121);
    const fastForwarded = advanceTransportTicks(initial, 121);

    expect(createTransportSimulationSnapshot(fastForwarded)).toEqual(
      createTransportSimulationSnapshot(repeated),
    );
    expect(fastForwarded.fleet[0]).toMatchObject({
      routeLegIndex: 0,
      completedRouteCycles: 20,
    });
    expect(fastForwarded.vehicleOperations[0]).toMatchObject({
      patternRunSequence: 21,
      patternRunStartedAtTick: 121,
      stopCallSequence: 81,
    });
    expect(fastForwarded.currentStopCalls).toEqual([
      expect.objectContaining({
        patternRunSequence: 21,
        stopCallSequence: 81,
        occurrenceIndex: 0,
        tick: 121,
      }),
    ]);
  });

  it('round-trips and continues exact one-leg route-cycle authority after a handoff', () => {
    const original = advanceTransportTicks(routeOwnedClosedLoopStarted(), 7);
    const restored = restoreTransportSimulationState(
      structuredClone(createTransportSimulationSnapshot(original)),
      original.scenario,
    );
    expect(createTransportSimulationSnapshot(restored)).toEqual(
      createTransportSimulationSnapshot(original),
    );

    const originalContinued = advanceTransportTicks(original, 12);
    const restoredContinued = advanceTransportTicks(restored, 12);
    expect(createTransportSimulationSnapshot(restoredContinued)).toEqual(
      createTransportSimulationSnapshot(originalContinued),
    );
    expect(restoredContinued.vehicleOperations[0]).toMatchObject({
      patternRunSequence: 4,
      patternRunStartedAtTick: 19,
      stopCallSequence: 13,
    });
  });

  it('increments ordinary multi-leg route cycles once per canonical leg handoff', () => {
    const returnHandoff = advanceTransportTicks(started(), 3);
    expect(returnHandoff.fleet[0]).toMatchObject({
      routeLegIndex: 1,
      completedRouteCycles: 0,
      patternId: 'return',
    });
    expect(returnHandoff.vehicleOperations[0]).toMatchObject({
      patternRunSequence: 2,
      patternRunStartedAtTick: 3,
      stopCallSequence: 5,
    });
    expect(returnHandoff.currentStopCalls).toEqual([
      expect.objectContaining({
        patternRunSequence: 2,
        patternId: 'return',
        stopCallSequence: 4,
        occurrenceIndex: 0,
      }),
      expect.objectContaining({
        patternRunSequence: 2,
        patternId: 'return',
        stopCallSequence: 5,
        occurrenceIndex: 1,
      }),
    ]);

    const wrapped = advanceTransportTicks(returnHandoff, 2);
    expect(wrapped.fleet[0]).toMatchObject({
      routeLegIndex: 0,
      completedRouteCycles: 1,
      patternId: 'outbound',
    });
    expect(wrapped.vehicleOperations[0]).toMatchObject({
      patternRunSequence: 3,
      patternRunStartedAtTick: 5,
      stopCallSequence: 8,
    });
  });

  it('preserves standalone closed-loop restarts and non-loop termination', () => {
    const loopRestart = advanceTransportTicks(closedLoopStarted(), 6);
    expect(loopRestart.fleet[0]?.routeLegs).toBeUndefined();
    expect(loopRestart.vehicleOperations[0]).toMatchObject({
      patternRunSequence: 2,
      patternRunStartedAtTick: 6,
      stopCallSequence: 4,
    });
    expect(loopRestart.currentStopCalls).toEqual([
      expect.objectContaining({
        routeId: null,
        patternRunSequence: 2,
        stopCallSequence: 4,
        occurrenceIndex: 0,
        tick: 6,
      }),
    ]);

    let nonLoop = createTransportSimulationState(scenario(), 0);
    nonLoop = applyTransportVehicleCommand(nonLoop, {
      kind: 'transport.vehicle.create',
      vehicleId: 'standalone-terminal',
      label: 'Standalone terminal',
      patternId: 'outbound',
      movementPlan: {
        kind: 'vehicle-movement-plan-v1',
        edgeTravelTicks: [1, 1],
      },
    });
    nonLoop = applyTransportVehicleCommand(nonLoop, {
      kind: 'transport.vehicle.start',
      vehicleId: 'standalone-terminal',
    });
    const completed = advanceTransportTicks(nonLoop, 2);
    expect(completed.fleet[0]?.movement).toEqual({
      kind: 'completed-at-stop',
      stopNodeId: 'tv-stop-0078',
    });
    expect(completed.vehicleOperations[0]).toMatchObject({
      patternRunSequence: 1,
      stopCallSequence: 3,
    });
    const afterCompletion = advanceTransportTicks(completed, 1);
    expect(afterCompletion.fleet[0]).toEqual(completed.fleet[0]);
    expect(afterCompletion.vehicleOperations[0]).toEqual(
      completed.vehicleOperations[0],
    );
    expect(afterCompletion.currentStopCalls).toEqual([]);
  });

  it('keeps batched and split authority identical and round-trips Snapshot V9', () => {
    const initial = started();
    const batched = advanceTransportTicks(initial, 7);
    let split = initial;
    for (let tick = 0; tick < 7; tick += 1)
      split = advanceTransportTicks(split, 1);
    expect(batched).toEqual(split);
    const snapshot = createTransportSimulationSnapshot(batched);
    expect(snapshot).toMatchObject({
      schemaVersion: 9,
      simulationVersion: 'transport-9',
      state: {
        vehicleOperations: batched.vehicleOperations,
        currentStopCalls: batched.currentStopCalls,
      },
    });
    expect(
      createTransportSimulationSnapshot(
        restoreTransportSimulationState(snapshot, scenario()),
      ),
    ).toEqual(snapshot);
  });

  it('matches waiting cohorts only by route, pattern, and directional StopNode', () => {
    const call = advanceTransportTicks(started(), 1).currentStopCalls[0]!;
    const cohort = {
      routeId: call.routeId,
      patternId: call.patternId,
      originStopNodeId: call.stopNodeId,
    };
    expect(vehicleCallCanServeWaitingCohort(call, cohort)).toBe(true);
    expect(
      vehicleCallCanServeWaitingCohort(call, {
        ...cohort,
        originStopNodeId: 'opposite-direction',
      }),
    ).toBe(false);
    expect(
      vehicleCallCanServeWaitingCohort(call, {
        ...cohort,
        patternId: 'another-pattern',
      }),
    ).toBe(false);
  });

  it('keeps Route C terminal and distinct-platform origin calls on consecutive ticks', () => {
    const publicRoot = join(
      import.meta.dirname,
      '..',
      '..',
      '..',
      'apps',
      'web',
      'public',
      'scenarios',
      'torrevieja-v1',
      'torrevieja-legacy-abc-v1',
    );
    const publicJson = (name: string) =>
      JSON.parse(readFileSync(join(publicRoot, name), 'utf8')) as unknown;
    const canonical = parseScenarioPackage({
      manifest: publicJson('scenario.json'),
      settlements: publicJson('settlements.json'),
      stops: publicJson('stops.json'),
      routes: publicJson('routes.json'),
      presentation: publicJson('presentation.json'),
      provenance: publicJson('provenance.json'),
    });
    const route = canonical.routes.routes.find(
      ({ routeId }) => routeId === 'legacy-C',
    )!;
    let state = createTransportSimulationState(canonical, 0);
    state = applyTransportVehicleCommand(state, {
      kind: 'transport.vehicle.create-route-cycle',
      vehicleId: 'route-c-bus',
      label: 'Route C bus',
      routeId: route.routeId,
      legs: route.patterns.map((pattern) => ({
        patternId: pattern.patternId,
        movementPlan: {
          kind: 'vehicle-movement-plan-v1',
          edgeTravelTicks: Array.from(
            {
              length: pattern.stopNodeIds.length - (pattern.closesLoop ? 0 : 1),
            },
            () => 1,
          ),
        },
      })),
    });
    state = applyTransportVehicleCommand(state, {
      kind: 'transport.vehicle.start',
      vehicleId: 'route-c-bus',
    });
    const outboundEdges = route.patterns[0]!.stopNodeIds.length - 1;
    const terminal = advanceTransportTicks(state, outboundEdges);
    expect(terminal.currentStopCalls.at(-1)).toMatchObject({
      stopNodeId: 'tv-stop-0207',
      patternRunSequence: 1,
      tick: outboundEdges,
    });
    const handoff = advanceTransportTicks(terminal, 1);
    expect(handoff.currentStopCalls[0]).toMatchObject({
      stopNodeId: 'tv-stop-0209',
      patternRunSequence: 2,
      tick: outboundEdges + 1,
    });
    expect(
      terminal.graph
        .outgoingEdges('tv-stop-0207')
        .some(({ toStopNodeId }) => toStopNodeId === 'tv-stop-0209'),
    ).toBe(false);
  });

  it('rejects corrupted operating authority without normalizing it', () => {
    const snapshot = createTransportSimulationSnapshot(
      advanceTransportTicks(started(), 1),
    );
    const futureStart = structuredClone(snapshot);
    futureStart.state.vehicleOperations[0]!.patternRunStartedAtTick = 2;
    expect(() =>
      restoreTransportSimulationState(futureStart, scenario()),
    ).toThrow('future');
    const wrongOccurrence = structuredClone(snapshot);
    wrongOccurrence.state.currentStopCalls[0]!.occurrenceIndex = 0;
    expect(() =>
      restoreTransportSimulationState(wrongOccurrence, scenario()),
    ).toThrow('canonical');
    const missing = structuredClone(snapshot);
    missing.state.vehicleOperations = [];
    expect(() => restoreTransportSimulationState(missing, scenario())).toThrow(
      'match the fleet',
    );

    const corruptions: Array<[string, (value: typeof snapshot) => void]> = [
      [
        'same order',
        (value) => {
          value.state.vehicleOperations[0]!.vehicleId = 'unknown';
        },
      ],
      [
        'sequence',
        (value) => {
          value.state.vehicleOperations[0]!.patternRunSequence = 2;
        },
      ],
      [
        'canonical',
        (value) => {
          value.state.currentStopCalls[0]!.tick = 0;
        },
      ],
      [
        'canonical',
        (value) => {
          value.state.currentStopCalls[0]!.routeId = 'missing';
        },
      ],
      [
        'counter',
        (value) => {
          value.state.vehicleOperations[0]!.stopCallSequence += 1;
        },
      ],
    ];
    for (const [message, mutate] of corruptions) {
      const value = structuredClone(snapshot);
      mutate(value);
      expect(() => restoreTransportSimulationState(value, scenario())).toThrow(
        message,
      );
    }

    const initial = structuredClone(
      createTransportSimulationSnapshot(started()),
    );
    initial.state.currentStopCalls = [];
    expect(() => restoreTransportSimulationState(initial, scenario())).toThrow(
      /current/i,
    );

    const twoCalls = createTransportSimulationSnapshot(
      advanceTransportTicks(advanceTransportTicks(started(), 2), 1),
    );
    const noncontiguous = structuredClone(twoCalls);
    noncontiguous.state.currentStopCalls[1]!.stopCallSequence += 1;
    noncontiguous.state.vehicleOperations[0]!.stopCallSequence += 1;
    expect(() =>
      restoreTransportSimulationState(noncontiguous, scenario()),
    ).toThrow('counter');
    const unordered = structuredClone(twoCalls);
    unordered.state.currentStopCalls.reverse();
    expect(() =>
      restoreTransportSimulationState(unordered, scenario()),
    ).toThrow('canonical');
  });

  it('emits no call while partway along an edge and does not repeat an arrival', () => {
    let state = createTransportSimulationState(scenario(), 0);
    state = applyTransportVehicleCommand(state, {
      kind: 'transport.vehicle.create-route-cycle',
      vehicleId: 'slow',
      label: 'Slow',
      routeId: 'route-a',
      legs: [
        {
          patternId: 'outbound',
          movementPlan: {
            kind: 'vehicle-movement-plan-v1',
            edgeTravelTicks: [2, 2],
          },
        },
        {
          patternId: 'return',
          movementPlan: {
            kind: 'vehicle-movement-plan-v1',
            edgeTravelTicks: [2, 2],
          },
        },
      ],
    });
    state = applyTransportVehicleCommand(state, {
      kind: 'transport.vehicle.start',
      vehicleId: 'slow',
    });
    const midEdge = advanceTransportTicks(state, 1);
    expect(midEdge.currentStopCalls).toEqual([]);
    const arrival = advanceTransportTicks(midEdge, 1);
    expect(arrival.currentStopCalls).toHaveLength(1);
    expect(advanceTransportTicks(arrival, 1).currentStopCalls).toEqual([]);
  });

  it('rejects sequence overflow before publishing a call', () => {
    const value = structuredClone(createTransportSimulationSnapshot(started()));
    value.state.vehicleOperations[0]!.stopCallSequence =
      Number.MAX_SAFE_INTEGER;
    value.state.currentStopCalls[0]!.stopCallSequence = Number.MAX_SAFE_INTEGER;
    expect(() => restoreTransportSimulationState(value, scenario())).toThrow(
      'counter',
    );

    const current = started();
    const overflowing = {
      ...current,
      vehicleOperations: [
        {
          ...current.vehicleOperations[0]!,
          patternRunSequence: Number.MAX_SAFE_INTEGER,
          stopCallSequence: Number.MAX_SAFE_INTEGER,
        },
      ],
    };
    expect(() => advanceTransportTicks(overflowing, 10_001)).toThrow(
      'operating sequence overflow',
    );
  });

  it('fast-forwards to an on-edge route position without losing run timing', () => {
    const advanced = advanceTransportTicks(
      started([
        [2, 3],
        [5, 7],
      ]),
      10_003,
    );
    expect(advanced.fleet[0]?.movement.kind).toBe('running-on-edge');
    expect(
      advanced.vehicleOperations[0]!.patternRunStartedAtTick,
    ).toBeLessThanOrEqual(advanced.tick);
  });

  it('fast-forwards a closed loop from a later occurrence', () => {
    let state = closedLoopStarted();
    state = advanceTransportTicks(state, 2);
    const oneTick = advanceTransportTicks(state, 1);
    expect(
      fastForwardVehicleOperation({
        graph: state.graph,
        before: state.fleet[0]!,
        after: oneTick.fleet[0]!,
        operation: state.vehicleOperations[0]!,
        tick: oneTick.tick,
        advancement: 1,
      }).patternRunSequence,
    ).toBe(state.vehicleOperations[0]!.patternRunSequence);
    const advanced = advanceTransportTicks(state, 10_001);
    expect(advanced.vehicleOperations[0]!.stopCallSequence).toBeGreaterThan(
      state.vehicleOperations[0]!.stopCallSequence,
    );
    expect(advanced.vehicleOperations[0]!.patternRunSequence).toBeGreaterThan(
      state.vehicleOperations[0]!.patternRunSequence,
    );
  });

  it.each([
    ['occurrence zero', 0],
    ['later stop occurrence', 2],
    ['partway through an edge', 3],
    ['immediately before restart', 5],
    ['immediately after restart', 6],
  ])(
    'matches 10,001 one-tick closed-loop reductions from %s',
    (_label, offset) => {
      const state = repeatTicks(closedLoopStarted(), offset);
      const reference = repeatTicks(state, 10_001);
      const batched = advanceTransportTicks(state, 10_001);
      expect({
        tick: batched.tick,
        fleet: batched.fleet,
        vehicleOperations: batched.vehicleOperations,
        currentStopCalls: batched.currentStopCalls,
      }).toEqual({
        tick: reference.tick,
        fleet: reference.fleet,
        vehicleOperations: reference.vehicleOperations,
        currentStopCalls: reference.currentStopCalls,
      });
      expect(batched.vehicleOperations[0]!.stopCallSequence).toBe(
        reference.vehicleOperations[0]!.stopCallSequence,
      );
    },
    15_000,
  );

  it('preserves a parked vehicle run start until an actual run boundary', () => {
    let state = createTransportSimulationState(scenario(), 0);
    state = applyTransportVehicleCommand(state, {
      kind: 'transport.vehicle.create-route-cycle',
      vehicleId: 'late-start',
      label: 'Late start',
      routeId: 'route-a',
      legs: [
        {
          patternId: 'outbound',
          movementPlan: {
            kind: 'vehicle-movement-plan-v1',
            edgeTravelTicks: [10_000, 10_000],
          },
        },
        {
          patternId: 'return',
          movementPlan: {
            kind: 'vehicle-movement-plan-v1',
            edgeTravelTicks: [10_000, 10_000],
          },
        },
      ],
    });
    state = advanceTransportTicks(state, 7);
    state = applyTransportVehicleCommand(state, {
      kind: 'transport.vehicle.start',
      vehicleId: 'late-start',
    });
    const reference = repeatTicks(state, 1_001);
    const batched = advanceTransportTicks(state, 1_001);
    expect(batched).toEqual(reference);
    expect(batched.vehicleOperations[0]!.patternRunStartedAtTick).toBe(0);

    const crossingReference = repeatTicks(state, 20_001);
    const crossingBatch = advanceTransportTicks(state, 20_001);
    expect(crossingBatch).toEqual(crossingReference);
    expect(crossingBatch.vehicleOperations[0]!.patternRunStartedAtTick).toBe(
      crossingReference.vehicleOperations[0]!.patternRunStartedAtTick,
    );
  }, 15_000);

  it('rejects positional operation swaps and exact counter corruption', () => {
    let state = started();
    state = applyTransportVehicleCommand(state, {
      kind: 'transport.vehicle.create-route-cycle',
      vehicleId: 'bus-2',
      label: 'Bus 2',
      routeId: 'route-a',
      legs: [
        {
          patternId: 'outbound',
          movementPlan: {
            kind: 'vehicle-movement-plan-v1',
            edgeTravelTicks: [2, 3],
          },
        },
        {
          patternId: 'return',
          movementPlan: {
            kind: 'vehicle-movement-plan-v1',
            edgeTravelTicks: [4, 5],
          },
        },
      ],
    });
    state = advanceTransportTicks(state, 3);
    const snapshot = createTransportSimulationSnapshot(state);
    const reversed = structuredClone(snapshot);
    reversed.state.vehicleOperations.reverse();
    expect(() => restoreTransportSimulationState(reversed, scenario())).toThrow(
      /same order/i,
    );

    for (const field of ['patternRunSequence', 'stopCallSequence'] as const) {
      for (const delta of [-1, 1]) {
        const corrupt = structuredClone(snapshot);
        corrupt.state.vehicleOperations[0]![field] += delta;
        expect(() =>
          restoreTransportSimulationState(corrupt, scenario()),
        ).toThrow(/counter|sequence/i);
      }
    }
  });

  it('rejects calls that are canonical-looking but false for the current tick', () => {
    const arrival = createTransportSimulationSnapshot(
      advanceTransportTicks(started(), 1),
    );
    const corruptions: Array<(value: typeof arrival) => void> = [
      (value) => {
        value.state.currentStopCalls[0]!.stopNodeId = 'tv-stop-0078';
        value.state.currentStopCalls[0]!.occurrenceIndex = 2;
      },
      (value) => {
        value.state.currentStopCalls[0]!.patternId = 'return';
      },
      (value) => {
        value.state.currentStopCalls[0]!.routeId = null;
      },
      (value) => {
        value.state.currentStopCalls = [];
      },
    ];
    for (const corrupt of corruptions) {
      const value = structuredClone(arrival);
      corrupt(value);
      expect(() => restoreTransportSimulationState(value, scenario())).toThrow(
        /current|canonical|call/i,
      );
    }

    const midEdge = createTransportSimulationSnapshot(
      advanceTransportTicks(
        started([
          [2, 2],
          [2, 2],
        ]),
        1,
      ),
    );
    const extra = structuredClone(midEdge);
    extra.state.currentStopCalls = [
      {
        ...arrival.state.currentStopCalls[0]!,
        tick: extra.state.tick,
      },
    ];
    expect(() => restoreTransportSimulationState(extra, scenario())).toThrow(
      /current|canonical|call/i,
    );

    const afterArrival = advanceTransportTicks(
      advanceTransportTicks(
        started([
          [2, 2],
          [2, 2],
        ]),
        2,
      ),
      1,
    );
    const relabelled = structuredClone(
      createTransportSimulationSnapshot(afterArrival),
    );
    relabelled.state.currentStopCalls = [
      {
        ...arrival.state.currentStopCalls[0]!,
        tick: relabelled.state.tick,
      },
    ];
    expect(() =>
      restoreTransportSimulationState(relabelled, scenario()),
    ).toThrow(/current|canonical|call/i);
  });

  it('derives exact counters for route, closed-loop, and non-loop vehicles', () => {
    const routeSnapshot = createTransportSimulationSnapshot(
      advanceTransportTicks(started(), 3),
    );
    const closedSnapshot = createTransportSimulationSnapshot(
      repeatTicks(closedLoopStarted(), 7),
    );
    let nonLoop = createTransportSimulationState(scenario(), 0);
    nonLoop = applyTransportVehicleCommand(nonLoop, {
      kind: 'transport.vehicle.create',
      vehicleId: 'one-way',
      label: 'One way',
      patternId: 'outbound',
      movementPlan: {
        kind: 'vehicle-movement-plan-v1',
        edgeTravelTicks: [1, 1],
      },
    });
    nonLoop = applyTransportVehicleCommand(nonLoop, {
      kind: 'transport.vehicle.start',
      vehicleId: 'one-way',
    });
    const nonLoopSnapshot = createTransportSimulationSnapshot(
      advanceTransportTicks(nonLoop, 2),
    );
    for (const [label, snapshot, canonical] of [
      ['route', routeSnapshot, scenario()],
      ['closed loop', closedSnapshot, closedLoopStarted().scenario],
      ['non-loop', nonLoopSnapshot, scenario()],
    ] as const) {
      expect(
        () => restoreTransportSimulationState(snapshot, canonical),
        label,
      ).not.toThrow();
      for (const field of ['patternRunSequence', 'stopCallSequence'] as const) {
        for (const delta of [-1, 1]) {
          const corrupt = structuredClone(snapshot);
          corrupt.state.vehicleOperations[0]![field] += delta;
          expect(() =>
            restoreTransportSimulationState(corrupt, canonical),
          ).toThrow(/counter|sequence|run start/i);
        }
      }
    }
  });

  it('validates the exact origin arrival of a route-owned closed loop', () => {
    const state = advanceTransportTicks(routeOwnedClosedLoopStarted(), 6);

    expect(state).toMatchObject({
      tick: 6,
      fleet: [
        {
          routeLegIndex: 0,
          completedRouteCycles: 0,
          movement: {
            kind: 'running-at-stop',
            nextEdgeSequence: 3,
          },
        },
      ],
      vehicleOperations: [
        {
          patternRunSequence: 1,
          stopCallSequence: 4,
        },
      ],
      currentStopCalls: [
        {
          patternRunSequence: 1,
          stopCallSequence: 4,
          occurrenceIndex: 0,
          tick: 6,
        },
      ],
    });
    expect(() =>
      restoreTransportSimulationState(
        createTransportSimulationSnapshot(state),
        state.scenario,
      ),
    ).not.toThrow();
  });

  it('validates parked, early-run, and later-run standalone loop authority', () => {
    const canonical = closedLoopStarted().scenario;
    let parked = createTransportSimulationState(canonical, 0);
    parked = applyTransportVehicleCommand(parked, {
      kind: 'transport.vehicle.create',
      vehicleId: 'parked-loop',
      label: 'Parked loop',
      patternId: 'closed-loop',
      movementPlan: {
        kind: 'vehicle-movement-plan-v1',
        edgeTravelTicks: [2, 2, 2],
      },
    });
    expect(() =>
      restoreTransportSimulationState(
        createTransportSimulationSnapshot(parked),
        canonical,
      ),
    ).not.toThrow();

    const early = advanceTransportTicks(closedLoopStarted(), 1);
    expect(() =>
      restoreTransportSimulationState(
        createTransportSimulationSnapshot(early),
        canonical,
      ),
    ).not.toThrow();
    const invalidEarlyRunStart = structuredClone(
      createTransportSimulationSnapshot(early),
    );
    invalidEarlyRunStart.state.vehicleOperations[0]!.patternRunStartedAtTick = 1;
    expect(() =>
      restoreTransportSimulationState(invalidEarlyRunStart, canonical),
    ).toThrow(/run start/i);

    const laterRunArrival = advanceTransportTicks(closedLoopStarted(), 8);
    expect(laterRunArrival).toMatchObject({
      tick: 8,
      vehicleOperations: [
        {
          patternRunSequence: 2,
          patternRunStartedAtTick: 6,
          stopCallSequence: 5,
        },
      ],
      currentStopCalls: [
        {
          patternRunSequence: 2,
          occurrenceIndex: 1,
          tick: 8,
        },
      ],
    });
    expect(() =>
      restoreTransportSimulationState(
        createTransportSimulationSnapshot(laterRunArrival),
        canonical,
      ),
    ).not.toThrow();
  });

  it('round-trips each canonical current-call shape', () => {
    const initial = started();
    const ordinaryArrival = advanceTransportTicks(initial, 1);
    const terminal = advanceTransportTicks(initial, 2);
    const handoffAndArrival = advanceTransportTicks(terminal, 1);
    const closedRestart = repeatTicks(closedLoopStarted(), 6);
    for (const state of [
      initial,
      ordinaryArrival,
      terminal,
      handoffAndArrival,
      closedRestart,
    ])
      expect(
        restoreTransportSimulationState(
          createTransportSimulationSnapshot(state),
          state.scenario,
        ).currentStopCalls,
      ).toEqual(state.currentStopCalls);
  });

  it('defensively rejects transitions across different vehicle identities', () => {
    const state = started();
    const after = advanceTransportTicks(state, 1);
    expect(() =>
      deriveVehicleOperationTransition({
        graph: state.graph,
        before: state.fleet[0]!,
        after: { ...after.fleet[0]!, vehicleId: 'another-bus' },
        operation: state.vehicleOperations[0]!,
        tick: after.tick,
      }),
    ).toThrow(/vehicle identity/i);
    expect(() =>
      fastForwardVehicleOperation({
        graph: state.graph,
        before: state.fleet[0]!,
        after: { ...after.fleet[0]!, vehicleId: 'another-bus' },
        operation: state.vehicleOperations[0]!,
        tick: after.tick,
        advancement: 1,
      }),
    ).toThrow(/vehicle identity/i);
  });

  it('checks cumulative loop arithmetic and operation additions for overflow', () => {
    expect(() =>
      completedLoopEventsAtElapsedTick(
        [Number.MAX_SAFE_INTEGER, 1],
        Number.MAX_SAFE_INTEGER,
      ),
    ).toThrow(/vehicle operation overflow/i);
    const state = closedLoopStarted();
    const after = advanceTransportTicks(state, 1);
    expect(() =>
      fastForwardVehicleOperation({
        graph: state.graph,
        before: state.fleet[0]!,
        after: after.fleet[0]!,
        operation: {
          ...state.vehicleOperations[0]!,
          stopCallSequence: Number.MAX_SAFE_INTEGER,
        },
        tick: after.tick,
        advancement: 2,
      }),
    ).toThrow(/operating sequence overflow/i);
    const arriving = started();
    const arrived = advanceTransportTicks(arriving, 1);
    expect(() =>
      deriveVehicleOperationTransition({
        graph: arriving.graph,
        before: arriving.fleet[0]!,
        after: arrived.fleet[0]!,
        operation: {
          ...arriving.vehicleOperations[0]!,
          stopCallSequence: Number.MAX_SAFE_INTEGER,
        },
        tick: arrived.tick,
      }),
    ).toThrow(/vehicle operation overflow/i);

    const routeState = started();
    expect(() =>
      fastForwardVehicleOperation({
        graph: routeState.graph,
        before: routeState.fleet[0]!,
        after: {
          ...routeState.fleet[0]!,
          completedRouteCycles: Number.MAX_SAFE_INTEGER,
        },
        operation: routeState.vehicleOperations[0]!,
        tick: Number.MAX_SAFE_INTEGER,
        advancement: 1,
      }),
    ).toThrow(/vehicle operation overflow/i);
  });

  it('validates parked authority and a completed vehicle after its call tick', () => {
    let parked = createTransportSimulationState(scenario(), 0);
    parked = applyTransportVehicleCommand(parked, {
      kind: 'transport.vehicle.create',
      vehicleId: 'parked',
      label: 'Parked',
      patternId: 'outbound',
      movementPlan: {
        kind: 'vehicle-movement-plan-v1',
        edgeTravelTicks: [1, 1],
      },
    });
    expect(() =>
      restoreTransportSimulationState(
        createTransportSimulationSnapshot(parked),
        scenario(),
      ),
    ).not.toThrow();
    let completed = applyTransportVehicleCommand(parked, {
      kind: 'transport.vehicle.start',
      vehicleId: 'parked',
    });
    completed = advanceTransportTicks(completed, 3);
    expect(completed.currentStopCalls).toEqual([]);
    expect(() =>
      restoreTransportSimulationState(
        createTransportSimulationSnapshot(completed),
        scenario(),
      ),
    ).not.toThrow();
  });

  it('derives standalone terminal-call truth from canonical event timing', () => {
    let state = createTransportSimulationState(scenario(), 0);
    state = applyTransportVehicleCommand(state, {
      kind: 'transport.vehicle.create',
      vehicleId: 'terminal-truth',
      label: 'Terminal truth',
      patternId: 'outbound',
      movementPlan: {
        kind: 'vehicle-movement-plan-v1',
        edgeTravelTicks: [1, 1],
      },
    });
    state = applyTransportVehicleCommand(state, {
      kind: 'transport.vehicle.start',
      vehicleId: 'terminal-truth',
    });
    const terminal = advanceTransportTicks(state, 2);
    expect(terminal.tick).toBe(2);
    expect(terminal.fleet[0]!.movement.kind).toBe('completed-at-stop');
    expect(terminal.currentStopCalls).toEqual([
      expect.objectContaining({
        vehicleId: 'terminal-truth',
        occurrenceIndex: 2,
        tick: 2,
      }),
    ]);

    const missing = structuredClone(
      createTransportSimulationSnapshot(terminal),
    );
    missing.state.currentStopCalls = [];
    expect(() => restoreTransportSimulationState(missing, scenario())).toThrow(
      /current|terminal|call/i,
    );

    const oneTickLater = advanceTransportTicks(terminal, 1);
    expect(oneTickLater.currentStopCalls).toEqual([]);
    for (const later of [
      oneTickLater,
      advanceTransportTicks(terminal, 10_000),
    ]) {
      const fabricated = structuredClone(
        createTransportSimulationSnapshot(later),
      );
      fabricated.state.currentStopCalls = [
        {
          ...terminal.currentStopCalls[0]!,
          tick: fabricated.state.tick,
        },
      ];
      expect(() =>
        restoreTransportSimulationState(fabricated, scenario()),
      ).toThrow(/current|terminal|call/i);
    }
  });

  it('rejects a fabricated run start and origin beside an ordinary arrival', () => {
    const arrival = advanceTransportTicks(
      started([
        [2, 2],
        [2, 2],
      ]),
      2,
    );
    expect(arrival.currentStopCalls).toHaveLength(1);
    const fabricated = structuredClone(
      createTransportSimulationSnapshot(arrival),
    );
    fabricated.state.vehicleOperations[0]!.patternRunStartedAtTick =
      fabricated.state.tick;
    fabricated.state.currentStopCalls.unshift({
      ...fabricated.state.currentStopCalls[0]!,
      stopCallSequence:
        fabricated.state.currentStopCalls[0]!.stopCallSequence - 1,
      occurrenceIndex: 0,
      stopNodeId: 'tv-stop-0108',
    });
    expect(() =>
      restoreTransportSimulationState(fabricated, scenario()),
    ).toThrow(/run|origin|current|canonical/i);
  });

  it('rejects movement and run timestamps that cannot produce canonical movement', () => {
    let parked = createTransportSimulationState(scenario(), 0);
    parked = applyTransportVehicleCommand(parked, {
      kind: 'transport.vehicle.create',
      vehicleId: 'timing-truth',
      label: 'Timing truth',
      patternId: 'outbound',
      movementPlan: {
        kind: 'vehicle-movement-plan-v1',
        edgeTravelTicks: [2, 2],
      },
    });
    const movingParked = structuredClone(
      createTransportSimulationSnapshot(parked),
    );
    movingParked.state.vehicleOperations[0]!.movementStartedAtTick = 0;
    expect(() =>
      restoreTransportSimulationState(movingParked, scenario()),
    ).toThrow(/movement-start/i);

    const active = applyTransportVehicleCommand(parked, {
      kind: 'transport.vehicle.start',
      vehicleId: 'timing-truth',
    });
    for (const invalidStart of [null, 1]) {
      const malformed = structuredClone(
        createTransportSimulationSnapshot(active),
      );
      malformed.state.vehicleOperations[0]!.movementStartedAtTick =
        invalidStart;
      expect(() =>
        restoreTransportSimulationState(malformed, scenario()),
      ).toThrow(/movement-start/i);
    }

    const arrival = advanceTransportTicks(active, 2);
    const shiftedStart = structuredClone(
      createTransportSimulationSnapshot(arrival),
    );
    shiftedStart.state.vehicleOperations[0]!.movementStartedAtTick = 1;
    expect(() =>
      restoreTransportSimulationState(shiftedStart, scenario()),
    ).toThrow(/movement-start/i);

    const routeHandoff = advanceTransportTicks(started(), 3);
    const shiftedRouteRun = structuredClone(
      createTransportSimulationSnapshot(routeHandoff),
    );
    shiftedRouteRun.state.vehicleOperations[0]!.patternRunStartedAtTick = 2;
    expect(() =>
      restoreTransportSimulationState(shiftedRouteRun, scenario()),
    ).toThrow(/run start tick|canonical/i);

    const loopRestart = advanceTransportTicks(closedLoopStarted(), 6);
    const shiftedLoopRun = structuredClone(
      createTransportSimulationSnapshot(loopRestart),
    );
    shiftedLoopRun.state.vehicleOperations[0]!.patternRunStartedAtTick = 5;
    expect(() =>
      restoreTransportSimulationState(shiftedLoopRun, loopRestart.scenario),
    ).toThrow(/run start tick|canonical/i);
  });
});
