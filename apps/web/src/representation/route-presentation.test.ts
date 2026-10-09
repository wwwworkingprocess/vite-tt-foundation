import {
  createTransportMapProjection,
  projectTransportMapVehicles,
  deriveTransportRouteViewport,
} from './transport-map-projection.js';
import {
  parseVehicleId,
  type VehicleState,
} from '@torrevieja-tycoon/simulation';
import { buildDirectedScenarioGraph } from '@torrevieja-tycoon/transport-domain';
import {
  createCanvas2dSelectionIndex,
  createCanvas2dSelectionSnapshot,
  hitTestCanvas2dSelection,
} from './canvas2d-selection-model.js';
import {
  projectVehicleMovementSvg,
  svgRouteArrowhead,
} from '../transport-representation/vehicle-svg-projection.js';
import {
  createD3dMapModel,
  d3dWorldPoint,
  projectD3dVehicles,
} from './d3d-map-model.js';
import { readFileSync } from '../../../../scripts/public-layer-files.mjs';

import { join } from 'node:path';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import { expect, it } from 'vitest';
import { parseRoutePresentation } from './route-presentation.js';
import {
  createRoutePresentationView,
  pointAtRouteProgress,
  projectRoutePresentationVehicles,
  routePresentationDrawOrder,
} from './route-presentation-view.js';

const publicRoot = join(import.meta.dirname, '../../public');
const root = join(
  publicRoot,
  'scenarios/torrevieja-v1/torrevieja-legacy-all-v1',
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
const raw = () =>
  JSON.parse(
    readFileSync(
      join(
        publicRoot,
        'route-presentation/torrevieja/torrevieja-route-presentation.v0.json',
      ),
      'utf8',
    ),
  );

it('accepts the unchanged real candidate with 205 source legs and 39 chords', () => {
  const asset = parseRoutePresentation(raw(), scenario);
  const legs = asset.routes.flatMap((r) => r.patterns.flatMap((p) => p.legs));
  expect(legs).toHaveLength(244);
  expect(
    legs.filter((l) => l.geometryStatus === 'source-derived'),
  ).toHaveLength(205);
  expect(
    legs.filter((l) => l.geometryStatus === 'canonical-chord-fallback'),
  ).toHaveLength(39);
  expect(Object.isFrozen(legs[0]!.coordinates[0])).toBe(true);
});

const vehicle = (
  map: ReturnType<typeof createTransportMapProjection>,
): VehicleState => ({
  vehicleId: parseVehicleId('curved-bus'),
  label: 'Curved bus',
  patternId: map.edges[0]!.patternId,
  movementPlan: { kind: 'vehicle-movement-plan-v1', edgeTravelTicks: [10] },
  movement: {
    kind: 'running-on-edge',
    edgeId: buildDirectedScenarioGraph(map.scenario).edges[0]!.edgeId,
    edgeSequence: 0,
    fromStopNodeId: map.edges[0]!.fromStopNodeId,
    toStopNodeId: map.edges[0]!.toStopNodeId,
    progressTicks: 5,
    travelTicks: 10,
  },
});

it('shares curve geometry and canonical vehicle progress with SVG, Canvas, world projection and hit testing', () => {
  const map = createTransportMapProjection(scenario);
  const view = createRoutePresentationView(
    map,
    parseRoutePresentation(raw(), scenario),
  );
  const fleet = [vehicle(map)];
  const normalized = projectRoutePresentationVehicles(
    view,
    projectTransportMapVehicles(map, fleet),
  );
  expect(normalized[0]).toMatchObject({
    vehicleId: fleet[0]!.vehicleId,
    progressNumerator: 5,
    progressDenominator: 10,
    color: '#D32F2F',
  });
  const svg = projectVehicleMovementSvg(scenario, fleet, undefined, view);
  const index = createCanvas2dSelectionIndex(scenario, view);
  const canvas = createCanvas2dSelectionSnapshot(index, fleet, 400, 300);
  expect(canvas.routeEdges[0]!.points).toHaveLength(
    view.map.edges[0]!.points!.length,
  );
  expect(svg.edges[0]!.points!.split(' ')).toHaveLength(
    canvas.routeEdges[0]!.points.length,
  );
  expect(canvas.routeEdges[0]!.color).toBe(svg.edges[0]!.color);
  expect(svg.vehicles[0]!.cx).toBeCloseTo(5 + normalized[0]!.point.x * 90);
  expect(canvas.vehiclePoints[0]!.x).toBeCloseTo(
    16 + normalized[0]!.point.x * 368,
  );
  expect(
    hitTestCanvas2dSelection(
      canvas,
      canvas.vehiclePoints[0]!.x,
      canvas.vehiclePoints[0]!.y,
    ),
  ).toMatchObject({ vehicleId: fleet[0]!.vehicleId });
  const next = createCanvas2dSelectionSnapshot(index, [], 400, 300, canvas);
  expect(next.routeEdges).toBe(canvas.routeEdges);
  expect(projectVehicleMovementSvg(scenario, [], undefined, view).edges).toBe(
    svg.edges,
  );
  const model = createD3dMapModel(view.map);
  expect(model.routes[0]!.points).toEqual(
    view.map.edges[0]!.points!.map((p) => d3dWorldPoint(model.bounds, p)),
  );
  expect(projectD3dVehicles(model, normalized)[0]).toMatchObject({
    ...d3dWorldPoint(model.bounds, normalized[0]!.point),
    color: '#D32F2F',
    headingRadians: normalized[0]!.headingRadians,
  });
  const changed = createCanvas2dSelectionSnapshot(
    createCanvas2dSelectionIndex(scenario),
    fleet,
    400,
    300,
    canvas,
  );
  expect(changed.routeEdges).not.toBe(canvas.routeEdges);
});

it('keeps omitted enrichment continuous, preserves stationary canonical positions and never invents edges', () => {
  const map = createTransportMapProjection(scenario);
  const missing = raw();
  missing.routes = [];
  const view = createRoutePresentationView(
    map,
    parseRoutePresentation(missing, scenario),
  );
  expect(view.map.edges).toEqual(map.edges);
  const edge = map.edges[0]!;
  expect(pointAtRouteProgress(view, edge.edgeId, 0.5).point).toEqual({
    x: (edge.from.x + edge.to.x) / 2,
    y: (edge.from.y + edge.to.y) / 2,
  });
  const stopped = {
    ...vehicle(map),
    routeId: edge.routeId,
    movement: {
      kind: 'parked-at-stop' as const,
      stopNodeId: edge.fromStopNodeId,
      nextEdgeSequence: 0 as const,
    },
  };
  expect(
    projectRoutePresentationVehicles(
      view,
      projectTransportMapVehicles(map, [stopped]),
    )[0]!.point,
  ).toBe(edge.from);
  const unstyled = createTransportMapProjection({
    ...scenario,
    presentation: {
      schemaVersion: '1.0.0',
      scenarioId: scenario.manifest.scenarioId,
    },
    routes: { ...scenario.routes, routes: [] },
  });
  const parked = {
    ...vehicle(map),
    movement: stopped.movement,
  };
  expect(
    projectRoutePresentationVehicles(
      createRoutePresentationView(unstyled),
      projectTransportMapVehicles(unstyled, [parked]),
    )[0]!.color,
  ).toBeUndefined();
  expect(
    createCanvas2dSelectionSnapshot(
      createCanvas2dSelectionIndex(unstyled.scenario),
      [parked],
      400,
      300,
    ).vehiclePoints[0]!.color,
  ).toBe('#c6533b');
  expect(() => pointAtRouteProgress(view, 'missing', 0.5)).toThrow(
    'Unknown canonical',
  );
  for (const progress of [-1, 2, NaN])
    expect(() => pointAtRouteProgress(view, edge.edgeId, progress)).toThrow(
      'Invalid presentation',
    );
});

it('frames the entire curve outside the stop envelope without changing canonical fallback framing', () => {
  const value = raw();
  value.routes[0].patterns[0].legs[0].coordinates[1] = [
    scenario.stops.stopNodes[0]!.position.longitude + 1,
    scenario.stops.stopNodes[0]!.position.latitude,
  ];
  const map = createTransportMapProjection(scenario);
  const view = createRoutePresentationView(
    map,
    parseRoutePresentation(value, scenario),
  );
  const routeId = map.edges[0]!.routeId;
  const extent = deriveTransportRouteViewport(view.map, routeId)!;
  expect(extent.maxX).toBeGreaterThan(1);
  expect(extent.maxX).toBeGreaterThan(
    Math.max(
      ...view.map.edges
        .filter((e) => e.routeId === routeId)
        .flatMap((e) => e.points!.map((p) => p.x)),
    ),
  );
});

it('handles duplicate vertices and exact final progress without division by zero', () => {
  const value = raw();
  const coordinates = value.routes[0].patterns[0].legs[0].coordinates;
  coordinates.push(coordinates.at(-1));
  const map = createTransportMapProjection(scenario);
  const view = createRoutePresentationView(
    map,
    parseRoutePresentation(value, scenario),
  );
  expect(pointAtRouteProgress(view, map.edges[0]!.edgeId, 1).point).toBe(
    map.edges[0]!.to,
  );
});

it('uses a declared route color and canonical chord for an omitted presentation pattern', () => {
  const value = raw();
  value.routes[0].patterns.shift();
  const map = createTransportMapProjection(scenario);
  const view = createRoutePresentationView(
    map,
    parseRoutePresentation(value, scenario),
  );
  expect(view.map.edges).toHaveLength(map.edges.length);
  expect(view.map.edges[0]).toMatchObject({
    color: '#D32F2F',
    enriched: true,
    points: [map.edges[0]!.from, map.edges[0]!.to],
  });
  expect(pointAtRouteProgress(view, map.edges[0]!.edgeId, 0.5).point).toEqual({
    x: (map.edges[0]!.from.x + map.edges[0]!.to.x) / 2,
    y: (map.edges[0]!.from.y + map.edges[0]!.to.y) / 2,
  });
});

it('orders selected route geometry late and caches straight directional cues', () => {
  const routes = [{ routeId: 'A' }, { routeId: 'B' }, { routeId: 'A' }];
  expect(routePresentationDrawOrder(routes)).toBe(routes);
  expect(routePresentationDrawOrder(routes, 'A')).toEqual([
    routes[1],
    routes[0],
    routes[2],
  ]);
  const edge = projectVehicleMovementSvg(scenario, []).edges[0]!;
  expect(edge.arrowhead).toBeDefined();
  expect(
    svgRouteArrowhead({ ...edge, x2: edge.x1, y2: edge.y1 }),
  ).toBeUndefined();
});

it('caches geometry, preserves canonical edges and uses curved arc length with exact endpoints', () => {
  const asset = parseRoutePresentation(raw(), scenario);
  const view = createRoutePresentationView(
    createTransportMapProjection(scenario),
    asset,
  );
  expect(
    createRoutePresentationView(createTransportMapProjection(scenario), asset),
  ).toBe(view);
  const edge = view.map.edges[0]!;
  expect(edge.points!.length).toBeGreaterThan(2);
  expect(pointAtRouteProgress(view, edge.edgeId, 0).point).toEqual(edge.from);
  expect(pointAtRouteProgress(view, edge.edgeId, 1).point).toEqual(edge.to);
  expect(pointAtRouteProgress(view, edge.edgeId, 0.5).point).not.toEqual({
    x: (edge.from.x + edge.to.x) / 2,
    y: (edge.from.y + edge.to.y) / 2,
  });
  const fallback = createRoutePresentationView(
    createTransportMapProjection(scenario),
  );
  expect(fallback.map.edges).toHaveLength(244);
  expect(
    createRoutePresentationView(createTransportMapProjection(scenario)),
  ).toBe(fallback);
  expect(edge.color).toBe('#D32F2F');
});

it.each([
  'scenario',
  'route',
  'pattern',
  'order',
  'adjacency',
  'endpoint',
  'color',
  'length',
  'coordinate',
  'chord',
])('rejects %s corruption as a whole', (kind) => {
  const value = raw();
  const route = value.routes[0];
  const pattern = route.patterns[0];
  const leg = pattern.legs[0];
  if (kind === 'scenario') value.scenarioId = 'other';
  if (kind === 'route') route.routeId = 'other';
  if (kind === 'pattern') pattern.patternId = 'other';
  if (kind === 'order') pattern.stopNodeIds.reverse();
  if (kind === 'adjacency') leg.toStopNodeId = leg.fromStopNodeId;
  if (kind === 'endpoint') leg.coordinates[0][0] += 0.001;
  if (kind === 'color') route.color = 'red';
  if (kind === 'length') leg.lengthMeters = 0;
  if (kind === 'coordinate') leg.coordinates[1][1] = 100;
  if (kind === 'chord') leg.geometryStatus = 'canonical-chord-fallback';
  expect(() => parseRoutePresentation(value, scenario)).toThrow();
});
