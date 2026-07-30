import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildDirectedScenarioGraph,
  parseScenarioPackage,
} from '@torrevieja-tycoon/transport-domain';
import {
  advanceTransportTicks,
  applyTransportVehicleCommand,
  createTransportSimulationSnapshot,
  createTransportSimulationState,
  parseTransportVehicleCommand,
  restoreTransportSimulationState,
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

function routeScenario() {
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
  outbound.patternId = 'route-outbound';
  outbound.stopNodeIds = ['tv-stop-0108', 'tv-stop-0053', 'tv-stop-0078'];
  routes.routes[0]!.routeId = 'route-a';
  routes.routes[0]!.patterns = [
    outbound,
    {
      ...outbound,
      patternId: 'route-return',
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

function started() {
  let state = createTransportSimulationState(routeScenario(), 0);
  state = applyTransportVehicleCommand(state, {
    kind: 'transport.vehicle.create-route-cycle',
    vehicleId: 'route-bus',
    label: 'Route bus',
    routeId: 'route-a',
    legs: [
      {
        patternId: 'route-outbound',
        movementPlan: {
          kind: 'vehicle-movement-plan-v1',
          edgeTravelTicks: [2, 3],
        },
      },
      {
        patternId: 'route-return',
        movementPlan: {
          kind: 'vehicle-movement-plan-v1',
          edgeTravelTicks: [5, 7],
        },
      },
    ],
  });
  return applyTransportVehicleCommand(state, {
    kind: 'transport.vehicle.start',
    vehicleId: 'route-bus',
  });
}

describe('repeating route-cycle movement', () => {
  it('hands off between ordered route legs without inventing an edge', () => {
    const atOutboundTerminal = advanceTransportTicks(started(), 5);
    expect(atOutboundTerminal.fleet[0]).toMatchObject({
      routeId: 'route-a',
      routeLegIndex: 0,
      patternId: 'route-outbound',
      completedRouteCycles: 0,
      movement: {
        kind: 'running-at-stop',
        stopNodeId: 'tv-stop-0078',
        nextEdgeSequence: 2,
      },
    });
    expect(
      atOutboundTerminal.graph
        .outgoingEdges('tv-stop-0078')
        .some((edge) => edge.toStopNodeId === 'tv-stop-0067'),
    ).toBe(false);

    const afterHandoff = advanceTransportTicks(atOutboundTerminal, 1);
    expect(afterHandoff.fleet[0]).toMatchObject({
      routeLegIndex: 1,
      patternId: 'route-return',
      movement: {
        kind: 'running-on-edge',
        fromStopNodeId: 'tv-stop-0067',
        progressTicks: 1,
        travelTicks: 5,
      },
    });
  });

  it('restarts outbound after return and skips complete route cycles exactly', () => {
    const cycleTicks = 17;
    const exact = advanceTransportTicks(started(), cycleTicks);
    expect(exact.fleet[0]).toMatchObject({
      routeLegIndex: 1,
      patternId: 'route-return',
      completedRouteCycles: 0,
      movement: {
        kind: 'running-at-stop',
        stopNodeId: 'tv-stop-0108',
        nextEdgeSequence: 2,
      },
    });
    const restarted = advanceTransportTicks(exact, 1);
    expect(restarted.fleet[0]).toMatchObject({
      routeLegIndex: 0,
      patternId: 'route-outbound',
      completedRouteCycles: 1,
      movement: { kind: 'running-on-edge', progressTicks: 1 },
    });

    const huge = advanceTransportTicks(started(), cycleTicks * 1_000_000 + 1);
    expect(huge.fleet[0]).toMatchObject({
      routeLegIndex: 0,
      completedRouteCycles: 1_000_000,
      movement: { kind: 'running-on-edge', progressTicks: 1 },
    });
    const initial = started();
    expect(advanceTransportTicks(initial, 29)).toEqual(
      advanceTransportTicks(advanceTransportTicks(initial, 11), 18),
    );
  });

  it('rejects malformed canonical route assignments without mutation', () => {
    const state = createTransportSimulationState(routeScenario(), 0);
    expect(() =>
      parseTransportVehicleCommand(
        {
          kind: 'transport.vehicle.create-route-cycle',
          vehicleId: 'bad',
          label: 'Bad',
          routeId: 'missing',
          legs: [
            {
              patternId: 'route-outbound',
              movementPlan: {
                kind: 'vehicle-movement-plan-v1',
                edgeTravelTicks: [1, 1],
              },
            },
          ],
        },
        buildDirectedScenarioGraph(routeScenario()),
      ),
    ).toThrow('Unknown route');
    for (const command of [
      {
        kind: 'transport.vehicle.create-route-cycle',
        vehicleId: 'bad',
        label: 'Bad',
        routeId: 'missing',
        legs: [],
      },
      {
        kind: 'transport.vehicle.create-route-cycle',
        vehicleId: 'bad',
        label: 'Bad',
        routeId: 'route-a',
        legs: [
          {
            patternId: 'route-outbound',
            movementPlan: {
              kind: 'vehicle-movement-plan-v1',
              edgeTravelTicks: [1, 1],
            },
          },
          {
            patternId: 'route-outbound',
            movementPlan: {
              kind: 'vehicle-movement-plan-v1',
              edgeTravelTicks: [1, 1],
            },
          },
        ],
      },
    ]) {
      expect(() => applyTransportVehicleCommand(state, command)).toThrow();
      expect(state.fleet).toEqual([]);
    }
    const created = applyTransportVehicleCommand(state, {
      kind: 'transport.vehicle.create-route-cycle',
      vehicleId: 'route-bus',
      label: 'Route bus',
      routeId: 'route-a',
      legs: [
        {
          patternId: 'route-outbound',
          movementPlan: {
            kind: 'vehicle-movement-plan-v1',
            edgeTravelTicks: [2, 3],
          },
        },
        {
          patternId: 'route-return',
          movementPlan: {
            kind: 'vehicle-movement-plan-v1',
            edgeTravelTicks: [5, 7],
          },
        },
      ],
    });
    expect(() =>
      applyTransportVehicleCommand(created, {
        kind: 'transport.vehicle.create-route-cycle',
        vehicleId: 'route-bus',
        label: 'Duplicate',
        routeId: 'route-a',
        legs: created.fleet[0]!.routeLegs!,
      }),
    ).toThrow('Duplicate vehicle ID');
  });

  it('falls back safely when a complete route-cycle cost cannot be summed', () => {
    let state = createTransportSimulationState(routeScenario(), 0);
    state = applyTransportVehicleCommand(state, {
      kind: 'transport.vehicle.create-route-cycle',
      vehicleId: 'overflow-cycle',
      label: 'Overflow cycle',
      routeId: 'route-a',
      legs: [
        {
          patternId: 'route-outbound',
          movementPlan: {
            kind: 'vehicle-movement-plan-v1',
            edgeTravelTicks: [Number.MAX_SAFE_INTEGER, 1],
          },
        },
        {
          patternId: 'route-return',
          movementPlan: {
            kind: 'vehicle-movement-plan-v1',
            edgeTravelTicks: [1, 1],
          },
        },
      ],
    });
    state = applyTransportVehicleCommand(state, {
      kind: 'transport.vehicle.start',
      vehicleId: 'overflow-cycle',
    });
    expect(advanceTransportTicks(state, 1).fleet[0]?.movement).toMatchObject({
      kind: 'running-on-edge',
      progressTicks: 1,
      travelTicks: Number.MAX_SAFE_INTEGER,
    });
  });

  it('round-trips current route-cycle state and rejects malformed authority', () => {
    const moving = advanceTransportTicks(started(), 9);
    const snapshot = createTransportSimulationSnapshot(moving);
    expect(snapshot).toMatchObject({
      schemaVersion: 6,
      simulationVersion: 'transport-6',
      state: {
        fleet: [
          {
            routeId: 'route-a',
            routeLegIndex: 1,
            completedRouteCycles: 0,
          },
        ],
      },
    });
    expect(
      createTransportSimulationSnapshot(
        restoreTransportSimulationState(snapshot, routeScenario()),
      ),
    ).toEqual(snapshot);

    const malformedSnapshots = [
      (() => {
        const value = structuredClone(snapshot);
        value.state.fleet[0]!.routeId = 'missing-route';
        return value;
      })(),
      (() => {
        const value = structuredClone(snapshot);
        value.state.fleet[0]!.patternId = 'route-outbound';
        return value;
      })(),
      (() => {
        const value = structuredClone(snapshot);
        value.state.fleet[0]!.movement = {
          kind: 'parked-at-stop',
          stopNodeId: 'tv-stop-0078',
          nextEdgeSequence: 0,
        };
        return value;
      })(),
      (() => {
        const value = structuredClone(snapshot);
        value.state.fleet[0]!.movement = {
          kind: 'running-at-stop',
          stopNodeId: 'tv-stop-0108',
          nextEdgeSequence: 0,
        };
        return value;
      })(),
    ];
    malformedSnapshots.forEach((malformed, index) => {
      let failure: unknown;
      try {
        restoreTransportSimulationState(malformed, routeScenario());
      } catch (error) {
        failure = error;
      }
      expect(failure, `malformed snapshot ${index}`).toBeInstanceOf(Error);
    });

    const completedRouteCycle = structuredClone(snapshot);
    completedRouteCycle.state.fleet[0]!.movement = {
      kind: 'completed-at-stop',
      stopNodeId: 'tv-stop-0108',
    };
    expect(() =>
      restoreTransportSimulationState(completedRouteCycle, routeScenario()),
    ).toThrow('Repeating route-cycle vehicle');

    const impossibleCycles = structuredClone(snapshot);
    impossibleCycles.state.fleet[0]!.completedRouteCycles =
      impossibleCycles.state.tick + 1;
    expect(() =>
      restoreTransportSimulationState(impossibleCycles, routeScenario()),
    ).toThrow('completed route cycles');

    const validTerminal = advanceTransportTicks(started(), 5);
    const restoredTerminal = restoreTransportSimulationState(
      createTransportSimulationSnapshot(validTerminal),
      routeScenario(),
    );
    expect(restoredTerminal.fleet[0]?.movement).toMatchObject({
      kind: 'running-at-stop',
      nextEdgeSequence: 2,
    });
    expect(advanceTransportTicks(restoredTerminal, 1).fleet[0]).toMatchObject({
      routeLegIndex: 1,
      movement: { kind: 'running-on-edge', progressTicks: 1 },
    });
  });
});
