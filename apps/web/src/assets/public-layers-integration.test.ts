import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createPublicLayerLoader } from './public-layers.js';
import { createScenarioLoader } from '../scenarios/scenario-loader.js';
import { createPopulationFieldLoader } from '../population/population-field-loader.js';
import { createTerrainLoader } from '../terrain/terrain-loader.js';
import { createSettlementMetadataLoader } from '../settlement/settlement-metadata-loader.js';
import { createRoutePresentationLoader } from '../representation/route-presentation-loader.js';

it('loads the real canonical and presentation products through five lazy archives under a subpath', async () => {
  const fetchArchive = vi.fn(async (url: string) => ({
    ok: true,
    arrayBuffer: async () =>
      Uint8Array.from(
        readFileSync(
          join(import.meta.dirname, '../../public', url.slice('/game/'.length)),
        ),
      ).buffer,
  }));
  const storage = createPublicLayerLoader({ baseUrl: '/game/', fetchArchive });
  const input = {
    baseUrl: '/game/',
    fetchText: storage.fetchAsset,
    digestSha256: async (text: string) =>
      createHash('sha256').update(text).digest('hex'),
  };
  expect(fetchArchive).not.toHaveBeenCalled();
  const scenarios = createScenarioLoader(input);
  await scenarios.loadCatalog();
  expect(scenarios.projection.getState().catalog?.scenarios).toHaveLength(76);
  const scenario = await scenarios.resolveCatalogScenario(
    'torrevieja-legacy-all-v1',
  );
  expect(Object.isFrozen(scenario)).toBe(true);
  const population =
    await createPopulationFieldLoader(input).resolveScenarioPopulation(
      scenario,
    );
  expect(population.nonzeroCellCount).toBeGreaterThan(0);
  const terrainLoader = createTerrainLoader(input);
  const terrain = await terrainLoader.resolve(
    'es-torrevieja',
    scenario.manifest.scenarioId,
  );
  expect(terrain.status).toBe('ready');
  if (terrain.status !== 'ready') throw new Error('Expected native terrain');
  expect(terrain.terrain.statistics).toMatchObject({
    nativeSamples: 161680,
    landSamples: 115166,
    waterSamples: 46514,
  });
  expect(
    await terrainLoader.resolve('es-torrevieja', 'torrevieja-legacy-abc-v1'),
  ).toBe(terrain);
  const metadata =
    await createSettlementMetadataLoader(input).resolveSettlementMetadata(
      'es-torrevieja',
    );
  expect(metadata.status).toBe('ready');
  expect(
    await createRoutePresentationLoader(input).resolve(scenario),
  ).toBeDefined();
  expect(fetchArchive.mock.calls.map(([url]) => url)).toEqual([
    '/game/scenarios/scenarios.zip',
    '/game/population-fields/population-fields.zip',
    '/game/terrain/terrain.zip',
    '/game/settlement-metadata/settlement-metadata.zip',
    '/game/route-presentation/route-presentation.zip',
  ]);
});
