import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import {
  parseScenarioStartupBenchmarkArguments,
  runScenarioStartupBenchmark,
} from '../../../../scripts/scenario-startup-benchmark.mjs';
import { createPopulationFieldLoader } from '../population/population-field-loader.js';

const publicRoot = join(import.meta.dirname, '..', '..', 'public');
const fetchText = async (url: string) => {
  try {
    const text = await readFile(
      join(publicRoot, url.replace(/^\//, '')),
      'utf8',
    );
    return { ok: true, text: async () => text };
  } catch {
    return { ok: false, text: async () => '' };
  }
};
const digestSha256 = async (text: string) =>
  createHash('sha256').update(text).digest('hex');

async function loadScenario(scenarioId: string) {
  const catalogue = JSON.parse(
    await readFile(join(publicRoot, 'scenarios', 'catalog.json'), 'utf8'),
  ) as { scenarios: Array<{ scenarioId: string; manifestPath: string }> };
  const descriptor = catalogue.scenarios.find(
    (candidate) => candidate.scenarioId === scenarioId,
  )!;
  const directory = join(
    publicRoot,
    'scenarios',
    descriptor.manifestPath,
    '..',
  );
  const json = async (name: string) =>
    JSON.parse(await readFile(join(directory, name), 'utf8')) as unknown;
  return parseScenarioPackage({
    manifest: await json('scenario.json'),
    settlements: await json('settlements.json'),
    stops: await json('stops.json'),
    routes: await json('routes.json'),
    presentation: await json('presentation.json'),
    provenance: await json('provenance.json'),
  });
}

describe('scenario startup benchmark', () => {
  it('parses scenario, city, all, run-count and JSON modes strictly', () => {
    expect(
      parseScenarioStartupBenchmarkArguments([
        '--scenario',
        'torrevieja-legacy-abc-v1',
        '--runs',
        '2',
        '--json',
      ]),
    ).toEqual({
      scenario: 'torrevieja-legacy-abc-v1',
      runs: 2,
      json: true,
    });
    expect(
      parseScenarioStartupBenchmarkArguments(['--city', 'malaga-v1']),
    ).toMatchObject({
      city: 'malaga-v1',
      runs: 5,
    });
    expect(parseScenarioStartupBenchmarkArguments(['--all'])).toMatchObject({
      all: true,
    });
    expect(() => parseScenarioStartupBenchmarkArguments([])).toThrow(
      /exactly one/i,
    );
    expect(() =>
      parseScenarioStartupBenchmarkArguments(['--all', '--runs', '0']),
    ).toThrow(/positive safe integer/i);
    expect(() => parseScenarioStartupBenchmarkArguments(['--wat'])).toThrow(
      /unknown/i,
    );
  });

  it('reports stable structural metadata and stage statistics for a real scenario', async () => {
    const result = (
      await runScenarioStartupBenchmark({
        scenario: 'torrevieja-legacy-abc-v1',
        runs: 1,
        json: true,
      })
    )[0]!;
    expect(result).toMatchObject({
      scenarioId: 'torrevieja-legacy-abc-v1',
      cityDirectory: 'torrevieja-v1',
      runCount: 1,
      structure: {
        routes: 3,
        patterns: 6,
        stopNodes: 98,
        directedEdges: 111,
        itineraryStopPlaces: 79,
        itineraryPairCount: 6162,
        directItineraryPairCount: 1112,
        unavailableItineraryPairCount: 5050,
      },
      startupTimingsMilliseconds: {
        assetLoading: {
          min: expect.any(Number),
          median: expect.any(Number),
          max: expect.any(Number),
        },
        startupTotal: {
          min: expect.any(Number),
          median: expect.any(Number),
          max: expect.any(Number),
        },
      },
      diagnosticTimingsMilliseconds: {
        passengerDemandRuntimeIndexDiagnostic: {
          min: expect.any(Number),
          median: expect.any(Number),
          max: expect.any(Number),
        },
        directItineraryPlanConstruction: {
          min: expect.any(Number),
          median: expect.any(Number),
          max: expect.any(Number),
        },
        directItineraryRuntimeIndexConstruction: {
          min: expect.any(Number),
          median: expect.any(Number),
          max: expect.any(Number),
        },
        diagnosticTotal: {
          min: expect.any(Number),
          median: expect.any(Number),
          max: expect.any(Number),
        },
      },
    });
    expect(Object.keys(result.startupTimingsMilliseconds)).toEqual([
      'assetLoading',
      'scenarioParsingAndGraph',
      'populationView',
      'stopCatchmentConstruction',
      'passengerDemandPlanCreation',
      'initialAuthoritySemanticPreflight',
      'workerAuthorityCreation',
      'startupTotal',
    ]);
    expect(Object.keys(result.diagnosticTimingsMilliseconds)).toEqual([
      'passengerDemandRuntimeIndexDiagnostic',
      'directItineraryPlanConstruction',
      'directItineraryRuntimeIndexConstruction',
      'diagnosticTotal',
    ]);
    const productionPopulation = await createPopulationFieldLoader({
      baseUrl: '/',
      fetchText,
      digestSha256,
    }).resolveScenarioPopulation(
      await loadScenario('torrevieja-legacy-abc-v1'),
    );
    expect(result.demandModelContentHash).toBe(
      productionPopulation.demandModelContentHash,
    );
  }, 30_000);
});
