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
  migrateTransportSaveRecordV2,
  migrateTransportSaveRecordV3,
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
    schemaVersion: 3,
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
        schemaVersion: 4,
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
    const summary = summarizeCompatibleSave(record);
    expect(summary).toMatchObject({
      compatibility: 'current',
      scenarioSchemaVersion: '1.0.0',
      scenarioId: 'torrevieja-mini-v1',
      scenarioVersion: '1.0.0',
      contentHash: expect.any(String),
      snapshotVersion: 4,
      vehicleCount: 0,
      sourceSimulationTick: 120,
    });
    expect(Object.isFrozen(summary)).toBe(true);
    expect(Reflect.set(summary, 'scenarioId', 'mutated')).toBe(false);
    const assertCompileTimeReadonly = () => {
      // @ts-expect-error public summaries are readonly
      summary.scenarioId = 'mutated';
    };
    void assertCompileTimeReadonly;
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
      schemaVersion: 3,
      snapshot: {
        schemaVersion: 4,
        state: {
          tick: 120,
          fleet: [],
          passengerDemand: { status: 'disabled' },
        },
      },
    });
    expect(Object.isFrozen(migrated.snapshot.state.fleet)).toBe(true);
  });

  it('classifies Transport V2 as migratable without inferring a route cycle', () => {
    const value = current();
    const v2 = {
      ...value,
      schemaVersion: 2,
      snapshot: {
        kind: value.snapshot.kind,
        scenario: value.snapshot.scenario,
        schemaVersion: 2,
        simulationVersion: 'transport-2',
        state: {
          tick: value.snapshot.state.tick,
          fleet: value.snapshot.state.fleet,
        },
      },
    };
    const classified = classifyPersistedSaveRecord(v2);
    expect(classified).toMatchObject({
      classification: 'migratable-transport-v2',
      summary: { compatibility: 'migratable', snapshotVersion: 2 },
    });
    if (classified.classification !== 'migratable-transport-v2')
      throw new Error('Expected a migratable Transport V2 record.');
    const migrated = migrateTransportSaveRecordV2(classified.record);
    expect(migrated).toMatchObject({
      schemaVersion: 3,
      snapshot: { schemaVersion: 4 },
    });
    expect(migrated.snapshot.state.fleet).toEqual([]);
  });

  it('classifies Transport V3 as migratable with passenger demand disabled', () => {
    const value = current();
    const v3 = {
      ...value,
      snapshot: {
        kind: value.snapshot.kind,
        scenario: value.snapshot.scenario,
        schemaVersion: 3,
        simulationVersion: 'transport-3',
        state: {
          tick: value.snapshot.state.tick,
          fleet: value.snapshot.state.fleet,
        },
      },
    };
    const classified = classifyPersistedSaveRecord(v3);
    expect(classified).toMatchObject({
      classification: 'migratable-transport-v3',
      summary: { compatibility: 'migratable', snapshotVersion: 3 },
    });
    if (classified.classification !== 'migratable-transport-v3')
      throw new Error('Expected a migratable Transport V3 record.');
    expect(migrateTransportSaveRecordV3(classified.record)).toMatchObject({
      schemaVersion: 3,
      snapshot: {
        schemaVersion: 4,
        state: { passengerDemand: { status: 'disabled' } },
      },
    });
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
