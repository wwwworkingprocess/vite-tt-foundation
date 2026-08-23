import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { buildDirectedScenarioGraph } from '../packages/transport-domain/dist/index.js';
import {
  DEFAULT_VEHICLE_PASSENGER_CAPACITY,
  advanceTransportTicks,
  advanceTransportTicksInternal,
  applyTransportVehicleCommand,
  createTransportSimulationSnapshot,
  createTransportSimulationState,
} from '../packages/simulation/dist/index.js';
import { prepareBenchmarkScenario } from './scenario-benchmark-support.mjs';

const passengerRuntimePhases = [
  'passenger-emission',
  'passenger-access-arrival',
  'passenger-destination-waiting',
  'passenger-vehicle-transit',
  'passenger-destination-access-completion',
];

export function parseSimulationRuntimeBenchmarkArguments(values) {
  const result = {
    runs: 3,
    ticks: 100,
    warmup: 200,
    passengerWorkWindow: 12,
    profilePassengerPhases: false,
    json: false,
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--json') result.json = true;
    else if (value === '--profile-passenger-phases')
      result.profilePassengerPhases = true;
    else if (
      [
        '--scenario',
        '--runs',
        '--ticks',
        '--warmup',
        '--passenger-work-window',
      ].includes(value)
    ) {
      const next = values[++index];
      if (!next) throw new Error(`${value} requires a value.`);
      if (value === '--scenario') result.scenario = next;
      else if (value === '--passenger-work-window')
        result.passengerWorkWindow = Number(next);
      else result[value.slice(2)] = Number(next);
    } else throw new Error(`Unknown benchmark argument ${value}.`);
  }
  if (!result.scenario) throw new Error('--scenario is required.');
  for (const field of ['runs', 'ticks', 'warmup'])
    if (
      !Number.isSafeInteger(result[field]) ||
      result[field] < (field === 'warmup' ? 0 : 1)
    )
      throw new Error(
        `--${field} must be ${field === 'warmup' ? 'a nonnegative' : 'a positive'} safe integer.`,
      );
  if (
    !Number.isInteger(result.passengerWorkWindow) ||
    result.passengerWorkWindow < 1 ||
    result.passengerWorkWindow > 12
  )
    throw new Error(
      '--passenger-work-window must be an integer from 1 through 12.',
    );
  return Object.freeze(result);
}

const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return Object.freeze({
    min: sorted[0],
    median:
      sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2,
    max: sorted.at(-1),
  });
};

export function summarizePassengerRuntimePhases(
  phaseDurations,
  phaseWork,
  measuredTicks,
  wholeSimulationMilliseconds,
) {
  const measuredPassengerPhaseTotalMs = passengerRuntimePhases.reduce(
    (total, phase) =>
      total + phaseDurations[phase].reduce((sum, value) => sum + value, 0),
    0,
  );
  const passengerPhases = Object.fromEntries(
    passengerRuntimePhases.map((phase) => {
      const durations = phaseDurations[phase];
      const totalMs = durations.reduce((sum, value) => sum + value, 0);
      return [
        phase,
        Object.freeze({
          invocations: durations.length,
          totalMs,
          msPerTick: totalMs / measuredTicks,
          meanMsPerInvocation:
            durations.length === 0 ? 0 : totalMs / durations.length,
          shareOfMeasuredPassengerTime:
            measuredPassengerPhaseTotalMs === 0
              ? 0
              : (totalMs * 100) / measuredPassengerPhaseTotalMs,
          work: Object.freeze({ ...phaseWork[phase] }),
        }),
      ];
    }),
  );
  return Object.freeze({
    passengerPhases: Object.freeze(passengerPhases),
    measuredPassengerPhaseTotalMs,
    unattributedSimulationMs:
      wholeSimulationMilliseconds - measuredPassengerPhaseTotalMs,
  });
}

const summarizeNestedPhase = (
  durations,
  work,
  measuredTicks,
  destinationWaitingTotalMs,
) => {
  const totalMs = durations.reduce((sum, value) => sum + value, 0);
  return Object.freeze({
    invocations: durations.length,
    totalMs,
    msPerTick: totalMs / measuredTicks,
    meanMsPerInvocation:
      durations.length === 0 ? 0 : totalMs / durations.length,
    shareOfDestinationWaitingTime:
      destinationWaitingTotalMs === 0
        ? 0
        : (totalMs * 100) / destinationWaitingTotalMs,
    work: Object.freeze({ ...work }),
  });
};

export function summarizePassengerDestinationWaitingBreakdown(
  destinationWaitingTotalMs,
  destinationAllocationDurations,
  waitingActivationDurations,
  destinationAllocationWork,
  waitingActivationWork,
  residualDurations,
  residualWork,
  measuredTicks,
  waitingActivationBreakdown,
) {
  const destinationAllocation = summarizeNestedPhase(
    destinationAllocationDurations,
    destinationAllocationWork,
    measuredTicks,
    destinationWaitingTotalMs,
  );
  const waitingActivation = summarizeNestedPhase(
    waitingActivationDurations,
    waitingActivationWork,
    measuredTicks,
    destinationWaitingTotalMs,
  );
  const residualPhases = Object.fromEntries(
    destinationWaitingResidualPhases.map((name) => [
      name,
      summarizeNestedPhase(
        residualDurations[name],
        residualWork[name],
        measuredTicks,
        destinationWaitingTotalMs,
      ),
    ]),
  );
  const calculatedResidual =
    destinationWaitingTotalMs -
    destinationAllocation.totalMs -
    waitingActivation.totalMs -
    Object.values(residualPhases).reduce(
      (sum, phase) => sum + phase.totalMs,
      0,
    );
  const totalMs =
    calculatedResidual < 0 && calculatedResidual > -1e-9
      ? 0
      : calculatedResidual;
  return Object.freeze({
    destinationAllocation,
    waitingActivation: Object.freeze({
      ...waitingActivation,
      ...(waitingActivationBreakdown
        ? { breakdown: waitingActivationBreakdown }
        : {}),
    }),
    ...residualPhases,
    unattributed: Object.freeze({
      totalMs,
      msPerTick: totalMs / measuredTicks,
      shareOfDestinationWaitingTime:
        destinationWaitingTotalMs === 0
          ? 0
          : (totalMs * 100) / destinationWaitingTotalMs,
    }),
  });
}

const waitingActivationPhases = [
  'planPreparation',
  'existingAuthorityPreparation',
  'newAssignmentActivation',
  'orderingFinalization',
];

const destinationWaitingResidualPhases = [
  'accessingOrdering',
  'stopAuthorityMaterialization',
  'stateFinalization',
];

export function summarizePassengerWaitingActivationBreakdown(
  waitingActivationTotalMs,
  durations,
  work,
  measuredTicks,
) {
  const phases = Object.fromEntries(
    waitingActivationPhases.map((name) => {
      const values = durations[name];
      const totalMs = values.reduce((sum, value) => sum + value, 0);
      return [
        name,
        Object.freeze({
          invocations: values.length,
          totalMs,
          msPerTick: totalMs / measuredTicks,
          meanMsPerInvocation:
            values.length === 0 ? 0 : totalMs / values.length,
          shareOfWaitingActivationTime:
            waitingActivationTotalMs === 0
              ? 0
              : (totalMs * 100) / waitingActivationTotalMs,
          work: Object.freeze({ ...work[name] }),
        }),
      ];
    }),
  );
  const calculatedUnattributed =
    waitingActivationTotalMs -
    Object.values(phases).reduce((sum, phase) => sum + phase.totalMs, 0);
  const totalMs =
    calculatedUnattributed < 0 && calculatedUnattributed > -1e-9
      ? 0
      : calculatedUnattributed;
  return Object.freeze({
    ...phases,
    unattributed: Object.freeze({
      totalMs,
      msPerTick: totalMs / measuredTicks,
      shareOfWaitingActivationTime:
        waitingActivationTotalMs === 0
          ? 0
          : (totalMs * 100) / waitingActivationTotalMs,
    }),
  });
}

const createPhaseProfiler = (now) => {
  const durations = Object.fromEntries(
    passengerRuntimePhases.map((phase) => [phase, []]),
  );
  const work = Object.fromEntries(
    passengerRuntimePhases.map((phase) => [phase, {}]),
  );
  const destinationWaitingDurations = {
    destinationAllocation: [],
    waitingActivation: [],
    accessingOrdering: [],
    stopAuthorityMaterialization: [],
    stateFinalization: [],
  };
  const destinationWaitingWork = {
    destinationAllocation: {},
    waitingActivation: {},
    accessingOrdering: {},
    stopAuthorityMaterialization: {},
    stateFinalization: {},
  };
  const waitingActivationDurations = Object.fromEntries(
    waitingActivationPhases.map((name) => [name, []]),
  );
  const waitingActivationWork = Object.fromEntries(
    waitingActivationPhases.map((name) => [name, {}]),
  );
  let started;
  let waitingActivationStarted;
  let waitingActivationChildStarted;
  let destinationWaitingResidualStarted;
  const nextPhase = [undefined, 1, 2, 4, 3, 4];
  return {
    observer(boundary, primaryWork, secondaryWork) {
      if (boundary >= 9 && boundary <= 12) {
        const expected = waitingActivationPhases[boundary - 9];
        if (
          waitingActivationStarted === undefined ||
          waitingActivationChildStarted?.name !== expected
        )
          throw new Error(
            'Passenger waiting activation detail order is invalid.',
          );
        const time = now();
        waitingActivationDurations[expected].push(
          time - waitingActivationChildStarted.time,
        );
        if (boundary === 9) {
          if (secondaryWork !== undefined) {
            const prior = waitingActivationWork.planPreparation.demandPlanCells;
            if (prior !== undefined && prior !== secondaryWork)
              throw new Error('Passenger demand-plan size changed.');
            waitingActivationWork.planPreparation.demandPlanCells =
              secondaryWork;
          }
          addWork(
            waitingActivationWork.planPreparation,
            'planPreparationCellEvaluations',
            primaryWork,
          );
        } else if (boundary === 10)
          addWork(
            waitingActivationWork.existingAuthorityPreparation,
            'inputWaitingCohorts',
            primaryWork,
          );
        else if (boundary === 12)
          addWork(
            waitingActivationWork.orderingFinalization,
            'resultingWaitingCohorts',
            primaryWork,
          );
        const next = waitingActivationPhases[boundary - 8];
        waitingActivationChildStarted = next ? { name: next, time } : undefined;
        return;
      }
      if (boundary === 7) {
        if (
          started?.phase !== 'passenger-destination-waiting' ||
          waitingActivationStarted !== undefined
        )
          throw new Error('Passenger destination allocation order is invalid.');
        const time = now();
        destinationWaitingDurations.destinationAllocation.push(
          time - started.time,
        );
        waitingActivationStarted = time;
        waitingActivationChildStarted = {
          name: waitingActivationPhases[0],
          time,
        };
        addWork(
          waitingActivationWork.newAssignmentActivation,
          'destinationAssignedGroups',
          primaryWork,
        );
        addWork(
          waitingActivationWork.newAssignmentActivation,
          'destinationAssignedPassengers',
          secondaryWork,
        );
        return;
      }
      if (boundary === 8) {
        if (
          waitingActivationStarted === undefined ||
          waitingActivationChildStarted !== undefined
        )
          throw new Error('Passenger waiting activation order is invalid.');
        const time = now();
        destinationWaitingDurations.waitingActivation.push(
          time - waitingActivationStarted,
        );
        waitingActivationStarted = undefined;
        destinationWaitingResidualStarted = {
          name: destinationWaitingResidualPhases[0],
          time,
        };
        return;
      }
      if (boundary >= 13 && boundary <= 15) {
        const expected = destinationWaitingResidualPhases[boundary - 13];
        if (destinationWaitingResidualStarted?.name !== expected)
          throw new Error(
            'Passenger destination waiting residual order is invalid.',
          );
        const time = now();
        destinationWaitingDurations[expected].push(
          time - destinationWaitingResidualStarted.time,
        );
        if (boundary === 13)
          addWork(
            destinationWaitingWork.accessingOrdering,
            'accessingGroups',
            primaryWork,
          );
        else if (boundary === 14)
          addWork(
            destinationWaitingWork.stopAuthorityMaterialization,
            'stopPlaces',
            primaryWork,
          );
        const next = destinationWaitingResidualPhases[boundary - 12];
        destinationWaitingResidualStarted = next
          ? { name: next, time }
          : undefined;
        return;
      }
      if (boundary === 0) {
        if (started)
          throw new Error('Passenger runtime phases must not overlap.');
        started = { phase: passengerRuntimePhases[0], time: now() };
      } else {
        if (
          !started ||
          waitingActivationStarted !== undefined ||
          destinationWaitingResidualStarted !== undefined
        )
          throw new Error('Passenger runtime phase order is invalid.');
        const time = now();
        durations[started.phase].push(time - started.time);
        const phase = nextPhase[boundary];
        started =
          phase === undefined
            ? undefined
            : { phase: passengerRuntimePhases[phase], time };
      }
    },
    durations,
    work,
    destinationWaitingDurations,
    destinationWaitingWork,
    waitingActivationDurations,
    waitingActivationWork,
  };
};

const addWork = (work, name, count) => {
  if (count === undefined) return;
  work[name] = (work[name] ?? 0) + count;
};

const recordTickWork = (work, destinationWaitingWork, before, after) => {
  const previous = before.passengerDemand;
  const current = after.passengerDemand;
  if (previous.status !== 'active' || current.status !== 'active') return;
  const scheduler = before.passengerEmissionScheduler;
  const shard =
    (after.tick - scheduler.seedTick - 1) % scheduler.workWindowTicks;
  addWork(
    work['passenger-emission'],
    'evaluatedDemandCells',
    Math.ceil(
      (before.passengerDemandPlan.cells.length - shard) /
        scheduler.workWindowTicks,
    ),
  );
  addWork(
    work['passenger-emission'],
    'emittedPassengers',
    current.totalEmittedPassengerCount - previous.totalEmittedPassengerCount,
  );
  addWork(
    work['passenger-access-arrival'],
    'arrivedPassengers',
    current.totalArrivedAtStopPassengerCount -
      previous.totalArrivedAtStopPassengerCount,
  );
  addWork(
    work['passenger-destination-waiting'],
    'destinationAssignedPassengers',
    current.totalDestinationAssignedPassengerCount -
      previous.totalDestinationAssignedPassengerCount,
  );
  addWork(
    destinationWaitingWork.destinationAllocation,
    'destinationAssignedPassengers',
    current.totalDestinationAssignedPassengerCount -
      previous.totalDestinationAssignedPassengerCount,
  );
  addWork(
    destinationWaitingWork.waitingActivation,
    'inputWaitingCohorts',
    previous.waitingCohorts.length,
  );
  addWork(
    destinationWaitingWork.waitingActivation,
    'resultingWaitingCohorts',
    current.waitingCohorts.length,
  );
  addWork(
    work['passenger-destination-waiting'],
    'resultingWaitingCohorts',
    current.waitingCohorts.length,
  );
  addWork(
    work['passenger-vehicle-transit'],
    'vehicleCallsProcessed',
    after.currentStopCalls.length,
  );
  addWork(
    work['passenger-vehicle-transit'],
    'boardedEvents',
    after.currentBoardingEvents.length,
  );
  addWork(
    work['passenger-vehicle-transit'],
    'alightedEvents',
    after.currentAlightingEvents.length,
  );
  addWork(
    work['passenger-destination-access-completion'],
    'completedPassengers',
    current.totalCompletedJourneyPassengerCount -
      previous.totalCompletedJourneyPassengerCount,
  );
};
function benchmarkFleet(state) {
  for (const route of state.scenario.routes.routes) {
    const vehicleId = `benchmark-${route.routeId}`;
    state = applyTransportVehicleCommand(state, {
      kind: 'transport.vehicle.create-route-cycle',
      vehicleId,
      label: vehicleId,
      routeId: route.routeId,
      passengerCapacity: DEFAULT_VEHICLE_PASSENGER_CAPACITY,
      legs: route.patterns.map((pattern) => ({
        patternId: pattern.patternId,
        movementPlan: {
          kind: 'vehicle-movement-plan-v1',
          edgeTravelTicks: Array.from(
            {
              length: pattern.stopNodeIds.length - (pattern.closesLoop ? 0 : 1),
            },
            () => 120,
          ),
        },
      })),
    });
    state = applyTransportVehicleCommand(state, {
      kind: 'transport.vehicle.start',
      vehicleId,
    });
  }
  return state;
}
const authorityMetrics = (state) => {
  const active =
    state.passengerDemand.status === 'active'
      ? state.passengerDemand
      : undefined;
  return Object.freeze({
    tick: state.tick,
    fleetSize: state.fleet.length,
    totalEmittedPassengers: active?.totalEmittedPassengerCount ?? 0,
    waitingPassengers: active?.totalWaitingForVehiclePassengerCount ?? 0,
    waitingCohorts: active?.waitingCohorts.length ?? 0,
    onboardPassengers: active?.totalOnboardPassengerCount ?? 0,
    onboardGroups: active?.onboardGroups.length ?? 0,
    destinationAccessPassengers:
      active?.totalInDestinationAccessPassengerCount ?? 0,
    destinationAccessGroups: active?.destinationAccessGroups.length ?? 0,
    completedPassengers: active?.totalCompletedJourneyPassengerCount ?? 0,
    unavailableDirectPassengers:
      active?.directItineraryUnavailablePassengerCount ?? 0,
    currentStopNodeCalls: state.currentStopCalls.length,
  });
};
const evaluatedCells = (cellCount, scheduler, tick) => {
  const elapsed = tick - scheduler.seedTick;
  let total = Math.floor(elapsed / scheduler.workWindowTicks) * cellCount;
  for (let shard = 0; shard < elapsed % scheduler.workWindowTicks; shard += 1)
    total += Math.ceil((cellCount - shard) / scheduler.workWindowTicks);
  return total;
};

export async function runSimulationRuntimeBenchmark(
  options,
  now = () => performance.now(),
) {
  const passengerWorkWindow = options.passengerWorkWindow ?? 12;
  const { scenario, demandPlan, populationView } =
    await prepareBenchmarkScenario(options.scenario);
  const graph = buildDirectedScenarioGraph(scenario);
  const timings = [];
  let expectedMetrics;
  let expectedSnapshotJson;
  let finalSnapshotSha256;
  let directItineraryPairCount;
  let benchmarkStartTick;
  let emissionScheduler;
  const phaseDurations = Object.fromEntries(
    passengerRuntimePhases.map((phase) => [phase, []]),
  );
  const phaseWork = Object.fromEntries(
    passengerRuntimePhases.map((phase) => [phase, {}]),
  );
  const destinationWaitingDurations = {
    destinationAllocation: [],
    waitingActivation: [],
    accessingOrdering: [],
    stopAuthorityMaterialization: [],
    stateFinalization: [],
  };
  const destinationWaitingWork = {
    destinationAllocation: {},
    waitingActivation: {},
    accessingOrdering: {},
    stopAuthorityMaterialization: {},
    stateFinalization: {},
  };
  const waitingActivationDurations = Object.fromEntries(
    waitingActivationPhases.map((name) => [name, []]),
  );
  const waitingActivationWork = Object.fromEntries(
    waitingActivationPhases.map((name) => [name, {}]),
  );
  for (let run = 0; run < options.runs; run += 1) {
    let state = benchmarkFleet(
      createTransportSimulationState(scenario, 0, demandPlan, {
        passengerEmissionWorkWindowTicks: passengerWorkWindow,
      }),
    );
    directItineraryPairCount =
      state.passengerDirectItineraryPlan.directPairCount;
    state = advanceTransportTicks(state, options.warmup);
    const startTick = state.tick;
    benchmarkStartTick = startTick;
    const start = now();
    const profiler = options.profilePassengerPhases
      ? createPhaseProfiler(now)
      : undefined;
    for (let tick = 0; tick < options.ticks; tick += 1)
      if (profiler) {
        const before = state;
        state = advanceTransportTicksInternal(
          state,
          1,
          undefined,
          profiler.observer,
        );
        recordTickWork(
          profiler.work,
          profiler.destinationWaitingWork,
          before,
          state,
        );
      } else state = advanceTransportTicks(state, 1);
    const elapsedMilliseconds = now() - start;
    if (profiler)
      for (const phase of passengerRuntimePhases) {
        phaseDurations[phase].push(...profiler.durations[phase]);
        for (const [name, count] of Object.entries(profiler.work[phase]))
          phaseWork[phase][name] = (phaseWork[phase][name] ?? 0) + count;
      }
    if (profiler)
      for (const name of [
        'destinationAllocation',
        'waitingActivation',
        ...destinationWaitingResidualPhases,
      ]) {
        destinationWaitingDurations[name].push(
          ...profiler.destinationWaitingDurations[name],
        );
        for (const [workName, count] of Object.entries(
          profiler.destinationWaitingWork[name],
        ))
          destinationWaitingWork[name][workName] =
            (destinationWaitingWork[name][workName] ?? 0) + count;
      }
    if (profiler)
      for (const name of waitingActivationPhases) {
        waitingActivationDurations[name].push(
          ...profiler.waitingActivationDurations[name],
        );
        for (const [workName, count] of Object.entries(
          profiler.waitingActivationWork[name],
        ))
          waitingActivationWork[name][workName] =
            workName === 'demandPlanCells'
              ? Math.max(waitingActivationWork[name][workName] ?? 0, count)
              : (waitingActivationWork[name][workName] ?? 0) + count;
      }
    timings.push({
      elapsedMilliseconds,
      millisecondsPerTick: elapsedMilliseconds / options.ticks,
      ticksPerSecond:
        elapsedMilliseconds === 0
          ? null
          : (options.ticks * 1000) / elapsedMilliseconds,
    });
    const metrics = authorityMetrics(state);
    const snapshotJson = JSON.stringify(
      createTransportSimulationSnapshot(state),
    );
    if (
      expectedSnapshotJson !== undefined &&
      snapshotJson !== expectedSnapshotJson
    )
      throw new Error('Simulation benchmark authority was not deterministic.');
    expectedMetrics = metrics;
    expectedSnapshotJson = snapshotJson;
    finalSnapshotSha256 = createHash('sha256')
      .update(snapshotJson)
      .digest('hex');
    emissionScheduler = state.passengerEmissionScheduler;
  }
  const elapsed = timings.map((value) => value.elapsedMilliseconds);
  const perTick = timings.map((value) => value.millisecondsPerTick);
  const throughput = timings
    .map((value) => value.ticksPerSecond)
    .filter((value) => value !== null);
  const profile = options.profilePassengerPhases
    ? summarizePassengerRuntimePhases(
        phaseDurations,
        phaseWork,
        options.ticks * options.runs,
        elapsed.reduce((sum, value) => sum + value, 0),
      )
    : undefined;
  const passengerDestinationWaitingBreakdown = profile
    ? (() => {
        const waitingActivationTotalMs =
          destinationWaitingDurations.waitingActivation.reduce(
            (sum, value) => sum + value,
            0,
          );
        return summarizePassengerDestinationWaitingBreakdown(
          profile.passengerPhases['passenger-destination-waiting'].totalMs,
          destinationWaitingDurations.destinationAllocation,
          destinationWaitingDurations.waitingActivation,
          destinationWaitingWork.destinationAllocation,
          destinationWaitingWork.waitingActivation,
          Object.fromEntries(
            destinationWaitingResidualPhases.map((name) => [
              name,
              destinationWaitingDurations[name],
            ]),
          ),
          Object.fromEntries(
            destinationWaitingResidualPhases.map((name) => [
              name,
              destinationWaitingWork[name],
            ]),
          ),
          options.ticks * options.runs,
          summarizePassengerWaitingActivationBreakdown(
            waitingActivationTotalMs,
            waitingActivationDurations,
            waitingActivationWork,
            options.ticks * options.runs,
          ),
        );
      })()
    : undefined;
  return Object.freeze({
    configuration: Object.freeze({
      scenarioId: options.scenario,
      runs: options.runs,
      warmupTicks: options.warmup,
      measuredTicks: options.ticks,
      edgeTravelTicks: 120,
      passengerCapacity: DEFAULT_VEHICLE_PASSENGER_CAPACITY,
      demandModelContentHash: demandPlan.demandModelContentHash,
      passengerEmissionWorkWindowTicks: passengerWorkWindow,
    }),
    structure: Object.freeze({
      routes: scenario.routes.routes.length,
      patterns: scenario.routes.routes.reduce(
        (sum, route) => sum + route.patterns.length,
        0,
      ),
      stopPlaces: scenario.stops.stopPlaces.length,
      stopNodes: scenario.stops.stopNodes.length,
      directedEdges: graph.edges.length,
      demandPlanCells: demandPlan.cells.length,
      servedDemandPlanCells: demandPlan.cells.filter(
        (cell) => cell.assignedStopPlaceId !== null,
      ).length,
      totalActivePopulationCells: populationView.activeCells.length,
      totalPopulationWeight: populationView.activeCells.reduce(
        (sum, cell) => sum + cell.populationWeight,
        0,
      ),
      itineraryStopPlaces: demandPlan.stops.length,
      directItineraryPairCount,
      bootstrapEvaluatedCells: demandPlan.cells.length,
      averageEvaluatedCellsPerTick:
        evaluatedCells(
          demandPlan.cells.length,
          emissionScheduler,
          expectedMetrics.tick,
        ) / (expectedMetrics.tick || 1),
      maximumEvaluatedCellsPerTick: Math.ceil(
        demandPlan.cells.length / emissionScheduler.workWindowTicks,
      ),
      scheduledEmissionRecords: emissionScheduler.buckets.reduce(
        (total, bucket) => total + bucket[1].length,
        0,
      ),
    }),
    timings: Object.freeze({
      elapsedMilliseconds: stats(elapsed),
      millisecondsPerTick: stats(perTick),
      ticksPerSecond: stats(throughput),
    }),
    finalAuthority: Object.freeze({
      ...expectedMetrics,
      startTick: benchmarkStartTick,
      finalSnapshotSha256,
    }),
    ...(profile ?? {}),
    ...(passengerDestinationWaitingBreakdown
      ? { passengerDestinationWaitingBreakdown }
      : {}),
  });
}

if (
  process.argv[1] &&
  import.meta.url ===
    new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href
) {
  try {
    const options = parseSimulationRuntimeBenchmarkArguments(
      process.argv.slice(2),
    );
    const result = await runSimulationRuntimeBenchmark(options);
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.table(result.structure);
      console.table(result.timings);
      console.table(result.finalAuthority);
      if (result.passengerPhases) {
        console.table(result.passengerPhases);
        console.table(result.passengerDestinationWaitingBreakdown);
        console.table({
          measuredPassengerPhaseTotalMs: result.measuredPassengerPhaseTotalMs,
          unattributedSimulationMs: result.unattributedSimulationMs,
        });
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
