import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  buildStopCatchments,
  listActivePopulationCells,
  parseCityPopulationGrid,
  parseScenarioPackage,
} from '../packages/transport-domain/dist/index.js';
import { createPassengerDemandPlan } from '../packages/simulation/dist/index.js';

const root = process.cwd().replaceAll('\\', '/').endsWith('/apps/web')
  ? resolve(process.cwd(), '..', '..')
  : process.cwd();
export const benchmarkPublicRoot = join(root, 'apps/web/public');
const json = (text) => JSON.parse(text);
const digest = (value) => createHash('sha256').update(value).digest('hex');
const scenarioAssetNames = Object.freeze([
  'scenario.json',
  'settlements.json',
  'stops.json',
  'routes.json',
  'presentation.json',
  'provenance.json',
]);

export async function loadBenchmarkCatalogues() {
  const [scenarioText, populationText] = await Promise.all([
    readFile(join(benchmarkPublicRoot, 'scenarios/catalog.json'), 'utf8'),
    readFile(
      join(benchmarkPublicRoot, 'population-fields/catalog.json'),
      'utf8',
    ),
  ]);
  return Object.freeze({
    scenarioCatalogue: json(scenarioText),
    populationCatalogue: json(populationText),
  });
}

export function findBenchmarkScenarioDescriptor(catalogue, scenarioId) {
  const descriptor = catalogue.scenarios.find(
    (entry) => entry.scenarioId === scenarioId,
  );
  if (!descriptor) throw new Error(`Unknown scenario ${scenarioId}.`);
  return descriptor;
}

export async function loadBenchmarkAssets(descriptor, populationCatalogue) {
  const populationEntry = populationCatalogue.cities.find(
    (entry) => entry.primarySettlementId === descriptor.primarySettlementId,
  );
  if (!populationEntry)
    throw new Error(`No population field for ${descriptor.scenarioId}.`);
  const scenarioDirectory = join(
    benchmarkPublicRoot,
    'scenarios',
    dirname(descriptor.manifestPath),
  );
  const [scenarioTexts, gridText, cropText] = await Promise.all([
    Promise.all(
      scenarioAssetNames.map((name) =>
        readFile(join(scenarioDirectory, name), 'utf8'),
      ),
    ),
    readFile(
      join(benchmarkPublicRoot, 'population-fields', populationEntry.gridPath),
      'utf8',
    ),
    readFile(
      join(benchmarkPublicRoot, 'population-fields', populationEntry.cropPath),
      'utf8',
    ),
  ]);
  return Object.freeze({
    scenarioTexts,
    gridText,
    cropText,
    populationEntry,
  });
}

export function parseBenchmarkScenario(scenarioTexts) {
  const values = scenarioTexts.map(json);
  return parseScenarioPackage({
    manifest: values[0],
    settlements: values[1],
    stops: values[2],
    routes: values[3],
    presentation: values[4],
    provenance: values[5],
  });
}

export function cropBenchmarkGrid(canonical, crop) {
  return parseCityPopulationGrid({
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
}

export function prepareBenchmarkPopulationView(descriptor, assets) {
  const canonicalGrid = parseCityPopulationGrid(json(assets.gridText));
  const cropDocument = json(assets.cropText);
  const crop = cropDocument.scenarios.find(
    (entry) => entry.scenarioId === descriptor.scenarioId,
  )?.crop;
  if (!crop) throw new Error(`Missing crop for ${descriptor.scenarioId}.`);
  const grid = cropBenchmarkGrid(canonicalGrid, crop);
  return Object.freeze({
    canonicalGrid,
    grid,
    crop,
    activeCells: listActivePopulationCells(grid),
  });
}

export function buildBenchmarkCatchment(
  scenario,
  populationView,
  populationCatalogue,
) {
  return buildStopCatchments({
    grid: populationView.grid,
    scenario,
    maxAccessDistanceCells:
      populationCatalogue.operationalCropPolicy.maxAccessDistanceCells,
  });
}

export function createBenchmarkPassengerDemandPlan(
  catchment,
  populationView,
  populationEntry,
  populationCatalogue,
) {
  return createPassengerDemandPlan({
    catchment,
    demandModelContentHash: digest(
      JSON.stringify({
        kind: 'population-demand-model-v1',
        gridSha256: populationEntry.gridSha256,
        rowStart: populationView.crop.rowStart,
        rowEnd: populationView.crop.rowEnd,
        columnStart: populationView.crop.columnStart,
        columnEnd: populationView.crop.columnEnd,
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
}

export async function prepareBenchmarkScenario(scenarioId) {
  const { scenarioCatalogue, populationCatalogue } =
    await loadBenchmarkCatalogues();
  const descriptor = findBenchmarkScenarioDescriptor(
    scenarioCatalogue,
    scenarioId,
  );
  const assets = await loadBenchmarkAssets(descriptor, populationCatalogue);
  const scenario = parseBenchmarkScenario(assets.scenarioTexts);
  const populationView = prepareBenchmarkPopulationView(descriptor, assets);
  const catchment = buildBenchmarkCatchment(
    scenario,
    populationView,
    populationCatalogue,
  );
  const demandPlan = createBenchmarkPassengerDemandPlan(
    catchment,
    populationView,
    assets.populationEntry,
    populationCatalogue,
  );
  return Object.freeze({
    descriptor,
    scenario,
    populationView,
    demandPlan,
  });
}
