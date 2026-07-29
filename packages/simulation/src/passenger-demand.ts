import { z } from 'zod';
import type {
  CityId,
  CityPopulationCellId,
  StopCatchmentResult,
  StopPlaceId,
} from '@torrevieja-tycoon/transport-domain';
import { parseSimulationTick, type SimulationTick } from './time.js';
import type { ScenarioCoordinate } from './transport-simulation.js';

export const passengerDemandPlanSchemaVersion = '1.0.0' as const;
const distanceTieToleranceSquaredCells = 1e-9;

const positiveSafeInteger = z.number().int().positive().safe();
const nonnegativeSafeInteger = z.number().int().nonnegative().safe();
const demandModelHashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .brand<'PassengerDemandModelHash'>();
const passengerGroupIdSchema = z
  .string()
  .regex(/^passenger-group-[1-9]\d*$/)
  .brand<'PassengerGroupId'>();
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
  readonly cellCredits: readonly Readonly<PassengerCellCreditState>[];
  readonly accessingGroups: readonly Readonly<AccessingPassengerGroup>[];
  readonly stopArrivals: readonly Readonly<StopPlaceArrivalState>[];
  readonly totalEmittedPassengerCount: number;
  readonly servedEmittedPassengerCount: number;
  readonly unservedAtSourcePassengerCount: number;
  readonly totalArrivedAtStopPassengerCount: number;
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
    totalEmittedPassengerCount: nonnegativeSafeInteger,
    servedEmittedPassengerCount: nonnegativeSafeInteger,
    unservedAtSourcePassengerCount: nonnegativeSafeInteger,
    totalArrivedAtStopPassengerCount: nonnegativeSafeInteger,
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
      readonly stopArrivals: readonly Readonly<StopPlaceArrivalState>[];
    }
>;

const deepFreeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
};

const checkedAdd = (left: number, right: number, context: string) => {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error(`${context} overflow.`);
  return result;
};

const checkedMultiply = (left: number, right: number, context: string) => {
  const result = left * right;
  if (!Number.isSafeInteger(result)) throw new Error(`${context} overflow.`);
  return result;
};

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
  });
}

export function createInitialPassengerDemandState(
  plan: PassengerDemandPlanV1,
  initialTick: number,
): ActivePassengerDemandState {
  const parsedPlan = parsePassengerDemandPlan(plan);
  return deepFreeze({
    status: 'active',
    demandPlanCoordinate: planCoordinate(parsedPlan),
    processedThroughTick: parseSimulationTick(initialTick),
    nextPassengerGroupSequence: 1,
    cellCredits: parsedPlan.cells.map((cell) => ({
      cellId: cell.cellId,
      credit: 0,
    })),
    accessingGroups: [],
    stopArrivals: parsedPlan.stops.map((stop) => ({
      stopPlaceId: stop.stopPlaceId,
      awaitingDestinationCount: 0,
    })),
    totalEmittedPassengerCount: 0,
    servedEmittedPassengerCount: 0,
    unservedAtSourcePassengerCount: 0,
    totalArrivedAtStopPassengerCount: 0,
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

const compareGroups = (
  left: Readonly<AccessingPassengerGroup>,
  right: Readonly<AccessingPassengerGroup>,
) =>
  left.arrivalTick - right.arrivalTick ||
  (left.passengerGroupId < right.passengerGroupId ? -1 : 1);

export function validatePassengerDemandState(
  plan: PassengerDemandPlanV1,
  value: unknown,
): ActivePassengerDemandState {
  const parsedPlan = parsePassengerDemandPlan(plan);
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
        arrival.stopPlaceId !== parsedPlan.stops[index]!.stopPlaceId,
    )
  )
    throw new Error('Passenger StopPlace arrivals are inconsistent.');
  const cells = new Map(parsedPlan.cells.map((cell) => [cell.cellId, cell]));
  const groupIds = new Set<string>();
  let inAccess = 0;
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
    parsed.totalArrivedAtStopPassengerCount !== arrived
  )
    throw new Error('Passenger demand conservation failed.');
  return deepFreeze({
    ...parsed,
    processedThroughTick: parseSimulationTick(parsed.processedThroughTick),
    demandPlanCoordinate:
      parsed.demandPlanCoordinate as ActivePassengerDemandState['demandPlanCoordinate'],
    cellCredits: parsed.cellCredits as PassengerCellCreditState[],
    accessingGroups: (
      [...parsed.accessingGroups] as AccessingPassengerGroup[]
    ).sort(compareGroups),
    stopArrivals: parsed.stopArrivals as StopPlaceArrivalState[],
  });
}

export function advancePassengerDemandToTick(
  plan: PassengerDemandPlanV1,
  state: ActivePassengerDemandState,
  targetTickValue: number,
): ActivePassengerDemandState {
  const parsedPlan = parsePassengerDemandPlan(plan);
  let current = validatePassengerDemandState(parsedPlan, state);
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
    let totalEmitted = current.totalEmittedPassengerCount;
    let servedEmitted = current.servedEmittedPassengerCount;
    let unserved = current.unservedAtSourcePassengerCount;
    const groups: AccessingPassengerGroup[] = [...current.accessingGroups];
    const cellCredits = parsedPlan.cells.map((cell, index) => {
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
      if (emitted > 0) {
        totalEmitted = checkedAdd(totalEmitted, emitted, 'total emissions');
        if (cell.assignedStopPlaceId === null)
          unserved = checkedAdd(unserved, emitted, 'unserved emissions');
        else {
          servedEmitted = checkedAdd(
            servedEmitted,
            emitted,
            'served emissions',
          );
          const distance = cell.distanceSquaredCells!;
          const band = distanceBand(
            distance,
            parsedPlan.catchmentPolicy.maxAccessDistanceCells,
          );
          const duration = checkedMultiply(
            band,
            parsedPlan.accessPolicy.accessTicksPerCell,
            'access duration',
          );
          groups.push({
            passengerGroupId: passengerGroupIdSchema.parse(
              `passenger-group-${nextSequence}`,
            ),
            cellId: cell.cellId,
            targetStopPlaceId: cell.assignedStopPlaceId,
            count: emitted,
            spawnTick: tick,
            arrivalTick: parseSimulationTick(
              checkedAdd(tick, duration, 'passenger arrival tick'),
            ),
          });
          nextSequence = checkedAdd(
            nextSequence,
            1,
            'passenger group sequence',
          );
        }
      }
      return { cellId: cell.cellId, credit };
    });
    const arrivals = new Map(
      current.stopArrivals.map((stop) => [
        stop.stopPlaceId,
        stop.awaitingDestinationCount,
      ]),
    );
    let arrivedTotal = current.totalArrivedAtStopPassengerCount;
    const accessingGroups: AccessingPassengerGroup[] = [];
    for (const group of groups)
      if (group.arrivalTick <= tick) {
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
    current = validatePassengerDemandState(parsedPlan, {
      status: 'active',
      demandPlanCoordinate: current.demandPlanCoordinate,
      processedThroughTick: tick,
      nextPassengerGroupSequence: nextSequence,
      cellCredits,
      accessingGroups: accessingGroups.sort(compareGroups),
      stopArrivals: parsedPlan.stops.map((stop) => ({
        stopPlaceId: stop.stopPlaceId,
        awaitingDestinationCount: arrivals.get(stop.stopPlaceId)!,
      })),
      totalEmittedPassengerCount: totalEmitted,
      servedEmittedPassengerCount: servedEmitted,
      unservedAtSourcePassengerCount: unserved,
      totalArrivedAtStopPassengerCount: arrivedTotal,
    });
  }
  return current;
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
  return parsePassengerDemandProjection({
    status: 'active' as const,
    demandPlanCoordinate: state.demandPlanCoordinate,
    processedThroughTick: state.processedThroughTick,
    totalEmittedPassengerCount: state.totalEmittedPassengerCount,
    unservedAtSourcePassengerCount: state.unservedAtSourcePassengerCount,
    inAccessPassengerCount,
    accessingGroupCount: state.accessingGroups.length,
    totalAwaitingDestinationCount: state.totalArrivedAtStopPassengerCount,
    stopArrivals: state.stopArrivals,
  });
}
