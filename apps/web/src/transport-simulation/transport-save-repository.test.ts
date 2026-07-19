import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createScenarioCoordinate,
  createTransportSimulationSnapshot,
  createTransportSimulationState,
} from '@torrevieja-tycoon/simulation';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTransportSaveRecord } from './transport-save-record.js';
import {
  createDexieTransportSaveRepository,
  createInMemoryTransportSaveRepository,
  deleteTransportSaveDatabase,
} from './transport-save-repository.js';

const root = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'transport-domain',
  'fixtures',
  'torrevieja-mini-v1',
);
const json = (name: string) =>
  JSON.parse(readFileSync(join(root, name), 'utf8')) as unknown;
const scenario = () =>
  parseScenarioPackage({
    manifest: json('scenario.json'),
    settlements: json('settlements.json'),
    stops: json('stops.json'),
    routes: json('routes.json'),
    presentation: json('presentation.json'),
    provenance: json('provenance.json'),
  });
const record = () => {
  const value = scenario();
  return parseTransportSaveRecord({
    kind: 'transport-save-record',
    schemaVersion: 1,
    saveId: 'slot',
    gameId: 'game',
    sourceTimelineId: 'timeline',
    sourceCommandRevision: 0,
    sourceSimulationTick: 5,
    sourceStreamOffset: 0,
    createdAtUtcMs: 1,
    updatedAtUtcMs: 2,
    scenario: createScenarioCoordinate(value),
    snapshot: createTransportSimulationSnapshot(
      createTransportSimulationState(value, 5),
    ),
  });
};
const legacy = {
  kind: 'foundation-save-record',
  schemaVersion: 1,
  saveId: 'legacy',
  gameId: 'game',
  sourceTimelineId: 'old',
  sourceCommandRevision: 0,
  sourceSimulationTick: 0,
  sourceStreamOffset: 0,
  createdAtUtcMs: 1,
  updatedAtUtcMs: 1,
  snapshot: {
    kind: 'foundation-simulation-snapshot',
    schemaVersion: 1,
    simulationVersion: 'foundation-1',
    state: { tick: 0 },
  },
};

describe.each([
  ['memory', () => createInMemoryTransportSaveRepository([legacy])],
  ['dexie', () => createDexieTransportSaveRepository('transport-contract')],
] as const)('%s transport repository', (_name, create) => {
  afterEach(async () => deleteTransportSaveDatabase('transport-contract'));
  it('stores current records, lists compatibility, and overwrites deterministically', async () => {
    const repository = create();
    await repository.put(record());
    expect(await repository.get('slot')).toMatchObject({
      kind: 'transport-save-record',
    });
    const list = await repository.list();
    expect(list.some((item) => item.classification === 'current')).toBe(true);
    await repository.delete('slot');
    expect(await repository.get('slot')).toBeUndefined();
    await repository.close();
    await repository.close();
    await expect(repository.list()).rejects.toThrow('closed');
  });
});

it('validates repository construction and classifies seeded legacy data', async () => {
  expect(() => createDexieTransportSaveRepository(' ')).toThrow('required');
  const repository = createInMemoryTransportSaveRepository([
    legacy,
    {},
    { saveId: 1 },
  ]);
  expect(await repository.list()).toMatchObject([
    { classification: 'legacy-foundation' },
  ]);
  await repository.close();
});
