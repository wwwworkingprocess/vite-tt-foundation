import {
  freezeRoutePresentation,
  type RoutePresentationAsset,
} from './route-presentation.js';
import { projectTransportMapPoint } from './transport-map-space.js';
import type {
  TransportMapProjection,
  TransportMapPoint,
  TransportMapVehicle,
} from './transport-map-projection.js';
type Arc = Readonly<{
  points: readonly TransportMapPoint[];
  cumulative: readonly number[];
}>;
export type RoutePresentationView = Readonly<{
  source: TransportMapProjection;
  map: TransportMapProjection;
}>;
const views = new WeakMap<
  TransportMapProjection,
  Map<RoutePresentationAsset | undefined, RoutePresentationView>
>();
const arcs = new WeakMap<RoutePresentationView, ReadonlyMap<string, Arc>>();
export function createRoutePresentationView(
  source: TransportMapProjection,
  asset?: RoutePresentationAsset,
): RoutePresentationView {
  let cache = views.get(source);
  if (!cache) {
    cache = new Map();
    views.set(source, cache);
  }
  const existing = cache.get(asset);
  if (existing) return existing;
  const legs = new Map<
    string,
    {
      leg: RoutePresentationAsset['routes'][number]['patterns'][number]['legs'][number];
      color: string;
    }
  >(
    asset?.routes.flatMap((r) =>
      r.patterns.flatMap((p) =>
        p.legs.map(
          (l, i) =>
            [`${p.patternId}:${i}`, { leg: l, color: r.color }] as const,
        ),
      ),
    ),
  );
  const arcIndex = new Map<string, Arc>();
  const routeColors = new Map(
    asset?.routes.map((route) => [route.routeId, route.color]),
  );
  const edges = source.edges.map((edge) => {
    const enrichment = legs.get(edge.edgeId);
    if (!enrichment) {
      const color = routeColors.get(edge.routeId);
      return color
        ? freezeRoutePresentation({
            ...edge,
            color,
            enriched: true,
            points: [edge.from, edge.to],
          })
        : edge;
    }
    const points = enrichment.leg.coordinates.map((c) =>
      projectTransportMapPoint(source.bounds, {
        longitude: c[0]!,
        latitude: c[1]!,
      }),
    );
    const cosine = Math.cos(
      ((source.bounds.north + source.bounds.south) * Math.PI) / 360,
    );
    const cumulative = [0];
    for (let i = 1; i < points.length; i++) {
      const a = enrichment.leg.coordinates[i - 1]!;
      const b = enrichment.leg.coordinates[i]!;
      cumulative.push(
        cumulative[i - 1]! +
          Math.hypot((b[0]! - a[0]!) * cosine, b[1]! - a[1]!),
      );
    }
    arcIndex.set(edge.edgeId, freezeRoutePresentation({ points, cumulative }));
    return freezeRoutePresentation({
      ...edge,
      color: enrichment.color,
      points,
      enriched: true,
    });
  });
  const view = freezeRoutePresentation({
    source,
    map: asset ? { ...source, edges } : source,
  });
  cache.set(asset, view);
  arcs.set(view, arcIndex);
  return view;
}
export function pointAtRouteProgress(
  view: RoutePresentationView,
  edgeId: string,
  progress: number,
) {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1)
    throw new Error('Invalid presentation progress');
  const edge = view.source.edges.find((e) => e.edgeId === edgeId);
  if (!edge) throw new Error('Unknown canonical presentation edge');
  const arc = arcs.get(view)!.get(edgeId);
  const points = arc?.points ?? [edge.from, edge.to];
  const cumulative = arc?.cumulative ?? [0, 1];
  const target = progress * cumulative.at(-1)!;
  let i = 1;
  while (i < points.length - 1 && cumulative[i]! <= target) i++;
  const a = points[i - 1]!;
  const b = points[i]!;
  const span = cumulative[i]! - cumulative[i - 1]!;
  const ratio = span === 0 ? 0 : (target - cumulative[i - 1]!) / span;
  const bounds = view.source.bounds;
  const cosine = Math.max(
    0.01,
    Math.cos(((bounds.north + bounds.south) * Math.PI) / 360),
  );
  return freezeRoutePresentation({
    point:
      progress === 0
        ? edge.from
        : progress === 1
          ? edge.to
          : { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio },
    headingRadians: Math.atan2(
      (b.x - a.x) * (bounds.east - bounds.west) * cosine,
      (b.y - a.y) * (bounds.north - bounds.south),
    ),
  });
}
export function projectRoutePresentationVehicles(
  view: RoutePresentationView,
  vehicles: readonly TransportMapVehicle[],
) {
  return freezeRoutePresentation(
    vehicles.map((vehicle) => {
      const routeId =
        vehicle.routeId ??
        view.source.edges.find((e) => e.patternId === vehicle.patternId)
          ?.routeId;
      const color = view.map.edges.find((e) => e.routeId === routeId)?.color;
      return {
        ...vehicle,
        ...(color ? { color } : {}),
        ...(vehicle.edgeId
          ? pointAtRouteProgress(
              view,
              vehicle.edgeId,
              vehicle.progressNumerator! / vehicle.progressDenominator!,
            )
          : {}),
      };
    }),
  );
}
export function routePresentationDrawOrder<
  T extends Readonly<{ routeId: string }>,
>(items: readonly T[], selectedRouteId?: string) {
  return selectedRouteId
    ? [...items].sort(
        (a, b) =>
          Number(a.routeId === selectedRouteId) -
          Number(b.routeId === selectedRouteId),
      )
    : items;
}
