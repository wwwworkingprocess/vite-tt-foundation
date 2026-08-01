import { z } from 'zod';
import type {
  CityPopulationCellId,
  RouteId,
  RoutePatternId,
  StopNodeId,
  StopPlaceId,
} from '@torrevieja-tycoon/transport-domain';
import {
  checkedAdd,
  deepFreeze,
  lexical,
  nonnegativeSafeInteger,
  positiveSafeInteger,
} from './authority-utils.js';
import {
  comparePassengerWaitingCohorts,
  passengerWaitingCohortIdSchema,
  passengerWaitingCohortKey,
  passengerWaitingCohortSequence,
  type PassengerWaitingCohort,
} from './passenger-waiting-cohort.js';
import type { SimulationTick } from './time.js';
import { parseVehicleId, type VehicleId } from './vehicle-movement.js';
import type {
  VehiclePatternRunState,
  VehicleStopNodeCall,
} from './vehicle-operation.js';

export const DEFAULT_VEHICLE_PASSENGER_CAPACITY = 80 as const;

export const passengerOnboardGroupIdSchema = z
  .string()
  .regex(/^passenger-onboard-group-[1-9]\d*$/)
  .brand<'PassengerOnboardGroupId'>();
export type PassengerOnboardGroupId = z.infer<
  typeof passengerOnboardGroupIdSchema
>;

export interface VehiclePassengerCapacity {
  readonly vehicleId: VehicleId;
  readonly passengerCapacity: number;
}

export interface VehiclePassengerLoadProjection extends VehiclePassengerCapacity {
  readonly onboardPassengerCount: number;
  readonly remainingPassengerCapacity: number;
}

export function projectVehiclePassengerLoads(
  capacities: readonly Readonly<VehiclePassengerCapacity>[],
  onboardGroups: readonly Readonly<PassengerOnboardGroup>[],
): readonly Readonly<VehiclePassengerLoadProjection>[] {
  const counts = new Map<VehicleId, number>();
  for (const group of onboardGroups)
    counts.set(
      group.vehicleId,
      checkedAdd(
        counts.get(group.vehicleId) ?? 0,
        group.count,
        'vehicle onboard passengers',
      ),
    );
  return deepFreeze(
    capacities.map((capacity) => {
      const onboardPassengerCount = counts.get(capacity.vehicleId) ?? 0;
      if (onboardPassengerCount > capacity.passengerCapacity)
        throw new Error('Vehicle passenger capacity exceeded.');
      return {
        ...capacity,
        onboardPassengerCount,
        remainingPassengerCapacity:
          capacity.passengerCapacity - onboardPassengerCount,
      };
    }),
  );
}

export interface PassengerOnboardGroup {
  readonly passengerOnboardGroupId: PassengerOnboardGroupId;
  readonly sourceWaitingCohortId: PassengerWaitingCohort['passengerWaitingCohortId'];
  readonly vehicleId: VehicleId;
  readonly routeId: RouteId;
  readonly patternId: RoutePatternId;
  readonly originStopPlaceId: StopPlaceId;
  readonly originStopNodeId: StopNodeId;
  readonly originOccurrenceIndex: number;
  readonly destinationCellId: CityPopulationCellId;
  readonly destinationStopPlaceId: StopPlaceId;
  readonly destinationStopNodeId: StopNodeId;
  readonly destinationOccurrenceIndex: number;
  readonly wrapsPatternEnd: boolean;
  readonly edgeCount: number;
  readonly boardedAtTick: SimulationTick;
  readonly boardedAtPatternRunSequence: number;
  readonly alightAtPatternRunSequence: number;
  readonly boardedAtStopCallSequence: number;
  readonly count: number;
  readonly firstAssignedTick: SimulationTick;
  readonly lastAssignedTick: SimulationTick;
}

export interface CurrentBoardingEvent {
  readonly vehicleId: VehicleId;
  readonly routeId: RouteId;
  readonly patternId: RoutePatternId;
  readonly stopNodeId: StopNodeId;
  readonly occurrenceIndex: number;
  readonly stopCallSequence: number;
  readonly patternRunSequence: number;
  readonly tick: SimulationTick;
  readonly boardedPassengerCount: number;
  readonly onboardPassengerCountAfterBoarding: number;
  readonly remainingCapacity: number;
  readonly onboardGroupIds: readonly PassengerOnboardGroupId[];
}

export const vehiclePassengerCapacitySchema = z.strictObject({
  vehicleId: z.string().min(1),
  passengerCapacity: positiveSafeInteger,
});
export const vehiclePassengerLoadProjectionSchema =
  vehiclePassengerCapacitySchema.extend({
    onboardPassengerCount: nonnegativeSafeInteger,
    remainingPassengerCapacity: nonnegativeSafeInteger,
  });

export const passengerOnboardGroupSchema = z.strictObject({
  passengerOnboardGroupId: passengerOnboardGroupIdSchema,
  sourceWaitingCohortId: z
    .string()
    .regex(/^passenger-waiting-cohort-[1-9]\d*$/),
  vehicleId: z.string().min(1),
  routeId: z.string().min(1),
  patternId: z.string().min(1),
  originStopPlaceId: z.string().min(1),
  originStopNodeId: z.string().min(1),
  originOccurrenceIndex: nonnegativeSafeInteger,
  destinationCellId: z.string().regex(/^r(?:0|[1-9]\d*)c(?:0|[1-9]\d*)$/),
  destinationStopPlaceId: z.string().min(1),
  destinationStopNodeId: z.string().min(1),
  destinationOccurrenceIndex: nonnegativeSafeInteger,
  wrapsPatternEnd: z.boolean(),
  edgeCount: positiveSafeInteger,
  boardedAtTick: nonnegativeSafeInteger,
  boardedAtPatternRunSequence: positiveSafeInteger,
  alightAtPatternRunSequence: positiveSafeInteger,
  boardedAtStopCallSequence: positiveSafeInteger,
  count: positiveSafeInteger,
  firstAssignedTick: nonnegativeSafeInteger,
  lastAssignedTick: nonnegativeSafeInteger,
});

export const currentBoardingEventSchema = z.strictObject({
  vehicleId: z.string().min(1),
  routeId: z.string().min(1),
  patternId: z.string().min(1),
  stopNodeId: z.string().min(1),
  occurrenceIndex: nonnegativeSafeInteger,
  stopCallSequence: positiveSafeInteger,
  patternRunSequence: positiveSafeInteger,
  tick: nonnegativeSafeInteger,
  boardedPassengerCount: positiveSafeInteger,
  onboardPassengerCountAfterBoarding: positiveSafeInteger,
  remainingCapacity: nonnegativeSafeInteger,
  onboardGroupIds: z.array(passengerOnboardGroupIdSchema).min(1),
});

export interface PassengerBoardingInput {
  readonly tick: SimulationTick;
  readonly waitingCohorts: readonly Readonly<PassengerWaitingCohort>[];
  readonly onboardGroups: readonly Readonly<PassengerOnboardGroup>[];
  readonly nextPassengerOnboardGroupSequence: number;
  readonly totalBoardedPassengerCount: number;
  readonly capacities: readonly Readonly<VehiclePassengerCapacity>[];
  readonly vehicleOperations: readonly Readonly<VehiclePatternRunState>[];
  readonly currentStopCalls: readonly Readonly<VehicleStopNodeCall>[];
  readonly itineraryIsValid: (
    cohort: Readonly<PassengerWaitingCohort>,
  ) => boolean;
}

export interface PassengerBoardingResult {
  readonly waitingCohorts: readonly Readonly<PassengerWaitingCohort>[];
  readonly onboardGroups: readonly Readonly<PassengerOnboardGroup>[];
  readonly nextPassengerOnboardGroupSequence: number;
  readonly totalWaitingForVehiclePassengerCount: number;
  readonly totalBoardedPassengerCount: number;
  readonly totalOnboardPassengerCount: number;
  readonly currentBoardingEvents: readonly Readonly<CurrentBoardingEvent>[];
}

export function validatePassengerBoardingAuthority(input: {
  readonly tick: SimulationTick;
  readonly fleet: readonly Readonly<{
    readonly vehicleId: VehicleId;
    readonly routeId?: RouteId;
  }>[];
  readonly capacities: readonly Readonly<VehiclePassengerCapacity>[];
  readonly onboardGroups: readonly Readonly<PassengerOnboardGroup>[];
  readonly waitingCohorts: readonly Readonly<PassengerWaitingCohort>[];
  readonly nextPassengerWaitingCohortSequence: number;
  readonly nextPassengerOnboardGroupSequence: number;
  readonly totalWaitingForVehiclePassengerCount: number;
  readonly totalBoardedPassengerCount: number;
  readonly totalOnboardPassengerCount: number;
  readonly currentStopCalls: readonly Readonly<VehicleStopNodeCall>[];
  readonly currentBoardingEvents: readonly Readonly<CurrentBoardingEvent>[];
  readonly vehicleOperations: readonly Readonly<VehiclePatternRunState>[];
  readonly itineraryIsValid: (
    group: Readonly<PassengerWaitingCohort>,
  ) => boolean;
}): void {
  if (
    input.capacities.length !== input.fleet.length ||
    input.capacities.some(
      (capacity, index) => capacity.vehicleId !== input.fleet[index]!.vehicleId,
    )
  )
    throw new Error('Vehicle capacity authority must align with fleet.');
  const capacities = new Map(
    input.capacities.map((item) => [item.vehicleId, item.passengerCapacity]),
  );
  const fleet = new Map(
    input.fleet.map((vehicle) => [vehicle.vehicleId, vehicle]),
  );
  const ids = new Set<string>();
  const onboardSequences: number[] = [];
  const sourceSequences = new Set<number>();
  const sourceIdentities = new Map<string, string>();
  const perVehicle = new Map<VehicleId, number>();
  let onboardTotal = 0;
  for (let index = 0; index < input.onboardGroups.length; index += 1) {
    const group = input.onboardGroups[index]!;
    const sequence = Number(
      group.passengerOnboardGroupId.slice('passenger-onboard-group-'.length),
    );
    const sourceWaitingCohortId = passengerWaitingCohortIdSchema.parse(
      group.sourceWaitingCohortId,
    );
    const sourceSequence = Number(
      sourceWaitingCohortId.slice('passenger-waiting-cohort-'.length),
    );
    const vehicle = fleet.get(group.vehicleId);
    if (
      ids.has(group.passengerOnboardGroupId) ||
      sequence >= input.nextPassengerOnboardGroupSequence ||
      sourceSequence >= input.nextPassengerWaitingCohortSequence ||
      group.boardedAtTick > input.tick ||
      group.firstAssignedTick > group.lastAssignedTick ||
      group.lastAssignedTick > group.boardedAtTick ||
      group.alightAtPatternRunSequence !==
        (group.wrapsPatternEnd
          ? checkedAdd(
              group.boardedAtPatternRunSequence,
              1,
              'onboard alight pattern-run sequence',
            )
          : group.boardedAtPatternRunSequence) ||
      vehicle === undefined ||
      vehicle.routeId !== group.routeId ||
      !input.itineraryIsValid(
        waitingCohortFromOnboardGroup(group, group.count),
      ) ||
      (index > 0 &&
        comparePassengerOnboardGroups(input.onboardGroups[index - 1]!, group) >=
          0)
    )
      throw new Error('Invalid onboard passenger group.');
    ids.add(group.passengerOnboardGroupId);
    onboardSequences.push(sequence);
    sourceSequences.add(sourceSequence);
    const identity = waitingCohortIdentity(group);
    const priorIdentity = sourceIdentities.get(sourceWaitingCohortId);
    if (priorIdentity !== undefined && priorIdentity !== identity)
      throw new Error('Onboard source waiting-cohort identity mismatch.');
    sourceIdentities.set(sourceWaitingCohortId, identity);
    onboardTotal = checkedAdd(onboardTotal, group.count, 'onboard passengers');
    perVehicle.set(
      group.vehicleId,
      checkedAdd(
        perVehicle.get(group.vehicleId) ?? 0,
        group.count,
        'vehicle onboard passengers',
      ),
    );
  }
  onboardSequences.sort((left, right) => left - right);
  if (
    input.nextPassengerOnboardGroupSequence !== onboardSequences.length + 1 ||
    onboardSequences.some((sequence, index) => sequence !== index + 1)
  )
    throw new Error('Onboard passenger group sequence is not contiguous.');
  for (const [vehicleId, count] of perVehicle)
    if (count > capacities.get(vehicleId)!)
      throw new Error('Vehicle passenger capacity exceeded.');
  if (
    onboardTotal !== input.totalOnboardPassengerCount ||
    onboardTotal !== input.totalBoardedPassengerCount
  )
    throw new Error('Onboard passenger conservation failed.');

  const currentGroups = input.onboardGroups.filter(
    (group) => group.boardedAtTick === input.tick,
  );
  const priorGroups = input.onboardGroups.filter(
    (group) => group.boardedAtTick < input.tick,
  );
  for (const cohort of input.waitingCohorts) {
    const sourceId = passengerWaitingCohortIdSchema.parse(
      cohort.passengerWaitingCohortId,
    );
    const sequence = Number(sourceId.slice('passenger-waiting-cohort-'.length));
    if (sequence >= input.nextPassengerWaitingCohortSequence)
      throw new Error('Invalid waiting-cohort sequence.');
    sourceSequences.add(sequence);
    const onboardIdentity = sourceIdentities.get(sourceId);
    if (
      onboardIdentity !== undefined &&
      onboardIdentity !== waitingCohortIdentity(cohort)
    )
      throw new Error('Residual waiting cohort identity mismatch.');
  }
  const issuedWaitingCount = input.nextPassengerWaitingCohortSequence - 1;
  if (
    !Number.isSafeInteger(issuedWaitingCount) ||
    issuedWaitingCount < 0 ||
    sourceSequences.size !== issuedWaitingCount ||
    [...sourceSequences].some(
      (sequence) => sequence < 1 || sequence > issuedWaitingCount,
    )
  )
    throw new Error('Waiting-cohort source sequence is not contiguous.');
  validateWaitingGenerationLineage({
    waitingCohorts: input.waitingCohorts,
    onboardGroups: input.onboardGroups,
  });

  const reconstructed = input.waitingCohorts.map((cohort) => ({ ...cohort }));
  const reconstructedById = new Map(
    reconstructed.map((cohort) => [cohort.passengerWaitingCohortId, cohort]),
  );
  for (const group of currentGroups) {
    const existing = reconstructedById.get(group.sourceWaitingCohortId);
    if (existing === undefined) {
      const cohort = waitingCohortFromOnboardGroup(group, group.count);
      reconstructed.push(cohort);
      reconstructedById.set(cohort.passengerWaitingCohortId, cohort);
    } else {
      existing.count = checkedAdd(
        existing.count,
        group.count,
        'reconstructed waiting passengers',
      );
    }
  }
  reconstructed.sort(comparePassengerWaitingCohorts);
  const priorBoarded = priorGroups.reduce(
    (total, group) =>
      checkedAdd(total, group.count, 'prior boarded passengers'),
    0,
  );
  const replay = boardPassengersAtVehicleCalls({
    tick: input.tick,
    waitingCohorts: reconstructed,
    onboardGroups: priorGroups,
    nextPassengerOnboardGroupSequence: priorGroups.length + 1,
    totalBoardedPassengerCount: priorBoarded,
    capacities: input.capacities,
    vehicleOperations: input.vehicleOperations,
    currentStopCalls: input.currentStopCalls,
    itineraryIsValid: input.itineraryIsValid,
  });
  if (
    replay.totalWaitingForVehiclePassengerCount !==
      input.totalWaitingForVehiclePassengerCount ||
    replay.totalBoardedPassengerCount !== input.totalBoardedPassengerCount ||
    replay.totalOnboardPassengerCount !== input.totalOnboardPassengerCount ||
    replay.nextPassengerOnboardGroupSequence !==
      input.nextPassengerOnboardGroupSequence ||
    JSON.stringify(replay.waitingCohorts) !==
      JSON.stringify(input.waitingCohorts) ||
    JSON.stringify(replay.onboardGroups) !==
      JSON.stringify(input.onboardGroups) ||
    JSON.stringify(replay.currentBoardingEvents) !==
      JSON.stringify(input.currentBoardingEvents)
  )
    throw new Error('Passenger boarding authority is not canonical.');
}

interface WaitingGenerationLineage {
  readonly cohort: Readonly<PassengerWaitingCohort>;
  readonly representedOnboard: boolean;
  readonly earliestBoardedAtTick: number | null;
}

const validateWaitingGenerationLineage = (input: {
  readonly waitingCohorts: readonly Readonly<PassengerWaitingCohort>[];
  readonly onboardGroups: readonly Readonly<PassengerOnboardGroup>[];
}): void => {
  const generations = new Map<string, WaitingGenerationLineage>();
  for (const group of input.onboardGroups) {
    const cohort = waitingCohortFromOnboardGroup(group, group.count);
    const existing = generations.get(group.sourceWaitingCohortId);
    generations.set(group.sourceWaitingCohortId, {
      cohort: existing?.cohort ?? cohort,
      representedOnboard: true,
      earliestBoardedAtTick:
        existing === undefined
          ? group.boardedAtTick
          : Math.min(existing.earliestBoardedAtTick!, group.boardedAtTick),
    });
  }
  for (const cohort of input.waitingCohorts) {
    const existing = generations.get(cohort.passengerWaitingCohortId);
    if (existing === undefined)
      generations.set(cohort.passengerWaitingCohortId, {
        cohort,
        representedOnboard: false,
        earliestBoardedAtTick: null,
      });
  }

  const byKey = new Map<string, WaitingGenerationLineage[]>();
  for (const generation of generations.values()) {
    const key = passengerWaitingCohortKey(generation.cohort);
    const group = byKey.get(key) ?? [];
    group.push(generation);
    byKey.set(key, group);
  }
  for (const group of byKey.values()) {
    group.sort(
      (left, right) =>
        passengerWaitingCohortSequence(left.cohort.passengerWaitingCohortId) -
        passengerWaitingCohortSequence(right.cohort.passengerWaitingCohortId),
    );
    let mergeableCount = 0;
    for (let index = 0; index < group.length; index += 1) {
      const generation = group[index]!;
      const successor = group[index + 1];
      if (!generation.representedOnboard) {
        mergeableCount += 1;
        if (successor !== undefined)
          throw new Error('Invalid waiting generation chronology.');
      }
      if (
        successor !== undefined &&
        (generation.earliestBoardedAtTick === null ||
          successor.cohort.firstAssignedTick <=
            generation.earliestBoardedAtTick)
      )
        throw new Error('Invalid waiting generation chronology.');
    }
    if (mergeableCount > 1)
      throw new Error('Invalid waiting generation chronology.');
  }
};

const waitingCohortIdentity = (
  cohort: Pick<
    PassengerWaitingCohort,
    Exclude<keyof PassengerWaitingCohort, 'count' | 'passengerWaitingCohortId'>
  >,
): string =>
  JSON.stringify({
    originStopPlaceId: cohort.originStopPlaceId,
    originStopNodeId: cohort.originStopNodeId,
    routeId: cohort.routeId,
    patternId: cohort.patternId,
    originOccurrenceIndex: cohort.originOccurrenceIndex,
    destinationCellId: cohort.destinationCellId,
    destinationStopPlaceId: cohort.destinationStopPlaceId,
    destinationStopNodeId: cohort.destinationStopNodeId,
    destinationOccurrenceIndex: cohort.destinationOccurrenceIndex,
    wrapsPatternEnd: cohort.wrapsPatternEnd,
    edgeCount: cohort.edgeCount,
    firstAssignedTick: cohort.firstAssignedTick,
    lastAssignedTick: cohort.lastAssignedTick,
  });

const waitingCohortFromOnboardGroup = (
  group: Readonly<PassengerOnboardGroup>,
  count: number,
): PassengerWaitingCohort => ({
  passengerWaitingCohortId: group.sourceWaitingCohortId,
  originStopPlaceId: group.originStopPlaceId,
  originStopNodeId: group.originStopNodeId,
  routeId: group.routeId,
  patternId: group.patternId,
  originOccurrenceIndex: group.originOccurrenceIndex,
  destinationCellId: group.destinationCellId,
  destinationStopPlaceId: group.destinationStopPlaceId,
  destinationStopNodeId: group.destinationStopNodeId,
  destinationOccurrenceIndex: group.destinationOccurrenceIndex,
  wrapsPatternEnd: group.wrapsPatternEnd,
  edgeCount: group.edgeCount,
  count,
  firstAssignedTick: group.firstAssignedTick,
  lastAssignedTick: group.lastAssignedTick,
});

export function createVehiclePassengerCapacity(
  vehicleId: VehicleId | string,
  passengerCapacity: number = DEFAULT_VEHICLE_PASSENGER_CAPACITY,
): Readonly<VehiclePassengerCapacity> {
  if (!Number.isSafeInteger(passengerCapacity) || passengerCapacity < 1)
    throw new Error('Invalid vehicle passenger capacity.');
  return deepFreeze({
    vehicleId: parseVehicleId(vehicleId),
    passengerCapacity,
  });
}

export function parseVehiclePassengerCapacities(
  value: unknown,
): readonly Readonly<VehiclePassengerCapacity>[] {
  return deepFreeze(
    z
      .array(vehiclePassengerCapacitySchema)
      .parse(value)
      .map((item) => ({
        vehicleId: parseVehicleId(item.vehicleId),
        passengerCapacity: item.passengerCapacity,
      })),
  );
}

export function parseVehiclePassengerLoadProjections(
  value: unknown,
): readonly Readonly<VehiclePassengerLoadProjection>[] {
  return deepFreeze(
    z
      .array(vehiclePassengerLoadProjectionSchema)
      .parse(value)
      .map((item) => ({
        ...item,
        vehicleId: parseVehicleId(item.vehicleId),
      })),
  );
}

export function parseCurrentBoardingEvents(
  value: unknown,
): readonly Readonly<CurrentBoardingEvent>[] {
  return deepFreeze(
    z
      .array(currentBoardingEventSchema)
      .parse(value)
      .map((item) => ({
        ...item,
        vehicleId: parseVehicleId(item.vehicleId),
      })) as unknown as CurrentBoardingEvent[],
  );
}

const callMatches = (
  call: Readonly<VehicleStopNodeCall>,
  cohort: Readonly<PassengerWaitingCohort>,
): boolean =>
  call.routeId === cohort.routeId &&
  call.patternId === cohort.patternId &&
  call.stopNodeId === cohort.originStopNodeId &&
  call.occurrenceIndex === cohort.originOccurrenceIndex;

const cohortOrder = (
  left: Readonly<PassengerWaitingCohort>,
  right: Readonly<PassengerWaitingCohort>,
): number =>
  left.firstAssignedTick - right.firstAssignedTick ||
  passengerWaitingCohortSequence(left.passengerWaitingCohortId) -
    passengerWaitingCohortSequence(right.passengerWaitingCohortId);

const cellPosition = (cellId: string): readonly [number, number] => {
  const match = /^r(\d+)c(\d+)$/.exec(cellId)!;
  return [Number(match[1]), Number(match[2])];
};

export const comparePassengerOnboardGroups = (
  left: Readonly<PassengerOnboardGroup>,
  right: Readonly<PassengerOnboardGroup>,
): number => {
  const [leftRow, leftColumn] = cellPosition(left.destinationCellId);
  const [rightRow, rightColumn] = cellPosition(right.destinationCellId);
  return (
    lexical(left.vehicleId, right.vehicleId) ||
    left.alightAtPatternRunSequence - right.alightAtPatternRunSequence ||
    left.destinationOccurrenceIndex - right.destinationOccurrenceIndex ||
    leftRow - rightRow ||
    leftColumn - rightColumn ||
    lexical(left.passengerOnboardGroupId, right.passengerOnboardGroupId)
  );
};

export function boardPassengersAtVehicleCalls(
  input: PassengerBoardingInput,
): Readonly<PassengerBoardingResult> {
  if (
    !Number.isSafeInteger(input.nextPassengerOnboardGroupSequence) ||
    input.nextPassengerOnboardGroupSequence < 1 ||
    !Number.isSafeInteger(input.totalBoardedPassengerCount) ||
    input.totalBoardedPassengerCount < 0 ||
    input.capacities.length !== input.vehicleOperations.length ||
    input.capacities.some(
      (capacity, index) =>
        capacity.vehicleId !== input.vehicleOperations[index]!.vehicleId ||
        !Number.isSafeInteger(capacity.passengerCapacity) ||
        capacity.passengerCapacity < 1,
    )
  )
    throw new Error('Invalid passenger boarding authority.');

  const waiting = input.waitingCohorts.map((item) => ({ ...item }));
  const onboard = input.onboardGroups.map((item) => ({ ...item }));
  const waitingBefore = waiting.reduce(
    (total, item) => checkedAdd(total, item.count, 'waiting passengers'),
    0,
  );
  const onboardCounts = new Map<string, number>();
  for (const group of onboard)
    onboardCounts.set(
      group.vehicleId,
      checkedAdd(
        onboardCounts.get(group.vehicleId) ?? 0,
        group.count,
        'onboard passengers',
      ),
    );
  const onboardBefore = [...onboardCounts.values()].reduce(
    (total, count) => checkedAdd(total, count, 'onboard passengers'),
    0,
  );
  if (onboardBefore !== input.totalBoardedPassengerCount)
    throw new Error('Invalid boarded passenger total.');
  const capacities = new Map(
    input.capacities.map((item) => [item.vehicleId, item.passengerCapacity]),
  );
  const operations = new Map(
    input.vehicleOperations.map((item) => [item.vehicleId, item]),
  );
  let nextSequence = input.nextPassengerOnboardGroupSequence;
  let boardedTotal = input.totalBoardedPassengerCount;
  const events: CurrentBoardingEvent[] = [];
  const calls = [...input.currentStopCalls].sort(
    (left, right) =>
      lexical(left.vehicleId, right.vehicleId) ||
      left.stopCallSequence - right.stopCallSequence,
  );

  for (const call of calls) {
    const operation = operations.get(call.vehicleId);
    const capacity = capacities.get(call.vehicleId);
    if (
      call.tick !== input.tick ||
      operation === undefined ||
      capacity === undefined ||
      operation.stopCallSequence < call.stopCallSequence ||
      operation.patternRunSequence !== call.patternRunSequence ||
      call.routeId === null
    )
      throw new Error('Invalid current boarding call.');
    let onboardCount = onboardCounts.get(call.vehicleId) ?? 0;
    let remaining = capacity - onboardCount;
    if (remaining < 0) throw new Error('Vehicle passenger capacity exceeded.');
    if (remaining === 0) continue;
    const eligible = waiting
      .map((item, index) => ({ item, index }))
      .filter(
        ({ item }) =>
          item.count > 0 &&
          callMatches(call, item) &&
          input.itineraryIsValid(item),
      )
      .sort((left, right) => cohortOrder(left.item, right.item));
    let boardedByCall = 0;
    const groupIds: PassengerOnboardGroupId[] = [];
    for (const entry of eligible) {
      if (remaining === 0) break;
      const current = waiting[entry.index]!;
      const count = Math.min(current.count, remaining);
      const id = passengerOnboardGroupIdSchema.parse(
        `passenger-onboard-group-${nextSequence}`,
      );
      const alightAtPatternRunSequence = current.wrapsPatternEnd
        ? checkedAdd(
            call.patternRunSequence,
            1,
            'onboard alight pattern-run sequence',
          )
        : call.patternRunSequence;
      onboard.push({
        passengerOnboardGroupId: id,
        sourceWaitingCohortId: current.passengerWaitingCohortId,
        vehicleId: call.vehicleId,
        routeId: current.routeId,
        patternId: current.patternId,
        originStopPlaceId: current.originStopPlaceId,
        originStopNodeId: current.originStopNodeId,
        originOccurrenceIndex: current.originOccurrenceIndex,
        destinationCellId: current.destinationCellId,
        destinationStopPlaceId: current.destinationStopPlaceId,
        destinationStopNodeId: current.destinationStopNodeId,
        destinationOccurrenceIndex: current.destinationOccurrenceIndex,
        wrapsPatternEnd: current.wrapsPatternEnd,
        edgeCount: current.edgeCount,
        boardedAtTick: input.tick,
        boardedAtPatternRunSequence: call.patternRunSequence,
        alightAtPatternRunSequence,
        boardedAtStopCallSequence: call.stopCallSequence,
        count,
        firstAssignedTick: current.firstAssignedTick,
        lastAssignedTick: current.lastAssignedTick,
      });
      waiting[entry.index] = { ...current, count: current.count - count };
      nextSequence = checkedAdd(nextSequence, 1, 'onboard group sequence');
      boardedTotal = checkedAdd(boardedTotal, count, 'boarded passengers');
      boardedByCall = checkedAdd(
        boardedByCall,
        count,
        'current boarding passengers',
      );
      onboardCount = checkedAdd(onboardCount, count, 'onboard passengers');
      remaining -= count;
      groupIds.push(id);
    }
    if (boardedByCall > 0) {
      onboardCounts.set(call.vehicleId, onboardCount);
      events.push({
        vehicleId: call.vehicleId,
        routeId: call.routeId,
        patternId: call.patternId,
        stopNodeId: call.stopNodeId,
        occurrenceIndex: call.occurrenceIndex,
        stopCallSequence: call.stopCallSequence,
        patternRunSequence: call.patternRunSequence,
        tick: input.tick,
        boardedPassengerCount: boardedByCall,
        onboardPassengerCountAfterBoarding: onboardCount,
        remainingCapacity: remaining,
        onboardGroupIds: groupIds,
      });
    }
  }
  const waitingCohorts = waiting.filter((item) => item.count > 0);
  onboard.sort(comparePassengerOnboardGroups);
  const waitingTotal = waitingCohorts.reduce(
    (total, item) => checkedAdd(total, item.count, 'waiting passengers'),
    0,
  );
  const onboardTotal = onboard.reduce(
    (total, item) => checkedAdd(total, item.count, 'onboard passengers'),
    0,
  );
  const boardedThisOperation = events.reduce(
    (total, event) =>
      checkedAdd(total, event.boardedPassengerCount, 'boarded passengers'),
    0,
  );
  if (
    waitingBefore !==
      checkedAdd(boardedThisOperation, waitingTotal, 'boarding conservation') ||
    onboardTotal !==
      checkedAdd(onboardBefore, boardedThisOperation, 'onboard conservation')
  )
    throw new Error('Passenger boarding conservation failed.');
  return deepFreeze({
    waitingCohorts,
    onboardGroups: onboard,
    nextPassengerOnboardGroupSequence: nextSequence,
    totalWaitingForVehiclePassengerCount: waitingTotal,
    totalBoardedPassengerCount: boardedTotal,
    totalOnboardPassengerCount: onboardTotal,
    currentBoardingEvents: events,
  });
}
