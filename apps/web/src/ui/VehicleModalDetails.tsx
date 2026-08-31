import type {
  CurrentAlightingEvent,
  CurrentBoardingEvent,
  PassengerDemandProjection,
  PassengerJourneyCompletionEvent,
  VehicleId,
  VehiclePassengerLoadProjection,
  VehiclePatternRunState,
  VehicleState,
} from '@torrevieja-tycoon/simulation';

const sum = (values: readonly number[]) =>
  values.reduce((total, value) => total + value, 0);

export default function VehicleModalDetails({
  vehicleId,
  fleet,
  passengerDemand,
  vehicleOperations,
  vehiclePassengerLoads,
  currentBoardingEvents,
  currentAlightingEvents,
  currentJourneyCompletionEvents,
}: Readonly<{
  vehicleId: VehicleId;
  fleet: readonly VehicleState[];
  passengerDemand?: PassengerDemandProjection | undefined;
  vehicleOperations?: readonly VehiclePatternRunState[] | undefined;
  vehiclePassengerLoads?: readonly VehiclePassengerLoadProjection[] | undefined;
  currentBoardingEvents?: readonly CurrentBoardingEvent[] | undefined;
  currentAlightingEvents?: readonly CurrentAlightingEvent[] | undefined;
  currentJourneyCompletionEvents?:
    readonly PassengerJourneyCompletionEvent[] | undefined;
}>) {
  const vehicle = fleet.find((candidate) => candidate.vehicleId === vehicleId);
  if (!vehicle) return <p>The selected vehicle is no longer available.</p>;
  const operation = vehicleOperations?.find(
    (candidate) => candidate.vehicleId === vehicleId,
  );
  const load = vehiclePassengerLoads?.find(
    (candidate) => candidate.vehicleId === vehicleId,
  );
  const active =
    passengerDemand?.status === 'active' ? passengerDemand : undefined;
  const onboard =
    active?.onboardGroups.filter((group) => group.vehicleId === vehicleId) ??
    [];
  const boarding =
    currentBoardingEvents?.filter((event) => event.vehicleId === vehicleId) ??
    [];
  const alighting =
    currentAlightingEvents?.filter((event) => event.vehicleId === vehicleId) ??
    [];
  const location =
    vehicle.movement.kind === 'running-on-edge'
      ? vehicle.movement.edgeId
      : vehicle.movement.stopNodeId;
  return (
    <section data-testid="vehicle-modal-details">
      <h3>Vehicle overview</h3>
      <p>Route {vehicle.routeId ?? 'standalone'}</p>
      <p>Pattern {vehicle.patternId}</p>
      <p>Movement {vehicle.movement.kind}</p>
      <p>Location {location}</p>
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
      {currentJourneyCompletionEvents?.some(
        (event) => event.vehicleId === vehicleId,
      ) ? (
        <p>Journey completion occurred this tick.</p>
      ) : null}
    </section>
  );
}
