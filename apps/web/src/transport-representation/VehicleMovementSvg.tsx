import type { VehicleState } from '@torrevieja-tycoon/simulation';
import type { CanonicalScenario } from '@torrevieja-tycoon/transport-domain';
import type { KeyboardEvent } from 'react';
import { selectVehicle, type GameSelection } from '../ui/game-selection.js';
import { projectVehicleMovementSvg } from './vehicle-svg-projection.js';
import StaticScenarioSvgLayer from './StaticScenarioSvgLayer.js';

export function VehicleMovementSvg({
  scenario,
  fleet,
  selection = null,
  onSelectionChange,
}: Readonly<{
  scenario: CanonicalScenario;
  fleet: readonly VehicleState[];
  selection?: GameSelection;
  onSelectionChange?: (selection: GameSelection) => void;
}>) {
  const projection = projectVehicleMovementSvg(scenario, fleet);
  const activate = (callback: () => void) => (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      callback();
    }
  };
  return (
    <svg
      data-testid="vehicle-movement-svg"
      data-scenario-id={scenario.manifest.scenarioId}
      data-content-hash={scenario.manifest.contentHash}
      data-node-count={projection.nodes.length}
      data-directed-edge-count={projection.edges.length}
      viewBox={projection.viewBox}
      role="group"
      aria-label="Authoritative vehicle movement"
    >
      <StaticScenarioSvgLayer
        edges={projection.edges}
        nodes={projection.nodes}
        selection={
          selection?.kind === 'route' || selection?.kind === 'stop'
            ? selection
            : null
        }
        onSelectionChange={onSelectionChange}
      />
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
            role="button"
            tabIndex={0}
            data-selected={
              selection?.kind === 'vehicle' &&
              selection.vehicleId === vehicle.vehicleId
            }
            onClick={() =>
              onSelectionChange?.(selectVehicle(vehicle.vehicleId))
            }
            onKeyDown={activate(() =>
              onSelectionChange?.(selectVehicle(vehicle.vehicleId)),
            )}
          />
        ))}
      </g>
    </svg>
  );
}
