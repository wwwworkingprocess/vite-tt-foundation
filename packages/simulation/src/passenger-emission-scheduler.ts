import {
  checkedAdd,
  checkedMultiply,
  freezeTrustedAuthority,
} from './authority-utils.js';
import {
  addModulo,
  multiplyModulo,
} from './passenger-destination-permutation.js';
import type {
  ActivePassengerDemandState,
  PassengerDemandPlanV1,
} from './passenger-demand.js';
import type { SimulationTick } from './time.js';

export const DEFAULT_PASSENGER_EMISSION_WORK_WINDOW_TICKS = 12;

const parseWorkWindow = (value: number) => {
  if (!Number.isInteger(value) || value < 1 || value > 12)
    throw new Error('Invalid work span.');
  return value;
};

export interface TransportSimulationRuntimeTuning {
  readonly passengerEmissionWorkWindowTicks: number;
}

export const defaultTransportSimulationRuntimeTuning = Object.freeze({
  passengerEmissionWorkWindowTicks:
    DEFAULT_PASSENGER_EMISSION_WORK_WINDOW_TICKS,
});

export function parseTransportSimulationRuntimeTuning(
  value: unknown,
): Readonly<TransportSimulationRuntimeTuning> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !('passengerEmissionWorkWindowTicks' in value)
  )
    throw new Error('Invalid work span.');
  return Object.freeze({
    passengerEmissionWorkWindowTicks: parseWorkWindow(
      (value as TransportSimulationRuntimeTuning)
        .passengerEmissionWorkWindowTicks,
    ),
  });
}

export interface ScheduledPassengerEmission {
  readonly cellIndex: number;
  readonly count: number;
}

export type PassengerEmissionBucket = readonly [
  tick: number,
  emissions: readonly ScheduledPassengerEmission[],
];

export interface PassengerEmissionScheduler {
  readonly workWindowTicks: number;
  readonly seedTick: SimulationTick;
  readonly seedCredits: readonly number[];
  readonly buckets: readonly PassengerEmissionBucket[];
}

const rateFor = (plan: PassengerDemandPlanV1, cellIndex: number) =>
  checkedMultiply(
    plan.cells[cellIndex]!.populationWeight,
    plan.emissionPolicy.emissionCreditsPerWeightPerTick,
    'emission',
  );

const creditAt = (
  plan: PassengerDemandPlanV1,
  scheduler: PassengerEmissionScheduler,
  cellIndex: number,
  tick: number,
) => {
  const divisor = plan.emissionPolicy.creditsPerPassenger;
  const elapsed = tick - scheduler.seedTick;
  const delta = multiplyModulo(
    rateFor(plan, cellIndex) % divisor,
    elapsed % divisor,
    divisor,
  );
  return addModulo(scheduler.seedCredits[cellIndex]!, delta, divisor);
};

const scheduleCellSpan = (
  plan: PassengerDemandPlanV1,
  scheduler: PassengerEmissionScheduler,
  cellIndex: number,
  firstTick: number,
  buckets: Map<number, ScheduledPassengerEmission[]>,
  spanTicks = scheduler.workWindowTicks,
  startingCredit?: number,
  startingRate?: number,
) => {
  const rate = startingRate ?? rateFor(plan, cellIndex);
  const divisor = plan.emissionPolicy.creditsPerPassenger;
  let credit =
    startingCredit ?? creditAt(plan, scheduler, cellIndex, firstTick - 1);
  const endTick = checkedAdd(firstTick, spanTicks, 'emission tick');
  if (rate < divisor) {
    let tick = firstTick;
    while (tick < endTick) {
      const offset = Math.floor((divisor - credit - 1) / rate) + 1;
      const emissionTick = checkedAdd(tick, offset - 1, 'emission tick');
      if (emissionTick >= endTick) return;
      credit = addModulo(
        credit,
        multiplyModulo(rate, offset, divisor),
        divisor,
      );
      const records = buckets.get(emissionTick) ?? [];
      records.push({ cellIndex, count: 1 });
      buckets.set(emissionTick, records);
      tick = checkedAdd(emissionTick, 1, 'emission tick');
    }
    return;
  }
  for (let tick = firstTick; tick < endTick; tick += 1) {
    const accumulated = checkedAdd(credit, rate, 'emission');
    const count = Math.floor(accumulated / divisor);
    credit = accumulated % divisor;
    const records = buckets.get(tick) ?? [];
    records.push({ cellIndex, count });
    buckets.set(tick, records);
  }
};

const freezeBuckets = (buckets: Map<number, ScheduledPassengerEmission[]>) =>
  freezeTrustedAuthority([...buckets]);

export function createPassengerEmissionScheduler(
  plan: PassengerDemandPlanV1,
  state: ActivePassengerDemandState,
  workWindowTicks: number,
): PassengerEmissionScheduler {
  const validatedWindow = parseWorkWindow(workWindowTicks);
  const seed = {
    workWindowTicks: validatedWindow,
    seedTick: state.processedThroughTick,
    seedCredits: state.cellCredits.map(({ credit }) => credit),
    buckets: [],
  } satisfies PassengerEmissionScheduler;
  const buckets = new Map<number, ScheduledPassengerEmission[]>();
  for (let index = 0; index < plan.cells.length; index += 1)
    scheduleCellSpan(
      plan,
      seed,
      index,
      state.processedThroughTick + 1,
      buckets,
      validatedWindow + (index % validatedWindow),
      state.cellCredits[index]!.credit,
      rateFor(plan, index),
    );
  return freezeTrustedAuthority({
    ...seed,
    buckets: freezeBuckets(buckets),
  });
}

export function advancePassengerEmissionScheduler(
  plan: PassengerDemandPlanV1,
  scheduler: PassengerEmissionScheduler,
  tick: SimulationTick,
): Readonly<{
  scheduler: PassengerEmissionScheduler;
  emissions: readonly ScheduledPassengerEmission[];
}> {
  const due = scheduler.buckets.find((bucket) => bucket[0] === tick);
  const additions = new Map<number, ScheduledPassengerEmission[]>();
  const shard = (tick - scheduler.seedTick - 1) % scheduler.workWindowTicks;
  for (
    let index = shard;
    index < plan.cells.length;
    index += scheduler.workWindowTicks
  ) {
    scheduleCellSpan(
      plan,
      scheduler,
      index,
      checkedAdd(tick, scheduler.workWindowTicks, 'emission tick'),
      additions,
    );
  }
  const addedBuckets = freezeBuckets(additions);
  const addedByTick = new Map(
    addedBuckets.map((bucket) => [bucket[0], bucket]),
  );
  const buckets = scheduler.buckets
    .filter((bucket) => bucket !== due)
    .map((bucket) => {
      const added = addedByTick.get(bucket[0]);
      if (!added) return bucket;
      addedByTick.delete(bucket[0]);
      return [bucket[0], [...bucket[1], ...added[1]]] as const;
    });
  buckets.push(...addedByTick.values());
  const emissions = Object.freeze(
    [...(due?.[1] ?? [])].sort(
      (left, right) => left.cellIndex - right.cellIndex,
    ),
  );
  return freezeTrustedAuthority({
    emissions,
    scheduler: {
      ...scheduler,
      buckets,
    },
  });
}

export function materializePassengerCellCredits(
  plan: PassengerDemandPlanV1,
  scheduler: PassengerEmissionScheduler,
  tick: number,
) {
  return Object.freeze(
    plan.cells.map((cell, index) =>
      Object.freeze({
        cellId: cell.cellId,
        credit: creditAt(plan, scheduler, index, tick),
      }),
    ),
  );
}
