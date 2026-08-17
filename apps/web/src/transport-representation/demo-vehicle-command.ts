import {
  createScenarioCoordinate,
  parseVehicleId,
  scenarioCoordinatesEqual,
  type ScenarioCoordinate,
  type TransportVehicleCommand,
} from '@torrevieja-tycoon/simulation';
import {
  buildDirectedScenarioGraph,
  type CanonicalScenario,
} from '@torrevieja-tycoon/transport-domain';

export const DEFAULT_DEMO_EDGE_TRAVEL_TICKS = 120;

export function createDemoVehicleCommandForAuthority(
  coordinate: ScenarioCoordinate,
  resolve: (coordinate: ScenarioCoordinate) => CanonicalScenario | undefined,
  fleet: readonly Readonly<{ vehicleId: string }>[] = [],
  requestedRouteId?: string,
): Extract<
  TransportVehicleCommand,
  { kind: 'transport.vehicle.create-route-cycle' }
> {
  const scenario = resolve(coordinate);
  if (
    !scenario ||
    !scenarioCoordinatesEqual(coordinate, createScenarioCoordinate(scenario))
  ) {
    throw new Error(
      'The authoritative scenario package is unavailable. Reload the scenario catalogue and try again.',
    );
  }
  let index = 1;
  const existing = new Set(fleet.map((vehicle) => vehicle.vehicleId));
  while (existing.has(`browser-demo-vehicle-${String(index).padStart(3, '0')}`))
    index += 1;
  const suffix = String(index).padStart(3, '0');
  const route = requestedRouteId
    ? scenario.routes.routes.find(
        (candidate) => candidate.routeId === requestedRouteId,
      )
    : scenario.routes.routes[0];
  if (!route)
    throw new Error(
      'The selected route is unavailable in the authoritative scenario.',
    );
  const graph = buildDirectedScenarioGraph(scenario);
  const legs = route.patterns.map((pattern) => {
    const edgeCount = graph.patternEdges(pattern.patternId).length;
    return Object.freeze({
      patternId: pattern.patternId,
      movementPlan: Object.freeze({
        kind: 'vehicle-movement-plan-v1' as const,
        edgeTravelTicks: Object.freeze(
          Array.from(
            { length: edgeCount },
            () => DEFAULT_DEMO_EDGE_TRAVEL_TICKS,
          ),
        ),
      }),
    });
  });
  return Object.freeze({
    kind: 'transport.vehicle.create-route-cycle' as const,
    vehicleId: parseVehicleId(`browser-demo-vehicle-${suffix}`),
    label: `Demo vehicle ${suffix}`,
    routeId: route.routeId,
    legs: Object.freeze(legs),
  });
}
