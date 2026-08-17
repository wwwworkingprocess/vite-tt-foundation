import { describe, expect, it } from 'vitest';
import {
  scenarioCityDirectory,
  validateScenarioCityDirectory,
} from '../../../../scripts/scenario-city-directory.mjs';

describe('scenario city directory convention', () => {
  it.each([
    ['Torrevieja', 'torrevieja-v1'],
    ['Málaga', 'malaga-v1'],
    ['San Sebastián', 'san_sebastian-v1'],
  ])('normalizes %s to %s', (name, expected) => {
    expect(scenarioCityDirectory(name)).toBe(expected);
  });

  it('rejects a syntactically valid directory owned by the wrong city', () => {
    expect(() =>
      validateScenarioCityDirectory({
        scenarioId: 'malaga-day-legacy-all-v1',
        primarySettlementName: 'Málaga',
        manifestPath: 'banana-v1/malaga-day-legacy-all-v1/scenario.json',
      }),
    ).toThrow(/expected scenario city directory malaga-v1.*banana-v1/i);
  });

  it.each(['Málaga-Centro', "L'Hospitalet", 'City.'])(
    'rejects unsupported punctuation in %s',
    (name) => {
      expect(() => scenarioCityDirectory(name)).toThrow(
        /unsupported filesystem characters/i,
      );
    },
  );
});
