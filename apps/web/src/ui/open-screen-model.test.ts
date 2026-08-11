import { afterEach, describe, expect, it, vi } from 'vitest';
import * as repositoryModule from '../transport-simulation/transport-save-repository.js';
import { parseScenarioCatalog } from '@torrevieja-tycoon/transport-domain';
import {
  createCityScenarioGroups,
  discoverBrowserSave,
  formatLastPlayed,
  type CityNameLookup,
} from './open-screen-model.js';

afterEach(() => vi.restoreAllMocks());

const catalog = parseScenarioCatalog({
  schemaVersion: '1.0.0' as const,
  catalogId: 'catalog',
  scenarios: [
    {
      scenarioId: 'a-1',
      scenarioVersion: '1.0.0',
      title: 'A first',
      primarySettlementId: 'city-a',
      settlementIds: ['city-a'],
      manifestPath: 'a-1/scenario.json',
      status: 'development-seed' as const,
      contentHash: 'a'.repeat(64),
    },
    {
      scenarioId: 'b-1',
      scenarioVersion: '1.0.0',
      title: 'B first',
      primarySettlementId: 'city-b',
      settlementIds: ['city-b'],
      manifestPath: 'b-1/scenario.json',
      status: 'development-seed' as const,
      contentHash: 'b'.repeat(64),
    },
    {
      scenarioId: 'a-2',
      scenarioVersion: '1.0.0',
      title: 'A second',
      primarySettlementId: 'city-a',
      settlementIds: ['city-a'],
      manifestPath: 'a-2/scenario.json',
      status: 'development-seed' as const,
      contentHash: 'c'.repeat(64),
    },
  ],
});

describe('open-screen presentation model', () => {
  it('groups catalogue scenarios by canonical primary settlement without changing catalogue order', () => {
    const names: CityNameLookup = Object.freeze({
      'city-a': 'City A',
      'city-b': 'City B',
    });
    const groups = createCityScenarioGroups(catalog, names);
    expect(groups.map(({ cityId, name }) => ({ cityId, name }))).toEqual([
      { cityId: 'city-a', name: 'City A' },
      { cityId: 'city-b', name: 'City B' },
    ]);
    expect(groups[0]!.scenarios.map(({ scenarioId }) => scenarioId)).toEqual([
      'a-1',
      'a-2',
    ]);
    expect(Object.isFrozen(groups)).toBe(true);
    expect(Object.isFrozen(groups[0]!.scenarios)).toBe(true);
    expect(createCityScenarioGroups(catalog, {})[0]!.name).toBe('city-a');
    expect(createCityScenarioGroups(catalog, names)).toEqual(groups);
  });

  it('formats injected wall-clock metadata without changing any authority', () => {
    const hour = 60 * 60 * 1_000;
    expect(formatLastPlayed(10 * hour, 12 * hour)).toBe(
      'Last played 2 hours ago',
    );
    expect(formatLastPlayed(10 * hour, 10 * hour)).toBe('Last played just now');
    expect(formatLastPlayed(10 * hour, 10 * hour + 30_000)).toBe(
      'Last played just now',
    );
    expect(formatLastPlayed(0, 60_000)).toBe('Last played 1 minute ago');
    expect(formatLastPlayed(0, 120_000)).toBe('Last played 2 minutes ago');
    expect(formatLastPlayed(0, hour)).toBe('Last played 1 hour ago');
    expect(formatLastPlayed(0, 24 * hour)).toBe('Last played 1 day ago');
    expect(formatLastPlayed(0, 48 * hour)).toBe('Last played 2 days ago');
    expect(formatLastPlayed(11 * hour, 10 * hour)).toBe('Last played just now');
    expect(() => formatLastPlayed(-1, 0)).toThrow('Last-played metadata');
    expect(() => formatLastPlayed(Number.MAX_SAFE_INTEGER + 1, 0)).toThrow(
      'Last-played metadata',
    );
    expect(() => formatLastPlayed(0, Number.MAX_SAFE_INTEGER + 1)).toThrow(
      'Last-played metadata',
    );
  });

  it('discovers the newest current save without restoring authority', async () => {
    const close = vi.fn(async () => undefined);
    vi.spyOn(
      repositoryModule,
      'createDexieTransportSaveRepository',
    ).mockReturnValue({
      list: vi.fn(async () => [
        { classification: 'unrelated' },
        {
          classification: 'current',
          summary: { saveId: 'z', updatedAtUtcMs: 10 },
        },
        {
          classification: 'current',
          summary: { saveId: 'a', updatedAtUtcMs: 10 },
        },
      ]),
      close,
    } as never);
    expect((await discoverBrowserSave()).resumableSave?.saveId).toBe('a');
    expect(close).toHaveBeenCalledOnce();
  });

  it('reports obsolete discovery and closes the adapter', async () => {
    const close = vi.fn(async () => undefined);
    vi.spyOn(
      repositoryModule,
      'createDexieTransportSaveRepository',
    ).mockReturnValue({
      list: vi.fn(async () => [{ classification: 'obsolete' }]),
      close,
    } as never);
    expect(await discoverBrowserSave()).toEqual({
      resumableSave: undefined,
      unavailableSaveMessage:
        'A previous save exists but is unavailable in this version.',
    });
    expect(close).toHaveBeenCalledOnce();
  });
});
