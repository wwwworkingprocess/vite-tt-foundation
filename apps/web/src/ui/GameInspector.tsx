import type {
  CurrentAlightingEvent,
  CurrentBoardingEvent,
  PassengerDemandProjection,
  PassengerJourneyCompletionEvent,
  VehiclePassengerLoadProjection,
  VehiclePatternRunState,
  VehicleState,
} from '@torrevieja-tycoon/simulation';
import type { CanonicalScenario } from '@torrevieja-tycoon/transport-domain';
import type { GameSelection } from './game-selection.js';

export interface GameInspectorProps {
  readonly selection: GameSelection;
  readonly scenario: CanonicalScenario;
  readonly fleet: readonly VehicleState[];
  readonly passengerDemand?: PassengerDemandProjection | undefined;
  readonly vehicleOperations?: readonly VehiclePatternRunState[] | undefined;
  readonly vehiclePassengerLoads?:
    readonly VehiclePassengerLoadProjection[] | undefined;
  readonly currentBoardingEvents?: readonly CurrentBoardingEvent[] | undefined;
  readonly currentAlightingEvents?:
    readonly CurrentAlightingEvent[] | undefined;
  readonly currentJourneyCompletionEvents?:
    readonly PassengerJourneyCompletionEvent[] | undefined;
  readonly onClear: () => void;
  readonly selectionDetailsOpen?: boolean;
  readonly onOpenSelectionDetails?: () => void;
}

const sum = (values: readonly number[]) =>
  values.reduce((total, value) => total + value, 0);
const Lines = ({ values }: { readonly values: readonly string[] }) =>
  values.map((value) => <p key={value}>{value}</p>);

export default function GameInspector(props: GameInspectorProps) {
  const demand = props.passengerDemand;
  const active = demand?.status === 'active' ? demand : undefined;
  const summaries = [
    ['Waiting', active?.totalWaitingForVehiclePassengerCount ?? 0],
    ['Onboard', active?.totalOnboardPassengerCount ?? 0],
    ['Destination access', active?.totalInDestinationAccessPassengerCount ?? 0],
    ['Completed journeys', active?.totalCompletedJourneyPassengerCount ?? 0],
    ['Active vehicles', props.fleet.length],
  ] as const;
  const global = (
    <dl data-testid="passenger-summary">
      {summaries.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
  const selection = props.selection;
  if (selection === null)
    return (
      <aside aria-label="Game object inspector">
        <p>Select a route, stop, or vehicle.</p>
        {global}
      </aside>
    );

  const unavailable = (
    <aside
      aria-label="Game object inspector"
      data-testid="unavailable-inspector"
    >
      {global}
      <button onClick={props.onClear}>Clear selection</button>
      <p>The selected game object is no longer available.</p>
    </aside>
  );

  if (selection.kind === 'route') {
    const route = props.scenario.routes.routes.find(
      ({ routeId }) => routeId === selection.routeId,
    );
    if (!route) return unavailable;
    const stopNodeIds = new Set(
      route.patterns.flatMap(({ stopNodeIds }) => stopNodeIds),
    );
    const stopPlaces = new Set(
      props.scenario.stops.stopNodes
        .filter(({ stopNodeId }) => stopNodeIds.has(stopNodeId))
        .flatMap(({ stopPlaceId }) => (stopPlaceId ? [stopPlaceId] : [])),
    );
    const waiting =
      active?.waitingCohorts.filter(
        ({ routeId }) => routeId === route.routeId,
      ) ?? [];
    const onboard =
      active?.onboardGroups.filter(
        ({ routeId }) => routeId === route.routeId,
      ) ?? [];
    return (
      <aside aria-label="Game object inspector" data-testid="route-inspector">
        {global}
        <button onClick={props.onClear}>Clear selection</button>
        <h2>Route {route.publicCode}</h2>
        <Lines values={[route.name, route.routeId]} />
        <ul>
          {route.patterns.map((pattern) => (
            <li key={pattern.patternId}>
              {pattern.patternId}: {pattern.stopNodeIds.length} stops, loop{' '}
              {String(pattern.closesLoop)}
            </li>
          ))}
        </ul>
        <Lines
          values={[
            `Physical stops: ${stopPlaces.size}`,
            `Active vehicles: ${
              props.fleet
                .filter(({ routeId }) => routeId === route.routeId)
                .map(({ vehicleId }) => vehicleId)
                .join(', ') || 'none'
            }`,
            `Waiting passengers: ${sum(waiting.map(({ count }) => count))}`,
            `Onboard passengers: ${sum(onboard.map(({ count }) => count))}`,
          ]}
        />
      </aside>
    );
  }

  if (selection.kind === 'stop') {
    const place = props.scenario.stops.stopPlaces.find(
      ({ stopPlaceId }) => stopPlaceId === selection.stopPlaceId,
    );
    if (!place) return unavailable;
    const nodes = props.scenario.stops.stopNodes.filter(
      ({ stopPlaceId }) => stopPlaceId === place.stopPlaceId,
    );
    const nodeIds = new Set(nodes.map(({ stopNodeId }) => stopNodeId));
    const waiting =
      active?.waitingCohorts.filter(
        ({ originStopPlaceId }) => originStopPlaceId === place.stopPlaceId,
      ) ?? [];
    const servingRoutes = props.scenario.routes.routes.filter((route) =>
      route.patterns.some((pattern) =>
        pattern.stopNodeIds.some((id) => nodeIds.has(id)),
      ),
    );
    return (
      <aside aria-label="Game object inspector" data-testid="stop-inspector">
        {global}
        <button onClick={props.onClear}>Clear selection</button>
        <section className="compact-stop-summary">
          <h2>Stop {place.name}</h2>
          <p>
            Services:{' '}
            {servingRoutes.map(({ routeId, publicCode }) => (
              <b className="route-badge" key={routeId}>
                {publicCode}
              </b>
            ))}
          </p>
          <p>Waiting passengers: {sum(waiting.map(({ count }) => count))}</p>
          {!props.selectionDetailsOpen ? (
            <button type="button" onClick={props.onOpenSelectionDetails}>
              Open details
            </button>
          ) : null}
        </section>
      </aside>
    );
  }

  const vehicle = props.fleet.find(
    ({ vehicleId }) => vehicleId === selection.vehicleId,
  );
  if (!vehicle) return unavailable;
  const load = props.vehiclePassengerLoads?.find(
    ({ vehicleId }) => vehicleId === vehicle.vehicleId,
  );
  return (
    <aside aria-label="Game object inspector" data-testid="vehicle-inspector">
      {global}
      <button onClick={props.onClear}>Clear selection</button>
      <section className="compact-vehicle-summary">
        <h2>Vehicle {vehicle.vehicleId}</h2>
        <Lines
          values={[
            `Route ${vehicle.routeId ?? 'standalone'}`,
            `Movement ${vehicle.movement.kind}`,
            `Occupancy ${load?.onboardPassengerCount ?? 0}`,
          ]}
        />
        {!props.selectionDetailsOpen ? (
          <button type="button" onClick={props.onOpenSelectionDetails}>
            Open details
          </button>
        ) : null}
      </section>
    </aside>
  );
}
