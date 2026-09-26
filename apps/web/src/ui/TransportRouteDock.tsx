import { ControlIcon } from './ControlIcon.js';
import type {
  CanonicalScenario,
  RouteId,
} from '@torrevieja-tycoon/transport-domain';
import { selectRoute, type GameSelection } from './game-selection.js';

export function TransportRouteDock({
  scenario,
  selection,
  ready,
  onSelectionChange,
  onAddBus,
  focusedRouteId,
  onFocusRoute,
  onShowFullNetwork,
}: Readonly<{
  scenario: CanonicalScenario;
  selection: GameSelection;
  ready: boolean;
  onSelectionChange: (selection: GameSelection) => void;
  onAddBus: () => void;
  focusedRouteId?: RouteId | undefined;
  onFocusRoute: (routeId: RouteId) => void;
  onShowFullNetwork: () => void;
}>) {
  const selectedRouteId =
    selection?.kind === 'route' ? selection.routeId : undefined;
  const selectedRoute = scenario.routes.routes.find(
    (route) => route.routeId === selectedRouteId,
  );
  return (
    <section
      className="transport-route-dock"
      aria-label="Transport routes"
      data-focused-route-id={focusedRouteId}
    >
      <h2 className="route-dock-heading">
        Routes <span>{scenario.routes.routes.length}</span>
      </h2>
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
            title={route.name}
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
          <span>
            <small>Selected route {selectedRoute.publicCode}</small>
            {selectedRoute.name}
          </span>
          <button type="button" disabled={!ready} onClick={onAddBus}>
            <ControlIcon name="plus" />
            Add bus
          </button>
          {focusedRouteId === selectedRoute.routeId ? (
            <button type="button" onClick={onShowFullNetwork}>
              <ControlIcon name="network" />
              Show full network
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onFocusRoute(selectedRoute.routeId)}
            >
              <ControlIcon name="focus" />
              Focus route
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}
