import { projectTransportMapVehicles } from '../representation/transport-map-projection.js';
import type { VehicleId, VehicleState } from '@torrevieja-tycoon/simulation';
import type {
  CanonicalScenario,
  RouteId,
  RoutePatternId,
  StopPlaceId,
} from '@torrevieja-tycoon/transport-domain';
import {
  createTransportMapProjection,
  projectTransportMapPoint,
  fullTransportMapViewport,
  type TransportMapPoint,
  type TransportMapViewport,
} from '../representation/transport-map-projection.js';
import {
  createRoutePresentationView,
  projectRoutePresentationVehicles,
  type RoutePresentationView,
} from '../representation/route-presentation-view.js';

type GeographicPosition = Readonly<{ latitude: number; longitude: number }>;
type SvgPosition = Readonly<{ cx: number; cy: number }>;

export interface VehicleSvgProjection {
  readonly viewBox: string;
  readonly nodes: readonly Readonly<
    SvgPosition &
      GeographicPosition & {
        stopNodeId: string;
        stopPlaceId?: StopPlaceId;
        name: string;
      }
  >[];
  readonly edges: readonly Readonly<{
    edgeId: string;
    routeId: RouteId;
    patternId: RoutePatternId;
    color?: string;
    arrowhead?: string | undefined;
    points?: string;
    enriched?: boolean;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }>[];
  readonly vehicles: readonly Readonly<
    SvgPosition & {
      vehicleId: VehicleId;
      label: string;
      movementKind: VehicleState['movement']['kind'];
      routeId?: RouteId;
      patternId: RoutePatternId;
      color?: string;
      routeLegIndex?: number;
      completedRouteCycles?: number;
      edgeId?: string;
      progressNumerator?: number;
      progressDenominator?: number;
    }
  >[];
}

export const svgRouteArrowhead = (
  edge: VehicleSvgProjection['edges'][number],
) => {
  const dx = edge.x2 - edge.x1;
  const dy = edge.y2 - edge.y1;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return undefined;
  const x = dx / distance;
  const y = dy / distance;
  const midpointX = (edge.x1 + edge.x2) / 2;
  const midpointY = (edge.y1 + edge.y2) / 2;
  const halfLength = Math.min(1.2, distance * 0.18);
  const halfWidth = Math.min(0.8, distance * 0.12);
  const baseX = midpointX - x * halfLength;
  const baseY = midpointY - y * halfLength;
  return `${midpointX + x * halfLength},${midpointY + y * halfLength} ${baseX - y * halfWidth},${baseY + x * halfWidth} ${baseX + y * halfWidth},${baseY - x * halfWidth}`;
};

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const svgPoint = (point: TransportMapPoint): SvgPosition =>
  freeze({ cx: 5 + point.x * 90, cy: 5 + point.y * 90 });
const staticProjections = new WeakMap<
  object,
  Pick<VehicleSvgProjection, 'nodes' | 'edges'>
>();

export function createScenarioSvgPositionProjector(
  scenario: CanonicalScenario,
): (position: GeographicPosition) => SvgPosition {
  const map = createTransportMapProjection(scenario);
  return (position) => svgPoint(projectTransportMapPoint(map.bounds, position));
}

export function transportMapViewportSvgViewBox(
  viewport: TransportMapViewport = fullTransportMapViewport,
) {
  return viewport === fullTransportMapViewport
    ? '0 0 100 100'
    : `${5 + viewport.minX * 90} ${5 + viewport.minY * 90} ${(viewport.maxX - viewport.minX) * 90} ${(viewport.maxY - viewport.minY) * 90}`;
}

export function projectVehicleMovementSvg(
  scenario: CanonicalScenario,
  fleet: readonly VehicleState[],
  viewport: TransportMapViewport = fullTransportMapViewport,
  view: RoutePresentationView = createRoutePresentationView(
    createTransportMapProjection(scenario),
  ),
): VehicleSvgProjection {
  const map = view.map;
  let staticProjection = staticProjections.get(map);
  if (!staticProjection) {
    staticProjection = freeze({
      nodes: freeze(
        map.nodes.map((node) =>
          freeze({
            stopNodeId: node.stopNodeId,
            ...(node.stopPlaceId ? { stopPlaceId: node.stopPlaceId } : {}),
            name: node.name,
            latitude: node.position.latitude,
            longitude: node.position.longitude,
            ...svgPoint(node.point),
          }),
        ),
      ),
      edges: freeze(
        map.edges.map((edge) => ({
          edgeId: edge.edgeId,
          routeId: edge.routeId,
          patternId: edge.patternId,
          points: (edge.points ?? [edge.from, edge.to])
            .map((p) => {
              const s = svgPoint(p);
              return `${s.cx},${s.cy}`;
            })
            .join(' '),
          enriched: edge.enriched === true,
          ...(!edge.enriched
            ? {
                arrowhead: svgRouteArrowhead({
                  edgeId: edge.edgeId,
                  routeId: edge.routeId,
                  patternId: edge.patternId,
                  x1: svgPoint(edge.from).cx,
                  y1: svgPoint(edge.from).cy,
                  x2: svgPoint(edge.to).cx,
                  y2: svgPoint(edge.to).cy,
                }),
              }
            : {}),
          ...(edge.color ? { color: edge.color } : {}),
          x1: svgPoint(edge.from).cx,
          y1: svgPoint(edge.from).cy,
          x2: svgPoint(edge.to).cx,
          y2: svgPoint(edge.to).cy,
        })),
      ),
    });
    staticProjections.set(map, staticProjection);
  }
  const vehicles = projectRoutePresentationVehicles(
    view,
    projectTransportMapVehicles(view.source, fleet),
  ).map((vehicle) => ({
    vehicleId: vehicle.vehicleId,
    label: vehicle.label,
    movementKind: vehicle.movementKind,
    ...(vehicle.routeId ? { routeId: vehicle.routeId } : {}),
    patternId: vehicle.patternId,
    color: vehicle.color ?? 'currentColor',
    ...(vehicle.routeLegIndex === undefined
      ? {}
      : { routeLegIndex: vehicle.routeLegIndex }),
    ...(vehicle.completedRouteCycles === undefined
      ? {}
      : { completedRouteCycles: vehicle.completedRouteCycles }),
    ...(vehicle.edgeId ? { edgeId: vehicle.edgeId } : {}),
    ...(vehicle.progressNumerator === undefined
      ? {}
      : { progressNumerator: vehicle.progressNumerator }),
    ...(vehicle.progressDenominator === undefined
      ? {}
      : { progressDenominator: vehicle.progressDenominator }),
    ...svgPoint(vehicle.point),
  }));
  return freeze({
    viewBox: transportMapViewportSvgViewBox(viewport),
    nodes: staticProjection.nodes,
    edges: staticProjection.edges,
    vehicles: freeze(vehicles),
  });
}
