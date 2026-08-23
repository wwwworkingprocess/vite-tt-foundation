import { z } from 'zod';
import type {
  CityId,
  CityPopulationCellId,
  StopCatchmentResult,
  StopPlaceId,
} from '@torrevieja-tycoon/transport-domain';
import { parseSimulationTick, type SimulationTick } from './time.js';
import type { ScenarioCoordinate } from './transport-simulation.js';
import type { PassengerDirectItineraryRuntimeIndex } from './passenger-direct-itinerary.js';
import {
  checkedAdd,
  checkedMultiply,
  deepFreeze,
  freezeTrustedAuthority,
  nonnegativeSafeInteger,
  positiveSafeInteger,
} from './authority-utils.js';
import {
  activatePassengerDirectItineraries,
  activateTrustedPassengerDirectItineraries,
  passengerWaitingCohortMatchesItinerary,
  passengerWaitingCohortIdSchema,
  passengerWaitingCohortSchema,
  type PassengerWaitingCohort,
} from './passenger-waiting-cohort.js';
import {
  passengerOnboardGroupSchema,
  type PassengerOnboardGroup,
} from './passenger-boarding.js';
import {
  passengerDestinationAccessGroupSchema,
  validatePassengerTransitCollections,
  waitingGenerationLineageWatermarkSchema,
  type PassengerDestinationAccessGroup,
  type WaitingGenerationLineageWatermark,
} from './passenger-transit.js';
import {
  allocateTrustedPassengerDestinations,
  passengerDemandRuntimeIndex,
} from './passenger-demand-runtime.js';
import {
  allocatePermutedDestinationCounts,
  derivePassengerDestinationPermutation,
} from './passenger-destination-permutation.js';
import type { PassengerRuntimePhaseObserver } from './passenger-runtime-profiling.js';

export const passengerDemandPlanSchemaVersion = '1.0.0' as const;
const distanceTieToleranceSquaredCells = 1e-9;

const demandModelHashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .brand<'PassengerDemandModelHash'>();
const passengerGroupIdSchema = z
  .string()
  .regex(/^passenger-group-[1-9]\d*$/)
  .brand<'PassengerGroupId'>();
const passengerJourneyGroupIdSchema = z
  .string()
  .regex(/^passenger-journey-group-[1-9]\d*$/)
  .brand<'PassengerJourneyGroupId'>();
const scenarioCoordinateSchema = z.strictObject({
  scenarioSchemaVersion: z.literal('1.0.0'),
  scenarioId: z.string().trim().min(1),
  scenarioVersion: z
    .string()
    .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
});
const gridIdentitySchema = z.strictObject({
  cityId: z.string().regex(/^Q[1-9]\d*$/),
  populationGridSchemaVersion: z.literal('1.0.0'),
  gridVersion: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
  rows: positiveSafeInteger,
  columns: positiveSafeInteger,
  resolutionDegrees: z.literal(0.001),
  totalActiveCellCount: nonnegativeSafeInteger,
  totalPopulationWeight: nonnegativeSafeInteger,
});
const catchmentPolicySchema = z.strictObject({
  maxAccessDistanceCells: positiveSafeInteger,
});
const emissionPolicySchema = z.strictObject({
  emissionCreditsPerWeightPerTick: positiveSafeInteger,
  creditsPerPassenger: positiveSafeInteger,
});
const accessPolicySchema = z.strictObject({
  accessTicksPerCell: positiveSafeInteger,
});
const passengerOriginStopArrivalEventSchema = z.strictObject({
  tick: nonnegativeSafeInteger,
  stopPlaceId: z.string().min(1),
  arrivedPassengerCount: positiveSafeInteger,
});
const planCellSchema = z.strictObject({
  cellId: z.string().regex(/^r(?:0|[1-9]\d*)c(?:0|[1-9]\d*)$/),
  row: nonnegativeSafeInteger,
  column: nonnegativeSafeInteger,
  populationWeight: positiveSafeInteger,
  assignedStopPlaceId: z.string().min(1).nullable(),
  distanceSquaredCells: z.number().finite().nonnegative().nullable(),
});
const planStopSchema = z.strictObject({ stopPlaceId: z.string().min(1) });
const planSchema = z.strictObject({
  schemaVersion: z.literal(passengerDemandPlanSchemaVersion),
  demandModelContentHash: demandModelHashSchema,
  scenario: scenarioCoordinateSchema,
  grid: gridIdentitySchema,
  catchmentPolicy: catchmentPolicySchema,
  emissionPolicy: emissionPolicySchema,
  accessPolicy: accessPolicySchema,
  cells: z.array(planCellSchema),
  stops: z.array(planStopSchema),
});

export type PassengerDemandModelHash = z.infer<typeof demandModelHashSchema>;
export type PassengerGroupId = z.infer<typeof passengerGroupIdSchema>;
export type PassengerJourneyGroupId = z.infer<
  typeof passengerJourneyGroupIdSchema
>;

export interface PassengerDemandPlanCell {
  readonly cellId: CityPopulationCellId;
  readonly row: number;
  readonly column: number;
  readonly populationWeight: number;
  readonly assignedStopPlaceId: StopPlaceId | null;
  readonly distanceSquaredCells: number | null;
}

export interface PassengerDemandPlanStop {
  readonly stopPlaceId: StopPlaceId;
}

export interface PassengerDemandPlanV1 {
  readonly schemaVersion: typeof passengerDemandPlanSchemaVersion;
  readonly demandModelContentHash: PassengerDemandModelHash;
  readonly scenario: Readonly<ScenarioCoordinate>;
  readonly grid: Readonly<{
    cityId: CityId;
    populationGridSchemaVersion: '1.0.0';
    gridVersion: string;
    rows: number;
    columns: number;
    resolutionDegrees: 0.001;
    totalActiveCellCount: number;
    totalPopulationWeight: number;
  }>;
  readonly catchmentPolicy: Readonly<{ maxAccessDistanceCells: number }>;
  readonly emissionPolicy: Readonly<{
    emissionCreditsPerWeightPerTick: number;
    creditsPerPassenger: number;
  }>;
  readonly accessPolicy: Readonly<{ accessTicksPerCell: number }>;
  readonly cells: readonly Readonly<PassengerDemandPlanCell>[];
  readonly stops: readonly Readonly<PassengerDemandPlanStop>[];
}

export interface PassengerCellCreditState {
  readonly cellId: CityPopulationCellId;
  readonly credit: number;
}

export interface AccessingPassengerGroup {
  readonly passengerGroupId: PassengerGroupId;
  readonly cellId: CityPopulationCellId;
  readonly targetStopPlaceId: StopPlaceId;
  readonly count: number;
  readonly spawnTick: SimulationTick;
  readonly arrivalTick: SimulationTick;
}

export interface StopPlaceArrivalState {
  readonly stopPlaceId: StopPlaceId;
  readonly awaitingDestinationCount: number;
}

export interface PassengerDestinationCandidate {
  readonly cellId: CityPopulationCellId;
  readonly row: number;
  readonly column: number;
  readonly destinationStopPlaceId: StopPlaceId;
  readonly weight: number;
}

export interface PassengerDestinationCursorState {
  readonly stopPlaceId: StopPlaceId;
  readonly destinationCursor: number;
}

export interface PassengerOriginStopArrivalEvent {
  readonly tick: SimulationTick;
  readonly stopPlaceId: StopPlaceId;
  readonly arrivedPassengerCount: number;
}

export interface PassengerDemandAdvancementResult {
  readonly state: ActivePassengerDemandState;
  readonly passengerOriginStopArrivalEvents: readonly Readonly<PassengerOriginStopArrivalEvent>[];
}

export function parsePassengerOriginStopArrivalEvents(
  input: unknown,
): readonly Readonly<PassengerOriginStopArrivalEvent>[] {
  return deepFreeze(
    z
      .array(passengerOriginStopArrivalEventSchema)
      .parse(input)
      .map((event) => ({
        ...event,
        tick: parseSimulationTick(event.tick),
        stopPlaceId: event.stopPlaceId as StopPlaceId,
      })),
  );
}

export interface DestinationAssignedPassengerGroup {
  readonly passengerJourneyGroupId: PassengerJourneyGroupId;
  readonly originStopPlaceId: StopPlaceId;
  readonly destinationCellId: CityPopulationCellId;
  readonly destinationStopPlaceId: StopPlaceId;
  readonly count: number;
  readonly firstAssignedTick: SimulationTick;
  readonly lastAssignedTick: SimulationTick;
}

export interface DisabledPassengerDemandState {
  readonly status: 'disabled';
}

export interface ActivePassengerDemandState {
  readonly status: 'active';
  readonly demandPlanCoordinate: Readonly<{
    schemaVersion: '1.0.0';
    demandModelContentHash: PassengerDemandModelHash;
    scenario: Readonly<ScenarioCoordinate>;
    grid: PassengerDemandPlanV1['grid'];
    catchmentPolicy: PassengerDemandPlanV1['catchmentPolicy'];
    emissionPolicy: PassengerDemandPlanV1['emissionPolicy'];
    accessPolicy: PassengerDemandPlanV1['accessPolicy'];
  }>;
  readonly processedThroughTick: SimulationTick;
  readonly nextPassengerGroupSequence: number;
  readonly nextPassengerWaitingCohortSequence: number;
  readonly nextPassengerOnboardGroupSequence: number;
  readonly nextPassengerDestinationAccessGroupSequence: number;
  readonly cellCredits: readonly Readonly<PassengerCellCreditState>[];
  readonly accessingGroups: readonly Readonly<AccessingPassengerGroup>[];
  readonly stopArrivals: readonly Readonly<StopPlaceArrivalState>[];
  readonly destinationCursors: readonly Readonly<PassengerDestinationCursorState>[];
  readonly waitingCohorts: readonly Readonly<PassengerWaitingCohort>[];
  readonly waitingGenerationLineageWatermarks: readonly Readonly<WaitingGenerationLineageWatermark>[];
  readonly onboardGroups: readonly Readonly<PassengerOnboardGroup>[];
  readonly destinationAccessGroups: readonly Readonly<PassengerDestinationAccessGroup>[];
  readonly totalEmittedPassengerCount: number;
  readonly servedEmittedPassengerCount: number;
  readonly unservedAtSourcePassengerCount: number;
  readonly totalArrivedAtStopPassengerCount: number;
  readonly totalDestinationAssignedPassengerCount: number;
  readonly destinationUnavailableAtStopPassengerCount: number;
  readonly directItineraryUnavailablePassengerCount: number;
  readonly totalWaitingForVehiclePassengerCount: number;
  readonly totalBoardedPassengerCount: number;
  readonly totalOnboardPassengerCount: number;
  readonly totalAlightedPassengerCount: number;
  readonly totalInDestinationAccessPassengerCount: number;
  readonly totalCompletedJourneyPassengerCount: number;
}

export type PassengerDemandState =
  DisabledPassengerDemandState | ActivePassengerDemandState;

const stateSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('disabled') }),
  z.strictObject({
    status: z.literal('active'),
    demandPlanCoordinate: z.strictObject({
      schemaVersion: z.literal('1.0.0'),
      demandModelContentHash: demandModelHashSchema,
      scenario: scenarioCoordinateSchema,
      grid: gridIdentitySchema,
      catchmentPolicy: catchmentPolicySchema,
      emissionPolicy: emissionPolicySchema,
      accessPolicy: accessPolicySchema,
    }),
    processedThroughTick: nonnegativeSafeInteger,
    nextPassengerGroupSequence: positiveSafeInteger,
    nextPassengerWaitingCohortSequence: positiveSafeInteger,
    nextPassengerOnboardGroupSequence: positiveSafeInteger,
    nextPassengerDestinationAccessGroupSequence: positiveSafeInteger,
    cellCredits: z.array(
      z.strictObject({
        cellId: planCellSchema.shape.cellId,
        credit: nonnegativeSafeInteger,
      }),
    ),
    accessingGroups: z.array(
      z.strictObject({
        passengerGroupId: passengerGroupIdSchema,
        cellId: planCellSchema.shape.cellId,
        targetStopPlaceId: z.string().min(1),
        count: positiveSafeInteger,
        spawnTick: nonnegativeSafeInteger,
        arrivalTick: nonnegativeSafeInteger,
      }),
    ),
    stopArrivals: z.array(
      z.strictObject({
        stopPlaceId: z.string().min(1),
        awaitingDestinationCount: nonnegativeSafeInteger,
      }),
    ),
    destinationCursors: z.array(
      z.strictObject({
        stopPlaceId: z.string().min(1),
        destinationCursor: nonnegativeSafeInteger,
      }),
    ),
    waitingCohorts: z.array(passengerWaitingCohortSchema),
    waitingGenerationLineageWatermarks: z.array(
      waitingGenerationLineageWatermarkSchema,
    ),
    onboardGroups: z.array(passengerOnboardGroupSchema),
    destinationAccessGroups: z.array(passengerDestinationAccessGroupSchema),
    totalEmittedPassengerCount: nonnegativeSafeInteger,
    servedEmittedPassengerCount: nonnegativeSafeInteger,
    unservedAtSourcePassengerCount: nonnegativeSafeInteger,
    totalArrivedAtStopPassengerCount: nonnegativeSafeInteger,
    totalDestinationAssignedPassengerCount: nonnegativeSafeInteger,
    destinationUnavailableAtStopPassengerCount: nonnegativeSafeInteger,
    directItineraryUnavailablePassengerCount: nonnegativeSafeInteger,
    totalWaitingForVehiclePassengerCount: nonnegativeSafeInteger,
    totalBoardedPassengerCount: nonnegativeSafeInteger,
    totalOnboardPassengerCount: nonnegativeSafeInteger,
    totalAlightedPassengerCount: nonnegativeSafeInteger,
    totalInDestinationAccessPassengerCount: nonnegativeSafeInteger,
    totalCompletedJourneyPassengerCount: nonnegativeSafeInteger,
  }),
]);
const projectionSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('disabled') }),
  z.strictObject({
    status: z.literal('active'),
    demandPlanCoordinate: stateSchema.options[1].shape.demandPlanCoordinate,
    processedThroughTick: nonnegativeSafeInteger,
    totalEmittedPassengerCount: nonnegativeSafeInteger,
    unservedAtSourcePassengerCount: nonnegativeSafeInteger,
    inAccessPassengerCount: nonnegativeSafeInteger,
    accessingGroupCount: nonnegativeSafeInteger,
    totalAwaitingDestinationCount: nonnegativeSafeInteger,
    totalDestinationAssignedPassengerCount: nonnegativeSafeInteger,
    destinationUnavailableAtStopPassengerCount: nonnegativeSafeInteger,
    directItineraryUnavailablePassengerCount: nonnegativeSafeInteger,
    totalWaitingForVehiclePassengerCount: nonnegativeSafeInteger,
    totalBoardedPassengerCount: nonnegativeSafeInteger,
    totalOnboardPassengerCount: nonnegativeSafeInteger,
    totalAlightedPassengerCount: nonnegativeSafeInteger,
    totalInDestinationAccessPassengerCount: nonnegativeSafeInteger,
    totalCompletedJourneyPassengerCount: nonnegativeSafeInteger,
    onboardGroupCount: nonnegativeSafeInteger,
    onboardGroups: z.array(passengerOnboardGroupSchema),
    destinationAccessGroupCount: nonnegativeSafeInteger,
    destinationAccessGroups: z.array(passengerDestinationAccessGroupSchema),
    waitingCohortCount: nonnegativeSafeInteger,
    waitingCohorts: stateSchema.options[1].shape.waitingCohorts,
    stopArrivals: stateSchema.options[1].shape.stopArrivals,
  }),
]);

export type PassengerDemandProjection = Readonly<
  | { readonly status: 'disabled' }
  | {
      readonly status: 'active';
      readonly demandPlanCoordinate: ActivePassengerDemandState['demandPlanCoordinate'];
      readonly processedThroughTick: SimulationTick;
      readonly totalEmittedPassengerCount: number;
      readonly unservedAtSourcePassengerCount: number;
      readonly inAccessPassengerCount: number;
      readonly accessingGroupCount: number;
      readonly totalAwaitingDestinationCount: number;
      readonly totalDestinationAssignedPassengerCount: number;
      readonly destinationUnavailableAtStopPassengerCount: number;
      readonly directItineraryUnavailablePassengerCount: number;
      readonly totalWaitingForVehiclePassengerCount: number;
      readonly totalBoardedPassengerCount: number;
      readonly totalOnboardPassengerCount: number;
      readonly totalAlightedPassengerCount: number;
      readonly totalInDestinationAccessPassengerCount: number;
      readonly totalCompletedJourneyPassengerCount: number;
      readonly onboardGroupCount: number;
      readonly onboardGroups: readonly Readonly<PassengerOnboardGroup>[];
      readonly destinationAccessGroupCount: number;
      readonly destinationAccessGroups: readonly Readonly<PassengerDestinationAccessGroup>[];
      readonly waitingCohortCount: number;
      readonly waitingCohorts: readonly Readonly<PassengerWaitingCohort>[];
      readonly stopArrivals: readonly Readonly<StopPlaceArrivalState>[];
    }
>;

export function listPassengerDestinationCandidates(
  plan: PassengerDemandPlanV1,
  originStopPlaceId: StopPlaceId | string,
): readonly Readonly<PassengerDestinationCandidate>[] {
  const parsedPlan = parsePassengerDemandPlan(plan);
  if (!parsedPlan.stops.some((stop) => stop.stopPlaceId === originStopPlaceId))
    throw new Error('Unknown origin StopPlace.');
  return destinationCandidates(parsedPlan, originStopPlaceId);
}

const destinationCandidates = (
  plan: PassengerDemandPlanV1,
  originStopPlaceId: StopPlaceId | string,
) =>
  deepFreeze(
    plan.cells
      .filter(
        (cell) =>
          cell.assignedStopPlaceId !== null &&
          cell.assignedStopPlaceId !== originStopPlaceId,
      )
      .map((cell) => ({
        cellId: cell.cellId,
        row: cell.row,
        column: cell.column,
        destinationStopPlaceId: cell.assignedStopPlaceId!,
        weight: cell.populationWeight,
      })),
  );

export function allocatePassengerDestinations(
  candidatesInput: readonly Readonly<PassengerDestinationCandidate>[],
  cursor: number,
  passengerCount: number,
  demandModelContentHash: string,
  originStopPlaceId: string,
): Readonly<{
  readonly allocations: readonly Readonly<
    PassengerDestinationCandidate & { readonly count: number }
  >[];
  readonly nextCursor: number;
}> {
  if (
    !/^[0-9a-f]{64}$/.test(demandModelContentHash) ||
    originStopPlaceId.trim().length === 0
  )
    throw new Error('Invalid destination permutation coordinate.');
  if (
    !Number.isSafeInteger(cursor) ||
    cursor < 0 ||
    !Number.isSafeInteger(passengerCount) ||
    passengerCount < 0
  )
    throw new Error('Invalid allocation.');
  const candidates = [...candidatesInput].sort(
    (left, right) => left.row - right.row || left.column - right.column,
  );
  let totalWeight = 0;
  const keys = new Set<string>();
  for (const candidate of candidates) {
    if (
      !Number.isSafeInteger(candidate.weight) ||
      candidate.weight <= 0 ||
      !Number.isSafeInteger(candidate.row) ||
      candidate.row < 0 ||
      !Number.isSafeInteger(candidate.column) ||
      candidate.column < 0 ||
      keys.has(candidate.cellId)
    )
      throw new Error('Invalid candidate.');
    keys.add(candidate.cellId);
    totalWeight = checkedAdd(
      totalWeight,
      candidate.weight,
      'destination candidate weight',
    );
  }
  if (totalWeight === 0) {
    if (cursor !== 0) throw new Error('Invalid empty cursor.');
    return deepFreeze({ allocations: [], nextCursor: 0 });
  }
  if (cursor >= totalWeight) throw new Error('Invalid cursor.');
  const cumulativeEnds: number[] = [];
  let cumulative = 0;
  for (const candidate of candidates) {
    cumulative = checkedAdd(
      cumulative,
      candidate.weight,
      'destination interval',
    );
    cumulativeEnds.push(cumulative);
  }
  const result = allocatePermutedDestinationCounts(
    candidates.map(({ weight }) => weight),
    cursor,
    passengerCount,
    derivePassengerDestinationPermutation(
      demandModelContentHash,
      originStopPlaceId,
      totalWeight,
    ),
    (position) => {
      let low = 0;
      let high = cumulativeEnds.length - 1;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (position < cumulativeEnds[middle]!) high = middle;
        else low = middle + 1;
      }
      return low;
    },
  );
  const allocations = candidates.map((candidate, index) => ({
    ...candidate,
    count: result.counts[index]!,
  }));
  return deepFreeze({
    allocations,
    nextCursor: result.nextCursor,
  });
}

const coordinateEqual = (
  left: Readonly<ScenarioCoordinate>,
  right: Readonly<ScenarioCoordinate>,
) =>
  left.scenarioSchemaVersion === right.scenarioSchemaVersion &&
  left.scenarioId === right.scenarioId &&
  left.scenarioVersion === right.scenarioVersion &&
  left.contentHash === right.contentHash;

const planCoordinate = (plan: PassengerDemandPlanV1) =>
  deepFreeze({
    schemaVersion: plan.schemaVersion,
    demandModelContentHash: plan.demandModelContentHash,
    scenario: plan.scenario,
    grid: plan.grid,
    catchmentPolicy: plan.catchmentPolicy,
    emissionPolicy: plan.emissionPolicy,
    accessPolicy: plan.accessPolicy,
  });

const validatePlanSemantics = (
  parsed: z.infer<typeof planSchema>,
): PassengerDemandPlanV1 => {
  const cells = [...parsed.cells].sort(
    (left, right) => left.row - right.row || left.column - right.column,
  );
  const stops = [...parsed.stops].sort((left, right) =>
    left.stopPlaceId < right.stopPlaceId ? -1 : 1,
  );
  if (new Set(cells.map((cell) => cell.cellId)).size !== cells.length)
    throw new Error('Passenger demand plan has duplicate cell IDs.');
  const occupiedCells = new Set<string>();
  for (const cell of cells) {
    const coordinate = `${cell.row}:${cell.column}`;
    if (occupiedCells.has(coordinate))
      throw new Error('Passenger demand plan has duplicate cell coordinates.');
    occupiedCells.add(coordinate);
    if (cell.row >= parsed.grid.rows || cell.column >= parsed.grid.columns)
      throw new Error('Passenger demand plan cell is outside grid bounds.');
    if (cell.cellId !== `r${cell.row}c${cell.column}`)
      throw new Error('Passenger demand plan cell identity is inconsistent.');
  }
  if (new Set(stops.map((stop) => stop.stopPlaceId)).size !== stops.length)
    throw new Error('Passenger demand plan has duplicate StopPlace IDs.');
  const stopIds = new Set(stops.map((stop) => stop.stopPlaceId));
  let totalWeight = 0;
  for (const cell of cells) {
    totalWeight = checkedAdd(
      totalWeight,
      cell.populationWeight,
      'plan population weight',
    );
    const served = cell.assignedStopPlaceId !== null;
    if (
      served !== (cell.distanceSquaredCells !== null) ||
      (served && !stopIds.has(cell.assignedStopPlaceId!)) ||
      (cell.distanceSquaredCells !== null &&
        cell.distanceSquaredCells >
          parsed.catchmentPolicy.maxAccessDistanceCells ** 2 +
            distanceTieToleranceSquaredCells)
    )
      throw new Error('Passenger demand plan cell assignment is inconsistent.');
  }
  if (
    cells.length !== parsed.grid.totalActiveCellCount ||
    totalWeight !== parsed.grid.totalPopulationWeight
  )
    throw new Error('Passenger demand plan grid totals are inconsistent.');
  return deepFreeze({
    ...parsed,
    demandModelContentHash: parsed.demandModelContentHash,
    scenario: parsed.scenario as ScenarioCoordinate,
    grid: { ...parsed.grid, cityId: parsed.grid.cityId as CityId },
    cells: cells as PassengerDemandPlanCell[],
    stops: stops as PassengerDemandPlanStop[],
  });
};

export function parsePassengerDemandPlan(
  value: unknown,
): PassengerDemandPlanV1 {
  return validatePlanSemantics(planSchema.parse(value));
}

export function createPassengerDemandPlan(input: {
  readonly catchment: StopCatchmentResult;
  readonly demandModelContentHash: string;
  readonly emissionPolicy: Readonly<{
    emissionCreditsPerWeightPerTick: number;
    creditsPerPassenger: number;
  }>;
  readonly accessPolicy: Readonly<{ accessTicksPerCell: number }>;
}): PassengerDemandPlanV1 {
  return parsePassengerDemandPlan({
    schemaVersion: passengerDemandPlanSchemaVersion,
    demandModelContentHash: input.demandModelContentHash,
    scenario: input.catchment.scenario,
    grid: input.catchment.grid,
    catchmentPolicy: input.catchment.catchmentPolicy,
    emissionPolicy: input.emissionPolicy,
    accessPolicy: input.accessPolicy,
    cells: input.catchment.cellAssignments.map((assignment) => ({
      cellId: assignment.cellId,
      row: assignment.row,
      column: assignment.column,
      populationWeight: assignment.populationWeight,
      assignedStopPlaceId: assignment.assignedStopPlaceId,
      distanceSquaredCells: assignment.distanceSquaredCells,
    })),
    stops: input.catchment.stopSummaries.map((summary) => ({
      stopPlaceId: summary.stopPlaceId,
    })),
  });
}

export function createDisabledPassengerDemandState(): DisabledPassengerDemandState {
  return deepFreeze({ status: 'disabled' });
}

export function parsePassengerDemandState(
  value: unknown,
): PassengerDemandState {
  const parsed = stateSchema.parse(value);
  if (parsed.status === 'disabled') return createDisabledPassengerDemandState();
  return deepFreeze({
    ...parsed,
    processedThroughTick: parseSimulationTick(parsed.processedThroughTick),
    demandPlanCoordinate:
      parsed.demandPlanCoordinate as ActivePassengerDemandState['demandPlanCoordinate'],
    cellCredits: parsed.cellCredits as PassengerCellCreditState[],
    accessingGroups: parsed.accessingGroups as AccessingPassengerGroup[],
    stopArrivals: parsed.stopArrivals as StopPlaceArrivalState[],
    destinationCursors:
      parsed.destinationCursors as PassengerDestinationCursorState[],
    waitingCohorts: parsed.waitingCohorts as PassengerWaitingCohort[],
    onboardGroups: parsed.onboardGroups as PassengerOnboardGroup[],
    waitingGenerationLineageWatermarks:
      parsed.waitingGenerationLineageWatermarks as WaitingGenerationLineageWatermark[],
    destinationAccessGroups:
      parsed.destinationAccessGroups as PassengerDestinationAccessGroup[],
  });
}

export function createInitialPassengerDemandState(
  plan: PassengerDemandPlanV1,
  initialTick: number,
): ActivePassengerDemandState {
  return createInitialTrustedPassengerDemandState(
    parsePassengerDemandPlan(plan),
    initialTick,
  );
}

/** Internal composition boundary. The caller must already own parsed authority. */
export function createInitialTrustedPassengerDemandState(
  parsedPlan: PassengerDemandPlanV1,
  initialTick: number,
): ActivePassengerDemandState {
  return deepFreeze({
    status: 'active',
    demandPlanCoordinate: planCoordinate(parsedPlan),
    processedThroughTick: parseSimulationTick(initialTick),
    nextPassengerGroupSequence: 1,
    nextPassengerWaitingCohortSequence: 1,
    nextPassengerOnboardGroupSequence: 1,
    nextPassengerDestinationAccessGroupSequence: 1,
    cellCredits: parsedPlan.cells.map((cell) => ({
      cellId: cell.cellId,
      credit: 0,
    })),
    accessingGroups: [],
    stopArrivals: parsedPlan.stops.map((stop) => ({
      stopPlaceId: stop.stopPlaceId,
      awaitingDestinationCount: 0,
    })),
    destinationCursors: parsedPlan.stops.map((stop) => ({
      stopPlaceId: stop.stopPlaceId,
      destinationCursor: 0,
    })),
    waitingCohorts: [],
    waitingGenerationLineageWatermarks: [],
    onboardGroups: [],
    destinationAccessGroups: [],
    totalEmittedPassengerCount: 0,
    servedEmittedPassengerCount: 0,
    unservedAtSourcePassengerCount: 0,
    totalArrivedAtStopPassengerCount: 0,
    totalDestinationAssignedPassengerCount: 0,
    destinationUnavailableAtStopPassengerCount: 0,
    directItineraryUnavailablePassengerCount: 0,
    totalWaitingForVehiclePassengerCount: 0,
    totalBoardedPassengerCount: 0,
    totalOnboardPassengerCount: 0,
    totalAlightedPassengerCount: 0,
    totalInDestinationAccessPassengerCount: 0,
    totalCompletedJourneyPassengerCount: 0,
  });
}

const distanceBand = (
  distanceSquaredCells: number,
  maximumDistanceCells: number,
) => {
  let lower = 0;
  let upper = maximumDistanceCells;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    const squared = middle * middle;
    if (distanceSquaredCells <= squared + distanceTieToleranceSquaredCells)
      upper = middle;
    else lower = middle + 1;
  }
  return lower;
};

export function calculatePassengerAccessTicks(
  distanceSquaredCells: number,
  maximumDistanceCells: number,
  accessTicksPerCell: number,
): number {
  if (
    !Number.isFinite(distanceSquaredCells) ||
    distanceSquaredCells < 0 ||
    !Number.isSafeInteger(maximumDistanceCells) ||
    maximumDistanceCells < 1 ||
    !Number.isSafeInteger(accessTicksPerCell) ||
    accessTicksPerCell < 1
  )
    throw new Error('Invalid passenger access timing input.');
  return checkedMultiply(
    distanceBand(distanceSquaredCells, maximumDistanceCells),
    accessTicksPerCell,
    'access duration',
  );
}

const compareGroups = (
  left: Readonly<AccessingPassengerGroup>,
  right: Readonly<AccessingPassengerGroup>,
) =>
  left.arrivalTick - right.arrivalTick ||
  (left.passengerGroupId < right.passengerGroupId ? -1 : 1);

export function validatePassengerDemandState(
  plan: PassengerDemandPlanV1,
  itineraryIndex: PassengerDirectItineraryRuntimeIndex,
  value: unknown,
): ActivePassengerDemandState {
  return validateTrustedPassengerDemandState(
    parsePassengerDemandPlan(plan),
    itineraryIndex,
    value,
  );
}

/** Internal composition boundary. The caller must already own parsed authority. */
export function validateTrustedPassengerDemandState(
  parsedPlan: PassengerDemandPlanV1,
  itineraryIndex: PassengerDirectItineraryRuntimeIndex,
  value: unknown,
): ActivePassengerDemandState {
  const parsed = stateSchema.parse(value);
  if (parsed.status !== 'active')
    throw new Error('Expected active passenger demand state.');
  if (
    parsed.demandPlanCoordinate.schemaVersion !== parsedPlan.schemaVersion ||
    parsed.demandPlanCoordinate.demandModelContentHash !==
      parsedPlan.demandModelContentHash ||
    !coordinateEqual(
      parsed.demandPlanCoordinate.scenario as ScenarioCoordinate,
      parsedPlan.scenario,
    ) ||
    JSON.stringify(parsed.demandPlanCoordinate.grid) !==
      JSON.stringify(parsedPlan.grid) ||
    JSON.stringify(parsed.demandPlanCoordinate.catchmentPolicy) !==
      JSON.stringify(parsedPlan.catchmentPolicy) ||
    JSON.stringify(parsed.demandPlanCoordinate.emissionPolicy) !==
      JSON.stringify(parsedPlan.emissionPolicy) ||
    JSON.stringify(parsed.demandPlanCoordinate.accessPolicy) !==
      JSON.stringify(parsedPlan.accessPolicy)
  )
    throw new Error('Passenger demand plan coordinate mismatch.');
  if (
    parsed.cellCredits.length !== parsedPlan.cells.length ||
    parsed.cellCredits.some(
      (credit, index) =>
        credit.cellId !== parsedPlan.cells[index]!.cellId ||
        credit.credit >= parsedPlan.emissionPolicy.creditsPerPassenger,
    )
  )
    throw new Error('Passenger cell-credit state is inconsistent.');
  if (
    parsed.stopArrivals.length !== parsedPlan.stops.length ||
    parsed.stopArrivals.some(
      (arrival, index) =>
        arrival.stopPlaceId !== parsedPlan.stops[index]!.stopPlaceId ||
        arrival.awaitingDestinationCount !== 0,
    )
  )
    throw new Error(
      'Passenger StopPlace arrivals contain invalid destination backlog.',
    );
  if (
    parsed.destinationCursors.length !== parsedPlan.stops.length ||
    parsed.destinationCursors.some(
      (cursor, index) =>
        cursor.stopPlaceId !== parsedPlan.stops[index]!.stopPlaceId,
    )
  )
    throw new Error('Invalid destination cursors.');
  for (const cursor of parsed.destinationCursors) {
    const candidates = listPassengerDestinationCandidates(
      parsedPlan,
      cursor.stopPlaceId,
    );
    const weight = candidates.reduce(
      (total, candidate) =>
        checkedAdd(total, candidate.weight, 'destination candidate weight'),
      0,
    );
    if (
      (weight === 0 && cursor.destinationCursor !== 0) ||
      (weight > 0 && cursor.destinationCursor >= weight)
    )
      throw new Error('Invalid destination cursor.');
  }
  const cells = new Map(parsedPlan.cells.map((cell) => [cell.cellId, cell]));
  const groupIds = new Set<string>();
  let inAccess = 0;
  for (let index = 1; index < parsed.accessingGroups.length; index += 1)
    if (
      compareGroups(
        parsed.accessingGroups[index - 1] as AccessingPassengerGroup,
        parsed.accessingGroups[index] as AccessingPassengerGroup,
      ) >= 0
    )
      throw new Error('Accessing passenger group order is non-canonical.');
  for (const group of parsed.accessingGroups) {
    const cell = cells.get(group.cellId as CityPopulationCellId);
    const sequence = Number(
      group.passengerGroupId.slice('passenger-group-'.length),
    );
    if (
      groupIds.has(group.passengerGroupId) ||
      cell?.assignedStopPlaceId !== group.targetStopPlaceId ||
      group.spawnTick > parsed.processedThroughTick ||
      group.arrivalTick <= parsed.processedThroughTick ||
      group.arrivalTick < group.spawnTick ||
      !Number.isSafeInteger(sequence) ||
      sequence >= parsed.nextPassengerGroupSequence
    )
      throw new Error('Accessing passenger group is inconsistent.');
    groupIds.add(group.passengerGroupId);
    inAccess = checkedAdd(inAccess, group.count, 'in-access passengers');
  }
  const arrived = parsed.stopArrivals.reduce(
    (total, stop) =>
      checkedAdd(
        total,
        stop.awaitingDestinationCount,
        'awaiting destination passengers',
      ),
    0,
  );
  const waitingAuthority = activatePassengerDirectItineraries({
    itineraryIndex,
    demandPlan: parsedPlan,
    destinationAssignedGroups: [],
    waitingCohorts: parsed.waitingCohorts as PassengerWaitingCohort[],
    nextPassengerWaitingCohortSequence:
      parsed.nextPassengerWaitingCohortSequence,
    directItineraryUnavailablePassengerCount:
      parsed.directItineraryUnavailablePassengerCount,
    activationTick: parsed.processedThroughTick,
    nonMergeableWaitingCohortIds: new Set(
      [
        ...parsed.onboardGroups.map((group) => group.sourceWaitingCohortId),
        ...parsed.waitingGenerationLineageWatermarks.map(
          (watermark) => watermark.passengerWaitingCohortId,
        ),
      ].map((id) => passengerWaitingCohortIdSchema.parse(id)),
    ),
  });
  validatePassengerTransitCollections({
    tick: parseSimulationTick(parsed.processedThroughTick),
    demandPlan: parsedPlan,
    waitingCohorts: parsed.waitingCohorts as PassengerWaitingCohort[],
    waitingGenerationLineageWatermarks:
      parsed.waitingGenerationLineageWatermarks as WaitingGenerationLineageWatermark[],
    onboardGroups: parsed.onboardGroups as PassengerOnboardGroup[],
    destinationAccessGroups:
      parsed.destinationAccessGroups as PassengerDestinationAccessGroup[],
    nextPassengerWaitingCohortSequence:
      parsed.nextPassengerWaitingCohortSequence,
    nextPassengerOnboardGroupSequence: parsed.nextPassengerOnboardGroupSequence,
    nextPassengerDestinationAccessGroupSequence:
      parsed.nextPassengerDestinationAccessGroupSequence,
    itineraryIsValid: (cohort) => {
      const itinerary = itineraryIndex.find(
        cohort.originStopPlaceId,
        cohort.destinationStopPlaceId,
      );
      return (
        itinerary !== undefined &&
        passengerWaitingCohortMatchesItinerary(cohort, itinerary)
      );
    },
  });
  const awaitingDestination = arrived;
  const onboardPassengerCount = parsed.onboardGroups.reduce(
    (total, group) => checkedAdd(total, group.count, 'onboard passengers'),
    0,
  );
  const destinationAccessPassengerCount = parsed.destinationAccessGroups.reduce(
    (total, group) =>
      checkedAdd(total, group.count, 'destination access passengers'),
    0,
  );
  if (
    parsed.totalEmittedPassengerCount !==
      checkedAdd(
        parsed.servedEmittedPassengerCount,
        parsed.unservedAtSourcePassengerCount,
        'emitted passengers',
      ) ||
    parsed.servedEmittedPassengerCount !==
      checkedAdd(
        parsed.totalArrivedAtStopPassengerCount,
        inAccess,
        'served passengers',
      ) ||
    parsed.totalArrivedAtStopPassengerCount !==
      checkedAdd(
        checkedAdd(
          parsed.destinationUnavailableAtStopPassengerCount,
          parsed.directItineraryUnavailablePassengerCount,
          'unavailable itinerary passengers',
        ),
        checkedAdd(
          checkedAdd(
            checkedAdd(
              parsed.totalWaitingForVehiclePassengerCount,
              parsed.totalOnboardPassengerCount,
              'waiting and onboard passengers',
            ),
            checkedAdd(
              parsed.totalInDestinationAccessPassengerCount,
              parsed.totalCompletedJourneyPassengerCount,
              'destination access and completed passengers',
            ),
            'passenger transit ownership',
          ),
          awaitingDestination,
          'waiting passengers',
        ),
        'arrived passengers',
      ) ||
    parsed.totalDestinationAssignedPassengerCount !==
      checkedAdd(
        parsed.directItineraryUnavailablePassengerCount,
        checkedAdd(
          parsed.totalWaitingForVehiclePassengerCount,
          checkedAdd(
            parsed.totalOnboardPassengerCount,
            checkedAdd(
              parsed.totalInDestinationAccessPassengerCount,
              parsed.totalCompletedJourneyPassengerCount,
              'assigned destination ownership',
            ),
            'assigned onboard and destination passengers',
          ),
          'assigned waiting and transit passengers',
        ),
        'destination-assigned passengers',
      ) ||
    parsed.totalWaitingForVehiclePassengerCount !==
      waitingAuthority.totalWaitingForVehiclePassengerCount ||
    parsed.totalOnboardPassengerCount !== onboardPassengerCount ||
    parsed.totalInDestinationAccessPassengerCount !==
      destinationAccessPassengerCount ||
    parsed.totalBoardedPassengerCount !==
      checkedAdd(
        parsed.totalOnboardPassengerCount,
        checkedAdd(
          parsed.totalInDestinationAccessPassengerCount,
          parsed.totalCompletedJourneyPassengerCount,
          'boarded destination ownership',
        ),
        'boarded passenger ownership',
      ) ||
    parsed.totalAlightedPassengerCount !==
      checkedAdd(
        parsed.totalInDestinationAccessPassengerCount,
        parsed.totalCompletedJourneyPassengerCount,
        'alighted passenger ownership',
      ) ||
    parsed.destinationUnavailableAtStopPassengerCount >
      parsed.totalArrivedAtStopPassengerCount
  )
    throw new Error('Passenger demand conservation failed.');
  return deepFreeze({
    ...parsed,
    processedThroughTick: parseSimulationTick(parsed.processedThroughTick),
    demandPlanCoordinate:
      parsed.demandPlanCoordinate as ActivePassengerDemandState['demandPlanCoordinate'],
    cellCredits: parsed.cellCredits as PassengerCellCreditState[],
    accessingGroups: parsed.accessingGroups as AccessingPassengerGroup[],
    stopArrivals: parsed.stopArrivals as StopPlaceArrivalState[],
    destinationCursors:
      parsed.destinationCursors as PassengerDestinationCursorState[],
    waitingCohorts: parsed.waitingCohorts as PassengerWaitingCohort[],
    waitingGenerationLineageWatermarks:
      parsed.waitingGenerationLineageWatermarks as WaitingGenerationLineageWatermark[],
    onboardGroups: parsed.onboardGroups as PassengerOnboardGroup[],
    destinationAccessGroups:
      parsed.destinationAccessGroups as PassengerDestinationAccessGroup[],
  });
}

const advancePassengerDemand = (
  plan: PassengerDemandPlanV1,
  itineraryIndex: PassengerDirectItineraryRuntimeIndex,
  state: ActivePassengerDemandState,
  targetTickValue: number,
  trusted: boolean,
  arrivalEvents?: PassengerOriginStopArrivalEvent[],
  scheduled?: Readonly<{
    emissions: readonly Readonly<{ cellIndex: number; count: number }>[];
    materializeCellCredits: () => readonly PassengerCellCreditState[];
  }>,
  observer?: PassengerRuntimePhaseObserver,
): ActivePassengerDemandState => {
  const parsedPlan = trusted ? plan : parsePassengerDemandPlan(plan);
  let current = trusted
    ? state
    : validatePassengerDemandState(parsedPlan, itineraryIndex, state);
  const runtimeIndex = passengerDemandRuntimeIndex(parsedPlan);
  const targetTick = parseSimulationTick(targetTickValue);
  if (targetTick < current.processedThroughTick)
    throw new Error('Passenger demand cannot advance backwards.');
  if (targetTick === current.processedThroughTick) return state;
  for (
    let tickValue = current.processedThroughTick + 1;
    tickValue <= targetTick;
    tickValue += 1
  ) {
    const tick = parseSimulationTick(tickValue);
    let nextSequence = current.nextPassengerGroupSequence;
    let nextJourneySequence = 1;
    let totalEmitted = current.totalEmittedPassengerCount;
    let servedEmitted = current.servedEmittedPassengerCount;
    let unserved = current.unservedAtSourcePassengerCount;
    let destinationAssigned = current.totalDestinationAssignedPassengerCount;
    let destinationUnavailable =
      current.destinationUnavailableAtStopPassengerCount;
    const groups: AccessingPassengerGroup[] = [...current.accessingGroups];
    const emit = (cell: PassengerDemandPlanCell, count: number) => {
      if (count === 0) return;
      totalEmitted = checkedAdd(totalEmitted, count, 'total emissions');
      if (cell.assignedStopPlaceId === null) {
        unserved = checkedAdd(unserved, count, 'unserved emissions');
        return;
      }
      servedEmitted = checkedAdd(servedEmitted, count, 'served emissions');
      const duration = calculatePassengerAccessTicks(
        cell.distanceSquaredCells!,
        parsedPlan.catchmentPolicy.maxAccessDistanceCells,
        parsedPlan.accessPolicy.accessTicksPerCell,
      );
      groups.push({
        passengerGroupId: passengerGroupIdSchema.parse(
          `passenger-group-${nextSequence}`,
        ),
        cellId: cell.cellId,
        targetStopPlaceId: cell.assignedStopPlaceId,
        count,
        spawnTick: tick,
        arrivalTick: parseSimulationTick(
          checkedAdd(tick, duration, 'passenger arrival tick'),
        ),
      });
      nextSequence = checkedAdd(nextSequence, 1, 'passenger group sequence');
    };
    const cellCredits = scheduled
      ? undefined
      : parsedPlan.cells.map((cell, index) => {
          const added = checkedMultiply(
            cell.populationWeight,
            parsedPlan.emissionPolicy.emissionCreditsPerWeightPerTick,
            'emission credit',
          );
          const accumulated = checkedAdd(
            current.cellCredits[index]!.credit,
            added,
            'emission credit',
          );
          const emitted = Math.floor(
            accumulated / parsedPlan.emissionPolicy.creditsPerPassenger,
          );
          const credit =
            accumulated % parsedPlan.emissionPolicy.creditsPerPassenger;
          emit(cell, emitted);
          return { cellId: cell.cellId, credit };
        });
    if (scheduled)
      for (const { cellIndex, count } of scheduled.emissions)
        emit(parsedPlan.cells[cellIndex]!, count);
    observer?.(1);
    const arrivals = new Map(
      current.stopArrivals.map((stop) => [
        stop.stopPlaceId,
        stop.awaitingDestinationCount,
      ]),
    );
    let arrivedTotal = current.totalArrivedAtStopPassengerCount;
    const arrivedByStopPlace = new Map<StopPlaceId, number>();
    const accessingGroups: AccessingPassengerGroup[] = [];
    for (const group of groups)
      if (group.arrivalTick <= tick) {
        arrivedByStopPlace.set(
          group.targetStopPlaceId,
          checkedAdd(
            arrivedByStopPlace.get(group.targetStopPlaceId) ?? 0,
            group.count,
            `arrival evidence at ${group.targetStopPlaceId}`,
          ),
        );
        arrivals.set(
          group.targetStopPlaceId,
          checkedAdd(
            arrivals.get(group.targetStopPlaceId)!,
            group.count,
            `arrivals at ${group.targetStopPlaceId}`,
          ),
        );
        arrivedTotal = checkedAdd(
          arrivedTotal,
          group.count,
          'arrived passengers',
        );
      } else accessingGroups.push(group);
    if (arrivalEvents)
      for (const [stopPlaceId, arrivedPassengerCount] of [
        ...arrivedByStopPlace,
      ].sort(([left], [right]) => left.localeCompare(right)))
        arrivalEvents.push(
          freezeTrustedAuthority({ tick, stopPlaceId, arrivedPassengerCount }),
        );
    observer?.(2);
    const destinationCursors = new Map(
      current.destinationCursors.map((cursor) => [
        cursor.stopPlaceId,
        cursor.destinationCursor,
      ]),
    );
    const destinationGroups: DestinationAssignedPassengerGroup[] = [];
    for (const stop of parsedPlan.stops) {
      const waiting = arrivals.get(stop.stopPlaceId)!;
      if (waiting === 0) continue;
      const eligibleWeight =
        runtimeIndex.totalServedDestinationWeight -
        runtimeIndex.assignedWeightByStopPlace.get(stop.stopPlaceId)!;
      if (eligibleWeight === 0) {
        destinationUnavailable = checkedAdd(
          destinationUnavailable,
          waiting,
          'destination-unavailable passengers',
        );
        arrivals.set(stop.stopPlaceId, 0);
        continue;
      }
      const allocation = allocateTrustedPassengerDestinations(
        runtimeIndex,
        stop.stopPlaceId,
        destinationCursors.get(stop.stopPlaceId)!,
        waiting,
      );
      destinationCursors.set(stop.stopPlaceId, allocation.nextCursor);
      for (const candidate of allocation.allocations) {
        destinationGroups.push({
          passengerJourneyGroupId: passengerJourneyGroupIdSchema.parse(
            `passenger-journey-group-${nextJourneySequence}`,
          ),
          originStopPlaceId: stop.stopPlaceId,
          destinationCellId: candidate.cellId,
          destinationStopPlaceId: candidate.destinationStopPlaceId,
          count: candidate.count,
          firstAssignedTick: tick,
          lastAssignedTick: tick,
        });
        nextJourneySequence = checkedAdd(
          nextJourneySequence,
          1,
          'passenger journey group sequence',
        );
      }
      destinationAssigned = checkedAdd(
        destinationAssigned,
        waiting,
        'destination-assigned passengers',
      );
      arrivals.set(stop.stopPlaceId, 0);
    }
    observer?.(
      7,
      destinationGroups.length,
      destinationAssigned - current.totalDestinationAssignedPassengerCount,
    );
    const activation = activateTrustedPassengerDirectItineraries({
      itineraryIndex,
      demandRuntimeIndex: runtimeIndex,
      destinationAssignedGroups: destinationGroups,
      waitingCohorts: current.waitingCohorts,
      nextPassengerWaitingCohortSequence:
        current.nextPassengerWaitingCohortSequence,
      directItineraryUnavailablePassengerCount:
        current.directItineraryUnavailablePassengerCount,
      activationTick: tick,
      nonMergeableWaitingCohortIds: new Set([
        ...current.onboardGroups.map((group) => group.sourceWaitingCohortId),
        ...current.waitingGenerationLineageWatermarks.map(
          (watermark) => watermark.passengerWaitingCohortId,
        ),
      ]),
      ...(observer ? { observer } : {}),
    });
    observer?.(8);
    const orderedAccessingGroups = accessingGroups.sort(compareGroups);
    observer?.(13, orderedAccessingGroups.length);
    let changedStopArrivals: StopPlaceArrivalState[] | undefined;
    let changedDestinationCursors:
      PassengerDestinationCursorState[] | undefined;
    for (let index = 0; index < parsedPlan.stops.length; index += 1) {
      const stop = parsedPlan.stops[index]!;
      const priorArrival = current.stopArrivals[index]!;
      const awaitingDestinationCount = arrivals.get(stop.stopPlaceId)!;
      if (priorArrival.awaitingDestinationCount !== awaitingDestinationCount) {
        changedStopArrivals ??= [...current.stopArrivals];
        changedStopArrivals[index] = freezeTrustedAuthority({
          stopPlaceId: stop.stopPlaceId,
          awaitingDestinationCount,
        });
      }
      const priorCursor = current.destinationCursors[index]!;
      const destinationCursor = destinationCursors.get(stop.stopPlaceId)!;
      if (priorCursor.destinationCursor !== destinationCursor) {
        changedDestinationCursors ??= [...current.destinationCursors];
        changedDestinationCursors[index] = freezeTrustedAuthority({
          stopPlaceId: stop.stopPlaceId,
          destinationCursor,
        });
      }
    }
    const nextStopArrivals = changedStopArrivals
      ? Object.freeze(changedStopArrivals)
      : current.stopArrivals;
    const nextDestinationCursors = changedDestinationCursors
      ? Object.freeze(changedDestinationCursors)
      : current.destinationCursors;
    observer?.(14, parsedPlan.stops.length);
    const next: ActivePassengerDemandState = {
      status: 'active',
      demandPlanCoordinate: current.demandPlanCoordinate,
      processedThroughTick: tick,
      nextPassengerGroupSequence: nextSequence,
      nextPassengerWaitingCohortSequence:
        activation.nextPassengerWaitingCohortSequence,
      nextPassengerOnboardGroupSequence:
        current.nextPassengerOnboardGroupSequence,
      nextPassengerDestinationAccessGroupSequence:
        current.nextPassengerDestinationAccessGroupSequence,
      cellCredits: cellCredits ?? [],
      accessingGroups: orderedAccessingGroups,
      stopArrivals: nextStopArrivals,
      destinationCursors: nextDestinationCursors,
      waitingCohorts: activation.waitingCohorts,
      waitingGenerationLineageWatermarks:
        current.waitingGenerationLineageWatermarks,
      onboardGroups: current.onboardGroups,
      destinationAccessGroups: current.destinationAccessGroups,
      totalEmittedPassengerCount: totalEmitted,
      servedEmittedPassengerCount: servedEmitted,
      unservedAtSourcePassengerCount: unserved,
      totalArrivedAtStopPassengerCount: arrivedTotal,
      totalDestinationAssignedPassengerCount: destinationAssigned,
      destinationUnavailableAtStopPassengerCount: destinationUnavailable,
      directItineraryUnavailablePassengerCount:
        activation.directItineraryUnavailablePassengerCount,
      totalWaitingForVehiclePassengerCount:
        activation.totalWaitingForVehiclePassengerCount,
      totalBoardedPassengerCount: current.totalBoardedPassengerCount,
      totalOnboardPassengerCount: current.totalOnboardPassengerCount,
      totalAlightedPassengerCount: current.totalAlightedPassengerCount,
      totalInDestinationAccessPassengerCount:
        current.totalInDestinationAccessPassengerCount,
      totalCompletedJourneyPassengerCount:
        current.totalCompletedJourneyPassengerCount,
    };
    if (scheduled) {
      Object.defineProperty(next, 'cellCredits', {
        enumerable: true,
        configurable: false,
        get: scheduled.materializeCellCredits,
      });
    }
    current = trusted
      ? freezeTrustedAuthority(next)
      : validatePassengerDemandState(parsedPlan, itineraryIndex, next);
    observer?.(15);
    observer?.(3);
  }
  return current;
};

export function advanceTrustedPassengerDemandToTickWithScheduledEmissions(
  plan: PassengerDemandPlanV1,
  itineraryIndex: PassengerDirectItineraryRuntimeIndex,
  state: ActivePassengerDemandState,
  targetTickValue: number,
  emissions: readonly Readonly<{ cellIndex: number; count: number }>[],
  materializeCellCredits: () => readonly PassengerCellCreditState[],
  arrivalEvents?: PassengerOriginStopArrivalEvent[],
  observer?: PassengerRuntimePhaseObserver,
): ActivePassengerDemandState {
  return advancePassengerDemand(
    plan,
    itineraryIndex,
    state,
    targetTickValue,
    true,
    arrivalEvents,
    {
      emissions,
      materializeCellCredits,
    },
    observer,
  );
}

export function replaceTrustedPassengerDemandFields(
  state: ActivePassengerDemandState,
  fields: Partial<ActivePassengerDemandState>,
): ActivePassengerDemandState {
  const descriptors = Object.getOwnPropertyDescriptors(state);
  for (const key of Object.keys(fields)) delete descriptors[key];
  const next = {} as ActivePassengerDemandState;
  Object.defineProperties(next, descriptors);
  Object.assign(next, fields);
  return freezeTrustedAuthority(next);
}

export function advancePassengerDemandToTick(
  plan: PassengerDemandPlanV1,
  itineraryIndex: PassengerDirectItineraryRuntimeIndex,
  state: ActivePassengerDemandState,
  targetTickValue: number,
): ActivePassengerDemandState {
  return advancePassengerDemand(
    plan,
    itineraryIndex,
    state,
    targetTickValue,
    false,
  );
}

export function advancePassengerDemandToTickWithEvents(
  plan: PassengerDemandPlanV1,
  itineraryIndex: PassengerDirectItineraryRuntimeIndex,
  state: ActivePassengerDemandState,
  targetTickValue: number,
): PassengerDemandAdvancementResult {
  const events: PassengerOriginStopArrivalEvent[] = [];
  const next = advancePassengerDemand(
    plan,
    itineraryIndex,
    state,
    targetTickValue,
    false,
    events,
  );
  return deepFreeze({
    state: next,
    passengerOriginStopArrivalEvents: events,
  });
}

export function advanceTrustedPassengerDemandToTick(
  plan: PassengerDemandPlanV1,
  itineraryIndex: PassengerDirectItineraryRuntimeIndex,
  state: ActivePassengerDemandState,
  targetTickValue: number,
): ActivePassengerDemandState {
  return advancePassengerDemand(
    plan,
    itineraryIndex,
    state,
    targetTickValue,
    true,
  );
}

export function parsePassengerDemandProjection(
  value: unknown,
): PassengerDemandProjection {
  const parsed = projectionSchema.parse(value);
  return deepFreeze(
    parsed.status === 'disabled'
      ? parsed
      : {
          ...parsed,
          processedThroughTick: parseSimulationTick(
            parsed.processedThroughTick,
          ),
          demandPlanCoordinate:
            parsed.demandPlanCoordinate as ActivePassengerDemandState['demandPlanCoordinate'],
          stopArrivals: parsed.stopArrivals as StopPlaceArrivalState[],
          waitingCohorts: parsed.waitingCohorts as PassengerWaitingCohort[],
          onboardGroups: parsed.onboardGroups as PassengerOnboardGroup[],
          destinationAccessGroups:
            parsed.destinationAccessGroups as PassengerDestinationAccessGroup[],
        },
  );
}

export function projectPassengerDemand(
  state: PassengerDemandState,
): PassengerDemandProjection {
  if (state.status === 'disabled')
    return parsePassengerDemandProjection({ status: 'disabled' });
  const inAccessPassengerCount = state.accessingGroups.reduce(
    (total, group) =>
      checkedAdd(total, group.count, 'projected in-access passengers'),
    0,
  );
  const totalAwaitingDestinationCount = state.stopArrivals.reduce(
    (total, stop) =>
      checkedAdd(
        total,
        stop.awaitingDestinationCount,
        'projected awaiting-destination passengers',
      ),
    0,
  );
  return parsePassengerDemandProjection({
    status: 'active' as const,
    demandPlanCoordinate: state.demandPlanCoordinate,
    processedThroughTick: state.processedThroughTick,
    totalEmittedPassengerCount: state.totalEmittedPassengerCount,
    unservedAtSourcePassengerCount: state.unservedAtSourcePassengerCount,
    inAccessPassengerCount,
    accessingGroupCount: state.accessingGroups.length,
    totalAwaitingDestinationCount,
    totalDestinationAssignedPassengerCount:
      state.totalDestinationAssignedPassengerCount,
    destinationUnavailableAtStopPassengerCount:
      state.destinationUnavailableAtStopPassengerCount,
    directItineraryUnavailablePassengerCount:
      state.directItineraryUnavailablePassengerCount,
    totalWaitingForVehiclePassengerCount:
      state.totalWaitingForVehiclePassengerCount,
    waitingCohortCount: state.waitingCohorts.length,
    waitingCohorts: state.waitingCohorts,
    totalBoardedPassengerCount: state.totalBoardedPassengerCount,
    totalOnboardPassengerCount: state.totalOnboardPassengerCount,
    totalAlightedPassengerCount: state.totalAlightedPassengerCount,
    totalInDestinationAccessPassengerCount:
      state.totalInDestinationAccessPassengerCount,
    totalCompletedJourneyPassengerCount:
      state.totalCompletedJourneyPassengerCount,
    onboardGroupCount: state.onboardGroups.length,
    onboardGroups: state.onboardGroups,
    destinationAccessGroupCount: state.destinationAccessGroups.length,
    destinationAccessGroups: state.destinationAccessGroups,
    stopArrivals: state.stopArrivals,
  });
}
