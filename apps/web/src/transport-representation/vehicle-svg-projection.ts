import type { VehicleId, VehicleState } from '@torrevieja-tycoon/simulation';
import {
  buildDirectedScenarioGraph,
  type CanonicalScenario,
  type RouteId,
  type RoutePatternId,
  type StopPlaceId,
} from '@torrevieja-tycoon/transport-domain';

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

const deepFreeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

type ScenarioProjectionIndex = Readonly<{
  graph: ReturnType<typeof buildDirectedScenarioGraph>;
  stops: ReadonlyMap<
    string,
    ReturnType<typeof buildDirectedScenarioGraph>['nodes'][number]
  >;
  edges: ReadonlyMap<
    string,
    ReturnType<typeof buildDirectedScenarioGraph>['edges'][number]
  >;
  project: (position: GeographicPosition) => SvgPosition;
}>;

const scenarioProjectionIndexes = new WeakMap<
  CanonicalScenario,
  ScenarioProjectionIndex
>();
const staticScenarioProjections = new WeakMap<
  CanonicalScenario,
  Pick<VehicleSvgProjection, 'nodes' | 'edges'>
>();

const scenarioProjectionIndex = (scenario: CanonicalScenario) => {
  const existing = scenarioProjectionIndexes.get(scenario);
  if (existing) return existing;
  const graph = buildDirectedScenarioGraph(scenario);
  if (graph.nodes.length === 0)
    throw new Error('SVG projection requires at least one canonical stop.');
  const latitudes = graph.nodes.map((node) => node.position.latitude);
  const longitudes = graph.nodes.map((node) => node.position.longitude);
  const south = Math.min(...latitudes);
  const north = Math.max(...latitudes);
  const west = Math.min(...longitudes);
  const east = Math.max(...longitudes);
  const latitudeSpan = north - south;
  const longitudeSpan = east - west;
  const project = (position: GeographicPosition) =>
    deepFreeze({
      cx:
        longitudeSpan === 0
          ? 50
          : 5 + ((position.longitude - west) / longitudeSpan) * 90,
      cy:
        latitudeSpan === 0
          ? 50
          : 5 + ((north - position.latitude) / latitudeSpan) * 90,
    });
  const created = {
    graph,
    stops: new Map(graph.nodes.map((node) => [node.stopNodeId, node])),
    edges: new Map(graph.edges.map((edge) => [edge.edgeId, edge])),
    project,
  };
  scenarioProjectionIndexes.set(scenario, created);
  return created;
};

export function interpolateSvgPosition(
  from: GeographicPosition,
  to: GeographicPosition,
  numerator: number,
  denominator: number,
): GeographicPosition {
  if (
    !Number.isSafeInteger(numerator) ||
    numerator < 0 ||
    !Number.isSafeInteger(denominator) ||
    denominator <= 0 ||
    numerator > denominator
  )
    throw new Error('Invalid authoritative vehicle progress.');
  const ratio = numerator / denominator;
  return deepFreeze({
    latitude: from.latitude + (to.latitude - from.latitude) * ratio,
    longitude: from.longitude + (to.longitude - from.longitude) * ratio,
  });
}

export function createScenarioSvgPositionProjector(
  scenario: CanonicalScenario,
): (position: GeographicPosition) => SvgPosition {
  return scenarioProjectionIndex(scenario).project;
}

export function projectVehicleMovementSvg(
  scenario: CanonicalScenario,
  fleet: readonly VehicleState[],
): VehicleSvgProjection {
  const index = scenarioProjectionIndex(scenario);
  const { graph, stops } = index;
  const mapPosition = index.project;
  const requireStop = (stopNodeId: string) => {
    const stop = stops.get(stopNodeId);
    if (!stop)
      throw new Error(
        `Vehicle references missing canonical stop: ${stopNodeId}.`,
      );
    return stop;
  };
  let staticProjection = staticScenarioProjections.get(scenario);
  if (!staticProjection) {
    const nodes = graph.nodes.map((node) => ({
      stopNodeId: node.stopNodeId,
      ...(node.stopPlaceId ? { stopPlaceId: node.stopPlaceId } : {}),
      name: node.name ?? node.stopNodeId,
      latitude: node.position.latitude,
      longitude: node.position.longitude,
      ...mapPosition(node.position),
    }));
    const edges = graph.edges.map((edge) => {
      const from = mapPosition(requireStop(edge.fromStopNodeId).position);
      const to = mapPosition(requireStop(edge.toStopNodeId).position);
      const presentation = scenario.presentation as
        { routeStyles?: Record<string, { color?: unknown }> } | undefined;
      const color = presentation?.routeStyles?.[edge.routeId]?.color;
      return {
        edgeId: edge.edgeId,
        routeId: edge.routeId,
        patternId: edge.patternId,
        ...(typeof color === 'string' ? { color } : {}),
        x1: from.cx,
        y1: from.cy,
        x2: to.cx,
        y2: to.cy,
      };
    });
    staticProjection = deepFreeze({ nodes, edges });
    staticScenarioProjections.set(scenario, staticProjection);
  }
  const vehicles = fleet.map((vehicle) => {
    const presentation = scenario.presentation as
      { routeStyles?: Record<string, { color?: unknown }> } | undefined;
    const presentationRouteId =
      vehicle.routeId ??
      scenario.routes.routes.find((route) =>
        route.patterns.some(({ patternId }) => patternId === vehicle.patternId),
      )?.routeId;
    const routeColor = presentationRouteId
      ? presentation?.routeStyles?.[presentationRouteId]?.color
      : undefined;
    const color = typeof routeColor === 'string' ? routeColor : 'currentColor';
    const movement = vehicle.movement;
    if (movement.kind !== 'running-on-edge') {
      const position = mapPosition(requireStop(movement.stopNodeId).position);
      return {
        vehicleId: vehicle.vehicleId,
        label: vehicle.label,
        movementKind: movement.kind,
        ...(vehicle.routeId ? { routeId: vehicle.routeId } : {}),
        patternId: vehicle.patternId,
        color,
        ...(vehicle.routeLegIndex === undefined
          ? {}
          : { routeLegIndex: vehicle.routeLegIndex }),
        ...(vehicle.completedRouteCycles === undefined
          ? {}
          : { completedRouteCycles: vehicle.completedRouteCycles }),
        ...position,
      };
    }
    const edge = index.edges.get(movement.edgeId);
    if (!edge)
      throw new Error(
        `Vehicle references missing canonical edge: ${movement.edgeId}.`,
      );
    if (
      edge.fromStopNodeId !== movement.fromStopNodeId ||
      edge.toStopNodeId !== movement.toStopNodeId
    )
      throw new Error(
        `Vehicle edge endpoints do not match ${movement.edgeId}.`,
      );
    const geographic = interpolateSvgPosition(
      requireStop(edge.fromStopNodeId).position,
      requireStop(edge.toStopNodeId).position,
      movement.progressTicks,
      movement.travelTicks,
    );
    return {
      vehicleId: vehicle.vehicleId,
      label: vehicle.label,
      movementKind: movement.kind,
      ...(vehicle.routeId ? { routeId: vehicle.routeId } : {}),
      patternId: vehicle.patternId,
      color,
      ...(vehicle.routeLegIndex === undefined
        ? {}
        : { routeLegIndex: vehicle.routeLegIndex }),
      ...(vehicle.completedRouteCycles === undefined
        ? {}
        : { completedRouteCycles: vehicle.completedRouteCycles }),
      edgeId: movement.edgeId,
      progressNumerator: movement.progressTicks,
      progressDenominator: movement.travelTicks,
      ...mapPosition(geographic),
    };
  });
  return deepFreeze({
    viewBox: '0 0 100 100',
    nodes: staticProjection.nodes,
    edges: staticProjection.edges,
    vehicles,
  });
}
