import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseScenarioPackage,
  type RouteId,
} from '@torrevieja-tycoon/transport-domain';
import {
  allocatePassengerDestinations,
  advanceTransportTicks,
  applyTransportVehicleCommand,
  createScenarioCoordinate,
  createTransportSimulationState,
  listPassengerDestinationCandidates,
} from '@torrevieja-tycoon/simulation';
import { createPopulationFieldLoader } from './population-field-loader.js';
import { createProductionPassengerDemandPlan } from './population-demand-plan.js';
import { createDemoVehicleCommandForAuthority } from '../transport-representation/demo-vehicle-command.js';

const root = join(import.meta.dirname, '..', '..', 'public');
const fetchText = async (url: string) => {
  try {
    const text = await readFile(join(root, url.replace(/^\//, '')), 'utf8');
    return { ok: true, text: async () => text };
  } catch {
    return { ok: false, text: async () => '' };
  }
};
const digestSha256 = async (text: string) => {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(text).digest('hex');
};
const scenario = async (scenarioId: string) => {
  const catalogue = JSON.parse(
    await readFile(join(root, 'scenarios', 'catalog.json'), 'utf8'),
  ) as { scenarios: Array<{ scenarioId: string; manifestPath: string }> };
  const descriptor = catalogue.scenarios.find(
    (candidate) => candidate.scenarioId === scenarioId,
  )!;
  const directory = join(root, 'scenarios', descriptor.manifestPath, '..');
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
};

describe('population field loader', () => {
  it.each([
    ['torrevieja-legacy-abc-v1', 'Q36730'],
    ['elche-urban-abc-v1', 'Q10509'],
    ['alicante-legacy-core-v1', 'Q11959'],
    ['benidorm-legacy-core-v1', 'Q487981'],
    ['cartagena-legacy-core-v1', 'Q162615'],
    ['murcia-circular-24-v1', 'Q12225'],
    ['malaga-lines-3-11-n1-v1', 'Q8851'],
  ])('loads the exact operational view for %s', async (scenarioId, cityId) => {
    const loader = createPopulationFieldLoader({
      baseUrl: '/',
      fetchText,
      digestSha256,
    });
    const view = await loader.resolveScenarioPopulation(
      await scenario(scenarioId),
    );
    expect(view.grid.cityId).toBe(cityId);
    expect(view.totalPopulationWeight).toBeGreaterThan(0);
    expect(view.nonzeroCellCount).toBeGreaterThan(0);
    expect(view.grid.rows).toBe(view.crop.rowEnd - view.crop.rowStart);
    expect(view.grid.columns).toBe(view.crop.columnEnd - view.crop.columnStart);
    expect(Object.isFrozen(view.grid.populationWeights[0])).toBe(true);
  });

  it('rejects unknown settlement and missing or malformed assets', async () => {
    const canonical = await scenario('torrevieja-legacy-abc-v1');
    const unknown = structuredClone(canonical) as unknown as {
      manifest: { primarySettlementId: string };
    };
    unknown.manifest.primarySettlementId = 'unknown';
    const loader = createPopulationFieldLoader({
      baseUrl: '/',
      fetchText,
      digestSha256,
    });
    await expect(
      loader.resolveScenarioPopulation(unknown as never),
    ).rejects.toThrow(/population field/i);
    const missing = createPopulationFieldLoader({
      baseUrl: '/',
      fetchText: async () => ({ ok: false, text: async () => '' }),
      digestSha256,
    });
    await expect(missing.resolveScenarioPopulation(canonical)).rejects.toThrow(
      /population/i,
    );
  });

  it('retries recoverable catalogue and asset acquisition failures', async () => {
    const canonical = await scenario('torrevieja-legacy-abc-v1');
    let failCatalogue = true;
    let failGrid = true;
    const loader = createPopulationFieldLoader({
      baseUrl: '/',
      fetchText: async (url) => {
        if (url.endsWith('catalog.json') && failCatalogue) {
          failCatalogue = false;
          return { ok: false, text: async () => '' };
        }
        if (url.includes('city-population-grid') && failGrid) {
          failGrid = false;
          return { ok: false, text: async () => '' };
        }
        return fetchText(url);
      },
      digestSha256,
    });
    await expect(loader.resolveScenarioPopulation(canonical)).rejects.toThrow(
      /catalogue unavailable/i,
    );
    await expect(loader.resolveScenarioPopulation(canonical)).rejects.toThrow(
      /asset unavailable/i,
    );
    await expect(
      loader.resolveScenarioPopulation(canonical),
    ).resolves.toMatchObject({ grid: { cityId: 'Q36730' } });
  });

  it('rejects malformed catalogues, assets, crops, and unsafe totals', async () => {
    const canonical = await scenario('torrevieja-legacy-abc-v1');
    const grid = {
      schemaVersion: '1.0.0',
      cityId: 'Q36730',
      gridVersion: '1.0.0',
      originCellCenter: { latitude: 38, longitude: -0.7 },
      resolutionDegrees: 0.001,
      rowDirection: 'north-to-south',
      columnDirection: 'west-to-east',
      rows: 1,
      columns: 1,
      populationWeights: [[1]],
    };
    const crop = {
      scenarios: [
        {
          scenarioId: canonical.manifest.scenarioId,
          contentHash: canonical.manifest.contentHash,
          crop: { rowStart: 0, rowEnd: 1, columnStart: 0, columnEnd: 1 },
        },
      ],
    };
    const make = async (
      catalogueValue: unknown,
      gridValue: unknown = grid,
      cropValue: unknown = crop,
      options: Readonly<{ omitGrid?: boolean; corruptDigest?: boolean }> = {},
    ) => {
      const gridText = JSON.stringify(gridValue);
      const cropText = JSON.stringify(cropValue);
      const catalogue =
        catalogueValue === 'valid'
          ? {
              schemaVersion: '1.0.0',
              operationalCropPolicy: { maxAccessDistanceCells: 5 },
              cities: [
                {
                  primarySettlementId: canonical.manifest.primarySettlementId,
                  gridPath: 'grid.json',
                  cropPath: 'crop.json',
                  gridSha256: await digestSha256(gridText),
                  cropSha256: await digestSha256(cropText),
                },
              ],
            }
          : catalogueValue;
      const assets = new Map([
        ['/base/population-fields/catalog.json', JSON.stringify(catalogue)],
        ['/base/population-fields/crop.json', cropText],
      ]);
      if (!options.omitGrid)
        assets.set('/base/population-fields/grid.json', gridText);
      return createPopulationFieldLoader({
        baseUrl: '/base',
        fetchText: async (url) => ({
          ok: assets.has(url),
          text: async () => assets.get(url) ?? '',
        }),
        digestSha256: options.corruptDigest
          ? async () => '0'.repeat(64)
          : digestSha256,
      });
    };
    for (const malformed of [
      {},
      {
        schemaVersion: '1.0.0',
        operationalCropPolicy: { maxAccessDistanceCells: 5 },
        cities: [null],
      },
      {
        schemaVersion: '1.0.0',
        operationalCropPolicy: { maxAccessDistanceCells: 5 },
        cities: [
          {
            primarySettlementId: '',
            gridPath: 'g',
            cropPath: 'c',
            gridSha256: 'x',
            cropSha256: 'x',
          },
        ],
      },
      {
        schemaVersion: '1.0.0',
        operationalCropPolicy: { maxAccessDistanceCells: 5 },
        cities: [
          {
            primarySettlementId: 'city',
            gridPath: 'g',
            cropPath: 'c',
            gridSha256: 'x'.repeat(64),
            cropSha256: 'x'.repeat(64),
          },
        ],
      },
      {
        schemaVersion: '1.0.0',
        operationalCropPolicy: { maxAccessDistanceCells: 5 },
        cities: [
          {
            primarySettlementId: 'city',
            gridPath: 3,
            cropPath: 'c',
            gridSha256: 'a'.repeat(64),
            cropSha256: 'a'.repeat(64),
          },
        ],
      },
      {
        schemaVersion: '1.0.0',
        operationalCropPolicy: { maxAccessDistanceCells: 5 },
        cities: [
          {
            primarySettlementId: 'city',
            gridPath: 'g',
            cropPath: 'c',
            gridSha256: 'a'.repeat(64),
            cropSha256: 'x'.repeat(64),
          },
        ],
      },
    ])
      await expect(
        (await make(malformed)).resolveScenarioPopulation(canonical),
      ).rejects.toThrow(/population field/i);

    await expect(
      (await make('valid', grid, {})).resolveScenarioPopulation(canonical),
    ).rejects.toThrow(/crop/i);
    await expect(
      (await make('valid', grid, { scenarios: [] })).resolveScenarioPopulation(
        canonical,
      ),
    ).rejects.toThrow(/crop missing/i);
    await expect(
      (
        await make('valid', grid, {
          scenarios: [
            {
              scenarioId: canonical.manifest.scenarioId,
              contentHash: canonical.manifest.contentHash,
              crop: { rowStart: -1, rowEnd: 1, columnStart: 0, columnEnd: 1 },
            },
          ],
        })
      ).resolveScenarioPopulation(canonical),
    ).rejects.toThrow(/rowStart/i);
    await expect(
      (
        await make('valid', grid, {
          scenarios: [
            {
              scenarioId: canonical.manifest.scenarioId,
              contentHash: canonical.manifest.contentHash,
              crop: { rowStart: 0, rowEnd: 2, columnStart: 0, columnEnd: 1 },
            },
          ],
        })
      ).resolveScenarioPopulation(canonical),
    ).rejects.toThrow(/outside canonical grid/i);
    await expect(
      (
        await make(
          'valid',
          {
            ...grid,
            columns: 2,
            populationWeights: [[Number.MAX_SAFE_INTEGER, 1]],
          },
          {
            scenarios: [
              {
                scenarioId: canonical.manifest.scenarioId,
                contentHash: canonical.manifest.contentHash,
                crop: { rowStart: 0, rowEnd: 1, columnStart: 0, columnEnd: 2 },
              },
            ],
          },
        )
      ).resolveScenarioPopulation(canonical),
    ).rejects.toThrow(/overflow/i);

    const cached = await make('valid');
    await cached.resolveScenarioPopulation(canonical);
    await expect(
      cached.resolveScenarioPopulation(canonical),
    ).resolves.toBeDefined();
    await expect(
      (
        await make('valid', grid, crop, { omitGrid: true })
      ).resolveScenarioPopulation(canonical),
    ).rejects.toThrow(/asset unavailable/i);
    await expect(
      (
        await make('valid', grid, crop, { corruptDigest: true })
      ).resolveScenarioPopulation(canonical),
    ).rejects.toThrow(/integrity mismatch/i);
  });

  it('builds a reproducible active Torrevieja demand plan from public assets', async () => {
    const canonical = await scenario('torrevieja-legacy-abc-v1');
    const loader = createPopulationFieldLoader({
      baseUrl: '/',
      fetchText,
      digestSha256,
    });
    const population = await loader.resolveScenarioPopulation(canonical);
    const plan = createProductionPassengerDemandPlan({
      scenario: canonical,
      population,
    });
    expect(() =>
      createProductionPassengerDemandPlan({
        scenario: canonical,
        population: {
          ...population,
          operationalCropPolicy: { maxAccessDistanceCells: 4 },
        },
      }),
    ).toThrow(/crop policy/i);
    expect(
      createProductionPassengerDemandPlan({ scenario: canonical, population }),
    ).toEqual(plan);
    expect(
      createProductionPassengerDemandPlan({
        scenario: canonical,
        population: { ...population, cropSha256: 'f'.repeat(64) },
      }).demandModelContentHash,
    ).toBe(plan.demandModelContentHash);
    const initial = createTransportSimulationState(canonical, 0, plan);
    if (
      initial.passengerDemand.status !== 'active' ||
      !initial.passengerDirectItineraryIndex
    )
      throw new Error('Expected active passenger authority.');
    const itineraryIndex = initial.passengerDirectItineraryIndex;
    const stopNodePlaces = new Map(
      canonical.stops.stopNodes.map((node) => [
        node.stopNodeId,
        node.stopPlaceId,
      ]),
    );
    const placesByRoute = new Map(
      canonical.routes.routes.map((route) => [
        route.routeId,
        new Set(
          route.patterns.flatMap((pattern) =>
            pattern.stopNodeIds.flatMap((stopNodeId) => {
              const stopPlaceId = stopNodePlaces.get(stopNodeId);
              return stopPlaceId === null || stopPlaceId === undefined
                ? []
                : [stopPlaceId];
            }),
          ),
        ),
      ]),
    );
    const exclusiveOrigin = (routeId: RouteId) =>
      [...placesByRoute.get(routeId)!]
        .filter((stopPlaceId) =>
          [...placesByRoute].every(
            ([candidateRouteId, places]) =>
              candidateRouteId === routeId || !places.has(stopPlaceId),
          ),
        )
        .sort()[0]!;
    const metrics = canonical.routes.routes.map(({ routeId }) => {
      const originStopPlaceId = exclusiveOrigin(routeId);
      const candidates = listPassengerDestinationCandidates(
        plan,
        originStopPlaceId,
      );
      const allocations = allocatePassengerDestinations(
        candidates,
        0,
        80,
        plan.demandModelContentHash,
        originStopPlaceId,
      ).allocations.filter(({ count }) => count > 0);
      let remainingBaseline = 80;
      const baselineByPlace = new Map<string, number>();
      let baselineAvailable = 0;
      for (const candidate of candidates) {
        const count = Math.min(remainingBaseline, candidate.weight);
        if (count === 0) break;
        baselineByPlace.set(
          candidate.destinationStopPlaceId,
          (baselineByPlace.get(candidate.destinationStopPlaceId) ?? 0) + count,
        );
        if (
          itineraryIndex.find(
            originStopPlaceId,
            candidate.destinationStopPlaceId,
          ) !== undefined
        )
          baselineAvailable += count;
        remainingBaseline -= count;
      }
      const byPlace = new Map<string, number>();
      let available = 0;
      for (const allocation of allocations) {
        byPlace.set(
          allocation.destinationStopPlaceId,
          (byPlace.get(allocation.destinationStopPlaceId) ?? 0) +
            allocation.count,
        );
        if (
          itineraryIndex.find(
            originStopPlaceId,
            allocation.destinationStopPlaceId,
          ) !== undefined
        )
          available += allocation.count;
      }
      return {
        routeId,
        originStopPlaceId,
        distinctCells: allocations.length,
        distinctStopPlaces: byPlace.size,
        largestStopPlaceCount: Math.max(...byPlace.values()),
        available,
        unavailable: 80 - available,
        observedPrefixCount:
          (byPlace.get('tv-place-0067') ?? 0) +
          (byPlace.get('tv-place-0093') ?? 0),
        baseline: {
          distinctStopPlaces: baselineByPlace.size,
          largestStopPlaceCount: Math.max(...baselineByPlace.values()),
          available: baselineAvailable,
          unavailable: 80 - baselineAvailable,
          observedPrefixCount:
            (baselineByPlace.get('tv-place-0067') ?? 0) +
            (baselineByPlace.get('tv-place-0093') ?? 0),
        },
      };
    });
    expect(metrics).toEqual([
      {
        routeId: 'legacy-A',
        originStopPlaceId: 'tv-place-0053',
        distinctCells: 80,
        distinctStopPlaces: 40,
        largestStopPlaceCount: 6,
        available: 2,
        unavailable: 78,
        observedPrefixCount: 1,
        baseline: {
          distinctStopPlaces: 1,
          largestStopPlaceCount: 80,
          available: 80,
          unavailable: 0,
          observedPrefixCount: 80,
        },
      },
      {
        routeId: 'legacy-B',
        originStopPlaceId: 'tv-place-0033',
        distinctCells: 80,
        distinctStopPlaces: 41,
        largestStopPlaceCount: 8,
        available: 4,
        unavailable: 76,
        observedPrefixCount: 1,
        baseline: {
          distinctStopPlaces: 1,
          largestStopPlaceCount: 80,
          available: 0,
          unavailable: 80,
          observedPrefixCount: 80,
        },
      },
      {
        routeId: 'legacy-C',
        originStopPlaceId: 'tv-place-0031',
        distinctCells: 80,
        distinctStopPlaces: 39,
        largestStopPlaceCount: 9,
        available: 18,
        unavailable: 62,
        observedPrefixCount: 0,
        baseline: {
          distinctStopPlaces: 1,
          largestStopPlaceCount: 80,
          available: 0,
          unavailable: 80,
          observedPrefixCount: 80,
        },
      },
    ]);
    const firstQualifyingTick = Math.min(
      ...plan.cells
        .filter((cell) => cell.populationWeight > 0)
        .map((cell) =>
          Math.ceil(
            plan.emissionPolicy.creditsPerPassenger /
              (cell.populationWeight *
                plan.emissionPolicy.emissionCreditsPerWeightPerTick),
          ),
        ),
    );
    expect(firstQualifyingTick).toBe(154);
    expect(
      plan.cells.reduce(
        (total, cell) =>
          total +
          Math.floor(
            (cell.populationWeight *
              plan.emissionPolicy.emissionCreditsPerWeightPerTick *
              200) /
              plan.emissionPolicy.creditsPerPassenger,
          ),
        0,
      ),
    ).toBe(28);
    const beforeEmission = advanceTransportTicks(initial, 153);
    if (beforeEmission.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    expect(beforeEmission.passengerDemand.totalEmittedPassengerCount).toBe(0);
    const firstEmission = advanceTransportTicks(beforeEmission, 1);
    if (firstEmission.passengerDemand.status !== 'active')
      throw new Error('Expected active passenger authority.');
    expect(firstEmission.passengerDemand.totalEmittedPassengerCount).toBe(1);
    const advanced = advanceTransportTicks(firstEmission, 46);
    expect(advanced.passengerDemand.status).toBe('active');
    if (advanced.passengerDemand.status === 'active') {
      expect(advanced.tick).toBe(200);
      expect(advanced.passengerDemand.totalEmittedPassengerCount).toBe(28);
      expect(
        advanced.passengerDemand.totalWaitingForVehiclePassengerCount,
      ).toBe(9);
      expect(advanced.passengerDemand.totalBoardedPassengerCount).toBe(0);
      expect(advanced.passengerDemand.totalOnboardPassengerCount).toBe(0);
      expect(advanced.passengerDemand.totalCompletedJourneyPassengerCount).toBe(
        0,
      );
      const originCohort = advanced.passengerDemand.waitingCohorts.find(
        (cohort) => cohort.originOccurrenceIndex === 0,
      );
      expect(originCohort).toBeDefined();
      expect(['legacy-A', 'legacy-B', 'legacy-C']).toContain(
        originCohort?.routeId,
      );
      const command = createDemoVehicleCommandForAuthority(
        createScenarioCoordinate(canonical),
        () => canonical,
        [],
        originCohort?.routeId,
      );
      const boarded = applyTransportVehicleCommand(advanced, command);
      if (boarded.passengerDemand.status === 'active') {
        expect(
          boarded.passengerDemand.totalBoardedPassengerCount,
        ).toBeGreaterThan(0);
        expect(boarded.passengerDemand.totalOnboardPassengerCount).toBe(
          boarded.passengerDemand.totalBoardedPassengerCount,
        );
      }
    }
  }, 240_000);
});
