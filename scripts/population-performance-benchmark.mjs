import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildDirectedScenarioGraph,
  buildStopCatchments,
  parseCityPopulationGrid,
  parseScenarioPackage,
} from '../packages/transport-domain/dist/index.js';
import {
  advancePassengerDemandToTick,
  advanceTransportTicks,
  applyTransportVehicleCommand,
  createInitialPassengerDemandState,
  createPassengerDemandPlan,
  createTransportSimulationState,
} from '../packages/simulation/dist/index.js';
import { passengerDemandRuntimeIndex } from '../packages/simulation/dist/passenger-demand-runtime.js';
import {
  buildPassengerDirectItineraryPlan,
  createPassengerDirectItineraryRuntimeIndex,
} from '../packages/simulation/dist/passenger-direct-itinerary.js';

const root = new URL('../', import.meta.url).pathname.replace(/^\/(.:)/, '$1');
const publicRoot = join(root, 'apps/web/public');
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const arguments_ = process.argv.slice(2);
const scenarioId =
  arguments_.find((value) => !value.startsWith('--') && !/^\d+$/.test(value)) ??
  'torrevieja-legacy-abc-v1';
const ticks = Number(arguments_.find((value) => /^\d+$/.test(value)) ?? 300);
const scenarioRoot = join(publicRoot, 'scenarios', scenarioId);
const scenario = parseScenarioPackage({
  manifest: await json(join(scenarioRoot, 'scenario.json')),
  settlements: await json(join(scenarioRoot, 'settlements.json')),
  stops: await json(join(scenarioRoot, 'stops.json')),
  routes: await json(join(scenarioRoot, 'routes.json')),
  presentation: await json(join(scenarioRoot, 'presentation.json')),
  provenance: await json(join(scenarioRoot, 'provenance.json')),
});
const populationCatalog = await json(
  join(publicRoot, 'population-fields', 'catalog.json'),
);
const populationEntry = populationCatalog.cities.find(
  (city) => city.primarySettlementId === scenario.manifest.primarySettlementId,
);
if (!populationEntry) throw new Error(`No population entry for ${scenarioId}.`);
const populationRoot = join(publicRoot, 'population-fields');
const fullGrid = parseCityPopulationGrid(
  await json(join(populationRoot, populationEntry.gridPath)),
);
const crops = await json(join(populationRoot, populationEntry.cropPath));
const crop = crops.scenarios.find(
  (item) => item.scenarioId === scenarioId,
).crop;
const grid = parseCityPopulationGrid({
  ...fullGrid,
  originCellCenter: {
    latitude:
      fullGrid.originCellCenter.latitude -
      crop.rowStart * fullGrid.resolutionDegrees,
    longitude:
      fullGrid.originCellCenter.longitude +
      crop.columnStart * fullGrid.resolutionDegrees,
  },
  rows: crop.rowEnd - crop.rowStart,
  columns: crop.columnEnd - crop.columnStart,
  populationWeights: fullGrid.populationWeights
    .slice(crop.rowStart, crop.rowEnd)
    .map((row) => row.slice(crop.columnStart, crop.columnEnd)),
});
const catchment = buildStopCatchments({
  grid,
  scenario,
  maxAccessDistanceCells: 5,
});
const plan = createPassengerDemandPlan({
  catchment,
  demandModelContentHash: '0'.repeat(64),
  emissionPolicy: {
    emissionCreditsPerWeightPerTick: 1,
    creditsPerPassenger: 50_000,
  },
  accessPolicy: { accessTicksPerCell: 1 },
});
const itineraryPlan = buildPassengerDirectItineraryPlan({
  scenario,
  demandPlan: plan,
});
const index = createPassengerDirectItineraryRuntimeIndex({
  plan: itineraryPlan,
  scenario,
  demandPlan: plan,
});
const initialDemand = createInitialPassengerDemandState(plan, 0);
const postOnly = arguments_.includes('--post-only');
const transportOnly = process.argv.includes('--transport-only');
const reference = arguments_.includes('--reference');

const stats = (name, samples, final) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const total = samples.reduce((sum, value) => sum + value, 0);
  const percentile = (ratio) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
  return {
    name,
    ticks: samples.length,
    elapsedMs: total,
    meanMsPerTick: total / samples.length,
    medianMsPerTick: percentile(0.5),
    p95MsPerTick: percentile(0.95),
    maxMsPerTick: sorted.at(-1),
    ticksPerSecond: (samples.length / total) * 1000,
    final: final.passengerDemand ?? final,
  };
};

const measureDemand = (advance, name) => {
  let state = initialDemand;
  const samples = [];
  for (let tick = 1; tick <= ticks; tick += 1) {
    const start = performance.now();
    state = advance(plan, index, state, tick);
    samples.push(performance.now() - start);
  }
  return stats(name, samples, state);
};

const heapBeforeIndex = process.memoryUsage().heapUsed;
const indexStart = performance.now();
const destinationIndex = passengerDemandRuntimeIndex(plan);
const indexConstructionMs = performance.now() - indexStart;
const heapAfterIndex = process.memoryUsage().heapUsed;

const route = scenario.routes.routes[0];
const graph = buildDirectedScenarioGraph(scenario);
const command = {
  kind: 'transport.vehicle.create-route-cycle',
  vehicleId: 'benchmark-bus',
  label: 'Benchmark bus',
  routeId: route.routeId,
  legs: route.patterns.map((pattern) => ({
    patternId: pattern.patternId,
    movementPlan: {
      kind: 'vehicle-movement-plan-v1',
      edgeTravelTicks: graph.patternEdges(pattern.patternId).map(() => 120),
    },
  })),
};
let transport = applyTransportVehicleCommand(
  createTransportSimulationState(scenario, 0, plan),
  command,
);
transport = applyTransportVehicleCommand(transport, {
  kind: 'transport.vehicle.start',
  vehicleId: command.vehicleId,
});
const transportSamples = [];
let firstCompletedJourneyTick = null;
for (let tick = 1; tick <= ticks; tick += 1) {
  const start = performance.now();
  transport = advanceTransportTicks(transport, 1);
  transportSamples.push(performance.now() - start);
  if (
    firstCompletedJourneyTick === null &&
    transport.passengerDemand.totalCompletedJourneyPassengerCount > 0
  )
    firstCompletedJourneyTick = tick;
}

const summarizeDemand = (state) => ({
  tick: state.processedThroughTick,
  emitted: state.totalEmittedPassengerCount,
  waiting: state.totalWaitingForVehiclePassengerCount,
  onboard: state.totalOnboardPassengerCount,
  completed: state.totalCompletedJourneyPassengerCount,
  waitingCohorts: state.waitingCohorts.length,
  onboardGroups: state.onboardGroups.length,
});
const results = [
  ...(!reference || postOnly || transportOnly
    ? []
    : [
        measureDemand(
          advancePassengerDemandToTick,
          'validated-reference-demand',
        ),
      ]),
  stats('population-backed-transport', transportSamples, transport),
].map((result) => ({
  ...result,
  final: summarizeDemand(result.final),
}));
console.log(
  JSON.stringify(
    {
      scenarioId,
      activeCells: plan.cells.length,
      eligibleStops: plan.stops.length,
      destinationRuntimeIndex: {
        servedCandidateRecords: destinationIndex.servedCandidates.length,
        stopWeightRecords: destinationIndex.assignedWeightByStopPlace.size,
        retainedRecordCount: destinationIndex.retainedRecordCount,
        indexConstructionMs,
        heapBeforeIndex,
        heapAfterIndex,
        heapDeltaBytes: heapAfterIndex - heapBeforeIndex,
      },
      heapUsedBytes: process.memoryUsage().heapUsed,
      firstCompletedJourneyTick,
      results,
    },
    null,
    2,
  ),
);
