import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { buildDirectedScenarioGraph } from '../packages/transport-domain/dist/index.js';
import {
  DEFAULT_VEHICLE_PASSENGER_CAPACITY,
  advanceTransportTicks,
  applyTransportVehicleCommand,
  createTransportSimulationSnapshot,
  createTransportSimulationState,
} from '../packages/simulation/dist/index.js';
import { prepareBenchmarkScenario } from './scenario-benchmark-support.mjs';

export function parseSimulationRuntimeBenchmarkArguments(values) {
  const result = {
    runs: 3,
    ticks: 100,
    warmup: 200,
    passengerWorkWindow: 12,
    json: false,
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--json') result.json = true;
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
    for (let tick = 0; tick < options.ticks; tick += 1)
      state = advanceTransportTicks(state, 1);
    const elapsedMilliseconds = now() - start;
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
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
