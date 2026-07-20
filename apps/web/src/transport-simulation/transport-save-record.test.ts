import { describe, expect, it } from 'vitest';
import {
  createScenarioCoordinate,
  createTransportSimulationSnapshot,
  createTransportSimulationState,
} from '@torrevieja-tycoon/simulation';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyPersistedSaveRecord,
  migrateTransportSaveRecordV1,
  parseTransportSaveRecord,
  summarizeCompatibleSave,
} from './transport-save-record.js';

const fixtureRoot = join(
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
  JSON.parse(readFileSync(join(fixtureRoot, name), 'utf8')) as unknown;
const scenario = () =>
  parseScenarioPackage({
    manifest: json('scenario.json'),
    settlements: json('settlements.json'),
    stops: json('stops.json'),
    routes: json('routes.json'),
    presentation: json('presentation.json'),
    provenance: json('provenance.json'),
  });
const current = () => {
  const canonical = scenario();
  return {
    kind: 'transport-save-record',
    schemaVersion: 2,
    saveId: 'foundation-slot',
    label: 'Mini save',
    gameId: 'game-fixture',
    sourceTimelineId: 'timeline-source',
    sourceCommandRevision: 7,
    sourceSimulationTick: 120,
    sourceStreamOffset: 7,
    createdAtUtcMs: 100,
    updatedAtUtcMs: 200,
    scenario: createScenarioCoordinate(canonical),
    snapshot: createTransportSimulationSnapshot(
      createTransportSimulationState(canonical, 120),
    ),
  };
};

describe('transport save compatibility', () => {
  it.each([null, undefined, 0, 'save', [], {}, { kind: 'other-save' }])(
    'classifies unrelated value %j without throwing',
    (value) => {
      const result = classifyPersistedSaveRecord(value);
      expect(result).toEqual({ classification: 'unrelated' });
      expect(Object.isFrozen(result)).toBe(true);
    },
  );

  it('distinguishes malformed versions from numeric future versions', () => {
    expect(
      classifyPersistedSaveRecord({
        kind: 'transport-save-record',
        schemaVersion: 3,
      }),
    ).toMatchObject({ classification: 'unsupported-future' });
    for (const schemaVersion of [undefined, '3', -1, 1.5])
      expect(
        classifyPersistedSaveRecord({
          kind: 'transport-save-record',
          schemaVersion,
        }),
      ).toMatchObject({ classification: 'malformed-known' });
  });
  it('parses, freezes, and summarizes a current transport record', () => {
    const record = parseTransportSaveRecord(current());
    expect(summarizeCompatibleSave(record)).toMatchObject({
      compatibility: 'current',
      scenarioId: 'torrevieja-mini-v1',
      sourceSimulationTick: 120,
    });
    expect(Object.isFrozen(record.snapshot.scenario)).toBe(true);
  });

  it('classifies legacy foundation data as incompatible rather than corrupt', () => {
    const legacy = {
      kind: 'foundation-save-record',
      schemaVersion: 1,
      saveId: 'legacy',
      label: 'Legacy',
      gameId: 'game-fixture',
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
    expect(classifyPersistedSaveRecord(legacy)).toMatchObject({
      classification: 'legacy-foundation',
      summary: { saveId: 'legacy', compatibility: 'legacy-incompatible' },
    });
  });

  it('classifies Transport V1 as migratable and migrates only when requested', () => {
    const canonical = scenario();
    const value = {
      ...current(),
      schemaVersion: 1,
      snapshot: {
        kind: 'transport-simulation-snapshot',
        schemaVersion: 1,
        simulationVersion: 'transport-1',
        scenario: createScenarioCoordinate(canonical),
        state: { tick: 120 },
      },
    };
    const classified = classifyPersistedSaveRecord(value);
    expect(classified).toMatchObject({
      classification: 'migratable-transport-v1',
      summary: {
        compatibility: 'migratable',
        snapshotVersion: 1,
        vehicleCount: 0,
      },
    });
    if (classified.classification !== 'migratable-transport-v1')
      throw new Error('Expected a migratable Transport V1 record.');
    const migrated = migrateTransportSaveRecordV1(classified.record);
    expect(migrated).toMatchObject({
      schemaVersion: 2,
      snapshot: {
        schemaVersion: 2,
        state: { tick: 120, fleet: [] },
      },
    });
    expect(Object.isFrozen(migrated.snapshot.state.fleet)).toBe(true);
  });

  it('distinguishes malformed known and unsupported future records', () => {
    expect(
      classifyPersistedSaveRecord({
        kind: 'transport-save-record',
        schemaVersion: 99,
        saveId: 'future',
      }),
    ).toMatchObject({ classification: 'unsupported-future' });
    expect(
      classifyPersistedSaveRecord({
        ...current(),
        snapshot: { ...current().snapshot, state: { tick: 999 } },
      }),
    ).toMatchObject({ classification: 'malformed-known' });
  });

  it.each([
    [
      'scenario',
      (value: ReturnType<typeof current>) => {
        value.scenario = { ...value.scenario, contentHash: '0'.repeat(64) };
      },
    ],
    [
      'tick',
      (value: ReturnType<typeof current>) => {
        value.sourceSimulationTick = 121;
      },
    ],
    [
      'timestamps',
      (value: ReturnType<typeof current>) => {
        value.updatedAtUtcMs = 99;
      },
    ],
  ])('rejects inconsistent current %s coordinates', (_name, mutate) => {
    const value = current();
    mutate(value);
    expect(() => parseTransportSaveRecord(value)).toThrow('inconsistent');
  });

  it('validates V1 consistency and supports summaries without labels', () => {
    const value = current();
    delete (value as { label?: string }).label;
    const parsed = parseTransportSaveRecord(value);
    expect(summarizeCompatibleSave(parsed)).not.toHaveProperty('label');
    const v1 = {
      ...value,
      schemaVersion: 1,
      sourceSimulationTick: 121,
      snapshot: {
        kind: 'transport-simulation-snapshot',
        schemaVersion: 1,
        simulationVersion: 'transport-1',
        scenario: value.scenario,
        state: { tick: 120 },
      },
    };
    expect(classifyPersistedSaveRecord(v1)).toMatchObject({
      classification: 'malformed-known',
    });
    v1.sourceSimulationTick = 120;
    const classified = classifyPersistedSaveRecord(v1);
    expect(classified).toMatchObject({
      classification: 'migratable-transport-v1',
    });
    if (classified.classification !== 'migratable-transport-v1')
      throw new Error('Expected migratable record.');
    expect(classified.summary).not.toHaveProperty('label');
  });
});
