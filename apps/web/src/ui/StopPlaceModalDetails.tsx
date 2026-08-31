import type {
  CurrentAlightingEvent,
  CurrentBoardingEvent,
  PassengerDemandProjection,
} from '@torrevieja-tycoon/simulation';
import type {
  CanonicalScenario,
  StopPlaceId,
} from '@torrevieja-tycoon/transport-domain';
import { useMemo } from 'react';
import StopPlaceDetails from './StopPlaceDetails.js';
import { deriveStopPlaceDetailsModel } from './stop-place-details-model.js';

export default function StopPlaceModalDetails({
  scenario,
  stopPlaceId,
  passengerDemand,
  currentBoardingEvents,
  currentAlightingEvents,
}: Readonly<{
  scenario: CanonicalScenario;
  stopPlaceId: StopPlaceId;
  passengerDemand?: PassengerDemandProjection | undefined;
  currentBoardingEvents?: readonly CurrentBoardingEvent[] | undefined;
  currentAlightingEvents?: readonly CurrentAlightingEvent[] | undefined;
}>) {
  const model = useMemo(
    () => deriveStopPlaceDetailsModel(scenario, stopPlaceId),
    [scenario, stopPlaceId],
  );
  if (!model) return <p>The selected StopPlace is no longer available.</p>;
  const active =
    passengerDemand?.status === 'active' ? passengerDemand : undefined;
  const nodeIds = new Set(
    model.directionalNodes.map(({ stopNodeId }) => stopNodeId),
  );
  const waiting =
    active?.waitingCohorts.filter(
      ({ originStopPlaceId }) => originStopPlaceId === stopPlaceId,
    ) ?? [];
  const sum = (values: readonly number[]) =>
    values.reduce((total, value) => total + value, 0);
  const live = Object.freeze({
    waitingPassengers: sum(waiting.map(({ count }) => count)),
    waitingCohorts: waiting.length,
    distinctDestinations: new Set(
      waiting.map(({ destinationStopPlaceId }) => destinationStopPlaceId),
    ).size,
    boardingThisTick: sum(
      (currentBoardingEvents ?? [])
        .filter(({ stopNodeId }) => nodeIds.has(stopNodeId))
        .map(({ boardedPassengerCount }) => boardedPassengerCount),
    ),
    alightingThisTick: sum(
      (currentAlightingEvents ?? [])
        .filter(({ stopNodeId }) => nodeIds.has(stopNodeId))
        .map(({ alightedPassengerCount }) => alightedPassengerCount),
    ),
    destinationAccess: sum(
      (active?.destinationAccessGroups ?? [])
        .filter(
          ({ destinationStopPlaceId }) =>
            destinationStopPlaceId === stopPlaceId,
        )
        .map(({ count }) => count),
    ),
  });
  return <StopPlaceDetails model={model} live={live} />;
}
