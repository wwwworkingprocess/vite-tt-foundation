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

const demoEdgeTravelTicks = 120;

export function createDemoVehicleCommandForAuthority(
  coordinate: ScenarioCoordinate,
  resolve: (coordinate: ScenarioCoordinate) => CanonicalScenario | undefined,
  fleet: readonly Readonly<{ vehicleId: string }>[] = [],
): Extract<TransportVehicleCommand, { kind: 'transport.vehicle.create' }> {
  const scenario = resolve(coordinate);
  if (
    !scenario ||
    !scenarioCoordinatesEqual(coordinate, createScenarioCoordinate(scenario))
  ) {
    throw new Error(
      'The authoritative scenario package is unavailable. Reload the scenario catalogue and try again.',
    );
  }
  const patterns = scenario.routes.routes.flatMap((route) => route.patterns);
  let index = 1;
  const existing = new Set(fleet.map((vehicle) => vehicle.vehicleId));
  while (existing.has(`browser-demo-vehicle-${String(index).padStart(3, '0')}`))
    index += 1;
  const suffix = String(index).padStart(3, '0');
  const pattern = patterns[(index - 1) % patterns.length];
  if (!pattern) {
    throw new Error('The authoritative scenario has no vehicle route pattern.');
  }
  const edgeCount = buildDirectedScenarioGraph(scenario).patternEdges(
    pattern.patternId,
  ).length;
  return Object.freeze({
    kind: 'transport.vehicle.create' as const,
    vehicleId: parseVehicleId(`browser-demo-vehicle-${suffix}`),
    label: `Demo vehicle ${suffix}`,
    patternId: pattern.patternId,
    movementPlan: Object.freeze({
      kind: 'vehicle-movement-plan-v1' as const,
      edgeTravelTicks: Object.freeze(
        Array.from({ length: edgeCount }, () => demoEdgeTravelTicks),
      ),
    }),
  });
}
