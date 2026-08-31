import type {
  CanonicalScenario,
  StopPlaceId,
} from '@torrevieja-tycoon/transport-domain';

type StopPlace = CanonicalScenario['stops']['stopPlaces'][number];
type StopNode = CanonicalScenario['stops']['stopNodes'][number];
type Settlement = CanonicalScenario['settlements']['settlements'][number];
type Route = CanonicalScenario['routes']['routes'][number];

export interface StopPlaceServiceBadge {
  readonly routeId: Route['routeId'];
  readonly publicCode: string;
}

export interface StopPlaceOccurrenceDetails {
  readonly occurrenceIndex: number;
  readonly stopNodeId: StopNode['stopNodeId'];
  readonly stopPlaceId: StopNode['stopPlaceId'];
  readonly name: string;
  readonly selected: boolean;
  readonly services: readonly StopPlaceServiceBadge[];
}

export interface StopPlacePatternDetails {
  readonly patternId: Route['patterns'][number]['patternId'];
  readonly directionLabel: string;
  readonly closesLoop: boolean;
  readonly stops: readonly StopPlaceOccurrenceDetails[];
}

export interface StopPlaceRouteDetails {
  readonly routeId: Route['routeId'];
  readonly publicCode: string;
  readonly name: string;
  readonly dataStatus: string;
  readonly patterns: readonly StopPlacePatternDetails[];
}

export interface StopPlaceDetailsModel {
  readonly stopPlace: StopPlace;
  readonly settlement: Settlement | undefined;
  readonly directionalNodes: readonly StopNode[];
  readonly services: readonly StopPlaceRouteDetails[];
}

export function deriveStopPlaceDetailsModel(
  scenario: CanonicalScenario,
  selectedStopPlaceId: StopPlaceId,
): StopPlaceDetailsModel | undefined {
  const stopPlace = scenario.stops.stopPlaces.find(
    ({ stopPlaceId }) => stopPlaceId === selectedStopPlaceId,
  );
  if (!stopPlace) return undefined;
  const nodes = new Map(
    scenario.stops.stopNodes.map((node) => [node.stopNodeId, node]),
  );
  const places = new Map(
    scenario.stops.stopPlaces.map((place) => [place.stopPlaceId, place]),
  );
  const routesByPlace = new Map<
    StopPlaceId,
    { routeId: Route['routeId']; publicCode: string }[]
  >();
  for (const route of scenario.routes.routes) {
    const seen = new Set<StopPlaceId>();
    for (const pattern of route.patterns)
      for (const nodeId of pattern.stopNodeIds) {
        const id = nodes.get(nodeId)?.stopPlaceId;
        if (id && !seen.has(id)) {
          seen.add(id);
          const services = routesByPlace.get(id) ?? [];
          services.push({
            routeId: route.routeId,
            publicCode: route.publicCode,
          });
          routesByPlace.set(id, services);
        }
      }
  }
  const services = scenario.routes.routes.flatMap((route) => {
    const patterns = route.patterns
      .filter((pattern) =>
        pattern.stopNodeIds.some(
          (id) => nodes.get(id)?.stopPlaceId === selectedStopPlaceId,
        ),
      )
      .map((pattern) => ({
        patternId: pattern.patternId,
        directionLabel: pattern.directionLabel,
        closesLoop: pattern.closesLoop,
        stops: pattern.stopNodeIds.map((stopNodeId, occurrenceIndex) => {
          const node = nodes.get(stopNodeId)!;
          const place = node.stopPlaceId
            ? places.get(node.stopPlaceId)
            : undefined;
          return {
            occurrenceIndex,
            stopNodeId,
            stopPlaceId: node.stopPlaceId,
            name: place?.name ?? node.name ?? stopNodeId,
            selected: node.stopPlaceId === selectedStopPlaceId,
            services: node.stopPlaceId
              ? routesByPlace.get(node.stopPlaceId)!
              : [],
          };
        }),
      }));
    return patterns.length
      ? [
          {
            routeId: route.routeId,
            publicCode: route.publicCode,
            name: route.name,
            dataStatus: route.dataStatus,
            patterns,
          },
        ]
      : [];
  });
  return Object.freeze({
    stopPlace,
    settlement: scenario.settlements.settlements.find(
      ({ settlementId }) => settlementId === stopPlace.settlementId,
    ),
    directionalNodes: scenario.stops.stopNodes.filter(
      ({ stopPlaceId }) => stopPlaceId === selectedStopPlaceId,
    ),
    services,
  });
}
