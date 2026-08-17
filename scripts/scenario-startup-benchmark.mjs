import { performance } from 'node:perf_hooks';
import { buildDirectedScenarioGraph } from '../packages/transport-domain/dist/index.js';
import { buildPassengerDirectItineraryAuthority } from '../packages/simulation/dist/passenger-direct-itinerary.js';
import { passengerDemandRuntimeIndex } from '../packages/simulation/dist/passenger-demand-runtime.js';
import { createTransportSimulationState } from '../packages/simulation/dist/index.js';
import {
  buildBenchmarkCatchment,
  createBenchmarkPassengerDemandPlan,
  loadBenchmarkAssets,
  loadBenchmarkCatalogues,
  parseBenchmarkScenario,
  prepareBenchmarkPopulationView,
} from './scenario-benchmark-support.mjs';

export function parseScenarioStartupBenchmarkArguments(values) {
  const result = { runs: 5, json: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--all') result.all = true;
    else if (value === '--json') result.json = true;
    else if (
      value === '--scenario' ||
      value === '--city' ||
      value === '--runs'
    ) {
      const next = values[++index];
      if (!next) throw new Error(`${value} requires a value.`);
      if (value === '--scenario') result.scenario = next;
      else if (value === '--city') result.city = next;
      else result.runs = Number(next);
    } else throw new Error(`Unknown benchmark argument ${value}.`);
  }
  if (!Number.isSafeInteger(result.runs) || result.runs <= 0)
    throw new Error('--runs must be a positive safe integer.');
  if (
    [
      result.all,
      result.city !== undefined,
      result.scenario !== undefined,
    ].filter(Boolean).length !== 1
  )
    throw new Error('Choose exactly one of --scenario, --city, or --all.');
  return Object.freeze(result);
}

const stats = (values) => {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return Object.freeze({
    min: ordered[0],
    median:
      ordered.length % 2 === 1
        ? ordered[middle]
        : (ordered[middle - 1] + ordered[middle]) / 2,
    max: ordered.at(-1),
  });
};

async function measureScenario(descriptor, populationCatalogue) {
  const startupTimings = {};
  const diagnosticTimings = {};
  const time = async (timings, name, operation) => {
    const start = performance.now();
    const value = await operation();
    timings[name] = performance.now() - start;
    return value;
  };
  const assets = await time(startupTimings, 'assetLoading', () =>
    loadBenchmarkAssets(descriptor, populationCatalogue),
  );
  const scenario = await time(
    startupTimings,
    'scenarioParsingAndGraph',
    async () => {
      const parsed = parseBenchmarkScenario(assets.scenarioTexts);
      buildDirectedScenarioGraph(parsed);
      return parsed;
    },
  );
  let canonicalGrid;
  let grid;
  let populationView;
  let activeCells;
  await time(startupTimings, 'populationView', async () => {
    populationView = prepareBenchmarkPopulationView(descriptor, assets);
    ({ canonicalGrid, grid, activeCells } = populationView);
  });
  let demandPlan;
  let catchment;
  let itinerary;
  await time(startupTimings, 'stopCatchmentConstruction', async () => {
    catchment = buildBenchmarkCatchment(
      scenario,
      populationView,
      populationCatalogue,
    );
  });
  await time(startupTimings, 'passengerDemandPlanCreation', async () => {
    demandPlan = createBenchmarkPassengerDemandPlan(
      catchment,
      populationView,
      assets.populationEntry,
      populationCatalogue,
    );
  });
  await time(
    diagnosticTimings,
    'passengerDemandRuntimeIndexDiagnostic',
    async () => {
      passengerDemandRuntimeIndex(demandPlan);
    },
  );
  await time(
    diagnosticTimings,
    'directItineraryAuthorityConstruction',
    async () => {
      itinerary = buildPassengerDirectItineraryAuthority({
        scenario,
        demandPlan,
      }).plan;
    },
  );
  await time(startupTimings, 'workerAuthorityCreation', async () => {
    createTransportSimulationState(scenario, 0, demandPlan);
  });
  startupTimings.startupTotal = Object.values(startupTimings).reduce(
    (total, value) => total + value,
    0,
  );
  diagnosticTimings.diagnosticTotal = Object.values(diagnosticTimings).reduce(
    (total, value) => total + value,
    0,
  );
  const graph = buildDirectedScenarioGraph(scenario);
  return Object.freeze({
    startupTimings,
    diagnosticTimings,
    demandModelContentHash: demandPlan.demandModelContentHash,
    structure: Object.freeze({
      routes: scenario.routes.routes.length,
      patterns: scenario.routes.routes.reduce(
        (total, route) => total + route.patterns.length,
        0,
      ),
      stopPlaces: scenario.stops.stopPlaces.length,
      stopNodes: scenario.stops.stopNodes.length,
      directedEdges: graph.edges.length,
      canonicalPopulationRows: canonicalGrid.rows,
      canonicalPopulationColumns: canonicalGrid.columns,
      canonicalPopulationCells: canonicalGrid.rows * canonicalGrid.columns,
      operationalCropRows: grid.rows,
      operationalCropColumns: grid.columns,
      operationalCropCells: grid.rows * grid.columns,
      activePopulationCells: activeCells.length,
      populationWeight: activeCells.reduce(
        (sum, cell) => sum + cell.populationWeight,
        0,
      ),
      servedDestinationCells: demandPlan.cells.filter(
        (cell) => cell.assignedStopPlaceId !== null,
      ).length,
      itineraryStopPlaces: itinerary.stopPlaceIds.length,
      itineraryPairCount: itinerary.pairCount,
      directItineraryPairCount: itinerary.directPairCount,
      unavailableItineraryPairCount: itinerary.unavailablePairCount,
      retainedDirectItineraryEntries: itinerary.directEntries.length,
    }),
  });
}

export async function runScenarioStartupBenchmark(options) {
  const { scenarioCatalogue, populationCatalogue } =
    await loadBenchmarkCatalogues();
  const selected = scenarioCatalogue.scenarios.filter((descriptor) =>
    options.all
      ? true
      : options.scenario
        ? descriptor.scenarioId === options.scenario
        : descriptor.manifestPath.startsWith(`${options.city}/`),
  );
  if (selected.length === 0)
    throw new Error(
      `No scenarios matched ${options.scenario ?? options.city}.`,
    );
  const results = [];
  for (const descriptor of selected) {
    await measureScenario(descriptor, populationCatalogue);
    const runs = [];
    for (let index = 0; index < options.runs; index += 1)
      runs.push(await measureScenario(descriptor, populationCatalogue));
    const startupStageNames = Object.keys(runs[0].startupTimings);
    const diagnosticStageNames = Object.keys(runs[0].diagnosticTimings);
    results.push(
      Object.freeze({
        scenarioId: descriptor.scenarioId,
        cityDirectory: descriptor.manifestPath.split('/')[0],
        runCount: options.runs,
        demandModelContentHash: runs[0].demandModelContentHash,
        structure: runs[0].structure,
        startupTimingsMilliseconds: Object.freeze(
          Object.fromEntries(
            startupStageNames.map((name) => [
              name,
              stats(runs.map((run) => run.startupTimings[name])),
            ]),
          ),
        ),
        diagnosticTimingsMilliseconds: Object.freeze(
          Object.fromEntries(
            diagnosticStageNames.map((name) => [
              name,
              stats(runs.map((run) => run.diagnosticTimings[name])),
            ]),
          ),
        ),
      }),
    );
  }
  return Object.freeze(results);
}

if (
  process.argv[1] &&
  import.meta.url ===
    new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href
) {
  try {
    const options = parseScenarioStartupBenchmarkArguments(
      process.argv.slice(2),
    );
    const results = await runScenarioStartupBenchmark(options);
    if (options.json) console.log(JSON.stringify({ results }, null, 2));
    else
      for (const result of results) {
        console.log(`\n${result.scenarioId} (${result.cityDirectory})`);
        console.table(result.structure);
        console.log('Startup-path timings');
        console.table(result.startupTimingsMilliseconds);
        console.log('Standalone diagnostic decomposition timings');
        console.table(result.diagnosticTimingsMilliseconds);
      }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
