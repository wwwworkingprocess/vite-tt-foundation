import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  buildDirectedScenarioGraph,
  buildStopCatchments,
  listActivePopulationCells,
  parseCityPopulationGrid,
  parseScenarioPackage,
} from '../packages/transport-domain/dist/index.js';
import {
  buildPassengerDirectItineraryPlan,
  createPassengerDirectItineraryRuntimeIndex,
} from '../packages/simulation/dist/passenger-direct-itinerary.js';
import { passengerDemandRuntimeIndex } from '../packages/simulation/dist/passenger-demand-runtime.js';
import {
  createPassengerDemandPlan,
  createTransportSimulationState,
} from '../packages/simulation/dist/index.js';

const root = process.cwd().replaceAll('\\', '/').endsWith('/apps/web')
  ? resolve(process.cwd(), '..', '..')
  : process.cwd();
const publicRoot = join(root, 'apps/web/public');
const json = (text) => JSON.parse(text);
const digest = (value) => createHash('sha256').update(value).digest('hex');

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

const cropGrid = (canonical, crop) =>
  parseCityPopulationGrid({
    ...canonical,
    originCellCenter: {
      latitude:
        canonical.originCellCenter.latitude -
        crop.rowStart * canonical.resolutionDegrees,
      longitude:
        canonical.originCellCenter.longitude +
        crop.columnStart * canonical.resolutionDegrees,
    },
    rows: crop.rowEnd - crop.rowStart,
    columns: crop.columnEnd - crop.columnStart,
    populationWeights: canonical.populationWeights
      .slice(crop.rowStart, crop.rowEnd)
      .map((row) => row.slice(crop.columnStart, crop.columnEnd)),
  });

async function measureScenario(descriptor, populationCatalogue) {
  const startupTimings = {};
  const diagnosticTimings = {};
  const time = async (timings, name, operation) => {
    const start = performance.now();
    const value = await operation();
    timings[name] = performance.now() - start;
    return value;
  };
  const scenarioDirectory = join(
    publicRoot,
    'scenarios',
    dirname(descriptor.manifestPath),
  );
  const populationEntry = populationCatalogue.cities.find(
    (entry) => entry.primarySettlementId === descriptor.primarySettlementId,
  );
  if (!populationEntry)
    throw new Error(`No population field for ${descriptor.scenarioId}.`);
  const assets = await time(startupTimings, 'assetLoading', async () => {
    const scenarioNames = [
      'scenario.json',
      'settlements.json',
      'stops.json',
      'routes.json',
      'presentation.json',
      'provenance.json',
    ];
    const [scenarioTexts, gridText, cropText] = await Promise.all([
      Promise.all(
        scenarioNames.map((name) =>
          readFile(join(scenarioDirectory, name), 'utf8'),
        ),
      ),
      readFile(
        join(publicRoot, 'population-fields', populationEntry.gridPath),
        'utf8',
      ),
      readFile(
        join(publicRoot, 'population-fields', populationEntry.cropPath),
        'utf8',
      ),
    ]);
    return { scenarioTexts, gridText, cropText };
  });
  const scenario = await time(
    startupTimings,
    'scenarioParsingAndGraph',
    async () => {
      const values = assets.scenarioTexts.map(json);
      const parsed = parseScenarioPackage({
        manifest: values[0],
        settlements: values[1],
        stops: values[2],
        routes: values[3],
        presentation: values[4],
        provenance: values[5],
      });
      buildDirectedScenarioGraph(parsed);
      return parsed;
    },
  );
  let canonicalGrid;
  let grid;
  let crop;
  let activeCells;
  await time(startupTimings, 'populationView', async () => {
    canonicalGrid = parseCityPopulationGrid(json(assets.gridText));
    const cropDocument = json(assets.cropText);
    crop = cropDocument.scenarios.find(
      (entry) => entry.scenarioId === descriptor.scenarioId,
    )?.crop;
    if (!crop) throw new Error(`Missing crop for ${descriptor.scenarioId}.`);
    grid = cropGrid(canonicalGrid, crop);
    activeCells = listActivePopulationCells(grid);
  });
  let demandPlan;
  let catchment;
  let itinerary;
  await time(startupTimings, 'stopCatchmentConstruction', async () => {
    catchment = buildStopCatchments({
      grid,
      scenario,
      maxAccessDistanceCells:
        populationCatalogue.operationalCropPolicy.maxAccessDistanceCells,
    });
  });
  await time(startupTimings, 'passengerDemandPlanCreation', async () => {
    demandPlan = createPassengerDemandPlan({
      catchment,
      demandModelContentHash: digest(
        JSON.stringify({
          kind: 'population-demand-model-v1',
          gridSha256: populationEntry.gridSha256,
          rowStart: crop.rowStart,
          rowEnd: crop.rowEnd,
          columnStart: crop.columnStart,
          columnEnd: crop.columnEnd,
          maxAccessDistanceCells:
            populationCatalogue.operationalCropPolicy.maxAccessDistanceCells,
        }),
      ),
      emissionPolicy: {
        emissionCreditsPerWeightPerTick: 1,
        creditsPerPassenger: 50_000,
      },
      accessPolicy: { accessTicksPerCell: 1 },
    });
  });
  await time(
    diagnosticTimings,
    'passengerDemandRuntimeIndexDiagnostic',
    async () => {
      passengerDemandRuntimeIndex(demandPlan);
    },
  );
  await time(diagnosticTimings, 'directItineraryPlanConstruction', async () => {
    itinerary = buildPassengerDirectItineraryPlan({ scenario, demandPlan });
  });
  await time(
    diagnosticTimings,
    'directItineraryRuntimeIndexConstruction',
    async () => {
      createPassengerDirectItineraryRuntimeIndex({
        plan: itinerary,
        scenario,
        demandPlan,
      });
    },
  );
  await time(startupTimings, 'initialAuthoritySemanticPreflight', async () => {
    createTransportSimulationState(scenario, 0, demandPlan);
  });
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
    }),
  });
}

export async function runScenarioStartupBenchmark(options) {
  const scenarioCatalogue = json(
    await readFile(join(publicRoot, 'scenarios', 'catalog.json'), 'utf8'),
  );
  const populationCatalogue = json(
    await readFile(
      join(publicRoot, 'population-fields', 'catalog.json'),
      'utf8',
    ),
  );
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
