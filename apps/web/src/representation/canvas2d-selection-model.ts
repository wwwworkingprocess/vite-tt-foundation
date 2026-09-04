import type { VehicleId, VehicleState } from '@torrevieja-tycoon/simulation';
import type {
  CanonicalScenario,
  StopNodeId,
  StopPlaceId,
} from '@torrevieja-tycoon/transport-domain';
import {
  createTransportMapProjection,
  projectTransportMapVehicles,
  type TransportMapPoint,
  type TransportMapProjection,
} from './transport-map-projection.js';

type CanvasPosition = Readonly<{ x: number; y: number }>;

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

type MapStop = Readonly<{
  stopPlaceId: StopPlaceId;
  stopNodeId?: StopNodeId;
  label: string;
  point: TransportMapPoint;
}>;

type MapRouteEdge = Readonly<{
  edgeId: string;
  routeId: string;
  patternId: string;
  color: string;
  from: TransportMapPoint;
  to: TransportMapPoint;
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
  readonly map: TransportMapProjection;
  readonly stopOccurrences: readonly MapStop[];
  readonly keyboardStops: readonly MapStop[];
  readonly routeEdges: readonly MapRouteEdge[];
  readonly nodes: ReadonlyMap<StopNodeId, TransportMapPoint>;
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
  const map = createTransportMapProjection(scenario);
  const nodes = new Map(map.nodes.map((node) => [node.stopNodeId, node.point]));
  const placeNames = new Map(
    map.stopPlaces.map((stop) => [stop.stopPlaceId, stop.name]),
  );
  const stopOccurrences: MapStop[] = [];
  const firstOccurrence = new Map<StopPlaceId, MapStop>();
  for (const node of map.nodes) {
    if (!node.stopPlaceId) continue;
    const occurrence = freeze({
      stopPlaceId: node.stopPlaceId,
      stopNodeId: node.stopNodeId,
      label: placeNames.get(node.stopPlaceId)!,
      point: node.point,
    });
    stopOccurrences.push(occurrence);
    if (!firstOccurrence.has(node.stopPlaceId))
      firstOccurrence.set(node.stopPlaceId, occurrence);
  }
  const keyboardStops = map.stopPlaces.map((stop) => {
    const occurrence = firstOccurrence.get(stop.stopPlaceId);
    if (occurrence) return occurrence;
    const standalone = freeze({
      stopPlaceId: stop.stopPlaceId,
      label: stop.name,
      point: stop.point,
    });
    stopOccurrences.push(standalone);
    return standalone;
  });
  const routeEdges = map.edges.map((edge) =>
    freeze({
      edgeId: edge.edgeId,
      routeId: edge.routeId,
      patternId: edge.patternId,
      color: edge.color ?? '#67bed6',
      from: edge.from,
      to: edge.to,
    }),
  );
  return freeze({
    scenario,
    map,
    stopOccurrences: freeze(stopOccurrences),
    keyboardStops: freeze(keyboardStops),
    routeEdges: freeze(routeEdges),
    nodes,
    edges: new Map(
      map.edges.map(({ edgeId, fromStopNodeId, toStopNodeId }) => [
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
  point: TransportMapPoint,
  width: number,
  height: number,
): CanvasPosition {
  const margin = Math.min(16, width / 4, height / 4);
  return freeze({
    x: margin + point.x * (width - margin * 2),
    y: margin + point.y * (height - margin * 2),
  });
}

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
  const project = (point: TransportMapPoint) =>
    projectCanvas2dPosition(point, width, height);
  const stopPoint = (stop: MapStop) =>
    freeze({
      kind: 'stop' as const,
      stopPlaceId: stop.stopPlaceId,
      label: stop.label,
      ...project(stop.point),
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
  const vehiclePoints = projectTransportMapVehicles(index.map, fleet)
    .map((vehicle) =>
      freeze({
        kind: 'vehicle' as const,
        vehicleId: vehicle.vehicleId,
        label: vehicle.label,
        ...project(vehicle.point),
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
