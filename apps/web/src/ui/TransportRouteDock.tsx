import type { CanonicalScenario } from '@torrevieja-tycoon/transport-domain';
import { selectRoute, type GameSelection } from './game-selection.js';

export function TransportRouteDock({
  scenario,
  selection,
  ready,
  onSelectionChange,
  onAddBus,
}: Readonly<{
  scenario: CanonicalScenario;
  selection: GameSelection;
  ready: boolean;
  onSelectionChange: (selection: GameSelection) => void;
  onAddBus: () => void;
}>) {
  const selectedRouteId =
    selection?.kind === 'route' ? selection.routeId : undefined;
  const selectedRoute = scenario.routes.routes.find(
    (route) => route.routeId === selectedRouteId,
  );
  return (
    <section className="transport-route-dock" aria-label="Transport routes">
      <div
        className="transport-route-selector"
        role="group"
        aria-label="Routes"
      >
        {scenario.routes.routes.map((route) => (
          <button
            key={route.routeId}
            type="button"
            data-route-id={route.routeId}
            aria-pressed={route.routeId === selectedRouteId}
            aria-label={`Select route ${route.publicCode} — ${route.name}`}
            onClick={() => onSelectionChange(selectRoute(route.routeId))}
          >
            {route.publicCode}
          </button>
        ))}
      </div>
      {selectedRoute ? (
        <div
          className="selected-route-actions"
          role="group"
          aria-label={`Actions for route ${selectedRoute.publicCode}`}
          data-route-id={selectedRoute.routeId}
        >
          <span>{selectedRoute.name}</span>
          <button type="button" disabled={!ready} onClick={onAddBus}>
            Add bus
          </button>
        </div>
      ) : null}
    </section>
  );
}
