import type { VehicleId, VehicleState } from '@torrevieja-tycoon/simulation';
import {
  buildDirectedScenarioGraph,
  type CanonicalScenario,
  type StopNodeId,
  type StopPlaceId,
} from '@torrevieja-tycoon/transport-domain';

type GeographicPosition = Readonly<{ latitude: number; longitude: number }>;
type CanvasPosition = Readonly<{ x: number; y: number }>;
type GeographicBounds = Readonly<{
  south: number;
  north: number;
  west: number;
  east: number;
}>;

export type Canvas2dSelectablePoint =
  | Readonly<
      CanvasPosition & {
        kind: 'stop';
        stopPlaceId: StopPlaceId;
        label: string;
      }
    >
  | Readonly<
      CanvasPosition & {
        kind: 'vehicle';
        vehicleId: VehicleId;
        label: string;
      }
    >;

type GeographicStop = Readonly<{
  stopPlaceId: StopPlaceId;
  stopNodeId?: StopNodeId;
  label: string;
  position: GeographicPosition;
}>;

type GeographicRouteEdge = Readonly<{
  edgeId: string;
  routeId: string;
  patternId: string;
  color: string;
  from: GeographicPosition;
  to: GeographicPosition;
}>;

export type Canvas2dRouteEdge = Readonly<{
  edgeId: string;
  routeId: string;
  patternId: string;
  color: string;
  from: CanvasPosition;
  to: CanvasPosition;
  arrowhead: readonly CanvasPosition[] | undefined;
}>;

export interface Canvas2dSelectionIndex {
  readonly scenario: CanonicalScenario;
  readonly bounds: GeographicBounds;
  readonly stopOccurrences: readonly GeographicStop[];
  readonly keyboardStops: readonly GeographicStop[];
  readonly routeEdges: readonly GeographicRouteEdge[];
  readonly nodes: ReadonlyMap<StopNodeId, GeographicPosition>;
  readonly edges: ReadonlyMap<
    string,
    Readonly<{ fromStopNodeId: StopNodeId; toStopNodeId: StopNodeId }>
  >;
}

export interface Canvas2dSelectionSnapshot {
  readonly scenario: CanonicalScenario;
  readonly width: number;
  readonly height: number;
  readonly routeEdges: readonly Canvas2dRouteEdge[];
  readonly stopPoints: readonly Extract<
    Canvas2dSelectablePoint,
    { kind: 'stop' }
  >[];
  readonly vehiclePoints: readonly Extract<
    Canvas2dSelectablePoint,
    { kind: 'vehicle' }
  >[];
  readonly keyboardCandidates: readonly Canvas2dSelectablePoint[];
}

export const canvas2dStopHitRadius = 10;
export const canvas2dVehicleHitRadius = 12;

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

export function createCanvas2dSelectionIndex(
  scenario: CanonicalScenario,
): Canvas2dSelectionIndex {
  const graph = buildDirectedScenarioGraph(scenario);
  if (graph.nodes.length === 0)
    throw new Error('Canvas selection requires at least one canonical stop.');
  const nodes = new Map(
    graph.nodes.map((node) => [node.stopNodeId, node.position]),
  );
  const stopPlaces = new Map(
    scenario.stops.stopPlaces.map((stop) => [stop.stopPlaceId, stop]),
  );
  const stopOccurrences: GeographicStop[] = [];
  const firstOccurrence = new Map<StopPlaceId, GeographicStop>();
  for (const node of graph.nodes) {
    if (!node.stopPlaceId) continue;
    const stop = stopPlaces.get(node.stopPlaceId);
    if (!stop)
      throw new Error(
        `StopNode references missing physical StopPlace: ${node.stopPlaceId}.`,
      );
    const occurrence = freeze({
      stopPlaceId: stop.stopPlaceId,
      stopNodeId: node.stopNodeId,
      label: stop.name,
      position: node.position,
    });
    stopOccurrences.push(occurrence);
    if (!firstOccurrence.has(stop.stopPlaceId))
      firstOccurrence.set(stop.stopPlaceId, occurrence);
  }
  const keyboardStops = scenario.stops.stopPlaces.map((stop) => {
    const occurrence = firstOccurrence.get(stop.stopPlaceId);
    if (occurrence) return occurrence;
    if (!stop.position)
      throw new Error(
        `Physical StopPlace has no canonical selection position: ${stop.stopPlaceId}.`,
      );
    const standalone = freeze({
      stopPlaceId: stop.stopPlaceId,
      label: stop.name,
      position: stop.position,
    });
    stopOccurrences.push(standalone);
    return standalone;
  });
  const positions = [
    ...graph.nodes.map(({ position }) => position),
    ...scenario.stops.stopPlaces.flatMap(({ position }) =>
      position ? [position] : [],
    ),
  ];
  const routeStyles = (
    scenario.presentation as
      { routeStyles?: Record<string, { color?: unknown }> } | undefined
  )?.routeStyles;
  const routeEdges = graph.edges.map((edge) => {
    const color = routeStyles?.[edge.routeId]?.color;
    return freeze({
      edgeId: edge.edgeId,
      routeId: edge.routeId,
      patternId: edge.patternId,
      color: typeof color === 'string' ? color : '#67bed6',
      from: nodes.get(edge.fromStopNodeId)!,
      to: nodes.get(edge.toStopNodeId)!,
    });
  });
  return freeze({
    scenario,
    bounds: freeze({
      south: Math.min(...positions.map(({ latitude }) => latitude)),
      north: Math.max(...positions.map(({ latitude }) => latitude)),
      west: Math.min(...positions.map(({ longitude }) => longitude)),
      east: Math.max(...positions.map(({ longitude }) => longitude)),
    }),
    stopOccurrences: freeze(stopOccurrences),
    keyboardStops: freeze(keyboardStops),
    routeEdges: freeze(routeEdges),
    nodes,
    edges: new Map(
      graph.edges.map(({ edgeId, fromStopNodeId, toStopNodeId }) => [
        edgeId,
        freeze({ fromStopNodeId, toStopNodeId }),
      ]),
    ),
  });
}

const routeArrowhead = (
  from: CanvasPosition,
  to: CanvasPosition,
): readonly CanvasPosition[] | undefined => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return undefined;
  const directionX = dx / distance;
  const directionY = dy / distance;
  const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const length = Math.min(6, distance * 0.18);
  const width = Math.min(4, distance * 0.12);
  const base = {
    x: midpoint.x - directionX * length,
    y: midpoint.y - directionY * length,
  };
  return freeze([
    freeze({
      x: midpoint.x + directionX * length,
      y: midpoint.y + directionY * length,
    }),
    freeze({
      x: base.x - directionY * width,
      y: base.y + directionX * width,
    }),
    freeze({
      x: base.x + directionY * width,
      y: base.y - directionX * width,
    }),
  ]);
};

export function projectCanvas2dPosition(
  position: GeographicPosition,
  bounds: GeographicBounds,
  width: number,
  height: number,
): CanvasPosition {
  const margin = Math.min(16, width / 4, height / 4);
  const latitudeSpan = bounds.north - bounds.south;
  const longitudeSpan = bounds.east - bounds.west;
  return freeze({
    x:
      longitudeSpan === 0
        ? width / 2
        : margin +
          ((position.longitude - bounds.west) / longitudeSpan) *
            (width - margin * 2),
    y:
      latitudeSpan === 0
        ? height / 2
        : margin +
          ((bounds.north - position.latitude) / latitudeSpan) *
            (height - margin * 2),
  });
}

const requireNode = (index: Canvas2dSelectionIndex, id: StopNodeId) => {
  const position = index.nodes.get(id);
  if (!position)
    throw new Error(`Vehicle references missing canonical stop: ${id}.`);
  return position;
};

const vehiclePosition = (
  index: Canvas2dSelectionIndex,
  vehicle: VehicleState,
): GeographicPosition => {
  const movement = vehicle.movement;
  if (movement.kind !== 'running-on-edge')
    return requireNode(index, movement.stopNodeId);
  const edge = index.edges.get(movement.edgeId);
  if (!edge)
    throw new Error(
      `Vehicle references missing canonical edge: ${movement.edgeId}.`,
    );
  if (
    edge.fromStopNodeId !== movement.fromStopNodeId ||
    edge.toStopNodeId !== movement.toStopNodeId
  )
    throw new Error(`Vehicle edge endpoints do not match ${movement.edgeId}.`);
  if (
    !Number.isSafeInteger(movement.progressTicks) ||
    movement.progressTicks < 0 ||
    !Number.isSafeInteger(movement.travelTicks) ||
    movement.travelTicks <= 0 ||
    movement.progressTicks > movement.travelTicks
  )
    throw new Error('Invalid authoritative vehicle progress.');
  const from = requireNode(index, movement.fromStopNodeId);
  const to = requireNode(index, movement.toStopNodeId);
  const ratio = movement.progressTicks / movement.travelTicks;
  return freeze({
    latitude: from.latitude + (to.latitude - from.latitude) * ratio,
    longitude: from.longitude + (to.longitude - from.longitude) * ratio,
  });
};

export function createCanvas2dSelectionSnapshot(
  index: Canvas2dSelectionIndex,
  fleet: readonly VehicleState[],
  width: number,
  height: number,
  previous?: Canvas2dSelectionSnapshot,
): Canvas2dSelectionSnapshot {
  if (
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(height) ||
    height <= 0
  )
    throw new Error(
      'Canvas selection requires positive finite CSS dimensions.',
    );
  const project = (position: GeographicPosition) =>
    projectCanvas2dPosition(position, index.bounds, width, height);
  const stopPoint = (stop: GeographicStop) =>
    freeze({
      kind: 'stop' as const,
      stopPlaceId: stop.stopPlaceId,
      label: stop.label,
      ...project(stop.position),
    });
  const reusable =
    previous?.scenario === index.scenario &&
    previous.width === width &&
    previous.height === height;
  const stopPoints = reusable
    ? previous.stopPoints
    : freeze(index.stopOccurrences.map(stopPoint));
  const keyboardStopPoints = reusable
    ? previous.keyboardCandidates.slice(0, index.keyboardStops.length)
    : index.keyboardStops.map(stopPoint);
  const routeEdges = reusable
    ? previous.routeEdges
    : freeze(
        index.routeEdges.map((edge) => {
          const from = project(edge.from);
          const to = project(edge.to);
          return freeze({
            edgeId: edge.edgeId,
            routeId: edge.routeId,
            patternId: edge.patternId,
            color: edge.color,
            from,
            to,
            arrowhead: routeArrowhead(from, to),
          });
        }),
      );
  const vehiclePoints = fleet
    .map((vehicle) =>
      freeze({
        kind: 'vehicle' as const,
        vehicleId: vehicle.vehicleId,
        label: vehicle.label,
        ...project(vehiclePosition(index, vehicle)),
      }),
    )
    .sort((left, right) =>
      left.vehicleId < right.vehicleId
        ? -1
        : left.vehicleId > right.vehicleId
          ? 1
          : 0,
    );
  return freeze({
    scenario: index.scenario,
    width,
    height,
    routeEdges,
    stopPoints,
    vehiclePoints: freeze(vehiclePoints),
    keyboardCandidates: freeze([...keyboardStopPoints, ...vehiclePoints]),
  });
}

const identifier = (point: Canvas2dSelectablePoint) =>
  point.kind === 'vehicle' ? point.vehicleId : point.stopPlaceId;

export function hitTestCanvas2dSelection(
  snapshot: Canvas2dSelectionSnapshot,
  x: number,
  y: number,
): Canvas2dSelectablePoint | undefined {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  const nearest = (
    points: readonly Canvas2dSelectablePoint[],
    radius: number,
  ) =>
    points
      .map((point) => ({
        point,
        distanceSquared: (point.x - x) ** 2 + (point.y - y) ** 2,
      }))
      .filter(({ distanceSquared }) => distanceSquared <= radius ** 2)
      .sort((left, right) =>
        left.distanceSquared !== right.distanceSquared
          ? left.distanceSquared - right.distanceSquared
          : identifier(left.point) < identifier(right.point)
            ? -1
            : identifier(left.point) > identifier(right.point)
              ? 1
              : 0,
      )[0]?.point;
  return (
    nearest(snapshot.vehiclePoints, canvas2dVehicleHitRadius) ??
    nearest(snapshot.stopPoints, canvas2dStopHitRadius)
  );
}

export function canvas2dPointerPosition(
  bounds: Readonly<{
    left: number;
    top: number;
    width: number;
    height: number;
  }>,
  snapshot: Readonly<{ width: number; height: number }>,
  clientX: number,
  clientY: number,
): CanvasPosition | undefined {
  if (
    !Number.isFinite(clientX) ||
    !Number.isFinite(clientY) ||
    !Number.isFinite(bounds.left) ||
    !Number.isFinite(bounds.top) ||
    !Number.isFinite(bounds.width) ||
    bounds.width <= 0 ||
    !Number.isFinite(bounds.height) ||
    bounds.height <= 0 ||
    !Number.isFinite(snapshot.width) ||
    snapshot.width <= 0 ||
    !Number.isFinite(snapshot.height) ||
    snapshot.height <= 0
  )
    return undefined;
  return freeze({
    x: ((clientX - bounds.left) * snapshot.width) / bounds.width,
    y: ((clientY - bounds.top) * snapshot.height) / bounds.height,
  });
}
