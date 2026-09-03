import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyTransportVehicleCommand,
  advanceTransportTicks,
  createTransportSimulationState,
  parseVehicleId,
} from '@torrevieja-tycoon/simulation';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import { expect, it } from 'vitest';
import {
  canvas2dPointerPosition,
  createCanvas2dSelectionIndex,
  createCanvas2dSelectionSnapshot,
  hitTestCanvas2dSelection,
  projectCanvas2dPosition,
} from './canvas2d-selection-model.js';

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

const loadScenario = (scenarioRoot: string) => {
  const asset = (name: string) =>
    JSON.parse(readFileSync(join(scenarioRoot, name), 'utf8')) as unknown;
  return parseScenarioPackage({
    manifest: asset('scenario.json'),
    settlements: asset('settlements.json'),
    stops: asset('stops.json'),
    routes: asset('routes.json'),
    presentation: asset('presentation.json'),
    provenance: asset('provenance.json'),
  });
};

it('preserves canonical closed-loop wrap topology in route drawing geometry', () => {
  const loopScenario = loadScenario(
    join(
      import.meta.dirname,
      '..',
      '..',
      'public',
      'scenarios',
      'alicante-v1',
      'alicante-legacy-circular-v1',
    ),
  );
  const loopPattern = loopScenario.routes.routes
    .flatMap(({ patterns }) => patterns)
    .find(({ closesLoop }) => closesLoop)!;
  const index = createCanvas2dSelectionIndex(loopScenario);
  const patternEdges = index.routeEdges.filter(
    ({ patternId }) => patternId === loopPattern.patternId,
  );
  expect(patternEdges).toHaveLength(loopPattern.stopNodeIds.length);
  expect(patternEdges.at(-1)).toMatchObject({
    from: index.nodes.get(loopPattern.stopNodeIds.at(-1)!),
    to: index.nodes.get(loopPattern.stopNodeIds[0]!),
  });
});

it('builds canonical physical StopPlace and stopped/running Vehicle selection geometry', () => {
  const index = createCanvas2dSelectionIndex(scenario);
  expect(index.routeEdges).toHaveLength(
    scenario.routes.routes.reduce(
      (total, route) =>
        total +
        route.patterns.reduce(
          (patternTotal, candidate) =>
            patternTotal +
            candidate.stopNodeIds.length -
            1 +
            (candidate.closesLoop ? 1 : 0),
          0,
        ),
      0,
    ),
  );
  expect(index.routeEdges.slice(0, 2).map(({ edgeId }) => edgeId)).toEqual(
    [...index.edges.keys()].slice(0, 2),
  );
  expect(index.routeEdges[0]).toMatchObject({
    routeId: scenario.routes.routes[0]!.routeId,
    patternId: scenario.routes.routes[0]!.patterns[0]!.patternId,
  });
  expect(index.stopOccurrences.length).toBeGreaterThan(
    index.keyboardStops.length,
  );
  expect(index.keyboardStops).toHaveLength(scenario.stops.stopPlaces.length);
  expect(
    new Set(index.keyboardStops.map(({ stopPlaceId }) => stopPlaceId)).size,
  ).toBe(index.keyboardStops.length);
  const pattern = scenario.routes.routes[0]!.patterns[0]!;
  let state = createTransportSimulationState(scenario, 0);
  state = applyTransportVehicleCommand(state, {
    kind: 'transport.vehicle.create',
    vehicleId: parseVehicleId('canvas-vehicle'),
    label: 'Canvas vehicle',
    patternId: pattern.patternId,
    movementPlan: {
      kind: 'vehicle-movement-plan-v1',
      edgeTravelTicks: Array.from(
        { length: pattern.stopNodeIds.length - 1 },
        () => 10,
      ),
    },
  });
  const stopped = createCanvas2dSelectionSnapshot(index, state.fleet, 200, 100);
  expect(stopped.routeEdges).toHaveLength(index.routeEdges.length);
  expect(stopped.routeEdges[0]!.color).toBe('#2c7fb8');
  expect(stopped.routeEdges[0]!.arrowhead).toHaveLength(3);
  expect(stopped.keyboardCandidates.some((point) => 'edgeId' in point)).toBe(
    false,
  );
  expect(stopped.keyboardCandidates).toHaveLength(
    index.keyboardStops.length + stopped.vehiclePoints.length,
  );
  expect(stopped.stopPoints.length).toBeGreaterThan(0);
  expect(stopped.vehiclePoints[0]).toMatchObject({
    kind: 'vehicle',
    label: 'Canvas vehicle',
  });
  state = applyTransportVehicleCommand(state, {
    kind: 'transport.vehicle.start',
    vehicleId: parseVehicleId('canvas-vehicle'),
  });
  state = advanceTransportTicks(state, 5);
  const running = createCanvas2dSelectionSnapshot(
    index,
    state.fleet,
    200,
    100,
    stopped,
  );
  expect(running.vehiclePoints[0]).toMatchObject({ kind: 'vehicle' });
  expect(running.vehiclePoints[0]).not.toEqual(stopped.vehiclePoints[0]);
  expect(running.routeEdges).toBe(stopped.routeEdges);
  expect(running.stopPoints).toBe(stopped.stopPoints);
  const edgeOnlyPoint = stopped.routeEdges.find(({ from, to }) => {
    const x = (from.x + to.x) / 2;
    const y = (from.y + to.y) / 2;
    return [...stopped.stopPoints, ...stopped.vehiclePoints].every(
      (point) => Math.hypot(point.x - x, point.y - y) > 12,
    );
  })!;
  expect(edgeOnlyPoint).toBeDefined();
  const edgeX = (edgeOnlyPoint.from.x + edgeOnlyPoint.to.x) / 2;
  const edgeY = (edgeOnlyPoint.from.y + edgeOnlyPoint.to.y) / 2;
  expect(hitTestCanvas2dSelection(stopped, edgeX, edgeY)).toBeUndefined();
});

it('projects degenerate extents and converts client coordinates in CSS pixels', () => {
  expect(
    projectCanvas2dPosition(
      { latitude: 1, longitude: 2 },
      { south: 1, north: 1, west: 2, east: 2 },
      200,
      100,
    ),
  ).toEqual({ x: 100, y: 50 });
  expect(
    canvas2dPointerPosition(
      { left: 10, top: 20, width: 200, height: 100 },
      { width: 200, height: 100 },
      60,
      45,
    ),
  ).toEqual({ x: 50, y: 25 });
  expect(
    canvas2dPointerPosition(
      { left: 0, top: 0, width: 0, height: 1 },
      { width: 1, height: 1 },
      0,
      0,
    ),
  ).toBeUndefined();
  expect(
    canvas2dPointerPosition(
      { left: 0, top: 0, width: 1, height: Number.NaN },
      { width: 1, height: 1 },
      Number.NaN,
      0,
    ),
  ).toBeUndefined();
  expect(
    canvas2dPointerPosition(
      { left: 10, top: 20, width: 400, height: 200 },
      { width: 200, height: 100 },
      210,
      120,
    ),
  ).toEqual({ x: 100, y: 50 });
  for (const snapshot of [
    { width: 0, height: 1 },
    { width: 1, height: 0 },
    { width: Number.POSITIVE_INFINITY, height: 1 },
    { width: 1, height: Number.NaN },
  ])
    expect(
      canvas2dPointerPosition(
        { left: 0, top: 0, width: 1, height: 1 },
        snapshot,
        0,
        0,
      ),
    ).toBeUndefined();
  expect(
    canvas2dPointerPosition(
      { left: 0, top: 0, width: 1, height: 1 },
      { width: 1, height: 1 },
      0,
      Number.POSITIVE_INFINITY,
    ),
  ).toBeUndefined();
  expect(
    canvas2dPointerPosition(
      { left: Number.NaN, top: 0, width: 1, height: 1 },
      { width: 1, height: 1 },
      0,
      0,
    ),
  ).toBeUndefined();
});

it('uses a deterministic fallback color and omits arrows for collocated edges', () => {
  const withoutPresentation = {
    manifest: scenario.manifest,
    settlements: scenario.settlements,
    stops: scenario.stops,
    routes: scenario.routes,
    ...(scenario.provenance ? { provenance: scenario.provenance } : {}),
  };
  const position = scenario.stops.stopNodes[0]!.position;
  const collocated = {
    ...withoutPresentation,
    stops: {
      ...scenario.stops,
      stopNodes: scenario.stops.stopNodes.map((node) => ({
        ...node,
        position,
      })),
    },
  };
  const snapshot = createCanvas2dSelectionSnapshot(
    createCanvas2dSelectionIndex(collocated),
    [],
    100,
    100,
  );
  expect(snapshot.routeEdges[0]).toMatchObject({
    color: '#67bed6',
    arrowhead: undefined,
  });
});

it('resolves overlap by Vehicle priority, distance, then canonical identifier', () => {
  const stop = {
    kind: 'stop' as const,
    stopPlaceId: scenario.stops.stopPlaces[0]!.stopPlaceId,
    label: 'Stop',
    x: 20,
    y: 20,
  };
  const vehicleA = {
    kind: 'vehicle' as const,
    vehicleId: parseVehicleId('vehicle-a'),
    label: 'A',
    x: 20,
    y: 20,
  };
  const vehicleB = { ...vehicleA, vehicleId: parseVehicleId('vehicle-b') };
  const snapshot = {
    scenario,
    width: 100,
    height: 100,
    routeEdges: [],
    stopPoints: [stop],
    vehiclePoints: [vehicleB, vehicleA],
    keyboardCandidates: [stop, vehicleB, vehicleA],
  };
  expect(hitTestCanvas2dSelection(snapshot, 20, 20)).toEqual(vehicleA);
  expect(hitTestCanvas2dSelection(snapshot, 99, 99)).toBeUndefined();
  expect(hitTestCanvas2dSelection(snapshot, Number.NaN, 20)).toBeUndefined();
  expect(
    hitTestCanvas2dSelection(
      {
        ...snapshot,
        vehiclePoints: [],
        stopPoints: [
          stop,
          { ...stop, stopPlaceId: scenario.stops.stopPlaces[1]!.stopPlaceId },
        ],
      },
      20,
      20,
    ),
  ).toEqual(stop);
});

it('covers standalone physical stops, dimensions, ordering, and strict running authority', () => {
  const extra = {
    ...scenario.stops.stopPlaces[0]!,
    stopPlaceId: 'standalone-place' as never,
    name: 'Standalone place',
    position: { latitude: 37.95, longitude: -0.7 },
  };
  const withStandalone = {
    ...scenario,
    stops: {
      ...scenario.stops,
      stopPlaces: [...scenario.stops.stopPlaces, extra],
    },
  };
  const index = createCanvas2dSelectionIndex(withStandalone);
  expect(index.keyboardStops.at(-1)).toMatchObject({
    stopPlaceId: extra.stopPlaceId,
  });
  expect(index.keyboardStops.at(-1)).not.toHaveProperty('stopNodeId');
  expect(() => createCanvas2dSelectionSnapshot(index, [], 0, 1)).toThrow(
    'positive finite CSS dimensions',
  );

  const edge = [...index.edges.entries()][0]!;
  const base = {
    vehicleId: parseVehicleId('vehicle-b'),
    label: 'B',
    patternId: scenario.routes.routes[0]!.patterns[0]!.patternId,
    movementPlan: {
      kind: 'vehicle-movement-plan-v1' as const,
      edgeTravelTicks: [10],
    },
    movement: {
      kind: 'running-on-edge' as const,
      edgeId: edge[0] as never,
      edgeSequence: 0,
      fromStopNodeId: edge[1].fromStopNodeId,
      toStopNodeId: edge[1].toStopNodeId,
      progressTicks: 5,
      travelTicks: 10,
    },
  };
  const ordered = createCanvas2dSelectionSnapshot(
    index,
    [
      { ...base },
      { ...base, vehicleId: parseVehicleId('vehicle-a'), label: 'A' },
    ],
    100,
    100,
  );
  expect(ordered.vehiclePoints.map(({ vehicleId }) => vehicleId)).toEqual([
    'vehicle-a',
    'vehicle-b',
  ]);
  expect(
    createCanvas2dSelectionSnapshot(
      index,
      [
        { ...base, vehicleId: parseVehicleId('vehicle-a'), label: 'A' },
        { ...base },
        { ...base, label: 'B duplicate' },
      ],
      100,
      100,
    ).vehiclePoints,
  ).toHaveLength(3);
  expect(() =>
    createCanvas2dSelectionSnapshot(
      { ...index, edges: new Map() },
      [base],
      100,
      100,
    ),
  ).toThrow('missing canonical edge');
  expect(() =>
    createCanvas2dSelectionSnapshot(
      index,
      [
        {
          ...base,
          movement: {
            ...base.movement,
            toStopNodeId: base.movement.fromStopNodeId,
          },
        },
      ],
      100,
      100,
    ),
  ).toThrow('edge endpoints do not match');
  for (const movement of [
    { ...base.movement, progressTicks: -1 },
    { ...base.movement, travelTicks: 0 },
    { ...base.movement, progressTicks: 11 },
  ])
    expect(() =>
      createCanvas2dSelectionSnapshot(index, [{ ...base, movement }], 100, 100),
    ).toThrow('Invalid authoritative vehicle progress');
});

it('fails closed for malformed canonical stop ownership and covers deterministic ties', () => {
  expect(() =>
    createCanvas2dSelectionIndex({
      ...scenario,
      stops: { ...scenario.stops, stopNodes: [], stopPlaces: [] },
      routes: { ...scenario.routes, routes: [] },
    }),
  ).toThrow('at least one canonical stop');

  const node = scenario.stops.stopNodes[0]!;
  const withoutPhysicalOwner = {
    ...scenario,
    stops: {
      ...scenario.stops,
      stopPlaces: scenario.stops.stopPlaces.filter(
        ({ stopPlaceId }) => stopPlaceId !== node.stopPlaceId,
      ),
    },
  };
  expect(() => createCanvas2dSelectionIndex(withoutPhysicalOwner)).toThrow(
    'references missing physical StopPlace',
  );

  const withoutPhysicalIdentity = {
    ...scenario,
    stops: {
      ...scenario.stops,
      stopNodes: scenario.stops.stopNodes.map((candidate, index) =>
        index === 0 ? { ...candidate, stopPlaceId: null } : candidate,
      ),
    },
  };
  expect(
    createCanvas2dSelectionIndex(withoutPhysicalIdentity).stopOccurrences,
  ).not.toHaveLength(0);

  const withoutRedundantPhysicalPosition = {
    ...scenario,
    stops: {
      ...scenario.stops,
      stopPlaces: scenario.stops.stopPlaces.map((candidate, index) =>
        index === 0 ? { ...candidate, position: undefined } : candidate,
      ),
    },
  } as typeof scenario;
  expect(
    createCanvas2dSelectionIndex(withoutRedundantPhysicalPosition)
      .keyboardStops,
  ).toHaveLength(scenario.stops.stopPlaces.length);

  const unpositioned = {
    ...scenario,
    stops: {
      ...scenario.stops,
      stopPlaces: [
        ...scenario.stops.stopPlaces,
        {
          ...scenario.stops.stopPlaces[0]!,
          stopPlaceId: 'unpositioned' as never,
          position: undefined,
        },
      ],
    },
  };
  expect(() => createCanvas2dSelectionIndex(unpositioned)).toThrow(
    'has no canonical selection position',
  );

  const stopA = {
    kind: 'stop' as const,
    stopPlaceId: scenario.stops.stopPlaces[0]!.stopPlaceId,
    label: 'A',
    x: 1,
    y: 1,
  };
  const stopB = {
    ...stopA,
    stopPlaceId: scenario.stops.stopPlaces[1]!.stopPlaceId,
    label: 'B',
  };
  expect(
    hitTestCanvas2dSelection(
      {
        scenario,
        width: 10,
        height: 10,
        routeEdges: [],
        stopPoints: [stopB, stopA],
        vehiclePoints: [],
        keyboardCandidates: [stopB, stopA],
      },
      1,
      1,
    ),
  ).toEqual(
    [stopA, stopB].sort((left, right) =>
      left.stopPlaceId < right.stopPlaceId ? -1 : 1,
    )[0],
  );
  expect(
    hitTestCanvas2dSelection(
      {
        scenario,
        width: 10,
        height: 10,
        routeEdges: [],
        stopPoints: [
          { ...stopA, stopPlaceId: 'a-stop' as never },
          { ...stopB, stopPlaceId: 'z-stop' as never },
        ],
        vehiclePoints: [],
        keyboardCandidates: [stopA, stopB],
      },
      1,
      1,
    ),
  ).toMatchObject({ stopPlaceId: 'a-stop' });
  expect(
    hitTestCanvas2dSelection(
      {
        scenario,
        width: 10,
        height: 10,
        routeEdges: [],
        stopPoints: [stopA, { ...stopA }],
        vehiclePoints: [],
        keyboardCandidates: [stopA],
      },
      1,
      1,
    ),
  ).toEqual(stopA);
});

it('rejects missing authoritative Vehicle references', () => {
  const index = createCanvas2dSelectionIndex(scenario);
  expect(() =>
    createCanvas2dSelectionSnapshot(
      index,
      [
        {
          vehicleId: parseVehicleId('missing-stop'),
          label: 'Missing stop',
          patternId: scenario.routes.routes[0]!.patterns[0]!.patternId,
          movementPlan: {
            kind: 'vehicle-movement-plan-v1',
            edgeTravelTicks: [1],
          },
          movement: {
            kind: 'parked-at-stop',
            stopNodeId: 'missing' as never,
            nextEdgeSequence: 0,
          },
        },
      ],
      100,
      100,
    ),
  ).toThrow('Vehicle references missing canonical stop: missing.');
});
