import { z } from 'zod';
import type {
  CityPopulationCellId,
  DirectedScenarioGraph,
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
  boardPassengersAtVehicleCalls,
  comparePassengerOnboardGroups,
  passengerOnboardGroupIdSchema,
  type CurrentBoardingEvent,
  type PassengerOnboardGroup,
  type VehiclePassengerCapacity,
} from './passenger-boarding.js';
import {
  calculatePassengerAccessTicks,
  type PassengerDemandPlanV1,
} from './passenger-demand.js';
import {
  passengerWaitingCohortIdSchema,
  passengerWaitingCohortKey,
  passengerWaitingCohortSequence,
  type PassengerWaitingCohort,
} from './passenger-waiting-cohort.js';
import { parseSimulationTick, type SimulationTick } from './time.js';
import type {
  VehiclePatternRunState,
  VehicleStopNodeCall,
} from './vehicle-operation.js';
import {
  parseVehicleId,
  type VehicleId,
  type VehicleState,
} from './vehicle-movement.js';

export const passengerDestinationAccessGroupIdSchema = z
  .string()
  .regex(/^passenger-destination-access-group-[1-9]\d*$/)
  .brand<'PassengerDestinationAccessGroupId'>();
export type PassengerDestinationAccessGroupId = z.infer<
  typeof passengerDestinationAccessGroupIdSchema
>;

export interface PassengerDestinationAccessGroup {
  readonly passengerDestinationAccessGroupId: PassengerDestinationAccessGroupId;
  readonly sourceOnboardGroupId: PassengerOnboardGroup['passengerOnboardGroupId'];
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
  readonly boardedAtStopCallSequence: number;
  readonly alightedAtTick: SimulationTick;
  readonly alightedAtPatternRunSequence: number;
  readonly alightedAtStopCallSequence: number;
  readonly destinationAccessTicks: number;
  readonly completionTick: SimulationTick;
  readonly count: number;
  readonly firstAssignedTick: SimulationTick;
  readonly lastAssignedTick: SimulationTick;
}

export interface PassengerJourneyCompletionEvent extends PassengerDestinationAccessGroup {
  readonly completedAtTick: SimulationTick;
  readonly minimumAssignmentToCompletionTicks: number;
  readonly maximumAssignmentToCompletionTicks: number;
  readonly inVehicleTicks: number;
}

export interface CurrentAlightingEvent {
  readonly vehicleId: VehicleId;
  readonly routeId: RouteId;
  readonly patternId: RoutePatternId;
  readonly stopNodeId: StopNodeId;
  readonly occurrenceIndex: number;
  readonly stopCallSequence: number;
  readonly patternRunSequence: number;
  readonly tick: SimulationTick;
  readonly alightedPassengerCount: number;
  readonly onboardPassengerCountAfterAlighting: number;
  readonly remainingCapacityAfterAlighting: number;
  readonly sourceOnboardGroupIds: readonly PassengerOnboardGroup['passengerOnboardGroupId'][];
  readonly destinationAccessGroupIds: readonly PassengerDestinationAccessGroupId[];
}

export interface WaitingGenerationLineageWatermark {
  readonly passengerWaitingCohortKey: string;
  readonly passengerWaitingCohortId: PassengerWaitingCohort['passengerWaitingCohortId'];
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
  readonly firstAssignedTick: SimulationTick;
  readonly lastAssignedTick: SimulationTick;
  readonly earliestBoardedAtTick: SimulationTick;
}

export const passengerDestinationAccessGroupSchema = z.strictObject({
  passengerDestinationAccessGroupId: passengerDestinationAccessGroupIdSchema,
  sourceOnboardGroupId: passengerOnboardGroupIdSchema,
  sourceWaitingCohortId: passengerWaitingCohortIdSchema,
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
  boardedAtStopCallSequence: positiveSafeInteger,
  alightedAtTick: nonnegativeSafeInteger,
  alightedAtPatternRunSequence: positiveSafeInteger,
  alightedAtStopCallSequence: positiveSafeInteger,
  destinationAccessTicks: nonnegativeSafeInteger,
  completionTick: nonnegativeSafeInteger,
  count: positiveSafeInteger,
  firstAssignedTick: nonnegativeSafeInteger,
  lastAssignedTick: nonnegativeSafeInteger,
});

export const passengerJourneyCompletionEventSchema =
  passengerDestinationAccessGroupSchema.extend({
    completedAtTick: nonnegativeSafeInteger,
    minimumAssignmentToCompletionTicks: nonnegativeSafeInteger,
    maximumAssignmentToCompletionTicks: nonnegativeSafeInteger,
    inVehicleTicks: nonnegativeSafeInteger,
  });

export const currentAlightingEventSchema = z.strictObject({
  vehicleId: z.string().min(1),
  routeId: z.string().min(1),
  patternId: z.string().min(1),
  stopNodeId: z.string().min(1),
  occurrenceIndex: nonnegativeSafeInteger,
  stopCallSequence: positiveSafeInteger,
  patternRunSequence: positiveSafeInteger,
  tick: nonnegativeSafeInteger,
  alightedPassengerCount: positiveSafeInteger,
  onboardPassengerCountAfterAlighting: nonnegativeSafeInteger,
  remainingCapacityAfterAlighting: nonnegativeSafeInteger,
  sourceOnboardGroupIds: z.array(passengerOnboardGroupIdSchema).min(1),
  destinationAccessGroupIds: z
    .array(passengerDestinationAccessGroupIdSchema)
    .min(1),
});

export const waitingGenerationLineageWatermarkSchema = z.strictObject({
  passengerWaitingCohortKey: z.string(),
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
  firstAssignedTick: nonnegativeSafeInteger,
  lastAssignedTick: nonnegativeSafeInteger,
  earliestBoardedAtTick: nonnegativeSafeInteger,
});

const idSequence = (id: string): number =>
  Number(id.slice(id.lastIndexOf('-') + 1));
const cellPosition = (cellId: string): readonly [number, number] => {
  const match = /^r(\d+)c(\d+)$/.exec(cellId)!;
  return [Number(match[1]), Number(match[2])];
};

export const comparePassengerDestinationAccessGroups = (
  left: Readonly<PassengerDestinationAccessGroup>,
  right: Readonly<PassengerDestinationAccessGroup>,
): number => {
  const [leftRow, leftColumn] = cellPosition(left.destinationCellId);
  const [rightRow, rightColumn] = cellPosition(right.destinationCellId);
  return (
    left.completionTick - right.completionTick ||
    leftRow - rightRow ||
    leftColumn - rightColumn ||
    idSequence(left.sourceOnboardGroupId) -
      idSequence(right.sourceOnboardGroupId) ||
    idSequence(left.passengerDestinationAccessGroupId) -
      idSequence(right.passengerDestinationAccessGroupId)
  );
};

export function parsePassengerDestinationAccessGroups(
  value: unknown,
): readonly Readonly<PassengerDestinationAccessGroup>[] {
  return deepFreeze(
    z
      .array(passengerDestinationAccessGroupSchema)
      .parse(value)
      .map((group) => ({
        ...group,
        vehicleId: parseVehicleId(group.vehicleId),
        boardedAtTick: parseSimulationTick(group.boardedAtTick),
        alightedAtTick: parseSimulationTick(group.alightedAtTick),
        completionTick: parseSimulationTick(group.completionTick),
      })) as unknown as readonly PassengerDestinationAccessGroup[],
  );
}

export function parseCurrentAlightingEvents(
  value: unknown,
): readonly Readonly<CurrentAlightingEvent>[] {
  return deepFreeze(
    z.array(currentAlightingEventSchema).parse(value),
  ) as unknown as readonly CurrentAlightingEvent[];
}

export function parsePassengerJourneyCompletionEvents(
  value: unknown,
): readonly Readonly<PassengerJourneyCompletionEvent>[] {
  return deepFreeze(
    z.array(passengerJourneyCompletionEventSchema).parse(value),
  ) as unknown as readonly PassengerJourneyCompletionEvent[];
}

export function parseWaitingGenerationLineageWatermarks(
  value: unknown,
): readonly Readonly<WaitingGenerationLineageWatermark>[] {
  return deepFreeze(
    z.array(waitingGenerationLineageWatermarkSchema).parse(value),
  ) as unknown as readonly WaitingGenerationLineageWatermark[];
}

export function validatePassengerTransitCollections(input: {
  readonly tick: SimulationTick;
  readonly demandPlan: PassengerDemandPlanV1;
  readonly waitingCohorts: readonly Readonly<PassengerWaitingCohort>[];
  readonly waitingGenerationLineageWatermarks: readonly Readonly<WaitingGenerationLineageWatermark>[];
  readonly onboardGroups: readonly Readonly<PassengerOnboardGroup>[];
  readonly destinationAccessGroups: readonly Readonly<PassengerDestinationAccessGroup>[];
  readonly nextPassengerWaitingCohortSequence: number;
  readonly nextPassengerOnboardGroupSequence: number;
  readonly nextPassengerDestinationAccessGroupSequence: number;
  readonly itineraryIsValid: (
    cohort: Readonly<PassengerWaitingCohort>,
  ) => boolean;
}): void {
  const cells = new Map(
    input.demandPlan.cells.map((cell) => [cell.cellId, cell]),
  );
  const accessIds = new Set<string>();
  const activeSourceOnboardIds = new Set(
    input.onboardGroups.map((group) => group.passengerOnboardGroupId),
  );
  for (
    let index = 0;
    index < input.destinationAccessGroups.length;
    index += 1
  ) {
    const group = input.destinationAccessGroups[index]!;
    const cell = cells.get(group.destinationCellId);
    const sequence = idSequence(group.passengerDestinationAccessGroupId);
    const expectedDuration =
      cell?.distanceSquaredCells === null || cell === undefined
        ? -1
        : calculatePassengerAccessTicks(
            cell.distanceSquaredCells,
            input.demandPlan.catchmentPolicy.maxAccessDistanceCells,
            input.demandPlan.accessPolicy.accessTicksPerCell,
          );
    const expectedCompletion =
      expectedDuration < 0
        ? -1
        : checkedAdd(
            group.alightedAtTick,
            expectedDuration,
            'destination completion tick',
          );
    if (
      accessIds.has(group.passengerDestinationAccessGroupId) ||
      activeSourceOnboardIds.has(group.sourceOnboardGroupId) ||
      idSequence(group.sourceOnboardGroupId) >=
        input.nextPassengerOnboardGroupSequence ||
      sequence >= input.nextPassengerDestinationAccessGroupSequence ||
      group.completionTick <= input.tick ||
      group.boardedAtTick > group.alightedAtTick ||
      group.firstAssignedTick > group.lastAssignedTick ||
      group.lastAssignedTick > group.boardedAtTick ||
      group.destinationAccessTicks !== expectedDuration ||
      group.completionTick !== expectedCompletion ||
      cell?.assignedStopPlaceId !== group.destinationStopPlaceId ||
      !input.itineraryIsValid({
        ...group,
        passengerWaitingCohortId: group.sourceWaitingCohortId,
      }) ||
      (index > 0 &&
        comparePassengerDestinationAccessGroups(
          input.destinationAccessGroups[index - 1]!,
          group,
        ) >= 0)
    )
      throw new Error('Invalid passenger destination-access authority.');
    accessIds.add(group.passengerDestinationAccessGroupId);
    activeSourceOnboardIds.add(group.sourceOnboardGroupId);
  }

  const watermarkKeys = new Set<string>();
  for (
    let index = 0;
    index < input.waitingGenerationLineageWatermarks.length;
    index += 1
  ) {
    const watermark = input.waitingGenerationLineageWatermarks[index]!;
    const watermarkKey = passengerWaitingCohortKey({
      ...watermark,
      count: 1,
    } as PassengerWaitingCohort);
    if (
      watermarkKeys.has(watermark.passengerWaitingCohortKey) ||
      watermark.passengerWaitingCohortKey !== watermarkKey ||
      passengerWaitingCohortSequence(watermark.passengerWaitingCohortId) >=
        input.nextPassengerWaitingCohortSequence ||
      watermark.firstAssignedTick > watermark.lastAssignedTick ||
      watermark.lastAssignedTick > watermark.earliestBoardedAtTick ||
      (index > 0 &&
        lexical(
          input.waitingGenerationLineageWatermarks[index - 1]!
            .passengerWaitingCohortKey,
          watermark.passengerWaitingCohortKey,
        ) >= 0)
    )
      throw new Error('Invalid waiting-generation lineage watermark.');
    watermarkKeys.add(watermark.passengerWaitingCohortKey);
  }
  const watermarks = new Map(
    input.waitingGenerationLineageWatermarks.map((item) => [
      item.passengerWaitingCohortKey,
      item,
    ]),
  );
  const latestWaitingSequence = Math.max(
    0,
    ...input.waitingCohorts.map((cohort) =>
      passengerWaitingCohortSequence(cohort.passengerWaitingCohortId),
    ),
    ...input.waitingGenerationLineageWatermarks.map((watermark) =>
      passengerWaitingCohortSequence(watermark.passengerWaitingCohortId),
    ),
  );
  if (latestWaitingSequence !== input.nextPassengerWaitingCohortSequence - 1)
    throw new Error('Invalid waiting-cohort sequence authority.');
  const mergeable = new Set<string>();
  for (const cohort of input.waitingCohorts) {
    const key = passengerWaitingCohortKey(cohort);
    const watermark = watermarks.get(key);
    if (watermark === undefined) continue;
    const sequence = passengerWaitingCohortSequence(
      cohort.passengerWaitingCohortId,
    );
    const historical =
      sequence <=
      passengerWaitingCohortSequence(watermark.passengerWaitingCohortId);
    if (
      cohort.passengerWaitingCohortId === watermark.passengerWaitingCohortId &&
      (cohort.firstAssignedTick !== watermark.firstAssignedTick ||
        cohort.lastAssignedTick !== watermark.lastAssignedTick)
    )
      throw new Error('Waiting-generation watermark identity mismatch.');
    if (!historical) {
      if (
        mergeable.has(key) ||
        cohort.firstAssignedTick <= watermark.earliestBoardedAtTick
      )
        throw new Error('Invalid waiting-generation lineage successor.');
      mergeable.add(key);
    }
  }
  for (const group of input.onboardGroups) {
    const cohort = {
      ...group,
      passengerWaitingCohortId: group.sourceWaitingCohortId,
    } as unknown as PassengerWaitingCohort;
    const watermark = watermarks.get(passengerWaitingCohortKey(cohort));
    if (
      watermark === undefined ||
      passengerWaitingCohortSequence(group.sourceWaitingCohortId) >
        passengerWaitingCohortSequence(watermark.passengerWaitingCohortId)
    )
      throw new Error('Missing waiting-generation lineage watermark.');
  }
}

const reachedOccurrenceIndex = (vehicle: Readonly<VehicleState>): number => {
  const movement = vehicle.movement;
  if (movement.kind === 'parked-at-stop') return 0;
  if (movement.kind === 'running-on-edge') return movement.edgeSequence;
  if (movement.kind === 'running-at-stop') return movement.nextEdgeSequence;
  return vehicle.movementPlan.edgeTravelTicks.length;
};

interface PassengerJourneyOperationInput {
  readonly graph: DirectedScenarioGraph;
  readonly fleet: readonly Readonly<VehicleState>[];
  readonly vehicleOperations: readonly Readonly<VehiclePatternRunState>[];
  readonly currentStopCalls: readonly Readonly<VehicleStopNodeCall>[];
  readonly onboardGroups: readonly Readonly<PassengerOnboardGroup>[];
  readonly destinationAccessGroups: readonly Readonly<PassengerDestinationAccessGroup>[];
  readonly currentJourneyCompletionEvents: readonly Readonly<PassengerJourneyCompletionEvent>[];
}

const expectedAlightRun = (group: {
  readonly wrapsPatternEnd: boolean;
  readonly boardedAtPatternRunSequence: number;
}): number =>
  group.wrapsPatternEnd
    ? checkedAdd(
        group.boardedAtPatternRunSequence,
        1,
        'passenger alight pattern-run sequence',
      )
    : group.boardedAtPatternRunSequence;

/** Proves boarding-to-alighting lineage against canonical vehicle operation. */
export function validatePassengerJourneyRunAndCallIdentity(
  input: PassengerJourneyOperationInput,
): void {
  const vehicles = new Map(
    input.fleet.map((vehicle) => [vehicle.vehicleId, vehicle]),
  );
  const operations = new Map(
    input.vehicleOperations.map((operation) => [
      operation.vehicleId,
      operation,
    ]),
  );
  for (const group of input.onboardGroups) {
    const vehicle = vehicles.get(group.vehicleId);
    const operation = operations.get(group.vehicleId);
    const route = input.graph.route(group.routeId);
    const targetRun = group.alightAtPatternRunSequence;
    const boardedRun = group.boardedAtPatternRunSequence;
    if (vehicle === undefined || operation === undefined)
      throw new Error(
        'Invalid or overdue onboard passenger pattern-run authority.',
      );
    const currentRun = operation.patternRunSequence;
    if (
      vehicle.routeId !== group.routeId ||
      route === undefined ||
      !route.patterns.some(
        (pattern) => pattern.patternId === group.patternId,
      ) ||
      targetRun !== expectedAlightRun(group) ||
      boardedRun > currentRun ||
      currentRun > targetRun ||
      (currentRun === boardedRun &&
        (vehicle.patternId !== group.patternId ||
          group.boardedAtTick < operation.patternRunStartedAtTick ||
          group.boardedAtStopCallSequence > operation.stopCallSequence)) ||
      (currentRun === targetRun &&
        (vehicle.patternId !== group.patternId ||
          group.destinationOccurrenceIndex <=
            reachedOccurrenceIndex(vehicle))) ||
      input.currentStopCalls.some(
        (call) =>
          call.vehicleId === group.vehicleId &&
          call.routeId === group.routeId &&
          call.patternId === group.patternId &&
          call.stopNodeId === group.destinationStopNodeId &&
          call.occurrenceIndex === group.destinationOccurrenceIndex &&
          call.patternRunSequence === targetRun &&
          call.stopCallSequence > group.boardedAtStopCallSequence,
      )
    )
      throw new Error(
        'Invalid or overdue onboard passenger pattern-run authority.',
      );
  }

  for (const group of [
    ...input.destinationAccessGroups,
    ...input.currentJourneyCompletionEvents,
  ]) {
    const vehicle = vehicles.get(group.vehicleId);
    const operation = operations.get(group.vehicleId);
    const route = input.graph.route(group.routeId);
    const expectedCall = checkedAdd(
      group.boardedAtStopCallSequence,
      group.edgeCount,
      'passenger alight StopNode-call sequence',
    );
    if (
      vehicle === undefined ||
      operation === undefined ||
      vehicle.routeId !== group.routeId ||
      route === undefined ||
      !route.patterns.some(
        (pattern) => pattern.patternId === group.patternId,
      ) ||
      group.alightedAtPatternRunSequence !== expectedAlightRun(group) ||
      group.alightedAtStopCallSequence !== expectedCall ||
      group.alightedAtStopCallSequence <= group.boardedAtStopCallSequence ||
      group.boardedAtTick > group.alightedAtTick ||
      group.alightedAtPatternRunSequence > operation.patternRunSequence ||
      group.alightedAtStopCallSequence > operation.stopCallSequence ||
      (group.alightedAtPatternRunSequence === operation.patternRunSequence &&
        (vehicle.patternId !== group.patternId ||
          reachedOccurrenceIndex(vehicle) < group.destinationOccurrenceIndex))
    )
      throw new Error('Invalid passenger alighting run/call authority.');
  }
}

/** Compatibility wrapper for focused active-onboard validation. */
export function validateOnboardPassengerProgress(
  input: Omit<
    PassengerJourneyOperationInput,
    'destinationAccessGroups' | 'currentJourneyCompletionEvents'
  >,
): void {
  validatePassengerJourneyRunAndCallIdentity({
    ...input,
    destinationAccessGroups: [],
    currentJourneyCompletionEvents: [],
  });
}

const completionEvent = (
  group: Readonly<PassengerDestinationAccessGroup>,
): PassengerJourneyCompletionEvent => ({
  ...group,
  completedAtTick: group.completionTick,
  minimumAssignmentToCompletionTicks:
    group.completionTick - group.lastAssignedTick,
  maximumAssignmentToCompletionTicks:
    group.completionTick - group.firstAssignedTick,
  inVehicleTicks: group.alightedAtTick - group.boardedAtTick,
});

export function advancePassengerDestinationAccessToTick(input: {
  readonly tick: number;
  readonly destinationAccessGroups: readonly Readonly<PassengerDestinationAccessGroup>[];
  readonly totalCompletedJourneyPassengerCount: number;
}): Readonly<{
  destinationAccessGroups: readonly Readonly<PassengerDestinationAccessGroup>[];
  totalInDestinationAccessPassengerCount: number;
  totalCompletedJourneyPassengerCount: number;
  currentJourneyCompletionEvents: readonly Readonly<PassengerJourneyCompletionEvent>[];
}> {
  const tick = parseSimulationTick(input.tick);
  let completed = input.totalCompletedJourneyPassengerCount;
  const active: PassengerDestinationAccessGroup[] = [];
  const events: PassengerJourneyCompletionEvent[] = [];
  for (const group of parsePassengerDestinationAccessGroups(
    input.destinationAccessGroups,
  )) {
    if (group.completionTick < tick)
      throw new Error('Overdue passenger destination access group.');
    if (group.completionTick === tick) {
      completed = checkedAdd(completed, group.count, 'completed journeys');
      events.push(completionEvent(group));
    } else active.push(group);
  }
  active.sort(comparePassengerDestinationAccessGroups);
  return deepFreeze({
    destinationAccessGroups: active,
    totalInDestinationAccessPassengerCount: active.reduce(
      (total, group) =>
        checkedAdd(total, group.count, 'destination access passengers'),
      0,
    ),
    totalCompletedJourneyPassengerCount: completed,
    currentJourneyCompletionEvents: events,
  });
}

export interface PassengerTransitInput {
  readonly tick: SimulationTick;
  readonly demandPlan: PassengerDemandPlanV1;
  readonly waitingCohorts: readonly Readonly<PassengerWaitingCohort>[];
  readonly waitingGenerationLineageWatermarks: readonly Readonly<WaitingGenerationLineageWatermark>[];
  readonly onboardGroups: readonly Readonly<PassengerOnboardGroup>[];
  readonly destinationAccessGroups: readonly Readonly<PassengerDestinationAccessGroup>[];
  readonly nextPassengerOnboardGroupSequence: number;
  readonly nextPassengerDestinationAccessGroupSequence: number;
  readonly totalWaitingForVehiclePassengerCount: number;
  readonly totalBoardedPassengerCount: number;
  readonly totalOnboardPassengerCount: number;
  readonly totalAlightedPassengerCount: number;
  readonly totalInDestinationAccessPassengerCount: number;
  readonly totalCompletedJourneyPassengerCount: number;
  readonly capacities: readonly Readonly<VehiclePassengerCapacity>[];
  readonly vehicleOperations: readonly Readonly<VehiclePatternRunState>[];
  readonly currentStopCalls: readonly Readonly<VehicleStopNodeCall>[];
  readonly itineraryIsValid: (
    cohort: Readonly<PassengerWaitingCohort>,
  ) => boolean;
}

export interface PassengerTransitResult {
  readonly waitingCohorts: readonly Readonly<PassengerWaitingCohort>[];
  readonly waitingGenerationLineageWatermarks: readonly Readonly<WaitingGenerationLineageWatermark>[];
  readonly onboardGroups: readonly Readonly<PassengerOnboardGroup>[];
  readonly destinationAccessGroups: readonly Readonly<PassengerDestinationAccessGroup>[];
  readonly nextPassengerOnboardGroupSequence: number;
  readonly nextPassengerDestinationAccessGroupSequence: number;
  readonly totalWaitingForVehiclePassengerCount: number;
  readonly totalBoardedPassengerCount: number;
  readonly totalOnboardPassengerCount: number;
  readonly totalAlightedPassengerCount: number;
  readonly totalInDestinationAccessPassengerCount: number;
  readonly totalCompletedJourneyPassengerCount: number;
  readonly currentAlightingEvents: readonly Readonly<CurrentAlightingEvent>[];
  readonly currentBoardingEvents: readonly Readonly<CurrentBoardingEvent>[];
  readonly currentJourneyCompletionEvents: readonly Readonly<PassengerJourneyCompletionEvent>[];
}

const callMatchesDestination = (
  call: Readonly<VehicleStopNodeCall>,
  group: Readonly<PassengerOnboardGroup>,
) =>
  call.vehicleId === group.vehicleId &&
  call.routeId === group.routeId &&
  call.patternId === group.patternId &&
  call.stopNodeId === group.destinationStopNodeId &&
  call.occurrenceIndex === group.destinationOccurrenceIndex &&
  call.patternRunSequence === group.alightAtPatternRunSequence &&
  call.stopCallSequence > group.boardedAtStopCallSequence;

const updateWatermarks = (
  watermarks: readonly Readonly<WaitingGenerationLineageWatermark>[],
  groups: readonly Readonly<PassengerOnboardGroup>[],
): WaitingGenerationLineageWatermark[] => {
  const byKey = new Map(
    watermarks.map((watermark) => [
      watermark.passengerWaitingCohortKey,
      { ...watermark },
    ]),
  );
  for (const group of groups) {
    const cohort = {
      ...group,
      passengerWaitingCohortId: group.sourceWaitingCohortId,
    } as unknown as PassengerWaitingCohort;
    const key = passengerWaitingCohortKey(cohort);
    const existing = byKey.get(key);
    const sequence = passengerWaitingCohortSequence(
      group.sourceWaitingCohortId,
    );
    if (
      existing === undefined ||
      sequence >
        passengerWaitingCohortSequence(existing.passengerWaitingCohortId)
    )
      byKey.set(key, {
        passengerWaitingCohortKey: key,
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
        firstAssignedTick: group.firstAssignedTick,
        lastAssignedTick: group.lastAssignedTick,
        earliestBoardedAtTick: group.boardedAtTick,
      });
    else if (
      sequence ===
      passengerWaitingCohortSequence(existing.passengerWaitingCohortId)
    )
      byKey.set(key, {
        ...existing,
        earliestBoardedAtTick: Math.min(
          existing.earliestBoardedAtTick,
          group.boardedAtTick,
        ) as SimulationTick,
      });
    else throw new Error('Waiting generation lineage cannot move backward.');
  }
  return [...byKey.values()].sort((left, right) =>
    lexical(left.passengerWaitingCohortKey, right.passengerWaitingCohortKey),
  );
};

export function processPassengerTransitAtVehicleCalls(
  input: PassengerTransitInput,
): Readonly<PassengerTransitResult> {
  const tick = parseSimulationTick(input.tick);
  const settled = advancePassengerDestinationAccessToTick({
    tick,
    destinationAccessGroups: input.destinationAccessGroups,
    totalCompletedJourneyPassengerCount:
      input.totalCompletedJourneyPassengerCount,
  });
  let waiting = [...input.waitingCohorts];
  let onboard = [...input.onboardGroups];
  let access = [...settled.destinationAccessGroups];
  let watermarks = [...input.waitingGenerationLineageWatermarks];
  let nextOnboard = input.nextPassengerOnboardGroupSequence;
  let nextAccess = input.nextPassengerDestinationAccessGroupSequence;
  let waitingTotal = input.totalWaitingForVehiclePassengerCount;
  let boardedTotal = input.totalBoardedPassengerCount;
  let onboardTotal = input.totalOnboardPassengerCount;
  let alightedTotal = input.totalAlightedPassengerCount;
  let accessTotal = settled.totalInDestinationAccessPassengerCount;
  let completedTotal = settled.totalCompletedJourneyPassengerCount;
  const alightingEvents: CurrentAlightingEvent[] = [];
  const boardingEvents: CurrentBoardingEvent[] = [];
  const completionEvents = [...settled.currentJourneyCompletionEvents];
  const capacities = new Map(
    input.capacities.map((item) => [item.vehicleId, item.passengerCapacity]),
  );
  const cells = new Map(
    input.demandPlan.cells.map((cell) => [cell.cellId, cell]),
  );
  const calls = [...input.currentStopCalls].sort(
    (left, right) =>
      lexical(left.vehicleId, right.vehicleId) ||
      left.stopCallSequence - right.stopCallSequence,
  );

  for (const call of calls) {
    if (call.tick !== tick)
      throw new Error('Invalid current passenger transit call.');
    if (call.routeId === null) continue;
    const eligible = onboard
      .filter((group) => callMatchesDestination(call, group))
      .sort(
        (left, right) =>
          idSequence(left.passengerOnboardGroupId) -
          idSequence(right.passengerOnboardGroupId),
      );
    if (
      eligible.some(
        (group) =>
          !input.itineraryIsValid({
            ...group,
            passengerWaitingCohortId: group.sourceWaitingCohortId,
          }),
      )
    )
      throw new Error('Invalid onboard passenger itinerary.');
    if (eligible.length > 0) {
      const ids = new Set(
        eligible.map((group) => group.passengerOnboardGroupId),
      );
      onboard = onboard.filter(
        (group) => !ids.has(group.passengerOnboardGroupId),
      );
      let alightedByCall = 0;
      const accessIds: PassengerDestinationAccessGroupId[] = [];
      for (const group of eligible) {
        const cell = cells.get(group.destinationCellId);
        if (
          cell?.assignedStopPlaceId !== group.destinationStopPlaceId ||
          cell.distanceSquaredCells === null
        )
          throw new Error('Invalid destination access cell.');
        const destinationAccessTicks = calculatePassengerAccessTicks(
          cell.distanceSquaredCells,
          input.demandPlan.catchmentPolicy.maxAccessDistanceCells,
          input.demandPlan.accessPolicy.accessTicksPerCell,
        );
        const id = passengerDestinationAccessGroupIdSchema.parse(
          `passenger-destination-access-group-${nextAccess}`,
        );
        const completionTick = parseSimulationTick(
          checkedAdd(
            tick,
            destinationAccessTicks,
            'destination completion tick',
          ),
        );
        access.push({
          passengerDestinationAccessGroupId: id,
          sourceOnboardGroupId: group.passengerOnboardGroupId,
          sourceWaitingCohortId: group.sourceWaitingCohortId,
          vehicleId: group.vehicleId,
          routeId: group.routeId,
          patternId: group.patternId,
          originStopPlaceId: group.originStopPlaceId,
          originStopNodeId: group.originStopNodeId,
          originOccurrenceIndex: group.originOccurrenceIndex,
          destinationCellId: group.destinationCellId,
          destinationStopPlaceId: group.destinationStopPlaceId,
          destinationStopNodeId: group.destinationStopNodeId,
          destinationOccurrenceIndex: group.destinationOccurrenceIndex,
          wrapsPatternEnd: group.wrapsPatternEnd,
          edgeCount: group.edgeCount,
          boardedAtTick: group.boardedAtTick,
          boardedAtPatternRunSequence: group.boardedAtPatternRunSequence,
          boardedAtStopCallSequence: group.boardedAtStopCallSequence,
          alightedAtTick: tick,
          alightedAtPatternRunSequence: call.patternRunSequence,
          alightedAtStopCallSequence: call.stopCallSequence,
          destinationAccessTicks,
          completionTick,
          count: group.count,
          firstAssignedTick: group.firstAssignedTick,
          lastAssignedTick: group.lastAssignedTick,
        });
        nextAccess = checkedAdd(
          nextAccess,
          1,
          'destination access group sequence',
        );
        alightedByCall = checkedAdd(
          alightedByCall,
          group.count,
          'alighted passengers',
        );
        accessIds.push(id);
      }
      alightedTotal = checkedAdd(
        alightedTotal,
        alightedByCall,
        'total alighted passengers',
      );
      accessTotal = checkedAdd(
        accessTotal,
        alightedByCall,
        'destination access passengers',
      );
      const capacity = capacities.get(call.vehicleId)!;
      let vehicleOnboard = 0;
      for (const group of onboard)
        if (group.vehicleId === call.vehicleId)
          vehicleOnboard = checkedAdd(
            vehicleOnboard,
            group.count,
            'vehicle onboard passengers',
          );
      alightingEvents.push({
        vehicleId: call.vehicleId,
        routeId: call.routeId,
        patternId: call.patternId,
        stopNodeId: call.stopNodeId,
        occurrenceIndex: call.occurrenceIndex,
        stopCallSequence: call.stopCallSequence,
        patternRunSequence: call.patternRunSequence,
        tick,
        alightedPassengerCount: alightedByCall,
        onboardPassengerCountAfterAlighting: vehicleOnboard,
        remainingCapacityAfterAlighting: capacity - vehicleOnboard,
        sourceOnboardGroupIds: eligible.map(
          (group) => group.passengerOnboardGroupId,
        ),
        destinationAccessGroupIds: accessIds,
      });
    }

    const beforeIds = new Set(
      onboard.map((group) => group.passengerOnboardGroupId),
    );
    const boarding = boardPassengersAtVehicleCalls({
      tick,
      waitingCohorts: waiting,
      onboardGroups: onboard,
      nextPassengerOnboardGroupSequence: nextOnboard,
      totalBoardedPassengerCount: boardedTotal,
      capacities: input.capacities,
      vehicleOperations: input.vehicleOperations,
      currentStopCalls: [call],
      itineraryIsValid: input.itineraryIsValid,
    });
    waiting = [...boarding.waitingCohorts];
    onboard = [...boarding.onboardGroups];
    nextOnboard = boarding.nextPassengerOnboardGroupSequence;
    waitingTotal = boarding.totalWaitingForVehiclePassengerCount;
    boardedTotal = boarding.totalBoardedPassengerCount;
    onboardTotal = boarding.totalOnboardPassengerCount;
    boardingEvents.push(...boarding.currentBoardingEvents);
    watermarks = updateWatermarks(
      watermarks,
      onboard.filter((group) => !beforeIds.has(group.passengerOnboardGroupId)),
    );
  }
  access.sort(comparePassengerDestinationAccessGroups);
  const immediate = advancePassengerDestinationAccessToTick({
    tick,
    destinationAccessGroups: access,
    totalCompletedJourneyPassengerCount: completedTotal,
  });
  completedTotal = immediate.totalCompletedJourneyPassengerCount;
  access = [...immediate.destinationAccessGroups];
  completionEvents.push(...immediate.currentJourneyCompletionEvents);
  completionEvents.sort(comparePassengerDestinationAccessGroups);
  accessTotal = immediate.totalInDestinationAccessPassengerCount;
  return deepFreeze({
    waitingCohorts: waiting,
    waitingGenerationLineageWatermarks: watermarks,
    onboardGroups: onboard,
    destinationAccessGroups: access,
    nextPassengerOnboardGroupSequence: nextOnboard,
    nextPassengerDestinationAccessGroupSequence: nextAccess,
    totalWaitingForVehiclePassengerCount: waitingTotal,
    totalBoardedPassengerCount: boardedTotal,
    totalOnboardPassengerCount: onboardTotal,
    totalAlightedPassengerCount: alightedTotal,
    totalInDestinationAccessPassengerCount: accessTotal,
    totalCompletedJourneyPassengerCount: completedTotal,
    currentAlightingEvents: alightingEvents,
    currentBoardingEvents: boardingEvents,
    currentJourneyCompletionEvents: completionEvents,
  });
}

const onboardFromAccess = (
  group: Readonly<PassengerDestinationAccessGroup>,
): PassengerOnboardGroup => ({
  passengerOnboardGroupId: group.sourceOnboardGroupId,
  sourceWaitingCohortId: group.sourceWaitingCohortId,
  vehicleId: group.vehicleId,
  routeId: group.routeId,
  patternId: group.patternId,
  originStopPlaceId: group.originStopPlaceId,
  originStopNodeId: group.originStopNodeId,
  originOccurrenceIndex: group.originOccurrenceIndex,
  destinationCellId: group.destinationCellId,
  destinationStopPlaceId: group.destinationStopPlaceId,
  destinationStopNodeId: group.destinationStopNodeId,
  destinationOccurrenceIndex: group.destinationOccurrenceIndex,
  wrapsPatternEnd: group.wrapsPatternEnd,
  edgeCount: group.edgeCount,
  boardedAtTick: group.boardedAtTick,
  boardedAtPatternRunSequence: group.boardedAtPatternRunSequence,
  alightAtPatternRunSequence: group.alightedAtPatternRunSequence,
  boardedAtStopCallSequence: group.boardedAtStopCallSequence,
  count: group.count,
  firstAssignedTick: group.firstAssignedTick,
  lastAssignedTick: group.lastAssignedTick,
});

const waitingFromOnboard = (
  group: Readonly<PassengerOnboardGroup>,
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
  count: group.count,
  firstAssignedTick: group.firstAssignedTick,
  lastAssignedTick: group.lastAssignedTick,
});

const accessFromCompletion = (
  event: Readonly<PassengerJourneyCompletionEvent>,
): PassengerDestinationAccessGroup => {
  const {
    completedAtTick: _completedAtTick,
    minimumAssignmentToCompletionTicks: _minimum,
    maximumAssignmentToCompletionTicks: _maximum,
    inVehicleTicks: _inVehicle,
    ...group
  } = event;
  void _completedAtTick;
  void _minimum;
  void _maximum;
  void _inVehicle;
  return group;
};

const checkedSubtract = (
  left: number,
  right: number,
  context: string,
): number => {
  if (
    !Number.isSafeInteger(left) ||
    !Number.isSafeInteger(right) ||
    right < 0 ||
    right > left
  )
    throw new Error(`${context} underflow.`);
  return left - right;
};

/** Reconstructs the pre-call current-tick authority and proves the serialized
 * bounded events by replaying the production transit reducer once. */
export function validatePassengerTransitReplay(
  input: PassengerTransitInput & {
    readonly currentAlightingEvents: readonly Readonly<CurrentAlightingEvent>[];
    readonly currentBoardingEvents: readonly Readonly<CurrentBoardingEvent>[];
    readonly currentJourneyCompletionEvents: readonly Readonly<PassengerJourneyCompletionEvent>[];
  },
): void {
  const tick = parseSimulationTick(input.tick);
  const activeOnboardIds = new Set<string>();
  for (let index = 0; index < input.onboardGroups.length; index += 1) {
    const group = input.onboardGroups[index]!;
    const sequence = idSequence(group.passengerOnboardGroupId);
    if (
      activeOnboardIds.has(group.passengerOnboardGroupId) ||
      !Number.isSafeInteger(sequence) ||
      sequence < 1 ||
      sequence >= input.nextPassengerOnboardGroupSequence ||
      group.boardedAtTick > tick ||
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
      !input.itineraryIsValid(waitingFromOnboard(group)) ||
      (index > 0 &&
        comparePassengerOnboardGroups(input.onboardGroups[index - 1]!, group) >=
          0)
    )
      throw new Error('Invalid active onboard passenger authority.');
    activeOnboardIds.add(group.passengerOnboardGroupId);
  }
  if (input.totalAlightedPassengerCount === 0) {
    const activeSequences = input.onboardGroups
      .map((group) => idSequence(group.passengerOnboardGroupId))
      .sort((left, right) => left - right);
    if (
      input.nextPassengerOnboardGroupSequence !== activeSequences.length + 1 ||
      activeSequences.some((sequence, index) => sequence !== index + 1)
    )
      throw new Error('Invalid onboard group sequence authority.');
  }
  const completedGroups = parsePassengerJourneyCompletionEvents(
    input.currentJourneyCompletionEvents,
  );
  const lifecycleOnboardIds = new Set(
    input.onboardGroups.map((group) => group.passengerOnboardGroupId),
  );
  const lifecycleAccessIds = new Set<string>();
  for (const group of [...input.destinationAccessGroups, ...completedGroups]) {
    if (
      idSequence(group.sourceOnboardGroupId) >=
        input.nextPassengerOnboardGroupSequence ||
      lifecycleOnboardIds.has(group.sourceOnboardGroupId) ||
      lifecycleAccessIds.has(group.passengerDestinationAccessGroupId)
    )
      throw new Error('Duplicate passenger lifecycle ownership identity.');
    lifecycleOnboardIds.add(group.sourceOnboardGroupId);
    lifecycleAccessIds.add(group.passengerDestinationAccessGroupId);
  }
  const currentCreatedAccess = [
    ...input.destinationAccessGroups.filter(
      (group) => group.alightedAtTick === tick,
    ),
    ...completedGroups.filter((group) => group.alightedAtTick === tick),
  ];
  const currentAlighted = currentCreatedAccess.map(onboardFromAccess);
  const currentBoardedById = new Map<string, PassengerOnboardGroup>();
  for (const group of [...input.onboardGroups, ...currentAlighted])
    if (group.boardedAtTick === tick)
      currentBoardedById.set(group.passengerOnboardGroupId, group);
  const currentBoarded = [...currentBoardedById.values()];
  const priorOnboard = [
    ...input.onboardGroups.filter((group) => group.boardedAtTick < tick),
    ...currentAlighted.filter((group) => group.boardedAtTick < tick),
  ].sort(comparePassengerOnboardGroups);
  const waiting = input.waitingCohorts.map((cohort) => ({ ...cohort }));
  const waitingById = new Map(
    waiting.map((cohort) => [cohort.passengerWaitingCohortId, cohort]),
  );
  for (const group of currentBoarded) {
    const existing = waitingById.get(group.sourceWaitingCohortId);
    if (existing === undefined) {
      const cohort = waitingFromOnboard(group);
      waiting.push(cohort);
      waitingById.set(cohort.passengerWaitingCohortId, cohort);
    } else
      existing.count = checkedAdd(
        existing.count,
        group.count,
        'reconstructed waiting passengers',
      );
  }
  waiting.sort(
    (left, right) =>
      lexical(
        passengerWaitingCohortKey(left),
        passengerWaitingCohortKey(right),
      ) ||
      left.firstAssignedTick - right.firstAssignedTick ||
      passengerWaitingCohortSequence(left.passengerWaitingCohortId) -
        passengerWaitingCohortSequence(right.passengerWaitingCohortId),
  );
  const priorAccess = [
    ...input.destinationAccessGroups.filter(
      (group) => group.alightedAtTick < tick,
    ),
    ...completedGroups
      .filter((group) => group.alightedAtTick < tick)
      .map(accessFromCompletion),
  ].sort(comparePassengerDestinationAccessGroups);
  const boardedThisTick = currentBoarded.reduce(
    (total, group) =>
      checkedAdd(total, group.count, 'current boarded passengers'),
    0,
  );
  const alightedThisTick = currentAlighted.reduce(
    (total, group) =>
      checkedAdd(total, group.count, 'current alighted passengers'),
    0,
  );
  const completedThisTick = completedGroups.reduce(
    (total, group) =>
      checkedAdd(total, group.count, 'current completed passengers'),
    0,
  );
  const replay = processPassengerTransitAtVehicleCalls({
    ...input,
    waitingCohorts: waiting,
    onboardGroups: priorOnboard,
    destinationAccessGroups: priorAccess,
    nextPassengerOnboardGroupSequence: checkedSubtract(
      input.nextPassengerOnboardGroupSequence,
      currentBoarded.length,
      'onboard group sequence',
    ),
    nextPassengerDestinationAccessGroupSequence: checkedSubtract(
      input.nextPassengerDestinationAccessGroupSequence,
      currentCreatedAccess.length,
      'destination access group sequence',
    ),
    totalWaitingForVehiclePassengerCount: waiting.reduce(
      (total, cohort) => checkedAdd(total, cohort.count, 'waiting passengers'),
      0,
    ),
    totalBoardedPassengerCount: checkedSubtract(
      input.totalBoardedPassengerCount,
      boardedThisTick,
      'boarded passengers',
    ),
    totalOnboardPassengerCount: priorOnboard.reduce(
      (total, group) => checkedAdd(total, group.count, 'onboard passengers'),
      0,
    ),
    totalAlightedPassengerCount: checkedSubtract(
      input.totalAlightedPassengerCount,
      alightedThisTick,
      'alighted passengers',
    ),
    totalInDestinationAccessPassengerCount: priorAccess.reduce(
      (total, group) =>
        checkedAdd(total, group.count, 'destination access passengers'),
      0,
    ),
    totalCompletedJourneyPassengerCount: checkedSubtract(
      input.totalCompletedJourneyPassengerCount,
      completedThisTick,
      'completed passengers',
    ),
  });
  const expected = {
    waitingCohorts: input.waitingCohorts,
    waitingGenerationLineageWatermarks:
      input.waitingGenerationLineageWatermarks,
    onboardGroups: input.onboardGroups,
    destinationAccessGroups: input.destinationAccessGroups,
    nextPassengerOnboardGroupSequence: input.nextPassengerOnboardGroupSequence,
    nextPassengerDestinationAccessGroupSequence:
      input.nextPassengerDestinationAccessGroupSequence,
    totalWaitingForVehiclePassengerCount:
      input.totalWaitingForVehiclePassengerCount,
    totalBoardedPassengerCount: input.totalBoardedPassengerCount,
    totalOnboardPassengerCount: input.totalOnboardPassengerCount,
    totalAlightedPassengerCount: input.totalAlightedPassengerCount,
    totalInDestinationAccessPassengerCount:
      input.totalInDestinationAccessPassengerCount,
    totalCompletedJourneyPassengerCount:
      input.totalCompletedJourneyPassengerCount,
    currentAlightingEvents: input.currentAlightingEvents,
    currentBoardingEvents: input.currentBoardingEvents,
    currentJourneyCompletionEvents: input.currentJourneyCompletionEvents,
  };
  if (JSON.stringify(replay) !== JSON.stringify(expected))
    throw new Error('Passenger transit authority is not canonical.');
}
