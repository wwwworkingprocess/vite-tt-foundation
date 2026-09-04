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
  projectTransportMapVehicles,
  type TransportMapPoint,
} from '../representation/transport-map-projection.js';

type GeographicPosition = Readonly<{ latitude: number; longitude: number }>;
type SvgPosition = Readonly<{ cx: number; cy: number }>;

export interface VehicleSvgProjection {
  readonly viewBox: '0 0 100 100';
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

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const svgPoint = (point: TransportMapPoint): SvgPosition =>
  freeze({ cx: 5 + point.x * 90, cy: 5 + point.y * 90 });
const staticProjections = new WeakMap<
  CanonicalScenario,
  Pick<VehicleSvgProjection, 'nodes' | 'edges'>
>();

export function createScenarioSvgPositionProjector(
  scenario: CanonicalScenario,
): (position: GeographicPosition) => SvgPosition {
  const map = createTransportMapProjection(scenario);
  return (position) => svgPoint(projectTransportMapPoint(map.bounds, position));
}

export function projectVehicleMovementSvg(
  scenario: CanonicalScenario,
  fleet: readonly VehicleState[],
): VehicleSvgProjection {
  const map = createTransportMapProjection(scenario);
  let staticProjection = staticProjections.get(scenario);
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
          ...(edge.color ? { color: edge.color } : {}),
          x1: svgPoint(edge.from).cx,
          y1: svgPoint(edge.from).cy,
          x2: svgPoint(edge.to).cx,
          y2: svgPoint(edge.to).cy,
        })),
      ),
    });
    staticProjections.set(scenario, staticProjection);
  }
  const vehicles = projectTransportMapVehicles(map, fleet).map((vehicle) => ({
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
    viewBox: '0 0 100 100',
    nodes: staticProjection.nodes,
    edges: staticProjection.edges,
    vehicles: freeze(vehicles),
  });
}
