import type { VehicleId, VehicleState } from '@torrevieja-tycoon/simulation';
import {
  buildDirectedScenarioGraph,
  type CanonicalScenario,
  type RouteId,
  type RoutePatternId,
  type StopNodeId,
  type StopPlaceId,
} from '@torrevieja-tycoon/transport-domain';

export type TransportMapPoint = Readonly<{ x: number; y: number }>;
export type TransportMapBounds = Readonly<{
  south: number;
  north: number;
  west: number;
  east: number;
}>;
type GeographicPosition = Readonly<{ latitude: number; longitude: number }>;

export interface TransportMapProjection {
  readonly scenario: CanonicalScenario;
  readonly bounds: TransportMapBounds;
  readonly nodes: readonly Readonly<{
    stopNodeId: StopNodeId;
    stopPlaceId?: StopPlaceId;
    name: string;
    position: GeographicPosition;
    point: TransportMapPoint;
  }>[];
  readonly stopPlaces: readonly Readonly<{
    stopPlaceId: StopPlaceId;
    name: string;
    representativeStopNodeId?: StopNodeId;
    point: TransportMapPoint;
  }>[];
  readonly edges: readonly Readonly<{
    edgeId: string;
    routeId: RouteId;
    patternId: RoutePatternId;
    fromStopNodeId: StopNodeId;
    toStopNodeId: StopNodeId;
    color?: string;
    from: TransportMapPoint;
    to: TransportMapPoint;
  }>[];
}

export type TransportMapVehicle = Readonly<{
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
  point: TransportMapPoint;
}>;

type ProjectionIndex = Readonly<{
  nodes: ReadonlyMap<StopNodeId, TransportMapProjection['nodes'][number]>;
  edges: ReadonlyMap<string, TransportMapProjection['edges'][number]>;
  routeByPattern: ReadonlyMap<RoutePatternId, RouteId>;
}>;

const projections = new WeakMap<CanonicalScenario, TransportMapProjection>();
const indexes = new WeakMap<TransportMapProjection, ProjectionIndex>();

const deepFreeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

export function projectTransportMapPoint(
  bounds: TransportMapBounds,
  position: GeographicPosition,
): TransportMapPoint {
  const longitudeSpan = bounds.east - bounds.west;
  const latitudeSpan = bounds.north - bounds.south;
  return deepFreeze({
    x:
      longitudeSpan === 0
        ? 0.5
        : (position.longitude - bounds.west) / longitudeSpan,
    y:
      latitudeSpan === 0
        ? 0.5
        : (bounds.north - position.latitude) / latitudeSpan,
  });
}

export function createTransportMapProjection(
  scenario: CanonicalScenario,
): TransportMapProjection {
  const existing = projections.get(scenario);
  if (existing) return existing;
  const graph = buildDirectedScenarioGraph(scenario);
  if (graph.nodes.length === 0)
    throw new Error(
      'Transport Map projection requires at least one canonical stop.',
    );
  const positions = [
    ...graph.nodes.map(({ position }) => position),
    ...scenario.stops.stopPlaces.flatMap(({ position }) =>
      position ? [position] : [],
    ),
  ];
  const bounds = deepFreeze({
    south: Math.min(...positions.map(({ latitude }) => latitude)),
    north: Math.max(...positions.map(({ latitude }) => latitude)),
    west: Math.min(...positions.map(({ longitude }) => longitude)),
    east: Math.max(...positions.map(({ longitude }) => longitude)),
  });
  const physicalStops = new Map(
    scenario.stops.stopPlaces.map((stop) => [stop.stopPlaceId, stop]),
  );
  const nodes = graph.nodes.map((node) =>
    (() => {
      if (node.stopPlaceId && !physicalStops.has(node.stopPlaceId))
        throw new Error(
          `StopNode references missing physical StopPlace: ${node.stopPlaceId}.`,
        );
      return deepFreeze({
        stopNodeId: node.stopNodeId,
        ...(node.stopPlaceId ? { stopPlaceId: node.stopPlaceId } : {}),
        name: node.name ?? node.stopNodeId,
        position: node.position,
        point: projectTransportMapPoint(bounds, node.position),
      });
    })(),
  );
  const nodeById = new Map(nodes.map((node) => [node.stopNodeId, node]));
  const firstNodeByPlace = new Map<StopPlaceId, (typeof nodes)[number]>();
  for (const node of nodes)
    if (node.stopPlaceId && !firstNodeByPlace.has(node.stopPlaceId))
      firstNodeByPlace.set(node.stopPlaceId, node);
  const stopPlaces = scenario.stops.stopPlaces.map((stop) => {
    const representative = firstNodeByPlace.get(stop.stopPlaceId);
    if (!representative && !stop.position)
      throw new Error(
        `Physical StopPlace has no canonical Map position: ${stop.stopPlaceId}.`,
      );
    return deepFreeze({
      stopPlaceId: stop.stopPlaceId,
      name: stop.name,
      ...(representative
        ? { representativeStopNodeId: representative.stopNodeId }
        : {}),
      point:
        representative?.point ??
        projectTransportMapPoint(bounds, stop.position!),
    });
  });
  const routeStyles = (
    scenario.presentation as
      { routeStyles?: Record<string, { color?: unknown }> } | undefined
  )?.routeStyles;
  const edges = graph.edges.map((edge) => {
    const from = nodeById.get(edge.fromStopNodeId)!;
    const to = nodeById.get(edge.toStopNodeId)!;
    const color = routeStyles?.[edge.routeId]?.color;
    return deepFreeze({
      edgeId: edge.edgeId,
      routeId: edge.routeId,
      patternId: edge.patternId,
      fromStopNodeId: edge.fromStopNodeId,
      toStopNodeId: edge.toStopNodeId,
      ...(typeof color === 'string' ? { color } : {}),
      from: from.point,
      to: to.point,
    });
  });
  const projection = deepFreeze({
    scenario,
    bounds,
    nodes,
    stopPlaces,
    edges,
  });
  projections.set(scenario, projection);
  indexes.set(projection, {
    nodes: nodeById,
    edges: new Map(edges.map((edge) => [edge.edgeId, edge])),
    routeByPattern: new Map(
      scenario.routes.routes.flatMap((route) =>
        route.patterns.map((pattern) => [pattern.patternId, route.routeId]),
      ),
    ),
  });
  return projection;
}

const requireNode = (index: ProjectionIndex, stopNodeId: StopNodeId) => {
  const node = index.nodes.get(stopNodeId);
  if (!node)
    throw new Error(
      `Vehicle references missing canonical stop: ${stopNodeId}.`,
    );
  return node;
};

export function projectTransportMapVehicles(
  projection: TransportMapProjection,
  fleet: readonly VehicleState[],
): readonly TransportMapVehicle[] {
  const index = indexes.get(projection);
  if (!index) throw new Error('Unknown Transport Map projection authority.');
  const routeStyles = (
    projection.scenario.presentation as
      { routeStyles?: Record<string, { color?: unknown }> } | undefined
  )?.routeStyles;
  return deepFreeze(
    fleet.map((vehicle) => {
      const routeId =
        vehicle.routeId ?? index.routeByPattern.get(vehicle.patternId);
      const routeColor = routeId ? routeStyles?.[routeId]?.color : undefined;
      const shared = {
        vehicleId: vehicle.vehicleId,
        label: vehicle.label,
        movementKind: vehicle.movement.kind,
        ...(vehicle.routeId ? { routeId: vehicle.routeId } : {}),
        patternId: vehicle.patternId,
        ...(typeof routeColor === 'string' ? { color: routeColor } : {}),
        ...(vehicle.routeLegIndex === undefined
          ? {}
          : { routeLegIndex: vehicle.routeLegIndex }),
        ...(vehicle.completedRouteCycles === undefined
          ? {}
          : { completedRouteCycles: vehicle.completedRouteCycles }),
      };
      const movement = vehicle.movement;
      if (movement.kind !== 'running-on-edge')
        return deepFreeze({
          ...shared,
          point: requireNode(index, movement.stopNodeId).point,
        });
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
      if (
        !Number.isSafeInteger(movement.progressTicks) ||
        movement.progressTicks < 0 ||
        !Number.isSafeInteger(movement.travelTicks) ||
        movement.travelTicks <= 0 ||
        movement.progressTicks > movement.travelTicks
      )
        throw new Error('Invalid authoritative vehicle progress.');
      const ratio = movement.progressTicks / movement.travelTicks;
      return deepFreeze({
        ...shared,
        edgeId: movement.edgeId,
        progressNumerator: movement.progressTicks,
        progressDenominator: movement.travelTicks,
        point: deepFreeze({
          x: edge.from.x + (edge.to.x - edge.from.x) * ratio,
          y: edge.from.y + (edge.to.y - edge.from.y) * ratio,
        }),
      });
    }),
  );
}
