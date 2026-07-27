import type { VehicleState } from '@torrevieja-tycoon/simulation';
import type { CanonicalScenario } from '@torrevieja-tycoon/transport-domain';
import { projectVehicleMovementSvg } from './vehicle-svg-projection.js';

type SvgEdgeGeometry = Readonly<{
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}>;

const createMidpointArrowPoints = ({
  x1,
  y1,
  x2,
  y2,
}: SvgEdgeGeometry): string | undefined => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const distance = Math.hypot(dx, dy);

  if (distance === 0) return undefined;

  const unitX = dx / distance;
  const unitY = dy / distance;

  // Perpendicular unit vector.
  const perpendicularX = -unitY;
  const perpendicularY = unitX;

  const midpointX = (x1 + x2) / 2;
  const midpointY = (y1 + y2) / 2;

  // Keep arrows compact on short edges.
  const halfLength = Math.min(1.2, distance * 0.18);
  const halfWidth = Math.min(0.8, distance * 0.12);

  const tipX = midpointX + unitX * halfLength;
  const tipY = midpointY + unitY * halfLength;

  const baseX = midpointX - unitX * halfLength;
  const baseY = midpointY - unitY * halfLength;

  const leftX = baseX + perpendicularX * halfWidth;
  const leftY = baseY + perpendicularY * halfWidth;
  const rightX = baseX - perpendicularX * halfWidth;
  const rightY = baseY - perpendicularY * halfWidth;

  return `${tipX},${tipY} ${leftX},${leftY} ${rightX},${rightY}`;
};

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
        {projection.edges.map((edge) => {
          const color = edge.color ?? 'currentColor';
          const arrowPoints = createMidpointArrowPoints(edge);

          return (
            <g
              key={edge.edgeId}
              data-edge-group-id={edge.edgeId}
              data-route-id={edge.routeId}
              data-pattern-id={edge.patternId}
            >
              <line
                data-edge-id={edge.edgeId}
                data-route-id={edge.routeId}
                data-pattern-id={edge.patternId}
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                stroke={color}
                strokeWidth="0.6"
              />

              {arrowPoints ? (
                <polygon
                  data-testid="edge-direction"
                  data-direction-edge-id={edge.edgeId}
                  data-route-id={edge.routeId}
                  data-pattern-id={edge.patternId}
                  points={arrowPoints}
                  fill={color}
                  pointerEvents="none"
                  aria-hidden="true"
                />
              ) : null}
            </g>
          );
        })}
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
