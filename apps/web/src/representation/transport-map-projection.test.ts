import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  advanceTransportTicks,
  applyTransportVehicleCommand,
  createTransportSimulationState,
  parseVehicleId,
} from '@torrevieja-tycoon/simulation';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import { expect, it } from 'vitest';
import {
  createTransportMapProjection,
  projectTransportMapVehicles,
} from './transport-map-projection.js';
import {
  createCanvas2dSelectionIndex,
  createCanvas2dSelectionSnapshot,
} from './canvas2d-selection-model.js';
import { projectVehicleMovementSvg } from '../transport-representation/vehicle-svg-projection.js';

const root = join(
  import.meta.dirname,
  '..',
  '..',
  'public',
  'scenarios',
  'torrevieja-v1',
  'torrevieja-legacy-abc-v1',
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

it('projects immutable canonical network semantics into normalized Map space once per scenario', () => {
  const projection = createTransportMapProjection(scenario);
  expect(createTransportMapProjection(scenario)).toBe(projection);
  expect(projection.nodes).toHaveLength(scenario.stops.stopNodes.length);
  expect(projection.stopPlaces).toHaveLength(scenario.stops.stopPlaces.length);
  expect(projection.edges[0]).toMatchObject({
    routeId: scenario.routes.routes[0]!.routeId,
    patternId: scenario.routes.routes[0]!.patterns[0]!.patternId,
    color: '#2c7fb8',
  });
  expect(
    projection.nodes.every(({ point }) => point.x >= 0 && point.x <= 1),
  ).toBe(true);
  expect(
    projection.nodes.every(({ point }) => point.y >= 0 && point.y <= 1),
  ).toBe(true);
  expect(Object.isFrozen(projection)).toBe(true);
  expect(Object.isFrozen(projection.edges[0])).toBe(true);
});

it('shares exact stopped and authoritative on-edge Vehicle Map positions without extrapolation', () => {
  const projection = createTransportMapProjection(scenario);
  const pattern = scenario.routes.routes[0]!.patterns[0]!;
  let state = createTransportSimulationState(scenario, 0);
  state = applyTransportVehicleCommand(state, {
    kind: 'transport.vehicle.create',
    vehicleId: parseVehicleId('shared-map-vehicle'),
    label: 'Shared map vehicle',
    patternId: pattern.patternId,
    movementPlan: {
      kind: 'vehicle-movement-plan-v1',
      edgeTravelTicks: Array.from(
        { length: pattern.stopNodeIds.length - 1 },
        () => 10,
      ),
    },
  });
  const stopped = projectTransportMapVehicles(projection, state.fleet)[0]!;
  expect(stopped.point).toEqual(
    projection.nodes.find(
      ({ stopNodeId }) => stopNodeId === pattern.stopNodeIds[0],
    )!.point,
  );
  state = applyTransportVehicleCommand(state, {
    kind: 'transport.vehicle.start',
    vehicleId: parseVehicleId('shared-map-vehicle'),
  });
  state = advanceTransportTicks(state, 5);
  const running = projectTransportMapVehicles(projection, state.fleet)[0]!;
  const edge = projection.edges.find(
    ({ edgeId }) => edgeId === `${pattern.patternId}:0`,
  )!;
  expect(running).toMatchObject({
    movementKind: 'running-on-edge',
    progressNumerator: 5,
    progressDenominator: 10,
  });
  expect(running.point.x).toBeCloseTo((edge.from.x + edge.to.x) / 2);
  expect(running.point.y).toBeCloseTo((edge.from.y + edge.to.y) / 2);
});

it('centres both axes for a degenerate valid extent', () => {
  const samePosition = {
    ...scenario,
    stops: {
      ...scenario.stops,
      stopNodes: scenario.stops.stopNodes.map((node) => ({
        ...node,
        position: { latitude: 38, longitude: -0.6 },
      })),
      stopPlaces: scenario.stops.stopPlaces.map((stop) => ({
        ...stop,
        ...(stop.position
          ? { position: { latitude: 38, longitude: -0.6 } }
          : {}),
      })),
    },
  };
  const projection = createTransportMapProjection(
    parseScenarioPackage(samePosition),
  );
  expect(projection.nodes.every(({ point }) => point.x === 0.5)).toBe(true);
  expect(projection.nodes.every(({ point }) => point.y === 0.5)).toBe(true);
});

it('gives DOM2D and Canvas2D identical normalized network and Vehicle semantics', () => {
  const map = createTransportMapProjection(scenario);
  const canvasIndex = createCanvas2dSelectionIndex(scenario);
  expect(canvasIndex.map).toBe(map);
  const canvas = createCanvas2dSelectionSnapshot(canvasIndex, [], 100, 100);
  const svg = projectVehicleMovementSvg(scenario, []);
  expect(canvas.routeEdges[0]!.from).toEqual({
    x: 16 + map.edges[0]!.from.x * 68,
    y: 16 + map.edges[0]!.from.y * 68,
  });
  expect(svg.edges[0]).toMatchObject({
    x1: 5 + map.edges[0]!.from.x * 90,
    y1: 5 + map.edges[0]!.from.y * 90,
  });
});

it('rejects foreign projection objects and preserves optional route-cycle identity', () => {
  const projection = createTransportMapProjection(scenario);
  expect(() =>
    projectTransportMapVehicles(structuredClone(projection), []),
  ).toThrow('Unknown Transport Map projection authority');
  const pattern = scenario.routes.routes[0]!.patterns[0]!;
  let state = createTransportSimulationState(scenario, 0);
  state = applyTransportVehicleCommand(state, {
    kind: 'transport.vehicle.create',
    vehicleId: parseVehicleId('route-cycle-map-vehicle'),
    label: 'Route cycle map vehicle',
    patternId: pattern.patternId,
    movementPlan: {
      kind: 'vehicle-movement-plan-v1',
      edgeTravelTicks: Array.from(
        { length: pattern.stopNodeIds.length - 1 },
        () => 10,
      ),
    },
  });
  const routeCycleVehicle = {
    ...state.fleet[0]!,
    routeId: scenario.routes.routes[0]!.routeId,
    routeLegIndex: 0,
    completedRouteCycles: 0,
  };
  expect(
    projectTransportMapVehicles(projection, [routeCycleVehicle])[0],
  ).toMatchObject({
    routeId: scenario.routes.routes[0]!.routeId,
    routeLegIndex: 0,
    completedRouteCycles: 0,
  });
});
