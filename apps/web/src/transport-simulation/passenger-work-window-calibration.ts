import {
  DEFAULT_PASSENGER_EMISSION_WORK_WINDOW_TICKS,
  advancePassengerEmissionScheduler,
  createPassengerEmissionScheduler,
  parseSimulationTick,
  type ActivePassengerDemandState,
  type PassengerDemandPlanV1,
} from '@torrevieja-tycoon/simulation';

export const passengerWorkWindowCalibrationBudgetMilliseconds = 250;
const materialImprovementRatio = 0.95;
const effectiveTieRatio = 1.05;
const calibrationBatchTicks = 48;
const candidates = Object.freeze([
  DEFAULT_PASSENGER_EMISSION_WORK_WINDOW_TICKS,
  ...Array.from({ length: 12 }, (_, index) => 12 - index),
]);

export interface PassengerWorkWindowMeasurement {
  readonly workWindowTicks: number;
  readonly elapsedMilliseconds: number;
}

export interface PassengerWorkWindowCalibrationResult {
  readonly selectedWorkWindowTicks: number;
  readonly measuredCandidateCount: number;
  readonly elapsedMilliseconds: number;
  readonly fallbackUsed: boolean;
}

export function selectPassengerEmissionWorkWindow(
  measurements: readonly PassengerWorkWindowMeasurement[],
): number {
  const valid = measurements.filter(
    ({ workWindowTicks, elapsedMilliseconds }) =>
      Number.isInteger(workWindowTicks) &&
      workWindowTicks >= 1 &&
      workWindowTicks <= 12 &&
      Number.isFinite(elapsedMilliseconds) &&
      elapsedMilliseconds >= 0,
  );
  const baselineElapsed = Math.min(
    ...valid
      .filter(
        ({ workWindowTicks }) =>
          workWindowTicks === DEFAULT_PASSENGER_EMISSION_WORK_WINDOW_TICKS,
      )
      .map(({ elapsedMilliseconds }) => elapsedMilliseconds),
  );
  if (!Number.isFinite(baselineElapsed))
    return DEFAULT_PASSENGER_EMISSION_WORK_WINDOW_TICKS;
  const challengers = valid.filter(
    ({ workWindowTicks, elapsedMilliseconds }) =>
      workWindowTicks !== DEFAULT_PASSENGER_EMISSION_WORK_WINDOW_TICKS &&
      elapsedMilliseconds < baselineElapsed * materialImprovementRatio,
  );
  if (challengers.length === 0)
    return DEFAULT_PASSENGER_EMISSION_WORK_WINDOW_TICKS;
  const fastest = Math.min(
    ...challengers.map(({ elapsedMilliseconds }) => elapsedMilliseconds),
  );
  return Math.max(
    ...challengers
      .filter(
        ({ elapsedMilliseconds }) =>
          elapsedMilliseconds <= fastest * effectiveTieRatio,
      )
      .map(({ workWindowTicks }) => workWindowTicks),
  );
}

const result = (
  selectedWorkWindowTicks: number,
  measuredCandidateCount: number,
  elapsedMilliseconds: number,
): PassengerWorkWindowCalibrationResult =>
  Object.freeze({
    selectedWorkWindowTicks,
    measuredCandidateCount,
    elapsedMilliseconds,
    fallbackUsed:
      selectedWorkWindowTicks === DEFAULT_PASSENGER_EMISSION_WORK_WINDOW_TICKS,
  });

const runBatch = (
  demandPlan: PassengerDemandPlanV1,
  passengerDemandState: ActivePassengerDemandState,
  workWindowTicks: number,
) => {
  let scheduler = createPassengerEmissionScheduler(
    demandPlan,
    passengerDemandState,
    workWindowTicks,
  );
  for (let offset = 1; offset <= calibrationBatchTicks; offset += 1)
    scheduler = advancePassengerEmissionScheduler(
      demandPlan,
      scheduler,
      parseSimulationTick(passengerDemandState.processedThroughTick + offset),
    ).scheduler;
};

export function calibratePassengerEmissionWorkWindow(input: {
  readonly demandPlan: PassengerDemandPlanV1;
  readonly passengerDemandState: ActivePassengerDemandState;
  readonly now?: () => number;
  readonly budgetMilliseconds?: number;
}): PassengerWorkWindowCalibrationResult {
  const now = input.now ?? (() => performance.now());
  const budget =
    input.budgetMilliseconds ??
    passengerWorkWindowCalibrationBudgetMilliseconds;
  let started: number;
  let elapsed = 0;
  const measurements: PassengerWorkWindowMeasurement[] = [];
  try {
    started = now();
    if (!Number.isFinite(started)) throw new Error('Invalid timer.');
    runBatch(
      input.demandPlan,
      input.passengerDemandState,
      DEFAULT_PASSENGER_EMISSION_WORK_WINDOW_TICKS,
    );
    for (const workWindowTicks of candidates) {
      const before = now();
      if (!Number.isFinite(before)) throw new Error('Invalid timer.');
      elapsed = before - started;
      if (elapsed >= budget) break;
      const candidateStarted = now();
      runBatch(input.demandPlan, input.passengerDemandState, workWindowTicks);
      const candidateFinished = now();
      const candidateElapsed = candidateFinished - candidateStarted;
      elapsed = candidateFinished - started;
      if (!Number.isFinite(candidateElapsed) || candidateElapsed < 0)
        throw new Error('Invalid timer.');
      measurements.push({
        workWindowTicks,
        elapsedMilliseconds: candidateElapsed,
      });
    }
  } catch {
    return result(
      DEFAULT_PASSENGER_EMISSION_WORK_WINDOW_TICKS,
      new Set(measurements.map(({ workWindowTicks }) => workWindowTicks)).size,
      Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0,
    );
  }
  const selectedWorkWindowTicks =
    selectPassengerEmissionWorkWindow(measurements);
  return result(
    selectedWorkWindowTicks,
    new Set(measurements.map(({ workWindowTicks }) => workWindowTicks)).size,
    elapsed,
  );
}
