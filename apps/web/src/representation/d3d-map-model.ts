import type { VehicleId } from '@torrevieja-tycoon/simulation';
import type {
  RouteId,
  StopPlaceId,
  Wgs84Position,
} from '@torrevieja-tycoon/transport-domain';
import {
  selectStop,
  selectVehicle,
  type GameSelection,
} from '../ui/game-selection.js';
import {
  deriveTransportRouteViewport,
  projectTransportMapPoint,
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
    points?: readonly D3dWorldPoint[];
    enriched?: boolean;
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
}>;

const models = new WeakMap<object, D3dMapModel>();
const frozen = <T>(value: T): Readonly<T> => Object.freeze(value);

/** Same local equirectangular approximation and cosine clamp as world normalization. */
export function d3dMetreScale(model: D3dMapModel) {
  const { north, south, east, west } = model.projection.bounds;
  const cosine = Math.max(0.01, Math.cos(((north + south) * Math.PI) / 360));
  const spanDegrees = Math.max(
    Math.abs(east - west) * cosine,
    Math.abs(north - south),
    0.000001,
  );
  const worldUnitsPerMetre = worldSpan / (spanDegrees * 111320);
  return frozen({
    worldUnitsPerMetre,
    metresPerWorldUnit: 1 / worldUnitsPerMetre,
  });
}
export function d3dProjectedPoint(model: D3dMapModel, point: Wgs84Position) {
  return d3dWorldPoint(
    model.bounds,
    projectTransportMapPoint(model.projection.bounds, point),
  );
}
export function d3dGeographicPoint(
  model: D3dMapModel,
  point: D3dWorldPoint,
): Wgs84Position {
  const { west, east, north, south } = model.projection.bounds;
  return frozen({
    longitude: west + (point.x / model.bounds.width + 0.5) * (east - west),
    latitude: north - (point.z / model.bounds.depth + 0.5) * (north - south),
  });
}

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
        ...(edge.points
          ? {
              points: frozen(edge.points.map((p) => d3dWorldPoint(bounds, p))),
              enriched: edge.enriched,
            }
          : {}),
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
  const model = frozen({ projection, bounds, routes, stops });
  models.set(projection, model);
  return model;
}

export type D3dSceneBounds = Readonly<{
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY?: number;
  maxY?: number;
}>;
export function d3dSceneBounds(
  model: D3dMapModel,
  populationBounds?: Readonly<{
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  }>,
): D3dSceneBounds {
  return frozen({
    minX: Math.min(-model.bounds.width / 2, populationBounds?.minX ?? 0),
    maxX: Math.max(model.bounds.width / 2, populationBounds?.maxX ?? 0),
    minZ: Math.min(-model.bounds.depth / 2, populationBounds?.minZ ?? 0),
    maxZ: Math.max(model.bounds.depth / 2, populationBounds?.maxZ ?? 0),
  });
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
        headingRadians:
          vehicle.headingRadians ??
          (vehicle.edgeId
            ? (edges.get(vehicle.edgeId)?.headingRadians ?? 0)
            : 0),
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
  sceneBounds = d3dSceneBounds(model),
): D3dCameraFit {
  const viewport = routeId
    ? deriveTransportRouteViewport(model.projection, routeId)
    : undefined;
  const minimum = viewport
    ? d3dWorldPoint(model.bounds, { x: viewport.minX, y: viewport.minY })
    : { x: sceneBounds.minX, z: sceneBounds.minZ };
  const maximum = viewport
    ? d3dWorldPoint(model.bounds, { x: viewport.maxX, y: viewport.maxY })
    : { x: sceneBounds.maxX, z: sceneBounds.maxZ };
  const halfX = (maximum.x - minimum.x) / 2;
  const halfZ = (maximum.z - minimum.z) / 2;
  const projectedHalfWidth = cosAzimuth * halfX + sinAzimuth * halfZ;
  const projectedHalfHeight =
    sinElevation * (sinAzimuth * halfX + cosAzimuth * halfZ) +
    Math.max(Math.abs(sceneBounds.minY ?? 0), Math.abs(sceneBounds.maxY ?? 0)) *
      Math.cos(elevation);
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

/** Preserve the vertical pick volume so far-view Stop targets do not obscure
 * Vehicle targets; only the horizontal footprint gets a CSS-scale floor. */
export function d3dStopHitScale(worldUnitsPerCssPixel: number) {
  const horizontal = Math.max(1.25, 12 * worldUnitsPerCssPixel) / 1.25;
  return frozen({ x: horizontal, y: 1, z: horizontal });
}
