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
    schemaVersion: 1,
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
});
