import type {
  PassengerDemandProjection,
  PassengerOriginStopArrivalEvent,
} from '@torrevieja-tycoon/simulation';

export function passengerWaitingTotals(
  passengerDemand: PassengerDemandProjection | undefined,
) {
  const totals = new Map<string, number>();
  if (passengerDemand?.status === 'active')
    for (const cohort of passengerDemand.waitingCohorts) {
      const total = (totals.get(cohort.originStopPlaceId) ?? 0) + cohort.count;
      if (!Number.isSafeInteger(total))
        throw new Error('Passenger map waiting total exceeds safe range.');
      totals.set(cohort.originStopPlaceId, total);
    }
  return totals;
}

export function updatePassengerArrivalTicks(
  previous: ReadonlyMap<string, number>,
  events: readonly PassengerOriginStopArrivalEvent[],
  simulationTick: number,
) {
  const next = new Map(
    [...previous].filter(([, tick]) => simulationTick - tick < 5),
  );
  for (const event of events) {
    if (simulationTick - event.tick >= 5) continue;
    const prior = next.get(event.stopPlaceId);
    if (prior === undefined || prior < event.tick)
      next.set(event.stopPlaceId, event.tick);
  }
  return next;
}
