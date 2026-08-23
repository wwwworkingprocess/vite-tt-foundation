import type {
  CityPopulationCellId,
  StopPlaceId,
} from '@torrevieja-tycoon/transport-domain';
import {
  checkedAdd,
  checkedMultiply,
  freezeTrustedAuthority,
} from './authority-utils.js';
import type {
  PassengerDemandPlanV1,
  PassengerDemandPlanCell,
  PassengerDestinationCandidate,
} from './passenger-demand.js';
import {
  addModulo,
  derivePassengerDestinationPermutation,
  multiplyModulo,
} from './passenger-destination-permutation.js';

export interface PassengerDemandRuntimeIndex {
  readonly demandModelContentHash: string;
  readonly servedCandidates: readonly Readonly<PassengerDestinationCandidate>[];
  readonly totalServedDestinationWeight: number;
  readonly assignedWeightByStopPlace: ReadonlyMap<StopPlaceId, number>;
  readonly exclusionByStopPlace: ReadonlyMap<
    StopPlaceId,
    Readonly<{
      readonly indexes: readonly number[];
      readonly cumulativeEnds: readonly number[];
    }>
  >;
  readonly cumulativeWeightEnds: readonly number[];
  readonly planCellCount: number;
  readonly findCell: (
    cellId: CityPopulationCellId | string,
  ) => Readonly<PassengerDemandPlanCell> | undefined;
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
  const candidateIndexesByStopPlace = new Map<StopPlaceId, number[]>();
  const cellsById = new Map<CityPopulationCellId, PassengerDemandPlanCell>();
  const cumulativeWeightEnds: number[] = [];
  const servedCandidates = plan.cells.flatMap((cell) => {
    cellsById.set(cell.cellId, cell);
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
    const candidateIndex = cumulativeWeightEnds.length;
    cumulativeWeightEnds.push(totalServedDestinationWeight);
    const indexes =
      candidateIndexesByStopPlace.get(cell.assignedStopPlaceId) ?? [];
    indexes.push(candidateIndex);
    candidateIndexesByStopPlace.set(cell.assignedStopPlaceId, indexes);
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
  const exclusionByStopPlace = new Map(
    [...candidateIndexesByStopPlace].map(([stopPlaceId, candidateIndexes]) => {
      let cumulative = 0;
      return [
        stopPlaceId,
        {
          indexes: candidateIndexes,
          cumulativeEnds: candidateIndexes.map((candidateIndex) => {
            cumulative = checkedAdd(
              cumulative,
              servedCandidates[candidateIndex]!.weight,
              'excluded destination weight',
            );
            return cumulative;
          }),
        },
      ] as const;
    }),
  );
  const created = freezeTrustedAuthority({
    demandModelContentHash: plan.demandModelContentHash,
    servedCandidates,
    totalServedDestinationWeight,
    assignedWeightByStopPlace,
    exclusionByStopPlace,
    cumulativeWeightEnds,
    planCellCount: plan.cells.length,
    findCell: (cellId: CityPopulationCellId | string) =>
      cellsById.get(cellId as CityPopulationCellId),
  });
  indexes.set(plan, created);
  return created;
};

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
  const exclusion = index.exclusionByStopPlace.get(
    originStopPlaceId as StopPlaceId,
  );
  const excludedThrough = (candidateIndex: number) => {
    if (!exclusion) return 0;
    let low = 0;
    let high = exclusion.indexes.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (exclusion.indexes[middle]! <= candidateIndex) low = middle + 1;
      else high = middle;
    }
    return low === 0 ? 0 : exclusion.cumulativeEnds[low - 1]!;
  };
  const candidateAt = (position: number) => {
    let low = 0;
    let high = index.servedCandidates.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const eligibleEnd =
        index.cumulativeWeightEnds[middle]! - excludedThrough(middle);
      if (position < eligibleEnd) high = middle;
      else low = middle + 1;
    }
    return low;
  };
  const counts = new Map<number, number>();
  const fullCycles = Math.floor(passengerCount / totalWeight);
  if (fullCycles > 0)
    index.servedCandidates.forEach((candidate, candidateIndex) => {
      if (candidate.destinationStopPlaceId !== originStopPlaceId)
        counts.set(
          candidateIndex,
          checkedMultiply(
            fullCycles,
            candidate.weight,
            'destination allocation',
          ),
        );
    });
  const permutation = derivePassengerDestinationPermutation(
    index.demandModelContentHash,
    String(originStopPlaceId),
    totalWeight,
  );
  const remainder = passengerCount % totalWeight;
  if (permutation.stride === 1) {
    const start = addModulo(permutation.phase, cursor, totalWeight);
    const distanceToEnd = totalWeight - start;
    const wraps = remainder >= distanceToEnd;
    const firstEnd = wraps ? totalWeight : start + remainder;
    const wrappedEnd = wraps ? remainder - distanceToEnd : 0;
    let eligibleStart = 0;
    index.servedCandidates.forEach((candidate, candidateIndex) => {
      if (candidate.destinationStopPlaceId === originStopPlaceId) return;
      const eligibleEnd = checkedAdd(
        eligibleStart,
        candidate.weight,
        'destination interval',
      );
      const overlap = (left: number, right: number) =>
        Math.max(
          0,
          Math.min(eligibleEnd, right) - Math.max(eligibleStart, left),
        );
      const extra = overlap(start, firstEnd) + overlap(0, wrappedEnd);
      if (extra > 0)
        counts.set(
          candidateIndex,
          checkedAdd(
            counts.get(candidateIndex) ?? 0,
            extra,
            'destination allocation',
          ),
        );
      eligibleStart = eligibleEnd;
    });
    const allocations = [...counts]
      .sort(([left], [right]) => left - right)
      .map(([candidateIndex, count]) => ({
        ...index.servedCandidates[candidateIndex]!,
        count,
      }));
    return freezeTrustedAuthority({
      allocations,
      nextCursor: addModulo(cursor, remainder, totalWeight),
    });
  }
  let position = addModulo(
    permutation.phase,
    multiplyModulo(cursor, permutation.stride, totalWeight),
    totalWeight,
  );
  for (let assigned = 0; assigned < remainder; assigned += 1) {
    const candidateIndex = candidateAt(position);
    counts.set(
      candidateIndex,
      checkedAdd(counts.get(candidateIndex) ?? 0, 1, 'destination allocation'),
    );
    position = addModulo(position, permutation.stride, totalWeight);
  }
  const allocations = [...counts]
    .sort(([left], [right]) => left - right)
    .map(([candidateIndex, count]) => ({
      ...index.servedCandidates[candidateIndex]!,
      count,
    }));
  return freezeTrustedAuthority({
    allocations,
    nextCursor: addModulo(cursor, remainder, totalWeight),
  });
};
