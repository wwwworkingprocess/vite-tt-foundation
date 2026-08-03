import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import {
  advanceTransportTicks,
  advanceVehicleFleet,
  applyTransportVehicleCommand,
  createTransportSimulationSnapshot,
  createTransportSimulationState,
  parseTickAdvancement,
  parseVehicleId,
  parseVehicleMovementPlan,
  restoreTransportSimulationState,
  type TransportSimulationState,
} from './index.js';

const fixtureRoot = join(
  import.meta.dirname,
  '..',
  '..',
  'transport-domain',
  'fixtures',
  'torrevieja-mini-v1',
);
const json = (name: string) =>
  JSON.parse(readFileSync(join(fixtureRoot, name), 'utf8')) as unknown;
const scenario = () =>
  parseScenarioPackage({
    manifest: json('scenario.json'),
    settlements: json('settlements.json'),
    stops: json('stops.json'),
    routes: json('routes.json'),
    presentation: json('presentation.json'),
    provenance: json('provenance.json'),
  });
const loopScenario = () => {
  const routes = structuredClone(json('routes.json')) as {
    routes: Array<{
      patterns: Array<{ closesLoop: boolean; stopNodeIds: string[] }>;
    }>;
  };
  routes.routes[0]!.patterns[0]!.closesLoop = true;
  routes.routes[0]!.patterns[0]!.stopNodeIds = ['tv-stop-0108', 'tv-stop-0053'];
  return parseScenarioPackage({
    manifest: json('scenario.json'),
    settlements: json('settlements.json'),
    stops: json('stops.json'),
    routes,
    presentation: json('presentation.json'),
    provenance: json('provenance.json'),
  });
};
const patternId = 'legacy-A2-torrevieja-la-mata';
const createCommand = (id = 'vehicle-x', ticks = [3, 4, 5, 6]) => ({
  kind: 'transport.vehicle.create',
  vehicleId: id,
  label: `Vehicle ${id}`,
  patternId,
  movementPlan: { kind: 'vehicle-movement-plan-v1', edgeTravelTicks: ticks },
});
const started = (id = 'vehicle-x', ticks = [3, 4, 5, 6]) => {
  const created = applyTransportVehicleCommand(
    createTransportSimulationState(scenario(), 40),
    createCommand(id, ticks),
  );
  return applyTransportVehicleCommand(created, {
    kind: 'transport.vehicle.start',
    vehicleId: id,
  });
};
const vehicle = (state: TransportSimulationState, index = 0) =>
  state.fleet[index];

describe('vehicle identity and movement plans', () => {
  it('parses deterministic canonical IDs and rejects malformed IDs', () => {
    expect(parseVehicleId('vehicle.demo-1')).toBe('vehicle.demo-1');
    for (const value of ['', ' vehicle', 'vehicle space', 1, undefined])
      expect(() => parseVehicleId(value)).toThrow();
  });

  it('clones and deeply freezes exact positive-safe-integer plans', () => {
    const ticks = [3, 4, 5, 6];
    const plan = parseVehicleMovementPlan(
      { kind: 'vehicle-movement-plan-v1', edgeTravelTicks: ticks },
      4,
    );
    ticks[0] = 99;
    expect(plan.edgeTravelTicks).toEqual([3, 4, 5, 6]);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.edgeTravelTicks)).toBe(true);
    for (const invalid of [
      [],
      [1],
      [1, 2, 3],
      [1, 2, 3, 4, 5],
      [0, 2, 3, 4],
      [-1, 2, 3, 4],
      [1.5, 2, 3, 4],
      [Number.POSITIVE_INFINITY, 2, 3, 4],
      [Number.NaN, 2, 3, 4],
      [Number.MAX_SAFE_INTEGER + 1, 2, 3, 4],
    ])
      expect(() =>
        parseVehicleMovementPlan(
          { kind: 'vehicle-movement-plan-v1', edgeTravelTicks: invalid },
          4,
        ),
      ).toThrow();
  });

  it('preserves an explicit passenger capacity on a created vehicle', () => {
    const state = applyTransportVehicleCommand(
      createTransportSimulationState(scenario(), 0),
      { ...createCommand('capacity-bus'), passengerCapacity: 17 },
    );

    expect(state.vehicleCapacities).toEqual([
      { vehicleId: 'capacity-bus', passengerCapacity: 17 },
    ]);
  });

  it('creates ordered parked vehicles and starts without consuming a tick', () => {
    let state = createTransportSimulationState(scenario(), 40);
    state = applyTransportVehicleCommand(state, createCommand('vehicle-x'));
    state = applyTransportVehicleCommand(state, createCommand('vehicle-y'));
    expect(state.fleet.map(({ vehicleId }) => vehicleId)).toEqual([
      'vehicle-x',
      'vehicle-y',
    ]);
    expect(vehicle(state)?.movement).toEqual({
      kind: 'parked-at-stop',
      stopNodeId: 'tv-stop-0108',
      nextEdgeSequence: 0,
    });
    const next = applyTransportVehicleCommand(state, {
      kind: 'transport.vehicle.start',
      vehicleId: 'vehicle-x',
    });
    expect(next.tick).toBe(40);
    expect(vehicle(next)?.movement).toEqual({
      kind: 'running-at-stop',
      stopNodeId: 'tv-stop-0108',
      nextEdgeSequence: 0,
    });
    expect(Object.isFrozen(next.fleet)).toBe(true);
    expect(Object.isFrozen(vehicle(next))).toBe(true);
  });

  it('rejects duplicate IDs, missing patterns, empty labels, and invalid starts without mutation', () => {
    const initial = createTransportSimulationState(scenario(), 0);
    const created = applyTransportVehicleCommand(initial, createCommand());
    for (const command of [
      createCommand(),
      { ...createCommand('missing'), patternId: 'missing-pattern' },
      { ...createCommand('empty-label'), label: '' },
      { kind: 'transport.vehicle.start', vehicleId: 'missing' },
    ]) {
      expect(() => applyTransportVehicleCommand(created, command)).toThrow();
      expect(created.fleet).toHaveLength(1);
      expect(created.tick).toBe(0);
    }
    const running = applyTransportVehicleCommand(created, {
      kind: 'transport.vehicle.start',
      vehicleId: 'vehicle-x',
    });
    expect(() =>
      applyTransportVehicleCommand(running, {
        kind: 'transport.vehicle.start',
        vehicleId: 'vehicle-x',
      }),
    ).toThrow();
  });
});

describe('deterministic directed-edge movement', () => {
  it.each([
    [
      0,
      {
        kind: 'running-at-stop',
        stopNodeId: 'tv-stop-0108',
        nextEdgeSequence: 0,
      },
    ],
    [
      1,
      {
        kind: 'running-on-edge',
        edgeId: `${patternId}:0`,
        edgeSequence: 0,
        fromStopNodeId: 'tv-stop-0108',
        toStopNodeId: 'tv-stop-0053',
        progressTicks: 1,
        travelTicks: 3,
      },
    ],
    [
      2,
      {
        kind: 'running-on-edge',
        edgeId: `${patternId}:0`,
        edgeSequence: 0,
        fromStopNodeId: 'tv-stop-0108',
        toStopNodeId: 'tv-stop-0053',
        progressTicks: 2,
        travelTicks: 3,
      },
    ],
    [
      3,
      {
        kind: 'running-at-stop',
        stopNodeId: 'tv-stop-0053',
        nextEdgeSequence: 1,
      },
    ],
    [
      4,
      {
        kind: 'running-on-edge',
        edgeId: `${patternId}:1`,
        edgeSequence: 1,
        fromStopNodeId: 'tv-stop-0053',
        toStopNodeId: 'tv-stop-0078',
        progressTicks: 1,
        travelTicks: 4,
      },
    ],
    [
      7,
      {
        kind: 'running-at-stop',
        stopNodeId: 'tv-stop-0078',
        nextEdgeSequence: 2,
      },
    ],
    [
      12,
      {
        kind: 'running-at-stop',
        stopNodeId: 'tv-stop-0067',
        nextEdgeSequence: 3,
      },
    ],
    [18, { kind: 'completed-at-stop', stopNodeId: 'tv-stop-0093' }],
    [100, { kind: 'completed-at-stop', stopNodeId: 'tv-stop-0093' }],
  ] as const)('matches the non-loop oracle at %i ticks', (ticks, movement) => {
    const state = advanceTransportTicks(started(), ticks);
    expect(vehicle(state)?.movement).toEqual(movement);
    expect(state.tick).toBe(40 + ticks);
  });

  it('is split-batch equivalent across exact boundaries and many edges', () => {
    const initial = started();
    const once = advanceTransportTicks(initial, 18);
    const split = advanceTransportTicks(
      advanceTransportTicks(advanceTransportTicks(initial, 3), 7),
      8,
    );
    expect(split).toEqual(once);
  });

  it('advances multiple vehicles independently without collisions or ordering effects', () => {
    let state = started('vehicle-x', [3, 4, 5, 6]);
    state = applyTransportVehicleCommand(
      state,
      createCommand('vehicle-y', [2, 2, 2, 2]),
    );
    state = applyTransportVehicleCommand(state, {
      kind: 'transport.vehicle.start',
      vehicleId: 'vehicle-y',
    });
    const advanced = advanceTransportTicks(state, 8);
    expect(vehicle(advanced, 0)?.movement).toMatchObject({
      kind: 'running-on-edge',
      edgeSequence: 2,
      progressTicks: 1,
    });
    expect(vehicle(advanced, 1)?.movement).toEqual({
      kind: 'completed-at-stop',
      stopNodeId: 'tv-stop-0093',
    });
  });

  it.each([
    [
      0,
      {
        kind: 'running-at-stop',
        stopNodeId: 'tv-stop-0108',
        nextEdgeSequence: 0,
      },
    ],
    [
      2,
      {
        kind: 'running-at-stop',
        stopNodeId: 'tv-stop-0053',
        nextEdgeSequence: 1,
      },
    ],
    [
      5,
      {
        kind: 'running-at-stop',
        stopNodeId: 'tv-stop-0108',
        nextEdgeSequence: 0,
      },
    ],
    [
      6,
      {
        kind: 'running-on-edge',
        edgeId: `${patternId}:0`,
        edgeSequence: 0,
        fromStopNodeId: 'tv-stop-0108',
        toStopNodeId: 'tv-stop-0053',
        progressTicks: 1,
        travelTicks: 2,
      },
    ],
    [
      10,
      {
        kind: 'running-at-stop',
        stopNodeId: 'tv-stop-0108',
        nextEdgeSequence: 0,
      },
    ],
    [
      11,
      {
        kind: 'running-on-edge',
        edgeId: `${patternId}:0`,
        edgeSequence: 0,
        fromStopNodeId: 'tv-stop-0108',
        toStopNodeId: 'tv-stop-0053',
        progressTicks: 1,
        travelTicks: 2,
      },
    ],
  ] as const)(
    'matches the explicit loop oracle at %i ticks',
    (ticks, expected) => {
      let state = createTransportSimulationState(loopScenario(), 0);
      state = applyTransportVehicleCommand(
        state,
        createCommand('loop', [2, 3]),
      );
      state = applyTransportVehicleCommand(state, {
        kind: 'transport.vehicle.start',
        vehicleId: 'loop',
      });
      expect(vehicle(advanceTransportTicks(state, ticks))?.movement).toEqual(
        expected,
      );
    },
  );

  it('does not allow a completed vehicle to restart', () => {
    const completed = advanceTransportTicks(started(), 100);
    expect(() =>
      applyTransportVehicleCommand(completed, {
        kind: 'transport.vehicle.start',
        vehicleId: 'vehicle-x',
      }),
    ).toThrow('not parked');
  });

  it('falls back to exact edge advancement when a loop duration overflows', () => {
    let state = createTransportSimulationState(loopScenario(), 0);
    state = applyTransportVehicleCommand(
      state,
      createCommand('overflow-loop', [Number.MAX_SAFE_INTEGER, 1]),
    );
    state = applyTransportVehicleCommand(state, {
      kind: 'transport.vehicle.start',
      vehicleId: 'overflow-loop',
    });

    expect(advanceTransportTicks(state, 1).fleet[0]?.movement).toMatchObject({
      kind: 'running-on-edge',
      edgeSequence: 0,
      progressTicks: 1,
      travelTicks: Number.MAX_SAFE_INTEGER,
    });
  });

  it('returns the identical fleet for zero direct movement advancement', () => {
    const state = started();
    expect(
      advanceVehicleFleet(state.graph, state.fleet, parseTickAdvancement(0)),
    ).toBe(state.fleet);
  });

  it('skips complete loop revolutions algebraically for very large batches', () => {
    const canonical = loopScenario();
    let state = createTransportSimulationState(canonical, 0);
    state = applyTransportVehicleCommand(
      state,
      createCommand('large-loop', [2, 3]),
    );
    state = applyTransportVehicleCommand(state, {
      kind: 'transport.vehicle.start',
      vehicleId: 'large-loop',
    });
    const originalEdges = state.graph.patternEdges(patternId);
    let edgeReads = 0;
    const guardedEdges = new Proxy(originalEdges, {
      get(target, property, receiver) {
        if (/^\d+$/.test(String(property)) && ++edgeReads > 100)
          throw new Error('Loop advancement iterated by revolution.');
        return Reflect.get(target, property, receiver);
      },
    });
    const guarded = {
      ...state,
      graph: {
        ...state.graph,
        patternEdges: () => guardedEdges,
      },
    };
    const exact = advanceTransportTicks(guarded, 1_000_000_000_000);
    expect(vehicle(exact)?.movement).toEqual({
      kind: 'running-at-stop',
      stopNodeId: 'tv-stop-0108',
      nextEdgeSequence: 0,
    });
    const partial = advanceTransportTicks(state, 1_000_000_000_001);
    expect(vehicle(partial)?.movement).toMatchObject({
      kind: 'running-on-edge',
      edgeSequence: 0,
      progressTicks: 1,
      travelTicks: 2,
    });
    expect(edgeReads).toBeLessThan(100);
  });

  it('finishes a partial loop edge before skipping complete cycles', () => {
    let state = createTransportSimulationState(loopScenario(), 0);
    state = applyTransportVehicleCommand(
      state,
      createCommand('partial-loop', [7, 11]),
    );
    state = applyTransportVehicleCommand(state, {
      kind: 'transport.vehicle.start',
      vehicleId: 'partial-loop',
    });
    state = advanceTransportTicks(state, 3);
    const advanced = advanceTransportTicks(state, 18 * 1_000 + 5);
    expect(vehicle(advanced)?.movement).toMatchObject({
      kind: 'running-on-edge',
      edgeSequence: 1,
      progressTicks: 1,
      travelTicks: 11,
    });
    expect(advanceTransportTicks(state, 41)).toEqual(
      advanceTransportTicks(advanceTransportTicks(state, 18), 23),
    );
  });

  it('rejects incomplete route authority and impossible active-edge identity on restore', () => {
    const parked = applyTransportVehicleCommand(
      createTransportSimulationState(scenario(), 0),
      createCommand('restore-parked'),
    );
    const incomplete = structuredClone(
      createTransportSimulationSnapshot(parked),
    );
    incomplete.state.fleet[0]!.routeId = 'legacy-A2';
    expect(() =>
      restoreTransportSimulationState(incomplete, scenario()),
    ).toThrow(
      /Route-cycle assignment must provide routeId, routeLegs, routeLegIndex, and completedRouteCycles together\./,
    );

    const onEdge = advanceTransportTicks(started('restore-edge'), 1);
    const invalidEdge = structuredClone(
      createTransportSimulationSnapshot(onEdge),
    );
    if (invalidEdge.state.fleet[0]!.movement.kind !== 'running-on-edge')
      throw new Error('Expected running-on-edge fixture.');
    invalidEdge.state.fleet[0]!.movement.edgeId = 'wrong-edge';
    expect(() =>
      restoreTransportSimulationState(invalidEdge, scenario()),
    ).toThrow(/edge movement is invalid/i);
  });

  it('preserves parked and completed vehicles during positive global advancement', () => {
    const base = createTransportSimulationState(scenario(), 0);
    const parked = applyTransportVehicleCommand(base, createCommand());
    const completed = advanceTransportTicks(started(), 100);
    expect(advanceTransportTicks(parked, 5).fleet).toEqual(parked.fleet);
    expect(advanceTransportTicks(completed, 5).fleet).toEqual(completed.fleet);
  });

  it('rejects overflowing global ticks without changing fleet state', () => {
    const initial = started();
    expect(() =>
      advanceTransportTicks(
        { ...initial, tick: Number.MAX_SAFE_INTEGER as never },
        1,
      ),
    ).toThrow();
    expect(initial.tick).toBe(40);
    expect(vehicle(initial)?.movement.kind).toBe('running-at-stop');
  });
});
