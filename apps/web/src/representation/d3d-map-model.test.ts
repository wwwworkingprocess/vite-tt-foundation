import { expect, it } from 'vitest';
import { parseVehicleId } from '@torrevieja-tycoon/simulation';
import type { RouteId, StopPlaceId } from '@torrevieja-tycoon/transport-domain';
import {
  createD3dMapModel,
  fitD3dCamera,
  d3dLodBand,
  d3dKeyboardCandidates,
  projectD3dVehicles,
  selectD3dCandidate,
  d3dSceneBounds,
  d3dMetreScale,
  d3dGeographicPoint,
  d3dProjectedPoint,
  d3dStopHitScale,
} from './d3d-map-model.js';

const routeId = 'route-a' as RouteId;
const stopPlaceId = 'place-a' as StopPlaceId;

it('converts local metres and WGS84 through the same latitude-adjusted D3D projection', () => {
  const map = createD3dMapModel({
    bounds: { west: -0.72, east: -0.64, south: 37.94, north: 38.04 },
    edges: [],
    stopPlaces: [],
  });
  const scale = d3dMetreScale(map);
  expect(scale.worldUnitsPerMetre * scale.metresPerWorldUnit).toBeCloseTo(1);
  expect(scale.worldUnitsPerMetre * 11132).toBeCloseTo(100);
  const origin = { longitude: -0.68, latitude: 37.99 };
  const p = d3dProjectedPoint(map, origin);
  expect(d3dGeographicPoint(map, p)).toEqual(origin);
  const east = d3dProjectedPoint(map, {
    ...origin,
    longitude: origin.longitude + 0.001,
  });
  const north = d3dProjectedPoint(map, {
    ...origin,
    latitude: origin.latitude + 0.001,
  });
  expect((east.x - p.x) / scale.worldUnitsPerMetre).toBeCloseTo(
    111.32 * Math.cos((37.99 * Math.PI) / 180),
  );
  expect((p.z - north.z) / scale.worldUnitsPerMetre).toBeCloseTo(111.32);
  expect(
    d3dMetreScale(
      createD3dMapModel({
        bounds: { west: 0, east: 0, south: 0, north: 0 },
        edges: [],
        stopPlaces: [],
      }),
    ).worldUnitsPerMetre,
  ).toBeGreaterThan(0);
});
const projection = {
  bounds: { west: -1, east: 1, south: 0, north: 1 },
  edges: [
    {
      edgeId: 'edge-a',
      routeId,
      patternId: 'pattern-a',
      from: { x: 0, y: 0 },
      to: { x: 1, y: 1 },
      fromStopNodeId: 'node-a',
      toStopNodeId: 'node-b',
      color: '#127f83',
    },
  ],
  stopPlaces: [{ stopPlaceId, name: 'Place A', point: { x: 0.25, y: 0.75 } }],
} as unknown as Parameters<typeof createD3dMapModel>[0];

it('materializes aspect-preserving world coordinates, directed routes, and physical stops', () => {
  const model = createD3dMapModel(projection);
  expect(model.bounds.width).toBeGreaterThan(model.bounds.depth);
  expect(model.routes).toHaveLength(1);
  expect(model.routes[0]).toMatchObject({
    edgeId: 'edge-a',
    routeId,
    color: '#127f83',
  });
  expect(model.routes[0]!.length).toBeGreaterThan(0);
  expect(model.stops).toHaveLength(1);
  expect(model.stops[0]!.stopPlaceId).toBe(stopPlaceId);
  expect(model.stops[0]!.x).toBeLessThan(0);
  expect(createD3dMapModel(projection)).toBe(model);
  const uncoloured = createD3dMapModel({
    ...projection,
    edges: projection.edges.map((edge) => ({
      edgeId: edge.edgeId,
      routeId: edge.routeId,
      patternId: edge.patternId,
      fromStopNodeId: edge.fromStopNodeId,
      toStopNodeId: edge.toStopNodeId,
      from: edge.from,
      to: edge.to,
    })),
  });
  expect(uncoloured.routes[0]!.color).toBe('#477d89');
});

it('fits full and route extents with resize-aware orthographic zoom and bounded controls', () => {
  const model = createD3dMapModel(projection);
  const wide = fitD3dCamera(model, undefined, 1000, 660);
  const narrow = fitD3dCamera(model, undefined, 390, 844);
  const route = fitD3dCamera(model, routeId, 1000, 660);
  expect(wide.zoom).toBeGreaterThan(0);
  expect(narrow.zoom).toBeLessThan(wide.zoom);
  expect(route.zoom).toBeGreaterThanOrEqual(wide.zoom);
  expect(wide.minZoom).toBeLessThan(wide.zoom);
  expect(wide.maxZoom).toBeGreaterThan(wide.zoom);
  expect(wide.panBounds.minX).toBeLessThan(wide.panBounds.maxX);
});

it('uses apparent screen scale for stable far, medium, and near detail', () => {
  expect(d3dLodBand(0.3, 'normal', 'far')).toBe('far');
  expect(d3dLodBand(0.1, 'normal', 'far')).toBe('medium');
  expect(d3dLodBand(0.02, 'normal', 'medium')).toBe('near');
  expect(d3dLodBand(0.02, 'mini', 'near')).toBe('far');
  expect(d3dLodBand(0.205, 'normal', 'far')).toBe('far');
});

it('maps exact fleet points and headings without rebuilding static geometry', () => {
  const model = createD3dMapModel(projection);
  const vehicles = projectD3dVehicles(model, [
    {
      vehicleId: parseVehicleId('bus-a'),
      label: 'Bus A',
      point: { x: 0.5, y: 0.5 },
      edgeId: 'edge-a',
      color: '#127f83',
    },
  ] as never);
  expect(vehicles[0]).toMatchObject({
    vehicleId: 'bus-a',
    x: 0,
    z: 0,
    color: '#127f83',
  });
  expect(Number.isFinite(vehicles[0]!.headingRadians)).toBe(true);
  expect(createD3dMapModel(projection)).toBe(model);
  const missing = projectD3dVehicles(model, [
    {
      vehicleId: parseVehicleId('bus-missing'),
      label: 'Missing',
      point: { x: 0, y: 0 },
      edgeId: 'missing',
    },
    {
      vehicleId: parseVehicleId('bus-parked'),
      label: 'Parked',
      point: { x: 1, y: 1 },
    },
  ] as never);
  expect(missing.map((vehicle) => vehicle.headingRadians)).toEqual([0, 0]);
  expect(missing[0]!.color).toBe('#b44b34');
});

it('uses hysteresis when leaving near and far LOD bands', () => {
  expect(d3dLodBand(0.06, 'normal', 'near')).toBe('medium');
  expect(d3dLodBand(0.05, 'normal', 'near')).toBe('near');
  expect(d3dLodBand(0.18, 'normal', 'far')).toBe('medium');
  expect(d3dLodBand(0.23, 'normal', 'medium')).toBe('far');
  expect(d3dLodBand(0.04, 'normal', 'far')).toBe('near');
});

it('orders keyboard candidates by canonical identity and activates exact shared selection', () => {
  const model = createD3dMapModel(projection);
  const vehicles = projectD3dVehicles(model, [
    {
      vehicleId: parseVehicleId('bus-b'),
      label: 'Bus B',
      point: { x: 0.5, y: 0.5 },
    },
  ] as never);
  const candidates = d3dKeyboardCandidates(model, vehicles);
  expect(candidates.map((candidate) => candidate.id)).toEqual([
    'place-a',
    'bus-b',
  ]);
  expect(selectD3dCandidate(candidates[0]!)).toEqual({
    kind: 'stop',
    stopPlaceId,
  });
  expect(selectD3dCandidate(candidates[1]!)).toEqual({
    kind: 'vehicle',
    vehicleId: 'bus-b',
  });
  const multiProjection = {
    ...projection,
    stopPlaces: [
      {
        stopPlaceId: 'place-z' as StopPlaceId,
        name: 'Z',
        point: { x: 0, y: 0 },
      },
      { stopPlaceId, name: 'A', point: { x: 1, y: 1 } },
    ],
  } as Parameters<typeof createD3dMapModel>[0];
  const sorted = d3dKeyboardCandidates(
    createD3dMapModel(multiProjection),
    projectD3dVehicles(model, [
      { vehicleId: parseVehicleId('bus-z'), label: 'Z', point: { x: 0, y: 0 } },
      { vehicleId: parseVehicleId('bus-a'), label: 'A', point: { x: 1, y: 1 } },
    ] as never),
  );
  expect(sorted.map((candidate) => candidate.id)).toEqual([
    'place-a',
    'place-z',
    'bus-a',
    'bus-z',
  ]);
});

it('frames the full canonical crop even where no buildings are occupied', () => {
  const model = createD3dMapModel(projection);
  const extent = d3dSceneBounds(model, {
    minX: -100,
    maxX: 150,
    minZ: -125,
    maxZ: 125,
  });
  expect(fitD3dCamera(model, undefined, 1000, 660, extent).zoom).toBeLessThan(
    fitD3dCamera(model, undefined, 1000, 660).zoom,
  );
  expect(fitD3dCamera(model, routeId, 1000, 660, extent)).toEqual(
    fitD3dCamera(model, routeId, 1000, 660),
  );
  expect(d3dSceneBounds(model).minX).toBe(-model.bounds.width / 2);
});

it('keeps far Stop footprints pickable without enlarging vertical occlusion over Vehicles', () => {
  expect(d3dStopHitScale(0.01)).toEqual({ x: 1, y: 1, z: 1 });
  const far = d3dStopHitScale(0.4);
  expect((far.x * 1.25) / 0.4).toBeCloseTo(12, 12);
  expect(far.z).toBe(far.x);
  expect(far.y * 0.8).toBe(0.8);
});
