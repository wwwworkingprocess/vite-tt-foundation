import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createScenarioCoordinate,
  createTransportSimulationSnapshot,
  createTransportSimulationState,
} from '@torrevieja-tycoon/simulation';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import {
  classifyPersistedSaveRecord,
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
    schemaVersion: 6,
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

describe('current-only transport save compatibility', () => {
  it.each([null, undefined, 0, 'save', [], {}, { kind: 'other-save' }])(
    'classifies unrelated value %j without throwing',
    (value) => {
      expect(classifyPersistedSaveRecord(value)).toEqual({
        classification: 'unrelated',
      });
    },
  );

  it('parses, freezes, and summarizes Save V5 with Snapshot V7', () => {
    const record = parseTransportSaveRecord(current());
    const summary = summarizeCompatibleSave(record);
    expect(summary).toMatchObject({
      compatibility: 'current',
      scenarioSchemaVersion: '1.0.0',
      scenarioId: 'torrevieja-mini-v1',
      snapshotVersion: 8,
      vehicleCount: 0,
    });
    expect(Object.isFrozen(record.snapshot.state)).toBe(true);
    expect(Object.isFrozen(summary)).toBe(true);
    expect(Reflect.set(summary, 'scenarioId', 'mutated')).toBe(false);
  });

  it.each([1, 2, 3])(
    'classifies pre-release Transport Save V%s as obsolete without migration',
    (schemaVersion) => {
      expect(
        classifyPersistedSaveRecord({ ...current(), schemaVersion }),
      ).toMatchObject({ classification: 'obsolete-pre-release' });
    },
  );

  it('classifies Foundation Save V1 as obsolete pre-release data', () => {
    expect(
      classifyPersistedSaveRecord({
        kind: 'foundation-save-record',
        schemaVersion: 1,
      }),
    ).toMatchObject({ classification: 'obsolete-pre-release' });
  });

  it('classifies the immediately preceding Save V4 as obsolete pre-release data', () => {
    expect(
      classifyPersistedSaveRecord({
        ...current(),
        schemaVersion: 4,
      }),
    ).toMatchObject({ classification: 'obsolete-pre-release' });
  });

  it('distinguishes future and malformed current records', () => {
    expect(
      classifyPersistedSaveRecord({
        kind: 'transport-save-record',
        schemaVersion: 7,
      }),
    ).toMatchObject({ classification: 'unsupported-future' });
    expect(
      classifyPersistedSaveRecord({ ...current(), sourceSimulationTick: 121 }),
    ).toMatchObject({ classification: 'malformed-known' });
  });
});
