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
import type { PassengerWaitingCohort } from './passenger-waiting-cohort.js';
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
  readonly nextPassengerOnboardGroupSequence: number;
  readonly totalBoardedPassengerCount: number;
  readonly totalOnboardPassengerCount: number;
  readonly currentStopCalls: readonly Readonly<VehicleStopNodeCall>[];
  readonly currentBoardingEvents: readonly Readonly<CurrentBoardingEvent>[];
  readonly itineraryIsValid: (
    group: Readonly<PassengerOnboardGroup>,
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
  const perVehicle = new Map<VehicleId, number>();
  let onboardTotal = 0;
  for (let index = 0; index < input.onboardGroups.length; index += 1) {
    const group = input.onboardGroups[index]!;
    const sequence = Number(
      group.passengerOnboardGroupId.slice('passenger-onboard-group-'.length),
    );
    const vehicle = fleet.get(group.vehicleId);
    if (
      ids.has(group.passengerOnboardGroupId) ||
      sequence >= input.nextPassengerOnboardGroupSequence ||
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
      !input.itineraryIsValid(group) ||
      (index > 0 &&
        comparePassengerOnboardGroups(input.onboardGroups[index - 1]!, group) >=
          0)
    )
      throw new Error('Invalid onboard passenger group.');
    ids.add(group.passengerOnboardGroupId);
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
  const expected: CurrentBoardingEvent[] = [];
  const priorByVehicle = new Map<VehicleId, number>();
  for (const group of input.onboardGroups)
    if (group.boardedAtTick < input.tick)
      priorByVehicle.set(
        group.vehicleId,
        checkedAdd(
          priorByVehicle.get(group.vehicleId) ?? 0,
          group.count,
          'prior onboard passengers',
        ),
      );
  for (const call of [...input.currentStopCalls].sort(
    (left, right) =>
      lexical(left.vehicleId, right.vehicleId) ||
      left.stopCallSequence - right.stopCallSequence,
  )) {
    const groups = currentGroups
      .filter(
        (group) =>
          group.vehicleId === call.vehicleId &&
          group.boardedAtStopCallSequence === call.stopCallSequence &&
          group.routeId === call.routeId &&
          group.patternId === call.patternId &&
          group.originStopNodeId === call.stopNodeId &&
          group.originOccurrenceIndex === call.occurrenceIndex,
      )
      .sort(
        (left, right) =>
          Number(
            left.passengerOnboardGroupId.slice(
              'passenger-onboard-group-'.length,
            ),
          ) -
          Number(
            right.passengerOnboardGroupId.slice(
              'passenger-onboard-group-'.length,
            ),
          ),
      );
    if (groups.length === 0) continue;
    const boarded = groups.reduce(
      (total, group) => checkedAdd(total, group.count, 'event boarding count'),
      0,
    );
    const after = checkedAdd(
      priorByVehicle.get(call.vehicleId) ?? 0,
      boarded,
      'event onboard count',
    );
    priorByVehicle.set(call.vehicleId, after);
    expected.push({
      vehicleId: call.vehicleId,
      routeId: call.routeId!,
      patternId: call.patternId,
      stopNodeId: call.stopNodeId,
      occurrenceIndex: call.occurrenceIndex,
      stopCallSequence: call.stopCallSequence,
      patternRunSequence: call.patternRunSequence,
      tick: call.tick,
      boardedPassengerCount: boarded,
      onboardPassengerCountAfterBoarding: after,
      remainingCapacity: capacities.get(call.vehicleId)! - after,
      onboardGroupIds: groups.map((group) => group.passengerOnboardGroupId),
    });
  }
  if (
    expected.reduce(
      (total, event) =>
        checkedAdd(
          total,
          event.onboardGroupIds.length,
          'boarding event groups',
        ),
      0,
    ) !== currentGroups.length ||
    JSON.stringify(expected) !== JSON.stringify(input.currentBoardingEvents)
  )
    throw new Error('Current boarding events are inconsistent.');
}

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
  lexical(left.passengerWaitingCohortId, right.passengerWaitingCohortId);

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
