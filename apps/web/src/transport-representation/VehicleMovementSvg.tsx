import type { VehicleState } from '@torrevieja-tycoon/simulation';
import type { CanonicalScenario } from '@torrevieja-tycoon/transport-domain';
import { projectVehicleMovementSvg } from './vehicle-svg-projection.js';

export function VehicleMovementSvg({
  scenario,
  fleet,
}: Readonly<{
  scenario: CanonicalScenario;
  fleet: readonly VehicleState[];
}>) {
  const projection = projectVehicleMovementSvg(scenario, fleet);
  return (
    <svg
      data-testid="vehicle-movement-svg"
      data-scenario-id={scenario.manifest.scenarioId}
      data-content-hash={scenario.manifest.contentHash}
      data-node-count={projection.nodes.length}
      data-directed-edge-count={projection.edges.length}
      viewBox={projection.viewBox}
      role="img"
      aria-label="Authoritative vehicle movement"
    >
      <g aria-label="Directed route edges">
        {projection.edges.map((edge) => (
          <line
            key={edge.edgeId}
            data-edge-id={edge.edgeId}
            data-route-id={edge.routeId}
            data-pattern-id={edge.patternId}
            x1={edge.x1}
            y1={edge.y1}
            x2={edge.x2}
            y2={edge.y2}
            stroke={edge.color ?? 'currentColor'}
            strokeWidth="0.6"
          />
        ))}
      </g>
      <g aria-label="Canonical stops">
        {projection.nodes.map((node) => (
          <circle
            key={node.stopNodeId}
            data-stop-node-id={node.stopNodeId}
            cx={node.cx}
            cy={node.cy}
            r="0.8"
            fill="currentColor"
          />
        ))}
      </g>
      <g aria-label="Authoritative vehicles">
        {projection.vehicles.map((vehicle) => (
          <circle
            key={vehicle.vehicleId}
            data-testid="vehicle-position"
            data-vehicle-id={vehicle.vehicleId}
            data-movement-kind={vehicle.movementKind}
            data-route-id={vehicle.routeId}
            data-pattern-id={vehicle.patternId}
            data-route-leg-index={vehicle.routeLegIndex}
            data-completed-route-cycles={vehicle.completedRouteCycles}
            data-edge-id={vehicle.edgeId}
            data-progress-numerator={vehicle.progressNumerator}
            data-progress-denominator={vehicle.progressDenominator}
            aria-label={`${vehicle.label}: ${vehicle.movementKind}`}
            cx={vehicle.cx}
            cy={vehicle.cy}
            r="1.8"
            fill="crimson"
          />
        ))}
      </g>
    </svg>
  );
}
