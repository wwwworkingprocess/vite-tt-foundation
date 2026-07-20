import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyTransportVehicleCommand,
  createTransportSimulationState,
  parseTickAdvancement,
  parseVehicleId,
  advanceTransportTicks,
} from '@torrevieja-tycoon/simulation';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import {
  interpolateSvgPosition,
  projectVehicleMovementSvg,
} from './vehicle-svg-projection.js';

const root = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'transport-domain',
  'fixtures',
  'torrevieja-mini-v1',
);
const json = (name: string) =>
  JSON.parse(readFileSync(join(root, name), 'utf8')) as unknown;
const scenario = parseScenarioPackage({
  manifest: json('scenario.json'),
  settlements: json('settlements.json'),
  stops: json('stops.json'),
  routes: json('routes.json'),
  presentation: json('presentation.json'),
  provenance: json('provenance.json'),
});
const pattern = scenario.routes.routes[0]!.patterns[0]!;
const createFleet = () => {
  let state = createTransportSimulationState(scenario, 0);
  state = applyTransportVehicleCommand(state, {
    kind: 'transport.vehicle.create',
    vehicleId: parseVehicleId('vehicle-a'),
    label: 'Vehicle A',
    patternId: pattern.patternId,
    movementPlan: {
      kind: 'vehicle-movement-plan-v1',
      edgeTravelTicks: Array.from(
        {
          length: pattern.stopNodeIds.length - 1 + (pattern.closesLoop ? 1 : 0),
        },
        (_, index) => index + 4,
      ),
    },
  });
  return state;
};

describe('vehicle SVG projection', () => {
  it('maps canonical longitude to x, inverts latitude, and freezes every projection', () => {
    const projection = projectVehicleMovementSvg(scenario, createFleet().fleet);
    expect(projection.viewBox).toBe('0 0 100 100');
    expect(projection.nodes).toHaveLength(scenario.stops.stopNodes.length);
    expect(projection.edges).toHaveLength(6);
    expect(projection.vehicles[0]).toMatchObject({
      vehicleId: 'vehicle-a',
      movementKind: 'parked-at-stop',
    });
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.nodes[0])).toBe(true);
    expect(() => (projection.nodes as unknown[]).push({})).toThrow();
    const north = [...projection.nodes].sort(
      (a, b) => b.latitude - a.latitude,
    )[0]!;
    const south = [...projection.nodes].sort(
      (a, b) => a.latitude - b.latitude,
    )[0]!;
    expect(north.cy).toBeLessThanOrEqual(south.cy);
  });

  it('projects running-at-stop, on-edge progress, completion, loops, and multiple vehicles', () => {
    let state = applyTransportVehicleCommand(createFleet(), {
      kind: 'transport.vehicle.start',
      vehicleId: parseVehicleId('vehicle-a'),
    });
    expect(
      projectVehicleMovementSvg(scenario, state.fleet).vehicles[0]!
        .movementKind,
    ).toBe('running-at-stop');
    state = advanceTransportTicks(state, parseTickAdvancement(2));
    const edge = projectVehicleMovementSvg(scenario, state.fleet).vehicles[0]!;
    expect(edge).toMatchObject({
      movementKind: 'running-on-edge',
      progressNumerator: 2,
      progressDenominator: 4,
      edgeId: `${pattern.patternId}:0`,
    });
    const from = scenario.stops.stopNodes.find(
      (node) => node.stopNodeId === pattern.stopNodeIds[0],
    )!.position;
    const to = scenario.stops.stopNodes.find(
      (node) => node.stopNodeId === pattern.stopNodeIds[1],
    )!.position;
    expect(interpolateSvgPosition(from, to, 0, 4)).toEqual(from);
    expect(interpolateSvgPosition(from, to, 4, 4)).toEqual(to);

    const second = applyTransportVehicleCommand(state, {
      kind: 'transport.vehicle.create',
      vehicleId: parseVehicleId('vehicle-b'),
      label: 'Vehicle B',
      patternId: pattern.patternId,
      movementPlan: {
        kind: 'vehicle-movement-plan-v1',
        edgeTravelTicks: Array.from({ length: 4 }, () => 1),
      },
    });
    expect(
      projectVehicleMovementSvg(scenario, second.fleet).vehicles,
    ).toHaveLength(2);
  });

  it('centres degenerate coordinates and rejects missing canonical locations', () => {
    expect(
      interpolateSvgPosition(
        { latitude: 1, longitude: 2 },
        { latitude: 1, longitude: 2 },
        1,
        2,
      ),
    ).toEqual({ latitude: 1, longitude: 2 });
    const invalid = structuredClone(createFleet().fleet) as unknown as Array<{
      movement: { kind: string; stopNodeId: string };
    }>;
    invalid[0]!.movement.stopNodeId = 'missing';
    expect(() => projectVehicleMovementSvg(scenario, invalid as never)).toThrow(
      'missing canonical stop',
    );

    const samePosition = structuredClone(scenario);
    for (const node of samePosition.stops.stopNodes) {
      const position = node.position as {
        latitude: number;
        longitude: number;
      };
      position.latitude = 38;
      position.longitude = -0.6;
    }
    const degenerate = parseScenarioPackage(samePosition);
    expect(projectVehicleMovementSvg(degenerate, []).nodes[0]).toMatchObject({
      cx: 50,
      cy: 50,
    });
    const noStops = structuredClone(scenario) as unknown as {
      stops: { stopNodes: unknown[] };
    };
    noStops.stops.stopNodes = [];
    expect(() => projectVehicleMovementSvg(noStops as never, [])).toThrow(
      'at least one canonical stop',
    );
    expect(() =>
      interpolateSvgPosition(
        { latitude: 0, longitude: 0 },
        { latitude: 1, longitude: 1 },
        -1,
        2,
      ),
    ).toThrow('Invalid authoritative vehicle progress');
  });

  it('rejects missing edges and mismatched authoritative edge endpoints', () => {
    let state = applyTransportVehicleCommand(createFleet(), {
      kind: 'transport.vehicle.start',
      vehicleId: parseVehicleId('vehicle-a'),
    });
    state = advanceTransportTicks(state, parseTickAdvancement(1));
    const missingEdge = structuredClone(state.fleet) as unknown as Array<{
      movement: { edgeId: string; fromStopNodeId: string };
    }>;
    missingEdge[0]!.movement.edgeId = 'missing-edge';
    expect(() =>
      projectVehicleMovementSvg(scenario, missingEdge as never),
    ).toThrow('missing canonical edge');
    const mismatched = structuredClone(state.fleet) as unknown as Array<{
      movement: { edgeId: string; fromStopNodeId: string };
    }>;
    mismatched[0]!.movement.fromStopNodeId = 'wrong-stop';
    expect(() =>
      projectVehicleMovementSvg(scenario, mismatched as never),
    ).toThrow('endpoints do not match');
  });
});
