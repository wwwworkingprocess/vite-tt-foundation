import { describe, expect, it } from 'vitest';
import type { ScenarioCoordinate } from '@torrevieja-tycoon/simulation';
import { createScenarioScopedSaveTarget } from './scenario-save-target.js';

const coordinate: ScenarioCoordinate = Object.freeze({
  scenarioSchemaVersion: '1.0.0',
  scenarioId: 'torrevieja-v1' as ScenarioCoordinate['scenarioId'],
  scenarioVersion: '1.0.0',
  contentHash: 'a'.repeat(64),
});

describe('scenario-scoped save target identity', () => {
  it('produces stable bounded targets for the public coordinates', () => {
    const manual = createScenarioScopedSaveTarget('manual', coordinate);
    const autosave = createScenarioScopedSaveTarget('autosave', coordinate);
    expect(manual).not.toBe(autosave);
    expect(manual).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
    expect(manual.length).toBeLessThanOrEqual(128);
    expect(createScenarioScopedSaveTarget('manual', coordinate)).toBe(manual);
    expect(
      createScenarioScopedSaveTarget('manual', {
        contentHash: coordinate.contentHash,
        scenarioVersion: coordinate.scenarioVersion,
        scenarioId: coordinate.scenarioId,
        scenarioSchemaVersion: coordinate.scenarioSchemaVersion,
      }),
    ).toBe(manual);
  });

  it.each([
    'a'.repeat(400),
    'Torrevieja central scenario',
    'Torrevieja — 交通 🚌',
    'scenario/with?punctuation&symbols',
  ])('accepts every valid domain scenario ID: %s', (scenarioId) => {
    const target = createScenarioScopedSaveTarget('manual', {
      ...coordinate,
      scenarioId: scenarioId as ScenarioCoordinate['scenarioId'],
    });
    expect(target).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
    expect(target.length).toBeLessThanOrEqual(128);
  });

  it.each([
    'scenarioSchemaVersion',
    'scenarioId',
    'scenarioVersion',
    'contentHash',
  ] as const)('changes when %s changes', (field) => {
    const changed = {
      ...coordinate,
      [field]:
        field === 'contentHash'
          ? 'b'.repeat(64)
          : field === 'scenarioId'
            ? 'torrevieja-mini-v1'
            : '2.0.0',
    } as ScenarioCoordinate;
    expect(createScenarioScopedSaveTarget('manual', changed)).not.toBe(
      createScenarioScopedSaveTarget('manual', coordinate),
    );
  });
});
