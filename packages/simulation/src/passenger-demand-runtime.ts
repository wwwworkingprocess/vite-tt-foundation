import type { StopPlaceId } from '@torrevieja-tycoon/transport-domain';
import {
  checkedAdd,
  checkedMultiply,
  freezeTrustedAuthority,
} from './authority-utils.js';
import type {
  PassengerDemandPlanV1,
  PassengerDestinationCandidate,
} from './passenger-demand.js';

export interface PassengerDemandRuntimeIndex {
  readonly servedCandidates: readonly Readonly<PassengerDestinationCandidate>[];
  readonly totalServedDestinationWeight: number;
  readonly assignedWeightByStopPlace: ReadonlyMap<StopPlaceId, number>;
  readonly retainedRecordCount: number;
}

const indexes = new WeakMap<
  PassengerDemandPlanV1,
  PassengerDemandRuntimeIndex
>();

export const passengerDemandRuntimeIndex = (
  plan: PassengerDemandPlanV1,
): PassengerDemandRuntimeIndex => {
  const existing = indexes.get(plan);
  if (existing) return existing;
  const assignedWeightByStopPlace = new Map<StopPlaceId, number>(
    plan.stops.map(({ stopPlaceId }) => [stopPlaceId, 0]),
  );
  let totalServedDestinationWeight = 0;
  const servedCandidates = plan.cells.flatMap((cell) => {
    if (cell.assignedStopPlaceId === null) return [];
    totalServedDestinationWeight = checkedAdd(
      totalServedDestinationWeight,
      cell.populationWeight,
      'served destination weight',
    );
    assignedWeightByStopPlace.set(
      cell.assignedStopPlaceId,
      checkedAdd(
        assignedWeightByStopPlace.get(cell.assignedStopPlaceId)!,
        cell.populationWeight,
        'assigned StopPlace weight',
      ),
    );
    return [
      freezeTrustedAuthority({
        cellId: cell.cellId,
        row: cell.row,
        column: cell.column,
        destinationStopPlaceId: cell.assignedStopPlaceId,
        weight: cell.populationWeight,
      }),
    ];
  });
  const created = freezeTrustedAuthority({
    servedCandidates,
    totalServedDestinationWeight,
    assignedWeightByStopPlace,
    retainedRecordCount:
      servedCandidates.length + assignedWeightByStopPlace.size,
  });
  indexes.set(plan, created);
  return created;
};

const overlap = (
  start: number,
  end: number,
  segmentStart: number,
  segmentEnd: number,
) => Math.max(0, Math.min(end, segmentEnd) - Math.max(start, segmentStart));

export const allocateTrustedPassengerDestinations = (
  index: PassengerDemandRuntimeIndex,
  originStopPlaceId: StopPlaceId | string,
  cursor: number,
  passengerCount: number,
) => {
  const totalWeight =
    index.totalServedDestinationWeight -
    (index.assignedWeightByStopPlace.get(originStopPlaceId as StopPlaceId) ??
      0);
  if (totalWeight === 0)
    return freezeTrustedAuthority({ allocations: [], nextCursor: 0 });
  const fullCycles = Math.floor(passengerCount / totalWeight);
  const remainder = passengerCount % totalWeight;
  const distanceToCycleEnd = totalWeight - cursor;
  const wraps = remainder >= distanceToCycleEnd;
  const firstEnd = wraps ? totalWeight : cursor + remainder;
  const wrappedEnd = wraps ? remainder - distanceToCycleEnd : 0;
  let intervalStart = 0;
  const allocations = [] as Array<
    PassengerDestinationCandidate & { readonly count: number }
  >;
  for (const candidate of index.servedCandidates) {
    if (candidate.destinationStopPlaceId === originStopPlaceId) continue;
    const intervalEnd = checkedAdd(
      intervalStart,
      candidate.weight,
      'destination interval',
    );
    const base = checkedMultiply(
      fullCycles,
      candidate.weight,
      'destination allocation',
    );
    const extra =
      overlap(intervalStart, intervalEnd, cursor, firstEnd) +
      overlap(intervalStart, intervalEnd, 0, wrappedEnd);
    const count = checkedAdd(base, extra, 'destination allocation');
    if (count > 0) allocations.push({ ...candidate, count });
    intervalStart = intervalEnd;
  }
  return freezeTrustedAuthority({
    allocations,
    nextCursor: wraps ? wrappedEnd : firstEnd,
  });
};
