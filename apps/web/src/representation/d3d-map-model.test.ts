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
} from './d3d-map-model.js';

const routeId = 'route-a' as RouteId;
const stopPlaceId = 'place-a' as StopPlaceId;
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
