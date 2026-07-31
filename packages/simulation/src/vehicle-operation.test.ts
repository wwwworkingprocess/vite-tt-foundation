import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import {
  advanceTransportTicks,
  applyTransportVehicleCommand,
  createTransportSimulationSnapshot,
  createTransportSimulationState,
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

describe('light vehicle pattern runs and StopNode calls', () => {
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

  it('keeps batched and split authority identical and round-trips Snapshot V7', () => {
    const initial = started();
    const batched = advanceTransportTicks(initial, 7);
    let split = initial;
    for (let tick = 0; tick < 7; tick += 1)
      split = advanceTransportTicks(split, 1);
    expect(batched).toEqual(split);
    const snapshot = createTransportSimulationSnapshot(batched);
    expect(snapshot).toMatchObject({
      schemaVersion: 7,
      simulationVersion: 'transport-7',
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
    ).toThrow('canonical authority');
    const missing = structuredClone(snapshot);
    missing.state.vehicleOperations = [];
    expect(() => restoreTransportSimulationState(missing, scenario())).toThrow(
      'match the fleet',
    );

    const corruptions: Array<[string, (value: typeof snapshot) => void]> = [
      [
        'identity',
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
        'authority',
        (value) => {
          value.state.currentStopCalls[0]!.tick = 0;
        },
      ],
      [
        'canonical authority',
        (value) => {
          value.state.currentStopCalls[0]!.routeId = 'missing';
        },
      ],
      [
        'persisted counter',
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
      'origin call',
    );

    const twoCalls = createTransportSimulationSnapshot(
      advanceTransportTicks(advanceTransportTicks(started(), 2), 1),
    );
    const noncontiguous = structuredClone(twoCalls);
    noncontiguous.state.currentStopCalls[1]!.stopCallSequence += 1;
    noncontiguous.state.vehicleOperations[0]!.stopCallSequence += 1;
    expect(() =>
      restoreTransportSimulationState(noncontiguous, scenario()),
    ).toThrow('contiguous');
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
    const restored = restoreTransportSimulationState(value, scenario());
    expect(() => advanceTransportTicks(restored, 1)).toThrow(
      'StopNode-call sequence overflow',
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
    state = applyTransportVehicleCommand(state, {
      kind: 'transport.vehicle.start',
      vehicleId: 'loop-bus',
    });
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
});
