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
}

const sum = (values: readonly number[]) =>
  values.reduce((total, value) => total + value, 0);

export default function GameInspector(props: GameInspectorProps) {
  const demand = props.passengerDemand;
  const active = demand?.status === 'active' ? demand : undefined;
  const global = (
    <dl data-testid="passenger-summary">
      <div>
        <dt>Waiting</dt>
        <dd>{active?.totalWaitingForVehiclePassengerCount ?? 0}</dd>
      </div>
      <div>
        <dt>Onboard</dt>
        <dd>{active?.totalOnboardPassengerCount ?? 0}</dd>
      </div>
      <div>
        <dt>Destination access</dt>
        <dd>{active?.totalInDestinationAccessPassengerCount ?? 0}</dd>
      </div>
      <div>
        <dt>Completed journeys</dt>
        <dd>{active?.totalCompletedJourneyPassengerCount ?? 0}</dd>
      </div>
      <div>
        <dt>Active vehicles</dt>
        <dd>{props.fleet.length}</dd>
      </div>
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
        <p>{route.name}</p>
        <p>{route.routeId}</p>
        <ul>
          {route.patterns.map((pattern) => (
            <li key={pattern.patternId}>
              {pattern.patternId}: {pattern.stopNodeIds.length} stops, loop{' '}
              {String(pattern.closesLoop)}
            </li>
          ))}
        </ul>
        <p>Physical stops: {stopPlaces.size}</p>
        <p>
          Active vehicles:{' '}
          {props.fleet
            .filter(({ routeId }) => routeId === route.routeId)
            .map(({ vehicleId }) => vehicleId)
            .join(', ') || 'none'}
        </p>
        <p>Waiting passengers: {sum(waiting.map(({ count }) => count))}</p>
        <p>Onboard passengers: {sum(onboard.map(({ count }) => count))}</p>
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
    const patterns = props.scenario.routes.routes.flatMap((route) =>
      route.patterns
        .filter(({ stopNodeIds }) => stopNodeIds.some((id) => nodeIds.has(id)))
        .map((pattern) => `${route.routeId}/${pattern.patternId}`),
    );
    const waiting =
      active?.waitingCohorts.filter(
        ({ originStopPlaceId }) => originStopPlaceId === place.stopPlaceId,
      ) ?? [];
    const boarding =
      props.currentBoardingEvents?.filter(({ stopNodeId }) =>
        nodeIds.has(stopNodeId),
      ) ?? [];
    const alighting =
      props.currentAlightingEvents?.filter(({ stopNodeId }) =>
        nodeIds.has(stopNodeId),
      ) ?? [];
    const access =
      active?.destinationAccessGroups.filter(
        ({ destinationStopPlaceId }) =>
          destinationStopPlaceId === place.stopPlaceId,
      ) ?? [];
    return (
      <aside aria-label="Game object inspector" data-testid="stop-inspector">
        {global}
        <button onClick={props.onClear}>Clear selection</button>
        <h2>Stop {place.name}</h2>
        <p>{place.stopPlaceId}</p>
        <p>{place.settlementId}</p>
        <p>
          {place.position
            ? `${place.position.latitude}, ${place.position.longitude}`
            : 'No canonical position'}
        </p>
        <p>
          Directional nodes:{' '}
          {nodes.map(({ stopNodeId }) => stopNodeId).join(', ')}
        </p>
        <p>Services: {patterns.join(', ') || 'none'}</p>
        <p>Waiting passengers: {sum(waiting.map(({ count }) => count))}</p>
        <p>Waiting cohorts: {waiting.length}</p>
        <p>
          Distinct destination StopPlaces:{' '}
          {
            new Set(
              waiting.map(
                ({ destinationStopPlaceId }) => destinationStopPlaceId,
              ),
            ).size
          }
        </p>
        <p>
          Boarding this tick:{' '}
          {sum(
            boarding.map(({ boardedPassengerCount }) => boardedPassengerCount),
          )}
        </p>
        <p>
          Alighting this tick:{' '}
          {sum(
            alighting.map(
              ({ alightedPassengerCount }) => alightedPassengerCount,
            ),
          )}
        </p>
        <p>Destination access: {sum(access.map(({ count }) => count))}</p>
      </aside>
    );
  }

  const vehicle = props.fleet.find(
    ({ vehicleId }) => vehicleId === selection.vehicleId,
  );
  if (!vehicle) return unavailable;
  const operation = props.vehicleOperations?.find(
    ({ vehicleId }) => vehicleId === vehicle.vehicleId,
  );
  const load = props.vehiclePassengerLoads?.find(
    ({ vehicleId }) => vehicleId === vehicle.vehicleId,
  );
  const onboard =
    active?.onboardGroups.filter(
      ({ vehicleId }) => vehicleId === vehicle.vehicleId,
    ) ?? [];
  const boarding =
    props.currentBoardingEvents?.filter(
      ({ vehicleId }) => vehicleId === vehicle.vehicleId,
    ) ?? [];
  const alighting =
    props.currentAlightingEvents?.filter(
      ({ vehicleId }) => vehicleId === vehicle.vehicleId,
    ) ?? [];
  return (
    <aside aria-label="Game object inspector" data-testid="vehicle-inspector">
      {global}
      <button onClick={props.onClear}>Clear selection</button>
      <h2>Vehicle {vehicle.vehicleId}</h2>
      <p>Route {vehicle.routeId ?? 'standalone'}</p>
      <p>Pattern {vehicle.patternId}</p>
      <p>Movement {vehicle.movement.kind}</p>
      <p>
        Location{' '}
        {vehicle.movement.kind === 'running-on-edge'
          ? vehicle.movement.edgeId
          : vehicle.movement.stopNodeId}
      </p>
      <p>Route leg {vehicle.routeLegIndex ?? 0}</p>
      <p>Completed cycles {vehicle.completedRouteCycles ?? 0}</p>
      <p>Pattern run {operation?.patternRunSequence ?? 'unavailable'}</p>
      <p>Stop call {operation?.stopCallSequence ?? 'unavailable'}</p>
      <p>Capacity {load?.passengerCapacity ?? 0}</p>
      <p>Occupancy {load?.onboardPassengerCount ?? 0}</p>
      <p>Remaining {load?.remainingPassengerCapacity ?? 0}</p>
      <p>
        Onboard groups:{' '}
        {onboard
          .map(
            ({ passengerOnboardGroupId, destinationStopPlaceId, count }) =>
              `${passengerOnboardGroupId}→${destinationStopPlaceId} (${count})`,
          )
          .join(', ') || 'none'}
      </p>
      <p>
        Boarding this tick:{' '}
        {sum(
          boarding.map(({ boardedPassengerCount }) => boardedPassengerCount),
        )}
      </p>
      <p>
        Alighting this tick:{' '}
        {sum(
          alighting.map(({ alightedPassengerCount }) => alightedPassengerCount),
        )}
      </p>
      {props.currentJourneyCompletionEvents?.some(
        ({ vehicleId }) => vehicleId === vehicle.vehicleId,
      ) ? (
        <p>Journey completion occurred this tick.</p>
      ) : null}
    </aside>
  );
}
