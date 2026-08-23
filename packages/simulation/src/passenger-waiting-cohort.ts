import { z } from 'zod';
import type {
  CityPopulationCellId,
  RouteId,
  RoutePatternId,
  StopNodeId,
  StopPlaceId,
} from '@torrevieja-tycoon/transport-domain';
import type {
  PassengerDirectItinerary,
  PassengerDirectItineraryRuntimeIndex,
} from './passenger-direct-itinerary.js';
import {
  parsePassengerDemandPlan,
  type DestinationAssignedPassengerGroup,
  type PassengerDemandPlanV1,
} from './passenger-demand.js';
import {
  passengerDemandRuntimeIndex,
  type PassengerDemandRuntimeIndex,
} from './passenger-demand-runtime.js';
import { parseSimulationTick, type SimulationTick } from './time.js';
import type { PassengerRuntimePhaseObserver } from './passenger-runtime-profiling.js';
import {
  checkedAdd,
  deepFreeze,
  lexical,
  nonnegativeSafeInteger,
  positiveSafeInteger,
} from './authority-utils.js';

export const passengerWaitingCohortIdSchema = z
  .string()
  .regex(/^passenger-waiting-cohort-[1-9]\d*$/)
  .brand<'PassengerWaitingCohortId'>();
export type PassengerWaitingCohortId = z.infer<
  typeof passengerWaitingCohortIdSchema
>;

export const passengerWaitingCohortSchema = z.strictObject({
  passengerWaitingCohortId: passengerWaitingCohortIdSchema,
  originStopPlaceId: z.string().min(1),
  originStopNodeId: z.string().min(1),
  routeId: z.string().min(1),
  patternId: z.string().min(1),
  originOccurrenceIndex: nonnegativeSafeInteger,
  destinationCellId: z.string().regex(/^r(?:0|[1-9]\d*)c(?:0|[1-9]\d*)$/),
  destinationStopPlaceId: z.string().min(1),
  destinationStopNodeId: z.string().min(1),
  destinationOccurrenceIndex: nonnegativeSafeInteger,
  wrapsPatternEnd: z.boolean(),
  edgeCount: positiveSafeInteger,
  count: positiveSafeInteger,
  firstAssignedTick: nonnegativeSafeInteger,
  lastAssignedTick: nonnegativeSafeInteger,
});

export interface PassengerWaitingCohort {
  readonly passengerWaitingCohortId: PassengerWaitingCohortId;
  readonly originStopPlaceId: StopPlaceId;
  readonly originStopNodeId: StopNodeId;
  readonly routeId: RouteId;
  readonly patternId: RoutePatternId;
  readonly originOccurrenceIndex: number;
  readonly destinationCellId: CityPopulationCellId;
  readonly destinationStopPlaceId: StopPlaceId;
  readonly destinationStopNodeId: StopNodeId;
  readonly destinationOccurrenceIndex: number;
  readonly wrapsPatternEnd: boolean;
  readonly edgeCount: number;
  readonly count: number;
  readonly firstAssignedTick: SimulationTick;
  readonly lastAssignedTick: SimulationTick;
}

export const passengerWaitingCohortKey = (
  group: Pick<
    PassengerWaitingCohort,
    | 'originStopPlaceId'
    | 'originStopNodeId'
    | 'routeId'
    | 'patternId'
    | 'originOccurrenceIndex'
    | 'destinationCellId'
    | 'destinationStopPlaceId'
    | 'destinationStopNodeId'
    | 'destinationOccurrenceIndex'
  >,
) =>
  [
    group.originStopPlaceId,
    group.originStopNodeId,
    group.routeId,
    group.patternId,
    group.originOccurrenceIndex,
    group.destinationCellId,
    group.destinationStopPlaceId,
    group.destinationStopNodeId,
    group.destinationOccurrenceIndex,
  ].join('\u0000');

export const passengerWaitingCohortMatchesItinerary = (
  cohort: Readonly<PassengerWaitingCohort>,
  itinerary: Readonly<PassengerDirectItinerary>,
) =>
  cohort.originStopNodeId === itinerary.originStopNodeId &&
  cohort.routeId === itinerary.routeId &&
  cohort.patternId === itinerary.patternId &&
  cohort.originOccurrenceIndex === itinerary.originOccurrenceIndex &&
  cohort.destinationStopNodeId === itinerary.destinationStopNodeId &&
  cohort.destinationOccurrenceIndex === itinerary.destinationOccurrenceIndex &&
  cohort.wrapsPatternEnd === itinerary.wrapsPatternEnd &&
  cohort.edgeCount === itinerary.edgeCount;

export const passengerWaitingCohortSequence = (
  passengerWaitingCohortId: PassengerWaitingCohortId,
): number =>
  Number(passengerWaitingCohortId.slice('passenger-waiting-cohort-'.length));

const cellPosition = (
  cellId: CityPopulationCellId,
): readonly [number, number] => {
  const match = /^r(\d+)c(\d+)$/.exec(cellId)!;
  return [Number(match[1]), Number(match[2])];
};

export function comparePassengerWaitingCohorts(
  left: Readonly<PassengerWaitingCohort>,
  right: Readonly<PassengerWaitingCohort>,
) {
  const [leftRow, leftColumn] = cellPosition(left.destinationCellId);
  const [rightRow, rightColumn] = cellPosition(right.destinationCellId);
  return (
    lexical(left.originStopNodeId, right.originStopNodeId) ||
    lexical(left.routeId, right.routeId) ||
    lexical(left.patternId, right.patternId) ||
    lexical(left.destinationStopNodeId, right.destinationStopNodeId) ||
    leftRow - rightRow ||
    leftColumn - rightColumn ||
    left.firstAssignedTick - right.firstAssignedTick ||
    passengerWaitingCohortSequence(left.passengerWaitingCohortId) -
      passengerWaitingCohortSequence(right.passengerWaitingCohortId)
  );
}

export interface PassengerItineraryActivationResult {
  readonly nextPassengerWaitingCohortSequence: number;
  readonly waitingCohorts: readonly Readonly<PassengerWaitingCohort>[];
  readonly directItineraryUnavailablePassengerCount: number;
  readonly totalWaitingForVehiclePassengerCount: number;
}

interface PassengerItineraryActivationInput {
  readonly itineraryIndex: PassengerDirectItineraryRuntimeIndex;
  readonly destinationAssignedGroups: readonly Readonly<DestinationAssignedPassengerGroup>[];
  readonly waitingCohorts: readonly Readonly<PassengerWaitingCohort>[];
  readonly nextPassengerWaitingCohortSequence: number;
  readonly directItineraryUnavailablePassengerCount: number;
  readonly activationTick: number;
  readonly nonMergeableWaitingCohortIds?: ReadonlySet<PassengerWaitingCohortId>;
  readonly observer?: PassengerRuntimePhaseObserver;
}

export function activatePassengerDirectItineraries(
  input: PassengerItineraryActivationInput & {
    readonly demandPlan: PassengerDemandPlanV1;
  },
): Readonly<PassengerItineraryActivationResult> {
  const demandPlan = parsePassengerDemandPlan(input.demandPlan);
  return activateTrustedPassengerDirectItineraries({
    ...input,
    demandRuntimeIndex: passengerDemandRuntimeIndex(demandPlan),
  });
}

export function activateTrustedPassengerDirectItineraries(
  input: PassengerItineraryActivationInput & {
    readonly demandRuntimeIndex: PassengerDemandRuntimeIndex;
  },
): Readonly<PassengerItineraryActivationResult> {
  const activationTick = parseSimulationTick(input.activationTick);
  if (
    !Number.isSafeInteger(input.nextPassengerWaitingCohortSequence) ||
    input.nextPassengerWaitingCohortSequence < 1 ||
    !Number.isSafeInteger(input.directItineraryUnavailablePassengerCount) ||
    input.directItineraryUnavailablePassengerCount < 0
  )
    throw new Error('Invalid waiting-cohort authority.');
  input.observer?.(9, 0, input.demandRuntimeIndex.planCellCount);
  const cohorts = input.waitingCohorts.map((cohort) => ({ ...cohort }));
  const keys = new Map<string, number>();
  const generations = new Map<
    string,
    Readonly<{ sequence: number; firstAssignedTick: number }>
  >();
  const ids = new Set<string>();
  let waitingTotal = 0;
  for (let index = 0; index < cohorts.length; index += 1) {
    const cohort = cohorts[index]!;
    const destinationCell = input.demandRuntimeIndex.findCell(
      cohort.destinationCellId,
    );
    const itinerary = input.itineraryIndex.find(
      cohort.originStopPlaceId,
      cohort.destinationStopPlaceId,
    );
    const sequence = passengerWaitingCohortSequence(
      cohort.passengerWaitingCohortId,
    );
    const key = passengerWaitingCohortKey(cohort);
    const priorGeneration = generations.get(key);
    if (
      itinerary === undefined ||
      !passengerWaitingCohortMatchesItinerary(cohort, itinerary) ||
      destinationCell?.assignedStopPlaceId !== cohort.destinationStopPlaceId ||
      !Number.isSafeInteger(cohort.count) ||
      cohort.count < 1 ||
      cohort.firstAssignedTick > cohort.lastAssignedTick ||
      cohort.lastAssignedTick > activationTick ||
      !Number.isSafeInteger(sequence) ||
      sequence >= input.nextPassengerWaitingCohortSequence ||
      ids.has(cohort.passengerWaitingCohortId) ||
      keys.has(key) ||
      (index > 0 &&
        comparePassengerWaitingCohorts(cohorts[index - 1]!, cohort) >= 0) ||
      (priorGeneration !== undefined &&
        (sequence <= priorGeneration.sequence ||
          cohort.firstAssignedTick < priorGeneration.firstAssignedTick)) ||
      (!input.nonMergeableWaitingCohortIds?.has(
        cohort.passengerWaitingCohortId,
      ) &&
        keys.has(key))
    )
      throw new Error('Invalid directional waiting cohort.');
    ids.add(cohort.passengerWaitingCohortId);
    generations.set(key, {
      sequence,
      firstAssignedTick: cohort.firstAssignedTick,
    });
    if (
      !input.nonMergeableWaitingCohortIds?.has(cohort.passengerWaitingCohortId)
    )
      keys.set(key, index);
    waitingTotal = checkedAdd(
      waitingTotal,
      cohort.count,
      'waiting passenger count',
    );
  }
  input.observer?.(10, input.waitingCohorts.length);

  let nextSequence = input.nextPassengerWaitingCohortSequence;
  let unavailable = input.directItineraryUnavailablePassengerCount;
  for (const assignment of input.destinationAssignedGroups) {
    if (
      !Number.isSafeInteger(assignment.count) ||
      assignment.count < 1 ||
      assignment.lastAssignedTick !== activationTick
    )
      throw new Error('Invalid destination assignment activation.');
    const destinationCell = input.demandRuntimeIndex.findCell(
      assignment.destinationCellId,
    );
    if (
      destinationCell?.assignedStopPlaceId !== assignment.destinationStopPlaceId
    )
      throw new Error('Destination assignment does not match its cell.');
    const itinerary = input.itineraryIndex.find(
      assignment.originStopPlaceId,
      assignment.destinationStopPlaceId,
    );
    if (itinerary === undefined) {
      unavailable = checkedAdd(
        unavailable,
        assignment.count,
        'direct-itinerary-unavailable passengers',
      );
      continue;
    }
    const candidate: PassengerWaitingCohort = {
      passengerWaitingCohortId: passengerWaitingCohortIdSchema.parse(
        `passenger-waiting-cohort-${nextSequence}`,
      ),
      originStopPlaceId: assignment.originStopPlaceId,
      originStopNodeId: itinerary.originStopNodeId,
      routeId: itinerary.routeId,
      patternId: itinerary.patternId,
      originOccurrenceIndex: itinerary.originOccurrenceIndex,
      destinationCellId: assignment.destinationCellId,
      destinationStopPlaceId: assignment.destinationStopPlaceId,
      destinationStopNodeId: itinerary.destinationStopNodeId,
      destinationOccurrenceIndex: itinerary.destinationOccurrenceIndex,
      wrapsPatternEnd: itinerary.wrapsPatternEnd,
      edgeCount: itinerary.edgeCount,
      count: assignment.count,
      firstAssignedTick: activationTick,
      lastAssignedTick: activationTick,
    };
    const key = passengerWaitingCohortKey(candidate);
    const existingIndex = keys.get(key);
    if (existingIndex === undefined) {
      keys.set(key, cohorts.length);
      cohorts.push(candidate);
      nextSequence = checkedAdd(nextSequence, 1, 'waiting cohort sequence');
    } else {
      const existing = cohorts[existingIndex]!;
      cohorts[existingIndex] = {
        ...existing,
        count: checkedAdd(
          existing.count,
          assignment.count,
          'waiting cohort passengers',
        ),
        lastAssignedTick: activationTick,
      };
    }
    waitingTotal = checkedAdd(
      waitingTotal,
      assignment.count,
      'waiting passenger count',
    );
  }
  input.observer?.(11);
  cohorts.sort(comparePassengerWaitingCohorts);
  const result = deepFreeze({
    nextPassengerWaitingCohortSequence: nextSequence,
    waitingCohorts: cohorts,
    directItineraryUnavailablePassengerCount: unavailable,
    totalWaitingForVehiclePassengerCount: waitingTotal,
  });
  input.observer?.(12, cohorts.length);
  return result;
}
