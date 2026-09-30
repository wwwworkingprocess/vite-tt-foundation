import type { VehicleId } from '@torrevieja-tycoon/simulation';
import type { RouteId, StopPlaceId } from '@torrevieja-tycoon/transport-domain';
import {
  selectStop,
  selectVehicle,
  type GameSelection,
} from '../ui/game-selection.js';
import {
  deriveTransportRouteViewport,
  type TransportMapPoint,
  type TransportMapProjection,
  type TransportMapVehicle,
} from './transport-map-projection.js';
import type { RepresentationMode } from './representation-cadence.js';

const worldSpan = 100;
const elevation = (Math.PI * 35) / 180;
const azimuth = Math.PI / 4;
const sinElevation = Math.sin(elevation);
const cosAzimuth = Math.cos(azimuth);
const sinAzimuth = Math.sin(azimuth);

export type D3dWorldPoint = Readonly<{ x: number; z: number }>;
export type D3dLodBand = 'far' | 'medium' | 'near';
export type D3dMapModel = Readonly<{
  projection: Pick<TransportMapProjection, 'bounds' | 'edges' | 'stopPlaces'>;
  bounds: Readonly<{ width: number; depth: number }>;
  routes: readonly Readonly<{
    edgeId: string;
    routeId: RouteId;
    color: string;
    from: D3dWorldPoint;
    to: D3dWorldPoint;
    length: number;
    headingRadians: number;
  }>[];
  stops: readonly Readonly<{
    stopPlaceId: StopPlaceId;
    name: string;
    x: number;
    z: number;
  }>[];
  tiles: readonly Readonly<{ x: number; z: number; tone: number }>[];
}>;

const models = new WeakMap<object, D3dMapModel>();
const frozen = <T>(value: T): Readonly<T> => Object.freeze(value);

/** X is east, Z is south, Y is visual layering only. */
export function d3dWorldPoint(
  bounds: D3dMapModel['bounds'],
  point: TransportMapPoint,
): D3dWorldPoint {
  return frozen({
    x: (point.x - 0.5) * bounds.width,
    z: (point.y - 0.5) * bounds.depth,
  });
}

export function createD3dMapModel(
  projection: Pick<TransportMapProjection, 'bounds' | 'edges' | 'stopPlaces'>,
): D3dMapModel {
  const previous = models.get(projection);
  if (previous) return previous;
  const { north, south, east, west } = projection.bounds;
  const latitudeRadians = (((north + south) / 2) * Math.PI) / 180;
  const eastWest =
    Math.abs(east - west) * Math.max(0.01, Math.cos(latitudeRadians));
  const northSouth = Math.abs(north - south);
  const largest = Math.max(eastWest, northSouth, 0.000001);
  const bounds = frozen({
    width: (worldSpan * Math.max(eastWest, largest * 0.01)) / largest,
    depth: (worldSpan * Math.max(northSouth, largest * 0.01)) / largest,
  });
  const routes = frozen(
    projection.edges.map((edge) => {
      const from = d3dWorldPoint(bounds, edge.from);
      const to = d3dWorldPoint(bounds, edge.to);
      return frozen({
        edgeId: edge.edgeId,
        routeId: edge.routeId,
        color: edge.color ?? '#477d89',
        from,
        to,
        length: Math.hypot(to.x - from.x, to.z - from.z),
        headingRadians: Math.atan2(to.x - from.x, to.z - from.z),
      });
    }),
  );
  const stops = frozen(
    projection.stopPlaces.map((stop) =>
      frozen({
        stopPlaceId: stop.stopPlaceId,
        name: stop.name,
        ...d3dWorldPoint(bounds, stop.point),
      }),
    ),
  );
  const tiles = frozen(
    Array.from({ length: 16 * 16 }, (_, index) => {
      const column = index % 16;
      const row = Math.floor(index / 16);
      return frozen({
        x: ((column + 0.5 - 8) * bounds.width) / 16,
        z: ((row + 0.5 - 8) * bounds.depth) / 16,
        tone: (column * 17 + row * 31) % 4,
      });
    }),
  );
  const model = frozen({ projection, bounds, routes, stops, tiles });
  models.set(projection, model);
  return model;
}

export type D3dVehicle = Readonly<{
  vehicleId: VehicleId;
  label: string;
  x: number;
  z: number;
  color: string;
  headingRadians: number;
}>;

export function projectD3dVehicles(
  model: D3dMapModel,
  vehicles: readonly TransportMapVehicle[],
): readonly D3dVehicle[] {
  const edges = new Map(model.routes.map((edge) => [edge.edgeId, edge]));
  return frozen(
    vehicles.map((vehicle) =>
      frozen({
        vehicleId: vehicle.vehicleId,
        label: vehicle.label,
        ...d3dWorldPoint(model.bounds, vehicle.point),
        color: vehicle.color ?? '#b44b34',
        headingRadians: vehicle.edgeId
          ? (edges.get(vehicle.edgeId)?.headingRadians ?? 0)
          : 0,
      }),
    ),
  );
}

export type D3dCandidate =
  | Readonly<{ kind: 'stop'; id: StopPlaceId; label: string }>
  | Readonly<{ kind: 'vehicle'; id: VehicleId; label: string }>;

export function d3dKeyboardCandidates(
  model: D3dMapModel,
  vehicles: readonly D3dVehicle[],
): readonly D3dCandidate[] {
  return frozen([
    ...[...model.stops]
      .sort((a, b) => a.stopPlaceId.localeCompare(b.stopPlaceId))
      .map((stop) =>
        frozen({
          kind: 'stop' as const,
          id: stop.stopPlaceId,
          label: stop.name,
        }),
      ),
    ...[...vehicles]
      .sort((a, b) => a.vehicleId.localeCompare(b.vehicleId))
      .map((vehicle) =>
        frozen({
          kind: 'vehicle' as const,
          id: vehicle.vehicleId,
          label: vehicle.label,
        }),
      ),
  ]);
}

export function selectD3dCandidate(candidate: D3dCandidate): GameSelection {
  return candidate.kind === 'stop'
    ? selectStop(candidate.id)
    : selectVehicle(candidate.id);
}

export type D3dCameraFit = Readonly<{
  targetX: number;
  targetZ: number;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  panBounds: Readonly<{
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  }>;
}>;

export function fitD3dCamera(
  model: D3dMapModel,
  routeId: RouteId | undefined,
  cssWidth: number,
  cssHeight: number,
): D3dCameraFit {
  const viewport = routeId
    ? deriveTransportRouteViewport(model.projection, routeId)
    : undefined;
  const minimum = d3dWorldPoint(model.bounds, {
    x: viewport?.minX ?? 0,
    y: viewport?.minY ?? 0,
  });
  const maximum = d3dWorldPoint(model.bounds, {
    x: viewport?.maxX ?? 1,
    y: viewport?.maxY ?? 1,
  });
  const halfX = (maximum.x - minimum.x) / 2;
  const halfZ = (maximum.z - minimum.z) / 2;
  const projectedHalfWidth = cosAzimuth * halfX + sinAzimuth * halfZ;
  const projectedHalfHeight =
    sinElevation * (sinAzimuth * halfX + cosAzimuth * halfZ);
  const aspect = Math.max(1, cssWidth) / Math.max(1, cssHeight);
  const zoom =
    0.85 *
    Math.min(
      (10 * aspect) / Math.max(0.1, projectedHalfWidth),
      10 / Math.max(0.1, projectedHalfHeight),
    );
  const fullHalfX = model.bounds.width / 2;
  const fullHalfZ = model.bounds.depth / 2;
  return frozen({
    targetX: (minimum.x + maximum.x) / 2,
    targetZ: (minimum.z + maximum.z) / 2,
    zoom,
    minZoom: zoom * 0.65,
    maxZoom: zoom * 25,
    panBounds: frozen({
      minX: -fullHalfX * 1.4,
      maxX: fullHalfX * 1.4,
      minZ: -fullHalfZ * 1.4,
      maxZ: fullHalfZ * 1.4,
    }),
  });
}

export function d3dLodBand(
  worldUnitsPerCssPixel: number,
  mode: RepresentationMode,
  previous: D3dLodBand,
): D3dLodBand {
  if (mode === 'mini') return 'far';
  if (previous === 'far' && worldUnitsPerCssPixel > 0.18) return 'far';
  if (previous === 'near' && worldUnitsPerCssPixel < 0.055) return 'near';
  if (worldUnitsPerCssPixel >= 0.22) return 'far';
  if (worldUnitsPerCssPixel <= 0.045) return 'near';
  return 'medium';
}
